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
  });
});
