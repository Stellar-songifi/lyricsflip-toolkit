import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';

export interface UnsignedStakeTransaction {
  playerId: string;
  /** Base64 XDR the player's wallet must sign and submit. */
  transactionXdr: string;
}

export interface StellarInfo {
  settlementMode: 'mock' | 'stellar';
  custodyMode: 'non-custodial' | 'custodial';
  network: string;
  escrowContractId: string | null;
  tokenContractId: string | null;
}

/**
 * Talks to the `lyricsflip-escrow` Soroban contract. In `mock` mode (the
 * default) nothing touches the network — wager balances live entirely in
 * Postgres, via the `wagers` table — so gameplay can be built without
 * deploying contracts. In `stellar` mode this builds unsigned transactions
 * for non-custodial signing, or submits directly with the resolver key in
 * custodial mode.
 */
@Injectable()
export class StellarService {
  private readonly logger = new Logger(StellarService.name);

  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  private get stellarConfig() {
    return this.configService.get('stellar', { infer: true });
  }

  getInfo(): StellarInfo {
    const { settlementMode, custodyMode, network, escrowContractId, tokenContractId } =
      this.stellarConfig;
    return {
      settlementMode,
      custodyMode,
      network,
      escrowContractId: escrowContractId || null,
      tokenContractId: tokenContractId || null,
    };
  }

  /**
   * Opens a pot for a session and returns one unsigned funding transaction
   * per player (non-custodial mode). In mock mode this is a no-op — staking
   * is recorded directly against the `wagers` row instead.
   */
  async openPot(
    sessionId: string,
    playerAAddress: string,
    playerBAddress: string,
    stakeAmountStroops: string,
  ): Promise<UnsignedStakeTransaction[] | null> {
    const { settlementMode } = this.stellarConfig;
    if (settlementMode === 'mock') {
      this.logger.debug(`[mock] open_pot session=${sessionId} stake=${stakeAmountStroops}`);
      return null;
    }

    // TODO: build a Soroban `open_pot` invocation with @stellar/stellar-sdk
    // against STELLAR_ESCROW_CONTRACT_ID, then a `stake` invocation per
    // player, returned as unsigned XDR for the wallet to sign.
    throw new Error('stellar settlement mode is not implemented yet — see contracts/README.md');
  }

  async resolve(sessionId: string, winnerAddress: string): Promise<string | null> {
    const { settlementMode } = this.stellarConfig;
    if (settlementMode === 'mock') {
      this.logger.debug(`[mock] resolve session=${sessionId} winner=${winnerAddress}`);
      return null;
    }

    throw new Error('stellar settlement mode is not implemented yet — see contracts/README.md');
  }

  async refund(sessionId: string): Promise<string | null> {
    const { settlementMode } = this.stellarConfig;
    if (settlementMode === 'mock') {
      this.logger.debug(`[mock] refund session=${sessionId}`);
      return null;
    }

    throw new Error('stellar settlement mode is not implemented yet — see contracts/README.md');
  }
}
