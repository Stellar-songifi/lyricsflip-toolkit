import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomInt } from 'crypto';
import { Challenge, ChallengeStatus } from './entities/challenge.entity';
import { GameService } from '../game/game.service';
import { GameMode } from '../game/entities/game-session.entity';
import { WagerService, WalletLinkService, fromStroops } from '@lyricsflip-toolkit/server';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { deepLink } from '../notifications/deep-links';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I — easy to read aloud
const CODE_LENGTH = 6;
const CHALLENGE_TTL_MS = 15 * 60 * 1000;
/** PostgreSQL SQLSTATE for a unique-constraint violation. */
const UNIQUE_VIOLATION = '23505';
/** One insert, plus a single retry on collision. */
const CODE_INSERT_ATTEMPTS = 2;

/** The columns `create` decides; `code` is generated per attempt instead. */
type NewChallenge = Pick<
  Challenge,
  'hostUserId' | 'stakeAmount' | 'invitedUserId' | 'status' | 'expiresAt'
>;

/**
 * PostgreSQL reports a unique-constraint violation as SQLSTATE 23505. TypeORM
 * wraps the driver error in a `QueryFailedError`, and which level carries the
 * code has moved between versions, so check both.
 */
function isUniqueViolation(err: unknown): boolean {
  const error = err as { code?: string; driverError?: { code?: string } } | null;
  return (error?.code ?? error?.driverError?.code) === UNIQUE_VIOLATION;
}

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
    private readonly users: UsersService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(hostUserId: string, stakeAmount?: string, opponentUsername?: string): Promise<ChallengeSummary> {
    const invited = opponentUsername ? await this.users.findByUsername(opponentUsername) : null;
    if (invited?.id === hostUserId) {
      throw new BadRequestException("You can't challenge yourself");
    }
    if (stakeAmount && !(await this.walletLinks.getAddress(hostUserId))) {
      throw new BadRequestException('Link a wallet before creating a staked challenge');
    }

    const challenge = await this.insertWithUniqueCode({
      hostUserId,
      stakeAmount: stakeAmount ?? null,
      invitedUserId: invited?.id ?? null,
      status: ChallengeStatus.PENDING,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    });

    if (invited) {
      const host = await this.users.findById(hostUserId);
      const stake = stakeAmount ? ` for ${fromStroops(stakeAmount)}` : '';
      await this.notifications.push(
        invited.id,
        'challenge.invite',
        `${host.username} challenged you${stake}. Code ${challenge.code}.`,
        { url: deepLink.challenge(challenge.code), code: challenge.code },
      );
    }

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
    if (challenge.invitedUserId && challenge.invitedUserId !== joinerUserId) {
      throw new BadRequestException('This challenge was sent to someone else');
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

  /**
   * Inserts a row whose `code` is unique, letting the database decide.
   *
   * A "read to check the code is free, then insert" loop is not atomic: two
   * requests can both see the same code as free and both try to insert it, so
   * the check proves nothing about the insert. `UQ_challenges_code` is what
   * actually serialises them, so we generate a code, insert, and treat a
   * unique violation as "someone beat us to it, try once more".
   *
   * Anything that is not a unique violation is a real failure and propagates
   * untouched; two collisions in a row (vanishingly unlikely at 6 characters
   * over a 32-symbol alphabet) surface as a 500 rather than a plain `Error`.
   */
  private async insertWithUniqueCode(input: NewChallenge): Promise<Challenge> {
    for (let attempt = 0; attempt < CODE_INSERT_ATTEMPTS; attempt++) {
      const challenge = this.challengesRepository.create({
        ...input,
        code: this.randomCode(),
      });
      try {
        return await this.challengesRepository.save(challenge);
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    throw new InternalServerErrorException('Could not generate a unique challenge code');
  }

  private randomCode(): string {
    return Array.from(
      { length: CODE_LENGTH },
      () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
    ).join('');
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
