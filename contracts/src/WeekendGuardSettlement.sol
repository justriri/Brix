// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * WeekendGuardSettlement
 * ============================================================================
 * THE SMALLEST CREDIBLE ON-CHAIN PIECE OF WEEKENDGUARD'S PROTECTION MECHANISM.
 * ============================================================================
 *
 * PRODUCT BOUNDARY (read this before touching anything below):
 * WeekendGuard protects a user's existing SPOT tokenized-stock position. This
 * contract never touches that spot position: it never receives, trades,
 * buys, or sells the tokenized stock, never opens margin, and never creates
 * a perpetual/future/short/leveraged instrument. `tokenizedStockContract`
 * on a Policy is recorded for traceability ONLY — this contract never calls
 * it. The only asset this contract ever moves is USDT, in fixed amounts
 * decided before a policy is opened. See DEPLOYMENT.md / SETTLEMENT.md for
 * the full "spot vs. perps" classification writeup.
 *
 * WHAT THIS CONTRACT INTENTIONALLY DOES NOT DO (by design, not by omission):
 *   - It does not compute the Safety Gate (liquidity/freshness/reference-
 *     deviation/market-status/cross-wrapper-consistency checks).
 *   - It does not compute trust continuity across Friday/Saturday/Sunday/
 *     Monday checkpoints, and does not know what a "missed checkpoint" is.
 *   - It does not decide whether a threshold was crossed.
 *   - It does not talk to Pyth, Binance, or any price feed directly.
 *
 * RESERVE ASSET: USDT (BSC Binance-Peg BSC-USD, 18 decimals, live-verified —
 * same address already used elsewhere in this app as a trusted spot-purchase
 * quote asset, see lib/providers/trustedQuoteLiquidity.ts). Chosen so BRIX's
 * economic flow is a single stablecoin end to end — USDT buys the tokenized
 * stock AND funds/pays the protection reserve — rather than requiring a user
 * or operator to juggle two different stablecoins for two halves of one
 * product. This is a reserve-asset choice only: it changes nothing about
 * which asset a user buys as their tokenized-stock position (that remains
 * whichever trusted pool/asset the spot-purchase flow already resolves to,
 * unmodified), and nothing about this contract's accounting/authorization
 * logic, which only ever moves raw uint256 base units and never assumed a
 * particular stablecoin's identity.
 * All of that is the existing, unmodified off-chain WeekendGuard trust
 * pipeline (safetyGate.ts -> weekendTrustMonitor.ts -> protectionScheduler.ts).
 * This contract trusts exactly ONE thing crossing that boundary: an EIP-712
 * message signed by `trustedSigner`, asserting the FINAL, ALREADY-COMPUTED
 * outcome of that off-chain pipeline for one specific policy. Why a signed
 * message rather than reading Pyth on-chain directly: Pyth's on-chain
 * contracts can only attest "a price was published at time T within
 * confidence interval C" — they know nothing about multi-day trust
 * continuity, missed checkpoints, or cross-wrapper consistency, which is
 * WeekendGuard's actual off-chain product logic. Re-deriving that entire
 * state machine in Solidity would duplicate already-tested logic and
 * reintroduce exactly the "should the settlement layer make its own
 * judgment calls" problem this project has avoided throughout (see
 * weekendTrustMonitor.ts's own module doc). A signed attestation bridging
 * an already-correct off-chain decision to an on-chain claim is the
 * minimal, correct architecture for this MVP.
 *
 * FAIL-CLOSED, EVERYWHERE: every external condition that can't be verified
 * (stale/expired authorization, wrong signer, wrong policy, already
 * settled, wrong state, amount exceeds cap, insufficient reserve) reverts.
 * Nothing in this contract has an implicit "else pay" branch.
 */
