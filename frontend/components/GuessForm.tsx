'use client';

import { FormEvent, useState } from 'react';

interface GuessFormProps {
  onSubmit: (guess: string) => void;
  disabled?: boolean;
}

export function GuessForm({ onSubmit, disabled }: GuessFormProps) {
  const [value, setValue] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    onSubmit(value.trim());
    setValue('');
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-md gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
        placeholder="Song title or artist…"
        className="flex-1 rounded-lg border border-surface bg-surface px-4 py-2 text-text-primary placeholder:text-text-muted focus:border-brand-400 focus:outline-none disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={disabled}
        className="rounded-lg bg-brand-600 px-4 py-2 font-medium text-text-primary hover:bg-brand-400 disabled:opacity-50"
      >
        Guess
      </button>
    </form>
  );
}
