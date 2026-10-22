/**
 * PF2e Campaign Trackers
 * GM Core's subsystems and a few table-neutral trackers in one window: Reputation, Victory Points,
 * Influence, Research, Chases, Infiltration, Clocks and Checklists.
 *
 * Everything is hidden from players until the GM reveals it. The full data lives in a journal entry
 * that only GMs can see; players get a copy of what has been revealed, kept in a world setting.
 * Subsystem checks are rolled through the PF2e system with a tag, and the GM applies the result
 * from the roll card. Dates on clocks and checklists send the GM a whisper when the calendar
 * reaches them. Campaign content can be shipped by another module as a preset.
 */

const MOD = "pf2e-campaign-trackers";
/** Flag scope for the data journal and chat cards. */
const SCOPE = MOD;

const KINDS = ["reputation", "pressure", "points", "influence", "research", "chase", "infiltration", "clock", "checklist"];
const KIND_INFO = {
  reputation: { label: "Reputation", tab: "Reputation", icon: "fa-solid fa-scale-balanced", blurb: "How a group regards the party, in named tiers. GM Core's Reputation subsystem, or your own tiers." },
  pressure: { label: "Pressure track", tab: "Pressure", icon: "fa-solid fa-gauge-high", blurb: "Something building against the party, in named bands: heat, alarm, suspicion, doom. You move it by judgment; it has no checks." },
  points: { label: "Victory Points", tab: "Victory Points", icon: "fa-solid fa-flag-checkered", blurb: "Progress the party earns with checks toward a goal, with thresholds along the way." },
  influence: { label: "Influence", tab: "Influence", icon: "fa-solid fa-comments", blurb: "Winning someone over across a few rounds of conversation (GM Core)." },
  research: { label: "Research", tab: "Research", icon: "fa-solid fa-book-open", blurb: "Digging through a library or archive for what it can tell (GM Core)." },
  chase: { label: "Chase", tab: "Chases", icon: "fa-solid fa-person-running", blurb: "A pursuit through a run of obstacles (GM Core)." },
  infiltration: { label: "Infiltration", tab: "Infiltration", icon: "fa-solid fa-mask", blurb: "Getting in, or out, before anyone notices (GM Core)." },
  clock: { label: "Clock", tab: "Clocks", icon: "fa-solid fa-clock", blurb: "A segmented clock. Dates on segments send you a reminder." },
  checklist: { label: "Checklist", tab: "Checklists", icon: "fa-solid fa-list-check", blurb: "Named entries to tick off, with optional closing dates." },
};

const DEGREES = ["criticalSuccess", "success", "failure", "criticalFailure"];
const DEGREE_LABEL = { criticalSuccess: "Critical Success", success: "Success", failure: "Failure", criticalFailure: "Critical Failure" };
const DEG = () => ({ criticalSuccess: 2, success: 1, failure: 0, criticalFailure: -1 });

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
/** Plain text with line breaks kept. */
const para = (s) => esc(s).replace(/\n/g, "<br>");
const uid = () => foundry.utils.randomID(10).toLowerCase();
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const num = (v, d = 0) => (Number.isFinite(Number(v)) && v !== "" && v !== null ? Number(v) : d);
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
const isPrimaryGM = () => game.user.isGM && game.users.activeGM?.id === game.user.id;

/* ------------------------------------------------------------------ */
/* Templates for every list in every tracker                           */
/* ------------------------------------------------------------------ */

const TPL = {
  tier: () => ({ id: uid(), label: "New tier", min: 0, text: "", gm: "" }),
  threshold: () => ({ id: uid(), at: 1, text: "", revealed: false }),
  check: () => ({ id: uid(), label: "", skill: "", dc: null, revealed: false }),
  rcheck: () => ({ id: uid(), label: "", skill: "", dc: null, maxRP: null, earned: 0, revealed: false }),
  note: () => ({ id: uid(), text: "", revealed: false }),
  obstacle: () => ({ id: uid(), name: "", points: 4, progress: 0, text: "", checks: [], revealed: false }),
  iobstacle: () => ({ id: uid(), name: "", points: 1, type: "group", progress: 0, byActor: {}, text: "", checks: [], revealed: false }),
  complication: () => ({ id: uid(), name: "", trigger: "", text: "", checks: [], done: false, revealed: false }),
  opportunity: () => ({ id: uid(), name: "", text: "", checks: [], done: false, revealed: false }),
  segment: () => ({ id: uid(), label: "", date: null, text: "", state: "empty", reminded: null }),
  entry: () => ({ id: uid(), group: "", label: "", detail: "", effect: "", closes: null, tag: "", done: false, revealed: false, reminded: null }),
};

/** Which fields of each kind are lists, and the template their rows use. Nested lists use "parent.child". */
const LISTS = {
  reputation: { tiers: "tier" },
  pressure: { tiers: "tier", thresholds: "threshold" },
  points: { thresholds: "threshold", checks: "check" },
  influence: { thresholds: "threshold", skills: "check", discovery: "check", resistances: "note", weaknesses: "note" },
  research: { thresholds: "threshold", checks: "rcheck" },
  chase: { obstacles: "obstacle", "obstacles.checks": "check" },
  infiltration: { awarenessThresholds: "threshold", obstacles: "iobstacle", complications: "complication", opportunities: "opportunity", "obstacles.checks": "check", "complications.checks": "check", "opportunities.checks": "check" },
  clock: { segments: "segment" },
  checklist: { entries: "entry" },
};

/** The template for a list at a path such as "obstacles.2.checks". */
function tplFor(kind, listPath) {
  const generic = listPath.replace(/\.\d+\./g, ".");
  return LISTS[kind]?.[generic] ?? null;
}

const GMCORE_TIERS = () => [
  { id: "hunted", label: "Hunted", min: -50, text: "They want the party dead, captured or driven out.", gm: "Raised only by a moderate or major favor. Lowered by a major disservice." },
  { id: "hated", label: "Hated", min: -29, text: "They act against the party when they can.", gm: "Raised by any favor. Lowered by a major disservice." },
  { id: "disliked", label: "Disliked", min: -14, text: "They distrust the party and won't help it.", gm: "Raised by any favor. Lowered by a moderate or major disservice." },
  { id: "ignored", label: "Ignored", min: -4, text: "They pay the party no special attention.", gm: "Raised by any favor. Lowered by any disservice." },
  { id: "liked", label: "Liked", min: 5, text: "They think well of the party and may help it.", gm: "Raised by a moderate or major favor. Lowered by any disservice." },
  { id: "admired", label: "Admired", min: 15, text: "They are glad to help the party.", gm: "Raised by a major favor. Lowered by any disservice." },
  { id: "revered", label: "Revered", min: 30, text: "They would go a long way for the party.", gm: "Raised by a major favor. Lowered by a moderate or major disservice." },
];

const PRESSURE_BANDS = () => [
  { id: "low", label: "Low", min: 0, text: "", gm: "" },
  { id: "rising", label: "Rising", min: 4, text: "", gm: "" },
  { id: "high", label: "High", min: 8, text: "", gm: "" },
];

const GMCORE_AWARENESS = () => [
  { id: "ap5", at: 5, text: "DCs rise by 1. The first time, a complication.", revealed: false },
  { id: "ap10", at: 10, text: "The first time, a complication.", revealed: false },
  { id: "ap15", at: 15, text: "DCs rise by 2 in all. The first time, a complication.", revealed: false },
  { id: "ap20", at: 20, text: "The infiltration fails.", revealed: false },
];

/** A new, empty tracker of a kind. */
function blank(kind, name) {
  const base = { id: uid(), kind, name: name || `New ${KIND_INFO[kind].label.toLowerCase()}`, revealed: false, desc: "", notes: "", sort: Date.now() };
  switch (kind) {
    case "reputation":
      return { ...base, value: 0, min: -50, max: 50, showValue: true, steps: [1, 2, 5], tiers: GMCORE_TIERS() };
    case "pressure":
      return { ...base, value: 0, min: 0, max: 10, showValue: false, halve: true, steps: [1], tiers: PRESSURE_BANDS(), thresholds: [] };
    case "points":
      return { ...base, value: 0, min: 0, max: 10, showValue: true, halve: false, thresholds: [], checks: [], degrees: DEG() };
    case "influence":
      return { ...base, npc: null, value: 0, rounds: 3, roundsUsed: 0, thresholds: [], skills: [], discovery: [], resistances: [], weaknesses: [], penalty: "", degrees: DEG() };
    case "research":
      return { ...base, value: 0, round: 0, thresholds: [], checks: [], degrees: DEG() };
    case "chase":
      return { ...base, round: 1, current: 0, quarry: { enabled: true, label: "Quarry", at: 1 }, obstacles: [TPL.obstacle()], degrees: DEG() };
    case "infiltration":
      return { ...base, round: 1, awareness: 0, showAwareness: false, edge: 0, objective: 0, awarenessThresholds: GMCORE_AWARENESS(), obstacles: [], complications: [], opportunities: [] };
    case "clock":
      return { ...base, ordered: false, showLabels: false, segments: Array.from({ length: 6 }, () => TPL.segment()) };
    case "checklist":
      return { ...base, entries: [] };
  }
  return base;
}

/** Fill in defaults and ids, so a tracker from a preset or an older version has every field. */
function normalize(raw) {
  const kind = KINDS.includes(raw?.kind) ? raw.kind : "points";
  const t = { ...blank(kind), ...clone(raw), kind };
  if (raw.id) t.id = raw.id;
  for (const [path, tpl] of Object.entries(LISTS[kind])) {
    if (path.includes(".")) continue;
    t[path] = (Array.isArray(t[path]) ? t[path] : []).map((row) => fillRow(kind, path, row, tpl));
  }
  if (t.degrees) t.degrees = { ...DEG(), ...t.degrees };
  if (kind === "chase") t.quarry = { enabled: true, label: "Quarry", at: 1, ...(t.quarry ?? {}) };
  return t;
}

