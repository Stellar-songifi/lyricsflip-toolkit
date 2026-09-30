import { Subject } from 'rxjs';
import type { PvpEvent } from '@lyricsflip-toolkit/server';

/** The toolkit's wager events, for the game to react to. */
export const pvpEvents = new Subject<PvpEvent>();
