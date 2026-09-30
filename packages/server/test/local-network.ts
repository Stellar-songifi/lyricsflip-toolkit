import {
  Address,
  Asset,
  Keypair,
  Operation,
  Transaction,
  TransactionBuilder,
  rpc,
  scValToNative,
} from '@stellar/stellar-sdk';
import { randomBytes } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Deploys `pvp-escrow` and a stake token to a local Stellar network
 * (`stellar/quickstart --local`). Integration tests only; refuses anything
 * but a local or test network.
 */
export const LOCAL = {
  rpcUrl: process.env.STELLAR_INTEGRATION_RPC_URL ?? 'http://localhost:8000/rpc',
  friendbotUrl: process.env.STELLAR_INTEGRATION_FRIENDBOT_URL ?? 'http://localhost:8000/friendbot',
  networkPassphrase:
    process.env.STELLAR_INTEGRATION_PASSPHRASE ?? 'Standalone Network ; February 2017',
};

if (LOCAL.networkPassphrase.startsWith('Public Global Stellar Network')) {
  throw new Error('Integration tests must never run against mainnet');
}

export const WASM_PATH =
  process.env.PVP_ESCROW_WASM ??
  resolve(__dirname, '../../../contracts/target/wasm32v1-none/release/pvp_escrow.wasm');

export interface Deployment {
  server: rpc.Server;
  admin: Keypair;
  resolver: Keypair;
  issuer: Keypair;
  asset: Asset;
  tokenContractId: string;
  escrowContractId: string;
}

export async function fund(...keypairs: Keypair[]): Promise<void> {
  await Promise.all(
    keypairs.map(async (kp) => {
      const res = await fetch(`${LOCAL.friendbotUrl}?addr=${kp.publicKey()}`);
      if (!res.ok) throw new Error(`Friendbot failed for ${kp.publicKey()}: ${res.status}`);
    }),
  );
}

async function submit(server: rpc.Server, tx: Transaction, signers: Keypair[]): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
  for (const s of signers) tx.sign(s);
  const sent = await server.sendTransaction(tx);
  if (sent.status === 'ERROR') throw new Error(`Rejected: ${sent.errorResult?.toXDR('base64')}`);
  const result = await server.pollTransaction(sent.hash, { attempts: 30 });
  if (result.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`Transaction ${sent.hash} ended as ${result.status}`);
  }
  return result as rpc.Api.GetSuccessfulTransactionResponse;
}

async function classic(server: rpc.Server, source: Keypair, ops: ReturnType<typeof Operation.payment>[], signers = [source]) {
  const account = await server.getAccount(source.publicKey());
  const builder = new TransactionBuilder(account, { fee: '1000', networkPassphrase: LOCAL.networkPassphrase });
  ops.forEach((op) => builder.addOperation(op));
  return submit(server, builder.setTimeout(60).build(), signers);
}

async function soroban(server: rpc.Server, source: Keypair, op: ReturnType<typeof Operation.invokeHostFunction>) {
  const account = await server.getAccount(source.publicKey());
  const tx = new TransactionBuilder(account, { fee: '100000', networkPassphrase: LOCAL.networkPassphrase })
    .addOperation(op)
    .setTimeout(60)
    .build();
  return submit(server, await server.prepareTransaction(tx), [source]);
}

/** Gives `players` a trustline to the stake asset and `amount` of it. */
export async function giveTokens(d: Deployment, players: Keypair[], amount: string): Promise<void> {
  for (const player of players) {
    await classic(d.server, player, [Operation.changeTrust({ asset: d.asset })]);
  }
  await classic(
    d.server,
    d.issuer,
    players.map((p) => Operation.payment({ destination: p.publicKey(), asset: d.asset, amount })),
  );
}

export async function tokenBalance(d: Deployment, address: string): Promise<bigint> {
  const account = await d.server.getAccount(d.admin.publicKey());
  const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase: LOCAL.networkPassphrase })
    .addOperation(
      Operation.invokeContractFunction({
        contract: d.tokenContractId,
        function: 'balance',
        args: [new Address(address).toScVal()],
      }),
    )
    .setTimeout(60)
    .build();
  const sim = await d.server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) throw new Error('balance read failed');
  return BigInt(scValToNative(sim.result.retval));
}

export async function latestLedger(server: rpc.Server): Promise<number> {
  return (await server.getLatestLedger()).sequence;
}

export async function deploy(): Promise<Deployment> {
  if (!existsSync(WASM_PATH)) {
    throw new Error(`Build the contract first: cd contracts && stellar contract build (${WASM_PATH} is missing)`);
  }
  const server = new rpc.Server(LOCAL.rpcUrl, { allowHttp: true });
  const admin = Keypair.random();
  const resolver = Keypair.random();
  const issuer = Keypair.random();
  await fund(admin, resolver, issuer);

  const asset = new Asset('STAKE', issuer.publicKey());
  await soroban(server, issuer, Operation.createStellarAssetContract({ asset }));
  const tokenContractId = asset.contractId(LOCAL.networkPassphrase);

  const upload = await soroban(server, admin, Operation.uploadContractWasm({ wasm: readFileSync(WASM_PATH) }));
  const wasmHash = Buffer.from(scValToNative(upload.returnValue!));

  const created = await soroban(
    server,
    admin,
    Operation.createCustomContract({
      address: new Address(admin.publicKey()),
      wasmHash,
      salt: randomBytes(32),
      constructorArgs: [
        new Address(admin.publicKey()).toScVal(),
        new Address(resolver.publicKey()).toScVal(),
        new Address(tokenContractId).toScVal(),
      ],
    }),
  );
  const escrowContractId = Address.fromScVal(created.returnValue!).toString();

  return { server, admin, resolver, issuer, asset, tokenContractId, escrowContractId };
}
