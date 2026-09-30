import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Lyric } from './entities/lyric.entity';

@Injectable()
export class LyricsService {
  constructor(
    @InjectRepository(Lyric)
    private readonly lyricsRepository: Repository<Lyric>,
  ) {}

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
