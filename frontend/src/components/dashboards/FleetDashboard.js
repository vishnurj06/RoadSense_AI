"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Car, Camera, Wifi, WifiOff, Clock, ChevronRight, X } from "lucide-react";
import Filters from "@/components/shared/Filters";
import UploadPanel from "@/components/shared/UploadPanel";
import ReportLogs from "@/components/shared/ReportLogs";
import { getMaxSeverity, getSeverityBadgeStyle } from "@/lib/classUtils";

const BACKEND_URL = "http://localhost:8000";

// ── Camera health badge ───────────────────────────────────────────────────────

const HEALTH_STYLES = {
  online:  { dot: "bg-green-500",  label: "text-green-400",  text: "Online" },
  stale:   { dot: "bg-amber-400 animate-pulse", label: "text-amber-400", text: "Stale" },
  offline: { dot: "bg-red-500",    label: "text-red-400",    text: "Offline" },
  unknown: { dot: "bg-slate-600",  label: "text-slate-500",  text: "No data" },
};

function CameraHealthBadge({ health }) {
  const s = HEALTH_STYLES[health] || HEALTH_STYLES.unknown;
  return (
    <span className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full shrink-0 ${s.dot}`} />
      <span className={`text-[10px] font-bold uppercase tracking-wide ${s.label}`}>
        {s.text}
      </span>
    </span>
  );
}

// ── Vehicle history drawer ────────────────────────────────────────────────────

function VehicleHistoryDrawer({ vehicle, onClose }) {
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);

  // Deliberately performs no *synchronous* setState: every state write happens
  // after an await. That lets the mount effect below call it directly without
  // triggering cascading renders (react-hooks/set-state-in-effect). `loading`
  // already starts true for the initial load; the pagination handlers raise it
  // themselves, which is fine — the restriction only applies inside effects.
  const fetchHistory = useCallback(async (p = 1) => {
    try {
      const res = await fetch(
        `${BACKEND_URL}/fleet/vehicles/${vehicle.id}/history?page=${p}&limit=10`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setHistory(data);
      setPage(p);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [vehicle.id]);

  useEffect(() => {
    (async () => { await fetchHistory(1); })();
  }, [fetchHistory]);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      data-testid="vehicle-history-drawer"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div className="relative z-10 w-[28rem] h-full bg-slate-900 border-l border-slate-800 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 shrink-0">
          <div className="flex flex-col">
            <span className="text-sm font-bold text-slate-100">
              {vehicle.plate}
            </span>
            <span className="text-[10px] text-slate-500">{vehicle.model || "Unknown model"}</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="h-4 w-4 text-slate-400" />
          </button>
        </div>

        {/* Stats row */}
        <div className="flex gap-3 px-5 py-3 border-b border-slate-800/60 shrink-0">
          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] uppercase text-slate-500 font-bold">Camera</span>
            <CameraHealthBadge health={vehicle.camera_health} />
          </div>
          <div className="w-px bg-slate-800" />
          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] uppercase text-slate-500 font-bold">Reports</span>
            <span className="text-sm font-bold text-slate-200">{vehicle.report_count}</span>
          </div>
          {vehicle.last_seen && (
            <>
              <div className="w-px bg-slate-800" />
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] uppercase text-slate-500 font-bold">Last Seen</span>
                <span className="text-[10px] text-slate-400">
                  {new Date(vehicle.last_seen).toLocaleString([], {
                    month: "short", day: "numeric",
                    hour: "2-digit", minute: "2-digit",
                  })}
                </span>
              </div>
            </>
          )}
        </div>

        {/* History list */}
        <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-3">
          {loading && (
            <div className="flex items-center justify-center py-10 text-slate-500 text-xs gap-2">
              <Clock className="animate-spin h-4 w-4" /> Loading history...
            </div>
          )}
          {error && (
            <p className="text-xs text-red-400 text-center py-6">Error: {error}</p>
          )}
          {!loading && !error && history?.reports?.length === 0 && (
            <p className="text-xs text-slate-600 text-center py-8 italic">
              No reports submitted by this vehicle yet.
            </p>
          )}
          {!loading && !error && history?.reports?.map((report) => {
            const maxSev = getMaxSeverity(report.detections);
            return (
              <div
                key={report.id}
                className="border-b border-slate-800/60 py-3 flex flex-col gap-1"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">
                    {new Date(report.timestamp).toLocaleString([], {
                      month: "short", day: "numeric",
                      hour: "2-digit", minute: "2-digit",
                    })}
                  </span>
                  <span
                    className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full border ${getSeverityBadgeStyle(maxSev)}`}
                  >
                    {maxSev}
                  </span>
                </div>
                <div className="text-xs text-slate-400">
                  {report.detections?.length || 0} detection(s)
                  {report.speed_kmph != null && ` · ${report.speed_kmph} km/h`}
                </div>
              </div>
            );
          })}
        </div>

        {/* Pagination footer */}
        {history?.total > 10 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-slate-800 shrink-0">
            <button
              disabled={page === 1}
              onClick={() => { setLoading(true); fetchHistory(page - 1); }}
              className="text-[10px] font-bold px-3 py-1 bg-slate-800 rounded disabled:opacity-40 cursor-pointer"
            >
              Prev
            </button>
            <span className="text-[10px] text-slate-500">
              Page {page} of {Math.ceil(history.total / 10)}
            </span>
            <button
              disabled={page >= Math.ceil(history.total / 10)}
              onClick={() => { setLoading(true); fetchHistory(page + 1); }}
              className="text-[10px] font-bold px-3 py-1 bg-slate-800 rounded disabled:opacity-40 cursor-pointer"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Vehicle registry list ─────────────────────────────────────────────────────

function VehicleRegistry({ vehicles, loading, error, onSelect }) {
  const totalOnline  = vehicles.filter((v) => v.camera_health === "online").length;
  const totalStale   = vehicles.filter((v) => v.camera_health === "stale").length;
  const totalOffline = vehicles.filter((v) => v.camera_health === "offline").length;

  return (
    <section
      className="bg-slate-900/40 border border-slate-800/60 p-4 rounded-2xl flex flex-col overflow-hidden min-h-[18rem] max-h-[26rem]"
      data-testid="vehicle-registry"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-400">
          <Car className="h-4 w-4 text-indigo-400" />
          <span>FLEET REGISTRY ({vehicles.length})</span>
        </div>
        {/* Health summary pills */}
        <div className="flex gap-2 text-[9px] font-bold">
          <span className="flex items-center gap-1 text-green-400">
            <Wifi className="h-3 w-3" />{totalOnline}
          </span>
          <span className="flex items-center gap-1 text-amber-400">
            <Clock className="h-3 w-3" />{totalStale}
          </span>
          <span className="flex items-center gap-1 text-red-400">
            <WifiOff className="h-3 w-3" />{totalOffline}
          </span>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1">
        {loading && (
          <div className="h-full flex items-center justify-center text-slate-600 text-xs py-8">
            Loading vehicles...
          </div>
        )}
        {error && (
          <p className="text-xs text-red-400 text-center py-6">Fleet API error: {error}</p>
        )}
        {!loading && !error && vehicles.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-slate-600 text-xs py-8">
            <Camera className="h-8 w-8 mb-2 opacity-20" />
            No vehicles registered yet. Use the admin panel or POST /fleet/vehicles.
          </div>
        )}
        {!loading && !error && vehicles.map((veh) => (
          <div
            key={veh.id}
            onClick={() => onSelect(veh)}
            className="bg-slate-950/40 border border-slate-800/80 hover:border-slate-700 rounded-xl p-3 flex items-center justify-between cursor-pointer transition duration-150 group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-bold text-slate-200 truncate">
                  {veh.plate}
                </span>
                <span className="text-[9px] text-slate-500 mt-0.5 truncate">
                  {veh.model || "No model"} · Camera: {veh.camera_id || "—"}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <CameraHealthBadge health={veh.camera_health} />
              <span className="text-[10px] text-slate-500 font-semibold">
                {veh.report_count} rpt
              </span>
              <ChevronRight className="h-3.5 w-3.5 text-slate-600 group-hover:text-slate-400 transition" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── FleetDashboard (top-level export) ─────────────────────────────────────────

/**
 * FleetDashboard — real fleet data from GET /fleet/vehicles + history drawer.
 *
 * Props:
 *   reports, filteredReports, totalReports, reportPage, onPageChange,
 *   onUpload, uploading,
 *   severityFilter, setSeverityFilter,
 *   classFilter, setClassFilter,
 *   statusFilter, setStatusFilter
 */
export default function FleetDashboard({
  filteredReports,
  totalReports,
  reportPage,
  onPageChange,
  onUpload,
  uploading,
  severityFilter,
  setSeverityFilter,
  classFilter,
  setClassFilter,
  statusFilter,
  setStatusFilter,
  realGpsOnly,
  setRealGpsOnly,
}) {
  const [vehicles, setVehicles] = useState([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(true);
  const [vehiclesError, setVehiclesError] = useState(null);
  const [selectedVehicle, setSelectedVehicle] = useState(null);

  // No synchronous setState — every write happens after an await, so the mount
  // effect can call this directly (react-hooks/set-state-in-effect).
  // `vehiclesLoading` starts true for the first load and is never re-raised:
  // the 60 s refresh below must update the list *in place*. Toggling it back to
  // true on each poll blanked the whole registry to "Loading vehicles..." every
  // minute, which is why the spinner is now strictly an initial-load state.
  const fetchVehicles = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/fleet/vehicles?limit=100`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setVehicles(data.vehicles || []);
      setVehiclesError(null);
    } catch (err) {
      setVehiclesError(err.message);
    } finally {
      setVehiclesLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => { await fetchVehicles(); })();
    // Refresh vehicle health every 60 seconds (camera health changes in real time)
    const interval = setInterval(fetchVehicles, 60_000);
    return () => clearInterval(interval);
  }, [fetchVehicles]);

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
      <UploadPanel onUpload={onUpload} uploading={uploading} />
      <VehicleRegistry
        vehicles={vehicles}
        loading={vehiclesLoading}
        error={vehiclesError}
        onSelect={setSelectedVehicle}
      />
      <ReportLogs
        reports={filteredReports}
        totalReports={totalReports}
        reportPage={reportPage}
        onPageChange={onPageChange}
      />

      {/* History drawer — rendered at portal level, full-screen overlay */}
      {selectedVehicle && (
        <VehicleHistoryDrawer
          vehicle={selectedVehicle}
          onClose={() => setSelectedVehicle(null)}
        />
      )}
    </>
  );
}
