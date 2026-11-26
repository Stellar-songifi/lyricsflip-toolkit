import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Sep10Service, WalletLinkService } from '@lyricsflip-toolkit/server';
import { createHash, randomBytes } from 'crypto';
import { UsersService } from '../users/users.service';

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface RefreshTokenRecord {
  tokenHash: string;
  userId: string;
  familyId: string;
  expiresAt: number;
  revoked: boolean;
}

/**
 * Sign-in with a Stellar wallet, via the toolkit's SEP-10 service. The
 * verified wallet becomes the user's identity and their linked wallet for
 * wagers.
 *
 * Access tokens are short-lived; refresh tokens are opaque, stored hashed,
 * and rotated on every use. Reusing a rotated token revokes its whole family.
 */
@Injectable()
export class AuthService {
  private readonly refreshTokens = new Map<string, RefreshTokenRecord>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
    private readonly sep10: Sep10Service,
    private readonly walletLinks: WalletLinkService,
  ) {}

  getChallenge(walletAddress: string) {
    return this.sep10.buildChallenge(walletAddress);
  }

  async verify(walletAddress: string, signedTransactionXdr: string) {
    const address = await this.sep10.verify(walletAddress, signedTransactionXdr);
    const user = await this.usersService.findOrCreateByWallet(address);
    await this.walletLinks.link(user.id, address);
    const accessToken = this.signAccessToken(user.id, address, user.tokenVersion ?? 0);
    const refreshToken = this.issueRefreshToken(user.id, randomBytes(16).toString('hex'));
    return { accessToken, refreshToken, user };
  }

  async refresh(refreshToken: string) {
    const tokenHash = this.hashToken(refreshToken);
    const record = this.refreshTokens.get(tokenHash);
    if (!record || record.revoked || record.expiresAt < Date.now()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.usersService.findById(record.userId);
    if (!user) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Rotate: revoke the presented token and issue a new one in the same family.
    record.revoked = true;
    const accessToken = this.signAccessToken(user.id, user.walletAddress, user.tokenVersion ?? 0);
    const newRefreshToken = this.issueRefreshToken(user.id, record.familyId);
    return { accessToken, refreshToken: newRefreshToken, user };
  }

  async logout(refreshToken: string) {
    const record = this.refreshTokens.get(this.hashToken(refreshToken));
    if (record) {
      record.revoked = true;
    }
    return { success: true };
  }

  private signAccessToken(userId: string, walletAddress: string, tokenVersion: number) {
    return this.jwtService.sign(
      { sub: userId, walletAddress, tokenVersion },
      { expiresIn: ACCESS_TOKEN_TTL },
    );
  }

  private issueRefreshToken(userId: string, familyId: string) {
    const token = randomBytes(32).toString('hex');
    this.refreshTokens.set(this.hashToken(token), {
      tokenHash: this.hashToken(token),
      userId,
      familyId,
      expiresAt: Date.now() + REFRESH_TOKEN_TTL_MS,
      revoked: false,
    });
    return token;
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
}
