# Implementation plan — agent wallet onboarding

> **Superseded.** The Create Aztec Account node and the vault-node round trip this
> plan describes have been replaced by **Aztec Ensure Account**
> (`ensure-account.node.ts`) plus **Aztec Account Signer** taking an
> `AztecAccountRef`. See [specification.md](./specification.md) §5.1 and §5.1.1.
> Where this plan disagrees with the code, the code is right.

Execution plan for §3.7 and §5.1.1 of [specification.md](./specification.md): give the end user talking to
an agent an Aztec account the agent can use programmatically, created during the conversation and owned by
that user.

Observations about the tree were taken **2026-08-10** against `@aztec/* 5.0.1`. Where this plan disagrees
with the code, the code is right — fix the plan in the same change.

---

## 1. What is being built, and why in this order

The onboarding round trip is: read the user's account out of the vault, mint one if they have none, use it,
and write a new one back. Three of those four steps already work. The write does not, and the reason is not
in this package:

- `VaultCreateNode` and `VaultUpdateNode` resolve their owner from `context.runnerId`, which is a
  **deprecated alias for `flowOwnerId`** (`packages/fireflow-types/src/execution/execution-context.ts:212-215`).
  A flow we author and a user runs would store that user's account under *our* identity, where the
  caller-scoped read can never find it again. The first conversation works, the second silently mints a
  second account and abandons the first.
- `VaultUpdateNode.value` is a plaintext `Record<string, string>` object port, so a runtime-generated
  credential can only reach the vault by crossing an edge in the clear — into the execution event stream
  and the editor.

So the platform work comes first. Everything after it is additive.

| Stage | Package | Depends on |
|---|---|---|
| 1. Caller-scoped vault writes + secret-valued update | `fireflow-nodes`, `docs/design` | — |
| 2. Shared secret-encryption helper | `fireflow-types` | — |
| 3. Overcast account runtime | `fireflow-overcast` | 2 |
| 4. Create Aztec Account node | `fireflow-overcast` | 2, 3 |
| 5. Sandbox integration + the deployment measurement | `fireflow-overcast` | 4 |
| 6. Testnet measurement | `fireflow-overcast` | 5 |
| 7. Docs and registration | both | 4 |

Stages 1 and 2 touch other packages and are self-contained; they want to be their own PR ahead of the
Overcast one.

**Write each falsifier before its fix and confirm it is red first.** Every defect class in this plan — a
write that lands under the wrong owner, a plaintext value on an edge, a salt wired into a signing key, a
replay that mints a second account — is invisible to `typecheck` and to every happy-path test.

---

## 2. Stage 1 — caller-scoped vault writes

### Changes

`packages/fireflow-nodes/src/nodes/secret/utils.ts`
- Extract the `secretScope` enum options and the identity resolution that `vault-get.ts` and `vault-list.ts`
  currently repeat verbatim. It is about to live in four nodes; one copy, used four times.
- The resolver takes the context and the scope and returns the owner id, throwing the existing per-scope
  message when the identity is absent. Keep the wording — the caller-scope message is the only thing that
  tells an author their execution has no caller.

`packages/fireflow-nodes/src/nodes/secret/vault-update.ts`
- Add the `secretScope` input (`owner | caller`, default `owner`) and resolve the owner through the shared
  helper instead of `context.runnerId`.
- Add a `Secret<string>` input that supersedes `value`. When it is wired, decrypt it inside the node and
  store the decrypted record; `value` is ignored. When it is not, behaviour is exactly as today.

`packages/fireflow-nodes/src/nodes/secret/vault-create.ts`
- Add the same `secretScope` input and resolve through the same helper.

`docs/design/033-vault-secrets-system.md`
- §3 currently states "CRUD operations: Always use `flowOwnerId` — callers cannot create/modify/delete
  secrets through foreign flows". Amend it: a caller may write a secret they own, which is what makes
  BYO-credential onboarding through someone else's flow possible at all. Record why, so the next reader does
  not restore the old rule as a security fix.

### Falsifiers

1. **The one that would have caught this.** A `VaultUpdateNode` with `secretScope: 'caller'`, executed
   against a context where `callerId` and `flowOwnerId` differ, calls `updateSecret` with the *caller*.
   Red against today's node.
