import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Database-level guards for the wager state machine (issue #66).
 *
 * `WagerService` already enforces these, but a manual fix or a future bug
 * could otherwise write rows the reconciler never expects. Each rule mirrors
 * what the service actually writes:
 *
 * - `CHK_pvp_wagers_stake_amount`: stroops as a positive integer string.
 * - `CHK_pvp_wagers_distinct_players` (a player can't wager against themself)
 *   already exists from `CreatePvpTables1760000000000`.
 * - `CHK_pvp_wagers_settlement_kind`: `settling`, `won` and `refunded` are only
 *   reached through `settle`/`abort`, which always record the kind first.
 *   (`refunded` may carry `payout` when the players reclaimed their stakes.)
 * - `CHK_pvp_wagers_won`: a won wager was a payout to a recorded winner.
 * - `CHK_pvp_wagers_winner_kind`: a winner exists only for a payout, and every
 *   payout has one.
 * - `CHK_pvp_wagers_winner_player`: the winner is one of the two players.
 * - `CHK_pvp_wagers_reconcile_attempts`: never negative.
 */
export class AddWagerInvariantChecks1760000000002 implements MigrationInterface {
  name = 'AddWagerInvariantChecks1760000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "pvp_wagers"
        ADD CONSTRAINT "CHK_pvp_wagers_stake_amount"
          CHECK ("stakeAmount" ~ '^[1-9][0-9]*$'),
        ADD CONSTRAINT "CHK_pvp_wagers_settlement_kind"
          CHECK ("status" NOT IN ('settling', 'won', 'refunded') OR "settlementKind" IS NOT NULL),
        ADD CONSTRAINT "CHK_pvp_wagers_won"
          CHECK ("status" <> 'won' OR ("winnerId" IS NOT NULL AND "settlementKind" = 'payout')),
        ADD CONSTRAINT "CHK_pvp_wagers_winner_kind"
          CHECK (("winnerId" IS NULL) = ("settlementKind" IS NULL OR "settlementKind" <> 'payout')),
        ADD CONSTRAINT "CHK_pvp_wagers_winner_player"
          CHECK ("winnerId" IS NULL OR "winnerId" IN ("playerAId", "playerBId")),
        ADD CONSTRAINT "CHK_pvp_wagers_reconcile_attempts"
          CHECK ("reconcileAttempts" >= 0)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const name of [
      'CHK_pvp_wagers_reconcile_attempts',
      'CHK_pvp_wagers_winner_player',
      'CHK_pvp_wagers_winner_kind',
      'CHK_pvp_wagers_won',
      'CHK_pvp_wagers_settlement_kind',
      'CHK_pvp_wagers_stake_amount',
    ]) {
      await queryRunner.query(`ALTER TABLE "pvp_wagers" DROP CONSTRAINT "${name}"`);
    }
  }
}