function fillRow(kind, path, row, tpl) {
  const out = { ...TPL[tpl](), ...row };
  out.id = String(row.id ?? row.key ?? out.id);
  delete out.key;
  for (const [sub, subTpl] of Object.entries(LISTS[kind])) {
    if (!sub.startsWith(`${path}.`)) continue;
    const field = sub.slice(path.length + 1);
    out[field] = (Array.isArray(out[field]) ? out[field] : []).map((r) => fillRow(kind, sub, r, subTpl));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Reading trackers                                                    */
/* ------------------------------------------------------------------ */

const clamp = (v, lo, hi) => Math.min(hi ?? Infinity, Math.max(lo ?? -Infinity, v));
const nullNum = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

/** Tiers sorted low to high, with the range each covers. */
function tierLadder(t) {
  const tiers = [...(t.tiers ?? [])].sort((a, b) => num(a.min) - num(b.min));
  return tiers.map((tier, i) => {
    const next = tiers[i + 1];
    const lo = i === 0 ? nullNum(t.min) : num(tier.min);
    const hi = next ? num(next.min) - 1 : nullNum(t.max);
    const range = lo === null && hi === null ? "Any" : lo === null ? `${hi} or lower` : hi === null ? `${lo} or higher` : lo === hi ? `${lo}` : `${lo} to ${hi}`;
    return { ...tier, range };
  });
}

function currentTier(t) {
  const ladder = tierLadder(t);
  let tier = ladder[0] ?? null;
  for (const x of ladder) if (num(t.value) >= num(x.min)) tier = x;
  return tier;
}

/** Thresholds with whether they have been reached. */
const reached = (list, value) => [...(list ?? [])].sort((a, b) => num(a.at) - num(b.at)).map((th) => ({ ...th, reached: num(value) >= num(th.at) }));

/** Infiltration points the party has earned across all obstacles. */
function infiltrationIP(t) {
  let total = 0;
  for (const o of t.obstacles ?? []) {
    if (o.type === "individual") total += Object.values(o.byActor ?? {}).reduce((s, v) => s + num(v), 0);
    else total += num(o.progress);
  }
  return total;
}

/** A one-line summary for the card header. */
function summary(t) {
  switch (t.kind) {
    case "reputation": {
      const tier = currentTier(t);
      return `${tier?.label ?? "No tiers"} (${signed(num(t.value))})`;
    }
    case "pressure": {
      const tier = currentTier(t);
      return `${tier?.label ?? "No bands"} (${num(t.value)}${nullNum(t.max) !== null ? ` of ${t.max}` : ""})`;
    }
    case "points":
      return t.max !== null && t.max !== undefined && t.max !== "" ? `${num(t.value)} / ${t.max}` : `${num(t.value)}`;
    case "influence":
      return `${num(t.value)} influence, round ${num(t.roundsUsed)} of ${num(t.rounds)}`;
    case "research":
      return `${num(t.value)} research points`;
    case "chase": {
      const n = t.obstacles?.length ?? 0;
      const at = num(t.current);
      return at >= n ? `Done, round ${num(t.round)}` : `Obstacle ${at + 1} of ${n}, round ${num(t.round)}`;
    }
    case "infiltration":
      return `${infiltrationIP(t)} infiltration, ${num(t.awareness)} awareness, round ${num(t.round)}`;
    case "clock": {
      const segs = t.segments ?? [];
      return `${segs.filter((s) => s.state === "filled").length} / ${segs.length}`;
    }
    case "checklist": {
      const e = t.entries ?? [];
      return `${e.filter((x) => x.done).length} of ${e.length} done`;
    }
  }
  return "";
}

/** Find a row anywhere in a tracker by id, with the list it sits in. */
function findRow(t, id) {
  const walk = (obj, path) => {
    for (const [key, val] of Object.entries(obj)) {
      if (!Array.isArray(val)) continue;
      for (let i = 0; i < val.length; i++) {
        const row = val[i];
        if (!row || typeof row !== "object") continue;
        const p = path ? `${path}.${key}.${i}` : `${key}.${i}`;
        if (row.id === id) return { row, list: path ? `${path.replace(/\.\d+/g, "")}.${key}` : key, path: p, parent: obj };
        const inner = walk(row, p);
        if (inner) return inner;
      }
    }
    return null;
  };
  return walk(t, "");
}

/** Lowest and highest value a numeric field can take. */
function bounds(t, path) {
  if (path === "value") {
    if (["points", "reputation", "pressure"].includes(t.kind)) return [nullNum(t.min), nullNum(t.max)];
    return [0, null];
  }
  if (path === "current") return [0, t.obstacles?.length ?? 0];
  if (path === "quarry.at") return [0, (t.obstacles?.length ?? 0) + 1];
  const m = path.match(/^obstacles\.(\d+)\.(progress|byActor\.[^.]+)$/);
  if (m) return [0, num(t.obstacles?.[Number(m[1])]?.points, null)];
  if (path === "roundsUsed" && t.kind === "influence") return [0, null];
  return [0, null];
}

/* ------------------------------------------------------------------ */
/* Storage                                                            */
/* ------------------------------------------------------------------ */

/**
 * The full data, GM only, is a JSON string in a flag on a journal entry nobody else can see.
 * Players read the "public" world setting, which holds only what has been revealed.
 */
const Store = {
  data: { v: 1, rev: 0, trackers: [], presets: {} },
  journal: null,
  /** The revision of the data this client last loaded or wrote. Every save raises it by one. */
  rev: 0,
  /** The stored JSON as it is when it can't be parsed. Nothing is written over it. */
  broken: null,
  writing: null,
  pending: false,
  warnedDupes: false,

  /** The data journal. With more than one (a duplicate, an import), the one already in use, else the first. */
  find() {
    const all = game.journal?.filter((j) => j.getFlag?.(SCOPE, "store")) ?? [];
    if (all.length > 1 && !this.warnedDupes) {
      this.warnedDupes = true;
      ui.notifications.warn(`Campaign Trackers: ${all.length} journal entries carry the tracker data (${all.map((j) => `"${j.name}"`).join(", ")}). Keep one: export your data from the window menu, then unlock and delete the others (see the README).`);
    }
    return all.find((j) => j.id === this.journal?.id) ?? all[0] ?? null;
  },

  load() {
    this.journal = this.find();
    const raw = this.journal?.getFlag(SCOPE, "json");
    let data = null;
    this.broken = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch (err) {
      console.error(`${MOD} | stored data could not be read`, err);
      this.broken = raw;
      ui.notifications.error("Campaign Trackers: the stored data couldn't be read, so nothing can be changed until it's fixed. Export it from the window menu, fix the file, then import it.");
    }
    this.data = { v: 1, rev: 0, trackers: [], presets: {}, ...(data ?? {}) };
    this.data.trackers = (this.data.trackers ?? []).map(normalize);
    this.rev = num(this.data.rev, 0);
  },

  /** Make sure there is a data journal: find it, or, as the active GM, create it with the current data. Never makes a second one. */
  async ensure() {
    this.journal = this.find();
    if (this.journal || !isPrimaryGM()) return;
    await JournalEntry.create({
      name: "Campaign Trackers (GM data)",
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
      flags: { [SCOPE]: { store: true, json: JSON.stringify(this.data) } },
    });
    this.journal = this.find();
  },

  /** The revision in the journal right now, or null when there is none to read. */
  storedRev() {
    const raw = this.journal?.getFlag(SCOPE, "json");
    if (!raw) return null;
    try {
      return num(JSON.parse(raw).rev, 0);
    } catch {
      return null;
    }
  },

  get(id) {
    return this.data.trackers.find((t) => t.id === id) ?? null;
  },

  /**
   * Write the current data, one write at a time; changes made while writing go in the next one.
   * A failed write says so. If the journal holds a newer revision than this client loaded (the
   * same GM in another tab), the data is reloaded instead of overwritten.
   */
  async save() {
    if (!game.user.isGM) return;
    if (this.writing) {
      this.pending = true;
      return this.writing;
    }
    this.writing = (async () => {
      do {
        this.pending = false;
        try {
          if (this.broken) throw new Error("the stored data couldn't be read; export it, fix it, then import it");
          if (!this.journal || !game.journal.get(this.journal.id)) await this.ensure();
          if (!this.journal) throw new Error("there is no data journal; the active GM creates it on login");
          const stored = this.storedRev();
          if (stored !== null && stored !== this.rev) {
            this.load();
            refresh();
            ui.notifications.warn("Campaign Trackers: another window saved newer data, so this one has reloaded it instead of overwriting. Make your change again.");
            return;
          }
          this.data.rev = this.rev + 1;
          const json = JSON.stringify(this.data);
          this.rev = this.data.rev;
          try {
            await this.journal.update({ [`flags.${SCOPE}.json`]: json });
          } catch (err) {
            this.rev -= 1;
            throw err;
          }
          await publish(this.data);
        } catch (err) {
          console.error(`${MOD} | save failed`, err);
          ui.notifications.error(`Campaign Trackers: couldn't save (${err.message}). The change is only in this window; export your data from the window menu before reloading.`);
          return;
        }
      } while (this.pending);
    })();
    try {
      await this.writing;
    } finally {
      this.writing = null;
    }
  },

  /** Replace everything with imported data and write it. */
  async replace(data) {
    if (!game.user.isGM) return;
    this.data = { v: 1, rev: 0, trackers: [], presets: {}, ...data };
    this.data.trackers = (this.data.trackers ?? []).map(normalize);
    this.broken = null;
    this.rev = this.storedRev() ?? 0;
    await this.save();
    refresh();
  },
};

/**
 * Change the data. The function gets a copy to change and can return a value. Notices about
 * thresholds crossed and tiers changed are whispered to the GM.
 */
async function mutate(fn, { notify = true } = {}) {
  if (!game.user.isGM) return;
  if (Store.broken) return void ui.notifications.error("Campaign Trackers: the stored data couldn't be read, so nothing can be changed until it's fixed. Export it from the window menu, fix the file, then import it.");
  const before = clone(Store.data);
  const draft = clone(Store.data);
  const result = fn(draft);
  draft.trackers = draft.trackers.map(normalize);
  Store.data = draft;
  refresh();
  if (notify) {
    const lines = [];
    for (const t of draft.trackers) {
      const old = before.trackers.find((x) => x.id === t.id);
      if (old) lines.push(...notices(old, t));
    }
    if (lines.length) whisperGM(lines, "fa-solid fa-bullhorn");
  }
  await Store.save();
  return result;
}

const mutateTracker = (id, fn, opts) => mutate((d) => {
  const t = d.trackers.find((x) => x.id === id);
  return t ? fn(t, d) : undefined;
}, opts);

/** What changed that the GM should hear about: thresholds crossed upward, tiers, cleared obstacles. */
function notices(a, b) {
  const out = [];
  const n = esc(b.name);
  const crossed = (list, from, to, label) => {
    for (const th of list ?? []) {
      if (num(from) < num(th.at) && num(to) >= num(th.at)) out.push(`<strong>${n}</strong> reached ${label} ${th.at}${th.text ? `: ${para(th.text)}` : "."}`);
    }
  };
  switch (b.kind) {
    case "reputation": {
      const ta = currentTier(a), tb = currentTier(b);
      if (ta?.id !== tb?.id && tb) out.push(`<strong>${n}</strong> is now ${esc(tb.label)} (${signed(num(b.value))}).`);
      break;
    }
    case "pressure": {
      const ta = currentTier(a), tb = currentTier(b);
      const up = num(b.value) > num(a.value);
      if (ta?.id !== tb?.id && tb) out.push(`<strong>${n}</strong> ${up ? "has risen to" : "has fallen to"} ${esc(tb.label)} (${num(b.value)})${up && tb.gm ? `: ${para(tb.gm)}` : "."}`);
      crossed(b.thresholds, a.value, b.value, "");
      break;
    }
    case "points":
    case "influence":
    case "research":
      crossed(b.thresholds, a.value, b.value, b.kind === "influence" ? "influence" : b.kind === "research" ? "research points" : "");
      break;
    case "infiltration":
      crossed(b.awarenessThresholds, a.awareness, b.awareness, "awareness");
      break;
    case "chase": {
      const na = num(a.current), nb = num(b.current);
      if (nb > na) {
        for (let i = na; i < nb; i++) out.push(`<strong>${n}</strong>: the party is past obstacle ${i + 1}${b.obstacles[i]?.name ? `, ${esc(b.obstacles[i].name)}` : ""}.`);
        if (nb >= b.obstacles.length) out.push(`<strong>${n}</strong>: the party has cleared the last obstacle.`);
      }
      if (b.quarry?.enabled && nb < b.obstacles.length && nb + 1 >= num(b.quarry.at) && !(na + 1 >= num(a.quarry?.at))) {
        out.push(`<strong>${n}</strong>: the party has caught up with the ${esc((b.quarry.label || "quarry").toLowerCase())}.`);
      }
      break;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* What players see                                                    */
/* ------------------------------------------------------------------ */

const shown = (list) => (list ?? []).filter((x) => x.revealed);
const pubCheck = (c) => ({ id: c.id, label: c.label, skill: c.skill, dc: c.dc, maxRP: c.maxRP ?? null, earned: c.earned ?? 0 });

/** The part of a tracker players may see, or null while it is hidden. */
function project(t, { force = false } = {}) {
  if (!t.revealed && !force) return null;
  const p = { id: t.id, kind: t.kind, name: t.name, desc: t.desc, sort: t.sort };
  switch (t.kind) {
    case "reputation": {
      const tier = currentTier(t);
      return { ...p, value: t.showValue ? num(t.value) : null, tier: tier?.id ?? null, tiers: tierLadder(t).map((x) => ({ id: x.id, label: x.label, range: t.showValue ? x.range : "", text: x.text })) };
    }
    case "pressure": {
      const tier = currentTier(t);
      return { ...p, value: t.showValue ? num(t.value) : null, max: t.showValue ? nullNum(t.max) : null, tier: tier?.id ?? null, tiers: tierLadder(t).map((x) => ({ id: x.id, label: x.label, range: t.showValue ? x.range : "", text: x.text })), thresholds: reached(shown(t.thresholds), t.value).map(({ at, text, reached: r }) => ({ at: t.showValue ? at : null, text, reached: r })) };
    }
    case "points":
      return { ...p, value: t.showValue ? num(t.value) : null, max: t.showValue ? nullNum(t.max) : null, thresholds: reached(shown(t.thresholds), t.value).map(({ at, text, reached: r }) => ({ at: t.showValue ? at : null, text, reached: r })), checks: shown(t.checks).map(pubCheck) };
    case "influence":
      return { ...p, npc: t.npc ? { name: t.npc.name, img: t.npc.img } : null, value: num(t.value), rounds: num(t.rounds), roundsUsed: num(t.roundsUsed), thresholds: reached(shown(t.thresholds), t.value).map(({ at, text, reached: r }) => ({ at, text, reached: r })), skills: shown(t.skills).map(pubCheck), discovery: shown(t.discovery).map(pubCheck), resistances: shown(t.resistances).map((x) => x.text), weaknesses: shown(t.weaknesses).map((x) => x.text) };
    case "research":
      return { ...p, value: num(t.value), thresholds: reached(shown(t.thresholds), t.value).map(({ at, text, reached: r }) => ({ at, text, reached: r })), checks: shown(t.checks).map(pubCheck) };
    case "chase":
      return { ...p, round: num(t.round), current: num(t.current), quarry: t.quarry?.enabled ? { label: t.quarry.label, at: num(t.quarry.at) } : null, obstacles: t.obstacles.map((o) => (o.revealed ? { id: o.id, name: o.name, points: num(o.points), progress: num(o.progress), checks: o.checks.map(pubCheck) } : { id: o.id, hidden: true })) };
    case "infiltration":
      return { ...p, round: num(t.round), awareness: t.showAwareness ? num(t.awareness) : null, edge: num(t.edge), ip: infiltrationIP(t), objective: num(t.objective), obstacles: shown(t.obstacles).map((o) => ({ id: o.id, name: o.name, type: o.type, points: num(o.points), progress: num(o.progress), byActor: o.byActor, checks: o.checks.map(pubCheck) })), complications: shown(t.complications).map((o) => ({ id: o.id, name: o.name, done: o.done, checks: o.checks.map(pubCheck) })), opportunities: shown(t.opportunities).map((o) => ({ id: o.id, name: o.name, done: o.done, checks: o.checks.map(pubCheck) })) };
    case "clock":
      return { ...p, segments: t.segments.map((s) => ({ state: s.state, label: t.showLabels ? s.label : "" })) };
    case "checklist":
      return { ...p, entries: shown(t.entries).map((e) => ({ id: e.id, group: e.group, label: e.label, done: e.done, closes: e.closes })) };
  }
  return p;
}

async function publish(data) {
  const pub = { trackers: data.trackers.map((t) => project(t)).filter(Boolean) };
  const current = game.settings.get(MOD, "public");
  if (JSON.stringify(current) === JSON.stringify(pub)) return;
  await game.settings.set(MOD, "public", pub);
}

/** Trackers as the current user sees them: everything for a GM, the revealed copy for players. */
function visibleTrackers({ asPlayer = false } = {}) {
  if (game.user.isGM && !asPlayer) return Store.data.trackers;
  if (game.user.isGM) return Store.data.trackers.map((t) => project(t)).filter(Boolean);
  return game.settings.get(MOD, "public")?.trackers ?? [];
}

/* ------------------------------------------------------------------ */
/* Presets                                                             */
/* ------------------------------------------------------------------ */

const presets = new Map();
let storeReady = false;

/** Fields that belong to play, kept when a preset's text is updated. */
const STATE_KEYS = new Set(["value", "revealed", "round", "current", "awareness", "edge", "roundsUsed", "progress", "byActor", "done", "state", "earned", "reminded", "showValue", "showAwareness", "showLabels", "npc"]);

/**
 * Copy play state from an old copy of a tracker into a fresh one from a preset. Rows in a list
 * that the preset doesn't have (ones the GM added) are kept, after the preset's own.
 */
function keepState(fresh, old) {
  if (!old || typeof old !== "object") return fresh;
  for (const [key, val] of Object.entries(fresh)) {
    if (STATE_KEYS.has(key) && key in old) {
      fresh[key] = clone(old[key]);
    } else if (Array.isArray(val) && Array.isArray(old[key])) {
      fresh[key] = val.map((row) => (row && typeof row === "object" && row.id ? keepState(row, old[key].find((o) => o?.id === row.id)) : row));
      const ids = new Set(val.map((row) => row?.id));
      for (const o of old[key]) if (o && typeof o === "object" && o.id && !ids.has(o.id)) fresh[key].push(clone(o));
    } else if (val && typeof val === "object" && !Array.isArray(val) && old[key] && typeof old[key] === "object") {
      fresh[key] = keepState(val, old[key]);
    }
  }
  return fresh;
}

/** A preset tracker with its id and defaults, ready to store. */
function fromPreset(preset, raw, index) {
  const { key, ...rest } = raw;
  const t = normalize({ ...rest, id: `${preset.id}-${key ?? raw.id ?? index}`, preset: preset.id, sort: num(raw.sort, index) });
  return t;
}

function mergePreset(d, preset) {
  let added = 0, updated = 0;
  preset.trackers.forEach((raw, i) => {
    const fresh = fromPreset(preset, raw, i);
    const at = d.trackers.findIndex((t) => t.id === fresh.id);
    if (at < 0) {
      d.trackers.push(fresh);
      added++;
    } else {
      const old = d.trackers[at];
      const merged = keepState(fresh, old);
      if (merged.kind === "chase" && old.quarry) merged.quarry.at = old.quarry.at;
      d.trackers[at] = merged;
      updated++;
    }
  });
  d.presets[preset.id] = { version: preset.version, label: preset.label, at: Date.now() };
  return { added, updated };
}

/** Load presets the world hasn't seen, and update the text of ones whose version changed. */
async function syncPresets({ force = false, only = null } = {}) {
  if (!storeReady || !isPrimaryGM() || Store.broken) return;
  for (const preset of presets.values()) {
    if (only && preset.id !== only) continue;
    const have = Store.data.presets?.[preset.id];
    if (have && have.version === preset.version && !force) continue;
    const { added, updated } = await mutate((d) => mergePreset(d, preset), { notify: false });
    const what = [added && `${added} added`, updated && `${updated} updated`].filter(Boolean).join(", ");
    ui.notifications.info(`Campaign Trackers: ${preset.label} preset ${have ? "updated" : "loaded"} (${what || "no trackers"}). New trackers start hidden from players.`);
  }
}

/** Another module registers campaign content: { id, label, version, trackers: [...] }. */
function registerPreset(preset) {
  if (!preset?.id || !Array.isArray(preset.trackers)) throw new Error(`${MOD} | a preset needs an id and a trackers list`);
  presets.set(preset.id, { label: preset.id, version: "1", ...preset });
  if (storeReady) syncPresets({ only: preset.id });
}

/* ------------------------------------------------------------------ */
/* Checks                                                              */
/* ------------------------------------------------------------------ */

const titleCase = (s) => String(s).replace(/\b\w/g, (c) => c.toUpperCase());

function skillLabel(slug) {
  if (!slug) return "Check";
  const s = String(slug).toLowerCase();
  if (s === "perception") return "Perception";
  const sk = globalThis.CONFIG?.PF2E?.skills?.[s];
  if (sk) return game.i18n.localize(sk.label ?? sk);
  const sv = globalThis.CONFIG?.PF2E?.saves?.[s];
  if (sv) return game.i18n.localize(sv.label ?? sv);
  if (s.endsWith("-lore")) return `${titleCase(s.slice(0, -5).replace(/-/g, " "))} Lore`;
  return titleCase(s.replace(/-/g, " "));
}

/** The roll option that ties a roll to a tracker: pf2e-campaign-trackers:<tracker>:<target>:<check>. */
const rollTag = (tid, target, checkId) => `${MOD}:${tid}:${target}:${checkId}`;
function parseTag(options) {
  const tag = (options ?? []).find((o) => typeof o === "string" && o.startsWith(`${MOD}:`));
  if (!tag) return null;
  const [, tid, target, checkId] = tag.split(":");
  return tid && target ? { tid, target, checkId } : null;
}

/** Who rolls: the selected tokens the user owns, or their assigned character. */
function rollers() {
  const fromTokens = (globalThis.canvas?.tokens?.controlled ?? []).map((t) => t.actor).filter((a) => a?.isOwner);
  if (fromTokens.length) return [...new Set(fromTokens)];
  return game.user.character ? [game.user.character] : [];
}

async function rollCheck({ tid, target, check, title }) {
  const actors = rollers();
  if (!actors.length) return ui.notifications.warn(game.user.isGM ? "Select the tokens of the characters who are rolling." : "Select your token, or ask the GM to assign you a character.");
  for (const actor of actors) {
    const stat = actor.getStatistic?.(String(check.skill || "").toLowerCase());
    if (!stat) {
      ui.notifications.warn(`${actor.name} has no ${skillLabel(check.skill)} to roll.`);
      continue;
    }
    const dc = Number.isFinite(Number(check.dc)) && check.dc !== null && check.dc !== "" ? { value: Number(check.dc) } : undefined;
    await stat.roll({ dc, label: title, extraRollOptions: [rollTag(tid, target, check.id)] });
  }
}

/** The thing a roll targets inside a tracker, and the checks it offers. */
function locate(t, target) {
  if (target === "main") return { type: "main", obj: t, checks: t.checks ?? [], name: "" };
  const found = findRow(t, target);
  if (!found) return null;
  const list = found.list;
  const row = found.row;
  if (["obstacles", "complications", "opportunities"].includes(list)) return { type: list.slice(0, -1), obj: row, checks: row.checks ?? [], name: row.name, index: Number(found.path.split(".")[1]) };
  if (["skills", "discovery", "checks"].includes(list)) return { type: list === "discovery" ? "discover" : "check", obj: row, checks: [row], name: row.label || skillLabel(row.skill) };
  return null;
}

/** The roll title on the card: tracker name and what the check is for. */
function rollTitle(t, target) {
  const where = locate(t, target);
  return where?.name && where.type !== "check" ? `${t.name}: ${where.name}` : t.name;
}

/**
 * Apply a roll's degree of success to a tracker. Changes the tracker in place and returns a line
 * saying what happened, or null if the roll doesn't apply.
 */
function applyRoll(t, { target, outcome, actorId = null, actorName = "" }) {
  if (!DEGREES.includes(outcome)) return null;
  const where = locate(t, target);
  if (!where) return null;
  const deg = num(t.degrees?.[outcome], DEG()[outcome]);
  const res = DEGREE_LABEL[outcome];
  const who = actorName ? `${actorName}: ` : "";
  switch (t.kind) {
    case "points": {
      const [lo, hi] = bounds(t, "value");
      const before = num(t.value);
      t.value = clamp(before + deg, lo, hi);
      return `${who}${res}, ${signed(t.value - before)} to ${t.name} (now ${t.value}).`;
    }
    case "influence": {
      if (where.type === "discover") {
        const what = { criticalSuccess: "learn two things about them", success: "learn one thing about them", failure: "learn nothing", criticalFailure: "learn one thing, and it's wrong" }[outcome];
        return `${who}Discover, ${res}: they ${what}.`;
      }
      const before = num(t.value);
      t.value = Math.max(0, before + deg);
      return `${who}${res}, ${signed(t.value - before)} influence (now ${t.value}).`;
    }
    case "research": {
      const c = where.obj;
      let pts = deg;
      const max = nullNum(c.maxRP);
      if (pts > 0 && max !== null) pts = Math.max(0, Math.min(pts, max - num(c.earned)));
      if (pts > 0) c.earned = num(c.earned) + pts;
      const before = num(t.value);
      t.value = Math.max(0, before + pts);
      const capped = deg > 0 && pts < deg ? ` ${c.label || skillLabel(c.skill)} has nothing more to give.` : "";
      return `${who}${res}, ${signed(t.value - before)} research points (now ${t.value}).${capped}`;
    }
    case "chase": {
      if (where.type !== "obstacle") return null;
      const o = where.obj;
      const before = num(o.progress);
      o.progress = clamp(before + deg, 0, num(o.points));
      let line = `${who}${res}, ${signed(o.progress - before)} at ${o.name || `obstacle ${where.index + 1}`} (${o.progress} of ${o.points}).`;
      if (o.progress >= num(o.points) && where.index === num(t.current)) {
        t.current = num(t.current) + 1;
        line += " Obstacle cleared.";
      }
      return line;
    }
    case "infiltration": {
      const o = where.obj;
      if (where.type === "obstacle") {
        if (outcome === "success" || outcome === "criticalSuccess") {
          if (o.type === "individual") {
            const key = actorId || "party";
            o.byActor = { ...(o.byActor ?? {}) };
            const before = num(o.byActor[key]);
            o.byActor[key] = Math.min(num(o.points), before + deg);
            return `${who}${res}, ${signed(o.byActor[key] - before)} infiltration at ${o.name} (${o.byActor[key]} of ${o.points} for them).`;
          }
          const before = num(o.progress);
          o.progress = Math.min(num(o.points), before + deg);
          return `${who}${res}, ${signed(o.progress - before)} infiltration at ${o.name} (${o.progress} of ${o.points}).`;
        }
        const ap = outcome === "criticalFailure" ? 2 : 1;
        t.awareness = num(t.awareness) + ap;
        return `${who}${res} at ${o.name}, +${ap} awareness (now ${t.awareness}).`;
      }
      if (where.type === "complication") {
        if (outcome === "success" || outcome === "criticalSuccess") {
          o.done = true;
          return `${who}${res}, ${o.name} is dealt with.`;
        }
        const ap = outcome === "criticalFailure" ? 2 : 1;
        t.awareness = num(t.awareness) + ap;
        return `${who}${res} against ${o.name}, +${ap} awareness (now ${t.awareness}).`;
      }
      if (where.type === "opportunity") {
        if (outcome === "success" || outcome === "criticalSuccess") o.done = true;
        return `${who}${res} at ${o.name}.${o.done ? " Marked as taken." : ""}`;
      }
      return null;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Chat                                                                */
/* ------------------------------------------------------------------ */

const gmIds = () => game.users.filter((u) => u.isGM).map((u) => u.id);

function whisperGM(lines, icon = "fa-solid fa-bell", title = "Campaign Trackers") {
  if (!game.user.isGM || !lines.length) return;
  return ChatMessage.create({
    content: `<div class="pct-chat"><header><i class="${icon}"></i> <strong>${esc(title)}</strong></header><ul>${lines.map((l) => `<li>${l}</li>`).join("")}</ul></div>`,
    speaker: { alias: "Campaign Trackers" },
    whisper: gmIds(),
  });
}

/**
 * Post checks as buttons anyone can click to roll: the checks of one obstacle, complication or
 * opportunity (target), or the revealed checks of a list such as influence skills (list).
 */
async function postCheckCard(t, { target = null, list = null } = {}) {
  let checks, title, text = "";
  if (list) {
    checks = (t[list] ?? []).filter((c) => c.revealed).map((c) => ({ ...c, target: c.id }));
    title = `${t.name}${list === "discovery" ? ": Discover" : ""}`;
  } else {
    const where = locate(t, target);
    if (!where) return;
    checks = (where.type === "main" ? where.checks.filter((c) => c.revealed) : where.checks).map((c) => ({ ...c, target }));
    title = rollTitle(t, target);
    if (where.type !== "main" && where.obj.text && where.obj.revealed && t.kind !== "chase" && t.kind !== "infiltration") text = `<p>${para(where.obj.text)}</p>`;
  }
  if (!checks.length) return ui.notifications.warn(list || target === "main" ? "Reveal at least one check first. Only revealed checks are posted." : "There are no checks to post here.");
  const buttons = checks.map((c) => `<button type="button" data-pct-roll="${esc(c.id)}"><strong>${esc(skillLabel(c.skill))}</strong>${c.label ? ` <span>${esc(c.label)}</span>` : ""}</button>`).join("");
  await ChatMessage.create({
    content: `<div class="pct-chat pct-request"><header><i class="${KIND_INFO[t.kind].icon}"></i> <strong>${esc(title)}</strong></header>${text}<div class="pct-req">${buttons}</div><p class="pct-hint">Select your token and click a check to roll it.</p></div>`,
    speaker: { alias: KIND_INFO[t.kind].label },
    flags: { [SCOPE]: { request: { tid: t.id, title, checks: checks.map((c) => ({ id: c.id, skill: c.skill, dc: c.dc, label: c.label, target: c.target })) } } },
  });
}

/** Buttons on check cards, and the GM's Apply box on tagged roll cards. */
function onRenderMessage(message, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  const req = message.getFlag?.(SCOPE, "request");
  if (req) {
    for (const b of root.querySelectorAll("[data-pct-roll]")) {
      b.addEventListener("click", (ev) => {
        ev.preventDefault();
        const check = req.checks.find((c) => c.id === b.dataset.pctRoll);
        if (check) rollCheck({ tid: req.tid, target: check.target ?? req.target, check, title: req.title });
      });
    }
  }
  if (!game.user.isGM) return;
  const ctx = message.flags?.pf2e?.context;
  const tag = parseTag(ctx?.options);
  if (!tag) return;
  const t = Store.get(tag.tid);
  if (!t) return;
  const box = document.createElement("div");
  box.className = "pct-apply";
  const applied = message.getFlag(SCOPE, "applied");
  const actor = ctx.actor ? game.actors.get(ctx.actor) : null;
  const args = { target: tag.target, outcome: ctx.outcome, actorId: actor?.id ?? null, actorName: "" };
  if (applied) {
    box.innerHTML = `<i class="fa-solid fa-check"></i> ${esc(applied.text)}`;
  } else if (!ctx.outcome) {
    box.innerHTML = `<i class="fa-solid fa-circle-info"></i> No DC on this roll, so there is no result to apply to ${esc(t.name)}.`;
  } else {
    const preview = applyRoll(clone(t), args);
    if (!preview) return;
    box.innerHTML = `<button type="button"><i class="${KIND_INFO[t.kind].icon}"></i> Apply to ${esc(t.name)}</button><div class="pct-preview">${esc(preview)}</div>`;
    box.querySelector("button").addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.currentTarget.disabled = true;
      const text = await mutateTracker(t.id, (tr) => applyRoll(tr, args));
      if (text) await message.setFlag(SCOPE, "applied", { text });
    });
  }
  const content = root.querySelector(".message-content") ?? root;
  content.append(box);
}

/* ------------------------------------------------------------------ */
/* Calendar                                                            */
/* ------------------------------------------------------------------ */

function months() {
  const vals = game.time?.calendar?.months?.values ?? [];
  return vals.map((m) => ({ name: m.name, short: String(m.abbreviation || m.name).split(",")[0].trim(), days: m.days }));
}

/** Today's date as { y, m, d }, with the year as the calendar shows it and months and days from 1. */
function today() {
  const c = game.time.components ?? {};
  const y0 = num(game.time.calendar?.years?.yearZero, 0);
  return { y: num(c.year) + y0, m: num(c.month) + 1, d: num(c.dayOfMonth) + 1 };
}

const dkey = (x) => (x && Number.isFinite(x.y) ? x.y * 100000 + x.m * 100 + x.d : null);

function fmtDate(x, { year = false } = {}) {
  if (!x) return "";
  const mo = months()[x.m - 1];
  const showYear = year || x.y !== today().y;
  return `${x.d} ${mo?.short ?? `Month ${x.m}`}${showYear ? ` ${x.y}` : ""}`;
}

function monthIndex(name) {
  const n = String(name).trim().toLowerCase();
  if (!n) return -1;
  const list = months();
  let i = list.findIndex((m) => m.short.toLowerCase() === n || m.name.toLowerCase() === n);
  if (i < 0 && n.length >= 3) i = list.findIndex((m) => m.short.toLowerCase().startsWith(n) || m.name.toLowerCase().startsWith(n));
  if (i < 0 && /^\d+$/.test(n)) i = Number(n) - 1;
  return i;
}

/** "15 Vind", "15 Vind 1534", "Vind 15" or "1534-12-15". Returns null for blank and undefined if unreadable. */
function parseDate(str, defYear = today().y) {
  const s = String(str ?? "").trim().replace(/\s+/g, " ");
  if (!s) return null;
  let y, mi, d;
  let m = s.match(/^(-?\d{1,5})-(\d{1,2})-(\d{1,2})$/);
  if (m) [y, mi, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  else if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([^\d,]+?)(?:,?\s+(-?\d{1,5}))?(?:\s+[a-z.]+)?$/i))) [d, mi, y] = [Number(m[1]), monthIndex(m[2]), m[3] ? Number(m[3]) : defYear];
  else if ((m = s.match(/^([^\d,]+?)\s+(\d{1,2})(?:,?\s+(-?\d{1,5}))?$/i))) [mi, d, y] = [monthIndex(m[1]), Number(m[2]), m[3] ? Number(m[3]) : defYear];
  else return undefined;
  const list = months();
  if (mi < 0 || (list.length && mi >= list.length)) return undefined;
  const days = list[mi]?.days;
  if (d < 1 || (days && d > days)) return undefined;
  return { y, m: mi + 1, d };
}

/** Find reminders due by `now` and mark them, in place. Returns the lines to whisper. */
function collectReminders(d, now) {
  const lines = [];
  const when = (k, date) => (k === now ? "today" : `on ${fmtDate(date)}`);
  for (const t of d.trackers) {
    const name = `<strong>${esc(t.name)}</strong>`;
    if (t.kind === "clock") {
      const segs = t.segments ?? [];
      let ticks = 0;
      const firstEmpty = segs.findIndex((s) => s.state === "empty");
      segs.forEach((s, i) => {
        const k = dkey(s.date);
        if (k === null) return;
        if (k > now) {
          s.reminded = null;
          return;
        }
        if (s.reminded === k) return;
        s.reminded = k;
        if (t.ordered) {
          const idx = firstEmpty < 0 ? -1 : firstEmpty + ticks;
          ticks++;
          if (idx < 0 || idx >= segs.length) lines.push(`${name} would fill a segment ${when(k, s.date)}, but it's already full.`);
          else lines.push(`${name} fills a segment ${when(k, s.date)}: segment ${idx + 1} of ${segs.length}${segs[idx].label ? `, ${esc(segs[idx].label.replace(/[.!?]+$/, ""))}` : ""}.`);
        } else if (s.state === "empty") {
          lines.push(`${name}: segment ${i + 1}${s.label ? `, ${esc(s.label.replace(/[.!?]+$/, ""))},` : ""} is due ${when(k, s.date)}.`);
        }
      });
    }
    if (t.kind === "checklist") {
      for (const e of t.entries ?? []) {
        const k = dkey(e.closes);
        if (k === null) continue;
        if (k > now) {
          e.reminded = null;
          continue;
        }
        if (e.reminded === k) continue;
        e.reminded = k;
        if (e.done) continue;
        lines.push(`${name}: ${esc(e.label)} ${k === now ? "closes today" : `closed on ${fmtDate(e.closes)}`}.`);
      }
    }
  }
  return lines;
}

let reminderTimer = null;
function scheduleReminders() {
  clearTimeout(reminderTimer);
  reminderTimer = setTimeout(checkReminders, 1000);
}

async function checkReminders() {
  if (!isPrimaryGM() || !storeReady || Store.broken || !game.settings.get(MOD, "reminders")) return;
  const now = dkey(today());
  const draft = clone(Store.data);
  const lines = collectReminders(draft, now);
  if (JSON.stringify(draft) === JSON.stringify(Store.data)) return;
  await mutate((d) => collectReminders(d, now), { notify: false });
  if (lines.length) whisperGM(lines, "fa-solid fa-bell", `Campaign Trackers, ${fmtDate(today(), { year: true })}`);
}

/* ------------------------------------------------------------------ */
/* HTML helpers                                                        */
/* ------------------------------------------------------------------ */

const dataAttrs = (data) => Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(" ");
/** An action link. `label` is plain text. */
const A = (action, icon, { tip = "", label = "", cls = "", data = {} } = {}) =>
  `<a class="pct-btn ${cls}" data-action="${action}" ${dataAttrs(data)} ${tip ? `data-tooltip="${esc(tip)}"` : ""}>${icon ? `<i class="${icon}"></i>` : ""}${label ? `<span>${esc(label)}</span>` : ""}</a>`;

const F = {
  text: (path, v, ph = "", cls = "") => `<input type="text" data-path="${path}" value="${esc(v)}" placeholder="${esc(ph)}" class="${cls}">`,
  num: (path, v, ph = "", cls = "") => `<input type="number" data-path="${path}" data-type="number" value="${v === null || v === undefined ? "" : esc(v)}" placeholder="${esc(ph)}" class="pct-num ${cls}">`,
  area: (path, v, ph = "", rows = 2) => `<textarea data-path="${path}" rows="${rows}" placeholder="${esc(ph)}">${esc(v)}</textarea>`,
  bool: (path, v, label, tip = "") => `<label class="pct-chk" ${tip ? `data-tooltip="${esc(tip)}"` : ""}><input type="checkbox" data-path="${path}" data-type="bool" ${v ? "checked" : ""}> <span>${esc(label)}</span></label>`,
  select: (path, v, opts) => `<select data-path="${path}">${opts.map(([val, lab]) => `<option value="${esc(val)}" ${String(val) === String(v) ? "selected" : ""}>${esc(lab)}</option>`).join("")}</select>`,
  date: (path, v) => `<input type="text" data-path="${path}" data-type="date" value="${esc(v ? fmtDate(v, { year: true }) : "")}" placeholder="15 Vind" class="pct-date">`,
};
const L = (label, inner, cls = "") => `<label class="pct-field ${cls}"><span>${esc(label)}</span>${inner}</label>`;

const eye = (path, on) => A("pctToggle", on ? "fa-solid fa-eye" : "fa-solid fa-eye-slash", { tip: on ? "Shown to players. Click to hide." : "Hidden from players. Click to show.", data: { path: `${path}.revealed` }, cls: `pct-eye ${on ? "pct-on" : ""}` });

function stepper(path, value, { steps = [1], label = "", tip = "", fmt = (v) => v } = {}) {
  const minus = [...steps].reverse().map((s) => A("pctStep", "", { label: `-${s}`, data: { path, delta: -s }, cls: "pct-step" })).join("");
  const plus = steps.map((s) => A("pctStep", "", { label: `+${s}`, data: { path, delta: s }, cls: "pct-step" })).join("");
  return `<span class="pct-stepper" ${tip ? `data-tooltip="${esc(tip)}"` : ""}>${label ? `<span class="pct-step-label">${esc(label)}</span>` : ""}${minus}<span class="pct-value">${esc(fmt(value))}</span>${plus}</span>`;
}

function listEditor(path, rows, rowFn, addLabel) {
  const body = rows.map((r, i) => {
    const p = `${path}.${i}`;
    const tools = `${A("pctMove", "fa-solid fa-arrow-up", { data: { path: p, dir: -1 }, tip: "Move up" })}${A("pctMove", "fa-solid fa-arrow-down", { data: { path: p, dir: 1 }, tip: "Move down" })}${A("pctRemove", "fa-solid fa-xmark", { data: { path: p }, tip: "Remove" })}`;
    return `<div class="pct-row"><div class="pct-row-main">${rowFn(r, p, i)}</div><span class="pct-row-tools">${tools}</span></div>`;
  }).join("");
  return `<div class="pct-list">${body}</div>${A("pctAdd", "fa-solid fa-plus", { label: addLabel, data: { list: path }, cls: "pct-add" })}`;
}

const SKILLS = ["perception", "acrobatics", "arcana", "athletics", "crafting", "deception", "diplomacy", "intimidation", "medicine", "nature", "occultism", "performance", "religion", "society", "stealth", "survival", "thievery", "fortitude", "reflex", "will"];
const skillList = () => `<datalist id="pct-skills">${SKILLS.map((s) => `<option value="${s}">${esc(skillLabel(s))}</option>`).join("")}</datalist>`;

function checkEdit(c, p, { research = false } = {}) {
  return `${L("Skill", `<input type="text" list="pct-skills" data-path="${p}.skill" value="${esc(c.skill)}" placeholder="athletics, sailing-lore" class="pct-skill">`)}
    ${L("DC", F.num(`${p}.dc`, c.dc, "", "pct-dc"))}
    ${research ? L("Max RP", F.num(`${p}.maxRP`, c.maxRP, "none", "pct-dc")) : ""}
    ${L("For", F.text(`${p}.label`, c.label, research ? "where, or what" : "what the check does"), "pct-grow")}`;
}

function thresholdEdit(th, p, what = "At") {
  return `${L(what, F.num(`${p}.at`, th.at, "", "pct-dc"))}${L("What happens", F.text(`${p}.text`, th.text), "pct-grow")}`;
}

function degreesEdit(t) {
  return `<div class="pct-degrees"><span class="pct-sub">Points for each result</span>${DEGREES.map((d) => L(DEGREE_LABEL[d], F.num(`degrees.${d}`, t.degrees?.[d], "", "pct-dc"))).join("")}</div>`;
}

/** A check as a roll button. The GM sees the DC. */
function checkButton(t, target, c, { gm }) {
  const dc = gm && c.dc !== null && c.dc !== undefined && c.dc !== "" ? ` <em>DC ${esc(c.dc)}</em>` : "";
  const rp = c.maxRP !== null && c.maxRP !== undefined && c.maxRP !== "" ? ` <span class="pct-chip" data-tooltip="Research points earned here, of the most it can give">${num(c.earned)} / ${c.maxRP}</span>` : "";
  return `<button type="button" class="pct-roll" data-action="pctRoll" data-target="${esc(target)}" data-check="${esc(c.id)}" data-tooltip="${gm ? "Roll for the selected tokens" : "Roll for your character"}"><i class="fa-solid fa-dice-d20"></i> <strong>${esc(skillLabel(c.skill))}</strong>${dc}</button>${c.label ? `<span class="pct-for">${esc(c.label)}</span>` : ""}${rp}`;
}

function checkRows(t, target, checks, { gm, perCheckTarget = false, revealEach = false, path = "" }) {
  if (!checks.length) return "";
  return `<div class="pct-checks">${checks.map((c, i) => `<div class="pct-check">${gm && revealEach ? eye(`${path}.${i}`, c.revealed) : ""}${checkButton(t, perCheckTarget ? c.id : target, c, { gm })}</div>`).join("")}</div>`;
}

const cardBtn = (target, tip = "Post these checks to chat for the players to roll") => A("pctCard", "fa-solid fa-share-from-square", { tip, data: { target }, cls: "pct-card-post" });

function thresholdRows(list, value, { gm, path = "", unit = "" }) {
  if (!list.length) return "";
  const rows = (gm ? reached(list.map((x, i) => ({ ...x, _i: list.indexOf(x) })), value) : list).map((th) => {
    const r = th.reached;
    return `<li class="${r ? "pct-reached" : ""}">${gm ? eye(`${path}.${th._i}`, th.revealed) : ""}<i class="fa-${r ? "solid fa-circle-check" : "regular fa-circle"}"></i> ${th.at !== null && th.at !== undefined ? `<strong>${esc(th.at)}${unit}</strong> ` : ""}${para(th.text)}</li>`;
  }).join("");
  return `<ul class="pct-thresholds">${rows}</ul>`;
}

/** A clock face as an SVG pie. */
function clockSVG(segs, size = 72) {
  const n = Math.max(1, segs.length);
  const c = size / 2, r = size / 2 - 3;
  const pt = (a) => [c + r * Math.cos(a), c + r * Math.sin(a)];
  const paths = segs.map((s, i) => {
    const a0 = -Math.PI / 2 + (i / n) * 2 * Math.PI;
    const a1 = -Math.PI / 2 + ((i + 1) / n) * 2 * Math.PI;
    const [x0, y0] = pt(a0), [x1, y1] = pt(a1);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const d = n === 1 ? `M ${c} ${c - r} A ${r} ${r} 0 1 1 ${c - 0.01} ${c - r} Z` : `M ${c} ${c} L ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`;
    return `<path d="${d}" class="pct-seg-${s.state || "empty"}"/>`;
  }).join("");
  return `<svg class="pct-clock" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${paths}</svg>`;
}

function partyMembers() {
  const members = game.actors.party?.members?.filter((a) => a.type === "character") ?? [];
  return members.length ? members : game.actors.filter((a) => a.type === "character" && a.hasPlayerOwner);
}
const pcName = (a) => a?.prototypeToken?.name?.trim() || a?.name || "?";

function dateStatus(date, done = false) {
  const k = dkey(date);
  if (k === null) return "";
  const now = dkey(today());
  const cls = done ? "" : k < now ? "pct-closed" : k === now ? "pct-today" : "";
  const word = k < now ? "Closed" : k === now ? "Closes today" : "Closes";
  return `<span class="pct-date-chip ${cls}">${word} ${esc(fmtDate(date))}</span>`;
}

/* ------------------------------------------------------------------ */
/* GM view of each kind                                                */
/* ------------------------------------------------------------------ */

const GM = {
  reputation(t) {
    const tier = currentTier(t);
    const ladder = tierLadder(t).reverse();
    return `<div class="pct-rep">
        ${stepper("value", num(t.value), { steps: (t.steps?.length ? t.steps : [1]).map(Number), fmt: signed })}
        <div class="pct-tier-now">${tier ? `<strong>${esc(tier.label)}</strong>${tier.text ? `<p>${para(tier.text)}</p>` : ""}${tier.gm ? `<p class="pct-gm">${para(tier.gm)}</p>` : ""}` : "<em>No tiers set.</em>"}</div>
      </div>
      <ol class="pct-ladder">${ladder.map((x) => `<li class="${x.id === tier?.id ? "pct-current" : ""}"><strong>${esc(x.label)}</strong> <span class="pct-range">${esc(x.range)}</span></li>`).join("")}</ol>`;
  },

  pressure(t) {
    const tier = currentTier(t);
    const ladder = tierLadder(t);
    const max = nullNum(t.max);
    const meter = max ? `<div class="pct-meter">${ladder.map((x, i) => {
      // Slots 1..max; a band covers the slots from its start to the next band's.
      const lo = Math.max(1, i === 0 ? nullNum(t.min) ?? 0 : num(x.min));
      const hi = Math.min(ladder[i + 1] ? num(ladder[i + 1].min) : max + 1, max + 1);
      const span = Math.max(0, hi - lo);
      const fill = clamp(num(t.value) - lo + 1, 0, span);
      return `<div class="pct-band ${x.id === tier?.id ? "pct-current" : ""}" style="flex:${span}" data-tooltip="${esc(`${x.label}: ${x.range}`)}"><div style="width:${span ? (fill / span) * 100 : 0}%"></div></div>`;
    }).join("")}</div>` : "";
    return `<div class="pct-line">${stepper("value", num(t.value), { steps: (t.steps?.length ? t.steps : [1]).map(Number), fmt: (v) => (max !== null ? `${v} / ${max}` : v) })}
        ${t.halve ? A("pctHalve", "fa-solid fa-divide", { label: "Halve", tip: "Halve the value, rounded down" }) : ""}</div>
      ${meter}
      <div class="pct-tier-now">${tier ? `<strong>${esc(tier.label)}</strong> <span class="pct-range">${esc(tier.range)}</span>${tier.text ? `<p>${para(tier.text)}</p>` : ""}${tier.gm ? `<p class="pct-gm">${para(tier.gm)}</p>` : ""}` : "<em>No bands set.</em>"}</div>
      <ol class="pct-ladder">${[...ladder].reverse().map((x) => `<li class="${x.id === tier?.id ? "pct-current" : ""}"><strong>${esc(x.label)}</strong> <span class="pct-range">${esc(x.range)}</span></li>`).join("")}</ol>
      ${thresholdRows(t.thresholds, t.value, { gm: true, path: "thresholds" })}`;
  },

  points(t) {
    const max = nullNum(t.max);
    const bar = max ? `<div class="pct-bar"><div style="width:${clamp((num(t.value) / max) * 100, 0, 100)}%"></div></div>` : "";
    return `<div class="pct-line">${stepper("value", num(t.value), { fmt: (v) => (max !== null ? `${v} / ${max}` : v) })}
        ${t.halve ? A("pctHalve", "fa-solid fa-divide", { label: "Halve", tip: "Halve the value, rounded down" }) : ""}
        ${t.checks.length ? cardBtn("main") : ""}</div>
      ${bar}
      ${thresholdRows(t.thresholds, t.value, { gm: true, path: "thresholds" })}
      ${checkRows(t, "main", t.checks, { gm: true, revealEach: true, path: "checks" })}`;
  },

  influence(t) {
    const npc = t.npc
      ? `<div class="pct-npc" data-drop="npc"><img src="${esc(t.npc.img)}" alt=""><strong>${esc(t.npc.name)}</strong>${A("pctClearNpc", "fa-solid fa-xmark", { tip: "Unlink" })}</div>`
      : `<div class="pct-npc pct-drop" data-drop="npc"><i class="fa-solid fa-user-plus"></i> Drop an NPC here</div>`;
    const notes = (list, path, title) => (list.length ? `<div class="pct-sub">${title}</div><ul class="pct-notes">${list.map((x, i) => `<li>${eye(`${path}.${i}`, x.revealed)} ${para(x.text)}</li>`).join("")}</ul>` : "");
    return `<div class="pct-line">${npc}
        ${stepper("value", num(t.value), { label: "Influence" })}
        ${stepper("roundsUsed", num(t.roundsUsed), { label: "Round", fmt: (v) => `${v} of ${num(t.rounds)}` })}
        ${A("pctEndRound", "fa-solid fa-forward", { label: "End round" })}</div>
      ${thresholdRows(t.thresholds, t.value, { gm: true, path: "thresholds" })}
      ${t.skills.length ? `<div class="pct-sub">Influence ${A("pctCardList", "fa-solid fa-share-from-square", { tip: "Post the revealed influence skills to chat", data: { list: "skills" }, cls: "pct-card-post" })}</div>${checkRows(t, "", t.skills, { gm: true, perCheckTarget: true, revealEach: true, path: "skills" })}` : ""}
      ${t.discovery.length ? `<div class="pct-sub">Discover ${A("pctCardList", "fa-solid fa-share-from-square", { tip: "Post the revealed Discover checks to chat", data: { list: "discovery" }, cls: "pct-card-post" })}</div>${checkRows(t, "", t.discovery, { gm: true, perCheckTarget: true, revealEach: true, path: "discovery" })}` : ""}
      ${notes(t.resistances, "resistances", "Resistances")}
      ${notes(t.weaknesses, "weaknesses", "Weaknesses")}
      ${t.penalty ? `<div class="pct-sub">Penalty</div><p class="pct-gm">${para(t.penalty)}</p>` : ""}`;
  },

  research(t) {
    return `<div class="pct-line">${stepper("value", num(t.value), { label: "Research points" })}
        ${stepper("round", num(t.round), { label: "Rounds" })}
        ${A("pctCardList", "fa-solid fa-share-from-square", { tip: "Post the revealed research checks to chat", data: { list: "checks" }, cls: "pct-card-post" })}</div>
      ${thresholdRows(t.thresholds, t.value, { gm: true, path: "thresholds" })}
      ${checkRows(t, "", t.checks, { gm: true, perCheckTarget: true, revealEach: true, path: "checks" })}`;
  },

  chase(t) {
    const n = t.obstacles.length;
    const cur = num(t.current);
    const q = t.quarry?.enabled ? num(t.quarry.at) : null;
    const qLabel = t.quarry?.label || "Quarry";
    const qText = q === null ? "" : q < 1 ? "not started" : q > n ? "got away" : `at obstacle ${q}`;
    const track = `<ol class="pct-track">${t.obstacles.map((o, i) => `<li class="${i < cur ? "pct-done" : i === cur ? "pct-current" : ""}">
        <span class="pct-track-n">${i + 1}</span><span class="pct-track-name">${esc(o.name || `Obstacle ${i + 1}`)}</span>
        <span class="pct-track-pts">${num(o.progress)}/${num(o.points)}</span>
        <span class="pct-marks">${i === cur ? `<i class="fa-solid fa-users" data-tooltip="The party"></i>` : ""}${q === i + 1 ? `<i class="fa-solid fa-person-running pct-quarry" data-tooltip="${esc(qLabel)}"></i>` : ""}</span></li>`).join("")}</ol>`;
    const rows = t.obstacles.map((o, i) => `<div class="pct-obstacle ${i === cur ? "pct-current" : i < cur ? "pct-done" : ""}">
        <div class="pct-line">${eye(`obstacles.${i}`, o.revealed)}<strong>${i + 1}. ${esc(o.name || `Obstacle ${i + 1}`)}</strong>
          ${stepper(`obstacles.${i}.progress`, num(o.progress), { fmt: (v) => `${v} of ${num(o.points)}` })}
          ${o.checks.length ? cardBtn(o.id) : ""}</div>
        ${o.text ? `<p class="pct-gm">${para(o.text)}</p>` : ""}
        ${checkRows(t, o.id, o.checks, { gm: true })}
      </div>`).join("");
    return `<div class="pct-line">
        ${stepper("round", num(t.round), { label: "Round" })}
        ${stepper("current", cur, { label: "Party at", fmt: (v) => (v >= n ? "the end" : `obstacle ${v + 1}`) })}
        ${q !== null ? stepper("quarry.at", q, { label: qLabel, fmt: () => qText }) : ""}
      </div>${track}${rows}`;
  },

  infiltration(t) {
    const pcs = partyMembers();
    const ip = infiltrationIP(t);
    const obstacles = t.obstacles.map((o, i) => {
      const prog = o.type === "individual"
        ? `<div class="pct-indiv">${pcs.map((pc) => `<span class="pct-pc">${esc(pcName(pc))} ${stepper(`obstacles.${i}.byActor.${pc.id}`, num(o.byActor?.[pc.id]), { fmt: (v) => `${v}/${num(o.points)}` })}</span>`).join("")}</div>`
        : stepper(`obstacles.${i}.progress`, num(o.progress), { fmt: (v) => `${v} of ${num(o.points)}` });
      return `<div class="pct-obstacle"><div class="pct-line">${eye(`obstacles.${i}`, o.revealed)}<strong>${esc(o.name || "Obstacle")}</strong><span class="pct-chip">${o.type === "individual" ? "Each PC" : "Group"}</span>${o.type === "individual" ? "" : prog}${o.checks.length ? cardBtn(o.id) : ""}</div>
        ${o.type === "individual" ? prog : ""}${o.text ? `<p class="pct-gm">${para(o.text)}</p>` : ""}${checkRows(t, o.id, o.checks, { gm: true })}</div>`;
    }).join("");
    const extras = (list, path, title) => (list.length ? `<div class="pct-sub">${title}</div>${list.map((o, i) => `<div class="pct-obstacle ${o.done ? "pct-done" : ""}"><div class="pct-line">${eye(`${path}.${i}`, o.revealed)}${F.bool(`${path}.${i}.done`, o.done, "")}<strong>${esc(o.name || "Untitled")}</strong>${o.trigger ? `<span class="pct-chip">${esc(o.trigger)}</span>` : ""}${o.checks.length ? cardBtn(o.id) : ""}</div>${o.text ? `<p class="pct-gm">${para(o.text)}</p>` : ""}${checkRows(t, o.id, o.checks, { gm: true })}</div>`).join("")}` : "");
    return `<div class="pct-line">
        ${stepper("awareness", num(t.awareness), { label: "Awareness" })}
        ${stepper("edge", num(t.edge), { label: "Edge" })}
        ${stepper("round", num(t.round), { label: "Round" })}
        ${A("pctEndRound", "fa-solid fa-forward", { label: "End round", tip: "Next round, and +1 awareness" })}
        <span class="pct-chip" data-tooltip="Infiltration points earned">${ip}${num(t.objective) ? ` of ${num(t.objective)}` : ""} infiltration</span>
      </div>
      ${thresholdRows(t.awarenessThresholds, t.awareness, { gm: true, path: "awarenessThresholds", unit: " AP" })}
      ${obstacles ? `<div class="pct-sub">Obstacles</div>${obstacles}` : ""}
      ${extras(t.complications, "complications", "Complications")}
      ${extras(t.opportunities, "opportunities", "Opportunities")}`;
  },

  clock(t) {
    const rows = t.segments.map((s, i) => `<li class="pct-seg pct-seg-${s.state}">
        ${A("pctSeg", s.state === "filled" ? "fa-solid fa-circle" : s.state === "broken" ? "fa-solid fa-ban" : "fa-regular fa-circle", { tip: "Click to fill or empty. Right-click to mark it broken by the party.", data: { path: `segments.${i}` } })}
        <span class="pct-seg-n">${i + 1}</span><span class="pct-seg-label">${esc(s.label || "")}${s.text ? `<span class="pct-gm">${para(s.text)}</span>` : ""}</span>
        ${s.date ? `<span class="pct-date-chip ${dkey(s.date) <= dkey(today()) && s.state === "empty" ? "pct-today" : ""}">${esc(fmtDate(s.date))}</span>` : ""}</li>`).join("");
    return `<div class="pct-clockwrap">${clockSVG(t.segments, 84)}<ol class="pct-segs">${rows}</ol></div>
      ${t.ordered ? `<p class="pct-hint">Segments fill in order. A date is a day the clock fills its next segment.</p>` : ""}`;
  },

  checklist(t) {
    const groups = [];
    t.entries.forEach((e, i) => {
      const g = e.group || "";
      let grp = groups.find((x) => x.name === g);
      if (!grp) groups.push((grp = { name: g, rows: [] }));
      grp.rows.push({ e, i });
    });
    return groups.map((g) => `${g.name ? `<div class="pct-sub">${esc(g.name)}</div>` : ""}<ul class="pct-entries">${g.rows.map(({ e, i }) => `<li class="${e.done ? "pct-done" : ""}">
        ${eye(`entries.${i}`, e.revealed)}${F.bool(`entries.${i}.done`, e.done, "")}
        <div class="pct-entry"><div><strong>${esc(e.label || "Untitled")}</strong>${e.tag ? ` <span class="pct-chip">${esc(e.tag)}</span>` : ""} ${dateStatus(e.closes, e.done)}</div>
          ${e.detail ? `<div class="pct-gm"><span class="pct-k">Earned by</span> ${para(e.detail)}</div>` : ""}
          ${e.effect ? `<div class="pct-gm"><span class="pct-k">Pays off</span> ${para(e.effect)}</div>` : ""}</div></li>`).join("")}</ul>`).join("") || `<p class="pct-hint">No entries yet. Add them under Edit.</p>`;
  },
};

/* ------------------------------------------------------------------ */
/* Editing each kind                                                   */
/* ------------------------------------------------------------------ */

const EDIT = {
  reputation: (t) => `<div class="pct-line">${L("Lowest", F.num("min", t.min, "none"))}${L("Highest", F.num("max", t.max, "none"))}
      ${L("Buttons", `<input type="text" data-path="steps" data-type="steps" value="${esc((t.steps ?? []).join(", "))}" placeholder="1, 2, 5" class="pct-dc">`)}
      ${F.bool("showValue", t.showValue, "Players see the number", "Off: players see only the tier")}</div>
    <div class="pct-sub">Tiers, from lowest to highest. A tier starts at its value and runs to the next one.</div>
    ${listEditor("tiers", t.tiers, (x, p, i) => `${L("Tier", F.text(`${p}.label`, x.label), "pct-w8")}${L(i === 0 ? "From (lowest)" : "From", F.num(`${p}.min`, x.min, "", "pct-dc"))}${L("Players see", F.text(`${p}.text`, x.text), "pct-grow")}${L("GM only", F.text(`${p}.gm`, x.gm), "pct-grow")}`, "Tier")}`,

  pressure: (t) => `<div class="pct-line">${L("Lowest", F.num("min", t.min, "none"))}${L("Highest", F.num("max", t.max, "none"))}
      ${L("Buttons", `<input type="text" data-path="steps" data-type="steps" value="${esc((t.steps ?? []).join(", "))}" placeholder="1, 2" class="pct-dc">`)}
      ${F.bool("showValue", t.showValue, "Players see the number", "Off: players see only the band, if you reveal it")}${F.bool("halve", t.halve, "Halve button")}</div>
    <div class="pct-sub">Bands, from lowest to highest. A band starts at its value and runs to the next one.</div>
    ${listEditor("tiers", t.tiers, (x, p, i) => `${L("Band", F.text(`${p}.label`, x.label), "pct-w8")}${L(i === 0 ? "From (lowest)" : "From", F.num(`${p}.min`, x.min, "", "pct-dc"))}${L("Players see", F.text(`${p}.text`, x.text), "pct-grow")}${L("GM only", F.text(`${p}.gm`, x.gm), "pct-grow")}`, "Band")}
    <div class="pct-sub">Events at a value, besides the bands</div>${listEditor("thresholds", t.thresholds, (x, p) => thresholdEdit(x, p), "Event")}`,

  points: (t) => `<div class="pct-line">${L("Lowest", F.num("min", t.min, "none"))}${L("Highest", F.num("max", t.max, "none"))}
      ${F.bool("showValue", t.showValue, "Players see the number")}${F.bool("halve", t.halve, "Halve button")}</div>
    ${degreesEdit(t)}
    <div class="pct-sub">Thresholds</div>${listEditor("thresholds", t.thresholds, (x, p) => thresholdEdit(x, p), "Threshold")}
    <div class="pct-sub">Checks that earn points</div>${listEditor("checks", t.checks, (x, p) => checkEdit(x, p), "Check")}`,

  influence: (t) => `<div class="pct-line">${L("Rounds", F.num("rounds", t.rounds))}</div>
    ${degreesEdit(t)}
    <div class="pct-sub">Influence thresholds</div>${listEditor("thresholds", t.thresholds, (x, p) => thresholdEdit(x, p), "Threshold")}
    <div class="pct-sub">Influence skills</div>${listEditor("skills", t.skills, (x, p) => checkEdit(x, p), "Skill")}
    <div class="pct-sub">Discover</div>${listEditor("discovery", t.discovery, (x, p) => checkEdit(x, p), "Discover check")}
    <div class="pct-sub">Resistances</div>${listEditor("resistances", t.resistances, (x, p) => L("", F.text(`${p}.text`, x.text, "Raises the DC by 2 when..."), "pct-grow"), "Resistance")}
    <div class="pct-sub">Weaknesses</div>${listEditor("weaknesses", t.weaknesses, (x, p) => L("", F.text(`${p}.text`, x.text, "Lowers the DC by 2 when..."), "pct-grow"), "Weakness")}
    ${L("Penalty (GM only)", F.area("penalty", t.penalty, "What happens if the party antagonizes them"), "pct-block")}`,

  research: (t) => `${degreesEdit(t)}
    <div class="pct-sub">Research thresholds</div>${listEditor("thresholds", t.thresholds, (x, p) => thresholdEdit(x, p), "Threshold")}
    <div class="pct-sub">Research checks</div>${listEditor("checks", t.checks, (x, p) => checkEdit(x, p, { research: true }), "Check")}`,

  chase: (t) => `<div class="pct-line">${F.bool("quarry.enabled", t.quarry?.enabled, "Track the other side")}${t.quarry?.enabled ? L("Called", F.text("quarry.label", t.quarry.label, "Quarry")) : ""}</div>
    ${degreesEdit(t)}
    <div class="pct-sub">Obstacles</div>
    ${listEditor("obstacles", t.obstacles, (o, p) => `<div class="pct-line">${L("Obstacle", F.text(`${p}.name`, o.name), "pct-grow")}${L("Points", F.num(`${p}.points`, o.points, "", "pct-dc"))}</div>
      ${L("Notes (GM only)", F.area(`${p}.text`, o.text, "", 2), "pct-block")}
      <div class="pct-nested">${listEditor(`${p}.checks`, o.checks, (c, cp) => checkEdit(c, cp), "Check")}</div>`, "Obstacle")}`,

  infiltration: (t) => `<div class="pct-line">${L("Objective", F.num("objective", t.objective, "IP"))}${F.bool("showAwareness", t.showAwareness, "Players see awareness")}</div>
    <div class="pct-sub">Awareness thresholds</div>${listEditor("awarenessThresholds", t.awarenessThresholds, (x, p) => thresholdEdit(x, p, "AP"), "Threshold")}
    <div class="pct-sub">Obstacles</div>
    ${listEditor("obstacles", t.obstacles, (o, p) => `<div class="pct-line">${L("Obstacle", F.text(`${p}.name`, o.name), "pct-grow")}${L("Points", F.num(`${p}.points`, o.points, "", "pct-dc"))}${L("Type", F.select(`${p}.type`, o.type, [["group", "Group"], ["individual", "Each PC"]]))}</div>
      ${L("Notes (GM only)", F.area(`${p}.text`, o.text, "", 2), "pct-block")}
      <div class="pct-nested">${listEditor(`${p}.checks`, o.checks, (c, cp) => checkEdit(c, cp), "Check")}</div>`, "Obstacle")}
    <div class="pct-sub">Complications</div>
    ${listEditor("complications", t.complications, (o, p) => `<div class="pct-line">${L("Complication", F.text(`${p}.name`, o.name), "pct-grow")}${L("Trigger", F.text(`${p}.trigger`, o.trigger, "5 AP"))}</div>
      ${L("Notes (GM only)", F.area(`${p}.text`, o.text, "", 2), "pct-block")}
      <div class="pct-nested">${listEditor(`${p}.checks`, o.checks, (c, cp) => checkEdit(c, cp), "Check")}</div>`, "Complication")}
    <div class="pct-sub">Opportunities</div>
    ${listEditor("opportunities", t.opportunities, (o, p) => `<div class="pct-line">${L("Opportunity", F.text(`${p}.name`, o.name), "pct-grow")}</div>
      ${L("Notes (GM only)", F.area(`${p}.text`, o.text, "", 2), "pct-block")}
      <div class="pct-nested">${listEditor(`${p}.checks`, o.checks, (c, cp) => checkEdit(c, cp), "Check")}</div>`, "Opportunity")}`,

  clock: (t) => `<div class="pct-line">${L("Segments", `<input type="number" data-path="segments" data-type="segcount" value="${t.segments.length}" min="1" max="24" class="pct-num pct-dc">`)}
      ${F.bool("ordered", t.ordered, "Fills in order", "On: each date fills the next empty segment. Off: each segment has its own date.")}
      ${F.bool("showLabels", t.showLabels, "Players see segment names")}</div>
    ${listEditor("segments", t.segments, (s, p) => `${L("Segment", F.text(`${p}.label`, s.label), "pct-grow")}${L("Date", F.date(`${p}.date`, s.date))}${L("Notes (GM only)", F.text(`${p}.text`, s.text), "pct-grow")}`, "Segment")}`,

  checklist: (t) => listEditor("entries", t.entries, (e, p) => `<div class="pct-line">${L("Group", F.text(`${p}.group`, e.group), "pct-w8")}${L("Entry", F.text(`${p}.label`, e.label), "pct-grow")}${L("Tag", F.text(`${p}.tag`, e.tag, "hidden"), "pct-w6")}${L("Closes", F.date(`${p}.closes`, e.closes))}</div>
      <div class="pct-line">${L("Earned by (GM only)", F.text(`${p}.detail`, e.detail), "pct-grow")}${L("Pays off (GM only)", F.text(`${p}.effect`, e.effect), "pct-grow")}</div>`, "Entry"),
};

function editView(t) {
  return `<div class="pct-edit">
      <div class="pct-line">${L("Name", F.text("name", t.name), "pct-grow")}</div>
      ${L("Players see", F.area("desc", t.desc, "A description shown to players when this is revealed"), "pct-block")}
      ${L("GM notes", F.area("notes", t.notes, "Only the GM sees these", 3), "pct-block")}
      ${EDIT[t.kind](t)}
    </div>`;
}

/* ------------------------------------------------------------------ */
/* Player view of each kind (works on the revealed copy)               */
/* ------------------------------------------------------------------ */

const PLAYER = {
  reputation(p) {
    return `<div class="pct-rep"><div class="pct-tier-now">${p.tiers.filter((x) => x.id === p.tier).map((x) => `<strong>${esc(x.label)}</strong>${p.value !== null ? ` <span class="pct-range">${signed(p.value)}</span>` : ""}${x.text ? `<p>${para(x.text)}</p>` : ""}`).join("")}</div></div>
      <ol class="pct-ladder">${[...p.tiers].reverse().map((x) => `<li class="${x.id === p.tier ? "pct-current" : ""}"><strong>${esc(x.label)}</strong> <span class="pct-range">${esc(x.range)}</span>${x.text ? ` <span class="pct-for">${esc(x.text)}</span>` : ""}</li>`).join("")}</ol>`;
  },
  pressure(p) {
    const tier = p.tiers.find((x) => x.id === p.tier);
    return `<div class="pct-tier-now">${tier ? `<strong>${esc(tier.label)}</strong>${p.value !== null ? ` <span class="pct-range">${p.value}${p.max !== null ? ` of ${p.max}` : ""}</span>` : ""}${tier.text ? `<p>${para(tier.text)}</p>` : ""}` : ""}</div>${thresholdRows(p.thresholds, p.value, { gm: false })}`;
  },
  points(p) {
    const val = p.value !== null ? `<div class="pct-big">${p.value}${p.max !== null ? ` / ${p.max}` : ""}</div>` : "";
    const bar = p.value !== null && p.max ? `<div class="pct-bar"><div style="width:${clamp((p.value / p.max) * 100, 0, 100)}%"></div></div>` : "";
    return `${val}${bar}${thresholdRows(p.thresholds, p.value, { gm: false })}${checkRows(p, "main", p.checks, { gm: false })}`;
  },
  influence(p) {
    const npc = p.npc ? `<div class="pct-npc"><img src="${esc(p.npc.img)}" alt=""><strong>${esc(p.npc.name)}</strong></div>` : "";
    const list = (xs, title) => (xs.length ? `<div class="pct-sub">${title}</div><ul class="pct-notes">${xs.map((x) => `<li>${para(x)}</li>`).join("")}</ul>` : "");
    return `<div class="pct-line">${npc}<span class="pct-chip">${p.value} influence</span><span class="pct-chip">Round ${p.roundsUsed} of ${p.rounds}</span></div>
      ${thresholdRows(p.thresholds, p.value, { gm: false })}
      ${p.skills.length ? `<div class="pct-sub">Influence</div>${checkRows(p, "", p.skills, { gm: false, perCheckTarget: true })}` : ""}
      ${p.discovery.length ? `<div class="pct-sub">Discover</div>${checkRows(p, "", p.discovery, { gm: false, perCheckTarget: true })}` : ""}
      ${list(p.resistances, "Resistances")}${list(p.weaknesses, "Weaknesses")}`;
  },
  research(p) {
    return `<div class="pct-big">${p.value} <span>research points</span></div>${thresholdRows(p.thresholds, p.value, { gm: false })}${checkRows(p, "", p.checks, { gm: false, perCheckTarget: true })}`;
  },
  chase(p) {
    const n = p.obstacles.length;
    const cur = p.current;
    const q = p.quarry ? p.quarry.at : null;
    const track = `<ol class="pct-track">${p.obstacles.map((o, i) => `<li class="${i < cur ? "pct-done" : i === cur ? "pct-current" : ""}"><span class="pct-track-n">${i + 1}</span><span class="pct-track-name">${o.hidden ? "?" : esc(o.name || `Obstacle ${i + 1}`)}</span>${o.hidden ? "" : `<span class="pct-track-pts">${o.progress}/${o.points}</span>`}<span class="pct-marks">${i === cur ? `<i class="fa-solid fa-users"></i>` : ""}${q === i + 1 ? `<i class="fa-solid fa-person-running pct-quarry" data-tooltip="${esc(p.quarry.label)}"></i>` : ""}</span></li>`).join("")}</ol>`;
    const o = p.obstacles[cur];
    const now = o && !o.hidden ? `<div class="pct-obstacle pct-current"><strong>${esc(o.name)}</strong> <span class="pct-chip">${o.progress} of ${o.points}</span>${checkRows(p, o.id, o.checks, { gm: false })}</div>` : "";
    const status = cur >= n ? "The party is through." : q !== null && q > n ? `The ${esc(p.quarry.label.toLowerCase())} got away.` : "";
    return `<div class="pct-line"><span class="pct-chip">Round ${p.round}</span>${status ? `<span>${status}</span>` : ""}</div>${track}${now}`;
  },
  infiltration(p) {
    const pcs = partyMembers();
    const obstacles = p.obstacles.map((o) => `<div class="pct-obstacle"><div class="pct-line"><strong>${esc(o.name)}</strong><span class="pct-chip">${o.type === "individual" ? "Each PC" : `${o.progress} of ${o.points}`}</span></div>
      ${o.type === "individual" ? `<div class="pct-indiv">${pcs.map((pc) => `<span class="pct-pc">${esc(pcName(pc))} ${num(o.byActor?.[pc.id])}/${o.points}</span>`).join("")}</div>` : ""}
      ${checkRows(p, o.id, o.checks, { gm: false })}</div>`).join("");
    const extras = (list, title) => (list.length ? `<div class="pct-sub">${title}</div>${list.map((o) => `<div class="pct-obstacle ${o.done ? "pct-done" : ""}"><strong>${esc(o.name)}</strong>${o.done ? "" : checkRows(p, o.id, o.checks, { gm: false })}</div>`).join("")}` : "");
    return `<div class="pct-line">${p.awareness !== null ? `<span class="pct-chip">Awareness ${p.awareness}</span>` : ""}<span class="pct-chip">Edge ${p.edge}</span><span class="pct-chip">Round ${p.round}</span><span class="pct-chip">${p.ip}${p.objective ? ` of ${p.objective}` : ""} infiltration</span></div>
      ${obstacles}${extras(p.complications, "Complications")}${extras(p.opportunities, "Opportunities")}`;
  },
  clock(p) {
    const filled = p.segments.filter((s) => s.state === "filled").length;
    const labels = p.segments.some((s) => s.label) ? `<ol class="pct-segs">${p.segments.map((s, i) => `<li class="pct-seg pct-seg-${s.state}"><span class="pct-seg-n">${i + 1}</span><span class="pct-seg-label">${esc(s.label)}</span></li>`).join("")}</ol>` : "";
    return `<div class="pct-clockwrap">${clockSVG(p.segments, 84)}<div><div class="pct-big">${filled} / ${p.segments.length}</div>${labels}</div></div>`;
  },
  checklist(p) {
    return p.entries.length ? `<ul class="pct-entries">${p.entries.map((e) => `<li class="${e.done ? "pct-done" : ""}"><i class="fa-${e.done ? "solid fa-square-check" : "regular fa-square"}"></i><div class="pct-entry"><strong>${esc(e.label)}</strong> ${dateStatus(e.closes, e.done)}</div></li>`).join("")}</ul>` : "";
  },
};

/** A short status card for chat: what players would see. */
function chatCard(p) {
  const head = `<header><i class="${KIND_INFO[p.kind].icon}"></i> <strong>${esc(p.name)}</strong></header>`;
  const desc = p.desc ? `<p>${para(p.desc)}</p>` : "";
  const reachedList = (list) => {
    const r = (list ?? []).filter((x) => x.reached);
    return r.length ? `<ul>${r.map((x) => `<li>${para(x.text)}</li>`).join("")}</ul>` : "";
  };
  let body = "";
  switch (p.kind) {
    case "reputation": {
      const tier = p.tiers.find((x) => x.id === p.tier);
      body = `<p class="pct-chat-big">${esc(tier?.label ?? "")}${p.value !== null ? ` (${signed(p.value)})` : ""}</p>${tier?.text ? `<p>${para(tier.text)}</p>` : ""}`;
      break;
    }
    case "pressure": {
      const tier = p.tiers.find((x) => x.id === p.tier);
      body = `<p class="pct-chat-big">${esc(tier?.label ?? "")}${p.value !== null ? ` (${p.value}${p.max !== null ? ` of ${p.max}` : ""})` : ""}</p>${tier?.text ? `<p>${para(tier.text)}</p>` : ""}${reachedList(p.thresholds)}`;
      break;
    }
    case "points":
      body = `${p.value !== null ? `<p class="pct-chat-big">${p.value}${p.max !== null ? ` / ${p.max}` : ""}</p>` : ""}${reachedList(p.thresholds)}`;
      break;
    case "influence":
      body = `<p class="pct-chat-big">${p.npc ? `${esc(p.npc.name)}: ` : ""}${p.value} influence</p><p>Round ${p.roundsUsed} of ${p.rounds}</p>${reachedList(p.thresholds)}`;
      break;
    case "research":
      body = `<p class="pct-chat-big">${p.value} research points</p>${reachedList(p.thresholds)}`;
      break;
    case "chase": {
      const n = p.obstacles.length;
      const o = p.obstacles[p.current];
      const where = p.current >= n ? "The party is through." : `Obstacle ${p.current + 1} of ${n}${o && !o.hidden ? `: ${esc(o.name)} (${o.progress} of ${o.points})` : ""}.`;
      const q = p.quarry ? (p.quarry.at > n ? ` The ${esc(p.quarry.label.toLowerCase())} got away.` : p.quarry.at >= 1 ? ` The ${esc(p.quarry.label.toLowerCase())} is at obstacle ${p.quarry.at}.` : "") : "";
      body = `<p class="pct-chat-big">Round ${p.round}</p><p>${where}${q}</p>`;
      break;
    }
    case "infiltration":
      body = `<p class="pct-chat-big">${p.ip}${p.objective ? ` of ${p.objective}` : ""} infiltration</p><p>${p.awareness !== null ? `Awareness ${p.awareness}. ` : ""}Edge ${p.edge}. Round ${p.round}.</p>`;
      break;
    case "clock": {
      const filled = p.segments.filter((s) => s.state === "filled").length;
      body = `<div class="pct-chat-clock">${clockSVG(p.segments, 48)}<span class="pct-chat-big">${filled} / ${p.segments.length}</span></div>`;
      break;
    }
    case "checklist":
      body = p.entries.length ? `<ul class="pct-chat-list">${p.entries.map((e) => `<li><i class="fa-${e.done ? "solid fa-square-check" : "regular fa-square"}"></i> ${esc(e.label)}</li>`).join("")}</ul>` : "<p>Nothing to show yet.</p>";
      break;
  }
  return `<div class="pct-chat pct-post">${head}${desc}${body}</div>`;
}

/* ------------------------------------------------------------------ */
/* Window                                                             */
/* ------------------------------------------------------------------ */

const openApps = new Set();
let refreshTimer = null;
/** Fields a redraw would pull the keyboard out of. Checkboxes are fine: a tick should show at once. */
const TYPING = "textarea, select, input:not([type=checkbox]):not([type=radio])";
function refresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    for (const app of openApps) {
      if (!app.rendered) continue;
      // Don't redraw under someone who is typing: the window's focusout calls refresh again when they leave the form.
      const active = document.activeElement;
      if (active && app.element.contains(active) && active.matches(TYPING)) {
        app._deferred = true;
        continue;
      }
      app.render();
    }
  }, 120);
}

/** Tab, folded cards and open GM-notes boxes, kept in this browser across redraws and reopening. */
const UI_KEY = `${MOD}.ui`;
function loadUI() {
  try {
    return JSON.parse(localStorage.getItem(UI_KEY)) ?? {};
  } catch {
    return {};
  }
}
function saveUI(state) {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify({ tab: state.tab, closed: [...state.closed], notesOpen: [...state.notesOpen] }));
  } catch {
    /* no storage: the state lives only in this window */
  }
}

class TrackersApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: MOD,
    classes: ["pct-app"],
    tag: "div",
    window: {
      title: "Campaign Trackers",
      icon: "fa-solid fa-list-check",
      resizable: true,
      controls: [
        { icon: "fa-solid fa-download", label: "Export data", action: "pctExport" },
        { icon: "fa-solid fa-upload", label: "Import data", action: "pctImport" },
      ],
    },
    position: { width: 960, height: 720 },
    actions: {
      pctExport: TrackersApp.#onExport,
      pctImport: TrackersApp.#onImport,
      pctTab: TrackersApp.#onTab,
      pctNew: TrackersApp.#onNew,
      pctFold: TrackersApp.#onFold,
      pctEdit: TrackersApp.#onEdit,
      pctReveal: TrackersApp.#onReveal,
      pctPost: TrackersApp.#onPost,
      pctDelete: TrackersApp.#onDelete,
      pctStep: TrackersApp.#onStep,
      pctToggle: TrackersApp.#onToggle,
      pctAdd: TrackersApp.#onAdd,
      pctRemove: TrackersApp.#onRemove,
      pctMove: TrackersApp.#onMove,
      pctSeg: { handler: TrackersApp.#onSeg, buttons: [0, 2] },
      pctRoll: TrackersApp.#onRoll,
      pctCard: TrackersApp.#onCard,
      pctCardList: TrackersApp.#onCardList,
      pctEndRound: TrackersApp.#onEndRound,
      pctHalve: TrackersApp.#onHalve,
      pctClearNpc: TrackersApp.#onClearNpc,
      pctPreview: TrackersApp.#onPreview,
      pctPresets: TrackersApp.#onPresets,
    },
  };

  state = (() => {
    const ui = loadUI();
    return { tab: ui.tab ?? null, closed: new Set(ui.closed ?? []), notesOpen: new Set(ui.notesOpen ?? []), edit: new Set(), preview: false };
  })();

  /** True when the window shows the GM's full view. */
  get isGM() {
    return game.user.isGM && !this.state.preview;
  }

  /** Export and Import are for the GM only. */
  _getHeaderControls() {
    return game.user.isGM ? super._getHeaderControls() : [];
  }

  trackers() {
    const list = this.isGM ? Store.data.trackers : visibleTrackers({ asPlayer: true });
    return [...list].sort((a, b) => num(a.sort) - num(b.sort) || String(a.name).localeCompare(String(b.name)));
  }

  /** The tracker a click came from: the full one for the GM, the revealed copy for players. */
  trackerFor(target) {
    const id = target.closest("[data-tid]")?.dataset.tid;
    if (!id) return null;
    return this.trackers().find((t) => t.id === id) ?? null;
  }

  async _renderHTML() {
    const all = this.trackers();
    const kinds = this.isGM ? KINDS : KINDS.filter((k) => all.some((t) => t.kind === k));
    if (!kinds.includes(this.state.tab)) this.state.tab = kinds[0] ?? null;
    const el = document.createElement("div");
    el.className = "pct";
    const rail = kinds.map((k) => {
      const n = all.filter((t) => t.kind === k).length;
      return `<a data-action="pctTab" data-kind="${k}" class="${this.state.tab === k ? "active" : ""}"><i class="${KIND_INFO[k].icon}"></i><span>${esc(KIND_INFO[k].tab)}</span>${n ? `<em>${n}</em>` : ""}</a>`;
    }).join("");
    const foot = game.user.isGM
      ? `<div class="pct-rail-foot">
          ${A("pctPreview", this.state.preview ? "fa-solid fa-user-shield" : "fa-solid fa-users", { label: this.state.preview ? "Back to GM view" : "Player view", tip: "See the window as the players see it", cls: this.state.preview ? "pct-on" : "" })}
          ${presets.size ? A("pctPresets", "fa-solid fa-box-open", { label: "Presets", tip: "Reload a preset's text from its module" }) : ""}
          ${Store.broken ? `<p class="pct-hint">The stored data couldn't be read. Export it from the window menu, fix the file, then import it.</p>` : ""}
        </div>`
      : "";
    el.innerHTML = `<nav class="pct-rail">${rail || `<p class="pct-hint">Nothing has been shared yet.</p>`}${foot}</nav>
      <section class="pct-body">${this.state.tab ? this.#tab(this.state.tab, all.filter((t) => t.kind === this.state.tab)) : ""}</section>
      ${this.isGM ? skillList() : ""}`;
    return el;
  }

  #tab(kind, list) {
    const info = KIND_INFO[kind];
    const head = `<header class="pct-tab-head"><div><h2><i class="${info.icon}"></i> ${esc(info.tab)}</h2>${this.isGM ? `<p class="pct-hint">${esc(info.blurb)}</p>` : ""}</div>
        ${this.isGM ? A("pctNew", "fa-solid fa-plus", { label: `New ${info.label.toLowerCase()}`, data: { kind }, cls: "pct-new" }) : ""}</header>`;
    const cards = list.map((t) => this.#card(t)).join("") || `<p class="pct-hint">${this.isGM ? "None yet." : "Nothing here yet."}</p>`;
    return head + cards;
  }

  #card(t) {
    const closed = this.state.closed.has(t.id);
    if (!this.isGM) {
      return `<article class="pct-card" data-tid="${esc(t.id)}">
          <header>${A("pctFold", closed ? "fa-solid fa-caret-right" : "fa-solid fa-caret-down", { cls: "pct-fold" })}<h3>${esc(t.name)}</h3></header>
          ${closed ? "" : `<div class="pct-card-body">${t.desc ? `<p class="pct-desc">${para(t.desc)}</p>` : ""}${PLAYER[t.kind](t)}</div>`}
        </article>`;
    }
    const editing = this.state.edit.has(t.id);
    const tools = [
      A("pctReveal", t.revealed ? "fa-solid fa-eye" : "fa-solid fa-eye-slash", { tip: t.revealed ? "Shown to players. Click to hide." : "Hidden from players. Click to show.", cls: `pct-eye ${t.revealed ? "pct-on" : ""}` }),
      A("pctPost", "fa-solid fa-comment", { tip: "Post to chat what players see" }),
      A("pctEdit", "fa-solid fa-pen", { tip: editing ? "Done editing" : "Edit", cls: editing ? "pct-on" : "" }),
      A("pctDelete", "fa-solid fa-trash", { tip: "Delete" }),
    ].join("");
    const body = closed ? "" : `<div class="pct-card-body">${editing ? editView(t) : `${t.desc ? `<p class="pct-desc">${para(t.desc)}</p>` : ""}${GM[t.kind](t)}${t.notes ? `<details class="pct-notes-box" ${this.state.notesOpen.has(t.id) ? "open" : ""}><summary>GM notes</summary><div class="pct-gm">${para(t.notes)}</div></details>` : ""}`}</div>`;
    return `<article class="pct-card ${t.revealed ? "" : "pct-hidden"}" data-tid="${esc(t.id)}" data-drop-card>
        <header>${A("pctFold", closed ? "fa-solid fa-caret-right" : "fa-solid fa-caret-down", { cls: "pct-fold" })}<h3>${esc(t.name)}</h3><span class="pct-sum">${esc(summary(t))}</span><span class="pct-tools">${tools}</span></header>
        ${body}
      </article>`;
  }

  _replaceHTML(result, content) {
    const top = content.querySelector(".pct-body")?.scrollTop ?? 0;
    content.replaceChildren(result);
    const body = content.querySelector(".pct-body");
    if (body) body.scrollTop = top;
    this._deferred = false;
  }

  _onFirstRender() {
    openApps.add(this);
    this.element.addEventListener("change", (ev) => this.#onChange(ev));
    // A redraw put off while a field had focus happens once focus leaves the form (refresh checks again).
    this.element.addEventListener("focusout", () => {
      if (this._deferred) refresh();
    });
    // <details> doesn't bubble its toggle event, so listen in the capture phase.
    this.element.addEventListener("toggle", (ev) => {
      const box = ev.target;
      if (!box?.classList?.contains("pct-notes-box")) return;
      const id = box.closest("[data-tid]")?.dataset.tid;
      if (!id) return;
      box.open ? this.state.notesOpen.add(id) : this.state.notesOpen.delete(id);
      saveUI(this.state);
    }, true);
    this.element.addEventListener("dragover", (ev) => {
      if (ev.target.closest?.("[data-drop]")) ev.preventDefault();
    });
    this.element.addEventListener("drop", (ev) => this.#onDrop(ev));
  }

  _onClose() {
    openApps.delete(this);
  }

  async #onChange(ev) {
    const el = ev.target.closest?.("[data-path]");
    const card = el?.closest("[data-tid]");
    if (!el || !card || !game.user.isGM) return;
    const path = el.dataset.path;
    const type = el.dataset.type;
    let value;
    if (type === "bool") value = el.checked;
    else if (type === "number") value = el.value === "" ? null : Number(el.value);
    else if (type === "steps") value = el.value.split(/[,\s]+/).map(Number).filter((n) => n > 0);
    else if (type === "date") {
      value = parseDate(el.value);
      if (value === undefined) {
        ui.notifications.warn(`Couldn't read "${el.value}" as a date. Try "15 ${months()[0]?.short ?? "Month"}" or "15 ${months()[0]?.short ?? "Month"} ${today().y}".`);
        return refresh();
      }
    } else if (type === "segcount") {
      value = clamp(Math.round(num(el.value, 6)), 1, 24);
      const dropped = (this.trackerFor(el)?.segments ?? []).slice(value).filter((s) => s.state !== "empty" || s.label || s.date);
      if (dropped.length) {
        const ok = await foundry.applications.api.DialogV2.confirm({
          window: { title: "Fewer segments" },
          content: `<p>Going down to ${value} segments drops ${dropped.length} that ${dropped.length === 1 ? "is" : "are"} filled, broken, named or dated. Drop ${dropped.length === 1 ? "it" : "them"}?</p>`,
        });
        if (!ok) return this.render();
      }
    } else value = el.value;
    await mutateTracker(card.dataset.tid, (t) => {
      if (type === "segcount") {
        while (t.segments.length < value) t.segments.push(TPL.segment());
        t.segments.length = value;
        return;
      }
      foundry.utils.setProperty(t, path, value);
    });
  }

  async #onDrop(ev) {
    const zone = ev.target.closest?.("[data-drop]");
    const card = zone?.closest("[data-tid]");
    if (!zone || !card || !game.user.isGM) return;
    ev.preventDefault();
    let data;
    try {
      data = JSON.parse(ev.dataTransfer.getData("text/plain"));
    } catch {
      return;
    }
    if (data?.type !== "Actor") return;
    const actor = await fromUuid(data.uuid);
    if (!actor) return;
    await mutateTracker(card.dataset.tid, (t) => {
      t.npc = { uuid: actor.uuid, name: actor.prototypeToken?.name?.trim() || actor.name, img: actor.img };
    });
  }

  static #onTab(event, target) {
    this.state.tab = target.dataset.kind;
    saveUI(this.state);
    this.render();
  }

  static async #onNew(event, target) {
    const t = blank(target.dataset.kind);
    this.state.edit.add(t.id);
    await mutate((d) => {
      d.trackers.push(t);
    }, { notify: false });
  }

  static #onFold(event, target) {
    const id = target.closest("[data-tid]").dataset.tid;
    this.state.closed.has(id) ? this.state.closed.delete(id) : this.state.closed.add(id);
    saveUI(this.state);
    this.render();
  }

  static #onEdit(event, target) {
    const id = target.closest("[data-tid]").dataset.tid;
    this.state.edit.has(id) ? this.state.edit.delete(id) : this.state.edit.add(id);
    this.render();
  }

  static async #onReveal(event, target) {
    const id = target.closest("[data-tid]").dataset.tid;
    await mutateTracker(id, (t) => {
      t.revealed = !t.revealed;
    }, { notify: false });
  }

  static async #onPost(event, target) {
    const t = this.trackerFor(target);
    if (!t) return;
    if (!t.revealed) {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Post to chat" },
        content: `<p><strong>${esc(t.name)}</strong> is hidden from players. Posting it shows them what they would see if it were revealed. Post anyway?</p>`,
      });
      if (!ok) return;
    }
    await ChatMessage.create({ content: chatCard(project(t, { force: true })), speaker: { alias: KIND_INFO[t.kind].label } });
  }

  static async #onDelete(event, target) {
    const t = this.trackerFor(target);
    if (!t) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Delete tracker" },
      content: `<p>Delete <strong>${esc(t.name)}</strong>? This can't be undone.${t.preset ? " It came from a preset, which will add it back if the preset is reloaded." : ""}</p>`,
    });
    if (!ok) return;
    await mutate((d) => {
      d.trackers = d.trackers.filter((x) => x.id !== t.id);
    }, { notify: false });
  }

  static async #onStep(event, target) {
    const id = target.closest("[data-tid]").dataset.tid;
    const path = target.dataset.path;
    const delta = Number(target.dataset.delta);
    await mutateTracker(id, (t) => {
      const [lo, hi] = bounds(t, path);
      const now = num(foundry.utils.getProperty(t, path));
      foundry.utils.setProperty(t, path, clamp(now + delta, lo, hi));
    });
  }

  static async #onToggle(event, target) {
    const id = target.closest("[data-tid]").dataset.tid;
    const path = target.dataset.path;
    await mutateTracker(id, (t) => {
      foundry.utils.setProperty(t, path, !foundry.utils.getProperty(t, path));
    }, { notify: false });
  }

  static async #onAdd(event, target) {
    const id = target.closest("[data-tid]").dataset.tid;
    const list = target.dataset.list;
    await mutateTracker(id, (t) => {
      const tpl = tplFor(t.kind, list);
      const arr = foundry.utils.getProperty(t, list);
      if (!tpl || !Array.isArray(arr)) return;
      const row = TPL[tpl]();
      const last = arr.at(-1);
      if (tpl === "tier" && last) row.min = num(last.min) + 5;
      if (tpl === "threshold" && last) row.at = num(last.at) + 1;
      if (tpl === "entry" && last) row.group = last.group;
      if (tpl === "segment" && last?.date) row.date = clone(last.date);
      arr.push(row);
    }, { notify: false });
  }

  static async #onRemove(event, target) {
    const id = target.closest("[data-tid]").dataset.tid;
    const parts = target.dataset.path.split(".");
    const index = Number(parts.pop());
    // A row with anything written in it asks first; a blank one just goes.
    const row = foundry.utils.getProperty(this.trackerFor(target) ?? {}, target.dataset.path);
    const written = ["label", "name", "text", "detail", "effect", "trigger", "skill", "gm"].map((k) => String(row?.[k] ?? "").trim()).find(Boolean);
    if (written || row?.checks?.length) {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Remove" },
        content: `<p>Remove <strong>${esc(written || "this row")}</strong>? This can't be undone.</p>`,
      });
      if (!ok) return;
    }
    await mutateTracker(id, (t) => {
      foundry.utils.getProperty(t, parts.join("."))?.splice(index, 1);
    }, { notify: false });
  }

  static async #onMove(event, target) {
    const id = target.closest("[data-tid]").dataset.tid;
    const parts = target.dataset.path.split(".");
    const index = Number(parts.pop());
    const dir = Number(target.dataset.dir);
    await mutateTracker(id, (t) => {
      const arr = foundry.utils.getProperty(t, parts.join("."));
      const to = index + dir;
      if (!arr || to < 0 || to >= arr.length) return;
      [arr[index], arr[to]] = [arr[to], arr[index]];
    }, { notify: false });
  }

  /** Click fills or empties a segment; right-click marks it broken (or empties a broken one). */
  static async #onSeg(event, target) {
    const id = target.closest("[data-tid]").dataset.tid;
    const path = target.dataset.path;
    const right = event.button === 2 || event.type === "contextmenu";
    await mutateTracker(id, (t) => {
      const s = foundry.utils.getProperty(t, path);
      if (!s) return;
      if (right) s.state = s.state === "broken" ? "empty" : "broken";
      else s.state = s.state === "filled" ? "empty" : "filled";
    }, { notify: false });
  }

  static async #onRoll(event, target) {
    const t = this.trackerFor(target);
    if (!t) return;
    const where = locate(t, target.dataset.target);
    const check = where?.checks?.find((c) => c.id === target.dataset.check);
    if (!check) return;
    await rollCheck({ tid: t.id, target: target.dataset.target, check, title: rollTitle(t, target.dataset.target) });
  }

  static async #onCard(event, target) {
    const t = this.trackerFor(target);
    if (t && game.user.isGM) await postCheckCard(t, { target: target.dataset.target });
  }

  static async #onCardList(event, target) {
    const t = this.trackerFor(target);
    if (t && game.user.isGM) await postCheckCard(t, { list: target.dataset.list });
  }

  static async #onEndRound(event, target) {
    const id = target.closest("[data-tid]").dataset.tid;
    await mutateTracker(id, (t) => {
      if (t.kind === "influence") t.roundsUsed = num(t.roundsUsed) + 1;
      else t.round = num(t.round) + 1;
      if (t.kind === "infiltration") t.awareness = num(t.awareness) + 1;
    });
  }

  static async #onHalve(event, target) {
    const id = target.closest("[data-tid]").dataset.tid;
    await mutateTracker(id, (t) => {
      t.value = Math.floor(num(t.value) / 2);
    });
  }

  static async #onClearNpc(event, target) {
    const id = target.closest("[data-tid]").dataset.tid;
    await mutateTracker(id, (t) => {
      t.npc = null;
    }, { notify: false });
  }

  static #onPreview() {
    this.state.preview = !this.state.preview;
    this.render();
  }

  static async #onPresets() {
    const list = [...presets.values()];
    if (!list.length) return;
    const rows = list.map((p) => {
      const have = Store.data.presets?.[p.id];
      return `<li><strong>${esc(p.label)}</strong> version ${esc(p.version)}${have ? `, loaded version ${esc(have.version)}` : ", not loaded"}</li>`;
    }).join("");
    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: "Presets" },
      content: `<p>Reloading a preset puts its text back the way its module ships it: names, tiers, thresholds, checks, dates and notes. Values, progress, ticks and what you've revealed are kept. Trackers you deleted come back.</p><ul>${rows}</ul>`,
      buttons: [...list.map((p) => ({ action: p.id, label: `Reload ${p.label}` })), { action: "cancel", label: "Cancel", default: true }],
      rejectClose: false,
    });
    if (choice && choice !== "cancel") await syncPresets({ force: true, only: choice });
  }

  /** Download the whole store as a JSON file: the in-memory data, or the unreadable stored text as it is. */
  static #onExport() {
    if (!game.user.isGM) return;
    const json = Store.broken ?? JSON.stringify(Store.data, null, 2);
    foundry.utils.saveDataToFile(json, "application/json", `${game.world.id}-campaign-trackers-${new Date().toISOString().slice(0, 10)}.json`);
  }

  /** Replace the whole store with an exported file, after a confirmation. */
  static async #onImport() {
    if (!game.user.isGM) return;
    const file = await foundry.applications.api.DialogV2.wait({
      window: { title: "Import tracker data" },
      content: `<p>Pick a file exported from Campaign Trackers.</p><input type="file" name="file" accept=".json,application/json">`,
      buttons: [
        { action: "import", label: "Import", icon: "fa-solid fa-upload", callback: (event, button) => button.form?.elements.file?.files?.[0] ?? null },
        { action: "cancel", label: "Cancel", default: true },
      ],
      rejectClose: false,
    });
    if (!(file instanceof File)) return;
    let data;
    try {
      data = JSON.parse(await foundry.utils.readTextFromFile(file));
    } catch (err) {
      return ui.notifications.error(`Campaign Trackers: "${file.name}" isn't valid JSON (${err.message}).`);
    }
    if (!Array.isArray(data?.trackers)) return ui.notifications.error(`Campaign Trackers: "${file.name}" doesn't hold tracker data (no "trackers" list).`);
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Import tracker data" },
      content: `<p>Replace everything here (${Store.data.trackers.length} trackers) with the ${data.trackers.length} trackers in <strong>${esc(file.name)}</strong>? Values, reveals and notes all come from the file. This can't be undone.</p>`,
    });
    if (!ok) return;
    await Store.replace(data);
    ui.notifications.info(`Campaign Trackers: imported ${Store.data.trackers.length} trackers from "${file.name}".`);
  }

  static open() {
    if (!game.user.isGM && !game.settings.get(MOD, "playerAccess")) return ui.notifications.warn("The GM hasn't opened the campaign trackers to players.");
    const existing = [...openApps][0];
    if (existing) return existing.render({ force: true });
    return new TrackersApp().render({ force: true });
  }
}

