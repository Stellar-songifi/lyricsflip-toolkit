import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { GameSession, GameSessionStatus, GameMode } from './entities/game-session.entity';
import { LyricsService } from '../lyrics/lyrics.service';
import { UsersService } from '../users/users.service';
import { GuessOutcome, scoreGuess } from './scoring';
import type { AppConfig } from '../../config/configuration';

export interface PublicLyric {
  id: string;
  snippet: string;
  genre: string;
  decade: number;
}

export interface GuessResult {
  outcome: GuessOutcome;
  pointsAwarded: number;
  streak: number;
  nextLyric: PublicLyric | null;
  sessionStatus: GameSessionStatus;
  /** Rounds this session runs for; `currentRound` reaches it on the last guess. */
  totalRounds: number;
}

/** Emitted once, by the server, when a session's last round is scored. */
export interface SessionFinishedEvent {
  sessionId: string;
  mode: GameMode;
  playerIds: string[];
  scores: Record<string, number>;
}

/** Options for {@link GameService.createSession}. */
export interface CreateSessionOptions {
  /** Stay `waiting` until {@link GameService.activate}, for a staked match. */
  waitForStakes?: boolean;
  /**
   * Rounds this session runs for, overriding `ROUNDS_PER_SESSION`. Lets a game
   * mode pick its own length (a coin flip wants 1, trivia might want 20).
   */
  rounds?: number;
}

@Injectable()
export class GameService {
  /** `sessionId:userId` -> current correct-answer streak. Reset to 0 on a miss. */
  private readonly streaks = new Map<string, number>();
  /** sessionId -> lyric ids already shown, so a session never repeats one. */
  private readonly seenLyrics = new Map<string, string[]>();

