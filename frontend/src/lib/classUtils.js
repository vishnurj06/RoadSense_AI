/**
 * classUtils.js — Contract v3 detection-class registry
 *
 * RULES (from Phase3 Workflow §3.1):
 *  - `class` is always lowercase snake_case from the AI.
 *  - Person B must treat UNKNOWN classes as forward-compatible:
 *    store + display, never 500. A ships new classes incrementally.
 *  - This file is the SINGLE source of truth for display labels and colours.
 *    Add new classes here when A ships them; the UI auto-adopts everywhere.
 */

/** All 7 PRD detection classes (Contract v3). */
export const KNOWN_CLASSES = new Set([
  "pothole",
  "road_crack",
  "broken_road",
  "water_filled_pothole",
  "patch_repair",
  "road_edge_damage",
  "speed_breaker",
]);

/**
 * Human-readable display label for a raw class string from the AI.
 * Unknown classes are title-cased from their snake_case form.
 *
 * @param {string} cls - Raw class string, e.g. "road_crack"
 * @returns {string}
 */
export function getClassLabel(cls) {
  if (!cls || typeof cls !== "string") return "Unknown";
  const normalized = cls.trim().toLowerCase();
  const labelMap = {
    pothole: "Pothole",
    road_crack: "Road Crack",
    broken_road: "Broken Road",
    water_filled_pothole: "Water-filled Pothole",
    patch_repair: "Patch Repair",
    road_edge_damage: "Road Edge Damage",
    speed_breaker: "Speed Breaker",
  };
  return (
    labelMap[normalized] ||
    // Graceful fallback: capitalise each word of any future class
    normalized
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

/**
 * Tailwind className string for the class badge.
 * Known classes get a branded colour; unknown classes get a neutral grey
 * so they are visibly different without crashing.
 *
 * @param {string} cls - Raw class string from the AI
 * @returns {string} Tailwind className string
 */
export function getClassBadgeStyle(cls) {
  const normalized = (cls || "").trim().toLowerCase();
  const styleMap = {
    pothole:
      "bg-red-500/10 text-red-400 border-red-500/30",
    road_crack:
      "bg-orange-500/10 text-orange-400 border-orange-500/30",
    broken_road:
      "bg-amber-500/10 text-amber-400 border-amber-500/30",
    water_filled_pothole:
      "bg-blue-500/10 text-blue-400 border-blue-500/30",
    patch_repair:
      "bg-green-500/10 text-green-400 border-green-500/30",
    road_edge_damage:
      "bg-purple-500/10 text-purple-400 border-purple-500/30",
    speed_breaker:
      "bg-teal-500/10 text-teal-400 border-teal-500/30",
  };
  // Forward-compatible unknown class → neutral grey, clearly marked
  return styleMap[normalized] || "bg-slate-700/30 text-slate-400 border-slate-600/40";
}

/**
 * Returns true if the class string is a recognised Contract v3 class.
 * Use this to add a visual "unknown" indicator in the UI when needed.
 *
 * @param {string} cls
 * @returns {boolean}
 */
export function isKnownClass(cls) {
  return KNOWN_CLASSES.has((cls || "").trim().toLowerCase());
}

/**
 * Derives the maximum severity across a detections array.
 * Defensive: handles null/undefined detections, missing severity fields,
 * and any severity string that isn't low/medium/high.
 *
 * @param {Array<{severity?: string}>} detections
 * @returns {"high"|"medium"|"low"}
 */
export function getMaxSeverity(detections) {
  if (!Array.isArray(detections) || detections.length === 0) return "low";
  const sevs = detections.map((d) => (d?.severity || "low").toLowerCase());
  if (sevs.includes("high")) return "high";
  if (sevs.includes("medium")) return "medium";
  return "low";
}

/**
 * Tailwind className string for a severity badge.
 *
 * @param {"high"|"medium"|"low"|string} severity
 * @returns {string}
 */
export function getSeverityBadgeStyle(severity) {
  switch ((severity || "low").toLowerCase()) {
    case "high":
      return "bg-red-500/10 text-red-400 border-red-500/20";
    case "medium":
      return "bg-orange-500/10 text-orange-400 border-orange-500/20";
    default:
      return "bg-green-500/10 text-green-400 border-green-500/20";
  }
}

/**
 * Tailwind className string for an issue-status badge.
 *
 * @param {string} status
 * @returns {string}
 */
export function getStatusBadgeStyle(status) {
  switch ((status || "detected").toLowerCase()) {
    case "verified":
      return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    case "assigned":
      return "bg-indigo-500/10 text-indigo-400 border-indigo-500/20";
    case "inspection":
      return "bg-amber-500/10 text-amber-400 border-amber-500/20";
    case "repair":
      return "bg-orange-500/10 text-orange-400 border-orange-500/20";
    case "completed":
      return "bg-teal-500/10 text-teal-400 border-teal-500/20";
    case "closed":
      return "bg-rose-500/10 text-rose-400 border-rose-500/20";
    default:
      return "bg-slate-800 text-slate-400 border-slate-700";
  }
}
