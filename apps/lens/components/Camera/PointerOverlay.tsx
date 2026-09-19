"use client";

/**
 * PointerOverlay — maps a normalized bounding box onto the video's *rendered*
 * pixels.
 *
 * The subtlety that makes boxes land in the wrong place: a <video> element's
 * box is almost never the same aspect ratio as the frames inside it. With
 * object-fit: cover the frame is scaled up and cropped; with contain it is
 * scaled down and letterboxed. Either way the visible image occupies a
 * sub-rectangle of the element, offset from the element's origin.
 *
 * So the mapping is two steps, not one:
 *   1. work out the rendered image rectangle inside the element
 *   2. map the normalized box into *that* rectangle
 *
 * Mapping straight from normalized coordinates to element width/height — the
 * obvious thing — is correct only when the aspect ratios happen to match, and
 * looks subtly, confusingly wrong the rest of the time.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

export type PointerBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Metrics = {
  /** Element box, CSS pixels. */
  elementWidth: number;
  elementHeight: number;
  /** Intrinsic frame size. */
  videoWidth: number;
  videoHeight: number;
};

/** How long a box is treated as current, and when it has fully faded. */
const FRESH_MS = 4000;
const STALE_MS = 10000;

const EMPTY: Metrics = {
  elementWidth: 0,
  elementHeight: 0,
  videoWidth: 0,
  videoHeight: 0,
};

export function PointerOverlay({
  box,
  label,
  videoEl,
  objectFit = "cover",
  active = false,
  lowConfidence = false,
  capturedAt,
}: {
  box: PointerBox | null;
  label?: string;
  videoEl: HTMLVideoElement | null;
  /** Must match the CSS object-fit on the <video>. */
  objectFit?: "cover" | "contain";
  /** True while a vision call is in flight. */
  active?: boolean;
  /** True when the model could not read the frame confidently. */
  lowConfidence?: boolean;
  /** When the box was produced. Drives the staleness fade. */
  capturedAt?: number;
}) {
  const [metrics, setMetrics] = useState<Metrics>(EMPTY);
  const [age, setAge] = useState(0);

  // A box is drawn from a frame captured seconds ago, over video that has
  // moved on. Held at full strength it lies: the student moves their hand and
  // the box sits confidently on nothing. Fading it out says "this is what I
  // saw a moment ago" without pretending it is live.
  useEffect(() => {
    if (!capturedAt) return;
    setAge(0);
    const tick = window.setInterval(() => setAge(Date.now() - capturedAt), 250);
    return () => window.clearInterval(tick);
  }, [capturedAt]);

  const measure = useCallback(() => {
    if (!videoEl) {
      setMetrics(EMPTY);
      return;
    }

    const rect = videoEl.getBoundingClientRect();
    const next: Metrics = {
      elementWidth: rect.width,
      elementHeight: rect.height,
      videoWidth: videoEl.videoWidth,
      videoHeight: videoEl.videoHeight,
    };

    setMetrics((prev) =>
      prev.elementWidth === next.elementWidth &&
      prev.elementHeight === next.elementHeight &&
      prev.videoWidth === next.videoWidth &&
      prev.videoHeight === next.videoHeight
        ? prev
        : next
    );
  }, [videoEl]);

  useEffect(() => {
    if (!videoEl) return;

    measure();

    // ResizeObserver catches layout changes the window resize event misses:
    // sidebars opening, flex reflow, devtools docking.
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(videoEl);

    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    videoEl.addEventListener("loadedmetadata", measure);
    videoEl.addEventListener("resize", measure);
    videoEl.addEventListener("playing", measure);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
      videoEl.removeEventListener("loadedmetadata", measure);
      videoEl.removeEventListener("resize", measure);
      videoEl.removeEventListener("playing", measure);
    };
  }, [videoEl, measure]);

  const geometry = useMemo(() => {
    const { elementWidth, elementHeight, videoWidth, videoHeight } = metrics;
    if (!box || !elementWidth || !elementHeight || !videoWidth || !videoHeight) {
      return null;
    }

    // Step 1: the rendered image rectangle inside the element.
    // contain fits the whole frame (letterbox); cover fills the element (crop).
    const scale =
      objectFit === "contain"
        ? Math.min(elementWidth / videoWidth, elementHeight / videoHeight)
        : Math.max(elementWidth / videoWidth, elementHeight / videoHeight);

    const renderedWidth = videoWidth * scale;
    const renderedHeight = videoHeight * scale;

    // object-position defaults to 50% 50%, so the image is centered. Under
    // cover these offsets are negative — the frame overflows the element.
    const offsetX = (elementWidth - renderedWidth) / 2;
    const offsetY = (elementHeight - renderedHeight) / 2;

    // Step 2: normalized box into the rendered rectangle.
    return {
      left: offsetX + box.x * renderedWidth,
      top: offsetY + box.y * renderedHeight,
      width: box.width * renderedWidth,
      height: box.height * renderedHeight,
      elementWidth,
      elementHeight,
    };
  }, [box, metrics, objectFit]);

  // Full strength for 4s, then fade to a faint trace by 10s.
  const freshness =
    !capturedAt || age < FRESH_MS
      ? 1
      : Math.max(0.18, 1 - (age - FRESH_MS) / (STALE_MS - FRESH_MS));
  const stale = freshness < 0.95;

  if (!geometry) return null;

  // The aperture teal, and the only place it appears on this screen.
  const stroke = lowConfidence ? "#B45309" : "#00C2A8";
  const labelText = stale && label ? `${label} · a moment ago` : label?.trim();

  // Keep the label inside the frame when the box hugs an edge.
  const labelWidth = labelText ? Math.max(58, labelText.length * 7.2 + 18) : 0;
  const labelX = Math.min(
    Math.max(4, geometry.left),
    Math.max(4, geometry.elementWidth - labelWidth - 4)
  );
  const labelAbove = geometry.top >= 28;
  const labelY = labelAbove ? geometry.top - 26 : Math.min(geometry.top + geometry.height + 4, geometry.elementHeight - 26);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <svg
        style={{ opacity: freshness, transition: "opacity 250ms linear" }}
        width={geometry.elementWidth}
        height={geometry.elementHeight}
        viewBox={`0 0 ${geometry.elementWidth} ${geometry.elementHeight}`}
        className="absolute left-0 top-0"
        aria-hidden
      >
        <rect
          x={geometry.left}
          y={geometry.top}
          width={geometry.width}
          height={geometry.height}
          rx={10}
          fill="none"
          stroke={stroke}
          strokeWidth={3}
          strokeDasharray={lowConfidence ? "8 6" : stale ? "3 5" : undefined}
          opacity={0.95}
        >
          {active ? (
            <animate
              attributeName="opacity"
              values="0.45;1;0.45"
              dur="1.2s"
              repeatCount="indefinite"
            />
          ) : null}
        </rect>

        {labelText ? (
          <g>
            <rect
              x={labelX}
              y={labelY}
              width={labelWidth}
              height={22}
              rx={6}
              fill="rgba(11,18,32,0.82)"
              stroke={stroke}
              strokeWidth={1}
            />
            <text
              x={labelX + 9}
              y={labelY + 15}
              fill="#F7F9FA"
              fontSize={12}
              fontWeight={600}
              fontFamily="ui-sans-serif, system-ui, sans-serif"
            >
              {labelText}
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  );
}
