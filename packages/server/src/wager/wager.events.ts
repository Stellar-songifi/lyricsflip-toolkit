import type { Wager } from './wager.entity';

export type PvpEventType =
  | 'wager.created'
  | 'wager.accepted'
  | 'wager.staked'
  | 'wager.won'
  | 'wager.refunded'
  | 'wager.cancelled'
  | 'wager.failed';

/** Emitted through `PvpSettlementOptions.onEvent` after a status change commits. */
export interface PvpEvent {
  type: PvpEventType;
  wager: Wager;
}
