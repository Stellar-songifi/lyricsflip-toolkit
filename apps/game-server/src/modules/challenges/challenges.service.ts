import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomInt } from 'crypto';
import { Challenge, ChallengeStatus } from './entities/challenge.entity';
import { GameService } from '../game/game.service';
import { GameMode } from '../game/entities/game-session.entity';
import { WagerService, WalletLinkService } from '@lyricsflip-toolkit/server';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I — easy to read aloud
const CODE_LENGTH = 6;
const CHALLENGE_TTL_MS = 15 * 60 * 1000;

export interface ChallengeSummary {
  code: string;
  status: ChallengeStatus;
  hostUserId: string;
  /** Stroops each player stakes, or null for an unstaked match. Shown before accepting. */
  stakeAmount: string | null;
  gameSessionId: string | null;
  wagerId: string | null;
  expiresAt: Date;
}

export interface AcceptChallengeResult {
  gameSessionId: string;
  wagerId: string | null;
}

@Injectable()
export class ChallengesService {
  constructor(
    @InjectRepository(Challenge)
    private readonly challengesRepository: Repository<Challenge>,
    private readonly gameService: GameService,
    private readonly wagerService: WagerService,
    private readonly walletLinks: WalletLinkService,
  ) {}

  async create(hostUserId: string, stakeAmount?: string): Promise<ChallengeSummary> {
    if (stakeAmount && !(await this.walletLinks.getAddress(hostUserId))) {
      throw new BadRequestException('Link a wallet before creating a staked challenge');
    }
    const code = await this.generateUniqueCode();

    const challenge = await this.challengesRepository.save(
      this.challengesRepository.create({
        code,
        hostUserId,
        stakeAmount: stakeAmount ?? null,
        status: ChallengeStatus.PENDING,
        expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
      }),
    );

    return this.toSummary(challenge);
  }

  async getByCode(code: string): Promise<ChallengeSummary> {
    const challenge = await this.loadByCode(code);
    return this.toSummary(await this.expireIfDue(challenge));
  }

  /**
   * The joiner accepts the challenge — and, if it carries a stake, the wager
   * with it: the code shows the stake before they accept, and accepting is
   * their explicit agreement. Only then is the escrow pot opened and a stake
   * requested from either player.
   *
   * A staked session stays `waiting` until both stakes are confirmed; the
   * host discovers it by polling `getByCode`.
   */
  async accept(code: string, joinerUserId: string): Promise<AcceptChallengeResult> {
    const challenge = await this.expireIfDue(await this.loadByCode(code));

    if (challenge.status === ChallengeStatus.EXPIRED) {
      throw new BadRequestException('This challenge has expired');
    }
    if (challenge.status === ChallengeStatus.ACCEPTED) {
      throw new BadRequestException('This challenge has already been accepted');
    }
    if (challenge.hostUserId === joinerUserId) {
      throw new BadRequestException("You can't accept your own challenge");
    }
    if (challenge.stakeAmount && !(await this.walletLinks.getAddress(joinerUserId))) {
      throw new BadRequestException('Link a wallet before accepting a staked challenge');
    }

    // Claim the challenge first so two joiners can't both accept it.
    const claimed = await this.challengesRepository.update(
      { id: challenge.id, status: ChallengeStatus.PENDING },
      { status: ChallengeStatus.ACCEPTED },
    );
    if (!claimed.affected) {
      throw new BadRequestException('This challenge has already been accepted');
    }

    const staked = Boolean(challenge.stakeAmount);
    const session = await this.gameService.createSession(challenge.hostUserId, GameMode.HEAD_TO_HEAD, {
      waitForStakes: staked,
    });
    await this.gameService.joinSession(session.id, joinerUserId);

    let wagerId: string | null = null;
    if (staked) {
      const wager = await this.wagerService.create({
        matchId: session.id,
        playerAId: challenge.hostUserId,
        playerBId: joinerUserId,
        stakeAmount: challenge.stakeAmount as string,
      });
      wagerId = wager.id;
      await this.wagerService.accept(wager.id, joinerUserId);
    }

    await this.challengesRepository.update(
      { id: challenge.id },
      { gameSessionId: session.id, wagerId },
    );

    return { gameSessionId: session.id, wagerId };
  }

  private async generateUniqueCode(): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = Array.from({ length: CODE_LENGTH }, () =>
        CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
      ).join('');
      const existing = await this.challengesRepository.findOne({ where: { code } });
      if (!existing) return code;
    }
    throw new Error('Could not generate a unique challenge code');
  }

  private async loadByCode(code: string): Promise<Challenge> {
    const challenge = await this.challengesRepository.findOne({
      where: { code: code.toUpperCase() },
    });
    if (!challenge) {
      throw new NotFoundException(`No challenge found for code ${code}`);
    }
    return challenge;
  }

  private async expireIfDue(challenge: Challenge): Promise<Challenge> {
    if (challenge.status === ChallengeStatus.PENDING && challenge.expiresAt < new Date()) {
      challenge.status = ChallengeStatus.EXPIRED;
      return this.challengesRepository.save(challenge);
    }
    return challenge;
  }

  private toSummary(challenge: Challenge): ChallengeSummary {
    return {
      code: challenge.code,
      status: challenge.status,
      hostUserId: challenge.hostUserId,
      stakeAmount: challenge.stakeAmount,
      gameSessionId: challenge.gameSessionId,
      wagerId: challenge.wagerId,
      expiresAt: challenge.expiresAt,
    };
  }
}
