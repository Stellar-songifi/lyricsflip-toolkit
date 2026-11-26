import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserRole1750000600000 implements MigrationInterface {
  name = 'AddUserRole1750000600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "users_role_enum" AS ENUM ('player', 'operator', 'admin')`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "role" "users_role_enum" NOT NULL DEFAULT 'player'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "role"`);
    await queryRunner.query(`DROP TYPE "users_role_enum"`);
  }
}
