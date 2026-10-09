# OwnRAG console — implementation contract

Everything a contributor (human or agent) needs to add a screen without inventing a second
design language. **Read this file before writing any component under `web/src/pages/`.**

OwnRAG's console is a new application that talks to the **preserved upstream API surface**.
The backend is not modified by console work. See `NOTICE`.

---

## 1. Stack (already installed — do not add dependencies)

| Concern | Choice |
|---|---|
| Runtime | React 18.3, TypeScript 5.9 (strict), Vite 7 |
| Styling | Tailwind CSS **v4** (CSS-first `@theme`), tokens in `src/styles/tokens.css` |
| Primitives | Radix UI + project-authored components in `src/components/ui/` |
| Server state | TanStack Query v5 (`src/api/hooks.ts`, `src/api/query-client.ts`) |
| Client state | Zustand (`src/store/ui.ts`, `src/store/auth.ts`) — theme, nav, toasts, demo flag |
| Routing | react-router v7 (`src/routes.tsx`) |
| Icons | `lucide-react` |
| Graphs (agent canvas only) | `@xyflow/react` |
| Markdown (chat only) | `react-markdown` + `remark-gfm` |

**No new npm packages.** If something seems to need one, build it from the primitives below.

---

## 2. Design language (non-negotiable)

OwnRAG is a **monitor + operate** console: dense, glanceable, action-first. It is not a
marketing site. Concretely:

- **Never use raw colours.** Only token utilities. No `#hex`, no `bg-slate-800`, no
  `text-emerald-500`.
- **One accent.** `accent` (teal) means "interactive / selected / primary metric". `violet`
  is a second *data* hue for charts only. `ok` / `warn` / `danger` / `info` are **state only**
  — a coloured pill always means something you can act on.
- **Depth comes from hairlines and surface steps**, not shadows. Use `border-line`,
  `bg-surface-1/2/3`. `shadow-e2/e3` is for overlays and popovers only.
- **No gradients, no glassmorphism, no glow, no emoji in product chrome, no decorative
  illustrations.** Scores, ids, counts and tokens are `font-mono`.
- Type scale is small and tight: page title `text-lg`, section `text-md`, body `text-sm`,
  metadata `text-xs`, labels `text-2xs`. Headings use `tracking-[-0.015em]`.
- Radii: `rounded-md` (controls) / `rounded-lg` (panels) / `rounded-xl` (dialogs).
- Rows and controls are compact: 28–36px tall. Mobile hit targets stay ≥ 36px where the
  control is the primary action.
