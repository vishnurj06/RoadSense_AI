"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Users,
  Server,
  Compass,
  Cpu,
  Activity,
  HardDrive,
  CheckCircle,
  RefreshCw,
  PackageCheck,
  AlertCircle,
} from "lucide-react";
import UploadPanel from "@/components/shared/UploadPanel";

const BACKEND_URL = "http://localhost:8000";

// ─── UserDirectory ────────────────────────────────────────────────────────────

/**
 * UserDirectory — list of registered users with role selector.
 */
function UserDirectory({ adminUsers, onRoleChange }) {
  return (
    <section
      className="bg-slate-900/40 border border-slate-800/60 p-4 rounded-2xl flex flex-col overflow-hidden min-h-[14rem] max-h-[18rem]"
      data-testid="user-directory"
    >
      <div className="flex items-center gap-2 text-xs font-bold text-slate-400 mb-3 shrink-0">
        <Users className="h-4 w-4 text-blue-400" />
        <span>USER REGISTRY ({adminUsers.length})</span>
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1">
        {adminUsers.length === 0 ? (
          <p className="text-xs text-slate-600 text-center py-4">
            No users registered.
          </p>
        ) : (
          adminUsers.map((u) => (
            <div
              key={u.id}
              className="bg-slate-950/40 border border-slate-800/80 rounded-xl p-3 flex items-center justify-between"
            >
              <div className="flex flex-col">
                <span className="text-xs font-bold text-slate-200">{u.username}</span>
                <span className="text-[9px] text-slate-500 mt-0.5">
                  Created: {new Date(u.created_at).toLocaleDateString()}
                </span>
              </div>
              <select
                value={u.role}
                onChange={(e) => onRoleChange(u.id, e.target.value)}
                className="bg-slate-900 border border-slate-800 rounded-lg text-[10px] font-semibold px-2 py-1 text-slate-300 focus:outline-none cursor-pointer"
              >
                <option value="admin">Admin</option>
                <option value="authority">Authority</option>
                <option value="fleet">Fleet</option>
              </select>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

// ─── SystemHealthPanel ────────────────────────────────────────────────────────

/**
 * SystemHealthPanel — real psutil metrics from GET /admin/system-health.
 * Updated in B3-0 to display real CPU / memory / disk / inference status.
 */
function SystemHealthPanel({ systemHealth }) {
  if (!systemHealth) return null;

  const inferenceOk = systemHealth.inference_status === "ok";

  return (
    <section
      className="bg-slate-900/40 border border-slate-800/60 p-4 rounded-2xl flex flex-col gap-3.5 shrink-0"
      data-testid="system-health"
    >
      <div className="flex items-center gap-2 text-xs font-bold text-slate-400 shrink-0">
        <Server className="h-4 w-4 text-emerald-400" />
        <span>SYSTEM INFRASTRUCTURE HEALTH</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* CPU */}
        <div className="bg-slate-950/40 border border-slate-800/80 rounded-xl p-3 flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-[9px] uppercase font-bold text-slate-500">
            <span>CPU LOAD</span>
            <Cpu className="h-3 w-3 text-blue-400" />
          </div>
          <span className="text-sm font-extrabold text-slate-200">
            {systemHealth.cpu_usage_pct}%
          </span>
          <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full"
              style={{ width: `${Math.min(systemHealth.cpu_usage_pct, 100)}%` }}
            />
          </div>
        </div>

        {/* Memory */}
        <div className="bg-slate-950/40 border border-slate-800/80 rounded-xl p-3 flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-[9px] uppercase font-bold text-slate-500">
            <span>MEMORY</span>
            <Activity className="h-3 w-3 text-purple-400" />
          </div>
          <span className="text-sm font-extrabold text-slate-200">
            {systemHealth.memory_usage_pct}%
          </span>
          <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
            <div
              className="h-full bg-purple-500 rounded-full"
              style={{ width: `${Math.min(systemHealth.memory_usage_pct, 100)}%` }}
            />
          </div>
        </div>

        {/* DB connections */}
        <div className="bg-slate-950/40 border border-slate-800/80 rounded-xl p-3 flex flex-col gap-1">
          <span className="text-[9px] uppercase font-bold text-slate-500">DB CONNS</span>
          <div className="flex items-baseline gap-1 mt-0.5">
            <span className="text-sm font-extrabold text-slate-200">
              {systemHealth.db_active_connections}
            </span>
            <span className="text-[10px] text-slate-500">
              / {systemHealth.db_pool_size} pool
            </span>
          </div>
        </div>

        {/* Disk */}
        <div className="bg-slate-950/40 border border-slate-800/80 rounded-xl p-3 flex flex-col gap-1">
          <div className="flex items-center justify-between text-[9px] uppercase font-bold text-slate-500">
            <span>DISK</span>
            <HardDrive className="h-3 w-3 text-slate-400" />
          </div>
          <div className="flex items-baseline gap-1 mt-0.5">
            <span className="text-sm font-extrabold text-slate-200">
              {systemHealth.disk_used_gb} GB
            </span>
            <span className="text-[10px] text-slate-500">
              / {systemHealth.disk_total_gb} GB
            </span>
          </div>
          <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden mt-0.5">
            <div
              className="h-full bg-slate-500 rounded-full"
              style={{ width: `${Math.min(systemHealth.disk_usage_pct, 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Inference status row */}
      <div className="bg-slate-950/40 border border-slate-800/80 rounded-xl p-3 flex items-center justify-between text-xs">
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] uppercase font-bold text-slate-500">INFERENCE SERVICE</span>
          <span className="text-slate-400 truncate max-w-[10rem]">{systemHealth.inference_url}</span>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <span
            className={`text-[10px] font-extrabold uppercase ${
              inferenceOk ? "text-green-400" : "text-red-400"
            }`}
          >
            {systemHealth.inference_status}
          </span>
          {systemHealth.inference_latency_ms !== null && (
            <span className="text-[9px] text-slate-500">
              {systemHealth.inference_latency_ms} ms
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

// ─── ModelRegistryPanel ───────────────────────────────────────────────────────

/**
 * ModelRegistryPanel — B3-4 live model registry.
 *
 * Fetches GET /admin/models on mount and on manual refresh.
 * Each inactive row has an Activate button → POST /admin/models/{id}/activate.
 * The active row is highlighted with a green ring.
 * Component manages its own data-fetching state so page.js stays clean.
 */
function ModelRegistryPanel() {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  /** ID of the model currently being activated (shows spinner in button). */
  const [activating, setActivating] = useState(null);

  // No synchronous setState — every write happens after an await, so the mount
  // effect can call this directly (react-hooks/set-state-in-effect). `loading`
  // starts true for the initial load; the Refresh button raises it from its own
  // handler, where setState is unrestricted.
  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/admin/models`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Server returned HTTP ${res.status}`);
      setModels(await res.json());
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Run the fetch as async work rather than calling it straight from the
    // effect body. Paired with fetchModels() being await-first, no state is
    // written synchronously during the effect — which is what
    // react-hooks/set-state-in-effect is guarding against.
    (async () => { await fetchModels(); })();
  }, [fetchModels]);

  const handleActivate = async (modelId) => {
    try {
      setActivating(modelId);
      const res = await fetch(
        `${BACKEND_URL}/admin/models/${modelId}/activate`,
        { method: "POST", credentials: "include" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `HTTP ${res.status}`);
      }
      await fetchModels(); // refresh to show new active state
    } catch (e) {
      setError(e.message);
    } finally {
      setActivating(null);
    }
  };

  return (
    <section
      className="bg-slate-900/40 border border-slate-800/60 p-4 rounded-2xl flex flex-col gap-3 shrink-0"
      data-testid="model-registry"
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-400">
          <Compass className="h-4 w-4 text-blue-400" />
          <span>AI MODEL REGISTRY</span>
        </div>
        <button
          onClick={() => { setLoading(true); fetchModels(); }}
          disabled={loading}
          className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 hover:text-slate-300 transition disabled:opacity-40 cursor-pointer"
          title="Refresh model list"
          id="refresh-model-registry"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin text-blue-400" : ""}`} />
          Refresh
        </button>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="flex items-center gap-2 bg-red-950/40 border border-red-500/30 rounded-xl px-3 py-2 text-[10px] text-red-400">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}

      {/* ── Model list ── */}
      <div className="flex flex-col gap-2 max-h-[22rem] overflow-y-auto custom-scrollbar pr-1">
        {/* Loading state */}
        {loading && models.length === 0 && (
          <div className="flex items-center justify-center py-6 text-slate-600 text-xs gap-2">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Loading registry…
          </div>
        )}

        {/* Empty state */}
        {!loading && models.length === 0 && (
          <div className="flex flex-col items-center justify-center py-6 gap-2 text-center">
            <PackageCheck className="h-8 w-8 text-slate-700" />
            <p className="text-xs text-slate-600">No models registered yet.</p>
            <p className="text-[10px] text-slate-700 max-w-[16rem]">
              Use{" "}
              <code className="bg-slate-800 px-1 rounded text-slate-400">
                POST /admin/models
              </code>{" "}
              to register the first version.
            </p>
          </div>
        )}

        {/* Model rows */}
        {models.map((m) => (
          <div
            key={m.id}
            className={`rounded-xl p-3 border flex flex-col gap-2 transition ${
              m.is_active
                ? "bg-emerald-950/30 border-emerald-500/40 ring-1 ring-emerald-500/20"
                : "bg-slate-950/40 border-slate-800/80"
            }`}
          >
            {/* Top row: version + badge/button */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {m.is_active && (
                  <CheckCircle className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                )}
                <span
                  className={`text-xs font-bold truncate ${
                    m.is_active ? "text-emerald-300" : "text-slate-200"
                  }`}
                  title={m.version}
                >
                  {m.version}
                </span>
              </div>

              {m.is_active ? (
                <span className="text-[9px] font-extrabold uppercase tracking-wider text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-2 py-0.5 rounded-full shrink-0">
                  ACTIVE
                </span>
              ) : (
                <button
                  onClick={() => handleActivate(m.id)}
                  disabled={activating === m.id}
                  className="text-[9px] font-extrabold uppercase tracking-wider text-blue-400 bg-blue-950/50 border border-blue-500/30 px-2 py-0.5 rounded-full shrink-0 hover:bg-blue-900/60 hover:text-blue-300 transition cursor-pointer disabled:opacity-50"
                  id={`activate-model-${m.id}`}
                >
                  {activating === m.id ? "…" : "Activate"}
                </button>
              )}
            </div>

            {/* Metrics row */}
            <div className="grid grid-cols-3 gap-2 text-[9px]">
              <div className="flex flex-col">
                <span className="text-slate-600 uppercase font-bold">Classes</span>
                <span
                  className="text-slate-300 font-semibold mt-0.5 truncate"
                  title={(m.classes || []).join(", ")}
                >
                  {(m.classes || []).length} class
                  {(m.classes || []).length !== 1 ? "es" : ""}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-slate-600 uppercase font-bold">Conf</span>
                <span className="text-slate-300 font-semibold mt-0.5">
                  {m.conf_threshold.toFixed(2)}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-slate-600 uppercase font-bold">mAP50</span>
                <span className="text-slate-300 font-semibold mt-0.5">
                  {m.metrics?.map50 != null
                    ? m.metrics.map50.toFixed(3)
                    : m.metrics?.mAP50 != null
                    ? m.metrics.mAP50.toFixed(3)
                    : "—"}
                </span>
              </div>
            </div>

            {/* Class pills */}
            {(m.classes || []).length > 0 && (
              <div className="flex flex-wrap gap-1">
                {(m.classes || []).map((cls) => (
                  <span
                    key={cls}
                    className="text-[8px] font-semibold bg-slate-800/80 border border-slate-700/60 text-slate-400 px-1.5 py-0.5 rounded-full"
                  >
                    {cls.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            )}

            {/* Footer: date + notes */}
            <span className="text-[9px] text-slate-600">
              Registered {new Date(m.registered_at).toLocaleDateString()}
              {m.notes && (
                <span className="ml-2 italic" title={m.notes}>
                  · {m.notes.slice(0, 60)}
                  {m.notes.length > 60 ? "…" : ""}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── AdminDashboard (default export) ─────────────────────────────────────────

/**
 * AdminDashboard — user registry + real system health + live model registry + upload.
 *
 * Props:
 *   adminUsers    — array of user objects from GET /admin/users
 *   systemHealth  — object from GET /admin/system-health
 *   onRoleChange  — (userId, newRole) => void
 *   onUpload      — file input change handler
 *   uploading     — boolean upload-in-progress flag
 *
 * ModelRegistryPanel manages its own data-fetching via useEffect so this
 * component receives no extra props for B3-4.
 */
export default function AdminDashboard({
  adminUsers,
  systemHealth,
  onRoleChange,
  onUpload,
  uploading,
}) {
  return (
    <>
      <UserDirectory adminUsers={adminUsers} onRoleChange={onRoleChange} />
      <SystemHealthPanel systemHealth={systemHealth} />
      {/* B3-4: live model registry — self-fetching, no extra props needed */}
      <ModelRegistryPanel />
      <UploadPanel onUpload={onUpload} uploading={uploading} />
    </>
  );
}
