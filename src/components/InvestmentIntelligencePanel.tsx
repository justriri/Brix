"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BuySpotPanel } from "@/components/BuySpotPanel";
import { BinanceRwaProtectionQuote } from "@/components/BinanceRwaProtectionQuote";
import { AssistantChatPanel } from "@/components/AssistantChatPanel";
import { getSettlementContractAddress, getSettlementUsdtAddress } from "@/lib/protection/settlementContractClient";
import type { WalletState } from "@/lib/useWallet";
import { compareCandidates } from "@/lib/invest/intelligence/compareCandidates";
import type { CandidateEvaluation, CandidateGroup } from "@/lib/invest/intelligence/intelligenceTypes";

/**
 * BRIX's PRIMARY product journey — Markets is the main surface, not a
 * detached analytics page. Reuses every existing piece unchanged —
 * BuySpotPanel (real PancakeSwap swap), BinanceRwaProtectionQuote (real
 * Weekend Protection quote + trust-monitoring/settlement demos), the
 * intelligence engine's own evaluateCandidate()/compareCandidates() — this
 * file only ADDS a guided stage sequence on top of them:
 *
 *   Discover -> Analyze -> Buy -> Verify -> Protect (-> Monitor -> Settle,
 *   both reached from inside the Protect stage below, which already
 *   renders the existing monitoring/settlement demos).
 *
 * Visual-only redesign pass: every stage now also renders a persistent
 * 4-phase lifecycle header (Invest/Protect/Monitor/Settle) so the card's
 * place in the bigger journey is always visible, not just within the
 * finer 5-stage machine below. No state, callback, or API call changed —
 * only JSX/markup/derived display values.
 */

interface IntelligenceResponse {
  groups: CandidateGroup[];
  warnings: string[];
  fetchedAt: number;
}

interface VerifiedPosition {
  positionAmount: number;
  positionValueUsd: number;
}

/** A REAL on-chain holding, from /api/portfolio — never hardcoded, never synthesized from a failed lookup. */
interface OwnedPosition {
  balance: number;
  usdValue?: number;
}

type Stage = "discover" | "analyze" | "buy" | "verified" | "protect";
type LifecyclePhase = "invest" | "protect" | "monitor" | "settle";

const PHASES: { key: LifecyclePhase; label: string }[] = [
  { key: "invest", label: "Invest" },
  { key: "protect", label: "Protect" },
  { key: "monitor", label: "Monitor" },
  { key: "settle", label: "Settle" },
];

/** Pure, derived mapping — the finer 5-stage machine below is unchanged; this only decides which of the 4 big lifecycle phases to highlight for orientation. */
function phaseForStage(stage: Stage): LifecyclePhase {
  return stage === "protect" ? "protect" : "invest";
}

