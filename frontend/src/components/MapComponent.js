"use client";

import React from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Set default fallback icon in case SVGs fail
const DefaultIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png",
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

export default function MapComponent({ reports }) {
  // Mumbai default center
  const defaultCenter = [19.0760, 72.8777];

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

          // Fallback image url
          const imageUrl = report.image_url
            ? report.image_url.startsWith("http")
              ? report.image_url
              : `${BACKEND_URL}${report.image_url}`
            : null;

          return (
            <Marker
              key={report.id}
              position={[report.latitude, report.longitude]}
              icon={createMarkerIcon(maxSeverity, report.detection_count)}
            >
              <Popup className="roadsense-popup">
                <div className="flex flex-col w-64 p-1 font-sans text-slate-100">
                  {imageUrl ? (
                    <div className="w-full h-32 rounded-lg overflow-hidden mb-2 bg-slate-900 border border-slate-700 relative">
                      <img
                        src={imageUrl}
                        alt="Detection Thumbnail"
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          e.target.onerror = null;
                          e.target.src = "https://images.unsplash.com/photo-1515162305285-0293e4767cc2?q=80&w=400";
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
                        <div key={d.id} className="flex justify-between items-center text-xs bg-slate-900/50 p-1.5 rounded border border-slate-800">
                          <span className="capitalize text-slate-200 font-medium">{d.class}</span>
                          <span className="text-slate-400 font-semibold">{(d.confidence * 100).toFixed(0)}% conf</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="text-[9px] text-slate-500 mt-2 text-right italic">
                    ID: {report.id.substring(0, 8)}...
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
