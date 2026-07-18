"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import {
  motion,
  useReducedMotion,
  useMotionValue,
  useTransform,
  useAnimationFrame,
} from "motion/react";
import { SEVERITY_COLOR, ACCENT } from "@/lib/theme";

/**
 * LiveNetwork — the login background IS the product, running, across India.
 *
 * The map opens on the whole country, then flies into a random INLAND city every
 * few seconds and holds (coastal cities put sea in frame; inland keeps the whole
 * viewport land). Each hold generates a FRESH random scene — hazards and vehicles
 * spread over a jittered grid so nothing clusters. Vehicles drive STRAIGHT road
 * segments and take quick sharp turns (no curved paths — a spline reads as a
 * constant wobble), always facing their exact direction of travel, and buck hard
 * as they cross a hazard. Everything is a demo layer (no auth, no fetch), theme-
 * aware, and collapses to a calm still under prefers-reduced-motion.
 */

const INDIA_CENTER = [22.3, 80.2];
const INDIA_ZOOM = 4.6;

// INLAND cities only — no coastline means no ocean in the viewport.
const CITIES = [
  { lat: 28.61, lng: 77.21 }, // Delhi
  { lat: 12.9716, lng: 77.5946 }, // Bengaluru
  { lat: 17.385, lng: 78.4867 }, // Hyderabad
  { lat: 18.5204, lng: 73.8567 }, // Pune
  { lat: 23.0225, lng: 72.5714 }, // Ahmedabad
  { lat: 26.9124, lng: 75.7873 }, // Jaipur
  { lat: 21.1458, lng: 79.0882 }, // Nagpur
  { lat: 23.2599, lng: 77.4126 }, // Bhopal
  { lat: 26.8467, lng: 80.9462 }, // Lucknow
  { lat: 22.7196, lng: 75.8577 }, // Indore
];
const CITY_ZOOM = 12;

const LABELS = ["POTHOLE", "ROAD CRACK", "BROKEN ROAD", "EDGE DAMAGE"];
const SEVS = ["high", "medium", "low"];
const CROSS_DIST = 3.2; // % — proximity that counts as "crossing" a hazard

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Jittered-grid cell centres, shuffled — even coverage without clustering. */
function spreadCells(cols, rows, x0, x1, y0, y1) {
  const cw = (x1 - x0) / cols;
  const ch = (y1 - y0) / rows;
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push([
        x0 + (c + 0.5) * cw + rnd(-0.35, 0.35) * cw,
        y0 + (r + 0.5) * ch + rnd(-0.35, 0.35) * ch,
      ]);
    }
  }
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return cells;
}

/** A fresh random scene — regenerated on every city so none repeat. */
function generateScene() {
  const pinCells = spreadCells(4, 3, 8, 92, 10, 88);
  const nPins = Math.floor(rnd(8, 13)); // 8–12 hazards
  const pins = pinCells.slice(0, nPins).map(([x, y]) => ({
    x,
    y,
    sev: pick(SEVS),
    label: pick(LABELS),
    conf: Number(rnd(0.5, 0.96).toFixed(2)),
    t: rnd(0, 3),
  }));

  const carCells = spreadCells(4, 2, 16, 84, 22, 78);
  const nCars = Math.floor(rnd(5, 8)); // 5–7 vehicles
  const routes = carCells.slice(0, nCars).map(([cx, cy]) => {
    // A closed ring of vertices → STRAIGHT edges joined by sharp corners. The
    // vertices are placed at random angles/radii so each turn is a different
    // sharp angle, not a uniform curve.
    // Fewer vertices + larger radius → LONG straight edges with only a few sharp
    // turns. Short edges are what made the motion read as a constant wobble.
    const k = Math.floor(rnd(3, 6)); // 3–5 sharp turns
    const a0 = rnd(0, Math.PI * 2);
    const pts = [];
    for (let j = 0; j < k; j++) {
      const ang = a0 + (j / k) * Math.PI * 2 + rnd(-0.45, 0.45);
      const px = Math.max(6, Math.min(94, cx + Math.cos(ang) * rnd(20, 36)));
      const py = Math.max(8, Math.min(90, cy + Math.sin(ang) * rnd(16, 28)));
      pts.push([px, py]);
    }
    // Route one vertex through the nearest hazard so a crossing (jolt) happens.
    if (pins.length) {
      let np = pins[0];
      let nd = Infinity;
      for (const pin of pins) {
        const d = (pin.x - cx) ** 2 + (pin.y - cy) ** 2;
        if (d < nd) {
          nd = d;
          np = pin;
        }
      }
      pts[Math.floor(Math.random() * pts.length)] = [np.x, np.y];
    }
    return { pts, speed: rnd(3.2, 4.4), offset: rnd(0, 40) };
  });
  return { pins, routes };
}

