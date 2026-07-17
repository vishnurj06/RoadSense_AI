"use client";

import React from "react";
import { motion } from "motion/react";
import { SlidersHorizontal, Satellite, RotateCcw } from "lucide-react";
import { getClassLabel } from "@/lib/classUtils";
import { T } from "@/lib/motion";

/**
 * Filters — severity toggles, hazard class selector, status, GPS provenance.
 *
 * These scope BOTH the map and the report/issue lists, so this is one filter
 * row for everything it affects — never a filter living inside the card it
 * filters.
 *
 * Severity chips are the one control that wears hue, and only while ON: an
 * active `high` chip is `critical` red because it is showing you critical
 * things. Switched off, it drops to neutral ink — so the row reads as "what am
 * I currently letting through" at a glance.
 *
 * Props:
 *   severityFilter:    { high: bool, medium: bool, low: bool }
 *   setSeverityFilter: (updater) => void
 *   classFilter:       string   ("all" | any class name)
 *   setClassFilter:    (string) => void
 *   statusFilter:      string   ("all" | any status name)
 *   setStatusFilter:   (string) => void
 *   realGpsOnly:       bool
 *   setRealGpsOnly:    (bool) => void
 *   knownClasses:      string[] - list to populate the class filter buttons.
 *                      Defaults to ["pothole","road_crack"] (Phase 2 baseline).
 *                      Extend this as A ships new classes (B3-8 / Contract v3).
 */

const SEV_ON = {
  high: "bg-critical/12 text-critical border-critical/35",
  medium: "bg-warning/12 text-warning border-warning/35",
  low: "bg-good/12 text-good border-good/35",
};

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
  const severities = Object.keys(severityFilter);
  const dirty =
    severities.some((s) => !severityFilter[s]) ||
    classFilter !== "all" ||
    statusFilter !== "all" ||
    !!realGpsOnly;

  const reset = () => {
    setSeverityFilter(Object.fromEntries(severities.map((s) => [s, true])));
    setClassFilter("all");
    setStatusFilter("all");
    setRealGpsOnly?.(false);
  };

  return (
    <section
      className="bg-surface/70 border-line flex shrink-0 flex-col gap-3 rounded-2xl border p-3 backdrop-blur-xl"
      data-testid="filters-panel"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="text-ink-3 h-3.5 w-3.5" />
          <span className="eyebrow">Filters</span>
        </div>
        {dirty && (
          <motion.button
            type="button"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={T.fast}
            onClick={reset}
            className="text-ink-3 hover:text-accent flex cursor-pointer items-center gap-1 text-[10px] font-medium transition-colors"
          >
            <RotateCcw className="h-2.5 w-2.5" />
            Reset
          </motion.button>
        )}
      </div>

      {/* Severity */}
      <div className="flex gap-1.5">
        {severities.map((sev) => {
          const on = severityFilter[sev];
          return (
            <motion.button
              key={sev}
              type="button"
              data-testid={`severity-toggle-${sev}`}
              whileTap={{ scale: 0.95 }}
              transition={T.fast}
              aria-pressed={on}
              onClick={() => setSeverityFilter((prev) => ({ ...prev, [sev]: !prev[sev] }))}
              className={`flex-1 cursor-pointer rounded-lg border py-1.5 text-[11px] font-medium capitalize transition-colors ${
                on ? SEV_ON[sev] : "bg-sunken/60 text-ink-3 border-line hover:text-ink-2"
              }`}
            >
              {sev}
            </motion.button>
          );
        })}
      </div>

      {/* Hazard class — forward-compatible: renders whatever is in knownClasses */}
      <div className="flex flex-wrap gap-1.5">
        {[{ id: "all", label: "All hazards" }, ...knownClasses.map((c) => ({ id: c, label: getClassLabel(c) }))].map(
          ({ id, label }) => {
            const on = classFilter === id;
            return (
              <motion.button
                key={id}
                type="button"
                data-testid={`class-filter-${id}`}
                whileTap={{ scale: 0.95 }}
                transition={T.fast}
                aria-pressed={on}
                onClick={() => setClassFilter(id)}
                className={`relative cursor-pointer rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  on
                    ? "border-accent/35 text-accent bg-accent/10"
                    : "bg-sunken/60 text-ink-3 border-line hover:text-ink-2"
                }`}
              >
                {label}
              </motion.button>
            );
          }
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* Status */}
        <select
          data-testid="status-filter-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-sunken border-line text-ink-2 focus:border-accent/50 h-7 flex-1 cursor-pointer rounded-lg border px-2 text-[11px] outline-none transition-colors"
        >
          <option value="all">All statuses</option>
          <option value="detected">Detected</option>
          <option value="verified">Verified</option>
          <option value="assigned">Assigned</option>
          <option value="inspection">Inspection</option>
          <option value="repair">Repair</option>
          <option value="completed">Completed</option>
          <option value="closed">Closed</option>
        </select>

        {/* GPS provenance — B3-6. Fails closed: see gpsUtils.isRealGps. */}
        {setRealGpsOnly && (
          <motion.button
            type="button"
            whileTap={{ scale: 0.95 }}
            transition={T.fast}
            role="switch"
            aria-checked={!!realGpsOnly}
            onClick={() => setRealGpsOnly(!realGpsOnly)}
            title="Show only reports with EXIF or GPX provenance"
            className={`flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-colors ${
              realGpsOnly
                ? "border-accent/35 text-accent bg-accent/10"
                : "bg-sunken/60 text-ink-3 border-line hover:text-ink-2"
            }`}
          >
            <Satellite className="h-3 w-3" />
            Real GPS
          </motion.button>
        )}
      </div>
    </section>
  );
}
