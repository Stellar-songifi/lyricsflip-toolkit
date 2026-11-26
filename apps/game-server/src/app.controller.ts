import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { AppService } from './app.service';
import { StellarHealthIndicator } from './health/stellar.health';

@ApiTags('health')
@Controller('health')
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly stellar: StellarHealthIndicator,
  ) {}

  /** Liveness probe — the process is up and the event loop is not hung. */
  @Get('live')
  @HealthCheck()
  live() {
    return this.health.check([]);
  }

  /** Readiness probe — database (and Stellar RPC in stellar mode) reachable. */
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.db.pingCheck('database'),
      () => this.stellar.isHealthy('stellar'),
    ]);
  }

  /** @deprecated Use GET /health/live or GET /health/ready instead. */
  @Get()
  getHealth() {
    return this.appService.getHealth();
  }
}
