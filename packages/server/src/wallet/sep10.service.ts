import { Inject, Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { Keypair, StrKey, TransactionBuilder, WebAuth } from '@stellar/stellar-sdk';
import { DEFAULTS, PVP_SETTLEMENT_OPTIONS, PvpSettlementOptions, Sep10Options } from '../options';

export interface Sep10Challenge {
  /** Base64 challenge transaction for the wallet to sign. */
  transactionXdr: string;
  networkPassphrase: string;
}

/**
 * SEP-10 web authentication:
 * https://developers.stellar.org/docs/learn/fundamentals/stellar-ecosystem-proposals/sep-0010
 *
 * `buildChallenge` issues a challenge signed by the server key; `verify`
 * checks the server's signature, the time bounds and domains, and that the
 * claimed account signed it. The signing key comes from options, so it is
 * stable across restarts and shared by every instance.
 *
 * Supports classic accounts (G...) signed by their master key. Contract
 * accounts (C..., e.g. passkey wallets) need SEP-45 instead.
 */
@Injectable()
export class Sep10Service {
  private readonly config: Sep10Options | null;
  private readonly serverKeypair: Keypair | null;
  /** Challenge hashes already redeemed, until they would have expired anyway. */
  private readonly redeemed = new Map<string, number>();

  constructor(@Inject(PVP_SETTLEMENT_OPTIONS) options: PvpSettlementOptions) {
    this.config = options.sep10 ?? null;
    this.serverKeypair = this.config ? Keypair.fromSecret(this.config.signingSecret) : null;
  }

  get serverAccountId(): string {
    return this.requireConfig().keypair.publicKey();
  }

  buildChallenge(address: string): Sep10Challenge {
    const { config, keypair } = this.requireConfig();
    if (!StrKey.isValidEd25519PublicKey(address)) {
      throw new BadRequestException('Expected a Stellar account address (G...)');
    }
    const transactionXdr = WebAuth.buildChallengeTx(
      keypair,
      address,
      config.homeDomain,
      config.challengeTtlSeconds ?? DEFAULTS.challengeTtlSeconds,
      config.networkPassphrase,
      config.webAuthDomain ?? config.homeDomain,
    );
    return { transactionXdr, networkPassphrase: config.networkPassphrase };
  }

  /**
   * Returns the verified address, or throws `UnauthorizedException`. Each
   * signed challenge can be redeemed once per process.
   */
  verify(address: string, signedTransactionXdr: string): string {
    const { config, keypair } = this.requireConfig();
    let clientAccountID: string;
    let hash: string;
    let maxTime: number;
    try {
      const read = WebAuth.readChallengeTx(
        signedTransactionXdr,
        keypair.publicKey(),
        config.networkPassphrase,
        config.homeDomain,
        config.webAuthDomain ?? config.homeDomain,
      );
      clientAccountID = read.clientAccountID;
      hash = read.tx.hash().toString('hex');
      maxTime = Number(read.tx.timeBounds?.maxTime ?? 0);
      if (!WebAuth.verifyTxSignedBy(read.tx, address)) {
        throw new Error('not signed by the claimed account');
      }
    } catch (err) {
      throw new UnauthorizedException(
        `Invalid SEP-10 challenge: ${err instanceof Error ? err.message : 'unreadable'}`,
      );
    }
    if (clientAccountID !== address) {
      throw new UnauthorizedException('Challenge was issued to a different account');
    }

    this.forgetExpired();
    if (this.redeemed.has(hash)) {
      throw new UnauthorizedException('Challenge has already been used');
    }
    this.redeemed.set(hash, maxTime);
    return address;
  }

  /** Parses an envelope without verifying it; handy for clients and tests. */
  static parse(transactionXdr: string, networkPassphrase: string) {
    return TransactionBuilder.fromXDR(transactionXdr, networkPassphrase);
  }

  private forgetExpired(): void {
    const now = Math.floor(Date.now() / 1000);
    for (const [hash, maxTime] of this.redeemed) {
      if (maxTime < now) this.redeemed.delete(hash);
    }
  }

  private requireConfig(): { config: Sep10Options; keypair: Keypair } {
    if (!this.config || !this.serverKeypair) {
      throw new BadRequestException('SEP-10 is not configured on this server');
    }
    return { config: this.config, keypair: this.serverKeypair };
  }
}
