import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddRoundAnswersToGameSessions1750000600000
  implements MigrationInterface
{
  name = 'AddRoundAnswersToGameSessions1750000600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('game_sessions');
    if (!table) {
      return;
    }

    if (!table.findColumnByName('roundAnswers')) {
      await queryRunner.addColumn(
        'game_sessions',
        new TableColumn({
          name: 'roundAnswers',
          type: 'jsonb',
          isNullable: false,
          default: "'{}'",
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('game_sessions');
    if (!table) {
      return;
    }

    if (table.findColumnByName('roundAnswers')) {
      await queryRunner.dropColumn('game_sessions', 'roundAnswers');
    }
  }
}
