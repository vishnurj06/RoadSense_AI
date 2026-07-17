"use client";

import React from "react";
import {
  Activity,
  CheckCircle,
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  PieChart,
  Pie,
  Cell,
} from "recharts"; // recharts is a direct dep already
import {
  ResponsiveContainer as RC,
  AreaChart as AC,
  Area as Ar,
  XAxis as XA,
  YAxis as YA,
  Tooltip as ChartTooltip,
  PieChart as PC,
  Pie as Pi,
  Cell as Ce,
} from "recharts";
import { Activity as ActivityIcon, CheckCircle as CheckCircleIcon, Map as MapIcon, ShieldAlert } from "lucide-react";
import {
  getMaxSeverity,
  getSeverityBadgeStyle,
  getStatusBadgeStyle,
} from "@/lib/classUtils";
import Filters from "@/components/shared/Filters";

const PIE_COLORS = ["#3b82f6", "#6366f1", "#f59e0b", "#ec4899", "#22c55e", "#a855f7", "#14b8a6"];

/**
 * PendingRepairQueue — list of issues in actionable states with quick-action buttons.
 */
function PendingRepairQueue({ mapIssues, onQuickAction }) {
  const pendingIssues = mapIssues.filter((issue) =>
    ["detected", "verified", "repair"].includes(
      (issue.status || "detected").toLowerCase()
    )
  );

  const nextStatusMap = { detected: "verified", verified: "repair", repair: "completed" };
  const actionLabelMap = { detected: "Verify", verified: "Dispatch", repair: "Complete" };

  return (
    <section
      className="bg-slate-900/40 border border-slate-800/60 p-4 rounded-2xl flex flex-col overflow-hidden min-h-[16rem] max-h-[22rem]"
      data-testid="pending-repair-queue"
    >
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-400">
          <ActivityIcon className="h-4 w-4 text-blue-400" />
          <span>PENDING ACTION QUEUE ({pendingIssues.length})</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1">
        {pendingIssues.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-600 text-xs py-8">
            <CheckCircleIcon className="h-8 w-8 mb-2 opacity-30 text-green-500" />
            No issues pending action.
          </div>
        ) : (
          pendingIssues.map((issue) => {
            const maxSeverity = getMaxSeverity(issue.detections);
            const currentStatus = (issue.status || "detected").toLowerCase();
            const nextStatus = nextStatusMap[currentStatus];
            const actionLabel = actionLabelMap[currentStatus];

            return (
              <div
                key={issue.id}
                className="bg-slate-950/40 border border-slate-800/80 rounded-xl p-3 flex flex-col gap-2 transition duration-150"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-100">
                      Issue: #{issue.id.slice(0, 8)}
                    </span>
                    <span
                      className={`text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded-full shrink-0 border ${getSeverityBadgeStyle(
                        maxSeverity
                      )}`}
                    >
                      {maxSeverity}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded">
                    {issue.detection_count} reports
                  </span>
                </div>

                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] text-slate-500 italic">
                    Type: {issue.class_name || "Mixed"} | Lat:{" "}
                    {issue.latitude?.toFixed(4)}
                  </span>
                  {nextStatus && (
                    <button
                      onClick={() => onQuickAction(issue.id, nextStatus)}
                      className="px-2 py-1 text-[10px] font-extrabold bg-blue-600 hover:bg-blue-500 text-white rounded transition cursor-pointer"
                    >
                      {actionLabel}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

/**
 * AnalyticsCharts — volume trend (AreaChart) + class distribution (PieChart).
 */
function AnalyticsCharts({ analytics }) {
  const pieData = Object.entries(analytics?.class_distribution || {}).map(
    ([name, value]) => ({ name: name.toUpperCase(), value })
  );

  return (
    <section className="bg-slate-900/40 border border-slate-800/60 p-4 rounded-2xl flex flex-col gap-4 shrink-0">
      <div>
        <span className="text-xs font-bold text-slate-400 uppercase tracking-wide">
          REPORT VOLUME TRENDS
        </span>
        <div className="mt-3">
          {analytics?.time_series?.length > 0 ? (
            <RC width="100%" height={150}>
              <AC
                data={analytics.time_series}
                margin={{ top: 5, right: 5, left: -25, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="colorHigh" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XA dataKey="date" stroke="#64748b" fontSize={9} tickLine={false} />
                <YA stroke="#64748b" fontSize={9} tickLine={false} />
                <ChartTooltip
                  contentStyle={{
                    backgroundColor: "#0f172a",
                    borderColor: "#334155",
                    borderRadius: "8px",
                  }}
                  labelStyle={{ color: "#94a3b8", fontSize: 9 }}
                  itemStyle={{ fontSize: 9 }}
                />
                <Ar
                  type="monotone"
                  dataKey="total"
                  stroke="#3b82f6"
                  fillOpacity={1}
                  fill="url(#colorTotal)"
                  name="Total Reports"
                  strokeWidth={1.5}
                />
                <Ar
                  type="monotone"
                  dataKey="high"
                  stroke="#ef4444"
                  fillOpacity={1}
                  fill="url(#colorHigh)"
                  name="High Severity"
                  strokeWidth={1.5}
                />
              </AC>
            </RC>
          ) : (
            <p className="text-xs text-slate-600 text-center py-4">
              No time-series data available
            </p>
          )}
        </div>
      </div>

      <div className="border-t border-slate-800/80 pt-4">
        <span className="text-xs font-bold text-slate-400 uppercase tracking-wide">
          HAZARD DISTRIBUTION
        </span>
        <div className="flex items-center justify-between gap-2 mt-2">
          <div className="flex-1">
            {pieData.length > 0 ? (
              <RC width="100%" height={120}>
                <PC>
                  <Pi
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={25}
                    outerRadius={45}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {pieData.map((_, index) => (
                      <Ce
                        key={`cell-${index}`}
                        fill={PIE_COLORS[index % PIE_COLORS.length]}
                      />
                    ))}
                  </Pi>
                  <ChartTooltip
                    contentStyle={{
                      backgroundColor: "#0f172a",
                      borderColor: "#334155",
                      borderRadius: "8px",
                    }}
                    itemStyle={{ fontSize: 9 }}
                  />
                </PC>
              </RC>
            ) : (
              <p className="text-xs text-slate-600 text-center py-4">
                No hazard breakdown available
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5 shrink-0">
            {pieData.map((d, index) => (
              <div key={d.name} className="flex items-center gap-2">
                <div
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }}
                />
                <span className="text-[10px] font-semibold text-slate-400 capitalize">
                  {d.name.toLowerCase()} ({d.value})
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * RoadHealthPanel — displays worst road segments and toggle for map overlay
 */
function RoadHealthPanel({ roadHealthSegments, showRoadHealth, setShowRoadHealth }) {
  const worstSegments = [...(roadHealthSegments || [])]
    .sort((a, b) => a.health_score - b.health_score)
    .slice(0, 5);

  return (
    <section className="bg-slate-900/40 border border-slate-800/60 p-4 rounded-2xl flex flex-col shrink-0">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wide">
          <ShieldAlert className="h-4 w-4 text-orange-500" />
          <span>ROAD HEALTH (WORST SEGMENTS)</span>
        </div>
        <button
          onClick={() => setShowRoadHealth(!showRoadHealth)}
          className={`px-3 py-1 text-[10px] font-extrabold rounded-full transition cursor-pointer flex items-center gap-1.5 ${
            showRoadHealth 
              ? "bg-blue-600 text-white border border-blue-500" 
              : "bg-slate-800 text-slate-400 hover:bg-slate-700 border border-slate-700"
          }`}
        >
          <MapIcon className="h-3 w-3" />
          {showRoadHealth ? "HIDE CHOROPLETH" : "SHOW CHOROPLETH"}
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {worstSegments.length === 0 ? (
          <div className="text-xs text-slate-500 italic py-2 text-center">No segments analyzed yet.</div>
        ) : (
          worstSegments.map(segment => (
            <div key={segment.hex_id} className="bg-slate-950/40 border border-slate-800/80 rounded-xl p-2.5 flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-300 font-semibold font-mono">
                  {segment.hex_id}
                </span>
                <span className="text-[9px] text-slate-500">
                  {segment.total_issues} issues · {segment.total_reports} reports
                </span>
              </div>
              <div className="flex flex-col items-end">
                <span className={`text-xs font-black ${
                  segment.health_score >= 80 ? "text-green-400" :
                  segment.health_score >= 50 ? "text-yellow-400" :
                  segment.health_score >= 30 ? "text-orange-400" : "text-red-400"
                }`}>
                  {segment.health_score.toFixed(1)}
                </span>
                <span className="text-[8px] text-slate-500 uppercase font-bold tracking-widest">Score</span>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

/**
 * AuthorityDashboard — Pending queue + analytics charts + filters.
 *
 * Props:
 *   analytics, mapIssues, onQuickAction,
 *   severityFilter, setSeverityFilter,
 *   classFilter, setClassFilter,
 *   statusFilter, setStatusFilter
 */
export default function AuthorityDashboard({
  analytics,
  mapIssues,
  onQuickAction,
  roadHealthSegments,
  showRoadHealth,
  setShowRoadHealth,
  severityFilter,
  setSeverityFilter,
  classFilter,
  setClassFilter,
  statusFilter,
  setStatusFilter,
  realGpsOnly,
  setRealGpsOnly,
}) {
  return (
    <>
      <Filters
        severityFilter={severityFilter}
        setSeverityFilter={setSeverityFilter}
        classFilter={classFilter}
        setClassFilter={setClassFilter}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        realGpsOnly={realGpsOnly}
        setRealGpsOnly={setRealGpsOnly}
      />
      <RoadHealthPanel 
        roadHealthSegments={roadHealthSegments} 
        showRoadHealth={showRoadHealth}
        setShowRoadHealth={setShowRoadHealth}
      />
      <PendingRepairQueue mapIssues={mapIssues} onQuickAction={onQuickAction} />
      <AnalyticsCharts analytics={analytics} />
    </>
  );
}
