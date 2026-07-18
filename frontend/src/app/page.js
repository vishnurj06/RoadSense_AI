"use client";

/**
 * page.js — Dashboard orchestrator (Person B · RoadSense AI · Phase 3)
 *
 * Responsibility: auth guard, data fetching, shared state, and routing between
 * views. All rendering is delegated to the shell and the views.
 *
 * The shell used to force EVERY section into one 400px column floating over the
 * map, which is why reports, analytics and admin all felt cramped and left dead
 * space. Now only MapView floats a panel — the rest are real pages.
 */

import React, { useState, useEffect, useMemo, useCallback, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, MotionConfig } from "motion/react";
import {
  Map as MapIcon,
  Table2,
  BarChart3,
  Car,
  Server,
  Users,
  Boxes,
  ListChecks,
  RefreshCw,
  Satellite,
  Layers,
} from "lucide-react";

import dynamic from "next/dynamic";
import Sidebar from "@/components/shell/Sidebar";
import PageHeader from "@/components/shell/PageHeader";
import CommandPalette from "@/components/shell/CommandPalette";
import NotificationBell from "@/components/shell/NotificationBell";
import Toast from "@/components/shared/Toast";
import MapView from "@/components/views/MapView";
import QueueView from "@/components/views/QueueView";
import ReportsView from "@/components/views/ReportsView";
import AnalyticsView from "@/components/views/AnalyticsView";
import FleetView from "@/components/views/FleetView";
import AdminView from "@/components/views/AdminView";
import { VehicleHistoryDrawer } from "@/components/dashboards/FleetDashboard";
import { getMaxSeverity } from "@/lib/classUtils";
import { isRealGps } from "@/lib/gpsUtils";
import { mapFeaturesToIssues } from "@/lib/mapUtils";
import { IconButton } from "@/components/ui/Primitives";
import { T } from "@/lib/motion";

// Leaflet map — SSR disabled (window is not defined on server). Mounted once,
// at the back, for the whole session.
const MapComponent = dynamic(() => import("@/components/MapComponent"), {
  ssr: false,
  loading: () => (
    <div className="bg-canvas bg-grid text-ink-3 flex h-full w-full flex-col items-center justify-center gap-3">
      <RefreshCw className="text-accent h-5 w-5 animate-spin" />
      <p className="text-[11px] font-medium">Loading map…</p>
    </div>
  ),
});

const BACKEND_URL = "http://localhost:8000";

// ─── Hydration guard ──────────────────────────────────────────────────────────

/**
 * `user` is read from localStorage, so it is null on the server and populated on
 * the client — rendering user-dependent UI on the first client pass would be a
 * hydration mismatch. This reports false during SSR *and* during hydration, then
 * flips to true once mounted, matching the server output exactly when it counts.
 */
const subscribeToNothing = () => () => {};
const useIsHydrated = () =>
  useSyncExternalStore(
    subscribeToNothing,
    () => true, // client snapshot — after hydration
    () => false // server snapshot — during SSR and hydration
  );

// ─── Views per role ───────────────────────────────────────────────────────────

/**
 * Views, mapped from the PRD's three dashboards.
 *
 *   Authority → Live map · Severity · Pending reports · Repair tracking · Analytics
 *   Fleet     → Vehicle status · Detection history · Camera health
 *   Admin     → User management · AI model management · System monitoring
 *
 * `w` is the docked panel width. Every view is a panel beside the sidebar with
 * the map living behind it — the width is what the view needs, not a different
 * layout. A 384px issue list and a 1020px telemetry table are the same shell.
 */
