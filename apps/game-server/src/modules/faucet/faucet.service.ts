import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Asset, Keypair, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { SorobanRpc, WalletLinkService } from '@lyricsflip-toolkit/server';
import { AppConfig } from '../../config/configuration';

const TEST_NETWORKS = new Set(['testnet', 'local', 'futurenet']);
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * Hands out the free test stake token so mobile players can try staked
 * matches. Refuses to exist outside test networks. The player's wallet must
 * already trust the asset (the app does that before calling).
 *
 * Cooldowns are kept in memory: a restart resets them, which is fine for a
 * testnet faucet.
 */
@Injectable()
export class FaucetService {
  private readonly logger = new Logger(FaucetService.name);
  private readonly lastClaim = new Map<string, number>();

  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly walletLinks: WalletLinkService,
  ) {}

  info() {
    const faucet = this.config.get('faucet', { infer: true });
    const stellar = this.config.get('stellar', { infer: true });
    const enabled = this.enabled();
    return {
      enabled,
      asset: enabled ? faucet.asset : null,
      amount: enabled ? faucet.amount : null,
      rpcUrl: enabled ? stellar.rpcUrl : null,
      networkPassphrase: enabled ? stellar.networkPassphrase : null,
    };
  }

  async claim(userId: string): Promise<{ txHash: string; amount: string }> {
    if (!this.enabled()) throw new BadRequestException('The faucet is off on this server');
    const last = this.lastClaim.get(userId) ?? 0;
    if (Date.now() - last < COOLDOWN_MS) {
      throw new BadRequestException('You can use the faucet once a day');
    }
    const address = await this.walletLinks.getAddress(userId);
    if (!address) throw new BadRequestException('Link a wallet first');

    const faucet = this.config.get('faucet', { infer: true });
    const stellar = this.config.get('stellar', { infer: true });
    const [code, issuer] = faucet.asset.split(':');
    const source = Keypair.fromSecret(faucet.secret);
    const sorobanRpc = new SorobanRpc({ rpcUrl: stellar.rpcUrl, networkPassphrase: stellar.networkPassphrase });
    const account = await sorobanRpc.server.getAccount(source.publicKey());
    const tx = new TransactionBuilder(account, { fee: '1000', networkPassphrase: stellar.networkPassphrase })
      .addOperation(Operation.payment({ destination: address, asset: new Asset(code, issuer), amount: faucet.amount }))
      .setTimeout(60)
      .build();
    const result = await sorobanRpc.signAndSubmit(tx, [source]);
    if (result.status !== 'confirmed') {
      this.logger.warn(`Faucet payment to ${address} ${result.status}: ${result.error}`);
      throw new ServiceUnavailableException('The faucet payment did not go through; does your wallet trust the asset?');
    }
    this.lastClaim.set(userId, Date.now());
    return { txHash: result.hash, amount: faucet.amount };
  }

  private enabled(): boolean {
    const faucet = this.config.get('faucet', { infer: true });
    const stellar = this.config.get('stellar', { infer: true });
    return (
      stellar.settlementMode === 'stellar' &&
      TEST_NETWORKS.has(stellar.network) &&
      Boolean(faucet.secret) &&
      /^[A-Za-z0-9]{1,12}:G[A-Z2-7]{55}$/.test(faucet.asset)
    );
  }
}

