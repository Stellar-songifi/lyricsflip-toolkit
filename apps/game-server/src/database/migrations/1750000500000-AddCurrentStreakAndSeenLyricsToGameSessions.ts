import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Moves per-session game state out of `GameService`'s process-local Maps and
 * into the session row (issue #2):
 *
 *   - `currentStreak` — per-player consecutive-correct-answer count, keyed by
 *     userId. Reset to 0 on a miss. Feeds `STREAK_BONUS` in scoring.
 *   - `seenLyricIds` — lyric ids the session has already presented, so a
 *     restart can never re-show one.
 *
 * Both default to empty so existing rows behave exactly as before until the
 * session is next written.
 */
export class AddCurrentStreakAndSeenLyricsToGameSessions1750000500000
  implements MigrationInterface
{
  name = 'AddCurrentStreakAndSeenLyricsToGameSessions1750000500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "game_sessions"
        ADD COLUMN "currentStreak" jsonb NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN "seenLyricIds" uuid[] NOT NULL DEFAULT '{}'::uuid[]
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "game_sessions"
        DROP COLUMN "seenLyricIds",
        DROP COLUMN "currentStreak"
    `);
  }
}