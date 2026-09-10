import Link from 'next/link';
import { WalletConnect } from '@/components/WalletConnect';

const modes = [
  {
    href: '/solo',
    title: 'Solo',
    description: 'Fetch a snippet, submit a guess, get scored.',
  },
  {
    href: '/rooms',
    title: 'Rooms',
    description: 'Everyone in a room guesses the same snippet before it expires.',
  },
  {
    href: '/head-to-head',
    title: 'Head-to-head',
    description: 'Two players, one session, an optional equal stake — winner takes the pot.',
  },
];

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-10 px-6 py-12">
      <header className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">LyricsFlip</h1>
        <div className="flex items-center gap-3">
          <Link href="/leaderboard" className="text-sm text-text-muted hover:text-text-primary">
            Leaderboard
          </Link>
          <WalletConnect />
        </div>
      </header>

      <p className="max-w-xl text-text-muted">
        See a lyric snippet, name the song or the artist before the card flips. You have 15
        seconds.
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        {modes.map((mode) => (
          <Link
            key={mode.href}
            href={mode.href}
            className="flex flex-col gap-2 rounded-2xl bg-surface p-6 transition hover:bg-brand-600/20"
          >
            <span className="font-display text-lg font-semibold">{mode.title}</span>
            <span className="text-sm text-text-muted">{mode.description}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
