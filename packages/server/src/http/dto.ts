import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from './swagger';

export class SubmitStakeDto {
  /** The signed stake envelope; omit in mock or custodial mode. */
  @ApiPropertyOptional({ description: 'Signed stake envelope XDR (base64). Omit in mock or custodial mode.', maxLength: 20_000 })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  signedTransactionXdr?: string;
}

export class SubmitStakeAuthDto {
  @ApiProperty({
    description: "The player's signed `SorobanAuthorizationEntry` for `stake(potId, player)` (base64 XDR).",
    maxLength: 20_000,
  })
  @IsString()
  @MaxLength(20_000)
  signedAuthEntryXdr: string;
}

export class WalletChallengeDto {
  @ApiProperty({ description: 'The Stellar account (G...) to link.', maxLength: 64 })
  @IsString()
  @MaxLength(64)
  address: string;
}

export class WalletVerifyDto {
  /** A classic account (G...) or a contract account (C...). */
  @ApiProperty({ description: 'The Stellar account (G...) being linked.', maxLength: 64 })
  @IsString()
  @MaxLength(64)
  address: string;

  /** Classic accounts: the signed SEP-10 challenge transaction. */
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  signedTransactionXdr?: string;

  /** Contract accounts: the signed SEP-45 `authorization_entries` (#61). */
  @IsOptional()
  @ApiProperty({ description: 'The challenge transaction, signed by the account (base64 XDR).', maxLength: 20_000 })
  @IsString()
  @MaxLength(20_000)
  authorizationEntries?: string;
}