/* ------------------------------------------------------------------ */
/* Registration                                                       */
/* ------------------------------------------------------------------ */

Hooks.once("init", () => {
  game.settings.register(MOD, "public", { scope: "world", config: false, type: Object, default: { trackers: [] }, onChange: () => refresh() });
  game.settings.register(MOD, "reminders", {
    name: "Date reminders",
    hint: "Whisper the GM when the calendar reaches a date on a clock or a checklist entry.",
    scope: "world", config: true, type: Boolean, default: true,
  });
  game.settings.register(MOD, "playerAccess", {
    name: "Players can open the trackers",
    hint: "Players see only what you've revealed. Turn this off to keep the window GM-only.",
    scope: "world", config: true, type: Boolean, default: true,
  });
  game.keybindings.register(MOD, "open", {
    name: "Open Campaign Trackers",
    hint: "Opens the trackers window, or brings it to the front.",
    editable: [{ key: "KeyT", modifiers: ["Alt"] }],
    onDown: () => {
      TrackersApp.open();
      return true;
    },
  });
});

Hooks.once("ready", async () => {
  const api = {
    open: () => TrackersApp.open(),
    registerPreset,
    syncPresets,
    get: (id) => clone(Store.get(id)),
    list: () => clone(Store.data.trackers),
    /** Change a field by an amount, e.g. adjust("my-heat", "value", 1). GM only. */
    adjust: (id, path, delta) => mutateTracker(id, (t) => {
      const [lo, hi] = bounds(t, path);
      foundry.utils.setProperty(t, path, clamp(num(foundry.utils.getProperty(t, path)) + Number(delta), lo, hi));
    }),
    /** Set a field, e.g. set("my-clock", "segments.2.state", "filled"). GM only. */
    set: (id, path, value) => mutateTracker(id, (t) => foundry.utils.setProperty(t, path, value)),
    reveal: (id, revealed = true) => mutateTracker(id, (t) => {
      t.revealed = !!revealed;
    }, { notify: false }),
    today,
    parseDate,
    formatDate: fmtDate,
    /** Let the data journal (or the one with this id) be deleted. Export first. GM only. */
    unlockStore: async (id = null) => {
      const j = id ? game.journal.get(id) : Store.journal;
      if (!j || !game.user.isGM) return ui.notifications.warn("Campaign Trackers: no such journal entry.");
      await j.setFlag(SCOPE, "allowDelete", true);
      ui.notifications.info(`Campaign Trackers: "${j.name}" can be deleted now.`);
    },
  };
  game.modules.get(MOD).api = api;
  if (game.user.isGM) {
    await Store.ensure();
    Store.load();
    storeReady = true;
    if (isPrimaryGM() && !Store.broken) await publish(Store.data);
    Hooks.callAll(`${MOD}.ready`, api);
    await syncPresets();
    scheduleReminders();
  } else {
    Hooks.callAll(`${MOD}.ready`, api);
  }
});

