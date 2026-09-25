/* editor.js — Google-Sheets-style inline editor that wraps an analyzed table.
 * Features:
 *   - Click-to-edit cells, Tab/Enter navigation, Escape to cancel
 *   - Toolbar: add row above/below, add col left/right, delete row/col, insert formula
 *   - Datatype auto-detection per cell when editing starts
 *   - Formula support (=SUM(A1:A5), =B2*C2, etc.) with live recalculation
 *   - Session snapshot (state) for reset/copy-to-clipboard
 */
(function () {
  "use strict";
  const D = window.TableMasterDetector;
  const F = window.TableMasterFormulas;

  class Editor {
    constructor(analysis, options = {}) {
      this.analysis = analysis;
      this.options = options;
      this.table = analysis.el;
      this.grid = analysis.grid.map((row, r) => row.map((c, ci) => ({
        el: c.el,
        raw: c.raw,
        value: D.detectDatatype(c.raw).value,
        isFormula: false,
        isHeader: r < analysis.headerRowCount,
        isFooter: r >= analysis.numRows - analysis.footerRowCount,
        virtual: c.virtual,
        missing: c.missing,
        colspan: c.colspan,
        rowspan: c.rowspan,
        rowIdx: r,
        colIdx: ci,
      })));
      // mark formulas
      for (const row of this.grid) for (const cell of row) {
        if (typeof cell.raw === "string" && cell.raw.startsWith("=")) {
          cell.isFormula = true;
        }
      }
      this.originalHTML = this.table.outerHTML;
      this.active = null; // {r,c}
      this.wrap();
      this.recalc();
    }

    wrap() {
      const t = this.table;
      t.classList.add("tmtbl-live");
      this.makeToolbar();
      this.bindEvents();
      this.render();
    }

    makeToolbar() {
      const bar = document.createElement("div");
      bar.className = "tmtbl-toolbar";
      bar.innerHTML = `
        <div class="tmtbl-group">
          <button data-act="add-row-above" title="Add row above selected">＋Row ↑</button>
          <button data-act="add-row-below" title="Add row below selected">＋Row ↓</button>
          <button data-act="add-col-left" title="Add column left">＋Col ←</button>
          <button data-act="add-col-right" title="Add column right">＋Col →</button>
          <button data-act="del-row" title="Delete selected row">✕ Row</button>
          <button data-act="del-col" title="Delete selected column">✕ Col</button>
        </div>
        <div class="tmtbl-group">
          <span class="tmtbl-cell-ref" data-ref>A1</span>
          <span class="tmtbl-cell-type" data-type>text</span>
        </div>
        <div class="tmtbl-group tmtbl-right">
          <button data-act="copy-html" title="Copy edited HTML">Copy HTML</button>
          <button data-act="copy-csv" title="Copy as CSV">Copy CSV</button>
          <button data-act="copy-md" title="Copy as Markdown">Copy MD</button>
          <button data-act="reset" title="Reset to original table">↺ Reset</button>
          <button data-act="close" title="Exit editor">✕ Close</button>
        </div>
      `;
      this.table.parentElement.insertBefore(bar, this.table);
      this.toolbar = bar;
    }

    bindEvents() {
      this.table.addEventListener("click", (e) => this.onClick(e));
      this.table.addEventListener("dblclick", (e) => this.onDblClick(e));
      this.toolbar.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        const act = b.dataset.act;
        if (act === "add-row-above") this.addRow(-1);
        else if (act === "add-row-below") this.addRow(1);
        else if (act === "add-col-left") this.addCol(-1);
        else if (act === "add-col-right") this.addCol(1);
        else if (act === "del-row") this.delRow();
        else if (act === "del-col") this.delCol();
        else if (act === "reset") this.reset();
        else if (act === "close") this.destroy();
        else if (act === "copy-html") this.copyAs("html");
        else if (act === "copy-csv") this.copyAs("csv");
        else if (act === "copy-md") this.copyAs("md");
      });
      this.keyHandler = (e) => {
        if (this.editorInput) return; // let input handler run
        const { r, c } = this.active || {};
        if (r === undefined) return;
        if (e.key === "Tab") {
          e.preventDefault();
          this.move(r, c + (e.shiftKey ? -1 : 1));
        } else if (e.key === "Enter") {
          e.preventDefault();
          this.startEdit(r, c);
        } else if (e.key === "ArrowUp") { e.preventDefault(); this.move(r - 1, c); }
        else if (e.key === "ArrowDown") { e.preventDefault(); this.move(r + 1, c); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); this.move(r, c - 1); }
        else if (e.key === "ArrowRight") { e.preventDefault(); this.move(r, c + 1); }
        else if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          this.setCell(r, c, "");
        }
      };
      document.addEventListener("keydown", this.keyHandler);
    }

    onClick(e) {
      const cell = e.target.closest("td, th");
      if (!cell || !this.table.contains(cell)) return;
      const pos = this.findCellPos(cell);
      if (pos) { this.select(pos.r, pos.c); }
    }

    onDblClick(e) {
      const cell = e.target.closest("td, th");
      if (!cell || !this.table.contains(cell)) return;
      const pos = this.findCellPos(cell);
      if (pos) this.startEdit(pos.r, pos.c);
    }

    findCellPos(el) {
      for (let r = 0; r < this.grid.length; r++) {
        for (let c = 0; c < this.grid[r].length; c++) {
          if (this.grid[r][c].el === el && !this.grid[r][c].virtual) return { r, c };
        }
      }
      return null;
    }

    select(r, c) {
      if (r < 0 || r >= this.grid.length || c < 0 || c >= this.grid[0].length) return;
      this.clearSelection();
      this.active = { r, c };
      const cell = this.grid[r][c];
      if (cell.el) cell.el.classList.add("tmtbl-selected");
      this.updateHUD();
    }

    move(r, c) {
      r = Math.max(0, Math.min(this.grid.length - 1, r));
      c = Math.max(0, Math.min(this.grid[0].length - 1, c));
      this.select(r, c);
      if (cellInView(this.grid[r][c].el)) {
        this.grid[r][c].el?.focus?.();
      } else {
        this.grid[r][c].el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      }
    }

    clearSelection() {
      this.table.querySelectorAll(".tmtbl-selected").forEach((n) => n.classList.remove("tmtbl-selected"));
    }

    updateHUD() {
      if (!this.active) return;
      const { r, c } = this.active;
      const ref = this.toolbar.querySelector("[data-ref]");
      const type = this.toolbar.querySelector("[data-type]");
      ref.textContent = D.coordToA1(r, c);
      const cell = this.grid[r][c];
      type.textContent = cell.isFormula ? "formula" : D.detectDatatype(cell.raw).type;
      type.className = "tmtbl-cell-type tmtbl-type-" + (cell.isFormula ? "formula" : D.detectDatatype(cell.raw).type);
    }

    startEdit(r, c) {
      if (this.editorInput) return;
      const cell = this.grid[r][c];
      if (!cell.el) return;
      cell.el.classList.add("tmtbl-editing");
      const text = cell.isFormula ? cell.raw : formatValue(cell);
      const input = document.createElement("input");
      input.className = "tmtbl-cell-input";
      input.value = text;
      input.spellcheck = false;
      cell.el.innerHTML = "";
      cell.el.appendChild(input);
      input.focus();
      input.select();
      this.editorInput = input;
      this.editorPos = { r, c };

      const finish = (commit, moveDir) => {
        if (!this.editorInput) return;
        const val = input.value;
        if (commit) this.setCell(r, c, val);
        else this.renderCell(r, c);
        input.remove();
        this.editorInput = null;
        cell.el.classList.remove("tmtbl-editing");
        this.select(r, c);
        if (moveDir === "down") this.move(r + 1, c);
        else if (moveDir === "right") this.move(r, c + 1);
      };

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); finish(true, "down"); }
        else if (e.key === "Tab") { e.preventDefault(); finish(true, e.shiftKey ? null : "right"); }
        else if (e.key === "Escape") { e.preventDefault(); finish(false, null); }
      });
      input.addEventListener("blur", () => finish(true, null));
    }

    setCell(r, c, raw) {
      const cell = this.grid[r][c];
      cell.raw = raw;
      cell.isFormula = typeof raw === "string" && raw.startsWith("=");
      this.recalc();
      this.renderCell(r, c);
      this.updateHUD();
    }

    recalc() {
      // Build resolver matrix for formulas:
      const matrix = this.grid.map((row) => row.map((cell) => ({
        raw: cell.raw,
        value: cell.value,
        isFormula: cell.isFormula,
      })));
      F.recalculate(matrix);
      for (let r = 0; r < this.grid.length; r++) {
        for (let c = 0; c < this.grid[r].length; c++) {
          if (this.grid[r][c].isFormula) {
            this.grid[r][c].value = matrix[r][c].value;
            this.grid[r][c].error = matrix[r][c].error;
          } else {
            const dt = D.detectDatatype(this.grid[r][c].raw);
            this.grid[r][c].value = dt.value;
            this.grid[r][c].datatype = dt.type;
          }
        }
      }
    }

    render() {
      // Refresh the DOM grid from internal state. Handles inserted rows/cols
      // by rebuilding the minimal needed structure.
      // Simplest robust approach: rebuild the <table>'s rows/cells to match this.grid.
      const tbl = this.table;
      // clear sections
      ["thead", "tbody", "tfoot"].forEach((s) => {
        const sec = tbl.querySelector(s);
        if (sec) sec.remove();
      });
      const thead = document.createElement("thead");
      const tbody = document.createElement("tbody");
      const tfoot = document.createElement("tfoot");

      for (let r = 0; r < this.grid.length; r++) {
        const tr = document.createElement("tr");
        const isHeader = r < this.analysis.headerRowCount;
        const isFooter = r >= this.grid.length - this.analysis.footerRowCount;
        for (let c = 0; c < this.grid[r].length; c++) {
          const cellDef = this.grid[r][c];
          if (cellDef.virtual && !cellDef.missing && !cellDef.inserted) continue;
          const el = document.createElement(isHeader ? "th" : "td");
          cellDef.el = el;
          cellDef.virtual = false;
          el.rowSpan = cellDef.rowspan || 1;
          el.colSpan = cellDef.colspan || 1;
          tr.appendChild(el);
        }
        if (isHeader && this.analysis.headerRowCount > 0) thead.appendChild(tr);
        else if (isFooter && this.analysis.footerRowCount > 0) tfoot.appendChild(tr);
        else tbody.appendChild(tr);
      }
      if (thead.children.length) tbl.appendChild(thead);
      if (tbody.children.length) tbl.appendChild(tbody);
      if (tfoot.children.length) tbl.appendChild(tfoot);

      for (let r = 0; r < this.grid.length; r++) for (let c = 0; c < this.grid[r].length; c++) this.renderCell(r, c);
      if (this.active) this.select(this.active.r, this.active.c);
    }

    renderCell(r, c) {
      const cell = this.grid[r][c];
      if (!cell.el || cell.virtual) return;
      cell.el.textContent = cell.isFormula ? formatFormulaValue(cell) : cell.raw;
      cell.el.classList.toggle("tmtbl-formula", !!cell.isFormula);
      cell.el.classList.toggle("tmtbl-error", !!cell.error);
      cell.el.classList.toggle("tmtbl-num", !cell.isFormula && isNumCell(cell));
      cell.el.classList.toggle("tmtbl-head", cell.isHeader);
      cell.el.classList.toggle("tmtbl-foot", cell.isFooter);
    }

    // --- structural ops ---
    addRow(dir) {
      const ref = this.active || { r: this.grid.length, c: 0 };
      const at = ref.r + (dir > 0 ? 1 : 0);
      const cols = this.grid[0].length;
      const row = [];
      for (let c = 0; c < cols; c++) row.push({
        el: null, raw: "", value: "", isFormula: false, isHeader: false, isFooter: false,
        virtual: false, missing: true, inserted: true, colspan: 1, rowspan: 1, rowIdx: at, colIdx: c,
      });
      this.grid.splice(at, 0, row);
      if (this.analysis.footerRowCount && dir <= 0 && at <= this.grid.length - this.analysis.footerRowCount - 1) {
        // footer count stays same; nothing extra to do
      }
      this.active = { r: at, c: 0 };
      this.render();
    }

    addCol(dir) {
      const ref = this.active || { c: 0 };
      const at = ref.c + (dir > 0 ? 1 : 0);
      for (let r = 0; r < this.grid.length; r++) {
        this.grid[r].splice(at, 0, {
          el: null, raw: "", value: "", isFormula: false, isHeader: r < this.analysis.headerRowCount, isFooter: r >= this.grid.length - this.analysis.footerRowCount,
          virtual: false, missing: true, inserted: true, colspan: 1, rowspan: 1, rowIdx: r, colIdx: at,
        });
      }
      this.active = { r: 0, c: at };
      this.render();
    }

    delRow() {
      if (!this.active) return;
      if (this.grid.length <= 1) return;
      this.grid.splice(this.active.r, 1);
      this.active.r = Math.min(this.active.r, this.grid.length - 1);
      this.render();
    }

    delCol() {
      if (!this.active) return;
      if (this.grid[0].length <= 1) return;
      for (const row of this.grid) row.splice(this.active.c, 1);
      this.active.c = Math.min(this.active.c, this.grid[0].length - 1);
      this.render();
    }

    reset() {
      if (!confirm("Reset this table to its original HTML? Unsaved edits will be lost.")) return;
      this.destroy();
      const tmp = document.createElement("div");
      tmp.innerHTML = this.originalHTML;
      const fresh = tmp.firstElementChild;
      this.table.replaceWith(fresh);
      this.table = fresh;
      // re-analyze and re-open editor on the new node
      const re = new Editor(D.analyzeTable(fresh, 0), this.options);
      if (this.options?.onReset) this.options.onReset(re);
    }

    destroy() {
      document.removeEventListener("keydown", this.keyHandler);
      if (this.toolbar) this.toolbar.remove();
      if (this.table) this.table.classList.remove("tmtbl-live");
      this.clearSelection();
    }

    // --- export ---
    copyAs(kind) {
      let text = "";
      if (kind === "html") {
        // Build current DOM table HTML
        text = serializeTableHTML(this.grid, this.analysis);
      } else if (kind === "csv") {
        text = gridToCSV(this.grid);
      } else if (kind === "md") {
        text = gridToMarkdown(this.grid, this.analysis);
      }
      navigator.clipboard.writeText(text).then(
        () => flash(this.toolbar, "Copied " + kind.toUpperCase()),
        () => flash(this.toolbar, "Copy failed")
      );
    }

    getState() {
      return {
        grid: this.grid.map((row) => row.map((c) => ({ raw: c.raw }))),
        orientation: this.analysis.orientation,
        headerRowCount: this.analysis.headerRowCount,
        footerRowCount: this.analysis.footerRowCount,
        originalHTML: this.originalHTML,
      };
    }
  }

  function isNumCell(cell) {
    if (cell.isFormula) return typeof cell.value === "number";
    const t = D.detectDatatype(cell.raw).type;
    return t === "number" || t === "currency" || t === "percent";
  }

  function formatValue(cell) {
    if (cell.error) return "#ERR";
    const v = cell.value;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    return cell.raw;
  }

  function formatFormulaValue(cell) {
    if (cell.error) return "#ERR: " + cell.error;
    const v = cell.value;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === "number") {
      if (!isFinite(v)) return "#DIV/0";
      return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e10) / 1e10);
    }
    if (v === null || v === undefined) return "";
    return String(v);
  }

  function cellInView(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight;
  }

  function flash(parent, msg) {
    const el = document.createElement("span");
    el.className = "tmtbl-flash";
    el.textContent = msg;
    parent.appendChild(el);
    setTimeout(() => el.remove(), 1200);
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
  function gridToMarkdown(grid, analysis) {
    if (!grid.length) return "";
    const hdr = analysis.headerRowCount > 0 ? 0 : -1;
    const lines = [];
    lines.push("| " + grid[0].map((c) => c.raw || " ").join(" | ") + " |");
    lines.push("| " + grid[0].map(() => "---").join(" | ") + " |");
    for (let r = (hdr === 0 ? 1 : 0); r < grid.length; r++) {
      lines.push("| " + grid[r].map((c) => (c.raw ?? "").toString().replace(/\|/g, "\\|")).join(" | ") + " |");
    }
    return lines.join("\n");
  }

  window.TableMasterEditor = Editor;
})();
