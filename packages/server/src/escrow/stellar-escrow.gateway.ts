import { BadRequestException, Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Keypair } from '@stellar/stellar-sdk';
import { DEFAULTS, PVP_SETTLEMENT_OPTIONS, PvpSettlementOptions, StellarSettlementOptions } from '../options';
import { ResolverKeyProvider } from './resolver-secret';
import { FeeSponsor } from './fee-sponsor';
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Keypair, xdr } from '@stellar/stellar-sdk';
import { DEFAULTS, PVP_SETTLEMENT_OPTIONS, PvpSettlementOptions, StellarSettlementOptions } from '../options';
import { ResolverKeyProvider } from './resolver-secret';

/** Ledgers (~5s each) a smart wallet has to sign and return a stake authorisation. */
const STAKE_AUTH_VALID_LEDGERS = 60;
import { toUserFacingError } from '../wager/wager.errors';
import {
  InvalidStakeAuthError,
  InvalidStakeEnvelopeError,
  PvpEscrowClient,
  PvpEscrowError,
  SorobanRpc,
  Submission,
  isContractError,
} from '@lyricsflip-toolkit/sdk';
import {
  EscrowGateway,
  OpenPotOutcome,
  OpenPotParams,
  PotState,
  SubmitOutcome,
  UnsignedStake,
  UnsignedStakeAuth,
} from './escrow.gateway';

/**
 * Settlement against a deployed `pvp-escrow` contract.
 *
 * - Resolver calls are signed with the key `stellar.resolverSecret` holds, or,
 *   when `stellar.resolverSecretProvider` is set, re-read from it before each
 *   call so the key can be rotated without a restart.
 * - Non-custodial (default): each player's wallet signs its own stake; the
 *   signed envelope is checked to be exactly that stake before submission.
 * - Custodial (refused on `public`): the server signs stakes with the key
 *   `custodialPlayerSecret` returns for the player.
 *
 * Anything that fails before submission is `failed` (nothing reached the
 * network); anything submitted but unconfirmed is `pending`.
 */
@Injectable()
export class StellarEscrowGateway implements EscrowGateway, OnApplicationBootstrap {
  readonly mode = 'stellar' as const;
  private readonly logger = new Logger(StellarEscrowGateway.name);
  private readonly config: StellarSettlementOptions;
  private readonly resolverKeys: ResolverKeyProvider;
  /** Pays players' stake fees when `feeSponsorSecret` is set (#60). */
  readonly feeSponsor: FeeSponsor | null;
  readonly client: PvpEscrowClient;

  constructor(@Inject(PVP_SETTLEMENT_OPTIONS) options: PvpSettlementOptions) {
    if (!options.stellar) throw new Error('StellarEscrowGateway needs the `stellar` options');
    this.config = options.stellar;
    this.resolverKeys = new ResolverKeyProvider(this.config, this.logger);
    if (!this.config.resolverSecretProvider && this.config.network !== 'local') {
      this.logger.warn(
        `Stellar settlement is signing with a static resolverSecret on "${this.config.network}": ` +
          'the resolver key cannot be rotated without a restart. Set ' +
          '`stellar.resolverSecretProvider` to rotate it without downtime.',
      );
    }
    const rpc = new SorobanRpc({
      rpcUrl: this.config.rpcUrl,
      networkPassphrase: this.config.networkPassphrase,
      pollAttempts: this.config.confirmTimeoutSeconds ?? DEFAULTS.confirmTimeoutSeconds,
      // Bounds every RPC request, so a slow node fails a settlement call rather
      // than holding the request handler open forever.
      httpTimeoutMs: this.config.httpTimeoutMs ?? DEFAULTS.httpTimeoutMs,
    });
    this.client = new PvpEscrowClient(rpc, this.config.escrowContractId);
    this.feeSponsor = this.config.feeSponsorSecret
      ? new FeeSponsor(this.config.feeSponsorSecret, this.config.feeSponsorship)
      : null;
  }

  /**
   * The resolver public key as last seen, without hitting the secrets manager.
   * Empty until a provider has been read at least once.
   */
  get resolverAddress(): string {
    return this.resolverKeys.lastKnownAddress ?? '';
  }

  /** The resolver public key right now, re-reading through the provider if it is due. */
  async currentResolverAddress(): Promise<string> {
    return (await this.resolverKeys.resolve()).publicKey();
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.checkContractConfig();
  }

