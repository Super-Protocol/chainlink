# Verification Guide

This guide explains how to verify that the Chainlink image used in a specific order is authentic and matches the expected artifact.

- Target order to verify: 255204
- Marketplace order link: https://marketplace.superprotocol.com/order/255204
- Resource manifest file: `verification/resource.json`

## Prerequisites

Install Super Protocol [CLI (spctl)](https://docs.superprotocol.com/cli/)

## Step 1 — Download the resource manifest

Download the `resource.json` file using [spctl files download command](https://docs.superprotocol.com/cli/commands/files/download) (optional if you already have the file from this repo):

```bash
spctl files download resource.json .
```

This manifest contains the expected SHA-256 hash of the image.

## Step 2 — Calculate the image SHA-256 locally (optional)

If you have downloaded the image tarball, compute its SHA-256 checksum and compare it with the hash in `resource.json`.

- Expected image file name (from resource.json): `chainlink-all-in-one-image-mainnet-b18473545264.tar.gz`

Compute SHA-256:

```bash
shasum -a 256 chainlink-all-in-one-image-mainnet-b18473545264.tar.gz
```

Compare the resulting hash with `hash.hash` from `resource.json`.

## Step 3 — Verify the order attestation (workload report)

Use `spctl` to fetch and verify the report for order [255204](https://marketplace.superprotocol.com/order/255204). This command verifies the [TEE certificate chain](https://www.youtube.com/watch?v=aXotdTZ8oSc) and prints `workloadInfo` with the order parameters, including the image hash.

```bash
spctl orders get-report 255204
```

- The image hash shown in the report’s `workloadInfo` must match the hash in `resource.json` (and the `shasum` value if you computed it).
- The report guarantees that the workload for order 255204 is running the exact image in TEE corresponding to that hash.

## Expected outcomes

- The SHA-256 checksum printed by `shasum` equals the `hash.hash` value in `resource.json`.
- The `workloadInfo` section in the order report includes the same image hash.
