/**
 * gpsUtils.js — Contract v3 GPS provenance registry (B3-6)
 *
 * RULES (from Phase3 Workflow §3.2):
 *  - `gps_source` ∈ {exif, gpx, faked}.
 *  - Provenance FAILS CLOSED. Only an explicitly-known real source may be
 *    presented as verified. A missing or unrecognised value is "unknown" —
 *    never "verified", and never silently coerced to "exif".
 *  - This file is the SINGLE source of truth for that rule; the map pin, the
 *    popup badge, and the "real GPS only" filter all read it.
 *
 * Why this exists: /map originally omitted gps_source entirely, and every
 * consumer independently defaulted the missing field to "exif" — so faked
 * pins rendered as "✓ GPS VERIFIED". Centralising the rule means a field that
 * goes missing again degrades to "unknown" everywhere at once.
 */

/** Sources that represent a real, trustworthy positional fix. */
export const REAL_GPS_SOURCES = new Set(["exif", "gpx"]);

/** The sentinel the backend writes for a synthesised/approximate location. */
export const FAKED_GPS_SOURCE = "faked";

/**
 * Classify a raw gps_source into exactly one provenance state.
 *
 * @param {string|null|undefined} source - Raw gps_source from the API.
 * @returns {"real"|"faked"|"unknown"}
 */
export function getGpsProvenance(source) {
  if (source === FAKED_GPS_SOURCE) return "faked";
  if (typeof source === "string" && REAL_GPS_SOURCES.has(source)) return "real";
  return "unknown";
}

/**
 * True only when the location is backed by a real fix. Unknown counts as not
 * verified — this is the predicate the "real GPS only" filter must use.
 *
 * @param {string|null|undefined} source
 * @returns {boolean}
 */
export function isRealGps(source) {
  return getGpsProvenance(source) === "real";
}

/**
 * Display string for the GPS Source badge. Never fabricates a source.
 *
 * @param {string|null|undefined} source
 * @returns {string}
 */
export function getGpsSourceLabel(source) {
  return typeof source === "string" && source.length > 0 ? source : "unknown";
}
