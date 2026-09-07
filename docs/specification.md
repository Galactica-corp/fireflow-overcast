# Node specification for FireFlow \- Overcast integration

## 1\. Context

This document specifies the FireFlow graph nodes required to let an AI agent execute **private stablecoin payments** using the **Overcast protocol on Aztec**. Each node is an atomic operation (comparable to an MCP service the agent can call) with defined inputs, outputs, and behavior. Together these nodes compose into larger FireFlow graphs that fulfill an agent's payment intent while preserving Overcast's privacy and compliance guarantees.

Agent wallet onboarding (§3.7, §5.1.1) is implemented by **Aztec Ensure Account**: get-or-create the caller's `aztec-account` vault secret and publish a `.ffsecret` pointer, then hand an `AztecAccountRef` to the Aztec Account Signer (§5.1). Secrets never appear on ports.

## 2\. Use cases

The nodes in this specification target two payment flows:

1. **Direct private transfer** — an agent sends a defined amount of the Overcast stablecoin to a known recipient, satisfying the token contract's compliance guards while keeping the amount, sender, and recipient private.  
2. **Commerce payment via x402** — an agent requests a paid resource/service, receives an HTTP `402 Payment Required` challenge, and settles it privately through the Overcast x402 facilitator flow (machine-to-merchant commerce).

## 3\. Scope

**In scope:**

1. General-purpose Aztec interaction nodes that can read from and write to *any* smart contract on Aztec — representing a contract, building a transaction from a contract/method/parameters, authorizing it, submitting it, and confirming it. This specification keeps these nodes general purpose but applies them to the payment use case only.  
2. Atomic nodes covering the agent-side payment lifecycle: note/balance management, transaction construction, authorization, submission, and confirmation.  
3. The x402 commerce flow: parsing payment challenges, assembling the signed payment payload, and settling via a facilitator.  
4. Selective-disclosure attachment for compliant transfers (basic and threshold disclosure as configured by the target contract).  
5. Delegated-KYC ("Know Your Agent") usage, where the agent acts under an AuthWit issued by its parent identity.  
6. Activity by a x402 consumer.  
7. Agent wallet onboarding — provisioning an Aztec account for the **end user talking to the agent**, not for the author of the flow. The account is created during the conversation, on that user's behalf, and belongs to them; the flow author never holds its keys. This makes the account's identity a caller-scoped concern throughout: it is stored as the caller's FireFlow secret (RFC 033) and read back as the caller's secret on the next conversation.

**Out of scope (Delivered through Overcast):**

1. Guardian-side KYC onboarding and PII verification internals.  
2. Overcast / Aztec smart contract implementation and the protocol's compliance-guard logic itself.  
3. Cross-chain bridging and settlement (Portal pattern, TRAIN atomic swaps, yield routing).  
4. FireFlow engine internals (scheduling, persistence, DBOS execution semantics).  
5. Onboarding transactions to Overcast (getting stablecoins onto Aztec from another chain). This is a manual step done by the user to provide the agent with a limited budget.  
6. x402 merchant and facilitator logic.

## 4\. Open questions

1. **Compliance & proof model.** ZK.money is another stablecoin we might integrate within Overcast. The main open question is what compliance requirements ZK.money has, and how far we adopt its compliance setup versus building our own ZK-KYC compliance setup on Aztec. This also drives proof granularity (one combined compliance proof vs. separate ownership / KYC / non-membership proofs). *For the node specifications below we assume the compliance and KYC proofs are bundled into the delegated-KYC authorization handed to the agent (a manual pre-step), so the agent only consumes pre-generated proof data.*  
2. **Aztec version handling.** The Aztec version is essential for several nodes because it influences, for example, the derived account address. We could hard-code a version, or expose the version as an input on all relevant nodes. *Resolution: we focus on the relevant version(s) for now. If we later want to support multiple Aztec versions, we add separate nodes for each supported version.*  
3. **General-purpose nodes vs. artifact-driven node generation.** Do we keep the general-purpose nodes as specified (a single Aztec Transaction Builder that takes a method name and a generic parameter list), or do we invest in a node generator that — similar to the MCP service integration — lets someone submit a smart contract artifact and then has FireFlow build a dedicated list of nodes corresponding to the contract's available methods? The generator approach would simplify the interface considerably (typed, per-method nodes instead of strongly-typed method names and untyped parameters), at the cost of building and maintaining the generation tooling.  
4. **Does a freshly created account need an explicit deployment node?** Aztec Ensure Account (§5.1.1) mints an account contract of type `schnorr_initializerless`. Initializerless means there is no constructor call and no `signing_public_key` note to discover — but it does *not* by itself establish that the account's contract instance can stay unpublished. Whether an undeployed account can send a fee-paying transaction (sponsored FPC) is a property of the network, not of the SDK call, and we have no evidence for it in-tree: every initializerless account exercised so far is a sandbox genesis account, which is already published. *Resolution path: measure it. `src/__integration__/fresh-account.integration.test.ts` runs generate → sign → SponsoredFPC → `transfer_private_to_private` on the local sandbox with no deploy step; `pnpm --filter @persistent-ai/fireflow-overcast measure:testnet-account` repeats that path on Testnet (opt-in). If that transaction lands, no deployment node is needed and this question closes. If it fails, add a **Deploy Aztec Account** node taking the `AztecSignerRef` (§5.1) and the `AztecFeePayerRef` (§5.3), resolving both and calling `account.getDeployMethod()` with `from: NO_FROM` — Simulate / Submit already perform the sponsored-FPC registration that the Aztec documentation writes out by hand, so the node adds only the deploy call, an idempotency check against the published instance, and a confirmation wait.*

