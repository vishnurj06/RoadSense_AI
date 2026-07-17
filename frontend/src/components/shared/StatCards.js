"use client";

import React from "react";
import { motion } from "motion/react";
import { MapPin, ScanLine, TriangleAlert } from "lucide-react";
import { CountUp, Sparkline } from "@/components/ui/Primitives";
import { ACCENT, STATUS, INK } from "@/lib/theme";
import { stagger, rise } from "@/lib/motion";

/**
 * StatCards — the KPI row (Reports / Detections / High Risk).
 *
 * A stat tile is the right form here: these are single current values, not
 * things to compare against each other, so a chart would be the wrong shape.
 * Each tile carries value + trend sparkline — the shape lives beside the
 * number instead of needing its own panel.
 *
 * High Risk wears the `critical` status token because it genuinely means bad;
 * the other two are neutral magnitudes and wear interface ink. That is why
 * only one tile is coloured — the coloured one is the one that needs you.
 *
 * Props:
 *   analytics: {
 *     total_reports: number,
 *     total_detections: number,
 *     severity_distribution: { high: number, medium: number, low: number },
 *     time_series?: [{ date, total, high }]
 *   }
 */
export default function StatCards({ analytics }) {
  const totalReports = analytics?.total_reports ?? 0;
  const totalDetections = analytics?.total_detections ?? 0;
  const highRisk = analytics?.severity_distribution?.high ?? 0;

  const series = Array.isArray(analytics?.time_series) ? analytics.time_series : [];
  const trendTotal = series.map((d) => d?.total ?? 0);
  const trendHigh = series.map((d) => d?.high ?? 0);

  const tiles = [
    {
      key: "reports",
      label: "Reports",
      value: totalReports,
      testId: "stat-reports",
      icon: MapPin,
      color: ACCENT,
      valueClass: "text-ink",
      trend: trendTotal,
    },
    {
      key: "detections",
      label: "Detections",
      value: totalDetections,
      testId: "stat-detections",
      icon: ScanLine,
      color: INK.secondary,
      valueClass: "text-ink",
      trend: trendTotal,
    },
    {
      key: "high-risk",
      label: "High Risk",
      value: highRisk,
      testId: "stat-high-risk",
      icon: TriangleAlert,
      color: STATUS.critical,
      valueClass: "text-critical",
      trend: trendHigh,
      alert: highRisk > 0,
    },
  ];

  return (
    <motion.section
      variants={stagger()}
      initial="hidden"
      animate="show"
      className="grid shrink-0 grid-cols-3 gap-2"
      data-testid="stat-cards"
    >
      {tiles.map(({ key, label, value, testId, icon: Icon, color, valueClass, trend, alert }) => (
        <motion.div
          key={key}
          variants={rise}
          whileHover={{ y: -2 }}
          className={`bg-surface/70 relative overflow-hidden rounded-xl border p-3 backdrop-blur-xl transition-colors ${
            alert ? "border-critical/30" : "border-line hover:border-line/80"
          }`}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="eyebrow truncate">{label}</span>
            <Icon
              className="h-3 w-3 shrink-0 opacity-70"
              style={{ color }}
              aria-hidden="true"
            />
          </div>

          {/* The count-up is decoration: it is aria-hidden, and the real value
              is exposed as text beside it. Screen readers get a stable number
              instead of a stream of intermediate ones, and the value is
              readable the instant it lands rather than only after the spring
              settles. Proportional figures — tabular would look loose here. */}
          <span aria-hidden="true">
            <CountUp
              value={value}
              className={`block text-[26px] leading-none font-semibold tracking-tight ${valueClass}`}
            />
          </span>
          <span data-testid={testId} className="sr-only">
            {value}
          </span>

          <div className="mt-2 -mb-1 h-[22px]">
            <Sparkline data={trend} color={color} width={90} height={22} />
          </div>
        </motion.div>
      ))}
    </motion.section>
  );
}
