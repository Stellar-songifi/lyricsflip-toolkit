import type { ReactElement } from 'react';
import { useRouter } from 'expo-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import Notifications from '../app/(tabs)/notifications';
import Leaderboard from '../app/(tabs)/leaderboard';
import MatchHistory from '../app/match-history';
import { useSession } from '../src/lib/session';

jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('../src/lib/session', () => ({ useSession: jest.fn() }));
jest.mock('../src/hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({ online: true }) }));

const push = jest.fn();
const api = {
  notifications: {
    list: jest.fn(),
    markRead: jest.fn(async () => ({ id: 'n1', read: true })),
  },
  users: { leaderboard: jest.fn() },
  daily: { leaderboard: jest.fn() },
  game: { history: jest.fn() },
};

function renderScreen(element: ReactElement) {
  return render(element);
}

beforeEach(() => {
  jest.clearAllMocks();
  (useRouter as jest.Mock).mockReturnValue({ push });
  (useSession as jest.Mock).mockReturnValue({ api, user: { id: 'me' } });
});

describe('notifications screen', () => {
  it('lists notifications, marks them read and follows the deep link', async () => {
    api.notifications.list.mockResolvedValue([
      {
        id: 'n1',
        type: 'match.finished',
        message: 'You won',
        read: false,
        data: { url: 'lyricsflip://results/s1' },
        createdAt: '2026-11-24T00:00:00.000Z',
      },
    ]);

    renderScreen(<Notifications />);
    await waitFor(() => expect(screen.getByLabelText('You won, unread')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('You won, unread'));

    expect(api.notifications.markRead).toHaveBeenCalledWith('n1');
    expect(push).toHaveBeenCalledWith('/results/s1');
    expect(screen.getByLabelText('You won')).toBeTruthy();
  }, 20_000);
});

describe('leaderboard screen', () => {
  it('highlights the signed-in player row', async () => {
    api.users.leaderboard.mockResolvedValue([
      { id: 'other', username: 'rival', xp: 50, level: 'Gold' },
      { id: 'me', username: 'player', xp: 10, level: 'Silver' },
    ]);

    renderScreen(<Leaderboard />);
    await waitFor(() =>
      expect(screen.getByLabelText('Rank 2, player, 10 XP, you')).toBeTruthy(),
    );
    expect(screen.getByLabelText('Rank 1, rival, 50 XP')).toBeTruthy();
  }, 20_000);
});

describe('match history screen', () => {
  it('lists past matches and opens the results screen', async () => {
    api.game.history.mockResolvedValue([
      {
        id: 's1',
        mode: 'head_to_head',
        status: 'finished',
        playerIds: ['me', 'them'],
        currentRound: 10,
        scores: { me: 20, them: 5 },
      },
    ]);

    renderScreen(<MatchHistory />);
    await waitFor(() =>
      expect(screen.getByLabelText('Head-to-head, Won, 20 points. View results.')).toBeTruthy(),
    );
    fireEvent.press(screen.getByLabelText('Head-to-head, Won, 20 points. View results.'));
    expect(push).toHaveBeenCalledWith('/results/s1');
  }, 20_000);
});
