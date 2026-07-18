import React from "react";
import { ACCENT } from "@/lib/theme";

/**
 * RoadSense logo mark.
 *
 * Concept: the product is "seeing the road." So the mark is a road in
 * perspective — two edges converging to a horizon with a dashed centre line —
 * capped by a bright detection node emitting two sensing arcs. Road (structure)
 * in the inherited ink colour, the sensing (intelligence) in the accent. It
 * reads at 16px and scales cleanly; distinct from the generic pulse/heartbeat
 * the app shipped with.
 *
 * `roadColor` defaults to currentColor so the glyph inherits ink from its
 * container; `accent` is the sensing colour.
 */
export default function Logo({ size = 24, className = "", accent = ACCENT }) {
  const uid = React.useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      role="img"
      aria-label="RoadSense"
    >
      <defs>
        <linearGradient id={`${uid}-road`} x1="16" y1="30" x2="16" y2="9" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.95" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.35" />
        </linearGradient>
        <radialGradient id={`${uid}-glow`} cx="16" cy="8.5" r="7" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={accent} stopOpacity="0.55" />
          <stop offset="1" stopColor={accent} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* node glow */}
      <circle cx="16" cy="8.5" r="7" fill={`url(#${uid}-glow)`} />

      {/* road edges converging to the horizon */}
      <path
        d="M4.5 29.5 L13 10 M27.5 29.5 L19 10"
        stroke={`url(#${uid}-road)`}
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      {/* dashed centre line */}
      <path
        d="M16 28 L16 12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="2.2 3.2"
        opacity="0.55"
      />

      {/* sensing arcs radiating from the detection node */}
      <path
        d="M10.5 8.5 A5.5 5.5 0 0 1 21.5 8.5"
        stroke={accent}
        strokeWidth="1.7"
        strokeLinecap="round"
        opacity="0.9"
      />
      <path
        d="M7.5 9 A8.5 8.5 0 0 1 24.5 9"
        stroke={accent}
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.45"
      />

      {/* detection node */}
      <circle cx="16" cy="8.5" r="2.6" fill={accent} />
      <circle cx="16" cy="8.5" r="2.6" stroke="#04060a" strokeWidth="1" opacity="0.35" />
    </svg>
  );
}
