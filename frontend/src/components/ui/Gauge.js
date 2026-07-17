"use client";

import React from "react";
import { motion, useReducedMotion } from "motion/react";
import { CountUp } from "@/components/ui/Primitives";
import { SURFACE } from "@/lib/theme";

/**
 * Gauge — a radial meter for a single ratio against a limit.
 *
 * A 270° arc rather than a full ring: the gap gives the value a start and an
 * end, so "how full" is readable at a glance instead of having to find where
 * the ring began.
 *
 * The colour is supplied by the caller (see loadColor in AdminView) so a gauge
 * only takes on a status hue once the number actually matters — a permanently
 * coloured dial is decoration.
 */
export default function Gauge({
  value = 0,
  max = 100,
  size = 132,
  stroke = 9,
  color,
  label,
  suffix = "%",
}) {
  const reduce = useReducedMotion();
  const pct = Math.max(0, Math.min(1, (value || 0) / (max || 1)));

  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const SWEEP = 0.75; // 270° of the circle
  const track = circumference * SWEEP;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-[225deg]">
          {/* Track. Deliberately NOT `sunken` — at #0A0D12 on a near-black card
              it was invisible, so a 20% reading rendered as an unexplained
              sliver floating on the left with nothing to measure it against.
              The track is what makes the value legible. */}
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={SURFACE.line}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${track} ${circumference}`}
          />
          {/* Value */}
          <motion.circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${track} ${circumference}`}
            initial={reduce ? false : { strokeDashoffset: track }}
            animate={{ strokeDashoffset: track * (1 - pct) }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
            style={{ filter: `drop-shadow(0 0 6px ${color}55)` }}
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="flex items-baseline">
            <CountUp
              value={value}
              className="text-ink text-[24px] leading-none font-semibold tracking-tight"
            />
            <span className="text-ink-3 text-[12px] font-medium">{suffix}</span>
          </div>
        </div>
      </div>
      {label && <span className="eyebrow">{label}</span>}
    </div>
  );
}
