import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUsersXpIndex1750000600000 implements MigrationInterface {
  name = 'AddUsersXpIndex1750000600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_users_xp" ON "users" ("xp")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_users_xp"`);
  }
}
