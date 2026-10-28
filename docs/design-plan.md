# Forever Gold Tracker — Design Plan

Status: plan only. No code changed.
Date: 2026-10-28. Game launch: 2026-11-04.
Scope: visual theme, UI/UX fixes, Wowhead item links. Plain CSS + React, no UI framework.

Guiding rule: **numbers first.** Decoration never slows down reading gold or entering data.
Since spec §9b, most data arrives by sync. The UI should show data first and hide manual forms.

---

## 1. Current UI audit

Checked in code (`src/App.tsx`, `src/ui.tsx`, `src/styles.css`, `src/pages/*.tsx`) and in the
running app at 1280 px and 375 px width (empty test database at `[::1]`).

### Ranked by impact

| # | Problem | Where | Impact |
|---|---|---|---|
| 1 | **Forms come before data.** Every page opens with an "Add / Record / Set" form card. The data the user came to read sits below it. Since sync fills most data, the forms are now the rare case. | Ledger, Prices, Inventory, Professions, Goals, Crafting, Overview (gold form per character) | High |
| 2 | **Phone nav eats the screen.** The 10 links wrap into a 158 px block above every page (about 20% of an 812 px screen). There is no grouping, no icons, no bottom bar. | `App.tsx`, `nav.side` media query | High |
| 3 | **Tables will overflow on phones.** No table has an `overflow-x: auto` wrapper. Sessions (9 columns), Prices (7 columns with inputs) and Crafting push the page wider once data exists. The empty test DB hides this today. | all tables | High |
| 4 | **Overview is not a home.** It shows totals and a chart. It does not show what needs attention (to-do), sync status, goals, or recent sessions. The recent-ledger table has no header row. | `Overview.tsx` | High |
| 5 | **Numbers don't line up.** No `tabular-nums`. `Money` parts have variable width, so columns of g/s/c jitter. No sorting on any table. No sticky headers on long tables. | `ui.tsx` `Money`, `styles.css` | Medium |
| 6 | **Weak feedback.** Sync results appear as a plain card at the top of `<main>` for 8 s, without `aria-live`. Save actions give no confirmation. Delete (✕) acts at once, with no undo or confirm. Inline vendor/deposit inputs in Prices save on blur silently. | `App.tsx`, `Ledger.tsx`, `Prices.tsx` | Medium |
| 7 | **No loading state.** `useLiveQuery(...) ?? []` shows "No entries yet" for a moment before data loads. This looks like data loss. | all pages | Medium |
| 8 | **Layout hacks.** About 45 inline `style={{…}}` uses. Empty `<span style={{minHeight:16}}>` under every field and `marginBottom:20` on submit buttons fake alignment. | all forms | Medium (maintenance) |
| 9 | **Focus and buttons.** Inputs have a focus outline; buttons and links do not. Primary buttons are a cold blue (`#2c3a55`) unrelated to the theme. Primary vs secondary is unclear. The Sync nav count uses `badge Craft` (a verdict color) for a count. | `styles.css`, `App.tsx` | Medium |
| 10 | **Long Sync page on phones.** 3240 px tall at 375 px. The coverage table (4 columns of prose) wraps badly. Setup steps and to-do list compete. | `Sync.tsx` | Medium |
| 11 | **Bare empty states.** "No items recorded." does not say where data comes from (sync) or what to do. | all pages | Low–Medium |
| 12 | **Generic look.** System font, grey-blue palette, no identity. Chart colors are hard-coded hex in `Overview.tsx` and `Professions.tsx`. Items are plain text with no icon or quality color. | global | Low (but it is the user's request) |

### Per page (short)

- **Overview:** good welcome card. Gold entry form on every character card is noise once sync works. No to-do, goals or sessions.
- **Sync & to-do:** clear checklist logic. Too long. "Value" badges reuse verdict colors. To-do is the most useful content and it is the second card.
- **Ledger:** 6-field form first. Filter row and totals share one flex row and wrap unevenly. Delete without undo.
- **Inventory:** form first. Good "no price" handling. Needs sort by value.
- **Prices:** two jobs on one table (latest price and editing vendor/deposit). Inline inputs in every row are heavy on phones. History only appears after clicking a row, with no affordance.
- **Crafting:** recipe editor dominates. Verdict is the key output and should be the first column after the name.
- **Professions:** fine. "Click a row" is a hint, not an affordance.
- **Sessions:** active session card uses a hard-coded border color. Results table is the widest in the app.
- **Goals:** progress bar is good. Estimated date should be more prominent.
- **Settings:** OK. Will host the Wowhead toggle.

---

## 2. Theme: "Stone and gold ledger"

WoW-*inspired*: dark warm stone, parchment text, gold trim, item quality colors.
No Blizzard assets. See licensing table at the end of this section.

### 2.1 Color tokens (dark only)

Contrast ratios are WCAG 2.x, computed for this plan. Backgrounds: `--bg` / `--panel` / `--panel-2`.

| Token | Hex | Use | Contrast on bg / panel / panel-2 |
|---|---|---|---|
| `--bg` | `#15130f` | page background (warm near-black stone) | — |
| `--panel` | `#1e1b16` | panels, nav | — |
| `--panel-2` | `#29251e` | inputs, hover rows, table header | — |
| `--border` | `#3a342a` | hairlines, dividers | decorative only |
| `--trim` | `#6b5a32` | gold trim on panel tops, active nav edge | 2.8 / 2.6 / 2.3 (non-text, ≥ 3:1 not required for decoration; not used for focus) |
| `--text` | `#ece4d3` | body text (parchment) | 14.7 / 13.6 / 12.1 |
| `--muted` | `#a89f8c` | labels, secondary text | 7.1 / 6.5 / 5.8 |
| `--faint` | `#8a8170` | timestamps only, ≥ 12 px | 4.8 / 4.5 / 4.0 (not on `--panel-2`) |
| `--accent` | `#e8c25a` | headings, active nav, primary button fill, focus ring | 10.9 / 10.1 / 8.9 |
| `--on-accent` | `#15130f` | text on gold buttons | 10.9 on `--accent` |
| `--link` | `#8ab8ff` | in-text links | 9.2 / 8.5 / 7.5 |
| `--good` | `#6fd18a` | income, done, Craft verdict | 9.9 / 9.1 / 8.1 |
| `--bad` | `#f07a6e` | expense, errors, delete | 6.8 / 6.3 / 5.6 |
| `--warn` | `#e9a23b` | stale price, partial | 8.6 / 7.9 / 7.0 |

Money colors (keep existing convention, contrast checked):

| Token | Hex | Contrast bg / panel / panel-2 |
|---|---|---|
| `--gold` | `#ffd100` | 12.7 / 11.8 / 10.4 |
| `--silver` | `#c7c7cf` | 11.0 / 10.2 / 9.1 |
| `--copper` | `#e09a5c` (was `#d08a4c`, lifted) | 7.9 / 7.3 / 6.5 |

`--gold` (money) and `--accent` (UI) are kept distinct: money is bright yellow, UI chrome is a softer gold.

### 2.2 Item quality colors (game convention, not a Blizzard asset)

Classic values. Two are too dark on our background for text, so text uses a lifted variant.

| Quality | Game hex | Contrast on `--panel` | Text token used |
|---|---|---|---|
| Poor | `#9d9d9d` | 6.3 | `--q0: #9d9d9d` |
| Common | `#ffffff` | 17.2 | `--q1: #ffffff` |
| Uncommon | `#1eff00` | 12.6 | `--q2: #1eff00` |
| Rare | `#0070dd` | 3.6 ✗ | `--q3: #4a9eff` (6.2) |
| Epic | `#a335ee` | 3.5 ✗ | `--q4: #b56cf5` (5.3) |
| Legendary | `#ff8000` | 6.8 | `--q5: #ff8000` |

Use the game hex only for icon borders (non-text). Quality is never the only signal: the tooltip and the name carry it too.
Note: the `items` table has no quality field today. See §3.6 and decision D4.

### 2.3 Typography

| Role | Font | License | Fallback | Use |
|---|---|---|---|---|
| Display | **Marcellus** (Google Fonts) | SIL OFL 1.1 | `Georgia, 'Times New Roman', serif` | app name, page titles (h1), panel titles (h2). Never in tables or inputs. |
| Body / UI | **Source Sans 3** (Google Fonts, variable) | SIL OFL 1.1 | `system-ui, 'Segoe UI', sans-serif` | everything else |
| Numbers | Source Sans 3 with `font-variant-numeric: tabular-nums` | same | same | all `Money`, counts, percents |

- Marcellus is a flared Roman face. It gives the carved-inscription feel of WoW UI titles **without** copying Friz Quadrata (commercial, not used).
- Self-host with `@fontsource/marcellus` and `@fontsource-variable/source-sans-3` (npm, bundled by Vite). No request to Google at runtime. (Assumption: package names as of 2026; verify on install.)
- `font-display: swap`. Only Latin subsets, weights 400/600/700 → about 60–90 KB.

Type scale (px / line-height): 12/16 caption · 13/18 table · 14/20 body · 16/22 lead & stat label · 20/26 panel title · 26/32 page title · 32/36 hero stat (total gold).
Uppercase labels: 12 px, `letter-spacing: 0.06em`, `--muted`.

### 2.4 Spacing, radius, borders

- Spacing scale: `--s1 4px`, `--s2 8px`, `--s3 12px`, `--s4 16px`, `--s5 24px`, `--s6 32px`. Use `gap`, not margins between siblings.
- Page gutter: `max(16px, env(safe-area-inset-left))` / right. Max content width 1200 px.
- Radius: `--r-sm 4px` (inputs, badges), `--r-md 6px` (panels). Square-ish corners read more "carved" than pill shapes.
- **Panel style:** `--panel` fill, 1 px `--border`, plus a 1 px `--trim` line on the top edge only (`box-shadow: inset 0 1px 0 var(--trim)`). No drop shadows, no textures. One subtle radial gradient on `body` (stone vignette, CSS only) is optional.
- Data tables inside panels have no extra border; rows use `--border` hairlines.

### 2.5 Iconography

- **UI icons:** Lucide via `lucide-react` (ISC license, tree-shaken, ~1 KB per icon). Used in nav, buttons, empty states. 18 px, `stroke-width 1.75`, `currentColor`.
  - Suggested: Overview `Home`, Sync `RefreshCw`, Ledger `BookOpen`, Inventory `Backpack`, Prices `Scale`, Crafting `Hammer`, Professions `GraduationCap`, Sessions `Fish`, Goals `Target`, Settings `Settings`.
- **Item icons:** only through the official Wowhead tooltip script (§3). We never download, copy or rehost Blizzard icon files.
- No class icons, no faction crests, no logos.

### 2.6 Money display

- Keep `Money` and the g/s/c letters (readable, accessible, no images).
- Add a small coin dot before each unit: an 0.6 em CSS circle in `--gold` / `--silver` / `--copper` (pure CSS, not a game asset). Letters stay for screen readers and colorblind users.
- `tabular-nums`, `white-space: nowrap`. In tables, right-align and give the silver and copper parts a fixed 2-digit width (`min-width: 2ch`), so `1,234g 5s` and `12g 40s 3c` line up by unit. Option `compact` hides copper when gold ≥ 100.
- Signed values: `+` / `−` (U+2212) and `--good` / `--bad` on the sign only, so the coin colors stay readable.
- Hero variant (`size="xl"`) for total gold on Overview.

### 2.7 Licensing summary

| Thing | Status |
|---|---|
| Colors, quality color convention | Inspired-by. Colors are not copyrightable; we lift two for contrast. |
| Marcellus, Source Sans 3 | Licensed: SIL OFL 1.1, self-hosted. |
| Lucide icons | Licensed: ISC. |
| Coin dots, panel trim, stone gradient | Our own CSS. |
| Item icons and tooltips | Served by Wowhead's official public script from Wowhead's servers. Not stored or rehosted by us. |
| Blizzard / WoW: Forever logos, splash art, game UI textures, Friz Quadrata | **Not used.** |
| Names "World of Warcraft", "WoW: Forever" | Text only, to describe compatibility. Add a footer line: "Fan-made tool. Not affiliated with or endorsed by Blizzard Entertainment or Wowhead." |

---

## 3. Wowhead integration

### 3.1 Verified facts (checked 2026-10-28)

- Official page: https://www.wowhead.com/tooltips . Install snippet, quoted from it:
  `const whTooltips = {colorLinks: true, iconizeLinks: true, renameLinks: true};` then
  `<script src="https://wow.zamimg.com/js/tooltips.js"></script>`.
- Options read by the current script: `colorLinks`, `iconizeLinks`, `renameLinks`, `iconSize` (`tiny` default, `small`, `medium`, `large`), `hide`. Per link: `data-wh-icon-size`, `data-wh-rename-link`, and `data-wowhead="item=ID&domain=…"`. Any `href` works if `data-wowhead` is set.
- The page says the script is meant for fan sites and lists other community sites using it. It shows tooltips on hover and on tap on mobile.
- **Forever has its own data branch.** The live `tooltips.js` defines `WH.dataEnv.CLASSICPLUS = 16` and maps it to the URL prefix `"forever"` (also accepts `classic-plus`). So links of the form `https://www.wowhead.com/forever/item=<id>` select Forever data.
- The tooltip data API answers for that branch: `nether.wowhead.com/tooltip/item/2589?dataEnv=16` returned "Linen Cloth", quality 1, icon `inv_fabric_linen_01`.
- `https://www.wowhead.com/classic/item=2589` resolves (301 to the named page). Classic Era is the fallback branch.
- `WH.Tooltips.refreshLinks()` exists (legacy alias `$WowheadPower.refreshLinks()`). Needed after React renders new links.

### 3.2 Assumptions (to verify in a real browser at launch)

- A plain `curl` of `https://www.wowhead.com/forever/item=2589` returned HTTP 403 (likely bot protection). Assumed to work in a browser. Check once by hand.
- Forever item ids equal Classic Era item ids for Classic-era items (the addon reads the game's own ids, so links use the right id either way).
- `iconizeLinks` inserts an icon element inside our `<a>`. React must not fight it (see §3.4).
- Terms: no separate Wowhead terms page was found for the script (`/terms-of-use` returned 404). The tooltip page invites fan-site use. We follow it as published: load from their URL, do not scrape the data API, do not rehost icons. Re-check if Wowhead publishes terms.

### 3.3 Link format

```
<a class="item-link q{quality}"
   href="https://www.wowhead.com/forever/item={gameItemId}"
   data-wowhead="item={gameItemId}"
   target="_blank" rel="noopener noreferrer">{item.name}</a>
```

- Branch is a setting: `forever` (default) or `classic`. Stored as the URL prefix.
- Items without `gameItemId` (created by hand) render as plain text with a neutral icon placeholder. No link.
- `renameLinks: false`. We keep our own names, so React stays the owner of the link text.
- `colorLinks: true` gives quality color even before we store quality ourselves.
- `iconizeLinks: true`, `iconSize: 'small'` in tables (18 px), `medium` in detail panels.

### 3.4 Loading in a React SPA

- New hook `useWowhead(enabled)` in `src/wowhead.ts`:
  - When enabled and not loaded: set `window.whTooltips`, append the `<script>` once.
  - When disabled: do not load. (A loaded script cannot be unloaded; turning it off takes effect on reload. The toggle says so.)
- `ItemLink` calls a debounced `WH?.Tooltips?.refreshLinks()` in `useEffect` after mount.
- Give each `ItemLink` anchor `key={gameItemId + branch}` and only a text child, so the icon node Wowhead inserts is not reconciled by React.
- Never await the script. Links are normal `<a>` elements and work without it.

### 3.5 Fallback, offline, blocked

- Script fails, is blocked (ad blockers often block `zamimg.com`), or offline: links show as plain colored text with our 18 px placeholder square (border in quality color if known). No error shown.
- `<script onerror>` sets a flag. Settings shows "Wowhead tooltips: blocked or offline" so the user knows why icons are missing.
- No tooltip data is cached by us.

### 3.6 Item quality

- Short term: `colorLinks` colors names when the script is on.
- Better: the addon already calls item APIs. Store `quality` (0–5) on `items` during sync, then color names offline too. Needs an addon + sync change (decision D4).

### 3.7 Privacy and the Settings toggle

- When on, the browser sends requests to `wow.zamimg.com` and `nether.wowhead.com`. Those requests include the user's IP address, browser data, the referrer (the Pages URL) and the ids of items hovered or shown. Wowhead may set cookies.
- No gold amounts, character names or ledger data are sent.
- Settings → new panel "Item links":
  - Toggle "Show item icons and tooltips from Wowhead" with the sentence above.
  - Select "Wowhead data: Forever / Classic Era".
- New `Settings` fields: `wowheadTooltips: boolean`, `wowheadBranch: 'forever' | 'classic'`. Settings is one record, so no Dexie schema version bump is needed (defaults fill in).
- Default on or off: decision D2.

---

## 4. UX improvements

### 4.1 Navigation

Group the 10 pages:

| Group | Pages |
|---|---|
| — | Overview |
| Money | Ledger, Goals |
| Market | Prices, Inventory, Crafting |
| Play | Sessions, Professions |
| Setup | Sync & to-do, Settings |

- **Desktop (≥ 900 px):** left sidebar 220 px, sticky, app name in Marcellus, group labels (uppercase caption), icon + label per link. Active link: `--panel-2` fill, gold left edge (`--trim`), `--text` color, `aria-current="page"`. Footer: sync status chip ("Synced 4 min ago" / "Not connected").
- **Tablet (600–899 px):** icon-only rail (64 px) with labels as `title` and visible on focus.
- **Phone (< 600 px):** fixed bottom bar with 5 targets: Overview, Ledger, Prices, Sessions, **More**. "More" opens a sheet with the full grouped list. Bar height 56 px + `env(safe-area-inset-bottom)`. Count badge (High to-dos) on "More" and on Sync. This frees the 158 px the current nav takes.
- The to-do count badge uses a neutral gold "count" style, not the Craft verdict color.
- Set `document.title` per page ("Ledger · Forever Gold").

### 4.2 Overview as home

Order, top to bottom:

1. **Status line:** sync chip (last sync, "Sync now" button) and realm name. Warnings from the last sync appear here.
2. **Hero:** total gold (`Money size="xl"`), with Today / 7 days / Since start as signed deltas in one row.
3. **Character tiles** (StatTile): name, class, gold, "updated 12 min ago". Manual gold entry moves behind a small "Correct gold" button that opens an inline field.
4. **Needs you:** top 3 to-dos from `useTodos()` with value badge and a link "All to-dos →". Hidden when empty.
5. **Gold over time** chart (themed, see §4.8).
6. **Goals:** each goal as one row with progress bar and estimated date. Link to Goals.
7. **Recent activity:** last 8 ledger entries and last 3 sessions, merged by time, with a header row.

Phone: one column in the same order. Character tiles in a 2-column grid.

### 4.3 Tables (DataTable)

- Every table sits in a `.table-wrap { overflow-x: auto }` so the page never scrolls sideways.
- Sticky `thead` inside the wrapper (`position: sticky; top: 0; background: --panel-2`).
- Click-to-sort headers with `aria-sort`, keyboard operable (buttons in `th`). Default sort per table (e.g. Inventory by value desc, Prices by name).
- Numbers right-aligned, `tabular-nums`. Text left. Dates as relative age with full date in `title`.
- Row actions (delete) in the last column, icon button with `aria-label`.
- Phone: low-priority columns get `data-priority="low"` and are hidden under 600 px (e.g. Source, Note). The first column stays sticky on horizontal scroll for wide tables (Sessions).
- Clickable rows (Prices, Professions) show a chevron and are focusable (`tabindex=0`, Enter to open).

### 4.4 Forms

- Move every manual form behind a disclosure button in the panel header: "+ Add entry", "+ Record price", "Set count". Closed by default once data exists; open by default when the table is empty.
- Remove the spacer spans. One `Field` component handles label, input, help and error with a reserved line only when needed. Align the submit button with `align-items: end` on the row.
- Defaults: character = last used (remember in `localStorage`), date = now (hide the date field behind "Change date"), category = last used, ledger type inferred from the sign (`-5g` = expense).
- Ledger: 3 visible fields (character, amount, category) + optional note.
- Prices: move vendor price and deposit edits out of table rows into the item detail panel (opens on row click). The table becomes read-only and scans faster.
- Enter submits. After save: clear amount, keep focus in the first field, show a toast.

### 4.5 Empty states

One `EmptyState` component: icon, one sentence on where data comes from, one action.
Examples:
- Ledger: "Ledger entries arrive when you sync after playing. — Go to Sync · Add by hand"
- Prices: "Prices come from Auctionator scans. Run a full scan at the AH, then /gt sync."
- Sessions: "Start fishing in game. A session starts on your first catch."

### 4.6 Feedback and toasts

- `Toast` region (`role="status"`, `aria-live="polite"`), bottom-right on desktop, above the bottom bar on phones. Auto-hide after 5 s, pause on hover.
- Sync result → toast "Synced: 12 new events, 340 prices". Warnings → toast with `--warn` stripe and a link to Sync.
- Delete → immediate delete + toast "Entry deleted · Undo" (keeps the row in memory for 6 s and re-adds it). Simpler and faster than a confirm dialog.
- Inline edits → small "Saved" text next to the field for 2 s.

### 4.7 Loading states

- Distinguish `undefined` (loading) from `[]` (empty) in `useLiveQuery` results. Add a small `useLive()` wrapper that returns `{ data, loading }`.
- Loading: skeleton rows (3 grey bars, `--panel-2`) for 300 ms+ only, to avoid flicker. IndexedDB is fast, so most users will never see them.
- Sync button shows a spinner and "Syncing…" and is disabled while busy.

### 4.8 Charts

- Recharts colors from CSS variables (read once via `getComputedStyle`), not hex literals.
- Gold line in `--gold`, area fill at 12% opacity, grid `--border`, axis text `--muted`, last point emphasized with a dot and label.
- Tooltip styled like a Panel, values through `formatMoney`.

### 4.9 Accessibility

- Visible focus on every interactive element: `outline: 2px solid var(--accent); outline-offset: 2px` via `:focus-visible`.
- Hit targets ≥ 40 px on phones (nav, row actions).
- `prefers-reduced-motion`: no sheet/toast slide, fade only.
- Color is never the only signal: verdicts have text, signs have +/−, stale prices have a "stale" label as well as orange.
- Skip link "Skip to content".

---

## 5. Components

All in `src/ui/` (split `ui.tsx` into a folder; keep `src/ui.tsx` re-exporting during migration).

| Component | Spec |
|---|---|
| **tokens** (`src/styles/tokens.css`) | All CSS variables from §2. Only file with hex values. |
| **Panel** | `<section>` with optional `title`, `actions` (right side of header, e.g. "+ Add"), `children`. Trim line on top. Props: `title`, `actions`, `tone?: 'default'|'active'` (active = gold border, for the running session). |
| **PageHeader** | h1 in Marcellus, optional one-line description and right-side actions. Sets `document.title`. |
| **StatTile** | Label (caption), value (`Money` or number), optional delta and sub-line. Equal height in a grid. |
| **DataTable** | Props: `columns` (`key`, `label`, `align`, `sort`, `priority`, `render`), `rows`, `rowKey`, `defaultSort`, `onRowClick?`, `empty`. Renders wrapper, sticky head, sortable headers, empty state. Plain `<table>`; no virtualisation needed at this data size. |
| **ItemLink** | Props: `item` (`name`, `gameItemId?`, `quality?`), `size?: 'small'|'medium'`. Renders Wowhead link (§3.3) or plain text + placeholder. Reads the setting from context. |
| **Money** | Existing component plus `size?: 'sm'|'md'|'xl'`, `compact?`, coin dots, tabular nums, U+2212 minus. API stays compatible. |
| **Badge** | `tone: 'neutral'|'good'|'warn'|'bad'|'accent'|'count'`. Replaces `.badge.Craft/.Sell/.Vendor`. `VerdictBadge` and `ValueBadge` map onto it. |
| **Nav** | Data-driven from one `NAV` array (`path`, `label`, `icon`, `group`, `mobile`). Renders sidebar, rail or bottom bar + More sheet by CSS breakpoint. |
| **Field / MoneyField / ItemField / CharacterSelect** | Shared label/help/error layout. No spacer spans. `id` + `htmlFor`. |
| **Disclosure** | Button that toggles a form region (`aria-expanded`, `aria-controls`). |
| **EmptyState** | Icon, text, up to two actions. |
| **Toast** (`ToastProvider`, `useToast()`) | Queue, `role="status"`, optional action (Undo). |
| **Skeleton** | Grey bars for loading rows and tiles. |

---

## 6. Implementation plan

Each step ships alone and leaves the app working. Run `npm test` and check 375 px and 1280 px after each.
Effort: S ≈ under 2 h, M ≈ half a day, L ≈ a day.

| # | Step | Files | Effort |
|---|---|---|---|
| 1 | **Tokens and base reskin.** Add `tokens.css`, swap palette, fonts (`@fontsource` packages), focus-visible, button styles (gold primary, quiet secondary), panel trim, tabular nums. No markup changes. | `src/styles.css`, new `src/styles/tokens.css`, `src/main.tsx`, `package.json` | S |
| 2 | **Table wrapper and money alignment.** Wrap all tables in `.table-wrap`, sticky header, `Money` coin dots + sizes. Fixes phone overflow before data grows at launch. | `styles.css`, `ui.tsx`, all pages (wrap only) | S |
| 3 | **Navigation.** `NAV` array with groups and Lucide icons, sidebar/rail/bottom bar + More sheet, `aria-current`, per-page title, count badge style. | `App.tsx`, new `src/ui/Nav.tsx`, `styles.css`, `package.json` (`lucide-react`) | M |
| 4 | **Panel, PageHeader, Field cleanup.** Replace `.card` + inline styles; remove spacer spans. | `ui.tsx` → `src/ui/*`, all pages | M |
| 5 | **Toasts, undo delete, loading vs empty.** `ToastProvider`, sync note → toast, `useLive()` wrapper, `EmptyState`. | `App.tsx`, new `src/ui/Toast.tsx`, `src/ui/EmptyState.tsx`, pages | M |
| 6 | **Overview home.** Status line, hero, tiles, Needs you, goals, recent activity; gold entry behind "Correct gold"; themed chart. | `Overview.tsx`, `ui/StatTile.tsx` | M |
| 7 | **Forms behind disclosures + defaults.** Data first on Ledger, Prices, Inventory, Professions, Goals, Crafting. Prices detail panel for vendor/deposit edits. | those pages, `ui/Disclosure.tsx` | M–L |
| 8 | **DataTable with sorting and column priority.** Migrate tables one page at a time. | new `ui/DataTable.tsx`, pages | L (split per page) |
| 9 | **Wowhead ItemLink + Settings toggle.** `wowhead.ts` hook, `ItemLink`, settings fields and panel, footer disclaimer. Replace item name cells. | new `src/wowhead.ts`, `ui/ItemLink.tsx`, `db.ts` (Settings type + defaults), `Settings.tsx`, pages | M |
| 10 | **Sync page tidy.** To-do list first when setup is done; setup steps collapsed; coverage table as a compact list on phones. | `Sync.tsx` | S |
| 11 | *(optional)* **Item quality from addon.** Save quality during sync; color names offline. | addon Lua, `src/sync/*`, `db.ts` | M |

Recommended before launch (Nov 4): steps 1, 2, 3, 5. They fix the phone layout and give the new look with low risk.
After launch: 6–10, once real Forever data shows which pages are used most.

### Decisions needed from the user

- **D1 — Fonts.** Marcellus (carved Roman display) + Source Sans 3, self-hosted. Alternative: system fonts only (zero bytes, less themed).
- **D2 — Wowhead default.** Tooltips **on by default** (best experience; third-party requests from first visit) or **off until enabled** in Settings (most private). Recommendation: on by default with the privacy note in Settings, since the only users are the owner and a friend.
- **D3 — Phone navigation.** Bottom bar with 4 pages + More (recommended), or a top "☰ Menu" button. Also: which 4 pages go in the bar (proposed Overview, Ledger, Prices, Sessions).
- **D4 — Item quality.** Extend the addon/sync to store quality (step 11), or rely on Wowhead `colorLinks` only.
- **D5 — Wowhead branch.** Default to `forever`; keep `classic` as a manual fallback if Forever pages are missing data at launch.
- **D6 — New dependencies.** `lucide-react`, `@fontsource/marcellus`, `@fontsource-variable/source-sans-3`. All small and permissively licensed. Confirm before adding.

### Sources

- Wowhead tooltips page: https://www.wowhead.com/tooltips
- Wowhead tooltip script (inspected for options and the `forever` / `CLASSICPLUS` data branch): https://wow.zamimg.com/js/tooltips.js
- Working demo linked from the tooltips page: https://wow.zamimg.com/widgets/power/demo.html
- Tooltip data check: `https://nether.wowhead.com/tooltip/item/2589?dataEnv=16&locale=0`
- WCAG contrast formula: https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