/**
 * The data changed: load it, unless it's the revision this client just wrote. The same GM user can
 * be in two tabs, so the user id says nothing about which window wrote it.
 */
Hooks.on("updateJournalEntry", (doc, changes) => {
  if (!game.user.isGM || !doc.getFlag(SCOPE, "store")) return;
  const json = changes.flags?.[SCOPE]?.json;
  if (json === undefined) return;
  let rev = null;
  try {
    rev = num(JSON.parse(json).rev, 0);
  } catch {
    /* unreadable: load() keeps it aside */
  }
  if (rev === Store.rev && !Store.broken) return;
  Store.load();
  refresh();
});
/** The data journal can't be deleted by accident: it needs the allowDelete flag (api.unlockStore). */
Hooks.on("preDeleteJournalEntry", (doc) => {
  if (!doc.getFlag(SCOPE, "store") || doc.getFlag(SCOPE, "allowDelete")) return;
  ui.notifications.warn(`Campaign Trackers: "${doc.name}" holds your tracker data and wasn't deleted. Export it first, then run game.modules.get("${MOD}").api.unlockStore("${doc.id}") and delete it.`);
  return false;
});
Hooks.on("deleteJournalEntry", (doc) => {
  if (Store.journal?.id === doc.id) Store.journal = null;
});
/** Dates only matter by the day, so a running clock doesn't redraw the window every second. */
let lastDay = null;
Hooks.on("updateWorldTime", () => {
  const day = dkey(today());
  if (day === lastDay) return;
  lastDay = day;
  scheduleReminders();
  refresh();
});
Hooks.on("renderChatMessageHTML", onRenderMessage);
Hooks.on("updateActor", (actor, changes) => {
  if (changes.name !== undefined || changes.prototypeToken?.name !== undefined) refresh();
});

Hooks.on("getSceneControlButtons", (controls) => {
  const tools = controls.tokens?.tools;
  if (!tools) return;
  if (!game.user.isGM && !game.settings.get(MOD, "playerAccess")) return;
  tools.campaignTrackers = {
    name: "campaignTrackers",
    title: "Campaign Trackers",
    icon: "fa-solid fa-list-check",
    order: Object.keys(tools).length,
    button: true,
    visible: true,
    onChange: () => TrackersApp.open(),
  };
});
