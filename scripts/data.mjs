/** The shape of every tracker: templates, normalizing, quest rules (ticks, follows, filing, party edits), and reading values. */

import { esc } from "./kit/safe-text.mjs";
import { onCalendar } from "./calendar.mjs";
import { shortText } from "./checks.mjs";
import { CDEG, DEGREES, KINDS, KIND_INFO, clone, lz, num, signed, uid } from "./core.mjs";
import { partyMembers } from "./html.mjs";
import { reputationScale } from "./rules.mjs";
import { questSummary } from "./socket.mjs";
import { Store, mutate } from "./store.mjs";

/* ------------------------------------------------------------------ */
/* Templates for every list in every tracker                           */
/* ------------------------------------------------------------------ */

const TPL = {
  tier: () => ({ id: uid(), label: lz("NewTier"), min: 0, text: "", gm: "" }),
  threshold: () => ({ id: uid(), at: 1, text: "", revealed: false }),
  check: () => ({ id: uid(), label: "", skill: "", dc: null, revealed: false }),
  rcheck: () => ({ id: uid(), label: "", skill: "", dc: null, maxRP: null, earned: 0, revealed: false }),
  note: () => ({ id: uid(), text: "", revealed: false }),
  obstacle: () => ({ id: uid(), name: "", points: 4, progress: 0, text: "", checks: [], revealed: false }),
  iobstacle: () => ({ id: uid(), name: "", points: 1, type: "group", progress: 0, byActor: {}, text: "", checks: [], revealed: false }),
  complication: () => ({ id: uid(), name: "", trigger: "", text: "", checks: [], done: false, revealed: false }),
  opportunity: () => ({ id: uid(), name: "", text: "", checks: [], done: false, revealed: false }),
  approach: () => ({ id: uid(), label: "", gm: "", critFail: "", uses: null, used: 0, checks: [], revealed: false }),
  adhoc: () => ({ id: uid(), skill: "", dc: null, label: "", approach: null, auto: false, actors: [] }),
  segment: () => ({ id: uid(), label: "", date: null, text: "", state: "empty", reminded: null }),
  entry: () => ({ id: uid(), group: "", label: "", detail: "", effect: "", closes: null, tag: "", done: false, revealed: false, reminded: null }),
  objective: () => ({ id: uid(), text: "", gm: "", state: "open", optional: false, count: null, have: 0, mode: "all", steps: [], onDone: [], doneBy: null, link: null, revealed: false }),
  step: () => ({ id: uid(), text: "", gm: "", state: "open", optional: false, count: null, have: 0, onDone: [], doneBy: null, link: null, revealed: false }),
  qentry: () => ({ id: uid(), date: null, text: "", revealed: false, revealedAt: null, under: "" }),
  lead: () => ({ id: uid(), text: "", to: "", clues: [], gm: "", revealed: false, followed: false, followedBy: null }),
  reward: () => ({ id: uid(), text: "", gm: "", actor: null, revealed: false }),
};

