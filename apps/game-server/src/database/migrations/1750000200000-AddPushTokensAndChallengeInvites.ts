import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPushTokensAndChallengeInvites1750000200000 implements MigrationInterface {
  name = 'AddPushTokensAndChallengeInvites1750000200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "push_tokens" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "token" varchar(255) NOT NULL,
        "platform" varchar(16) NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_push_tokens_token" UNIQUE ("token")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_push_tokens_userId" ON "push_tokens" ("userId")`);
    await queryRunner.query(`ALTER TABLE "challenges" ADD "invitedUserId" uuid`);
    await queryRunner.query(`ALTER TABLE "notifications" ADD "data" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "notifications" DROP COLUMN "data"`);
    await queryRunner.query(`ALTER TABLE "challenges" DROP COLUMN "invitedUserId"`);
    await queryRunner.query(`DROP INDEX "IDX_push_tokens_userId"`);
    await queryRunner.query(`DROP TABLE "push_tokens"`);
  }
}
