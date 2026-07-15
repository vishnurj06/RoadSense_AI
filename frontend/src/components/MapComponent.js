"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Set default fallback icon in case SVGs fail
const DefaultIcon = L.icon({
  iconUrl: "/images/marker-icon.png",
  shadowUrl: "/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

// Helper to generate dynamic colored pin SVGs
const createMarkerIcon = (severity, detectionCount = 1) => {
  let color = "#22c55e"; // Green for low
  if (severity === "high") {
    color = "#ef4444"; // Red
  } else if (severity === "medium") {
    color = "#f97316"; // Orange
  }

  const badgeSvg =
    detectionCount > 1
      ? `
    <circle cx="18" cy="6" r="5.5" fill="#3b82f6" stroke="#0f172a" stroke-width="1"/>
    <text x="18" y="8" font-size="6.5" font-family="sans-serif" font-weight="bold" fill="white" text-anchor="middle">${detectionCount}</text>
  `
      : "";

  const svgTemplate = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="38" height="38">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="${color}"/>
      ${badgeSvg}
    </svg>
  `;

  return L.divIcon({
    html: svgTemplate,
    className: "custom-marker-icon",
    iconSize: [38, 38],
    iconAnchor: [19, 38],
    popupAnchor: [0, -38],
  });
};

const BACKEND_URL = "http://localhost:8000";

const statusTransitionMap = {
  detected: ["verified", "closed"],
  verified: ["assigned", "closed"],
  assigned: ["inspection", "repair", "verified"],
  inspection: ["repair", "assigned"],
  repair: ["completed"],
  completed: ["closed", "repair"],
  closed: ["detected"]
};

const getStatusStyle = (status) => {
  const statusLower = (status || "detected").toLowerCase();
  switch (statusLower) {
    case "detected":
      return "bg-slate-800 text-slate-300 border-slate-700";
    case "verified":
      return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
    case "assigned":
      return "bg-indigo-500/20 text-indigo-400 border-indigo-500/30";
    case "inspection":
      return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    case "repair":
      return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    case "completed":
      return "bg-teal-500/20 text-teal-400 border-teal-500/30";
    case "closed":
      return "bg-rose-500/20 text-rose-400 border-rose-500/30";
    default:
      return "bg-slate-800 text-slate-300 border-slate-700";
  }
};

function IssuePopupContent({ report, onRefresh }) {
  const router = useRouter();
  const currentStatus = report.status || "detected";
  const validNextStates = statusTransitionMap[currentStatus.toLowerCase()] || [];

  const [statusInput, setStatusInput] = useState(validNextStates[0] || "");
  const [notesInput, setNotesInput] = useState("");
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState("");

  const handleStatusSubmit = async () => {
    const targetStatus = statusInput || validNextStates[0];
    if (!targetStatus) {
      setUpdateError("No valid next status available.");
      return;
    }

    try {
      setUpdating(true);
      setUpdateError("");
      const res = await fetch(`${BACKEND_URL}/repair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issue_id: report.id,
          status: targetStatus,
          notes: notesInput,
        }),
        credentials: "include",
      });

      if (res.status === 401) {
        localStorage.removeItem("user");
        router.push("/login");
        return;
      }

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || "Failed to update status.");
      }

      // Success: clear notes
      setNotesInput("");

      if (onRefresh) {
        await onRefresh();
      }
    } catch (err) {
      console.error(err);
      setUpdateError(err.message || "Failed to update status.");
    } finally {
      setUpdating(false);
    }
  };

  // Find maximum severity among detections
  const severities = report.detections?.map((d) => d.severity.toLowerCase()) || [];
  let maxSeverity = "low";
  if (severities.includes("high")) maxSeverity = "high";
  else if (severities.includes("medium")) maxSeverity = "medium";

  // Fallback image url
  const imageUrl = report.image_url
    ? report.image_url.startsWith("http")
      ? report.image_url
      : `${BACKEND_URL}${report.image_url}`
    : null;

  return (
    <div className="flex flex-col w-64 p-1 font-sans text-slate-100">
      {imageUrl ? (
        <div className="w-full h-32 rounded-lg overflow-hidden mb-2 bg-slate-900 border border-slate-700 relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt="Detection Thumbnail"
            className="w-full h-full object-cover"
            onError={(e) => {
              e.target.onerror = null;
              e.target.src =
                "https://images.unsplash.com/photo-1515162305285-0293e4767cc2?q=80&w=400";
            }}
          />
        </div>
      ) : (
        <div className="w-full h-32 rounded-lg bg-slate-900 border border-slate-700 flex items-center justify-center mb-2 text-slate-500 text-xs">
          No Image Available
        </div>
      )}

      <div className="flex items-center justify-between mb-1.5">
        <span
          className={`text-xs font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider ${
            maxSeverity === "high"
              ? "bg-red-500/20 text-red-400 border border-red-500/30"
              : maxSeverity === "medium"
              ? "bg-orange-500/20 text-orange-400 border border-orange-500/30"
              : "bg-green-500/20 text-green-400 border border-green-500/30"
          }`}
        >
          {maxSeverity} severity
        </span>
        <span className="text-[10px] text-slate-400">
          {new Date(report.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>

      <div className="text-xs text-slate-300 font-medium mb-1 truncate">
        Vehicle: <span className="text-slate-100 font-semibold">{report.vehicle_id}</span>
      </div>

      {report.speed_kmph !== undefined && report.speed_kmph !== null && (
        <div className="text-xs text-slate-300 font-medium mb-1 truncate">
          Speed: <span className="text-slate-100 font-semibold">{report.speed_kmph} km/h</span>
        </div>
      )}

      {report.model_version && (
        <div className="text-xs text-slate-300 font-medium mb-1 truncate">
          Model: <span className="text-slate-100 font-semibold">{report.model_version}</span>
        </div>
      )}

      <div className="border-t border-slate-800 my-1.5 pt-1.5">
        <div className="text-[11px] font-bold text-slate-400 mb-1">Detections:</div>
        <div className="space-y-1 max-h-24 overflow-y-auto pr-1">
          {report.detections?.map((d) => (
            <div
              key={d.id}
              className="flex justify-between items-center text-xs bg-slate-900/50 p-1.5 rounded border border-slate-800"
            >
              <span className="capitalize text-slate-200 font-medium">{d.class}</span>
              <span className="text-slate-400 font-semibold">
                {(d.confidence * 100).toFixed(0)}% conf
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Status workflow updater */}
      <div className="border-t border-slate-800 my-2 pt-2 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-slate-400">Status Workflow:</span>
          <span
            className={`text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full border ${getStatusStyle(
              currentStatus
            )}`}
          >
            {currentStatus}
          </span>
        </div>

        {validNextStates.length > 0 ? (
          <div className="flex flex-col gap-1.5 mt-0.5">
            <select
              value={statusInput}
              onChange={(e) => setStatusInput(e.target.value)}
              className="bg-slate-900 border border-slate-700/60 rounded-lg text-[11px] p-1.5 text-slate-100 focus:outline-none focus:border-blue-500 select-none"
            >
              {validNextStates.map((state) => (
                <option key={state} value={state} className="capitalize">
                  {state}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Audit comment..."
              value={notesInput}
              onChange={(e) => setNotesInput(e.target.value)}
              className="bg-slate-900 border border-slate-700/60 rounded-lg text-[11px] p-1.5 text-slate-100 focus:outline-none focus:border-blue-500"
            />
            {updateError && (
              <span className="text-[10px] text-red-400 font-medium">{updateError}</span>
            )}
            <button
              onClick={handleStatusSubmit}
              disabled={updating}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold text-[11px] py-1.5 px-3 rounded-lg mt-0.5 cursor-pointer select-none transition duration-150"
            >
              {updating ? "Updating..." : "Update Status"}
            </button>
          </div>
        ) : (
          <span className="text-[10px] text-slate-500 italic mt-0.5">Workflow completed</span>
        )}
      </div>

      <div className="text-[9px] text-slate-500 mt-2 text-right italic">
        ID: {report.id.substring(0, 8)}...
      </div>
    </div>
  );
}

export default function MapComponent({ reports, onRefresh }) {
  // Mumbai default center
  const defaultCenter = [19.076, 72.8777];

  return (
    <div className="w-full h-full rounded-2xl overflow-hidden shadow-2xl border border-slate-800 relative z-10">
      <MapContainer
        center={defaultCenter}
        zoom={13}
        scrollWheelZoom={true}
        className="w-full h-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {reports.map((report) => {
          // Find maximum severity among detections
          const severities = report.detections?.map((d) => d.severity.toLowerCase()) || [];
          let maxSeverity = "low";
          if (severities.includes("high")) maxSeverity = "high";
          else if (severities.includes("medium")) maxSeverity = "medium";

          return (
            <Marker
              key={report.id}
              position={[report.latitude, report.longitude]}
              icon={createMarkerIcon(maxSeverity, report.detection_count)}
            >
              <Popup className="roadsense-popup">
                <IssuePopupContent report={report} onRefresh={onRefresh} />
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
