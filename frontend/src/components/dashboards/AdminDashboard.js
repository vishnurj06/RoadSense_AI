"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion } from "motion/react";
import {
  Users,
  UserPlus,
  KeyRound,
  Trash2,
  Server,
  Boxes,
  Cpu,
  MemoryStick,
  HardDrive,
  Database,
  CheckCircle2,
  RefreshCw,
  PackageCheck,
  AlertCircle,
  Zap,
} from "lucide-react";
import Panel from "@/components/ui/Panel";
import UploadPanel from "@/components/shared/UploadPanel";
import { Meter, EmptyState, Skeleton, Chip, CountUp } from "@/components/ui/Primitives";
import { ACCENT, STATUS, INK } from "@/lib/theme";
import { stagger, rowIn, T } from "@/lib/motion";

const BACKEND_URL = "http://localhost:8000";

/* ── User directory ─────────────────────────────────────────────────────── */

function UserDirectory({
  adminUsers,
  onRoleChange,
  onCreateUser,
  onDeleteUser,
  onResetPassword,
  currentUserId,
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("fleet");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Inline password reset — only one row open at a time.
  const [editingId, setEditingId] = useState(null);
  const [newPwd, setNewPwd] = useState("");
  const [savingPwd, setSavingPwd] = useState(false);

  const openReset = (id) => {
    setEditingId((cur) => (cur === id ? null : id));
    setNewPwd("");
  };
  const submitReset = async (id) => {
    if (savingPwd) return;
    setSavingPwd(true);
    const res = await onResetPassword(id, newPwd);
    setSavingPwd(false);
    if (res?.ok) {
      setEditingId(null);
      setNewPwd("");
    }
  };

  const submitNewUser = async (e) => {
    e.preventDefault();
    if (!onCreateUser || busy) return;
    setBusy(true);
    setErr("");
    const res = await onCreateUser({ username: username.trim(), password, role });
    setBusy(false);
    if (res?.ok) {
      setUsername("");
      setPassword("");
      setRole("fleet");
    } else {
      setErr(res?.error || "Failed to create user");
    }
  };

  return (
    <Panel
      title="User registry"
      icon={Users}
      count={adminUsers.length}
      testId="user-directory"
      className="flex min-h-0 flex-col"
      bodyClassName="min-h-0"
    >
      {/* Add user — admin-only account creation (POST /admin/users). */}
      {onCreateUser && (
        <form
          onSubmit={submitNewUser}
          className="border-line bg-raised/40 mb-2.5 flex flex-wrap items-center gap-1.5 rounded-xl border p-2"
        >
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            autoComplete="off"
            minLength={3}
            required
            className="bg-sunken border-line text-ink placeholder:text-ink-3 focus:border-accent/50 h-7 min-w-0 flex-1 rounded-md border px-2 text-[11px] outline-none transition-colors"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="new-password"
            minLength={6}
            required
            className="bg-sunken border-line text-ink placeholder:text-ink-3 focus:border-accent/50 h-7 min-w-0 flex-1 rounded-md border px-2 text-[11px] outline-none transition-colors"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            aria-label="Role for new user"
            className="bg-sunken border-line text-ink-2 focus:border-accent/50 h-7 shrink-0 cursor-pointer rounded-md border px-1.5 text-[10px] outline-none transition-colors"
          >
            <option value="fleet">Fleet</option>
            <option value="authority">Authority</option>
            <option value="admin">Admin</option>
          </select>
          <button
            type="submit"
            disabled={busy}
            className="bg-accent/15 border-accent/30 text-accent hover:bg-accent/25 flex shrink-0 items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:opacity-50"
          >
            <UserPlus className="h-3 w-3" />
            {busy ? "Adding…" : "Add"}
          </button>
          {err && <span className="text-critical w-full text-[10px] font-medium">{err}</span>}
        </form>
      )}

      <div className="custom-scrollbar -mx-1 max-h-[14rem] min-h-0 overflow-y-auto px-1">
        {adminUsers.length === 0 ? (
          <EmptyState icon={Users} title="No users registered" />
        ) : (
          <motion.ul variants={stagger(0.03)} initial="hidden" animate="show" className="flex flex-col gap-1.5">
            {adminUsers.map((u) => (
              <motion.li
                key={u.id}
                variants={rowIn}
                className="bg-raised/50 border-line flex flex-col gap-2 rounded-xl border p-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-ink flex items-center gap-1.5 truncate text-[11px] font-medium">
                      {u.username}
                      {u.id === currentUserId && (
                        <span className="text-ink-3 text-[9px] font-normal">(you)</span>
                      )}
                    </span>
                    <span className="text-ink-3 tnum font-mono text-[9px]">
                      {new Date(u.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <select
                      value={u.role}
                      onChange={(e) => onRoleChange(u.id, e.target.value)}
                      aria-label={`Role for ${u.username}`}
                      className="bg-sunken border-line text-ink-2 focus:border-accent/50 h-6 cursor-pointer rounded-md border px-1.5 text-[10px] outline-none transition-colors"
                    >
                      <option value="admin">Admin</option>
                      <option value="authority">Authority</option>
                      <option value="fleet">Fleet</option>
                    </select>
                    {onResetPassword && (
                      <button
                        type="button"
                        onClick={() => openReset(u.id)}
                        aria-label={`Reset password for ${u.username}`}
                        title="Reset password"
                        className={`border-line grid h-6 w-6 cursor-pointer place-items-center rounded-md border transition-colors ${
                          editingId === u.id
                            ? "bg-accent/10 border-accent/30 text-accent"
                            : "bg-sunken text-ink-3 hover:text-ink-2"
                        }`}
                      >
                        <KeyRound className="h-3 w-3" />
                      </button>
                    )}
                    {onDeleteUser && u.id !== currentUserId && (
                      <button
                        type="button"
                        onClick={() => onDeleteUser(u.id, u.username)}
                        aria-label={`Delete ${u.username}`}
                        title="Delete user"
                        className="border-line bg-sunken text-ink-3 hover:border-critical/40 hover:text-critical grid h-6 w-6 cursor-pointer place-items-center rounded-md border transition-colors"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>

                {editingId === u.id && onResetPassword && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      submitReset(u.id);
                    }}
                    className="border-line flex items-center gap-1.5 border-t pt-2"
                  >
                    <input
                      type="password"
                      value={newPwd}
                      onChange={(e) => setNewPwd(e.target.value)}
                      placeholder="New password"
                      autoComplete="new-password"
                      minLength={6}
                      required
                      autoFocus
                      className="bg-sunken border-line text-ink placeholder:text-ink-3 focus:border-accent/50 h-7 min-w-0 flex-1 rounded-md border px-2 text-[11px] outline-none transition-colors"
                    />
                    <button
                      type="submit"
                      disabled={savingPwd}
                      className="bg-accent/15 border-accent/30 text-accent hover:bg-accent/25 shrink-0 rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:opacity-50"
                    >
                      {savingPwd ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="text-ink-3 hover:text-ink-2 shrink-0 rounded-md px-2 py-1 text-[11px] transition-colors"
                    >
                      Cancel
                    </button>
                  </form>
                )}
              </motion.li>
            ))}
          </motion.ul>
        )}
      </div>
    </Panel>
  );
}

/* ── System health ───────────────────────────────────────────────────────────
   Real psutil metrics from GET /admin/system-health (B3-0).

   The meters are sequential magnitude, so they take ONE hue each and stay in
   interface ink until they actually matter: a utilisation bar only turns
   warning/critical past 75/90%. A permanently-coloured bar is decoration; a bar
   that changes colour is information.                                        */

/**
 * SystemHealthPanel — the live service probe.
 *
 * CPU / memory / disk / DB-pool used to be four little bar tiles in here. They
 * are now radial gauges in AdminView, which reads far better at page width, so
 * duplicating them as bars would just be the same four numbers twice. What is
 * left is the part the gauges can't show: which service we are talking to,
 * whether it answered, and how fast.
 */
function SystemHealthPanel({ systemHealth }) {
  if (!systemHealth) return null;
  const ok = systemHealth.inference_status === "ok";

  return (
    <Panel title="Services" icon={Server} testId="system-health">
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        <div className="bg-raised/50 border-line flex items-center justify-between gap-2 rounded-xl border p-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="eyebrow">Inference service</span>
            <span className="text-ink-3 truncate font-mono text-[10px]">
              {systemHealth.inference_url}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {systemHealth.inference_latency_ms != null && (
              <span className="text-ink-3 tnum font-mono text-[10px]">
                {systemHealth.inference_latency_ms} ms
              </span>
            )}
            <Chip
              className={
                ok
                  ? "bg-good/10 text-good border-good/25"
                  : "bg-critical/10 text-critical border-critical/25"
              }
            >
              <Zap className="h-2.5 w-2.5" />
              {systemHealth.inference_status}
            </Chip>
          </div>
        </div>

        <div className="bg-raised/50 border-line flex items-center justify-between gap-2 rounded-xl border p-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="eyebrow">Datastores</span>
            <span className="text-ink-3 truncate font-mono text-[10px]">
              postgres · redis · minio
            </span>
          </div>
          <Chip className="bg-good/10 text-good border-good/25">
            <Database className="h-2.5 w-2.5" />
            connected
          </Chip>
        </div>
      </div>
    </Panel>
  );
}

/* ── Model registry ──────────────────────────────────────────────────────────
   B3-4 live model registry. Fetches GET /admin/models on mount and on manual
   refresh; each inactive row can be activated via POST /admin/models/{id}/activate.

   Person A's registry (ai/models.json) is explicit on two points: RDD test AP is
   NOT comparable across versions (v3 was scored on India-only, v4 on all six
   countries), and the real-footage numbers are the ship gate. So the headline
   cell shows the real-footage hit rate and RDD AP is demoted to a labelled
   secondary line carrying his own caveat — rendering his caveated number as a
   bare "mAP50" would launder exactly the warning he attached to it.          */

function getShipGate(metrics) {
  return metrics?.real_footage_pothole_frames_hit ?? null;
}

/** RDD AP, with fallbacks for models registered by hand via POST /admin/models. */
function getRddAp(metrics) {
  const v = metrics?.rdd_test_map50 ?? metrics?.map50 ?? metrics?.mAP50;
  return typeof v === "number" ? v : null;
}

function ModelRegistryPanel() {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  /** ID of the model currently being activated (shows spinner in button). */
  const [activating, setActivating] = useState(null);
  /** True while POST /admin/models/sync is in flight. */
  const [syncing, setSyncing] = useState(false);

  // No synchronous setState — every write happens after an await, so the mount
  // effect can call this directly (react-hooks/set-state-in-effect). `loading`
  // starts true for the initial load; the Refresh button raises it from its own
  // handler, where setState is unrestricted.
  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/admin/models`, { credentials: "include" });
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
    (async () => {
      await fetchModels();
    })();
  }, [fetchModels]);

  const handleActivate = async (modelId) => {
    try {
      setActivating(modelId);
      const res = await fetch(`${BACKEND_URL}/admin/models/${modelId}/activate`, {
        method: "POST",
        credentials: "include",
      });
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

  /**
   * B3-4: pull Person A's ai/models.json into the DB registry, then refresh.
   * Idempotent server-side, and it never overrides a deliberate activation.
   */
  const handleSync = async () => {
    try {
      setSyncing(true);
      setError(null);
      const res = await fetch(`${BACKEND_URL}/admin/models/sync`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.detail || `Sync failed (HTTP ${res.status})`);
      }
      await fetchModels();
    } catch (e) {
      setError(e.message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Panel
      title="Model registry"
      icon={Boxes}
      count={models.length || undefined}
      testId="model-registry"
      className="flex min-h-0 flex-col"
      bodyClassName="min-h-0"
      actions={
        <>
          <motion.button
            type="button"
            id="sync-model-registry"
            onClick={handleSync}
            disabled={syncing || loading}
            whileTap={{ scale: 0.94 }}
            transition={T.fast}
            title="Import versions from ai/models.json (Person A's registry)"
            className="bg-accent/10 border-accent/25 text-accent hover:bg-accent/20 flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium transition-colors disabled:opacity-40"
          >
            <PackageCheck className={`h-2.5 w-2.5 ${syncing ? "animate-breathe" : ""}`} />
            {syncing ? "Syncing…" : "Sync"}
          </motion.button>
          <motion.button
            type="button"
            id="refresh-model-registry"
            onClick={() => {
              setLoading(true);
              fetchModels();
            }}
            disabled={loading}
            whileTap={{ scale: 0.94 }}
            transition={T.fast}
            title="Refresh model list"
            className="bg-raised border-line text-ink-3 hover:text-ink flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`h-2.5 w-2.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </motion.button>
        </>
      }
    >
      {error && (
        <div className="bg-critical/10 border-critical/30 text-critical mb-2 flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[10px]">
          <AlertCircle className="h-3 w-3 shrink-0" />
          <span className="min-w-0 flex-1">{error}</span>
        </div>
      )}

      <div className="custom-scrollbar -mx-1 max-h-[22rem] min-h-0 overflow-y-auto px-1">
        {loading && models.length === 0 && (
          <div className="flex flex-col gap-1.5">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        )}

        {!loading && models.length === 0 && (
          <EmptyState
            icon={PackageCheck}
            title="No models registered"
            hint="Hit Sync to import Person A's published versions from ai/models.json, or register one by hand with POST /admin/models."
          />
        )}

        {models.length > 0 && (
          <motion.ul variants={stagger(0.04)} initial="hidden" animate="show" className="flex flex-col gap-1.5">
            {models.map((m) => (
              <motion.li
                key={m.id}
                variants={rowIn}
                className={`flex flex-col gap-2 rounded-xl border p-2.5 transition-colors ${
                  m.is_active ? "border-good/35 bg-good/5" : "border-line bg-raised/50"
                }`}
              >
                {/* Version + activation */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    {m.is_active && <CheckCircle2 className="text-good h-3 w-3 shrink-0" />}
                    <span
                      className={`truncate font-mono text-[11px] font-medium ${
                        m.is_active ? "text-good" : "text-ink"
                      }`}
                      title={m.version}
                    >
                      {m.version}
                    </span>
                  </div>
                  {m.is_active ? (
                    <Chip className="bg-good/10 text-good border-good/25 uppercase">Active</Chip>
                  ) : (
                    <motion.button
                      type="button"
                      id={`activate-model-${m.id}`}
                      onClick={() => handleActivate(m.id)}
                      disabled={activating === m.id}
                      whileTap={{ scale: 0.94 }}
                      transition={T.fast}
                      className="bg-accent/10 border-accent/25 text-accent hover:bg-accent/20 shrink-0 cursor-pointer rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors disabled:opacity-50"
                    >
                      {activating === m.id ? "…" : "Activate"}
                    </motion.button>
                  )}
                </div>

                {/* Metrics — real footage is the ship gate, not RDD AP */}
                <div className="grid grid-cols-3 gap-2">
                  <Cell label="Classes" value={`${(m.classes || []).length}`} title={(m.classes || []).join(", ")} />
                  <Cell
                    label="Conf"
                    value={typeof m.conf_threshold === "number" ? m.conf_threshold.toFixed(2) : "—"}
                  />
                  <Cell
                    label="Real footage"
                    value={getShipGate(m.metrics) ?? "—"}
                    title={
                      m.metrics?.real_footage_false_positives != null
                        ? `${getShipGate(m.metrics)} frames hit · ${m.metrics.real_footage_false_positives} false positives`
                        : "Pothole frames hit on real footage — the ship gate"
                    }
                  />
                </div>

                {/* RDD AP — deliberately secondary and caveated (see getShipGate) */}
                {getRddAp(m.metrics) != null && (
                  <p
                    className="text-ink-3 text-[9px]"
                    title={
                      m.metrics?._note ||
                      "RDD test AP is not comparable across versions — different test splits."
                    }
                  >
                    RDD test mAP50{" "}
                    <span className="text-ink-2 font-mono">{getRddAp(m.metrics).toFixed(3)}</span>
                    <span className="italic"> · not comparable across versions</span>
                  </p>
                )}

                {/* Class pills — neutral: class identity never wears hue */}
                {(m.classes || []).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {(m.classes || []).map((cls) => (
                      <Chip key={cls} className="bg-sunken text-ink-3">
                        {cls.replace(/_/g, " ")}
                      </Chip>
                    ))}
                  </div>
                )}

                <p className="text-ink-3 text-[9px]">
                  Registered {new Date(m.registered_at).toLocaleDateString()}
                  {m.notes && (
                    <span className="italic" title={m.notes}>
                      {" · "}
                      {m.notes.slice(0, 60)}
                      {m.notes.length > 60 ? "…" : ""}
                    </span>
                  )}
                </p>
              </motion.li>
            ))}
          </motion.ul>
        )}
      </div>
    </Panel>
  );
}

function Cell({ label, value, title }) {
  return (
    <div className="flex flex-col gap-0.5" title={title}>
      <span className="eyebrow truncate">{label}</span>
      <span className="text-ink-2 truncate font-mono text-[11px] font-medium">{value}</span>
    </div>
  );
}

export { UserDirectory, SystemHealthPanel, ModelRegistryPanel };
