/* Sir Bayard's module kit: pf2e-rules 2. Copied unchanged into each module that uses it; edit the kit's source, not
 * this copy. */

/*
 * Rules numbers read from the PF2e system at run time, never stored in a module: the tables in the system's GM Screen
 * journal (compendium pf2e.journals), and the attitudes from the system's own list. When a system update moves or
 * changes a table, the reader fails and says so; the module is patched then. There is no fallback copy of any table.
 *
 *   const rules = pf2eRules({ module: MODULE_ID, title: "PF2e Campaign Trackers" });
 *   Hooks.once("ready", () => rules.load());           // once; every getter after it is synchronous
 *   rules.dcByLevel(5)        a number, or null when the table couldn't be read
 *   rules.get("reputation")   { ok, value, error, page, matchedBy, notes? } (value is frozen)
 *
 * A module that needs only some tables names them (`tables: ["attitudes"]`): only those are read, and the GM is told
 * only about those. The GM Screen journal isn't opened when none of them is in it.
 *
 * A reader parses its table by column position, not by header text, so a translated system's tables still read (the
 * names in them come out in the system's language, and numbers written "355.000" or "355 000" read too). Readers of
 * numbers in the pages' prose (the points for each degree of success) read the English wording and fail in a
 * translated system; the module then asks the GM. Each reader checks the shape of what it read (so many columns and
 * levels, numbers that rise) and refuses a table that fails; it never compares with stored numbers. After load() a
 * GM is told once which tables couldn't be read, with the detail in the console; the feature that needs one asks
 * the GM for the number or switches itself off.
 */

/** The GM Screen journal. Pages are found by their id on PF2e 8.7.0 or by their name, whichever reads. */
const GM_SCREEN = "Compendium.pf2e.journals.JournalEntry.S55aqwWIzpQRFhcq";
const GM_SCREEN_NAME = "GM Screen";
const DEGREES = ["criticalSuccess", "success", "failure", "criticalFailure"];
const DEGREE_WORDS = { "critical success": "criticalSuccess", success: "success", failure: "failure", "critical failure": "criticalFailure" };

/* ------------------------------------------------------------------ */
/* Reading HTML without a page (so the readers run in node tests too)  */
/* ------------------------------------------------------------------ */

/** A tag's attribute text: quoted values may hold ">". */
const ATTRS = String.raw`(?:"[^"]*"|'[^']*'|[^"'>])*`;
const TAG = new RegExp(String.raw`<\/?[a-z]${ATTRS}>`, "gi");
/** The paired element `name` with its attribute text and content: [whole, attrs, content]. */
const element = (name) => new RegExp(String.raw`<${name}\b(${ATTRS})>([\s\S]*?)<\/${name}>`, "gi");
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", ndash: "\u2013", mdash: "\u2014", minus: "\u2212", hellip: "\u2026", rsquo: "\u2019", lsquo: "\u2018", ldquo: "\u201c", rdquo: "\u201d", times: "\u00d7", thinsp: "\u2009", ensp: "\u2002", emsp: "\u2003" };
/** Stands for a Foundry link or check with no label of its own (its text would be a document's name). */
const NO_LABEL = "\ufffc";

