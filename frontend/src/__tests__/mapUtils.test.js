import { mapFeatureToIssue, mapFeaturesToIssues } from "@/lib/mapUtils";

/** A feature shaped exactly like GET /map serves one. */
const feature = (props = {}) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [73.8567, 18.5204] },
  properties: {
    report_id: "abc-123",
    issue_id: "abc-123",
    class_name: "pothole",
    status: "detected",
    max_severity: "high",
    image_url: "http://minio/roadsense/x.jpg",
    detection_count: 3,
    timestamp: "2026-07-17T10:00:00",
    vehicle_id: "Clustered (3 reports)",
    speed_kmph: 42.0,
    model_version: "roadsense-stub-v2",
    gps_source: "faked",
    road_name: "Fergusson College Road",
    detections: [{ id: "d1", class: "pothole", severity: "high" }],
    ...props,
  },
});

describe("mapUtils — GeoJSON → UI adapter", () => {
  it("puts [lon, lat] back the right way round", () => {
    const issue = mapFeatureToIssue(feature());
    expect(issue.longitude).toBe(73.8567);
    expect(issue.latitude).toBe(18.5204);
  });

  // The regression this file exists for. The backend served gps_source and the
  // inline mapping silently dropped it, so B3-6's amber warning never rendered
  // even though both the backend test and the gpsUtils unit tests were green.
  it("carries gps_source through — B3-6 regression", () => {
    expect(mapFeatureToIssue(feature()).gps_source).toBe("faked");
  });

  it("carries road_name through — B3-5 regression", () => {
    expect(mapFeatureToIssue(feature()).road_name).toBe(
      "Fergusson College Road"
    );
  });

  it("preserves every field the popup and filters read", () => {
    const issue = mapFeatureToIssue(feature());
    // If you add a property to GET /map, add it here — a field the adapter
    // forgets is dropped silently, with no error anywhere.
    expect(issue).toEqual({
      id: "abc-123",
      latitude: 18.5204,
      longitude: 73.8567,
      vehicle_id: "Clustered (3 reports)",
      timestamp: "2026-07-17T10:00:00",
      image_url: "http://minio/roadsense/x.jpg",
      detection_count: 3,
      detections: [{ id: "d1", class: "pothole", severity: "high" }],
      speed_kmph: 42.0,
      model_version: "roadsense-stub-v2",
      gps_source: "faked",
      road_name: "Fergusson College Road",
      status: "detected",
    });
  });

  it("passes a real gps_source through unchanged", () => {
    expect(mapFeatureToIssue(feature({ gps_source: "exif" })).gps_source).toBe(
      "exif"
    );
  });

  it("leaves an absent gps_source undefined rather than inventing one", () => {
    const bare = feature();
    delete bare.properties.gps_source;
    expect(mapFeatureToIssue(bare).gps_source).toBeUndefined();
  });

  it("maps a whole collection", () => {
    expect(mapFeaturesToIssues({ features: [feature(), feature()] })).toHaveLength(2);
  });

  it("tolerates an empty or malformed payload", () => {
    expect(mapFeaturesToIssues({ features: [] })).toEqual([]);
    expect(mapFeaturesToIssues({})).toEqual([]);
    expect(mapFeaturesToIssues(null)).toEqual([]);
  });
});
