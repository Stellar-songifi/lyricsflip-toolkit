import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
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
  /** Unix timestamp (ms) when this round's deadline expires. */
  roundEndsAt: number;
}

export interface GuessResult {
  outcome: GuessOutcome;
  pointsAwarded: number;
  streak: number;
  nextLyric: PublicLyric | null;
  sessionStatus: GameSessionStatus;
  /** Rounds this session runs for; `currentRound` reaches it on the last guess. */
  totalRounds: number;
  /**
   * True when this player has answered the current round but the round has
   * not advanced yet because other players in the session are still to
   * answer (head-to-head and rooms). Solo sessions never set this.
   */
  waitingForOpponent: boolean;
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
  /**
   * Per-round time budget in seconds, overriding `ROUND_SECONDS`. Useful for
   * test modes or time-attack variants.
   */
  roundSeconds?: number;
}

/**
 * Game session lifecycle. All per-session state lives on the `game_sessions`
 * row (streaks, seen lyric ids, scores) rather than in process-local Maps,
 * so a restart, rolling deploy or crash mid-session does not lose it
 * (issue #2).
 */
@Injectable()
export class GameService {
  /**
   * Replaceable clock; tests swap this out to avoid sleeping.
   * Always call `this.now()` rather than `Date.now()` inside this class.
   */
  now: () => number = Date.now;
  private readonly logger = new Logger(GameService.name);

  constructor(
    @InjectRepository(GameSession)
    private readonly sessionsRepository: Repository<GameSession>,
    private readonly lyricsService: LyricsService,
    private readonly usersService: UsersService,
    private readonly eventEmitter: EventEmitter2,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  /**
   * Warns at boot when the lyric pool is smaller than a default session, so a
   * fresh install with a handful of seeded lyrics is visible in the logs
   * before a game crashes mid-round (issue #37).
   */
  async onModuleInit(): Promise<void> {
    const roundsPerSession = this.configService.get('roundsPerSession', { infer: true });
    const available = await this.lyricsService.count();
    if (available < roundsPerSession) {
      this.logger.warn(
        `Lyric pool has ${available} lyrics but ROUNDS_PER_SESSION is ${roundsPerSession}; ` +
          'sessions may finish early or be refused.',
      );
    }
  }

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
    if (
      options.roundSeconds !== undefined &&
      (!Number.isInteger(options.roundSeconds) || options.roundSeconds < 1)
    ) {
      throw new BadRequestException('roundSeconds must be a positive integer');
    }
    const totalRounds =
      options.rounds ?? this.configService.get('roundsPerSession', { infer: true });
    const roundSeconds =
      options.roundSeconds ?? this.configService.get('roundSeconds', { infer: true });

    const available = await this.lyricsService.count();
    if (available < totalRounds) {
      throw new BadRequestException(
        `Not enough lyrics for a ${totalRounds}-round session (only ${available} available)`,
      );
    }

    const lyric = await this.lyricsService.getRandom();
    const roundStartedAt = new Date(this.now());

    const session = this.sessionsRepository.create({
      mode,
      status: options.waitForStakes ? GameSessionStatus.WAITING : GameSessionStatus.ACTIVE,
      playerIds: [hostUserId],
      currentLyricId: lyric.id,
      currentRound: 1,
      totalRounds,
      roundSeconds,
      roundStartedAt,
      scores: { [hostUserId]: 0 },
      currentStreak: {},
      seenLyricIds: [lyric.id],
      roundAnswers: {},
    });
    return this.sessionsRepository.save(session);
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
      session.currentStreak[userId] = 0;
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
      { id: sessionId, status: GameSessionStatus.CANCELLED },
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
    return toPublicLyric(await this.lyricsService.findById(session.currentLyricId), session);
  }

