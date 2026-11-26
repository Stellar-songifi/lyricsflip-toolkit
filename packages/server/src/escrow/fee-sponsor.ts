import { BadRequestException } from '@nestjs/common';
import { Keypair } from '@stellar/stellar-sdk';
import { FeeSponsorshipOptions } from '../options';

export const FEE_SPONSOR_DEFAULTS = {
  /** 1 XLM: far above a normal stake's fee, low enough to cap abuse. */
  maxFeePerStakeStroops: 10_000_000n,
  /** 100 XLM per UTC day across all players. */
  dailyBudgetStroops: 1_000_000_000n,
  /** Sponsored stakes per player per UTC day. */
  maxStakesPerPlayerPerDay: 20,
} as const;

/**
 * Pays stake fees from a server fee account (#60) within limits, so the
 * account can't be drained: a cap per stake, a daily budget, and a daily
 * count per player. Limits are per process and reset at 00:00 UTC; run one
 * sponsor key per instance or lower the limits accordingly.
 */
export class FeeSponsor {
  readonly keypair: Keypair;
  private readonly maxFeePerStake: bigint;
  private readonly dailyBudget: bigint;
  private readonly perPlayer: number;
  private day = '';
  private spent = 0n;
  private readonly stakesToday = new Map<string, number>();

  constructor(
    secret: string,
    limits: FeeSponsorshipOptions = {},
    private readonly now: () => number = Date.now,
  ) {
    this.keypair = Keypair.fromSecret(secret);
    this.maxFeePerStake = BigInt(limits.maxFeePerStakeStroops ?? FEE_SPONSOR_DEFAULTS.maxFeePerStakeStroops);
    this.dailyBudget = BigInt(limits.dailyBudgetStroops ?? FEE_SPONSOR_DEFAULTS.dailyBudgetStroops);
    this.perPlayer = limits.maxStakesPerPlayerPerDay ?? FEE_SPONSOR_DEFAULTS.maxStakesPerPlayerPerDay;
  }

  /**
   * Reserves `maxFee` for `playerId`'s stake, or throws a 400 explaining which
   * limit was hit. Reserves the fee-bump's maximum; the network may charge less.
   */
  reserve(playerId: string, maxFee: bigint): void {
    this.rollDay();
    if (maxFee > this.maxFeePerStake) {
      throw new BadRequestException(
        `This stake's fee (${maxFee} stroops) is above the sponsored maximum of ${this.maxFeePerStake}`,
      );
    }
    const count = this.stakesToday.get(playerId) ?? 0;
    if (count >= this.perPlayer) {
      throw new BadRequestException('You have used your sponsored stakes for today; try again tomorrow');
    }
    if (this.spent + maxFee > this.dailyBudget) {
      throw new BadRequestException("Today's fee sponsorship budget is used up; try again later");
    }
    this.spent += maxFee;
    this.stakesToday.set(playerId, count + 1);
  }

  private rollDay(): void {
    const today = new Date(this.now()).toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.spent = 0n;
      this.stakesToday.clear();
    }
  }
}
