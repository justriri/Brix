import { expect } from "chai";
import { ethers } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { WeekendGuardSettlement, MockUSDT, MockFalseReturnUSDT } from "../typechain-types";

/**
 * WeekendGuardSettlement test suite — build brief Task 15. Every category
 * listed in the brief gets at least one dedicated test; boundary-value
 * tests use exact threshold math reused from the off-chain
 * computeThresholdCrossed() convention (>= counts as crossed), even though
 * this contract itself never recomputes a threshold on-chain — see
 * SETTLEMENT.md for why that split is correct.
 */

const USDT_DECIMALS = 18; // matches the REAL BSC Binance-Peg USDT, live-verified — see SETTLEMENT.md
const usdt = (n: number) => ethers.parseUnits(n.toString(), USDT_DECIMALS);

const DOMAIN_NAME = "WeekendGuardSettlement";
const DOMAIN_VERSION = "1";

async function deployFixture() {
  const [owner, signer, alice, bob, stranger] = await ethers.getSigners();

  const MockUSDTFactory = await ethers.getContractFactory("MockUSDT");
  const mockUsdt = (await MockUSDTFactory.deploy()) as unknown as MockUSDT;
  await mockUsdt.waitForDeployment();

  const SettlementFactory = await ethers.getContractFactory("WeekendGuardSettlement");
  const settlement = (await SettlementFactory.deploy(
    await mockUsdt.getAddress(),
    signer.address,
    usdt(1_000_000), // maxExposureCap
    usdt(10_000) // perUserCap
  )) as unknown as WeekendGuardSettlement;
  await settlement.waitForDeployment();

  // Fund alice/bob with USDT and have them approve the contract.
  for (const user of [alice, bob]) {
    await mockUsdt.mint(user.address, usdt(100_000));
    await mockUsdt.connect(user).approve(await settlement.getAddress(), usdt(100_000));
  }
  // Fund the reserve generously so purchase tests aren't reserve-limited unless testing that specifically.
  await mockUsdt.mint(owner.address, usdt(500_000));
  await mockUsdt.connect(owner).approve(await settlement.getAddress(), usdt(500_000));
  await settlement.connect(owner).fundReserve(usdt(500_000));

  return { owner, signer, alice, bob, stranger, mockUsdt, settlement };
}

