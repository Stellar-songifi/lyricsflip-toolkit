import * as Linking from 'expo-linking';

/**
 * Turns an app link (`lyricsflip://challenge/ABC123`) into a router path
 * (`/challenge/ABC123`). Returns null for links the app doesn't handle.
 */
export function pathFromLink(url: string): string | null {
  const { hostname, path } = Linking.parse(url);
  const full = [hostname, path].filter(Boolean).join('/');
  const [route, param] = full.split('/');
  if (!param) return null;
  if (route === 'challenge') return `/challenge/${encodeURIComponent(param.toUpperCase())}`;
  if (route === 'match') return `/match/${param}`;
  if (route === 'results') return `/results/${param}`;
  return null;
}
