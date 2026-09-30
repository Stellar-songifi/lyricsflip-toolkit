import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitSchema1730000000000 implements MigrationInterface {
  name = 'InitSchema1730000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      CREATE TYPE "users_level_enum" AS ENUM (
        'Gossip Rookie', 'Gossip Regular', 'Gossip Insider', 'Gossip Virtuoso', 'Gossip Guru'
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "walletAddress" varchar,
        "username" varchar NOT NULL,
        "xp" integer NOT NULL DEFAULT 0,
        "score" integer NOT NULL DEFAULT 0,
        "correctGuesses" integer NOT NULL DEFAULT 0,
        "gamesPlayed" integer NOT NULL DEFAULT 0,
        "level" "users_level_enum" NOT NULL DEFAULT 'Gossip Rookie',
        "walletVerifiedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_users_username" UNIQUE ("username"),
        CONSTRAINT "UQ_users_walletAddress" UNIQUE ("walletAddress")
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "lyrics_difficulty_enum" AS ENUM ('easy', 'medium', 'hard')
    `);
    await queryRunner.query(`
      CREATE TABLE "lyrics" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "snippet" text NOT NULL,
        "artist" varchar NOT NULL,
        "title" varchar NOT NULL,
        "genre" varchar NOT NULL,
        "decade" integer NOT NULL,
        "difficulty" "lyrics_difficulty_enum" NOT NULL DEFAULT 'medium',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "game_sessions_mode_enum" AS ENUM ('solo', 'room', 'head_to_head')
    `);
    await queryRunner.query(`
      CREATE TYPE "game_sessions_status_enum" AS ENUM ('waiting', 'active', 'finished')
    `);
    await queryRunner.query(`
      CREATE TABLE "game_sessions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "mode" "game_sessions_mode_enum" NOT NULL,
        "status" "game_sessions_status_enum" NOT NULL DEFAULT 'waiting',
        "playerIds" uuid[] NOT NULL DEFAULT '{}',
        "currentLyricId" uuid,
        "currentRound" integer NOT NULL DEFAULT 0,
        "scores" jsonb NOT NULL DEFAULT '{}',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "wagers_status_enum" AS ENUM (
        'pending', 'awaiting_stakes', 'staked', 'settling', 'won', 'refunded', 'failed'
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "wagers" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "gameSessionId" uuid NOT NULL,
        "playerAId" uuid NOT NULL,
        "playerBId" uuid NOT NULL,
        "stakeAmount" varchar NOT NULL,
        "status" "wagers_status_enum" NOT NULL DEFAULT 'pending',
        "playerAStaked" boolean NOT NULL DEFAULT false,
        "playerBStaked" boolean NOT NULL DEFAULT false,
        "winnerId" uuid,
        "settlementTxHash" varchar,
        "failureReason" varchar,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "FK_wagers_gameSession" FOREIGN KEY ("gameSessionId") REFERENCES "game_sessions"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "wagers"`);
    await queryRunner.query(`DROP TYPE "wagers_status_enum"`);
    await queryRunner.query(`DROP TABLE "game_sessions"`);
    await queryRunner.query(`DROP TYPE "game_sessions_status_enum"`);
    await queryRunner.query(`DROP TYPE "game_sessions_mode_enum"`);
    await queryRunner.query(`DROP TABLE "lyrics"`);
    await queryRunner.query(`DROP TYPE "lyrics_difficulty_enum"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "users_level_enum"`);
  }
}
