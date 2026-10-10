"use client";

import { useEffect, useRef, useState } from "react";
import { DevBadge } from "@/components/DevBadge";

/**
 * Minimal chat UI for the AI Investment Assistant (build brief Phase 2
 * §13). Every reply comes from /api/assistant, which is always grounded in
 * live data (see assistantResponder.ts) — this component has no logic of
 * its own beyond displaying the conversation; it never computes or
 * fabricates anything.
 */

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  usedLanguageModel?: boolean;
}

export function AssistantChatPanel({ prefillQuestion, onConsumedPrefill }: { prefillQuestion: string | null; onConsumedPrefill: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Syncing local input state to an external, imperative trigger (a
    // sibling panel's "Ask Assistant" button) — not state derivable from
    // props/state during render, so this genuinely needs the effect. Same
    // justification/precedent as useWallet.ts's window.ethereum detection.
    if (prefillQuestion) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInput(prefillQuestion);
      onConsumedPrefill();
    }
  }, [prefillQuestion, onConsumedPrefill]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const message = input.trim();
    if (!message || sending) return;
    setMessages((m) => [...m, { role: "user", text: message }]);
    setInput("");
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "The assistant could not respond.");
        return;
      }
      setMessages((m) => [...m, { role: "assistant", text: data.reply, usedLanguageModel: data.usedLanguageModel }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The assistant could not respond.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-border-subtle p-3 ">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium">Ask the Investment Assistant</p>
        <DevBadge label="Decision support — never executes transactions" />
      </div>

      <div className="max-h-64 space-y-2 overflow-y-auto text-sm">
        {messages.length === 0 && (
          <p className="text-xs text-muted-2">
            Try: &quot;What&apos;s currently available?&quot;, &quot;Compare the TSLA wrappers&quot;, or &quot;What would $10 of TSLAB get me?&quot;
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : ""}>
            <span
              className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-left ${
                m.role === "user" ? "bg-brand text-brand-foreground" : "bg-surface-3 "
              }`}
            >
              {m.text}
            </span>
          </div>
        ))}
        {sending && <p className="text-xs text-muted-2">Thinking…</p>}
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        <div ref={endRef} />
      </div>

      <div className="mt-2 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Ask about available tokenized stocks…"
          className="flex-1 rounded border border-border-subtle bg-transparent px-2 py-1 text-sm "
        />
        <button type="button" onClick={send} disabled={sending || !input.trim()} className="rounded border border-border-subtle px-3 py-1 text-sm font-medium disabled:opacity-40 ">
          Send
        </button>
      </div>
      <p className="mt-1 text-xs text-muted">Not investment advice. Cannot sign, approve, or submit any transaction.</p>
    </div>
  );
}
