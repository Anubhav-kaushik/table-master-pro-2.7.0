/* content.js — bootstraps the floating launcher, attaches editors on demand,
 * handles global state (active sessions, reset-all, copy-all, merge mode).
 */
(function () {
  "use strict";
  const D = window.TableMasterDetector;
  const E = window.TableMasterEditor;
  const M = window.TableMasterMerger;

  if (window.__tableMasterProLoaded) return;
  window.__tableMasterProLoaded = true;

  const state = {
    sessions: new Map(), // table -> Editor
    launchBtn: null,
    panel: null,
    scanResults: [],
  };

  function init() {
    injectLauncher();
    // re-scan periodically for SPAs
    const rescan = () => {
      state.scanResults = D.scanDocument(document);
      updateBadge();
    };
    rescan();
    const mo = new MutationObserver(debounce(rescan, 500));
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", debounce(updateBadge, 200));
  }

  function injectLauncher() {
    const btn = document.createElement("div");
    btn.className = "tmtbl-fab";
    btn.title = "Table Master Pro — Steroids";
    btn.innerHTML = `
      <div class="tmtbl-fab-icon">▦</div>
      <div class="tmtbl-fab-badge" data-badge>0</div>
      <div class="tmtbl-fab-menu" data-menu>
        <button data-act="edit">✎ Edit tables on this page</button>
        <button data-act="merge">⇌ Flexible merge mode (cross-table)</button>
        <button data-act="copyall">⧉ Copy all tables (HTML)</button>
        <button data-act="copycsv">⧉ Copy all tables (CSV)</button>
        <button data-act="reset">↺ Stop / reset session</button>
        <div class="tmtbl-fab-foot">Table Master Pro v3</div>
      </div>
    `;
    document.body.appendChild(btn);
    state.launchBtn = btn;

    btn.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) {
        // toggle menu
        btn.classList.toggle("tmtbl-open");
        return;
      }
      btn.classList.remove("tmtbl-open");
      const act = b.dataset.act;
      if (act === "edit") startEditingAll();
      else if (act === "merge") openMerge();
      else if (act === "copyall") copyAll("html");
      else if (act === "copycsv") copyAll("csv");
      else if (act === "reset") resetAll();
    });

    // close menu on outside click
    document.addEventListener("click", (e) => {
      if (!btn.contains(e.target)) btn.classList.remove("tmtbl-open");
    });
  }

  function updateBadge() {
    const badge = state.launchBtn?.querySelector("[data-badge]");
    if (badge) badge.textContent = state.scanResults.length;
  }

  function startEditingAll() {
    if (state.sessions.size) {
      // already editing — focus/refresh
      flashBtn("Already editing — toolbars shown.");
      return;
    }
    for (const t of state.scanResults) {
      try {
        const ed = new E(t);
        state.sessions.set(t.el, ed);
        scrollToIfNotVisible(t.el);
        // highlight first found
        if (state.sessions.size === 1) {
          ed.select(Math.min(ed.analysis.headerRowCount, ed.grid.length - 1), 0);
        }
      } catch (err) {
        console.warn("[TableMaster] failed to edit a table", err, t.el);
      }
    }
    if (!state.sessions.size) flashBtn("No tables detected on this page.");
  }

  function openMerge() {
    // ensure editors exist for all tables
    if (!state.sessions.size) startEditingAll();
    if (!state.sessions.size) return;
    new M(Array.from(state.sessions.values()));
  }

  function copyAll(kind) {
    if (!state.sessions.size) {
      // capture as-is without opening editor
      state.scanResults = D.scanDocument(document);
    }
    const parts = [];
    state.sessions.forEach((ed) => {
      parts.push(kind === "csv" ? gridToCSV(ed.grid) : serializeTableHTML(ed.grid, ed.analysis));
    });
    const text = parts.join("\n\n");
    navigator.clipboard.writeText(text).then(
      () => flashBtn("Copied " + parts.length + " table(s) as " + kind.toUpperCase()),
      () => flashBtn("Clipboard denied")
    );
  }

  function resetAll() {
    if (!state.sessions.size) { flashBtn("No active session."); return; }
    if (!confirm("Stop editing and reset all tables to original HTML?")) return;
    state.sessions.forEach((ed) => ed.destroy());
    // restore originals from stored html
    document.querySelectorAll(".tmtbl-toolbar").forEach((n) => n.remove());
    document.querySelectorAll("table.tmtbl-live").forEach((t) => t.classList.remove("tmtbl-live"));
    state.sessions.clear();
    flashBtn("Session reset.");
  }

  function flashBtn(msg) {
    const el = document.createElement("div");
    el.className = "tmtbl-toast";
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add("show"), 10);
    setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 300); }, 1800);
  }

  function scrollToIfNotVisible(el) {
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  function escapeHTML(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  }
  function serializeTableHTML(grid, analysis) {
    let html = "<table>\n";
    if (analysis.headerRowCount > 0) {
      html += "  <thead>\n";
      for (let r = 0; r < analysis.headerRowCount; r++) html += rowHTML(grid[r], "th");
      html += "  </thead>\n";
      html += "  <tbody>\n";
      for (let r = analysis.headerRowCount; r < grid.length - analysis.footerRowCount; r++) html += rowHTML(grid[r], "td");
      html += "  </tbody>\n";
    } else {
      html += "  <tbody>\n";
      for (let r = 0; r < grid.length - analysis.footerRowCount; r++) html += rowHTML(grid[r], "td");
      html += "  </tbody>\n";
    }
    if (analysis.footerRowCount > 0) {
      html += "  <tfoot>\n";
      for (let r = grid.length - analysis.footerRowCount; r < grid.length; r++) html += rowHTML(grid[r], "td");
      html += "  </tfoot>\n";
    }
    html += "</table>";
    return html;
  }
  function rowHTML(row, tag) {
    let s = "    <tr>";
    for (const c of row) {
      if (c.virtual && !c.inserted && !c.missing) continue;
      s += `<${tag}${c.colspan > 1 ? ` colspan="${c.colspan}"` : ""}${c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : ""}>`;
      s += escapeHTML(c.raw);
      s += `</${tag}>`;
    }
    return s + "</tr>\n";
  }
  function csvEscape(v) {
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function gridToCSV(grid) {
    return grid.map((row) => row.map((c) => csvEscape(c.raw)).join(",")).join("\n");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Listen for messages from the popup / background
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "tmtp-toggle") {
      state.launchBtn?.classList.toggle("tmtbl-open");
      sendResponse?.({ ok: true });
    } else if (msg?.type === "tmtp-edit") {
      startEditingAll();
      sendResponse?.({ ok: true });
    } else if (msg?.type === "tmtp-reset") {
      resetAll();
      sendResponse?.({ ok: true });
    }
    return true;
  });
})();
