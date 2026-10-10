"use client";

import { useState } from "react";
import { notFound } from "next/navigation";
import type { CheckResult, SafetyGateResult, SafetyGateStatus, Wrapper } from "@/lib/types";

/**
 * REAL MAINNET SETTLEMENT TEST HARNESS — not part of the product, not
 * linked from any nav. Exists for exactly one purpose: drive the EXISTING,
 * unmodified off-chain session lifecycle (startProtectionSession ->
 * recordTrustCheckpoint -> evaluateProtectionSettlement, via the existing
 * dev-only POST /api/dev/protection-session route) so the full on-chain
 * settlement machinery can be exercised end-to-end without waiting for a
 * real protection period.
 *
 * Two checkpoint-data modes, both already-existing capabilities of the
 * dev route (see its own doc comment — "a raw `snapshot` object... for
 * reproducing named scenarios with mocked/simulated data" vs
 * "`useRealSnapshot`... live data"), not something invented for this task:
 *
 *  - "Live" — fetches a REAL snapshot each time; whether the test reaches
 *    SETTLEMENT_ELIGIBLE then depends on real reference-price movement
 *    between Friday and Monday, which may or may not happen within a
 *    short test window.
 *  - "Deterministic" (default here) — supplies a directly-constructed
 *    TrustSnapshot (PASS at every checkpoint, a controlled, repeatable
 *    Friday->Monday reference-price drop). This controls ONE off-chain
 *    input only. It changes nothing about the contract, the EIP-712
 *    signing, the trusted signer, replay protection, reserve accounting,
 *    exposure limits, or the resolve/claim flow — none of that sees this
 *    page at all. The contract only ever trusts a validly-signed
 *    authorization; by design (see the contract's own header comment) it
 *    has no concept of "real" vs "test" price data — that distinction is
 *    entirely the off-chain system's responsibility, same as it always
 *    was. The resulting signature, on-chain resolution, and USDT payout
 *    are all 100% real.
 *
 * This page sends ZERO wallet transactions and holds no private key — it
 * only makes plain fetch() calls to this app's own already-existing dev
 * route. Every on-chain step still happens through the existing real UI
 * (BuySpotPanel / SettlementDemo), which is where the wallet signs.
 */

const SUPPORTED_TICKERS = ["TSLA", "AAPL", "NVDA"] as const;
const CHECKPOINTS = ["saturday", "sunday", "monday"] as const;

interface SessionSnapshot {
  checkpoint: string;
  timestamp: number;
  safetyGateResult: { status: string; primaryReference?: { price: number } };
}

interface SessionState {
  sessionId: string;
  status: string;
  trustContinuity: { status: string; brokenAt?: string };
  fridaySnapshot: SessionSnapshot;
  checkpoints: SessionSnapshot[];
  settlement?: { outcome: string; reason: string };
}

function checkResult(passed: boolean): CheckResult {
  return { id: "check", label: "check", passed, severity: "hard", message: "deterministic test checkpoint — not live market data" };
}

/** Mirrors ProtectionSessionDemo.tsx's own fixture-building helper exactly — same shape, same convention, just parameterized for this harness. */
function buildDeterministicSnapshot(params: {
  underlying: string;
  wrapper: Wrapper;
  status: SafetyGateStatus;
  referencePrice: number;
}) {
  const hardPass = params.status !== "FAIL";
  const result: SafetyGateResult = {
    status: params.status,
    underlying: params.underlying,
    wrapper: params.wrapper,
    checks: {
      liquidity: checkResult(hardPass),
      priceFreshness: checkResult(hardPass),
      referenceDeviation: checkResult(hardPass),
      marketStatus: checkResult(hardPass),
      crossWrapperConsistency: checkResult(params.status === "PASS"),
    },
    primaryReference: { name: "Deterministic test reference", price: params.referencePrice, publishTimeSec: Math.floor(Date.now() / 1000) },
    reasons: params.status === "PASS" ? ["Deterministic test checkpoint — trust held by construction."] : ["Deterministic test checkpoint — constructed to fail trust."],
    timestamp: Date.now(),
  };
  return result;
}

