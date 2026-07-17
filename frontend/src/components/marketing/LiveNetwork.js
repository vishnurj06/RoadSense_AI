"use client";

import React, { useState, useEffect } from "react";
import { MapContainer, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { motion, useReducedMotion } from "motion/react";
import { SEVERITY_COLOR, ACCENT } from "@/lib/theme";

/**
 * LiveNetwork — the login background IS the product, running.
 *
 * The research on current login trends is blunt: the strongest pattern is
 * "real product context" — put the actual product experience at the entrance,
 * not a picture of it. RoadSense's product is a live map of road hazards, so
 * that is exactly what the login shows: the same dark CARTO map the dashboard
 * uses, with detection pins arriving and pulsing in the real severity colours,
 * a sensor sweep passing over, and a live hazard counter. You are watching the
 * detection network before you sign into it.
 *
 * The pins are a curated demo layer (positioned in screen space over a static
 * map) — no auth, no fetch — so this is honest: a preview of what the network
 * does, animated on motion's clock, and it collapses to a calm still under
 * prefers-reduced-motion.
 */

// Demo detections, in screen-percent over the map. Staggered `t` so they arrive
// one after another like a live feed rather than all at once.
const PINS = [
  { x: 24, y: 34, sev: "high", label: "POTHOLE", conf: 0.94, t: 0.4 },
  { x: 61, y: 26, sev: "medium", label: "ROAD CRACK", conf: 0.71, t: 2.1 },
  { x: 39, y: 58, sev: "low", label: "PATCH REPAIR", conf: 0.55, t: 3.6 },
  { x: 72, y: 52, sev: "high", label: "BROKEN ROAD", conf: 0.88, t: 5.0 },
  { x: 17, y: 66, sev: "medium", label: "ROAD CRACK", conf: 0.63, t: 6.3 },
  { x: 52, y: 44, sev: "low", label: "POTHOLE", conf: 0.52, t: 7.7 },
  { x: 83, y: 36, sev: "high", label: "POTHOLE", conf: 0.91, t: 9.0 },
  { x: 31, y: 22, sev: "medium", label: "EDGE DAMAGE", conf: 0.68, t: 10.4 },
  { x: 67, y: 68, sev: "low", label: "PATCH REPAIR", conf: 0.58, t: 11.6 },
];

export default function LiveNetwork() {
  const reduce = useReducedMotion();

  return (
    // `isolate z-0` is load-bearing: Leaflet's panes carry z-index 200–700, and
    // without a stacking context here they beat the login card (z-20) in the
    // root context and bury the whole form under the map — the same bug the
    // dashboard hit. Isolating contains those z-indices inside this layer.
    <div className="absolute inset-0 isolate z-0 overflow-hidden">
      {/* The real product map — dark CARTO tiles, fully non-interactive. */}
      <MapContainer
        center={[19.076, 72.8777]}
        zoom={13}
        zoomControl={false}
        attributionControl={false}
        dragging={false}
        scrollWheelZoom={false}
        doubleClickZoom={false}
        touchZoom={false}
        keyboard={false}
        className="h-full w-full"
        style={{ background: "#04060a" }}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          subdomains="abcd"
          maxZoom={20}
        />
      </MapContainer>

      {/* ── Atmosphere layers, ALL beneath the pins ──────────────────────────
         Order matters: the pins are the subject, so every wash sits under them.
         An earlier cut painted the vignette (72% black at the edges) OVER the
         pins and quietly erased them — they were in the DOM at full opacity but
         buried. Tint → vignette → bloom → grain first, THEN the detections. */}
      {/* These wraps sit at z-[700] — above every Leaflet pane (200–700) so they
          actually tint the MAP, not hide behind it, but below the pins (800). */}
      {/* Tint the map down so it recedes behind the content — lightly. */}
      <div className="pointer-events-none absolute inset-0 z-[700] bg-[#04060a]/25" />
      {/* Vignette seats the card and darkens the edges. */}
      <div className="pointer-events-none absolute inset-0 z-[700] bg-[radial-gradient(ellipse_at_center,transparent_42%,rgba(4,6,10,0.6)_100%)]" />
      {/* Cyan bloom so the card's glass catches light. */}
      <div className="bg-accent/10 pointer-events-none absolute top-1/2 left-1/2 z-[700] h-[36rem] w-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[130px]" />
      {/* Film grain. */}
      <div className="grain pointer-events-none absolute inset-0 z-[700]" />

      {/* Detection layer.
         z-[800] is not arbitrary: Leaflet gives its own panes z-index 200–700,
         and z-index beats DOM order, so a later-in-markup layer at z:auto still
         renders BEHIND the map's panes — which is exactly why the pins were in
         the DOM at full opacity but invisible. 800 clears Leaflet's ceiling.
         (This whole layer is still inside the isolate wrapper, so it stays
         below the login card.) */}
      <div className="pointer-events-none absolute inset-0 z-[800]">
        {!reduce && <ScanSweep />}
        {PINS.map((p, i) => (
          <Pin key={i} p={p} reduce={reduce} />
        ))}
      </div>

      {/* Live counter — the network is doing something right now */}
      <LiveCounter reduce={reduce} />
    </div>
  );
}

/* ── Detection pin ────────────────────────────────────────────────────────────
   A dot in its severity colour with an expanding ping ring, and a label that
   flashes in when the pin "arrives" then settles. The whole thing loops on a
   long cycle so, at any moment, a couple of fresh detections are landing.     */

function Pin({ p, reduce }) {
  const color = SEVERITY_COLOR[p.sev];

  return (
    <div className="absolute" style={{ left: `${p.x}%`, top: `${p.y}%` }}>
      {/* soft halo so the pin reads over busy map detail — always on */}
      <span
        className="absolute rounded-full"
        style={{
          width: 34,
          height: 34,
          left: -17,
          top: -17,
          background: color,
          opacity: 0.2,
          filter: "blur(8px)",
        }}
      />

      {/* ping ring — the CONTINUOUS live pulse (this is what loops forever) */}
      {!reduce && (
        <motion.span
          className="absolute rounded-full"
          style={{ border: `2px solid ${color}`, left: 0, top: 0 }}
          initial={{ width: 12, height: 12, x: -6, y: -6, opacity: 0.7 }}
          animate={{
            width: [12, 64],
            height: [12, 64],
            x: [-6, -32],
            y: [-6, -32],
            opacity: [0.7, 0],
          }}
          transition={{
            duration: 2.6,
            repeat: Infinity,
            repeatDelay: 1.4,
            delay: p.t,
            ease: "easeOut",
          }}
        />
      )}

      {/* core dot — a ONE-SHOT arrival, then it STAYS. This is what makes the
          map fill up with detections instead of blinking. */}
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

      {/* label — flashes as the detection "event", then settles; loops slowly so
          a couple of fresh reads are always crossing the map. */}
      {!reduce && (
        <motion.span
          className="border-line bg-canvas/85 absolute top-[-9px] left-3 flex items-center gap-1.5 rounded-md border px-1.5 py-1 font-mono text-[9px] whitespace-nowrap backdrop-blur-sm"
          initial={{ opacity: 0, x: -4 }}
          animate={{ opacity: [0, 1, 1, 0], x: [-4, 0, 0, -4] }}
          transition={{
            duration: 4,
            times: [0, 0.1, 0.7, 1],
            repeat: Infinity,
            repeatDelay: 9,
            delay: p.t + 0.4,
          }}
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
      className="absolute inset-y-0 w-[38%]"
      style={{
        background: `linear-gradient(90deg, transparent, ${ACCENT}0d 55%, ${ACCENT}22 88%, transparent)`,
      }}
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
    <div className="border-line bg-canvas/55 absolute bottom-16 left-6 z-[800] hidden items-center gap-2.5 rounded-lg border px-3 py-2 backdrop-blur-md md:flex">
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
