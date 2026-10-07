import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Sep10Service, WalletLinkService } from '@lyricsflip-toolkit/server';
import { UsersService } from '../users/users.service';

/**
 * Sign-in with a Stellar wallet, via the toolkit's SEP-10 service. The
 * verified wallet becomes the user's identity and their linked wallet for
 * wagers.
 */
@Injectable()
export class AuthService {
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
    const accessToken = this.jwtService.sign({ sub: user.id, walletAddress: address });
    return { accessToken, user };
  }
}