export default function TestHarnessPage() {
  // Real mainnet test harness — never part of the production experience.
  // The dev-only API route it calls (/api/dev/protection-session) is also
  // independently gated (devOnlyGuardResponse()), so this is defense in
  // depth: even a direct, un-rendered fetch to that route would already
  // 404 in production; this keeps the PAGE itself from even rendering.
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const [mode, setMode] = useState<"deterministic" | "live">("deterministic");
  const [sessionId, setSessionId] = useState(() => `TEST-${Date.now()}`);
  const [ticker, setTicker] = useState<(typeof SUPPORTED_TICKERS)[number]>("TSLA");
  const [wrapper, setWrapper] = useState<Wrapper>("bstocks");
  const [thresholdPercent, setThresholdPercent] = useState("5");
  const [fridayPrice, setFridayPrice] = useState("1000");
  const [mondayPrice, setMondayPrice] = useState("900");
  const [session, setSession] = useState<SessionState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(op: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/dev/protection-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op, sessionId, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed.");
      setSession(data.session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  function snapshotInputFor(checkpoint: string) {
    if (mode === "live") return { useRealSnapshot: { ticker, checkpoint } };
    // Deterministic: PASS at every checkpoint (trust intact by construction);
    // only Friday and Monday carry a reference price, since that's the only
    // comparison computeThresholdCrossed() ever makes — the drop between
    // fridayPrice and mondayPrice is exactly what you set below, every time.
    const referencePrice = checkpoint === "friday" ? Number(fridayPrice) : checkpoint === "monday" ? Number(mondayPrice) : undefined;
    return { snapshot: { checkpoint, timestamp: Date.now(), safetyGateResult: buildDeterministicSnapshot({ underlying: ticker, wrapper, status: "PASS", referencePrice: referencePrice ?? Number(fridayPrice) }) } };
  }

  const nextCheckpoint = CHECKPOINTS.find((cp) => !session?.checkpoints.some((c) => c.checkpoint === cp));
  const impliedDropPercent = ((Number(fridayPrice) - Number(mondayPrice)) / Number(fridayPrice)) * 100;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6 rounded-xl border border-red-500/40 bg-red-500/10 p-4">
        <p className="font-bold text-red-400">REAL MAINNET TEST HARNESS</p>
        <p className="mt-1 text-sm text-red-300">
          Not part of BRIX&apos;s product UI. Drives the real off-chain settlement decision pipeline. Sends no
          transactions itself — copy the Session ID below into SettlementDemo&apos;s on-chain steps once this
          reaches SETTLED.
        </p>
      </div>

      <div className="mb-4 flex gap-2 text-sm">
        <button type="button" onClick={() => setMode("deterministic")} className={`rounded border px-3 py-1.5 ${mode === "deterministic" ? "border-emerald-500 text-emerald-400" : "border-zinc-700"}`}>
          Deterministic (recommended)
        </button>
        <button type="button" onClick={() => setMode("live")} className={`rounded border px-3 py-1.5 ${mode === "live" ? "border-emerald-500 text-emerald-400" : "border-zinc-700"}`}>
          Live real data (not guaranteed to cross threshold in time)
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <label className="flex flex-col gap-1">
          Session ID
          <input value={sessionId} onChange={(e) => setSessionId(e.target.value)} className="rounded border border-zinc-700 bg-transparent px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1">
          Ticker
          <select value={ticker} onChange={(e) => setTicker(e.target.value as (typeof SUPPORTED_TICKERS)[number])} className="rounded border border-zinc-700 bg-transparent px-2 py-1">
            {SUPPORTED_TICKERS.map((t) => (
              <option key={t} value={t} className="bg-zinc-900">
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Wrapper
          <select value={wrapper} onChange={(e) => setWrapper(e.target.value as Wrapper)} className="rounded border border-zinc-700 bg-transparent px-2 py-1">
            <option value="bstocks" className="bg-zinc-900">bstocks</option>
            <option value="ondo" className="bg-zinc-900">ondo</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Threshold %
          <input value={thresholdPercent} onChange={(e) => setThresholdPercent(e.target.value)} className="rounded border border-zinc-700 bg-transparent px-2 py-1" />
        </label>
        {mode === "deterministic" && (
          <>
            <label className="flex flex-col gap-1">
              Friday reference price
              <input value={fridayPrice} onChange={(e) => setFridayPrice(e.target.value)} className="rounded border border-zinc-700 bg-transparent px-2 py-1" />
            </label>
            <label className="flex flex-col gap-1">
              Monday reference price
              <input value={mondayPrice} onChange={(e) => setMondayPrice(e.target.value)} className="rounded border border-zinc-700 bg-transparent px-2 py-1" />
            </label>
          </>
        )}
      </div>

      {mode === "deterministic" && (
        <p className="mt-2 text-xs text-zinc-500">
          Implied drop: {impliedDropPercent.toFixed(2)}% {impliedDropPercent >= Number(thresholdPercent) ? "— will cross threshold (SETTLEMENT_ELIGIBLE)" : "— will NOT cross threshold (NO_PAYOUT)"}.
          Every checkpoint is constructed as Safety-Gate PASS, so trust continuity holds by construction too.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        <button
          type="button"
          disabled={busy || Boolean(session)}
          onClick={() =>
            call("start", {
              underlying: ticker,
              wrapper,
              expiresAt: Date.now() + 86400000,
              thresholdPercent: Number(thresholdPercent),
              ...snapshotInputFor("friday"),
            })
          }
          className="rounded border border-zinc-700 px-3 py-1.5 disabled:opacity-40"
        >
          Start (Friday)
        </button>

        {CHECKPOINTS.map((cp) => (
          <button
            key={cp}
            type="button"
            disabled={busy || !session || session.status !== "ACTIVE" || nextCheckpoint !== cp}
            onClick={() => call("checkpoint", snapshotInputFor(cp))}
            className="rounded border border-zinc-700 px-3 py-1.5 capitalize disabled:opacity-40"
          >
            Checkpoint: {cp}
          </button>
        ))}

        <button
          type="button"
          disabled={busy || !session || session.status !== "ACTIVE" || !session.checkpoints.some((c) => c.checkpoint === "monday")}
          onClick={() => call("settle")}
          className="rounded border border-emerald-600 px-3 py-1.5 text-emerald-400 disabled:opacity-40"
        >
          Evaluate settlement
        </button>

        <button type="button" disabled={busy} onClick={() => call("get")} className="rounded border border-zinc-700 px-3 py-1.5 disabled:opacity-40">
          Refresh
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      {session && (
        <div className="mt-4 rounded-lg border border-zinc-700 p-4 text-sm">
          <p>
            Status: <strong>{session.status}</strong> · Trust continuity: <strong>{session.trustContinuity.status}</strong>
            {session.trustContinuity.brokenAt && <> (broken at {session.trustContinuity.brokenAt})</>}
          </p>
          <ul className="mt-2 space-y-1">
            <li>
              Friday: {session.fridaySnapshot.safetyGateResult.status} · ref price{" "}
              {session.fridaySnapshot.safetyGateResult.primaryReference?.price ?? "unavailable"}
            </li>
            {session.checkpoints.map((c, i) => (
              <li key={i} className="capitalize">
                {c.checkpoint}: {c.safetyGateResult.status} · ref price {c.safetyGateResult.primaryReference?.price ?? "unavailable"}
              </li>
            ))}
          </ul>
          {session.settlement && (
            <div className="mt-3 rounded border border-zinc-600 p-2">
              <p className="font-semibold">Settlement outcome: {session.settlement.outcome}</p>
              <p className="text-xs text-zinc-400">{session.settlement.reason}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
