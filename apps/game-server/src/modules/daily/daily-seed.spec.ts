import { hashSeed, pickDeterministic, utcDay } from './daily-seed';

describe('daily seed', () => {
  const ids = Array.from({ length: 20 }, (_, i) => `lyric-${String(i).padStart(2, '0')}`);

  it('picks the same lyrics for the same day, whatever the pool order', () => {
    const a = pickDeterministic(ids, 5, '2026-09-30');
    const b = pickDeterministic([...ids].reverse(), 5, '2026-09-30');
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(5);
  });

  it('picks different lyrics on different days', () => {
    expect(pickDeterministic(ids, 5, '2026-09-30')).not.toEqual(pickDeterministic(ids, 5, '2026-10-01'));
  });

  it('never picks more than the pool holds', () => {
    expect(pickDeterministic(ids.slice(0, 3), 5, 'x')).toHaveLength(3);
  });

  it('hashes stably and formats UTC days', () => {
    expect(hashSeed('abc')).toBe(hashSeed('abc'));
    expect(utcDay(new Date('2026-09-30T23:59:59Z'))).toBe('2026-09-30');
  });
});

describe('pickDeterministic exclusion', () => {
  const ids = Array.from({ length: 20 }, (_, i) => `lyric-${String(i).padStart(2, '0')}`);

  it('avoids excluded ids when enough remain', () => {
    const exclude = ids.slice(0, 10); // half the pool
    const picked = pickDeterministic(ids, 5, '2026-09-30', exclude);
    expect(picked).toHaveLength(5);
    for (const id of picked) expect(exclude).not.toContain(id);
  });

  it('falls back to the full pool when exclusion would leave too few', () => {
    const exclude = ids.slice(0, 18); // only 2 remain, need 5
    const picked = pickDeterministic(ids, 5, '2026-09-30', exclude);
    expect(picked).toHaveLength(5);
  });

  it('is deterministic for the same seed and exclusions', () => {
    const exclude = ids.slice(0, 5);
    expect(pickDeterministic(ids, 5, '2026-10-01', exclude)).toEqual(
      pickDeterministic(ids, 5, '2026-10-01', exclude),
    );
  });
});
