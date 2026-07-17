"use client";

import React from "react";
import { motion } from "motion/react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from "recharts";
import { TrendingUp, Layers, Gauge as GaugeIcon, ShieldAlert } from "lucide-react";
import Panel from "@/components/ui/Panel";
import StatCards from "@/components/shared/StatCards";
import { EmptyState, Meter, CountUp } from "@/components/ui/Primitives";
import { getClassLabel, getClassColor } from "@/lib/classUtils";
import { SURFACE, INK, SERIES, TOOLTIP_STYLE, healthColor, healthLabel } from "@/lib/theme";
import { stagger, rise } from "@/lib/motion";

/**
 * AnalyticsView — the full-page analytics grid.
 *
 * These charts used to be crushed into a 400px floating column, where a
 * 132px-tall area chart with seven date ticks was unreadable. Given the page,
 * each chart gets a real plot area and the axis labels stop colliding.
 */
export default function AnalyticsView({ analytics, roadHealthSegments }) {
  const series = analytics?.time_series || [];

  const mix = Object.entries(analytics?.class_distribution || {})
    .map(([name, value]) => ({ name, label: getClassLabel(name), value, color: getClassColor(name) }))
    .sort((a, b) => b.value - a.value);
  const mixTotal = mix.reduce((s, e) => s + e.value, 0);

  const worst = [...(roadHealthSegments || [])]
    .sort((a, b) => a.health_score - b.health_score)
    .slice(0, 6);

  return (
    <motion.div
      variants={stagger(0.05)}
      initial="hidden"
      animate="show"
      className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-3"
    >
      <div className="flex flex-col gap-3">
        <StatCards analytics={analytics} />

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.6fr_1fr]">
          {/* Trend — two series, ONE axis (both are report counts). A dual axis
              here would invent a correlation that isn't in the data. */}
          <Panel title="Detection trend" icon={TrendingUp}>
            {series.length === 0 ? (
              <EmptyState icon={TrendingUp} title="No time-series data yet" className="py-14" />
            ) : (
              <>
                <div className="mb-3 flex items-center gap-4">
                  {[
                    { k: "Total reports", c: SERIES.total },
                    { k: "High severity", c: SERIES.high },
                  ].map(({ k, c }) => (
                    <span key={k} className="flex items-center gap-1.5">
                      <span className="h-1.5 w-4 rounded-full" style={{ background: c }} />
                      <span className="text-ink-3 text-[10px] font-medium">{k}</span>
                    </span>
                  ))}
                </div>
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={series} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="avTotal" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={SERIES.total} stopOpacity={0.3} />
                        <stop offset="100%" stopColor={SERIES.total} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="avHigh" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={SERIES.high} stopOpacity={0.3} />
                        <stop offset="100%" stopColor={SERIES.high} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke={SURFACE.grid} vertical={false} />
                    <XAxis
                      dataKey="date"
                      stroke={INK.muted}
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                    />
                    <YAxis
                      stroke={INK.muted}
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                      width={44}
                      allowDecimals={false}
                    />
                    <Tooltip {...TOOLTIP_STYLE} />
                    <Area
                      type="monotone"
                      dataKey="total"
                      name="Total reports"
                      stroke={SERIES.total}
                      strokeWidth={2}
                      fill="url(#avTotal)"
                      dot={false}
                      activeDot={{ r: 3.5, strokeWidth: 2, stroke: SURFACE.surface }}
                    />
                    <Area
                      type="monotone"
                      dataKey="high"
                      name="High severity"
                      stroke={SERIES.high}
                      strokeWidth={2}
                      fill="url(#avHigh)"
                      dot={false}
                      activeDot={{ r: 3.5, strokeWidth: 2, stroke: SURFACE.surface }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </>
            )}
          </Panel>

          {/* Hazard mix — a horizontal bar, not a donut. Comparing close values
              on a ring is exactly what bars are for, and it stays readable as
              Person A ships the remaining PRD classes. */}
          <Panel title="Hazard mix" icon={Layers}>
            {mixTotal === 0 ? (
              <EmptyState icon={Layers} title="No hazard breakdown yet" className="py-14" />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={mix}
                  layout="vertical"
                  margin={{ top: 0, right: 34, left: 4, bottom: 0 }}
                  barCategoryGap={10}
                >
                  <CartesianGrid stroke={SURFACE.grid} horizontal={false} />
                  <XAxis
                    type="number"
                    stroke={INK.muted}
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    stroke={INK.muted}
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    width={96}
                  />
                  <Tooltip {...TOOLTIP_STYLE} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                  {/* Colour follows the class identity, never the row index —
                      filtering to one class must not repaint the survivors. */}
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={22}>
                    {mix.map((e) => (
                      <Cell key={e.name} fill={e.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Panel>
        </div>

        {/* Road health — status buckets, each with its label so colour never
            works alone. */}
        <Panel title="Road health · worst segments" icon={GaugeIcon} count={roadHealthSegments?.length}>
          {worst.length === 0 ? (
            <EmptyState icon={ShieldAlert} title="No segments analysed yet" className="py-10" />
          ) : (
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
              {worst.map((s) => {
                const c = healthColor(s.health_score);
                return (
                  <motion.div
                    key={s.hex_id}
                    variants={rise}
                    className="bg-raised/50 border-line flex flex-col gap-2 rounded-xl border p-3"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-ink-3 truncate font-mono text-[10px]">{s.hex_id}</span>
                      <div className="flex shrink-0 items-baseline gap-1.5">
                        <span className="text-[10px] font-semibold uppercase" style={{ color: c }}>
                          {healthLabel(s.health_score)}
                        </span>
                        <CountUp value={s.health_score} className="text-ink text-[15px] font-semibold" />
                      </div>
                    </div>
                    <Meter value={s.health_score} color={c} />
                    <span className="text-ink-3 text-[9px]">
                      {s.total_issues} issues · {s.total_reports} reports
                    </span>
                  </motion.div>
                );
              })}
            </div>
          )}
        </Panel>
      </div>
    </motion.div>
  );
}
