import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { GameSession, GameSessionStatus, GameMode } from './entities/game-session.entity';
import { LyricsService } from '../lyrics/lyrics.service';
import { UsersService } from '../users/users.service';
import { GuessOutcome, scoreGuess } from './scoring';

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
}

const ROUNDS_PER_SESSION = 10;

@Injectable()
export class GameService {
  /** userId -> current correct-answer streak. Reset to 0 on a miss. */
  private readonly streaks = new Map<string, number>();
  /** sessionId -> lyric ids already shown, so a session never repeats one. */
  private readonly seenLyrics = new Map<string, string[]>();

  constructor(
    @InjectRepository(GameSession)
    private readonly sessionsRepository: Repository<GameSession>,
    private readonly lyricsService: LyricsService,
    private readonly usersService: UsersService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async createSession(hostUserId: string, mode: GameMode): Promise<GameSession> {
    const lyric = await this.lyricsService.getRandom();

    const session = this.sessionsRepository.create({
      mode,
      status: GameSessionStatus.ACTIVE,
      playerIds: [hostUserId],
      currentLyricId: lyric.id,
      currentRound: 1,
      scores: { [hostUserId]: 0 },
    });
    const saved = await this.sessionsRepository.save(session);
    this.seenLyrics.set(saved.id, [lyric.id]);

    return saved;
  }

  async joinSession(sessionId: string, userId: string): Promise<GameSession> {
    const session = await this.getSession(sessionId);
    if (session.status !== GameSessionStatus.WAITING && session.mode === GameMode.ROOM) {
      // Rooms can be joined mid-round; head-to-head cannot.
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
    const streak = this.streaks.get(userId) ?? 0;

    // A guess can name either the title or the artist — score against both
    // and keep whichever classifies better.
    const byTitle = scoreGuess(guessText, lyric.title, lyric.difficulty, streak);
    const byArtist = scoreGuess(guessText, lyric.artist, lyric.difficulty, streak);
    const { outcome: finalOutcome, points: finalPoints } =
      byArtist.points > byTitle.points ? byArtist : byTitle;

    if (finalOutcome === GuessOutcome.CORRECT) {
      this.streaks.set(userId, streak + 1);
    } else if (finalOutcome === GuessOutcome.MISS) {
      this.streaks.set(userId, 0);
    }

    session.scores[userId] = (session.scores[userId] ?? 0) + finalPoints;
    await this.usersService.awardXp(userId, finalPoints, finalOutcome !== GuessOutcome.MISS);

    let nextLyric: PublicLyric | null = null;
    if (session.currentRound >= ROUNDS_PER_SESSION) {
      session.status = GameSessionStatus.FINISHED;
      session.currentLyricId = null;
    } else {
      const seen = this.seenLyrics.get(sessionId) ?? [];
      const next = await this.lyricsService.getRandom(seen);
      this.seenLyrics.set(sessionId, [...seen, next.id]);
      session.currentLyricId = next.id;
      session.currentRound += 1;
      nextLyric = toPublicLyric(next);
    }

    await this.sessionsRepository.save(session);

    this.eventEmitter.emit('guess.submitted', {
      sessionId,
      userId,
      outcome: finalOutcome,
      points: finalPoints,
    });

    return {
      outcome: finalOutcome,
      pointsAwarded: finalPoints,
      streak: this.streaks.get(userId) ?? 0,
      nextLyric,
      sessionStatus: session.status,
    };
  }
}

function toPublicLyric(lyric: { id: string; snippet: string; genre: string; decade: number }): PublicLyric {
  return { id: lyric.id, snippet: lyric.snippet, genre: lyric.genre, decade: lyric.decade };
}
