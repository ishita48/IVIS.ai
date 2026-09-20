import { cn } from "@/lib/cn";

/**
 * LENS mark — a biconvex lens (side-profile cross-section): two circular
 * arcs of r=13 sharing endpoints at (3,16) and (29,16), more optically
 * specific than the old aperture-ring glyph.
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
  const uid = "lens-mark";
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <svg viewBox="0 0 32 32" className="size-7 shrink-0" aria-hidden>
        <defs>
          <radialGradient id={`${uid}-fill`} cx="47%" cy="38%" r="60%" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={invert ? "#FCE4DC" : "#FBD8CC"} />
            <stop offset="45%" stopColor={invert ? "#EFB4A3" : "#E67A55"} />
            <stop offset="100%" stopColor={invert ? "#C96A44" : "#B03D21"} />
          </radialGradient>
          <radialGradient id={`${uid}-sheen`} cx="38%" cy="28%" r="42%" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="rgba(255,255,255,0.32)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
        </defs>
        <path
          d="M3,16 A13,13 0 0,0 29,16 A13,13 0 0,0 3,16 Z"
          fill={`url(#${uid}-fill)`}
        />
        <path
          d="M3,16 A13,13 0 0,0 29,16 A13,13 0 0,0 3,16 Z"
          fill={`url(#${uid}-sheen)`}
        />
        <path
          d="M3,16 A13,13 0 0,0 29,16 A13,13 0 0,0 3,16 Z"
          stroke={invert ? "rgba(255,255,255,0.35)" : "rgba(120,50,20,0.45)"}
          strokeWidth="1"
          fill="none"
        />
        <circle cx="16" cy="16" r="3" fill="white" fillOpacity={invert ? 0.9 : 0.96} />
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
