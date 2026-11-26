#!/usr/bin/env node
'use strict';

/**
 * Pre-provision JWTs for a staging-like run. k6 cannot sign the SEP-10
 * challenge itself, so this Node helper creates fresh Stellar wallets, signs
 * each challenge with @stellar/stellar-sdk and writes one access token per
 * line. Load them with `LOAD_TOKEN_FILE=load/tokens.txt`.
 */

const fs = require('node:fs');

let Keypair;
let TransactionBuilder;
try {
  ({ Keypair, TransactionBuilder } = require('@stellar/stellar-sdk'));
} catch (error) {
  console.error(
    'This helper needs the workspace dependency @stellar/stellar-sdk. Run `npm ci` first.',
  );
  process.exit(2);
}

const argv = process.argv.slice(2);
function arg(name, fallback) {
  const flag = `--${name}`;
  const index = argv.indexOf(flag);
  if (index === -1) return fallback;
  return argv[index + 1] || fallback;
}

const baseUrl = String(arg('base-url', process.env.BASE_URL || 'http://127.0.0.1:3001')).replace(/\/+$/, '');
const count = Number.parseInt(arg('count', process.env.LOAD_TOKEN_COUNT || '20'), 10);
const output = arg('out', process.env.LOAD_TOKEN_FILE || 'load/tokens.txt');

async function postJson(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch (_) {
    // Let the status check below report the bad response.
  }
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${text}`);
  }
  return parsed;
}

async function main() {
  if (!Number.isFinite(count) || count < 2) {
    throw new Error('Provision at least two tokens; head-to-head needs a host and a guest.');
  }

  const tokens = [];
  for (let index = 0; index < count; index += 1) {
    const wallet = Keypair.random();
    const challenge = await postJson('/auth/stellar/challenge', {
      walletAddress: wallet.publicKey(),
    });
    const transaction = TransactionBuilder.fromXDR(
      challenge.transactionXdr,
      challenge.networkPassphrase,
    );
    transaction.sign(wallet);
    const verified = await postJson('/auth/stellar/verify', {
      walletAddress: wallet.publicKey(),
      signedTransactionXdr: transaction.toXDR(),
    });
    if (!verified.accessToken) throw new Error('Verify response did not include an accessToken');
    tokens.push(verified.accessToken);
  }

  fs.writeFileSync(output, `${tokens.join('\n')}\n`, { mode: 0o600 });
  console.log(`Wrote ${tokens.length} tokens to ${output} (mode 0600).`);
}

main().catch((error) => {
  console.error(`Token provisioning failed: ${error.message}`);
  process.exit(1);
});
