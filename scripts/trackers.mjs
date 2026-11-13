/**
 * PF2e Campaign Trackers
 * A quest log, GM Core's subsystems and a few table-neutral trackers in one window: Quests, Reputation,
 * Pressure, Victory Points, Skill Challenges, Influence, Research, Chases, Infiltration, Clocks and Checklists.
 *
 * Everything is hidden from players until the GM reveals it. The full data lives in a journal entry
 * that only GMs can see; players get a copy of what has been revealed, kept in a world setting.
 * Subsystem checks are rolled through the PF2e system with a tag, and the GM applies the result
 * from the roll card. Dates on clocks, checklists and quests send the GM a whisper when the calendar
 * reaches them. Players' quest ticks, notes and party quest edits reach the active GM through the
 * module socket. Campaign content can be shipped by another module as a preset.
 */

const MOD = "pf2e-campaign-trackers";
/** Flag scope for the data journal and chat cards. */
const SCOPE = MOD;

const KINDS = ["quest", "reputation", "pressure", "points", "challenge", "influence", "research", "chase", "infiltration", "clock", "checklist"];
const KIND_INFO = {
  quest: { label: "Quest", tab: "Quests", icon: "fa-solid fa-scroll", blurb: "The party's quests and leads: objectives with steps, clues, leads to other quests and rewards, each revealed when you choose." },
  reputation: { label: "Reputation", tab: "Reputation", icon: "fa-solid fa-scale-balanced", blurb: "How a group regards the party, in named tiers. GM Core's Reputation subsystem, or your own tiers." },
  pressure: { label: "Pressure track", tab: "Pressure", icon: "fa-solid fa-gauge-high", blurb: "Something building against the party, in named bands: heat, alarm, suspicion, doom. You move it by judgment; it has no checks." },
  points: { label: "Victory Points", tab: "Victory Points", icon: "fa-solid fa-flag-checkered", blurb: "Progress the party earns with checks toward a goal, with thresholds along the way." },
  challenge: { label: "Skill challenge", tab: "Skill Challenges", icon: "fa-solid fa-route", blurb: "A goal the party reaches with a number of successes before too many failures. List the approaches you expect, each with a spoiler-free name for players, and approve the ones they think of." },
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
/** What each result adds to a skill challenge: s successes and f failures. */
const CDEG = () => ({ criticalSuccess: { s: 2, f: 0 }, success: { s: 1, f: 0 }, failure: { s: 0, f: 1 }, criticalFailure: { s: 0, f: 1 } });

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
/** Plain text with line breaks kept. */
const para = (s) => esc(s).replace(/\n/g, "<br>");
const uid = () => foundry.utils.randomID(10).toLowerCase();
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const num = (v, d = 0) => (Number.isFinite(Number(v)) && v !== "" && v !== null ? Number(v) : d);
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
/* Foundry's active GM is a user, not a browser tab, so the same GM in two tabs would answer every request twice.
 * Each GM tab gets an id and tells the others about itself; only the tab with the lowest id among the active GM's
 * live tabs acts. */
const CLIENT_ID = globalThis.foundry?.utils?.randomID?.(16) ?? Math.random().toString(36).slice(2, 18);
const gmTabs = new Map();
/* A hidden tab's timers can slow to about once a minute, so a tab is forgotten only after 150 s without a word, and
 * each tab answers an announcement from a tab with a higher id (socket messages aren't slowed), so the lead stays
 * known while it lives. */
const TAB_TTL = 150000;
let lastAnswer = 0;
function leadTab() {
  const now = Date.now();
  for (const [id, seen] of gmTabs) if (now - seen > TAB_TTL) gmTabs.delete(id);
  return [...gmTabs.keys()].every((id) => CLIENT_ID < id);
}
const isPrimaryGM = () => game.user.isGM && game.users.activeGM?.id === game.user.id && leadTab();
function announceTab(hello = false) {
  if (game.user.isGM) game.socket.emit(SOCKET, { type: "gmtab", client: CLIENT_ID, hello });
}

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
  approach: () => ({ id: uid(), label: "", gm: "", critFail: "", uses: null, used: 0, checks: [], revealed: false }),
  adhoc: () => ({ id: uid(), skill: "", dc: null, label: "", approach: null }),
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
    case "quest":
      return { ...base, status: "active", category: "Main", focus: false, party: null, img: "", giver: null, giverText: "", location: "", deadline: null, showDue: true, reminded: null, objectives: [], entries: [], leads: [], rewards: [], pnotes: [] };
    case "reputation":
      return { ...base, value: 0, min: -50, max: 50, showValue: true, steps: [1, 2, 5], tiers: GMCORE_TIERS() };
    case "pressure":
      return { ...base, value: 0, min: 0, max: 10, showValue: false, halve: true, steps: [1], tiers: PRESSURE_BANDS(), thresholds: [] };
    case "points":
      return { ...base, value: 0, min: 0, max: 10, showValue: true, halve: false, thresholds: [], checks: [], degrees: DEG() };
    case "challenge":
      return { ...base, successes: 0, failures: 0, goal: 4, limit: 3, rounds: null, round: 1, showCount: true, explain: true, oncePerRound: false, degrees: CDEG(), onSuccess: "", onFailure: "", thresholds: [], approaches: [], log: [] };
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
  if (kind === "challenge") {
    const raw = t.degrees ?? {};
    t.degrees = Object.fromEntries(Object.entries(CDEG()).map(([d, def]) => [d, { s: num(raw[d]?.s, def.s), f: num(raw[d]?.f, def.f) }]));
    t.log = Array.isArray(t.log) ? t.log : [];
  } else if (t.degrees) t.degrees = { ...DEG(), ...t.degrees };
  if (kind === "chase") t.quarry = { enabled: true, label: "Quarry", at: 1, ...(t.quarry ?? {}) };
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
const QSTATUS_LABEL = { active: "Active", lead: "Lead", completed: "Completed", failed: "Failed" };
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
  clock: [["full", "is full"]],
  challenge: [["won", "succeeds"], ["lost", "fails"]],
  points: [["atLeast", "reaches"]],
  research: [["atLeast", "reaches"]],
  influence: [["atLeast", "reaches"]],
  reputation: [["atLeast", "reaches"]],
  pressure: [["atLeast", "reaches"]],
  checklist: [["entry", "has ticked"]],
  chase: [["through", "is won (the party gets through)"]],
  infiltration: [["objective", "reaches its objective"]],
};
const linkCond = (link, t) => (LINK_CONDS[t?.kind] ?? []).some(([c]) => c === link?.cond) ? link.cond : LINK_CONDS[t?.kind]?.[0]?.[0] ?? null;

/** Whether a linked tracker has reached what the goal watches, and how far along it is. */
function linkState(link, trackers) {
  const t = link?.tid ? (trackers ?? []).find((x) => x.id === link.tid) : null;
  if (!t) return { met: false, text: link?.tid ? "linked tracker is gone" : "", name: "" };
  const cond = linkCond(link, t);
  const name = t.name;
  switch (cond) {
    case "full": {
      const n = t.segments?.length ?? 0, f = (t.segments ?? []).filter((x) => x.state === "filled").length;
      return { met: n > 0 && f >= n, text: `${f} of ${n}`, name };
    }
    case "won":
    case "lost":
      return { met: challengeStatus(t) === cond, text: `${num(t.successes)} S, ${num(t.failures)} F`, name };
    case "atLeast": {
      const at = nullNum(link.at);
      return { met: at !== null && num(t.value) >= at, text: `${num(t.value)}${at !== null ? ` of ${at}` : ""}`, name };
    }
    case "entry": {
      const e = (t.entries ?? []).find((x) => x.id === link.entry);
      return { met: !!e?.done, text: e ? `${shortText(e.label, 40)}: ${e.done ? "ticked" : "not yet"}` : "pick an entry", name };
    }
    case "through": {
      const n = t.obstacles?.length ?? 0;
      return { met: n > 0 && num(t.current) >= n, text: `obstacle ${Math.min(num(t.current) + 1, n)} of ${n}`, name };
    }
    case "objective": {
      const goal = num(t.objective);
      return { met: goal > 0 && infiltrationIP(t) >= goal, text: `${infiltrationIP(t)} of ${goal || "?"} IP`, name };
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
  return { full: "is full", won: "succeeded", lost: "failed", through: "was won", objective: "reached its objective" }[cond] ?? "changed";
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
  const date = () => (v && typeof v === "object" && [v.y, v.m, v.d].every(Number.isFinite) ? { y: Math.trunc(v.y), m: Math.trunc(v.m), d: Math.trunc(v.d) } : null);
  switch (f) {
    case "name": return text(120).trim() || "Untitled quest";
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

const ROW_KIND = { objectives: "Objective", "objectives.steps": "Step", entries: "Clue", leads: "Lead", rewards: "Reward" };
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
    to && { key: "quest", kind: "quest", id: to.id, label: `The quest it points to, ${to.name}` },
    ...leadClues(t, lead).map((c) => ({ key: `clue:${c.id}`, kind: "clue", id: c.id, label: `Clue: ${shortText(c.text, 70) || "(no text)"}` })),
  ].filter(Boolean);
}

/** Reveal the lead offers whose keys were picked, in one save. Returns how many things it revealed, or undefined when it didn't save. */
async function revealLeadOffers(tid, offers, keys) {
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
  }, { notify: false });
  return n;
}

/** Checkboxes for lead offers, all ticked unless `ticked` is false. */
const offerRows = (offers, ticked = true) => offers.map((o) => `<label class="pct-chk"><input type="checkbox" name="${esc(o.key)}"${ticked ? " checked" : ""}> <span>${esc(o.label)}</span></label>`).join("");

/** The GM's client: ask whether to reveal what a lead points to, when players can't see it yet. */
async function offerLead(tid, leadId) {
  const t = Store.get(tid);
  const offers = leadOffers(t, (t?.leads ?? []).find((l) => l.id === leadId));
  if (!offers.length) return;
  const keys = await foundry.applications.api.DialogV2.wait({
    window: { title: "Lead" },
    content: `<p>${offers.length === 1 ? "Players can't see this yet. Reveal it too?" : "Players can't see these yet. Reveal them too?"}</p><div class="pct-rl-rows">${offerRows(offers)}</div>`,
    buttons: [
      { action: "reveal", label: "Reveal", icon: "fa-solid fa-eye", default: true, callback: (ev, button) => offers.filter((o) => button.form.elements.namedItem(o.key)?.checked).map((o) => o.key) },
      { action: "cancel", label: "Not now" },
    ],
    rejectClose: false,
  });
  if (Array.isArray(keys)) await revealLeadOffers(tid, offers, keys);
}

/** Does a found row show to players? A step only with its objective. */
const rowShown = (f) => !!f?.row?.revealed && (f.list !== "objectives.steps" || !!f.parent?.revealed);
/** "Step: Get disguises", plus ", and the objective it sits under (...)" when revealing it would bring that too. */
function revealLabel(t, f) {
  const base = rowLabel(t, f.row.id);
  return f.list === "objectives.steps" && f.parent && !f.parent.revealed ? `${base}, and the objective it sits under (${shortText(f.parent.text, 50) || "no text"})` : base;
}

/** A row of a quest named for the GM: "Step: Get disguises". */
function rowLabel(t, id) {
  const f = findRow(t, id);
  if (!f) return null;
  return `${ROW_KIND[f.list] ?? "Item"}: ${shortText(f.row.text, 70) || "(no text)"}`;
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

/** A short fingerprint of what players see of a quest, to tell when it changed. */
function questHash(p) {
  const { pnotes, focus, ...rest } = p ?? {};
  const str = JSON.stringify(rest);
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** What each quest looked like when this player last opened it, kept in this browser. */
const SEEN_KEY = `${MOD}.seen`;
let seenCache = null;
function seenMap() {
  if (seenCache) return seenCache;
  try {
    seenCache = JSON.parse(localStorage.getItem(SEEN_KEY)) ?? {};
  } catch {
    seenCache = {};
  }
  return seenCache;
}
/** "new" for a quest this player has never opened, "updated" if it changed since, else "". */
function unseen(q) {
  const was = seenMap()[q.id];
  return was === undefined ? "new" : was !== questHash(q) ? "updated" : "";
}
function markSeen(q) {
  const map = seenMap();
  const h = questHash(q);
  if (map[q.id] === h) return false;
  map[q.id] = h;
  changedSoon();
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(map));
  } catch {
    /* no storage: markers come back next time */
  }
  return true;
}

/** The quests as players last saw them in the shared copy, to say what changed when it changes. */
let lastQuests = null;
const questsOf = (pub) => new Map((pub?.trackers ?? []).filter((t) => t.kind === "quest").map((t) => [t.id, t]));

/** Goals this player ticked or unticked, by quest, until the shared copy next changes that quest. */
const ownTicks = new Map();
/** A player asks the GM to tick a goal, remembering it so their own tick brings no notice. */
function tickToGM(tid, goal, to) {
  if (!sendToGM({ type: "qtick", tid, goal, to })) return false;
  if (!ownTicks.has(tid)) ownTicks.set(tid, new Map());
  ownTicks.get(tid).set(goal, { to, at: Date.now() });
  return true;
}
/** A player asks the GM to file a clue under a goal (or nothing), remembered like a tick. */
function sortToGM(tid, clue, under) {
  if (!sendToGM({ type: "qsort", tid, clue, under })) return false;
  if (!ownTicks.has(tid)) ownTicks.set(tid, new Map());
  ownTicks.get(tid).set(clue, { to: under, at: Date.now() });
  return true;
}
/** A player asks the GM to mark a lead followed or not, remembered like a tick. */
function followToGM(tid, lead, to) {
  if (!sendToGM({ type: "qfollow", tid, lead, to })) return false;
  if (!ownTicks.has(tid)) ownTicks.set(tid, new Map());
  ownTicks.get(tid).set(lead, { to, at: Date.now() });
  return true;
}
/** True when the only change from `old` to `q` is in goals this player ticked, leads they followed or clues they filed. */
function onlyOwnTicks(old, q) {
  const mine = ownTicks.get(q.id);
  if (!mine?.size) return false;
  const copy = structuredClone(old);
  for (const o of copy.objectives ?? []) {
    for (const g of [o, ...(o.steps ?? [])]) {
      const asked = mine.get(g.id);
      const now = asked && Date.now() - asked.at < 15000 ? findGoal(q, g.id)?.g : null;
      if (now && now.state === asked.to) Object.assign(g, { state: now.state, doneBy: now.doneBy });
    }
  }
  for (const e of copy.entries ?? []) {
    const asked = mine.get(e.id);
    const now = asked && Date.now() - asked.at < 15000 ? (q.entries ?? []).find((x) => x.id === e.id) : null;
    if (now && (now.under ?? "") === asked.to) {
      if (now.under) e.under = now.under;
      else delete e.under;
    }
  }
  for (const l of copy.leads ?? []) {
    const asked = mine.get(l.id);
    const now = asked && Date.now() - asked.at < 15000 ? (q.leads ?? []).find((x) => x.id === l.id) : null;
    if (now && !!now.followed === (asked.to === "done")) {
      if (now.followed) Object.assign(l, { followed: now.followed, followedBy: now.followedBy });
      else {
        delete l.followed;
        delete l.followedBy;
      }
    }
  }
  return questHash(copy) === questHash(q);
}

/** A player's client: a short notice (and the GM's sound, if set) for each quest that appeared or changed. */
function questNotices(pub) {
  if (game.user.isGM) return;
  if (!game.settings.get(MOD, "playerAccess")) {
    lastQuests = questsOf(pub);
    return;
  }
  const now = questsOf(pub);
  const before = lastQuests;
  lastQuests = now;
  if (!before) return;
  const lines = [];
  for (const [id, q] of now) {
    const old = before.get(id);
    if (!old) {
      // A party quest is news to the rest of the party, not to the player who made it.
      if (!q.party) lines.push(`New quest: ${esc(q.name)}`);
      else if (q.party.by !== game.user.id) lines.push(`New quest from ${esc(q.party.name || "the party")}: ${esc(q.name)}`);
    } else if (old.status !== q.status && (q.status === "completed" || q.status === "failed")) lines.push(`Quest ${q.status}: ${esc(q.name)}`);
    else if (old.party && !q.party) lines.push(`The GM took over ${esc(q.name)}`);
    else if (questHash(old) !== questHash(q) && q.party) {
      // The party edits its own quests a lot: an Updated mark, no notice; nothing at all for this player's own edit.
      const mine = Date.now() - (ownEdits.get(id) ?? 0) < 15000 || onlyOwnTicks(old, q);
      if (mine && seenMap()[id] === questHash(old)) markSeen(q);
      ownTicks.delete(id);
    } else if (questHash(old) !== questHash(q)) {
      if (!onlyOwnTicks(old, q)) lines.push(`Quest updated: ${esc(q.name)}`);
      // Their own tick doesn't make the quest new to them either.
      else if (seenMap()[id] === questHash(old)) markSeen(q);
      ownTicks.delete(id);
    }
    if (old && q.focus && !old.focus && ["active", "lead"].includes(q.status)) lines.push(`Party focus: ${esc(q.name)}`);
    if (old) {
      const had = new Set((old.pnotes ?? []).map((x) => x.id));
      const added = (q.pnotes ?? []).filter((x) => !had.has(x.id) && x.by !== game.user.id);
      if (added.length) lines.push(`${esc(added.at(-1).name)} wrote in the Party Journal of ${esc(q.name)}`);
    }
  }
  if (!lines.length) return;
  for (const l of lines.slice(0, 3)) ui.notifications.info(l);
  if (lines.length > 3) ui.notifications.info(`${lines.length - 3} more quests changed.`);
  const src = game.settings.get(MOD, "questSound");
  if (src) foundry.audio.AudioHelper.play({ src, volume: 0.6, autoplay: true, loop: false }, false);
}

const SOCKET = `module.${MOD}`;
/** The drag data type of a clue dragged within the window. */
const CLUE_DRAG = "application/x-pct-clue";

/**
 * A player's request to the active GM (ticks, Party Journal entries, party quests). False when no GM is logged in.
 */
function sendToGM(msg) {
  if (!game.users.activeGM) {
    ui.notifications.warn("A GM needs to be logged in for that.");
    return false;
  }
  game.socket.emit(SOCKET, { ...msg, userId: game.user.id });
  return true;
}

const lastNoteAt = new Map();
const partyRate = new Map();
const markRate = new Map();
/**
 * Module socket messages: GM tabs announcing themselves, the GM's answers to a player, and players' requests, which
 * the lead tab of the active GM handles. Foundry gives the sender's user id with each message, so a player can't speak
 * for someone else.
 */
async function onSocket(msg, senderId) {
  if (!msg?.type) return;
  const sender = game.users.get(senderId);
  if (msg.type === "gmtab" || msg.type === "gmbye") {
    if (!game.user.isGM || sender?.id !== game.user.id || typeof msg.client !== "string") return;
    if (msg.type === "gmbye") gmTabs.delete(msg.client);
    else {
      gmTabs.set(msg.client, Date.now());
      if (msg.hello || (msg.client > CLIENT_ID && Date.now() - lastAnswer > 5000)) {
        lastAnswer = Date.now();
        announceTab(false);
      }
    }
    return;
  }
  // The GM's client answers a player: a request it couldn't record, or the quest it made for them.
  if (msg.type === "qfail" || msg.type === "qmade") {
    if (!sender?.isGM || msg.to !== game.user.id) return;
    if (msg.type === "qfail") ui.notifications.warn(String(msg.text ?? "That didn't go through."));
    else openQuestWhenShared(msg.tid);
    return;
  }
  if (!isPrimaryGM()) return;
  const user = sender;
  if (!user || user.isGM || (msg.userId && msg.userId !== user.id)) return;
  const fail = (text) => game.socket.emit(SOCKET, { type: "qfail", to: user.id, text });
  if (!["qtick", "qfollow", "qsort", "qnote", "qnoteDel", "qnew", "qedit", "qdel"].includes(msg.type)) return;
  if (!storeReady || Store.broken) return fail("The GM's trackers aren't ready yet. Try again in a moment.");
  if (!game.settings.get(MOD, "playerAccess")) return;
  const who = user.character ? pcName(user.character) : user.name;
  if (["qnew", "qedit", "qdel"].includes(msg.type)) return partyRequest(msg, user, who, fail);
  if (["qtick", "qfollow", "qsort"].includes(msg.type)) {
    // Ticks, follows and filing are quick to click; a flood isn't.
    const now = Date.now();
    const recent = (markRate.get(user.id) ?? []).filter((at) => now - at < 5000);
    if (recent.length >= 20) return fail("That's a lot of changes at once. Wait a moment and try again.");
    markRate.set(user.id, [...recent, now]);
  }
  if (msg.type === "qtick") {
    const party = partyTicks(Store.get(msg.tid));
    if (!game.settings.get(MOD, "playerTicks") && !party) return;
    if (!applyQuestTick(clone(Store.get(msg.tid)), msg.goal, msg.to, user.id)) {
      const cur = Store.get(msg.tid);
      if (!cur || findGoal(cur, msg.goal)?.g.state !== msg.to) fail("That tick didn't go through. It may have changed in the meantime; look again.");
      return;
    }
    const done = await mutateTracker(msg.tid, (t) => applyQuestTick(t, msg.goal, msg.to, user.id) || undefined, { notify: false });
    if (done && msg.to === "done" && !party) await promptCompletion(Store.get(msg.tid), msg.goal, { who });
    else if (!done) {
      const cur = Store.get(msg.tid);
      if (!cur || findGoal(cur, msg.goal)?.g.state !== msg.to) fail("That tick didn't go through. It may have changed in the meantime; look again.");
    }
  } else if (msg.type === "qfollow") {
    const party = partyTicks(Store.get(msg.tid));
    if (!game.settings.get(MOD, "playerTicks") && !party) return;
    const leadNow = () => (Store.get(msg.tid)?.leads ?? []).find((x) => x.id === msg.lead);
    if (!applyLeadFollow(clone(Store.get(msg.tid)), msg.lead, msg.to, user.id)) {
      if (!leadNow() || leadNow().followed !== (msg.to === "done")) fail("That didn't go through. It may have changed in the meantime; look again.");
      return;
    }
    const done = await mutateTracker(msg.tid, (t) => applyLeadFollow(t, msg.lead, msg.to, user.id) || undefined, { notify: false });
    if (done && msg.to === "done" && !party) await promptFollow(Store.get(msg.tid), msg.lead, who);
    else if (!done) {
      const l = (Store.get(msg.tid)?.leads ?? []).find((x) => x.id === msg.lead);
      if (!l || l.followed !== (msg.to === "done")) fail("That didn't go through. It may have changed in the meantime; look again.");
    }
  } else if (msg.type === "qsort") {
    const party = partyTicks(Store.get(msg.tid));
    if (!game.settings.get(MOD, "playerTicks") && !party) return;
    const under = typeof msg.under === "string" ? msg.under : "";
    if (!applyClueSort(clone(Store.get(msg.tid)), msg.clue, under)) {
      const e = (Store.get(msg.tid)?.entries ?? []).find((x) => x.id === msg.clue);
      if (!e || (e.under ?? "") !== under) fail("That didn't go through. It may have changed in the meantime; look again.");
      return;
    }
    const done = await mutateTracker(msg.tid, (t) => applyClueSort(t, msg.clue, under) || undefined, { notify: false });
    if (!done) {
      const e = (Store.get(msg.tid)?.entries ?? []).find((x) => x.id === msg.clue);
      if (!e || (e.under ?? "") !== under) fail("That didn't go through. It may have changed in the meantime; look again.");
    }
  } else if (msg.type === "qnote") {
    const now = Date.now();
    if (now - (lastNoteAt.get(user.id) ?? 0) < 2000) return fail("One entry at a time, please. Try again in a moment.");
    lastNoteAt.set(user.id, now);
    const t = Store.get(msg.tid);
    if ((t?.pnotes?.length ?? 0) >= NOTE_MAX) return fail(`The Party Journal of ${esc(t.name)} has ${NOTE_MAX} entries, the most it holds. Delete some first.`);
    const added = await mutateTracker(msg.tid, (tr) => applyQuestNote(tr, "add", { by: user.id, name: who, text: msg.text }) || undefined, { notify: false });
    if (!added) fail("Your entry didn't go through. Try again.");
  } else if (msg.type === "qnoteDel") {
    await mutateTracker(msg.tid, (t) => applyQuestNote(t, "delete", { id: msg.note, by: user.id }) || undefined, { notify: false });
  }
}

/** The GM's client: a player makes, edits or deletes a party quest. */
async function partyRequest(msg, user, who, fail) {
  if (!game.settings.get(MOD, "partyQuests")) return fail("The GM has turned off quests made by players.");
  // A burst of edits is fine; a flood isn't.
  const now = Date.now();
  const recent = (partyRate.get(user.id) ?? []).filter((t) => now - t < 5000);
  if (recent.length >= 30) return fail("That's a lot of changes at once. Wait a moment and try again.");
  partyRate.set(user.id, [...recent, now]);
  if (msg.type === "qnew") {
    const party = Store.data.trackers.filter((t) => t.kind === "quest" && t.party);
    if (party.length >= 100) return fail("There are already 100 party quests. Delete some first.");
    if (party.filter((t) => t.party.by === user.id).length >= PARTY_PER_PLAYER) return fail(`You've made ${PARTY_PER_PLAYER} party quests, the most one player can. Delete one first, or ask the GM.`);
    const t = { ...blank("quest", partyValue("name", msg.name)), revealed: true, category: "", desc: partyValue("desc", msg.desc), party: { by: user.id, name: who } };
    const made = await mutate((d) => {
      d.trackers.push(t);
      return true;
    }, { notify: false });
    if (made) game.socket.emit(SOCKET, { type: "qmade", to: user.id, tid: t.id });
    else fail("The quest wasn't made. Try again.");
  } else if (msg.type === "qedit") {
    const cur = Store.get(msg.tid);
    if (!cur?.party || !cur.revealed) return fail("Only quests made by players can be edited by players.");
    // Try it on a copy first: nothing to save when nothing changed, and no edit may make a quest too long.
    const test = clone(cur);
    try {
      applyPartyChanges(test, msg.changes);
    } catch (err) {
      console.warn(`${MOD} | a party quest edit couldn't be read`, err);
      return fail("Your change couldn't be read. Try again.");
    }
    if (same(test, cur)) return;
    const size = JSON.stringify(test).length;
    if (size > PARTY_QUEST_SIZE && size > JSON.stringify(cur).length) return fail(`That would make ${esc(cur.name)} too long. Shorten or remove something first.`);
    const done = await mutateTracker(msg.tid, (t) => applyPartyChanges(t, msg.changes) || undefined, { notify: false });
    if (!done) fail("Your change didn't go through. Try again.");
  } else if (msg.type === "qdel") {
    const t = Store.get(msg.tid);
    if (!t?.party || !t.revealed || t.party.by !== user.id) return fail("Only the player who made a party quest, or the GM, can delete it.");
    await mutate((d) => {
      d.trackers = d.trackers.filter((x) => x.id !== t.id);
    }, { notify: false });
  }
}

/** A player's new quest: open it, ready to add objectives, once the shared copy has it. */
function openQuestWhenShared(tid, tries = 0) {
  if (!visibleTrackers().some((t) => t.id === tid)) {
    if (tries < 15) setTimeout(() => openQuestWhenShared(tid, tries + 1), 200);
    return;
  }
  openQuest(tid, "objectives");
}

