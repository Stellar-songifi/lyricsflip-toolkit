import { PushService } from './push.service';
import { PushTransport } from './expo-push.client';

describe('PushService', () => {
  function setup(tickets: Array<{ token: string; ok: boolean; error?: string }>) {
    const repo = {
      find: jest.fn().mockResolvedValue([
        { token: 'ExponentPushToken[a]' },
        { token: 'ExponentPushToken[b]' },
      ]),
      delete: jest.fn(),
    };
    const transport: PushTransport = { send: jest.fn().mockResolvedValue(tickets) };
    return { repo, transport, service: new PushService(repo as never, transport) };
  }

  it('forgets tokens Expo reports as unregistered', async () => {
    const { repo, service } = setup([
      { token: 'ExponentPushToken[a]', ok: true },
      { token: 'ExponentPushToken[b]', ok: false, error: 'DeviceNotRegistered' },
    ]);
    await service.sendToUser('u', 'LyricsFlip', 'hi');
    expect(repo.delete).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(repo.delete.mock.calls[0][0])).toContain('ExponentPushToken[b]');
  });

  it('never throws when delivery fails', async () => {
    const { transport, service } = setup([]);
    (transport.send as jest.Mock).mockRejectedValue(new Error('down'));
    await expect(service.sendToUser('u', 't', 'b')).resolves.toBeUndefined();
  });

  it('recognises Expo push tokens', () => {
    expect(PushService.isExpoToken('ExponentPushToken[xYz-_1]')).toBe(true);
    expect(PushService.isExpoToken('ExpoPushToken[abc]')).toBe(true);
    expect(PushService.isExpoToken('fcm:abc')).toBe(false);
  });
});
