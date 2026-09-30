import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Keypair } from '@stellar/stellar-sdk';
import { DEFAULTS, PVP_SETTLEMENT_OPTIONS, PvpSettlementOptions, StellarSettlementOptions } from '../options';
import {
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
} from './escrow.gateway';

/**
 * Settlement against a deployed `pvp-escrow` contract.
 *
 * - Resolver calls are signed with `stellar.resolverSecret`.
 * - Non-custodial (default): each player's wallet signs its own stake; the
 *   signed envelope is checked to be exactly that stake before submission.
 * - Custodial (refused on `public`): the server signs stakes with the key
 *   `custodialPlayerSecret` returns for the player.
 *
 * Anything that fails before submission is `failed` (nothing reached the
 * network); anything submitted but unconfirmed is `pending`.
 */
@Injectable()
export class StellarEscrowGateway implements EscrowGateway {
  readonly mode = 'stellar' as const;
  private readonly logger = new Logger(StellarEscrowGateway.name);
  private readonly config: StellarSettlementOptions;
  private readonly resolver: Keypair;
  readonly client: PvpEscrowClient;

  constructor(@Inject(PVP_SETTLEMENT_OPTIONS) options: PvpSettlementOptions) {
    if (!options.stellar) throw new Error('StellarEscrowGateway needs the `stellar` options');
    this.config = options.stellar;
    this.resolver = Keypair.fromSecret(this.config.resolverSecret);
    const rpc = new SorobanRpc({
      rpcUrl: this.config.rpcUrl,
      networkPassphrase: this.config.networkPassphrase,
      pollAttempts: this.config.confirmTimeoutSeconds ?? DEFAULTS.confirmTimeoutSeconds,
    });
    this.client = new PvpEscrowClient(rpc, this.config.escrowContractId);
  }

  get resolverAddress(): string {
    return this.resolver.publicKey();
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
    const outcome = await this.attempt('open_pot', () => this.client.openPot(this.resolver, params));
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
      throw new BadRequestException(`Could not build the stake transaction: ${(err as Error).message}`);
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
      if (err instanceof InvalidStakeEnvelopeError) throw new BadRequestException(err.message);
      throw new BadRequestException('Not a valid signed transaction envelope');
    }
    return toOutcome(await this.client.rpc.submit(transaction));
  }

  resolve(potId: string, winner: string): Promise<SubmitOutcome> {
    return this.attempt('resolve', () => this.client.resolve(this.resolver, potId, winner));
  }

  refund(potId: string): Promise<SubmitOutcome> {
    return this.attempt('refund', () => this.client.refund(this.resolver, potId));
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
