/* detector.js — auto-identify HTML table layout: horizontal vs vertical,
 * header rows, footer rows, data rows. Exposes global TableMasterDetector.
 */
(function () {
  "use strict";

  const DATATYPES = {
    NUMBER: "number",
    CURRENCY: "currency",
    PERCENT: "percent",
    DATE: "date",
    BOOLEAN: "boolean",
    TEXT: "text",
    EMPTY: "empty",
  };

  function normalizeText(el) {
    return (el?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim();
  }

  /**
   * Classify a raw cell string into a datatype.
   * Returns { type, value } where value is the parsed JS value (Number, Date, String, Boolean, null).
   */
  function detectDatatype(raw) {
    const s = (raw ?? "").toString().trim();
    if (!s) return { type: DATATYPES.EMPTY, value: null };

    // boolean
    if (/^(true|false|yes|no|y|n)$/i.test(s)) {
      return { type: DATATYPES.BOOLEAN, value: /^(true|yes|y)$/i.test(s) };
    }

    // currency: $1,234.56 / €99 / £1,000 / 1.234,56 € / USD 50
    const curMatch = s.match(/^[\s]*([$€£¥₹₩])?\s?(-?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?|-?\d+(?:[.,]\d+)?)\s?([$€£¥₹₩])?[\s]*$/);
    if (curMatch) {
      const symLeft = curMatch[1];
      const num = curMatch[2];
      const symRight = curMatch[3];
      if (symLeft || symRight) {
        const normalized = num.replace(/,(?=\d{3}\b)/g, "").replace(/\.(?=\d{3}\b)/g, "");
        const v = parseFloat(normalized.replace(",", "."));
        if (!isNaN(v)) {
          return { type: DATATYPES.CURRENCY, value: v, symbol: symLeft || symRight };
        }
      }
    }

    // percent
    const pctMatch = s.match(/^-?\d+(?:\.\d+)?\s?%$/);
    if (pctMatch) {
      const v = parseFloat(s) / 100;
      return { type: DATATYPES.PERCENT, value: v };
    }

    // number
    const numMatch = s.match(/^-?\d{1,3}(?:,\d{3})*(?:\.\d+)?$|^-?\d+(?:\.\d+)?$/);
    if (numMatch) {
      const v = parseFloat(s.replace(/,/g, ""));
      if (!isNaN(v)) return { type: DATATYPES.NUMBER, value: v };
    }

    // date — try several patterns
    const dateParsed = tryParseDate(s);
    if (dateParsed) return { type: DATATYPES.DATE, value: dateParsed };

    return { type: DATATYPES.TEXT, value: s };
  }

  function tryParseDate(s) {
    // ISO yyyy-mm-dd
    if (/^\d{4}-\d{1,2}-\d{1,2}/.test(s)) {
      const d = new Date(s);
      if (!isNaN(d)) return d;
    }
    // dd/mm/yyyy or mm/dd/yyyy — prefer dd-first when first > 12
    const m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
    if (m) {
      let a = parseInt(m[1], 10);
      let b = parseInt(m[2], 10);
      let y = parseInt(m[3], 10);
      if (y < 100) y += 2000;
      let day, month;
      if (a > 12) { day = a; month = b; }
      else if (b > 12) { day = b; month = a; }
      else { month = a; day = b; } // assume mm/dd/yyyy when ambiguous
      const d = new Date(y, month - 1, day);
      if (!isNaN(d)) return d;
    }
    // Month-name variants
    const d2 = new Date(s);
    if (!isNaN(d2) && /[a-z]/i.test(s) && s.length > 4) return d2;
    return null;
  }

  /**
   * Read all tables from the document and classify each.
   */
  function scanDocument(root = document) {
    const tables = Array.from(root.querySelectorAll("table"));
    return tables.map((t, idx) => analyzeTable(t, idx));
  }

  /**
   * Build a structural analysis of a single <table>:
   *  - orientation: 'horizontal' (headers across top) | 'vertical' (headers down first column)
   *  - headerRows, footerRows: indices
   *  - grid: 2D array of { el, raw, colspan, rowspan, rowIdx, colIdx }
   *  - datatypes: per-column inferred type when horizontal, per-row when vertical
   */
  function analyzeTable(table, index = 0) {
    const rows = Array.from(table.rows);
    const grid = buildGrid(table);
    const numRows = grid.length;
    const numCols = grid[0]?.length || 0;

    // header candidates
    const theadRows = Array.from(table.tHead?.rows || []);
    const hasTHead = theadRows.length > 0;
    const hasTFoot = !!table.tFoot;
    const tfootCount = table.tFoot ? table.tFoot.rows.length : 0;

    // detect header rows
    let headerRowCount = hasTHead ? theadRows.length : guessHeaderRows(grid);
    let footerRowCount = hasTFoot ? tfootCount : guessFooterRows(grid, headerRowCount);

    // orientation
    const orientation = guessOrientation(grid, headerRowCount);

    // datatype map
    const datatypes = inferColumnDatatypes(grid, headerRowCount, footerRowCount, orientation);

    return {
      id: `tmtbl-${index}`,
      el: table,
      numRows,
      numCols,
      grid,
      orientation,
      headerRowCount,
      footerRowCount,
      datatypes,
    };
  }

  /** Build a row x col grid respecting colspan/rowspan. */
  function buildGrid(table) {
    const rows = Array.from(table.rows);
    const grid = [];
    const spanMap = {}; // "r,c" -> { el, rowspan, colspan } when a cell spills

    for (let r = 0; r < rows.length; r++) {
      grid[r] = grid[r] || [];
      const cells = Array.from(rows[r].cells);
      let c = 0;
      for (const cell of cells) {
        while (spanMap[`${r},${c}`]) {
          const sp = spanMap[`${r},${c}`];
          grid[r][c] = { el: sp.el, raw: normalizeText(sp.el), colspan: sp.colspan, rowspan: sp.rowspan, virtual: true, rowIdx: r, colIdx: c };
          c++;
        }
        const colspan = cell.colSpan || 1;
        const rowspan = cell.rowSpan || 1;
        for (let dr = 0; dr < rowspan; dr++) {
          for (let dc = 0; dc < colspan; dc++) {
            if (dr === 0 && dc === 0) continue;
            const rr = r + dr, cc = c + dc;
            grid[rr] = grid[rr] || [];
            spanMap[`${rr},${cc}`] = { el: cell, rowspan, colspan };
          }
        }
        grid[r][c] = {
          el: cell,
          raw: normalizeText(cell),
          colspan,
          rowspan,
          virtual: false,
          rowIdx: r,
          colIdx: c,
        };
        c += colspan;
      }
      // fill trailing virtual cells
      while (grid[r].length < c) c++;
      const rowLen = grid[r].length;
      // pad if spanMap extends further
      while (spanMap[`${r},${rowLen}`] || grid[r].length < (grid[r].length)) {
        if (spanMap[`${r},${grid[r].length}`]) {
          const sp = spanMap[`${r},${grid[r].length}`];
          grid[r][grid[r].length] = { el: sp.el, raw: normalizeText(sp.el), colspan: sp.colspan, rowspan: sp.rowspan, virtual: true, rowIdx: r, colIdx: grid[r].length };
        } else break;
      }
    }
    // normalize lengths
    const maxCols = Math.max(0, ...grid.map((r) => r.length));
    for (let r = 0; r < grid.length; r++) {
      while (grid[r].length < maxCols) {
        grid[r].push({ el: null, raw: "", colspan: 1, rowspan: 1, virtual: true, missing: true, rowIdx: r, colIdx: grid[r].length });
      }
    }
    return grid;
  }

  function guessHeaderRows(grid) {
    if (!grid.length) return 0;
    const numRows = grid.length;
    let headerCount = 0;
    // inspect first row: if mostly text-short & bold or <th> elements, count as header
    for (let r = 0; r < Math.min(3, numRows); r++) {
      const row = grid[r];
      const thCount = row.filter((c) => c.el && c.el.tagName === "TH").length;
      const boldish = row.filter((c) => {
        if (!c.el) return false;
        const style = window.getComputedStyle(c.el);
        return parseFloat(style.fontWeight) >= 600 || c.el.tagName === "TH";
      }).length;
      const pctTh = thCount / Math.max(1, row.filter((c) => c.el && !c.virtual).length);
      const pctBold = boldish / Math.max(1, row.filter((c) => c.el && !c.virtual).length);
      const avgLen = avgStrLen(row.filter((c) => c.el).map((c) => c.raw));
      if (pctTh >= 0.5 || pctBold >= 0.7 || (avgLen < 18 && r === 0 && pctBold >= 0.5)) {
        headerCount = r + 1;
      } else break;
    }
    return Math.min(headerCount, numRows - 1) || 1;
  }

  function guessFooterRows(grid, headerRows) {
    if (!grid.length) return 0;
    const last = grid[grid.length - 1];
    if (!last) return 0;
    const totalish = last.filter((c) => /total|sum|grand|合计|총계|合計/i.test(c.raw)).length;
    const boldish = last.filter((c) => {
      if (!c.el) return false;
      const style = window.getComputedStyle(c.el);
      return parseFloat(style.fontWeight) >= 600;
    }).length;
    if (totalish > 0 || boldish >= last.filter((c) => c.el).length * 0.6) {
      return 1;
    }
    return 0;
  }

  function avgStrLen(arr) {
    if (!arr.length) return 0;
    return arr.reduce((a, b) => a + b.length, 0) / arr.length;
  }

  function guessOrientation(grid, headerRows) {
    // Vertical = first column has many distinct short labels that look like headers,
    // while top header row is empty/repeated. Otherwise horizontal.
    if (grid.length < 2 || !grid[0]) return "horizontal";
    const firstCol = grid.map((r) => (r[0] ? r[0].raw : "")).slice(headerRows);
    const firstRow = grid[0].map((c) => c.raw);

    const firstColText = firstCol.filter((s) => s.length > 0 && s.length < 30).length;
    const firstRowText = firstRow.filter((s) => s.length > 0 && s.length < 30).length;

    // If first column has far more labels than first row (typical vertical), call it vertical.
    if (firstColText >= grid.length * 0.6 && firstRowText <= 2) return "vertical";
    return "horizontal";
  }

  function inferColumnDatatypes(grid, headerRows, footerRows, orientation) {
    const numRows = grid.length;
    const numCols = grid[0]?.length || 0;
    const result = {};
    if (orientation === "horizontal") {
      for (let c = 0; c < numCols; c++) {
        const types = {};
        for (let r = headerRows; r < numRows - footerRows; r++) {
          const cell = grid[r][c];
          if (!cell || !cell.raw) continue;
          const t = detectDatatype(cell.raw).type;
          types[t] = (types[t] || 0) + 1;
        }
        result[c] = dominantType(types);
      }
    } else {
      for (let r = headerRows; r < numRows - footerRows; r++) {
        const types = {};
        for (let c = 1; c < numCols; c++) {
          const cell = grid[r][c];
          if (!cell || !cell.raw) continue;
          const t = detectDatatype(cell.raw).type;
          types[t] = (types[t] || 0) + 1;
        }
        result[r] = dominantType(types);
      }
    }
    return result;
  }

  function dominantType(types) {
    let best = "text", bestN = 0;
    const priority = ["number", "currency", "percent", "date", "boolean", "text", "empty"];
    for (const k of priority) {
      if ((types[k] || 0) > bestN) { best = k; bestN = types[k]; }
    }
    return best;
  }

  /** Convert A1 / R1C1 address to {row, col} indexes into grid (data coordinates).
   *  We use standard spreadsheet addressing where A=col 0, 1=row 0.
   */
  function a1ToCoord(a1) {
    const m = a1.match(/^([A-Za-z]+)(\d+)$/);
    if (!m) return null;
    const colStr = m[1].toUpperCase();
    const row = parseInt(m[2], 10) - 1;
    let col = 0;
    for (let i = 0; i < colStr.length; i++) {
      col = col * 26 + (colStr.charCodeAt(i) - 64);
    }
    col -= 1;
    return { row, col };
  }

  function coordToA1(row, col) {
    let s = "";
    let c = col + 1;
    while (c > 0) {
      const rem = (c - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      c = Math.floor((c - 1) / 26);
    }
    return s + (row + 1);
  }

  window.TableMasterDetector = {
    DATATYPES,
    detectDatatype,
    scanDocument,
    analyzeTable,
    a1ToCoord,
    coordToA1,
    buildGrid,
  };
})();
