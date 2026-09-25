/* formulas.js — a small spreadsheet formula engine.
 * Supports: + - * / ^ ( ), cell refs (A1, B2), ranges (A1:B3),
 * SUM, AVG/AVERAGE, MIN, MAX, COUNT, COUNTA, IF, ABS, ROUND, CONCAT, NOW, TODAY.
 * Exposes global TableMasterFormulas.evaluate(formula, resolver) where
 * resolver({row, col}) -> numeric/string value.
 */
(function () {
  "use strict";

  const FUNCS = {
    SUM: (...args) => flat(args).reduce((a, b) => a + toNum(b), 0),
    AVG: (...args) => { const n = flat(args).map(toNum); return n.length ? n.reduce((a, b) => a + b, 0) / n.length : 0; },
    AVERAGE: (...args) => FUNCS.AVG(...args),
    MIN: (...args) => Math.min(...flat(args).map(toNum)),
    MAX: (...args) => Math.max(...flat(args).map(toNum)),
    COUNT: (...args) => flat(args).filter((v) => typeof v === "number" || (!isNaN(parseFloat(v)) && isFinite(v))).length,
    COUNTA: (...args) => flat(args).filter((v) => v !== "" && v !== null && v !== undefined).length,
    ABS: (v) => Math.abs(toNum(v)),
    ROUND: (v, d = 0) => { const f = Math.pow(10, d); return Math.round(toNum(v) * f) / f; },
    IF: (cond, t, f) => (toBool(cond) ? t : f),
    CONCAT: (...args) => flat(args).map((v) => String(v ?? "")).join(""),
    NOW: () => new Date(),
    TODAY: () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; },
    PRODUCT: (...args) => flat(args).map(toNum).reduce((a, b) => a * b, 1),
    AVERAGEIF: () => { throw new Error("AVERAGEIF not implemented"); },
  };

  function flat(a) {
    const out = [];
    for (const v of a) {
      if (Array.isArray(v)) out.push(...flat(v)); else out.push(v);
    }
    return out;
  }
  function toNum(v) {
    if (v instanceof Date) return v.getTime();
    if (typeof v === "number") return v;
    if (v === null || v === undefined || v === "") return 0;
    const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
    return isNaN(n) ? 0 : n;
  }
  function toBool(v) {
    if (typeof v === "number") return v !== 0;
    if (typeof v === "boolean") return v;
    if (v === null || v === undefined) return false;
    if (/^(true|yes|y)$/i.test(String(v))) return true;
    return false;
  }

  /** Tokenize: numbers, strings "...", cell refs, ranges, identifiers, operators, parens, commas. */
  function tokenize(input) {
    const tokens = [];
    let i = 0;
    const s = input.trim();
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '"') {
        let j = i + 1, val = "";
        while (j < s.length && s[j] !== '"') { val += s[j]; j++; }
        tokens.push({ type: "str", value: val });
        i = j + 1;
      } else if (/[0-9.]/.test(c)) {
        let j = i;
        while (j < s.length && /[0-9.]/.test(s[j])) j++;
        tokens.push({ type: "num", value: parseFloat(s.slice(i, j)) });
        i = j;
      } else if (/[A-Za-z_]/.test(c)) {
        // First consume letters/underscore only (no digits — so we can distinguish
        // identifiers like SUM from cell refs like A2).
        let j = i;
        while (j < s.length && /[A-Za-z_]/.test(s[j])) j++;
        const word = s.slice(i, j);
        // check for cell or range: letters followed immediately by digits
        if (j < s.length && /[0-9]/.test(s[j])) {
          let k = j;
          while (k < s.length && /[0-9]/.test(s[k])) k++;
          const a = word + s.slice(j, k);
          if (k < s.length && s[k] === ":" && /[A-Za-z]/.test(s[k + 1])) {
            let l = k + 1;
            while (l < s.length && /[A-Za-z]/.test(s[l])) l++;
            let m = l;
            while (m < s.length && /[0-9]/.test(s[m])) m++;
            const b = s.slice(k + 1, m);
            tokens.push({ type: "range", value: a + ":" + b });
            i = m;
          } else {
            tokens.push({ type: "cell", value: a });
            i = k;
          }
        } else {
          tokens.push({ type: "ident", value: word.toUpperCase() });
          i = j;
        }
      } else if ("+-*/^(),%".indexOf(c) >= 0) {
        tokens.push({ type: "op", value: c });
        i++;
      } else if (c === "<" || c === ">" || c === "=") {
        let op = c;
        if (s[i + 1] === "=") { op += "="; i++; }
        tokens.push({ type: "op", value: op });
        i++;
      } else {
        throw new Error("Unexpected char: " + c);
      }
    }
    return tokens;
  }

  function parse(tokens) {
    let pos = 0;
    function peek() { return tokens[pos]; }
    function eat(t, v) {
      const tk = tokens[pos];
      if (!tk || tk.type !== t || (v !== undefined && tk.value !== v)) throw new Error("Parse error at token " + pos + " (" + JSON.stringify(tk) + ")");
      pos++;
      return tk;
    }
    function parseExpr() { return parseCmp(); }
    function parseCmp() {
      let left = parseAdd();
      while (peek() && peek().type === "op" && ["=", "<", ">", "<=", ">=", "<>"].includes(peek().value)) {
        const op = eat("op").value;
        const right = parseAdd();
        left = { type: "bin", op, left, right };
      }
      return left;
    }
    function parseAdd() {
      let left = parseMul();
      while (peek() && peek().type === "op" && ["+", "-"].includes(peek().value)) {
        const op = eat("op").value;
        const right = parseMul();
        left = { type: "bin", op, left, right };
      }
      return left;
    }
    function parseMul() {
      let left = parsePow();
      while (peek() && peek().type === "op" && ["*", "/", "%"].includes(peek().value)) {
        const op = eat("op").value;
        const right = parsePow();
        left = { type: "bin", op, left, right };
      }
      return left;
    }
    function parsePow() {
      let left = parseUnary();
      while (peek() && peek().type === "op" && peek().value === "^") {
        eat("op");
        const right = parseUnary();
        left = { type: "bin", op: "^", left, right };
      }
      return left;
    }
    function parseUnary() {
      if (peek() && peek().type === "op" && (peek().value === "-" || peek().value === "+")) {
        const op = eat("op").value;
        const v = parseUnary();
        return { type: "unary", op, v };
      }
      return parsePrimary();
    }
    function parsePrimary() {
      const tk = peek();
      if (!tk) throw new Error("Unexpected end");
      if (tk.type === "num") { pos++; return { type: "num", value: tk.value }; }
      if (tk.type === "str") { pos++; return { type: "str", value: tk.value }; }
      if (tk.type === "cell") { pos++; return { type: "cell", value: tk.value }; }
      if (tk.type === "range") { pos++; return { type: "range", value: tk.value }; }
      if (tk.type === "ident") {
        pos++;
        if (peek() && peek().type === "op" && peek().value === "(") {
          eat("op", "(");
          const args = [];
          if (!(peek() && peek().type === "op" && peek().value === ")")) {
            args.push(parseExpr());
            while (peek() && peek().type === "op" && peek().value === ",") {
              eat("op", ",");
              args.push(parseExpr());
            }
          }
          eat("op", ")");
          return { type: "call", name: tk.value.toUpperCase(), args };
        }
        return { type: "ident", value: tk.value };
      }
      if (tk.type === "op" && tk.value === "(") {
        eat("op", "(");
        const e = parseExpr();
        eat("op", ")");
        return e;
      }
      throw new Error("Unexpected token " + JSON.stringify(tk));
    }
    const ast = parseExpr();
    return ast;
  }

  function evalAst(ast, resolver) {
    switch (ast.type) {
      case "num": return ast.value;
      case "str": return ast.value;
      case "unary": {
        const v = evalAst(ast.v, resolver);
        return ast.op === "-" ? -toNum(v) : toNum(v);
      }
      case "bin": {
        const l = evalAst(ast.left, resolver);
        const r = evalAst(ast.right, resolver);
        switch (ast.op) {
          case "+": return isNumLike(l) && isNumLike(r) ? toNum(l) + toNum(r) : String(l) + String(r);
          case "-": return toNum(l) - toNum(r);
          case "*": return toNum(l) * toNum(r);
          case "/": return toNum(l) / toNum(r);
          case "^": return Math.pow(toNum(l), toNum(r));
          case "%": return toNum(l) % toNum(r);
          case "=": return l == r;
          case "<": return toNum(l) < toNum(r);
          case ">": return toNum(l) > toNum(r);
          case "<=": return toNum(l) <= toNum(r);
          case ">=": return toNum(l) >= toNum(r);
          case "<>": return l != r;
        }
        throw new Error("Unknown op " + ast.op);
      }
      case "cell": {
        const m = ast.value.match(/^([A-Za-z]+)(\d+)$/);
        if (!m) throw new Error("Bad cell " + ast.value);
        const colStr = m[1].toUpperCase();
        const row = parseInt(m[2], 10) - 1;
        let col = 0;
        for (let i = 0; i < colStr.length; i++) col = col * 26 + (colStr.charCodeAt(i) - 64);
        col -= 1;
        return resolver(row, col);
      }
      case "range": {
        const [a, b] = ast.value.split(":");
        const ca = cellToRC(a), cb = cellToRC(b);
        const out = [];
        const r1 = Math.min(ca.row, cb.row), r2 = Math.max(ca.row, cb.row);
        const c1 = Math.min(ca.col, cb.col), c2 = Math.max(ca.col, cb.col);
        for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) out.push(resolver(r, c));
        return out;
      }
      case "call": {
        const fn = FUNCS[ast.name];
        if (!fn) throw new Error("Unknown function " + ast.name);
        const args = ast.args.map((a) => evalAst(a, resolver));
        return fn(...args);
      }
      case "ident":
        if (ast.value === "TRUE") return true;
        if (ast.value === "FALSE") return false;
        if (ast.value === "PI") return Math.PI;
        if (ast.value === "NULL") return null;
        throw new Error("Unknown identifier " + ast.value);
    }
    throw new Error("Unknown ast " + ast.type);
  }

  function cellToRC(a1) {
    const m = a1.match(/^([A-Za-z]+)(\d+)$/);
    if (!m) return null;
    const colStr = m[1].toUpperCase();
    const row = parseInt(m[2], 10) - 1;
    let col = 0;
    for (let i = 0; i < colStr.length; i++) col = col * 26 + (colStr.charCodeAt(i) - 64);
    col -= 1;
    return { row, col };
  }

  function isNumLike(v) {
    if (typeof v === "number") return true;
    if (v instanceof Date) return true;
    if (typeof v === "string" && v !== "" && !isNaN(parseFloat(v)) && isFinite(v)) return true;
    return false;
  }

  function evaluate(formula, resolver) {
    const src = formula.startsWith("=") ? formula.slice(1) : formula;
    const tokens = tokenize(src);
    const ast = parse(tokens);
    return evalAst(ast, resolver);
  }

  /**
   * Recalculate all formula cells in a 2D matrix of {raw,value,isFormula}.
   * Resolves references safely with a max-depth guard to avoid cycles.
   */
  function recalculate(matrix) {
    // matrix: array of rows; each cell { raw, value, error? }
    const cache = {};
    function resolve(r, c) {
      const key = r + "," + c;
      if (cache[key] !== undefined) return cache[key];
      const cell = matrix[r] && matrix[r][c];
      if (!cell) return "";
      if (cell.isFormula) {
        // guard cycles
        if (cache[key] === "__computing__") return 0;
        cache[key] = "__computing__";
        try {
          const v = evaluate(cell.raw, (rr, cc) => resolve(rr, cc));
          cache[key] = v;
          cell.value = v;
          cell.error = null;
        } catch (e) {
          cell.value = "#ERR";
          cell.error = e.message;
          cache[key] = "#ERR";
        }
        return cache[key];
      }
      cache[key] = cell.value;
      return cell.value;
    }
    for (let r = 0; r < matrix.length; r++) {
      for (let c = 0; c < matrix[r].length; c++) {
        resolve(r, c);
      }
    }
  }

  window.TableMasterFormulas = { evaluate, recalculate, FUNCS };
})();
