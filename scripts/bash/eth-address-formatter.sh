#!/usr/bin/env bash

cd $(dirname $0)

set -euo pipefail

# Usage: eth-address-formatter.sh <hex_address>
# Prints EIP55 checksummed address to stdout. Exits non-zero on error.

addr_input="${1:-}"
if [[ -z "$addr_input" ]]; then
  echo "" >&2
  exit 1
fi

if [[ "$addr_input" != 0x* ]]; then
  addr_input="0x${addr_input}"
fi

# Use ethers (installed for secrets scripts) to compute EIP55 checksum
cd ./secrets 2>/dev/null || true
node -e '
  const { ethers } = require("ethers");
  const a = process.argv[1];
  try {
    console.log(ethers.getAddress(a));
  } catch (e) {
    process.exit(1);
  }
' "$addr_input"
