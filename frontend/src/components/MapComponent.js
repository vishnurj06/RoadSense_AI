"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { MapContainer, TileLayer, Marker, Popup, Polygon, ZoomControl } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { RotateCcw } from "lucide-react";
import {
  getClassLabel,
  getClassBadgeStyle,
  getMaxSeverity,
  getStatusBadgeStyle,
  STATUS_ORDER,
} from "@/lib/classUtils";
import { getGpsProvenance, getGpsSourceLabel } from "@/lib/gpsUtils";
import { SEVERITY_COLOR, SURFACE, STATUS, healthColor, healthLabel } from "@/lib/theme";

// Default fallback icon, in case a divIcon ever fails to render.
const DefaultIcon = L.icon({
  iconUrl: "/images/marker-icon.png",
  shadowUrl: "/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

/**
 * Marker pin.
 *
 * Severity drives the fill from the RESERVED status palette — the same three
 * colours the badges use, so a red pin and a red chip mean the same thing.
 *
 * A high-severity pin gets a slow pulse ring. That is the only looping motion
 * on the map, and it is information: it marks the things that need someone.
 *
 * Faked GPS (B3-6) is marked structurally, not just chromatically — dashed
 * amber ring + a ⚠ glyph + reduced opacity — so provenance survives being
 * printed, screenshotted, or read by someone with CVD.
 */
const createMarkerIcon = (
  severity,
  detectionCount = 1,
  gpsSource = null,
  isVerified = false,
) => {
  const color = SEVERITY_COLOR[severity] || SEVERITY_COLOR.low;
  const isFaked = gpsSource === "faked";
  const isHigh = severity === "high";
  const opacity = isFaked ? 0.6 : 1;

  const pulse = isHigh
    ? `<circle cx="14" cy="13" r="7" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.9">
         <animate attributeName="r" from="7" to="15" dur="2.4s" repeatCount="indefinite"/>
         <animate attributeName="opacity" from="0.55" to="0" dur="2.4s" repeatCount="indefinite"/>
       </circle>`
    : "";

  const fakedRing = isFaked
    ? `<circle cx="14" cy="13" r="10" fill="none" stroke="#fab219" stroke-width="2" stroke-dasharray="3,2.2"/>`
    : "";

  const fakedGlyph = isFaked
    ? `<text x="14" y="16.5" font-size="8" font-family="sans-serif" font-weight="900" fill="#fab219" text-anchor="middle">&#x26A0;</text>`
    : "";

  const badge =
    detectionCount > 1
      ? `<circle cx="23" cy="6" r="5.5" fill="${SURFACE.surface}" stroke="${color}" stroke-width="1.5"/>
         <text x="23" y="8.4" font-size="7" font-family="ui-monospace, monospace" font-weight="700" fill="#EEF2F7" text-anchor="middle">${
           detectionCount > 9 ? "9+" : detectionCount
         }</text>`
      : "";

  // #9: verified pins (≥2 distinct vehicles) get a green ✓ badge at top-left —
  // its own corner, so it never collides with the count badge or the faked ring.
  const verifiedBadge = isVerified
    ? `<circle cx="5" cy="6" r="5" fill="${SURFACE.surface}" stroke="${STATUS.good}" stroke-width="1.5"/>
       <text x="5" y="8.6" font-size="7" font-family="sans-serif" font-weight="900" fill="${STATUS.good}" text-anchor="middle">&#x2713;</text>`
    : "";

  // Teardrop pin, 28×38. The inner dot is punched out via fill-rule so the
  // map reads through it — a solid blob hides the road underneath.
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 38" width="28" height="38" style="overflow:visible;opacity:${opacity}">
      ${pulse}
      <path d="M14 2.5c-5.25 0-9.5 4.25-9.5 9.5 0 7.13 9.5 20 9.5 20s9.5-12.87 9.5-20c0-5.25-4.25-9.5-9.5-9.5zm0 13.2a3.7 3.7 0 1 1 0-7.4 3.7 3.7 0 0 1 0 7.4z"
            fill="${color}" fill-rule="evenodd" stroke="${SURFACE.canvas}" stroke-width="1.2"/>
      ${fakedRing}
      ${fakedGlyph}
      ${badge}
      ${verifiedBadge}
    </svg>`;

  return L.divIcon({
    html: svg,
    className: "rs-marker",
    iconSize: [28, 38],
    iconAnchor: [14, 38],
    popupAnchor: [0, -38],
  });
};

const BACKEND_URL = "http://localhost:8000";

const statusTransitionMap = {
  detected: ["approved", "closed"],
  approved: ["assigned", "closed"],
  assigned: ["inspection", "repair", "approved"],
  inspection: ["repair", "assigned"],
  repair: ["completed"],
  completed: ["closed", "repair"],
  closed: ["detected"],
};

/** A row of pips showing where in the lifecycle this issue is. */
function StatusTrack({ status }) {
  const idx = STATUS_ORDER.indexOf((status || "detected").toLowerCase());
  return (
    <div className="flex items-center gap-[3px]" title={`Step ${idx + 1} of ${STATUS_ORDER.length}`}>
      {STATUS_ORDER.map((s, i) => (
        <span
          key={s}
          className={`h-[3px] flex-1 rounded-full ${i <= idx ? "bg-accent" : "bg-line"}`}
        />
      ))}
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-ink-3 shrink-0 text-[10px]">{label}</span>
      <span className="text-ink-2 truncate text-right text-[10px] font-medium">{children}</span>
    </div>
  );
}

// Terminal lifecycle state — no controls, just a resolved note. "closed" allows
// closed→detected on the backend (reopen), but that is a deliberate action, not
// a stray dropdown option; the UI treats closed as the end of the line.
const TERMINAL_STATUSES = new Set(["closed"]);

function IssuePopupContent({ report, onRefresh, canRepair = true }) {
  const router = useRouter();
  const currentStatus = report.status || "detected";
  const validNextStates = statusTransitionMap[currentStatus.toLowerCase()] || [];
  const isTerminal = TERMINAL_STATUSES.has(currentStatus.toLowerCase());

  const [statusInput, setStatusInput] = useState(validNextStates[0] || "");
  const [notesInput, setNotesInput] = useState("");
  const [assigneeInput, setAssigneeInput] = useState(report.assigned_to || "");
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState("");

  // Reconcile the selection against the CURRENT valid transitions every render.
  // The popup stays open across an update, so statusInput can hold a value that
  // is no longer valid for the new status — the <select> would then DISPLAY its
  // first option while SUBMITTING the stale one, producing "X -> X" 400s. A
  // derived value that always falls back to a real option kills that class of
  // bug without a resync effect.
  const targetStatus = validNextStates.includes(statusInput)
    ? statusInput
    : validNextStates[0] || "";

  // `overrideStatus` lets the Reopen action reuse this exact fetch/401/error
  // path with a fixed target (closed → detected) instead of the dropdown value.
  const handleStatusSubmit = async (overrideStatus) => {
    const submitStatus =
      typeof overrideStatus === "string" ? overrideStatus : targetStatus;
    if (!submitStatus) {
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
          status: submitStatus,
          notes: notesInput,
          // Only meaningful for the 'assigned' transition; backend ignores it
          // otherwise. Lets an authority name the crew as they dispatch.
          assignee: submitStatus === "assigned" ? assigneeInput : undefined,
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

      setNotesInput("");
      if (onRefresh) await onRefresh();
    } catch (err) {
      console.error(err);
      setUpdateError(err.message || "Failed to update status.");
    } finally {
      setUpdating(false);
    }
  };

  const maxSeverity = getMaxSeverity(report.detections);
  const sevColor = SEVERITY_COLOR[maxSeverity];
  const provenance = getGpsProvenance(report.gps_source);

  const imageUrl = report.image_url
    ? report.image_url.startsWith("http")
      ? report.image_url
      : `${BACKEND_URL}${report.image_url}`
    : null;

  return (
    <div className="font-sans text-ink flex w-[248px] flex-col gap-2.5">
      {/* Thumbnail */}
      <div className="bg-sunken border-line relative h-28 w-full overflow-hidden rounded-lg border">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt="Detection thumbnail"
            className="h-full w-full object-cover"
            onError={(e) => {
              e.target.onerror = null;
              e.target.style.display = "none";
            }}
          />
        ) : (
          <div className="text-ink-3 flex h-full items-center justify-center text-[10px]">
            No image
          </div>
        )}
        {/* Severity is the headline: it sits on the image, with its label. */}
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/85 to-transparent px-2 pt-5 pb-1.5">
          <span
            className="text-[10px] font-bold tracking-wide uppercase"
            style={{ color: sevColor }}
          >
            {maxSeverity} severity
          </span>
          <span className="text-ink-2 tnum font-mono text-[9px]">
            {new Date(report.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
      </div>

      {/* GPS provenance — B3-6.
          Fails closed: only an explicitly-known real source renders as verified.
          `faked` and `unknown` are visibly distinct from each other AND from
          verified, so a missing field can never masquerade as a real fix. */}
      {provenance === "faked" ? (
        <div className="bg-warning/12 border-warning/35 flex items-start gap-1.5 rounded-lg border px-2 py-1.5">
          <span className="text-warning text-[10px] leading-none" aria-hidden="true">
            ⚠
          </span>
          <span className="text-warning text-[9px] leading-tight font-semibold">
            UNVERIFIED GPS — location is approximate
          </span>
        </div>
      ) : provenance === "real" ? (
        <div className="text-good flex items-center gap-1.5 text-[9px] font-semibold">
          <span aria-hidden="true">✓</span>
          {getGpsSourceLabel(report.gps_source)} VERIFIED
        </div>
      ) : (
        <div className="text-ink-3 flex items-center gap-1.5 text-[9px] font-semibold">
          <span aria-hidden="true">?</span>
          GPS PROVENANCE UNKNOWN
        </div>
      )}

      {/* Corroboration — #1/#9. An issue is "verified" only once >=2 DISTINCT
          vehicles have reported it; a single source stays "unverified". This is
          orthogonal to GPS provenance above (that's location trust; this is
          sighting trust). */}
      {report.is_verified ? (
        <div className="text-good flex items-center gap-1.5 text-[9px] font-semibold">
          <span aria-hidden="true">✓</span>
          VERIFIED — corroborated by ≥2 vehicles
        </div>
      ) : (
        <div className="text-ink-3 flex items-center gap-1.5 text-[9px] font-semibold">
          <span aria-hidden="true">⏳</span>
          UNVERIFIED — awaiting a second vehicle
        </div>
      )}

      {/* Facts */}
      <div className="flex flex-col gap-1">
        <Row label="Vehicle">
          <span className="font-mono">{report.vehicle_id}</span>
        </Row>
        {report.speed_kmph != null && (
          <Row label="Speed">
            <span className="font-mono tnum">{report.speed_kmph} km/h</span>
          </Row>
        )}
        {report.road_name && <Row label="Location">{report.road_name}</Row>}
        {report.assigned_to && <Row label="Assigned to">{report.assigned_to}</Row>}
        {report.model_version && (
          <Row label="Model">
            <span className="font-mono text-[9px]">{report.model_version}</span>
          </Row>
        )}
      </div>

      {/* Detections — class chips are neutral; confidence is the number. */}
      <div className="border-line border-t pt-2">
        <div className="custom-scrollbar flex max-h-20 flex-col gap-1 overflow-y-auto">
          {report.detections?.map((d, i) => (
            <div key={d.id ?? i} className="flex items-center justify-between gap-2">
              <span
                className={`rounded border px-1.5 py-0.5 text-[9px] font-medium ${getClassBadgeStyle(d.class)}`}
              >
                {getClassLabel(d.class)}
              </span>
              <span className="text-ink-3 tnum font-mono text-[9px]">
                {(d.confidence * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Workflow */}
      <div className="border-line flex flex-col gap-2 border-t pt-2">
        <div className="flex items-center justify-between gap-2">
          <span className="eyebrow">Workflow</span>
          <span
            className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold capitalize ${getStatusBadgeStyle(currentStatus)}`}
          >
            {currentStatus}
          </span>
        </div>
        {/* Lifecycle order shown structurally — it is ordinal state, not
            good/bad, so it has no claim on the status palette. */}
        <StatusTrack status={currentStatus} />

        {!canRepair ? (
          // Admin (operator) views the workflow read-only — changing a repair
          // status is the authority's action, so the audit log stays honest.
          <span className="text-ink-3 text-[10px] italic">
            View only — repair status is managed by the authority.
          </span>
        ) : isTerminal ? (
          // Closed is the end of the line — no forward dropdown. Reopen is the
          // one exception: a deliberate, confirmed action (backend closed →
          // detected), styled as a muted secondary control so "closed" still
          // reads as done. Only authorities reach this branch — admin (view
          // only) is handled by the !canRepair case above.
          <div className="flex flex-col gap-1.5">
            <span className="text-ink-3 text-[10px] italic">
              Workflow closed — this issue is resolved.
            </span>
            {updateError && (
              <span className="text-critical text-[9px] font-medium">{updateError}</span>
            )}
            <button
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    "Reopen this closed issue? It will return to the queue as Detected."
                  )
                ) {
                  handleStatusSubmit("detected");
                }
              }}
              disabled={updating}
              className="border-line bg-sunken/60 text-ink-2 hover:text-ink hover:border-accent/30 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border py-1.5 text-[11px] font-medium transition-colors disabled:opacity-50"
            >
              <RotateCcw className="h-3 w-3" />
              {updating ? "Reopening…" : "Reopen issue"}
            </button>
          </div>
        ) : validNextStates.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <select
              value={targetStatus}
              onChange={(e) => setStatusInput(e.target.value)}
              className="bg-sunken border-line text-ink focus:border-accent/50 h-7 cursor-pointer rounded-lg border px-2 text-[11px] capitalize outline-none"
            >
              {validNextStates.map((state) => (
                <option key={state} value={state} className="capitalize">
                  {state}
                </option>
              ))}
            </select>
            {/* Assignee — only when dispatching. Optional: an issue can be marked
                'assigned' (queued) before a crew is named. */}
            {targetStatus === "assigned" && (
              <input
                type="text"
                placeholder="Assign to (crew / contractor)…"
                value={assigneeInput}
                onChange={(e) => setAssigneeInput(e.target.value)}
                maxLength={120}
                className="bg-sunken border-line text-ink placeholder:text-ink-3 focus:border-accent/50 h-7 rounded-lg border px-2 text-[11px] outline-none"
              />
            )}
            <input
              type="text"
              placeholder="Audit comment…"
              value={notesInput}
              onChange={(e) => setNotesInput(e.target.value)}
              className="bg-sunken border-line text-ink placeholder:text-ink-3 focus:border-accent/50 h-7 rounded-lg border px-2 text-[11px] outline-none"
            />
            {updateError && (
              <span className="text-critical text-[9px] font-medium">{updateError}</span>
            )}
            <button
              type="button"
              onClick={() => handleStatusSubmit()}
              disabled={updating}
              className="bg-accent/15 border-accent/30 text-accent hover:bg-accent/25 w-full cursor-pointer rounded-lg border py-1.5 text-[11px] font-semibold transition-colors disabled:opacity-50"
            >
              {updating ? "Updating…" : "Update status"}
            </button>
          </div>
        ) : (
          <span className="text-ink-3 text-[10px] italic">Workflow completed</span>
        )}
      </div>

      <span className="text-ink-3 text-right font-mono text-[9px]">
        {report.id.substring(0, 8)}
      </span>
    </div>
  );
}

