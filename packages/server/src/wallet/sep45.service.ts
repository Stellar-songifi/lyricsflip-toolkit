import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { UNBOUNDED_MAX_LENGTH, array as xdrArray } from '@stellar/js-xdr';
import {
  Account,
  Address,
  Keypair,
  Operation,
  StrKey,
  TransactionBuilder,
  authorizeEntry,
  buildAuthorizationEntryPreimage,
  hash,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import { createHash, randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { PVP_SETTLEMENT_OPTIONS, PvpSettlementOptions, Sep10Options, Sep45Options } from '../options';
import { Sep10Redeemed } from './sep10-redeemed.entity';

/** A SEP-45 challenge: the authorisation entries a contract account signs. */
export interface Sep45Challenge {
  /** Base64 XDR `SorobanAuthorizationEntries` (the server's entry is already signed). */
  authorizationEntries: string;
  networkPassphrase: string;
}

/** Any valid account works as the source of a simulation; nothing is submitted. */
const SIMULATION_SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const WEB_AUTH_FUNCTION = 'web_auth_verify';
/** Ledgers (~5 s each) a challenge stays valid. */
const DEFAULT_CHALLENGE_LEDGERS = 60;

const entriesSchema = xdrArray(xdr.SorobanAuthorizationEntry.schema, UNBOUNDED_MAX_LENGTH);

export function encodeAuthorizationEntries(entries: xdr.SorobanAuthorizationEntry[]): string {
  return Buffer.from(entriesSchema.encode(entries.map((e) => e.toXdrObject()))).toString('base64');
}

export function decodeAuthorizationEntries(base64: string): xdr.SorobanAuthorizationEntry[] {
  return entriesSchema
    .decode(Buffer.from(base64, 'base64'))
    .map((wire) => xdr.SorobanAuthorizationEntry.fromXdrObject(wire));
}

/**
 * SEP-45 web authentication for contract accounts (`C...`, e.g. passkey smart
 * wallets), the counterpart of {@link Sep10Service} for classic accounts (#61).
 * https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0045.md
 *
 * The challenge is a `web_auth_verify(args)` call on the web auth contract.
 * The server returns the authorisation entries simulation produces, with its
 * own entry signed; the wallet signs its entry and sends them back. `verify`
 * checks the arguments, the server signature and its expiry, re-simulates the
 * call with the signed entries (which runs the wallet's `__check_auth`), and
 * redeems the nonce once in `pvp_sep10_redeemed`.
 *
 * Client-domain verification is not supported: a challenge asking for it is
 * refused.
 */
@Injectable()
export class Sep45Service {
  private readonly sep10: Sep10Options | null;
  private readonly config: Sep45Options | null;
  private readonly serverKeypair: Keypair | null;
  private readonly server: rpc.Server | null;

  constructor(
    @Inject(PVP_SETTLEMENT_OPTIONS) options: PvpSettlementOptions,
    @InjectRepository(Sep10Redeemed)
    private readonly redeemed: Repository<Sep10Redeemed>,
  ) {
    this.sep10 = options.sep10 ?? null;
    this.config = options.sep45 ?? null;
    this.serverKeypair = this.sep10 ? Keypair.fromSecret(this.sep10.signingSecret) : null;
    this.server = this.config
      ? new rpc.Server(this.config.rpcUrl, { allowHttp: this.config.rpcUrl.startsWith('http://') })
      : null;
  }

  get enabled(): boolean {
    return this.config !== null && this.sep10 !== null;
  }

  async buildChallenge(account: string): Promise<Sep45Challenge> {
    const { sep10, config, keypair, server } = this.require();
    if (!StrKey.isValidContract(account)) {
      throw new BadRequestException('Expected a contract account address (C...)');
    }
    const args = this.args(account, randomBytes(16).toString('hex'));
    const simulation = await server.simulateTransaction(this.invocation(args, []));
    if (!rpc.Api.isSimulationSuccess(simulation) || !simulation.result) {
      throw new BadRequestException(
        `Could not build a SEP-45 challenge: ${rpc.Api.isSimulationError(simulation) ? simulation.error : 'no result'}`,
      );
    }
    const latest = (await server.getLatestLedger()).sequence;
    const validUntil = latest + (config.challengeLedgers ?? DEFAULT_CHALLENGE_LEDGERS);
    const entries = await Promise.all(
      simulation.result.auth.map((entry) =>
        credentialAddress(entry) === keypair.publicKey()
          ? authorizeEntry(entry, keypair, validUntil, sep10.networkPassphrase)
          : entry,
      ),
    );
    return { authorizationEntries: encodeAuthorizationEntries(entries), networkPassphrase: sep10.networkPassphrase };
  }

  /**
   * Returns `account` once it has proved control through a signed SEP-45
   * challenge, or throws `UnauthorizedException`. Each challenge redeems once.
   */
  async verify(account: string, authorizationEntries: string): Promise<string> {
    const { sep10, config, keypair, server } = this.require();
    const reject = (reason: string): never => {
      throw new UnauthorizedException(`Invalid SEP-45 challenge: ${reason}`);
    };

    let entries: xdr.SorobanAuthorizationEntry[];
    try {
      entries = decodeAuthorizationEntries(authorizationEntries);
    } catch {
      return reject('authorization_entries is not valid XDR');
    }
    if (entries.length !== 2) reject('expected exactly two entries (client and server)');

    let argsXdr: string | null = null;
    for (const entry of entries) {
      const fn = entry.rootInvocation.function;
      if (fn.type !== 'sorobanAuthorizedFunctionTypeContractFn') return reject('not a contract call');
      const call = fn.contractFn;
      if (Address.fromScAddress(call.contractAddress).toString() !== config.webAuthContractId) {
        reject('wrong web auth contract');
      }
      if (call.functionName.toString() !== WEB_AUTH_FUNCTION) reject(`function is not ${WEB_AUTH_FUNCTION}`);
      if (entry.rootInvocation.subInvocations.length > 0) reject('unexpected sub-invocations');
      if (call.args.length !== 1) reject('expected a single args map');
      const thisArgs = call.args[0].toXDR('base64');
      if (argsXdr !== null && thisArgs !== argsXdr) reject('entries carry different arguments');
      argsXdr = thisArgs;
    }
    const argsVal = xdr.ScVal.fromXDR(argsXdr as string, 'base64');
    const args = scValToNative(argsVal) as Record<string, unknown>;
    const expectArg = (key: string, value: string) => {
      if (args[key] !== value) reject(`${key} does not match`);
    };
    expectArg('account', account);
    expectArg('home_domain', sep10.homeDomain);
    expectArg('web_auth_domain', sep10.webAuthDomain ?? sep10.homeDomain);
    expectArg('web_auth_domain_account', keypair.publicKey());
    if ('client_domain' in args || 'client_domain_account' in args) reject('client domains are not supported');
    const nonce = args.nonce;
    if (typeof nonce !== 'string' || nonce.length < 16) reject('missing nonce');

    const byAddress = new Map(entries.map((e) => [credentialAddress(e), e]));
    const serverEntry = byAddress.get(keypair.publicKey());
    const clientEntry = byAddress.get(account);
    if (!serverEntry) return reject('no server entry');
    if (!clientEntry) return reject('no entry for the account');

    const latest = (await server.getLatestLedger()).sequence;
    const serverCreds = addressCredentials(serverEntry);
    if (!serverCreds || serverCreds.signatureExpirationLedger < latest) reject('challenge has expired');
    if (!this.signedByServer(serverEntry, keypair, sep10.networkPassphrase)) reject('not signed by this server');
    const clientCreds = addressCredentials(clientEntry);
    const window = config.challengeLedgers ?? DEFAULT_CHALLENGE_LEDGERS;
    if (
      !clientCreds ||
      clientCreds.signatureExpirationLedger < latest ||
      clientCreds.signatureExpirationLedger > latest + window
    ) {
      reject("the account's signature is expired or valid for too long");
    }

    // Running the call with the signed entries makes the account's
    // `__check_auth` accept (or reject) its signature.
    const simulation = await server.simulateTransaction(this.invocation(argsVal, entries));
    if (!rpc.Api.isSimulationSuccess(simulation)) {
      reject(`the account did not authorise it (${rpc.Api.isSimulationError(simulation) ? simulation.error : 'no result'})`);
    }

    const redeemedHash = createHash('sha256').update(`sep45:${nonce as string}`).digest('hex');
    const result = await this.redeemed
      .createQueryBuilder()
      .insert()
      .into(Sep10Redeemed)
      .values({ hash: redeemedHash, expiresAt: new Date(Date.now() + window * 6_000) })
      .orIgnore()
      .returning(['hash'])
      .execute();
    if (!(Array.isArray(result.raw) && result.raw.length > 0)) {
      throw new UnauthorizedException('Challenge has already been used');
    }
    return account;
  }

  private args(account: string, nonce: string): xdr.ScVal {
    const { sep10, keypair } = this.require();
    // Soroban maps must be sorted by key.
    const pairs: Array<[string, string]> = [
      ['account', account],
      ['home_domain', sep10.homeDomain],
      ['nonce', nonce],
      ['web_auth_domain', sep10.webAuthDomain ?? sep10.homeDomain],
      ['web_auth_domain_account', keypair.publicKey()],
    ];
    return xdr.ScVal.scvMap(
      pairs.map(
        ([key, value]) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val: xdr.ScVal.scvString(value) }),
      ),
    );
  }

  private invocation(args: xdr.ScVal, auth: xdr.SorobanAuthorizationEntry[]) {
    const { sep10, config } = this.require();
    return new TransactionBuilder(new Account(SIMULATION_SOURCE, '0'), {
      fee: '100',
      networkPassphrase: sep10.networkPassphrase,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: config.webAuthContractId,
          function: WEB_AUTH_FUNCTION,
          args: [args],
          auth,
        }),
      )
      .setTimeout(60)
      .build();
  }

  private signedByServer(entry: xdr.SorobanAuthorizationEntry, keypair: Keypair, passphrase: string): boolean {
    const creds = addressCredentials(entry);
    if (!creds) return false;
    const payload = hash(
      Buffer.from(buildAuthorizationEntryPreimage(entry, creds.signatureExpirationLedger, passphrase).toXDR()),
    );
    const signatures = scValToNative(creds.signature) as Array<{ public_key?: Uint8Array; signature?: Uint8Array }>;
    if (!Array.isArray(signatures)) return false;
    return signatures.some(
      (s) =>
        s.public_key !== undefined &&
        s.signature !== undefined &&
        Buffer.from(s.public_key).equals(keypair.rawPublicKey()) &&
        keypair.verify(Buffer.from(payload), Buffer.from(s.signature)),
    );
  }

  private require() {
    if (!this.config || !this.sep10 || !this.serverKeypair || !this.server) {
      throw new BadRequestException('SEP-45 (contract accounts) is not configured on this server');
    }
    return { sep10: this.sep10, config: this.config, keypair: this.serverKeypair, server: this.server };
  }
}

function addressCredentials(entry: xdr.SorobanAuthorizationEntry): xdr.SorobanAddressCredentials | null {
  const c = entry.credentials;
  if (c.type === 'sorobanCredentialsAddress') return c.address;
  if (c.type === 'sorobanCredentialsAddressV2') return c.addressV2;
  return null;
}

function credentialAddress(entry: xdr.SorobanAuthorizationEntry): string | null {
  const creds = addressCredentials(entry);
  return creds ? Address.fromScAddress(creds.address).toString() : null;
}
