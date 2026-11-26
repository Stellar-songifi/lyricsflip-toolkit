import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Lyric } from './entities/lyric.entity';

const ROUNDS_PER_SESSION = 5;

@Injectable()
export class LyricsService implements OnModuleInit {
  private readonly logger = new Logger(LyricsService.name);

  constructor(
    @InjectRepository(Lyric)
    private readonly lyricsRepository: Repository<Lyric>,
  ) {}

  async onModuleInit(): Promise<void> {
    const count = await this.count();
    if (count < ROUNDS_PER_SESSION) {
      this.logger.warn(
        `Lyric pool has ${count} entries, fewer than ROUNDS_PER_SESSION (${ROUNDS_PER_SESSION}). Sessions may finish early.`,
      );
    }
  }

  /** Total number of lyrics available in the pool. */
  async count(): Promise<number> {
    return this.lyricsRepository.count();
  }

  async findById(id: string): Promise<Lyric> {
    const lyric = await this.lyricsRepository.findOne({ where: { id } });
    if (!lyric) {
      throw new NotFoundException(`Lyric ${id} not found`);
    }
    return lyric;
  }

  /** Picks one random lyric, optionally excluding recently-seen ids. */
  async getRandom(excludeIds: string[] = []): Promise<Lyric> {
    const qb = this.lyricsRepository.createQueryBuilder('lyric').orderBy('RANDOM()').limit(1);
    if (excludeIds.length > 0) {
      qb.where('lyric.id NOT IN (:...excludeIds)', { excludeIds });
    }
    const lyric = await qb.getOne();
    if (!lyric) {
      throw new NotFoundException('No lyrics available');
    }
    return lyric;
  }
}