export default function MapComponent({
  reports,
  onRefresh,
  roadHealthSegments = [],
  showRoadHealth = false,
  canRepair = true,
}) {
  // Mumbai default center
  const defaultCenter = [19.076, 72.8777];

  // Priority-first cap (see the render note below). Severity, then recency.
  const MAX_MARKERS = 600;
  const sevRank = { high: 0, medium: 1, low: 2 };
  const sortedForMap = [...reports]
    .sort((a, b) => {
      const d = sevRank[getMaxSeverity(a.detections)] - sevRank[getMaxSeverity(b.detections)];
      if (d !== 0) return d;
      return new Date(b.timestamp) - new Date(a.timestamp);
    })
    .slice(0, MAX_MARKERS);
  const capped = reports.length - sortedForMap.length;

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={defaultCenter}
        zoom={13}
        scrollWheelZoom={true}
        zoomControl={false}
        className="h-full w-full"
      >
        {/* CARTO dark_matter. The bright default OSM tiles were the single
            loudest thing on screen — a white sheet inside a near-black app,
            which made the chrome look like a bug. Same class of CDN dependency
            as the OSM tiles they replace; no API key. */}
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          subdomains="abcd"
          maxZoom={20}
        />
        <ZoomControl position="bottomright" />

        {/*
         * Capped, priority-first render.
         *
         * Every issue gets a custom SVG divIcon with an interactive React
         * popup. That is affordable for a few hundred markers and fatal for
         * ~9.5k — painting that many inline SVGs locks the main thread and the
         * map renders NOTHING, which read exactly like "the backend is
         * disconnected." (Clustering via react-leaflet-cluster was tried first;
         * it silently no-ops against react-leaflet 5, adding zero markers.)
         *
         * So we render the MOST IMPORTANT markers and cap the rest: sort by
         * severity, then recency, and take MAX_MARKERS. The full set still
         * drives the list, the analytics and the counts — only the map pins are
         * capped, and the cap is surfaced on the map (see the badge below) so it
         * never silently hides scale.
         */}
        {sortedForMap.map((report) => {
          const maxSeverity = getMaxSeverity(report.detections);
          return (
            <Marker
              key={report.id}
              position={[report.latitude, report.longitude]}
              icon={createMarkerIcon(
                maxSeverity,
                report.detections?.length || 1,
                report.gps_source,
                report.is_verified
              )}
            >
              <Popup className="roadsense-popup" maxWidth={280} minWidth={248}>
                <IssuePopupContent report={report} onRefresh={onRefresh} canRepair={canRepair} />
              </Popup>
            </Marker>
          );
        })}

        {showRoadHealth &&
          roadHealthSegments.map((segment) => {
            const c = healthColor(segment.health_score);
            return (
              <Polygon
                key={segment.hex_id}
                positions={segment.polygon}
                pathOptions={{
                  fillColor: c,
                  fillOpacity: 0.32,
                  weight: 1,
                  color: c,
                  opacity: 0.7,
                }}
              >
                <Popup className="roadsense-popup">
                  <div className="font-sans flex w-40 flex-col gap-1.5">
                    <div className="flex items-baseline justify-between">
                      <span className="eyebrow">Health</span>
                      <span className="text-[10px] font-bold uppercase" style={{ color: c }}>
                        {healthLabel(segment.health_score)}
                      </span>
                    </div>
                    <span className="text-ink text-[20px] leading-none font-semibold">
                      {segment.health_score}
                    </span>
                    <div className="bg-sunken h-1 w-full overflow-hidden rounded-full">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(0, Math.min(100, segment.health_score))}%`,
                          background: c,
                        }}
                      />
                    </div>
                    <span className="text-ink-3 text-[9px]">
                      {segment.total_issues} issues · {segment.total_reports} reports
                    </span>
                  </div>
                </Popup>
              </Polygon>
            );
          })}
      </MapContainer>

      {/* Legend — the choropleth is a continuous scale, so it needs a key.
          Each bucket carries its label; the colour never works alone. */}
      {showRoadHealth && (
        <div className="border-line bg-surface/85 pointer-events-none absolute bottom-4 left-4 z-[400] flex flex-col gap-1.5 rounded-xl border px-3 py-2.5 backdrop-blur-xl">
          <span className="eyebrow">Road health</span>
          <div className="flex flex-col gap-1">
            {[100, 65, 40, 10].map((s) => (
              <span key={s} className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-[3px]"
                  style={{ background: healthColor(s) }}
                  aria-hidden="true"
                />
                <span className="text-ink-2 text-[10px]">{healthLabel(s)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Severity key — the pins are the only other colour on the map. */}
      <div className="border-line bg-surface/85 pointer-events-none absolute top-4 right-4 z-[400] flex items-center gap-3 rounded-xl border px-3 py-2 backdrop-blur-xl">
        {["high", "medium", "low"].map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: SEVERITY_COLOR[s] }}
              aria-hidden="true"
            />
            <span className="text-ink-2 text-[10px] capitalize">{s}</span>
          </span>
        ))}
        <span className="bg-line h-3 w-px" />
        <span className="flex items-center gap-1.5">
          <span className="text-warning text-[10px]" aria-hidden="true">
            ⚠
          </span>
          <span className="text-ink-2 text-[10px]">Faked GPS</span>
        </span>
      </div>

      {/* Cap disclosure — the map shows the top MAX_MARKERS by priority; the
          rest still live in the list and analytics. Surfaced so a full map of
          pins never silently hides how much data there actually is. */}
      {capped > 0 && (
        <div className="border-line bg-surface/85 text-ink-3 pointer-events-none absolute bottom-6 right-4 z-[400] rounded-lg border px-2.5 py-1.5 font-mono text-[10px] backdrop-blur-xl">
          Showing top{" "}
          <span className="text-ink-2">{sortedForMap.length.toLocaleString()}</span> of{" "}
          <span className="text-ink-2">{reports.length.toLocaleString()}</span> · sorted by severity
        </div>
      )}
    </div>
  );
}
