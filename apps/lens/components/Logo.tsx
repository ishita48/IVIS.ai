import { cn } from "@/lib/cn";

/**
 * LENS mark — an aperture. Concentric rings with one segment picked out in
 * the signal colour: the product in one glyph, something looking at one
 * specific thing rather than at everything.
 */
export function Logo({
  className,
  showWord = true,
  invert = false,
}: {
  className?: string;
  showWord?: boolean;
  invert?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <svg viewBox="0 0 32 32" className="size-7 shrink-0" aria-hidden>
        <circle
          cx="16"
          cy="16"
          r="13"
          fill="none"
          strokeWidth="1.6"
          className={invert ? "stroke-white/40" : "stroke-ink-300"}
        />
        <circle
          cx="16"
          cy="16"
          r="7.5"
          fill="none"
          strokeWidth="1.6"
          className={invert ? "stroke-white/25" : "stroke-ink-500"}
        />
        <circle cx="16" cy="16" r="3" className="fill-signal" />
        <path
          d="M16 3 A13 13 0 0 1 27.3 9.5"
          fill="none"
          strokeWidth="2.4"
          strokeLinecap="round"
          className="stroke-signal"
        />
      </svg>
      {showWord && (
        <span
          className={cn(
            "text-[19px] font-semibold tracking-[0.18em]",
            invert ? "text-white" : "text-ink-100"
          )}
        >
          LENS
        </span>
      )}
    </div>
  );
}
