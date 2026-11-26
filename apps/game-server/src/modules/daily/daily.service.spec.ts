import { DailyService, DAILY_LYRIC_COUNT } from './daily.service';

/**
 * Minimal in-memory stand-ins so this needs no Postgres. `lyricIdsFor` reads the
 * catalog, excludes recent picks, inserts the day, then re-reads it.
 */
function setup(allIds: string[], recent: Array<{ lyricIds: string[] }> = []) {
  let inserted: { lyricIds: string[] } | null = null;
  const days = {
    findOne: jest.fn(async () => null),
    find: jest.fn(async () => recent),
    findOneOrFail: jest.fn(async () => inserted ?? { lyricIds: [] }),
    createQueryBuilder: jest.fn(() => ({
      insert: () => ({
        values: (v: { lyricIds: string[] }) => {
          inserted = v;
          return { orIgnore: () => ({ execute: async () => undefined }) };
        },
      }),
    })),
  };
  const lyricsRepo = { find: jest.fn(async () => allIds.map((id) => ({ id }))) };
  const service = new DailyService(
    days as never,
    {} as never, // attempts
    lyricsRepo as never,
    {} as never, // lyrics service
    {} as never, // users
  );
  return { service, days };
}

describe('DailyService.lyricIdsFor (issue #102)', () => {
  it('throws a clear error when the catalog is smaller than a day needs', async () => {
    const tooFew = Array.from({ length: DAILY_LYRIC_COUNT - 1 }, (_, i) => `lyric-${i}`);
    const { service } = setup(tooFew);

    await expect(service.lyricIdsFor('2026-09-30')).rejects.toThrow(/Not enough lyrics/);
  });

  it('excludes the previous days\' picks from today\'s pool', async () => {
    const all = Array.from({ length: 10 }, (_, i) => `lyric-${String(i).padStart(2, '0')}`);
    const recent = [{ lyricIds: all.slice(0, 5) }];
    const { service } = setup(all, recent);

    const picked = await service.lyricIdsFor('2026-09-30');

    expect(picked).toHaveLength(DAILY_LYRIC_COUNT);
    for (const id of picked) expect(recent[0].lyricIds).not.toContain(id);
  });
});