5. **Caller-scoped vault writes (resolved).** Ensure Account writes the caller's `aztec-account` secret through `IVaultContextService.createSecret` / `updateSecret` with `ownerId = callerId`, rather than through `VaultCreateNode` / `VaultUpdateNode`. The RFC 033 rule that vault *nodes* always use `flowOwnerId` still holds; this node is the exception that owns the credential on the caller's behalf.

6. **Secret-valued vault update (resolved / not needed).** Ensure Account never emits scalars on ports, so there is no secret-valued edge into a vault node. Persistence is inside the node.

7. **Finding the right secret for the current user (resolved).** Ensure Account names the secret `aztec-account:${network}:${label}` and looks it up with `findSecretIdByName`. The Account Signer does not look up by name: it reads the `.ffsecret` pointer on the `AztecAccountRef`.

### Deferred to implementation

The following are not open questions — the decisions are clear and the work simply happens later, during implementation rather than in this specification:

1. **Complex object types.** Some nodes pass complex objects between them, e.g., Aztec signers, smart contract objects, authorization witnesses, payment headers. Their detailed shapes will be defined during implementation.  
2. **Error handling.** Nodes can fail for various reasons, e.g. invalid Aztec address in the input, on-chain tx failed, http timeout etc. The concrete error types and handling per node will be specified during implementation.

## 5\. Node specifications

Nodes are grouped by role. The **core / shared** nodes are general purpose — they can read from and write to any smart contract on Aztec. The **x402 commerce** nodes apply these primitives to the payment use case.

### Core / shared

#### 5.1 Aztec Account Signer

Description:

1. Assembles an `AztecSignerRef` from an `AztecAccountRef` (pointer coordinates + public address produced by Aztec Ensure Account, §5.1.1), a secret scope, and optional note-discovery senders.  
2. **Does not** decrypt vault secrets or initialize a PXE. Consumers (Simulate / Submit / x402) call `resolveSigner` which loads credentials and hydrates a live wallet from a process-local cache.  
3. The string `address` output is copied from `account.address`.

Inputs:

- `account` (`AztecAccountRef`) — pointer coordinates (`workspaceId`, `branch`, `pointerPath`) plus the public `address`, `network`, and `label`. The three credential scalars are **not** inputs; they live in the vault behind the pointer.  
- `secretScope` (`owner | caller`, default `caller`) — which identity owns the vault secret.  
- `discoverNotesFrom` (`string[]`) — sender addresses to register for private note discovery when the live signer is first resolved (and on subsequent cache hits with additional senders).

Outputs:

- `signer` (`AztecSignerRef`) — serializable signing context. Consumers rehydrate the live wallet locally.  
- `address` (`string`) — public account address from the account ref.

Behavior:

- Declared `execution: { pure: true }` — pure assembly, no I/O.  
- Address-match checking happens inside `resolveSigner`, not here.  
- Network is taken from `account.network`, not from a separate enum port.

#### 5.1.1 Aztec Ensure Account

Description:

