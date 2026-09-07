# @persistent-ai/fireflow-overcast

## 0.30.1

### Patch Changes

- @persistent-ai/fireflow-types@0.30.1

## 0.30.0

### Patch Changes

- Updated dependencies [a161a47]
  - @persistent-ai/fireflow-types@0.30.0

## 0.29.4

### Patch Changes

- Updated dependencies [824f2f3]
  - @persistent-ai/fireflow-types@0.29.4

## 0.29.3

### Patch Changes

- @persistent-ai/fireflow-types@0.29.3

## 0.29.2

### Patch Changes

- Updated dependencies [73fce0c]
  - @persistent-ai/fireflow-types@0.29.2

## 0.29.1

### Patch Changes

- @persistent-ai/fireflow-types@0.29.1

## 0.29.0

### Patch Changes

- Updated dependencies
  - @persistent-ai/fireflow-types@0.29.0

## 0.28.0

### Patch Changes

- Updated dependencies
  - @persistent-ai/fireflow-types@0.28.0

## 0.27.1

### Patch Changes

- Updated dependencies
  - @persistent-ai/fireflow-types@0.27.1

## 0.27.0

### Patch Changes

- @persistent-ai/fireflow-types@0.27.0

## 0.26.2

### Patch Changes

- @persistent-ai/fireflow-types@0.26.2

## 0.26.1

### Patch Changes

- @persistent-ai/fireflow-types@0.26.1

## 0.26.0

### Patch Changes

- Updated dependencies [65c1638]
  - @persistent-ai/fireflow-types@0.26.0

## 0.25.3

### Patch Changes

- @persistent-ai/fireflow-types@0.25.3

## 0.25.2

### Patch Changes

- @persistent-ai/fireflow-types@0.25.2

## 0.25.1

### Patch Changes

- @persistent-ai/fireflow-types@0.25.1

## 0.25.0

### Patch Changes

- Updated dependencies [ace10d8]
  - @persistent-ai/fireflow-types@0.25.0

## 0.24.0

### Patch Changes

- @persistent-ai/fireflow-types@0.24.0

## 0.23.1

### Patch Changes

- Bump
- Updated dependencies
  - @persistent-ai/fireflow-types@0.23.1

## 0.23.0

### Minor Changes

- ae55994: Upgrade Aztec from 4.2.0 to 5.0.1, the version the public testnet and mainnet
  run.

  **Breaking for existing flows.** The Aztec Account Signer node's `Signing Key`
  port changes from optional to required: v5 made the signing key the root of the
  key hierarchy and removed `deriveSigningKey`, so it can no longer be derived
  from the account secret. Independently of that, v5 changes every account address
  and switched Schnorr to Poseidon2, so accounts deployed under v4 cannot be
  controlled by v5 code and must be redeployed.

  The AIP-20 token artifact now comes from `@aztec-foundation/aztec-standards`
  (the `aztec-standards` project moved to AztecProtocol; the old
  `@defi-wonderland` scope has no stable v5).

### Patch Changes

- @persistent-ai/fireflow-types@0.23.0

## 0.22.1

### Patch Changes

- @persistent-ai/fireflow-types@0.22.1

## 0.22.0

### Patch Changes

- Updated dependencies [8ac9c4a]
  - @persistent-ai/fireflow-types@0.22.0

## 0.21.11

### Patch Changes

- Updated dependencies
  - @persistent-ai/fireflow-types@0.21.11

## 0.21.10

### Patch Changes

- Updated dependencies [b648680]
  - @persistent-ai/fireflow-types@0.21.10

## 0.21.9

### Patch Changes

- Export terminal dock
- Updated dependencies
  - @persistent-ai/fireflow-types@0.21.9

## 0.21.8

### Patch Changes

- @persistent-ai/fireflow-types@0.21.8

## 0.21.7

### Patch Changes

- @persistent-ai/fireflow-types@0.21.7

## 0.21.6

### Patch Changes

- Fix the post-0.21.5 production crashloop: `@aztec/native` ships a prebuilt NAPI binary linked against glibc and `dlopen`s it at module load, but the backend/execution-api/execution-worker images were built on Alpine (musl), which has no `ld-linux-x86-64.so.2` — the process died with `ERR_DLOPEN_FAILED` before `main()` ran.

  The `monorepo-installer` and `node-runner-base` Docker stages now build on `node:24.11.1-bookworm-slim` (glibc) instead of Alpine, keeping builder and runtime libc consistent. Additionally, only the execution worker actually executes nodes, so `fireflow-trpc/server/init.ts` now registers Overcast node declarations (`@persistent-ai/fireflow-overcast/nodes`) instead of the full Aztec runtime (`/server`); the worker registers the runtime itself at its own entry point. The backend and execution-api no longer load `@aztec/native` at all. The execution-worker image also gets a build-time preflight (`import('@aztec/native')`, wrapped in `timeout 90`) so a libc/base-image mismatch fails the build loudly instead of surfacing as a runtime crashloop.
  - @persistent-ai/fireflow-types@0.21.6

## 0.21.5

### Patch Changes

- e6cc129: Fix the 0.21.3 publish-size regression: `@persistent-ai/fireflow-frontend`'s `dist/lib/fireflow-frontend.js` grew from 20MB to a single 85MB module (tarball 17MB → 97MB) because `@persistent-ai/fireflow-overcast/nodes` statically imported the Aztec runtime (`@aztec/aztec.js`, the PXE embedded wallet, `@aztec/noir-contracts.js` artifacts and barretenberg's bb.js WASM workers), and the frontend lib entry registers those nodes for deserialization. Consumers' bundlers OOMed parsing the module.

  The Overcast nodes now resolve their runtime through a registry (mirroring `fireflow-bash`'s runner-registry): the `/nodes` entry carries declarations only, and `@persistent-ai/fireflow-overcast/server` — already imported by the executor and tRPC layer — registers the implementations on import. The frontend lib build additionally externalizes `@aztec/*` as a guard so a reintroduced static import fails loudly instead of quintupling the package.

- Updated dependencies [c03389b]
  - @persistent-ai/fireflow-types@0.21.5

## 0.21.4

### Patch Changes

- @persistent-ai/fireflow-types@0.21.4

## 0.21.3

### Patch Changes

- @persistent-ai/fireflow-types@0.21.3
