/**
 * theme.js — the design tokens, in JS.
 *
 * globals.css is the source of truth for anything CSS can reach. This file
 * exists for the two places that CANNOT read a CSS custom property:
 *   • Recharts — takes `stroke`/`fill` as literal strings
 *   • Leaflet  — marker pins are SVG strings injected via divIcon
 *
 * Keep these in lockstep with the @theme block in globals.css.
 *
 * Every value here was validated with the dataviz skill's validate_palette.js
 * against surface #0E1116 in dark mode. See the header of globals.css for the
 * colour law and the measured numbers. Do not add a colour here by eye.
 */

/** Surfaces. `surface` is the validator's reference surface. */
export const SURFACE = {
  canvas: "#06080B",
  sunken: "#0A0D12",
  surface: "#0E1116",
  raised: "#151A21",
  line: "#1E242D",
  grid: "#1A2029",
};

/** Ink. */
export const INK = {
  primary: "#EEF2F7",
  secondary: "#9AA6B6",
  muted: "#616D7E",
};

/**
 * Accent — INTERFACE ONLY. Never encodes data.
 * (L≈0.80 puts it outside the dark categorical band, so it is not a legal
 * series colour regardless.)
 */
export const ACCENT = "#22D3EE";

/**
 * Status — RESERVED for severity + road health. Always rendered with an icon
 * and a text label; never colour alone. Contrast on #0E1116: good 5.64:1,
 * warning 10.31:1, serious 7.17:1, critical 3.94:1 — all clear 3:1.
 */
export const STATUS = {
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
};

/** Severity → status token. The only mapping; used by chart, badge and pin. */
export const SEVERITY_COLOR = {
  high: STATUS.critical,
  medium: STATUS.warning,
  low: STATUS.good,
};

/**
 * Road-health score → status token. Four buckets onto the four status roles,
 * so a health colour and a severity colour always mean the same thing.
 */
export function healthColor(score) {
  if (score >= 80) return STATUS.good;
  if (score >= 50) return STATUS.warning;
  if (score >= 30) return STATUS.serious;
  return STATUS.critical;
}

/** Road-health bucket label — the "label" half of the icon+label pairing. */
export function healthLabel(score) {
  if (score >= 80) return "Good";
  if (score >= 50) return "Fair";
  if (score >= 30) return "Poor";
  return "Critical";
}

/**
 * Categorical slots — detection-class IDENTITY only.
 *
 * Fixed order, derived by enumerating all 8! orderings of the documented hues
 * and keeping the one that maximises the minimum adjacent CVD ΔE:
 *   worst adjacent ΔE 8.4 (protan) · 8.7 (tritan) · 19.3 (normal vision)
 *
 * 8.4 sits in the 6–8+ floor band, so anything painted with these MUST carry
 * secondary encoding (direct labels + legend). Never cycle past slot 8 — fold
 * the tail into `other`.
 */
export const CATEGORICAL = [
  "#3987e5", // 1 blue
  "#008300", // 2 green
  "#e66767", // 3 red
  "#9085e9", // 4 violet
  "#d55181", // 5 magenta
  "#c98500", // 6 yellow
  "#199e70", // 7 aqua
  "#d95926", // 8 orange
];

/** The folded tail / unknown class. Gray = de-emphasis, not a 9th hue. */
export const CATEGORICAL_OTHER = "#616D7E";

/**
 * Area-chart series. Validated as a pair on #0E1116:
 *   ΔE 25.7 (deutan) · 31.9 (normal) — comfortably clear.
 * `high` wears the status token because the series genuinely means "bad";
 * `total` is neutral magnitude and wears categorical slot 1.
 */
export const SERIES = {
  total: CATEGORICAL[0],
  high: STATUS.critical,
};

/** Shared Recharts tooltip chrome. */
export const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: "rgba(14,17,22,0.96)",
    border: `1px solid ${SURFACE.line}`,
    borderRadius: "10px",
    boxShadow: "0 16px 40px -8px rgba(0,0,0,0.8)",
    padding: "8px 10px",
    backdropFilter: "blur(12px)",
  },
  labelStyle: {
    color: INK.secondary,
    fontSize: 10,
    fontWeight: 600,
    marginBottom: 4,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
  },
  itemStyle: { fontSize: 11, fontWeight: 600, padding: "1px 0" },
  cursor: { stroke: SURFACE.line, strokeWidth: 1 },
};
