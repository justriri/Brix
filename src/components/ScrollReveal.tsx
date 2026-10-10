"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Minimal, dependency-free "fade up when scrolled into view" wrapper —
 * IntersectionObserver only, no animation library. Reveals once and stays
 * revealed (re-scrolling past it doesn't re-hide it), and respects
 * prefers-reduced-motion via the CSS in globals.css (.brix-reveal).
 */
export function ScrollReveal({ children, delayMs = 0, className = "", id }: { children: React.ReactNode; delayMs?: number; className?: string; id?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setRevealed(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div id={id} ref={ref} className={`brix-reveal ${revealed ? "brix-revealed" : ""} ${className}`} style={{ animationDelay: `${delayMs}ms` }}>
      {children}
    </div>
  );
}