const VIEW = {
  map: { label: "Live Map", icon: MapIcon, title: "Live Hazard Map", subtitle: "Real-time detections across the network", w: 384 },
  queue: { label: "Action Queue", icon: ListChecks, title: "Pending & Repair Tracking", subtitle: "Approved issues awaiting dispatch", w: 440 },
  reports: { label: "Report Logs", icon: Table2, title: "Report Logs", subtitle: "Raw telemetry from all vehicles", w: 1040 },
  analytics: { label: "Analytics", icon: BarChart3, title: "Operations Analytics", subtitle: "Trend, hazard mix & road health", w: 1100 },
  fleet: { label: "Fleet", icon: Car, title: "Fleet Registry", subtitle: "Vehicle status & camera health", w: 820 },
  // Admin operator console — three focused destinations, not one catch-all panel.
  health: { label: "System Health", icon: Server, title: "System Health", subtitle: "CPU, memory, disk, DB & inference", w: 1100 },
  users: { label: "User Management", icon: Users, title: "User Management", subtitle: "Accounts & role assignment", w: 720 },
  models: { label: "Model Registry", icon: Boxes, title: "AI Model Registry", subtitle: "Registered versions & activation", w: 900 },
};

/**
 * Role-derived: a fleet user never sees an admin destination at all.
 *
 * Scoped to the PRD's three dashboards rather than "everything for everyone":
 *   Authority → live map, severity, pending reports, repair tracking, analytics
 *   Fleet     → vehicle status, detection history, camera health
 *   Admin     → user management, AI model management, system monitoring
 *
 * So Authority does NOT get Fleet (vehicle/camera health is the operator's
 * concern, not the road authority's), and Fleet does NOT get Analytics.
 *
 * Admin is the internal OPERATOR, not a super-authority. It ACTS only on operator
 * tasks (system health, users, model registry) and can VIEW customer data
 * read-only (map, reports, analytics) for oversight/support — but it does NOT get
 * the action surfaces (Action Queue dispatch, Fleet management). Keeping admin
 * view-only on customer data also keeps the repair audit log honest: a status
 * change always means the authority acted, never "someone with god-mode".
 */
const SECTIONS = {
  // Live map · Severity · Pending reports · Repair tracking · Analytics
  authority: ["map", "queue", "reports", "analytics"],
  // Vehicle status · Detection history · Camera health
  fleet: ["map", "fleet", "reports"],
  // Operator console (act) + read-only oversight of customer data (view).
  admin: ["map", "reports", "analytics", "health", "users", "models"],
};

/** Each role lands on ITS dashboard, not on someone else's. */
const HOME = { authority: "map", fleet: "fleet", admin: "map" };

// ─── Filtering helpers ────────────────────────────────────────────────────────

