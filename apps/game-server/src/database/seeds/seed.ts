import 'reflect-metadata';
import { AppDataSource } from '../../config/data-source';
import { Lyric, Difficulty } from '../../modules/lyrics/entities/lyric.entity';

const sampleLyrics: Partial<Lyric>[] = [
  {
    snippet: "I'm gonna pop some tags, only got twenty dollars in my pocket",
    artist: 'Macklemore & Ryan Lewis',
    title: 'Thrift Shop',
    genre: 'Hip-Hop',
    decade: 2010,
    difficulty: Difficulty.EASY,
  },
  {
    snippet: 'Cause baby you\'re a firework, come on show \'em what you\'re worth',
    artist: 'Katy Perry',
    title: 'Firework',
    genre: 'Pop',
    decade: 2010,
    difficulty: Difficulty.EASY,
  },
  {
    snippet: "Is this the real life? Is this just fantasy?",
    artist: 'Queen',
    title: 'Bohemian Rhapsody',
    genre: 'Rock',
    decade: 1970,
    difficulty: Difficulty.MEDIUM,
  },
  {
    snippet: 'Started from the bottom now we\'re here',
    artist: 'Drake',
    title: 'Started From the Bottom',
    genre: 'Hip-Hop',
    decade: 2010,
    difficulty: Difficulty.MEDIUM,
  },
  {
    snippet: 'Hello darkness, my old friend, I\'ve come to talk with you again',
    artist: 'Simon & Garfunkel',
    title: 'The Sound of Silence',
    genre: 'Folk',
    decade: 1960,
    difficulty: Difficulty.HARD,
  },
];

async function run() {
  const dataSource = await AppDataSource.initialize();
  const repo = dataSource.getRepository(Lyric);

  const existing = await repo.count();
  if (existing > 0) {
    console.log(`Skipping seed — "lyrics" already has ${existing} rows.`);
    await dataSource.destroy();
    return;
  }

  await repo.save(repo.create(sampleLyrics));
  console.log(`Seeded ${sampleLyrics.length} lyrics.`);

  await dataSource.destroy();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
