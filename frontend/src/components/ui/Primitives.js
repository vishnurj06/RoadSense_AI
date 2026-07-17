"use client";

import React, { useEffect, useRef, useState } from "react";
import { motion, useSpring, useTransform, useReducedMotion } from "motion/react";
import { AlertTriangle, AlertCircle, CheckCircle2, MinusCircle } from "lucide-react";
import { getMaxSeverity, getSeverityBadgeStyle } from "@/lib/classUtils";
import { T } from "@/lib/motion";

/* ── CountUp ────────────────────────────────────────────────────────────────
   Animated numeric. Springs to its target so a refetch reads as a *change*
   rather than a silent swap. Proportional figures, never tabular: equal-width
   digits make a large standalone number look loose.
   Honours prefers-reduced-motion by snapping.                                */

export function CountUp({ value = 0, className = "" }) {
  const reduce = useReducedMotion();
  const target = Number(value) || 0;
  const spring = useSpring(0, { stiffness: 90, damping: 22, mass: 0.8 });
  const display = useTransform(spring, (v) => Math.round(v).toLocaleString());
  const [text, setText] = useState(() => target.toLocaleString());

  // Deliberately no useInView/IntersectionObserver here: these tiles are always
  // on screen, so an observer would buy nothing and cost a jsdom polyfill.
  useEffect(() => {
    if (!reduce) spring.set(target);
  }, [target, reduce, spring]);

  useEffect(() => display.on("change", setText), [display]);

  return <span className={className}>{reduce ? target.toLocaleString() : text}</span>;
}

/* ── LiveDot ────────────────────────────────────────────────────────────────
   The one thing allowed to loop forever: it means "this data is live".
   Accent, because accent is interface-only and never encodes data.           */

export function LiveDot({ label = "Live", active = true }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="relative flex h-1.5 w-1.5">
        {active && (
          <span
            className="bg-accent absolute inline-flex h-full w-full rounded-full opacity-70"
            style={{ animation: "rs-pulse-ring 2s cubic-bezier(0,0,0.2,1) infinite" }}
          />
        )}
        <span
          className={`relative inline-flex h-1.5 w-1.5 rounded-full ${active ? "bg-accent" : "bg-ink-3"}`}
        />
      </span>
      <span
        className={`text-[10px] font-medium tracking-wide ${active ? "text-accent" : "text-ink-3"}`}
      >
        {label}
      </span>
    </span>
  );
}

/* ── Chip ───────────────────────────────────────────────────────────────── */

export function Chip({ children, className = "", mono = false, title }) {
  return (
    <span
      title={title}
      className={`border-line inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] leading-none font-medium ${mono ? "font-mono tnum" : ""} ${className}`}
    >
      {children}
    </span>
  );
}

/* ── SeverityBadge ──────────────────────────────────────────────────────────
   Severity is the only thing wearing hue, so it always ships icon + label —
   colour never carries the meaning alone.                                    */

const SEV_ICON = {
  high: AlertTriangle,
  medium: AlertCircle,
  low: CheckCircle2,
};

export function SeverityBadge({ severity, detections, className = "" }) {
  const sev = severity || getMaxSeverity(detections);
  const Icon = SEV_ICON[sev] || MinusCircle;
  return (
    <Chip className={`${getSeverityBadgeStyle(sev)} uppercase ${className}`}>
      <Icon className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
      {sev}
    </Chip>
  );
}

/* ── Meter ──────────────────────────────────────────────────────────────────
   A single ratio against a limit. The skill's answer to "a pie of 2 slices".
   Fill animates from 0 on mount so the value reads as measured, not printed. */

export function Meter({ value = 0, max = 100, color, track = "bg-sunken", className = "" }) {
  const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  return (
    <div className={`h-1 w-full overflow-hidden rounded-full ${track} ${className}`}>
      <motion.div
        className="h-full rounded-full"
        style={{ background: color }}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ ...T.slow, delay: 0.08 }}
      />
    </div>
  );
}

/* ── Sparkline ──────────────────────────────────────────────────────────────
   Stat-tile trend. Draws itself in (pathLength) so the tile assembles.
   Deliberately axis-less and label-less: it shows shape, the number shows
   value, and the real chart is one panel away.                               */

export function Sparkline({ data = [], color, width = 72, height = 22 }) {
  const reduce = useReducedMotion();
  if (!data.length) return <div style={{ width, height }} />;

  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const span = max - min || 1;
  const step = data.length > 1 ? width / (data.length - 1) : width;
  const pts = data.map((d, i) => [i * step, height - ((d - min) / span) * (height - 3) - 1.5]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const gid = `spark-${color?.replace("#", "")}-${data.length}`;

  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.22} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <motion.path
        d={area}
        fill={`url(#${gid})`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.25 }}
      />
      <motion.path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduce ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
      />
    </svg>
  );
}

/* ── EmptyState ─────────────────────────────────────────────────────────── */

export function EmptyState({ icon: Icon, title, hint, className = "" }) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 px-4 py-8 text-center ${className}`}
    >
      {Icon && (
        <div className="bg-sunken border-line rounded-xl border p-2.5">
          <Icon className="text-ink-3 h-4 w-4" />
        </div>
      )}
      <p className="text-ink-2 text-xs font-medium">{title}</p>
      {hint && <p className="text-ink-3 max-w-[18rem] text-[11px] leading-relaxed">{hint}</p>}
    </div>
  );
}

/* ── Skeleton ───────────────────────────────────────────────────────────────
   Only for a FIRST load. On refetch, hold the previous render at reduced
   opacity instead — a skeleton flash on refresh is a layout jump for no
   information.                                                               */

export function Skeleton({ className = "" }) {
  return (
    <div className={`bg-raised relative overflow-hidden rounded-lg ${className}`}>
      <div
        className="animate-sweep absolute inset-0"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(255,255,255,0.045), transparent)",
        }}
      />
    </div>
  );
}

/* ── IconButton ─────────────────────────────────────────────────────────── */

export function IconButton({
  icon: Icon,
  label,
  onClick,
  active = false,
  spinning = false,
  disabled = false,
  className = "",
  ...rest
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      whileTap={{ scale: 0.92 }}
      transition={T.fast}
      className={`border-line inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "bg-accent/10 border-accent/30 text-accent"
          : "bg-raised text-ink-3 hover:text-ink hover:bg-hover"
      } ${className}`}
      {...rest}
    >
      <Icon className={`h-3.5 w-3.5 ${spinning ? "animate-spin" : ""}`} />
    </motion.button>
  );
}
