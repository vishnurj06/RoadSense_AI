"use client";

/**
 * page.js — Dashboard orchestrator (Person B · RoadSense AI · Phase 3)
 *
 * Responsibility: auth guard, data fetching, shared state.
 * All rendering is delegated to role-specific dashboard components.
 * This file must stay under ~150 lines. If it grows, extract more.
 */

import React, { useState, useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Activity, AlertTriangle, RefreshCw } from "lucide-react";

import StatCards from "@/components/shared/StatCards";
import Toast from "@/components/shared/Toast";
import AuthorityDashboard from "@/components/dashboards/AuthorityDashboard";
import FleetDashboard from "@/components/dashboards/FleetDashboard";
import AdminDashboard from "@/components/dashboards/AdminDashboard";
import { getMaxSeverity } from "@/lib/classUtils";
import { isRealGps } from "@/lib/gpsUtils";
import { mapFeaturesToIssues } from "@/lib/mapUtils";

// Leaflet map — SSR disabled (window is not defined on server)
const MapComponent = dynamic(() => import("@/components/MapComponent"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full rounded-2xl bg-slate-900 border border-slate-800 flex flex-col items-center justify-center text-slate-400 gap-3">
      <RefreshCw className="animate-spin h-8 w-8 text-blue-500" />
      <p className="text-sm font-medium">Loading Interactive Map...</p>
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
 *
 * Previously this was `useState(false)` + `useEffect(() => setMounted(true))`,
 * which sets state synchronously inside an effect and causes the cascading
 * re-render that react-hooks/set-state-in-effect exists to prevent.
 */
const subscribeToNothing = () => () => {};
const useIsHydrated = () =>
  useSyncExternalStore(
    subscribeToNothing,
    () => true,  // client snapshot — after hydration
    () => false, // server snapshot — during SSR and hydration
  );

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

  // Admin-only extras
  const [adminUsers, setAdminUsers] = useState([]);
  const [systemHealth, setSystemHealth] = useState(null);

  // UI state
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

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
  // renders (react-hooks/set-state-in-effect). `loading` starts true for the
  // initial load. User-initiated refreshes go through refresh() below to get the
  // spinner immediately; setState is unrestricted inside an event handler.
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
      setError("Backend offline. Ensure the FastAPI server is running on http://localhost:8000.");
    } finally {
      setLoading(false);
    }
  };

  /**
   * User-initiated refresh: raise the spinner immediately, then refetch. Safe to
   * setState here because this only ever runs from an event handler, never from
   * an effect.
   */
  const refresh = (targetPage = null) => {
    setLoading(true);
    setError(null);
    return fetchData(null, targetPage);
  };

  useEffect(() => {
    if (!user) { router.push("/login"); return; }
    // Async work, not a synchronous call: fetchData is await-first, so nothing
    // is written to state during the effect itself.
    (async () => { await fetchData(user); })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleLogout = async () => {
    try { await fetch(`${BACKEND_URL}/auth/logout`, { method: "POST", credentials: "include" }); }
    catch (e) { console.error("Logout failed:", e); }
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
      if (res.ok) { showToast(`Issue updated → ${nextStatus}`, "success"); refresh(); }
      else { const e = await res.json(); showToast(e.detail || "Failed to update", "error"); }
    } catch { showToast("Connection error", "error"); }
  };

  const handleUserRoleToggle = async (userId, newRole) => {
    try {
      const res = await fetch(`${BACKEND_URL}/admin/users/role`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, role: newRole }),
        credentials: "include",
      });
      if (res.ok) { showToast(`Role updated → ${newRole}`, "success"); refresh(); }
      else { const e = await res.json(); showToast(e.detail || "Failed to update role", "error"); }
    } catch { showToast("Connection error", "error"); }
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
        method: "POST", body: formData, credentials: "include",
      });
      if (res.status === 401) { localStorage.removeItem("user"); router.push("/login"); return; }
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.detail || "Image analysis failed."); }
      const data = await res.json();
      await refresh();
      showToast(
        data.detections?.length > 0
          ? `Analyzed: Found ${data.detections.length} hazard(s)!`
          : "Analyzed: No hazards detected.",
        "success"
      );
    } catch (err) {
      showToast(err.message, "error");
      setError(err.message);
    } finally { setUploading(false); }
  };

  // ── Derived data ─────────────────────────────────────────────────────────────

  const filteredReports = applyFilters(reports, severityFilter, classFilter, statusFilter, realGpsOnly);
  const filteredIssues  = applyFilters(mapIssues, severityFilter, classFilter, statusFilter, realGpsOnly);

  const filterProps = {
    severityFilter, setSeverityFilter,
    classFilter, setClassFilter,
    statusFilter, setStatusFilter,
    realGpsOnly, setRealGpsOnly,
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* ── Navbar ── */}
      <header className="flex items-center justify-between px-6 py-4 bg-slate-900/60 backdrop-blur-md border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-tr from-blue-600 to-indigo-500 p-2.5 rounded-xl shadow-lg shadow-blue-500/20">
            <Activity className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
              RoadSense AI
            </h1>
            <p className="text-[10px] font-semibold text-blue-400 uppercase tracking-widest">
              Road Condition Dashboard
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {error && (
            <div className="hidden md:flex items-center gap-2 bg-red-950/40 border border-red-500/30 text-red-400 text-xs px-3 py-1.5 rounded-lg">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {mounted && user && (
            <div className="flex items-center gap-3 bg-slate-900 border border-slate-800/80 px-3 py-1.5 rounded-xl">
              <div className="flex flex-col text-right">
                <span className="text-[10px] font-bold text-slate-200">{user.username}</span>
                <span className="text-[8px] uppercase tracking-wider font-semibold text-slate-500">{user.role}</span>
              </div>
              <div className="h-4 w-px bg-slate-800/60" />
              <button
                onClick={handleLogout}
                className="text-[10px] font-extrabold text-red-400 hover:text-red-300 transition duration-150 cursor-pointer"
              >
                Log Out
              </button>
            </div>
          )}
          <button
            onClick={() => refresh()}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 text-xs font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700/60 rounded-xl transition cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-blue-500" : ""}`} />
            Refresh
          </button>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden p-6 gap-6">
        {/* Sidebar */}
        <div className="w-[32rem] flex flex-col gap-5 shrink-0 overflow-y-auto custom-scrollbar pr-1">
          <StatCards analytics={analytics} />

          {mounted && user?.role === "authority" && (
            <AuthorityDashboard
              analytics={analytics}
              mapIssues={mapIssues}
              onQuickAction={handleQuickAction}
              roadHealthSegments={roadHealthSegments}
              showRoadHealth={showRoadHealth}
              setShowRoadHealth={setShowRoadHealth}
              {...filterProps}
            />
          )}

          {mounted && user?.role === "fleet" && (
            <FleetDashboard
              reports={reports}
              filteredReports={filteredReports}
              totalReports={totalReports}
              reportPage={reportPage}
              onPageChange={(p) => refresh(p)}
              onUpload={handleImageUpload}
              uploading={uploading}
              {...filterProps}
            />
          )}

          {mounted && user?.role === "admin" && (
            <AdminDashboard
              adminUsers={adminUsers}
              systemHealth={systemHealth}
              onRoleChange={handleUserRoleToggle}
              onUpload={handleImageUpload}
              uploading={uploading}
            />
          )}
        </div>

        {/* Map */}
        <div className="flex-1 h-full min-w-0 relative">
          <MapComponent
            reports={filteredIssues}
            onRefresh={() => refresh()}
            roadHealthSegments={roadHealthSegments}
            showRoadHealth={showRoadHealth}
          />
        </div>
      </div>

      <Toast toast={toast} />
    </div>
  );
}
