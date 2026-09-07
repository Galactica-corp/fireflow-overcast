/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Importing node modules triggers @Node() decorator registration in NodeRegistry.

import AztecAccountSignerNode from './account/account-signer.node'
import AztecEnsureAccountNode from './account/ensure-account.node'
import ParseContractArtifactNode from './contract/parse-artifact.node'
import AztecSmartContractNode from './contract/smart-contract.node'
import AztecGetFeePayerNode from './fee/get-fee-payer.node'
import AztecSimulateTransactionNode from './transaction/simulate-transaction.node'
import AztecSubmitTransactionNode from './transaction/submit-transaction.node'
import AztecTransactionBuilderNode from './transaction/transaction-builder.node'
import BuildX402PaymentHeaderNode from './x402/build-payment-header.node'
import ParseX402ChallengeNode from './x402/parse-challenge.node'
import RequestX402ResourceNode from './x402/request-resource.node'

export {
  AztecAccountSignerNode,
  AztecEnsureAccountNode,
  AztecGetFeePayerNode,
  AztecSimulateTransactionNode,
  AztecSmartContractNode,
  AztecSubmitTransactionNode,
  AztecTransactionBuilderNode,
  BuildX402PaymentHeaderNode,
  ParseContractArtifactNode,
  ParseX402ChallengeNode,
  RequestX402ResourceNode,
}