export default function LiveNetwork({ theme = "dark" }) {
  const reduce = useReducedMotion();
  const dark = theme !== "light";
  const [hold, setHold] = useState({ active: reduce, key: 0 });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- new random scene per city
  const scene = useMemo(() => generateScene(), [hold.key]);

  const tint = dark ? "bg-[#04060a]/30" : "bg-[#eef1f5]/25";
  const vignette = dark
    ? "bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(4,6,10,0.62)_100%)]"
    : "bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(205,213,224,0.55)_100%)]";

  return (
    <div className="absolute inset-0 isolate z-0 overflow-hidden">
      <MapContainer
        center={INDIA_CENTER}
        zoom={INDIA_ZOOM}
        zoomControl={false}
        attributionControl={false}
        dragging={false}
        scrollWheelZoom={false}
        doubleClickZoom={false}
        touchZoom={false}
        keyboard={false}
        className="h-full w-full"
        style={{ background: dark ? "#04060a" : "#eef1f5" }}
      >
        <TileLayer
          key={dark ? "dark" : "light"}
          url={`https://{s}.basemaps.cartocdn.com/${dark ? "dark_all" : "light_all"}/{z}/{x}/{y}{r}.png`}
          subdomains="abcd"
          maxZoom={20}
        />
        {!reduce && <CityTour setHold={setHold} />}
      </MapContainer>

      {/* Atmosphere — theme-aware, all beneath the overlays. */}
      <div className={`pointer-events-none absolute inset-0 z-[700] ${tint}`} />
      <div className={`pointer-events-none absolute inset-0 z-[700] ${vignette}`} />
      <div className="bg-accent/10 pointer-events-none absolute top-1/2 left-1/2 z-[700] h-[36rem] w-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[130px]" />
      <div className="grain pointer-events-none absolute inset-0 z-[700]" />

      <motion.div
        key={hold.key}
        className="pointer-events-none absolute inset-0 z-[800]"
        animate={{ opacity: hold.active ? 1 : 0 }}
        transition={{ duration: 0.7 }}
      >
        {hold.active &&
          !reduce &&
          scene.routes.map((r, i) => <Vehicle key={i} route={r} pins={scene.pins} dark={dark} />)}
        {scene.pins.map((p, i) => (
          <Pin key={i} p={p} reduce={reduce} />
        ))}
      </motion.div>

      {!reduce && <ScanSweep />}
      <LiveCounter reduce={reduce} />
    </div>
  );
}

/* ── City tour ──────────────────────────────────────────────────────────────── */

function CityTour({ setHold, firstDelay = 4200, dwell = 7500, flight = 2400 }) {
  const map = useMap();
  useEffect(() => {
    let cancelled = false;
    let last = -1;
    const onStart = () => setHold((h) => ({ ...h, active: false }));
    const onEnd = () => !cancelled && setHold((h) => ({ active: true, key: h.key + 1 }));
    map.on("movestart", onStart);
    map.on("moveend", onEnd);
    const next = () => {
      if (cancelled) return;
      let i = Math.floor(Math.random() * CITIES.length);
      if (i === last) i = (i + 1) % CITIES.length;
      last = i;
      const c = CITIES[i];
      map.flyTo([c.lat, c.lng], CITY_ZOOM, { duration: flight / 1000 });
    };
    const startId = setTimeout(next, firstDelay);
    const loopId = setInterval(next, dwell + flight);
    return () => {
      cancelled = true;
      clearTimeout(startId);
      clearInterval(loopId);
      map.off("movestart", onStart);
      map.off("moveend", onEnd);
    };
  }, [map, setHold, firstDelay, dwell, flight]);
  return null;
}

/* ── Straight-segment sampler ─────────────────────────────────────────────────
   Closed polyline → constant-speed position + per-segment heading. Motion is
   dead straight along each edge; heading is constant on an edge and only changes
   at a vertex → a sharp turn, never a curved wobble.                            */

