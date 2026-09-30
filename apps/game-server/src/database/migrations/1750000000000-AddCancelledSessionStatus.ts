import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCancelledSessionStatus1750000000000 implements MigrationInterface {
  name = 'AddCancelledSessionStatus1750000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "game_sessions_status_enum" ADD VALUE IF NOT EXISTS 'cancelled'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres can't drop an enum value; leaving it is harmless.
  }
}
