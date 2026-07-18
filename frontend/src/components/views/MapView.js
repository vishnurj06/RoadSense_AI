"use client";

import React, { useState, useMemo } from "react";
import { motion } from "motion/react";
import { Search, ListChecks, CheckCircle2, ArrowRight } from "lucide-react";
import Filters from "@/components/shared/Filters";
import { SeverityBadge, Chip, EmptyState } from "@/components/ui/Primitives";
import { getMaxSeverity, getClassLabel, getStatusBadgeStyle } from "@/lib/classUtils";
import { stagger, rowIn, T } from "@/lib/motion";

// Must mirror the backend VALID_TRANSITIONS — approved dispatches to "assigned"
// (approved→repair is rejected 400). Assignee is captured in the map popup or
// the Action Queue, so a one-click dispatch here queues the crew as TBD.
const NEXT_STATUS = { detected: "approved", approved: "assigned", assigned: "repair", repair: "completed" };
const ACTION_LABEL = { detected: "Approve", approved: "Dispatch", assigned: "Start repair", repair: "Complete" };

/**
 * MapView — the issue index for the canvas behind it.
 *
 * Renders panel CONTENT only: page.js owns both the docked panel shell and the
 * persistent map, so every view shares one shape and the map never unmounts.
 */
export default function MapView({ filteredIssues, onQuickAction, filterProps }) {
  const [query, setQuery] = useState("");

  // Cap the RENDERED rows. Rendering ~9.5k <li> is as fatal to the main thread
  // as ~9.5k map pins — it was part of why the panel showed nothing. The full
  // set still drives the count chip and the search; only the DOM list is
  // capped, and the overflow is surfaced at the foot of the list.
  const LIST_CAP = 200;
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return filteredIssues;
    return filteredIssues.filter(
      (i) =>
        i.id.toLowerCase().includes(q) ||
        (i.class_name || "").toLowerCase().includes(q) ||
        (i.status || "").toLowerCase().includes(q)
    );
  }, [filteredIssues, query]);
  const list = matches.slice(0, LIST_CAP);
  const overflow = matches.length - list.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 p-3 pb-0">
        <Filters {...filterProps} />
      </div>

      <div className="border-line mt-3 flex shrink-0 items-center gap-2 border-y px-3 py-2.5">
        <ListChecks className="text-ink-3 h-3.5 w-3.5" />
        <span className="eyebrow">Live issues</span>
        <Chip className="bg-raised text-ink-3" mono>
          {matches.length}
        </Chip>
      </div>

      <div className="border-line shrink-0 border-b px-3 py-2">
        <div className="relative flex items-center">
          <Search className="text-ink-3 pointer-events-none absolute left-2.5 h-3 w-3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search class, status or ID…"
            className="bg-sunken border-line text-ink placeholder:text-ink-3 focus:border-accent/50 h-7 w-full rounded-lg border pr-2 pl-7 text-[11px] outline-none transition-colors"
          />
        </div>
      </div>

      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-2">
        {list.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title={query ? "No issues match that search" : "No issues on the map"}
            hint={query ? undefined : "Loosen the filters, or upload a road image."}
          />
        ) : (
          <motion.ul variants={stagger(0.015)} initial="hidden" animate="show" className="flex flex-col gap-1.5">
            {list.map((issue) => {
              const status = (issue.status || "detected").toLowerCase();
              const next = NEXT_STATUS[status];
              return (
                <motion.li
                  key={issue.id}
                  variants={rowIn}
                  className="bg-raised/50 border-line hover:border-accent/30 rounded-xl border p-2.5 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="text-ink truncate text-[11px] font-medium">
                        {issue.class_name ? getClassLabel(issue.class_name) : "Mixed"}
                      </span>
                      <SeverityBadge severity={getMaxSeverity(issue.detections)} />
                    </div>
                    <Chip className={`${getStatusBadgeStyle(issue.status)} capitalize`}>{status}</Chip>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <span className="text-ink-3 truncate font-mono text-[9.5px]">
                      {issue.id.slice(0, 8)} · {issue.detection_count} rpts
                    </span>
                    {next && onQuickAction && (
                      <motion.button
                        type="button"
                        whileTap={{ scale: 0.94 }}
                        transition={T.fast}
                        onClick={() => onQuickAction(issue.id, next)}
                        className="bg-accent/10 border-accent/25 text-accent hover:bg-accent/20 flex shrink-0 cursor-pointer items-center gap-1 rounded-md border px-2 py-0.5 text-[9.5px] font-semibold transition-colors"
                      >
                        {ACTION_LABEL[status]}
                        <ArrowRight className="h-2.5 w-2.5" />
                      </motion.button>
                    )}
                  </div>
                </motion.li>
              );
            })}
          </motion.ul>
        )}
        {overflow > 0 && (
          <p className="text-ink-3 px-2 pt-2 pb-1 text-center font-mono text-[9.5px]">
            + {overflow.toLocaleString()} more — refine the search or filters
          </p>
        )}
      </div>
    </div>
  );
}
