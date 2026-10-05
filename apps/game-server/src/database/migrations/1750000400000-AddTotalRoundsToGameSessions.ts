import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sessions now record their own round count, so `ROUNDS_PER_SESSION` can
 * change without moving the finishing line of sessions already in progress,
 * and a single caller can create a shorter or longer session.
 *
 * Existing rows keep the old hardcoded length of 10 through the default.
 */
export class AddTotalRoundsToGameSessions1750000400000 implements MigrationInterface {
  name = 'AddTotalRoundsToGameSessions1750000400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "game_sessions" ADD COLUMN "totalRounds" integer NOT NULL DEFAULT 10`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "game_sessions" DROP COLUMN "totalRounds"`);
  }
}
