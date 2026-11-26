/**
 * Links the mobile app opens. Keep in sync with the routes in apps/mobile/app.
 *
 * Primary links use `https://` (Universal Links on iOS, App Links on Android)
 * so they open the app directly on devices that have it installed and fall back
 * to a browser on devices that don't. The custom `lyricsflip://` scheme is kept
 * as a fallback for contexts where the HTTPS link cannot be verified (e.g. the
 * Expo Go development client, certain notification trays).
 */
export const APP_SCHEME = 'lyricsflip';
export const APP_DOMAIN = 'lyricsflip.stellarsongifi.com';

export const deepLink = {
  challenge: (code: string) =>
    `https://${APP_DOMAIN}/challenge/${encodeURIComponent(code)}`,
  match: (sessionId: string) =>
    `https://${APP_DOMAIN}/match/${sessionId}`,
  results: (sessionId: string) =>
    `https://${APP_DOMAIN}/results/${sessionId}`,
};

/** Custom-scheme fallback links (kept for Expo Go / legacy clients). */
export const customSchemeLink = {
  challenge: (code: string) =>
    `${APP_SCHEME}://challenge/${encodeURIComponent(code)}`,
  match: (sessionId: string) => `${APP_SCHEME}://match/${sessionId}`,
  results: (sessionId: string) => `${APP_SCHEME}://results/${sessionId}`,
};
