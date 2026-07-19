/* ============================================================================
   SaaS Noir — motion primitives (Phase 1 foundation)
   Ported from the portfolio's src/lib/animation.js, tuned slightly faster for
   an app UI (0.6–0.8s entrances vs the portfolio's ~1.1s cinematic pacing).
   Framework-agnostic values; consumed by components/motion/primitives.tsx.
   ============================================================================ */

import type { Variants } from 'motion/react';

/** Signature cinematic easing (expo-out). Matches --ease-cinematic in tokens.css. */
export const EASE = [0.22, 1, 0.36, 1] as const;

/** Default entrance duration for app UI (portfolio uses 1.1s for marketing). */
export const ENTRANCE_DURATION = 0.7;

/**
 * Entrance standard: fade + rise + de-blur. Use with `custom={delaySeconds}`
 * to stagger cascades. Tuned to 0.7s for snappier app-grade motion.
 */
export const blurIn: Variants = {
  hidden: { opacity: 0, y: 24, filter: 'blur(14px)' },
  show: (delay = 0) => ({
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: ENTRANCE_DURATION, ease: EASE, delay },
  }),
};

/**
 * Per-item list cascade helper: delay = index * step, capped so long lists
 * (200+ rows) settle near-instantly instead of trickling in forever.
 */
export const staggerDelay = (index: number, step = 0.05, cap = 15): number =>
  Math.min(index, cap) * step;

/** Container that staggers its children. Pair with `staggerItem`. */
export const staggerContainer = (step = 0.05): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: step } },
});

/** Standard child of a `staggerContainer`. */
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
};

/**
 * Named stagger tiers (seconds) for cascading a section's elements.
 * Denser than the portfolio's marketing rhythm — app views want quicker settle.
 */
export const STAGGER = {
  EYEBROW: 0.05,
  HEADLINE: 0.1,
  SUBHEAD: 0.2,
  BODY: 0.32,
  CTA: 0.44,
} as const;

/** Shared viewport config for scroll-triggered entrances. */
export const VIEWPORT = { once: true, margin: '-80px' } as const;
