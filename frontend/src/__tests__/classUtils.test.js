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
  getClassColor,
  isKnownClass,
  getMaxSeverity,
  getSeverityBadgeStyle,
  getStatusBadgeStyle,
  getStatusProgress,
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
  // These assertions used to read `toContain("red")` / `toContain("slate")`,
  // pinning the old palette's Tailwind names. That made them fail on any
  // re-theme while never checking anything a user can perceive — and the hue
  // they pinned was the bug: class badges wore severity's colours.
  // They now assert the CONTRACT: class identity never spends hue, and an
  // unknown class is still visibly marked.

  test("known classes wear no hue — severity owns colour", () => {
    const style = getClassBadgeStyle("pothole");
    expect(style).toContain("text-ink-2");
    // Must not borrow any reserved status token
    expect(style).not.toMatch(/critical|warning|good|serious/);
  });

  test("unknown classes are visibly marked, but still without hue", () => {
    const style = getClassBadgeStyle("totally_new_class");
    expect(style).toContain("border-dashed");
    expect(style).not.toMatch(/critical|warning|good|serious/);
  });

  test("known and unknown are distinguishable from each other", () => {
    expect(getClassBadgeStyle("pothole")).not.toBe(
      getClassBadgeStyle("totally_new_class")
    );
  });

  test("returns a style for null / undefined (never throws)", () => {
    expect(() => getClassBadgeStyle(null)).not.toThrow();
    expect(() => getClassBadgeStyle(undefined)).not.toThrow();
  });
});

// ── getClassColor (charts only) ──────────────────────────────────────────────

describe("getClassColor", () => {
  test("assigns a fixed categorical slot per class identity", () => {
    // Colour follows the entity, not its rank — this is what stops a filter
    // from repainting the survivors.
    expect(getClassColor("pothole")).toBe("#3987e5");
    expect(getClassColor("road_crack")).toBe("#008300");
  });

  test("is stable regardless of call order or surrounding data", () => {
    const first = getClassColor("road_crack");
    getClassColor("pothole");
    getClassColor("speed_breaker");
    expect(getClassColor("road_crack")).toBe(first);
  });

  test("every Contract v3 class gets a distinct slot — none cycled", () => {
    const v3 = [
      "pothole", "road_crack", "broken_road",
      "water_filled_pothole", "patch_repair",
      "road_edge_damage", "speed_breaker",
    ];
    const colors = v3.map(getClassColor);
    expect(new Set(colors).size).toBe(v3.length);
  });

  test("unknown classes fold into the neutral tail, never a generated 9th hue", () => {
    expect(getClassColor("mystery_defect")).toBe("#616D7E");
    expect(getClassColor(null)).toBe("#616D7E");
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
  // Severity maps onto the RESERVED status tokens. Asserting the token name
  // (not "red"/"orange") means these survive a re-theme but still fail if
  // severity ever stops being the thing that carries colour.
  test("high wears the critical status token", () =>
    expect(getSeverityBadgeStyle("high")).toContain("critical"));
  test("medium wears the warning status token", () =>
    expect(getSeverityBadgeStyle("medium")).toContain("warning"));
  test("low wears the good status token", () =>
    expect(getSeverityBadgeStyle("low")).toContain("good"));
  test("defaults to good for unknown severity", () =>
    expect(getSeverityBadgeStyle("bizarre")).toContain("good"));

  test("the three levels are mutually distinct", () => {
    const styles = ["high", "medium", "low"].map(getSeverityBadgeStyle);
    expect(new Set(styles).size).toBe(3);
  });
});

// ── getStatusBadgeStyle ──────────────────────────────────────────────────────

describe("getStatusBadgeStyle", () => {
  // Was: emerald / indigo / slate — a six-hue rainbow for what is ordinal
  // lifecycle state, half of it colliding with severity. Status colours are
  // reserved for good→critical; a workflow state has no claim on them.

  test("in-flight states wear neutral ink, never a status hue", () => {
    for (const s of ["detected", "verified", "assigned", "inspection", "repair"]) {
      expect(getStatusBadgeStyle(s)).not.toMatch(/critical|warning|good|serious/);
    }
  });

  test("terminal states recede", () => {
    expect(getStatusBadgeStyle("completed")).toContain("text-ink-3");
    expect(getStatusBadgeStyle("closed")).toContain("text-ink-3");
  });

  test("unknown status falls back gracefully without throwing", () => {
    expect(() => getStatusBadgeStyle("random_status")).not.toThrow();
    expect(getStatusBadgeStyle("random_status")).toContain("text-ink-2");
  });
});

// ── getStatusProgress ────────────────────────────────────────────────────────

describe("getStatusProgress", () => {
  test("carries lifecycle ORDER so hue does not have to", () => {
    expect(getStatusProgress("detected")).toBe(0);
    expect(getStatusProgress("closed")).toBe(1);
    expect(getStatusProgress("repair")).toBeGreaterThan(getStatusProgress("verified"));
  });

  test("unknown / null status is treated as the start, never NaN", () => {
    expect(getStatusProgress("nonsense")).toBe(0);
    expect(getStatusProgress(null)).toBe(0);
  });
});
