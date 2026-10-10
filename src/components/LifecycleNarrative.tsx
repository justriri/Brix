import { ScrollReveal } from "@/components/ScrollReveal";

/**
 * The landing page's core narrative — INVEST -> PROTECT -> MONITOR ->
 * SETTLE as one connected journey, not four feature cards. Each stage
 * gets a full section with its own illustrative product mockup. These
 * mockups are deliberately labeled "Illustrative" — unlike the hero's
 * current TSLA price (a real live fetch), a mocked Safety Gate/policy/
 * settlement screen has no live state to show here (showing a REAL
 * settlement outcome would require an actual completed test), so this
 * stays honest rather than implying a real, currently-eligible policy.
 */

const STAGES = [
  {
    n: "01",
    key: "invest",
    title: "Invest",
    headline: "Own a real position on BNB Chain.",
    body: "Buy a tokenized stock through a real PancakeSwap swap. BRIX verifies the position directly from your on-chain balance — never from the swap's own estimate.",
  },
  {
    n: "02",
    key: "protect",
    title: "Protect",
    headline: "Attach a fixed-term policy to it.",
    body: "Define a coverage period, a downside threshold, and a maximum payout. The policy is created on the deployed settlement contract — a real transaction, not a form.",
  },
  {
    n: "03",
    key: "monitor",
    title: "Monitor",
    headline: "BRIX keeps checking, so you don't have to.",
    body: "Every checkpoint re-runs the same Safety Gate your purchase did — liquidity, price freshness, independent reference, market status. One break and trust is marked broken, permanently, even if things recover later.",
  },
  {
    n: "04",
    key: "settle",
    title: "Settle",
    headline: "A signed, verifiable resolution.",
    body: "At the end of the period, the monitored outcome is signed (EIP-712) and submitted on-chain. If eligible, the contract pays out in USDT — pulled by you, never pushed automatically.",
  },
] as const;

function InvestMock() {
  return (
    <div className="rounded-2xl border border-border-subtle bg-surface p-4">
      <div className="flex items-center justify-between">
        <p className="font-semibold">TSLA</p>
        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-400">PASS</span>
      </div>
      <p className="mt-1 text-xs text-muted-2">bstocks · TSLAB</p>
      <p className="mt-3 text-2xl font-bold tabular-nums">$370.71</p>
      <div className="mt-3 flex items-center justify-between text-xs text-muted">
        <span>Liquidity $1.99M</span>
        <span className="font-medium text-brand">Analyze →</span>
      </div>
    </div>
  );
}

function ProtectMock() {
  return (
    <div className="rounded-2xl border border-border-subtle bg-surface p-4">
      <p className="font-semibold">Weekend policy</p>
      <dl className="mt-3 grid grid-cols-2 gap-y-2 text-sm">
        <dt className="text-muted-2">Coverage</dt>
        <dd className="text-right">Weekend</dd>
        <dt className="text-muted-2">Threshold</dt>
        <dd className="text-right">5%</dd>
        <dt className="text-muted-2">Premium</dt>
        <dd className="text-right">$12.00</dd>
        <dt className="text-muted-2">Max payout</dt>
        <dd className="text-right font-semibold text-brand">$500.00</dd>
      </dl>
    </div>
  );
}

function MonitorMock() {
  const rows = [
    { label: "Friday", ok: true },
    { label: "Saturday", ok: true },
    { label: "Sunday", ok: true },
    { label: "Monday", ok: null },
  ];
  return (
    <div className="rounded-2xl border border-border-subtle bg-surface p-4">
      <div className="flex items-center justify-between">
        <p className="font-semibold">Trust continuity</p>
        <span className="rounded-full bg-brand/15 px-2 py-0.5 text-xs font-semibold text-brand">INTACT</span>
      </div>
      <ul className="mt-3 space-y-1.5 text-sm">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center gap-2">
            <span className={r.ok === true ? "text-emerald-400" : "text-muted-2"}>{r.ok === true ? "✓" : "…"}</span>
            <span className={r.ok === true ? "" : "text-muted"}>{r.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SettleMock() {
  return (
    <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-emerald-300">Settlement eligible</p>
        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-400">RESOLVED</span>
      </div>
      <p className="mt-3 text-2xl font-bold tabular-nums text-emerald-300">$42.00 USDT</p>
      <p className="mt-1 text-xs text-emerald-400/70">Paid out · pulled by policy owner · tx confirmed on-chain</p>
    </div>
  );
}

const MOCKS = { invest: InvestMock, protect: ProtectMock, monitor: MonitorMock, settle: SettleMock };

export function LifecycleNarrative() {
  return (
    <div className="relative">
      <div className="absolute bottom-0 left-[27px] top-0 hidden w-px brix-lifeline sm:block" aria-hidden />
      <div className="space-y-16 sm:space-y-24">
        {STAGES.map((s, i) => {
          const Mock = MOCKS[s.key];
          return (
            <ScrollReveal key={s.key}>
              <div className="grid grid-cols-1 gap-8 sm:grid-cols-[auto_1fr_1fr] sm:items-center">
                <div className="hidden sm:flex sm:h-14 sm:w-14 sm:items-center sm:justify-center sm:rounded-full sm:border sm:border-border-strong sm:bg-surface-2 sm:font-mono sm:text-sm sm:text-brand">
                  {s.n}
                </div>
                <div className={i % 2 === 1 ? "sm:order-2" : ""}>
                  <p className="font-mono text-xs text-brand sm:hidden">{s.n}</p>
                  <h3 className="mt-1 text-2xl font-bold sm:text-3xl" style={{ fontFamily: "var(--font-display)" }}>
                    {s.title}
                  </h3>
                  <p className="mt-2 text-lg text-foreground/90">{s.headline}</p>
                  <p className="mt-2 max-w-md text-sm text-muted">{s.body}</p>
                </div>
                <div className={i % 2 === 1 ? "sm:order-1" : ""}>
                  <p className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-2">Illustrative</p>
                  <Mock />
                </div>
              </div>
            </ScrollReveal>
          );
        })}
      </div>
    </div>
  );
}
