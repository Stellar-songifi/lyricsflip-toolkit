import { render, screen, fireEvent } from '@testing-library/react';
import { GuessForm } from './GuessForm';

describe('GuessForm', () => {
  it('submits the trimmed guess and clears the input', () => {
    const onSubmit = jest.fn();
    render(<GuessForm onSubmit={onSubmit} />);

    const input = screen.getByPlaceholderText(/song title or artist/i);
    fireEvent.change(input, { target: { value: '  Thrift Shop  ' } });
    fireEvent.click(screen.getByRole('button', { name: /guess/i }));

    expect(onSubmit).toHaveBeenCalledWith('Thrift Shop');
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('does not submit an empty guess', () => {
    const onSubmit = jest.fn();
    render(<GuessForm onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: /guess/i }));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
