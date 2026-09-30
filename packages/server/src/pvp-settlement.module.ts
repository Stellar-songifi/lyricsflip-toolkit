import { DynamicModule, Module, ModuleMetadata, Provider, Type } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ESCROW_GATEWAY, EscrowGateway } from './escrow/escrow.gateway';
import { MockEscrowGateway } from './escrow/mock-escrow.gateway';
import { MockPot } from './escrow/mock-pot.entity';
import { StellarEscrowGateway } from './escrow/stellar-escrow.gateway';
import { PvpPlayerGuard } from './http/player.guard';
import { WagerController } from './http/wager.controller';
import { WalletController } from './http/wallet.controller';
import { PVP_SETTLEMENT_OPTIONS, PvpSettlementOptions, validateOptions } from './options';
import { WagerReconcilerService } from './reconcile/wager-reconciler.service';
import { Wager } from './wager/wager.entity';
import { WagerService } from './wager/wager.service';
import { Sep10Service } from './wallet/sep10.service';
import { WalletLink } from './wallet/wallet-link.entity';
import { WalletLinkService } from './wallet/wallet-link.service';

/** Entities to add to the host app's TypeORM `entities`. */
export const PVP_ENTITIES = [Wager, WalletLink, MockPot];

export interface PvpSettlementAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  inject?: any[];
  useFactory: (...args: any[]) => PvpSettlementOptions | Promise<PvpSettlementOptions>;
  /** Mount the HTTP controllers. Default true. */
  controllers?: boolean;
}

/**
 * Staked head-to-head matches for a NestJS game server.
 *
 * Exports `WagerService` (the game server creates and settles wagers),
 * `WalletLinkService` and `Sep10Service`, globally. The host app must register
 * {@link PVP_ENTITIES} with TypeORM and run {@link PVP_MIGRATIONS}.
 */
@Module({})
export class PvpSettlementModule {
  static forRoot(options: PvpSettlementOptions): DynamicModule {
    validateOptions(options);
    return this.build([{ provide: PVP_SETTLEMENT_OPTIONS, useValue: options }], [], options.controllers ?? true);
  }

  static forRootAsync(options: PvpSettlementAsyncOptions): DynamicModule {
    return this.build(
      [
        {
          provide: PVP_SETTLEMENT_OPTIONS,
          inject: options.inject ?? [],
          useFactory: async (...args: unknown[]) => {
            const resolved = await options.useFactory(...args);
            validateOptions(resolved);
            return resolved;
          },
        },
      ],
      options.imports ?? [],
      options.controllers ?? true,
    );
  }

  private static build(
    optionProviders: Provider[],
    imports: NonNullable<ModuleMetadata['imports']>,
    withControllers: boolean,
  ): DynamicModule {
    const controllers: Type[] = withControllers ? [WagerController, WalletController] : [];
    return {
      module: PvpSettlementModule,
      // Global, so the host's own modules (auth, game logic) can inject
      // WagerService and Sep10Service without registering the module twice.
      global: true,
      imports: [...imports, TypeOrmModule.forFeature(PVP_ENTITIES)],
      controllers,
      providers: [
        ...optionProviders,
        MockEscrowGateway,
        {
          provide: ESCROW_GATEWAY,
          inject: [PVP_SETTLEMENT_OPTIONS, MockEscrowGateway],
          useFactory: (options: PvpSettlementOptions, mock: MockEscrowGateway): EscrowGateway =>
            options.mode === 'stellar' ? new StellarEscrowGateway(options) : mock,
        },
        WalletLinkService,
        Sep10Service,
        WagerService,
        WagerReconcilerService,
        PvpPlayerGuard,
      ],
      exports: [WagerService, WalletLinkService, Sep10Service, ESCROW_GATEWAY, PVP_SETTLEMENT_OPTIONS],
    };
  }
}