  constructor(
    @InjectRepository(GameSession)
    private readonly sessionsRepository: Repository<GameSession>,
    private readonly lyricsService: LyricsService,
    private readonly usersService: UsersService,
    private readonly eventEmitter: EventEmitter2,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  /**
   * Starts a session. With `waitForStakes`, it stays `waiting` until
   * {@link activate} is called, so a staked match can't be played before
   * both stakes are confirmed.
   *
   * The session's length comes from `ROUNDS_PER_SESSION` unless `options.rounds`
   * overrides it. It is stored on the session, so changing the environment
   * variable never moves the finishing line of a session already in progress.
   */
  async createSession(
    hostUserId: string,
    mode: GameMode,
    options: CreateSessionOptions = {},
  ): Promise<GameSession> {
    if (
      options.rounds !== undefined &&
      (!Number.isInteger(options.rounds) || options.rounds < 1)
    ) {
      throw new BadRequestException('rounds must be a positive integer');
    }
    const totalRounds =
      options.rounds ?? this.configService.get('roundsPerSession', { infer: true });

    const lyric = await this.lyricsService.getRandom();

    const session = this.sessionsRepository.create({
      mode,
      status: options.waitForStakes ? GameSessionStatus.WAITING : GameSessionStatus.ACTIVE,
      playerIds: [hostUserId],
      currentLyricId: lyric.id,
      currentRound: 1,
      totalRounds,
      scores: { [hostUserId]: 0 },
    });
    const saved = await this.sessionsRepository.save(session);
    this.seenLyrics.set(saved.id, [lyric.id]);

    return saved;
  }

  async joinSession(sessionId: string, userId: string): Promise<GameSession> {
    const session = await this.getSession(sessionId);
    if (session.status === GameSessionStatus.FINISHED || session.status === GameSessionStatus.CANCELLED) {
      throw new BadRequestException('This session is over');
    }
    if (session.mode === GameMode.SOLO && !session.playerIds.includes(userId)) {
      throw new BadRequestException('Solo sessions only take one player');
    }
    if (session.mode === GameMode.HEAD_TO_HEAD && session.playerIds.length >= 2) {
      throw new BadRequestException('Head-to-head sessions only take two players');
    }
    if (!session.playerIds.includes(userId)) {
      session.playerIds.push(userId);
      session.scores[userId] = 0;
      await this.sessionsRepository.save(session);
    }
    return session;
  }

  /** Makes a waiting session playable. No-op if it's already active. */
  async activate(sessionId: string): Promise<GameSession> {
    await this.sessionsRepository.update(
      { id: sessionId, status: GameSessionStatus.WAITING },
      { status: GameSessionStatus.ACTIVE },
    );
    return this.getSession(sessionId);
  }

  /** Cancels a session that hasn't started. A played session is left alone. */
  async cancel(sessionId: string): Promise<void> {
    await this.sessionsRepository.update(
      { id: sessionId, status: GameSessionStatus.WAITING },
      { status: GameSessionStatus.CANCELLED },
    );
  }

  async getSession(sessionId: string): Promise<GameSession> {
    const session = await this.sessionsRepository.findOne({ where: { id: sessionId } });
    if (!session) {
      throw new NotFoundException(`Game session ${sessionId} not found`);
    }
    return session;
  }

  async getCurrentLyric(sessionId: string): Promise<PublicLyric> {
    const session = await this.getSession(sessionId);
    if (!session.currentLyricId) {
      throw new BadRequestException('Session has no active card');
    }
    return toPublicLyric(await this.lyricsService.findById(session.currentLyricId));
  }

  async submitGuess(sessionId: string, userId: string, guessText: string): Promise<GuessResult> {
    const session = await this.getSession(sessionId);
    if (session.status !== GameSessionStatus.ACTIVE) {
      throw new BadRequestException('Session is not active');
    }
    if (!session.currentLyricId) {
      throw new BadRequestException('Session has no active card');
    }
    if (!session.playerIds.includes(userId)) {
      throw new BadRequestException('Player is not part of this session');
    }

    const lyric = await this.lyricsService.findById(session.currentLyricId);
    const streakKey = `${sessionId}:${userId}`;
    const streak = this.streaks.get(streakKey) ?? 0;

    // A guess can name either the title or the artist — score against both
    // and keep whichever classifies better.
    const byTitle = scoreGuess(guessText, lyric.title, lyric.difficulty, streak);
    const byArtist = scoreGuess(guessText, lyric.artist, lyric.difficulty, streak);
    const { outcome: finalOutcome, points: finalPoints } =
      byArtist.points > byTitle.points ? byArtist : byTitle;

    if (finalOutcome === GuessOutcome.CORRECT) {
      this.streaks.set(streakKey, streak + 1);
    } else if (finalOutcome === GuessOutcome.MISS) {
      this.streaks.set(streakKey, 0);
    }

    session.scores[userId] = (session.scores[userId] ?? 0) + finalPoints;
    await this.usersService.awardXp(userId, finalPoints, finalOutcome !== GuessOutcome.MISS);

    let nextLyric: PublicLyric | null = null;
    if (session.currentRound >= session.totalRounds) {
      session.status = GameSessionStatus.FINISHED;
      session.currentLyricId = null;
      for (const playerId of session.playerIds) this.streaks.delete(`${sessionId}:${playerId}`);
      this.seenLyrics.delete(sessionId);
    } else {
      const seen = this.seenLyrics.get(sessionId) ?? [];
      const next = await this.lyricsService.getRandom(seen);
      this.seenLyrics.set(sessionId, [...seen, next.id]);
      session.currentLyricId = next.id;
      session.currentRound += 1;
      nextLyric = toPublicLyric(next);
    }

    await this.sessionsRepository.save(session);

    if (session.status === GameSessionStatus.FINISHED) {
      // The server, not a client, announces the end of a match; settlement
      // listens for this. See SettlementListener.
      const finished: SessionFinishedEvent = {
        sessionId,
        mode: session.mode,
        playerIds: [...session.playerIds],
        scores: { ...session.scores },
      };
      this.eventEmitter.emit('game.session.finished', finished);
    }

    this.eventEmitter.emit('guess.submitted', {
      sessionId,
      userId,
      outcome: finalOutcome,
      points: finalPoints,
    });

    return {
      outcome: finalOutcome,
      pointsAwarded: finalPoints,
      streak: this.streaks.get(streakKey) ?? 0,
      nextLyric,
      sessionStatus: session.status,
      totalRounds: session.totalRounds,
    };
  }
}

function toPublicLyric(lyric: { id: string; snippet: string; genre: string; decade: number }): PublicLyric {
  return { id: lyric.id, snippet: lyric.snippet, genre: lyric.genre, decade: lyric.decade };
}