/** One line on a quest for the card header: its status and how its objectives stand. */
function questSummary(t) {
  const main = t.objectives.filter((o) => !o.optional);
  const done = main.filter((o) => o.state === "done").length;
  const parts = [QSTATUS_LABEL[t.status] ?? "Active"];
  if (t.category) parts.push(t.category);
  if (main.length) parts.push(`${done} of ${main.length} objectives`);
  return parts.join(", ");
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

/** Where a skill challenge stands: "won", "lost", "time" (out of rounds) or "" while it runs. */
function challengeStatus(t) {
  const goal = nullNum(t.goal), limit = nullNum(t.limit), rounds = nullNum(t.rounds);
  if (goal !== null && goal > 0 && num(t.successes) >= goal) return "won";
  if (limit !== null && limit > 0 && num(t.failures) >= limit) return "lost";
  if (rounds !== null && rounds > 0 && num(t.round) > rounds) return "time";
  return "";
}
const STATUS_TEXT = { won: "Succeeded", lost: "Failed", time: "Out of time" };

/** A one-line summary for the card header. */
function summary(t) {
  switch (t.kind) {
    case "quest":
      return questSummary(t);
    case "challenge": {
      const goal = nullNum(t.goal), limit = nullNum(t.limit), st = challengeStatus(t);
      return `${num(t.successes)}${goal ? ` of ${goal}` : ""} successes, ${num(t.failures)}${limit ? ` of ${limit}` : ""} failures${st ? `. ${STATUS_TEXT[st]}` : ""}`;
    }
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
  if (path === "roundsUsed" && t.kind === "influence") return [0, null];
  if (/\.have$/.test(path)) return [0, nullNum(foundry.utils.getProperty(t, path.replace(/\.have$/, ""))?.count)];
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
    if (!game.user.isGM) return false;
    if (this.writing) {
      this.pending = true;
      return this.writing;
    }
    this.writing = (async () => {
      let ok = false;
      do {
        this.pending = false;
        ok = false;
        try {
          if (this.broken) throw new Error("the stored data couldn't be read; export it, fix it, then import it");
          if (!this.journal || !game.journal.get(this.journal.id)) await this.ensure();
          if (!this.journal) throw new Error("there is no data journal; the active GM creates it on login");
          const stored = this.storedRev();
          if (stored !== null && stored !== this.rev) {
            this.load();
            refresh();
            ui.notifications.warn("Campaign Trackers: another window saved newer data, so this one has reloaded it instead of overwriting. Make your change again.");
            return false;
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
          ok = true;
        } catch (err) {
          console.error(`${MOD} | save failed`, err);
          ui.notifications.error(`Campaign Trackers: couldn't save (${err.message}). The change is only in this window; export your data from the window menu before reloading.`);
          return false;
        }
      } while (this.pending);
      return ok;
    })();
    try {
      return await this.writing;
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
 * Change the data (GM only). fn gets a copy to change and may return a value, which comes back only when the change
 * was saved (undefined otherwise). What notices() finds is whispered to the GM, and goals whose linked tracker just
 * got there get a completion card.
 */
async function mutate(fn, { notify = true } = {}) {
  if (!game.user.isGM) return;
  if (Store.broken) return void ui.notifications.error("Campaign Trackers: the stored data couldn't be read, so nothing can be changed until it's fixed. Export it from the window menu, fix the file, then import it.");
  const before = clone(Store.data);
  const draft = clone(Store.data);
  const result = fn(draft);
  draft.trackers = draft.trackers.map(normalize);
  stampReveals(before, draft);
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
  const saved = await Store.save();
  if (saved) for (const tr of linkTriggers(before, draft)) promptCompletion(Store.get(tr.tid), tr.goal, { why: tr.why });
  return saved ? result : undefined;
}

/** A clue keeps the time it was revealed, so the newest shows first; hiding it clears the time. */
function stampReveals(before, after) {
  const now = Date.now();
  for (const t of after.trackers) {
    if (t.kind !== "quest") continue;
    const old = before.trackers.find((x) => x.id === t.id);
    if (!old) continue;
    for (const e of t.entries) {
      if (!e.revealed) {
        e.revealedAt = null;
        continue;
      }
      const was = (old.entries ?? []).find((x) => x.id === e.id);
      e.revealedAt = was?.revealed ? (was.revealedAt ?? null) : now;
    }
  }
}

const mutateTracker = (id, fn, opts) => (game.user.isGM ? mutate((d) => {
  const t = d.trackers.find((x) => x.id === id);
  return t ? fn(t, d) : undefined;
}, opts) : partyMutate(id, fn));

/** Players may make quests the party edits, when the GM lets players see the trackers at all. */
const partyQuestsOn = () => !!game.settings.get(MOD, "playerAccess") && !!game.settings.get(MOD, "partyQuests");
/** Ticks on a party quest are the party's own: no "Players can tick" needed, and no card for the GM. */
const partyTicks = (q) => !!q?.party && partyQuestsOn();
const canPartyEdit = (t) => !game.user.isGM && t?.kind === "quest" && !!t.party && partyQuestsOn();
/** When this player last sent an edit to each party quest, so their own edit brings no notice. */
const ownEdits = new Map();
/** A player's edit to a party quest: the same editors the GM uses run on the player's copy, and what changed goes
 * to the GM's client. */
function partyMutate(id, fn) {
  const t = visibleTrackers().find((x) => x.id === id);
  if (!canPartyEdit(t)) return undefined;
  const before = clone(t);
  const draft = clone(t);
  const result = fn(draft);
  const changes = partyChanges(before, draft);
  if (!changes) return result;
  if (!sendToGM({ type: "qedit", tid: id, changes })) return undefined;
  ownEdits.set(id, Date.now());
  return result;
}

/**
 * What changed that the GM should hear about: thresholds crossed upward, tier changes, a skill challenge's outcome,
 * chase obstacles cleared and the quarry caught up with.
 */
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
    case "challenge": {
      for (const th of b.thresholds ?? []) {
        if (num(a.successes) < num(th.at) && num(b.successes) >= num(th.at)) out.push(`<strong>${n}</strong> reached ${th.at} ${num(th.at) === 1 ? "success" : "successes"}${th.text ? `: ${para(th.text)}` : "."}`);
      }
      const sa = challengeStatus(a), sb = challengeStatus(b);
      if (sb && sb !== sa) {
        const text = sb === "won" ? b.onSuccess : b.onFailure;
        out.push(`<strong>${n}</strong>: ${sb === "won" ? "the party succeeded" : sb === "lost" ? "the party failed" : "the party ran out of time"}${text ? `. ${para(text)}` : "."}`);
      }
      break;
    }
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
function project(t, { force = false, all = null } = {}) {
  if (!t.revealed && !force) return null;
  const p = { id: t.id, kind: t.kind, name: t.name, desc: t.desc, sort: t.sort };
  switch (t.kind) {
    case "quest": {
      // Only revealed parts, and no GM text. A lead names the quest it points to only once that quest is revealed too.
      const goal = (g) => ({ id: g.id, text: g.text, state: g.state, optional: !!g.optional, count: g.count, have: g.count !== null ? num(g.have) : null, doneBy: g.doneBy === "gm" ? "gm" : g.doneBy ? "player" : null });
      const linked = (id) => (all ?? []).find((x) => x.id === id && x.kind === "quest" && x.revealed);
      return {
        ...p, status: t.status, category: t.category, focus: !!t.focus, img: t.img, party: t.party ? { by: t.party.by, name: t.party.name } : null,
        giver: t.giver ? { name: t.giver.name, img: t.giver.img } : t.giverText ? { name: t.giverText, img: "" } : null,
        location: t.location, deadline: t.showDue !== false ? t.deadline : null, dueHidden: t.party && t.showDue === false ? true : undefined,
        objectives: shown(t.objectives).map((o) => ({ ...goal(o), mode: o.mode, steps: shown(o.steps).map(goal) })),
        entries: shown(t.entries).map((e) => ({ id: e.id, date: e.date, text: e.text, by: e.by || undefined, revealedAt: e.revealedAt ?? undefined, under: e.under && rowShown(findRow(t, e.under)) ? e.under : undefined })),
        leads: shown(t.leads).map((l) => {
          const q = linked(l.to);
          return { id: l.id, text: l.text, to: q ? { id: q.id, name: q.name } : null, followed: l.followed || undefined, followedBy: l.followed ? (l.followedBy === "gm" ? "gm" : "player") : undefined };
        }),
        rewards: shown(t.rewards).map((r) => ({ id: r.id, text: r.text, actor: r.actor ? { uuid: r.actor.uuid, name: r.actor.name, img: r.actor.img } : null })),
        pnotes: (t.pnotes ?? []).map((n) => ({ id: n.id, by: n.by, name: n.name, text: n.text, at: n.at })),
      };
    }
    case "reputation": {
      const tier = currentTier(t);
      return { ...p, value: t.showValue ? num(t.value) : null, tier: tier?.id ?? null, tiers: tierLadder(t).map((x) => ({ id: x.id, label: x.label, range: t.showValue ? x.range : "", text: x.text })) };
    }
    case "pressure": {
      // Players see the band the track is in, never the ladder: the bands above it stay the GM's.
      const tier = tierLadder(t).find((x) => x.id === currentTier(t)?.id) ?? null;
      return { ...p, value: t.showValue ? num(t.value) : null, max: t.showValue ? nullNum(t.max) : null, tier: tier?.id ?? null, tiers: tier ? [{ id: tier.id, label: tier.label, range: t.showValue ? tier.range : "", text: tier.text }] : [], thresholds: reached(shown(t.thresholds), t.value).map(({ at, text, reached: r }) => ({ at: t.showValue ? at : null, text, reached: r })) };
    }
    case "points":
      return { ...p, value: t.showValue ? num(t.value) : null, max: t.showValue ? nullNum(t.max) : null, thresholds: reached(shown(t.thresholds), t.value).map(({ at, text, reached: r }) => ({ at: t.showValue ? at : null, text, reached: r })), checks: shown(t.checks).map(pubCheck) };
    case "challenge": {
      // Players get the approaches by their spoiler-free names. The DC travels with each check so a
      // player's roll can be graded, but nothing in the players' window or cards prints it.
      const show = !!t.showCount;
      return {
        ...p,
        successes: show ? num(t.successes) : null, failures: show ? num(t.failures) : null,
        goal: show ? nullNum(t.goal) : null, limit: show ? nullNum(t.limit) : null,
        round: num(t.round), rounds: nullNum(t.rounds), status: challengeStatus(t), explain: t.explain !== false,
        thresholds: reached(shown(t.thresholds), t.successes).filter((x) => x.reached).map(({ text }) => ({ at: null, text, reached: true })),
        approaches: shown(t.approaches).map((a) => ({
          id: a.id, label: a.label,
          left: nullNum(a.uses) !== null ? Math.max(0, num(a.uses) - num(a.used)) : null,
          checks: a.checks.filter((c) => c.skill).map((c) => ({ id: c.id, skill: c.skill, dc: c.dc, label: "" })),
        })),
      };
    }
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
  const pub = { trackers: data.trackers.map((t) => project(t, { all: data.trackers })).filter(Boolean) };
  const current = game.settings.get(MOD, "public");
  if (JSON.stringify(current) === JSON.stringify(pub)) return;
  await game.settings.set(MOD, "public", pub);
}

/**
 * Trackers as the current user sees them: everything for a GM, the revealed copy for players (and for a GM with
 * asPlayer).
 */
function visibleTrackers({ asPlayer = false } = {}) {
  if (game.user.isGM && !asPlayer) return Store.data.trackers;
  if (game.user.isGM) return Store.data.trackers.map((t) => project(t, { all: Store.data.trackers })).filter(Boolean);
  return game.settings.get(MOD, "public")?.trackers ?? [];
}

/* ------------------------------------------------------------------ */
/* Presets                                                             */
/* ------------------------------------------------------------------ */

const presets = new Map();
let storeReady = false;

/** Fields that belong to play, kept when a preset's text is updated. */
const STATE_KEYS = new Set(["value", "revealed", "round", "current", "awareness", "edge", "roundsUsed", "progress", "byActor", "done", "state", "earned", "reminded", "showValue", "showAwareness", "showLabels", "npc", "successes", "failures", "used", "log", "showCount", "adhoc", "status", "have", "pnotes", "doneBy", "focus", "showDue", "revealedAt", "followed", "followedBy"]);
/** Fields a preset usually leaves empty for the GM to fill in play: kept unless the preset gives a value. */
const KEEP_IF_EMPTY = new Set(["giver", "actor", "img", "deadline", "onDone", "link", "clues", "under"]);
const isEmptyVal = (v) => v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length);

/**
 * Copy play state from an old copy of a tracker into a fresh one from a preset. Rows in a list
 * that the preset doesn't have (ones the GM added) are kept, after the preset's own.
 */
function keepState(fresh, old) {
  if (!old || typeof old !== "object") return fresh;
  for (const [key, val] of Object.entries(fresh)) {
    if (STATE_KEYS.has(key) && key in old) {
      fresh[key] = clone(old[key]);
    } else if (KEEP_IF_EMPTY.has(key) && isEmptyVal(val)) {
      if (!isEmptyVal(old[key])) fresh[key] = clone(old[key]);
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
  if (t.kind === "quest") {
    // A preset names its own trackers by key; stored, they carry the preset's id in front.
    const keys = new Set((preset.trackers ?? []).map((r, i) => String(r.key ?? r.id ?? i)));
    const own = (id) => (id && keys.has(String(id)) ? `${preset.id}-${id}` : id);
    for (const l of t.leads) l.to = own(l.to);
    for (const o of t.objectives) for (const g of [o, ...o.steps]) if (g.link) g.link.tid = own(g.link.tid);
  }
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
    const { added, updated } = (await mutate((d) => mergePreset(d, preset), { notify: false })) ?? {};
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
/** The tracker id on rolls from proposals made outside a skill challenge. */
const FREE_TID = "~free";
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

async function rollCheck({ tid, target, check, title, hideDC = false }) {
  const actors = rollers();
  if (!actors.length) return ui.notifications.warn(game.user.isGM ? "Select the tokens of the characters who are rolling." : "Select your token, or ask the GM to assign you a character.");
  for (const actor of actors) await rollAs(actor, { tid, target, check, title, hideDC });
}

/** A roll option on rolls whose DC players must not see, whatever the world's "show check DCs" setting. */
const HIDE_DC = "pct-hide-dc";

/** Roll one actor's check, tagged for a tracker. Returns the roll, or null if there was none. */
async function rollAs(actor, { tid, target, check, title, hideDC = false }) {
  const stat = actor.getStatistic?.(String(check.skill || "").toLowerCase());
  if (!stat) {
    ui.notifications.warn(`${actor.name} has no ${skillLabel(check.skill)} to roll.`);
    return null;
  }
  const dc = Number.isFinite(Number(check.dc)) && check.dc !== null && check.dc !== "" ? { value: Number(check.dc), ...(hideDC ? { visible: false } : {}) } : undefined;
  return (await stat.roll({ dc, label: title, extraRollOptions: [rollTag(tid, target, check.id), ...(hideDC ? [HIDE_DC] : [])] })) ?? null;
}

/** The thing a roll targets inside a tracker, and the checks it offers. */
function locate(t, target) {
  if (target === "main") return { type: "main", obj: t, checks: t.checks ?? [], name: "" };
  const found = findRow(t, target);
  if (!found) return null;
  const list = found.list;
  const row = found.row;
  if (list === "approaches") return { type: "approach", obj: row, checks: row.checks ?? [], name: row.label || "" };
  if (list === "adhoc") {
    // A check the GM called on the fly: it counts as an approach when the GM linked one.
    const linked = row.approach ? (t.approaches ?? []).find((a) => a.id === row.approach) : null;
    const checks = [{ id: row.id, skill: row.skill }];
    if (linked) return { type: "approach", obj: linked, checks, name: linked.label || "" };
    return { type: "adhoc", obj: row, checks, name: row.label || skillLabel(row.skill) };
  }
  if (["obstacles", "complications", "opportunities"].includes(list)) return { type: list.slice(0, -1), obj: row, checks: row.checks ?? [], name: row.name, index: Number(found.path.split(".")[1]) };
  if (["skills", "discovery", "checks"].includes(list)) return { type: list === "discovery" ? "discover" : "check", obj: row, checks: [row], name: row.label || skillLabel(row.skill) };
  return null;
}

/** Text cut to a length for titles and labels. */
const shortText = (s, n = 60) => {
  const x = String(s ?? "").replace(/\s+/g, " ").trim();
  if (x.length <= n) return x;
  const cut = x.slice(0, n);
  const space = cut.lastIndexOf(" ");
  return `${(space > n / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, "")}...`;
};

/** The roll title on the card: tracker name and what the check is for. */
function rollTitle(t, target) {
  const where = locate(t, target);
  return where?.name && where.type !== "check" ? `${t.name}: ${where.name}` : t.name;
}

/**
 * A skill challenge roll: add the result's successes and failures, count a use of the approach,
 * and log it. Returns the line for the roll card.
 */
function applyChallenge(t, where, { outcome, actorId, logName, skill }) {
  const d = t.degrees?.[outcome] ?? CDEG()[outcome];
  const s = num(d.s), f = num(d.f);
  const before = challengeStatus(t);
  t.successes = Math.max(0, num(t.successes) + s);
  t.failures = Math.max(0, num(t.failures) + f);
  const again = !!t.oncePerRound && !!actorId && (t.log ?? []).some((x) => x.actorId === actorId && num(x.round) === num(t.round));
  const a = where.type === "approach" ? where.obj : null;
  if (a) a.used = num(a.used) + 1;
  const over = a && nullNum(a.uses) !== null && num(a.used) > num(a.uses);
  const what = a ? a.label || "an approach" : where.name || "a check";
  t.log = [...(t.log ?? []), { id: uid(), round: num(t.round), actorId: actorId ?? null, name: logName || "", approach: a?.id ?? null, what, skill: skill || "", outcome, s, f }].slice(-50);
  const goal = nullNum(t.goal), limit = nullNum(t.limit);
  const parts = [];
  if (s) parts.push(`${signed(s)} ${s === 1 || s === -1 ? "success" : "successes"} (${num(t.successes)}${goal ? ` of ${goal}` : ""})`);
  if (f) parts.push(`${signed(f)} ${f === 1 || f === -1 ? "failure" : "failures"} (${num(t.failures)}${limit ? ` of ${limit}` : ""})`);
  let line = `${logName ? `${logName}: ` : ""}${DEGREE_LABEL[outcome]} at ${what}, ${parts.join(" and ") || "no change"}.`;
  const after = challengeStatus(t);
  if (after && after !== before) line += ` ${STATUS_TEXT[after]}.`;
  if (again) line += ` ${logName || "They"} already rolled this round.`;
  if (over) line += ` That is past its limit of ${num(a.uses)} ${num(a.uses) === 1 ? "use" : "uses"}.`;
  return line;
}

/**
 * Apply a roll's degree of success to a tracker. Changes the tracker in place and returns a line
 * saying what happened, or null if the roll doesn't apply.
 */
function applyRoll(t, { target, outcome, actorId = null, actorName = "", logName = "", skill = "" }) {
  if (!DEGREES.includes(outcome)) return null;
  const where = locate(t, target);
  if (!where) return null;
  if (t.kind === "challenge") return applyChallenge(t, where, { outcome, actorId, logName, skill });
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

/** The skills a challenge's approaches use, each once, in the order they first appear. */
function challengeSkills(t) {
  return [...new Set(t.approaches.flatMap((a) => a.checks.map((c) => String(c.skill || "").trim().toLowerCase()).filter(Boolean)))];
}

/**
 * Post a skill challenge to chat. "skills" lists every skill its approaches use, hidden ones
 * included, with no buttons and no DCs: players say what they do. "options" lists the revealed
 * approaches by their players' names, each with its skills as roll buttons (no DCs shown).
 */
async function postChallengeCard(t, mode) {
  const head = `<header><i class="${KIND_INFO.challenge.icon}"></i> <strong>${esc(t.name)}</strong></header>`;
  const desc = t.desc ? `<p>${para(t.desc)}</p>` : "";
  const speaker = { alias: KIND_INFO.challenge.label };
  if (mode === "skills") {
    const skills = challengeSkills(t);
    if (!skills.length) return ui.notifications.warn("Give the approaches some skills first.");
    return ChatMessage.create({
      content: `<div class="pct-chat pct-challenge">${head}${desc}<p>Skills that could help:</p><ul class="pct-skill-list">${skills.map((x) => `<li>${esc(skillLabel(x))}</li>`).join("")}</ul><p class="pct-hint">Say what your character does, and why the skill fits.</p>${PROPOSE_BTN(t.id)}</div>`,
      speaker,
      flags: { [SCOPE]: { challenge: { tid: t.id, mode, name: t.name, explain: t.explain !== false } } },
    });
  }
  const open = shown(t.approaches).filter((a) => a.checks.some((c) => c.skill) && !(nullNum(a.uses) !== null && num(a.used) >= num(a.uses)));
  if (!open.length) return ui.notifications.warn("Reveal at least one approach with a skill first. Only revealed approaches are posted.");
  const checks = [];
  const blocks = open.map((a) => {
    const title = a.label ? `${t.name}: ${a.label}` : t.name;
    const mine = a.checks.filter((c) => c.skill).map((c) => ({ id: c.id, skill: c.skill, dc: c.dc, label: "", target: a.id, title }));
    checks.push(...mine);
    const left = nullNum(a.uses) !== null ? Math.max(0, num(a.uses) - num(a.used)) : null;
    return `<div class="pct-opt"><strong>${esc(a.label || "Another way")}</strong>${left !== null ? ` <span class="pct-hint">${left} ${left === 1 ? "use" : "uses"} left</span>` : ""}<div class="pct-req pct-req-row">${mine.map((c) => `<button type="button" data-pct-roll="${esc(c.id)}"><i class="fa-solid fa-dice-d20"></i> ${esc(skillLabel(c.skill))}</button>`).join("")}</div></div>`;
  }).join("");
  return ChatMessage.create({
    content: `<div class="pct-chat pct-request pct-challenge">${head}${desc}${blocks}<p class="pct-hint">Select your token and click a skill to roll it, or propose something else.</p>${PROPOSE_BTN(t.id)}</div>`,
    speaker,
    flags: { [SCOPE]: { challenge: { tid: t.id, mode, name: t.name, explain: t.explain !== false }, request: { tid: t.id, title: t.name, hideDC: true, checks } } },
  });
}

/** An approach the DC prefill may pick: revealed, and not used up. Hidden or spent ones are the GM's to pick by hand. */
const prefillable = (a) => a.revealed && !(nullNum(a.uses) !== null && num(a.used) >= num(a.uses));

/** The standard DC for each level, 0 to 25. */
const LEVEL_DC = [14, 15, 16, 18, 19, 20, 22, 23, 24, 26, 27, 28, 30, 31, 32, 34, 35, 36, 38, 39, 40, 42, 44, 46, 48, 50];
const levelDC = (level) => LEVEL_DC[clamp(Math.round(num(level)), 0, LEVEL_DC.length - 1)];

/** An actor's skills as [slug, label], Perception first, lores included. */
function actorSkills(actor) {
  const out = [];
  if (actor?.perception) out.push(["perception", "Perception"]);
  for (const st of Object.values(actor?.skills ?? {})) if (st?.slug) out.push([st.slug, st.label ?? skillLabel(st.slug)]);
  return out;
}

const PROPOSE_BTN = (tid) => `<p class="pct-propose"><button type="button" data-pct-propose="${esc(tid)}"><i class="fa-solid fa-lightbulb"></i> Propose an approach</button></p>`;

/**
 * A player proposes an approach to a skill challenge, or a check in free play (no tid): a skill of
 * their character, what they do and why the skill fits. It goes to chat as a card the GM approves or declines.
 */
async function proposeDialog(tid, fallback = {}) {
  const t = tid ? visibleTrackers().find((x) => x.id === tid) : null;
  const name = tid ? t?.name ?? fallback.name ?? KIND_INFO.challenge.label : "Proposal";
  const explain = (t ? t.explain : fallback.explain) !== false;
  const actor = rollers()[0];
  if (!actor) return ui.notifications.warn(game.user.isGM ? "Select the token of the character who is proposing." : "Select your token, or ask the GM to assign you a character.");
  const skills = actorSkills(actor);
  if (!skills.length) return ui.notifications.warn(`${actor.name} has no skills to propose with.`);
  const opt = explain ? "" : " (optional)";
  let v = { skill: skills.find(([x]) => x !== "perception")?.[0] ?? skills[0][0], what: "", why: "" };
  for (;;) {
    const res = await foundry.applications.api.DialogV2.wait({
      window: { title: tid ? `Propose: ${name}` : "Propose a check" },
      classes: ["pct-propose-dialog"],
      content: `<p>Proposing for <strong>${esc(pcName(actor))}</strong>.</p>
        <div class="form-group"><label>Skill</label><select name="skill">${skills.map(([x, l]) => `<option value="${esc(x)}" ${x === v.skill ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>
        <div class="form-group stacked"><label>What do you do?${opt}</label><textarea name="what" rows="2">${esc(v.what)}</textarea></div>
        <div class="form-group stacked"><label>Why does this skill fit?${opt}</label><textarea name="why" rows="2">${esc(v.why)}</textarea></div>`,
      buttons: [
        { action: "send", label: "Propose", icon: "fa-solid fa-lightbulb", default: true, callback: (ev, button) => {
          const f = button.form.elements;
          return { skill: f.skill.value, what: f.what.value.trim(), why: f.why.value.trim() };
        } },
        { action: "cancel", label: "Cancel" },
      ],
      rejectClose: false,
    });
    if (!res || res === "cancel" || typeof res !== "object") return;
    v = res;
    if (explain && (!v.what || !v.why)) {
      ui.notifications.warn("Say what your character does, and why the skill fits.");
      continue;
    }
    break;
  }
  await ChatMessage.create({
    content: `<div class="pct-chat pct-proposal"><header><i class="fa-solid fa-lightbulb"></i> <strong>${esc(name)}</strong></header>
      <p><span class="pct-k">Proposes</span> <strong>${esc(skillLabel(v.skill))}</strong></p>
      ${v.what ? `<p>${para(v.what)}</p>` : ""}${v.why ? `<p><span class="pct-k">Why</span> ${para(v.why)}</p>` : ""}
      <div class="pct-prop-state"></div></div>`,
    speaker: ChatMessage.getSpeaker({ actor }),
    flags: { [SCOPE]: { proposal: { tid: tid || null, actorId: actor.id, userId: game.user.id, skill: v.skill, what: v.what, why: v.why, status: "pending" } } },
  });
}

/**
 * A proposal card's flags as far as they can be trusted. The player owns the message and can change its flags, so
 * an answer (approved, declined, rolled) counts only when a GM changed the message last; otherwise it's still waiting.
 */
function proposalOf(message) {
  const prop = message?.getFlag?.(SCOPE, "proposal");
  if (!prop || prop.status === "pending") return prop ?? null;
  if (game.users.get(message._stats?.lastModifiedBy)?.isGM) return prop;
  const { finalSkill, dc, target, checkId, title, rolled, reason, ...rest } = prop;
  return { ...rest, status: "pending" };
}

/** The live part of a proposal card: the GM's controls while it waits, then the roll button or the answer. */
function renderProposal(message, prop, root) {
  const box = root.querySelector(".pct-prop-state");
  if (!box) return;
  const actor = game.actors.get(prop.actorId) ?? null;
  const skill = prop.finalSkill || prop.skill;
  if (prop.status === "declined") {
    box.innerHTML = `<p class="pct-prop-no"><i class="fa-solid fa-xmark"></i> Not this time${prop.reason ? `: ${esc(prop.reason)}` : "."}</p>`;
    return;
  }
  if (prop.status === "approved") {
    const swapped = skill !== prop.skill ? ` as <strong>${esc(skillLabel(skill))}</strong>` : "";
    const dc = game.user.isGM && prop.dc !== null && prop.dc !== undefined ? ` <span class="pct-hint">DC ${esc(prop.dc)}</span>` : "";
    if (prop.rolled) {
      box.innerHTML = `<p class="pct-prop-ok"><i class="fa-solid fa-check"></i> Approved${swapped}. Rolled.${dc}</p>`;
      return;
    }
    const can = game.user.isGM || actor?.isOwner;
    box.innerHTML = `<p class="pct-prop-ok"><i class="fa-solid fa-check"></i> Approved${swapped}.${dc}</p>${can ? `<div class="pct-req"><button type="button" data-pct-prop-roll><i class="fa-solid fa-dice-d20"></i> Roll ${esc(skillLabel(skill))}${actor ? ` for ${esc(pcName(actor))}` : ""}</button></div>` : ""}`;
    box.querySelector("[data-pct-prop-roll]")?.addEventListener("click", async (ev) => {
      ev.preventDefault();
      if (!actor) return ui.notifications.warn("The character who proposed this no longer exists.");
      const b = ev.currentTarget;
      b.disabled = true;
      const roll = await rollAs(actor, { tid: prop.tid || FREE_TID, target: prop.target, check: { id: prop.checkId, skill, dc: prop.dc }, title: prop.title, hideDC: true });
      // The active GM marks the card rolled when the roll arrives (see createChatMessage below).
      if (!roll) b.disabled = false;
    });
    return;
  }
  if (!game.user.isGM) {
    box.innerHTML = `<p class="pct-hint">Waiting for the GM.</p>`;
    return;
  }
  box.replaceChildren(proposalControls(message, prop, actor));
}

/** The GM's controls on a waiting proposal: skill, DC, which approach it counts as, approve or decline. */
function proposalControls(message, prop, actor) {
  const el = document.createElement("div");
  el.className = "pct-prop-gm";
  const free = !prop.tid;
  const t = free ? null : Store.get(prop.tid);
  if (!free && !t) {
    el.innerHTML = `<p class="pct-hint">That skill challenge no longer exists.</p>`;
    return el;
  }
  const skills = actorSkills(actor);
  if (!skills.some(([x]) => x === prop.skill)) skills.unshift([prop.skill, skillLabel(prop.skill)]);
  el.innerHTML = `<div class="pct-prop-row"><label>Skill <select name="skill">${skills.map(([x, l]) => `<option value="${esc(x)}" ${x === prop.skill ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
      <label>DC <input type="number" name="dc"></label>
      <button type="button" data-adj="-2" data-tooltip="Easy: 2 lower">Easy</button><button type="button" data-adj="2" data-tooltip="Hard: 2 higher">Hard</button></div>
    ${free ? "" : `<div class="pct-prop-row"><label>Counts as <select name="approach"><option value="">On its own</option>${t.approaches.map((a) => `<option value="${esc(a.id)}">${esc(a.label || "Unnamed approach")}${a.revealed ? "" : " (hidden)"}</option>`).join("")}</select></label>
      <label class="pct-prop-save" data-tooltip="Add it to the challenge's approaches, shown to players by what they wrote"><input type="checkbox" name="save"> Save as an approach</label></div>`}
    <div class="pct-prop-row"><button type="button" data-act="approve"><i class="fa-solid fa-check"></i> Approve</button></div>
    <div class="pct-prop-row"><input type="text" name="reason" placeholder="Reason, if you decline (optional)"><button type="button" data-act="decline"><i class="fa-solid fa-xmark"></i> Decline</button></div>`;
  const $ = (n) => el.querySelector(`[name="${n}"]`);
  const sync = () => {
    if (free) return;
    const linked = !!$("approach").value;
    $("save").disabled = linked;
    if (linked) $("save").checked = false;
  };
  // An approach that already uses the skill gives the DC and the link; otherwise the character's level does.
  const prefill = () => {
    if (free) return void ($("dc").value = levelDC(actor?.level ?? 0));
    const skill = $("skill").value;
    const a = t.approaches.find((x) => prefillable(x) && x.checks.some((c) => String(c.skill).toLowerCase() === skill && c.dc !== null && c.dc !== ""));
    const c = a?.checks.find((x) => String(x.skill).toLowerCase() === skill);
    $("dc").value = c ? num(c.dc) : levelDC(actor?.level ?? 0);
    $("approach").value = a?.id ?? "";
    sync();
  };
  prefill();
  $("skill").addEventListener("change", prefill);
  $("approach")?.addEventListener("change", sync);
  for (const b of el.querySelectorAll("[data-adj]")) b.addEventListener("click", (ev) => {
    ev.preventDefault();
    $("dc").value = num($("dc").value) + Number(b.dataset.adj);
  });
  el.querySelector('[data-act="approve"]').addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.currentTarget.disabled = true;
    const dc = $("dc").value === "" ? null : num($("dc").value);
    const pick = { skill: $("skill").value, dc, approach: $("approach")?.value ?? "", save: !!$("save")?.checked };
    onceFor(message, (m) => (free ? approveFree(m, prop, pick) : approveProposal(m, prop, pick)));
  });
  el.querySelector('[data-act="decline"]').addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.currentTarget.disabled = true;
    const reason = $("reason").value.trim();
    onceFor(message, async (m) => {
      if (proposalOf(m)?.status !== "pending") return;
      await m.update({ [`flags.${SCOPE}.proposal`]: { ...prop, status: "declined", reason } });
    });
  });
  return el;
}

/** Approve a free-play proposal: the skill and DC, and the roll button for its character. */
async function approveFree(message, prop, { skill, dc }) {
  if (!game.user.isGM || proposalOf(message)?.status !== "pending") return;
  const id = foundry.utils.randomID(10);
  await message.update({ [`flags.${SCOPE}.proposal`]: { ...prop, status: "approved", finalSkill: skill, dc, target: id, checkId: id, title: shortText(prop.what) || skillLabel(skill) } });
}

/**
 * Approve a proposal: link it to an approach, or save it as a new one, and open its roll. The roll
 * targets a row in the GM's data (like a check called on the fly), so it applies even if the
 * proposal is deleted, and nothing the player can edit on their own message decides what it counts as.
 */
async function approveProposal(message, prop, { skill, dc, approach, save }) {
  const t = Store.get(prop.tid);
  if (!t || !game.user.isGM) return;
  if (proposalOf(message)?.status !== "pending") return;
  const what = shortText(prop.what) || skillLabel(skill);
  let linked = approach ? t.approaches.find((x) => x.id === approach) ?? null : null;
  let added = null;
  if (!linked && save) {
    const who = pcName(game.actors.get(prop.actorId));
    added = { ...TPL.approach(), label: what, gm: `Proposed by ${who}.${prop.why ? ` ${prop.why}` : ""}`, revealed: true, checks: [{ ...TPL.check(), skill, dc }] };
  }
  const row = { ...TPL.adhoc(), skill, dc, label: what, approach: (linked ?? added)?.id ?? null };
  const ok = await mutateTracker(t.id, (tr) => {
    if (added) tr.approaches.push(added);
    tr.adhoc = [...(tr.adhoc ?? []), row].slice(-200);
    return true;
  }, { notify: false });
  if (!ok) return;
  // A hidden approach's name stays off the public roll card.
  const title = `${t.name}: ${linked?.revealed && linked.label ? linked.label : what}`;
  await message.update({ [`flags.${SCOPE}.proposal`]: { ...prop, status: "approved", finalSkill: skill, dc, target: row.id, checkId: row.id, title } });
}

/**
 * The GM calls for a check on the fly: which characters, which skill, the DC (from a matching
 * approach, else the highest chosen level), and what it counts as. Then a chat card with a roll
 * button for each character, or the rolls at once.
 */
async function adhocDialog(t) {
  const pcs = partyMembers();
  if (!pcs.length) return ui.notifications.warn("There are no player characters to call a check for.");
  const skills = new Map([["perception", "Perception"], ...SKILLS.filter((x) => !["perception", "fortitude", "reflex", "will"].includes(x)).map((x) => [x, skillLabel(x)])]);
  for (const a of pcs) for (const [x, l] of actorSkills(a)) if (!skills.has(x)) skills.set(x, l);
  const lc = (x) => String(x ?? "").trim().toLowerCase();
  const controlled = (globalThis.canvas?.tokens?.controlled ?? []).map((x) => x.actor?.id).filter(Boolean);
  let v = { pcs: new Set(pcs.filter((a) => controlled.includes(a.id)).map((a) => a.id)), skill: challengeSkills(t)[0] ?? "perception", dc: undefined, approach: "", what: "" };
  for (;;) {
    const read = (mode) => (ev, button) => {
      const f = button.form;
      return { mode, pcs: new Set([...f.querySelectorAll("input[name=pc]:checked")].map((i) => i.value)), skill: f.elements.skill.value, dc: f.elements.dc.value, approach: f.elements.approach.value, what: f.elements.what.value.trim() };
    };
    const res = await foundry.applications.api.DialogV2.wait({
      window: { title: `Check: ${t.name}` },
      classes: ["pct-adhoc-dialog"],
      content: `<div class="form-group"><label>Who</label><div class="form-fields pct-pcs">${pcs.map((a) => `<label><input type="checkbox" name="pc" value="${esc(a.id)}" ${v.pcs.has(a.id) ? "checked" : ""}> ${esc(pcName(a))}</label>`).join("")}</div></div>
        <div class="form-group"><label>Skill</label><select name="skill">${[...skills].map(([x, l]) => `<option value="${esc(x)}" ${x === v.skill ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>
        <div class="form-group"><label>DC</label><div class="form-fields"><input type="number" name="dc" value="${esc(v.dc ?? "")}"><button type="button" data-adj="-2">Easy</button><button type="button" data-adj="2">Hard</button></div></div>
        <div class="form-group"><label>Counts as</label><select name="approach"><option value="">On its own</option>${t.approaches.map((a) => `<option value="${esc(a.id)}" ${a.id === v.approach ? "selected" : ""}>${esc(a.label || "Unnamed approach")}${a.revealed ? "" : " (hidden)"}</option>`).join("")}</select></div>
        <div class="form-group"><label>For</label><input type="text" name="what" value="${esc(v.what)}" placeholder="What they're doing (optional)"></div>
        <p class="hint">Players see the result, not the DC.</p>`,
      render: (ev, d) => {
        const root = d instanceof HTMLElement ? d : d?.element;
        if (!root) return;
        const $ = (n) => root.querySelector(`[name="${n}"]`);
        const prefill = (fromSkill) => {
          const skill = $("skill").value;
          const hasDC = (c) => lc(c.skill) === skill && c.dc !== null && c.dc !== "";
          if (fromSkill) $("approach").value = t.approaches.find((a) => prefillable(a) && a.checks.some(hasDC))?.id ?? "";
          const c = t.approaches.find((a) => a.id === $("approach").value)?.checks.find(hasDC);
          const chosen = [...root.querySelectorAll("input[name=pc]:checked")].map((i) => game.actors.get(i.value));
          const levels = (chosen.length ? chosen : pcs).map((a) => num(a?.level));
          $("dc").value = c ? num(c.dc) : levelDC(Math.max(0, ...levels));
        };
        if (v.dc === undefined) prefill(true);
        $("skill").addEventListener("change", () => prefill(true));
        $("approach").addEventListener("change", () => prefill(false));
        for (const i of root.querySelectorAll("input[name=pc]")) i.addEventListener("change", () => prefill(false));
        for (const b of root.querySelectorAll("[data-adj]")) b.addEventListener("click", (e) => {
          e.preventDefault();
          $("dc").value = num($("dc").value) + Number(b.dataset.adj);
        });
      },
      buttons: [
        { action: "send", label: "Send to players", icon: "fa-solid fa-share-from-square", default: true, callback: read("send") },
        { action: "roll", label: "Roll now", icon: "fa-solid fa-dice-d20", callback: read("roll") },
        { action: "cancel", label: "Cancel" },
      ],
      rejectClose: false,
    });
    if (!res || typeof res !== "object") return;
    v = res;
    if (!v.pcs.size) {
      ui.notifications.warn("Pick at least one character.");
      continue;
    }
    break;
  }
  const dc = v.dc === "" ? null : num(v.dc);
  const linked = t.approaches.find((a) => a.id === v.approach) ?? null;
  const row = { ...TPL.adhoc(), skill: v.skill, dc, label: v.what, approach: linked?.id ?? null };
  await mutateTracker(t.id, (tr) => {
    tr.adhoc = [...(tr.adhoc ?? []), row].slice(-200);
  }, { notify: false });
  const title = `${t.name}: ${v.what ? shortText(v.what) : (linked?.revealed && linked.label) || skillLabel(v.skill)}`;
  const ids = [...v.pcs];
  if (v.mode === "roll") {
    for (const id of ids) {
      const actor = game.actors.get(id);
      if (actor) await rollAs(actor, { tid: t.id, target: row.id, check: { id: row.id, skill: v.skill, dc }, title, hideDC: true });
    }
    return;
  }
  await ChatMessage.create({
    content: `<div class="pct-chat pct-adhoc"><header><i class="${KIND_INFO.challenge.icon}"></i> <strong>${esc(t.name)}</strong></header>
      <p><strong>${esc(skillLabel(v.skill))}</strong>${v.what ? `: ${esc(v.what)}` : ""}</p><div class="pct-adhoc-state"></div></div>`,
    speaker: { alias: KIND_INFO.challenge.label },
    flags: { [SCOPE]: { adhoc: { tid: t.id, row: row.id, actors: ids, skill: v.skill, dc, title, rolled: {} } } },
  });
}

/** A check card from the GM: a roll button for each character, for that character's owner. */
function renderAdhoc(message, ad, root) {
  const box = root.querySelector(".pct-adhoc-state");
  if (!box) return;
  box.innerHTML = `${game.user.isGM && ad.dc !== null && ad.dc !== undefined ? `<p class="pct-hint">DC ${esc(ad.dc)}</p>` : ""}<div class="pct-req pct-req-row"></div>`;
  const row = box.querySelector(".pct-req");
  for (const id of ad.actors ?? []) {
    const actor = game.actors.get(id);
    const name = actor ? pcName(actor) : "?";
    if (ad.rolled?.[id]) {
      row.insertAdjacentHTML("beforeend", `<span class="pct-adhoc-done"><i class="fa-solid fa-check"></i> ${esc(name)}</span>`);
    } else if (actor && (game.user.isGM || actor.isOwner)) {
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML = `<i class="fa-solid fa-dice-d20"></i> ${esc(name)}`;
      b.addEventListener("click", async (ev) => {
        ev.preventDefault();
        b.disabled = true;
        const roll = await rollAs(actor, { tid: ad.tid, target: ad.row, check: { id: ad.row, skill: ad.skill, dc: ad.dc }, title: ad.title, hideDC: true });
        if (!roll) b.disabled = false;
      });
      row.append(b);
    } else {
      row.insertAdjacentHTML("beforeend", `<span class="pct-hint">${esc(name)}</span>`);
    }
  }
}

/**
 * What applying a roll changed in a tracker, so it can be undone without touching anything changed
 * since: numbers as amounts, other values as from and to, rows added to a list by their id. A step
 * through a list of rows is the row's id, so later reordering or trimming doesn't misplace it.
 */
function diffTracker(a, b, path = []) {
  const out = [];
  if (Array.isArray(b)) {
    const old = Array.isArray(a) ? a : [];
    if (!b.every((x) => x && typeof x === "object" && x.id)) return out;
    for (const row of b) {
      const was = old.find((x) => x?.id === row.id);
      if (!was) out.push({ path, add: row.id });
      else out.push(...diffTracker(was, row, [...path, { id: row.id }]));
    }
    return out;
  }
  if (b && typeof b === "object") {
    for (const k of new Set([...Object.keys(a ?? {}), ...Object.keys(b)])) out.push(...diffTracker(a?.[k], b[k], [...path, k]));
    return out;
  }
  if (a !== b && !(a === undefined && b === undefined)) out.push({ path, from: a ?? null, to: b ?? null });
  return out;
}

function walkPath(obj, path) {
  let at = obj;
  for (const step of path) {
    if (at == null) return undefined;
    at = typeof step === "object" ? (Array.isArray(at) ? at.find((x) => x?.id === step.id) : undefined) : at[step];
  }
  return at;
}

/** Take back what diffTracker recorded: numbers by the amount they moved, the rest only if unchanged since. */
function undoChanges(t, changes) {
  for (const c of changes ?? []) {
    if (c.add) {
      const list = walkPath(t, c.path);
      const i = Array.isArray(list) ? list.findIndex((x) => x?.id === c.add) : -1;
      if (i >= 0) list.splice(i, 1);
      continue;
    }
    const parent = walkPath(t, c.path.slice(0, -1));
    const key = c.path.at(-1);
    if (!parent || typeof parent !== "object" || typeof key === "object") continue;
    if (typeof c.to === "number" && (c.from === null || typeof c.from === "number")) {
      const back = num(parent[key]) - (c.to - num(c.from));
      // Never past a field's limits: a plain field has its own; anything inside a row stops at 0.
      const [lo, hi] = c.path.every((x) => typeof x === "string") ? bounds(t, c.path.join(".")) : [0, null];
      if (c.from === null && back === 0) delete parent[key];
      else parent[key] = clamp(back, lo, hi);
    } else if (parent[key] === c.to) parent[key] = c.from;
  }
}

/** An approach's GM-only consequence for a critical failure, shown on the GM's Apply box (never stored on the card). */
function critFailNote(t, target, outcome) {
  if (t?.kind !== "challenge" || outcome !== "criticalFailure") return "";
  const where = locate(t, target);
  return where?.type === "approach" ? String(where.obj.critFail ?? "").trim() : "";
}

/** Apply a roll and record what it changed. Returns { text, changes } or null. */
function applyRecorded(tr, args) {
  const before = clone(tr);
  const text = applyRoll(tr, args);
  return text ? { text, changes: diffTracker(before, tr) } : null;
}

/**
 * A reroll (a hero point) deletes the roll card and posts a new one. When the first card had been
 * applied, what it applied is kept here for a short while, so the new card can offer to replace it.
 */
const rerollStash = new Map();
const rerollKey = (message) => {
  const ctx = message.flags?.pf2e?.context;
  const tag = ctx?.options?.find((o) => typeof o === "string" && o.startsWith(`${MOD}:`));
  return tag ? `${tag}|${ctx.actor ?? ""}` : null;
};
function priorApplied(message) {
  // Once replaced, the first roll's result is gone: an Undo after that leaves a plain Apply.
  if (message.getFlag(SCOPE, "replaced")) return null;
  const flagged = message.getFlag(SCOPE, "rerolled");
  if (flagged) return flagged;
  if (!message.flags?.pf2e?.context?.isReroll) return null;
  const hit = rerollStash.get(rerollKey(message));
  return hit && Date.now() - hit.at < 120000 ? hit : null;
}

/**
 * Card actions (Apply, Undo, Replace, approve, decline) run one at a time per card, on the card as it is when the
 * click lands.
 */
const busyCards = new Set();
async function onceFor(message, fn) {
  if (busyCards.has(message.id)) return;
  busyCards.add(message.id);
  try {
    await fn(game.messages?.get(message.id) ?? message);
  } finally {
    busyCards.delete(message.id);
  }
}

/** Give every player Observer on a loot actor, so they can open it and take what's inside. */
async function letPlayersOpen(uuid) {
  const actor = uuid ? await fromUuid(uuid) : null;
  const OBS = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
  if (!actor || num(actor.ownership?.default) >= OBS) return false;
  await actor.update({ "ownership.default": OBS });
  return true;
}

/** A reward's loot actor that players can't open yet, or null. */
async function lootToOpen(t, rewardId) {
  const r = (t.rewards ?? []).find((x) => x.id === rewardId);
  if (!r?.actor?.uuid) return null;
  const actor = await fromUuid(r.actor.uuid);
  return actor && num(actor.ownership?.default) < CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER ? actor : null;
}

/**
 * A goal was finished: whisper the GM a card with what it offers. Players' ticks always send one,
 * so the GM hears of them; the GM's own ticks send one only when there is something to offer.
 */
async function promptCompletion(t, goalId, { who = null, why = null } = {}) {
  const found = t ? findGoal(t, goalId) : null;
  if (!found) return;
  // A link (another tracker reaching something) offers the goal itself; it isn't done yet, so its reveals wait.
  const self = why && found.g.state === "open" ? goalId : null;
  const { reveal, parent } = self ? { reveal: completionOffers(t, goalId).reveal, parent: null } : completionOffers(t, goalId);
  if (!who && !self && !reveal.length && !parent) return;
  const what = shortText(found.g.text, 80) || "an objective";
  const line = self ? `${esc(why)}, so <em>${esc(what)}</em> may be done.` : `${who ? `<strong>${esc(who)}</strong> marked` : "Marked"} <em>${esc(what)}</em> done.`;
  await ChatMessage.create({
    content: `<div class="pct-chat pct-qprompt"><header><i class="${KIND_INFO.quest.icon}"></i> <strong>${esc(t.name)}</strong></header>
      <p>${line}</p><div class="pct-qprompt-state"></div></div>`,
    speaker: { alias: KIND_INFO.quest.label },
    whisper: gmIds(),
    flags: { [SCOPE]: { qprompt: { tid: t.id, goal: goalId, self, reveal, parent, status: "open" } } },
  });
}

/** A player followed a lead: whisper the GM a card, with what the lead can reveal that players can't see yet. */
async function promptFollow(t, leadId, who) {
  const lead = (t?.leads ?? []).find((l) => l.id === leadId);
  if (!lead) return;
  // A card for this lead still waiting on the GM is redrawn rather than posted again.
  const open = game.messages.contents.slice(-100).find((m) => {
    const f = m.getFlag?.(SCOPE, "qfollow");
    return f?.status === "open" && f.tid === t.id && f.lead === leadId;
  });
  if (open) return void ui.chat?.updateMessage?.(open);
  const what = shortText(lead.text, 80) || "a lead";
  await ChatMessage.create({
    content: `<div class="pct-chat pct-qprompt"><header><i class="${KIND_INFO.quest.icon}"></i> <strong>${esc(t.name)}</strong></header>
      <p><strong>${esc(who)}</strong> followed <em>${esc(what)}</em>${/[.!?]$/.test(what) ? "" : "."}</p><div class="pct-qprompt-state"></div></div>`,
    speaker: { alias: KIND_INFO.quest.label },
    whisper: gmIds(),
    flags: { [SCOPE]: { qfollow: { tid: t.id, lead: leadId, status: "open" } } },
  });
}

/** The GM's choices on a follow card: tick what to reveal, then Reveal or Not yet. */
function renderFollow(message, qf, root) {
  const box = root.querySelector(".pct-qprompt-state");
  if (!box) return;
  if (qf.status !== "open") {
    box.innerHTML = `<p class="pct-hint">${esc(qf.result || "Done.")}</p>`;
    return;
  }
  if (!game.user.isGM) return;
  const t = Store.get(qf.tid);
  const lead = (t?.leads ?? []).find((l) => l.id === qf.lead);
  if (!lead) {
    box.innerHTML = `<p class="pct-hint">That lead no longer exists.</p>`;
    return;
  }
  const offers = leadOffers(t, lead);
  const undone = !lead.followed;
  box.innerHTML = `${undone ? `<p class="pct-hint">It has been marked not followed since.</p>` : ""}${offers.length ? `<div class="pct-qprompt-rows">${offerRows(offers, !undone)}</div>` : `<p class="pct-hint">Nothing hidden to reveal.</p>`}
    <div class="pct-req pct-req-row">${offers.length ? `<button type="button" data-act="go"><i class="fa-solid fa-eye"></i> Reveal</button>` : ""}<button type="button" data-act="skip">${offers.length ? "Not yet" : "OK"}</button></div>`;
  box.querySelector('[data-act="go"]')?.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.currentTarget.disabled = true;
    const keys = offers.filter((o) => box.querySelector(`input[name="${CSS.escape(o.key)}"]`)?.checked).map((o) => o.key);
    onceFor(message, async (m) => {
      if (m.getFlag(SCOPE, "qfollow")?.status !== "open") return;
      const n = await revealLeadOffers(qf.tid, leadOffers(Store.get(qf.tid), (Store.get(qf.tid)?.leads ?? []).find((l) => l.id === qf.lead)), keys);
      if (n === undefined) return void ui.notifications.error("Campaign Trackers: the reveal didn't save. Try again.");
      await m.update({ [`flags.${SCOPE}.qfollow.status`]: "done", [`flags.${SCOPE}.qfollow.result`]: n ? `Done: revealed ${n}.` : "Done." });
    });
  });
  box.querySelector('[data-act="skip"]').addEventListener("click", (ev) => {
    ev.preventDefault();
    onceFor(message, async (m) => {
      if (m.getFlag(SCOPE, "qfollow")?.status !== "open") return;
      await m.update({ [`flags.${SCOPE}.qfollow.status`]: "skipped", [`flags.${SCOPE}.qfollow.result`]: offers.length ? "Left for later. Reveal from the quest when you're ready." : "Seen." });
    });
  });
}

/** The GM's choices on an On-completion card: tick what to reveal, then Reveal or Not yet. */
async function renderCompletion(message, qp, root) {
  const box = root.querySelector(".pct-qprompt-state");
  if (!box) return;
  if (qp.status !== "open") {
    box.innerHTML = `<p class="pct-hint">${esc(qp.result || "Done.")}</p>`;
    return;
  }
  if (!game.user.isGM) return;
  const t = Store.get(qp.tid);
  if (!t) {
    box.innerHTML = `<p class="pct-hint">That quest no longer exists.</p>`;
    return;
  }
  const rows = [], clues = new Map();
  const reopened = !qp.self && findGoal(t, qp.goal)?.g.state !== "done";
  if (qp.self) {
    const sg = findGoal(t, qp.self)?.g;
    if (sg && sg.state === "open") rows.push(`<label class="pct-chk"><input type="checkbox" name="self" checked> <span>Mark <em>${esc(shortText(sg.text, 70))}</em> done</span></label>`);
  }
  if (qp.parent) {
    const pg = findGoal(t, qp.parent)?.g;
    if (pg && pg.state === "open") rows.push(`<label class="pct-chk"><input type="checkbox" name="parent" checked> <span>Mark <em>${esc(shortText(pg.text, 70))}</em> done too (its steps add up)</span></label>`);
  }
  for (const id of qp.reveal) {
    const f = findRow(t, id);
    if (!f || rowShown(f)) continue;
    rows.push(`<label class="pct-chk"><input type="checkbox" name="reveal" value="${esc(id)}" checked> <span>Reveal ${esc(revealLabel(t, f))}</span></label>`);
    if (f.list === "leads") {
      const to = Store.data.trackers.find((x) => x.id === f.row.to && x.kind === "quest" && !x.revealed);
      if (to) rows.push(`<label class="pct-chk pct-indent"><input type="checkbox" name="leadq" value="${esc(to.id)}" data-for="${esc(id)}" checked> <span>and reveal the quest it points to, ${esc(to.name)}</span></label>`);
      for (const clue of leadClues(t, f.row)) {
        if (qp.reveal.includes(clue.id)) continue;
        // A clue two leads share is listed once, under the first, and comes with either of them.
        if (clues.has(clue.id)) {
          const at = clues.get(clue.id);
          rows[at] = rows[at].replace(/data-for="([^"]*)"/, (m0, ids) => `data-for="${ids} ${esc(id)}"`);
          continue;
        }
        clues.set(clue.id, rows.length);
        rows.push(`<label class="pct-chk pct-indent"><input type="checkbox" name="leadc" value="${esc(clue.id)}" data-for="${esc(id)}" checked> <span>and reveal its clue, ${esc(shortText(clue.text, 60) || "(no text)")}</span></label>`);
      }
    }
    if (f.list === "rewards" && (await lootToOpen(t, id))) rows.push(`<label class="pct-chk pct-indent"><input type="checkbox" name="loot" value="${esc(id)}" data-for="${esc(id)}" checked> <span>and let players open ${esc(f.row.actor.name)}</span></label>`);
  }
  const shownRows = reopened ? rows.map((r) => r.replace(" checked>", ">")) : rows;
  box.innerHTML = `${reopened ? `<p class="pct-hint">It has been marked open again since.</p>` : ""}${shownRows.length ? `<div class="pct-qprompt-rows">${shownRows.join("")}</div>` : `<p class="pct-hint">Nothing was set to be revealed.</p>`}
    <div class="pct-req pct-req-row">${rows.length ? `<button type="button" data-act="go"><i class="fa-solid fa-eye"></i> Reveal</button>` : ""}<button type="button" data-act="skip">${rows.length ? "Not yet" : "OK"}</button></div>`;
  box.querySelector('[data-act="go"]')?.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.currentTarget.disabled = true;
    const pick = (n) => [...box.querySelectorAll(`input[name="${n}"]:checked`)].map((i) => i.value);
    const ids = pick("reveal");
    // An indented "and ..." row counts only with the reveal above it.
    const under = (n) => [...box.querySelectorAll(`input[name="${n}"]:checked`)].filter((i) => !i.dataset.for || i.dataset.for.split(" ").some((f) => ids.includes(f))).map((i) => i.value);
    const loot = under("loot"), leadq = under("leadq"), leadc = under("leadc"), doParent = !!box.querySelector('input[name="parent"]:checked'), doSelf = !!box.querySelector('input[name="self"]:checked');
    onceFor(message, async (m) => {
      if (m.getFlag(SCOPE, "qprompt")?.status !== "open") return;
      let revealedN = 0;
      const done = await mutate((d) => {
        const tr = d.trackers.find((x) => x.id === qp.tid);
        if (!tr) return undefined;
        for (const qid of leadq) {
          const other = d.trackers.find((x) => x.id === qid);
          if (other) other.revealed = true;
        }
        if (doSelf) {
          const sg = findGoal(tr, qp.self)?.g;
          if (sg && sg.state === "open") {
            sg.state = "done";
            sg.doneBy = "gm";
          }
        }
        for (const id of [...ids, ...leadc]) revealedN += revealRow(findRow(tr, id)).length;
        if (doParent) {
          const pg = findGoal(tr, qp.parent)?.g;
          if (pg && pg.state === "open") {
            pg.state = "done";
            pg.doneBy = "gm";
          }
        }
        return true;
      }, { notify: false });
      if (!done) return;
      for (const rid of loot) {
        const r = (Store.get(qp.tid)?.rewards ?? []).find((x) => x.id === rid);
        if (r?.actor?.uuid) await letPlayersOpen(r.actor.uuid);
      }
      const parts = [doSelf && "marked it done", revealedN && `revealed ${revealedN}`, leadq.length && `revealed ${leadq.length === 1 ? "a quest" : `${leadq.length} quests`}`, doParent && "marked the objective done", loot.length && "opened the loot to players"].filter(Boolean);
      await m.update({ [`flags.${SCOPE}.qprompt.status`]: "done", [`flags.${SCOPE}.qprompt.result`]: parts.length ? `Done: ${parts.join(", ")}.` : "Done." });
      // Marking it done can complete the objective above it, or bring more to reveal.
      if (doSelf) await promptCompletion(Store.get(qp.tid), qp.self);
      if (doParent) await promptCompletion(Store.get(qp.tid), qp.parent);
    });
  });
  box.querySelector('[data-act="skip"]').addEventListener("click", (ev) => {
    ev.preventDefault();
    onceFor(message, async (m) => {
      if (m.getFlag(SCOPE, "qprompt")?.status !== "open") return;
      await m.update({ [`flags.${SCOPE}.qprompt.status`]: "skipped", [`flags.${SCOPE}.qprompt.result`]: "Left for later. Reveal from the quest when you're ready." });
    });
  });
}

/**
 * Wire up this module's chat cards: roll and propose buttons, proposals, GM check cards, completion cards, and the
 * GM's Apply box on tagged roll cards.
 */
function onRenderMessage(message, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  const req = message.getFlag?.(SCOPE, "request");
  if (req) {
    for (const b of root.querySelectorAll("[data-pct-roll]")) {
      b.addEventListener("click", (ev) => {
        ev.preventDefault();
        const check = req.checks.find((c) => c.id === b.dataset.pctRoll);
        if (check) rollCheck({ tid: req.tid, target: check.target ?? req.target, check, title: check.title ?? req.title, hideDC: !!req.hideDC });
      });
    }
  }
  const prop = proposalOf(message);
  if (prop) renderProposal(message, prop, root);
  const ad = message.getFlag?.(SCOPE, "adhoc");
  if (ad) renderAdhoc(message, ad, root);
  const qp = message.getFlag?.(SCOPE, "qprompt");
  if (qp) renderCompletion(message, qp, root);
  const qf = message.getFlag?.(SCOPE, "qfollow");
  if (qf) renderFollow(message, qf, root);
  for (const b of root.querySelectorAll("[data-pct-propose]")) {
    b.addEventListener("click", (ev) => {
      ev.preventDefault();
      const c = message.getFlag?.(SCOPE, "challenge") ?? {};
      proposeDialog(b.dataset.pctPropose, { name: c.name, explain: c.explain });
    });
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
  const args = { target: tag.target, outcome: ctx.outcome, actorId: actor?.id ?? null, actorName: "", logName: actor ? pcName(actor) : "", skill: locate(t, tag.target)?.checks?.find((c) => c.id === tag.checkId)?.skill ?? tag.checkId ?? "" };
  const prior = applied ? null : priorApplied(message);
  if (applied) {
    box.innerHTML = `<i class="fa-solid fa-check"></i> ${esc(applied.text)}${applied.changes ? ` <a class="pct-undo" data-tooltip="Take this result back off ${esc(t.name)}"><i class="fa-solid fa-rotate-left"></i> Undo</a>` : ""}`;
    box.querySelector(".pct-undo")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.currentTarget.classList.add("pct-busy");
      onceFor(message, async (m) => {
        const now = m.getFlag(SCOPE, "applied");
        if (!now?.changes) return;
        const ok = await mutateTracker(t.id, (tr) => {
          undoChanges(tr, now.changes);
          return true;
        });
        if (ok) await m.unsetFlag(SCOPE, "applied");
      });
    });
  } else if (!ctx.outcome) {
    box.innerHTML = `<i class="fa-solid fa-circle-info"></i> No DC on this roll, so there is no result to apply to ${esc(t.name)}.`;
  } else if (prior) {
    // The roll before this reroll was applied: offer to swap its result for this one's.
    const copy = clone(t);
    undoChanges(copy, prior.changes);
    const preview = applyRoll(copy, args);
    if (!preview) return;
    box.innerHTML = `<p class="pct-preview">The roll before this reroll was applied: ${esc(prior.text)}</p><button type="button"><i class="fa-solid fa-arrows-rotate"></i> Replace it with this roll</button><div class="pct-preview">${esc(preview)}</div>`;
    box.querySelector("button").addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.currentTarget.disabled = true;
      onceFor(message, async (m) => {
        if (m.getFlag(SCOPE, "applied") || m.getFlag(SCOPE, "replaced")) return;
        const done = await mutateTracker(t.id, (tr) => {
          undoChanges(tr, prior.changes);
          return applyRecorded(tr, args);
        });
        if (done) await m.update({ [`flags.${SCOPE}.applied`]: { text: `Replaced the first roll. ${done.text}`, changes: done.changes }, [`flags.${SCOPE}.replaced`]: true });
      });
    });
  } else {
    const preview = applyRoll(clone(t), args);
    if (!preview) return;
    box.innerHTML = `<button type="button"><i class="${KIND_INFO[t.kind].icon}"></i> Apply to ${esc(t.name)}</button><div class="pct-preview">${esc(preview)}</div>`;
    box.querySelector("button").addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.currentTarget.disabled = true;
      onceFor(message, async (m) => {
        if (m.getFlag(SCOPE, "applied")) return;
        const done = await mutateTracker(t.id, (tr) => applyRecorded(tr, args));
        if (done) await m.setFlag(SCOPE, "applied", done);
      });
    });
  }
  const note = critFailNote(t, tag.target, ctx.outcome);
  if (note) box.insertAdjacentHTML("beforeend", `<div class="pct-preview"><strong>On a critical failure:</strong> ${esc(note)}</div>`);
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

/**
 * A date typed against the world calendar: "15 Vind", "15 Vind 1534", "Vind 15" or "1534-12-15". Returns null for
 * blank and undefined if unreadable.
 */
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
    if (t.kind === "quest") {
      const k = dkey(t.deadline);
      if (k !== null) {
        if (k > now) t.reminded = null;
        else if (t.reminded !== k) {
          t.reminded = k;
          if (t.status === "active" || t.status === "lead") lines.push(`${name} ${k === now ? "is due today" : `was due on ${fmtDate(t.deadline)}`}.`);
        }
      }
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

function checkEdit(c, p, { research = false, bare = false } = {}) {
  const head = `${L("Skill", `<input type="text" list="pct-skills" data-path="${p}.skill" value="${esc(c.skill)}" placeholder="athletics, sailing-lore" class="pct-skill">`)}
    ${L("DC", F.num(`${p}.dc`, c.dc, "", "pct-dc"))}`;
  if (bare) return head;
  return `${head}
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

/** A due date on a quest. */
function dueChip(date, open = true) {
  const k = dkey(date);
  if (k === null) return "";
  const now = dkey(today());
  const cls = !open ? "" : k < now ? "pct-closed" : k === now ? "pct-today" : "";
  return `<span class="pct-date-chip ${cls}">${k < now ? "Was due" : k === now ? "Due today" : "Due"} ${esc(fmtDate(date))}</span>`;
}

const GOAL_ICON = { open: "fa-regular fa-square", done: "fa-solid fa-square-check", failed: "fa-solid fa-square-xmark" };

/** The quest's picture, status, category, giver, location and due date, shared by the GM's and the players' views. */
function questHead(q, { gm }) {
  const giver = gm
    ? q.giver
      ? `<div class="pct-npc" data-drop="giver">${q.giver.img ? `<img src="${esc(q.giver.img)}" alt="">` : ""}<span><span class="pct-k">Given by</span> <strong>${esc(q.giver.name)}</strong></span>${A("pctQClear", "fa-solid fa-xmark", { tip: "Unlink", data: { path: "giver" } })}</div>`
      : q.giverText ? `<span><span class="pct-k">Given by</span> ${esc(q.giverText)}</span>` : ""
    : q.giver ? `<div class="pct-npc">${q.giver.img ? `<img src="${esc(q.giver.img)}" alt="">` : ""}<span><span class="pct-k">Given by</span> <strong>${esc(q.giver.name)}</strong></span></div>` : "";
  const open = q.status === "active" || q.status === "lead";
  const facts = [
    `<span class="pct-chip pct-qs-${esc(q.status)}">${esc(QSTATUS_LABEL[q.status] ?? q.status)}</span>`,
    q.category ? `<span class="pct-chip">${esc(q.category)}</span>` : "",
    giver,
    q.location ? `<span><span class="pct-k">Where</span> ${esc(q.location)}</span>` : "",
    dueChip(q.deadline, open),
  ].filter(Boolean).join("");
  return `<div class="pct-qhead">${q.img ? `<img class="pct-qimg" src="${esc(q.img)}" alt="">` : ""}<div class="pct-line">${facts}</div></div>`;
}

/** Text only the GM sees on a quest, in a box marked as such. */
const gmBox = (text) => `<div class="pct-gm pct-gmbox"><span class="pct-gmtag" data-tooltip="Only you see this"><i class="fa-solid fa-eye-slash"></i>GM</span><span>${para(text)}</span></div>`;

/**
 * An objective or step as one line: state box, text, optional, count, steps and (GM) link chips. The GM's box is a
 * button: click done, right-click failed.
 */
function goalLine(g, path, { gm, steps = null, mode = "all", tick = false, party = false, counts = false }) {
  const can = tick && (g.state === "open" || (g.state === "done" && g.doneBy === "player"));
  const box = gm
    ? A("pctQState", GOAL_ICON[g.state] ?? GOAL_ICON.open, { tip: "Click: done or open. Right-click: failed or open.", data: { goal: g.id }, cls: `pct-qbox pct-q-${g.state}` })
    : can
      ? A("pctQTick", GOAL_ICON[g.state] ?? GOAL_ICON.open, { tip: g.state === "open" ? (party ? "Mark done" : "Mark done. The GM is told.") : "Mark open again", data: { goal: g.id, to: g.state === "open" ? "done" : "open" }, cls: `pct-qbox pct-q-${g.state}` })
      : `<i class="pct-qbox pct-q-${esc(g.state)} ${GOAL_ICON[g.state] ?? GOAL_ICON.open}" ${g.state === "done" && g.doneBy === "gm" && tick ? `data-tooltip="Marked by the GM"` : ""}></i>`;
  const count = g.count !== null && g.count !== undefined
    ? gm || counts ? stepper(`${path}.have`, num(g.have), { fmt: (v) => `${v} of ${g.count}` }) : `<span class="pct-chip">${num(g.have)} of ${g.count}</span>`
    : "";
  let stepNote = "";
  if (steps && steps.length) {
    const sp = stepProgress({ mode }, steps);
    stepNote = `<span class="pct-chip" data-tooltip="${mode === "any" ? "Done when any one step is done" : "Done when every step not marked optional is done"}">${mode === "any" ? `any one of ${steps.length}` : `${sp.done} of ${sp.of} steps`}${sp.complete && g.state === "open" ? ", ready to mark done" : ""}</span>`;
  }
  let link = "";
  if (gm && g.link?.tid) {
    const ls = linkState(g.link, Store.data.trackers);
    link = `<span class="pct-chip pct-qlinkchip ${ls.met ? "pct-met" : ""}" data-tooltip="Watching: when it ${ls.met ? "got there" : "gets there"}, you get a card"><i class="fa-solid fa-link"></i> ${esc(ls.name || "?")}: ${esc(ls.text)}</span>`;
  }
  return `${box}<span class="pct-qtext">${para(g.text) || (gm ? "<em>No text</em>" : "")}</span>${g.optional ? `<span class="pct-chip">optional</span>` : ""}${count}${stepNote}${link}`;
}

/** Quest groups (Followed leads, filed clues) opened or closed away from their default, kept in this browser. */
const FOLDS_KEY = `${MOD}.folds`;
const folds = (() => {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(FOLDS_KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
})();
const foldOpen = (key, byDefault) => (Object.hasOwn(folds, key) ? !!folds[key] : byDefault);
function onFoldToggle(ev) {
  const d = ev.target;
  if (!(d instanceof HTMLDetailsElement) || !d.dataset.pctFold) return;
  const key = d.dataset.pctFold;
  const byDefault = d.dataset.foldDefault === "open";
  if (d.open === foldOpen(key, byDefault)) return;
  if (d.open === byDefault) delete folds[key];
  else folds[key] = d.open;
  try {
    localStorage.setItem(FOLDS_KEY, JSON.stringify(folds));
  } catch {
    /* no storage: it goes back to its default next time */
  }
}

/** A goal of a quest by id, with a heading for its clue group: the objective, or "objective: step". */
function goalHeading(q, id) {
  for (const o of q.objectives ?? []) {
    if (o.id === id) return { g: o, label: shortText(o.text, 70) || "(no text)" };
    for (const st of o.steps ?? []) if (st.id === id) return { g: st, label: `${shortText(o.text, 40) || "(no text)"}: ${shortText(st.text, 40) || "(no text)"}` };
  }
  return null;
}

/**
 * Clues in the order they're listed, each with its index in the stored list: shown ones newest revealed first (those
 * with no reveal time after, newest added first), then hidden ones, newest added first. A players' copy has only shown ones.
 */
function clueOrder(entries) {
  const rows = (entries ?? []).map((e, i) => ({ e, i }));
  const at = (r) => (typeof r.e.revealedAt === "number" ? r.e.revealedAt : -1);
  return {
    shown: rows.filter((r) => r.e.revealed !== false).sort((a, b) => at(b) - at(a) || b.i - a.i),
    hidden: rows.filter((r) => r.e.revealed === false).reverse(),
  };
}

/** The GM's hidden rows of a list in a fold of their own, open unless closed in this browser. */
function hiddenFold(key, rows, li, cls) {
  if (!rows.length) return "";
  return `<li class="pct-qhidden"><details data-pct-fold="${esc(key)}" data-fold-default="open"${foldOpen(key, true) ? " open" : ""}><summary>Hidden (${rows.length})</summary><ul class="${cls}">${rows.map(li).join("")}</ul></details></li>`;
}

/** The quest's objectives (with their steps), clues, leads and rewards. `gm` adds eyes, notes and controls;
 * `open` names the sections the GM is editing in place, which show their editor instead. */
function questBody(q, { gm, party = false, all = [], open = new Set(), readOnly = false, pick = null }) {
  // The GM's reveal-link tools: while picking parts for a link, a toggle in front of each part; otherwise a link
  // icon at the end of each row (shown on hover) to drag or click (copy).
  const can = gm && !readOnly && game.user.isGM;
  const rl = (id) => (can && pick ? rlTool(id, pick) : "");
  const rlEnd = (id) => (can && !pick ? rlTool(id, null) : "");
  const tick = !readOnly && !gm && !game.user.isGM && ["active", "lead"].includes(q.status) && (!!game.settings.get(MOD, "playerTicks") || partyTicks(q));
  // Party ticks send the GM no card; the party's own editor view can count progress too.
  const own = partyTicks(q);
  const objectives = () => q.objectives.map((o, i) => {
    const p = `objectives.${i}`;
    const steps = o.steps.map((st, j) => `<li class="pct-q-${esc(st.state)}"${drop(st.id)}>${gm ? eye(`${p}.steps.${j}`, st.revealed) : ""}${rl(st.id)}${goalLine(st, `${p}.steps.${j}`, { gm, tick, party: own, counts: party })}${filedChip(st.id)}${rlEnd(st.id)}${gm && st.gm ? gmBox(st.gm) : ""}</li>`).join("");
    return `<li class="pct-q-${esc(o.state)}"><div class="pct-qrow"${drop(o.id)}>${gm ? eye(p, o.revealed) : ""}${rl(o.id)}${goalLine(o, p, { gm, steps: o.steps, mode: o.mode, tick, party: own, counts: party })}${filedChip(o.id)}${rlEnd(o.id)}</div>
        ${gm && o.gm ? gmBox(o.gm) : ""}
        ${steps ? `<ul class="pct-qsteps"><li class="pct-k">${o.mode === "any" ? "Any one of these" : "All of these"}</li>${steps}</ul>` : ""}</li>`;
  }).join("");
  // Who can file clues: the GM, and players who can tick (or on their party quest), by dragging onto goals.
  const sortable = (gm && can) || tick;
  const drop = (id) => (sortable ? ` data-goal-drop="${esc(id)}"` : "");
  const clues = clueOrder(q.entries);
  const clueLi = ({ e, i }) => {
    const hiddenUnder = gm && e.revealed === false && e.under ? goalHeading(q, e.under) : null;
    const grip = (gm && can) || (tick && e.revealed !== false) ? `<span class="pct-clue-grip" draggable="true" data-clue="${esc(e.id)}" data-tooltip="Drag onto an objective or step"><i class="fa-solid fa-grip-vertical"></i></span>` : "";
    return `<li>${gm ? eye(`entries.${i}`, e.revealed) : ""}${rl(e.id)}${e.date ? `<span class="pct-date-chip">${esc(fmtDate(e.date))}</span>` : ""}<span>${e.by ? `<strong class="pct-entry-by">${esc(e.by)}</strong> ` : ""}${para(e.text)}</span>${grip}${hiddenUnder ? `<span class="pct-chip pct-qunder" data-tooltip-text="${esc(hiddenUnder.label)}"><i class="fa-solid fa-folder"></i> ${esc(shortText(hiddenUnder.label, 24))}</span>` : ""}${rlEnd(e.id)}</li>`;
  };
  const unsorted = [], groups = new Map();
  for (const r of clues.shown) {
    const h = r.e.under ? goalHeading(q, r.e.under) : null;
    if (!h) unsorted.push(r);
    else {
      if (!groups.has(r.e.under)) groups.set(r.e.under, { h, rows: [] });
      groups.get(r.e.under).rows.push(r);
    }
  }
  const groupHtml = [...groups].map(([gid, { h, rows }]) => {
    const key = `g:${q.id}:${gid}`;
    // A finished objective's or step's clues start folded away.
    const open = h.g.state !== "done" && h.g.state !== "failed";
    return `<li class="pct-qgroup"><details data-pct-fold="${esc(key)}" data-fold-default="${open ? "open" : "closed"}"${foldOpen(key, open) ? " open" : ""}${drop(gid)}><summary>${esc(h.label)} <span class="pct-k">${rows.length}</span></summary><ul class="pct-qjournal">${rows.map(clueLi).join("")}</ul></details></li>`;
  }).join("");
  const top = unsorted.map(clueLi).join("") + groupHtml;
  const entries = top + hiddenFold(`h:${q.id}:entries`, clues.hidden, clueLi, "pct-qjournal");
  // How many clues are filed under each goal (a players' copy has only what they can see).
  const filedChip = (id) => {
    const n = (q.entries ?? []).filter((e) => e.under === id).length;
    return n ? `<span class="pct-chip pct-qclues" data-tooltip="Clues filed under it"><i class="fa-solid fa-magnifying-glass"></i> ${n}</span>` : "";
  };
  const leadRows = q.leads.map((l, i) => ({ l, i }));
  // GM data names who followed by user id or "gm"; a players' copy by "gm" or "player".
  const followBox = (l) => {
    const on = !!l.followed;
    const icon = on ? "fa-solid fa-square-check" : "fa-regular fa-square";
    if (l.revealed === false) return "";
    if (gm && can) return A("pctLeadFollow", icon, { tip: on ? "Mark not followed" : "Mark followed", data: { lead: l.id, to: on ? "open" : "done" }, cls: "pct-qbox pct-lead-box" });
    if (tick && (!on || l.followedBy !== "gm")) return A("pctLeadFollow", icon, { tip: on ? "Mark not followed" : own ? "Mark followed" : "Mark followed. The GM is told.", data: { lead: l.id, to: on ? "open" : "done" }, cls: "pct-qbox pct-lead-box" });
    return on ? `<i class="pct-qbox pct-lead-box ${icon}" ${tick ? `data-tooltip="Marked by the GM"` : ""}></i>` : "";
  };
  const leadLi = ({ l, i }) => {
    const to = gm ? all.find((x) => x.id === l.to && x.kind === "quest") : l.to;
    const linked = gm ? (l.clues ?? []).map((id) => (q.entries ?? []).find((e) => e.id === id)).filter(Boolean) : [];
    const go = (to ? `<a class="pct-qlink" data-action="pctQuestGo" data-qid="${esc(to.id)}"><i class="fa-solid fa-arrow-right"></i> ${esc(to.name)}${gm && !to.revealed ? " (hidden)" : ""}</a>` : "")
      + linked.map((clue) => `<span class="pct-qlink" data-tooltip-text="${esc(clue.text)}"><i class="fa-solid fa-magnifying-glass"></i> ${esc(shortText(clue.text, 30) || "clue")}${clue.revealed ? "" : " (hidden)"}</span>`).join("");
    return `<li${l.followed ? ` class="pct-followed"` : ""}>${gm ? eye(`leads.${i}`, l.revealed) : ""}${rl(l.id)}${followBox(l) || `<i class="fa-solid fa-signs-post"></i>`}<span>${para(l.text)}</span>${go}${rlEnd(l.id)}${gm && l.gm ? gmBox(l.gm) : ""}</li>`;
  };
  const followed = leadRows.filter((r) => r.l.followed && r.l.revealed !== false);
  const leads = leadRows.filter((r) => !r.l.followed && r.l.revealed !== false).map(leadLi).join("") + hiddenFold(`h:${q.id}:leads`, leadRows.filter((r) => r.l.revealed === false), leadLi, "pct-qleads")
    + (followed.length ? `<li class="pct-qfollowed"><details data-pct-fold="${esc(`f:${q.id}`)}" data-fold-default="closed"${foldOpen(`f:${q.id}`, false) ? " open" : ""}><summary>Followed (${followed.length})</summary><ul class="pct-qleads">${followed.map(leadLi).join("")}</ul></details></li>` : "");
  const rewards = q.rewards.map((r, i) => {
    const actor = r.actor ? `<a class="pct-npc" data-action="pctOpenActor" data-uuid="${esc(r.actor.uuid)}" data-tooltip="Open the sheet">${r.actor.img ? `<img src="${esc(r.actor.img)}" alt="">` : ""}<strong>${esc(r.actor.name)}</strong></a>` : "";
    return `<li>${gm ? eye(`rewards.${i}`, r.revealed) : ""}${rl(r.id)}<i class="fa-solid fa-gem"></i><span>${para(r.text)}</span>${actor}${rlEnd(r.id)}${gm && r.gm ? gmBox(r.gm) : ""}</li>`;
  }).join("");
  const notes = partyNotes(q, { gm, readOnly });
  const goalsHtml = objectives();
  if (!gm && !party) {
    return `${goalsHtml ? `<div class="pct-sub">Objectives</div><ul class="pct-qgoals">${goalsHtml}</ul>` : ""}
      ${entries ? `<div class="pct-sub"${drop("")}>Clues</div><ul class="pct-qjournal"${drop("")}>${entries}</ul>` : ""}
      ${leads ? `<div class="pct-sub">Leads</div><ul class="pct-qleads">${leads}</ul>` : ""}
      ${rewards ? `<div class="pct-sub">Rewards</div><ul class="pct-qrewards">${rewards}</ul>` : ""}
      ${notes}`;
  }
  const section = (sec, title, list, add, html, cls) => {
    const editing = open.has(sec);
    return `<div class="pct-qsec" data-sec="${sec}"><div class="pct-sub"${sec === "entries" ? drop("") : ""}>${esc(title)}
        ${A("pctQSec", editing ? "fa-solid fa-check" : "fa-solid fa-pen", { tip: editing ? "Done" : `Edit ${title.toLowerCase()}`, data: { sec }, cls: `pct-qsec-btn ${editing ? "pct-on" : ""}` })}
        ${A("pctAdd", "fa-solid fa-plus", { tip: `Add ${add}`, data: { list, sec }, cls: "pct-qsec-btn" })}</div>
      ${editing ? `<div class="pct-qsec-edit">${(party ? QEDIT_PARTY : QEDIT)[sec](q)}</div>` : html ? `<ul class="${cls}"${sec === "entries" ? drop("") : ""}>${html}</ul>` : `<p class="pct-hint">None yet.</p>`}</div>`;
  };
  const from = all.flatMap((x) => (x.kind === "quest" && x.id !== q.id ? x.leads.filter((l) => l.to === q.id).map((l) => ({ x, l })) : []));
  const fromHtml = gm && from.length ? `<div class="pct-qfrom"><span class="pct-k">Pointed to by</span>${from.map(({ x, l }) => `<a class="pct-qlink" data-action="pctQuestGo" data-qid="${esc(x.id)}" data-tooltip-text="${esc(l.text)}">${l.revealed ? "" : `<i class="fa-solid fa-eye-slash"></i> `}${esc(x.name)}</a>`).join("")}</div>` : "";
  return `${section("objectives", "Objectives", "objectives", "an objective", goalsHtml, "pct-qgoals")}
    ${section("entries", "Clues", "entries", "a clue", entries, "pct-qjournal")}
    ${section("leads", "Leads", "leads", "a lead", leads, "pct-qleads")}${fromHtml}
    ${section("rewards", "Rewards", "rewards", "a reward", rewards, "pct-qrewards")}
    ${notes}`;
}

/** The quest's Party Journal: anyone writes an entry, signed; its author or the GM deletes it. */
function partyNotes(q, { gm, readOnly = false }) {
  const preview = readOnly || (!gm && game.user.isGM);
  const isClue = (n) => (q.entries ?? []).some((e) => e.from === n.id);
  const toClue = (n) => (!gm ? "" : isClue(n)
    ? `<i class="fa-solid fa-magnifying-glass pct-qnote-kept" data-tooltip="A clue"></i>`
    : A("pctQNoteJournal", "fa-solid fa-magnifying-glass", { tip: "Make it a clue: dated today, revealed, signed with this name", data: { note: n.id } }));
  const rows = (q.pnotes ?? []).map((n) => `<li><strong>${esc(n.name)}</strong><span>${para(n.text)}</span>${toClue(n)}${!preview && (gm || n.by === game.user.id) ? A("pctQNoteDel", "fa-solid fa-xmark", { tip: "Delete this entry", data: { note: n.id } }) : ""}</li>`).join("");
  return `<div class="pct-qnotes"><div class="pct-sub">Party Journal</div>${rows ? `<ul>${rows}</ul>` : `<p class="pct-hint">Nothing yet.${gm ? "" : " Anything the party wants to remember goes here."}</p>`}
      ${preview ? "" : `<div class="pct-qnote-add"><textarea rows="2" placeholder="${gm ? "An entry, signed GM" : "Write in the Party Journal"}" maxlength="${NOTE_LEN}"></textarea>${A("pctQNoteAdd", "fa-solid fa-plus", { label: "Add" })}</div>`}</div>`;
}

/** A party quest in a player's window: the same sections as the GM's, with the editors players may use. */
function questParty(t, open) {
  const detailsOpen = open.has("details");
  const details = detailsOpen
    ? `<div class="pct-qsec-edit">${QEDIT_PARTY.details(t)}</div>`
    : `${t.desc ? `<p class="pct-desc">${para(t.desc)}</p>` : ""}${questHead(t, { gm: false })}`;
  return `${partyLine(t, false)}
    <div class="pct-qsec" data-sec="details"><div class="pct-sub">Details ${A("pctQSec", detailsOpen ? "fa-solid fa-check" : "fa-solid fa-pen", { tip: detailsOpen ? "Done" : "Edit the name, summary, status, category, giver, place and due date", data: { sec: "details" }, cls: `pct-qsec-btn ${detailsOpen ? "pct-on" : ""}` })}</div>${details}</div>
    ${questBody(t, { gm: false, party: true, open })}`;
}

/** Who made a party quest, above it. */
function partyLine(t, gm) {
  if (!t.party) return "";
  const by = t.party.by === game.user.id ? "you" : t.party.name || "a player";
  const tools = gm
    ? `<span class="pct-partytools">${t.category !== "Main" ? A("pctQMain", "fa-solid fa-flag", { label: "Make it a main quest", tip: "Set its category to Main. It stays a party quest." }) : ""}${A("pctQTake", "fa-solid fa-hand", { label: "Take it over", tip: "Make it your quest: you can add hidden parts and GM notes, and players go back to ticking and writing in the Party Journal" })}</span>`
    : "";
  return `<p class="pct-hint pct-partyline"><i class="fa-solid fa-users"></i> <span>A party quest, made by ${esc(by)}. ${gm ? (partyQuestsOn() ? "Players can edit it." : "Players can't edit it while \"Players can make quests\" is off.") : "Anyone in the party can edit it."}</span>${tools}</p>`;
}

/** The GM's quest, with the details and GM notes editable in place too. */
function questGM(t, open, pick = null) {
  const details = open.has("details")
    ? `<div class="pct-qsec-edit">${QEDIT.details(t)}</div>`
    : `${t.desc ? `<p class="pct-desc">${para(t.desc)}</p>` : ""}${questHead(t, { gm: true })}`;
  const notesOpen = open.has("notes");
  const detailsOpen = open.has("details");
  return `${partyLine(t, true)}<div class="pct-qsec" data-sec="details"><div class="pct-sub">Details ${A("pctQSec", detailsOpen ? "fa-solid fa-check" : "fa-solid fa-pen", { tip: detailsOpen ? "Done" : "Edit the name, summary, status, category, giver, location, due date and picture", data: { sec: "details" }, cls: `pct-qsec-btn ${detailsOpen ? "pct-on" : ""}` })}</div>${details}</div>
    ${pick ? rlBar(t, pick) : ""}${questBody(t, { gm: true, all: Store.data.trackers, open, pick })}
    <div class="pct-qsec" data-sec="notes"><div class="pct-sub">GM notes ${A("pctQSec", notesOpen ? "fa-solid fa-check" : "fa-solid fa-pen", { tip: notesOpen ? "Done" : "Edit GM notes", data: { sec: "notes" }, cls: `pct-qsec-btn ${notesOpen ? "pct-on" : ""}` })}</div>
      ${notesOpen ? `<div class="pct-qsec-edit">${QEDIT.notes(t)}</div>` : t.notes ? gmBox(t.notes) : `<p class="pct-hint">None.</p>`}</div>`;
}

/* ------------------------------------------------------------------ */
/* GM view of each kind                                                */
/* ------------------------------------------------------------------ */

/** A row of marks: `have` filled out of `of` (more than `of` shows as extra filled marks). */
function pips(have, of, cls) {
  const n = Math.max(num(have), num(of));
  if (!n) return "";
  return `<span class="pct-pips ${cls}">${Array.from({ length: Math.min(n, 30) }, (_, i) => `<i class="${i < num(have) ? "fa-solid" : "fa-regular"} fa-circle"></i>`).join("")}</span>`;
}

/** The counts of a skill challenge as marks, for the GM and for players who may see them. */
function challengeTally(successes, goal, failures, limit, { numbers = true } = {}) {
  const n = (v, of) => (numbers ? `<span>${num(v)}${of ? ` of ${of}` : ""}</span>` : "");
  return `<div class="pct-tally">
      <span class="pct-tally-row"><span class="pct-k">Successes</span>${pips(successes, goal, "pct-pips-ok")}${n(successes, goal)}</span>
      <span class="pct-tally-row"><span class="pct-k">Failures</span>${pips(failures, limit, "pct-pips-bad")}${n(failures, limit)}</span>
    </div>`;
}

const GM = {
  quest(t) {
    return questGM(t, new Set());
  },

  challenge(t) {
    const goal = nullNum(t.goal), limit = nullNum(t.limit), rounds = nullNum(t.rounds);
    const st = challengeStatus(t);
    const approaches = t.approaches.map((a, i) => {
      const uses = nullNum(a.uses);
      const usedChip = uses !== null ? `<span class="pct-chip" data-tooltip="Times used, of the most allowed">${num(a.used)} / ${uses} uses</span>` : num(a.used) ? `<span class="pct-chip" data-tooltip="Times used">used ${num(a.used)}</span>` : "";
      return `<div class="pct-obstacle pct-approach ${uses !== null && num(a.used) >= uses ? "pct-done" : ""}">
          <div class="pct-line">${eye(`approaches.${i}`, a.revealed)}<strong>${a.label ? esc(a.label) : `<em>No name for players</em>`}</strong>${usedChip}</div>
          ${a.gm ? `<p class="pct-gm">${para(a.gm)}</p>` : ""}
          ${a.critFail ? `<p class="pct-gm"><span class="pct-k">Critical failure</span> ${para(a.critFail)}</p>` : ""}
          ${checkRows(t, a.id, a.checks.filter((c) => c.skill), { gm: true })}
        </div>`;
    }).join("");
    const log = (t.log ?? []).slice(-12).reverse().map((x) => `<li><span class="pct-chip">R${num(x.round)}</span> ${x.name ? `<strong>${esc(x.name)}</strong> ` : ""}${esc(DEGREE_LABEL[x.outcome] ?? x.outcome)}${x.skill ? ` (${esc(skillLabel(x.skill))})` : ""} at ${esc(x.what)}: ${[x.s ? signed(x.s) + " S" : "", x.f ? signed(x.f) + " F" : ""].filter(Boolean).join(", ") || "no change"}</li>`).join("");
    return `<div class="pct-line">
        ${stepper("successes", num(t.successes), { label: "Successes", fmt: (v) => (goal ? `${v} / ${goal}` : v) })}
        ${stepper("failures", num(t.failures), { label: "Failures", fmt: (v) => (limit ? `${v} / ${limit}` : v) })}
        ${rounds || t.oncePerRound ? stepper("round", num(t.round), { label: "Round", fmt: (v) => (rounds ? `${v} of ${rounds}` : v) }) : ""}
        ${rounds || t.oncePerRound ? A("pctEndRound", "fa-solid fa-forward", { label: "End round" }) : ""}
        ${st ? `<span class="pct-chip pct-status-${st}">${STATUS_TEXT[st]}</span>` : ""}
        <span class="pct-push">${A("pctChallengeCheck", "fa-solid fa-dice-d20", { label: "Check", tip: "Call for a check on the fly: send characters a roll button, or roll for them now" })}
        ${A("pctChallengePost", "fa-solid fa-list", { label: "Post skills", tip: "Post to chat the skills that could help, with no approaches and no DCs. Players say what they do.", data: { mode: "skills" } })}
        ${A("pctChallengePost", "fa-solid fa-share-from-square", { label: "Post options", tip: "Post the revealed approaches to chat by their players' names, with roll buttons. No DCs are shown.", data: { mode: "options" } })}</span>
      </div>
      ${challengeTally(t.successes, goal, t.failures, limit, { numbers: false })}
      ${t.onSuccess ? `<p class="pct-gm"><span class="pct-k">On success</span> ${para(t.onSuccess)}</p>` : ""}
      ${t.onFailure ? `<p class="pct-gm"><span class="pct-k">On failure</span> ${para(t.onFailure)}</p>` : ""}
      ${t.thresholds.length ? `<div class="pct-sub">Along the way</div>${thresholdRows(t.thresholds, t.successes, { gm: true, path: "thresholds", unit: " S" })}` : ""}
      <div class="pct-sub">Approaches</div>
      ${approaches || `<p class="pct-hint">No approaches yet. Add them under Edit.</p>`}
      ${log ? `<details class="pct-log"><summary>Results (${(t.log ?? []).length})</summary><ul>${log}</ul></details>` : ""}`;
  },

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

/**
 * A goal's fields in the editor: what players see, the GM's note, optional, a count, and (given the quest) its link
 * and reveals.
 */
const goalEdit = (g, p, what, t) => `<div class="pct-line">${L(what, F.text(`${p}.text`, g.text, what === "Step" ? "Get disguises" : "Gain access to the castle"), "pct-grow")}${L("Count", F.num(`${p}.count`, g.count, "none", "pct-dc"))}${F.bool(`${p}.optional`, g.optional, "Optional")}</div>
    ${L("GM only", F.text(`${p}.gm`, g.gm, "What it really takes, what it turns up"), "pct-block")}${t ? `${linkEdit(g, p)}${onDoneEdit(g, p, t)}` : ""}`;

/** "Done when the Alarm clock is full": a goal watching another tracker. */
function linkEdit(g, p) {
  const others = Store.data.trackers.filter((x) => x.kind !== "quest" && LINK_CONDS[x.kind]);
  const t = others.find((x) => x.id === g.link?.tid) ?? null;
  const pick = L("Watch", F.select(`${p}.link.tid`, t ? t.id : "", [["", "nothing"], ...others.map((x) => [x.id, `${KIND_INFO[x.kind].label}: ${x.name}`])]));
  if (!t) return `<div class="pct-line pct-qlinkedit">${pick}</div>`;
  const cond = linkCond(g.link, t);
  const conds = LINK_CONDS[t.kind];
  const how = conds.length > 1 ? F.select(`${p}.link.cond`, cond, conds) : `<span>${esc(conds[0][1])}</span>`;
  const extra = cond === "atLeast"
    ? F.num(`${p}.link.at`, g.link.at, "value", "pct-dc")
    : cond === "entry" ? F.select(`${p}.link.entry`, g.link.entry ?? "", [["", "pick an entry"], ...(t.entries ?? []).map((e) => [e.id, shortText(e.label, 40) || "(untitled)"])]) : "";
  return `<div class="pct-line pct-qlinkedit">${pick}${how}${extra}<span class="pct-hint">When it does, you get a card offering to mark this done.</span></div>`;
}

/** <details> boxes the GM has open in an editor, kept across redraws in this window. */
const openDetails = new Set();

/** A lead's clues to reveal with it, as checkboxes in a fold. */
function leadCluesEdit(l, p, t) {
  const key = `${t.id}:${l.id}:clues`;
  const picked = new Set(l.clues ?? []);
  const boxes = (t.entries ?? []).map((e) => `<label class="pct-chk"><input type="checkbox" data-path="${p}.clues" data-type="idlist" value="${esc(e.id)}" ${picked.has(e.id) ? "checked" : ""}> <span>${esc(shortText(e.text, 70) || "(no text)")}${e.revealed ? "" : " (hidden)"}</span></label>`).join("");
  return `<details class="pct-ondone" data-key="${esc(key)}" ${openDetails.has(key) ? "open" : ""}><summary>Reveals clues (${picked.size})</summary>${boxes || `<p class="pct-hint">No clues in this quest yet.</p>`}</details>`;
}

/** Which rows of the quest finishing this goal offers to reveal. */
function onDoneEdit(g, p, t) {
  const rows = [];
  for (const o of t.objectives) {
    if (o.id !== g.id) rows.push(o);
    for (const st of o.steps) if (st.id !== g.id) rows.push(st);
  }
  rows.push(...t.entries, ...t.leads, ...t.rewards);
  const key = `${t.id}:${g.id}`;
  const picked = new Set(g.onDone ?? []);
  const boxes = rows.map((r) => `<label class="pct-chk"><input type="checkbox" data-path="${p}.onDone" data-type="idlist" value="${esc(r.id)}" ${picked.has(r.id) ? "checked" : ""}> <span>${esc(rowLabel(t, r.id))}</span></label>`).join("");
  return `<details class="pct-ondone" data-key="${esc(key)}" ${openDetails.has(key) ? "open" : ""}><summary>When it's done, offer to reveal (${picked.size})</summary>${boxes || `<p class="pct-hint">Nothing else in this quest yet.</p>`}</details>`;
}

/** Quest editors, one per section, so the GM can edit a part without opening the whole quest. */
const QEDIT = {
  meta(t) {
    const cats = [...new Set(["Main", "Side", ...Store.data.trackers.filter((x) => x.kind === "quest").map((x) => x.category).filter(Boolean)])];
    const giver = t.giver
      ? `<div class="pct-npc" data-drop="giver">${t.giver.img ? `<img src="${esc(t.giver.img)}" alt="">` : ""}<strong>${esc(t.giver.name)}</strong>${A("pctQClear", "fa-solid fa-xmark", { tip: "Unlink", data: { path: "giver" } })}</div>`
      : `<div class="pct-npc pct-drop" data-drop="giver"><i class="fa-solid fa-user-plus"></i> Drop the quest giver here</div>`;
    return `<div class="pct-line">${L("Status", F.select("status", t.status, QSTATUS.map((x) => [x, QSTATUS_LABEL[x]])))}
        ${L("Category", `<input type="text" list="pct-qcats" data-path="category" value="${esc(t.category)}" placeholder="Main" class="pct-w8">`)}<datalist id="pct-qcats">${cats.map((c) => `<option value="${esc(c)}">`).join("")}</datalist>
        ${L("Due", F.date("deadline", t.deadline))}${F.bool("showDue", t.showDue !== false, "Players see the due date", "Off: a secret deadline. You still get the reminder.")}</div>
      <div class="pct-line">${giver}${t.giver ? "" : L("or name them", F.text("giverText", t.giverText, "Maud Holloway"), "pct-grow")}${L("Where", F.text("location", t.location, "Ridge Road"), "pct-grow")}</div>
      <div class="pct-line">${L("Picture", F.text("img", t.img, "path to an image"), "pct-grow")}${A("pctQImg", "fa-solid fa-file-image", { tip: "Choose a picture" })}</div>`;
  },
  details: (t) => `<div class="pct-edit">${L("Name", F.text("name", t.name), "pct-block")}
      ${L("Players see", F.area("desc", t.desc, "The quest's summary, shown to players when you reveal it"), "pct-block")}${QEDIT.meta(t)}</div>`,
  notes: (t) => F.area("notes", t.notes, "Only the GM sees these", 4),
  objectives: (t) => listEditor("objectives", t.objectives, (o, p) => `${goalEdit(o, p, "Objective", t)}
      <div class="pct-line"><span class="pct-k">Steps</span>${L("Done when", F.select(`${p}.mode`, o.mode, [["all", "every step is done"], ["any", "any one step is done"]]))}</div>
      <div class="pct-nested">${listEditor(`${p}.steps`, o.steps, (st, sp) => goalEdit(st, sp, "Step", t), "Step")}</div>`, "Objective"),
  entries(t) {
    const hid = (g) => (g.revealed === false ? " (hidden)" : "");
    const goals = (t.objectives ?? []).flatMap((o) => [[o.id, `${shortText(o.text, 40) || "(no text)"}${hid(o)}`], ...(o.steps ?? []).map((st) => [st.id, `\u2003${shortText(st.text, 40) || "(no text)"}${hid(st)}`])]);
    return listEditor("entries", t.entries, (e, p) => `${L("Date", F.date(`${p}.date`, e.date))}${L("Clue", F.area(`${p}.text`, e.text, "The ferrywoman saw riders cross at dusk.", 2), "pct-grow")}${goals.length ? L("Filed under", F.select(`${p}.under`, e.under ?? "", [["", "nothing"], ...goals])) : ""}`, "Clue");
  },
  leads(t) {
    const others = Store.data.trackers.filter((x) => x.kind === "quest" && x.id !== t.id);
    return listEditor("leads", t.leads, (l, p) => `<div class="pct-line">${L("Lead", F.text(`${p}.text`, l.text, "A smuggler at the docks knows a way in"), "pct-grow")}${L("Points to", F.select(`${p}.to`, l.to, [["", "nothing"], ...others.map((x) => [x.id, x.name])]))}</div>
      ${leadCluesEdit(l, p, t)}${L("GM only", F.text(`${p}.gm`, l.gm), "pct-block")}`, "Lead");
  },
  rewards: (t) => listEditor("rewards", t.rewards, (r, p) => `<div class="pct-line">${L("Reward", F.text(`${p}.text`, r.text, "200 gp and the captain's favor"), "pct-grow")}
        ${r.actor ? `<div class="pct-npc" data-drop="${p}.actor">${r.actor.img ? `<img src="${esc(r.actor.img)}" alt="">` : ""}<strong>${esc(r.actor.name)}</strong>${A("pctQClear", "fa-solid fa-xmark", { tip: "Unlink", data: { path: `${p}.actor` } })}</div>` : `<div class="pct-npc pct-drop" data-drop="${p}.actor"><i class="fa-solid fa-box-open"></i> Drop a loot actor</div>`}</div>
      ${L("GM only", F.text(`${p}.gm`, r.gm), "pct-block")}`, "Reward"),
};

/** The editors a player gets on a party quest: no GM text, links, reveals, giver actors or pictures. */
const partyGoalEdit = (g, p, what) => `<div class="pct-line">${L(what, F.text(`${p}.text`, g.text, what === "Step" ? "Get disguises" : "Find out who hired the smugglers"), "pct-grow")}${L("Count", F.num(`${p}.count`, g.count, "none", "pct-dc"))}${F.bool(`${p}.optional`, g.optional, "Optional")}</div>`;
const QEDIT_PARTY = {
  details(t) {
    // The players' copy carries a named giver as giver.name with no picture; a linked actor (with a picture) stays the GM's.
    const giverName = t.giver && !t.giver.img ? t.giver.name : "";
    return `<div class="pct-edit">${L("Name", F.text("name", t.name), "pct-block")}
      ${L("Summary", F.area("desc", t.desc, "What the quest is about"), "pct-block")}
      <div class="pct-line">${L("Status", F.select("status", t.status, QSTATUS.map((x) => [x, QSTATUS_LABEL[x]])))}
        ${L("Category", F.text("category", t.category, "Side", "pct-w8"))}${t.dueHidden ? "" : L("Due", F.date("deadline", t.deadline))}</div>
      <div class="pct-line">${t.giver?.img ? "" : L("Given by", F.text("giverText", giverName, "Maud Holloway"), "pct-grow")}${L("Where", F.text("location", t.location, "Ridge Road"), "pct-grow")}</div></div>`;
  },
  objectives: (t) => listEditor("objectives", t.objectives, (o, p) => `${partyGoalEdit(o, p, "Objective")}
      <div class="pct-line"><span class="pct-k">Steps</span>${L("Done when", F.select(`${p}.mode`, o.mode, [["all", "every step is done"], ["any", "any one step is done"]]))}</div>
      <div class="pct-nested">${listEditor(`${p}.steps`, o.steps, (st, sp) => partyGoalEdit(st, sp, "Step"), "Step")}</div>`, "Objective"),
  entries: (t) => QEDIT.entries(t),
  leads: (t) => listEditor("leads", t.leads, (l, p) => `<div class="pct-line">${L("Lead", F.text(`${p}.text`, l.text, "A smuggler at the docks knows a way in"), "pct-grow")}</div>`, "Lead"),
  rewards: (t) => listEditor("rewards", t.rewards, (r, p) => `<div class="pct-line">${L("Reward", F.text(`${p}.text`, r.text, "200 gp and the captain's favor"), "pct-grow")}</div>`, "Reward"),
};

const EDIT = {
  quest: (t) => `${QEDIT.meta(t)}
      <div class="pct-sub">Objectives. Players see each one when you reveal it; steps are revealed on their own, and revealing one shows its objective too.</div>${QEDIT.objectives(t)}
      <div class="pct-sub">Clues: what the party has learned, newest shown first. Players see each one when you reveal it.</div>${QEDIT.entries(t)}
      <div class="pct-sub">Leads: where to go next. A lead can point to another quest, and reveal a clue.</div>${QEDIT.leads(t)}
      <div class="pct-sub">Rewards. Drop a loot actor on a reward for treasure.</div>${QEDIT.rewards(t)}`,

  challenge: (t) => `<div class="pct-line">${L("Successes needed", F.num("goal", t.goal, "none"))}${L("Failures allowed", F.num("limit", t.limit, "no limit"))}${L("Rounds", F.num("rounds", t.rounds, "no limit"))}
      ${F.bool("showCount", t.showCount, "Players see the counts", "Off: players see the approaches but not how close they are")}
      ${F.bool("explain", t.explain !== false, "Proposals need what and why", "Off: players can propose with just a skill and tell you the rest at the table")}
      ${F.bool("oncePerRound", t.oncePerRound, "One check per PC per round", "Apply tells you when a character rolls a second time in a round. It doesn't stop the roll.")}</div>
    <div class="pct-sub">Each result adds</div>
    <table class="pct-cdeg"><thead><tr><th></th><th>Successes</th><th>Failures</th></tr></thead><tbody>${DEGREES.map((d) => `<tr><th>${DEGREE_LABEL[d]}</th><td>${F.num(`degrees.${d}.s`, t.degrees?.[d]?.s, "0", "pct-dc")}</td><td>${F.num(`degrees.${d}.f`, t.degrees?.[d]?.f, "0", "pct-dc")}</td></tr>`).join("")}</tbody></table>
    <div class="pct-line">${L("On success (GM only)", F.text("onSuccess", t.onSuccess, "What the party gains"), "pct-grow")}${L("On failure (GM only)", F.text("onFailure", t.onFailure, "What it costs them"), "pct-grow")}</div>
    <div class="pct-sub">Along the way, at a number of successes</div>${listEditor("thresholds", t.thresholds, (x, p) => thresholdEdit(x, p, "Successes"), "Milestone")}
    <div class="pct-sub">Approaches. Players see only the name; keep it free of spoilers.</div>
    ${listEditor("approaches", t.approaches, (a, p) => `<div class="pct-line">${L("Players see", F.text(`${p}.label`, a.label, "Search the area"), "pct-grow")}${L("Uses", F.num(`${p}.uses`, a.uses, "any", "pct-dc"))}</div>
      ${L("GM only", F.area(`${p}.gm`, a.gm, "What it really is and what it turns up", 2), "pct-block")}
      ${L("On a critical failure (GM only)", F.text(`${p}.critFail`, a.critFail, "A consequence, besides the failure"), "pct-block")}
      <div class="pct-nested">${listEditor(`${p}.checks`, a.checks, (c, cp) => checkEdit(c, cp, { bare: true }), "Skill")}</div>`, "Approach")}`,

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
  quest(p) {
    return `${questHead(p, { gm: false })}${questBody(p, { gm: false })}`;
  },

  challenge(p) {
    const tally = p.successes !== null ? challengeTally(p.successes, p.goal, p.failures, p.limit) : "";
    const status = p.status ? `<p class="pct-big">${STATUS_TEXT[p.status]}</p>` : "";
    const round = p.rounds ? `<span class="pct-chip">Round ${p.round} of ${p.rounds}</span>` : "";
    const approaches = p.approaches.map((a) => {
      const out = a.left === 0;
      return `<div class="pct-obstacle pct-approach ${out ? "pct-done" : ""}"><div class="pct-line"><strong>${esc(a.label || "Another way")}</strong>${a.left !== null ? `<span class="pct-chip">${out ? "Used up" : `${a.left} ${a.left === 1 ? "use" : "uses"} left`}</span>` : ""}</div>
          ${out ? "" : checkRows(p, a.id, a.checks, { gm: false })}</div>`;
    }).join("");
    return `${status}${round ? `<div class="pct-line">${round}</div>` : ""}${tally}${thresholdRows(p.thresholds, 0, { gm: false })}
      ${approaches ? `<div class="pct-sub">Approaches</div>${approaches}` : ""}
      <div class="pct-line">${A("pctPropose", "fa-solid fa-lightbulb", { label: "Propose an approach", tip: "Say what your character does and which skill fits. The GM approves it and sets the DC." })}</div>`;
  },

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
    case "quest": {
      const goals = p.objectives.map((o) => `<li><i class="${GOAL_ICON[o.state] ?? GOAL_ICON.open}"></i> ${esc(o.text)}${o.count !== null ? ` (${o.have} of ${o.count})` : ""}</li>`).join("");
      const latest = clueOrder(p.entries).shown[0]?.e;
      body = `<p><strong>${esc(QSTATUS_LABEL[p.status] ?? "")}</strong>${p.category ? `, ${esc(p.category)}` : ""}</p>${latest ? `<p><em>${para(latest.text)}</em></p>` : ""}${goals ? `<ul class="pct-chat-list">${goals}</ul>` : ""}`;
      break;
    }
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
    case "challenge": {
      const counts = p.successes !== null ? `<p>${p.successes}${p.goal ? ` of ${p.goal}` : ""} successes, ${p.failures}${p.limit ? ` of ${p.limit}` : ""} failures</p>` : "";
      body = `${p.status ? `<p class="pct-chat-big">${STATUS_TEXT[p.status]}</p>` : ""}${counts}${p.rounds ? `<p>Round ${p.round} of ${p.rounds}</p>` : ""}${reachedList(p.thresholds)}`;
      break;
    }
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
/** Tell other modules (Bayard's Campaign Journal) that trackers or this user's seen marks changed, once per burst. */
let changedTimer = null;
function changedSoon() {
  clearTimeout(changedTimer);
  changedTimer = setTimeout(() => {
    repaintQuestLinks();
    Hooks.callAll(`${MOD}.changed`);
  }, 150);
}

function refresh() {
  clearTimeout(refreshTimer);
  changedSoon();
  refreshTimer = setTimeout(() => {
    renderPanel();
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

/* ------------------------------------------------------------------ */
/* Tracked-quest panel                                                 */
/* ------------------------------------------------------------------ */

const PIN_KEY = `${MOD}.pins`, PANEL_KEY = `${MOD}.panel`, PANEL_MAX = 3;
function readJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* no storage: it lasts until the page reloads */
  }
}
/** The quests this user pinned, kept in this browser. */
function pinned() {
  const v = readJSON(PIN_KEY, []);
  return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
}

/** What the panel shows, in order: the party's focus, then this user's pins. Open quests only, at most three. */
function panelQuests(quests, pins) {
  const byId = new Map(quests.map((q) => [q.id, q]));
  const ids = [...quests.filter((q) => q.focus).map((q) => q.id), ...pins];
  return [...new Set(ids)].map((id) => byId.get(id)).filter((q) => q && OPEN_Q.includes(q.status)).slice(0, PANEL_MAX);
}

/** Pin a quest to this user's panel, or unpin it. Pins of quests that are gone or finished don't count. */
function togglePin(id) {
  const pins = pinned();
  if (pins.includes(id)) {
    writeJSON(PIN_KEY, pins.filter((x) => x !== id));
  } else {
    const open = visibleTrackers().filter((t) => t.kind === "quest" && OPEN_Q.includes(t.status));
    const live = new Set(open.map((t) => t.id));
    const kept = pins.filter((x) => live.has(x));
    const focus = open.filter((t) => t.focus && !kept.includes(t.id)).map((t) => t.id);
    if (focus.includes(id)) return void ui.notifications.info("That quest is the party's focus, so it's in the panel already.");
    if (kept.length + focus.length >= PANEL_MAX) {
      ui.notifications.warn(`The quest panel shows ${PANEL_MAX} quests${focus.length ? `, ${focus.length} of them the party's focus` : ""}. Unpin one first.`);
      return;
    }
    writeJSON(PIN_KEY, [...kept, id]);
    if (!game.settings.get(MOD, "questPanel")) ui.notifications.info("Pinned. The quest panel is turned off for you in this module's settings.");
  }
  refresh();
}

/** The focus star (GM) and the pin, for a quest's card header. */
function pinTools(t, gm) {
  const on = pinned().includes(t.id);
  const out = [];
  if (gm) out.push(A("pctQFocus", t.focus ? "fa-solid fa-star" : "fa-regular fa-star", { tip: t.focus ? "The party's focus: it shows in everyone's quest panel. Click to stop." : "Make this the party's focus: it shows in everyone's quest panel while it's active or a lead.", cls: t.focus ? "pct-on" : "" }));
  if (on || OPEN_Q.includes(t.status)) out.push(A("pctQPin", "fa-solid fa-thumbtack", { tip: on ? "Pinned to your quest panel. Click to unpin." : "Pin to your quest panel", cls: on ? "pct-on" : "" }));
  return out.join("");
}

/** The GM marks a goal done or open (click), or failed or open (right click), then gets the card if there's anything to offer. */
async function setGoalState(tid, { path = null, goal = null }, right = false) {
  const done = await mutateTracker(tid, (t) => {
    const g = goal ? findGoal(t, goal)?.g : foundry.utils.getProperty(t, path);
    if (!g) return;
    const to = right ? (g.state === "failed" ? "open" : "failed") : g.state === "done" ? "open" : "done";
    g.state = to;
    g.doneBy = to === "open" ? null : "gm";
    return to === "done" ? g.id : undefined;
  }, { notify: false });
  if (done) await promptCompletion(Store.get(tid), done);
}

let panelEl = null;
const qpBtn = (qp, icon, tip, data = {}) => `<a class="pct-qp-btn" data-qp="${qp}" ${dataAttrs(data)} data-tooltip="${esc(tip)}"><i class="${icon}"></i></a>`;

/** One open objective or step: a box to tick, its text, its count. The GM also sees what players don't. */
function panelGoal(q, g, tick, steps = null) {
  const gm = game.user.isGM;
  const box = tick
    ? `<a class="pct-qp-box" data-qp="tick" data-tid="${esc(q.id)}" data-goal="${esc(g.id)}" data-tooltip="${gm ? "Click: done. Right-click: failed." : partyTicks(q) ? "Mark done" : "Mark done. The GM is told."}"><i class="fa-regular fa-square"></i></a>`
    : `<i class="pct-qp-box fa-regular fa-square"></i>`;
  const chips = [g.count !== null && g.count !== undefined ? `${num(g.have)} of ${g.count}` : "", g.optional ? "optional" : ""];
  if (steps?.length) {
    const sp = stepProgress(g, steps);
    chips.push(g.mode === "any" ? `any one of ${steps.length}` : `${sp.done} of ${sp.of} steps`);
  }
  const hidden = gm && !g.revealed ? `<i class="fa-solid fa-eye-slash" data-tooltip="Hidden from players"></i> ` : "";
  return `<div class="pct-qp-goal ${gm && !g.revealed ? "pct-qp-hidden" : ""}">${box}<span class="pct-qp-text">${hidden}${esc(g.text)}</span>${chips.filter(Boolean).map((c) => `<span class="pct-qp-chip">${esc(c)}</span>`).join("")}</div>`;
}

function panelQuest(q, folded, pins) {
  const gm = game.user.isGM;
  const tick = gm || !!game.settings.get(MOD, "playerTicks") || partyTicks(q);
  const main = q.objectives.filter((o) => !o.optional);
  const done = main.filter((o) => o.state === "done").length;
  const shut = folded.has(q.id);
  const goals = shut ? "" : q.objectives.filter((o) => o.state === "open").map((o) => {
    const steps = o.steps.filter((st) => st.state === "open").map((st) => `<li>${panelGoal(q, st, tick)}</li>`).join("");
    return `<li>${panelGoal(q, o, tick, o.steps)}${steps ? `<ul>${steps}</ul>` : ""}</li>`;
  }).join("");
  const marks = [
    gm && !q.revealed ? `<i class="fa-solid fa-eye-slash" data-tooltip="Hidden from players"></i>` : "",
    q.focus ? `<i class="fa-solid fa-star" data-tooltip="The party's focus"></i>` : "",
  ].join("");
  const unpin = pins.includes(q.id) ? qpBtn("unpin", "fa-solid fa-xmark", "Unpin", { tid: q.id }) : "";
  return `<div class="pct-qp-quest pct-qp-${esc(q.status)}">
      <div class="pct-qp-title">${qpBtn("fold", shut ? "fa-solid fa-caret-right" : "fa-solid fa-caret-down", shut ? "Show objectives" : "Hide objectives", { tid: q.id })}<a class="pct-qp-name" data-qp="open" data-tid="${esc(q.id)}" data-tooltip="Open in the trackers window">${marks}${esc(q.name)}</a>${main.length ? `<span class="pct-qp-count">${done}/${main.length}</span>` : ""}${unpin}</div>
      ${shut ? "" : `${q.deadline ? `<div class="pct-qp-due">${dueChip(q.deadline)}</div>` : ""}${goals ? `<ul class="pct-qp-goals">${goals}</ul>` : `<p class="pct-qp-none">No open objectives.</p>`}`}
    </div>`;
}

/** The quests this user sees in the panel, or null when there's no panel for them. */
function panelData() {
  if (!game.settings.get(MOD, "questPanel")) return null;
  if (game.user.isGM ? !storeReady || Store.broken : !game.settings.get(MOD, "playerAccess")) return null;
  return panelQuests(visibleTrackers().filter((t) => t.kind === "quest"), pinned());
}

/** Draw the panel, or take it away when there's nothing to show. */
function renderPanel() {
  const list = panelData();
  if (!list?.length) {
    panelEl?.remove();
    panelEl = null;
    return;
  }
  if (!panelEl) {
    panelEl = document.createElement("section");
    panelEl.id = "pct-qpanel";
    panelEl.className = "pct-qpanel";
    panelEl.addEventListener("click", onPanelClick);
    panelEl.addEventListener("contextmenu", onPanelClick);
    panelEl.addEventListener("pointerdown", onPanelDrag);
    (document.getElementById("interface") ?? document.body).append(panelEl);
  }
  const st = readJSON(PANEL_KEY, {});
  const folded = new Set(Array.isArray(st.folded) ? st.folded : []);
  const pins = pinned();
  panelEl.classList.toggle("pct-qp-min", !!st.min);
  panelEl.innerHTML = `<header class="pct-qp-head" data-tooltip="Drag to move"><i class="fa-solid fa-scroll"></i><span>Quests</span>${qpBtn("min", st.min ? "fa-solid fa-chevron-down" : "fa-solid fa-chevron-up", st.min ? "Show the panel" : "Shrink the panel")}${qpBtn("close", "fa-solid fa-xmark", "Hide the quest panel")}</header>
    ${st.min ? "" : `<div class="pct-qp-body">${list.map((q) => panelQuest(q, folded, pins)).join("")}</div>`}`;
  placePanel();
}

/** Keep the panel where this user put it, inside the screen. It starts near the top, left of the sidebar. */
function placePanel() {
  if (!panelEl) return;
  const st = readJSON(PANEL_KEY, {});
  const w = panelEl.offsetWidth || 280;
  const side = document.getElementById("sidebar")?.getBoundingClientRect().left ?? window.innerWidth;
  const left = clamp(Number.isFinite(st.left) ? st.left : side - w - 16, 0, Math.max(0, window.innerWidth - w));
  const top = clamp(Number.isFinite(st.top) ? st.top : 64, 0, Math.max(0, window.innerHeight - 40));
  panelEl.style.left = `${left}px`;
  panelEl.style.top = `${top}px`;
}

function onPanelDrag(ev) {
  if (ev.button !== 0 || !ev.target.closest(".pct-qp-head") || ev.target.closest("[data-qp]")) return;
  ev.preventDefault();
  const r = panelEl.getBoundingClientRect();
  const dx = ev.clientX - r.left, dy = ev.clientY - r.top;
  const move = (e) => {
    panelEl.style.left = `${e.clientX - dx}px`;
    panelEl.style.top = `${e.clientY - dy}px`;
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    if (!panelEl) return;
    const st = readJSON(PANEL_KEY, {});
    writeJSON(PANEL_KEY, { ...st, left: parseInt(panelEl.style.left, 10), top: parseInt(panelEl.style.top, 10) });
    placePanel();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

/** Can this user see quests at all? Players need "Players can open the trackers". */
const questsOpen = () => game.user.isGM || !!game.settings.get(MOD, "playerAccess");

/** A quest as the players see it, read-only, wrapped in this module's styles; null when players can't see it. */
function questReadOnly(id) {
  if (!questsOpen()) return null;
  // Project only this quest: projecting every tracker on each call is slow when a list asks for many quests.
  let q;
  if (game.user.isGM) {
    const t = Store.get(id);
    q = t?.kind === "quest" ? project(t, { all: Store.data.trackers }) : null;
  } else q = visibleTrackers().find((t) => t.id === id && t.kind === "quest");
  if (!q) return null;
  const html = `${q.desc ? `<p class="pct-desc">${para(q.desc)}</p>` : ""}${questHead(q, { gm: false })}${questBody(q, { gm: false, readOnly: true })}`;
  return `<div class="pct-app pct-embed"><div class="pct">${html.replaceAll('data-action="', 'data-pct-action="')}</div></div>`;
}

/* ------------------------------------------------------------------ */
/* Reveal links                                                        */
/* ------------------------------------------------------------------ */

/** Characters an id in a reveal link can't hold (they'd end or split the link). Preset keys could contain them. */
const RL_BAD = /[,\]|{}\r\n]/;
/** A part's reveal-link tool in the GM's view: a link icon to drag or click (copy), or a box while picking parts. */
function rlTool(id, pick) {
  if (RL_BAD.test(String(id))) return pick ? `<span class="pct-rlpick pct-rl-bad" data-tooltip="Its id has a character a reveal link can't hold"><i class="fa-solid fa-link-slash"></i></span>` : "";
  if (pick) return `<label class="pct-rlpick" data-tooltip="${pick.has(id) ? "In the reveal link. Click to take it out." : "Click to put it in the reveal link"}"><input type="checkbox" data-rl-pick="${esc(id)}" ${pick.has(id) ? "checked" : ""}><i class="fa-solid fa-link"></i></label>`;
  return `<a class="pct-rl-drag pct-rl-one" draggable="true" tabindex="0" role="button" data-action="pctRLCopy" data-rl="${esc(id)}" data-tooltip="Reveal link: drag it into a journal page, or click to copy it. Players who can read the page see its label."><i class="fa-solid fa-link"></i></a>`;
}

/** Above a quest while the GM picks parts for one reveal link. */
function rlBar(t, pick) {
  const have = revealableIds(t);
  const n = [...pick].filter((id) => have.includes(id)).length;
  const what = n ? `${n} ${n === 1 ? "part" : "parts"} picked.` : "Nothing picked yet: the link reveals the quest itself.";
  return `<div class="pct-rlbar"><i class="fa-solid fa-link"></i><span>Reveal link: ${what} Tick the parts it reveals. Players who can read the page see its label.</span>
    <a class="pct-btn pct-rl-drag pct-rl-chip" draggable="true" data-action="pctRLCopy" data-rl="*" data-tooltip="Drag it into a journal page, or click to copy it"><i class="fa-solid fa-grip-vertical"></i><span>Drag or copy</span></a>
    ${n ? A("pctRLClear", "fa-solid fa-eraser", { tip: "Untick them all" }) : ""}${A("pctRLPick", "fa-solid fa-check", { label: "Done", tip: "Stop picking" })}</div>`;
}

/** Every part a reveal link can name, in the quest's own order. */
function revealableIds(t) {
  return [
    ...(t.objectives ?? []).flatMap((o) => [o.id, ...(o.steps ?? []).map((st) => st.id)]),
    ...(t.entries ?? []).map((e) => e.id),
    ...(t.leads ?? []).map((l) => l.id),
    ...(t.rewards ?? []).map((r) => r.id),
  ];
}

/** The text of a reveal link: @QuestReveal[quest|part,part]{label}. One part is labeled with its text, else the
 * quest's name. */
function revealLinkText(t, ids = [], label = null) {
  if (RL_BAD.test(t.id)) return null;
  const order = revealableIds(t);
  const parts = [...new Set(ids)].filter((id) => order.includes(id) && !RL_BAD.test(String(id))).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const text = label ?? (parts.length === 1 ? shortText(findRow(t, parts[0])?.row.text, 40) : t.name);
  const clean = String(text ?? "").replace(/[{}[\]\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  return `@QuestReveal[${t.id}${parts.length ? `|${parts.join(",")}` : ""}]{${clean || "Reveal"}}`;
}

async function copyText(text) {
  try {
    if (game.clipboard?.copyPlainText) await game.clipboard.copyPlainText(text);
    else await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** The quest a reveal link names: by id, by its preset key (the id without the preset's prefix), or by its exact
 * name. Keys and names count only when they name one quest. */
function revealQuest(ref) {
  const key = String(ref ?? "").trim();
  const quests = Store.data.trackers.filter((t) => t.kind === "quest");
  const hit = quests.find((t) => t.id === key);
  if (hit) return hit;
  const byKey = quests.filter((t) => t.preset && t.id === `${t.preset}-${key}`);
  if (byKey.length === 1) return byKey[0];
  const byName = quests.filter((t) => String(t.name ?? "").trim().toLowerCase() === key.toLowerCase());
  return byName.length === 1 ? byName[0] : null;
}

/** What a reveal link names, read from the GM's data: the quest, its parts (with where they sit) and ids not found. */
function resolveReveal(questRef, partList) {
  if (!game.user.isGM) return { error: "Only the GM can reveal." };
  if (!storeReady || Store.broken) return { error: "Campaign Trackers hasn't loaded its data." };
  const q = revealQuest(questRef);
  if (!q) return { error: `No quest "${String(questRef ?? "").trim()}" in Campaign Trackers.` };
  const refs = [...new Set(String(partList ?? "").split(",").map((x) => x.trim()).filter(Boolean))];
  const parts = [], missing = [];
  for (const id of refs) {
    const f = findRow(q, id);
    if (f && ROW_KIND[f.list]) parts.push({ id, ...f });
    else missing.push(id);
  }
  return { q, parts, missing, questOnly: !refs.length };
}

/** Whether one part a link names shows to players (see rowShown). */
const partShown = (p) => rowShown(p);

/** What a click would reveal, as the checklist's rows (all ticked to start): the quest if hidden, each hidden part,
 * the objective a step sits under, the hidden quest a lead points to, and loot players can't open yet. */
async function revealPlan({ q, parts, questOnly = false }) {
  const rows = [], already = [];
  // A link whose parts are all gone mustn't reveal the quest on its own.
  if (!q.revealed && (questOnly || parts.length)) rows.push({ name: "quest", value: q.id, label: parts.length ? "The quest itself (players see none of it yet)" : "The quest itself" });
  const leadqs = new Set(), leadcs = new Set();
  for (const p of parts) {
    if (rowShown(p)) {
      already.push(p);
      continue;
    }
    // A step's row reveals its objective too (the same rule as the eye).
    rows.push({ name: "row", value: p.id, label: revealLabel(q, p) });
    if (p.row.revealed) continue;
    if (p.list === "leads") {
      const to = Store.data.trackers.find((x) => x.id === p.row.to && x.kind === "quest" && !x.revealed && x.id !== q.id);
      // A quest or clue two leads share is listed once, under the first, and comes with either of them.
      const shared = (name, value) => rows.find((x) => x.name === name && x.value === value);
      if (to && leadqs.has(to.id)) shared("leadq", to.id).for += ` ${p.id}`;
      else if (to) {
        leadqs.add(to.id);
        rows.push({ name: "leadq", value: to.id, label: `and reveal the quest it points to, ${to.name}`, indent: true, for: p.id });
      }
      for (const clue of leadClues(q, p.row)) {
        if (parts.some((x) => x.row.id === clue.id)) continue;
        if (leadcs.has(clue.id)) {
          shared("leadc", clue.id).for += ` ${p.id}`;
          continue;
        }
        leadcs.add(clue.id);
        rows.push({ name: "leadc", value: clue.id, label: `and reveal its clue, ${shortText(clue.text, 60) || "(no text)"}`, indent: true, for: p.id });
      }
    }
    if (p.list === "rewards") {
      const actor = await lootToOpen(q, p.id);
      if (actor) rows.push({ name: "loot", value: p.id, label: `and let players open ${actor.name}`, indent: true, for: p.id });
    }
  }
  return { rows, already };
}

/** The checklist a reveal link opens: untick anything to leave hidden. Null when the GM cancels. */
async function chooseReveal(r, plan) {
  const row = (x) => `<label class="pct-chk ${x.indent ? "pct-indent" : ""}"><input type="checkbox" name="${x.name}" value="${esc(x.value)}" ${x.for ? `data-for="${esc(x.for)}"` : ""} checked> <span>${esc(x.label)}</span></label>`;
  const shown = plan.already.map((p) => `<div class="pct-rl-note"><i class="fa-solid fa-check"></i> <span>${esc(rowLabel(r.q, p.id))}</span> <em>players see it</em></div>`).join("");
  const missing = r.missing.map((id) => `<div class="pct-rl-note pct-rl-missing"><i class="fa-solid fa-xmark"></i> <span>Not found: ${esc(id)}</span></div>`).join("");
  const res = await foundry.applications.api.DialogV2.wait({
    window: { title: `Reveal: ${r.q.name}` },
    classes: ["pct-reveal-dialog"],
    content: `<div class="pct-rl-rows">${plan.rows.map(row).join("")}</div>${shown}${missing}
      <p class="pct-hint">Shift-click a reveal link to reveal everything in it without this list.</p>`,
    buttons: [
      { action: "reveal", label: "Reveal", icon: "fa-solid fa-eye", default: true, callback: (ev, button) => readRevealForm(button.form) },
      { action: "cancel", label: "Cancel" },
    ],
    rejectClose: false,
  });
  return res && typeof res === "object" ? res : null;
}

/**
 * The checklist's ticks. An indented row (the quest a lead points to, its clue, loot) counts only with the row above
 * it.
 */
function readRevealForm(form) {
  const ticked = (n) => [...form.querySelectorAll(`input[name="${n}"]:checked`)];
  const rows = ticked("row").map((i) => i.value);
  const withParent = (n) => ticked(n).filter((i) => !i.dataset.for || i.dataset.for.split(" ").some((f) => rows.includes(f))).map((i) => i.value);
  return { quest: ticked("quest").length > 0, rows, leadq: withParent("leadq"), leadc: withParent("leadc"), loot: withParent("loot") };
}

const REVEAL_WORDS = { objectives: ["objective", "objectives"], "objectives.steps": ["step", "steps"], entries: ["clue", "clues"], leads: ["lead", "leads"], rewards: ["reward", "rewards"] };

/** Reveal what was chosen in one change, then open any loot, and say what happened. */
async function applyReveal(qid, choice) {
  choice.leadc ??= [];
  if (!choice.quest && !choice.rows.length && !choice.leadq.length && !choice.leadc.length && !choice.loot.length) return void ui.notifications.info("Nothing revealed.");
  const cur = Store.get(qid);
  if (cur?.kind !== "quest") return void ui.notifications.warn("That quest no longer exists.");
  const hidden = (choice.quest && !cur.revealed)
    || [...choice.rows, ...choice.leadc].some((id) => { const f = findRow(cur, id); return !!f && !rowShown(f); })
    || choice.leadq.some((id) => Store.get(id)?.revealed === false);
  const res = !hidden ? { name: cur.name, quest: false, kinds: {}, quests: [] } : await mutate((d) => {
    const tr = d.trackers.find((x) => x.id === qid && x.kind === "quest");
    if (!tr) return undefined;
    const out = { name: tr.name, quest: false, kinds: {}, quests: [] };
    if (choice.quest && !tr.revealed) out.quest = tr.revealed = true;
    for (const id of [...choice.rows, ...choice.leadc]) {
      const f = findRow(tr, id);
      if (!f || !ROW_KIND[f.list]) continue;
      for (const list of revealRow(f)) out.kinds[list] = (out.kinds[list] ?? 0) + 1;
    }
    for (const id of choice.leadq) {
      const o = d.trackers.find((x) => x.id === id && x.kind === "quest");
      if (o && !o.revealed) {
        o.revealed = true;
        out.quests.push(o.name);
      }
    }
    return out;
  }, { notify: false });
  if (!res) return;
  const opened = [], failed = [];
  for (const rid of choice.loot) {
    const r = (Store.get(qid)?.rewards ?? []).find((x) => x.id === rid);
    if (!r?.actor?.uuid) continue;
    try {
      if (await letPlayersOpen(r.actor.uuid)) opened.push(r.actor.name);
    } catch (err) {
      console.warn(`${MOD} | couldn't open ${r.actor.uuid} to players`, err);
      failed.push(r.actor.name);
    }
  }
  const bits = [
    res.quest && "the quest",
    ...Object.entries(REVEAL_WORDS).filter(([k]) => res.kinds[k]).map(([k, [one, many]]) => `${res.kinds[k]} ${res.kinds[k] === 1 ? one : many}`),
    ...res.quests.map((n) => `the quest ${n}`),
  ].filter(Boolean);
  const list = bits.length > 1 ? `${bits.slice(0, -1).join(", ")} and ${bits.at(-1)}` : bits[0];
  // Names can be players' own (party quests): escaped, since notices keep markup.
  const said = [bits.length && `Revealed in ${res.name}: ${list}.`, opened.length && `Players can open ${opened.join(" and ")} now.`, failed.length && `Couldn't open ${failed.join(" and ")} to players.`].filter(Boolean).join(" ");
  ui.notifications.info(esc(said || `${res.name}: players already see all of that.`));
}

/** One reveal at a time per link, so a double click doesn't open two lists. */
const revealBusy = new Set();
/** Reveal what a link names: with the checklist, or (ask false, a Shift-click) everything it would tick. */
async function revealFromLink(questRef, partList, { ask = true, trusted = true } = {}) {
  if (!game.user.isGM) return void ui.notifications.warn("Only the GM can reveal.");
  const key = `${questRef}|${partList ?? ""}`;
  if (revealBusy.has(key)) return;
  revealBusy.add(key);
  try {
    const r = resolveReveal(questRef, partList);
    if (r.error) return void ui.notifications.warn(esc(r.error));
    const plan = await revealPlan(r);
    if (!plan.rows.length) {
      if (r.missing.length) ui.notifications.warn(`${esc(r.q.name)}: nothing with the id ${r.missing.map(esc).join(", ")}.`);
      if (r.questOnly || r.parts.length) ui.notifications.info(`${esc(r.q.name)}: players already see all of that.`);
      return;
    }
    // A link a player may have written (chat, a page a player last changed) always shows the list.
    if (!trusted) ask = true;
    if (!ask && r.missing.length) ui.notifications.warn(`${esc(r.q.name)}: nothing with the id ${r.missing.map(esc).join(", ")}.`);
    const all = (n) => plan.rows.filter((x) => x.name === n).map((x) => x.value);
    const choice = ask ? await chooseReveal(r, plan) : { quest: all("quest").length > 0, rows: all("row"), leadq: all("leadq"), leadc: all("leadc"), loot: all("loot") };
    if (choice) await applyReveal(r.q.id, choice);
  } finally {
    revealBusy.delete(key);
  }
}

/** @QuestReveal[quest|part,part]{label}: for the GM a button that reveals those parts; for players the label as
 * plain text, which says nothing of what's behind it. The quest is anything but "]" and "|" (a name can have spaces);
 * parts and the label stay on one line. */
const REVEAL_LINK = /@QuestReveal\[([^\]|\n]{1,200})(?:\|([^\]{}\n]{0,1000}))?\](?:\{([^}\n]{0,500})\})?/g;
/** Did a GM write this link? Only a journal page (or entry) a GM last changed counts; chat gives no document. */
function gmWrote(doc) {
  const by = doc?._stats?.lastModifiedBy ?? doc?.parent?._stats?.lastModifiedBy;
  return !!by && !!game.users?.get(by)?.isGM && ["JournalEntryPage", "JournalEntry"].includes(doc?.documentName);
}
function enrichRevealLink(match, options = {}) {
  const [, ref, parts = "", label] = match;
  const quest = ref.trim();
  const text = String(label ?? "").trim() || "Reveal";
  if (!game.user.isGM) {
    const span = document.createElement("span");
    span.className = "pct-reveal-text";
    span.textContent = text;
    return span;
  }
  const a = document.createElement("a");
  a.className = "pct-reveal-link";
  a.dataset.quest = quest;
  a.dataset.parts = parts;
  a.dataset.label = text;
  if (!gmWrote(options?.relativeTo)) a.dataset.ask = "always";
  // In a journal page the GM can drop more parts onto it.
  const doc = options?.relativeTo;
  if (doc?.documentName === "JournalEntryPage" && !doc.pack && a.dataset.ask !== "always") a.dataset.page = doc.uuid;
  paintRevealLink(a);
  return a;
}
/** Draw a reveal link as things stand: its tooltip lists what it covers (ticked if players see it), it fades with a
 * check once players see it all, and it's dashed when something it names can't be found. */
function paintRevealLink(a) {
  const r = resolveReveal(a.dataset.quest, a.dataset.parts);
  let done = false, broken = true;
  const lines = [];
  if (r.error) lines.push(esc(r.error));
  else {
    broken = r.missing.length > 0;
    const mark = (on) => (on ? "✓" : "○");
    if (r.questOnly || !r.q.revealed) lines.push(`${mark(r.q.revealed)} The quest itself`);
    const named = new Set(r.parts.map((p) => p.id));
    for (const p of r.parts) {
      lines.push(`${mark(partShown(p))} ${esc(rowLabel(r.q, p.id))}`);
      if (p.list === "objectives.steps" && !p.parent.revealed && !named.has(p.parent.id)) {
        named.add(p.parent.id);
        lines.push(`○ and the objective it sits under, ${esc(shortText(p.parent.text, 50))}`);
      }
    }
    for (const id of r.missing) lines.push(`✗ Not found: ${esc(id)}`);
    done = !!r.q.revealed && !broken && r.parts.every(partShown);
    if (a.dataset.page) lines.push("Drop more parts of this quest on it to add them.");
    const how = a.dataset.ask === "always" ? "Click to choose what to reveal. (Written where a player could have written it, so it always asks.)" : "Click to choose what to reveal. Shift-click to reveal it all.";
    lines.push(`<em>${done ? "Players see all of this." : how}</em>`);
  }
  const tip = `${r.q ? `<strong>${esc(r.q.name)}</strong><br>` : ""}${lines.join("<br>")}`;
  const state = `${done}|${broken}`;
  // Repainted on every change, so touch the link only when something about it changed.
  if (a.dataset.tooltipHtml === tip && a.dataset.state === state && a.firstChild) return;
  a.dataset.tooltipHtml = tip;
  a.dataset.state = state;
  a.classList.toggle("pct-done", done);
  a.classList.toggle("pct-broken", broken);
  const icon = document.createElement("i");
  icon.className = done ? "fa-solid fa-check" : "fa-solid fa-eye";
  a.replaceChildren(icon, document.createTextNode(a.dataset.label || "Reveal"));
}
/**
 * A link's parts with the new ones after them, in the quest's order: { parts, added }, or null when nothing is new.
 */
function partsWithMore(t, have, add) {
  const order = revealableIds(t);
  const fresh = [...new Set(add)].filter((id) => !have.includes(id) && order.includes(id) && !RL_BAD.test(String(id)))
    .sort((x, y) => order.indexOf(x) - order.indexOf(y));
  return fresh.length ? { parts: [...have, ...fresh], added: fresh } : null;
}
/** Is this match (of REVEAL_LINK) the link `a` was drawn from? Compared the way the enricher reads it. */
function sameLink(m, a) {
  const label = String(m[3] ?? "").trim() || "Reveal";
  return m[1].trim() === a.dataset.quest && splitIds(m[2]).join(",") === splitIds(a.dataset.parts).join(",") && label === a.dataset.label;
}
/** In plain text (a text node, or a Markdown source), give every copy of link `a` these parts. Each copy keeps its own
 * quest ref and label as written, and a link with no label stays without one. */
function rewriteLinks(text, a, parts) {
  let count = 0;
  const out = String(text).replace(new RegExp(REVEAL_LINK.source, "g"), (...g) => {
    if (!sameLink(g, a)) return g[0];
    count++;
    return `@QuestReveal[${g[1]}|${parts.join(",")}]${g[3] === undefined ? "" : `{${g[3]}}`}`;
  });
  return { text: out, count };
}
/** The same in stored HTML: rewrite inside text nodes, as the enricher reads them (entities, nbsp and quoting don't
 * matter). Null when no copy was found. */
function rewriteLinksInHTML(html, a, parts) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT);
  let count = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue.includes("@QuestReveal[")) continue;
    const r = rewriteLinks(n.nodeValue, a, parts);
    if (r.count) {
      n.nodeValue = r.text;
      count += r.count;
    }
  }
  return count ? { text: tpl.innerHTML, count } : null;
}
const splitIds = (x) => String(x ?? "").split(",").map((v) => v.trim()).filter(Boolean);
/** Pages being written to by a drop, so a second drop waits for the first. */
const dropBusy = new Set();
/** Parts dropped on a reveal link in a journal page: add them to the link in the page's text. */
async function addToRevealLink(a, droppedQuest, droppedParts) {
  if (!game.user.isGM) return;
  // A link a player may have written isn't changed by a drop (the change would make the page the GM's).
  if (a.dataset.ask === "always") return void ui.notifications.warn("This link may have been written by a player. Edit the page to change it.");
  const t = revealQuest(a.dataset.quest);
  if (!t) return void ui.notifications.warn("This reveal link's quest can't be found.");
  if (revealQuest(droppedQuest)?.id !== t.id) return void ui.notifications.warn("That's from another quest. A reveal link covers one quest.");
  const add = splitIds(droppedParts);
  if (!add.length) return void ui.notifications.info("Drop a part's link icon here (or a picked set) to add it.");
  const next = partsWithMore(t, splitIds(a.dataset.parts), add);
  if (!next) return void ui.notifications.info("This reveal link already covers that.");
  if (next.parts.join(",").length > 1000) return void ui.notifications.warn("That would make the link too long. Make a second reveal link for the rest.");
  const page = await fromUuid(a.dataset.page);
  if (!page?.isOwner || page.pack) return void ui.notifications.warn("You can't change that page here.");
  if (dropBusy.has(page.uuid)) return void ui.notifications.info("Still saving the last drop on this page. Try again in a moment.");
  dropBusy.add(page.uuid);
  try {
    const changes = {};
    let count = 0;
    const html = rewriteLinksInHTML(page.text?.content ?? "", a, next.parts);
    // A Markdown page keeps its source in text.markdown and its HTML in text.content; both must change.
    const md = page.text?.format === CONST.JOURNAL_ENTRY_PAGE_FORMATS?.MARKDOWN;
    if (md) {
      const r = rewriteLinks(page.text?.markdown ?? "", a, next.parts);
      if (!r.count || (page.text?.content && !html)) return void ui.notifications.warn("Couldn't find this link in the page's text. Edit the page to add the parts by hand.");
      changes["text.markdown"] = r.text;
      if (html) changes["text.content"] = html.text;
      count = r.count;
    } else {
      if (!html) return void ui.notifications.warn("Couldn't find this link in the page's text. Edit the page to add the parts by hand.");
      changes["text.content"] = html.text;
      count = html.count;
    }
    await page.update(changes);
    const what = next.added.map((id) => rowLabel(t, id)).join("; ").replace(/[.!?]+$/, "");
    ui.notifications.info(esc(`Added to the reveal link${count > 1 ? ` (all ${count} copies in the page)` : ""}: ${what}.`));
  } catch (err) {
    console.warn(`${MOD} | couldn't add to a reveal link`, err);
    ui.notifications.warn("Couldn't change the page. Edit it to add the parts by hand.");
  } finally {
    dropBusy.delete(page.uuid);
  }
}
const dropLink = (ev) => (game.user.isGM ? ev.target.closest?.("a.pct-reveal-link[data-page]") : null);
function onRevealDragOver(ev) {
  const a = dropLink(ev);
  if (!a || !ev.dataTransfer?.types?.includes("text/plain")) return;
  ev.preventDefault();
  ev.dataTransfer.dropEffect = "copy";
  a.classList.add("pct-drop-on");
}
function onRevealDragLeave(ev) {
  const a = ev.target.closest?.("a.pct-reveal-link");
  // Moving onto the icon inside the link isn't leaving it.
  if (a && !a.contains(ev.relatedTarget)) a.classList.remove("pct-drop-on");
}
function onRevealDrop(ev) {
  const a = dropLink(ev);
  if (!a) return;
  a.classList.remove("pct-drop-on");
  const m = [...String(ev.dataTransfer?.getData("text/plain") ?? "").matchAll(REVEAL_LINK)][0];
  // Anything else dropped here goes on to Foundry as usual.
  if (!m) return;
  ev.preventDefault();
  ev.stopPropagation();
  addToRevealLink(a, m[1].trim(), m[2] ?? "").catch((err) => console.warn(`${MOD} | reveal link drop`, err));
}

/** A reveal link was clicked (GM only: players get plain text). Shift reveals at once, as Shift skips a roll's
 * dialog. */
function onRevealLink(ev) {
  const a = ev.target.closest?.("a.pct-reveal-link");
  if (!a) return;
  ev.preventDefault();
  ev.stopPropagation();
  revealFromLink(a.dataset.quest, a.dataset.parts, { ask: !ev.shiftKey, trusted: a.dataset.ask !== "always" });
}

/** @Quest[id]{label} in journal text: a link that opens the quest. Ids are anything but "]" and spaces (preset ids
 * can hold dots). */
const QUEST_LINK = /@Quest\[([^\]\s]{1,100})\](?:\{([^}]{1,500})\})?/g;
function enrichQuestLink(match) {
  const [, id, label] = match;
  const a = document.createElement("a");
  a.className = "pct-quest-link";
  a.dataset.questId = id;
  if (label) a.dataset.label = label;
  paintQuestLink(a);
  return a;
}
/**
 * Draw a quest link as this user should see it. A player who can't see the quest sees neither its name nor the link's
 * label (a label could name a hidden quest), only "Unknown quest".
 */
function paintQuestLink(a) {
  const q = visibleTrackers().find((t) => t.id === a.dataset.questId && t.kind === "quest");
  const open = questsOpen();
  const known = !!q && open;
  a.classList.toggle("pct-quest-unknown", !known);
  if (known) delete a.dataset.tooltip;
  else a.dataset.tooltip = game.user.isGM ? "No quest with this id" : open ? "Not revealed yet" : "The GM hasn't opened the trackers to players";
  const text = known ? a.dataset.label || q.name : game.user.isGM && a.dataset.label ? a.dataset.label : "Unknown quest";
  const icon = document.createElement("i");
  icon.className = "fa-solid fa-scroll";
  a.replaceChildren(icon, document.createTextNode(text));
}
/** Links already on screen follow reveals, renames and the trackers loading after them. */
function repaintQuestLinks() {
  for (const a of document.querySelectorAll("a.pct-quest-link")) paintQuestLink(a);
  for (const a of document.querySelectorAll("a.pct-reveal-link")) paintRevealLink(a);
}
/** A quest link was clicked: another module may show it (return false from the hook), else the window opens on it. */
function onQuestLink(ev) {
  const a = ev.target.closest?.("a.pct-quest-link");
  if (!a) return;
  ev.preventDefault();
  ev.stopPropagation();
  const id = a.dataset.questId;
  if (!questsOpen()) return ui.notifications.info("The GM hasn't opened the trackers to players.");
  if (!visibleTrackers().some((t) => t.id === id && t.kind === "quest")) return ui.notifications.info("That quest isn't open to you yet.");
  if (Hooks.call(`${MOD}.questLink`, id, a) === false) return;
  openQuest(id);
}

/** Open the window on a quest, with one of its sections open for editing if asked. */
function openQuest(id, sec = null) {
  if (!game.user.isGM && !game.settings.get(MOD, "playerAccess")) return;
  const app = [...openApps][0] ?? new TrackersApp();
  app.state.tab = "quest";
  app.state.quest = id;
  if (sec) app.state.qedit.add(`${id}:${sec}`);
  saveUI(app.state);
  app.show();
}

async function onPanelClick(ev) {
  const el = ev.target.closest("[data-qp]");
  if (!el || !panelEl?.contains(el)) return;
  const { qp, tid } = el.dataset;
  const right = ev.type === "contextmenu";
  if (right && !(qp === "tick" && game.user.isGM)) return;
  ev.preventDefault();
  const st = readJSON(PANEL_KEY, {});
  if (qp === "min") {
    writeJSON(PANEL_KEY, { ...st, min: !st.min });
    renderPanel();
  } else if (qp === "close") {
    await game.settings.set(MOD, "questPanel", false);
    ui.notifications.info('Quest panel hidden. To bring it back, choose "Show the quest panel" on the Quests tab.');
  } else if (qp === "fold") {
    const folded = new Set(Array.isArray(st.folded) ? st.folded : []);
    folded.has(tid) ? folded.delete(tid) : folded.add(tid);
    writeJSON(PANEL_KEY, { ...st, folded: [...folded] });
    renderPanel();
  } else if (qp === "open") {
    openQuest(tid);
  } else if (qp === "unpin") {
    togglePin(tid);
  } else if (qp === "tick") {
    if (el.classList.contains("pct-busy")) return;
    el.classList.add("pct-busy");
    setTimeout(() => el.classList.remove("pct-busy"), 5000);
    if (game.user.isGM) await setGoalState(tid, { goal: el.dataset.goal }, right);
    else if (!tickToGM(tid, el.dataset.goal, "done")) el.classList.remove("pct-busy");
  }
}

/** Tab, shown quest, folded cards and open GM-notes boxes, kept in this browser across redraws and reopening. */
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
    localStorage.setItem(UI_KEY, JSON.stringify({ tab: state.tab, closed: [...state.closed], notesOpen: [...state.notesOpen], quest: state.quest }));
  } catch {
    /* no storage: the state lives only in this window */
  }
}

const SIZE_KEY = `${MOD}.size`;
/** The window's last size and place in this browser, kept inside the screen. */
function loadSize() {
  let v;
  try {
    v = JSON.parse(localStorage.getItem(SIZE_KEY));
  } catch {
    return {};
  }
  if (!v || typeof v !== "object") return {};
  // A size saved while the window was collapsed is no size at all.
  if (!(v.width >= 400 && v.height >= 250)) return {};
  const out = {};
  const W = window.innerWidth, H = window.innerHeight;
  out.width = Math.max(400, Math.min(v.width, W));
  out.height = Math.max(250, Math.min(v.height, H));
  if (Number.isFinite(v.left)) out.left = Math.max(0, Math.min(v.left, W - out.width));
  if (Number.isFinite(v.top)) out.top = Math.max(0, Math.min(v.top, H - out.height));
  return out;
}
let sizeTimer = null;
function saveSize(position) {
  // Copy now: Foundry hands over its own live position object, which may change before the save runs.
  const pos = { left: position.left, top: position.top, width: position.width, height: position.height };
  clearTimeout(sizeTimer);
  sizeTimer = setTimeout(() => {
    try {
      localStorage.setItem(SIZE_KEY, JSON.stringify({ width: pos.width, height: pos.height, left: pos.left, top: pos.top }));
    } catch {
      /* no storage: the window opens at its default size */
    }
  }, 300);
}

/** Wait for an element's own transitions to end; a hidden tab pauses them, so after a second they're finished by hand. */
async function settle(el) {
  const anims = el?.getAnimations?.() ?? [];
  if (!anims.length) return;
  await Promise.race([Promise.all(anims.map((a) => a.finished.catch(() => null))), new Promise((r) => setTimeout(r, 1200))]);
  for (const a of el?.getAnimations?.() ?? []) {
    try {
      a.finish();
    } catch {
      /* an animation that can't finish (infinite) is left alone */
    }
  }
}

/** A tab named by its kind ("reputation"), its label ("Victory Points") or a tracker's id; null when nothing matches. */
function findTab(name) {
  if (typeof name !== "string" || !name.trim()) return null;
  const n = name.trim().toLowerCase();
  const kind = KINDS.find((k) => k === n || KIND_INFO[k].tab.toLowerCase() === n || KIND_INFO[k].label.toLowerCase() === n);
  if (kind) return { kind };
  const t = (game.user.isGM ? Store.data?.trackers : game.settings.get(MOD, "public")?.trackers)?.find((x) => x.id === name.trim());
  return t ? { kind: t.kind, tid: t.id } : null;
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
      pctChallengePost: TrackersApp.#onChallengePost,
      pctPropose: TrackersApp.#onPropose,
      pctChallengeCheck: TrackersApp.#onChallengeCheck,
      pctEndRound: TrackersApp.#onEndRound,
      pctHalve: TrackersApp.#onHalve,
      pctClearNpc: TrackersApp.#onClearNpc,
      pctQuestGo: TrackersApp.#onQuestGo,
      pctRLPick: TrackersApp.#onRLPick,
      pctRLClear: TrackersApp.#onRLClear,
      pctRLCopy: TrackersApp.#onRLCopy,
      pctQSec: TrackersApp.#onQSec,
      pctQTick: TrackersApp.#onQTick,
      pctLeadFollow: TrackersApp.#onLeadFollow,
      pctQNoteAdd: TrackersApp.#onQNoteAdd,
      pctQNoteJournal: TrackersApp.#onQNoteJournal,
      pctQNoteDel: TrackersApp.#onQNoteDel,
      pctQState: { handler: TrackersApp.#onQState, buttons: [0, 2] },
      pctQFocus: TrackersApp.#onQFocus,
      pctQPin: TrackersApp.#onQPin,
      pctPanelOn: TrackersApp.#onPanelOn,
      pctQNew: TrackersApp.#onQNew,
      pctQMain: TrackersApp.#onQMain,
      pctQTake: TrackersApp.#onQTake,
      pctQDel: TrackersApp.#onQDel,
      pctQClear: TrackersApp.#onQClear,
      pctQImg: TrackersApp.#onQImg,
      pctOpenActor: TrackersApp.#onOpenActor,
      pctPreview: TrackersApp.#onPreview,
      pctPresets: TrackersApp.#onPresets,
    },
  };

  constructor(options = {}) {
    super(foundry.utils.mergeObject({ position: loadSize() }, options));
  }

  state = (() => {
    const ui = loadUI();
    return { tab: ui.tab ?? null, closed: new Set(ui.closed ?? []), notesOpen: new Set(ui.notesOpen ?? []), edit: new Set(), preview: false, quest: ui.quest ?? null, qedit: new Set(), rl: null };
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
    const kinds = this.isGM ? KINDS : KINDS.filter((k) => all.some((t) => t.kind === k) || (k === "quest" && partyQuestsOn()));
    if (!kinds.includes(this.state.tab)) this.state.tab = kinds[0] ?? null;
    const el = document.createElement("div");
    el.className = "pct";
    const rail = kinds.map((k) => {
      const n = all.filter((t) => t.kind === k).length;
      const dot = k === "quest" && !game.user.isGM && all.some((t) => t.kind === "quest" && unseen(t) && !(this.state.tab === "quest" && t.id === this.state.quest)) ? `<b class="pct-qdot" data-tooltip="Something new"></b>` : "";
      return `<a data-action="pctTab" data-kind="${k}" class="${this.state.tab === k ? "active" : ""}"><i class="${KIND_INFO[k].icon}"></i><span>${esc(KIND_INFO[k].tab)}</span>${dot}${n ? `<em>${n}</em>` : ""}</a>`;
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
        ${this.isGM ? A("pctNew", "fa-solid fa-plus", { label: `New ${info.label.toLowerCase()}`, data: { kind }, cls: "pct-new" }) : kind === "quest" && !game.user.isGM && partyQuestsOn() ? A("pctQNew", "fa-solid fa-plus", { label: "New quest", tip: "A quest the whole party can edit", cls: "pct-new" }) : ""}</header>`;
    if (kind === "quest") {
      // Brought back here after the panel's own close button hid it.
      const panelOff = !game.settings.get(MOD, "questPanel") ? `<p class="pct-hint pct-panel-off">The quest panel is hidden for you. ${A("pctPanelOn", "fa-solid fa-scroll", { label: "Show the quest panel" })}</p>` : "";
      return head + panelOff + this.#quests(list);
    }
    const cards = list.map((t) => this.#card(t)).join("") || `<p class="pct-hint">${this.isGM ? "None yet." : "Nothing here yet."}</p>`;
    return head + cards;
  }

  /** Quests: a list grouped by status beside the chosen quest, like a journal. */
  #quests(list) {
    if (!list.length) return `<p class="pct-hint">${this.isGM ? "None yet." : "Nothing here yet."}</p>`;
    if (!list.some((q) => q.id === this.state.quest)) this.state.quest = (list.find((q) => q.status === "active") ?? list[0]).id;
    const pins = new Set(pinned());
    const groups = QGROUPS.map((st) => {
      const rows = list.filter((q) => (QSTATUS.includes(q.status) ? q.status : "active") === st);
      if (!rows.length) return "";
      return `<div class="pct-sub">${esc(QSTATUS_LABEL[st])} <em>${rows.length}</em></div><ul>${rows.map((q) => {
        const main = q.objectives.filter((o) => !o.optional);
        const done = main.filter((o) => o.state === "done").length;
        const mark = game.user.isGM || q.id === this.state.quest ? "" : unseen(q);
        return `<li><a data-action="pctQuestGo" data-qid="${esc(q.id)}" draggable="true" class="pct-qli-${esc(q.status)} ${q.id === this.state.quest ? "active" : ""} ${this.isGM && !q.revealed ? "pct-hiddenq" : ""}">
            ${this.isGM && !q.revealed ? `<i class="fa-solid fa-eye-slash" data-tooltip="Hidden from players"></i>` : ""}<span>${esc(q.name)}</span>${q.party ? `<i class="fa-solid fa-users pct-qli-ico" data-tooltip-text="${esc(`A party quest, made by ${q.party.by === game.user.id ? "you" : q.party.name || "a player"}`)}"></i>` : ""}${q.focus ? `<i class="fa-solid fa-star pct-qli-ico" data-tooltip="Party focus"></i>` : ""}${pins.has(q.id) ? `<i class="fa-solid fa-thumbtack pct-qli-ico" data-tooltip="Pinned to your quest panel"></i>` : ""}${mark ? `<b class="pct-qnew">${mark === "new" ? "New" : "Updated"}</b>` : ""}
            <small>${[q.category, main.length ? `${done}/${main.length}` : ""].filter(Boolean).map(esc).join(" · ")}</small></a></li>`;
      }).join("")}</ul>`;
    }).join("");
    const chosen = list.find((q) => q.id === this.state.quest);
    if (chosen && !game.user.isGM) markSeen(chosen);
    return `<div class="pct-quests"><nav class="pct-qlist">${groups}</nav><div class="pct-qdetail">${chosen ? this.#card(chosen) : ""}</div></div>`;
  }

  #card(t) {
    const closed = this.state.closed.has(t.id);
    if (!this.isGM) {
      const party = canPartyEdit(t);
      const secs = new Set([...this.state.qedit].filter((k) => k.startsWith(`${t.id}:`)).map((k) => k.slice(t.id.length + 1)));
      const del = party && t.party.by === game.user.id ? A("pctQDel", "fa-solid fa-trash", { tip: "Delete this quest" }) : "";
      const body = party ? questParty(t, secs) : `${t.desc ? `<p class="pct-desc">${para(t.desc)}</p>` : ""}${PLAYER[t.kind](t)}`;
      return `<article class="pct-card ${t.kind === "quest" ? `pct-qcard-${esc(t.status)}` : ""}" data-tid="${esc(t.id)}">
          <header>${A("pctFold", closed ? "fa-solid fa-caret-right" : "fa-solid fa-caret-down", { cls: "pct-fold" })}<h3>${esc(t.name)}</h3>${t.kind === "quest" ? `<span class="pct-tools">${pinTools(t, false)}${del}</span>` : ""}</header>
          ${closed ? "" : `<div class="pct-card-body">${body}</div>`}
        </article>`;
    }
    const editing = this.state.edit.has(t.id);
    const picking = this.state.rl?.qid === t.id && !editing;
    const tools = [
      t.kind === "quest" ? pinTools(t, true) : "",
      t.kind === "quest" && !editing ? A("pctRLPick", "fa-solid fa-link", { tip: picking ? "Stop picking parts" : "Make a reveal link: pick the parts it reveals, then drag it into a journal page or copy it", cls: picking ? "pct-on" : "" }) : "",
      A("pctReveal", t.revealed ? "fa-solid fa-eye" : "fa-solid fa-eye-slash", { tip: t.revealed ? "Shown to players. Click to hide." : "Hidden from players. Click to show.", cls: `pct-eye ${t.revealed ? "pct-on" : ""}` }),
      A("pctPost", "fa-solid fa-comment", { tip: "Post to chat what players see" }),
      A("pctEdit", "fa-solid fa-pen", { tip: editing ? "Done editing" : "Edit", cls: editing ? "pct-on" : "" }),
      A("pctDelete", "fa-solid fa-trash", { tip: "Delete" }),
    ].join("");
    const secs = new Set([...this.state.qedit].filter((k) => k.startsWith(`${t.id}:`)).map((k) => k.slice(t.id.length + 1)));
    if (t.kind === "quest" && !closed && !editing) {
      return `<article class="pct-card pct-qcard-${esc(t.status)} ${t.revealed ? "" : "pct-hidden"}" data-tid="${esc(t.id)}" data-drop-card>
          <header>${A("pctFold", "fa-solid fa-caret-down", { cls: "pct-fold" })}<h3>${esc(t.name)}</h3><span class="pct-sum">${esc(summary(t))}</span><span class="pct-tools">${tools}</span></header>
          <div class="pct-card-body">${questGM(t, secs, picking ? new Set(this.state.rl.ids) : null)}</div>
        </article>`;
    }
    const body = closed ? "" : `<div class="pct-card-body">${editing ? editView(t) : `${t.desc ? `<p class="pct-desc">${para(t.desc)}</p>` : ""}${GM[t.kind](t)}${t.notes ? `<details class="pct-notes-box" ${this.state.notesOpen.has(t.id) ? "open" : ""}><summary>GM notes</summary><div class="pct-gm">${para(t.notes)}</div></details>` : ""}`}</div>`;
    return `<article class="pct-card ${t.kind === "quest" ? `pct-qcard-${esc(t.status)}` : ""} ${t.revealed ? "" : "pct-hidden"}" data-tid="${esc(t.id)}" data-drop-card>
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
    this.element.addEventListener("dragstart", (ev) => {
      const rl = ev.target.closest?.(".pct-rl-drag");
      if (rl) {
        const text = this.#rlText(rl);
        if (text) ev.dataTransfer.setData("text/plain", text);
        return;
      }
      const clue = ev.target.closest?.("[data-clue]");
      if (clue) {
        const tid = clue.closest("[data-tid]")?.dataset.tid;
        if (!tid) return;
        ev.dataTransfer.setData(CLUE_DRAG, JSON.stringify({ tid, clue: clue.dataset.clue }));
        ev.dataTransfer.effectAllowed = "move";
        return;
      }
      const a = ev.target.closest?.(".pct-qlist a[data-qid]");
      if (!a) return;
      const q = visibleTrackers().find((t) => t.id === a.dataset.qid);
      if (q) ev.dataTransfer.setData("text/plain", `@Quest[${q.id}]`);
    });
    // The part link icons are plain elements (they drag better than buttons): Enter or Space copies, as a click does.
    this.element.addEventListener("keydown", (ev) => {
      if ((ev.key === "Enter" || ev.key === " ") && ev.target.matches?.(".pct-rl-one")) {
        ev.preventDefault();
        ev.target.click();
      }
    });
    this.element.addEventListener("change", (ev) => {
      const box = ev.target.closest?.("input[data-rl-pick]");
      if (box) return this.#onRLTick(box);
      this.#onChange(ev);
    });
    // A redraw put off while a field had focus happens once focus leaves the form (refresh checks again).
    this.element.addEventListener("focusout", () => {
      if (this._deferred) refresh();
    });
    // <details> doesn't bubble its toggle event, so listen in the capture phase.
    this.element.addEventListener("toggle", (ev) => {
      const box = ev.target;
      if (box?.classList?.contains("pct-ondone")) {
        box.open ? openDetails.add(box.dataset.key) : openDetails.delete(box.dataset.key);
        return;
      }
      if (!box?.classList?.contains("pct-notes-box")) return;
      const id = box.closest("[data-tid]")?.dataset.tid;
      if (!id) return;
      box.open ? this.state.notesOpen.add(id) : this.state.notesOpen.delete(id);
      saveUI(this.state);
    }, true);
    this.element.addEventListener("dragover", (ev) => {
      if (ev.target.closest?.("[data-drop]")) ev.preventDefault();
      const zone = ev.dataTransfer?.types?.includes(CLUE_DRAG) ? ev.target.closest?.("[data-goal-drop]") : null;
      if (!zone) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "move";
      if (this._dropZone !== zone) {
        this._dropZone?.classList.remove("pct-drop-over");
        zone.classList.add("pct-drop-over");
        this._dropZone = zone;
      }
    });
    this.element.addEventListener("dragleave", (ev) => {
      if (this._dropZone && !this._dropZone.contains(ev.relatedTarget)) {
        this._dropZone.classList.remove("pct-drop-over");
        this._dropZone = null;
      }
    });
    this.element.addEventListener("drop", (ev) => {
      this._dropZone?.classList.remove("pct-drop-over");
      this._dropZone = null;
      const zone = ev.dataTransfer?.types?.includes(CLUE_DRAG) ? ev.target.closest?.("[data-goal-drop]") : null;
      if (!zone) return this.#onDrop(ev);
      ev.preventDefault();
      let data;
      try {
        data = JSON.parse(ev.dataTransfer.getData(CLUE_DRAG));
      } catch {
        return;
      }
      if (data?.tid && data.tid === zone.closest("[data-tid]")?.dataset.tid) this.#fileClue(data.tid, String(data.clue), zone.dataset.goalDrop ?? "");
    });
  }

  _onClose() {
    openApps.delete(this);
  }

  /* Foundry restores a minimized window to its measured size on screen, which is smaller than its real size when
   * the interface is scaled; keep the real size from before and put it back. */
  #beforeMin = null;
  #restoring = false;
  #restore = null;
  async minimize() {
    if (!this.minimized && this.rendered) this.#beforeMin = { width: this.position.width, height: this.position.height };
    return super.minimize();
  }
  maximize() {
    // A restore already under way is the one to wait for.
    if (this.#restore) return this.#restore;
    if (!this.minimized) return super.maximize();
    this.#restore = this.#restoreWhole().finally(() => (this.#restore = null));
    return this.#restore;
  }
  async #restoreWhole() {
    const was = this.#beforeMin;
    this.#restoring = true;
    try {
      const pending = super.maximize();
      // Foundry's restore animation can stall at the header's height (seen on Foundry 14.370, core windows too) and
      // Foundry sets the size while it runs, which would leave the window a strip. Finish the animation at once; then
      // let anything left end before putting the size back.
      for (const a of this.element.getAnimations?.() ?? []) {
        try {
          a.finish();
        } catch {
          /* nothing to finish */
        }
      }
      await pending;
      await settle(this.element);
      // Not if it was closed or minimized again meanwhile.
      if (was && this.rendered && !this.minimized) this.setPosition(was);
    } finally {
      this.#restoring = false;
    }
  }

  /** Remember the size and place the user gives the window (not while it's minimized or being restored). */
  _onPosition(position) {
    super._onPosition?.(position);
    if (!this.rendered || this.minimized || this.#restoring) return;
    if (![position.width, position.height, position.left, position.top].every(Number.isFinite)) return;
    if (position.width < 400 || position.height < 250) return;
    saveSize(position);
  }

  /** Draw the window, restoring it first if it's minimized (a draw that ends while it's collapsed sizes it wrong). */
  async show() {
    if (this.minimized || this.#restore) {
      const open = this.rendered;
      await this.maximize();
      // Closed while it was being restored: don't open it again.
      if (open && !this.rendered) return this;
    }
    return this.render({ force: true });
  }

  async #onChange(ev) {
    const el = ev.target.closest?.("[data-path]");
    const card = el?.closest("[data-tid]");
    if (!el || !card) return;
    if (!game.user.isGM && !canPartyEdit(this.trackerFor(card))) return;
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
    } else if (type === "idlist") {
      const on = el.checked, rowId = el.value;
      return mutateTracker(card.dataset.tid, (t) => {
        const list = new Set(foundry.utils.getProperty(t, path) ?? []);
        on ? list.add(rowId) : list.delete(rowId);
        foundry.utils.setProperty(t, path, [...list]);
      }, { notify: false });
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
    if (/\.link\.tid$/.test(path)) {
      const at = path.slice(0, -".link.tid".length);
      return mutateTracker(card.dataset.tid, (t) => {
        const g = foundry.utils.getProperty(t, at);
        if (g) g.link = value ? { tid: value, cond: null, at: null, entry: null } : null;
      }, { notify: false });
    }
    await mutateTracker(card.dataset.tid, (t) => {
      if (type === "segcount") {
        while (t.segments.length < value) t.segments.push(TPL.segment());
        t.segments.length = value;
        return;
      }
      foundry.utils.setProperty(t, path, value);
    });
  }

  /** File a clue under a goal (or nothing): the GM directly, a player through the GM. */
  async #fileClue(tid, clueId, under) {
    if (this.isGM) {
      await mutateTracker(tid, (t) => {
        const e = (t.entries ?? []).find((x) => x.id === clueId);
        if (!e || (under && !findGoal(t, under)) || (e.under ?? "") === under) return undefined;
        e.under = under;
        return true;
      }, { notify: false });
      return;
    }
    if (!game.user.isGM) sortToGM(tid, clueId, under);
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
    const where = zone.dataset.drop;
    const link = { uuid: actor.uuid, name: actor.prototypeToken?.name?.trim() || actor.name, img: actor.img, type: actor.type };
    if (where.endsWith(".actor") && actor.type !== "loot") ui.notifications.info(`${actor.name} isn't a loot actor. Linked anyway.`);
    await mutateTracker(card.dataset.tid, (t) => {
      if (where === "npc") t.npc = link;
      else if (where === "giver") t.giver = link;
      else if (/^rewards\.\d+\.actor$/.test(where)) foundry.utils.setProperty(t, where, link);
    }, { notify: false });
  }

  static #onQTick(event, target) {
    const t = this.trackerFor(target);
    if (!t) return;
    target.classList.add("pct-busy");
    setTimeout(() => target.classList.remove("pct-busy"), 5000);
    tickToGM(t.id, target.dataset.goal, target.dataset.to);
  }

  /** Mark a lead followed or not: the GM directly (then offers what it reveals), a player through the GM. */
  static async #onLeadFollow(event, target) {
    const t = this.trackerFor(target);
    if (!t) return;
    const { lead, to } = target.dataset;
    if (this.isGM) {
      const done = await mutateTracker(t.id, (tr) => {
        const l = (tr.leads ?? []).find((x) => x.id === lead);
        if (!l || l.followed === (to === "done")) return undefined;
        l.followed = to === "done";
        l.followedBy = l.followed ? "gm" : null;
        return true;
      }, { notify: false });
      if (done && to === "done") await offerLead(t.id, lead);
      return;
    }
    if (game.user.isGM) return;
    target.classList.add("pct-busy");
    setTimeout(() => target.classList.remove("pct-busy"), 5000);
    followToGM(t.id, lead, to);
  }

  static async #onQNoteAdd(event, target) {
    const t = this.trackerFor(target);
    const area = target.closest(".pct-qnote-add")?.querySelector("textarea");
    const text = area?.value.trim();
    if (!t || !text) return;
    if (this.isGM) {
      if ((t.pnotes?.length ?? 0) >= NOTE_MAX) return ui.notifications.warn(`The Party Journal of ${esc(t.name)} has ${NOTE_MAX} entries, the most it holds. Delete some first.`);
      await mutateTracker(t.id, (tr) => applyQuestNote(tr, "add", { by: game.user.id, name: "GM", text, isGM: true }) || undefined, { notify: false });
    } else if (game.user.isGM) {
      return;
    } else if (sendToGM({ type: "qnote", tid: t.id, text })) {
      area.value = "";
    }
  }

  static async #onQNoteJournal(event, target) {
    const t = this.trackerFor(target);
    if (!this.isGM || !t) return;
    const id = target.dataset.note;
    await mutateTracker(t.id, (tr) => {
      const n = (tr.pnotes ?? []).find((x) => x.id === id);
      if (!n || tr.entries.some((e) => e.from === id)) return undefined;
      tr.entries.push({ ...TPL.qentry(), date: today(), text: n.text, by: n.name, from: id, revealed: true });
      return true;
    }, { notify: false });
  }

  static async #onQNoteDel(event, target) {
    const t = this.trackerFor(target);
    if (!t) return;
    const id = target.dataset.note;
    if (this.isGM) await mutateTracker(t.id, (tr) => applyQuestNote(tr, "delete", { id, isGM: true }) || undefined, { notify: false });
    else sendToGM({ type: "qnoteDel", tid: t.id, note: id });
  }

  static #onQSec(event, target) {
    const key = `${target.closest("[data-tid]").dataset.tid}:${target.dataset.sec}`;
    this.state.qedit.has(key) ? this.state.qedit.delete(key) : this.state.qedit.add(key);
    this.render();
  }

  /** Start or stop picking parts of this quest for one reveal link. */
  static #onRLPick(event, target) {
    const id = target.closest("[data-tid]")?.dataset.tid;
    if (!id) return;
    this.state.rl = this.state.rl?.qid === id ? null : { qid: id, ids: [] };
    this.render();
  }

  static #onRLClear() {
    if (this.state.rl) this.state.rl.ids = [];
    this.render();
  }

  async #onRLTick(box) {
    const qid = box.closest("[data-tid]")?.dataset.tid;
    if (!this.state.rl || this.state.rl.qid !== qid) return;
    const id = box.dataset.rlPick;
    const ids = new Set(this.state.rl.ids);
    box.checked ? ids.add(id) : ids.delete(id);
    this.state.rl.ids = [...ids];
    const focused = document.activeElement === box;
    await this.render();
    if (focused) this.element.querySelector(`input[data-rl-pick="${CSS.escape(id)}"]`)?.focus();
  }

  /** The reveal link a tool stands for: one part, or ("*") the parts picked. Null when an id can't go in a link. */
  #rlText(el) {
    if (!game.user.isGM) return null;
    const t = Store.get(el.closest("[data-tid]")?.dataset.tid);
    if (t?.kind !== "quest") return null;
    const ids = el.dataset.rl === "*" ? (this.state.rl?.qid === t.id ? this.state.rl.ids : []) : [el.dataset.rl];
    return revealLinkText(t, ids);
  }

  static async #onRLCopy(event, target) {
    const text = this.#rlText(target);
    if (!text) return void ui.notifications.warn("This quest's id has a character a reveal link can't hold.");
    if (await copyText(text)) ui.notifications.info("Reveal link copied. Paste it into a journal page.");
    else ui.notifications.warn("The browser wouldn't copy it. Drag it into the page instead.");
  }

  static #onQuestGo(event, target) {
    // Picking parts for a reveal link ends when another quest is shown.
    if (this.state.rl && this.state.rl.qid !== target.dataset.qid) this.state.rl = null;
    this.state.quest = target.dataset.qid;
    saveUI(this.state);
    this.render();
  }

  /** An objective or step: click marks it done (or open again), right-click failed (or open again). */
  static async #onQState(event, target) {
    if (!this.isGM) return;
    const right = event.button === 2 || event.type === "contextmenu";
    await setGoalState(target.closest("[data-tid]").dataset.tid, { goal: target.dataset.goal }, right);
  }

  static async #onQFocus(event, target) {
    const t = this.trackerFor(target);
    if (!t || !this.isGM) return;
    await mutateTracker(t.id, (tr) => {
      tr.focus = !tr.focus;
    }, { notify: false });
  }

  /** A player makes a party quest: a name and a summary, then the GM's client makes it and it opens for them. */
  static async #onQNew() {
    if (game.user.isGM || !partyQuestsOn()) return;
    const data = await foundry.applications.api.DialogV2.wait({
      window: { title: "New quest", icon: "fa-solid fa-scroll" },
      classes: ["pct-qnew-dialog"],
      position: { width: 420 },
      content: `<div class="pct-dialog-form"><label>Name <input type="text" name="name" placeholder="Who is buying the stolen ledgers?" autofocus></label>
        <label>Summary <textarea name="desc" rows="3" placeholder="What the party wants to find out or do"></textarea></label>
        <p class="pct-hint">Anyone in the party can edit it. A GM needs to be logged in.</p></div>`,
      buttons: [
        { action: "ok", label: "Make it", icon: "fa-solid fa-check", default: true, callback: (event, button) => ({ name: button.form.elements.name.value.trim(), desc: button.form.elements.desc.value.trim() }) },
        { action: "cancel", label: "Cancel" },
      ],
      rejectClose: false,
    });
    if (!data || typeof data !== "object" || !data.name) return;
    sendToGM({ type: "qnew", name: data.name, desc: data.desc });
  }

  static async #onQMain(event, target) {
    const t = this.trackerFor(target);
    if (!this.isGM || !t?.party) return;
    await mutateTracker(t.id, (tr) => {
      tr.category = "Main";
    }, { notify: false });
  }

  /** The GM takes a party quest over: it becomes an ordinary quest of theirs, everything in it kept. */
  static async #onQTake(event, target) {
    const t = this.trackerFor(target);
    if (!this.isGM || !t?.party) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Take it over" },
      content: `<p>Make <strong>${esc(t.name)}</strong> your quest? Everything in it stays, and players still see it, but they can only tick objectives and write in the Party Journal from now on. This can't be undone from the window.</p>`,
    });
    if (!ok) return;
    await mutateTracker(t.id, (tr) => {
      tr.party = null;
    }, { notify: false });
  }

  static async #onQDel(event, target) {
    const t = this.trackerFor(target);
    if (!t?.party || t.party.by !== game.user.id) return;
    const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Delete quest" }, content: `<p>Delete <strong>${esc(t.name)}</strong> for the whole party? This can't be undone.</p>` });
    if (ok) sendToGM({ type: "qdel", tid: t.id });
  }

  static async #onPanelOn() {
    await game.settings.set(MOD, "questPanel", true);
  }

  static #onQPin(event, target) {
    const t = this.trackerFor(target);
    if (t) togglePin(t.id);
  }

  static async #onQClear(event, target) {
    const id = target.closest("[data-tid]").dataset.tid;
    const path = target.dataset.path;
    await mutateTracker(id, (t) => {
      foundry.utils.setProperty(t, path, null);
    }, { notify: false });
  }

  static #onQImg(event, target) {
    const t = this.trackerFor(target);
    if (!t) return;
    const FP = foundry.applications.apps.FilePicker.implementation;
    new FP({ type: "image", current: t.img || "", callback: (path) => mutateTracker(t.id, (tr) => {
      tr.img = path;
    }, { notify: false }) }).render(true);
  }

  static async #onOpenActor(event, target) {
    const actor = await fromUuid(target.dataset.uuid);
    if (!actor) return ui.notifications.warn("That actor no longer exists.");
    if (!actor.testUserPermission(game.user, "LIMITED")) return ui.notifications.info(`You can't open ${actor.name} yet.`);
    actor.sheet.render(true);
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
    const now = await mutateTracker(id, (t) => {
      foundry.utils.setProperty(t, path, !foundry.utils.getProperty(t, path));
      const on = !!foundry.utils.getProperty(t, path);
      // A step shown under a hidden objective shows nothing: the objective comes too.
      const sm = on && t.kind === "quest" && path.match(/^objectives\.(\d+)\.steps\.\d+\.revealed$/);
      if (sm && t.objectives?.[Number(sm[1])]) t.objectives[Number(sm[1])].revealed = true;
      return on ? "on" : "off";
    }, { notify: false });
    const lm = path.match(/^leads\.(\d+)\.revealed$/);
    if (now === "on" && lm) {
      const lead = Store.get(id)?.leads?.[Number(lm[1])];
      if (lead) await offerLead(id, lead.id);
      return;
    }
    const m = path.match(/^rewards\.(\d+)\.revealed$/);
    if (now !== "on" || !m) return;
    const t = Store.get(id);
    const reward = t?.rewards?.[Number(m[1])];
    const actor = reward ? await lootToOpen(t, reward.id) : null;
    if (!actor) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Treasure" },
      content: `<p>Let players open <strong>${esc(actor.name)}</strong>, so they can take what's inside? This gives everyone Observer on it.</p>`,
    });
    if (ok) await letPlayersOpen(actor.uuid);
  }

  static async #onAdd(event, target) {
    const id = target.closest("[data-tid]").dataset.tid;
    const list = target.dataset.list;
    if (target.dataset.sec) this.state.qedit.add(`${id}:${target.dataset.sec}`);
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
    await rollCheck({ tid: t.id, target: target.dataset.target, check, title: rollTitle(t, target.dataset.target), hideDC: t.kind === "challenge" });
  }

  static async #onCard(event, target) {
    const t = this.trackerFor(target);
    if (t && game.user.isGM) await postCheckCard(t, { target: target.dataset.target });
  }

  static async #onCardList(event, target) {
    const t = this.trackerFor(target);
    if (t && game.user.isGM) await postCheckCard(t, { list: target.dataset.list });
  }

  static async #onChallengePost(event, target) {
    const t = this.trackerFor(target);
    if (!t || !game.user.isGM) return;
    if (!t.revealed) {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Post to chat" },
        content: `<p><strong>${esc(t.name)}</strong> is hidden from players, so they can't open it in their window. Post it to chat anyway?</p>`,
      });
      if (!ok) return;
    }
    await postChallengeCard(t, target.dataset.mode);
  }

  static async #onChallengeCheck(event, target) {
    const t = this.trackerFor(target);
    if (t && game.user.isGM) await adhocDialog(t);
  }

  static async #onPropose(event, target) {
    const t = this.trackerFor(target);
    if (t) await proposeDialog(t.id);
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

  /** Open the window, on a tab if one is named (see findTab). */
  static open(tab = null) {
    if (!game.user.isGM && !game.settings.get(MOD, "playerAccess")) return ui.notifications.warn("The GM hasn't opened the campaign trackers to players.");
    const app = [...openApps][0] ?? new TrackersApp();
    if (tab != null) {
      const to = findTab(tab);
      if (!to) console.warn(`${MOD} | api.open: no tab or tracker called "${tab}"; opening as last left`);
      else {
        app.state.tab = to.kind;
        if (to.kind === "quest" && to.tid) app.state.quest = to.tid;
        saveUI(app.state);
      }
    }
    return app.show();
  }
}

