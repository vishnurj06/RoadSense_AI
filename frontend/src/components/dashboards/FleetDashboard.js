"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Car, Camera, Wifi, WifiOff, Clock, ChevronRight, X } from "lucide-react";
import Panel from "@/components/ui/Panel";
import { SeverityBadge, EmptyState, Skeleton, Chip } from "@/components/ui/Primitives";
import { stagger, rowIn, drawer, fade, T } from "@/lib/motion";

const BACKEND_URL = "http://localhost:8000";

/* ── Camera health ───────────────────────────────────────────────────────────
   Camera health is a STATE, so it wears the reserved status tokens and always
   ships a text label beside the dot — never colour alone. `stale` breathes
   because it is the one value that is actively decaying.                     */

const HEALTH_STYLES = {
  online: { dot: "bg-good", label: "text-good", text: "Online" },
  stale: { dot: "bg-warning animate-breathe", label: "text-warning", text: "Stale" },
  offline: { dot: "bg-critical", label: "text-critical", text: "Offline" },
  unknown: { dot: "bg-ink-3", label: "text-ink-3", text: "No data" },
};

function CameraHealthBadge({ health }) {
  const s = HEALTH_STYLES[health] || HEALTH_STYLES.unknown;
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.dot}`} aria-hidden="true" />
      <span className={`text-[10px] font-medium ${s.label}`}>{s.text}</span>
    </span>
  );
}

/* ── Vehicle history drawer ─────────────────────────────────────────────── */

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
  const fetchHistory = useCallback(
    async (p = 1) => {
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
    },
    [vehicle.id]
  );

  useEffect(() => {
    (async () => {
      await fetchHistory(1);
    })();
  }, [fetchHistory]);

  // Escape closes — a drawer you can only leave by mousing to an X is a trap.
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pages = Math.ceil((history?.total || 0) / 10);

  return (
    <motion.div
      className="fixed inset-0 z-[60] flex justify-end"
      data-testid="vehicle-history-drawer"
      initial="hidden"
      animate="show"
      exit="exit"
    >
      <motion.div
        variants={fade}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      <motion.aside
        variants={drawer}
        className="border-line bg-surface/95 relative z-10 flex h-full w-[26rem] max-w-[92vw] flex-col border-l shadow-2xl backdrop-blur-2xl"
      >
        <header className="border-line flex shrink-0 items-center justify-between border-b px-4 py-3.5">
          <div className="flex min-w-0 flex-col">
            <span className="text-ink truncate font-mono text-[13px] font-semibold">
              {vehicle.plate}
            </span>
            <span className="text-ink-3 truncate text-[10px]">
              {vehicle.model || "Unknown model"}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-ink-3 hover:text-ink hover:bg-raised cursor-pointer rounded-lg p-1.5 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="border-line grid shrink-0 grid-cols-3 gap-3 border-b px-4 py-3">
          <div className="flex flex-col gap-1">
            <span className="eyebrow">Camera</span>
            <CameraHealthBadge health={vehicle.camera_health} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="eyebrow">Reports</span>
            <span className="text-ink tnum font-mono text-[12px] font-medium">
              {vehicle.report_count}
            </span>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="eyebrow">Last seen</span>
            <span className="text-ink-2 tnum truncate font-mono text-[10px]">
              {vehicle.last_seen
                ? new Date(vehicle.last_seen).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "—"}
            </span>
          </div>
        </div>

        <div className="custom-scrollbar flex-1 overflow-y-auto px-4 py-2">
          {loading && (
            <div className="flex flex-col gap-2 py-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          )}
          {error && (
            <p className="text-critical py-6 text-center text-[11px]">Error: {error}</p>
          )}
          {!loading && !error && history?.reports?.length === 0 && (
            <EmptyState icon={Camera} title="No reports from this vehicle yet" />
          )}
          {!loading && !error && history?.reports?.length > 0 && (
            <motion.ul variants={stagger(0.03)} initial="hidden" animate="show">
              {history.reports.map((report) => (
                <motion.li
                  key={report.id}
                  variants={rowIn}
                  className="border-line/60 flex items-center justify-between gap-2 border-b py-2.5 last:border-0"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-ink-2 tnum font-mono text-[10px]">
                      {new Date(report.timestamp).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span className="text-ink-3 text-[10px]">
                      {report.detections?.length || 0} detection
                      {report.detections?.length === 1 ? "" : "s"}
                      {report.speed_kmph != null && ` · ${report.speed_kmph} km/h`}
                    </span>
                  </div>
                  <SeverityBadge detections={report.detections} />
                </motion.li>
              ))}
            </motion.ul>
          )}
        </div>

        {pages > 1 && (
          <div className="border-line flex shrink-0 items-center justify-between border-t px-4 py-3">
            <button
              type="button"
              disabled={page === 1}
              onClick={() => {
                setLoading(true);
                fetchHistory(page - 1);
              }}
              className="bg-raised border-line text-ink-2 hover:text-ink cursor-pointer rounded-md border px-2 py-1 text-[10px] font-medium disabled:opacity-35"
            >
              Prev
            </button>
            <span className="text-ink-3 tnum text-[10px]">
              {page} / {pages}
            </span>
            <button
              type="button"
              disabled={page >= pages}
              onClick={() => {
                setLoading(true);
                fetchHistory(page + 1);
              }}
              className="bg-raised border-line text-ink-2 hover:text-ink cursor-pointer rounded-md border px-2 py-1 text-[10px] font-medium disabled:opacity-35"
            >
              Next
            </button>
          </div>
        )}
      </motion.aside>
    </motion.div>
  );
}

/* ── Vehicle registry ───────────────────────────────────────────────────── */

function VehicleRegistry({ vehicles, loading, error, onSelect, maxHeight = "18rem" }) {
  const count = (h) => vehicles.filter((v) => v.camera_health === h).length;

  return (
    <Panel
      title="Fleet registry"
      icon={Car}
      count={vehicles.length}
      testId="vehicle-registry"
      className="flex min-h-0 flex-col"
      bodyClassName="min-h-0"
      actions={
        <div className="flex items-center gap-2">
          <Chip className="bg-good/10 text-good border-good/25" mono>
            <Wifi className="h-2.5 w-2.5" />
            {count("online")}
          </Chip>
          <Chip className="bg-warning/10 text-warning border-warning/25" mono>
            <Clock className="h-2.5 w-2.5" />
            {count("stale")}
          </Chip>
          <Chip className="bg-critical/10 text-critical border-critical/25" mono>
            <WifiOff className="h-2.5 w-2.5" />
            {count("offline")}
          </Chip>
        </div>
      }
    >
      <div
        className="custom-scrollbar -mx-1 min-h-0 overflow-y-auto px-1"
        style={maxHeight === "none" ? undefined : { maxHeight }}
      >
        {loading && (
          <div className="flex flex-col gap-1.5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        )}
        {error && <p className="text-critical py-6 text-center text-[11px]">Fleet API error: {error}</p>}
        {!loading && !error && vehicles.length === 0 && (
          <EmptyState
            icon={Camera}
            title="No vehicles registered"
            hint="Register one from the admin panel, or POST /fleet/vehicles."
          />
        )}
        {!loading && !error && vehicles.length > 0 && (
          <motion.ul variants={stagger(0.03)} initial="hidden" animate="show" className="flex flex-col gap-1.5">
            {vehicles.map((veh) => (
              <motion.li key={veh.id} variants={rowIn}>
                <motion.button
                  type="button"
                  onClick={() => onSelect(veh)}
                  whileHover={{ x: 2 }}
                  whileTap={{ scale: 0.99 }}
                  transition={T.fast}
                  className="bg-raised/50 border-line hover:border-accent/30 group flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl border p-2.5 text-left transition-colors"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-ink truncate font-mono text-[11px] font-medium">
                      {veh.plate}
                    </span>
                    <span className="text-ink-3 truncate text-[9px]">
                      {veh.model || "No model"} · cam {veh.camera_id || "—"}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2.5">
                    <CameraHealthBadge health={veh.camera_health} />
                    <span className="text-ink-3 tnum font-mono text-[10px]">{veh.report_count}</span>
                    <ChevronRight className="text-ink-3 group-hover:text-accent h-3 w-3 transition-colors" />
                  </div>
                </motion.button>
              </motion.li>
            ))}
          </motion.ul>
        )}
      </div>
    </Panel>
  );
}

export { VehicleRegistry, CameraHealthBadge, VehicleHistoryDrawer };