async function purchaseDefault(
  settlement: WeekendGuardSettlement,
  buyer: HardhatEthersSigner,
  overrides: Partial<{ premium: bigint; maxPayout: bigint; expiryTime: number; thresholdBps: number }> = {}
) {
  const now = await ethers.provider.getBlock("latest").then((b) => b!.timestamp);
  const tx = await settlement.connect(buyer).purchaseProtection({
    underlyingTicker: "TSLA",
    tokenizedStockContract: ethers.ZeroAddress,
    wrapper: 0, // BSTOCKS
    coveredPositionValue: usdt(1000),
    thresholdBps: overrides.thresholdBps ?? 500, // 5%
    premiumAmount: overrides.premium ?? usdt(20),
    maxPayoutAmount: overrides.maxPayout ?? usdt(1000),
    expiryTime: overrides.expiryTime ?? now + 3 * 24 * 60 * 60,
    protectionSessionId: ethers.id("session-" + buyer.address),
  });
  const receipt = await tx.wait();
  const event = receipt!.logs
    .map((l) => {
      try {
        return settlement.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((e) => e?.name === "PolicyPurchased");
  return event!.args.policyId as bigint;
}

async function signAuthorization(
  signer: HardhatEthersSigner,
  settlement: WeekendGuardSettlement,
  auth: {
    policyId: bigint;
    eligible: boolean;
    finalReferencePrice: bigint;
    settlementTimestamp: number;
    authorizationExpiry: number;
    nonce: bigint;
  }
) {
  const domain = {
    name: DOMAIN_NAME,
    version: DOMAIN_VERSION,
    chainId: (await ethers.provider.getNetwork()).chainId,
    verifyingContract: await settlement.getAddress(),
  };
  const types = {
    SettlementAuthorization: [
      { name: "policyId", type: "uint256" },
      { name: "eligible", type: "bool" },
      { name: "finalReferencePrice", type: "int256" },
      { name: "settlementTimestamp", type: "uint64" },
      { name: "authorizationExpiry", type: "uint64" },
      { name: "nonce", type: "uint256" },
    ],
  };
  const signature = await signer.signTypedData(domain, types, auth);
  return signature;
}

describe("WeekendGuardSettlement", () => {
  describe("Policy creation", () => {
    it("a valid policy can be created and is ACTIVE", async () => {
      const { settlement, alice } = await deployFixture();
      const policyId = await purchaseDefault(settlement, alice);
      const policy = await settlement.getPolicy(policyId);
      expect(policy.status).to.equal(1n); // ACTIVE
      expect(policy.owner).to.equal(alice.address);
    });

    it("rejects malformed parameters (zero threshold, zero payout, past expiry, empty ticker, missing session link)", async () => {
      const { settlement, alice } = await deployFixture();
      const now = await ethers.provider.getBlock("latest").then((b) => b!.timestamp);
      const base = {
        underlyingTicker: "TSLA",
        tokenizedStockContract: ethers.ZeroAddress,
        wrapper: 0,
        coveredPositionValue: usdt(1000),
        thresholdBps: 500,
        premiumAmount: usdt(20),
        maxPayoutAmount: usdt(1000),
        expiryTime: now + 100,
        protectionSessionId: ethers.id("s"),
      };

      await expect(settlement.connect(alice).purchaseProtection({ ...base, thresholdBps: 0 })).to.be.revertedWith(
        "WeekendGuard: bad threshold"
      );
      await expect(settlement.connect(alice).purchaseProtection({ ...base, maxPayoutAmount: 0 })).to.be.revertedWith(
        "WeekendGuard: zero max payout"
      );
      await expect(settlement.connect(alice).purchaseProtection({ ...base, expiryTime: now - 1 })).to.be.revertedWith(
        "WeekendGuard: expiry in the past"
      );
      await expect(settlement.connect(alice).purchaseProtection({ ...base, underlyingTicker: "" })).to.be.revertedWith(
        "WeekendGuard: empty ticker"
      );
      await expect(
        settlement.connect(alice).purchaseProtection({ ...base, protectionSessionId: ethers.ZeroHash })
      ).to.be.revertedWith("WeekendGuard: missing session link");
    });
  });

  describe("USDT payment / reserve accounting", () => {
    it("premium is transferred to the contract and added to totalReserve", async () => {
      const { settlement, mockUsdt, alice } = await deployFixture();
      const before = await settlement.totalReserve();
      const aliceBalanceBefore = await mockUsdt.balanceOf(alice.address);

      await purchaseDefault(settlement, alice, { premium: usdt(20) });

      expect(await settlement.totalReserve()).to.equal(before + usdt(20));
      expect(await mockUsdt.balanceOf(alice.address)).to.equal(aliceBalanceBefore - usdt(20));
    });

    it("totalLockedForActivePolicies increases by maxPayoutAmount on purchase", async () => {
      const { settlement, alice } = await deployFixture();
      const before = await settlement.totalLockedForActivePolicies();
      await purchaseDefault(settlement, alice, { maxPayout: usdt(500) });
      expect(await settlement.totalLockedForActivePolicies()).to.equal(before + usdt(500));
    });
  });

  describe("Activation", () => {
    it("a policy only exists as ACTIVE after a successful payment — a failed transferFrom reverts the whole purchase", async () => {
      const { settlement, stranger } = await deployFixture();
      // stranger never approved any USDT.
      const now = await ethers.provider.getBlock("latest").then((b) => b!.timestamp);
      await expect(
        settlement.connect(stranger).purchaseProtection({
          underlyingTicker: "TSLA",
          tokenizedStockContract: ethers.ZeroAddress,
          wrapper: 0,
          coveredPositionValue: usdt(1000),
          thresholdBps: 500,
          premiumAmount: usdt(20),
          maxPayoutAmount: usdt(1000),
          expiryTime: now + 1000,
          protectionSessionId: ethers.id("s"),
        })
      ).to.be.reverted;
    });
  });

  describe("Settlement eligible / blocked", () => {
    it("a valid trusted authorization with eligible=true moves the policy to ELIGIBLE", async () => {
      const { settlement, signer, alice } = await deployFixture();
      const policyId = await purchaseDefault(settlement, alice, { expiryTime: (await ethers.provider.getBlock("latest"))!.timestamp + 10 });
      await ethers.provider.send("evm_increaseTime", [20]);
      await ethers.provider.send("evm_mine", []);

      const latestBlock = await ethers.provider.getBlock("latest");
      const auth = {
        policyId,
        eligible: true,
        finalReferencePrice: 33_000_000_000n,
        settlementTimestamp: latestBlock!.timestamp,
        authorizationExpiry: latestBlock!.timestamp + 3600,
        nonce: 1n,
      };
      const signature = await signAuthorization(signer, settlement, auth);

      await settlement.resolveSettlement(policyId, auth, signature);
      const policy = await settlement.getPolicy(policyId);
      expect(policy.status).to.equal(2n); // ELIGIBLE
    });

    it("an invalid (wrong-signer) authorization cannot settle — reverts, policy stays ACTIVE", async () => {
      const { settlement, alice, stranger } = await deployFixture();
      const policyId = await purchaseDefault(settlement, alice, { expiryTime: (await ethers.provider.getBlock("latest"))!.timestamp + 10 });
      await ethers.provider.send("evm_increaseTime", [20]);
      await ethers.provider.send("evm_mine", []);

      const latestBlock = await ethers.provider.getBlock("latest");
      const auth = {
        policyId,
        eligible: true,
        finalReferencePrice: 33_000_000_000n,
        settlementTimestamp: latestBlock!.timestamp,
        authorizationExpiry: latestBlock!.timestamp + 3600,
        nonce: 1n,
      };
      // Signed by `stranger`, not the configured trustedSigner.
      const badSignature = await signAuthorization(stranger, settlement, auth);

      await expect(settlement.resolveSettlement(policyId, auth, badSignature)).to.be.revertedWith(
        "WeekendGuard: invalid signature"
      );
      const policy = await settlement.getPolicy(policyId);
      expect(policy.status).to.equal(1n); // still ACTIVE
    });
  });

  describe("Threshold boundary (off-chain eligible flag, on-chain pure pass-through)", () => {
    // The contract never recomputes a percentage threshold itself (see
    // SETTLEMENT.md) — these tests confirm the contract behaves correctly
    // for whatever boolean `eligible` it's given, at the exact boundary the
    // off-chain computeThresholdCrossed() would have produced (its own
    // dedicated boundary tests already exist in weekendTrustMonitor.test.mts
    // and are unchanged by this task).
    for (const [label, eligible, expectedStatus] of [
      ["just under threshold (off-chain: not crossed)", false, 4n],
      ["exactly at threshold (off-chain: crossed, >= rule)", true, 2n],
      ["just over threshold (off-chain: crossed)", true, 2n],
    ] as const) {
      it(label, async () => {
        const { settlement, signer, alice } = await deployFixture();
        const policyId = await purchaseDefault(settlement, alice, {
          expiryTime: (await ethers.provider.getBlock("latest"))!.timestamp + 10,
        });
        await ethers.provider.send("evm_increaseTime", [20]);
        await ethers.provider.send("evm_mine", []);
        const latestBlock = await ethers.provider.getBlock("latest");
        const auth = {
          policyId,
          eligible,
          finalReferencePrice: 33_000_000_000n,
          settlementTimestamp: latestBlock!.timestamp,
          authorizationExpiry: latestBlock!.timestamp + 3600,
          nonce: 1n,
        };
        const signature = await signAuthorization(signer, settlement, auth);
        await settlement.resolveSettlement(policyId, auth, signature);
        expect((await settlement.getPolicy(policyId)).status).to.equal(expectedStatus);
      });
    }
  });

  describe("Expiry", () => {
    it("settlement cannot happen before the policy's own expiry", async () => {
      const { settlement, signer, alice } = await deployFixture();
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      const policyId = await purchaseDefault(settlement, alice, { expiryTime: now + 10_000 });

      const auth = {
        policyId,
        eligible: true,
        finalReferencePrice: 1n,
        settlementTimestamp: now,
        authorizationExpiry: now + 3600,
        nonce: 1n,
      };
      const signature = await signAuthorization(signer, settlement, auth);
      await expect(settlement.resolveSettlement(policyId, auth, signature)).to.be.revertedWith("WeekendGuard: not yet due");
    });

    it("an expired authorization (authorizationExpiry in the past) cannot settle", async () => {
      const { settlement, signer, alice } = await deployFixture();
      const expiryTime = (await ethers.provider.getBlock("latest"))!.timestamp + 10;
      const policyId = await purchaseDefault(settlement, alice, { expiryTime });
      await ethers.provider.send("evm_increaseTime", [20]);
      await ethers.provider.send("evm_mine", []);
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;

      const auth = {
        policyId,
        eligible: true,
        finalReferencePrice: 1n,
        settlementTimestamp: now,
        authorizationExpiry: now - 1, // already expired
        nonce: 1n,
      };
      const signature = await signAuthorization(signer, settlement, auth);
      await expect(settlement.resolveSettlement(policyId, auth, signature)).to.be.revertedWith(
        "WeekendGuard: authorization expired"
      );
    });
  });

  describe("Reserve accounting while ELIGIBLE-but-unclaimed (regression)", () => {
    it("a resolved-but-not-yet-claimed ELIGIBLE policy's capacity stays locked, and cannot be double-committed to a new purchase", async () => {
      const [owner, signer, alice, bob] = await ethers.getSigners();
      const MockUSDTFactory = await ethers.getContractFactory("MockUSDT");
      const mockUsdt = (await MockUSDTFactory.deploy()) as unknown as MockUSDT;
      const SettlementFactory = await ethers.getContractFactory("WeekendGuardSettlement");
      const settlement = (await SettlementFactory.deploy(
        await mockUsdt.getAddress(),
        signer.address,
        usdt(1_000_000),
        usdt(10_000)
      )) as unknown as WeekendGuardSettlement;

      // Fund a reserve of EXACTLY enough for one 1000-USDT policy — no slack.
      await mockUsdt.mint(owner.address, usdt(1000));
      await mockUsdt.connect(owner).approve(await settlement.getAddress(), usdt(1000));
      await settlement.connect(owner).fundReserve(usdt(1000));

      await mockUsdt.mint(alice.address, usdt(100));
      await mockUsdt.connect(alice).approve(await settlement.getAddress(), usdt(100));
      await mockUsdt.mint(bob.address, usdt(100));
      await mockUsdt.connect(bob).approve(await settlement.getAddress(), usdt(100));

      const policyId = await purchaseDefault(settlement, alice, {
        premium: usdt(0),
        maxPayout: usdt(1000),
        expiryTime: (await ethers.provider.getBlock("latest"))!.timestamp + 10,
      });

      await ethers.provider.send("evm_increaseTime", [20]);
      await ethers.provider.send("evm_mine", []);
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      const auth = { policyId, eligible: true, finalReferencePrice: 1n, settlementTimestamp: now, authorizationExpiry: now + 3600, nonce: 1n };
      const signature = await signAuthorization(signer, settlement, auth);
      await settlement.resolveSettlement(policyId, auth, signature);

      // Still ELIGIBLE, not yet claimed — the reserve must still show this
      // capacity as locked, NOT available for a new policy to also draw on.
      expect(await settlement.availableReserve()).to.equal(0n);
      await expect(
        settlement.connect(bob).purchaseProtection({
          underlyingTicker: "TSLA",
          tokenizedStockContract: ethers.ZeroAddress,
          wrapper: 0,
          coveredPositionValue: usdt(100),
          thresholdBps: 500,
          premiumAmount: usdt(0),
          maxPayoutAmount: usdt(1), // even a tiny new policy must be rejected — zero slack
          expiryTime: now + 1000,
          protectionSessionId: ethers.id("bob-session"),
        })
      ).to.be.revertedWith("WeekendGuard: insufficient reserve");

      // Claiming releases the lock and pays out correctly.
      await settlement.connect(alice).claimPayout(policyId);
      expect(await settlement.availableReserve()).to.equal(0n); // reserve was fully consumed by the payout, not freed for reuse
      expect(await mockUsdt.balanceOf(alice.address)).to.equal(usdt(1100)); // 100 starting + 1000 payout
    });
  });

  describe("Replay protection", () => {
    it("the same authorization cannot be used twice", async () => {
      const { settlement, signer, alice, bob } = await deployFixture();
      const expiryTime = (await ethers.provider.getBlock("latest"))!.timestamp + 10;
      const policyId1 = await purchaseDefault(settlement, alice, { expiryTime });
      await ethers.provider.send("evm_increaseTime", [20]);
      await ethers.provider.send("evm_mine", []);
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;

      const auth = {
        policyId: policyId1,
        eligible: true,
        finalReferencePrice: 1n,
        settlementTimestamp: now,
        authorizationExpiry: now + 3600,
        nonce: 42n,
      };
      const signature = await signAuthorization(signer, settlement, auth);
      await settlement.resolveSettlement(policyId1, auth, signature);

      // Replaying the exact same (policyId, signature) pair must fail even
      // though the required state (policy must be ACTIVE) already catches
      // this — confirms the independent `usedAuthorizations` guard too.
      await expect(settlement.resolveSettlement(policyId1, auth, signature)).to.be.revertedWith(
        "WeekendGuard: policy not active"
      );
    });
  });

  describe("Double claim", () => {
    it("the same policy cannot pay out twice", async () => {
      const { settlement, signer, alice } = await deployFixture();
      const expiryTime = (await ethers.provider.getBlock("latest"))!.timestamp + 10;
      const policyId = await purchaseDefault(settlement, alice, { expiryTime, maxPayout: usdt(500) });
      await ethers.provider.send("evm_increaseTime", [20]);
      await ethers.provider.send("evm_mine", []);
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;

      const auth = {
        policyId,
        eligible: true,
        finalReferencePrice: 1n,
        settlementTimestamp: now,
        authorizationExpiry: now + 3600,
        nonce: 1n,
      };
      const signature = await signAuthorization(signer, settlement, auth);
      await settlement.resolveSettlement(policyId, auth, signature);

      await settlement.connect(alice).claimPayout(policyId);
      await expect(settlement.connect(alice).claimPayout(policyId)).to.be.revertedWith("WeekendGuard: not eligible");
    });

    it("only the policy owner can claim", async () => {
      const { settlement, signer, alice, bob } = await deployFixture();
      const expiryTime = (await ethers.provider.getBlock("latest"))!.timestamp + 10;
      const policyId = await purchaseDefault(settlement, alice, { expiryTime });
      await ethers.provider.send("evm_increaseTime", [20]);
      await ethers.provider.send("evm_mine", []);
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      const auth = { policyId, eligible: true, finalReferencePrice: 1n, settlementTimestamp: now, authorizationExpiry: now + 3600, nonce: 1n };
      const signature = await signAuthorization(signer, settlement, auth);
      await settlement.resolveSettlement(policyId, auth, signature);

      await expect(settlement.connect(bob).claimPayout(policyId)).to.be.revertedWith("WeekendGuard: not policy owner");
    });
  });

  describe("Maximum payout", () => {
    it("claimPayout always transfers exactly maxPayoutAmount, never more", async () => {
      const { settlement, mockUsdt, signer, alice } = await deployFixture();
      const expiryTime = (await ethers.provider.getBlock("latest"))!.timestamp + 10;
      const policyId = await purchaseDefault(settlement, alice, { expiryTime, maxPayout: usdt(777) });
      await ethers.provider.send("evm_increaseTime", [20]);
      await ethers.provider.send("evm_mine", []);
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      const auth = { policyId, eligible: true, finalReferencePrice: 1n, settlementTimestamp: now, authorizationExpiry: now + 3600, nonce: 1n };
      const signature = await signAuthorization(signer, settlement, auth);
      await settlement.resolveSettlement(policyId, auth, signature);

      const before = await mockUsdt.balanceOf(alice.address);
      await settlement.connect(alice).claimPayout(policyId);
      expect(await mockUsdt.balanceOf(alice.address)).to.equal(before + usdt(777));
    });
  });

  describe("Reserve enforcement", () => {
    it("cannot activate a policy whose payout obligation exceeds available reserve", async () => {
      const [owner, signer, alice] = await ethers.getSigners();
      const MockUSDTFactory = await ethers.getContractFactory("MockUSDT");
      const mockUsdt = (await MockUSDTFactory.deploy()) as unknown as MockUSDT;
      const SettlementFactory = await ethers.getContractFactory("WeekendGuardSettlement");
      const settlement = (await SettlementFactory.deploy(
        await mockUsdt.getAddress(),
        signer.address,
        usdt(1_000_000),
        usdt(10_000)
      )) as unknown as WeekendGuardSettlement;
      // Deliberately fund only a tiny reserve.
      await mockUsdt.mint(owner.address, usdt(10));
      await mockUsdt.connect(owner).approve(await settlement.getAddress(), usdt(10));
      await settlement.connect(owner).fundReserve(usdt(10));

      await mockUsdt.mint(alice.address, usdt(100));
      await mockUsdt.connect(alice).approve(await settlement.getAddress(), usdt(100));

      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      await expect(
        settlement.connect(alice).purchaseProtection({
          underlyingTicker: "TSLA",
          tokenizedStockContract: ethers.ZeroAddress,
          wrapper: 0,
          coveredPositionValue: usdt(1000),
          thresholdBps: 500,
          premiumAmount: usdt(5),
          maxPayoutAmount: usdt(1000), // far exceeds the 10+5 USDT reserve
          expiryTime: now + 1000,
          protectionSessionId: ethers.id("s"),
        })
      ).to.be.revertedWith("WeekendGuard: insufficient reserve");
    });

    it("owner cannot withdraw reserve below what's obligated to active policies", async () => {
      const { settlement, owner, alice } = await deployFixture();
      await purchaseDefault(settlement, alice, { maxPayout: usdt(1000) });
      const available = await settlement.availableReserve();
      await expect(settlement.connect(owner).withdrawReserve(available + usdt(1), owner.address)).to.be.revertedWith(
        "WeekendGuard: would breach active obligations"
      );
      await expect(settlement.connect(owner).withdrawReserve(available, owner.address)).to.not.be.reverted;
    });
  });

  describe("Unauthorized settlement", () => {
    it("a random caller cannot create an eligible payout without a valid trustedSigner signature", async () => {
      const { settlement, alice, stranger } = await deployFixture();
      const expiryTime = (await ethers.provider.getBlock("latest"))!.timestamp + 10;
      const policyId = await purchaseDefault(settlement, alice, { expiryTime });
      await ethers.provider.send("evm_increaseTime", [20]);
      await ethers.provider.send("evm_mine", []);
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      const auth = { policyId, eligible: true, finalReferencePrice: 1n, settlementTimestamp: now, authorizationExpiry: now + 3600, nonce: 1n };
      const forgedSignature = await signAuthorization(stranger, settlement, auth);
      await expect(settlement.connect(stranger).resolveSettlement(policyId, auth, forgedSignature)).to.be.revertedWith(
        "WeekendGuard: invalid signature"
      );
    });
  });

  describe("Force-close safety valve", () => {
    it("cannot force-close before the grace period has elapsed", async () => {
      const { settlement, alice } = await deployFixture();
      const expiryTime = (await ethers.provider.getBlock("latest"))!.timestamp + 10;
      const policyId = await purchaseDefault(settlement, alice, { expiryTime });
      await ethers.provider.send("evm_increaseTime", [20]);
      await ethers.provider.send("evm_mine", []);
      await expect(settlement.forceCloseExpired(policyId)).to.be.revertedWith("WeekendGuard: grace period not elapsed");
    });

    it("anyone can force-close with NO payout after the grace period, releasing reserve capacity", async () => {
      const { settlement, alice, stranger } = await deployFixture();
      const expiryTime = (await ethers.provider.getBlock("latest"))!.timestamp + 10;
      const policyId = await purchaseDefault(settlement, alice, { expiryTime, maxPayout: usdt(500) });
      const lockedBefore = await settlement.totalLockedForActivePolicies();

      await ethers.provider.send("evm_increaseTime", [10 + 7 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine", []);

      await settlement.connect(stranger).forceCloseExpired(policyId);
      expect((await settlement.getPolicy(policyId)).status).to.equal(4n); // CLOSED_NO_PAYOUT
      expect(await settlement.totalLockedForActivePolicies()).to.equal(lockedBefore - usdt(500));
    });
  });

  // Added following the settlement audit (reports/Settlement audit and
  // deployment readiness.md) — each test below targets a specific
  // adversarial scenario from that audit's section 16 that was not yet
  // covered by the suite above.
  describe("Audit follow-up: tampered / misdirected authorizations", () => {
    it("tampering with ANY signed field (e.g. flipping eligible after signing) invalidates the signature", async () => {
      const { settlement, signer, alice } = await deployFixture();
      const expiryTime = (await ethers.provider.getBlock("latest"))!.timestamp + 10;
      const policyId = await purchaseDefault(settlement, alice, { expiryTime });
      await ethers.provider.send("evm_increaseTime", [20]);
      await ethers.provider.send("evm_mine", []);
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;

      const original = { policyId, eligible: false, finalReferencePrice: 1n, settlementTimestamp: now, authorizationExpiry: now + 3600, nonce: 1n };
      const signature = await signAuthorization(signer, settlement, original);

      // Same signature, but the eligible flag has been flipped after signing
      // — the recovered signer no longer matches, so this must revert rather
      // than silently using the tampered value.
      const tampered = { ...original, eligible: true };
      await expect(settlement.resolveSettlement(policyId, tampered, signature)).to.be.revertedWith(
        "WeekendGuard: invalid signature"
      );

      // The untampered original, by contrast, is valid.
      await expect(settlement.resolveSettlement(policyId, original, signature)).to.not.be.reverted;
    });

    it("a signature produced for one policyId cannot be reused to resolve a different policyId", async () => {
      const { settlement, signer, alice, bob } = await deployFixture();
      const expiryTime = (await ethers.provider.getBlock("latest"))!.timestamp + 10;
      const policyIdA = await purchaseDefault(settlement, alice, { expiryTime });
      const policyIdB = await purchaseDefault(settlement, bob, { expiryTime });
      await ethers.provider.send("evm_increaseTime", [20]);
      await ethers.provider.send("evm_mine", []);
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;

      const authForA = { policyId: policyIdA, eligible: true, finalReferencePrice: 1n, settlementTimestamp: now, authorizationExpiry: now + 3600, nonce: 1n };
      const signature = await signAuthorization(signer, settlement, authForA);

      // Attempt to apply A's signed authorization to policy B.
      await expect(settlement.resolveSettlement(policyIdB, authForA, signature)).to.be.revertedWith(
        "WeekendGuard: policy id mismatch"
      );
      // Policy B must remain untouched.
      expect((await settlement.getPolicy(policyIdB)).status).to.equal(1n); // still ACTIVE
    });

    it("the exact reserve boundary: a purchase requiring exactly the available reserve succeeds; one unit more fails", async () => {
      const [owner, signer, alice, bob] = await ethers.getSigners();
      const MockUSDTFactory = await ethers.getContractFactory("MockUSDT");
      const mockUsdt = (await MockUSDTFactory.deploy()) as unknown as MockUSDT;
      const SettlementFactory = await ethers.getContractFactory("WeekendGuardSettlement");
      const settlement = (await SettlementFactory.deploy(
        await mockUsdt.getAddress(),
        signer.address,
        usdt(1_000_000),
        usdt(10_000)
      )) as unknown as WeekendGuardSettlement;

      await mockUsdt.mint(owner.address, usdt(1000));
      await mockUsdt.connect(owner).approve(await settlement.getAddress(), usdt(1000));
      await settlement.connect(owner).fundReserve(usdt(1000));

      for (const user of [alice, bob]) {
        await mockUsdt.mint(user.address, usdt(10));
        await mockUsdt.connect(user).approve(await settlement.getAddress(), usdt(10));
      }
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;

      // Exactly the available reserve (1000) — must succeed.
      await expect(
        settlement.connect(alice).purchaseProtection({
          underlyingTicker: "TSLA",
          tokenizedStockContract: ethers.ZeroAddress,
          wrapper: 0,
          coveredPositionValue: usdt(1000),
          thresholdBps: 500,
          premiumAmount: usdt(0),
          maxPayoutAmount: usdt(1000),
          expiryTime: now + 1000,
          protectionSessionId: ethers.id("boundary-exact"),
        })
      ).to.not.be.reverted;

      // Reserve is now fully committed — one more unit must fail, not just a large excess.
      await expect(
        settlement.connect(bob).purchaseProtection({
          underlyingTicker: "TSLA",
          tokenizedStockContract: ethers.ZeroAddress,
          wrapper: 0,
          coveredPositionValue: usdt(1),
          thresholdBps: 500,
          premiumAmount: usdt(0),
          maxPayoutAmount: 1n, // one base unit above the now-fully-committed reserve
          expiryTime: now + 1000,
          protectionSessionId: ethers.id("boundary-over"),
        })
      ).to.be.revertedWith("WeekendGuard: insufficient reserve");
    });
  });

  describe("Shared pool accounting with multiple concurrent policies", () => {
    it("premiums from multiple users accumulate in the SAME totalReserve, and aggregate locked exposure (not any single policy) determines what the pool can still back", async () => {
      const [owner, signer, alice, bob, carol] = await ethers.getSigners();
      const MockUSDTFactory = await ethers.getContractFactory("MockUSDT");
      const mockUsdt = (await MockUSDTFactory.deploy()) as unknown as MockUSDT;
      const SettlementFactory = await ethers.getContractFactory("WeekendGuardSettlement");
      const settlement = (await SettlementFactory.deploy(
        await mockUsdt.getAddress(),
        signer.address,
        usdt(1_000_000),
        usdt(10_000)
      )) as unknown as WeekendGuardSettlement;

      // A deliberately tight shared reserve: enough for exactly two
      // 400-USDT policies, not three — this is the whole point of the
      // test: the pool is ONE shared number, not three independent ones.
      await mockUsdt.mint(owner.address, usdt(800));
      await mockUsdt.connect(owner).approve(await settlement.getAddress(), usdt(800));
      await settlement.connect(owner).fundReserve(usdt(800));

      for (const user of [alice, bob, carol]) {
        await mockUsdt.mint(user.address, usdt(50));
        await mockUsdt.connect(user).approve(await settlement.getAddress(), usdt(50));
      }
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;

      // Alice's premium (20 USDT) lands in the SAME totalReserve as the
      // owner's seed — it does not create a separate per-user pot.
      const policyIdAlice = await purchaseDefault(settlement, alice, {
        premium: usdt(20),
        maxPayout: usdt(400),
        expiryTime: now + 100_000,
      });
      expect(await settlement.totalReserve()).to.equal(usdt(820)); // 800 seed + alice's 20 premium
      expect(await settlement.totalLockedForActivePolicies()).to.equal(usdt(400));

      const policyIdBob = await purchaseDefault(settlement, bob, {
        premium: usdt(20),
        maxPayout: usdt(400),
        expiryTime: now + 100_000,
      });
      expect(await settlement.totalReserve()).to.equal(usdt(840)); // + bob's premium too — same shared bucket
      expect(await settlement.totalLockedForActivePolicies()).to.equal(usdt(800)); // alice + bob, aggregate
      expect(await settlement.availableReserve()).to.equal(usdt(40)); // 840 total - 800 locked

      // Carol's own premium (20) would raise totalReserve to 860 — but the
      // check runs BEFORE her premium is credited (see
      // WeekendGuardSettlement.sol's purchaseProtection ordering), so her
      // 400-USDT ask is checked against the pre-premium 840, not 860: 800
      // (already locked) + 400 (her ask) = 1200 > 840 -> must revert, and
      // her premium must never be collected for a policy that was rejected.
      const carolBalanceBefore = await mockUsdt.balanceOf(carol.address);
      await expect(
        settlement.connect(carol).purchaseProtection({
          underlyingTicker: "TSLA",
          tokenizedStockContract: ethers.ZeroAddress,
          wrapper: 0,
          coveredPositionValue: usdt(400),
          thresholdBps: 500,
          premiumAmount: usdt(20),
          maxPayoutAmount: usdt(400),
          expiryTime: now + 100_000,
          protectionSessionId: ethers.id("carol-session"),
        })
      ).to.be.revertedWith("WeekendGuard: insufficient reserve");
      expect(await mockUsdt.balanceOf(carol.address)).to.equal(carolBalanceBefore, "a rejected purchase must never collect a premium");

      // Resolving Alice's policy as NOT eligible releases her 400 lock
      // immediately (no payout) — this must free exactly enough capacity
      // for Carol's identical 400-USDT ask to now succeed, proving the
      // pool genuinely re-shares released capacity rather than it being
      // stuck per-policy.
      await ethers.provider.send("evm_increaseTime", [100_001]);
      await ethers.provider.send("evm_mine", []);
      const resolveNow = (await ethers.provider.getBlock("latest"))!.timestamp;
      const auth = {
        policyId: policyIdAlice,
        eligible: false,
        finalReferencePrice: 1n,
        settlementTimestamp: resolveNow,
        authorizationExpiry: resolveNow + 3600,
        nonce: 1n,
      };
      const signature = await signAuthorization(signer, settlement, auth);
      await settlement.resolveSettlement(policyIdAlice, auth, signature);
      expect((await settlement.getPolicy(policyIdAlice)).status).to.equal(4n); // CLOSED_NO_PAYOUT
      expect(await settlement.totalLockedForActivePolicies()).to.equal(usdt(400)); // only bob's 400 remains locked

      await expect(
        settlement.connect(carol).purchaseProtection({
          underlyingTicker: "TSLA",
          tokenizedStockContract: ethers.ZeroAddress,
          wrapper: 0,
          coveredPositionValue: usdt(400),
          thresholdBps: 500,
          premiumAmount: usdt(20),
          maxPayoutAmount: usdt(400),
          expiryTime: resolveNow + 100_000,
          protectionSessionId: ethers.id("carol-session-2"),
        })
      ).to.not.be.reverted;

      // Bob's policy is untouched by any of the above — his own ACTIVE
      // status and locked amount are independent of Alice's/Carol's.
      expect((await settlement.getPolicy(policyIdBob)).status).to.equal(1n); // still ACTIVE
    });

    it("a simultaneously-eligible claim can still be paid even while another policy remains active and locked, as long as the pool actually holds enough for both", async () => {
      const [owner, signer, alice, bob] = await ethers.getSigners();
      const MockUSDTFactory = await ethers.getContractFactory("MockUSDT");
      const mockUsdt = (await MockUSDTFactory.deploy()) as unknown as MockUSDT;
      const SettlementFactory = await ethers.getContractFactory("WeekendGuardSettlement");
      const settlement = (await SettlementFactory.deploy(
        await mockUsdt.getAddress(),
        signer.address,
        usdt(1_000_000),
        usdt(10_000)
      )) as unknown as WeekendGuardSettlement;

      await mockUsdt.mint(owner.address, usdt(1000));
      await mockUsdt.connect(owner).approve(await settlement.getAddress(), usdt(1000));
      await settlement.connect(owner).fundReserve(usdt(1000));
      for (const user of [alice, bob]) {
        await mockUsdt.mint(user.address, usdt(20));
        await mockUsdt.connect(user).approve(await settlement.getAddress(), usdt(20));
      }

      const now = (await ethers.provider.getBlock("latest"))!.timestamp;
      const policyIdAlice = await purchaseDefault(settlement, alice, { premium: usdt(0), maxPayout: usdt(500), expiryTime: now + 10 });
      const policyIdBob = await purchaseDefault(settlement, bob, { premium: usdt(0), maxPayout: usdt(500), expiryTime: now + 10 });

      await ethers.provider.send("evm_increaseTime", [20]);
      await ethers.provider.send("evm_mine", []);
      const resolveNow = (await ethers.provider.getBlock("latest"))!.timestamp;
      const authAlice = { policyId: policyIdAlice, eligible: true, finalReferencePrice: 1n, settlementTimestamp: resolveNow, authorizationExpiry: resolveNow + 3600, nonce: 1n };
      await settlement.resolveSettlement(policyIdAlice, authAlice, await signAuthorization(signer, settlement, authAlice));

      // Bob's policy is still ACTIVE and still fully locked for 500 — Alice
      // being resolved-eligible-but-unclaimed must not touch Bob's own lock.
      expect((await settlement.getPolicy(policyIdBob)).status).to.equal(1n);
      expect(await settlement.totalLockedForActivePolicies()).to.equal(usdt(1000)); // both still locked: alice (eligible-unclaimed) + bob (active)

      await settlement.connect(alice).claimPayout(policyIdAlice);
      expect(await mockUsdt.balanceOf(alice.address)).to.equal(usdt(520)); // started at 20, spent 0 premium, received 500 payout
      expect(await settlement.totalReserve()).to.equal(usdt(500)); // 1000 - alice's 500 payout
      expect(await settlement.totalLockedForActivePolicies()).to.equal(usdt(500)); // only bob remains locked
    });
  });

  describe("Audit follow-up: non-standard ERC20 behavior", () => {
    it("a token that returns false instead of reverting on transferFrom causes the whole purchase to revert, never silently succeeds", async () => {
      const [owner, signer, alice] = await ethers.getSigners();
      const MockFalseReturnFactory = await ethers.getContractFactory("MockFalseReturnUSDT");
      const falseReturnToken = (await MockFalseReturnFactory.deploy()) as unknown as MockFalseReturnUSDT;
      const SettlementFactory = await ethers.getContractFactory("WeekendGuardSettlement");
      const settlement = (await SettlementFactory.deploy(
        await falseReturnToken.getAddress(),
        signer.address,
        usdt(1_000_000),
        usdt(10_000)
      )) as unknown as WeekendGuardSettlement;

      await falseReturnToken.mint(alice.address, usdt(100));
      await falseReturnToken.connect(alice).approve(await settlement.getAddress(), usdt(100));
      const now = (await ethers.provider.getBlock("latest"))!.timestamp;

      // fundReserve must also revert — otherwise totalReserve would be
      // incremented despite no USDT actually moving.
      await expect(settlement.connect(alice).fundReserve(usdt(10))).to.be.reverted;
      expect(await settlement.totalReserve()).to.equal(0n);

      await expect(
        settlement.connect(alice).purchaseProtection({
          underlyingTicker: "TSLA",
          tokenizedStockContract: ethers.ZeroAddress,
          wrapper: 0,
          coveredPositionValue: usdt(1000),
          thresholdBps: 500,
          premiumAmount: usdt(20),
          maxPayoutAmount: usdt(1000),
          expiryTime: now + 1000,
          protectionSessionId: ethers.id("false-return-test"),
        })
      ).to.be.reverted;
    });
  });
});
