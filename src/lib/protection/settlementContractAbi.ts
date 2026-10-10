/**
 * Minimal, hand-written viem ABI for WeekendGuardSettlement.sol — only the
 * functions/events the frontend actually calls. Deliberately NOT generated
 * from the Hardhat subproject's build artifacts: contracts/ has its own
 * isolated node_modules/toolchain (see contracts/package.json) specifically
 * so the Next.js app never depends on it to build. If the contract's
 * interface changes, this file must be updated by hand to match.
 */
export const SETTLEMENT_CONTRACT_ABI = [
  {
    type: "function",
    name: "purchaseProtection",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "p",
        type: "tuple",
        components: [
          { name: "underlyingTicker", type: "string" },
          { name: "tokenizedStockContract", type: "address" },
          { name: "wrapper", type: "uint8" },
          { name: "coveredPositionValue", type: "uint256" },
          { name: "thresholdBps", type: "uint256" },
          { name: "premiumAmount", type: "uint256" },
          { name: "maxPayoutAmount", type: "uint256" },
          { name: "expiryTime", type: "uint64" },
          { name: "protectionSessionId", type: "bytes32" },
        ],
      },
    ],
    outputs: [{ name: "policyId", type: "uint256" }],
  },
  {
    type: "function",
    name: "resolveSettlement",
    stateMutability: "nonpayable",
    inputs: [
      { name: "policyId", type: "uint256" },
      {
        name: "auth",
        type: "tuple",
        components: [
          { name: "policyId", type: "uint256" },
          { name: "eligible", type: "bool" },
          { name: "finalReferencePrice", type: "int256" },
          { name: "settlementTimestamp", type: "uint64" },
          { name: "authorizationExpiry", type: "uint64" },
          { name: "nonce", type: "uint256" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "claimPayout",
    stateMutability: "nonpayable",
    inputs: [{ name: "policyId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "getPolicy",
    stateMutability: "view",
    inputs: [{ name: "policyId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "owner", type: "address" },
          { name: "underlyingTicker", type: "string" },
          { name: "tokenizedStockContract", type: "address" },
          { name: "wrapper", type: "uint8" },
          { name: "coveredPositionValue", type: "uint256" },
          { name: "thresholdBps", type: "uint256" },
          { name: "premiumAmount", type: "uint256" },
          { name: "maxPayoutAmount", type: "uint256" },
          { name: "startTime", type: "uint64" },
          { name: "expiryTime", type: "uint64" },
          { name: "protectionSessionId", type: "bytes32" },
          { name: "status", type: "uint8" },
          { name: "settled", type: "bool" },
        ],
      },
    ],
  },
  // Added for the controlled real-settlement test harness — pre-existing
  // contract functions (deployed, unmodified) that simply weren't wired
  // into the frontend ABI/client yet. fundReserve is permissionless by
  // design (see the contract's own doc comment); the two view functions
  // are read-only reserve-accounting getters.
  {
    type: "function",
    name: "fundReserve",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "totalReserve",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "availableReserve",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  // Added for the withdrawal interface — pre-existing, deployed,
  // unmodified contract functions (owner-only withdrawReserve; the two
  // view getters it depends on) simply not wired into the frontend ABI yet.
  {
    type: "function",
    name: "withdrawReserve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "to", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "totalLockedForActivePolicies",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  // Added for policy-by-owner discovery (the contract has no owner-indexed
  // getter, so the only way to find "my policies" is to scan 1..nextPolicyId-1
  // via getPolicy and filter by owner) — pre-existing, deployed, unmodified.
  {
    type: "function",
    name: "nextPolicyId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "trustedSigner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  // Added so a successful purchaseProtection() receipt's own policyId can be
  // read back directly from its emitted event, rather than guessed from
  // nextPolicyId() (racy under concurrent purchases) — pre-existing,
  // deployed, unmodified contract event, simply not wired in yet.
  {
    type: "event",
    name: "PolicyPurchased",
    inputs: [
      { name: "policyId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "protectionSessionId", type: "bytes32", indexed: true },
      { name: "premiumAmount", type: "uint256", indexed: false },
      { name: "maxPayoutAmount", type: "uint256", indexed: false },
      { name: "expiryTime", type: "uint64", indexed: false },
    ],
  },
] as const;

export const POLICY_STATUS_LABELS = ["NONE", "ACTIVE", "ELIGIBLE", "CLAIMED", "CLOSED_NO_PAYOUT"] as const;
