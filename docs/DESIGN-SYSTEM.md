# OwnRAG design system

The console at `web/` is a new product surface built on the preserved upstream API. This
document is the reasoning behind it: what each rule is for, and what it prevents.

---

## 1. Surface before style

Most redesigns fail compositionally, not cosmetically: a dashboard gets a marketing hero, a
settings page gets a feature grid, and no amount of colour work fixes it. So OwnRAG names the
surface archetype before choosing any token.

| Screen | Archetype | Consequence |
|---|---|---|
| Overview | **Monitor** | Density and glanceability. No hero, no centred stack. Metrics tile, then pipeline, then what needs a decision. |
| Knowledge, Documents | **Operate** | Action affordances and selection state dominate. Dense tables, row actions, bulk bars. |
| Retrieval console | **Command / Inspect** | Controls on the left, ranked results on the right, keyboard-first. |
| Chat | **Command / Inspect** | Transcript is primary; citations are an inspector, not a footer. |
| Agent builder | **Operate** | Canvas + inspector; the graph is the object, the panel edits it. |
| Models, Data sources, Settings | **Configure** | Progressive disclosure, explicit save state, minimal decoration. |
| Sign-in | **Decide** | The one legitimate hero: what OwnRAG is, in one screen. |

The `hero + three equal cards` composition is correct **only** on the sign-in surface.

## 2. Tokens

Everything is a semantic token. Components never contain a hex value, and Tailwind palette
colours (`slate-800`, `emerald-500`) are never used directly. Tokens live in
`web/src/styles/tokens.css` (values) and are mapped into utilities in
`web/src/styles/globals.css` (Tailwind v4 `@theme inline`).

### Colour

One accent — **OwnRAG Signal**, a teal-green. It was chosen deliberately over the
indigo/violet that most AI products default to, because the product's subject is
*infrastructure you own*, not a chatbot. `violet` is a second hue reserved for **data**
(second series in a chart, secondary scores), never for interaction.

`ok` / `warn` / `danger` / `info` are **state only**. A coloured pill always means something
the operator can act on; there is no decorative colour anywhere in the console.

Light and dark are both first-class. Dark is the default posture (long sessions, dense
tables), light is a complete counterpart (`color-scheme` is set on both, so native controls
follow).

### Depth

Two devices, in order:

1. **Hairlines** — `border-line` (8.5% white on dark, 10% black on light) carries the
   structure. Not 1px grey boxes: a single hairline between rows, panels, and shell regions.
2. **Surface steps** — `canvas → surface-1 → surface-2 → surface-3`. Elevation is expressed
   by stepping up one surface, plus a hairline.

Shadows (`shadow-e1/e2/e3`) exist only for elements that genuinely float: dropdowns,
popovers, dialogs, toasts. There is no glassmorphism, no blur, no gradient, no glow.

### Type

`Geist` for the interface, `Geist Mono` for anything an operator compares or copies:
identifiers, scores, token counts, model names, cron schedules, spans. Tabular numerals are
on globally so columns line up without extra work.

The scale is small and tight (page title 18px, body 14px, metadata 12px, labels 11px) because
the console is read at a glance, not read linearly. Headings use negative tracking; nothing
is larger than it needs to be.

### Space, radius, motion

4px spacing grid. Radii: 6px controls, 8px panels, 10px grouped surfaces, 14px dialogs.
Motion is 110–240ms with `cubic-bezier(0.16, 1, 0.3, 1)` — it clarifies state changes and
loading, never decorates. `prefers-reduced-motion` collapses all of it.

## 3. Components

`web/src/components/ui/` is the shared library. It is organised by role, not by screen:

- **Action** — `button.tsx` (8 intents × 7 sizes), `dialog.tsx` (`ConfirmDialog` for anything
  irreversible; the destructive label repeats the verb, never "OK").
- **Input** — `input.tsx` (`Input`, `Textarea`, `Field` with label/hint/error), `controls.tsx`
  (select, switch, checkbox, slider, segmented, tooltip, scroll area, avatar, progress, kbd).
- **Display** — `surface.tsx` (panel, header, toolbar, description list), `badge.tsx` (tone =
  state), `charts.tsx`, `data-table.tsx`.
- **State** — `states.tsx`: `EmptyState`, `ErrorState`, `OfflineState`, `InlineError` and
  shape-matched skeletons. **Every async surface renders all four states** — loading, empty,
  error, loaded. This is the single most enforced rule in the codebase.
- **Feedback** — `toaster.tsx`.

App-level composition lives in `web/src/components/app/` (sidebar, topbar, command palette,
page header) and `web/src/components/brand/` (mark + wordmark).

### Charts are hand-rolled SVG

There is no charting dependency. `Sparkline`, `BarSeries`, `MeterBar`, `StackedBar`, `Gauge`
and `Histogram` are ~40 lines each, drawn from real numbers. Two reasons: the bundle stays
lean, and a chart that is cheap to add but *only* renders with data makes decorative
dashboard filler harder to justify. **If a panel has no data, it renders an empty state that
names what would populate it — never a fabricated curve.**

## 4. Identity

The mark is an abstract "owned core": a container, four wired corners, and a node at the
centre, drawn from three primitives so it survives 16px. The wordmark is *type*, not a
redrawn logo — `Own` in the interface face, `RAG` in mono — which is what makes it read as an
independent product rather than a re-lettered badge.

Brand rules for contributors: [`BRAND-RULES.md`](BRAND-RULES.md). Naming inventory and
what was deliberately left unchanged: `NOTICE`.

## 5. Accessibility

- Focus is always visible: a 2px accent ring with 1px offset, globally defined, never removed.
- Colour is never the only signal — state pills carry text, trends carry numbers.
- Contrast: ink on canvas is ≥ 12:1 in dark and ≥ 13:1 in light; secondary text stays above
  4.5:1 in both.
- Hit targets: 28–36px for dense controls, ≥ 36px for primary actions on touch layouts.
- Semantic HTML first (`nav`, `main`, `header`, `table`, `dl`), ARIA only where the pattern
  has no element (`aria-label` on icon buttons, `role="status"` on toasts).
- `Escape` closes overlays, `⌘K` opens the palette, `⌘[` collapses the sidebar.
