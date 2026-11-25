# Resolver key: sources and rotation

The game server signs `open_pot`, `resolve` and `refund` with the resolver key.
`STELLAR_RESOLVER_SECRET_SOURCE` chooses where that key comes from:

| Source | Settings | Rotation |
|---|---|---|
| `env` (default) | `STELLAR_RESOLVER_SECRET` | needs a restart; the toolkit warns about this outside local |
| `file` | `STELLAR_RESOLVER_SECRET_FILE` | file re-read after the cache TTL |
| `vault` | `VAULT_ADDR`, `VAULT_TOKEN`, `STELLAR_RESOLVER_SECRET_VAULT_PATH` (+ `_MOUNT`, default `secret`; `_FIELD`, default `secret`) | KV v2 secret re-read after the cache TTL |
| `aws-secrets-manager` | `STELLAR_RESOLVER_SECRET_AWS_ID`, `AWS_REGION` (+ `STELLAR_RESOLVER_SECRET_AWS_JSON_KEY` for a JSON secret) | secret re-read after the cache TTL; install `@aws-sdk/client-secrets-manager` |

For every source except `env`, the toolkit caches the key for
`STELLAR_RESOLVER_SECRET_CACHE_TTL_MS` (default 60,000) and re-reads it after
that. A value that isn't a Stellar secret seed (`S…`) is refused.

With Kubernetes, mount the secret as a file and use `file`: the kubelet
updates the mounted file when the Secret changes, and the server picks it up
within the TTL.

## Rotating the resolver key

The on-chain contract only accepts the resolver stored in its config, so the
server key and the contract must change together. Expect a short window
(at most the cache TTL) in which settlements fail and are retried by the
reconciler — nothing is lost.

1. **Create the new key** and fund its account (it pays fees):

   ```sh
   stellar keys generate resolver-2 --network testnet --fund
   stellar keys address resolver-2          # G... — the new resolver address
   ```

2. **Store it in the secrets manager** under the configured path (update the
   mounted Secret, the Vault field or the AWS secret). The server keeps using
   the old key until its cache expires.

3. **Switch the contract to the new key** with the admin (a multisig on
   mainnet):

   ```sh
   stellar contract invoke --id "$STELLAR_ESCROW_CONTRACT_ID" --source-account admin --network testnet \
     -- set_resolver --resolver "$(stellar keys address resolver-2)"
   ```

4. **Confirm** within `STELLAR_RESOLVER_SECRET_CACHE_TTL_MS` that the server
   signs with the new key and that it matches the contract:

   ```sh
   curl -H "Authorization: Bearer $TOKEN" https://<game-server>/wager/resolver-address
   stellar contract invoke --id "$STELLAR_ESCROW_CONTRACT_ID" --network testnet -- get_config
   ```

   Both must show the new `G…` address.

5. **Retire the old key**: remove it from the secrets manager and, once
   no settlement is pending, merge its account away.

If the old key may be compromised, do step 3 first: from that moment the
contract refuses the old key, and the server catches up within the TTL.
