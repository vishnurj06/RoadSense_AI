"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronRight, ChevronLeft, Inbox, Copy, Check } from "lucide-react";
import { SeverityBadge, Chip, EmptyState } from "@/components/ui/Primitives";
import {
  getStatusBadgeStyle,
  getClassLabel,
  getClassBadgeStyle,
  getMaxSeverity,
} from "@/lib/classUtils";
import { getGpsProvenance } from "@/lib/gpsUtils";
import { stagger, rowIn, T } from "@/lib/motion";

const BACKEND_URL = "http://localhost:8000";

/**
 * ReportsView — raw telemetry as a full-page table.
 *
 * This used to be a list of stacked cards inside a 400px column floating over
 * the map, which is the wrong shape for tabular data: every field competed for
 * one narrow line, so vehicle, time, coordinates and severity were all the same
 * size and none of them scanned. Given the whole page, the fields become
 * columns and the eye can run down any one of them.
 *
 * Rows expand in place for detections rather than opening a modal — the
 * detail belongs to the row.
 */
export default function ReportsView({ reports, totalReports, reportPage, onPageChange }) {
  const pages = Math.max(1, Math.ceil(totalReports / 10));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Table header */}
        <div className="border-line text-ink-3 grid shrink-0 grid-cols-[minmax(120px,1.1fr)_90px_minmax(130px,1fr)_minmax(140px,1fr)_54px_100px_110px_44px] items-center gap-3 border-b px-4 py-2.5 text-[9px] font-medium tracking-[0.1em] uppercase">
          <span>Report ID</span>
          <span>Vehicle</span>
          <span>Timestamp</span>
          <span>Location</span>
          <span className="text-right">Dets</span>
          <span>Severity</span>
          <span>Status</span>
          <span className="text-right">GPS</span>
        </div>

        {/* Rows */}
        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
          {reports.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="No reports match the current filters"
              hint="Loosen the severity, hazard or status filters above."
              className="py-16"
            />
          ) : (
            <motion.div variants={stagger(0.02)} initial="hidden" animate="show">
              {reports.map((r) => (
                <Row key={r.id} report={r} />
              ))}
            </motion.div>
          )}
        </div>

        {/* Pager */}
        {totalReports > 10 && (
          <div className="border-line flex shrink-0 items-center justify-between border-t px-4 py-2.5">
            <span className="text-ink-3 text-[10px]">
              Showing <span className="text-ink-2 tnum font-mono">{reports.length}</span> of{" "}
              <span className="text-ink-2 tnum font-mono">{totalReports}</span>
            </span>
            <div className="flex items-center gap-2">
              <Pager
                icon={ChevronLeft}
                label="Prev"
                disabled={reportPage === 1}
                onClick={() => onPageChange(reportPage - 1)}
              />
              <span className="text-ink-3 tnum px-1 text-[10px] font-medium">
                {reportPage} / {pages}
              </span>
              <Pager
                icon={ChevronRight}
                label="Next"
                trailing
                disabled={reportPage >= pages}
                onClick={() => onPageChange(reportPage + 1)}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ report }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const sev = getMaxSeverity(report.detections);
  const prov = getGpsProvenance(report.gps_source);

  const copyId = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(report.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked — the id is visible on the row anyway */
    }
  };

  const img = report.image_url
    ? report.image_url.startsWith("http")
      ? report.image_url
      : `${BACKEND_URL}${report.image_url}`
    : null;

  return (
    <motion.div variants={rowIn} className="border-line/50 border-b last:border-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="hover:bg-raised/40 grid w-full cursor-pointer grid-cols-[minmax(120px,1.1fr)_90px_minmax(130px,1fr)_minmax(140px,1fr)_54px_100px_110px_44px] items-center gap-3 px-4 py-2.5 text-left transition-colors"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <motion.span animate={{ rotate: open ? 90 : 0 }} transition={T.fast}>
            <ChevronRight className="text-ink-3 h-3 w-3 shrink-0" />
          </motion.span>
          <span className="text-ink-2 truncate font-mono text-[11px]">
            {report.id.slice(0, 8)}
          </span>
          <span
            onClick={copyId}
            className="text-ink-3 hover:text-accent shrink-0 transition-colors"
            title="Copy full ID"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </span>
        </span>

        <span className="text-ink truncate font-mono text-[11px]">{report.vehicle_id}</span>

        <span className="text-ink-3 tnum truncate font-mono text-[10px]">
          {new Date(report.timestamp).toLocaleString([], {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>

        <span className="text-ink-3 tnum truncate font-mono text-[10px]">
          {report.latitude?.toFixed(4)}, {report.longitude?.toFixed(4)}
          {report.speed_kmph != null && (
            <span className="text-ink-3/60"> · {report.speed_kmph}km/h</span>
          )}
        </span>

        <span className="text-ink-2 tnum text-right font-mono text-[11px]">
          {report.detections?.length || 0}
        </span>

        <span>
          <SeverityBadge severity={sev} />
        </span>

        <span>
          <Chip className={`${getStatusBadgeStyle(report.status)} capitalize`}>
            {report.status || "detected"}
          </Chip>
        </span>

        {/* GPS provenance fails closed: only exif/gpx read as verified. */}
        <span className="flex justify-end" title={`GPS: ${report.gps_source || "unknown"}`}>
          {prov === "real" ? (
            <span className="text-good text-[10px]">✓</span>
          ) : prov === "faked" ? (
            <span className="text-warning text-[10px]">⚠</span>
          ) : (
            <span className="text-ink-3 text-[10px]">?</span>
          )}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={T.base}
            className="overflow-hidden"
          >
            <div className="bg-sunken/50 flex gap-4 px-4 py-3 pl-11">
              {img && (
                <div className="border-line h-20 w-28 shrink-0 overflow-hidden rounded-lg border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img}
                    alt="Detection"
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      e.target.style.display = "none";
                    }}
                  />
                </div>
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="eyebrow">Detections</span>
                {report.detections?.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {report.detections.map((d, i) => (
                      <span
                        key={d.id ?? i}
                        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] ${getClassBadgeStyle(d.class)}`}
                      >
                        {getClassLabel(d.class)}
                        <span className="text-ink-3 tnum font-mono">
                          {(d.confidence * 100).toFixed(0)}%
                        </span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-ink-3 text-[11px]">No detections on this frame.</span>
                )}
                {report.model_version && (
                  <span className="text-ink-3 mt-1 font-mono text-[10px]">
                    model {report.model_version}
                    {report.road_name && ` · ${report.road_name}`}
                  </span>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function Pager({ icon: Icon, label, onClick, disabled, trailing }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileTap={disabled ? {} : { scale: 0.94 }}
      transition={T.fast}
      className="bg-raised border-line text-ink-2 hover:text-ink hover:border-accent/30 flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35"
    >
      {!trailing && <Icon className="h-3 w-3" />}
      {label}
      {trailing && <Icon className="h-3 w-3" />}
    </motion.button>
  );
}
