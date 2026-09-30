/**
 * Turns an app link into a router path, or null for links the app doesn't
 * handle. Accepts the app scheme (`lyricsflip://challenge/ABC123`) and Expo
 * Go's development links (`exp://192.168.1.10:8081/--/challenge/ABC123`).
 */
export function pathFromLink(url: string): string | null {
  const afterScheme = url.split('://')[1];
  if (!afterScheme) return null;
  const expoGo = afterScheme.indexOf('/--/');
  const path = (expoGo >= 0 ? afterScheme.slice(expoGo + 4) : afterScheme).split(/[?#]/)[0];
  const [route, param] = path.split('/').filter(Boolean);
  if (!param) return null;
  if (route === 'challenge') return `/challenge/${encodeURIComponent(decodeURIComponent(param).toUpperCase())}`;
  if (route === 'match') return `/match/${param}`;
  if (route === 'results') return `/results/${param}`;
  return null;
}
