import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * SEP-10 replay protection across processes and instances (issue #1).
 *
 * `hash` is the primary key so an atomic `INSERT ... ON CONFLICT DO NOTHING`
 * can detect a replay. The index on `expiresAt` supports the periodic
 * cleanup that deletes rows once the challenge's time bound has lapsed.
 */
export class AddSep10Redeemed1760000000001 implements MigrationInterface {
  name = 'AddSep10Redeemed1760000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "pvp_sep10_redeemed" (
        "hash" varchar(64) PRIMARY KEY,
        "expiresAt" timestamptz NOT NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_pvp_sep10_redeemed_expiresAt" ON "pvp_sep10_redeemed" ("expiresAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_pvp_sep10_redeemed_expiresAt"`);
    await queryRunner.query(`DROP TABLE "pvp_sep10_redeemed"`);
  }
}