/** One attribute's value from a tag's attribute text ("" when it has none), or null when it isn't there. */
function attr(attrs, name) {
  for (const m of String(attrs ?? "").matchAll(/([^\s=/"'>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g)) {
    if (m[1].toLowerCase() === name) return m[2] === undefined ? "" : m[2].replace(/^["']|["']$/g, "");
  }
  return null;
}

/** Entities decoded: by the page when there is one (every named entity), else from a short list. */
function decode(s) {
  const doc = globalThis.document;
  if (doc?.createElement && /&[#a-z0-9]+;/i.test(s)) {
    // A <textarea>'s content is never run or parsed as markup: this only decodes.
    const ta = doc.createElement("textarea");
    ta.innerHTML = s.replace(/</g, "&lt;");
    return ta.value;
  }
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      // As the page decodes it: a number that is no character becomes the replacement character.
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "\ufffd";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/**
 * Text from an HTML fragment: comments and tags dropped, entities decoded, Foundry's links and checks reduced to
 * their labels (one with no label becomes NO_LABEL, which a table cell refuses), inline rolls to their label or
 * formula, white space collapsed to single spaces. A lone no-break or thin space between two digits is kept as a
 * no-break space ("355 000"), so numbersIn can read it as a thousands separator.
 */
export function textOf(html) {
  return decode(
    String(html ?? "")
      .replace(/[\u0001\ufffc]/g, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(TAG, ""),
  )
    .replace(/@\w+\[[^\]]*\]\{([^}]*)\}/g, "$1")
    .replace(/@\w+\[[^\]]*\]/g, NO_LABEL)
    .replace(/\[\[((?:[^[\]]|\[[^[\]]*\])*)\]\](?:\{([^}]*)\})?/g, (m, inner, label) => label ?? inner.replace(/^\s*\/\w+\s*/, ""))
    .replace(/(\d)[\u00a0\u2009\u202f](?=\d)/g, "$1\u0001")
    .replace(/\s+/g, " ")
    .replace(/\u0001/g, "\u00a0")
    .trim();
}

/**
 * The tables in an HTML fragment, each a list of rows of cell texts. Cells spanning columns or rows are copied into
 * every column and row they cover; a header row (all <th>) is dropped; so is a row whose only text is one cell
 * spanning the whole table (a footnote). Captions and comments are dropped. A table inside a table isn't read: its
 * place in the list is null (the reader then fails, as it should). A table whose header row was dropped carries
 * `headed: true`.
 */
export function tablesOf(html) {
  const out = [];
  const src = String(html ?? "").replace(/<!--[\s\S]*?-->/g, "");
  for (const [, , inner] of src.matchAll(element("table"))) {
    if (/<table\b/i.test(inner)) {
      out.push(null);
      continue;
    }
    const rows = [];
    const down = [];
    let headed = false;
    const clean = inner.replace(/<caption\b[\s\S]*?<\/caption>/gi, "");
    for (const [, , tr] of clean.matchAll(element("tr"))) {
      const cells = [];
      const spans = [];
      let allHead = true;
      let col = 0;
      const fillDown = () => {
        while (down[col]?.left > 0) {
          cells[col] = down[col].text;
          spans[col] = false;
          down[col].left--;
          col++;
        }
      };
      for (const [, tag, attrs, html2] of tr.matchAll(new RegExp(String.raw`<(td|th)\b(${ATTRS})>([\s\S]*?)<\/\1>`, "gi"))) {
        fillDown();
        if (tag.toLowerCase() === "td") allHead = false;
        const span = (name, max) => Math.max(1, Math.min(max, parseInt(attr(attrs, name) ?? "1", 10) || 1));
        const across = span("colspan", 50);
        const rowsDown = span("rowspan", 100);
        const text = textOf(html2);
        for (let i = 0; i < across; i++) {
          cells[col] = text;
          spans[col] = i > 0;
          if (rowsDown > 1) down[col] = { text, left: rowsDown - 1 };
          col++;
        }
      }
      fillDown();
      if (cells.length && allHead) headed = true;
      if (!cells.length || allHead) continue;
      rows.push({ cells, spans });
    }
    const width = Math.max(0, ...rows.map((r) => r.cells.length));
    const footnote = (r) => width > 1 && r.cells.length === width && r.spans.slice(1).every(Boolean) && r.cells[0] !== "";
    const list = rows.filter((r) => !footnote(r)).map((r) => r.cells);
    if (headed) list.headed = true;
    out.push(list);
  }
  return out;
}

/**
 * The paragraphs of an HTML fragment, in order: [bold text it opens with, the rest as plain text], or [null, all of
 * its text] for a paragraph that doesn't open with bold.
 */
function boldLeads(html) {
  const out = [];
  for (const [, , inner] of String(html ?? "").matchAll(element("p"))) {
    const m = new RegExp(String.raw`<(strong|b)\b${ATTRS}>([\s\S]*?)<\/\1>`, "i").exec(inner);
    // Bold that opens the paragraph (wrapping spans and the like before it are fine).
    if (!m || textOf(inner.slice(0, m.index)) !== "") out.push([null, textOf(inner)]);
    else out.push([textOf(m[2]), textOf(inner.slice(m.index + m[0].length))]);
  }
  return out;
}

/** The HTML between a heading with this text and the next heading of the same or a higher level. */
function section(html, heading) {
  const re = new RegExp(String.raw`<h([1-6])\b${ATTRS}>([\s\S]*?)<\/h\1>`, "gi");
  const heads = [...String(html ?? "").matchAll(re)].map((m) => ({ level: Number(m[1]), text: textOf(m[2]).toLowerCase(), start: m.index, end: m.index + m[0].length }));
  const i = heads.findIndex((h) => h.text === heading.toLowerCase());
  if (i < 0) return null;
  const next = heads.slice(i + 1).find((h) => h.level <= heads[i].level);
  return html.slice(heads[i].end, next ? next.start : undefined);
}

/* ------------------------------------------------------------------ */
/* Numbers in cells                                                    */
/* ------------------------------------------------------------------ */

const MINUS = /[-\u2010\u2011\u2012\u2013\u2212\ufe63\uff0d]/;
const WORDCHAR = /[\d\p{L}]/u;

/**
 * The numbers in a cell, in order.
 * - A minus sign (hyphen, en dash, the minus sign and their kin) is a sign unless a digit or a letter comes just
 *   before it, where it joins a range ("3-5" is 3 and 5; "-4 to -14" is -4 and -14; "1st-3rd" and "Level-5" have
 *   no minus).
 * - Groups of exactly three digits after the same comma, period or no-break space join into one number ("355,000",
 *   "355.000", "355 000" are 355000); after a plain space only with `amount` (a cell holding one amount, where
 *   "355 000" can't be two numbers; elsewhere "100 200" is two). A single period or comma before other than three
 *   digits is a decimal point ("7.5", "7,5", and so "6,12" too); with `list` every separator separates (a cell of
 *   whole numbers: "6,12" is 6 and 12). Any other run separates numbers ("5,10,15" and "5, 10, 15").
 * - An em dash alone means none.
 */
export function numbersIn(text, { amount = false, list = false } = {}) {
  const s = String(text ?? "");
  const out = [];
  const re = /\d+(?:(?:[.,]|[ \u00a0\u2009\u202f])\d+)*/g;
  let m;
  while ((m = re.exec(s))) {
    const parts = m[0].split(/([.,]|[ \u00a0\u2009\u202f])/);
    const groups = parts.filter((_, i) => i % 2 === 0);
    const seps = parts.filter((_, i) => i % 2 === 1);
    let values;
    if (!list && seps.length && groups[0].length <= 3 && groups.slice(1).every((g) => g.length === 3) && new Set(seps).size === 1 && (seps[0] !== " " || amount)) values = [Number(groups.join(""))];
    else if (!list && seps.length === 1 && (seps[0] === "." || seps[0] === ",")) values = [Number(`${groups[0]}.${groups[1]}`)];
    else values = groups.map(Number);
    const before = s[m.index - 1];
    if (before !== undefined && MINUS.test(before) && !WORDCHAR.test(s[m.index - 2] ?? "")) values[0] = -values[0];
    out.push(...values);
  }
  return out;
}

/** One whole number, or null when the cell has none, several, or a fraction. */
const oneInt = (text) => {
  const n = numbersIn(text);
  return n.length === 1 && Number.isInteger(n[0]) ? n[0] : null;
};
/** The first whole number ("1st"), or null. */
const firstInt = (text) => {
  const n = numbersIn(text)[0];
  return Number.isInteger(n) ? n : null;
};
/** A range "a to b", "a-b" or "a b": [low, high], or a single number as [n, n]; null when none or more. */
const rangeOf = (text) => {
  const n = numbersIn(text);
  if (n.length === 1) return [n[0], n[0]];
  if (n.length !== 2) return null;
  return n[0] <= n[1] ? [n[0], n[1]] : [n[1], n[0]];
};
const rising = (xs) => xs.every((x, i) => i === 0 || x > xs[i - 1]);
const hasDigit = (text) => /\d/.test(String(text ?? ""));
/** Gold read from a cell holding one amount ("175 gp*"), or null. */
const gold = (text) => {
  const n = numbersIn(text, { amount: true });
  return n.length === 1 && n[0] >= 0 ? n[0] : null;
};

/**
 * A table's rows. When the table had no header row of <th>, a first row with no digit in any cell is taken for a
 * header written with <td> and dropped, and `note` is told (only that one row: a later row without numbers reaches
 * the reader, which refuses it). A cell holding a link with no label is refused.
 */
function rowsOf(table, note) {
  if (!table) throw new Error("no table (or a table inside one)");
  let rows = table;
  if (rows.length && !table.headed && !rows[0].some(hasDigit)) {
    note?.(`first row read as a header: ${rows[0].join(" | ")}`);
    rows = rows.slice(1);
  }
  if (rows.some((r) => r.some((c) => c.includes(NO_LABEL)))) throw new Error("a cell holding a link with no label");
  return rows;
}

/** The rows of a table of exactly `width` columns (see rowsOf). */
function body(table, width, note) {
  const rows = rowsOf(table, note);
  const bad = rows.find((r) => r.length !== width);
  if (bad) throw new Error(`a row of ${bad.length} columns where ${width} were read: ${bad.join(" | ")}`);
  return rows;
}

/* ------------------------------------------------------------------ */
/* Readers                                                             */
/* ------------------------------------------------------------------ */

const degreeOf = (lead) => DEGREE_WORDS[lead.toLowerCase().replace(/[\s:.\u2014\u2013-]+$/u, "").trim()];

const GAIN = "gain|gains|gained|earn|earns|earned|accrue|accrues|accrued";
const GAIN_PAST = "gained|earned|accrued";
const LOSE = "lose|loses|losing|lost|forfeit|forfeits|forfeited";
const LOSE_PAST = "lost|forfeited";
const word = (verbs) => new RegExp(`\\b(${verbs})\\b`, "i");
/** "Avoids losing ground", "no points change": a degree worth nothing. */
const nothing = (rest) => /\b(avoid|avoids)\b[^.]*\blos/i.test(rest) || /\bno\b[^.]*\bpoints?\b/i.test(rest);

/** One kind of points: the number right after the verb ("gains 2"), or right before a past form ("2 are lost"). */
function plainPoints(rest, lead, where) {
  const amount = (verbs, past) => {
    const after = new RegExp(`\\b(${verbs})\\b[^.\\d]*?(\\d+)`, "i").exec(rest);
    if (after) return Number(after[2]);
    const before = new RegExp(`(\\d+)[^.\\d]*?\\b(${past})\\b`, "i").exec(rest);
    return before ? Number(before[1]) : null;
  };
  const gain = amount(GAIN, GAIN_PAST);
  const lose = amount(LOSE, LOSE_PAST);
  if (gain !== null && lose !== null) throw new Error(`${lead} ${where} both gains and loses`);
  if (gain !== null || lose !== null) return gain !== null ? gain : -lose;
  if (nothing(rest)) return 0;
  throw new Error(`${lead} ${where}: no points read`);
}

/**
 * Several kinds of points, each named right after its number ("2 Awareness Points"): { kind: points }, a kind the
 * paragraph doesn't name 0. Each number is signed by the verb before it in its sentence, or a past form after it.
 */
function kindPoints(rest, kinds, lead, where) {
  const out = Object.fromEntries(kinds.map((k) => [k, 0]));
  const hits = [...rest.matchAll(new RegExp(`(\\d+)\\s+(${kinds.join("|")})\\s+points?\\b`, "gi"))];
  if (!hits.length) {
    if (nothing(rest)) return out;
    throw new Error(`${lead} ${where}: no points read`);
  }
  if (word(GAIN).test(rest) && word(LOSE).test(rest)) throw new Error(`${lead} ${where} both gains and loses`);
  const seen = new Set();
  for (const h of hits) {
    const kind = h[2].toLowerCase();
    if (seen.has(kind)) throw new Error(`${lead} ${where}: ${h[2]} points twice`);
    seen.add(kind);
    const before = rest.slice(0, h.index).split(/[.!?;](?:\s|$)/).at(-1);
    const after = rest.slice(h.index + h[0].length).split(/[.!?;]/)[0];
    const sign = word(LOSE).test(before) || word(LOSE_PAST).test(after) ? -1 : word(GAIN).test(before) || word(GAIN_PAST).test(after) ? 1 : 0;
    if (!sign) throw new Error(`${lead} ${where}: no word for gaining or losing the ${h[2]} points`);
    out[kind] = sign * Number(h[1]) || 0;
  }
  return out;
}

/**
 * Points for each degree of success, from paragraphs that open with the degree in bold (English wording): the number
 * after a word for gaining or losing, signed by which (with `kinds`, one number per kind of points). A paragraph
 * saying nothing is lost gives 0; a paragraph with a condition ("if", "otherwise", "unless") is listed in
 * `conditional`; a degree with no paragraph is null and listed in `missing`. A bold lead that names a degree some
 * other way fails the reader. With `firstRun`, only the first run of degree paragraphs is read: it ends at a
 * paragraph that isn't one, or at a degree read already.
 */
function degreesFrom(html, where, { kinds = null, firstRun = false } = {}) {
  const points = Object.fromEntries(DEGREES.map((d) => [d, null]));
  const conditional = [];
  let started = false;
  for (const [lead, rest] of boldLeads(html)) {
    const degree = lead === null ? null : degreeOf(lead);
    if (firstRun && started && (!degree || points[degree] !== null)) break;
    if (!degree) {
      if (lead !== null && /success|failure/i.test(lead)) throw new Error(`a degree of success "${lead}" ${where} not read`);
      continue;
    }
    started = true;
    if (points[degree] !== null) throw new Error(`${lead} twice ${where}`);
    points[degree] = kinds ? kindPoints(rest, kinds, lead, where) : plainPoints(rest, lead, where);
    if (/\b(if|otherwise|unless)\b/i.test(rest)) conditional.push(degree);
  }
  const missing = DEGREES.filter((d) => points[d] === null);
  if (missing.length > 1) throw new Error(`fewer than three degrees of success ${where}`);
  // Whole numbers, and a plausibility bound (not a stored value): a subsystem's points per check are small.
  const numbers = Object.values(points).flatMap((v) => (v === null ? [] : typeof v === "number" ? [v] : Object.values(v)));
  if (numbers.some((v) => !Number.isInteger(v) || Math.abs(v) > 5)) throw new Error(`points that aren't small whole numbers ${where}`);
  return { points, missing, conditional };
}

/**
 * Each reader: where its page is (id on PF2e 8.7.0, name), how to read its HTML, and the shape what it read must have.
 * read() throws with a plain reason when the page doesn't hold what it should.
 */
const READERS = {
  dcsByLevel: {
    page: { id: "pBS3DUjlzVuFgapv", name: "DCs by Level" },
    read(html, note) {
      // Level and DC pairs, side by side with an empty column between them, or in one pair of columns.
      const rows = rowsOf(tablesOf(html)[0], note);
      const pairs = [];
      for (const row of rows) {
        const nums = row.filter((c) => c !== "").map(oneInt);
        if (nums.some((n) => n === null) || nums.length % 2) throw new Error(`a row that isn't level and DC pairs: ${row.join(" | ")}`);
        for (let i = 0; i < nums.length; i += 2) pairs.push({ level: nums[i], dc: nums[i + 1] });
      }
      pairs.sort((a, b) => a.level - b.level);
      const levels = pairs.map((p) => p.level);
      if (!levels.length || levels[0] > 0 || levels.at(-1) < 20 || !levels.every((l, i) => i === 0 || l === levels[i - 1] + 1)) throw new Error(`levels aren't a run through 0 to 20 without a gap (${levels.join(", ")})`);
      if (!rising(pairs.map((p) => p.dc))) throw new Error("the DCs don't rise with the level");
      return pairs;
    },
  },
  spellRankDCs: {
    page: { id: "pBS3DUjlzVuFgapv", name: "DCs by Level" },
    read(html, note) {
      const rows = body(tablesOf(html)[1], 2, note);
      const ranks = rows.map((r) => firstInt(r[0]));
      const dcs = rows.map((r) => oneInt(r[1]));
      if (rows.length < 9 || !ranks.every((r, i) => r === i + 1)) throw new Error(`ranks aren't 1 upward (${ranks.join(", ")})`);
      if (dcs.some((d) => d === null) || !rising(dcs)) throw new Error("the DCs don't rise with the rank");
      // Index 0 is rank 1.
      return dcs;
    },
  },
  simpleDCs: {
    page: { id: "4hahgIx6iZfRMpT8", name: "Simple DCs" },
    read(html, note) {
      const rows = body(tablesOf(html)[0], 2, note).map((r) => ({ label: r[0], dc: oneInt(r[1]) }));
      if (rows.length !== 5 || rows.some((r) => r.dc === null || !r.label)) throw new Error("not five proficiency ranks with a DC each");
      if (!rising(rows.map((r) => r.dc))) throw new Error("the DCs don't rise with the rank");
      // In rank order: untrained, trained, expert, master, legendary.
      return rows;
    },
  },
  dcAdjustments: {
    page: { id: "7zHsWW9q6YqiMIwy", name: "DC Adjustments" },
    read(html, note) {
      const rows = body(tablesOf(html)[0], 3, note).map((r) => ({ label: r[0], adjustment: oneInt(r[1]), rarity: /\p{L}/u.test(r[2]) && !hasDigit(r[2]) ? r[2] : null }));
      if (rows.length < 4 || rows.some((r) => r.adjustment === null || !r.label)) throw new Error("rows without a difficulty and an adjustment");
      const adj = rows.map((r) => r.adjustment);
      if (!rising(adj) || adj[0] >= 0 || adj.at(-1) <= 0) throw new Error("the adjustments don't run from easier (minus) to harder (plus)");
      return rows;
    },
  },
  partyTreasure: {
    page: { id: "Dae8LHdXZuBv06Jk", name: "Treasure" },
    read(html, note) {
      const rows = body(tablesOf(html)[0], 6, note).map((r) => ({ level: oneInt(r[0]), total: gold(r[1]), permanent: r[2], consumables: r[3], currency: gold(r[4]), perPC: gold(r[5]) }));
      if (rows.length !== 20 || !rows.every((r, i) => r.level === i + 1)) throw new Error("levels aren't 1 to 20");
      if (rows.some((r) => r.total === null || r.currency === null || r.perPC === null)) throw new Error("a level without its gold values, one amount each");
      if (!rising(rows.map((r) => r.total)) || !rising(rows.map((r) => r.currency)) || !rising(rows.map((r) => r.perPC))) throw new Error("gold that doesn't rise with the level");
      if (rows.some((r) => !(r.perPC < r.currency && r.currency < r.total))) throw new Error("columns out of place: per character, party currency and total don't grow in that order");
      // Index 0 is level 1; values in gp.
      return rows;
    },
  },
  newCharacterWealth: {
    page: { id: "Dae8LHdXZuBv06Jk", name: "Treasure" },
    read(html, note) {
      const rows = body(tablesOf(html)[1], 4, note).map((r) => ({ level: oneInt(r[0]), permanent: r[1], currency: gold(r[2]), lumpSum: gold(r[3]) }));
      if (rows.length !== 20 || !rows.every((r, i) => r.level === i + 1)) throw new Error("levels aren't 1 to 20");
      if (rows.some((r) => r.lumpSum === null || r.currency === null)) throw new Error("a level without its gold values, one amount each");
      if (!rising(rows.map((r) => r.lumpSum)) || rows.some((r) => r.currency > r.lumpSum)) throw new Error("lump sums that don't rise, or currency above the lump sum");
      return rows;
    },
  },
  reputation: {
    page: { id: "GMRQwFnChvxIjIiP", name: "Reputation" },
    read(html, note) {
      const rows = body(tablesOf(html)[0], 4, note).map((r) => {
        const range = rangeOf(r[1]);
        return { label: r[0], min: range?.[0] ?? null, max: range?.[1] ?? null, raisedBy: r[2], loweredBy: r[3] };
      });
      if (rows.length < 3 || rows.some((r) => !r.label || !Number.isInteger(r.min) || !Number.isInteger(r.max))) throw new Error("tiers without a name and a whole point range");
      // Highest first, each range just below the one before, no overlap and no gap.
      const ordered = rows.every((r, i) => i === 0 || r.max === rows[i - 1].min - 1);
      if (!ordered || rows.at(-1).min >= 0 || rows[0].max <= 0) throw new Error("the point ranges don't run from high to low without a gap or an overlap");
      return rows;
    },
  },
  victoryPointScales: {
    page: { id: "EBWqgmHdFUYBTD0a", name: "Victory Points" },
    read(html, note) {
      const rows = body(tablesOf(html)[0], 3, note).map((r) => {
        const end = rangeOf(r[1]);
        return { label: r[0], min: end?.[0] ?? null, max: end?.[1] ?? null, thresholds: numbersIn(r[2], { list: true }), raw: r[2] };
      });
      if (!rows.length || rows.some((r) => r.min === null || !r.label || r.min <= 0)) throw new Error("rows without a duration and an end point");
      for (const r of rows) {
        if (hasDigit(r.raw) && !r.thresholds.length) throw new Error(`thresholds "${r.raw}" not read`);
        if (r.thresholds.some((x, i, a) => !Number.isInteger(x) || x <= 0 || x >= r.max || (i && x <= a[i - 1]))) throw new Error(`thresholds "${r.raw}" that don't rise below the end point`);
        delete r.raw;
      }
      return rows;
    },
  },
  victoryPointDegrees: {
    page: { id: "EBWqgmHdFUYBTD0a", name: "Victory Points" },
    prose: true,
    read(html) {
      // Two ways of counting, each a heading with one paragraph per degree of success.
      const part = (heading) => {
        const h = section(html, heading);
        if (h === null) throw new Error(`no "${heading}" heading`);
        return degreesFrom(h, `under "${heading}"`);
      };
      return { accumulating: part("Accumulating Rolls"), diminishing: part("Diminishing Rolls") };
    },
  },
  infiltrationDegrees: {
    page: { id: "14gM2CIUCwZvxr3W", name: "Infiltration" },
    prose: true,
    read(html) {
      // The page's one run of degree paragraphs, each naming its Infiltration or Awareness Points (English wording):
      // { points: { degree: { infiltration, awareness } }, missing, conditional }.
      return degreesFrom(html, "on the page", { kinds: ["infiltration", "awareness"], firstRun: true });
    },
  },
};

/** A read value made read-only, so a module that changes it can't change it for every later caller. */
function freeze(v) {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v)) freeze(x);
  }
  return v;
}

/** A whole number from a getter's argument, or null (so null, true or "" never read as level 0 or 1). */
const whole = (x) => (typeof x === "number" ? (Number.isInteger(x) ? x : null) : typeof x === "string" && /^\s*-?\d+\s*$/.test(x) ? Number(x) : null);

/* ------------------------------------------------------------------ */
/* The reader object                                                   */
/* ------------------------------------------------------------------ */

/**
 * Rules from the PF2e system for one module.
 * @param {object} opts
 * @param {string} opts.module   the module's id (for the console)
 * @param {string} opts.title    the module's name, as the GM sees it in a notice
 * @param {boolean} [opts.byId]  false finds every page by its name only (the kit's live test, to check the names)
 * @param {string[]} [opts.tables]  the tables this module uses (names from names()); all of them when left out
 */
export function pf2eRules({ module, title, byId: useIds = true, tables = null } = {}) {
  const wanted = (name) => !Array.isArray(tables) || tables.includes(name);
  const results = new Map();
  let loading = null;
  let loaded = false;
  let systemVersion = null;
  let told = false;

  /** Tell a GM once, after load, which tables couldn't be read; the detail goes to the console. */
  const tell = (failed) => {
    for (const [name, error] of failed) console.warn(`${module} | couldn't read "${name}" from the PF2e system ${systemVersion ?? ""}: ${error}`);
    if (told || !failed.length) return;
    told = true;
    if (!globalThis.game?.user?.isGM) return;
    // Notices show their text as HTML: escape it.
    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    const what = failed.length > 3 ? `${failed.length} of its rules tables` : `the rules table${failed.length > 1 ? "s" : ""} ${failed.map(([n]) => `"${esc(n)}"`).join(", ")}`;
    try {
      globalThis.ui?.notifications?.warn(`${esc(title ?? module)} couldn't read ${what} from the PF2e system; this may need a module update. Details are in the console.`);
    } catch {
      /* no notifications: the console has it */
    }
  };

  /** The GM Screen entry, by its uuid, else by its name in the pack. */
  async function screen() {
    const fromUuid = globalThis.fromUuid ?? globalThis.foundry?.utils?.fromUuid;
    let entry = null;
    try {
      entry = await fromUuid?.(GM_SCREEN);
    } catch {
      entry = null;
    }
    if (entry) return entry;
    const pack = globalThis.game?.packs?.get("pf2e.journals");
    if (!pack) return null;
    const index = pack.index?.size ? pack.index : await pack.getIndex?.();
    const hit = index?.find?.((e) => e.name === GM_SCREEN_NAME);
    return hit ? pack.getDocument(hit._id) : null;
  }

  /** Run one reader on its page, found by id, else by name; the first that reads is the one. */
  function run(reader, entry) {
    const pages = [];
    const byId = useIds ? entry.pages?.get?.(reader.page.id) : null;
    if (byId) pages.push(["id", byId]);
    const byName = entry.pages?.find?.((p) => p.name === reader.page.name);
    if (byName && byName !== byId) pages.push(["name", byName]);
    if (!pages.length) return { ok: false, error: `page "${reader.page.name}" not found` };
    const errors = [];
    for (const [how, page] of pages) {
      const notes = [];
      try {
        const value = reader.read(page.text?.content ?? "", (n) => notes.push(n));
        return { ok: true, value: freeze(value), page: page.name, matchedBy: how, ...(notes.length ? { notes } : {}) };
      } catch (err) {
        errors.push(`${how} (${page.name}): ${err.message}`);
      }
    }
    return { ok: false, error: errors.join("; ") };
  }

  function attitudes() {
    const raw = globalThis.CONFIG?.PF2E?.attitude;
    if (!raw || typeof raw !== "object") return { ok: false, error: "CONFIG.PF2E.attitude is missing" };
    const value = Object.entries(raw).map(([key, label]) => {
      let text = typeof label === "string" ? label : String(label?.label ?? key);
      try {
        text = globalThis.game?.i18n?.localize?.(text) ?? text;
      } catch {
        /* the key as it is */
      }
      return { key, label: text };
    });
    if (value.length < 3) return { ok: false, error: "fewer than three attitudes" };
    return { ok: true, value: freeze(value), page: "CONFIG.PF2E.attitude", matchedBy: "config" };
  }

  const api = {
    /** Read every table once. Safe to call more than once; never throws or rejects. */
    load() {
      loading ??= (async () => {
        try {
          systemVersion = globalThis.game?.system?.version ?? null;
          if (wanted("attitudes")) results.set("attitudes", attitudes());
          const readers = Object.entries(READERS).filter(([name]) => wanted(name));
          let entry = null;
          try {
            entry = readers.length ? await screen() : null;
          } catch {
            entry = null;
          }
          for (const [name, reader] of readers) {
            let r;
            try {
              r = entry ? run(reader, entry) : { ok: false, error: "the GM Screen journal (pf2e.journals) wasn't found" };
            } catch (err) {
              r = { ok: false, error: String(err?.message ?? err) };
            }
            results.set(name, r);
          }
        } catch (err) {
          for (const name of api.names()) if (wanted(name) && !results.has(name)) results.set(name, { ok: false, error: String(err?.message ?? err) });
        }
        loaded = true;
        tell([...results].filter(([, r]) => !r.ok).map(([n, r]) => [n, r.error]));
      })();
      return loading;
    },

    /** Resolves once load() has finished (starting it if it hasn't been). */
    ready: () => loading ?? api.load(),

    /** Has load() finished? */
    get loaded() {
      return loaded;
    },

    /** { ok, value, error, page, matchedBy, notes? } for a table. Not ok before load() has finished, or for an unknown name. */
    get(name) {
      if (!api.names().includes(name)) return { ok: false, error: `no table named "${name}"` };
      if (!wanted(name)) return { ok: false, error: `"${name}" isn't one of the tables this module reads` };
      if (!results.has(name)) return { ok: false, error: loading ? "still loading" : "load() not called" };
      return results.get(name);
    },

    /** The names of every table this reads. */
    names: () => ["attitudes", ...Object.keys(READERS)],

    /** The system version the tables were read from. */
    get systemVersion() {
      return systemVersion;
    },

    /** The DC for a level, or null. */
    dcByLevel(level) {
      const r = api.get("dcsByLevel");
      const l = whole(level);
      return r.ok && l !== null ? (r.value.find((p) => p.level === l)?.dc ?? null) : null;
    },

    /** The DC for a spell rank (1 up), or null. */
    spellRankDC(rank) {
      const r = api.get("spellRankDCs");
      const k = whole(rank);
      return r.ok && k !== null && k >= 1 && k <= r.value.length ? r.value[k - 1] : null;
    },

    /** The simple DC for a proficiency rank: 0 untrained to 4 legendary, or null. */
    simpleDC(rank) {
      const r = api.get("simpleDCs");
      const k = whole(rank);
      return r.ok && k !== null && k >= 0 && k < r.value.length ? r.value[k].dc : null;
    },

    /** One level's party treasure (1 to 20): { total, currency, perPC, permanent, consumables } in gp, or null. */
    partyTreasure(level) {
      const r = api.get("partyTreasure");
      const l = whole(level);
      return r.ok && l !== null && l >= 1 && l <= r.value.length ? r.value[l - 1] : null;
    },

    /** Every reader's result, for the dev-world test: name, ok, how it was found, and the first and last rows. */
    summary() {
      return api.names().map((name) => {
        const r = api.get(name);
        const v = r.value;
        const rows = Array.isArray(v) ? v : v && typeof v === "object" ? Object.entries(v) : [];
        return { name, ok: r.ok, matchedBy: r.matchedBy ?? null, page: r.page ?? null, error: r.error ?? null, notes: r.notes ?? null, count: rows.length, first: rows[0] ?? null, last: rows.at(-1) ?? null };
      });
    },
  };
  return api;
}

/** For tests: read a table straight from HTML (what the reader notes goes into `notes`). */
export function readTable(name, html, notes = []) {
  const reader = READERS[name];
  if (!reader) throw new Error(`no reader "${name}"`);
  return reader.read(html, (n) => notes.push(n));
}
