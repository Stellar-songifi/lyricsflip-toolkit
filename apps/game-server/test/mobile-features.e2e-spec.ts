import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PushTransport, RecordingPushTransport } from '../src/modules/push/expo-push.client';
import { LYRICS, auth, bootApp, eventually, resetDatabase, signIn } from './e2e-app';

describe('features the mobile app relies on (e2e)', () => {
  let app: INestApplication;
  let server: any;
  let pushes: RecordingPushTransport;

  beforeAll(async () => {
    await resetDatabase();
    app = await bootApp();
    server = app.getHttpServer();
    pushes = app.get(PushTransport) as RecordingPushTransport;
  });
  afterAll(() => app.close());

  describe('daily challenge', () => {
    it('serves the same five lyrics to everyone and hides answers until guessed', async () => {
      const alice = await signIn(app);
      const bob = await signIn(app);
      const a = await request(server).get('/daily').set(...auth(alice)).expect(200);
      const b = await request(server).get('/daily').set(...auth(bob)).expect(200);

      expect(a.body.lyrics).toHaveLength(5);
      expect(a.body.lyrics.map((l: { id: string }) => l.id)).toEqual(b.body.lyrics.map((l: { id: string }) => l.id));
      expect(a.body.lyrics[0].attempt).toBeNull();
      expect(JSON.stringify(a.body)).not.toMatch(/Song Title/);
    });

    it('scores one guess per lyric and awards XP', async () => {
      const player = await signIn(app);
      const today = await request(server).get('/daily').set(...auth(player)).expect(200);
      const first = today.body.lyrics[0];
      const title = LYRICS.find((l) => l.snippet === first.snippet)!.title;

      const res = await request(server)
        .post('/daily/guess')
        .set(...auth(player))
        .send({ lyricId: first.id, guess: title })
        .expect(201);
      expect(res.body.outcome).toBe('correct');
      expect(res.body.points).toBeGreaterThan(0);

      await request(server)
        .post('/daily/guess')
        .set(...auth(player))
        .send({ lyricId: first.id, guess: title })
        .expect(400);

      const me = await request(server).get('/users/me').set(...auth(player)).expect(200);
      expect(me.body.xp).toBe(res.body.points);
      const board = await request(server).get('/daily/leaderboard').set(...auth(player)).expect(200);
      expect(board.body.find((r: { userId: string }) => r.userId === player.id).points).toBe(res.body.points);
    });

    it("rejects lyrics that aren't in today's set", async () => {
      const player = await signIn(app);
      await request(server)
        .post('/daily/guess')
        .set(...auth(player))
        .send({ lyricId: '00000000-0000-4000-8000-000000000000', guess: 'x' })
        .expect(400);
    });
  });

  describe('push notifications and invites', () => {
    it('registers only Expo push tokens', async () => {
      const player = await signIn(app);
      await request(server)
        .post('/push-tokens')
        .set(...auth(player))
        .send({ token: 'not-a-token', platform: 'ios' })
        .expect(400);
      await request(server)
        .post('/push-tokens')
        .set(...auth(player))
        .send({ token: 'ExponentPushToken[abc123]', platform: 'ios' })
        .expect(201);
    });

    it('pushes a challenge invite with a deep link, and only the invitee can accept', async () => {
      const host = await signIn(app);
      const friend = await signIn(app);
      const stranger = await signIn(app);
      await request(server).patch('/users/me').set(...auth(friend)).send({ username: `friend_${Date.now() % 100000}` }).expect(200);
      const me = await request(server).get('/users/me').set(...auth(friend)).expect(200);
      const token = `ExponentPushToken[friend${Date.now()}]`;
      await request(server).post('/push-tokens').set(...auth(friend)).send({ token, platform: 'android' }).expect(201);

      const created = await request(server)
        .post('/challenges')
        .set(...auth(host))
        .send({ opponentUsername: me.body.username })
        .expect(201);

      const push = pushes.sent.find((m) => m.to === token);
      expect(push?.data).toMatchObject({
        type: 'challenge.invite',
        url: `lyricsflip://challenge/${created.body.code}`,
      });

      await request(server).post(`/challenges/${created.body.code}/accept`).set(...auth(stranger)).expect(400);
      await request(server).post(`/challenges/${created.body.code}/accept`).set(...auth(friend)).expect(201);
    });

    it('pushes the result of a head-to-head match to both players', async () => {
      const host = await signIn(app);
      const guest = await signIn(app);
      const tokens = [`ExponentPushToken[h${Date.now()}]`, `ExponentPushToken[g${Date.now()}]`];
      await request(server).post('/push-tokens').set(...auth(host)).send({ token: tokens[0], platform: 'ios' });
      await request(server).post('/push-tokens').set(...auth(guest)).send({ token: tokens[1], platform: 'ios' });
      const created = await request(server).post('/challenges').set(...auth(host)).send({}).expect(201);
      const { body } = await request(server).post(`/challenges/${created.body.code}/accept`).set(...auth(guest)).expect(201);

      for (let round = 0; round < 10; round++) {
        await request(server)
          .post('/game/guess')
          .set(...auth(host))
          .send({ sessionId: body.gameSessionId, guess: 'nope' })
          .expect(201);
      }

      await eventually(async () => tokens.every((t) => pushes.sent.some((m) => m.to === t && m.data?.type === 'match.finished')));
      const hostPush = pushes.sent.find((m) => m.to === tokens[0] && m.data?.type === 'match.finished');
      expect(hostPush?.data?.url).toBe(`lyricsflip://results/${body.gameSessionId}`);
      expect(hostPush?.body).toMatch(/draw/);
    });

    it('lets a player pick a unique username', async () => {
      const a = await signIn(app);
      const b = await signIn(app);
      const name = `taken_${Date.now() % 100000}`;
      await request(server).patch('/users/me').set(...auth(a)).send({ username: name }).expect(200);
      await request(server).patch('/users/me').set(...auth(b)).send({ username: name }).expect(409);
      await request(server).patch('/users/me').set(...auth(b)).send({ username: 'Bad Name!' }).expect(400);
    });
  });
});