2. Same for `VaultCreateNode` and `createSecret`.
3. `secretScope: 'caller'` with no `callerId` in context throws, with the same message shape the read nodes
   use.
4. The default scope is `owner`, and an existing flow that never sets the port keeps calling with the flow
   owner. This is the regression guard on every already-wired vault node.
5. A wired secret input is decrypted and stored, and `value` is ignored when both are set.
6. An unwired secret input leaves the plaintext `value` path untouched.

---

## 3. Stage 2 — one implementation of secret encryption

`UnencryptedSecretNode.encryptDirectSecret`
(`packages/fireflow-nodes/src/nodes/secret/unencrypted-secret.node.ts:217`) is the only code in the tree
that produces an `EncryptedSecretValue` at runtime, and it re-declares the AES-GCM and HKDF parameters that
`wrapSecret`'s decrypt path already owns in `packages/fireflow-types/src/port/base/secret.ts`. Stage 4 needs
the same operation. Two copies of an encryption routine is two encryption routines.

Extract it as an exported `encryptSecretForExecution(ctx, secretType, value)` beside `wrapSecret`, sharing
`encryptionAlgorithm`, `keyDerivationAlgorithm` and `ivLength` with the decrypt path, and have
`UnencryptedSecretNode` call it.

### Falsifiers

1. Round trip: `encryptSecretForExecution` then `wrapSecret(...).decrypt(ctx)` returns the input value.
2. A different execution context cannot decrypt it — this is the property the whole transit scheme rests on.
3. The existing `unencrypted-secret` tests stay green. They are the regression guard on the extraction.

**Known limitation, worth stating rather than discovering later:** `ExecutionContext.getECDHKeyPair()`
generates its keypair in memory and never persists it. A secret encrypted in one execution cannot be
decrypted after a worker recovery rebuilds the context. That is acceptable here because the values are
written to the vault within the same execution, but it does mean a recovered onboarding run loses an
account it had not yet persisted.

---

## 4. Stage 3 — Overcast account runtime

`packages/fireflow-overcast/src/utils/aztec-wallet.ts`
- `generateAccountCredentials()` — a pure seam returning the three values as strings, from `Fr.random()`,
  `Fr.random()` and `GrumpkinScalar.random()`. No network, so it is unit-testable on its own.
- `resolveAccount({ network, secret, salt, signingKey })` — takes the three values (given or generated) and
  delegates to the existing `createSigner`. Delegating is the point: it is what stops the account contract
  type drifting away from the Account Signer's `createSchnorrInitializerlessAccount`, which is an input to
  address derivation.

`packages/fireflow-overcast/src/shared/fields.ts`
- `isUninitializedFieldValue(value)` — true for unset, empty, whitespace, or a value that parses to zero.
  This is the "not initialized `= 0`" rule from the spec, and it belongs next to `parseFr` / `parseFq`.

Register `resolveAccount` in `OvercastRuntime` (`src/nodes/runtime-registry.ts`), fill it in from
`src/server.ts`, and export from `src/utils/index.ts` — the same three touch points every existing Overcast
runtime function has.

### Falsifiers

1. `generateAccountCredentials()` returns three values that `parseFr` / `parseFq` accept, and two successive
   calls agree on nothing.
2. `isUninitializedFieldValue` is table-driven over `undefined`, `''`, `'   '`, `'0'`, `'0x0'`,
   `'0x0000…0'` (true) and a real field element (false).

---

## 5. Stage 4 — the Create Aztec Account node

`packages/fireflow-overcast/src/nodes/account/create-account.node.ts`, following the shape of
`account-signer.node.ts`: ports declared against `@persistent-ai/fireflow-types`, the Aztec runtime reached
only through `getOvercastRuntime()` so the editor bundle never pulls the `@aztec/*` stack.

- Inputs: three optional `PortSecret<'string'>` and a `network` `StringEnum` over `NETWORK_OPTIONS`.
- Outputs: three `PortSecret<'string'>`, a `PortString` address, a `PortBoolean` `created`.
- No `execution: { pure: true }`, deliberately.

Export it from `src/nodes/index.ts`.

### Falsifiers

Unit tests in `src/nodes/account/__tests__/create-account.node.test.ts`, registering runtime mocks the way
`account-signer.node.test.ts` does.