/* ------------------------------------------------------------------ */
/* Registration                                                       */
/* ------------------------------------------------------------------ */

Hooks.once("init", () => {
  CONFIG.TextEditor.enrichers.push({ pattern: QUEST_LINK, enricher: async (match) => enrichQuestLink(match) });
  CONFIG.TextEditor.enrichers.push({ pattern: REVEAL_LINK, enricher: async (match, options) => enrichRevealLink(match, options) });
  document.addEventListener("click", onQuestLink, true);
  document.addEventListener("toggle", onFoldToggle, true);
  document.addEventListener("click", onRevealLink, true);
  document.addEventListener("dragover", onRevealDragOver, true);
  document.addEventListener("dragleave", onRevealDragLeave, true);
  document.addEventListener("drop", onRevealDrop, true);
  game.settings.register(MOD, "public", { scope: "world", config: false, type: Object, default: { trackers: [] }, onChange: (v) => {
    questNotices(v);
    refresh();
  } });
  game.settings.register(MOD, "playerTicks", {
    name: "Players can tick objectives, follow leads and file clues",
    hint: "On revealed quests: players mark objectives and steps done and leads followed (the GM gets a card each time), and file clues under objectives. They can undo a player's mark, not the GM's.",
    scope: "world", config: true, type: Boolean, default: true, onChange: () => refresh(),
  });
  game.settings.register(MOD, "partyQuests", {
    name: "Players can make quests",
    hint: "Players make quests of their own, which anyone in the party can edit (a GM must be logged in). You can make one a main quest or take it over.",
    scope: "world", config: true, type: Boolean, default: true, onChange: () => refresh(),
  });
  game.settings.register(MOD, "questPanel", {
    name: "Show the quest panel",
    hint: "A small panel with the party's focus and the quests you pinned, and their open objectives. Just for you.",
    scope: "client", config: true, type: Boolean, default: true, onChange: () => {
      renderPanel();
      refresh();
    },
  });
  game.settings.register(MOD, "questSound", {
    name: "Quest notice sound",
    hint: "A sound players hear with the notice when a quest is added or changes. Leave blank for none.",
    scope: "world", config: true, type: String, default: "", filePicker: "audio",
  });
  game.settings.register(MOD, "reminders", {
    name: "Date reminders",
    hint: "Whisper the GM when the calendar reaches a date on a clock, a checklist entry or a quest.",
    scope: "world", config: true, type: Boolean, default: true,
  });
  game.settings.register(MOD, "playerAccess", {
    name: "Players can open the trackers",
    hint: "Players see only what you've revealed. Turn this off to keep the window and the quest panel GM-only.",
    scope: "world", config: true, type: Boolean, default: true, onChange: () => refresh(),
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

Hooks.once("ready", () => {
  game.socket.on(SOCKET, onSocket);
  if (game.user.isGM) {
    announceTab(true);
    setInterval(() => announceTab(false), 15000);
    window.addEventListener("beforeunload", () => game.socket.emit(SOCKET, { type: "gmbye", client: CLIENT_ID }));
  }
  // Players start from what is already shared, so only later changes bring notices.
  if (!game.user.isGM) lastQuests = questsOf(game.settings.get(MOD, "public"));
});
Hooks.once("ready", async () => {
  // Links drawn before the trackers loaded (chat, an open journal) pick up their names.
  setTimeout(repaintQuestLinks, 2000);
  const api = {
    open: (tab) => TrackersApp.open(tab),
    /** Propose a check outside a skill challenge: the selected token's character (or the user's own), a skill,
     * what they do and why. The GM approves it with a DC, and the player rolls from the card. For a hotbar macro. */
    propose: () => proposeDialog(null),
    /** Open the window on a quest this user can see (another module's link to it, say). */
    openQuest: (id) => openQuest(id),
    /**
     * The quests this user can see (the GM: all), as { id, name, status, statusLabel, category, done, total,
     * shownDone, shownTotal, revealed, party, focus, mark }. done and total skip optional objectives; the shown pair
     * counts only what players see. mark is this user's "new", "updated" or "". Empty for players while they can't
     * open the trackers.
     */
    quests: () => (questsOpen() ? visibleTrackers() : []).filter((t) => t.kind === "quest").map((t) => {
      const main = (t.objectives ?? []).filter((o) => !o.optional);
      const shown = game.user.isGM ? (project(t, { all: Store.data.trackers })?.objectives ?? []).filter((o) => !o.optional) : main;
      return {
        shownDone: shown.filter((o) => o.state === "done").length, shownTotal: shown.length,
        id: t.id, name: t.name, status: t.status, statusLabel: QSTATUS_LABEL[t.status] ?? "Active", category: t.category ?? "",
        done: main.filter((o) => o.state === "done").length, total: main.length,
        revealed: game.user.isGM ? !!t.revealed : true, party: !!t.party, focus: !!t.focus,
        mark: game.user.isGM ? "" : unseen(t),
      };
    }),
    /** A quest as the players see it, read-only, as HTML styled by this module (no actions; links to other quests
     * carry data-pct-action="pctQuestGo" and data-qid, loot links data-pct-action="pctOpenActor" and data-uuid).
     * null when players can't see it. */
    questHTML: (id) => questReadOnly(id),
    /** Mark a quest seen by this user (clears its New/Updated mark), as opening it in the window does. */
    markQuestSeen: (id) => {
      if (game.user.isGM) return;
      const q = visibleTrackers().find((t) => t.id === id && t.kind === "quest");
      if (q && markSeen(q)) refresh();
    },
    /** A reveal link's text for a quest and some of its parts (ids), with an optional label. GM only. */
    revealLink: (questId, partIds = [], label = null) => {
      const t = game.user.isGM ? Store.get(questId) : null;
      return t?.kind === "quest" ? revealLinkText(t, [].concat(partIds), label) : null;
    },
    /** Reveal parts of a quest as a reveal link would: with the checklist, or { ask: false } at once. GM only. */
    revealParts: (questId, partIds = [], { ask = true } = {}) => revealFromLink(questId, [].concat(partIds).join(","), { ask }),
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
    // Links drawn before the data loaded (chat at startup) said so; draw them again.
    repaintQuestLinks();
    if (isPrimaryGM() && !Store.broken) await publish(Store.data);
    // Chat drew its messages before the data was loaded, so Apply boxes and proposal controls are missing: draw them again.
    for (const m of game.messages.contents.slice(-100)) {
      if (m.flags?.[SCOPE]?.proposal || m.flags?.[SCOPE]?.adhoc || m.flags?.[SCOPE]?.qprompt || parseTag(m.flags?.pf2e?.context?.options)) ui.chat?.updateMessage?.(m);
    }
    Hooks.callAll(`${MOD}.ready`, api);
    await syncPresets();
    scheduleReminders();
  } else {
    Hooks.callAll(`${MOD}.ready`, api);
  }
  renderPanel();
  // A calendar module may set the calendar up just after ready; draw dates again once it has.
  setTimeout(renderPanel, 1500);
  window.addEventListener("resize", () => placePanel());
});
Hooks.on("calendaria.ready", () => refresh());
Hooks.on("calendaria.calendarSwitched", () => refresh());

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
/**
 * PF2e shows a roll's DC and margin to players when the world's "show check DCs" setting is on,
 * whatever the roll asks. On rolls marked HIDE_DC, the rolling client marks those parts GM-only
 * before the card is created, as PF2e does itself with the setting off. Rerolls keep the mark.
 */
Hooks.on("preCreateChatMessage", (message) => {
  const opts = message.flags?.pf2e?.context?.options;
  if (!Array.isArray(opts) || !opts.includes(HIDE_DC) || !message.flavor) return;
  const div = document.createElement("div");
  div.innerHTML = message.flavor;
  const parts = div.querySelectorAll(".target-dc, [data-whose=\"opposer\"]");
  if (!parts.length) return;
  for (const el of parts) el.dataset.visibility = "gm";
  message.updateSource({ flavor: div.innerHTML });
});
/** An applied roll card deleted by a reroll: keep what it applied for the reroll's new card. */
Hooks.on("deleteChatMessage", (message) => {
  if (!game.user.isGM) return;
  const applied = message.flags?.[SCOPE]?.applied;
  const key = rerollKey(message);
  if (!applied?.changes || !key) return;
  rerollStash.set(key, { text: applied.text, changes: applied.changes, at: Date.now() });
  for (const [k, v] of rerollStash) if (Date.now() - v.at > 120000) rerollStash.delete(k);
});
/** The reroll's new card: the active GM marks it, so the offer to replace survives a reload. */
Hooks.on("createChatMessage", (message) => {
  if (!isPrimaryGM() || !message.flags?.pf2e?.context?.isReroll) return;
  const key = rerollKey(message);
  const hit = key ? rerollStash.get(key) : null;
  if (!hit) return;
  message.setFlag(SCOPE, "rerolled", { text: hit.text, changes: hit.changes }).finally(() => rerollStash.delete(key));
});
/**
 * A roll from a GM's check card ticks that character off on the card, and a roll from an approved
 * proposal marks the proposal rolled. The active GM's client does it, since it can change anyone's message.
 */
Hooks.on("createChatMessage", (message) => {
  if (!isPrimaryGM()) return;
  const ctx = message.flags?.pf2e?.context;
  const tag = parseTag(ctx?.options);
  if (!tag || !ctx.actor || ctx.isReroll) return;
  const recent = game.messages.contents.slice(-100).reverse();
  const card = recent.find((m) => m.flags?.[SCOPE]?.adhoc?.row === tag.target);
  const ad = card?.flags[SCOPE].adhoc;
  if (ad && ad.actors?.includes(ctx.actor) && !ad.rolled?.[ctx.actor]) card.update({ [`flags.${SCOPE}.adhoc.rolled.${ctx.actor}`]: true });
  const prop = recent.find((m) => m.flags?.[SCOPE]?.proposal?.target === tag.target);
  const pr = proposalOf(prop);
  if (pr && pr.status === "approved" && pr.actorId === ctx.actor && !pr.rolled) prop.update({ [`flags.${SCOPE}.proposal.rolled`]: true });
});
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
