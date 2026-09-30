#!/usr/bin/env bash
# Builds and deploys pvp-escrow to a test network.
#
#   NETWORK=testnet ADMIN=<identity> RESOLVER=<G...> TOKEN=<C...> \
#     contracts/scripts/deploy-pvp-escrow.sh
#
# ADMIN is a Stellar CLI identity (it signs the deploy and the constructor).
# RESOLVER is the public key the game server signs with. TOKEN is the stake
# token's contract ID. Mainnet is refused: this toolkit has not been audited.
set -euo pipefail

NETWORK="${NETWORK:-testnet}"
case "$NETWORK" in
  testnet | local | futurenet) ;;
  *)
    echo "Refusing to deploy to '$NETWORK'. Only testnet, local and futurenet are allowed." >&2
    exit 1
    ;;
esac

: "${ADMIN:?set ADMIN to a stellar CLI identity}"
: "${RESOLVER:?set RESOLVER to the resolver public key}"
: "${TOKEN:?set TOKEN to the stake token contract ID}"

cd "$(dirname "$0")/.."
stellar contract build --package pvp-escrow

stellar contract deploy \
  --wasm target/wasm32v1-none/release/pvp_escrow.wasm \
  --source "$ADMIN" \
  --network "$NETWORK" \
  -- \
  --admin "$(stellar keys address "$ADMIN")" \
  --resolver "$RESOLVER" \
  --token "$TOKEN"
