# Table Master Pro — Steroids Edition (v3.0)

A Manifest-V3 browser extension (Chrome / Edge / Brave / Arc) that turns any
HTML table on any web page into a live Google-Sheets-style editor — with
automatic layout detection, formulas, datatype inference, row/column
operations, clipboard export, session reset, and flexible cross-table merging.

## ✨ Features

| Capability | Description |
|---|---|
| **Auto layout detection** | Scans every `<table>` on the page and classifies it as *horizontal* (headers on top) or *vertical* (labels in the first column). Identifies header rows from `<thead>`, `<th>` elements, bold/short text, and detects footer rows (`<tfoot>` or *Total/Sum/Grand* rows). Honors `colspan` / `rowspan`. |
| **Inline Sheets-style editing** | Click to select, double-click or press Enter to edit. Tab / Shift+Tab navigate, arrow keys move, Enter commits and moves down, Esc cancels. |
| **Add / delete rows & columns** | Toolbar buttons: ＋Row ↑/↓, ＋Col ←/→, ✕Row, ✕Col. |
| **Formulas** | Start a cell with `=`. Supports `+ - * / ^ %`, comparisons `= < > <= >= <>`, cell refs (`A1`, `B2`), ranges (`B2:B10`), and functions: `SUM`, `AVG/AVERAGE`, `MIN`, `MAX`, `COUNT`, `COUNTA`, `IF`, `ABS`, `ROUND`, `CONCAT`, `PRODUCT`, `NOW`, `TODAY`. Live recalc with cycle guard. |
| **Datatype auto-detect** | When you click a cell the toolbar shows the inferred type: number, currency, percent, date, boolean, text, empty — and right-aligns numerics for you. |
| **Copy to clipboard anytime** | Copy current table(s) as **HTML**, **CSV**, or **Markdown**. Buttons are on the in-table toolbar and on the floating menu. |
| **Reset / stop session** | One click restores every table to its original page HTML. |
| **Flexible merge mode** | Open the ⇌ Merge panel when a page has ≥2 tables. Pick a master table, choose a key column, and map each source column to any master column (or *append as new column*). Names don't have to match — fuzzy-matching pre-selects likely pairs, but you override freely. |
| **Respects SPAs** | A `MutationObserver` re-scans the DOM as pages change, so the FAB badge count stays up-to-date. |
| **Zero dependencies** | Plain JS + CSS, no build step, no npm packages, no remote code. |

## 🧱 Project layout

```
manifest.json           MV3 manifest
src/
  background.js         Service worker (icon-click bridge)
  content.js            Injects floating FAB, orchestrates editing/merging/copy/reset
  detector.js           Table/grid analysis + datatype detection
  formulas.js           Tokenizer → parser → evaluator + recalculation engine
  editor.js             Inline editor (toolbar, key handling, cell rendering, add/remove ops)
  merger.js             Flexible cross-table column merger
  styles.css            All UI styles (tmtbl- prefixed)
popup/
  popup.html, popup.js  Toolbar-icon popup
icons/                  16/48/128 px icons
demo.html               Test page with horizontal, vertical, and numeric tables
```

## 🚀 Install (unpacked)

### Chromium browsers (Chrome / Edge / Brave / Arc)

1. Open `chrome://extensions` (or `edge://extensions`)
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `table-master-pro-2.7.0/` folder
4. Visit any page with tables (open `demo.html` for a quick test)
5. Click the floating **▦** button in the bottom-right → **✎ Edit tables on this page**

### Firefox (121+)

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…** and select `manifest.json` in the `table-master-pro-2.7.0/` folder
3. **Important:** Firefox treats MV3 host permissions as optional and does not grant them automatically. Open `about:addons` → **Table Master Pro** → **Permissions** tab and enable **Access your data for all websites** — otherwise the content script (and the ▦ button) won't appear on pages.
4. Visit any page with tables (open `demo.html` for a quick test) and use the ▦ button or the toolbar popup.

> Cross-browser note: the manifest declares the background worker with both
> `background.service_worker` (used by Chromium) and `background.scripts`
> (used by Firefox 121+), and the JS uses the promise-based `browser.*` API
> when available, falling back to Chromium's promisified `chrome.*`.

## ⌨️ Keyboard shortcuts while editing

| Key | Action |
|---|---|
| Click a cell | Select it (shows A1 ref + datatype) |
| Double-click / Enter | Edit cell |
| Typing `=…` | Enters a formula |
| Tab / Shift+Tab | Move right / left (commits edit) |
| Enter | Commit edit & move down |
| Esc | Cancel edit |
| Arrow keys | Move selection |
| Delete / Backspace | Clear selected cell |

## 🧮 Formula examples

- `=SUM(B2:B10)`
- `=AVERAGE(C2:C20)`
- `=B2*C2`
- `=IF(D2>1000,"High","Low")`
- `=ROUND(E2*1.08, 2)`
- `=B2&" — "&C2` (concatenate)

Columns beyond Z are supported (`AA`, `AB`, …).

## 🧩 Merge mode workflow

1. Make sure two or more tables are visible on the page.
2. Open the FAB menu → **⇌ Flexible merge mode**.
3. Pick which table is the *master* (the one kept in place).
4. Pick a **row key column** (usually the first column — name, SKU, region…).
5. For every column in every other table, choose whether to:
   - Map it onto an existing master column (fuzzy match pre-selected, e.g. *Revenue* ↔ *Total Sales*),
   - Append it as a brand-new column,
   - Skip it.
6. Click **Apply merge**. Rows are aligned by key; new rows are appended when a key doesn't exist in the master. The result is a live editable table you can keep editing or copy.

## 🛡️ Safety & privacy

- All editing happens locally in the DOM. No network requests, no telemetry, no storage beyond a single `chrome.storage.local` flag.
- Original HTML of each edited table is captured before any mutation, so **Reset** always restores the page exactly as it was.
- All injected class names are prefixed with `tmtbl-` to avoid host-page collisions.

## 🗺️ Roadmap ideas (not yet implemented)

- Undo/redo stack
- Multi-cell selection + fill handle
- Sort/filter toggles on header columns
- Cell formatting (currency/date/percent renderers)
- VLOOKUP / INDEX-MATCH / AVERAGEIF
- Persistent sessions per URL

## License

MIT.
