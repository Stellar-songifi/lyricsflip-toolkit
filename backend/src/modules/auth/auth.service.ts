import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as StellarSdk from '@stellar/stellar-sdk';
import { randomBytes } from 'crypto';
import { UsersService } from '../users/users.service';
import { AppConfig } from '../../config/configuration';

interface PendingChallenge {
  transactionXdr: string;
  expiresAt: number;
}

/**
 * SEP-10 web auth: https://developers.stellar.org/docs/learn/encyclopedia/security/sep-0010
 *
 * `getChallenge` builds a challenge transaction for the wallet to sign;
 * `verify` checks the signature came back from the claimed account and
 * issues a JWT. Implemented server-side; the frontend doesn't call this yet
 * — see README.md#known-gaps.
 */
@Injectable()
export class AuthService {
  private readonly serverKeypair: StellarSdk.Keypair;
  private readonly challenges = new Map<string, PendingChallenge>();
  private readonly challengeTtlSeconds = 300;

  constructor(
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {
    // A dedicated SEP-10 signing key, separate from the escrow resolver key.
    this.serverKeypair = StellarSdk.Keypair.random();
  }

  getChallenge(walletAddress: string) {
    const { networkPassphrase } = this.configService.get('stellar', { infer: true });

    const account = new StellarSdk.Account(walletAddress, '-1');
    const transaction = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase,
    })
      .addOperation(
        StellarSdk.Operation.manageData({
          name: 'LyricsFlip auth',
          value: randomBytes(48),
          source: walletAddress,
        }),
      )
      .setTimeout(this.challengeTtlSeconds)
      .build();

    transaction.sign(this.serverKeypair);
    const transactionXdr = transaction.toXDR();

    this.challenges.set(walletAddress, {
      transactionXdr,
      expiresAt: Date.now() + this.challengeTtlSeconds * 1000,
    });

    return { transactionXdr, networkPassphrase };
  }

  async verify(walletAddress: string, signedTransactionXdr: string) {
    const pending = this.challenges.get(walletAddress);
    if (!pending || pending.expiresAt < Date.now()) {
      throw new UnauthorizedException('Challenge expired or not found — request a new one');
    }
    this.challenges.delete(walletAddress);

    const { networkPassphrase } = this.configService.get('stellar', { infer: true });
    const transaction = new StellarSdk.Transaction(signedTransactionXdr, networkPassphrase);

    const signedByWallet = transaction.signatures.some((sig) =>
      StellarSdk.Keypair.fromPublicKey(walletAddress).verify(
        transaction.hash(),
        sig.signature(),
      ),
    );
    if (!signedByWallet) {
      throw new UnauthorizedException('Challenge was not signed by the claimed wallet');
    }

    const user = await this.usersService.findOrCreateByWallet(walletAddress);
    const accessToken = this.jwtService.sign({ sub: user.id, walletAddress });

    return { accessToken, user };
  }
}
