<div align="center">
  <a href="https://aztec.network">
    <img src="https://cdn.prod.website-files.com/6847005bc403085c1aa846e0/6847514dc37a9e8cfe8a66b8_aztec-logo.svg" alt="Aztec Protocol Logo" width="300">
  </a>
</div>

# FireFlow Overcast

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![CI](https://github.com/Galactica-corp/fireflow-overcast/actions/workflows/ci.yml/badge.svg)](https://github.com/Galactica-corp/fireflow-overcast/actions/workflows/ci.yml)

FireFlow graph nodes for **Overcast** — private stablecoin payments on the **Aztec** blockchain.

This repository is the Apache 2.0 public release of `@persistent-ai/fireflow-overcast`, developed by [PersistentAI](https://github.com/Persistent-AI) under an Aztec grant. It is hosted alongside the other Overcast protocol repositories ([aztec-x402](https://github.com/Galactica-corp/aztec-x402), [aztec-zkkyc](https://github.com/Galactica-corp/aztec-zkkyc)).

The nodes run inside [FireFlow](https://github.com/Persistent-AI/fireflow), a flow-based programming engine. **This snapshot does not include the engine.** `@persistent-ai/fireflow-types` is a required peer dependency and is not published here. Typecheck, unit tests, and builds need a FireFlow checkout. Canonical development continues in FireFlow until that repository is public.

## What this package is

Atomic FireFlow graph nodes that let an AI agent execute private stablecoin payments using the Overcast protocol on Aztec. Each node is a single operation with defined inputs and outputs, composable into larger payment flows.

See [docs/specification.md](docs/specification.md) for the full node roadmap.

## Nodes

| Node | Description |
|------|-------------|
| **Aztec Ensure Account** | Get-or-create the caller's `aztec-account` vault secret and `.ffsecret` pointer; output `AztecAccountRef` |
| **Aztec Account Signer** | Assemble an `AztecSignerRef` from an `AztecAccountRef` (no vault / PXE I/O) |
| **Parse Contract Artifact** | Validate a VFS artifact JSON file and emit an `AztecArtifactRef` |
| **Aztec Smart Contract** | Bind a deployed contract address to an `AztecArtifactRef` |
| **Get Fee Payer** | Assemble an `AztecFeePayerRef` (fee juice or sponsored FPC) |
| **Aztec Transaction Builder** | Assemble an `AztecTxRequestRef` for simulation or submission |
| **Simulate Transaction** | Resolve the request and locally simulate (read methods) |
| **Submit Aztec Transaction** | Resolve the request and submit to the network |
| **Parse x402 Challenge** | Parse an HTTP 402 challenge into settlement parameters |
| **Build x402 Payment Header** | Assemble the signed x402 payment payload |
| **Request x402 Resource** | Request a paid resource and settle via the Overcast x402 flow |

### Agent wallet onboarding

`Aztec Ensure Account` get-or-creates the end user's Aztec credentials during a conversation: found-branch when the pointer already exists, mint when it does not. Output is a public `AztecAccountRef` — no secret ports. `Aztec Account Signer` takes that ref and assembles an `AztecSignerRef`; Simulate / Submit / x402 rehydrate the live wallet via `resolveSigner`. See [docs/specification.md](docs/specification.md) §5.1 and §5.1.1.

## Aztec version

Pinned to **`@aztec/* 5.0.1`**, matching the version the public testnet and mainnet run. The AIP-20 token comes from `@aztec-foundation/aztec-standards@5.0.1`.

- **Every account address changes across SDK majors, and old accounts are unusable.** v5 reworked the key hierarchy, added `immutablesHash` to address derivation, and switched Schnorr to Poseidon2.
- **The signing key is required.** It lives inside the `aztec-account` vault secret that **Aztec Ensure Account** writes. Flows must not pass a signing key (or any account scalar) on a port.
- **Accounts are initializerless Schnorr.** Sandbox genesis accounts use `createSchnorrInitializerlessAccount`.

> The token's `constructor_with_minter` takes an `auth_contract` argument. Pass `AztecAddress.ZERO` to disable it. It is the token's own authorization hook, **not** the standard auth registry.

## Using this package with FireFlow

This package is a FireFlow node library. To typecheck, test, or execute the nodes you need FireFlow's types package on disk:

```bash
# clone this repo and FireFlow as siblings
git clone https://github.com/Galactica-corp/fireflow-overcast.git
# FireFlow is not yet public; use a local checkout you already have
# git clone <fireflow-url> fireflow

cd fireflow-overcast
```

Point pnpm at the local FireFlow types package in `package.json`:

```json
{
  "pnpm": {
    "overrides": {
      "@persistent-ai/fireflow-types": "link:../fireflow/packages/fireflow-types"
    }
  }
}
```

Then:

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

Until FireFlow is public, the honest path is to develop inside the FireFlow monorepo (`packages/fireflow-overcast`) and refresh this snapshot for each Apache release.

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `AZTEC_NODE_URL` | `http://localhost:8080` | Aztec node RPC endpoint |

Copy [`.env.example`](.env.example) to `.env` for local sandbox work.

## Development

Requires **Node.js 24+** and **pnpm 11**.

```bash
pnpm build
pnpm test
pnpm typecheck
```

### Integration tests

Requires a local Aztec sandbox at `http://localhost:8080`:

```bash
pnpm test:integration
```

### Testnet account measurement (opt-in)

```bash
pnpm measure:testnet-account
```

### Local fixtures

Deploy local Aztec fixtures (accounts, Sponsored FPC, Token contract, Alice mint):

```bash
pnpm deploy:local
pnpm balances:local <address-from-deploy-output>
```

Optional environment overrides:

| Variable | Default | Description |
|----------|---------|-------------|
| `MINT_AMOUNT` | `1000` | Private tokens minted to Alice |
| `TOKEN_CONTRACT_ADDRESS` | _(CLI arg preferred)_ | Token contract from `deploy:local` output |

**Suggested test flow:** read Alice balance → transfer to Bob → read both balances. Wiring details are in [docs/specification.md](docs/specification.md).

## Exports

- `@persistent-ai/fireflow-overcast` — client-safe shared types
- `@persistent-ai/fireflow-overcast/nodes` — node registration (frontend)
- `@persistent-ai/fireflow-overcast/server` — server barrel (executor / worker)

## Related projects

- [Overcast](https://overcast.fi/) — private stablecoin on Aztec
- [aztec-x402](https://github.com/Galactica-corp/aztec-x402) — x402 payment protocol for Aztec
- [aztec-zkkyc](https://github.com/Galactica-corp/aztec-zkkyc) — ZK KYC by Galactica on Aztec
- [Aztec Network](https://aztec.network)

## License

Copyright 2026 PersistentAI.

Licensed under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for attribution.
