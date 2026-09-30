import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomInt } from 'crypto';
import { Challenge, ChallengeStatus } from './entities/challenge.entity';
import { GameService } from '../game/game.service';
import { GameMode } from '../game/entities/game-session.entity';
import { WagerService } from '../wager/wager.service';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I — easy to read aloud
const CODE_LENGTH = 6;
const CHALLENGE_TTL_MS = 15 * 60 * 1000;

export interface ChallengeSummary {
  code: string;
  status: ChallengeStatus;
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
  ) {}

  async create(hostUserId: string, stakeAmount?: string): Promise<ChallengeSummary> {
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
   * Creates the head-to-head session (and, if the challenge carried a
   * stake, the wager) and marks the challenge accepted. The host discovers
   * the resulting session by polling `getByCode`.
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

    const session = await this.gameService.createSession(challenge.hostUserId, GameMode.HEAD_TO_HEAD);
    await this.gameService.joinSession(session.id, joinerUserId);

    let wagerId: string | null = null;
    if (challenge.stakeAmount) {
      const { wager } = await this.wagerService.createWager(
        session.id,
        challenge.hostUserId,
        joinerUserId,
        challenge.stakeAmount,
      );
      wagerId = wager.id;
    }

    challenge.status = ChallengeStatus.ACCEPTED;
    challenge.gameSessionId = session.id;
    challenge.wagerId = wagerId;
    await this.challengesRepository.save(challenge);

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
      gameSessionId: challenge.gameSessionId,
      wagerId: challenge.wagerId,
      expiresAt: challenge.expiresAt,
    };
  }
}
