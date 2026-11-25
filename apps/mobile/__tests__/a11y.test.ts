import { AccessibilityInfo } from 'react-native';
import { announceGuessResult, announceScoreUpdate } from '../src/lib/a11y';

describe('a11y announcements', () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);

  beforeEach(() => announce.mockClear());

  it('announces a correct guess with its points and streak', () => {
    announceGuessResult('correct', 15, 3);
    expect(announce).toHaveBeenCalledWith('Correct. +15 points. Streak 3.');
  });

  it('announces partial and missed guesses', () => {
    announceGuessResult('partial', 5);
    expect(announce).toHaveBeenCalledWith('Partial match. +5 points.');
    announceGuessResult('miss');
    expect(announce).toHaveBeenCalledWith('Miss. No points.');
  });

  it('announces score changes with the player and opponent scores', () => {
    announceScoreUpdate({ me: 20, them: 5 }, 'me');
    expect(announce).toHaveBeenCalledWith('Score update: you 20, opponent 5.');
  });
});
