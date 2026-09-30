import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDailyChallenge1750000300000 implements MigrationInterface {
  name = 'AddDailyChallenge1750000300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "daily_challenges" (
        "date" date PRIMARY KEY,
        "lyricIds" uuid[] NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "daily_attempts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "challengeDate" date NOT NULL,
        "lyricId" uuid NOT NULL,
        "outcome" varchar(16) NOT NULL,
        "points" integer NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_daily_attempt_user_day_lyric" UNIQUE ("userId", "challengeDate", "lyricId")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_daily_attempt_day" ON "daily_attempts" ("challengeDate")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "daily_attempts"`);
    await queryRunner.query(`DROP TABLE "daily_challenges"`);
  }
}