1. Get-or-create the **caller's** Aztec account. The account is three values — an account secret, a deployment salt and a Grumpkin signing key — stored as one FireFlow vault secret of type `aztec-account` (RFC 033, `docs/design/033-vault-secrets-system.md`), plus a `.ffsecret` pointer in the caller's personal workspace. The node **does not emit secrets on ports**.  
2. **Found.** When the pointer already exists, the node returns the public `AztecAccountRef` (workspace, branch, pointer path, address, network, label) without minting.  
3. **Create.** When the pointer is missing, the node draws a random secret, salt and Grumpkin signing key, stores them under `aztec-account:${network}:${label}` (adopting an orphan vault row of that name if one exists), derives the address, and publishes the pointer.  
4. Derives the address locally, using the same account contract as the Aztec Account Signer (§5.1).  
5. Sends no transaction and writes no chain state. The only reason it contacts the network is to build the local wallet / PXE context that performs the derivation.  
6. Two named DBOS steps, node-scoped so two instances of the node in one flow can never swap checkpoints on recovery (`ensure-account:{nodeId}:ensure-vault-secret`, `ensure-account:{nodeId}:publish-pointer`). Declared `execution: { dbos: true }`. The flow lock is held across both steps so a concurrent first-run cannot mint a second address in the gap between `createSecret` and the pointer commit.

Inputs:

- `network` (`NetworkEnum`) — target Aztec network, selecting the node RPC endpoint used for address derivation.  
- `label` (`string`, default `'default'`) — folded into the secret name and pointer path. Must match `^[\w-]+$` (lakeFS-safe). Default is a single account per user per network.

Outputs:

- `account` (`AztecAccountRef`) — public pointer coordinates + derived address. Feeds §5.1's `account` port. Contains no secrets.

Behavior:

- **The three values never leave the vault step in plaintext.** Step checkpoints are public facts only (`secretId`, `address`, workspace coordinates).  
- **The node is deliberately not `execution: { pure: true }`.** A fused node is not checkpointed, so a workflow replay would mint a different account than the one already handed downstream.  
- **Caller identity is required.** `context.callerId` is the vault owner. The pointer is written to the caller's personal workspace (`mcpRuntime.resolvePersonalWorkspace`); that workspace is not provisioned here.  
- **Idempotent.** A second run with the same caller / network / label returns the same `AztecAccountRef` and does not call `createSecret`.

Onboarding wiring — one node writes the vault, one node reads it:

```
Aztec Ensure Account ──AztecAccountRef──> Aztec Account Signer (§5.1)
```

A returning user's pointer is already published; Ensure Account takes the found branch and the Signer decrypts the same vault secret. A new user gets a minted secret, a committed pointer, and the same Signer path.

#### 5.2 Aztec Smart Contract

Description:

1. Represents any smart contract deployed on Aztec (e.g. the Overcast stablecoin token contract).  
2. Assembles an `AztecSmartContractRef` from the contract address, network, and an `AztecArtifactRef` (VFS coordinates of the artifact JSON).  
3. Does not load the ABI; consumers call `resolveContract` / `resolveArtifact` which read the file from VFS once per cache key.

Inputs:

- `address` (`string`) — contract address.  
- `network` (`NetworkEnum`) — target Aztec network.  
- `artifact` (`AztecArtifactRef`) — VFS coordinates of the contract artifact JSON (`workspaceId`, `branch`, `path`, optional `name`).

Outputs:

- `contract` (`AztecSmartContractRef`) — serializable contract coordinates.

#### 5.2.1 Parse Contract Artifact

Description:

1. Validates a contract artifact JSON file in VFS and emits an `AztecArtifactRef`.  
2. Fail-fast + cache-warm path before Smart Contract / Simulate / Submit. Authors may also type coordinates directly on Smart Contract's nested `artifact` port and skip Parse.

Inputs:

- `workspaceId` (`string`) — workspace that holds the artifact JSON file.  
- `branch` (`string`) — VFS branch / ref.  
- `path` (`string`) — path to the artifact JSON inside the workspace.

Outputs:

- `artifact` (`AztecArtifactRef`) — same coordinates plus `name` from the repaired artifact. **Never** the ABI blob.

#### 5.3 Get Fee Payer

Description:

1. Assembles an `AztecFeePayerRef` describing how fees are paid (native fee juice or sponsored FPC).  
2. Does not require a signer — fee strategy is data; the account is already on the tx chain via `AztecSignerRef`. FPC PXE registration happens in Simulate / Submit after `resolveSigner`.

Inputs:

- `method` (`FeePaymentMethodEnum`) — how fees are paid.  
- `fpcAddress` (`string`, optional) — fee-paying contract address when using SponsoredFPC.

Outputs:

- `feePayer` (`AztecFeePayerRef`) — serializable fee strategy.

#### 5.4 Delegated KYC

Description:

1. Fetches the agent's delegation and authorization (AuthWit \+ bundled compliance/KYC proof data) from chain for the given authorizer.  
2. Binds the delegation to the specified token so the flow knows what it is authorized against.  
3. Optionally constrains usage with a spend limit and a recipient whitelist.

Inputs:

- `authorizer` (`string`) — authorizer (parent) address granting the delegation.  
- `token` (`string`) — token contract address the delegation is bound to.  
- `limit` (`number`, optional) — spending limit.  
- `whitelist` (`string[]`, optional) — allowed recipient addresses.

Outputs:

- `delegation` (`DelegationInfo`) — delegation/authorization info object. Can be passed into the Aztec Transaction Builder (§5.5) `parameters` to authorize a compliant call.  
- `witness` (`AuthWitness`) — authorization witness derived from the delegation, to hand to the Submit Aztec Transaction node (§5.8) `witnesses`.

#### 5.5 Aztec Transaction Builder

Description:

1. General-purpose write primitive: assembles an `AztecTxRequestRef` that calls a method on any Aztec smart contract.  
2. Pure assembly — no ABI load and no method-existence check here (that runs inside `resolveTxRequest` at Simulate / Submit).  
3. For a direct private transfer this means calling the token contract's transfer method with the recipient and amount as parameters; the same node builds any other contract call (e.g. completing an x402 payment note — see §5.10).

Inputs:

- `contract` (`AztecSmartContractRef`) — the target smart contract.  
- `subContracts` (`AztecSmartContractRef[]`, optional) — additional contracts registered in the PXE before simulate/submit.  
- `signer` (`AztecSignerRef`) — account building / sending the transaction.  
- `method` (`string`) — name of the contract method to call.  
- `parameters` (`any[]`) — ordered list of arguments for the method.  
- `feePayer` (`AztecFeePayerRef`) — who pays the transaction fee and how.

Outputs:

- `transaction` (`AztecTxRequestRef`) — serializable transaction request.

#### 5.6 Simulate Transaction

Description:

1. General-purpose read primitive: simulates a transaction locally via the PXE without submitting it on-chain, and returns whatever the called smart contract method returns.  
2. Replaces special-purpose getters — e.g. reading the agent's Overcast balance is now building a balance-read call with the Aztec Transaction Builder (§5.5) and simulating it here.  
3. Runs locally, so it needs neither authorization witnesses nor a wait-for-confirmation flag.

Inputs:

- `transaction` (`AztecTxRequestRef`) — transaction request from the Aztec Transaction Builder (§5.5). Consumers call `resolveTxRequest` then simulate.

Outputs:

- `result` (`object`) — object containing the value(s) returned by the smart contract read.

#### 5.7 Create AuthWit

Description:

1. Creates an Authorization Witness (AuthWit) that authorizes a prepared transaction on behalf of the signing identity.  
2. Used, for example, so an agent can act under an AuthWit issued by its parent identity (delegated KYC) or to satisfy a token contract's compliance hooks.  
3. The resulting witness is handed to the Submit Aztec Transaction node alongside the transaction.

Inputs:

- `transaction` (`PreparedTransaction`) — the transaction to authorize.  
- `signer` (`Signer`) — identity producing the authorization.

Outputs:

- `witness` (`AuthWitness`) — authorization witness.

#### 5.8 Submit Aztec Transaction

Description:

1. Submits a prepared Aztec transaction to the network, together with any required authorization witnesses.  
2. Optionally waits for the transaction to be confirmed before completing.

Inputs:

- `transaction` (`AztecTxRequestRef`) — transaction request to submit.  
- `witnesses` (`AuthWitness[]`, optional) — authorization witnesses (e.g. delegated-KYC AuthWits) required by the transaction.  
- `waitForConfirmation` (`boolean`) — whether to wait for confirmation.

Outputs:

- `txHash` (`string`) — submitted transaction hash.  
- `receipt` (`TxReceipt`) — confirmation status / receipt (when waiting).

### x402 commerce

#### 5.9 Request x402 Resource

Description:

