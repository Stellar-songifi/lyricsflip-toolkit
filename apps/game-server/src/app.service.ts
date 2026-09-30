import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHealth() {
    return { status: 'ok', service: 'lyricsflip-game-server', timestamp: new Date().toISOString() };
  }
}
