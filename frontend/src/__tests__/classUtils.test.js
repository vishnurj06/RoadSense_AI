/**
 * classUtils.test.js
 *
 * Unit tests for src/lib/classUtils.js
 *
 * These tests are pure JS (no DOM / React needed) and run fastest.
 * They form the safety net for Contract v3's forward-compatibility
 * requirement: unknown AI classes must never crash the frontend.
 */
import {
  getClassLabel,
  getClassBadgeStyle,
  isKnownClass,
  getMaxSeverity,
  getSeverityBadgeStyle,
  getStatusBadgeStyle,
} from "@/lib/classUtils";

// ── getClassLabel ────────────────────────────────────────────────────────────

describe("getClassLabel", () => {
  test("returns correct label for every known Contract v3 class", () => {
    expect(getClassLabel("pothole")).toBe("Pothole");
    expect(getClassLabel("road_crack")).toBe("Road Crack");
    expect(getClassLabel("broken_road")).toBe("Broken Road");
    expect(getClassLabel("water_filled_pothole")).toBe("Water-filled Pothole");
    expect(getClassLabel("patch_repair")).toBe("Patch Repair");
    expect(getClassLabel("road_edge_damage")).toBe("Road Edge Damage");
    expect(getClassLabel("speed_breaker")).toBe("Speed Breaker");
  });

  test("title-cases unknown future classes gracefully instead of crashing", () => {
    expect(getClassLabel("future_class_x")).toBe("Future Class X");
    expect(getClassLabel("alligator_crack")).toBe("Alligator Crack");
  });

  test("handles null / undefined / empty without throwing", () => {
    expect(getClassLabel(null)).toBe("Unknown");
    expect(getClassLabel(undefined)).toBe("Unknown");
    expect(getClassLabel("")).toBe("Unknown");
  });

  test("is case-insensitive (AI output could be mixed case)", () => {
    expect(getClassLabel("POTHOLE")).toBe("Pothole");
    expect(getClassLabel("Road_Crack")).toBe("Road Crack");
  });
});

// ── getClassBadgeStyle ───────────────────────────────────────────────────────

describe("getClassBadgeStyle", () => {
  test("returns a branded Tailwind class for known classes", () => {
    const style = getClassBadgeStyle("pothole");
    // Should contain colour tokens, not the neutral grey
    expect(style).toContain("red");
  });

  test("returns a neutral grey style for unknown classes (never crashes)", () => {
    const style = getClassBadgeStyle("totally_new_class");
    expect(style).toContain("slate");
  });

  test("returns a style for null / undefined (never throws)", () => {
    expect(() => getClassBadgeStyle(null)).not.toThrow();
    expect(() => getClassBadgeStyle(undefined)).not.toThrow();
  });
});

// ── isKnownClass ─────────────────────────────────────────────────────────────

describe("isKnownClass", () => {
  test("returns true for every Contract v3 class", () => {
    const v3Classes = [
      "pothole", "road_crack", "broken_road",
      "water_filled_pothole", "patch_repair",
      "road_edge_damage", "speed_breaker",
    ];
    v3Classes.forEach((cls) => expect(isKnownClass(cls)).toBe(true));
  });

  test("returns false for unknown future classes", () => {
    expect(isKnownClass("mystery_defect")).toBe(false);
    expect(isKnownClass("")).toBe(false);
    expect(isKnownClass(null)).toBe(false);
  });
});

// ── getMaxSeverity ───────────────────────────────────────────────────────────

describe("getMaxSeverity", () => {
  test("returns 'high' when any detection is high", () => {
    const detections = [{ severity: "low" }, { severity: "high" }, { severity: "medium" }];
    expect(getMaxSeverity(detections)).toBe("high");
  });

  test("returns 'medium' when highest is medium", () => {
    const detections = [{ severity: "low" }, { severity: "medium" }];
    expect(getMaxSeverity(detections)).toBe("medium");
  });

  test("returns 'low' for all-low or empty arrays", () => {
    expect(getMaxSeverity([{ severity: "low" }])).toBe("low");
    expect(getMaxSeverity([])).toBe("low");
  });

  test("handles null / undefined detections defensively", () => {
    expect(getMaxSeverity(null)).toBe("low");
    expect(getMaxSeverity(undefined)).toBe("low");
    expect(getMaxSeverity([{ severity: null }])).toBe("low");
  });
});

// ── getSeverityBadgeStyle ────────────────────────────────────────────────────

describe("getSeverityBadgeStyle", () => {
  test("returns red style for high", () => expect(getSeverityBadgeStyle("high")).toContain("red"));
  test("returns orange style for medium", () => expect(getSeverityBadgeStyle("medium")).toContain("orange"));
  test("returns green style for low", () => expect(getSeverityBadgeStyle("low")).toContain("green"));
  test("defaults to green for unknown severity", () => expect(getSeverityBadgeStyle("bizarre")).toContain("green"));
});

// ── getStatusBadgeStyle ──────────────────────────────────────────────────────

describe("getStatusBadgeStyle", () => {
  test("returns emerald for verified", () => expect(getStatusBadgeStyle("verified")).toContain("emerald"));
  test("returns indigo for assigned", () => expect(getStatusBadgeStyle("assigned")).toContain("indigo"));
  test("returns slate for detected (default)", () => expect(getStatusBadgeStyle("detected")).toContain("slate"));
  test("returns slate for unknown status (graceful fallback)", () => expect(getStatusBadgeStyle("random_status")).toContain("slate"));
});
