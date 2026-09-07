/*
 * Copyright 2026 PersistentAI
 *
 * SPDX-License-Identifier: Apache-2.0
 */

export const FEE_PAYMENT_METHOD_OPTIONS = ['FeeJuice', 'SponsoredFPC'] as const

export type FeePaymentMethodEnum = (typeof FEE_PAYMENT_METHOD_OPTIONS)[number]

export const DEFAULT_FEE_PAYMENT_METHOD: FeePaymentMethodEnum = 'FeeJuice'
