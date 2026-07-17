/**
 * motion.js — the shared motion vocabulary.
 *
 * One file so timing is consistent everywhere. The rule of thumb: motion
 * should explain a change (where did this come from, what just updated), never
 * decorate. Anything that loops forever is either a live-data indicator or it
 * shouldn't exist.
 *
 * Reduced motion is handled two ways:
 *   • CSS animations  → the media query in globals.css
 *   • JS/motion       → `useReducedMotion()` from motion/react at the call site,
 *                       plus MotionConfig in the shell
 */

/** The house curve. Fast out, long settle — reads as "responsive, not bouncy". */
export const EASE = [0.16, 1, 0.3, 1];

export const T = {
  fast: { duration: 0.16, ease: EASE },
  base: { duration: 0.28, ease: EASE },
  slow: { duration: 0.5, ease: EASE },
  spring: { type: "spring", stiffness: 420, damping: 34, mass: 0.7 },
  softSpring: { type: "spring", stiffness: 260, damping: 30 },
};

/** Panel / card entrance: rise + fade. */
export const rise = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: T.base },
  exit: { opacity: 0, y: -6, transition: T.fast },
};

/** Fade only — for things that shouldn't appear to move (map overlays). */
export const fade = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: T.base },
  exit: { opacity: 0, transition: T.fast },
};

/**
 * Stagger container. Children animate in sequence so a panel assembles
 * rather than snapping in as one block.
 */
export const stagger = (staggerChildren = 0.045, delayChildren = 0.02) => ({
  hidden: {},
  show: { transition: { staggerChildren, delayChildren } },
});

/** List rows: slide in from the leading edge. */
export const rowIn = {
  hidden: { opacity: 0, x: -8 },
  show: { opacity: 1, x: 0, transition: T.base },
  exit: { opacity: 0, x: 8, transition: T.fast },
};

/** Modal / command palette. */
export const pop = {
  hidden: { opacity: 0, scale: 0.97, y: 8 },
  show: { opacity: 1, scale: 1, y: 0, transition: T.spring },
  exit: { opacity: 0, scale: 0.98, y: 4, transition: T.fast },
};

/** Right-hand drawer. */
export const drawer = {
  hidden: { x: "100%" },
  show: { x: 0, transition: T.spring },
  exit: { x: "100%", transition: { duration: 0.2, ease: EASE } },
};

/** Toast: springs up from the bottom edge. */
export const toastIn = {
  hidden: { opacity: 0, y: 24, scale: 0.96 },
  show: { opacity: 1, y: 0, scale: 1, transition: T.spring },
  exit: { opacity: 0, y: 12, scale: 0.98, transition: T.fast },
};

/** Shared hover/press feel for interactive cards and buttons. */
export const tapScale = { scale: 0.975 };
export const hoverLift = { y: -2 };
