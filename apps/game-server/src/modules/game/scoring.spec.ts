import { Difficulty } from '../lyrics/entities/lyric.entity';
import { classifyGuess, GuessOutcome, scoreGuess } from './scoring';

describe('classifyGuess', () => {
  it('matches an exact guess, case- and punctuation-insensitive', () => {
    expect(classifyGuess('Thrift Shop', 'thrift shop')).toBe(GuessOutcome.CORRECT);
    expect(classifyGuess("thrift-shop!", 'Thrift Shop')).toBe(GuessOutcome.CORRECT);
  });

  it('classifies a near-miss as partial', () => {
    expect(classifyGuess('Thrift Shp', 'Thrift Shop')).toBe(GuessOutcome.PARTIAL);
  });

  it('classifies an unrelated guess as a miss', () => {
    expect(classifyGuess('Bohemian Rhapsody', 'Thrift Shop')).toBe(GuessOutcome.MISS);
  });

  it('treats an empty guess as a miss', () => {
    expect(classifyGuess('', 'Thrift Shop')).toBe(GuessOutcome.MISS);
  });

  it('does not allocate a matrix larger than 500 x 500 for oversized input', () => {
    // A 500-char target with a 50-char guess would normally allocate 51 x 501.
    // With the guard, any input over 500 chars returns Math.max() instead.
    const longTarget = 'a'.repeat(501);
    expect(classifyGuess('a'.repeat(500), longTarget)).toBe(GuessOutcome.MISS);
  });

  it('does not allocate a matrix larger than 500 x 500 for oversized input', () => {
    // A 500-char target with a 50-char guess would normally allocate 51 x 501.
    // With the guard, any input over 500 chars returns Math.max() instead.
    const longTarget = 'a'.repeat(501);
    expect(classifyGuess('a'.repeat(500), longTarget)).toBe(GuessOutcome.MISS);
  });
});

describe('scoreGuess', () => {
  it('awards 100 points for a correct easy guess with no streak', () => {
    const result = scoreGuess('Thrift Shop', 'Thrift Shop', Difficulty.EASY, 0);
    expect(result.outcome).toBe(GuessOutcome.CORRECT);
    expect(result.points).toBe(100);
  });

  it('applies the streak bonus on top of a correct guess', () => {
    const result = scoreGuess('Thrift Shop', 'Thrift Shop', Difficulty.EASY, 3);
    expect(result.points).toBe(125);
  });

  it('applies the difficulty multiplier', () => {
    const result = scoreGuess('Thrift Shop', 'Thrift Shop', Difficulty.HARD, 0);
    expect(result.points).toBe(200);
  });

  it('awards 0 points for a miss', () => {
    const result = scoreGuess('nonsense', 'Thrift Shop', Difficulty.MEDIUM, 5);
    expect(result.outcome).toBe(GuessOutcome.MISS);
    expect(result.points).toBe(0);
  });
});
