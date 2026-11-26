import { SettlementKind, WagerStatus } from '../wager/wager.entity';
import { ApiProperty, ApiPropertyOptional } from './swagger';

/** A wager as returned by the `/wagers` routes. */
export class WagerDto {
  @ApiProperty({ format: 'uuid', description: 'Wager id; also the escrow pot key.' })
  id: string;

  @ApiProperty({ description: "The game's identifier for the match." })
  matchId: string;

  @ApiProperty({ description: 'The player who proposed the wager.' })
  playerAId: string;

  @ApiProperty({ description: 'The invited player.' })
  playerBId: string;

  @ApiProperty({ example: '50000000', description: 'Stroops each player stakes, as an integer string.' })
  stakeAmount: string;

  @ApiProperty({ enum: WagerStatus, enumName: 'WagerStatus' })
  status: WagerStatus;

  @ApiPropertyOptional({ nullable: true, type: String, description: 'Wallet fixed for player A when the pot opened.' })
  playerAAddress: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  playerBAddress: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  acceptedAt: Date | null;

  @ApiPropertyOptional({ nullable: true, type: Number, description: 'Ledger after which players can reclaim stakes.' })
  potDeadlineLedger: number | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  playerAStakeTxHash: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  playerBStakeTxHash: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  playerAStakedAt: Date | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  playerBStakedAt: Date | null;

  @ApiPropertyOptional({ nullable: true, enum: SettlementKind, enumName: 'SettlementKind' })
  settlementKind: SettlementKind | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  winnerId: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  settlementTxHash: string | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  settlementLedger: number | null;

  @ApiProperty()
  reconcileAttempts: number;

  @ApiPropertyOptional({ nullable: true, type: String })
  failureReason: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;
}

/** A stake transaction for the player's wallet to sign. */
export class UnsignedStakeDto {
  @ApiProperty({ description: 'Base64 transaction envelope XDR.' })
  transactionXdr: string;

  @ApiProperty({ example: 'Test SDF Network ; September 2015' })
  networkPassphrase: string;
}

/** A stake authorisation entry for a smart wallet to sign (#62). */
export class UnsignedStakeAuthDto {
  @ApiProperty({ description: 'Base64 SorobanAuthorizationEntry to sign.' })
  authEntryXdr: string;

  @ApiProperty({ description: 'Last ledger at which the signature is accepted.' })
  expirationLedger: number;

  @ApiProperty({ example: 'Test SDF Network ; September 2015' })
  networkPassphrase: string;
}

/** `transaction: null` means no signature is needed; post to `/stake` directly. */
export class StakeTransactionDto {
  @ApiProperty({ type: UnsignedStakeDto, nullable: true })
  transaction: UnsignedStakeDto | null;
}

/** A SEP-10 challenge for the wallet to sign. */
export class Sep10ChallengeDto {
  @ApiProperty({ description: 'Base64 challenge transaction XDR.' })
  transactionXdr: string;

  @ApiProperty({ example: 'Test SDF Network ; September 2015' })
  networkPassphrase: string;
}

export class WalletAddressDto {
  @ApiProperty({ nullable: true, type: String, description: 'The linked wallet, or null.' })
  address: string | null;
}

export class WalletLinkDto {
  @ApiProperty()
  address: string;

  @ApiProperty({ type: String, format: 'date-time' })
  verifiedAt: Date;
}

export class ResolverAddressDto {
  @ApiProperty({ description: 'The resolver public key the server signs with.' })
  resolverAddress: string;
}
