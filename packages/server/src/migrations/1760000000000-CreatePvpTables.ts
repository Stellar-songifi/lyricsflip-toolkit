import { MigrationInterface, QueryRunner } from 'typeorm';

/** Creates the toolkit's tables. Needs PostgreSQL 13+ for `gen_random_uuid()`. */
export class CreatePvpTables1760000000000 implements MigrationInterface {
  name = 'CreatePvpTables1760000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "pvp_wager_status" AS ENUM (
        'pending', 'awaiting_stakes', 'staked', 'settling', 'won', 'refunded', 'cancelled', 'failed'
      )
    `);
    await queryRunner.query(`CREATE TYPE "pvp_settlement_kind" AS ENUM ('payout', 'refund')`);
    await queryRunner.query(`
      CREATE TABLE "pvp_wagers" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "matchId" varchar(128) NOT NULL,
        "playerAId" varchar(128) NOT NULL,
        "playerBId" varchar(128) NOT NULL,
        "stakeAmount" varchar(40) NOT NULL,
        "status" "pvp_wager_status" NOT NULL DEFAULT 'pending',
        "playerAAddress" varchar(64),
        "playerBAddress" varchar(64),
        "acceptedAt" timestamptz,
        "potDeadlineLedger" integer,
        "playerAStakeTxHash" varchar(128),
        "playerBStakeTxHash" varchar(128),
        "playerAStakedAt" timestamptz,
        "playerBStakedAt" timestamptz,
        "settlementKind" "pvp_settlement_kind",
        "winnerId" varchar(128),
        "settlementTxHash" varchar(128),
        "settlementLedger" integer,
        "reconcileAttempts" integer NOT NULL DEFAULT 0,
        "failureReason" text,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_pvp_wagers_distinct_players" CHECK ("playerAId" <> "playerBId")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_pvp_wagers_matchId" ON "pvp_wagers" ("matchId")`);
    await queryRunner.query(`CREATE INDEX "IDX_pvp_wagers_status" ON "pvp_wagers" ("status")`);
    await queryRunner.query(`CREATE INDEX "IDX_pvp_wagers_playerAId" ON "pvp_wagers" ("playerAId")`);
    await queryRunner.query(`CREATE INDEX "IDX_pvp_wagers_playerBId" ON "pvp_wagers" ("playerBId")`);

    await queryRunner.query(`
      CREATE TABLE "pvp_wallet_links" (
        "playerId" varchar(128) PRIMARY KEY,
        "address" varchar(64) NOT NULL UNIQUE,
        "verifiedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "pvp_mock_pots" (
        "id" uuid PRIMARY KEY,
        "playerA" varchar(64) NOT NULL,
        "playerB" varchar(64) NOT NULL,
        "stakeAmount" varchar(40) NOT NULL,
        "playerAStaked" boolean NOT NULL DEFAULT false,
        "playerBStaked" boolean NOT NULL DEFAULT false,
        "status" varchar(16) NOT NULL,
        "deadlineLedger" integer NOT NULL,
        "winner" varchar(64),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "pvp_mock_pots"`);
    await queryRunner.query(`DROP TABLE "pvp_wallet_links"`);
    await queryRunner.query(`DROP TABLE "pvp_wagers"`);
    await queryRunner.query(`DROP TYPE "pvp_settlement_kind"`);
    await queryRunner.query(`DROP TYPE "pvp_wager_status"`);
  }
}