  /**
   * Closes a round whose deadline has passed without all answers being
   * submitted. Scores absent players 0 for the round and advances (or
   * finishes) the session exactly as a normal guess would.
   *
   * Safe to call repeatedly: it is a no-op if the session is not active, if
   * the deadline has not yet passed, or if all players already answered.
   * Returns `true` when it advanced the round, `false` otherwise.
   */
  async closeExpiredRound(sessionId: string): Promise<boolean> {
    const locked = await this.sessionsRepository.manager.transaction(async (manager) => {
      const session = await manager.findOne(GameSession, {
        where: { id: sessionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!session) return null;
      if (session.status !== GameSessionStatus.ACTIVE) return null;
      if (!session.roundStartedAt) return null;

      const deadlineMs =
        new Date(session.roundStartedAt).getTime() + session.roundSeconds * 1000;
      if (this.now() < deadlineMs) return null;

      // Award 0 to any player who hasn't answered yet this round. We track
      // "answered" by checking whether scores changed in this round; since we
      // can't distinguish that from earlier rounds on a plain score field, we
      // close the round for everyone — the round advancement is the closure.
      let justFinished = false;
      let nextLyric: { id: string; snippet: string; genre: string; decade: number } | null = null;

      if (session.currentRound >= session.totalRounds) {
        const result = await manager.update(
          GameSession,
          { id: sessionId, status: GameSessionStatus.ACTIVE },
          {
            status: GameSessionStatus.FINISHED,
            currentLyricId: null,
            roundStartedAt: null,
            scores: session.scores,
            currentStreak: session.currentStreak,
          },
        );
        if (!result.affected) return null;
        session.status = GameSessionStatus.FINISHED;
        session.currentLyricId = null;
        session.roundStartedAt = null;
        justFinished = true;
      } else {
        const next = await this.lyricsService.getRandom(session.seenLyricIds);
        const now = new Date(this.now());
        session.seenLyricIds = [...session.seenLyricIds, next.id];
        session.currentLyricId = next.id;
        session.currentRound += 1;
        session.roundStartedAt = now;
        nextLyric = next;
        await manager.save(GameSession, session);
      }

      return { session, justFinished, nextLyric };
    });

    if (!locked) return false;

    const { session, justFinished, nextLyric } = locked;

    if (justFinished) {
      const finished: SessionFinishedEvent = {
        sessionId,
        mode: session.mode,
        playerIds: [...session.playerIds],
        scores: { ...session.scores },
      };
      this.eventEmitter.emit('game.session.finished', finished);
    }

    if (nextLyric) {
      this.eventEmitter.emit('round.advanced', {
        sessionId,
        lyric: toPublicLyric(nextLyric, session),
      });
    }

    return true;
  }

  /**
   * Scores a guess and advances the session. Runs inside a transaction that
   * takes a pessimistic write lock on the session row, so two guesses that
   * arrive together (two players, or a double-tap over HTTP and the socket)
   * can no longer both read the same row and race to `save()` (issue #27).
   * Only the lyric lookup and the session write happen inside the lock;
   * `awardXp` and the emitted events happen after commit.
   *
   * A guess submitted after the round deadline scores 0 and is treated as a
   * miss for streak purposes, but it still advances the round so the session
   * never stalls.
   * In head-to-head and room sessions every player answers the same card:
   * the round only advances once all players have answered (issue #26). A
   * player who has already answered the current round is rejected with
   * `400 Already answered` until the round advances.
   */
  async submitGuess(sessionId: string, userId: string, guessText: string): Promise<GuessResult> {
    const locked = await this.sessionsRepository.manager.transaction(async (manager) => {
      const session = await manager.findOne(GameSession, {
        where: { id: sessionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!session) {
        throw new NotFoundException(`Game session ${sessionId} not found`);
      }
      if (session.status !== GameSessionStatus.ACTIVE) {
        throw new BadRequestException('Session is not active');
      }
      if (!session.currentLyricId) {
        throw new BadRequestException('Session has no active card');
      }
      if (!session.playerIds.includes(userId)) {
        throw new BadRequestException('Player is not part of this session');
      }

      // Check whether the round deadline has passed.
      const deadlineMs = session.roundStartedAt
        ? new Date(session.roundStartedAt).getTime() + session.roundSeconds * 1000
        : Infinity;
      const isExpired = this.now() > deadlineMs;
      const roundAnswers = session.roundAnswers ?? {};
      const roundKey = String(session.currentRound);
      const answersThisRound = roundAnswers[roundKey] ?? {};
      if (answersThisRound[userId]) {
        throw new BadRequestException('Already answered');
      }

      const lyric = await this.lyricsService.findById(session.currentLyricId);
      const streak = session.currentStreak[userId] ?? 0;

      let finalOutcome: GuessOutcome;
      let finalPoints: number;

      if (isExpired) {
        // Late guess: counts as a miss, scores 0.
        finalOutcome = GuessOutcome.MISS;
        finalPoints = 0;
      } else {
        // A guess can name either the title or the artist — score against both
        // and keep whichever classifies better.
        const byTitle = scoreGuess(guessText, lyric.title, lyric.difficulty, streak);
        const byArtist = scoreGuess(guessText, lyric.artist, lyric.difficulty, streak);
        ({ outcome: finalOutcome, points: finalPoints } =
          byArtist.points > byTitle.points ? byArtist : byTitle);
      }

      if (finalOutcome === GuessOutcome.CORRECT) {
        session.currentStreak[userId] = streak + 1;
      } else if (finalOutcome === GuessOutcome.MISS) {
        session.currentStreak[userId] = 0;
      }

      session.scores[userId] = (session.scores[userId] ?? 0) + finalPoints;

      // Record this player's answer for the current round. The round only
      // advances once every player in the session has answered.
      answersThisRound[userId] = { outcome: finalOutcome, points: finalPoints };
      roundAnswers[roundKey] = answersThisRound;
      session.roundAnswers = roundAnswers;

      const allAnswered = session.playerIds.every((id) => Boolean(answersThisRound[id]));

      let nextLyric: PublicLyric | null = null;
      let justFinished = false;
      if (session.currentRound >= session.totalRounds) {
        const result = await manager.update(
          GameSession,
          { id: sessionId, status: GameSessionStatus.ACTIVE },
          {
            status: GameSessionStatus.FINISHED,
            currentLyricId: null,
            roundStartedAt: null,
            scores: session.scores,
            currentStreak: session.currentStreak,
          },
        );
        if (!result.affected) {
          throw new ConflictException('Session was already finished');
        }
        session.status = GameSessionStatus.FINISHED;
        session.currentLyricId = null;
        session.roundStartedAt = null;
        // A conditional update, not an unconditional save()
        session.status = GameSessionStatus.FINISHED;
        justFinished = true;
      } else {
        // Guard against a shrinking pool: if no unseen lyric is left, finish
        // the session early instead of letting getRandom throw mid-game
        // (issue #37).
        const next = await this.lyricsService.getRandom(session.seenLyricIds);
        if (!next) {
          session.status = GameSessionStatus.FINISHED;
          justFinished = true;
        } else {
          session.currentLyricId = next.id;
          session.currentRound += 1;
          session.seenLyricIds = [...session.seenLyricIds, next.id];
          nextLyric = toPublicLyric(next);
        }
      }

      await manager.save(session);

      return {
        session,
        nextLyric,
        justFinished,
        pointsAwarded: finalPoints,
        streak: session.currentStreak[userId] ?? 0,
      };
    });

    const { session, nextLyric, justFinished, pointsAwarded, streak } = locked;

    if (justFinished) {
      let waitingForOpponent = false;
      if (!allAnswered) {
        // Other players still owe an answer for this card; keep the round
        // where it is and let this player wait.
        waitingForOpponent = true;
      } else if (session.currentRound >= session.totalRounds) {
        // A conditional update, not an unconditional save()
        justFinished = true;
      } else {
        // Advance to the next round with a fresh card.
        const next = await this.lyricsService.getRandom(session.seenLyricIds);
        const now = new Date(this.now());
        session.seenLyricIds = [...session.seenLyricIds, next.id];
        session.currentLyricId = next.id;
        session.currentRound += 1;
        session.roundStartedAt = now;
        nextLyric = toPublicLyric(next, session);
        await manager.save(GameSession, session);
        session.currentRound += 1;
        session.currentLyricId = next.id;
        session.seenLyricIds = [...session.seenLyricIds, next.id];
        nextLyric = toPublicLyric(next);
      }

      await manager.save(session);

      return {
        session,
        userId,
        finalOutcome,
        finalPoints,
        nextLyric,
        justFinished,
        waitingForOpponent,
      };
    });

    const {
      session,
      userId: scoredUserId,
      finalOutcome,
      finalPoints,
      nextLyric,
      justFinished,
      waitingForOpponent,
    } = locked;

    if (finalOutcome === GuessOutcome.CORRECT) {
      await this.usersService.awardXp(scoredUserId, finalPoints);
    }

    if (justFinished) {
      const finished: SessionFinishedEvent = {
        sessionId,
      await this.sessionsRepository.update(
        { id: session.id, status: GameSessionStatus.ACTIVE },
        { status: GameSessionStatus.FINISHED },
      );
      session.status = GameSessionStatus.FINISHED;
      this.eventEmitter.emit('game.session.finished', {
        sessionId: session.id,
        mode: session.mode,
        playerIds: session.playerIds,
        scores: session.scores,
      } satisfies SessionFinishedEvent);
    }

    return {
      outcome: GuessOutcome.CORRECT,
      pointsAwarded,
      streak,
      outcome: finalOutcome,
      pointsAwarded: finalPoints,
      streak: session.currentStreak[scoredUserId] ?? 0,
      nextLyric,
      sessionStatus: session.status,
      totalRounds: session.totalRounds,
      waitingForOpponent,
    };
  }
}

function toPublicLyric(
  lyric: { id: string; snippet: string; genre: string; decade: number },
  session: { roundStartedAt: Date | null; roundSeconds: number },
): PublicLyric {
  const startedAt = session.roundStartedAt ? new Date(session.roundStartedAt).getTime() : Date.now();
function toPublicLyric(lyric: { id: string; snippet: string; genre: string; decade: number }): PublicLyric {
  return {
    id: lyric.id,
    snippet: lyric.snippet,
    genre: lyric.genre,
    decade: lyric.decade,
    roundEndsAt: startedAt + session.roundSeconds * 1000,
  };
}
  };
}