function applyFilters(items, severityFilter, classFilter, statusFilter, realGpsOnly) {
  return items.filter((item) => {
    // B3-6: "real GPS only" must fail closed — unknown provenance is not real.
    if (realGpsOnly && !isRealGps(item.gps_source)) return false;
    const maxSev = getMaxSeverity(item.detections);
    if (!severityFilter[maxSev]) return false;
    if (classFilter !== "all") {
      const classes = item.detections?.map((d) => (d.class || "").toLowerCase()) || [];
      if (!classes.includes(classFilter)) return false;
    }
    if (statusFilter !== "all") {
      if ((item.status || "detected").toLowerCase() !== statusFilter) return false;
    }
    return true;
  });
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const router = useRouter();
  const [user] = useState(() => {
    if (typeof window === "undefined") return null;
    const saved = localStorage.getItem("user");
    return saved ? JSON.parse(saved) : null;
  });
  const mounted = useIsHydrated();

  // Core data
  const [reports, setReports] = useState([]);
  const [mapIssues, setMapIssues] = useState([]);
  const [analytics, setAnalytics] = useState({
    total_reports: 0,
    total_detections: 0,
    severity_distribution: { high: 0, medium: 0, low: 0 },
    class_distribution: {},
    time_series: [],
  });
  const [roadHealthSegments, setRoadHealthSegments] = useState([]);
  const [showRoadHealth, setShowRoadHealth] = useState(false);
  const [reportPage, setReportPage] = useState(1);
  const [totalReports, setTotalReports] = useState(0);

  // Fleet
  const [vehicles, setVehicles] = useState([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(true);
  const [vehiclesError, setVehiclesError] = useState(null);
  const [selectedVehicle, setSelectedVehicle] = useState(null);

  // Admin-only extras
  const [adminUsers, setAdminUsers] = useState([]);
  const [systemHealth, setSystemHealth] = useState(null);

  // UI state
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  /**
   * `null` until the user actually picks something. The role's home view is
   * DERIVED below rather than written by an effect — an effect that setState's
   * a default triggers a cascading render and, worse, fights the user's own
   * navigation on every subsequent render.
   */
  const [pickedView, setView] = useState(null);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Filters
  const [severityFilter, setSeverityFilter] = useState({ high: true, medium: true, low: true });
  const [classFilter, setClassFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [realGpsOnly, setRealGpsOnly] = useState(false);

  const showToast = (message, type = "info") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // ── Data fetching ───────────────────────────────────────────────────────────

  // Deliberately performs no *synchronous* setState — every write happens after
  // an await — so the mount effect can call it directly without cascading
  // renders (react-hooks/set-state-in-effect).
  const fetchData = async (currentUser = null, targetPage = null) => {
    try {
      const activeUser = currentUser || user;
      const pageToFetch = targetPage !== null ? targetPage : reportPage;

      const [reportsRes, analyticsRes, mapRes, roadHealthRes] = await Promise.all([
        fetch(`${BACKEND_URL}/reports?page=${pageToFetch}&limit=10`, { credentials: "include" }),
        fetch(`${BACKEND_URL}/analytics`, { credentials: "include" }),
        fetch(`${BACKEND_URL}/map`, { credentials: "include" }),
        fetch(`${BACKEND_URL}/analytics/road-health`, { credentials: "include" }),
      ]);

      if ([reportsRes, analyticsRes, mapRes, roadHealthRes].some((r) => r.status === 401)) {
        localStorage.removeItem("user");
        router.push("/login");
        return;
      }
      if (!reportsRes.ok || !analyticsRes.ok || !mapRes.ok) {
        throw new Error("Failed to fetch dashboard data from backend server.");
      }

      const reportsData = await reportsRes.json();
      const analyticsData = await analyticsRes.json();
      const mapGeoJson = await mapRes.json();
      const roadHealthData = await roadHealthRes.json();

      setError(null);
      setReports(reportsData.reports || []);
      setTotalReports(reportsData.total || 0);
      if (targetPage !== null) setReportPage(targetPage);
      setAnalytics(analyticsData);
      setRoadHealthSegments(roadHealthData.segments || []);
      setMapIssues(mapFeaturesToIssues(mapGeoJson));

      if (activeUser?.role === "admin") {
        const [usersRes, healthRes] = await Promise.all([
          fetch(`${BACKEND_URL}/admin/users`, { credentials: "include" }),
          fetch(`${BACKEND_URL}/admin/system-health`, { credentials: "include" }),
        ]);
        if (usersRes.ok && healthRes.ok) {
          setAdminUsers(await usersRes.json());
          setSystemHealth(await healthRes.json());
        }
      }
    } catch (err) {
      console.error(err);
      setError("Backend offline. Ensure FastAPI is running on http://localhost:8000.");
    } finally {
      setLoading(false);
    }
  };

  /**
   * User-initiated refresh. Does NOT clear existing data: a refetch holds the
   * previous render rather than flashing skeletons, so the layout never jumps.
   */
  const refresh = (targetPage = null) => {
    setLoading(true);
    setError(null);
    return fetchData(null, targetPage);
  };

  // `vehiclesLoading` starts true and is never re-raised: the 60 s poll must
  // update in place. Re-raising it blanked the registry every minute.
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
    if (!user) {
      router.push("/login");
      return;
    }
    (async () => {
      await fetchData(user);
      await fetchVehicles();
    })();
    const id = setInterval(fetchVehicles, 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ⌘K / Ctrl-K
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleLogout = async () => {
    try {
      await fetch(`${BACKEND_URL}/auth/logout`, { method: "POST", credentials: "include" });
    } catch (e) {
      console.error("Logout failed:", e);
    }
    localStorage.removeItem("user");
    router.push("/login");
  };

  const handleQuickAction = async (issueId, nextStatus) => {
    try {
      const res = await fetch(`${BACKEND_URL}/repair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issue_id: issueId, status: nextStatus }),
        credentials: "include",
      });
      if (res.ok) {
        showToast(`Issue updated → ${nextStatus}`, "success");
        refresh();
      } else {
        const e = await res.json();
        showToast(e.detail || "Failed to update", "error");
      }
    } catch {
      showToast("Connection error", "error");
    }
  };

  const handleUserRoleToggle = async (userId, newRole) => {
    try {
      const res = await fetch(`${BACKEND_URL}/admin/users/role`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, role: newRole }),
        credentials: "include",
      });
      if (res.ok) {
        showToast(`Role updated → ${newRole}`, "success");
        refresh();
      } else {
        const e = await res.json();
        showToast(e.detail || "Failed to update role", "error");
      }
    } catch {
      showToast("Connection error", "error");
    }
  };

  // Admin-only account creation via the gated POST /admin/users. Returns a
  // result so the form can clear on success or surface an inline error.
  const handleUserCreate = async ({ username, password, role }) => {
    try {
      const res = await fetch(`${BACKEND_URL}/admin/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, role }),
        credentials: "include",
      });
      if (res.ok) {
        showToast(`User "${username}" created`, "success");
        refresh();
        return { ok: true };
      }
      const e = await res.json().catch(() => ({}));
      const msg =
        typeof e.detail === "string" ? e.detail : "Failed to create user";
      showToast(msg, "error");
      return { ok: false, error: msg };
    } catch {
      showToast("Connection error", "error");
      return { ok: false, error: "Connection error" };
    }
  };

  const handleUserDelete = async (userId, username) => {
    if (!window.confirm(`Delete user "${username}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`${BACKEND_URL}/admin/users/${userId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        showToast(`User "${username}" deleted`, "success");
        refresh();
      } else {
        const e = await res.json().catch(() => ({}));
        showToast(typeof e.detail === "string" ? e.detail : "Failed to delete user", "error");
      }
    } catch {
      showToast("Connection error", "error");
    }
  };

  // Password reset is the account "edit" action. Returns a result so the inline
  // form can close on success or show an error.
  const handleUserPasswordReset = async (userId, password) => {
    try {
      const res = await fetch(`${BACKEND_URL}/admin/users/${userId}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
        credentials: "include",
      });
      if (res.ok) {
        showToast("Password reset", "success");
        return { ok: true };
      }
      const e = await res.json().catch(() => ({}));
      const msg =
        typeof e.detail === "string" ? e.detail : "Failed to reset password";
      showToast(msg, "error");
      return { ok: false, error: msg };
    } catch {
      showToast("Connection error", "error");
      return { ok: false, error: "Connection error" };
    }
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setUploading(true);
      setError(null);
      const jitterLat = (Math.random() - 0.5) * 0.08;
      const jitterLon = (Math.random() - 0.5) * 0.08;
      const formData = new FormData();
      formData.append("file", file);
      formData.append("latitude", (19.076 + jitterLat).toString());
      formData.append("longitude", (72.8777 + jitterLon).toString());
      formData.append("vehicle_id", "demo-web-upload");
      formData.append("speed_kmph", String(Math.round(20 + Math.random() * 50)));
      const res = await fetch(`${BACKEND_URL}/detect-image`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (res.status === 401) {
        localStorage.removeItem("user");
        router.push("/login");
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Image analysis failed.");
      }
      const data = await res.json();
      await refresh();
      showToast(
        data.detections?.length > 0
          ? `Analysed: found ${data.detections.length} hazard(s)`
          : "Analysed: no hazards detected",
        "success"
      );
    } catch (err) {
      showToast(err.message, "error");
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  // ── Derived ──────────────────────────────────────────────────────────────────

  const filteredReports = applyFilters(reports, severityFilter, classFilter, statusFilter, realGpsOnly);
  const filteredIssues = applyFilters(mapIssues, severityFilter, classFilter, statusFilter, realGpsOnly);

  const role = mounted ? user?.role : undefined;
  // Each role lands on ITS dashboard. Derived, never written: before hydration
  // this is "map" on both server and client, so it can't mismatch.
  const view = pickedView ?? (role ? HOME[role] || "map" : "map");
  const ids = SECTIONS[role] || [];
  const sections = ids.map((id) => ({ id, ...VIEW[id] }));
  const meta = VIEW[view] || VIEW.map;

  // Admin is the operator: it can VIEW customer data but not ACT on the repair
  // workflow. `canAct` gates the map's status controls and the quick-action
  // buttons so admin's map/reports/analytics are genuinely read-only.
  const canAct = role !== "admin";

  const filterProps = {
    severityFilter,
    setSeverityFilter,
    classFilter,
    setClassFilter,
    statusFilter,
    setStatusFilter,
    realGpsOnly,
    setRealGpsOnly,
  };

  const commands = useMemo(() => {
    const nav = sections.map((s) => ({
      id: `nav-${s.id}`,
      group: "Navigate",
      label: s.label,
      icon: s.icon,
      run: () => setView(s.id),
    }));
    const actions = [
      { id: "act-refresh", group: "Actions", label: "Refresh data", icon: RefreshCw, run: () => refresh() },
      {
        id: "act-gps",
        group: "Actions",
        label: realGpsOnly ? "Show all GPS sources" : "Show real GPS only",
        icon: Satellite,
        run: () => setRealGpsOnly((v) => !v),
      },
      {
        id: "act-choropleth",
        group: "Actions",
        label: showRoadHealth ? "Hide road-health choropleth" : "Show road-health choropleth",
        icon: Layers,
        run: () => {
          setShowRoadHealth((v) => !v);
          setView("map");
        },
      },
    ];
    return [...nav, ...actions];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, realGpsOnly, showRoadHealth]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="bg-canvas text-ink flex h-screen w-screen overflow-hidden">
        {mounted && user && (
          <Sidebar
            sections={sections}
            active={view}
            onSelect={setView}
            user={user}
            onLogout={handleLogout}
            collapsed={navCollapsed}
            onToggle={() => setNavCollapsed((c) => !c)}
          />
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <PageHeader
            title={meta.title}
            subtitle={meta.subtitle}
            error={error}
            loading={loading}
            onRefresh={() => refresh()}
            onOpenPalette={() => setPaletteOpen(true)}
            actions={<NotificationBell />}
          />

          {/*
           * The map is a PERSISTENT canvas, not one destination among five.
           *
           * Views used to swap the whole page, which threw the map away and
           * rebuilt it on every return — losing pan/zoom and any sense of
           * place. Now the canvas stays mounted underneath and every other
           * view rises IN FRONT of it as an elevated sheet: the map breathes
           * at the edges, the app reads as one surface with depth rather than
           * a stack of unrelated pages, and coming back to the map is instant
           * because it never left.
           */}
          <div className="relative min-h-0 flex-1">
            {/*
             * `isolate` is load-bearing, not decoration.
             *
             * Leaflet gives its own panes z-index 200–700 and its controls
             * 800–1000. This wrapper is `absolute` with z-index:auto, which
             * does NOT create a stacking context — so without `isolate` those
             * values compete directly with the overlaying panels in the SAME
             * context, the map wins, and the entire UI renders underneath the
             * tiles: invisible, and eating every click.
             */}
            <div className="absolute inset-0 isolate z-0">
              <MapComponent
                reports={filteredIssues}
                onRefresh={() => refresh()}
                roadHealthSegments={roadHealthSegments}
                showRoadHealth={showRoadHealth}
                canRepair={canAct}
              />
            </div>

            {/*
             * ONE shell for every view: a panel docked beside the sidebar,
             * with the map living behind and to the right of it.
             *
             * This replaced a full-page swap, which was a regression I was told
             * about and argued past: switching to Report Logs threw the whole
             * canvas away and read as landing on an unrelated site. Docking
             * every view keeps the product in one place — the map is always
             * there, the panel is what changes — and the width simply grows to
             * what the content needs (384px issue list → 1040px telemetry
             * table) instead of the layout changing shape.
             */}
            <AnimatePresence mode="wait">
              <motion.aside
                key={view}
                initial={{ x: -22, opacity: 0, scale: 0.99 }}
                animate={{ x: 0, opacity: 1, scale: 1 }}
                exit={{ x: -14, opacity: 0, scale: 0.995 }}
                transition={T.base}
                style={{ width: `min(${meta.w}px, calc(100vw - ${navCollapsed ? 68 : 236}px - 96px))` }}
                className="absolute inset-y-0 left-0 z-20 p-3"
              >
                <div className="border-line bg-canvas/90 flex h-full flex-col overflow-hidden rounded-2xl border shadow-[0_32px_80px_-16px_rgba(0,0,0,0.9)] backdrop-blur-2xl">
                  {view === "map" && (
                    <MapView
                      filteredIssues={filteredIssues}
                      onQuickAction={canAct ? handleQuickAction : undefined}
                      filterProps={filterProps}
                    />
                  )}

                  {view === "queue" && (
                    <QueueView issues={mapIssues} onQuickAction={handleQuickAction} />
                  )}

                  {view === "reports" && (
                    <ReportsView
                      reports={filteredReports}
                      totalReports={totalReports}
                      reportPage={reportPage}
                      onPageChange={(p) => refresh(p)}
                      filterProps={filterProps}
                    />
                  )}

                  {view === "analytics" && (
                    <AnalyticsView analytics={analytics} roadHealthSegments={roadHealthSegments} />
                  )}

                  {view === "fleet" && (
                    <FleetView
                      vehicles={vehicles}
                      loading={vehiclesLoading}
                      error={vehiclesError}
                      onSelect={setSelectedVehicle}
                      onUpload={handleImageUpload}
                      uploading={uploading}
                    />
                  )}

                  {view === "health" && (
                    <AdminView fixedTab="system" systemHealth={systemHealth} />
                  )}

                  {view === "users" && (
                    <AdminView
                      fixedTab="users"
                      adminUsers={adminUsers}
                      onRoleChange={handleUserRoleToggle}
                      onCreateUser={handleUserCreate}
                      onDeleteUser={handleUserDelete}
                      onResetPassword={handleUserPasswordReset}
                      currentUserId={user?.id}
                    />
                  )}

                  {view === "models" && <AdminView fixedTab="models" />}
                </div>
              </motion.aside>
            </AnimatePresence>

            {/* Canvas controls sit clear of the panel, on the map itself. */}
            <div className="absolute top-3 right-3 z-30 flex gap-2">
              <IconButton
                icon={Layers}
                label={showRoadHealth ? "Hide road-health choropleth" : "Show road-health choropleth"}
                onClick={() => setShowRoadHealth((v) => !v)}
                active={showRoadHealth}
                className="bg-surface/80 h-8 w-8 backdrop-blur-xl"
              />
            </div>
          </div>
        </div>

        <AnimatePresence>
          {selectedVehicle && (
            <VehicleHistoryDrawer
              vehicle={selectedVehicle}
              onClose={() => setSelectedVehicle(null)}
            />
          )}
        </AnimatePresence>

        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          commands={commands}
        />
        <Toast toast={toast} />
      </div>
    </MotionConfig>
  );
}
