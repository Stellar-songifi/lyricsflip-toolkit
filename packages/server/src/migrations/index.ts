import { CreatePvpTables1760000000000 } from './1760000000000-CreatePvpTables';
import { AddSep10Redeemed1760000000001 } from './1760000000001-AddSep10Redeemed';
import { CreatePvpWagerEvents1760000000002 } from './1760000000002-CreatePvpWagerEvents';

/** Migrations to add to the host app's TypeORM `migrations`. */
export const PVP_MIGRATIONS = [
  CreatePvpTables1760000000000,
  AddSep10Redeemed1760000000001,
  CreatePvpWagerEvents1760000000002,
];