import { Inject, Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { Keypair, StrKey, TransactionBuilder, WebAuth } from '@stellar/stellar-sdk';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { DEFAULTS, PVP_SETTLEMENT_OPTIONS, PvpSettlementOptions, Sep10Options } from '../options';
import { Sep10Redeemed } from './sep10-redeemed.entity';

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
 * Replay protection is **database-backed** (issue #1): `verify` inserts the
 * challenge's transaction hash into `pvp_sep10_redeemed` with
 * `ON CONFLICT DO NOTHING`, and treats a no-op insert as a replay. That is
 * atomic across instances sharing a database, and it survives a process
 * restart, so the service is stateless and scales horizontally.
 *
 * Supports classic accounts (G...) signed by their master key. Contract
 * accounts (C..., e.g. passkey wallets) need SEP-45 instead.
 */
@Injectable()
export class Sep10Service {
  private readonly config: Sep10Options | null;
  private readonly serverKeypair: Keypair | null;

  constructor(
    @Inject(PVP_SETTLEMENT_OPTIONS) options: PvpSettlementOptions,
    @InjectRepository(Sep10Redeemed)
    private readonly redeemed: Repository<Sep10Redeemed>,
  ) {
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
   * signed challenge can be redeemed exactly once, across every instance
   * sharing this database (issue #1).
   */
  async verify(address: string, signedTransactionXdr: string): Promise<string> {
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
      hash = Buffer.from(read.tx.hash()).toString('hex');
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

    // Atomic single-use: ON CONFLICT DO NOTHING means a second insert of the
    // same hash affects 0 rows. Two concurrent verifies of the same signed
    // challenge can both reach this line; exactly one wins.
    const result = await this.redeemed
      .createQueryBuilder()
      .insert()
      .into(Sep10Redeemed)
      .values({ hash, expiresAt: new Date(maxTime * 1000) })
      .orIgnore()
      .returning(['hash'])
      .execute();

    // RETURNING yields no row when the conflict skipped the insert. Don't use
    // `identifiers`: TypeORM fills it from the supplied primary key either way.
    const inserted = Array.isArray(result.raw) && result.raw.length > 0;
    if (!inserted) {
      throw new UnauthorizedException('Challenge has already been used');
    }
    return address;
  }

  /**
   * Deletes redeemed rows whose challenge time bound has lapsed. Called by
   * `Sep10CleanupService` on an interval; kept public so the reconciler or
   * a test can drive it directly.
   */
  async forgetExpired(now: Date = new Date()): Promise<number> {
    const result = await this.redeemed.delete({ expiresAt: LessThan(now) });
    return result.affected ?? 0;
  }

  /** Parses an envelope without verifying it; handy for clients and tests. */
  static parse(transactionXdr: string, networkPassphrase: string) {
    return TransactionBuilder.fromXDR(transactionXdr, networkPassphrase);
  }

  private requireConfig(): { config: Sep10Options; keypair: Keypair } {
    if (!this.config || !this.serverKeypair) {
      throw new BadRequestException('SEP-10 is not configured on this server');
    }
    return { config: this.config, keypair: this.serverKeypair };
  }
}