  /**
   * Checks the deployed contract against this server's settings (#58): that
   * `escrowContractId` answers `get_config`, that its resolver is the key we
   * sign with and that its token is `tokenContractId`. Logs the admin so an
   * operator can confirm it is the expected multisig. Throws (or warns, with
   * `configCheck: 'warn'`) on a mismatch, so a wrong contract id or a resolver
   * rotated on-chain but not here fails at boot instead of at the first pot.
   */
  async checkContractConfig(): Promise<void> {
    const mode = this.config.configCheck ?? 'fail';
    if (mode === 'off') return;

    const problems: string[] = [];
    try {
      const onChain = await this.client.getConfig();
      const resolver = await this.currentResolverAddress();
      this.logger.log(
        `Escrow ${this.config.escrowContractId}: admin ${onChain.admin}, resolver ${onChain.resolver}, token ${onChain.token}`,
      );
      if (onChain.resolver !== resolver) {
        problems.push(
          `its resolver is ${onChain.resolver}, but this server signs as ${resolver} ` +
            '(rotate the key here or call set_resolver on-chain)',
        );
      }
      if (onChain.token !== this.config.tokenContractId) {
        problems.push(`its token is ${onChain.token}, but tokenContractId is ${this.config.tokenContractId}`);
      }
    } catch (err) {
      problems.push(
        `get_config failed (${(err as Error).message}); is escrowContractId a pvp-escrow deployment on this network?`,
      );
    }
    if (problems.length === 0) return;

    const message = `Escrow contract ${this.config.escrowContractId} does not match this server: ${problems.join('; ')}`;
    if (mode === 'warn') {
      this.logger.warn(`${message} (continuing because stellar.configCheck is "warn")`);
      return;
    }
    throw new Error(`${message}. Set stellar.configCheck to "warn" to boot anyway during a rotation.`);
  }

  async openPot(params: OpenPotParams): Promise<OpenPotOutcome> {
    // Idempotent: a retry after a lost confirmation finds the pot already there.
    const existing = await this.safeGetPot(params.potId);
    if (existing) {
      const same =
        existing.playerA === params.playerA &&
        existing.playerB === params.playerB &&
        existing.stakeAmount === params.stakeAmount;
      return same
        ? { status: 'confirmed', txHash: null, deadlineLedger: existing.deadlineLedger }
        : { status: 'failed', txHash: null, error: 'A different pot already exists under this id' };
    }
    const outcome = await this.attempt('open_pot', async () =>
      this.client.openPot(await this.resolverKeys.resolve(), params),
    );
    if (outcome.status !== 'confirmed') return outcome;
    const pot = await this.safeGetPot(params.potId);
    return { ...outcome, deadlineLedger: pot?.deadlineLedger };
  }

  async buildStake(potId: string, player: string, playerId: string): Promise<UnsignedStake | null> {
    if (await this.custodialSigner(playerId, player)) return null;
    try {
      const transaction = await this.client.buildStake(
        potId,
        player,
        this.config.stakeTxTimeoutSeconds ?? DEFAULTS.stakeTxTimeoutSeconds,
      );
      return { transactionXdr: transaction.toXDR(), networkPassphrase: this.config.networkPassphrase };
    } catch (err) {
      // The SDK message can echo an RPC URL or raw XDR; keep it server-side only.
      this.logger.warn(`buildStake failed for pot ${potId}: ${(err as Error).message}`);
      const mapped = toUserFacingError(err);
      throw new BadRequestException({ code: mapped.code, message: mapped.message });
    }
  }

  async submitStake(
    potId: string,
    player: string,
    playerId: string,
    signedTransactionXdr: string | null,
  ): Promise<SubmitOutcome> {
    const signer = await this.custodialSigner(playerId, player);
    if (signer) {
      return this.attempt('stake', async () => {
        const transaction = await this.client.buildStake(potId, player);
        return this.client.rpc.signAndSubmit(transaction, [signer]);
      });
    }
    if (!signedTransactionXdr) {
      throw new BadRequestException('Sign the stake transaction in your wallet and send it back');
    }
    let transaction;
    try {
      transaction = this.client.rpc.fromXdr(signedTransactionXdr);
      this.client.assertIsStake(transaction, potId, player);
    } catch (err) {
      this.logger.warn(`submitStake rejected the envelope for pot ${potId}: ${(err as Error).message}`);
      if (err instanceof InvalidStakeEnvelopeError) {
        const mapped = toUserFacingError(err);
        throw new BadRequestException({ code: mapped.code, message: mapped.message });
      }
      throw new BadRequestException({
        code: 'INVALID_STAKE_ENVELOPE',
        message: 'Not a valid signed transaction envelope',
      });
    }
    if (this.feeSponsor) {
      // The player's envelope was checked above; the fee-bump wraps it
      // unchanged and only the fee account pays.
      const { transaction: sponsored, maxFee } = this.client.rpc.sponsorFee(transaction, this.feeSponsor.keypair);
      this.feeSponsor.reserve(playerId, maxFee);
      return toOutcome(await this.client.rpc.submit(sponsored));
    }
    return toOutcome(await this.client.rpc.submit(transaction));
  }

