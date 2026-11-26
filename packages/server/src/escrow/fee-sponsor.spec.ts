import { BadRequestException, Logger } from '@nestjs/common';
import { Account, Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import { randomUUID } from 'crypto';
import { addressToScVal, potIdToScVal } from '@lyricsflip-toolkit/sdk';
import { Contract } from '@stellar/stellar-sdk';
import { FeeSponsor } from './fee-sponsor';
import { StellarEscrowGateway } from './stellar-escrow.gateway';

const ESCROW = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

describe('FeeSponsor limits (#60)', () => {
  it('caps the fee per stake, the stakes per player and the daily budget', () => {
    let now = Date.parse('2026-11-26T10:00:00Z');
    const sponsor = new FeeSponsor(
      Keypair.random().secret(),
      { maxFeePerStakeStroops: 1_000, dailyBudgetStroops: 2_500, maxStakesPerPlayerPerDay: 2 },
      () => now,
    );
    expect(() => sponsor.reserve('alice', 1_001n)).toThrow(/above the sponsored maximum/);
    sponsor.reserve('alice', 1_000n);
    sponsor.reserve('alice', 1_000n);
    expect(() => sponsor.reserve('alice', 10n)).toThrow(/sponsored stakes for today/);
    expect(() => sponsor.reserve('bob', 600n)).toThrow(/budget is used up/);
    sponsor.reserve('bob', 500n);

    now = Date.parse('2026-11-27T00:00:01Z'); // a new UTC day resets everything
    sponsor.reserve('alice', 1_000n);
  });
});

describe('StellarEscrowGateway fee-bump sponsorship (#60)', () => {
  const sponsorKey = Keypair.random();
  const player = Keypair.random();
  let gateway: StellarEscrowGateway;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    gateway = new StellarEscrowGateway({
      mode: 'stellar',
      authenticate: () => null,
      stellar: {
        network: 'testnet',
        rpcUrl: 'https://soroban-testnet.stellar.org',
        networkPassphrase: Networks.TESTNET,
        escrowContractId: ESCROW,
        tokenContractId: 'CTOKEN',
        resolverSecret: Keypair.random().secret(),
        feeSponsorSecret: sponsorKey.secret(),
      },
    });
  });
  afterEach(() => jest.restoreAllMocks());

  function signedStake(potId: string, fn = 'stake') {
    const tx = new TransactionBuilder(new Account(player.publicKey(), '7'), {
      fee: '50000',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(new Contract(ESCROW).call(fn, potIdToScVal(potId), addressToScVal(player.publicKey())))
      .setTimeout(60)
      .build();
    tx.sign(player);
    return tx.toXDR();
  }

  it('wraps the checked stake in a fee-bump paid by the sponsor', async () => {
    const potId = randomUUID();
    const submit = jest
      .spyOn(gateway.client.rpc, 'submit')
      .mockResolvedValue({ status: 'confirmed', hash: 'h', ledger: 3 });

    const outcome = await gateway.submitStake(potId, player.publicKey(), 'player-1', signedStake(potId));

    expect(outcome.status).toBe('confirmed');
    const sent: any = submit.mock.calls[0][0];
    expect(sent.feeSource).toBe(sponsorKey.publicKey());
    expect(sent.innerTransaction.source).toBe(player.publicKey());
    expect(sent.signatures).toHaveLength(1);
  });

  it('still refuses an envelope that is not this stake (the inner tx is checked)', async () => {
    const potId = randomUUID();
    const submit = jest.spyOn(gateway.client.rpc, 'submit');
    await expect(
      gateway.submitStake(potId, player.publicKey(), 'player-1', signedStake(potId, 'claim_refund')),
    ).rejects.toThrow(BadRequestException);
    expect(submit).not.toHaveBeenCalled();
  });

  it('refuses a client-built fee-bump envelope', async () => {
    const potId = randomUUID();
    const inner = TransactionBuilder.fromXDR(signedStake(potId), Networks.TESTNET) as any;
    const attacker = Keypair.random();
    const bump = TransactionBuilder.buildFeeBumpTransaction(attacker, '50000', inner, Networks.TESTNET);
    bump.sign(attacker);
    await expect(
      gateway.submitStake(potId, player.publicKey(), 'player-1', bump.toXDR()),
    ).rejects.toThrow('Not a valid signed transaction envelope');
  });
});
