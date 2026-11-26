import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { Repository } from 'typeorm';
import {
  GameMode,
  GameSession,
  GameSessionStatus,
} from '../modules/game/entities/game-session.entity';

export type SettlementOutcome = 'won' | 'refunded' | 'failed';
export type ReconcileSweepOutcome = 'success' | 'failed' | 'skipped';

@Injectable()
export class MetricsService {
  readonly contentType = Registry.PROMETHEUS_CONTENT_TYPE;

  private readonly registry = new Registry();
  private readonly httpRequests: Counter<'method' | 'route' | 'status_code'>;
  private readonly httpRequestDuration: Histogram<'method' | 'route' | 'status_code'>;
  private readonly activeGameSessions: Gauge<'mode'>;
  private readonly settlements: Counter<'outcome'>;
  private readonly settlementDuration: Histogram<'outcome'>;
  private readonly reconcileSweeps: Counter<'outcome'>;
  private readonly reconcileSweepDuration: Histogram<'outcome'>;
  private readonly reconcileAttemptsExhausted: Counter;
  private readonly reconcileSweepLastSuccess: Gauge;
  private readonly reconcileInterval: Gauge;

  constructor(
    @InjectRepository(GameSession)
    private readonly sessions: Repository<GameSession>,
  ) {
    collectDefaultMetrics({ register: this.registry, prefix: 'lyricsflip_process_' });

    this.httpRequests = new Counter({
      name: 'lyricsflip_http_requests_total',
      help: 'Total HTTP requests handled by the game server.',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });
    this.httpRequestDuration = new Histogram({
      name: 'lyricsflip_http_request_duration_seconds',
      help: 'HTTP request latency in seconds.',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });
    this.activeGameSessions = new Gauge({
      name: 'lyricsflip_game_sessions_active',
      help: 'Current active game sessions, grouped by game mode.',
      labelNames: ['mode'],
      registers: [this.registry],
    });
    this.settlements = new Counter({
      name: 'lyricsflip_settlement_total',
      help: 'Completed settlement attempts, grouped by terminal outcome.',
      labelNames: ['outcome'],
      registers: [this.registry],
    });
    this.settlementDuration = new Histogram({
      name: 'lyricsflip_settlement_duration_seconds',
      help: 'Settlement attempt latency in seconds.',
      labelNames: ['outcome'],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
      registers: [this.registry],
    });
    this.reconcileSweeps = new Counter({
      name: 'lyricsflip_reconcile_sweeps_total',
      help: 'Reconciliation sweeps, grouped by outcome.',
      labelNames: ['outcome'],
      registers: [this.registry],
    });
    this.reconcileSweepDuration = new Histogram({
      name: 'lyricsflip_reconcile_sweep_duration_seconds',
      help: 'Reconciliation sweep latency in seconds.',
      labelNames: ['outcome'],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
      registers: [this.registry],
    });
    this.reconcileAttemptsExhausted = new Counter({
      name: 'lyricsflip_reconcile_attempts_exhausted_total',
      help: 'Wagers that exhausted every reconciliation attempt.',
      registers: [this.registry],
    });
    this.reconcileSweepLastSuccess = new Gauge({
      name: 'lyricsflip_reconcile_sweep_last_success_timestamp_seconds',
      help: 'Unix timestamp of the last successful lock-owning reconciliation sweep.',
      registers: [this.registry],
    });
    this.reconcileInterval = new Gauge({
      name: 'lyricsflip_reconcile_interval_seconds',
      help: 'Configured interval between reconciliation sweeps.',
      registers: [this.registry],
    });
  }

  observeHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    durationSeconds: number,
  ): void {
    const labels = { method, route, status_code: String(statusCode) };
    this.httpRequests.inc(labels);
    this.httpRequestDuration.observe(labels, durationSeconds);
  }

  observeSettlement(outcome: SettlementOutcome, durationSeconds: number): void {
    this.settlements.inc({ outcome });
    this.settlementDuration.observe({ outcome }, durationSeconds);
  }

  observeReconcileSweep(outcome: ReconcileSweepOutcome, durationSeconds: number): void {
    this.reconcileSweeps.inc({ outcome });
    this.reconcileSweepDuration.observe({ outcome }, durationSeconds);
    if (outcome === 'success') this.reconcileSweepLastSuccess.setToCurrentTime();
  }

  observeReconcileAttemptsExhausted(): void {
    this.reconcileAttemptsExhausted.inc();
  }

  setReconcileInterval(seconds: number): void {
    this.reconcileInterval.set(seconds);
  }

  async render(): Promise<string> {
    await this.refreshActiveSessions();
    return this.registry.metrics();
  }

  private async refreshActiveSessions(): Promise<void> {
    const modes = Object.values(GameMode);
    const counts = await Promise.all(
      modes.map((mode) => this.sessions.countBy({ mode, status: GameSessionStatus.ACTIVE })),
    );
    modes.forEach((mode, index) => this.activeGameSessions.set({ mode }, counts[index]));
  }
}
