/**
 * classUtils.js — Contract v3 detection-class registry
 *
 * RULES (from Phase3 Workflow §3.1):
 *  - `class` is always lowercase snake_case from the AI.
 *  - Person B must treat UNKNOWN classes as forward-compatible:
 *    store + display, never 500. A ships new classes incrementally.
 *  - This file is the SINGLE source of truth for display labels and colours.
 *    Add new classes here when A ships them; the UI auto-adopts everywhere.
 *
 * ── Why class badges are colourless ─────────────────────────────────────────
 * They used to be: pothole=red, road_crack=orange, broken_road=amber… Those are
 * the same hue families severity uses, and the two badges sit side by side in
 * the same popup row — a red "Pothole" chip next to a red "HIGH" chip.
 *
 * This was measured, not guessed. Against the status palette, 6 of the 8
 * documented categorical hues sit below the ΔE 15 normal-vision floor:
 *   green 9.7 · aqua 9.8 · magenta 9.0 · yellow 9.0 · red 7.2 · orange 6.8
 * Only blue (30.4) and violet (24.5) are clear.
 *
 * So hue is spent on ONE job: severity. Class identity is carried by its label
 * (which is already spelled out) and, where identity genuinely is the subject —
 * the class-distribution chart — by `getClassColor` below, in a chart that
 * contains no severity colour and direct-labels every segment.
 */

import { CATEGORICAL, CATEGORICAL_OTHER } from "@/lib/theme";

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

/** Normalise any raw class string from the AI. */
const norm = (cls) => (typeof cls === "string" ? cls.trim().toLowerCase() : "");

/**
 * Human-readable display label for a raw class string from the AI.
 * Unknown classes are title-cased from their snake_case form.
 *
 * @param {string} cls - Raw class string, e.g. "road_crack"
 * @returns {string}
 */
export function getClassLabel(cls) {
  if (!cls || typeof cls !== "string") return "Unknown";
  const normalized = norm(cls);
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
 * Fixed categorical slot per class — CHARTS ONLY.
 *
 * Colour follows the ENTITY, never its rank: `pothole` is slot 1 whether it is
 * the largest segment or filtered down to nothing. That is what stops a filter
 * from repainting the survivors.
 *
 * Slot order is derived (not taste): all 8! orderings of the documented hues
 * were enumerated and the one maximising the minimum adjacent CVD ΔE kept —
 * worst adjacent 8.4 protan / 8.7 tritan / 19.3 normal-vision on surface
 * #0E1116. 8.4 is in the floor band, so callers MUST also direct-label.
 *
 * Never generate a 9th hue: unknown classes fold into the neutral `other`.
 *
 * @param {string} cls
 * @returns {string} hex
 */
export function getClassColor(cls) {
  const order = [
    "pothole",
    "road_crack",
    "broken_road",
    "water_filled_pothole",
    "patch_repair",
    "road_edge_damage",
    "speed_breaker",
  ];
  const i = order.indexOf(norm(cls));
  return i === -1 ? CATEGORICAL_OTHER : CATEGORICAL[i];
}

/**
 * Tailwind className for the class badge — deliberately NEUTRAL (see header).
 *
 * Known and unknown are still told apart, but by *border treatment* rather than
 * hue: an unrecognised class gets a dashed edge and muted ink, so a future
 * `speed_breaker` is visibly "new" without borrowing severity's colour.
 *
 * @param {string} cls - Raw class string from the AI
 * @returns {string} Tailwind className string
 */
export function getClassBadgeStyle(cls) {
  return isKnownClass(cls)
    ? "bg-raised text-ink-2 border-line"
    : "bg-raised text-ink-3 border-line border-dashed";
}

/**
 * Returns true if the class string is a recognised Contract v3 class.
 * Use this to add a visual "unknown" indicator in the UI when needed.
 *
 * @param {string} cls
 * @returns {boolean}
 */
export function isKnownClass(cls) {
  return KNOWN_CLASSES.has(norm(cls));
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
 * Tailwind className for a severity badge.
 *
 * Severity is the one thing in this UI that wears hue, and it wears the
 * RESERVED status tokens: high→critical, medium→warning, low→good. Always
 * rendered beside its text label (and an icon in the popup), so meaning never
 * rests on colour alone.
 *
 * @param {"high"|"medium"|"low"|string} severity
 * @returns {string}
 */
export function getSeverityBadgeStyle(severity) {
  switch ((severity || "low").toLowerCase()) {
    case "high":
      return "bg-critical/12 text-critical border-critical/30";
    case "medium":
      return "bg-warning/12 text-warning border-warning/30";
    default:
      return "bg-good/12 text-good border-good/30";
  }
}

/** The repair lifecycle, in order. `detected` is index 0. */
export const STATUS_ORDER = [
  "detected",
  "approved",
  "assigned",
  "inspection",
  "repair",
  "completed",
  "closed",
];

/**
 * Progress through the repair lifecycle, 0..1. Lets the UI show ORDER without
 * spending hue on it — the workflow is ordinal, not good/bad, so it has no
 * claim on the status palette.
 *
 * @param {string} status
 * @returns {number}
 */
export function getStatusProgress(status) {
  const i = STATUS_ORDER.indexOf((status || "detected").toLowerCase());
  return i === -1 ? 0 : i / (STATUS_ORDER.length - 1);
}

/**
 * Tailwind className for an issue-status badge — NEUTRAL by design.
 *
 * The lifecycle used to be a six-hue rainbow (emerald/indigo/amber/orange/
 * teal/rose) for what is nominal-ordinal state, not good/bad — and half those
 * hues collided with severity. Status colours are reserved; a workflow state
 * has no claim on them. The label carries the meaning; `getStatusProgress`
 * carries the order.
 *
 * @param {string} status
 * @returns {string}
 */
export function getStatusBadgeStyle(status) {
  const s = (status || "detected").toLowerCase();
  // Terminal states recede; in-flight states sit at normal ink weight.
  return s === "completed" || s === "closed"
    ? "bg-sunken text-ink-3 border-line"
    : "bg-raised text-ink-2 border-line";
}
