/**
 * mapUtils.js — GeoJSON → UI issue adapter
 *
 * `GET /map` returns a GeoJSON FeatureCollection; the map/popup components want
 * flat objects. This adapter is the ONLY place that translation happens.
 *
 * Why it lives here rather than inline in page.js: it is an explicit whitelist,
 * so a property the backend serves but this function forgets is dropped
 * silently — no error, no warning, the field just reads `undefined` downstream.
 * That is precisely how B3-6 stayed broken after the backend was fixed: /map
 * emitted `gps_source`, the inline mapping omitted it, and faked pins kept
 * rendering as unverified-looking "unknown". Keeping it in one exported
 * function makes the whitelist testable — see `__tests__/mapUtils.test.js`.
 */

/**
 * Flatten one GeoJSON feature from GET /map into the shape the UI consumes.
 *
 * @param {object} feature - A GeoJSON Feature from GET /map.
 * @returns {object} Flat issue object.
 */
export function mapFeatureToIssue(feature) {
  const props = feature.properties ?? {};
  const coords = feature.geometry?.coordinates ?? [];
  return {
    id: props.report_id,
    // GeoJSON is [lon, lat] — the UI wants them named and the right way round.
    latitude: coords[1],
    longitude: coords[0],
    class_name: props.class_name, // the issue's title label — else the list/queue read "Mixed"
    vehicle_id: props.vehicle_id,
    timestamp: props.timestamp,
    image_url: props.image_url,
    detection_count: props.detection_count,
    detections: props.detections,
    speed_kmph: props.speed_kmph,
    model_version: props.model_version,
    gps_source: props.gps_source, // B3-6 — provenance must survive the hop
    road_name: props.road_name, // B3-5 — enrichment must survive the hop
    status: props.status,
    is_verified: props.is_verified, // #1 — ≥2-vehicle verification must survive the hop
    priority: props.priority, // #3 — urgency score must survive the hop
    assigned_to: props.assigned_to, // repair assignee (crew/contractor) must survive the hop
  };
}

/**
 * Map a whole FeatureCollection. Tolerates a missing/!ok payload.
 *
 * @param {object} geojson - FeatureCollection from GET /map.
 * @returns {object[]}
 */
export function mapFeaturesToIssues(geojson) {
  return (geojson?.features ?? []).map(mapFeatureToIssue);
}
