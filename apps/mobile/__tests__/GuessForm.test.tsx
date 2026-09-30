import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { GuessForm } from '../src/components/GuessForm';
import { hapticForOutcome } from '../src/lib/haptics';

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(),
  impactAsync: jest.fn(),
  NotificationFeedbackType: { Success: 'success' },
  ImpactFeedbackStyle: { Light: 'light' },
}));

describe('GuessForm', () => {
  it('submits the trimmed guess and clears the input', async () => {
    const onGuess = jest.fn().mockResolvedValue(undefined);
    render(<GuessForm onGuess={onGuess} />);
    fireEvent.changeText(screen.getByLabelText('Your guess'), '  Firework ');
    fireEvent.press(screen.getByLabelText('Guess'));
    await waitFor(() => expect(onGuess).toHaveBeenCalledWith('Firework'));
    await waitFor(() => expect(screen.getByLabelText('Your guess').props.value).toBe(''));
  });

  it('does nothing for an empty guess', () => {
    const onGuess = jest.fn();
    render(<GuessForm onGuess={onGuess} />);
    fireEvent.press(screen.getByLabelText('Guess'));
    expect(onGuess).not.toHaveBeenCalled();
  });
});

describe('haptics', () => {
  it('buzzes on a correct guess, taps on a partial one, and stays still on a miss', () => {
    hapticForOutcome('correct');
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('success');
    hapticForOutcome('partial');
    expect(Haptics.impactAsync).toHaveBeenCalledWith('light');
    hapticForOutcome('miss');
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
  });
});
