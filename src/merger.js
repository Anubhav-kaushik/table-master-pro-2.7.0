/* merger.js — flexible cross-table column-merging mode.
 *
 * When enabled, hovering column headers shows a "link" handle; users can drag
 * columns from other tables onto a column in the master table, even when names
 * don't match. The user maps source-column -> target-column via a picker dialog.
 *
 * Rows are aligned by best-effort key match (first column by default) but the
 * user can change the key column. The merged result replaces the master table
 * in the live editor so they can continue editing with formulas spanning the
 * combined columns.
 */
(function () {
  "use strict";
  const D = window.TableMasterDetector;

  class Merger {
    constructor(editorInstances) {
      this.editors = editorInstances; // array of Editor
      this.buildPanel();
    }
    buildPanel() {
      const p = document.createElement("div");
      p.className = "tmtbl-merge-panel";
      p.innerHTML = `
        <div class="tmtbl-merge-head">
          <strong>Flexible merge mode</strong>
          <button class="tmtbl-close" data-close>✕</button>
        </div>
        <div class="tmtbl-merge-body">
          <p class="tmtbl-hint">Pick a <em>master</em> table to merge other tables into.
             Column names do <u>not</u> need to match — map them below.</p>
          <label>Master table:
            <select data-master></select>
          </label>
          <label>Row key column:
            <select data-keycol></select>
          </label>
          <div class="tmtbl-maps" data-maps></div>
          <div class="tmtbl-merge-actions">
            <button data-apply>Apply merge</button>
            <button data-cancel>Cancel</button>
          </div>
        </div>
      `;
      document.body.appendChild(p);
      this.panel = p;
      this.masterSel = p.querySelector("[data-master]");
      this.keySel = p.querySelector("[data-keycol]");
      this.mapsEl = p.querySelector("[data-maps]");
      this.editors.forEach((ed, i) => {
        const opt = document.createElement("option");
        opt.value = i; opt.textContent = "Table #" + (i + 1) + " (" + ed.analysis.numRows + "×" + ed.analysis.numCols + ")";
        this.masterSel.appendChild(opt);
      });
      this.masterSel.addEventListener("change", () => this.refreshKeyAndMaps());
      p.querySelector("[data-close]").addEventListener("click", () => this.close());
      p.querySelector("[data-cancel]").addEventListener("click", () => this.close());
      p.querySelector("[data-apply]").addEventListener("click", () => this.apply());
      this.refreshKeyAndMaps();
    }
    close() { this.panel.remove(); }

    masterEditor() { return this.editors[parseInt(this.masterSel.value, 10)]; }

    refreshKeyAndMaps() {
      const master = this.masterEditor();
      this.keySel.innerHTML = "";
      const headers = master.grid[0].map((c, i) => c.raw || "(col " + (i + 1) + ")");
      headers.forEach((h, i) => {
        const opt = document.createElement("option");
        opt.value = i; opt.textContent = D.coordToA1(0, i) + " — " + h;
        this.keySel.appendChild(opt);
      });
      // rebuild maps: for each non-master table, show mapping dropdown per column
      this.mapsEl.innerHTML = "";
      this.editors.forEach((ed, idx) => {
        if (ed === master) return;
        const sec = document.createElement("div");
        sec.className = "tmtbl-map-sec";
        sec.innerHTML = `<div class="tmtbl-map-title">Table #${idx + 1} → master</div>`;
        ed.grid[0].forEach((srcCol, ci) => {
          const label = srcCol.raw || "(col " + (ci + 1) + ")";
          const row = document.createElement("div");
          row.className = "tmtbl-map-row";
          row.innerHTML = `<span class="tmtbl-src">${escapeHtml(label)}</span> → <select data-mapto data-tbl="${idx}" data-col="${ci}"></select>`;
          const sel = row.querySelector("select");
          const optSkip = document.createElement("option"); optSkip.value = "__skip__"; optSkip.textContent = "(skip)";
          sel.appendChild(optSkip);
          const optNew = document.createElement("option"); optNew.value = "__new__"; optNew.textContent = "+ Append as new column";
          sel.appendChild(optNew);
          // fuzzy pre-match by header name
          const matchIdx = headers.findIndex((h) => fuzzy(h, label));
          master.grid[0].forEach((m, mi) => {
            const o = document.createElement("option");
            o.value = mi; o.textContent = D.coordToA1(0, mi) + " — " + (m.raw || "(col " + (mi + 1) + ")");
            if (mi === matchIdx) o.selected = true;
            sel.appendChild(o);
          });
          sec.appendChild(row);
        });
        this.mapsEl.appendChild(sec);
      });
    }

    apply() {
      const master = this.masterEditor();
      const keyCol = parseInt(this.keySel.value, 10);
      const maps = [];
      this.mapsEl.querySelectorAll("[data-mapto]").forEach((sel) => {
        maps.push({ tbl: parseInt(sel.dataset.tbl, 10), col: parseInt(sel.dataset.col, 10), to: sel.value });
      });

      // Build merged grid starting from master
      const out = master.grid.map((r) => r.slice());
      // Append __new__ columns
      const newCols = maps.filter((m) => m.to === "__new__");
      const baseCols = out[0].length;
      newCols.forEach((m, newIdx) => {
        for (let r = 0; r < out.length; r++) {
          out[r].push({
            el: null, raw: "", value: "", isFormula: false, isHeader: false, isFooter: false,
            virtual: false, missing: true, inserted: true, colspan: 1, rowspan: 1, colIdx: baseCols + newIdx, rowIdx: r,
          });
        }
        // header cell gets name from source column
        out[0][baseCols + newIdx].raw = this.editors[m.tbl].grid[0][m.col].raw || ("Merged col " + (newIdx + 1));
      });

      // Build key index for master (rows 1..end keyed by lowercased keycol cell)
      const keyIndex = new Map();
      for (let r = 1; r < out.length; r++) {
        const k = (out[r][keyCol]?.raw || "").toString().trim().toLowerCase();
        if (k) keyIndex.set(k, r);
      }
      let nextRow = out.length;

      for (const m of maps) {
        if (m.to === "__skip__") continue;
        const srcEd = this.editors[m.tbl];
        let targetCol;
        if (m.to === "__new__") {
          targetCol = baseCols + newCols.indexOf(m);
        } else {
          targetCol = parseInt(m.to, 10);
        }
        for (let r = 1; r < srcEd.grid.length; r++) {
          const srcKey = (srcEd.grid[r][0]?.raw || "").toString().trim().toLowerCase();
          const val = srcEd.grid[r][m.col]?.raw || "";
          let tr = keyIndex.get(srcKey);
          if (tr === undefined) {
            // append a new row
            const newRow = [];
            for (let c = 0; c < out[0].length; c++) newRow.push({
              el: null, raw: c === keyCol ? srcEd.grid[r][0]?.raw || "" : "", value: "", isFormula: false,
              isHeader: false, isFooter: false, virtual: false, missing: true, inserted: true, colspan: 1, rowspan: 1,
              colIdx: c, rowIdx: nextRow,
            });
            out.push(newRow);
            tr = nextRow++;
            keyIndex.set(srcKey, tr);
          }
          out[tr][targetCol].raw = val;
        }
      }

      master.grid = out;
      master.analysis.numRows = out.length;
      master.analysis.numCols = out[0].length;
      master.render();
      master.recalc();
      flash(master.toolbar, "Merge applied");
      this.close();
    }
  }

  function fuzzy(a, b) {
    if (!a || !b) return false;
    const na = a.toString().toLowerCase().replace(/[^a-z0-9]/g, "");
    const nb = b.toString().toLowerCase().replace(/[^a-z0-9]/g, "");
    return na && nb && (na === nb || na.includes(nb) || nb.includes(na));
  }
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  }
  function flash(parent, msg) {
    const el = document.createElement("span");
    el.className = "tmtbl-flash";
    el.textContent = msg;
    parent.appendChild(el);
    setTimeout(() => el.remove(), 1200);
  }

  window.TableMasterMerger = Merger;
})();
