import { INestApplication } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import request from 'supertest';
import { LYRICS, Player, auth, bootApp, eventually, resetDatabase, signIn } from './e2e-app';
import { GameGateway } from '../src/modules/game/game.gateway';
import { SettlementListener } from '../src/modules/settlement/settlement.listener';
import { SettlementSweeperService } from '../src/modules/settlement/settlement-sweeper.service';

const STAKE = '50000000';

describe('staked head-to-head match (e2e, mock settlement)', () => {
  let app: INestApplication;
  let server: any;

  beforeAll(async () => {
    await resetDatabase();
    app = await bootApp();
    server = app.getHttpServer();
  });
  afterAll(() => app.close());

  async function stakedMatch(host: Player, joiner: Player) {
    const created = await request(server)
      .post('/challenges')
      .set(...auth(host))
      .send({ stakeAmount: STAKE })
      .expect(201);
    const preview = await request(server).get(`/challenges/${created.body.code}`).set(...auth(joiner)).expect(200);
    expect(preview.body.stakeAmount).toBe(STAKE);

    const accepted = await request(server)
      .post(`/challenges/${created.body.code}/accept`)
      .set(...auth(joiner))
      .expect(201);
    return accepted.body as { gameSessionId: string; wagerId: string };
  }

  async function stake(player: Player, wagerId: string) {
    const tx = await request(server)
      .post(`/wagers/${wagerId}/stake-transaction`)
      .set(...auth(player))
      .expect(200);
    expect(tx.body.transaction).toBeNull(); // mock mode: nothing to sign
    return request(server).post(`/wagers/${wagerId}/stake`).set(...auth(player)).send({}).expect(200);
  }

  async function titleOfCurrentLyric(player: Player, sessionId: string) {
    const lyric = await request(server).get(`/game/sessions/${sessionId}/lyric`).set(...auth(player)).expect(200);
    return LYRICS.find((l) => l.snippet === lyric.body.snippet)!.title;
  }

  it('settles on the server, from server-side scores, when the match ends', async () => {
    const alice = await signIn(app);
    const bob = await signIn(app);
    const { gameSessionId, wagerId } = await stakedMatch(alice, bob);

    // Accepting opened the pot; the match waits for both stakes.
    let wager = await request(server).get(`/wagers/${wagerId}`).set(...auth(alice)).expect(200);
    expect(wager.body.status).toBe('awaiting_stakes');
    let session = await request(server).get(`/game/sessions/${gameSessionId}`).set(...auth(alice)).expect(200);
    expect(session.body.status).toBe('waiting');
    await request(server)
      .post('/game/guess')
      .set(...auth(alice))
      .send({ sessionId: gameSessionId, guess: 'anything' })
      .expect(400);

    await stake(alice, wagerId);
    wager = await request(server).get(`/wagers/${wagerId}`).set(...auth(alice)).expect(200);
    expect(wager.body.status).toBe('awaiting_stakes');
    await stake(bob, wagerId);

    await eventually(async () => {
      const s = await request(server).get(`/game/sessions/${gameSessionId}`).set(...auth(alice));
      return s.body.status === 'active';
    });

    // Ten rounds: Alice names each song, Bob misses.
    for (let round = 0; round < 10; round++) {
      const player = round % 2 === 0 ? alice : bob;
      const guess = player === alice ? await titleOfCurrentLyric(alice, gameSessionId) : 'wrong answer';
      await request(server)
        .post('/game/guess')
        .set(...auth(player))
        .send({ sessionId: gameSessionId, guess })
        .expect(201);
    }

    session = await request(server).get(`/game/sessions/${gameSessionId}`).set(...auth(alice)).expect(200);
    expect(session.body.status).toBe('finished');

    const settled = await eventually(async () => {
      const w = await request(server).get(`/wagers/${wagerId}`).set(...auth(bob));
      return w.body.status === 'won' ? w.body : null;
    });
    expect(settled.winnerId).toBe(alice.id);
    expect(settled.settlementKind).toBe('payout');
  });

  it('gives clients no way to settle, refund or name a winner', async () => {
    const alice = await signIn(app);
    const bob = await signIn(app);
    const { wagerId } = await stakedMatch(alice, bob);
    await stake(alice, wagerId);
    await stake(bob, wagerId);

    for (const path of ['settle', 'refund', 'reconcile']) {
      await request(server)
        .post(`/wagers/${wagerId}/${path}`)
        .set(...auth(bob))
        .send({ winnerId: bob.id, outcome: 'won', txHash: 'x' })
        .expect(404);
    }
    const wager = await request(server).get(`/wagers/${wagerId}`).set(...auth(bob)).expect(200);
    expect(wager.body.status).toBe('staked');
  });

  it('ignores user ids in request bodies', async () => {
    const alice = await signIn(app);
    const bob = await signIn(app);
    const mallory = await signIn(app);
    const created = await request(server)
      .post('/challenges')
      .set(...auth(alice))
      .send({ stakeAmount: STAKE, hostUserId: mallory.id })
      .expect(400); // unknown fields are rejected outright
    expect(created.body.message).toEqual(expect.arrayContaining([expect.stringMatching(/hostUserId/)]));

    const { gameSessionId } = await stakedMatch(alice, bob);
    await request(server)
      .post('/game/guess')
      .set(...auth(mallory))
      .send({ sessionId: gameSessionId, guess: 'x', userId: alice.id })
      .expect(400);
  });

  it('requires a token everywhere except sign-in and health', async () => {
    await request(server).get('/health').expect(200);
    await request(server).post('/challenges').send({}).expect(401);
    await request(server).post('/game/sessions').send({ mode: 'solo' }).expect(401);
    await request(server).get('/notifications').expect(401);
    await request(server).get('/wagers').expect(401);
  });

  it('notifies both players when the pot is paid', async () => {
    const alice = await signIn(app);
    const bob = await signIn(app);
    const { gameSessionId, wagerId } = await stakedMatch(alice, bob);
    await stake(alice, wagerId);
    await stake(bob, wagerId);
    await eventually(async () => {
      const s = await request(server).get(`/game/sessions/${gameSessionId}`).set(...auth(alice));
      return s.body.status === 'active';
    });
    for (let round = 0; round < 10; round++) {
      const guess = await titleOfCurrentLyric(bob, gameSessionId);
      await request(server)
        .post('/game/guess')
        .set(...auth(bob))
        .send({ sessionId: gameSessionId, guess })
        .expect(201);
    }

    const notes = await eventually(async () => {
      const res = await request(server).get('/notifications').set(...auth(bob));
      return res.body.some((n: { type: string }) => n.type === 'wager.won') ? res.body : null;
    });
    expect(notes.find((n: { type: string }) => n.type === 'wager.won').message).toMatch(/10\.0/);
    const aliceNotes = await request(server).get('/notifications').set(...auth(alice)).expect(200);
    expect(aliceNotes.body.map((n: { type: string }) => n.type)).toContain('wager.lost');
  });

  it('forbids third parties from reading session state and lyric via HTTP and socket (issue #29)', async () => {
    const alice = await signIn(app);
    const bob = await signIn(app);
    const mallory = await signIn(app);
    const { gameSessionId } = await stakedMatch(alice, bob);

    // Mallory is not a player -> HTTP 403 Forbidden
    await request(server)
      .get(`/game/sessions/${gameSessionId}`)
      .set(...auth(mallory))
      .expect(403);

    await request(server)
      .get(`/game/sessions/${gameSessionId}/lyric`)
      .set(...auth(mallory))
      .expect(403);

    // Alice and Bob are players -> HTTP 200 OK
    await request(server)
      .get(`/game/sessions/${gameSessionId}`)
      .set(...auth(alice))
      .expect(200);

    await request(server)
      .get(`/game/sessions/${gameSessionId}`)
      .set(...auth(bob))
      .expect(200);

    // Socket: Mallory gets WsException from getSession
    const gateway = app.get(GameGateway);
    const mockSocket = {
      data: { userId: mallory.id },
      emit: jest.fn(),
      join: jest.fn(),
    } as any;

    await expect(
      gateway.handleGetSession({ sessionId: gameSessionId }, mockSocket),
    ).rejects.toThrow(WsException);
  });

  it('recovers stuck staked wager when finished event is lost via sweeper (issue #30)', async () => {
    const listener = app.get(SettlementListener);
    listener.enabled = false;
    try {
      const alice = await signIn(app);
      const bob = await signIn(app);
      const { gameSessionId, wagerId } = await stakedMatch(alice, bob);
      await stake(alice, wagerId);
      await stake(bob, wagerId);

      await eventually(async () => {
        const s = await request(server).get(`/game/sessions/${gameSessionId}`).set(...auth(alice));
        return s.body.status === 'active';
      });

      for (let round = 0; round < 10; round++) {
        const player = round % 2 === 0 ? alice : bob;
        const guess = player === alice ? await titleOfCurrentLyric(alice, gameSessionId) : 'wrong answer';
        await request(server)
          .post('/game/guess')
          .set(...auth(player))
          .send({ sessionId: gameSessionId, guess })
          .expect(201);
      }

      const session = await request(server)
        .get(`/game/sessions/${gameSessionId}`)
        .set(...auth(alice))
        .expect(200);
      expect(session.body.status).toBe('finished');

      // Since listener was disabled, wager is still 'staked'
      let wager = await request(server).get(`/wagers/${wagerId}`).set(...auth(alice)).expect(200);
      expect(wager.body.status).toBe('staked');

      // Run sweeper
      const sweeper = app.get(SettlementSweeperService);
      const settledCount = await sweeper.sweep();
      expect(settledCount).toBe(1);

      wager = await request(server).get(`/wagers/${wagerId}`).set(...auth(alice)).expect(200);
      expect(wager.body.status).toBe('won');
      expect(wager.body.winnerId).toBe(alice.id);

      // Running sweeper twice does not change settled wager
      const settledCount2 = await sweeper.sweep();
      expect(settledCount2).toBe(0);

      const wagerAfterSecondSweep = await request(server).get(`/wagers/${wagerId}`).set(...auth(alice)).expect(200);
      expect(wagerAfterSecondSweep.body.status).toBe('won');
    } finally {
      listener.enabled = true;
    }
  });
});
