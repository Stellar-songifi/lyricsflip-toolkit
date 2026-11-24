/**
 * Turns an app link into a router path, or null for links the app doesn't
 * handle. Accepts:
 *   - Universal/App Links: `https://lyricsflip.stellarsongifi.com/challenge/ABC123`
 *   - Custom scheme:       `lyricsflip://challenge/ABC123`
 *   - Expo Go dev links:   `exp://192.168.1.10:8081/--/challenge/ABC123`
 */
export function pathFromLink(url: string): string | null {
  let pathPart: string;

  if (url.startsWith('https://')) {
    // Universal/App Link — strip the host, keep the path only.
    const withoutScheme = url.slice('https://'.length);
    const slashIdx = withoutScheme.indexOf('/');
    pathPart = slashIdx >= 0 ? withoutScheme.slice(slashIdx + 1) : '';
  } else {
    // Custom scheme (lyricsflip://) or Expo Go (exp://).
    const afterScheme = url.split('://')[1];
    if (!afterScheme) return null;
    const expoGo = afterScheme.indexOf('/--/');
    pathPart = (expoGo >= 0 ? afterScheme.slice(expoGo + 4) : afterScheme);
  }

  const path = pathPart.split(/[?#]/)[0];
  const [route, param] = path.split('/').filter(Boolean);
  if (!param) return null;
  if (route === 'challenge') return `/challenge/${encodeURIComponent(decodeURIComponent(param).toUpperCase())}`;
  if (route === 'match') return `/match/${param}`;
  if (route === 'results') return `/results/${param}`;
  return null;
}