1. Performs an HTTP request to a resource endpoint that may require x402 payment.  
2. Used both for the initial request (returns the `402` challenge with the merchant's partial note details) and for the second request after the payment is made (carrying the x402 payment data in the headers).

Inputs:

- `url` (`string`) — resource endpoint.  
- `method` (`HttpMethod`) — request method.  
- `headers` (`Header[]`, optional) — request headers; may include x402 payment data on the second request.  
- `body` (`object`, optional) — request body.  
- `signer` (`AztecSignerRef`, optional) — paying account used for the x402 prepare round-trip when a `402` is returned.

Outputs:

- `response` (`object`) — returned response as a JS object (the `402` challenge on the first call, or the delivered resource on the second).

#### 5.10 Parse x402 Challenge

Description:

1. Takes the merchant's x402 challenge response (containing the partial note details) and completes it by filling in the agent's funds.  
2. Validates the challenge against a caller-supplied spend cap (and optional expected asset / payTo) before producing settlement parameters.  
3. Produces the contract method and parameter list needed to settle the payment, ready to feed into the general-purpose Aztec Transaction Builder (§5.5) against the token contract.

Inputs:

- `x402Response` (`object`) — the x402 challenge response (partial note details).  
- `signer` (`AztecSignerRef`) — paying account whose funds complete the partial note.  
- `contract` (`AztecSmartContractRef`, optional) — token contract used for `offchain_receive` when an offchain message is present.  
- `maxAmount` (`string`, required) — maximum allowed payment amount in token base units. The challenge amount must be a non-negative integer string and must not exceed this cap.  
- `expectedAsset` (`string`, optional) — when set, the challenge `asset` must match (e.g. the token contract address from the Aztec Smart Contract node).  
- `expectedPayTo` (`string`, optional) — when set, the challenge `payTo` must match the expected merchant recipient.

Behavior:

- Rejects malformed challenge amounts (decimals, negatives, non-numeric strings).  
- When the challenge includes `maxTimeoutSeconds` and a client-side `receivedAt` timestamp (set when the 402 response is parsed), rejects stale challenges that exceed the timeout.  
- Delegated KYC (§5.4) and Human-in-the-Loop Payment Approval (§5.12) are orthogonal composition options — flows may wire them in separately; the x402 nodes do not require them.

Outputs:

- `method` (`string`) — token-contract method to call to settle the payment.  
- `parameters` (`any[]`) — parameters (the completed note) for the Aztec Transaction Builder.  
- `paymentContext` (`X402PaymentContext`) — accepted payment option + sender coordinates, passed to Build x402 Payment Header.

#### 5.11 Build x402 Payment Header

Description:

1. Transforms a submitted settlement transaction into the x402 payment header expected by the merchant.  
2. The header is passed to the Request x402 Resource node on the second request so the merchant / facilitator can verify the payment and deliver the resource.

Inputs:

- `txHash` (`string`) — hash of the submitted settlement transaction.  
- `receipt` (`TxReceipt`, optional) — confirmation receipt of the settlement transaction. When present with a non-success terminal status (reverted / dropped), the node refuses to build a header; `pending` is allowed for no-wait flows.  
- `paymentContext` (`X402PaymentContext`, required) — payment context from Parse x402 Challenge.

Outputs:

- `paymentHeader` (`Header`) — x402 payment header to pass to the Request x402 Resource node on the second request.

### Human-in-the-loop

#### 5.12 Human-in-the-Loop Payment Approval

Description:

1. Instead of the agent signing and submitting a payment itself, this node turns a payment intent into an interactive UI element that is presented to the user.  
2. The user is brought into the loop: they receive the element, review the payment, connect their wallet, and approve & sign (and submit) the transaction with their own wallet — rather than the agent signing locally via a loaded secret.  
3. The node suspends the flow until the user responds, then hands the result back to the agent so the flow can continue processing it downstream.  
4. For implementation we are going to use [AG-UI](https://docs.ag-ui.com/introduction) and [JSON-renderer](https://json-render.dev/docs).

Inputs:

- `transaction` (`PreparedTransaction`, optional) — the prepared payment transaction to present for approval (e.g. from the Aztec Transaction Builder §5.5).  
- `recipient` (`string`) — recipient address, shown in the UI element.  
- `amount` (`number`) — payment amount, shown in the UI element.  
- `label` (`string`, optional) — human-readable description / context of the payment intent.

Outputs:

- `uiElement` (`UIElement`) — the rendered payment-approval UI element handed to the user to connect their wallet and sign.  
- `result` (`object`) — outcome after the user acts: the signed/submitted transaction (`txHash` \+ `receipt`) and an approval/rejection status, returned to the agent for further processing.

## 6\. Components to develop (non-node)

Supporting components required for the end-to-end experience that are not FireFlow nodes:

1. **Overcast onboarding / offboarding interface** — for acquiring/depositing the stablecoin onto Aztec (e.g. bridging from L1/other chains) to fund the agent's budget, and withdrawing/redeeming it back out of Aztec.  
2. **Delegated-KYC & authorization issuance** — the parent-side flow to generate the delegated ZK-KYC authorization (AuthWit \+ compliance/KYC proofs, with spend/duration/counterparty limits) and hand it to the agent.  
3. **Delegated-KYC smart contract** — the on-chain contract holding the delegation/authorization that the Delegated KYC node reads from and that the token's compliance hooks check against.

Caller-scoped vault writes and a secret-valued vault-update port were previously listed here as blockers for agent wallet onboarding. Aztec Ensure Account (§5.1.1) writes the caller's `aztec-account` secret itself, so those platform changes are no longer required for this flow.