function makeSampler(pts) {
  const segs = [];
  let total = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 0.0001;
    // Keep the raw per-axis deltas (in %). Heading must be computed in PIXEL
    // space (aspect-corrected) by the caller — the viewport isn't square, so a
    // %-space angle points the car off its true screen direction of travel.
    segs.push({ a, b, len, dx: b[0] - a[0], dy: b[1] - a[1] });
    total += len;
  }
  const sample = (u) => {
    let d = ((((u % 1) + 1) % 1)) * total;
    for (const s of segs) {
      if (d <= s.len) {
        const f = d / s.len;
        return { px: s.a[0] + s.dx * f, py: s.a[1] + s.dy * f, dx: s.dx, dy: s.dy };
      }
      d -= s.len;
    }
    const last = segs[segs.length - 1];
    return { px: last.b[0], py: last.b[1], dx: last.dx, dy: last.dy };
  };
  return { sample, total };
}

/* ── Vehicle ──────────────────────────────────────────────────────────────────
   Drives straight edges at constant speed, faces its travel direction, and jolts
   HARD (edge-triggered, once) as it crosses a hazard.                           */

function Vehicle({ route, pins, dark }) {
  const path = useMemo(() => makeSampler(route.pts), [route.pts]);
  const dur = path.total / route.speed;

  const x = useMotionValue(route.pts[0][0]);
  const y = useMotionValue(route.pts[0][1]);
  const rot = useMotionValue(0);
  const shakeY = useMotionValue(0);
  const shakeR = useMotionValue(0);
  const glow = useMotionValue(0.25);
  const wasNear = useRef(false);
  const jolt = useRef(0);

  useAnimationFrame((tMs) => {
    const t = tMs / 1000 + route.offset;
    const s = path.sample(t / dur);
    x.set(s.px);
    y.set(s.py);
    // EXACT, ASPECT-CORRECTED heading. Position is left:x%(of width) / top:y%(of
    // height), so a %-delta maps to pixels as (dx*width, dy*height). The visual
    // travel angle is atan2(dy*height, dx*width) — computing it from raw % (as
    // before) pointed the car off its true direction on every diagonal, which is
    // the "slant". No ease, so straights are wobble-free and corners snap sharply.
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    rot.set((Math.atan2(s.dy * vh, s.dx * vw) * 180) / Math.PI);

    let near = false;
    for (let i = 0; i < pins.length; i++) {
      const dx = s.px - pins[i].x;
      const dy = s.py - pins[i].y;
      if (dx * dx + dy * dy < CROSS_DIST * CROSS_DIST) {
        near = true;
        break;
      }
    }
    if (near && !wasNear.current) jolt.current = 20; // rising edge → one hard buck
    wasNear.current = near;

    if (jolt.current > 0) {
      jolt.current -= 1;
      const k = jolt.current / 20;
      shakeY.set(Math.sin(tMs / 11) * 4.2 * k); // stronger, clearly a bump
      shakeR.set(Math.sin(tMs / 8) * 11 * k);
      glow.set(0.25 + 0.9 * k);
    } else {
      shakeY.set(0);
      shakeR.set(0);
      glow.set(glow.get() * 0.92 + 0.02);
    }
  });

  const left = useTransform(x, (v) => `${v}%`);
  const top = useTransform(y, (v) => `${v}%`);

  const body = dark ? "#d7e0ea" : "#33404f";
  const cabin = dark ? "#0e141b" : "#cfd8e3";
  const glass = dark ? "#2a3441" : "#eef2f7";

  return (
    <motion.div className="absolute" style={{ left, top }}>
      <div className="-translate-x-1/2 -translate-y-1/2">
        <motion.div style={{ rotate: rot }}>
          <div
            className="absolute top-1/2 h-[5px] -translate-y-1/2 rounded-full"
            style={{ left: -40, width: 42, background: `linear-gradient(90deg, transparent, ${ACCENT}55)`, filter: "blur(1px)" }}
          />
          <motion.div
            className="absolute top-1/2 left-1/2 rounded-full"
            style={{ width: 26, height: 14, x: "-50%", y: "-50%", background: ACCENT, filter: "blur(7px)", opacity: glow }}
          />
          <motion.div style={{ y: shakeY, rotate: shakeR }}>
            <svg width="24" height="11" viewBox="0 0 24 11" className="relative block">
              <rect x="1" y="1" width="22" height="9" rx="3.2" fill={body} />
              <rect x="6.5" y="2.4" width="9.5" height="6.2" rx="2" fill={cabin} opacity="0.92" />
              <rect x="8" y="3.3" width="3" height="4.4" rx="1" fill={glass} opacity="0.7" />
              <circle cx="21" cy="3.4" r="1.15" fill={ACCENT} />
              <circle cx="21" cy="7.6" r="1.15" fill={ACCENT} />
              <circle cx="2.6" cy="3.4" r="0.8" fill="#ec835a" />
              <circle cx="2.6" cy="7.6" r="0.8" fill="#ec835a" />
            </svg>
          </motion.div>
        </motion.div>
      </div>
    </motion.div>
  );
}

