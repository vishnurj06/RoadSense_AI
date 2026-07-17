"use client";

import React from "react";
import { Sliders } from "lucide-react";

/**
 * Filters — severity toggles, hazard class selector, and status dropdown.
 * Shared across Authority and Fleet dashboards.
 *
 * Props:
 *   severityFilter:    { high: bool, medium: bool, low: bool }
 *   setSeverityFilter: (updater) => void
 *   classFilter:       string   ("all" | any class name)
 *   setClassFilter:    (string) => void
 *   statusFilter:      string   ("all" | any status name)
 *   setStatusFilter:   (string) => void
 *   knownClasses:      string[] - list to populate the class filter buttons.
 *                      Defaults to ["pothole","road_crack"] (Phase 2 baseline).
 *                      Extend this as A ships new classes (B3-8 / Contract v3).
 */
export default function Filters({
  severityFilter,
  setSeverityFilter,
  classFilter,
  setClassFilter,
  statusFilter,
  setStatusFilter,
  realGpsOnly,
  setRealGpsOnly,
  knownClasses = ["pothole", "road_crack"],
}) {
  return (
    <section
      className="bg-slate-900/40 border border-slate-800/60 p-4 rounded-2xl flex flex-col gap-3 shrink-0"
      data-testid="filters-panel"
    >
      <div className="flex items-center gap-2 text-xs font-bold text-slate-400">
        <Sliders className="h-4 w-4" />
        <span>DASHBOARD FILTERS</span>
      </div>

      {/* Severity toggles */}
      <div className="flex flex-col gap-1.5 mt-1">
        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
          Severity Toggles:
        </span>
        <div className="flex gap-2">
          {Object.keys(severityFilter).map((sev) => (
            <button
              key={sev}
              data-testid={`severity-toggle-${sev}`}
              onClick={() =>
                setSeverityFilter((prev) => ({ ...prev, [sev]: !prev[sev] }))
              }
              className={`flex-1 py-1.5 px-3 text-xs font-semibold rounded-xl border transition cursor-pointer capitalize ${
                severityFilter[sev]
                  ? sev === "high"
                    ? "bg-red-500/10 text-red-400 border-red-500/40"
                    : sev === "medium"
                    ? "bg-orange-500/10 text-orange-400 border-orange-500/40"
                    : "bg-green-500/10 text-green-400 border-green-500/40"
                  : "bg-slate-950/20 text-slate-500 border-slate-800 hover:border-slate-700"
              }`}
            >
              {sev}
            </button>
          ))}
        </div>
      </div>

      {/* Hazard class filter — forward-compatible: renders whatever is in knownClasses */}
      <div className="flex flex-col gap-1.5 mt-1">
        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
          Hazard Type:
        </span>
        <div className="flex flex-wrap gap-2">
          <button
            data-testid="class-filter-all"
            onClick={() => setClassFilter("all")}
            className={`py-1.5 px-3 text-xs font-semibold rounded-xl border transition cursor-pointer ${
              classFilter === "all"
                ? "bg-blue-600/20 text-blue-400 border-blue-500/40"
                : "bg-slate-950/20 text-slate-500 border-slate-800 hover:border-slate-700"
            }`}
          >
            All Hazards
          </button>
          {knownClasses.map((cls) => (
            <button
              key={cls}
              data-testid={`class-filter-${cls}`}
              onClick={() => setClassFilter(cls)}
              className={`py-1.5 px-3 text-xs font-semibold rounded-xl border transition cursor-pointer capitalize ${
                classFilter === cls
                  ? "bg-blue-600/20 text-blue-400 border-blue-500/40"
                  : "bg-slate-950/20 text-slate-500 border-slate-800 hover:border-slate-700"
              }`}
            >
              {cls.replace(/_/g, " ")}
            </button>
          ))}
        </div>
      </div>

      {/* Status filter */}
      <div className="flex flex-col gap-1.5 mt-1">
        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
          Status Filter:
        </span>
        <select
          data-testid="status-filter-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded-xl text-xs p-2 text-slate-300 focus:outline-none focus:border-blue-500 w-full"
        >
          <option value="all">All Statuses</option>
          <option value="detected">Detected</option>
          <option value="verified">Verified</option>
          <option value="assigned">Assigned</option>
          <option value="inspection">Inspection</option>
          <option value="repair">Repair</option>
          <option value="completed">Completed</option>
          <option value="closed">Closed</option>
        </select>
      </div>

      {/* GPS filter */}
      {setRealGpsOnly && (
        <div className="flex items-center gap-2 mt-1 px-1">
          <input
            type="checkbox"
            id="gps-toggle"
            checked={realGpsOnly}
            onChange={(e) => setRealGpsOnly(e.target.checked)}
            className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-blue-500 focus:ring-blue-500 focus:ring-offset-slate-900"
          />
          <label htmlFor="gps-toggle" className="text-xs font-semibold text-slate-400 cursor-pointer select-none">
            Real GPS Only
          </label>
        </div>
      )}
    </section>
  );
}