/** Which fields of each kind are lists, and the template their rows use. Nested lists use "parent.child". */
const LISTS = {
  quest: { objectives: "objective", "objectives.steps": "step", entries: "qentry", leads: "lead", rewards: "reward" },
  reputation: { tiers: "tier" },
  pressure: { tiers: "tier", thresholds: "threshold" },
  points: { thresholds: "threshold", checks: "check" },
  challenge: { thresholds: "threshold", approaches: "approach", "approaches.checks": "check", adhoc: "adhoc" },
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


const PRESSURE_BANDS = () => [
  { id: "low", label: lz("Low"), min: 0, text: "", gm: "" },
  { id: "rising", label: lz("Rising"), min: 4, text: "", gm: "" },
  { id: "high", label: lz("High"), min: 8, text: "", gm: "" },
];

/** Points for each result left to the system's rules (a number set here is the GM's own). */
const noPoints = () => Object.fromEntries(DEGREES.map((d) => [d, null]));
const noInfiltrationPoints = () => Object.fromEntries(DEGREES.map((d) => [d, { ip: null, ap: null }]));

/** A new, empty tracker of a kind. */
function blank(kind, name) {
  const base = { id: uid(), kind, name: name || `${lz("New")} ${KIND_INFO[kind].label.toLowerCase()}`, revealed: false, desc: "", notes: "", sort: Date.now() };
  switch (kind) {
    case "quest":
      return { ...base, status: "active", category: lz("Main"), focus: false, party: null, img: "", giver: null, giverText: "", location: "", deadline: null, showDue: true, reminded: null, objectives: [], entries: [], leads: [], rewards: [], pnotes: [] };
    case "reputation":
      const scale = reputationScale();
      return { ...base, value: 0, min: scale?.min ?? null, max: scale?.max ?? null, showValue: true, steps: [1, 2, 5], tiers: scale?.tiers ?? [] };
    case "pressure":
      return { ...base, value: 0, min: 0, max: 10, showValue: false, showBand: true, halve: true, steps: [1], tiers: PRESSURE_BANDS(), thresholds: [] };
    case "points":
      return { ...base, value: 0, min: 0, max: 10, showValue: true, halve: false, thresholds: [], checks: [], degrees: noPoints() };
    case "challenge":
      return { ...base, successes: 0, failures: 0, goal: 4, limit: 3, rounds: null, round: 1, showCount: true, explain: true, oncePerRound: false, degrees: CDEG(), onSuccess: "", onFailure: "", thresholds: [], approaches: [], log: [] };
    case "influence":
      return { ...base, npc: null, value: 0, rounds: 3, roundsUsed: 0, thresholds: [], skills: [], discovery: [], resistances: [], weaknesses: [], penalty: "", showValue: true, degrees: noPoints() };
    case "research":
      return { ...base, value: 0, round: 0, showValue: true, thresholds: [], checks: [], degrees: noPoints() };
    case "chase":
      return { ...base, round: 1, current: 0, quarry: { enabled: true, label: lz("Quarry"), at: 1 }, obstacles: [TPL.obstacle()], degrees: noPoints() };
    case "infiltration":
      return { ...base, round: 1, awareness: 0, showAwareness: false, edge: 0, objective: 0, degrees: noInfiltrationPoints(), awarenessThresholds: [], obstacles: [], complications: [], opportunities: [] };
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
  if (kind === "challenge") {
    const raw = t.degrees ?? {};
    t.degrees = Object.fromEntries(Object.entries(CDEG()).map(([d, def]) => [d, { s: num(raw[d]?.s, def.s), f: num(raw[d]?.f, def.f) }]));
    t.log = Array.isArray(t.log) ? t.log : [];
  } else if (kind === "infiltration") t.degrees = Object.fromEntries(DEGREES.map((d) => [d, { ip: nullNum(t.degrees?.[d]?.ip), ap: nullNum(t.degrees?.[d]?.ap) }]));
  else if (t.degrees) t.degrees = Object.fromEntries(DEGREES.map((d) => [d, nullNum(t.degrees[d])]));
  if (kind === "chase") t.quarry = { enabled: true, label: lz("Quarry"), at: 1, ...(t.quarry ?? {}) };
  if (kind === "quest") {
    if (!QSTATUS.includes(t.status)) t.status = "active";
    t.focus = !!t.focus;
    // A party quest: made by a player, editable by the whole party (through the GM's client).
    t.party = t.party && typeof t.party === "object" && t.party.by ? { by: String(t.party.by), name: String(t.party.name ?? "") } : null;
    t.pnotes = Array.isArray(t.pnotes) ? t.pnotes : [];
    // A lead reveals clues of the same quest; an older single `clue` joins the list, and ids no longer there drop out.
    const clueIds = new Set(t.entries.map((e) => e.id));
    for (const l of t.leads) {
      const list = Array.isArray(l.clues) ? l.clues : [];
      if (typeof l.clue === "string" && l.clue) list.push(l.clue);
      delete l.clue;
      l.clues = [...new Set(list.filter((id) => typeof id === "string" && clueIds.has(id)))];
      l.followed = !!l.followed;
      l.followedBy = l.followed ? (l.followedBy ? String(l.followedBy) : "gm") : null;
    }
    for (const o of t.objectives) {
      fixGoal(o);
      if (o.mode !== "any") o.mode = "all";
      o.steps.forEach(fixGoal);
    }
    // A clue is filed under an objective or step of the same quest, or under nothing.
    const goals = new Set(t.objectives.flatMap((o) => [o.id, ...o.steps.map((st) => st.id)]));
    for (const e of t.entries) e.under = typeof e.under === "string" && goals.has(e.under) ? e.under : "";
  }
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
/* Quests                                                              */
/* ------------------------------------------------------------------ */

const QSTATUS = ["active", "lead", "completed", "failed"];
const QSTATUS_LABEL = { get active() {
    return lz("Active");
  }, get lead() {
    return lz("Lead");
  }, get completed() {
    return lz("Completed");
  }, get failed() {
    return lz("Failed");
  } };
/** The order quests are listed in, by status. */
const QGROUPS = ["active", "lead", "completed", "failed"];
const GOAL_STATES = ["open", "done", "failed"];

/** An objective or step with a valid state and a count that makes sense. */
function fixGoal(g) {
  if (!GOAL_STATES.includes(g.state)) g.state = "open";
  g.count = nullNum(g.count);
  if (g.count !== null && g.count < 1) g.count = null;
  g.have = Math.max(0, num(g.have));
  g.onDone = Array.isArray(g.onDone) ? g.onDone.filter((x) => typeof x === "string") : [];
  g.link = g.link && typeof g.link === "object" && g.link.tid ? { tid: String(g.link.tid), cond: g.link.cond ?? null, at: nullNum(g.link.at), entry: g.link.entry ?? null } : null;
}

/** What a goal can watch on each kind of tracker, the first being the default. */
const LINK_CONDS = {
  get clock() { return [["full", lz("LinkFull")]]; },
  get challenge() { return [["won", lz("LinkWon")], ["lost", lz("LinkLost")]]; },
  get points() { return [["atLeast", lz("LinkReaches")]]; },
  get research() { return [["atLeast", lz("LinkReaches")]]; },
  get influence() { return [["atLeast", lz("LinkReaches")]]; },
  get reputation() { return [["atLeast", lz("LinkReaches")]]; },
  get pressure() { return [["atLeast", lz("LinkReaches")]]; },
  get checklist() { return [["entry", lz("LinkTicked")]]; },
  get chase() { return [["through", lz("LinkThrough")]]; },
  get infiltration() { return [["objective", lz("LinkObjective")]]; },
};
const linkCond = (link, t) => (LINK_CONDS[t?.kind] ?? []).some(([c]) => c === link?.cond) ? link.cond : LINK_CONDS[t?.kind]?.[0]?.[0] ?? null;

/** Whether a linked tracker has reached what the goal watches, and how far along it is. */
function linkState(link, trackers) {
  const t = link?.tid ? (trackers ?? []).find((x) => x.id === link.tid) : null;
  if (!t) return { met: false, text: link?.tid ? lz("LinkedTrackerIsGone") : "", name: "" };
  const cond = linkCond(link, t);
  const name = t.name;
  switch (cond) {
    case "full": {
      const n = t.segments?.length ?? 0, f = (t.segments ?? []).filter((x) => x.state === "filled").length;
      return { met: n > 0 && f >= n, text: lz("NOfMax", { n: f, max: n }), name };
    }
    case "won":
    case "lost":
      return { met: challengeStatus(t) === cond, text: lz("SuccessesFailuresShort", { s: num(t.successes), f: num(t.failures) }), name };
    case "atLeast": {
      const at = nullNum(link.at);
      return { met: at !== null && num(t.value) >= at, text: at !== null ? lz("NOfMax", { n: num(t.value), max: at }) : String(num(t.value)), name };
    }
    case "entry": {
      const e = (t.entries ?? []).find((x) => x.id === link.entry);
      return { met: !!e?.done, text: e ? `${shortText(e.label, 40)}: ${e.done ? "ticked" : lz("NotYet2")}` : lz("PickAnEntry"), name };
    }
    case "through": {
      const n = t.obstacles?.length ?? 0;
      return { met: n > 0 && num(t.current) >= n, text: `${lz("ObstacleOf", { x: Math.min(num(t.current) + 1, n), n: n })}`, name };
    }
    case "objective": {
      const goal = num(t.objective);
      if (goal > 0) return { met: infiltrationIP(t) >= goal, text: `${infiltrationIP(t)} ${lz("OfIP", { goal: goal })}`, name };
      const p = infiltrationProgress(t, livePCs());
      return { met: p.of > 0 && p.done >= p.of, text: `${lz("OfObstaclesOvercome", { done: p.done, of: p.of })}`, name };
    }
  }
  return { met: false, text: "", name };
}

/** Open goals whose linked tracker has just reached what they watch: [{ tid, goal, why }]. */
function linkTriggers(before, after) {
  const out = [];
  for (const q of after.trackers ?? []) {
    if (q.kind !== "quest" || !OPEN_Q.includes(q.status)) continue;
    for (const o of q.objectives ?? []) {
      for (const g of [o, ...(o.steps ?? [])]) {
        if (!g.link?.tid || g.state !== "open") continue;
        const now = linkState(g.link, after.trackers);
        if (now.met && !linkState(g.link, before.trackers).met) out.push({ tid: q.id, goal: g.id, why: `${now.name} ${linkWhy(g.link, after.trackers)}` });
      }
    }
  }
  return out;
}
function linkWhy(link, trackers) {
  const t = (trackers ?? []).find((x) => x.id === link.tid);
  const cond = linkCond(link, t);
  if (cond === "atLeast") return `reached ${link.at}`;
  if (cond === "entry") return `has "${shortText((t?.entries ?? []).find((x) => x.id === link.entry)?.label, 40)}" ticked`;
  return { full: lz("IsFull"), won: lz("Succeeded2"), lost: lz("FailedLower"), through: lz("WasWon"), objective: lz("ReachedItsObjective") }[cond] ?? lz("Changed");
}

/** Statuses of a quest still in play. */
const OPEN_Q = ["active", "lead"];

/** How an objective's steps stand: { done, of, complete } (complete: the steps add up, by "all" or "any one"). */
function stepProgress(o, steps = o.steps) {
  const counted = steps.filter((x) => !x.optional);
  const done = steps.filter((x) => x.state === "done").length;
  const doneNeeded = counted.filter((x) => x.state === "done").length;
  const complete = steps.length > 0 && (o.mode === "any" ? done > 0 : counted.length > 0 && doneNeeded === counted.length);
  return { done, of: o.mode === "any" ? steps.length : counted.length, complete };
}

/** An objective or step by id, with the objective it sits under (null for an objective). */
function findGoal(t, id) {
  for (const o of t.objectives ?? []) {
    if (o.id === id) return { g: o, parent: null };
    for (const st of o.steps ?? []) if (st.id === id) return { g: st, parent: o };
  }
  return null;
}

/**
 * A player ticks or unticks a goal. Allowed on a revealed goal of a revealed, unfinished quest:
 * open to done, or done back to open when a player (not the GM) ticked it. Players never mark failed.
 * Changes `t` in place and returns true when it changed.
 */
function applyQuestTick(t, goalId, to, userId) {
  if (t?.kind !== "quest" || !t.revealed || !["active", "lead"].includes(t.status)) return false;
  const found = findGoal(t, goalId);
  if (!found || !found.g.revealed || (found.parent && !found.parent.revealed)) return false;
  const g = found.g;
  if (to === "done" && g.state === "open") {
    g.state = "done";
    g.doneBy = userId;
    return true;
  }
  if (to === "open" && g.state === "done" && g.doneBy && g.doneBy !== "gm") {
    g.state = "open";
    g.doneBy = null;
    return true;
  }
  return false;
}

/**
 * A player marks a lead followed or not. Allowed on a revealed lead of a revealed, unfinished quest; a player undoes
 * only a player's mark, not the GM's. Changes `t` in place and returns true when it changed.
 */
function applyLeadFollow(t, leadId, to, userId) {
  if (t?.kind !== "quest" || !t.revealed || !["active", "lead"].includes(t.status)) return false;
  const l = (t.leads ?? []).find((x) => x.id === leadId);
  if (!l || !l.revealed) return false;
  if (to === "done" && !l.followed) {
    l.followed = true;
    l.followedBy = userId;
    return true;
  }
  if (to === "open" && l.followed && l.followedBy && l.followedBy !== "gm") {
    l.followed = false;
    l.followedBy = null;
    return true;
  }
  return false;
}

/**
 * A player files a shown clue under a shown objective or step (or under nothing), on a revealed, unfinished quest. A
 * clue the GM filed under something players can't see stays where it is. Changes `t` in place; true when it changed.
 */
function applyClueSort(t, clueId, under) {
  if (t?.kind !== "quest" || !t.revealed || !["active", "lead"].includes(t.status)) return false;
  const e = (t.entries ?? []).find((x) => x.id === clueId);
  if (!e || !e.revealed) return false;
  if (e.under && !rowShown(findRow(t, e.under))) return false;
  if (under) {
    const f = findRow(t, under);
    if (!f || !["objectives", "objectives.steps"].includes(f.list) || !rowShown(f)) return false;
  }
  if ((e.under ?? "") === under) return false;
  e.under = under;
  return true;
}

const NOTE_MAX = 60, NOTE_LEN = 1000;
/* Party quests. A player's edit runs on their copy of the quest; what changed (fields set, rows added, removed,
 * edited or reordered, matched by id) goes to the GM's client, which applies only the parts players may change.
 * Rows the GM has hidden never reach players, so they're never touched. */
const PARTY_FIELDS = ["name", "desc", "status", "category", "location", "giverText", "deadline"];
const STEP_ROWS = { tpl: "step", fields: ["text", "optional", "count", "have"] };
const PARTY_ROWS = {
  objectives: { tpl: "objective", fields: ["text", "optional", "count", "have", "mode"], nested: "steps" },
  entries: { tpl: "qentry", fields: ["date", "text", "under"] },
  leads: { tpl: "lead", fields: ["text"] },
  rewards: { tpl: "reward", fields: ["text"] },
};
const PARTY_MAX = { objectives: 40, steps: 20, entries: 100, leads: 30, rewards: 30 };
/** The most party quests one player may have made, and how long (as JSON) a player's edit may make a quest. */
const PARTY_PER_PLAYER = 20, PARTY_QUEST_SIZE = 64000;
/** Every row id in a quest: objectives, their steps, clues, leads and rewards. */
const questIds = (t) => new Set([...Object.keys(PARTY_ROWS).flatMap((l) => (t[l] ?? []).map((r) => r.id)), ...(t.objectives ?? []).flatMap((o) => (o.steps ?? []).map((x) => x.id))]);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** What changed between a player's copy of a party quest before and after an edit, or null for nothing. */
function partyChanges(before, after) {
  const out = { set: {}, lists: {} };
  for (const k of PARTY_FIELDS) if (!same(before?.[k], after?.[k])) out.set[k] = after?.[k] ?? null;
  for (const [list, spec] of Object.entries(PARTY_ROWS)) {
    const lc = rowChanges(before?.[list] ?? [], after?.[list] ?? [], spec);
    if (lc) out.lists[list] = lc;
  }
  return Object.keys(out.set).length || Object.keys(out.lists).length ? out : null;
}
function rowChanges(b, a, spec) {
  const old = new Map(b.map((r) => [r.id, r]));
  const add = [];
  const edit = {};
  const remove = b.filter((r) => !a.some((x) => x.id === r.id)).map((r) => r.id);
  for (const r of a) {
    const was = old.get(r.id);
    const fields = {};
    for (const f of spec.fields) if (!was || !same(was[f], r[f])) fields[f] = r[f] ?? null;
    if (spec.nested) {
      const nc = rowChanges(was?.[spec.nested] ?? [], r[spec.nested] ?? [], STEP_ROWS);
      if (nc) fields[spec.nested] = nc;
    }
    if (!was) add.push({ id: r.id, ...fields });
    else if (Object.keys(fields).length) edit[r.id] = fields;
  }
  // Order counts only when rows in both copies changed places; new rows go at the end either way.
  const order = a.map((r) => r.id);
  const keptA = order.filter((id) => old.has(id));
  const keptB = b.map((r) => r.id).filter((id) => a.some((x) => x.id === id));
  const sameOrder = keptA.length === keptB.length && keptA.every((id, i) => keptB[i] === id);
  if (!add.length && !remove.length && !Object.keys(edit).length && sameOrder) return null;
  return { add, edit, remove, order: sameOrder ? null : order };
}

/** A value a player sent, made safe for its field. */
function partyValue(f, v) {
  const text = (max) => String(v ?? "").slice(0, max);
  const date = () => {
    if (!v || typeof v !== "object" || ![v.y, v.m, v.d].every(Number.isFinite)) return null;
    const x = { y: Math.trunc(v.y), m: Math.trunc(v.m), d: Math.trunc(v.d) };
    return onCalendar(x) ? x : null;
  };
  switch (f) {
    case "name": return text(120).trim() || lz("UntitledQuest");
    case "desc": return text(4000);
    case "category": case "location": case "giverText": return text(80);
    case "text": return text(1000);
    case "under": return text(40);
    case "deadline": case "date": return date();
    case "optional": return !!v;
    case "count": {
      const n = nullNum(v);
      return Number.isFinite(n) && n >= 1 ? Math.min(Math.trunc(n), 9999) : null;
    }
    case "have": return Math.max(0, Math.min(Math.trunc(num(v)), 9999));
    case "mode": return v === "any" ? "any" : "all";
  }
  return null;
}

/** The GM's client applies a player's changes to a party quest. False when it isn't one. */
function applyPartyChanges(t, ch, makeId = uid) {
  if (!t?.party || !ch || typeof ch !== "object") return false;
  const filedBefore = new Map((t.entries ?? []).map((e) => [e.id, e.under ?? ""]));
  for (const [k, v] of Object.entries(ch.set ?? {})) {
    if (!PARTY_FIELDS.includes(k)) continue;
    if (k === "status") {
      if (QSTATUS.includes(v)) t.status = v;
      continue;
    }
    if (k === "giverText" && t.giver) continue;
    // A due date the GM keeps secret isn't the party's to change.
    if (k === "deadline" && t.showDue === false) continue;
    t[k] = partyValue(k, v);
  }
  const taken = questIds(t);
  for (const [list, lc] of Object.entries(ch.lists && typeof ch.lists === "object" ? ch.lists : {})) {
    if (Object.hasOwn(PARTY_ROWS, list)) t[list] = applyRows(t[list] ?? [], lc, PARTY_ROWS[list], PARTY_MAX[list], makeId, taken);
  }
  // Filing a clue follows the same rules as dragging it: only under a goal players see, and never off one they don't.
  for (const e of t.entries ?? []) {
    const was = filedBefore.get(e.id) ?? "";
    const now = typeof e.under === "string" ? e.under : "";
    if (now === was) continue;
    const to = now ? findRow(t, now) : null;
    const okTo = !now || (!!to && ["objectives", "objectives.steps"].includes(to.list) && rowShown(to));
    if ((was && !rowShown(findRow(t, was))) || !okTo) e.under = was;
  }
  return true;
}
function applyRows(rows, lc, spec, max, makeId, taken = new Set()) {
  if (!lc || typeof lc !== "object") return rows;
  const removed = new Set(Array.isArray(lc.remove) ? lc.remove : []);
  let out = rows.filter((r) => !(r.revealed && removed.has(r.id)));
  for (const [id, fields] of Object.entries(lc.edit && typeof lc.edit === "object" ? lc.edit : {})) {
    const r = out.find((x) => x.id === id && x.revealed);
    if (r && fields && typeof fields === "object") setRowFields(r, fields, spec, makeId, taken);
  }
  for (const a of Array.isArray(lc.add) ? lc.add : []) {
    if (out.length >= max) break;
    if (!a || typeof a !== "object") continue;
    // The player's id is kept (their next edit may name it) unless any row in the quest already has it.
    let id = typeof a.id === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(a.id) && !taken.has(a.id) && !out.some((x) => x.id === a.id) ? a.id : makeId();
    while (taken.has(id)) id = makeId();
    taken.add(id);
    const r = { ...TPL[spec.tpl](), id, revealed: true };
    setRowFields(r, a, spec, makeId, taken);
    out.push(r);
  }
  if (Array.isArray(lc.order)) {
    // Rows the player named change places among the places they hold; rows they can't see (hidden) stay put.
    const pos = new Map(lc.order.map((id, i) => [id, i]));
    const slots = out.map((r, i) => (pos.has(r.id) ? i : -1)).filter((i) => i >= 0);
    const sorted = slots.map((i) => out[i]).sort((x, y) => pos.get(x.id) - pos.get(y.id));
    out = [...out];
    slots.forEach((at, k) => (out[at] = sorted[k]));
  }
  return out;
}
function setRowFields(r, fields, spec, makeId, taken) {
  for (const f of spec.fields) if (Object.hasOwn(fields, f)) r[f] = partyValue(f, fields[f]);
  if (spec.nested && fields[spec.nested]) r[spec.nested] = applyRows(r[spec.nested] ?? [], fields[spec.nested], STEP_ROWS, PARTY_MAX.steps, makeId, taken);
}

/** Add a Party Journal entry (anyone) or delete one (its author, or the GM). Changes `t` in place; true when it changed. */
function applyQuestNote(t, op, { id = null, by, name = "", text = "", isGM = false } = {}) {
  if (t?.kind !== "quest") return false;
  t.pnotes = Array.isArray(t.pnotes) ? t.pnotes : [];
  if (op === "add") {
    const body = String(text ?? "").trim().slice(0, NOTE_LEN);
    if (!body || (!isGM && !t.revealed) || t.pnotes.length >= NOTE_MAX) return false;
    t.pnotes.push({ id: uid(), by, name: String(name || "?").slice(0, 60), text: body, at: Date.now() });
    return true;
  }
  if (op === "delete") {
    const i = t.pnotes.findIndex((n) => n.id === id && (isGM || n.by === by));
    if (i < 0) return false;
    t.pnotes.splice(i, 1);
    return true;
  }
  return false;
}

const ROW_KIND = { get objectives() {
    return lz("Objective");
  }, get "objectives.steps"() {
    return lz("Step");
  }, get entries() {
    return lz("Clue");
  }, get leads() {
    return lz("Lead");
  }, get rewards() {
    return lz("Reward");
  } };
/** Reveal a found row (findRow's result). A step brings the objective it sits under, since players see nothing of a
 * step under a hidden objective. Returns the lists of what it revealed. */
function revealRow(f) {
  const out = [];
  if (!f?.row) return out;
  if (!f.row.revealed) {
    f.row.revealed = true;
    out.push(f.list);
  }
  if (f.list === "objectives.steps" && f.parent && !f.parent.revealed) {
    f.parent.revealed = true;
    out.push("objectives");
  }
  return out;
}
/** The hidden clues a lead reveals: their rows in the same quest. */
function leadClues(t, lead) {
  return (lead?.clues ?? []).map((id) => findRow(t, id)).filter((f) => f?.list === "entries" && !f.row.revealed).map((f) => f.row);
}
/** What a lead can reveal that players can't see yet: the quest it points to and its clue, each with a key. */
function leadOffers(t, lead) {
  if (!t || !lead) return [];
  const to = Store.data.trackers.find((x) => x.id === lead.to && x.kind === "quest" && !x.revealed);
  return [
    to && { key: "quest", kind: "quest", id: to.id, label: `${lz("TheQuestItPointsTo", { name: to.name })}` },
    ...leadClues(t, lead).map((c) => ({ key: `clue:${c.id}`, kind: "clue", id: c.id, label: lz("ClueLabel", { text: shortText(c.text, 70) || lz("NoText") }) })),
  ].filter(Boolean);
}

/** Reveal the lead offers whose keys were picked, in one save. Returns how many things it revealed, or undefined when it didn't save. */
async function revealLeadOffers(tid, offers, keys, { undo = false } = {}) {
  const pick = offers.filter((o) => keys.includes(o.key));
  if (!pick.length) return 0;
  const n = await mutate((d) => {
    const t = d.trackers.find((x) => x.id === tid);
    if (!t) return undefined;
    let count = 0;
    for (const o of pick) {
      if (o.kind === "quest") {
        const q = d.trackers.find((x) => x.id === o.id && x.kind === "quest");
        if (q && !q.revealed) {
          q.revealed = true;
          count++;
        }
      } else count += revealRow(findRow(t, o.id)).length;
    }
    return count;
  }, { notify: false, undo });
  return n;
}

/** Checkboxes for lead offers, all ticked unless `ticked` is false. */
const offerRows = (offers, ticked = true) => offers.map((o) => `<label class="pct-chk"><input type="checkbox" name="${esc(o.key)}"${ticked ? " checked" : ""}> <span>${esc(o.label)}</span></label>`).join("");

/** The GM's client: ask whether to reveal what a lead points to, when players can't see it yet. */
async function offerLead(tid, leadId, { undo = false } = {}) {
  const t = Store.get(tid);
  const offers = leadOffers(t, (t?.leads ?? []).find((l) => l.id === leadId));
  if (!offers.length) return;
  const keys = await foundry.applications.api.DialogV2.wait({
    window: { title: lz("Lead") },
    content: `<p>${offers.length === 1 ? lz("PlayersCanTSeeThisYet") : lz("PlayersCanTSeeTheseYet")}</p><div class="pct-rl-rows">${offerRows(offers)}</div>`,
    buttons: [
      { action: "reveal", label: lz("Reveal"), icon: "fa-solid fa-eye", default: true, callback: (ev, button) => offers.filter((o) => button.form.elements.namedItem(o.key)?.checked).map((o) => o.key) },
      { action: "cancel", label: lz("NotNow") },
    ],
    rejectClose: false,
  });
  if (Array.isArray(keys)) await revealLeadOffers(tid, offers, keys, { undo });
}

/** Does a found row show to players? A step only with its objective. */
const rowShown = (f) => !!f?.row?.revealed && (f.list !== "objectives.steps" || !!f.parent?.revealed);
/** "Step: Get disguises", plus ", and the objective it sits under (...)" when revealing it would bring that too. */
function revealLabel(t, f) {
  const base = rowLabel(t, f.row.id);
  return f.list === "objectives.steps" && f.parent && !f.parent.revealed ? `${lz("AndTheObjectiveItSitsUnder", { base: base })}${shortText(f.parent.text, 50) || lz("NoText2")})` : base;
}

/** A row of a quest named for the GM: "Step: Get disguises". */
function rowLabel(t, id) {
  const f = findRow(t, id);
  if (!f) return null;
  return `${ROW_KIND[f.list] ?? lz("Item")}: ${shortText(f.row.text, 70) || lz("NoText")}`;
}

/**
 * What finishing a goal offers the GM: the hidden rows it was set to reveal, and the objective it
 * completes when it was the step that made the steps add up.
 */
function completionOffers(t, goalId) {
  const found = findGoal(t, goalId);
  if (!found) return { reveal: [], parent: null };
  const reveal = (found.g.onDone ?? []).filter((id) => {
    const f = findRow(t, id);
    return f && !rowShown(f);
  });
  const parent = found.parent && found.parent.state === "open" && stepProgress(found.parent).complete ? found.parent.id : null;
  return { reveal, parent };
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
    const range = lo === null && hi === null ? lz("Any") : lo === null ? `${lz("OrLower", { hi: hi })}` : hi === null ? `${lz("OrHigher", { lo: lo })}` : lo === hi ? `${lo}` : lz("RangeTo", { lo, hi });
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

/**
 * A path drawn into the window ("objectives.2.steps.1.text") made right for the tracker as it is now. Each list position
 * is followed through the id of the row that was drawn there, so an edit made while the view was behind (a party
 * member's edit, another GM tab, a preset reload) lands on the same row, or nowhere (null) when that row is gone. A
 * list whose rows have no ids (a clock's segments) keeps its positions only while its length is unchanged. With
 * nothing drawn to compare, the path is used as it is.
 */
function remapPath(drawn, live, path) {
  if (!drawn || !live || typeof path !== "string") return path;
  const out = [];
  let a = drawn;
  let b = live;
  for (const seg of path.split(".")) {
    if (Array.isArray(a) && /^\d+$/.test(seg)) {
      if (!Array.isArray(b)) return null;
      const row = a[Number(seg)];
      if (row && typeof row === "object" && typeof row.id === "string" && row.id) {
        const j = b.findIndex((x) => x?.id === row.id);
        if (j < 0) return null;
        out.push(String(j));
        a = row;
        b = b[j];
        continue;
      }
      if (a.length !== b.length) return null;
      out.push(seg);
      a = row;
      b = b[Number(seg)];
      continue;
    }
    out.push(seg);
    a = a?.[seg];
    b = b?.[seg];
  }
  return out.join(".");
}

/** Infiltration points the party has earned across all obstacles. */
/**
 * Has the party overcome an infiltration obstacle? A group obstacle when its progress reaches its points; one each
 * character overcomes alone when every party member has (with no party known, everyone who has rolled at it).
 */
function obstacleOvercome(o, pcs = []) {
  const need = num(o.points);
  if (need <= 0) return false;
  if (o.type !== "individual") return num(o.progress) >= need;
  const by = o.byActor ?? {};
  if (pcs.length) return pcs.every((pc) => num(by[pc.id]) >= need);
  const got = Object.values(by);
  return got.length > 0 && got.every((v) => num(v) >= need);
}
/** How many of an infiltration's obstacles (or of `list`) the party has overcome: { done, of }. */
function infiltrationProgress(t, pcs = [], list = t.obstacles ?? []) {
  return { done: list.filter((o) => obstacleOvercome(o, pcs)).length, of: list.length };
}
/** The party's characters, or none outside Foundry (the node tests). */
function livePCs() {
  try {
    return partyMembers();
  } catch {
    return [];
  }
}

/** Infiltration points earned across the obstacles (the GM's optional goal counts these). */
function infiltrationIP(t) {
  let total = 0;
  for (const o of t.obstacles ?? []) {
    if (o.type === "individual") total += Object.values(o.byActor ?? {}).reduce((s, v) => s + num(v), 0);
    else total += num(o.progress);
  }
  return total;
}

/** Where a skill challenge stands: "won", "lost", "time" (out of rounds) or "" while it runs. */
function challengeStatus(t) {
  const goal = nullNum(t.goal), limit = nullNum(t.limit), rounds = nullNum(t.rounds);
  if (goal !== null && goal > 0 && num(t.successes) >= goal) return "won";
  if (limit !== null && limit > 0 && num(t.failures) >= limit) return "lost";
  if (rounds !== null && rounds > 0 && num(t.round) > rounds) return "time";
  return "";
}
const STATUS_TEXT = { get won() {
    return lz("Succeeded");
  }, get lost() {
    return lz("Failed");
  }, get time() {
    return lz("OutOfTime");
  } };

/** A one-line summary for the card header. */
function summary(t) {
  switch (t.kind) {
    case "quest":
      return questSummary(t);
    case "challenge": {
      const goal = nullNum(t.goal), limit = nullNum(t.limit), st = challengeStatus(t);
      return `${lz("ChallengeSummary", { s: goal ? lz("NOfMax", { n: num(t.successes), max: goal }) : num(t.successes), f: limit ? lz("NOfMax", { n: num(t.failures), max: limit }) : num(t.failures) })}${st ? `. ${STATUS_TEXT[st]}` : ""}`;
    }
    case "reputation": {
      const tier = currentTier(t);
      return `${tier?.label ?? lz("NoTiers")} (${signed(num(t.value))})`;
    }
    case "pressure": {
      const tier = currentTier(t);
      return `${tier?.label ?? lz("NoBands")} (${nullNum(t.max) !== null ? lz("XOfY", { x: num(t.value), y: t.max }) : num(t.value)})`;
    }
    case "points":
      return t.max !== null && t.max !== undefined && t.max !== "" ? `${num(t.value)} / ${t.max}` : `${num(t.value)}`;
    case "influence":
      return `${lz("InfluenceRoundOf", { value: num(t.value), roundsUsed: num(t.roundsUsed), rounds: num(t.rounds) })}`;
    case "research":
      return `${lz("ResearchPoints", { value: num(t.value) })}`;
    case "chase": {
      const n = t.obstacles?.length ?? 0;
      const at = num(t.current);
      return at >= n ? `${lz("DoneRound", { round: num(t.round) })}` : `${lz("ObstacleOfRound", { x: at + 1, n: n, round: num(t.round) })}`;
    }
    case "infiltration":
      {
        const p = infiltrationProgress(t, livePCs());
        return `${lz("OfObstaclesOvercome2", { done: p.done, of: p.of })} ${infiltrationIP(t)} ${lz("IPAwarenessRound", { awareness: num(t.awareness), round: num(t.round) })}`;
      }
    case "clock": {
      const segs = t.segments ?? [];
      return `${segs.filter((s) => s.state === "filled").length} / ${segs.length}`;
    }
    case "checklist": {
      const e = t.entries ?? [];
      return `${e.filter((x) => x.done).length} ${lz("OfDone", { length: e.length })}`;
    }
  }
  return "";
}

/**
 * Find a row anywhere in a tracker by id: { row, list, path, parent }, where list is the generic path
 * ("objectives.steps").
 */
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
  if (/\.have$/.test(path)) return [0, nullNum(foundry.utils.getProperty(t, path.replace(/\.have$/, ""))?.count)];
  return [0, null];
}


export { TPL, LISTS, tplFor, PRESSURE_BANDS, noPoints, noInfiltrationPoints, blank, normalize, fillRow, QSTATUS, QSTATUS_LABEL, QGROUPS, GOAL_STATES, fixGoal, LINK_CONDS, linkCond, linkState, linkTriggers, linkWhy, OPEN_Q, stepProgress, findGoal, applyQuestTick, applyLeadFollow, applyClueSort, NOTE_MAX, NOTE_LEN, PARTY_FIELDS, STEP_ROWS, PARTY_ROWS, PARTY_MAX, PARTY_PER_PLAYER, PARTY_QUEST_SIZE, questIds, same, partyChanges, rowChanges, partyValue, applyPartyChanges, applyRows, setRowFields, applyQuestNote, ROW_KIND, revealRow, leadClues, leadOffers, revealLeadOffers, offerRows, offerLead, rowShown, revealLabel, rowLabel, completionOffers, clamp, nullNum, tierLadder, currentTier, reached, remapPath, obstacleOvercome, infiltrationProgress, livePCs, infiltrationIP, challengeStatus, STATUS_TEXT, summary, findRow, bounds };
