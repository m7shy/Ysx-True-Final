# UI/UX Refinement Roadmap

Status: **Planning** · Branch: `phase5-frontend-wiring` · Last updated: 2026-07-06

This roadmap covers three workstreams: Dark Mode persistence, Dashboard visual-hierarchy polish, and interaction consistency between the Campaign and Unibox views. Each phase is independently shippable, in the order listed.

---

## Phase 1 — Dark Mode via `useDarkSide` hook

### Current state
- Tailwind (CDN build) is already configured with `darkMode: 'class'` in `index.html`.
- `dark:` variant classes already exist across most components (Dashboard, Unibox, Campaigns, scrollbars in `index.css`).
- `App.tsx` holds an inline `const [darkMode, setDarkMode] = useState(false)` (line ~40) with a `useEffect` that toggles `document.documentElement.classList`. The sidebar toggle works, but **the choice is lost on every reload**, and it never respects the OS `prefers-color-scheme`.

### Target design
Create `hooks/useDarkSide.ts`:

```ts
type Theme = 'light' | 'dark';

export function useDarkSide(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('ysxflow_theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('ysxflow_theme', theme);
  }, [theme]);

  const toggle = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'));
  return [theme, toggle];
}
```

Decisions baked into this design:
- **Storage key `ysxflow_theme`**, separate from the `ysxflow_settings` blob in `SettingsContext`, so the theme resolves synchronously before any context providers mount (no flash of wrong theme inside React).
- **Lazy initializer** reads localStorage exactly once — no "light flash then dark" on mount.
- **OS fallback** via `matchMedia` when no saved preference exists; an explicit toggle always wins afterwards.

### Steps
1. Create `hooks/useDarkSide.ts` as above.
2. In `App.tsx`: delete the local `darkMode` state and its `useEffect`; replace with `const [theme, toggleTheme] = useDarkSide();`.
3. Rewire the sidebar toggle (the Sun/Moon block around line 224) to `theme === 'dark'` / `toggleTheme`.
4. (Optional, kills first-paint flash entirely) Add a 3-line inline `<script>` in `index.html` `<head>` that applies `.dark` from `localStorage.ysxflow_theme` before the bundle loads.
5. QA sweep in dark mode: every view once. Expect stragglers in `SettingsModal`, `ConfirmModal`, `ComposeNewEmail`, and toast notifications — anything with a hardcoded `bg-white` and no `dark:` twin.

**Definition of done:** toggle persists across reloads, fresh browsers follow OS preference, no view has an unreadable dark-mode element, no flash on load.

---

## Phase 2 — Dashboard polish (F-pattern hierarchy)

Users scan in an F: hard across the top, a second shorter sweep, then down the left edge. Three actionable improvements for `DashboardView.tsx`:

### 2.1 Top row: four KPI stat cards, one number each
The first horizontal scan should answer "how is my outreach doing?" in one glance.
- Exactly four cards: **Sent · Open rate · Reply rate · Meetings booked** — the outcome funnel, left to right in that order (magnitude → engagement → result).
- One large number per card (`text-3xl font-semibold`), a small muted label above, and a single delta indicator vs. the previous period (`+2.1%` in green/red). Nothing else — no sparkline, no icon soup, no secondary stats in the card.
- Card chrome: `bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl` — flat borders, no shadows or gradients competing with the numbers.

### 2.2 Left column: activity/trend chart, decluttered
The vertical scan lands on the left, so the primary chart goes top-left below the KPIs, spanning ~2/3 width (secondary content in the right 1/3).

Data-viz rules to enforce on every chart:
- **No gridlines, or horizontal-only** at `slate-100`/`slate-800` — never a full grid.
- **One or two series max.** Sent vs. replies is a story; five lines is noise. More series → separate charts.
- **Axis discipline:** 4–5 y-axis ticks, rounded numbers, no axis titles when the chart title says it ("Emails sent — last 30 days"). No legend for a single series.
- **Color = meaning:** brand-600 for the primary series, `slate-300`/`slate-600` for comparison series. Never a rainbow palette.
- **No 3D, no drop shadows, no gradient area fills** darker than ~10% opacity.
- Values on hover (tooltip), not printed on every data point.

### 2.3 Kill visual noise so hierarchy can breathe
- **One accent color per screen region.** Brand blue means "primary action / primary data" only. Demote decorative gradients, glows (`shadow-glow`), and float animations to the login/marketing screens — the dashboard is a work surface.
- **Consistent card spacing:** one gap value (`gap-4` or `gap-6`) for the whole grid, one internal padding (`p-5`) for all cards. Mixed padding reads as clutter.
- **Typography ceiling:** max 3 text sizes visible at once (KPI number, section heading, body/label). Muted labels are `text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide`.

---

## Phase 3 — Interaction consistency (Campaigns ↔ Unibox)

Define once, apply to `CampaignsListView.tsx`, `CampaignDetailView.tsx`, and `UniboxView.tsx`. Codify as small shared components in `components/ui/` (`Button.tsx`, `FilterChip.tsx`) rather than a style guide nobody reads.

### Button standard
| Variant | Classes (light + dark) | Use for |
|---|---|---|
| Primary | `bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium` | The one main action per view (New Campaign, Send) |
| Secondary | `bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg px-4 py-2 text-sm` | Everything else |
| Ghost/icon | `text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg p-2` | Row actions, toolbars |
| Destructive | Secondary shape + `text-red-600 border-red-200 dark:border-red-900/50 hover:bg-red-50 dark:hover:bg-red-950/40` | Delete, disconnect |

Rules: one primary button per view; every button gets `focus-visible:ring-2 ring-brand-500`, `disabled:opacity-50 disabled:pointer-events-none`, and `transition-colors` (150ms — no scale/translate hover effects on functional buttons).

### Filter standard
- Filters are **pill chips in a horizontal row** under the view header — same pattern in both views (Unibox: All / Unread / Replied…; Campaigns: All / Active / Paused / Draft).
- Selected: `bg-brand-600 text-white`. Unselected: `bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700`. Shape: `rounded-full px-3 py-1.5 text-sm`.
- Filters are single-select per group, apply instantly (no Apply button), show a count badge when it aids scanning, and persist per view in component state (not localStorage).
- Search inputs share one recipe: icon-left, `rounded-lg border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 focus:ring-2 focus:ring-brand-500`.

### Rollout
1. Build `Button` and `FilterChip` in `components/ui/`.
2. Migrate `UniboxView` (highest interaction density) → then `CampaignsListView`/`CampaignDetailView` → then opportunistically elsewhere.
3. Acceptance: a screenshot of a button/filter from either view is indistinguishable in style from the other.

---

## Sequencing

| Phase | Effort | Depends on |
|---|---|---|
| 1. Dark mode hook | ~1–2 h + QA sweep | — |
| 2. Dashboard polish | ~½ day | Phase 1 (new styles written light+dark once) |
| 3. Interaction consistency | ~½–1 day | Phase 1 (shared components ship with dark styles) |
