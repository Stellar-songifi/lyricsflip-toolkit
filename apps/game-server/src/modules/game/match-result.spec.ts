import { headToHeadResult } from './match-result';

describe('headToHeadResult', () => {
  it('picks the higher score', () => {
    expect(headToHeadResult(['a', 'b'], { a: 30, b: 10 })).toEqual({ winnerId: 'a' });
    expect(headToHeadResult(['a', 'b'], { a: 5, b: 12 })).toEqual({ winnerId: 'b' });
  });

  it('calls equal scores a draw', () => {
    expect(headToHeadResult(['a', 'b'], { a: 7, b: 7 })).toEqual({ draw: true });
    expect(headToHeadResult(['a', 'b'], {})).toEqual({ draw: true });
  });

  it('treats a missing score as zero', () => {
    expect(headToHeadResult(['a', 'b'], { b: 1 })).toEqual({ winnerId: 'b' });
  });

  it('ignores scores of anyone outside the match', () => {
    expect(headToHeadResult(['a', 'b'], { a: 1, b: 2, mallory: 99 })).toEqual({ winnerId: 'b' });
  });

  it('needs exactly two players', () => {
    expect(() => headToHeadResult(['a'], { a: 1 })).toThrow(/two players/);
    expect(() => headToHeadResult(['a', 'b', 'c'], {})).toThrow(/two players/);
  });
});
