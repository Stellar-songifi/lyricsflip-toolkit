import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChallengesAndNotifications1730000100000 implements MigrationInterface {
  name = 'AddChallengesAndNotifications1730000100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "notifications" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "type" varchar NOT NULL,
        "message" varchar NOT NULL,
        "read" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_notifications_userId" ON "notifications" ("userId")`);

    await queryRunner.query(`
      CREATE TYPE "challenges_status_enum" AS ENUM ('pending', 'accepted', 'expired')
    `);
    await queryRunner.query(`
      CREATE TABLE "challenges" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "code" varchar(8) NOT NULL,
        "hostUserId" uuid NOT NULL,
        "stakeAmount" varchar,
        "status" "challenges_status_enum" NOT NULL DEFAULT 'pending',
        "gameSessionId" uuid,
        "wagerId" uuid,
        "expiresAt" TIMESTAMP NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_challenges_code" UNIQUE ("code")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "challenges"`);
    await queryRunner.query(`DROP TYPE "challenges_status_enum"`);
    await queryRunner.query(`DROP INDEX "IDX_notifications_userId"`);
    await queryRunner.query(`DROP TABLE "notifications"`);
  }
}