  /**
   * Relayed stake for a smart wallet (#62): the server's resolver account is
   * the transaction source and pays the fee; the player only signs the
   * authorisation entry for `stake(potId, player)`.
   */
  async buildStakeAuth(potId: string, player: string): Promise<UnsignedStakeAuth> {
    try {
      const relayer = (await this.resolverKeys.resolve()).publicKey();
      const request = await this.client.buildStakeAuth(potId, player, relayer, STAKE_AUTH_VALID_LEDGERS);
      return {
        authEntryXdr: request.authEntryXdr,
        expirationLedger: request.expirationLedger,
        networkPassphrase: request.networkPassphrase,
      };
    } catch (err) {
      throw new BadRequestException(`Could not build the stake authorisation: ${(err as Error).message}`);
    }
  }

  async submitStakeAuth(potId: string, player: string, signedAuthEntryXdr: string): Promise<SubmitOutcome> {
    let entry: xdr.SorobanAuthorizationEntry;
    try {
      entry = xdr.SorobanAuthorizationEntry.fromXDR(signedAuthEntryXdr, 'base64');
    } catch {
      throw new BadRequestException('Not a valid authorisation entry');
    }
    try {
      this.client.assertIsStakeAuth(entry, potId, player);
    } catch (err) {
      if (err instanceof InvalidStakeAuthError) throw new BadRequestException(err.message);
      throw err;
    }
    return this.attempt('stake', async () => {
      const relayer = await this.resolverKeys.resolve();
      const transaction = await this.client.buildStakeWithAuth(potId, player, entry, relayer.publicKey());
      return this.client.rpc.signAndSubmit(transaction, [relayer]);
    });
  }

  resolve(potId: string, winner: string): Promise<SubmitOutcome> {
    return this.attempt('resolve', async () =>
      this.client.resolve(await this.resolverKeys.resolve(), potId, winner),
    );
  }

  refund(potId: string): Promise<SubmitOutcome> {
    return this.attempt('refund', async () =>
      this.client.refund(await this.resolverKeys.resolve(), potId),
    );
  }

  async getPot(potId: string): Promise<PotState | null> {
    // Errors propagate: "couldn't read the pot" must never look like "no pot".
    return this.client.getPot(potId);
  }

  /** Builds and submits; anything thrown before submission is a definite failure. */
  private async attempt(method: string, run: () => Promise<Submission>): Promise<SubmitOutcome> {
    try {
      return toOutcome(await run());
    } catch (err) {
      this.logger.warn(`${method} was not submitted: ${(err as Error).message}`);
      return { status: 'failed', txHash: null, error: (err as Error).message };
    }
  }

  private async safeGetPot(potId: string): Promise<PotState | null> {
    try {
      return await this.client.getPot(potId);
    } catch (err) {
      if (isContractError(err, PvpEscrowError.PotNotFound)) return null;
      throw err;
    }
  }

  private async custodialSigner(playerId: string, player: string): Promise<Keypair | null> {
    if (this.config.custodyMode !== 'custodial' || !this.config.custodialPlayerSecret) return null;
    if (this.config.network === 'public') {
      throw new Error('Custodial signing is refused on the public network');
    }
    const secret = await this.config.custodialPlayerSecret(playerId);
    if (!secret) return null;
    const keypair = Keypair.fromSecret(secret);
    if (keypair.publicKey() !== player) {
      throw new BadRequestException("The custodial key doesn't match the player's linked wallet");
    }
    return keypair;
  }
}

function toOutcome(submission: Submission): SubmitOutcome {
  return {
    status: submission.status,
    txHash: submission.hash,
    ledger: submission.ledger,
    error: submission.error,
  };
}
