import type { Wager } from './wager.entity';

export type PvpEventType =
  | 'wager.created'
  | 'wager.accepted'
  | 'wager.staked'
  | 'wager.won'
  | 'wager.refunded'
  | 'wager.cancelled'
  | 'wager.failed';

/**
 * Emitted through `PvpSettlementOptions.onEvent`.
 *
 * Delivery is **at-least-once**: events are persisted to the `pvp_wager_events`
 * outbox table in the same transaction as the status change and delivered by a
 * background dispatcher. Handlers MUST be idempotent (e.g. key on `event.id` or
 * on `wager.id` + `type`) because the same event may be delivered more than once
 * if the process dies after the handler runs but before the row is marked
 * delivered, or if a handler throws and the event is retried.
 */
export interface PvpEvent {
  type: PvpEventType;
  wager: Wager;
}

/** A row in the `pvp_wager_events` outbox table. */
export interface WagerEvent {
  id: string;
  wagerId: string;
  type: PvpEventType;
  payload: Record<string, unknown>;
  createdAt: Date;
  deliveredAt: Date | null;
  attempts: number;
}

/** SQL definition for the `pvp_wager_events` outbox table. */
export const PVP_WAGER_EVENTS_TABLE = 'pvp_wager_events';

export const PVP_WAGER_EVENTS_CREATE_SQL = `
CREATE TABLE IF NOT EXISTS ${PVP_WAGER_EVENTS_TABLE} (
  id TEXT PRIMARY KEY,
  wager_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ${PVP_WAGER_EVENTS_TABLE}_undelivered_idx
  ON ${PVP_WAGER_EVENTS_TABLE} (created_at)
  WHERE delivered_at IS NULL;
CREATE INDEX IF NOT EXISTS ${PVP_WAGER_EVENTS_TABLE}_wager_idx
  ON ${PVP_WAGER_EVENTS_TABLE} (wager_id);
`;

/** Migration entry for `PVP_MIGRATIONS`. */
export const PVP_WAGER_EVENTS_MIGRATION = {
  id: '0003_pvp_wager_events',
  up: PVP_WAGER_EVENTS_CREATE_SQL,
  down: `DROP TABLE IF EXISTS ${PVP_WAGER_EVENTS_TABLE};`,
};

/** Advisory lock key used by the event dispatcher (distinct from the reconciler). */
export const PVP_WAGER_EVENTS_DISPATCH_LOCK_KEY = 0x7076_7765; // "pvwe"

/** Backoff schedule (ms) applied per attempt when a handler throws. */
export const PVP_WAGER_EVENTS_BACKOFF_MS = [
  1_000, 5_000, 15_000, 60_000, 300_000,
];

export function wagerEventBackoffMs(attempts: number): number {
  if (attempts <= 0) return 0;
  const idx = Math.min(attempts - 1, PVP_WAGER_EVENTS_BACKOFF_MS.length - 1);
  return PVP_WAGER_EVENTS_BACKOFF_MS[idx];
}
</｜｜DSML｜｜ parameter>
</｜｜DSML｜｜ invoke>
</｜｜DSML｜｜ calls>