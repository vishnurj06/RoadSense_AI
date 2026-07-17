"use client";

import React from "react";
import { Activity, MapPin, AlertTriangle, Car } from "lucide-react";

/**
 * StatCards — the 3-up summary row (Reports / Detections / High Risk).
 * Shared across all dashboard roles.
 *
 * Props:
 *   analytics: {
 *     total_reports: number,
 *     total_detections: number,
 *     severity_distribution: { high: number, medium: number, low: number }
 *   }
 */
export default function StatCards({ analytics }) {
  const totalReports = analytics?.total_reports ?? 0;
  const totalDetections = analytics?.total_detections ?? 0;
  const highRisk = analytics?.severity_distribution?.high ?? 0;

  return (
    <section
      className="grid grid-cols-3 gap-3 shrink-0"
      data-testid="stat-cards"
    >
      <div className="bg-slate-900/50 border border-slate-800/80 p-3 rounded-2xl flex flex-col justify-between">
        <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500">
          Reports
        </span>
        <div className="flex items-baseline gap-1 mt-1">
          <span className="text-2xl font-black text-white" data-testid="stat-reports">
            {totalReports}
          </span>
          <MapPin className="h-3.5 w-3.5 text-blue-400" />
        </div>
      </div>

      <div className="bg-slate-900/50 border border-slate-800/80 p-3 rounded-2xl flex flex-col justify-between">
        <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500">
          Detections
        </span>
        <div className="flex items-baseline gap-1 mt-1">
          <span className="text-2xl font-black text-white" data-testid="stat-detections">
            {totalDetections}
          </span>
          <Car className="h-3.5 w-3.5 text-indigo-400" />
        </div>
      </div>

      <div className="bg-slate-900/50 border border-slate-800/80 p-3 rounded-2xl flex flex-col justify-between">
        <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500">
          High Risk
        </span>
        <div className="flex items-baseline gap-1 mt-1">
          <span className="text-2xl font-black text-red-500" data-testid="stat-high-risk">
            {highRisk}
          </span>
          <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
        </div>
      </div>
    </section>
  );
}
