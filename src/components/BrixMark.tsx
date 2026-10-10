/**
 * The BRIX mark — a single, intentional geometric symbol, not a "B" made
 * of bricks. Two rounded squares: a larger outlined block (the position)
 * with a smaller solid block (protection) anchored into its corner,
 * slightly overlapping. The idea is literal enough to be legible at a
 * glance — "an asset, with a protective layer locked onto it" — and
 * simple enough to read correctly at 16px (favicon) as well as at banner
 * size, in exactly two shapes with no gradients or fine detail that would
 * disappear when scaled down.
 *
 * Deliberately NOT: a bar chart (overused in fintech), an isometric cube
 * (generic "blockchain" cliché), or literal masonry/brick texture.
 */
export function BrixMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} role="img" aria-label={title ?? "BRIX"}>
      <rect x="3" y="3" width="21" height="21" rx="6" stroke="currentColor" strokeWidth="2.25" />
      <rect x="15" y="15" width="14" height="14" rx="4.5" fill="var(--color-brand)" />
    </svg>
  );
}