contract WeekendGuardSettlement is EIP712 {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------
    // Roles (single-owner MVP — see SETTLEMENT.md "known centralization
    // risk" note: acceptable, disclosed, for a hackathon/testnet demo;
    // NOT how a mainnet deployment holding meaningful funds should work).
    // ------------------------------------------------------------------
    address public owner;
    address public trustedSigner;

    modifier onlyOwner() {
        require(msg.sender == owner, "WeekendGuard: not owner");
        _;
    }

    // ------------------------------------------------------------------
    // Reserve accounting (build brief Task 5 — "the contract should never
    // promise more than the available reserve").
    // ------------------------------------------------------------------
    IERC20 public immutable usdt;

    /** Total USDT ever funded via fundReserve() or collected as premium. Not the same as usdt.balanceOf(address(this)) — that could include stray/accidental transfers this contract never promised against. Tracked explicitly so reserve math can never be inflated by an unexpected direct transfer. */
    uint256 public totalReserve;
    /** Sum of maxPayoutAmount across every currently-ACTIVE policy — the contract's total outstanding obligation right now. */
    uint256 public totalLockedForActivePolicies;
    /** Hard ceiling on totalLockedForActivePolicies, set below totalReserve with a buffer by the owner — a second, independent guard beyond "reserve covers it". */
    uint256 public maxExposureCap;
    /** Per-wallet cap on simultaneously-active coverage (build brief Task 5 "per-user limits" via the strategy memo) — blunts one wallet buying maximal coverage against a position it doesn't actually hold. */
    uint256 public perUserCap;
    mapping(address => uint256) public userActiveExposure;

    /** Grace period after a policy's own expiry before ANYONE (not just the owner) may force-close it with no payout if the trusted signer never resolved it — a safety valve against outstanding reserve capacity being stuck forever by a backend outage. Generous on purpose: this is a last resort, not the normal path. */
    uint64 public constant FORCE_CLOSE_GRACE_PERIOD = 7 days;

    // ------------------------------------------------------------------
    // Policy model (build brief Task 3).
    // ------------------------------------------------------------------
    enum PolicyStatus {
        NONE, // policyId never used
        ACTIVE,
        ELIGIBLE, // trusted signer confirmed payout condition met; awaiting claim
        CLAIMED,
        CLOSED_NO_PAYOUT
    }

    enum Wrapper {
        BSTOCKS,
        ONDO,
        XSTOCKS
    }

    struct Policy {
        address owner;
        string underlyingTicker; // e.g. "TSLA" — small, fixed-size demo universe; not gas-optimized on purpose, MVP clarity over micro-optimization
        address tokenizedStockContract; // traceability ONLY — never called, never transferred into this contract
        Wrapper wrapper;
        uint256 coveredPositionValue; // USDT base units (the position's covered USD value at purchase time)
        uint256 thresholdBps; // basis points, e.g. 500 = 5.00% — integer, no floating point on-chain
        uint256 premiumAmount; // USDT base units, already collected at purchase
        uint256 maxPayoutAmount; // USDT base units — the single fixed, binary payout amount (no partial/proportional payouts, per the strategy memo's v1 scope discipline)
        uint64 startTime;
        uint64 expiryTime;
        bytes32 protectionSessionId; // keccak256 of the off-chain ProtectionMonitoringSession.sessionId string — links back to the existing persisted session without storing any session history on-chain
        PolicyStatus status;
        bool settled; // explicit, independently-auditable claim guard alongside `status`
    }

    mapping(uint256 => Policy) public policies;
    uint256 public nextPolicyId = 1;

    /** Replay guard for settlement authorizations, independent of (and in addition to) the status-machine guard — build brief Task 9: "the settlement authorization must also be replay-protected." Keyed by the EIP-712 struct hash of the exact signed payload. */
    mapping(bytes32 => bool) public usedAuthorizations;

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------
    event PolicyPurchased(uint256 indexed policyId, address indexed owner, bytes32 indexed protectionSessionId, uint256 premiumAmount, uint256 maxPayoutAmount, uint64 expiryTime);
    event PolicyResolved(uint256 indexed policyId, bool eligible, int256 finalReferencePrice, uint64 settlementTimestamp);
    event PolicyClaimed(uint256 indexed policyId, address indexed owner, uint256 amount);
    event PolicyForceClosed(uint256 indexed policyId);
    event ReserveFunded(address indexed from, uint256 amount);
    event ReserveWithdrawn(address indexed to, uint256 amount);
    event TrustedSignerUpdated(address indexed newSigner);
    event MaxExposureCapUpdated(uint256 newCap);
    event PerUserCapUpdated(uint256 newCap);
    event OwnerUpdated(address indexed newOwner);

    // ------------------------------------------------------------------
    // EIP-712 settlement authorization — the one message type this
    // contract trusts from off-chain (build brief Task 7).
    // ------------------------------------------------------------------
    bytes32 private constant SETTLEMENT_AUTHORIZATION_TYPEHASH = keccak256(
        "SettlementAuthorization(uint256 policyId,bool eligible,int256 finalReferencePrice,uint64 settlementTimestamp,uint64 authorizationExpiry,uint256 nonce)"
    );

    struct SettlementAuthorization {
        uint256 policyId;
        bool eligible;
        int256 finalReferencePrice; // fixed-point, 1e8-scaled — carried for transparency/event logs only; the contract does not recompute any threshold from it
        uint64 settlementTimestamp;
        uint64 authorizationExpiry; // this SIGNED MESSAGE's own expiry — independent of the policy's expiry, so a stale authorization can't be replayed far in the future
        uint256 nonce;
    }

    constructor(address usdtAddress, address trustedSignerAddress, uint256 initialMaxExposureCap, uint256 initialPerUserCap)
        EIP712("WeekendGuardSettlement", "1")
    {
        require(usdtAddress != address(0), "WeekendGuard: zero usdt");
        require(trustedSignerAddress != address(0), "WeekendGuard: zero signer");
        owner = msg.sender;
        usdt = IERC20(usdtAddress);
        trustedSigner = trustedSignerAddress;
        maxExposureCap = initialMaxExposureCap;
        perUserCap = initialPerUserCap;
    }

    // ------------------------------------------------------------------
    // Reserve management (build brief Task 5 — pre-funded reserve).
    // ------------------------------------------------------------------

    /** Anyone may top up the reserve (a demo/dev wallet funding the pool before any policies are sold, per the brief's "Developer/demo reserve -> Protection contract" diagram). */
    function fundReserve(uint256 amount) external {
        require(amount > 0, "WeekendGuard: zero amount");
        usdt.safeTransferFrom(msg.sender, address(this), amount);
        totalReserve += amount;
        emit ReserveFunded(msg.sender, amount);
    }

    /** Owner-only, and capped so the owner can never withdraw below what's currently obligated to active policies — prevents the single biggest "admin privilege abuse" vector named in the brief's security checklist. */
    function withdrawReserve(uint256 amount, address to) external onlyOwner {
        require(to != address(0), "WeekendGuard: zero recipient");
        require(amount <= totalReserve - totalLockedForActivePolicies, "WeekendGuard: would breach active obligations");
        totalReserve -= amount;
        usdt.safeTransfer(to, amount);
        emit ReserveWithdrawn(to, amount);
    }

    function availableReserve() external view returns (uint256) {
        return totalReserve - totalLockedForActivePolicies;
    }

    // ------------------------------------------------------------------
    // Admin configuration.
    // ------------------------------------------------------------------
    function setTrustedSigner(address newSigner) external onlyOwner {
        require(newSigner != address(0), "WeekendGuard: zero signer");
        trustedSigner = newSigner;
        emit TrustedSignerUpdated(newSigner);
    }

    function setMaxExposureCap(uint256 newCap) external onlyOwner {
        maxExposureCap = newCap;
        emit MaxExposureCapUpdated(newCap);
    }

    function setPerUserCap(uint256 newCap) external onlyOwner {
        perUserCap = newCap;
        emit PerUserCapUpdated(newCap);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "WeekendGuard: zero owner");
        owner = newOwner;
        emit OwnerUpdated(newOwner);
    }

    // ------------------------------------------------------------------
    // Purchase (build brief Task 6). Only USDT ever moves into this
    // contract — never the tokenized stock itself.
    // ------------------------------------------------------------------
    struct PurchaseParams {
        string underlyingTicker;
        address tokenizedStockContract;
        Wrapper wrapper;
        uint256 coveredPositionValue;
        uint256 thresholdBps;
        uint256 premiumAmount;
        uint256 maxPayoutAmount;
        uint64 expiryTime;
        bytes32 protectionSessionId;
    }

    function purchaseProtection(PurchaseParams calldata p) external returns (uint256 policyId) {
        require(bytes(p.underlyingTicker).length > 0, "WeekendGuard: empty ticker");
        require(p.thresholdBps > 0 && p.thresholdBps <= 10_000, "WeekendGuard: bad threshold");
        require(p.coveredPositionValue > 0, "WeekendGuard: zero covered value");
        require(p.maxPayoutAmount > 0, "WeekendGuard: zero max payout");
        require(p.expiryTime > block.timestamp, "WeekendGuard: expiry in the past");
        require(p.protectionSessionId != bytes32(0), "WeekendGuard: missing session link");

        require(totalLockedForActivePolicies + p.maxPayoutAmount <= totalReserve, "WeekendGuard: insufficient reserve");
        require(totalLockedForActivePolicies + p.maxPayoutAmount <= maxExposureCap, "WeekendGuard: exceeds exposure cap");
        require(userActiveExposure[msg.sender] + p.maxPayoutAmount <= perUserCap, "WeekendGuard: exceeds per-user cap");

        if (p.premiumAmount > 0) {
            usdt.safeTransferFrom(msg.sender, address(this), p.premiumAmount);
            totalReserve += p.premiumAmount;
        }

        policyId = nextPolicyId++;
        policies[policyId] = Policy({
            owner: msg.sender,
            underlyingTicker: p.underlyingTicker,
            tokenizedStockContract: p.tokenizedStockContract,
            wrapper: p.wrapper,
            coveredPositionValue: p.coveredPositionValue,
            thresholdBps: p.thresholdBps,
            premiumAmount: p.premiumAmount,
            maxPayoutAmount: p.maxPayoutAmount,
            startTime: uint64(block.timestamp),
            expiryTime: p.expiryTime,
            protectionSessionId: p.protectionSessionId,
            status: PolicyStatus.ACTIVE,
            settled: false
        });

        totalLockedForActivePolicies += p.maxPayoutAmount;
        userActiveExposure[msg.sender] += p.maxPayoutAmount;

        emit PolicyPurchased(policyId, msg.sender, p.protectionSessionId, p.premiumAmount, p.maxPayoutAmount, p.expiryTime);
    }

    // ------------------------------------------------------------------
    // Settlement resolution (build brief Task 7/8/9).
    // ------------------------------------------------------------------

    function hashSettlementAuthorization(SettlementAuthorization calldata auth) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                SETTLEMENT_AUTHORIZATION_TYPEHASH,
                auth.policyId,
                auth.eligible,
                auth.finalReferencePrice,
                auth.settlementTimestamp,
                auth.authorizationExpiry,
                auth.nonce
            )
        );
        return _hashTypedDataV4(structHash);
    }

    /**
     * Resolves a policy using a signed authorization from `trustedSigner`.
     * Callable by anyone (typically the backend relayer, but permissionless
     * on purpose — the security property lives entirely in the signature,
     * not in who submits it). Fails closed on every malformed/stale/
     * mismatched/replayed input; never has an implicit "pay" branch.
     */
    function resolveSettlement(uint256 policyId, SettlementAuthorization calldata auth, bytes calldata signature) external {
        Policy storage policy = policies[policyId];
        require(policy.status == PolicyStatus.ACTIVE, "WeekendGuard: policy not active");
        require(auth.policyId == policyId, "WeekendGuard: policy id mismatch");
        require(block.timestamp >= policy.expiryTime, "WeekendGuard: not yet due");
        require(block.timestamp <= auth.authorizationExpiry, "WeekendGuard: authorization expired");

        bytes32 digest = hashSettlementAuthorization(auth);
        require(!usedAuthorizations[digest], "WeekendGuard: authorization already used");

        address recovered = ECDSA.recover(digest, signature);
        require(recovered == trustedSigner, "WeekendGuard: invalid signature");

        usedAuthorizations[digest] = true;

        if (auth.eligible) {
            policy.status = PolicyStatus.ELIGIBLE;
        } else {
            // Not eligible — no payout will ever happen for this policy, so
            // the reserve capacity it held can be released right away.
            totalLockedForActivePolicies -= policy.maxPayoutAmount;
            userActiveExposure[policy.owner] -= policy.maxPayoutAmount;
            policy.status = PolicyStatus.CLOSED_NO_PAYOUT;
        }

        emit PolicyResolved(policyId, auth.eligible, auth.finalReferencePrice, auth.settlementTimestamp);
    }

    /** Pull-payment claim — the policy owner actively withdraws their own payout. Effects before interaction (checks-effects-interactions) to minimize reentrancy surface even though USDT itself is a well-known, non-malicious token. */
    function claimPayout(uint256 policyId) external {
        Policy storage policy = policies[policyId];
        require(policy.owner == msg.sender, "WeekendGuard: not policy owner");
        require(policy.status == PolicyStatus.ELIGIBLE, "WeekendGuard: not eligible");
        require(!policy.settled, "WeekendGuard: already settled");
        require(policy.maxPayoutAmount <= totalReserve, "WeekendGuard: reserve insufficient");

        policy.settled = true;
        policy.status = PolicyStatus.CLAIMED;
        totalReserve -= policy.maxPayoutAmount;
        totalLockedForActivePolicies -= policy.maxPayoutAmount;
        userActiveExposure[policy.owner] -= policy.maxPayoutAmount;

        usdt.safeTransfer(msg.sender, policy.maxPayoutAmount);
        emit PolicyClaimed(policyId, msg.sender, policy.maxPayoutAmount);
    }

    /** Safety valve, not a backdoor: only reachable long after a policy's own expiry, and only ever closes with NO payout — never fabricates eligibility. Releases reserve capacity a non-responsive backend would otherwise lock forever. */
    function forceCloseExpired(uint256 policyId) external {
        Policy storage policy = policies[policyId];
        require(policy.status == PolicyStatus.ACTIVE, "WeekendGuard: policy not active");
        require(block.timestamp >= policy.expiryTime + FORCE_CLOSE_GRACE_PERIOD, "WeekendGuard: grace period not elapsed");

        policy.status = PolicyStatus.CLOSED_NO_PAYOUT;
        policy.settled = true;
        totalLockedForActivePolicies -= policy.maxPayoutAmount;
        userActiveExposure[policy.owner] -= policy.maxPayoutAmount;

        emit PolicyForceClosed(policyId);
    }

    function getPolicy(uint256 policyId) external view returns (Policy memory) {
        return policies[policyId];
    }
}