/* ── Detection pin ──────────────────────────────────────────────────────────── */

function Pin({ p, reduce }) {
  const color = SEVERITY_COLOR[p.sev];
  return (
    <div className="absolute" style={{ left: `${p.x}%`, top: `${p.y}%` }}>
      <span
        className="absolute rounded-full"
        style={{ width: 34, height: 34, left: -17, top: -17, background: color, opacity: 0.2, filter: "blur(8px)" }}
      />
      {!reduce && (
        <motion.span
          className="absolute rounded-full"
          style={{ border: `2px solid ${color}`, left: 0, top: 0 }}
          initial={{ width: 12, height: 12, x: -6, y: -6, opacity: 0.7 }}
          animate={{ width: [12, 64], height: [12, 64], x: [-6, -32], y: [-6, -32], opacity: [0.7, 0] }}
          transition={{ duration: 2.6, repeat: Infinity, repeatDelay: 1.4, delay: p.t, ease: "easeOut" }}
        />
      )}
      <motion.span
        className="absolute rounded-full"
        style={{
          width: 13,
          height: 13,
          left: -6.5,
          top: -6.5,
          background: color,
          border: "2px solid rgba(238,242,247,0.9)",
          boxShadow: `0 0 14px ${color}, 0 2px 6px rgba(0,0,0,0.6)`,
        }}
        initial={reduce ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={reduce ? { duration: 0 } : { duration: 0.5, delay: p.t, ease: [0.34, 1.56, 0.64, 1] }}
      />
      {!reduce && (
        <motion.span
          className="border-line bg-canvas/85 absolute top-[-9px] left-3 flex items-center gap-1.5 rounded-md border px-1.5 py-1 font-mono text-[9px] whitespace-nowrap backdrop-blur-sm"
          initial={{ opacity: 0, x: -4 }}
          animate={{ opacity: [0, 1, 1, 0], x: [-4, 0, 0, -4] }}
          transition={{ duration: 4, times: [0, 0.1, 0.7, 1], repeat: Infinity, repeatDelay: 9, delay: p.t + 0.4 }}
        >
          <span style={{ color }}>{p.label}</span>
          <span className="text-ink-3">{p.conf.toFixed(2)}</span>
        </motion.span>
      )}
    </div>
  );
}

/* ── Sensor sweep ─────────────────────────────────────────────────────────── */

function ScanSweep() {
  return (
    <motion.div
      className="pointer-events-none absolute inset-y-0 z-[780] w-[38%]"
      style={{ background: `linear-gradient(90deg, transparent, ${ACCENT}0d 55%, ${ACCENT}22 88%, transparent)` }}
      initial={{ x: "-40%" }}
      animate={{ x: "300%" }}
      transition={{ duration: 7, repeat: Infinity, ease: "linear" }}
    />
  );
}

/* ── Live counter ─────────────────────────────────────────────────────────── */

function LiveCounter({ reduce }) {
  const [n, setN] = useState(12840);
  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setN((v) => v + Math.floor(1 + Math.random() * 3)), 2600);
    return () => clearInterval(id);
  }, [reduce]);

  return (
    <div className="border-line bg-canvas/55 absolute bottom-16 left-6 z-[810] hidden items-center gap-2.5 rounded-lg border px-3 py-2 backdrop-blur-md md:flex">
      <span className="relative flex h-1.5 w-1.5">
        <span className="bg-accent absolute inline-flex h-full w-full animate-ping rounded-full opacity-70" />
        <span className="bg-accent relative inline-flex h-1.5 w-1.5 rounded-full" />
      </span>
      <span className="text-ink-2 font-mono text-[10px] tracking-wide">
        <span className="text-ink tnum font-semibold">{n.toLocaleString()}</span> hazards mapped
      </span>
    </div>
  );
}
