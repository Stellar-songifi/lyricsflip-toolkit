import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { DailyChallenge } from './entities/daily-challenge.entity';
import { DailyAttempt } from './entities/daily-attempt.entity';
import { Lyric } from '../lyrics/entities/lyric.entity';
import { LyricsService } from '../lyrics/lyrics.service';
import { UsersService } from '../users/users.service';
import { GuessOutcome, scoreGuess } from '../game/scoring';
import { pickDeterministic, utcDay } from './daily-seed';

export const DAILY_LYRIC_COUNT = 5;
/** How many previous days' picks to keep out of today's pool. */
export const DAILY_RECENT_DAYS = 7;

export interface DailyView {
  date: string;
  lyrics: Array<{
    id: string;
    snippet: string;
    genre: string;
    decade: number;
    /** The player's attempt, if they've made one. Answers are revealed only after it. */
    attempt: { outcome: string; points: number; title: string; artist: string } | null;
  }>;
  totalPoints: number;
  complete: boolean;
}

/**
 * The daily challenge: the same five lyrics for every player on a UTC day,
 * one guess each. Ported and simplified from Lyricsflip_server.
 */
@Injectable()
export class DailyService {
  constructor(
    @InjectRepository(DailyChallenge) private readonly days: Repository<DailyChallenge>,
    @InjectRepository(DailyAttempt) private readonly attempts: Repository<DailyAttempt>,
    @InjectRepository(Lyric) private readonly lyricsRepo: Repository<Lyric>,
    private readonly lyrics: LyricsService,
    private readonly users: UsersService,
  ) {}

  /** Today's lyric ids, chosen once per day and then fixed. */
  async lyricIdsFor(date = utcDay()): Promise<string[]> {
    const existing = await this.days.findOne({ where: { date } });
    if (existing) return existing.lyricIds;

    const all = await this.lyricsRepo.find({ select: { id: true } });
    const allIds = all.map((l) => l.id);
    if (allIds.length < DAILY_LYRIC_COUNT) {
      // A too-small catalog can't fill a day; surface it loudly instead of
      // shipping a "complete" day with fewer than DAILY_LYRIC_COUNT lyrics.
      throw new Error(
        `Not enough lyrics to build a daily challenge: need ${DAILY_LYRIC_COUNT}, have ${allIds.length}`,
      );
    }

    // Keep the last DAILY_RECENT_DAYS of picks out of today's pool so the same
    // lyric doesn't reappear day after day.
    const recent = await this.days.find({
      where: { date: LessThan(date) },
      order: { date: 'DESC' },
      take: DAILY_RECENT_DAYS,
    });
    const exclude = recent.flatMap((d) => d.lyricIds);

    const lyricIds = pickDeterministic(allIds, DAILY_LYRIC_COUNT, date, exclude);
    // Another request may have fixed the day first; keep whichever landed.
    await this.days.createQueryBuilder().insert().values({ date, lyricIds }).orIgnore().execute();
    return (await this.days.findOneOrFail({ where: { date } })).lyricIds;
  }

  async view(userId: string, date = utcDay()): Promise<DailyView> {
    const ids = await this.lyricIdsFor(date);
    const mine = await this.attempts.find({ where: { userId, challengeDate: date } });
    const lyrics = await Promise.all(ids.map((id) => this.lyrics.findById(id)));
    const view = lyrics.map((lyric) => {
      const attempt = mine.find((a) => a.lyricId === lyric.id);
      return {
        id: lyric.id,
        snippet: lyric.snippet,
        genre: lyric.genre,
        decade: lyric.decade,
        attempt: attempt
          ? { outcome: attempt.outcome, points: attempt.points, title: lyric.title, artist: lyric.artist }
          : null,
      };
    });
    return {
      date,
      lyrics: view,
      totalPoints: mine.reduce((sum, a) => sum + a.points, 0),
      complete: mine.length >= ids.length,
    };
  }

  async guess(userId: string, lyricId: string, guessText: string, date = utcDay()) {
    const ids = await this.lyricIdsFor(date);
    if (!ids.includes(lyricId)) {
      throw new BadRequestException("That lyric isn't in today's challenge");
    }
    const lyric = await this.lyrics.findById(lyricId);
    const byTitle = scoreGuess(guessText, lyric.title, lyric.difficulty, 0);
    const byArtist = scoreGuess(guessText, lyric.artist, lyric.difficulty, 0);
    const best = byArtist.points > byTitle.points ? byArtist : byTitle;

    const inserted = await this.attempts
      .createQueryBuilder()
      .insert()
      .values({ userId, challengeDate: date, lyricId, outcome: best.outcome, points: best.points })
      .orIgnore()
      .execute();
    if (!inserted.identifiers.length || !inserted.identifiers[0]) {
      throw new BadRequestException("You've already answered this one today");
    }
    await this.users.awardXp(userId, best.points, best.outcome !== GuessOutcome.MISS);
    return { outcome: best.outcome, points: best.points, title: lyric.title, artist: lyric.artist };
  }

  async leaderboard(date = utcDay(), limit = 20) {
    return this.attempts
      .createQueryBuilder('a')
      .select('a.userId', 'userId')
      .addSelect('u.username', 'username')
      .addSelect('SUM(a.points)::int', 'points')
      .innerJoin('users', 'u', 'u.id = a.userId')
      .where('a.challengeDate = :date', { date })
      .groupBy('a.userId')
      .addGroupBy('u.username')
      .orderBy('points', 'DESC')
      .limit(Math.min(limit, 100))
      .getRawMany<{ userId: string; username: string; points: number }>();
  }
}
