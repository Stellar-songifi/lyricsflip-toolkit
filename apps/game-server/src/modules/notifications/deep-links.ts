/**
 * Links the mobile app opens (scheme `lyricsflip`, see apps/mobile/app.json).
 * Keep in sync with the routes in apps/mobile/app.
 */
export const APP_SCHEME = 'lyricsflip';

export const deepLink = {
  challenge: (code: string) => `${APP_SCHEME}://challenge/${encodeURIComponent(code)}`,
  match: (sessionId: string) => `${APP_SCHEME}://match/${sessionId}`,
  results: (sessionId: string) => `${APP_SCHEME}://results/${sessionId}`,
};
