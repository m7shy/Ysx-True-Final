# Design System — SaaS Noir

Phase 1 foundation for the CRM redesign. Adopts the portfolio's "SaaS Noir"
visual language: OLED-black canvas, a single electric-volt accent, hairline
white borders, faint translucent surfaces, and volt glows instead of drop
shadows.

## Files

- **`tokens.css`** — Tailwind v4 `@theme`. Colors (noir / volt / volt-text +
  volt hue ramp), surface/border tokens, `--ease-cinematic`, and volt glow
  custom properties. Self-contained (no imports from app code). Consumed via
  `@import "./src/design/tokens.css"` from the root `index.css`.
- **`motion.ts`** — typed motion primitives (`EASE`, `blurIn`, `staggerItem`,
  `staggerContainer`, `staggerDelay`, `STAGGER`, `VIEWPORT`). Ported from the
  portfolio's `lib/animation.js`, tuned faster (~0.7s entrances) for app UI.

## Usage contract

### Color

| Token | Use |
| --- | --- |
| `noir` (`#050505`) | page canvas only |
| `volt` (`#0201ff`) | fills, strokes, glows — **never small text** (2.38:1 on noir) |
| `volt-text` (`#6b6aff`) | text/icon accents (5.0:1 on noir, a11y-safe) |
| `surface` / `surface-hover` | card & panel fills (`white/[0.02]`) |
| `border` / `border-strong` | hairline dividers & card edges (`white/10`) |

Body text is `text-neutral-400`. Radii: pills `rounded-full`, cards
`rounded-2xl`. No drop shadows — reach for `--shadow-volt` / `--glow-volt`.

### Motion

Import from `src/design/motion.ts` (or, for back-compat, from
`components/motion/primitives.tsx`, which re-exports the same symbols).

```ts
import { EASE, blurIn, STAGGER } from '@/src/design/motion';
```

Entrances use `blurIn` (opacity 0→1, y 24→0, blur 14→0). Respect
`prefers-reduced-motion` at the component level. `EASE` is the tuple form of
`--ease-cinematic`.

## Transitional brand aliases

The legacy `--color-brand-*` ramp stays **defined** in the root `index.css`
because ~350 component class references still point at it. Phase 1 repoints the
key steps into the volt hue family so brand-classed UI shifts to the new accent
without editing every view:

- `brand-primary`, `brand-600` → volt (`#0201ff` / near)
- `brand-500` → volt-text (`#6b6aff`)
- `brand-300/400/700` → volt tints

These aliases are **transitional**. As views migrate to `volt` / `volt-text` /
`surface` / `border` tokens directly, retire the brand ramp step by step.

## Future extraction

`tokens.css` and `motion.ts` are intentionally free of app imports so they can
be lifted into a shared package (e.g. `@ysx/design`) consumed by both this CRM
and the portfolio. Keep them dependency-free (motion.ts only depends on
`motion/react` types) to make that extraction a move, not a rewrite.
