import { Asset, Keypair, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { SorobanRpc } from '@lyricsflip-toolkit/sdk';
import type { Api } from './api';
import { assertTestNetwork } from './config';

/**
 * Gets the free test stake token: trusts the asset from the device wallet
 * (skipped if it already does), then asks the server's faucet for a payment.
 */
export async function getTestTokens(api: Api, wallet: Keypair): Promise<string> {
  const info = await api.faucet.info();
  if (!info.enabled || !info.asset || !info.rpcUrl || !info.networkPassphrase) {
    throw new Error('Test tokens are not available on this server (it may be in mock mode)');
  }
  assertTestNetwork(info.networkPassphrase);
  const [code, issuer] = info.asset.split(':');
  const asset = new Asset(code, issuer);

  const rpc = new SorobanRpc({ rpcUrl: info.rpcUrl, networkPassphrase: info.networkPassphrase });
  const account = await rpc.server.getAccount(wallet.publicKey());
  const trust = new TransactionBuilder(account, { fee: '1000', networkPassphrase: info.networkPassphrase })
    .addOperation(Operation.changeTrust({ asset }))
    .setTimeout(60)
    .build();
  // changeTrust is a no-op if the trustline already exists.
  const trusted = await rpc.signAndSubmit(trust, [wallet]);
  if (trusted.status === 'failed') throw new Error(`Could not trust ${code}: ${trusted.error}`);

  const { amount } = await api.faucet.claim();
  return `${amount} ${code}`;
}
