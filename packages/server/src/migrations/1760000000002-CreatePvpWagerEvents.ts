import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

export class CreatePvpWagerEvents1760000000002 implements MigrationInterface {
  name = 'CreatePvpWagerEvents1760000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'pvp_wager_events',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          {
            name: 'wagerId',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'type',
            type: 'varchar',
            length: '64',
            isNullable: false,
          },
          {
            name: 'payload',
            type: 'jsonb',
            isNullable: false,
          },
          {
            name: 'createdAt',
            type: 'timestamptz',
            isNullable: false,
            default: 'now()',
          },
          {
            name: 'deliveredAt',
            type: 'timestamptz',
            isNullable: true,
          },
          {
            name: 'attempts',
            type: 'int',
            isNullable: false,
            default: 0,
          },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'pvp_wager_events',
      new TableForeignKey({
        columnNames: ['wagerId'],
        referencedTableName: 'pvp_wagers',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createIndex(
      'pvp_wager_events',
      new TableIndex({
        name: 'IDX_pvp_wager_events_deliveredAt_createdAt',
        columnNames: ['deliveredAt', 'createdAt'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('pvp_wager_events', true);
  }
}