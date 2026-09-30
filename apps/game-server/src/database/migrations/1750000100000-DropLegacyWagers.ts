import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Wagers now live in the toolkit's `pvp_wagers` table (created by
 * `@lyricsflip-toolkit/server`'s migrations). The old table only ever held
 * mock-mode rows — `stellar` mode was never implemented — so it is dropped
 * rather than migrated.
 */
export class DropLegacyWagers1750000100000 implements MigrationInterface {
  name = 'DropLegacyWagers1750000100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "wagers"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "wagers_status_enum"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "wagers_status_enum" AS ENUM (
        'pending', 'awaiting_stakes', 'staked', 'settling', 'won', 'refunded', 'failed'
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "wagers" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "gameSessionId" uuid NOT NULL,
        "playerAId" uuid NOT NULL,
        "playerBId" uuid NOT NULL,
        "stakeAmount" varchar NOT NULL,
        "status" "wagers_status_enum" NOT NULL DEFAULT 'pending',
        "playerAStaked" boolean NOT NULL DEFAULT false,
        "playerBStaked" boolean NOT NULL DEFAULT false,
        "winnerId" uuid,
        "settlementTxHash" varchar,
        "failureReason" varchar,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "FK_wagers_gameSession" FOREIGN KEY ("gameSessionId") REFERENCES "game_sessions"("id") ON DELETE CASCADE
      )
    `);
  }
}
