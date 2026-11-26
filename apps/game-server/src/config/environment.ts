import { plainToInstance, Transform } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  NotEquals,
  ValidateIf,
  validateSync,
} from 'class-validator';

const toNumber = ({ value }: { value: unknown }): unknown =>
  value === undefined || value === '' ? value : Number(value);

/** Environment contract shared by application startup and the TypeORM CLI. */
export class EnvironmentVariables {
  @IsDefined({ message: 'is required' })
  @IsString()
  @IsNotEmpty()
  JWT_SECRET!: string;

  @IsDefined({ message: 'is required' })
  @IsString()
  @IsNotEmpty()
  DB_HOST!: string;

  @IsDefined({ message: 'is required' })
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @Max(65_535)
  DB_PORT!: number;

  @IsDefined({ message: 'is required' })
  @IsString()
  @IsNotEmpty()
  DB_USERNAME!: string;

  @IsDefined({ message: 'is required' })
  @IsString()
  @IsNotEmpty()
  DB_PASSWORD!: string;

  @IsDefined({ message: 'is required' })
  @IsString()
  @IsNotEmpty()
  DB_NAME!: string;

  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @Max(65_535)
  PORT?: number;

  @IsOptional()
  @Transform(toNumber)
  @IsInt({ message: 'ROUNDS_PER_SESSION must be a positive integer' })
  @Min(1, { message: 'ROUNDS_PER_SESSION must be a positive integer' })
  ROUNDS_PER_SESSION?: number;

  @IsOptional()
  @IsIn(['development', 'test', 'production'])
  NODE_ENV?: string;

  @ValidateIf((env: EnvironmentVariables) => env.NODE_ENV === 'production')
  @IsDefined({
    message: 'CORS_ORIGIN must be explicitly set to a specific origin in production mode',
  })
  @IsString()
  @IsNotEmpty()
  @NotEquals('*', {
    message: 'CORS_ORIGIN must be explicitly set to a specific origin in production mode',
  })
  CORS_ORIGIN?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  FRONTEND_URL?: string;

  @IsOptional()
  @IsIn(['mock', 'stellar'])
  STELLAR_SETTLEMENT_MODE?: string;

  @IsOptional()
  @IsIn(['non-custodial', 'custodial'])
  STELLAR_CUSTODY_MODE?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  STELLAR_NETWORK?: string;

  @ValidateIf((env: EnvironmentVariables) => env.STELLAR_SETTLEMENT_MODE === 'stellar')
  @IsDefined({ message: 'is required when STELLAR_SETTLEMENT_MODE=stellar' })
  @IsString()
  @IsNotEmpty()
  STELLAR_ESCROW_CONTRACT_ID?: string;

  @ValidateIf((env: EnvironmentVariables) => env.STELLAR_SETTLEMENT_MODE === 'stellar')
  @IsDefined({ message: 'is required when STELLAR_SETTLEMENT_MODE=stellar' })
  @IsString()
  @IsNotEmpty()
  STELLAR_TOKEN_CONTRACT_ID?: string;

  @ValidateIf((env: EnvironmentVariables) => env.STELLAR_SETTLEMENT_MODE === 'stellar')
  @IsDefined({ message: 'is required when STELLAR_SETTLEMENT_MODE=stellar' })
  @IsString()
  @IsNotEmpty()
  STELLAR_RESOLVER_SECRET?: string;

  @IsOptional()
  @Transform(toNumber)
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    { message: 'STELLAR_RPC_HTTP_TIMEOUT_MS must be a non-negative number' },
  )
  @Min(0, { message: 'STELLAR_RPC_HTTP_TIMEOUT_MS must be a non-negative number' })
  STELLAR_RPC_HTTP_TIMEOUT_MS?: number;

  @ValidateIf((env: EnvironmentVariables) => env.NODE_ENV === 'production')
  @IsDefined({ message: 'is required in production' })
  @IsString()
  @IsNotEmpty()
  SEP10_SIGNING_SECRET?: string;
}

function messagesFor(error: { constraints?: Record<string, string> }): string[] {
  return Object.values(error.constraints ?? {});
}

export function validateEnvironment(input: NodeJS.ProcessEnv): EnvironmentVariables {
  const normalizedInput =
    input.NODE_ENV === 'production' && !input.CORS_ORIGIN && input.FRONTEND_URL
      ? { ...input, CORS_ORIGIN: input.FRONTEND_URL }
      : input;
  const candidate = plainToInstance(EnvironmentVariables, normalizedInput, {
    exposeDefaultValues: true,
  });
  const errors = validateSync(candidate, {
    skipMissingProperties: false,
    forbidUnknownValues: false,
  });

  if (candidate.STELLAR_CUSTODY_MODE === 'custodial' && candidate.STELLAR_NETWORK === 'public') {
    errors.push({
      property: 'STELLAR_CUSTODY_MODE',
      constraints: {
        mainnetCustody:
          'custodial mode is refused when STELLAR_NETWORK=public without an audited opt-in',
      },
      children: [],
      target: candidate,
    });
  }

  if (errors.length > 0) {
    const details = errors
      .flatMap((error) => messagesFor(error).map((message) => `  - ${error.property}: ${message}`))
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return candidate;
}
