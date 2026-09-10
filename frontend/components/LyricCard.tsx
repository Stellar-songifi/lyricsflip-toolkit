'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { PublicLyric } from '@/lib/api';
import type { GuessOutcome } from '@/store/gameStore';

const ROUND_SECONDS = 15;

interface LyricCardProps {
  lyric: PublicLyric;
  outcome: GuessOutcome | null;
  onExpire: () => void;
}

export function LyricCard({ lyric, outcome, onExpire }: LyricCardProps) {
  const [secondsLeft, setSecondsLeft] = useState(ROUND_SECONDS);
  const flipped = outcome !== null;

  useEffect(() => {
    setSecondsLeft(ROUND_SECONDS);
  }, [lyric.id]);

  useEffect(() => {
    if (flipped) return;
    if (secondsLeft <= 0) {
      onExpire();
      return;
    }
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft, flipped, onExpire]);

  const urgent = secondsLeft <= 3;

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="h-1 w-full max-w-md overflow-hidden rounded-full bg-surface">
        <motion.div
          className={urgent ? 'h-full bg-error' : 'h-full bg-accent-300'}
          animate={{ width: `${(secondsLeft / ROUND_SECONDS) * 100}%` }}
          transition={{ duration: 1, ease: 'linear' }}
        />
      </div>

      <div className="[perspective:1200px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={lyric.id}
            className="flex h-64 w-80 flex-col justify-between rounded-2xl bg-surface p-6 shadow-xl"
            initial={{ rotateY: -90, opacity: 0 }}
            animate={{ rotateY: 0, opacity: 1 }}
            exit={{ rotateY: 90, opacity: 0 }}
            transition={{ duration: 0.4, ease: 'easeInOut' }}
          >
            <p className="font-display text-lg leading-snug text-text-primary">
              &ldquo;{lyric.snippet}&rdquo;
            </p>
            <div className="flex items-center justify-between text-sm text-text-muted">
              <span>{lyric.genre}</span>
              <span>{lyric.decade}s</span>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      <span className="font-mono text-2xl text-text-primary">{secondsLeft}s</span>

      {outcome && (
        <motion.p
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className={outcome === 'miss' ? 'text-error' : 'text-success'}
        >
          {outcome === 'correct' && 'Correct!'}
          {outcome === 'partial' && 'So close — partial credit.'}
          {outcome === 'miss' && 'Missed it.'}
        </motion.p>
      )}
    </div>
  );
}
