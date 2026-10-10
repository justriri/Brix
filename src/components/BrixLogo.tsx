import { BrixMark } from "@/components/BrixMark";

export function BrixLogo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const markSize = size === "lg" ? "h-9 w-9" : size === "md" ? "h-7 w-7" : "h-6 w-6";
  const textSize = size === "lg" ? "text-2xl" : size === "md" ? "text-lg" : "text-base";
  return (
    <span className="inline-flex items-center gap-2">
      <BrixMark className={`${markSize} text-foreground`} />
      <span className={`${textSize} font-bold tracking-tight`} style={{ fontFamily: "var(--font-display)" }}>
        BRIX
      </span>
    </span>
  );
}
