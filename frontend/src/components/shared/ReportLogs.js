"use client";

import React from "react";
import { FileSpreadsheet, CheckCircle, Calendar } from "lucide-react";
import { getMaxSeverity, getSeverityBadgeStyle, getStatusBadgeStyle } from "@/lib/classUtils";

/**
 * ReportLogs — paginated list of raw detection reports.
 * Shared between Fleet and Authority dashboards.
 *
 * Props:
 *   reports:       Report[]
 *   totalReports:  number
 *   reportPage:    number
 *   onPageChange:  (page: number) => void
 */
export default function ReportLogs({
  reports,
  totalReports,
  reportPage,
  onPageChange,
}) {
  return (
    <section
      className="flex-1 bg-slate-900/40 border border-slate-800/60 p-4 rounded-2xl flex flex-col overflow-hidden min-h-[12rem]"
      data-testid="report-logs"
    >
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-400">
          <FileSpreadsheet className="h-4 w-4" />
          <span>REPORT LOGS ({totalReports} total)</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1">
        {reports.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-600 text-xs py-8">
            <CheckCircle className="h-8 w-8 mb-2 opacity-30 text-green-500" />
            No reports matching current filters.
          </div>
        ) : (
          reports.map((report) => {
            const maxSeverity = getMaxSeverity(report.detections);

            return (
              <div
                key={report.id}
                className="bg-slate-950/40 hover:bg-slate-900/30 border border-slate-800/80 hover:border-slate-700/60 rounded-xl p-3 flex items-center justify-between transition duration-150 gap-3"
              >
                <div className="flex flex-col gap-0.5 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-100 truncate">
                      Vehicle: {report.vehicle_id}
                    </span>
                    <span
                      className={`text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded-full shrink-0 border ${getSeverityBadgeStyle(
                        maxSeverity
                      )}`}
                    >
                      {maxSeverity}
                    </span>
                    <span
                      className={`text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded-full shrink-0 border ${getStatusBadgeStyle(
                        report.status
                      )}`}
                    >
                      {report.status || "detected"}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-500 flex items-center gap-1.5 mt-0.5">
                    <Calendar className="h-3 w-3 shrink-0" />
                    <span>
                      {new Date(report.timestamp).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1 shrink-0">
                  <div className="text-[10px] text-slate-400 font-bold bg-slate-900 border border-slate-800 px-2 py-0.5 rounded">
                    {report.detections?.length || 0} Detections
                  </div>
                  <span className="text-[9px] text-slate-600 italic truncate">
                    Lat: {report.latitude?.toFixed(4)}, Lon:{" "}
                    {report.longitude?.toFixed(4)}
                    {report.speed_kmph != null &&
                      ` | ${report.speed_kmph} km/h`}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Pagination footer */}
      {totalReports > 10 && (
        <div className="flex items-center justify-between border-t border-slate-800/80 pt-3 mt-3 shrink-0">
          <button
            onClick={() => onPageChange(reportPage - 1)}
            disabled={reportPage === 1}
            className="px-2.5 py-1 text-[10px] font-bold bg-slate-800 hover:bg-slate-700 active:bg-slate-900 border border-slate-700/60 rounded disabled:opacity-40 cursor-pointer"
          >
            Prev
          </button>
          <span className="text-[10px] text-slate-400 font-semibold">
            Page {reportPage} of {Math.ceil(totalReports / 10)}
          </span>
          <button
            onClick={() => onPageChange(reportPage + 1)}
            disabled={reportPage >= Math.ceil(totalReports / 10)}
            className="px-2.5 py-1 text-[10px] font-bold bg-slate-800 hover:bg-slate-700 active:bg-slate-900 border border-slate-700/60 rounded disabled:opacity-40 cursor-pointer"
          >
            Next
          </button>
        </div>
      )}
    </section>
  );
}
