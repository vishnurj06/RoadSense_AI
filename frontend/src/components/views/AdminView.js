"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Server, Users, Boxes } from "lucide-react";
import Gauge from "@/components/ui/Gauge";
import { SystemHealthPanel, UserDirectory, ModelRegistryPanel } from "@/components/dashboards/AdminDashboard";
import UploadPanel from "@/components/shared/UploadPanel";
import { ACCENT, STATUS } from "@/lib/theme";
import { T, rise, stagger } from "@/lib/motion";

/**
 * The gauges only take a status hue once the number matters (75/90%). A dial
 * that is always red is decoration; a dial that turns red is information.
 */
function loadColor(pct) {
  if (pct >= 90) return STATUS.critical;
  if (pct >= 75) return STATUS.warning;
  return ACCENT;
}

const TABS = [
  { id: "system", label: "System health", icon: Server },
  { id: "users", label: "User management", icon: Users },
  { id: "models", label: "Model registry", icon: Boxes },
];

/**
 * AdminView — system health, users and the model registry, as real tabs.
 *
 * The previous version routed on a `section` prop with an `if` ladder that fell
 * through to <UserDirectory> for BOTH "overview" and "users" — so two different
 * destinations rendered the same panel. Making the tabs the single source of
 * truth removes the fall-through entirely: there is no default branch to get
 * wrong, because every tab id maps to exactly one panel.
 */
export default function AdminView({ adminUsers, systemHealth, onRoleChange, onUpload, uploading }) {
  const [tab, setTab] = useState("system");

  return (
    <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
      <div className="flex flex-col gap-3">
        {/* Tabs */}
        <div className="border-line bg-surface/60 inline-flex w-fit gap-1 rounded-xl border p-1 backdrop-blur-xl">
          {TABS.map(({ id, label, icon: Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                aria-current={active ? "page" : undefined}
                className={`relative flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  active ? "text-accent" : "text-ink-3 hover:text-ink-2"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="admin-tab"
                    transition={T.spring}
                    className="bg-accent/10 border-accent/25 absolute inset-0 rounded-lg border"
                  />
                )}
                <Icon className="relative h-3.5 w-3.5" />
                <span className="relative">{label}</span>
              </button>
            );
          })}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            variants={stagger(0.05)}
            initial="hidden"
            animate="show"
            exit={{ opacity: 0, y: -6, transition: T.fast }}
            className="flex flex-col gap-3"
          >
            {tab === "system" && (
              <SystemTab systemHealth={systemHealth} onUpload={onUpload} uploading={uploading} />
            )}
            {tab === "users" && (
              <UserDirectory adminUsers={adminUsers} onRoleChange={onRoleChange} />
            )}
            {tab === "models" && <ModelRegistryPanel />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function SystemTab({ systemHealth, onUpload, uploading }) {
  if (!systemHealth) {
    return (
      <motion.div variants={rise} className="border-line bg-surface/60 rounded-2xl border p-10 text-center backdrop-blur-xl">
        <p className="text-ink-3 text-[12px]">System health unavailable — is the backend reachable?</p>
      </motion.div>
    );
  }

  const dbPct = systemHealth.db_pool_size
    ? (systemHealth.db_active_connections / systemHealth.db_pool_size) * 100
    : 0;

  return (
    <>
      <motion.div variants={rise} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <GaugeCard>
          <Gauge
            value={systemHealth.cpu_usage_pct}
            color={loadColor(systemHealth.cpu_usage_pct)}
            label="CPU load"
          />
        </GaugeCard>
        <GaugeCard>
          <Gauge
            value={systemHealth.memory_usage_pct}
            color={loadColor(systemHealth.memory_usage_pct)}
            label="Memory"
          />
        </GaugeCard>
        <GaugeCard>
          <Gauge
            value={systemHealth.disk_usage_pct}
            color={loadColor(systemHealth.disk_usage_pct)}
            label="Disk"
          />
          <span className="text-ink-3 tnum font-mono text-[10px]">
            {systemHealth.disk_used_gb} / {systemHealth.disk_total_gb} GB
          </span>
        </GaugeCard>
        <GaugeCard>
          <Gauge
            value={Math.round(dbPct)}
            color={loadColor(dbPct)}
            label="DB pool"
          />
          <span className="text-ink-3 tnum font-mono text-[10px]">
            {systemHealth.db_active_connections} / {systemHealth.db_pool_size} conns
          </span>
        </GaugeCard>
      </motion.div>

      <motion.div variants={rise}>
        <SystemHealthPanel systemHealth={systemHealth} />
      </motion.div>

      <motion.div variants={rise} className="max-w-md">
        <UploadPanel onUpload={onUpload} uploading={uploading} />
      </motion.div>
    </>
  );
}

function GaugeCard({ children }) {
  return (
    <div className="border-line bg-surface/60 flex flex-col items-center justify-center gap-2 rounded-2xl border p-5 backdrop-blur-xl">
      {children}
    </div>
  );
}
