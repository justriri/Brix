import type { ProtectionQuote } from "@/lib/types";

/**
 * ============================================================================
 * SUPERSEDED — kept only as historical record; see settlementContractClient.ts
 * ============================================================================
 *
 * The BNB Hack: Tokenized Stocks Edition rules state "Spot only. Perps are
 * out." Whether a fixed-term, pre-funded, non-leveraged contingent payout
 * satisfies that rule was UNRESOLVED when this module was written (see
 * reports/BNB tokenized stocks hackathon research.md "OPEN QUESTIONS" and
 * reports/Weekend protection strategy memo.md section 10-C) — BNB Chain has
 * SINCE CONFIRMED this mechanism is permitted.
 *
 * These four functions were a typed placeholder for an "on-chain policy
 * vault" design (strategy memo section 7 / 10-I) that was never actually
 * built or wired to anything (nothing in src/ imports this file). The real
 * settlement mechanism that WAS built and deployed — reserve funding,
 * premium collection via purchaseProtection, and payout/claim — is
 * settlementContractClient.ts's WeekendGuardSettlement.sol integration,
 * wired to the UI via PurchaseProtectionButton.tsx. This file is NOT part
 * of that path; it remains only so the historical "why was this blocked"
 * context isn't lost. Do not wire new code to the functions below.
 */

export class ProtectionMechanismDisabledError extends Error {
  constructor(action: string) {
    super(
      `This superseded placeholder ("${action}") was never wired to anything real — the actual, working settlement mechanism is settlementContractClient.ts. See lib/protection/policy.ts.`
    );
    this.name = "ProtectionMechanismDisabledError";
  }
}

/** Superseded — see settlementContractClient.ts's fundReserveOnChain(), the real, deployed equivalent. Not implemented here. */
export async function fundReservePool(_amountUsdt: number): Promise<never> {
  throw new ProtectionMechanismDisabledError("fundReservePool");
}

/** Superseded — see settlementContractClient.ts's purchaseProtectionOnChain(), the real, deployed equivalent (wired via PurchaseProtectionButton.tsx). Not implemented here. */
export async function purchasePolicy(_quote: ProtectionQuote): Promise<never> {
  throw new ProtectionMechanismDisabledError("purchasePolicy");
}

/** Superseded — see settlementContractClient.ts's resolveSettlementOnChain()/claimPayoutOnChain(), the real, deployed equivalents. Not implemented here. */
export async function executeSettlement(_policyId: string): Promise<never> {
  throw new ProtectionMechanismDisabledError("executeSettlement");
}

/** Superseded — see settlementContractClient.ts's readReserveStatus(), the real, deployed equivalent. Not implemented here. */
export async function getReservePoolStatus(): Promise<never> {
  throw new ProtectionMechanismDisabledError("getReservePoolStatus");
}
