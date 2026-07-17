"use client";

import React, { useMemo, useState } from "react";
import { motion } from "motion/react";
import { CheckCircle2, ArrowRight, Truck } from "lucide-react";
import { SeverityBadge, Chip, EmptyState } from "@/components/ui/Primitives";
import { getMaxSeverity, getClassLabel, getStatusBadgeStyle, STATUS_ORDER } from "@/lib/classUtils";
import { stagger, rowIn, T } from "@/lib/motion";

const NEXT_STATUS = { detected: "approved", approved: "assigned", assigned: "repair", repair: "completed" };
const ACTION_LABEL = { detected: "Approve", approved: "Dispatch", assigned: "Start repair", repair: "Complete" };
const STAGES = ["detected", "approved", "assigned", "repair"];

/**
 * QueueView — the PRD's "Pending reports" + "Repair tracking", for Authority.
 *
 * This was buried as a card inside the map panel, which made the authority's
 * core job — triaging and dispatching — a thing you had to scroll past the
 * filters to reach. It is a destination now, and it is ordered by PRIORITY
 * (urgency = severity + corroboration + age, computed backend-side, code item
 * #3) first: the queue answers "what needs someone next", which is an urgency
 * question, not a severity or chronological one. Severity is only the tiebreak.
 */
export default function QueueView({ issues, onQuickAction }) {
  const [stage, setStage] = useState("all");

  const pending = useMemo(() => {
    const rank = { high: 0, medium: 1, low: 2 };
    return (issues || [])
      .filter((i) => STAGES.includes((i.status || "detected").toLowerCase()))
      .filter((i) => stage === "all" || (i.status || "detected").toLowerCase() === stage)
      .sort((a, b) => {
        // Primary: backend priority (urgency), highest first. A missing score
        // sinks to the bottom rather than jumping the queue (fail-safe).
        const pa = a.priority ?? -1;
        const pb = b.priority ?? -1;
        if (pb !== pa) return pb - pa;
        // Tiebreak: severity, high first.
        return rank[getMaxSeverity(a.detections)] - rank[getMaxSeverity(b.detections)];
      });
  }, [issues, stage]);

  const countFor = (s) =>
    (issues || []).filter((i) => (i.status || "detected").toLowerCase() === s).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Stage filter — doubles as a live count of each lifecycle step */}
      <div className="border-line flex shrink-0 flex-wrap gap-1.5 border-b p-3">
        {[{ id: "all", label: "All" }, ...STAGES.map((s) => ({ id: s, label: s }))].map(({ id, label }) => {
          const on = stage === id;
          const n = id === "all" ? pending.length : countFor(id);
          return (
            <button
              key={id}
              type="button"
              onClick={() => setStage(id)}
              aria-pressed={on}
              className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium capitalize transition-colors ${
                on
                  ? "border-accent/35 text-accent bg-accent/10"
                  : "bg-sunken/60 text-ink-3 border-line hover:text-ink-2"
              }`}
            >
              {label}
              <span className="tnum font-mono text-[9.5px] opacity-70">{n}</span>
            </button>
          );
        })}
      </div>

      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-2.5">
        {pending.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="Queue is clear"
            hint="No issues are awaiting action at this stage."
            className="py-16"
          />
        ) : (
          <motion.ul variants={stagger(0.02)} initial="hidden" animate="show" className="flex flex-col gap-1.5">
            {pending.map((issue) => {
              const status = (issue.status || "detected").toLowerCase();
              const next = NEXT_STATUS[status];
              const idx = STATUS_ORDER.indexOf(status);
              return (
                <motion.li
                  key={issue.id}
                  variants={rowIn}
                  layout
                  className="bg-raised/50 border-line hover:border-accent/30 flex flex-col gap-2 rounded-xl border p-3 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="text-ink truncate text-[12px] font-medium">
                        {issue.class_name ? getClassLabel(issue.class_name) : "Mixed hazard"}
                      </span>
                      <SeverityBadge severity={getMaxSeverity(issue.detections)} />
                      <Chip className={`${getStatusBadgeStyle(issue.status)} capitalize`}>{status}</Chip>
                      {issue.priority != null && (
                        <span
                          className="text-ink-3 tnum shrink-0 font-mono text-[9.5px]"
                          title="Priority (urgency) — this is the sort order"
                        >
                          ⚡{issue.priority}
                        </span>
                      )}
                    </div>
                    {next && (
                      <motion.button
                        type="button"
                        whileTap={{ scale: 0.95 }}
                        transition={T.fast}
                        onClick={() => onQuickAction(issue.id, next)}
                        className="bg-accent/10 border-accent/25 text-accent hover:bg-accent/20 flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors"
                      >
                        <Truck className="h-3 w-3" />
                        {ACTION_LABEL[status]}
                        <ArrowRight className="h-2.5 w-2.5" />
                      </motion.button>
                    )}
                  </div>

                  {/* Lifecycle position, shown structurally: the workflow is
                      ordinal state, not good/bad, so it has no claim on the
                      reserved status palette. */}
                  <div className="flex items-center gap-[3px]">
                    {STATUS_ORDER.map((s, i) => (
                      <span
                        key={s}
                        title={s}
                        className={`h-[3px] flex-1 rounded-full ${i <= idx ? "bg-accent" : "bg-line"}`}
                      />
                    ))}
                  </div>

                  <span className="text-ink-3 truncate font-mono text-[9.5px]">
                    {issue.id.slice(0, 8)} · {issue.detection_count} reports ·{" "}
                    {issue.latitude?.toFixed(4)}, {issue.longitude?.toFixed(4)}
                    {issue.road_name && ` · ${issue.road_name}`}
                  </span>
                </motion.li>
              );
            })}
          </motion.ul>
        )}
      </div>
    </div>
  );
}
