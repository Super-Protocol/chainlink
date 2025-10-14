# Verification Guide

This guide explains how to verify the Chainlink image using the resource manifest.

- Resource file: [verification/resource.json](resource.json)
  - Contains the `orderId` and the expected image hash.

## Clone the repository

If you haven't already, clone this repository and navigate into it:

```bash
git clone https://github.com/Super-Protocol/chainlink.git
cd chainlink
```

## Quick automated verification (script)

Use the helper script to perform all steps automatically. It will download the latest spctl, create `config.json`, download the image if missing, calculate SHA‑256, fetch the order report, and compare the three hashes.

```bash
cd verification
chmod +x ./verify.sh
./verify.sh ./resource.json
```

Example output:

```
==> Hashes summary
    resource.json: <hash>
    local shasum : <hash>
    order report : <hash>
Validation result: OK
```

If hashes don't match, the script exits non‑zero and prints:

```
Validation result: FAIL
```

## Manual step-by-step verification

### Prerequisites

Install Super Protocol [CLI (spctl)](https://docs.superprotocol.com/cli/). You will also need `jq` for reading values from JSON.

### Step 1 — Download the resource and image

Download the Chainlink all‑in‑one image using [verification/resource.json](resource.json) with [spctl files download](https://docs.superprotocol.com/cli/commands/files/download):

```bash
spctl files download resource.json .
```

This command downloads the image tarball to your current directory.

### Step 2 — Calculate the image SHA‑256 locally (optional but recommended)

Compute the SHA‑256 checksum of the downloaded tarball and compare it with `hash.hash` in [verification/resource.json](resource.json).

```bash
shasum -a 256 <downloaded-image.tar.gz>
```

Ensure the printed hash equals the value in `resource.json` at `hash.hash`.

### Step 3 — Verify the order attestation (workload report)

Use `spctl` to fetch and verify the report for the order specified in `resource.json`. This command verifies the TEE certificate chain and prints `workloadInfo` with the order parameters, including the image hash.

```bash
ORDER_ID=$(jq -r .orderId resource.json)
spctl orders get-report "$ORDER_ID"
```

The image hash shown in the report’s `workloadInfo` must match the hash in `resource.json` (and the SHA‑256 value if you computed it). This confirms the workload for the order is running the exact image in TEE corresponding to that hash.

### Expected outcomes

- The SHA‑256 checksum printed by `shasum` equals the `hash.hash` value in `resource.json`.
- The `workloadInfo` section in the order report includes the same image hash.
