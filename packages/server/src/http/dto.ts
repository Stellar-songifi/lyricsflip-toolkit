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
  @IsString()
  @MaxLength(64)
  address: string;

  @IsString()
  @MaxLength(20_000)
  signedTransactionXdr: string;
}
