"use client";

import { useState } from "react";
import type { CheckResult, SafetyGateResult } from "@/lib/types";

function CheckRow({ check }: { check: CheckResult }) {
  const symbol = check.passed === true ? "✓" : check.passed === false ? "✗" : "⚠";
  const color =
    check.passed === true
      ? "text-emerald-600 dark:text-emerald-400"
      : check.passed === false
        ? "text-red-600 dark:text-red-400"
        : "text-amber-600 dark:text-amber-400";

  return (
    <li className="flex items-start gap-2 py-1.5 text-sm">
      <span className={`font-bold ${color}`}>{symbol}</span>
      <span>
        <span className="font-medium">{check.label}:</span>{" "}
        <span className="text-muted-2 ">{check.message}</span>
        {check.severity === "soft" && (
          <span className="ml-1.5 rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-2  ">
            soft signal
          </span>
        )}
      </span>
    </li>
  );
}

const DETAILS_PROMPT: Record<SafetyGateResult["status"], string> = {
  PASS: "Why did this pass?",
  WARNING: "Why the warning?",
  FAIL: "Why did this fail?",
  UNAVAILABLE: "Why is this unavailable?",
};

/** Expandable "Why did this pass/fail?" detail panel — the transparency the build brief calls out as important. */
export function SafetyDetails({ result, notes }: { result: SafetyGateResult; notes?: string[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
      >
        {open ? "Hide details" : DETAILS_PROMPT[result.status]}
      </button>
      {open && (
        <div className="mt-2 rounded-lg border border-border-subtle bg-surface-2 p-3  ">
          <ul className="divide-y divide-border-subtle ">
            {Object.values(result.checks).map((check) => (
              <CheckRow key={check.id} check={check} />
            ))}
          </ul>
          {result.primaryReference && (
            <p className="mt-2 text-xs text-muted-2 -2">
              Reference: {result.primaryReference.name} · ${result.primaryReference.price.toFixed(2)} · updated{" "}
              {new Date(result.primaryReference.publishTimeSec * 1000).toLocaleString()}
            </p>
          )}
          {notes && notes.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-2 -2">
              {notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-[10px] text-muted -2">
            Evaluated {new Date(result.timestamp).toLocaleString()}
          </p>
        </div>
      )}
    </div>
  );
}
