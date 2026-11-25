import { AccessibilityInfo } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { OfflineBanner } from '../src/components/OfflineBanner';
import { useNetworkStatus } from '../src/hooks/useNetworkStatus';

jest.mock('../src/hooks/useNetworkStatus', () => ({ useNetworkStatus: jest.fn() }));

const status = jest.mocked(useNetworkStatus);

describe('OfflineBanner', () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);

  beforeEach(() => {
    announce.mockClear();
    status.mockReturnValue({ online: true });
  });

  it('hides while online', () => {
    render(<OfflineBanner />);
    expect(screen.queryByLabelText('You are offline')).toBeNull();
  });

  it('shows and announces an offline state, then announces recovery', () => {
    const { rerender } = render(<OfflineBanner />);
    status.mockReturnValue({ online: false });
    rerender(<OfflineBanner />);
    expect(screen.getByLabelText('You are offline')).toBeTruthy();
    expect(announce).toHaveBeenLastCalledWith("You're offline. Showing the last known state.");

    status.mockReturnValue({ online: true });
    rerender(<OfflineBanner />);
    expect(screen.queryByLabelText('You are offline')).toBeNull();
    expect(announce).toHaveBeenLastCalledWith('Back online. Refreshing your game.');
  });
});
