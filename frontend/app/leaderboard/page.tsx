'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { usersApi } from '@/lib/api';

export default function LeaderboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['leaderboard'],
    queryFn: () => usersApi.getLeaderboard(),
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">Leaderboard</h1>
        <Link href="/" className="text-sm text-text-muted hover:text-text-primary">
          ← Back
        </Link>
      </div>

      {isLoading && <p className="text-text-muted">Loading…</p>}
      {error && <p className="text-error">Couldn&apos;t load the leaderboard.</p>}

      <ol className="flex flex-col gap-2">
        {data?.map((entry, i) => (
          <li
            key={entry.id}
            className="flex items-center justify-between rounded-lg bg-surface px-4 py-3"
          >
            <span className="flex items-center gap-3">
              <span className="font-mono text-text-muted">{i + 1}</span>
              <span>{entry.username}</span>
            </span>
            <span className="flex flex-col items-end text-sm">
              <span className="font-mono">{entry.xp} XP</span>
              <span className="text-text-muted">{entry.level}</span>
            </span>
          </li>
        ))}
      </ol>

      {data?.length === 0 && <p className="text-text-muted">No players yet — be the first.</p>}
    </main>
  );
}
