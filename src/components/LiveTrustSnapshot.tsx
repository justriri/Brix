"use client";

import { useEffect, useState } from "react";
import type { TrustSnapshot } from "@/lib/protection/weekendTrustMonitor";
import { SafetyBadge } from "@/components/SafetyBadge";
import { ErrorBanner, WarningBanner } from "@/components/ErrorBanner";
import { DevBadge } from "@/components/DevBadge";
import { toUserMessage } from "@/lib/errors";

interface TrustSnapshotResponse {
  snapshot: TrustSnapshot | null;
  isTrusted: boolean;
  warnings: string[];
  error?: string;
}

/**
 * Shows ONE real, live trust snapshot — real Binance RWA + Pyth data
 * through the existing, unmodified Safety Gate, right now. Deliberately
 * distinct from WeekendTrustScenarioDemo (fixture-based simulation of a
 * full weekend): this is real data for THIS INSTANT only. There is no
 * background job producing real Saturday/Sunday snapshots automatically —
 * BRIX currently has a mechanism for obtaining one real snapshot on demand,
 * not a live continuous-monitoring service.
 */
export function LiveTrustSnapshot({ ticker, wrapper }: { ticker: string; wrapper: string }) {
  const [data, setData] = useState<TrustSnapshotResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Resetting to a loading state when `ticker`/`wrapper` changes is a
    // deliberate response to that external prop change, not state derivable
    // from render — matches the same pattern/justification already used in
    // page.tsx and useWallet.ts for this exact lint rule.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch(`/api/dev/trust-snapshot?ticker=${ticker}&wrapper=${wrapper}&checkpoint=friday`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => !cancelled && setFetchError(toUserMessage(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [ticker, wrapper]);

  return (
    <div className="rounded-lg border border-border-subtle p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-medium">Live Trust Snapshot</p>
        <DevBadge label="Real data, right now — not continuous monitoring" />
      </div>

      {loading && <p className="text-xs text-muted-2">Fetching a real trust snapshot…</p>}
      {fetchError && <ErrorBanner message={fetchError} />}
      {data?.error && <ErrorBanner message={data.error} />}
      {data?.warnings.map((w, i) => (
        <div key={i} className="mb-2">
          <WarningBanner message={w} />
        </div>
      ))}

      {data?.snapshot && (
        <div className="mt-1 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-sm font-semibold ${data.isTrusted ? "text-emerald-400" : "text-amber-400"}`}>
              {data.isTrusted ? "TRUST HEALTHY" : "TRUST BROKEN"}
            </span>
            <SafetyBadge status={data.snapshot.safetyGateResult.status} />
          </div>
          <p className="mt-1 text-xs text-muted-2">Timestamp: {new Date(data.snapshot.timestamp).toLocaleString()}</p>
          <ul className="mt-2 space-y-1 text-xs text-muted">
            {Object.values(data.snapshot.safetyGateResult.checks).map((c) => (
              <li key={c.id}>
                {c.passed === true ? "✓" : c.passed === false ? "✗" : "⚠"} {c.label}: {c.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
