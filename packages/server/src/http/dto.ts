import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SubmitStakeDto {
  /** The signed stake envelope; omit in mock or custodial mode. */
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  signedTransactionXdr?: string;
}

export class WalletChallengeDto {
  @IsString()
  @MaxLength(64)
  address: string;
}

export class WalletVerifyDto {
  /** A classic account (G...) or a contract account (C...). */
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
  @IsString()
  @MaxLength(20_000)
  authorizationEntries?: string;
}