function PhaseHeader({ phase }: { phase: LifecyclePhase }) {
  const activeIndex = PHASES.findIndex((p) => p.key === phase);
  return (
    <div className="mb-4 flex items-center gap-1.5">
      {PHASES.map((p, i) => (
        <div key={p.key} className="flex flex-1 items-center gap-1.5">
          <span className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${i <= activeIndex ? "bg-brand" : "bg-border-subtle"}`} />
        </div>
      ))}
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = {
  PASS: "text-emerald-400",
  WARNING: "text-amber-400",
  FAIL: "text-red-400",
  // UNAVAILABLE = a hard check couldn't be evaluated (no data from any
  // source), not a confirmed failure — deliberately neutral, not red/amber,
  // so it doesn't read as alarming as a genuine FAIL/WARNING.
  UNAVAILABLE: "text-muted-2",
};

const STATUS_BADGE: Record<string, string> = {
  PASS: "bg-emerald-500/10 text-emerald-400 ring-1 ring-inset ring-emerald-500/30",
  WARNING: "bg-amber-500/10 text-amber-400 ring-1 ring-inset ring-amber-500/30",
  FAIL: "bg-red-500/10 text-red-400 ring-1 ring-inset ring-red-500/30",
  UNAVAILABLE: "bg-surface-3 text-muted ring-1 ring-inset ring-border-subtle",
};

const STATUS_LABEL: Record<string, string> = {
  UNAVAILABLE: "Price unavailable",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_BADGE[status] ?? "bg-surface-3 text-muted"}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

const PRICE_VERIFICATION_LABEL: Partial<Record<string, string>> = {
  CROSS_WRAPPER_CONFIRMED: "Cross-wrapper confirmed",
  ISSUER_REFERENCE_ONLY: "Single-source pricing",
  DISAGREEMENT: "Wrappers disagree",
};

/**
 * Shown ONLY for the three non-FAIL-irrelevant modes a user should
 * actually see — never for UNAVAILABLE (that's already implied by
 * whatever hard check failed, shown elsewhere) — and never claims a
 * single-source price was "verified" the same way a cross-wrapper
 * confirmation was. Deliberately a neutral/informational tone (not red),
 * even for DISAGREEMENT, since the gate's own PASS/WARNING/FAIL badge
 * already carries the alarm color.
 */
function PriceVerificationBadge({ mode }: { mode: string }) {
  const label = PRICE_VERIFICATION_LABEL[mode];
  if (!label) return null;
  return <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[10px] font-medium text-muted-2 ring-1 ring-inset ring-border-subtle">{label}</span>;
}

function CheckLine({ check }: { check: CandidateEvaluation["checks"][number] }) {
  const icon = check.status === "PASS" ? "✓" : check.status === "FAIL" ? "✗" : "?";
  return (
    <li className="flex items-start gap-2">
      <span className={`font-bold ${STATUS_COLOR[check.status] ?? "text-muted-2"}`}>{icon}</span>
      <span>
        {check.name}
        {check.value !== undefined && (
          <span className="text-muted-2">
            {" "}
            ({check.value}
            {check.threshold !== undefined ? ` / ${check.threshold}` : ""})
          </span>
        )}
        {check.status !== "PASS" && <span className="block text-xs text-muted-2">{check.message}</span>}
      </span>
    </li>
  );
}

function PrimaryButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-brand-foreground transition-all duration-200 hover:scale-[1.02] hover:bg-brand/90"
    >
      {children}
    </button>
  );
}

function BackLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="mb-3 text-xs text-muted-2 transition-colors hover:text-muted">
      {children}
    </button>
  );
}

function OwnedPositionNote({ owned, onViewPosition }: { owned: OwnedPosition; onViewPosition: () => void }) {
  return (
    <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-border-subtle bg-surface-2 px-3 py-2 text-xs">
      <div className="min-w-0">
        <p className="text-muted-2">
          Your position: <span className="font-medium tabular-nums text-foreground">{owned.balance.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
          {owned.usdValue !== undefined && <span className="text-muted-2"> (${owned.usdValue.toFixed(2)})</span>}
        </p>
      </div>
      <button type="button" onClick={onViewPosition} className="shrink-0 font-medium text-brand underline underline-offset-2 hover:text-brand/80">
        View Position
      </button>
    </div>
  );
}

function WrapperJourneyCard({
  evaluation,
  wallet,
  stage,
  ownedPosition,
  onViewPosition,
  onStageChange,
  onPurchaseComplete,
  onAskAssistant,
}: {
  evaluation: CandidateEvaluation;
  wallet: WalletState;
  stage: Stage;
  ownedPosition: OwnedPosition | null;
  onViewPosition: () => void;
  onStageChange: (stage: Stage) => void;
  onPurchaseComplete: (position: VerifiedPosition) => void;
  onAskAssistant: (question: string) => void;
}) {
  const gatePassed = evaluation.operationalStatus === "PASS";

  // Stage 1: discovery row — price, Safety Gate status, one primary action.
  // This IS the "market card" — it should look like the main product.
  if (stage === "discover") {
    return (
      <div className="group rounded-2xl border border-border-subtle bg-surface p-5 transition-all duration-300 hover:-translate-y-1 hover:border-border-strong hover:shadow-[0_12px_32px_-12px_rgba(0,0,0,0.5)]">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold" style={{ fontFamily: "var(--font-display)" }}>
              {evaluation.underlying}
            </p>
            <p className="truncate text-xs capitalize text-muted-2">
              {evaluation.wrapper} · {evaluation.tokenSymbol}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <StatusBadge status={evaluation.operationalStatus} />
            <PriceVerificationBadge mode={evaluation.priceVerification} />
          </div>
        </div>
        <p className="mt-4 text-3xl font-bold tabular-nums" style={{ fontFamily: "var(--font-display)" }}>
          {evaluation.facts.tokenPrice !== undefined ? `$${evaluation.facts.tokenPrice.toFixed(2)}` : "—"}
        </p>
        <dl className="mt-2 grid grid-cols-2 gap-y-0.5 text-xs text-muted-2">
          <dt>Reference</dt>
          <dd className="text-right tabular-nums text-muted">
            {evaluation.facts.referencePrice !== undefined ? `$${evaluation.facts.referencePrice.toFixed(2)}` : "—"}
          </dd>
          <dt>Liquidity</dt>
          <dd className="text-right tabular-nums text-muted">
            {evaluation.facts.liquidityUsd !== undefined ? `$${Math.round(evaluation.facts.liquidityUsd).toLocaleString()}` : "—"}
          </dd>
        </dl>
        {ownedPosition && <OwnedPositionNote owned={ownedPosition} onViewPosition={onViewPosition} />}
        <div className="mt-5 flex items-center justify-between gap-2">
          <PrimaryButton onClick={() => onStageChange("analyze")}>Analyze →</PrimaryButton>
          <button
            type="button"
            onClick={() => onAskAssistant(`Why did ${evaluation.underlying} ${evaluation.wrapper} get ${evaluation.operationalStatus}?`)}
            className="shrink-0 text-xs text-muted-2 underline underline-offset-2 transition-colors hover:text-muted"
          >
            Ask about this asset
          </button>
        </div>
      </div>
    );
  }

  const phase = phaseForStage(stage);

  // Stage 2: full analysis — every fact, then a clear next action (Buy) OR,
  // if the Safety Gate hasn't passed, a clear explanation instead of a
  // bypassable button.
  if (stage === "analyze") {
    return (
      <div className="rounded-2xl border border-border-subtle bg-surface p-5">
        <PhaseHeader phase={phase} />
        <BackLink onClick={() => onStageChange("discover")}>← Back</BackLink>
        {/* Status/price-verification badges already shown on the discover
            card the user just came from — not repeated here. The Safety
            Gate checklist below is the detail view; a second copy of the
            same top-level badge added nothing but visual noise. */}
        <p className="min-w-0 truncate font-semibold">
          {evaluation.underlying} · {evaluation.wrapper} ({evaluation.tokenSymbol})
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-y-1.5 text-sm">
          <dt className="text-muted-2">Current price</dt>
          <dd className="text-right tabular-nums">{evaluation.facts.tokenPrice !== undefined ? `$${evaluation.facts.tokenPrice.toFixed(2)}` : "unavailable"}</dd>
          <dt className="text-muted-2">Reference price</dt>
          <dd className="text-right tabular-nums">{evaluation.facts.referencePrice !== undefined ? `$${evaluation.facts.referencePrice.toFixed(2)}` : "unavailable"}</dd>
          <dt className="text-muted-2">Market status</dt>
          <dd className="text-right capitalize">{evaluation.facts.marketStatus ?? "unavailable"}</dd>
          <dt className="text-muted-2">Price freshness</dt>
          <dd className="text-right tabular-nums">{evaluation.facts.priceFreshnessSeconds !== undefined ? `${evaluation.facts.priceFreshnessSeconds}s old` : "unavailable"}</dd>
        </dl>

        {/* Liquidity is already shown on the discover card and is also the
            "Trusted liquidity" line in the checklist below (with its own
            value/threshold) — not repeated a third time here. */}
        <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted-2">Safety Gate</p>
        <ul className="mt-2 space-y-1.5 text-xs text-foreground/90">
          {evaluation.checks.map((c) => (
            <CheckLine key={c.name} check={c} />
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted-2">Evaluated at {new Date(evaluation.evaluationTimestamp).toLocaleString()}.</p>

        <div className="mt-4">
          {evaluation.canAttemptPurchase ? (
            <>
              <PrimaryButton onClick={() => onStageChange("buy")}>Buy Spot →</PrimaryButton>
              {!gatePassed && (
                <p className="mt-2 text-xs text-muted-2">
                  Note: the Trusted liquidity check above shows {evaluation.checks.find((c) => c.name === "Trusted liquidity")?.status.toLowerCase()} — that
                  checks overall pool TVL, not whether your specific purchase amount is executable. Getting a quote will run the real check, against the
                  actual live route, before anything can be signed.
                </p>
              )}
            </>
          ) : (
            (() => {
              const blockingChecks = evaluation.failedChecks.filter((c) => c.name !== "Trusted liquidity");
              const hasGenuineFailure = blockingChecks.some((c) => c.status === "FAIL");
              return (
                <div
                  className={`rounded-xl border p-3 text-xs ${
                    hasGenuineFailure ? "border-amber-500/30 bg-amber-500/10 text-amber-300" : "border-border-subtle bg-surface-2 text-muted-2"
                  }`}
                >
                  {hasGenuineFailure
                    ? "Buy isn't offered right now — this wrapper fails a check unrelated to pool liquidity:"
                    : "Buy isn't offered right now — a required check couldn't be verified (data unavailable), not because anything failed:"}
                  <ul className="mt-1 space-y-0.5">
                    {blockingChecks.map((c) => (
                      <li key={c.name}>
                        • {c.name}: {c.message}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })()
          )}
        </div>
      </div>
    );
  }

  // Stage 3: the existing, unmodified BuySpotPanel — just framed inside the journey.
  if (stage === "buy") {
    return (
      <div className="rounded-2xl border border-border-subtle bg-surface p-5">
        <PhaseHeader phase={phase} />
        <BackLink onClick={() => onStageChange("analyze")}>← Back to analysis</BackLink>
        <p className="text-xs text-muted-2">
          Analysis <span className="mx-1">→</span> Safety Gate: <span className={STATUS_COLOR[evaluation.operationalStatus]}>{evaluation.operationalStatus}</span>{" "}
          <span className="mx-1">→</span> <strong className="text-foreground">Buy Spot</strong>
        </p>
        <BuySpotPanel wallet={wallet} stock={evaluation.stock} onPurchaseComplete={onPurchaseComplete} />
      </div>
    );
  }

  // Stages 4 (Verify) & 5 (Protect) are rendered full-width, standalone,
  // outside the 1/3-width markets grid — by FocusedPurchasedStock below.
  // A just-purchased position is the thing the user is now focused on;
  // cramming the position summary, the lifecycle pills, and the full
  // Weekend Protection flow (quote + its own embedded monitoring/settlement
  // demos) into a grid cell sized for a discovery card is exactly why the
  // old layout overflowed. This function is never actually called with
  // those two stages (see InvestmentIntelligencePanel's render below); the
  // fallback exists only to keep this function total over the full Stage
  // type.
  return null;
}

function PurchasedBadge() {
  return (
    <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-400 ring-1 ring-inset ring-emerald-500/30">
      ✓ Purchased
    </span>
  );
}

/**
 * Stages 4 (Verify) & 5 (Protect) — reuses every existing piece unchanged
 * (BinanceRwaProtectionQuote, getSettlementContractAddress() /
 * getSettlementUsdtAddress(), the Protect/Monitor/Settle pills, the
 * settlement-engine status row); only the surrounding layout changed. Full
 * container width, with a two-column split on large screens (position/
 * lifecycle info beside the protection quote itself) instead of a long,
 * narrow, single-column stack.
 */
function FocusedPurchasedStock({
  evaluation,
  wallet,
  stage,
  onStageChange,
  verifiedPosition,
  onBackToMarkets,
}: {
  evaluation: CandidateEvaluation;
  wallet: WalletState;
  stage: "verified" | "protect";
  onStageChange: (stage: Stage) => void;
  verifiedPosition: VerifiedPosition | null;
  onBackToMarkets: () => void;
}) {
  const phase = phaseForStage(stage);
  const settlementEnabled = Boolean(getSettlementContractAddress() && getSettlementUsdtAddress());

  return (
    <div className="rounded-2xl border border-brand/30 bg-gradient-to-b from-brand/[0.06] to-surface p-5 sm:p-8">
      <div className="mb-5 flex items-center justify-between">
        <button type="button" onClick={onBackToMarkets} className="text-xs text-muted-2 transition-colors hover:text-muted">
          ← Back to markets
        </button>
        <span className="hidden text-xs text-muted-2 sm:inline">Invest → Protect → Monitor → Settle</span>
      </div>

      <PhaseHeader phase={phase} />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1.5">
            <PurchasedBadge />
          </div>
          <h3 className="text-2xl font-bold sm:text-3xl" style={{ fontFamily: "var(--font-display)" }}>
            {evaluation.underlying}{" "}
            <span className="text-base font-normal capitalize text-muted-2">
              · {evaluation.wrapper} ({evaluation.tokenSymbol})
            </span>
          </h3>
          <p className="mt-1 text-xs font-medium text-emerald-400">✓ Verified on-chain — read directly from your real wallet balance.</p>
        </div>
        {verifiedPosition && (
          <dl className="flex gap-6 text-sm">
            <div>
              <dt className="text-muted-2">Holding</dt>
              <dd className="font-semibold tabular-nums">
                {verifiedPosition.positionAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })} {evaluation.tokenSymbol}
              </dd>
            </div>
            <div>
              <dt className="text-muted-2">Value</dt>
              <dd className="font-semibold tabular-nums">${verifiedPosition.positionValueUsd.toFixed(2)}</dd>
            </div>
          </dl>
        )}
      </div>

      {stage === "verified" && (
        <div className="mt-6 max-w-xl">
          <p className="text-sm text-foreground/90">Your position is verified. Protect it over the weekend against a downside move.</p>
          <div className="mt-4">
            <PrimaryButton onClick={() => onStageChange("protect")}>Protect Position →</PrimaryButton>
          </div>
        </div>
      )}

      {stage === "protect" && (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div className="space-y-4">
            <BackLink onClick={() => onStageChange("verified")}>← Back to position</BackLink>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-xl border border-brand/30 bg-brand/5 px-2 py-2 font-semibold text-brand">Protect</div>
              <div className="rounded-xl border border-border-subtle bg-surface-2 px-2 py-2 font-medium text-foreground/80">Monitor</div>
              <div className="rounded-xl border border-border-subtle bg-surface-2 px-2 py-2 font-medium text-foreground/80">Settle</div>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border-subtle bg-surface-2 px-3 py-2.5">
              <p className="text-xs font-semibold text-foreground/80">Settlement engine</p>
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${settlementEnabled ? "bg-emerald-500/10 text-emerald-400" : "bg-brand/10 text-brand"}`}>
                {settlementEnabled ? "Enabled" : "Implemented · Not enabled"}
              </span>
            </div>
          </div>

          <div className="min-w-0">
            {wallet.address ? (
              <BinanceRwaProtectionQuote
                address={wallet.address}
                assessment={{ stock: evaluation.stock, safetyGateResult: evaluation.safetyGateResult }}
                wallet={wallet}
              />
            ) : (
              <p className="text-xs text-muted-2">Connect a wallet to generate a Weekend Protection quote.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Shown in the markets grid, in place of the full stage, for a wrapper
 * that's already been purchased (and/or moved into Protect) but isn't the
 * currently-focused one — e.g. the user went "← Back to markets" to browse
 * other assets, or purchased more than one wrapper. Never re-renders the
 * full Protect UI at grid-cell width (that was the layout bug); clicking it
 * just re-focuses the existing, already up-to-date state — nothing is
 * refetched or fabricated.
 */
function ResumeCard({
  evaluation,
  stage,
  verifiedPosition,
  onResume,
}: {
  evaluation: CandidateEvaluation;
  stage: "verified" | "protect";
  verifiedPosition: VerifiedPosition | null;
  onResume: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border-subtle bg-surface p-5">
      <div className="min-w-0">
        <div className="mb-1">
          <PurchasedBadge />
        </div>
        <p className="truncate font-semibold" style={{ fontFamily: "var(--font-display)" }}>
          {evaluation.underlying}
        </p>
        <p className="truncate text-xs capitalize text-muted-2">
          {evaluation.wrapper} · {evaluation.tokenSymbol}
          {verifiedPosition && ` · $${verifiedPosition.positionValueUsd.toFixed(2)}`}
        </p>
      </div>
      <PrimaryButton onClick={onResume}>{stage === "protect" ? "Resume protection →" : "Resume →"}</PrimaryButton>
    </div>
  );
}

export function InvestmentIntelligencePanel({ wallet }: { wallet: WalletState }) {
  const [data, setData] = useState<IntelligenceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stages, setStages] = useState<Record<string, Stage>>({});
  const [positions, setPositions] = useState<Record<string, VerifiedPosition>>({});
  const [compareOpen, setCompareOpen] = useState<Record<string, boolean>>({});
  const [chatQuestion, setChatQuestion] = useState<string | null>(null);
  // Which purchased wrapper (if any) is shown full-width, standalone, above
  // the markets grid — see FocusedPurchasedStock. Set automatically when a
  // purchase completes; cleared by "← Back to markets" (the stage itself is
  // untouched, so resuming via ResumeCard picks up exactly where it left off).
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  // Captured once, when the response actually arrives (not read via Date.now()
  // during render, which React's purity rules correctly flag as an impure,
  // non-idempotent render) — good enough for a cosmetic "this is stale,
  // reload" banner; nothing financial depends on this flag, since the real
  // quote/price freshness is independently re-checked by the Safety Gate and
  // by BuySpotPanel's own revalidation before any transaction is signed.
  const [isStale, setIsStale] = useState(false);
  // Keyed `${underlying}:${wrapper}`, same convention as `stages`/`positions`
  // above and brixActivity.ts's isProtectionQuoted(). Only ever populated
  // from a SUCCESSFUL /api/portfolio response — a fetch failure leaves this
  // empty, not "no positions", so a transient RPC/API error can never be
  // displayed as "you don't own this" (see the `ownedPositionsLoaded` guard
  // below, which gates whether this map is even consulted for rendering).
  const [ownedPositions, setOwnedPositions] = useState<Record<string, OwnedPosition>>({});
  const [ownedPositionsLoaded, setOwnedPositionsLoaded] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/investment-intelligence")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) {
          setError(d.error);
          return;
        }
        setData(d);
        setIsStale(Date.now() - d.fetchedAt > 5 * 60 * 1000);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Failed to load."));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!wallet.address) {
      // Reacting to an external event (wallet disconnect) — same precedent
      // as app/app/portfolio/page.tsx's own portfolio-clearing effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOwnedPositions({});
      setOwnedPositionsLoaded(false);
      return;
    }
    let cancelled = false;
    fetch(`/api/portfolio?address=${wallet.address}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !Array.isArray(d.assessments)) return;
        const map: Record<string, OwnedPosition> = {};
        for (const a of d.assessments) {
          const key = `${a.position.stock.underlying}:${a.position.stock.wrapper}`;
          map[key] = { balance: a.position.balance, usdValue: a.position.usdValue };
        }
        setOwnedPositions(map);
        setOwnedPositionsLoaded(true);
      })
      // A failed lookup leaves ownedPositionsLoaded false — never treated as "owns nothing".
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [wallet.address]);

  const focusedEvaluation = focusedKey
    ? data?.groups.flatMap((g) => g.wrappers).find((e) => `${e.underlying}:${e.wrapper}` === focusedKey) ?? null
    : null;
  const focusedStage = focusedKey ? stages[focusedKey] : undefined;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
            Markets
          </h2>
          <p className="mt-1 text-sm text-muted">Live tokenized stocks on BNB Chain — analyze, then buy.</p>
        </div>
      </div>

      {!data && !error && (
        <div>
          <p className="mb-3 flex items-center gap-2 text-sm text-muted">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
            Loading live markets from BNB Chain…
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-40 animate-pulse rounded-2xl border border-border-subtle bg-surface" />
            ))}
          </div>
        </div>
      )}
      {error && <p className="text-sm text-red-400">Could not load market data: {error}</p>}
      {data && data.groups.length === 0 && (
        <p className="rounded-xl border border-dashed border-border-subtle bg-surface p-6 text-center text-sm text-muted">
          No tokenized stocks are available right now — the live data source may be temporarily unreachable. Try reloading in a moment.
        </p>
      )}
      {isStale && <p className="mb-3 text-xs text-amber-400">This data was fetched more than 5 minutes ago — reload the page for a fresh read.</p>}
      {data && data.warnings.length > 0 && (
        <ul className="mb-3 text-xs text-muted-2">
          {data.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}

      {focusedKey && focusedEvaluation && (focusedStage === "verified" || focusedStage === "protect") && (
        <div className="mb-10">
          <FocusedPurchasedStock
            evaluation={focusedEvaluation}
            wallet={wallet}
            stage={focusedStage}
            onStageChange={(s) => setStages((st) => ({ ...st, [focusedKey]: s }))}
            verifiedPosition={positions[focusedKey] ?? null}
            onBackToMarkets={() => setFocusedKey(null)}
          />
        </div>
      )}

      {data?.groups.map((group) => (
        <div key={group.underlying} className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-muted">{group.underlying}</h3>
            {group.wrappers.length > 1 && (
              <button
                type="button"
                onClick={() => setCompareOpen((s) => ({ ...s, [group.underlying]: !s[group.underlying] }))}
                className="rounded-full border border-border-subtle px-3 py-1 text-xs font-medium text-muted transition-colors hover:border-border-strong hover:text-foreground"
              >
                {compareOpen[group.underlying] ? "Hide comparison" : "Compare wrappers"}
              </button>
            )}
          </div>

          {compareOpen[group.underlying] && <WrapperComparisonView group={group} />}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.wrappers.map((evaluation) => {
              const key = `${group.underlying}:${evaluation.wrapper}`;
              const stage = stages[key] ?? "discover";

              // Shown full-width above instead, by FocusedPurchasedStock.
              if (key === focusedKey) return null;

              // Already purchased (and/or in Protect) but not the focused
              // one right now — a compact resume row, never the full,
              // grid-cell-width Protect UI (that was the overflow bug).
              if (stage === "verified" || stage === "protect") {
                return (
                  <ResumeCard
                    key={key}
                    evaluation={evaluation}
                    stage={stage}
                    verifiedPosition={positions[key] ?? null}
                    onResume={() => setFocusedKey(key)}
                  />
                );
              }

              return (
                <WrapperJourneyCard
                  key={key}
                  evaluation={evaluation}
                  wallet={wallet}
                  stage={stage}
                  ownedPosition={ownedPositionsLoaded ? ownedPositions[key] ?? null : null}
                  onViewPosition={() => router.push(`/app/portfolio?position=${encodeURIComponent(key)}`)}
                  onStageChange={(s) => setStages((st) => ({ ...st, [key]: s }))}
                  onPurchaseComplete={(position) => {
                    setPositions((p) => ({ ...p, [key]: position }));
                    setStages((s) => ({ ...s, [key]: "verified" }));
                    setFocusedKey(key);
                  }}
                  onAskAssistant={(q) => setChatQuestion(q)}
                />
              );
            })}
          </div>
        </div>
      ))}

      <details id="assistant" className="mt-6 scroll-mt-20 rounded-2xl border border-border-subtle bg-surface p-4">
        <summary className="cursor-pointer text-sm font-medium text-foreground/80">
          Ask BRIX <span className="text-muted-2">— asset comparisons, Safety Gate, quotes, your position</span>
        </summary>
        <div className="mt-3">
          <AssistantChatPanel prefillQuestion={chatQuestion} onConsumedPrefill={() => setChatQuestion(null)} />
        </div>
      </details>
    </div>
  );
}

function WrapperComparisonView({ group }: { group: CandidateGroup }) {
  const differences = compareCandidates(group.wrappers).differences;

  if (differences.length === 0) {
    return <p className="mb-3 text-xs text-muted-2">All {group.underlying} wrappers currently agree on every operational check.</p>;
  }
  return (
    <ul className="mb-3 rounded-xl border border-border-subtle bg-surface-2 p-3 text-xs text-muted">
      {differences.map((d) => (
        <li key={d.checkName}>{d.description}</li>
      ))}
    </ul>
  );
}
