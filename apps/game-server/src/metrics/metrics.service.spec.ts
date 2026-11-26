import { GameMode, GameSessionStatus } from '../modules/game/entities/game-session.entity';
import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  it('renders request, session, settlement and reconciliation metrics', async () => {
    const sessions = {
      countBy: jest.fn(({ mode, status }) => {
        expect(status).toBe(GameSessionStatus.ACTIVE);
        return Promise.resolve(mode === GameMode.SOLO ? 2 : mode === GameMode.ROOM ? 1 : 0);
      }),
    };
    const metrics = new MetricsService(sessions as never);

    metrics.observeHttpRequest('POST', '/games/:id/guess', 201, 0.025);
    metrics.observeSettlement('won', 0.5);
    metrics.observeReconcileSweep('success', 0.75);
    metrics.observeReconcileAttemptsExhausted();
    metrics.setReconcileInterval(60);

    const output = await metrics.render();

    expect(output).toContain(
      'lyricsflip_http_requests_total{method="POST",route="/games/:id/guess",status_code="201"} 1',
    );
    expect(output).toContain('lyricsflip_http_request_duration_seconds_count');
    expect(output).toContain('lyricsflip_game_sessions_active{mode="solo"} 2');
    expect(output).toContain('lyricsflip_game_sessions_active{mode="room"} 1');
    expect(output).toContain('lyricsflip_settlement_total{outcome="won"} 1');
    expect(output).toContain('lyricsflip_settlement_duration_seconds_count{outcome="won"} 1');
    expect(output).toContain('lyricsflip_reconcile_sweeps_total{outcome="success"} 1');
    expect(output).toContain(
      'lyricsflip_reconcile_sweep_duration_seconds_count{outcome="success"} 1',
    );
    expect(output).toContain('lyricsflip_reconcile_attempts_exhausted_total 1');
    expect(output).toMatch(
      /lyricsflip_reconcile_sweep_last_success_timestamp_seconds \d+(?:\.\d+)?/,
    );
    expect(output).toContain('lyricsflip_reconcile_interval_seconds 60');
  });

  it('does not advance the last-success timestamp for skipped or failed sweeps', async () => {
    const metrics = new MetricsService({ countBy: jest.fn().mockResolvedValue(0) } as never);

    metrics.observeReconcileSweep('skipped', 0.1);
    metrics.observeReconcileSweep('failed', 0.2);

    expect(await metrics.render()).toContain(
      'lyricsflip_reconcile_sweep_last_success_timestamp_seconds 0',
    );
  });
});
