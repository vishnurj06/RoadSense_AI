import {
  getGpsProvenance,
  isRealGps,
  getGpsSourceLabel,
  REAL_GPS_SOURCES,
  FAKED_GPS_SOURCE,
} from "@/lib/gpsUtils";

describe("gpsUtils — B3-6 GPS provenance (fails closed)", () => {
  describe("getGpsProvenance", () => {
    it('classifies "faked" as faked', () => {
      expect(getGpsProvenance("faked")).toBe("faked");
    });

    it.each(["exif", "gpx"])('classifies real source "%s" as real', (src) => {
      expect(getGpsProvenance(src)).toBe("real");
    });

    // The actual production bug: /map omitted the field, every consumer
    // defaulted it to "exif", and faked pins rendered as "✓ GPS VERIFIED".
    it.each([
      ["undefined", undefined],
      ["null", null],
      ["empty string", ""],
      ["unknown future source", "cell_tower"],
      ["non-string", 42],
    ])("treats %s as unknown, never real", (_label, value) => {
      expect(getGpsProvenance(value)).toBe("unknown");
    });

    it("never reports a missing field as real", () => {
      expect(isRealGps(undefined)).toBe(false);
      expect(isRealGps(null)).toBe(false);
    });
  });

  describe("isRealGps", () => {
    it("is true only for known real sources", () => {
      expect(isRealGps("exif")).toBe(true);
      expect(isRealGps("gpx")).toBe(true);
      expect(isRealGps("faked")).toBe(false);
      expect(isRealGps("cell_tower")).toBe(false);
    });
  });

  describe("getGpsSourceLabel", () => {
    it("echoes a present source", () => {
      expect(getGpsSourceLabel("gpx")).toBe("gpx");
      expect(getGpsSourceLabel("faked")).toBe("faked");
    });

    it('renders a missing source as "unknown", not a fabricated "exif"', () => {
      expect(getGpsSourceLabel(undefined)).toBe("unknown");
      expect(getGpsSourceLabel(null)).toBe("unknown");
      expect(getGpsSourceLabel("")).toBe("unknown");
    });
  });

  describe("registry", () => {
    it("matches Contract v3 §3.2", () => {
      expect(REAL_GPS_SOURCES.has("exif")).toBe(true);
      expect(REAL_GPS_SOURCES.has("gpx")).toBe(true);
      expect(REAL_GPS_SOURCES.has(FAKED_GPS_SOURCE)).toBe(false);
    });
  });
});