- Motion: 110–240ms, easing `ease-out`, no bounce. Never animate on scroll.
- Focus is always visible (the global `:focus-visible` ring is defined; don't remove it).

### Token utilities

Surfaces `bg-canvas|surface-1|surface-2|surface-3|inset` ·
Text `text-ink|ink-2|ink-3` · Lines `border-line|line-strong|line-accent` ·
Accent `bg-accent|accent-hover|accent-soft|accent-soft-strong`, `text-accent`, `text-accent-ink` ·
Data `bg-violet|violet-soft` · State `bg-ok|warn|danger|info` + `-soft` variants ·
Radius `rounded-xs|sm|md|lg|xl` · Shadow `shadow-e1|e2|e3` ·
Helpers `.or-scroll`, `.or-truncate`, `.or-grid-bg`, `.or-fade-in`, `.or-rise-in`, `.or-shimmer`

---

## 3. Components you must reuse (do not re-implement)

```
@/components/ui/button          Button (primary|secondary|outline|ghost|subtle|danger|danger-ghost|link; xs|sm|md|lg|icon|icon-sm|icon-xs; loading, asChild)
@/components/ui/input           Input, Textarea, Label, Field(label,hint,error,required,action)
@/components/ui/badge           Badge(tone, size, dot), Dot(tone)
@/components/ui/surface         Panel, PanelHeader, SectionHeader, Toolbar, Skeleton, Spinner, KeyValue, DescriptionList
@/components/ui/states          EmptyState, ErrorState, InlineError, TableSkeleton, CardGridSkeleton, StatsSkeleton
@/components/ui/data-table      Table, THead, TBody, TR, TH, TD, Column<T>, DataTable<T>, TablePagination
@/components/ui/dialog          Dialog, DialogTrigger, DialogContent(size), DialogHeader, DialogBody, DialogFooter, ConfirmDialog
@/components/ui/dropdown-menu   DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem(icon,destructive), DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuCheckboxItem
@/components/ui/tabs            Tabs, TabsList, TabsTrigger(count), TabsContent
@/components/ui/controls        Select*, Switch, Checkbox, Slider, Segmented, Tooltip*, Hint, ScrollArea, Separator, Avatar, Progress, Kbd
@/components/ui/charts          Sparkline, BarSeries, MeterBar, StackedBar, Gauge, Histogram
@/components/ui/toaster         toast({title, description, variant, duration})
@/components/brand/logo         OwnRagMark, OwnRagWordmark
@/components/app/page-header    PageHeader(title, description, actions, breadcrumb, tabs, meta), PageBody(wide)
@/lib/format                    formatNumber, formatCompact, formatBytes, formatPercent, formatScore, formatDuration, formatRelativeTime, formatDateTime, titleCase, initialsOf
@/lib/utils                     cn, shortId
```

`DataTable` already owns loading / empty / error / pagination / sorting / selection. Pass
`loading`, `error`, `onRetry`, `emptyTitle`, `emptyAction` and let it render them.

### Screen skeleton (follow exactly)

```tsx
export default function Screen() {
  return (
    <>
      <PageHeader title="…" description="…" actions={<Button …/>} meta={…} tabs={…} />
      <PageBody>{/* content */}</PageBody>
    </>
  );
}
```

---

## 4. Data layer

```
@/api/client        api.get/post/put/patch/delete/list, ApiError, isDemoMode, OFFLINE_CODE
@/api/endpoints     endpoints.*  (mirrors the backend routes 1:1)
@/api/hooks         query hooks + key factories (KnowledgeKeys, ChatKeys, AgentKeys, ModelKeys, SystemKeys, …)
@/api/chat-stream   streamChat({ body, signal }) -> async iterator of { kind: 'delta'|'reference'|'done'|'thought', text?, citations? }
@/api/types         KnowledgeBase, KbDocument, Chunk, ChatAssistant, ChatMessage, Agent, ModelProvider, Connector, …
```

Rules:

1. **Every screen must work in both live and demo mode.** Never branch on demo mode for
   layout; the transport already routes to the seeded corpus. Only use `isDemoMode()` to
   change *copy* (e.g. "Connect the API server to run this for real").
2. Use the hooks in `@/api/hooks.ts`. If a hook you need is missing, write a local
   `useQuery` in your own page file against `@/api/client` — **do not edit shared files**.
3. Query keys: use the exported factory (`KnowledgeKeys.documents(id, params)`), never a
   raw array.
4. Mutations: call `toast(...)` on success and on error (`error.message`).
5. **Never fabricate numbers.** If an endpoint returns nothing to chart, render an empty
   state that says what would populate it. No random data, no lorem ipsum, no placeholder
   metrics.

---

## 5. Route ownership and file layout

| Route | File(s) |
|---|---|
| `/` | `pages/home.tsx` → `pages/landing-b.tsx` for a visitor, redirect to `/overview` for an operator |
| `/login`, `/signup`, `*` | `pages/login.tsx`, `pages/signup.tsx`, `pages/not-found.tsx` |
| `/knowledge` | `pages/knowledge/list.tsx` + `pages/knowledge/components/kb-card.tsx`, `create-kb-dialog.tsx` |
| `/knowledge/:kbId` | `pages/knowledge/detail.tsx` + `pages/knowledge/components/documents-table.tsx`, `kb-settings-form.tsx`, `kb-retrieval-panel.tsx`, `upload-dialog.tsx`, `kb-metadata-panel.tsx` |
| `/knowledge/:kbId/documents/:docId` | `pages/knowledge/document.tsx` + `pages/knowledge/components/document-viewer.tsx`, `chunk-outline.tsx` |
| `/retrieval` | `pages/retrieval.tsx` + `pages/retrieval/*` |
| `/chat`, `/chat/:chatId`, `/chat/:chatId/:sessionId` | `pages/chat.tsx` + `pages/chat/*` |
| `/agents`, `/agents/:agentId` | `pages/agents/list.tsx`, `pages/agents/builder.tsx` + `pages/agents/*` |
| `/models`, `/data-sources`, `/memory`, `/mcp`, `/settings`, `/developers` | `pages/models.tsx`, `pages/data-sources.tsx`, `pages/memory.tsx`, `pages/mcp.tsx`, `pages/settings.tsx`, `pages/developers.tsx` |
| `/invite/:token` (public shell) | `pages/invite.tsx` — accepts a workspace invitation; the token in the URL is the credential |

- Default-export the route component. Named sub-components live in the same folder.
- kebab-case filenames, PascalCase exports, `Column<T>` arrays for tables.
- Workspace membership lives in Settings → Team: the members and their roles, and the invitations
  that have been issued. The console hides the controls the engine would refuse; the engine is the
  authority for roles, invitations and removals (`docs/SECURITY.md`).
- **A workspace is not a shared folder.** A new signup gets one of its own **and owns it** — the
  account that creates a workspace is its owner from its first request, so Models, Memory and Developers
  work for every account rather than only the original one. An invitation is the
  only way into someone else's. Inside one, the owner and admins see everything and a member sees what
  it created. Removing a member ends their sessions and moves the account — with the knowledge bases it
  created — back to a workspace of its own; it does not delete the account. A roster is readable only
  by its own workspace, and the manager-only surfaces (Models, Memory, Developers) carry `manager: true`
  in `nav.ts` and are not offered to a member.
- **Removing a provider is a first-class action**, on the provider card behind a confirm. It deletes the
  provider and the models it serves, including the stored key, and moves any assistant pinned to one of them
  back to the workspace's own model. The engine refuses its own in-process provider, and reports that refusal
  as data (`removable` on the payload) so the console hides the action instead of offering one that fails.
  A provider can only be read, edited or removed by the workspace that added it.
- **The model that answers is chosen in the chat tab.** The chat header's model is a menu over the models
  this workspace may pin — its own providers' chat models and the engine's own, which is listed first because
  it needs no key and cannot fail. One it cannot use (the provider was removed, or the model was switched
  off) stays visible and unpickable, so the header never names a model that did not answer. Choosing one
  writes the pin through `PATCH /chats/{id}`; the list behind it is `GET /users/me/models`, which resolves
  what the *deployment* is using now as its default and lists everything the workspace *may* choose.
- **The engine's own model answers unless an assistant pins one.** A registered provider is used when an
  assistant selects it, never merely because it exists — registering one must not reroute every chat in the
  deployment. A pinned model is honoured only inside the workspace that owns the provider; anywhere else the
  workspace's own model answers, so a stale pin cannot route an answer through someone else's key.
- Import with the `@/` alias, never a long relative path.
- Every new file starts with:
  `/* Copyright 2026 OwnRAG contributors — Apache-2.0. */`

---

## 6. Required states for every async surface

Each list/table/detail must render all four:

1. **Loading** — `TableSkeleton` / `CardGridSkeleton` / `StatsSkeleton` (shape-matched).
2. **Empty** — `EmptyState` with the reason and the action that fills it.
3. **Error** — `ErrorState` with `onRetry` (the query's `refetch`).
4. **Loaded** — data.

Plus, for long operations: a determinate `Progress` with the stage label, and a running
state that keeps polling (hooks already do this for `RUNNING` documents).

## 7. Responsive rules

- `lg` and up: sidebar visible, panels may sit side by side (e.g. list + inspector).
- `md`: single column, panels stack, tables scroll horizontally inside `or-scroll`.
- `<md`: primary action stays reachable (sticky footer or header), drawers instead of side
  panels, no horizontal page overflow, nothing under 36px that is a primary tap target.
- Never rely on hover alone for a critical affordance.

## 8. Verification before you report done

```bash
cd web && npx tsc --noEmit       # must be clean for the files you wrote
```

Do not run `npm install`, `npm run dev` or `npm run build` (the integrator does that once).
Report: files written, which hooks/endpoints each screen uses, anything you could not verify.
