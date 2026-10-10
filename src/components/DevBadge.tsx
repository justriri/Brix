export function DevBadge({ label = "Development only" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-800 ring-1 ring-inset ring-violet-600/20 dark:bg-violet-950 dark:text-violet-300 dark:ring-violet-400/30">
      ⚠ {label}
    </span>
  );
}
