import { pathFromLink } from '../src/lib/links';

describe('pathFromLink', () => {
  it('maps invite, match and results links to routes', () => {
    expect(pathFromLink('lyricsflip://challenge/abc123')).toBe('/challenge/ABC123');
    expect(pathFromLink('lyricsflip://match/0f8e')).toBe('/match/0f8e');
    expect(pathFromLink('lyricsflip://results/0f8e')).toBe('/results/0f8e');
  });

  it('understands Expo Go development links', () => {
    expect(pathFromLink('exp://192.168.1.10:8081/--/challenge/xyz789')).toBe('/challenge/XYZ789');
  });

  it('ignores links the app does not handle', () => {
    expect(pathFromLink('lyricsflip://settings/x')).toBeNull();
    expect(pathFromLink('lyricsflip://challenge')).toBeNull();
  });
});
