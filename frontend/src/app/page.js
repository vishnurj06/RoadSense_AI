"use client";

import React, { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import {
  Activity,
  AlertTriangle,
  MapPin,
  Upload,
  RefreshCw,
  Sliders,
  Calendar,
  Car,
  CheckCircle,
  FileSpreadsheet
} from "lucide-react";

// Dynamically load MapComponent with SSR disabled
const MapComponent = dynamic(
  () => import("@/components/MapComponent"),
  { 
    ssr: false,
    loading: () => (
      <div className="w-full h-full rounded-2xl bg-slate-900 border border-slate-800 flex flex-col items-center justify-center text-slate-400 gap-3">
        <RefreshCw className="animate-spin h-8 w-8 text-blue-500" />
        <p className="text-sm font-medium">Loading Interactive Map...</p>
      </div>
    )
  }
);

const BACKEND_URL = "http://localhost:8000";

export default function Dashboard() {
  const [reports, setReports] = useState([]);
  const [analytics, setAnalytics] = useState({
    total_reports: 0,
    total_detections: 0,
    severity_distribution: { high: 0, medium: 0, low: 0 },
    class_distribution: {}
  });
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  // Filters State
  const [severityFilter, setSeverityFilter] = useState({
    high: true,
    medium: true,
    low: true
  });
  const [classFilter, setClassFilter] = useState("all");

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [reportsRes, analyticsRes] = await Promise.all([
        fetch(`${BACKEND_URL}/reports`),
        fetch(`${BACKEND_URL}/analytics`)
      ]);

      if (!reportsRes.ok || !analyticsRes.ok) {
        throw new Error("Failed to fetch dashboard data from backend server.");
      }

      const reportsData = await reportsRes.json();
      const analyticsData = await analyticsRes.json();

      setReports(reportsData);
      setAnalytics(analyticsData);
    } catch (err) {
      console.error(err);
      setError("Backend connection offline. Make sure the FastAPI server is running on http://localhost:8000.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Filter reports according to severity filter and class filter
  const filteredReports = reports.filter((report) => {
    // 1. Get max severity
    const severities = report.detections?.map((d) => d.severity.toLowerCase()) || [];
    let maxSeverity = "low";
    if (severities.includes("high")) maxSeverity = "high";
    else if (severities.includes("medium")) maxSeverity = "medium";

    // Check severity toggle
    if (!severityFilter[maxSeverity]) return false;

    // 2. Check class filter
    if (classFilter !== "all") {
      const classes = report.detections?.map((d) => d.class.toLowerCase()) || [];
      if (!classes.includes(classFilter)) return false;
    }

    return true;
  });

  // Handle mock image upload & detection workflow
  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);
      setError(null);

      // 1. POST file to /upload
      const formData = new FormData();
      formData.append("file", file);

      const uploadRes = await fetch(`${BACKEND_URL}/upload`, {
        method: "POST",
        body: formData
      });

      if (!uploadRes.ok) throw new Error("Image upload failed.");
      const { image_url } = await uploadRes.json();

      // 2. Generate random coordinate around Mumbai
      // Mumbai center: Lat 19.0760, Lon 72.8777
      const randomJitterLat = (Math.random() - 0.5) * 0.08;
      const randomJitterLon = (Math.random() - 0.5) * 0.08;
      const mockLat = 19.0760 + randomJitterLat;
      const mockLon = 72.8777 + randomJitterLon;

      // 3. Post a mock detection matching JSON contract
      const detectionPayload = {
        report_id: `user-upload-${Date.now()}`,
        vehicle_id: "demo-web-upload",
        timestamp: new Date().toISOString(),
        gps: {
          lat: mockLat,
          lon: mockLon
        },
        detections: [
          {
            class: "pothole",
            confidence: 0.94,
            bbox: [120, 220, 310, 420],
            severity: "high"
          }
        ],
        image_url: image_url
      };

      const detectRes = await fetch(`${BACKEND_URL}/detect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(detectionPayload)
      });

      if (!detectRes.ok) throw new Error("Failed to insert detection payload.");

      // Refresh data
      await fetchData();
    } catch (err) {
      console.error(err);
      setError("Failed to process local upload. Check connection or file.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* Navbar */}
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
              Road Condition Dashboard (PoC)
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
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 text-xs font-semibold bg-slate-800 hover:bg-slate-700 active:bg-slate-900 border border-slate-700/60 rounded-xl transition duration-150 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-blue-500" : ""}`} />
            Refresh
          </button>
        </div>
      </header>

      {/* Main Body Layout */}
      <div className="flex flex-1 overflow-hidden p-6 gap-6">
        
        {/* Left Side: Sidebar Controls, Stats, Upload, Lists */}
        <div className="w-[32rem] flex flex-col gap-5 shrink-0 overflow-y-auto custom-scrollbar pr-1">
          
          {/* Stats Section */}
          <section className="grid grid-cols-3 gap-3 shrink-0">
            <div className="bg-slate-900/50 border border-slate-800/80 p-3 rounded-2xl flex flex-col justify-between">
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Reports</span>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-2xl font-black text-white">{analytics.total_reports}</span>
                <MapPin className="h-3.5 w-3.5 text-blue-400" />
              </div>
            </div>
            <div className="bg-slate-900/50 border border-slate-800/80 p-3 rounded-2xl flex flex-col justify-between">
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Detections</span>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-2xl font-black text-white">{analytics.total_detections}</span>
                <Car className="h-3.5 w-3.5 text-indigo-400" />
              </div>
            </div>
            <div className="bg-slate-900/50 border border-slate-800/80 p-3 rounded-2xl flex flex-col justify-between">
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500">High Risk</span>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-2xl font-black text-red-500">{analytics.severity_distribution.high}</span>
                <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
              </div>
            </div>
          </section>

          {/* Filters & Control Panel */}
          <section className="bg-slate-900/40 border border-slate-800/60 p-4 rounded-2xl flex flex-col gap-3 shrink-0">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-400">
              <Sliders className="h-4 w-4" />
              <span>DASHBOARD FILTERS</span>
            </div>

            {/* Severity Filter */}
            <div className="flex flex-col gap-1.5 mt-1">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Severity Toggles:</span>
              <div className="flex gap-2">
                {Object.keys(severityFilter).map((sev) => (
                  <button
                    key={sev}
                    onClick={() => setSeverityFilter(prev => ({ ...prev, [sev]: !prev[sev] }))}
                    className={`flex-1 py-1.5 px-3 text-xs font-semibold rounded-xl border transition cursor-pointer capitalize ${
                      severityFilter[sev]
                        ? sev === "high"
                          ? "bg-red-500/10 text-red-400 border-red-500/40"
                          : sev === "medium"
                          ? "bg-orange-500/10 text-orange-400 border-orange-500/40"
                          : "bg-green-500/10 text-green-400 border-green-500/40"
                        : "bg-slate-950/20 text-slate-500 border-slate-800 hover:border-slate-700"
                    }`}
                  >
                    {sev}
                  </button>
                ))}
              </div>
            </div>

            {/* Class Filter */}
            <div className="flex flex-col gap-1.5 mt-1">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Hazard Type:</span>
              <div className="flex gap-2">
                {["all", "pothole", "crack"].map((cls) => (
                  <button
                    key={cls}
                    onClick={() => setClassFilter(cls)}
                    className={`flex-1 py-1.5 px-3 text-xs font-semibold rounded-xl border transition cursor-pointer capitalize ${
                      classFilter === cls
                        ? "bg-blue-600/20 text-blue-400 border-blue-500/40"
                        : "bg-slate-950/20 text-slate-500 border-slate-800 hover:border-slate-700"
                    }`}
                  >
                    {cls === "all" ? "All Hazards" : cls + "s"}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Quick Demo Image Upload Widget */}
          <section className="bg-slate-900/40 border border-slate-800/60 p-4 rounded-2xl flex flex-col gap-3 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-400">
                <Upload className="h-4 w-4" />
                <span>DEMO TELEMETRY UPLOAD</span>
              </div>
              {uploading && (
                <span className="text-[10px] text-blue-400 animate-pulse font-bold">Uploading...</span>
              )}
            </div>

            <label className={`w-full h-24 rounded-2xl border border-dashed border-slate-800 bg-slate-950/30 flex flex-col items-center justify-center cursor-pointer transition duration-150 relative ${uploading ? "opacity-50 pointer-events-none" : "hover:border-blue-500/50 hover:bg-slate-900/30"}`}>
              <input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
                disabled={uploading}
              />
              <Upload className="h-5 w-5 text-slate-500 mb-1.5" />
              <span className="text-xs text-slate-400 font-semibold text-center">Click to upload road image</span>
              <span className="text-[9px] text-slate-600 text-center mt-0.5">Mock GPS tags Mumbai area on map</span>
            </label>
          </section>

          {/* Table List View of Reports */}
          <section className="flex-1 bg-slate-900/40 border border-slate-800/60 p-4 rounded-2xl flex flex-col overflow-hidden min-h-[16rem]">
            <div className="flex items-center justify-between mb-3 shrink-0">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-400">
                <FileSpreadsheet className="h-4 w-4" />
                <span>REPORT LOGS ({filteredReports.length})</span>
              </div>
            </div>

            {/* List container */}
            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1">
              {filteredReports.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-600 text-xs py-8">
                  <CheckCircle className="h-8 w-8 mb-2 opacity-30 text-green-500" />
                  No reports matching current filters.
                </div>
              ) : (
                filteredReports.map((report) => {
                  const severities = report.detections?.map((d) => d.severity.toLowerCase()) || [];
                  let maxSeverity = "low";
                  if (severities.includes("high")) maxSeverity = "high";
                  else if (severities.includes("medium")) maxSeverity = "medium";

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
                            className={`text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded-full shrink-0 border ${
                              maxSeverity === "high"
                                ? "bg-red-500/10 text-red-400 border-red-500/20"
                                : maxSeverity === "medium"
                                ? "bg-orange-500/10 text-orange-400 border-orange-500/20"
                                : "bg-green-500/10 text-green-400 border-green-500/20"
                            }`}
                          >
                            {maxSeverity}
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
                          Lat: {report.latitude.toFixed(4)}, Lon: {report.longitude.toFixed(4)}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

        </div>

        {/* Right Side: Map Container */}
        <div className="flex-1 h-full min-w-0 relative">
          <MapComponent reports={filteredReports} />
        </div>

      </div>
    </div>
  );
}