1. **Passthrough.** Three initialized inputs produce the same three values, `created === false`, and the
   generator is never called.
2. **Generate.** Three uninitialized inputs produce new values and `created === true`.
3. **Uninitialized means several things.** Unwired, `''`, `'0'` and `'0x0'` each take the generate path.
4. **Partial input throws.** Two set and one uninitialized is an error naming which is which, and generates
   nothing. Silently filling the gap would derive a different address and orphan the user's account.
5. **No plaintext escapes.** The generated strings appear nowhere in the node's serialized outputs, which
   carry only `encrypted` / `hkdfNonce` / `publicKey`.
6. **Each value lands in its own port.** Decrypting `salt` yields the salt, not the signing key. All three
   are `Secret<string>`, so a swap is invisible to `typecheck`.
7. **Not pure.** The node metadata does not set `execution.pure`. A fused node is not checkpointed, so a
   replay would mint a different account than the one already handed downstream.
8. **Composition.** Create node into `AztecAccountSignerNode` with a mocked `createSigner`: the signer
   receives exactly the three values, in the right fields.

---

## 6. Stage 5 — sandbox integration, and the measurement that decides open question 4

`src/__integration__/create-account.integration.test.ts`, joining the existing shared-fixture pattern
(`getSharedLocalAztecFixtures`, `fileParallelism: false`) rather than deploying its own token — the suites
share one sandbox and a second mint of the same shape collides on nullifiers.

1. **Address determinism.** The create node's `address` equals the address an `AztecAccountSignerNode`
   derives from the three decrypted values. This is what falsifies an account-contract-type mismatch, whose
   only other symptom is an unreachable account.
2. **A fresh account can receive.** Alice transfers privately to the new address; the new account's signer
   reads its own `balance_of_private`.
3. **The deciding measurement.** With **no deployment step at all**, the fresh account submits
   `transfer_private_to_private` paying through `Get Fee Payer` with `SponsoredFPC`. Green closes open
   question 4 and no deploy node is needed. Red gives the exact error naming which publication is missing,
   and the Deploy Aztec Account node sketched in that open question gets built.

## 7. Stage 6 — testnet

The sandbox may be more permissive than testnet, and testnet is where the answer matters. A script beside
`deploy:local` and `balances:local` (`src/__integration__/scripts/`) runs create → sign → fee payer →
submit against `Testnet` and prints the values, opt-in rather than part of the suite because testnet is slow
and rate limited. Resolve open question 4 in the change that measures it.

## 8. Stage 7 — docs and registration

- `packages/fireflow-overcast/README.md`: the node table and a short onboarding section.
- Fold the outcome of the measurement back into `specification.md` open question 4.

---

## 9. Gates

```bash
pnpm --filter @persistent-ai/fireflow-nodes test
pnpm --filter @persistent-ai/fireflow-overcast test
pnpm --filter @persistent-ai/fireflow-overcast typecheck
pnpm run typecheck
pnpm test
```

Two things about the harnesses, so a green run is not read as more than it is:

- **`fireflow-overcast` runs under both vitest configs.** The root `exclude` list does not name the package,
  so its unit tests run under the root config *and* under `packages/fireflow-overcast/vitest.config.ts`.
  Anything a test depends on from the config has to be present in both.
- **`tsc -b` excludes `src/**/__tests__/**`.** A type error inside a new test file is invisible to the
  package typecheck gate. Run vitest's inline typecheck as well, and do not read either as covering the
  other.

---

## 10. Risks

- **Persist-before-use has no ordering guarantee.** Independent chains run in true parallel, so a fan-out
  from the create node to {update vault, use account} can transact with an account whose keys were never
  stored. The onboarding flow must chain the vault update ahead of the use, not fan out to both.
- **A recovered execution loses an unpersisted account.** See the ECDH note in Stage 2.
- **Three secrets is three chances at a partial write.** Keeping the account as three `string` secrets
  rather than one typed secret means an update that fails between the second and third value leaves the user
  with an account nobody can reconstruct. Worth revisiting if it bites.
- **The caller-write amendment widens what a foreign flow can do.** It is narrow — a caller writing a secret
  they own — but it is a real change to RFC 033's ownership rule, and falsifier 4 in Stage 1 is the only
  thing standing between it and a default that silently widens.
