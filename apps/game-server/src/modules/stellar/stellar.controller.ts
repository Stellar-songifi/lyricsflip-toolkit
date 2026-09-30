import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { StellarService, StellarInfo } from './stellar.service';

@ApiTags('stellar')
@Controller('stellar')
export class StellarController {
  constructor(private readonly stellarService: StellarService) {}

  /**
   * Compare this against what you deployed before letting players into a
   * `stellar`-mode wager — see README.md#smart-contracts.
   */
  @Get('info')
  getInfo(): StellarInfo {
    return this.stellarService.getInfo();
  }
}
