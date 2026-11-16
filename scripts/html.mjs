/** Pieces of the window's HTML shared by every view: buttons, steppers, eyes, folds and the quest body. */

import { esc, labelAttr, tipAttr } from "./kit/safe-text.mjs";
import { dkey, exampleDate, fmtDate, today } from "./calendar.mjs";
import { shortText, skillLabel } from "./checks.mjs";
import { DEGREES, DEGREE_LABEL, MOD, local, lz, num, oldKey, para } from "./core.mjs";
import { NOTE_LEN, QSTATUS_LABEL, linkState, reached, stepProgress } from "./data.mjs";
import { rlBar, rlTool } from "./links.mjs";
import { plainObject } from "./notices.mjs";
import { systemInfiltration, systemPoints } from "./rules.mjs";
import { Store, partyQuestsOn, partyTicks } from "./store.mjs";
import { QEDIT, QEDIT_PARTY } from "./view-edit.mjs";

/* ------------------------------------------------------------------ */
/* HTML helpers                                                        */
/* ------------------------------------------------------------------ */

const dataAttrs = (data) => Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(" ");

/** While read-only HTML is drawn (a quest shown in another module), actions are written as data-pct-action, which
 * this window doesn't answer and the other module may. */
let inert = 0;
function readOnlyHTML(draw) {
  inert++;
  try {
    return draw();
  } finally {
    inert--;
  }
}
const act = (action) => `${inert ? "data-pct-action" : "data-action"}="${esc(action)}"`;

/**
 * An action button. `label` is plain text beside the icon; `tip` its tooltip, and its name when it has no label.
 * `name` gives it a name of its own (a toggle keeps one name in both states, with `pressed`); `expanded` is for folds.
 */
const A = (action, icon, { tip = "", label = "", name = "", cls = "", data = {}, pressed = null, expanded = null, disabled = false } = {}) => {
  const named = name ? ` aria-label="${esc(name)}"${tip ? tipAttr(tip) : ""}` : !label && tip ? labelAttr(tip) : tip ? tipAttr(tip) : "";
  const state = `${pressed === null ? "" : ` aria-pressed="${!!pressed}"`}${expanded === null ? "" : ` aria-expanded="${!!expanded}"`}`;
  return `<button type="button" class="pct-btn ${cls}" ${act(action)} ${dataAttrs(data)}${named}${state}${disabled ? " disabled" : ""}>${icon ? `<i class="${icon}" aria-hidden="true"></i>` : ""}${label ? `<span>${esc(label)}</span>` : ""}</button>`;
};

const F = {
  text: (path, v, ph = "", cls = "") => `<input type="text" data-focus-key="${path}" data-path="${path}" value="${esc(v)}" placeholder="${esc(ph)}" class="${cls}">`,
  num: (path, v, ph = "", cls = "") => `<input type="number" data-focus-key="${path}" data-path="${path}" data-type="number" value="${v === null || v === undefined ? "" : esc(v)}" placeholder="${esc(ph)}" class="pct-num ${cls}">`,
  area: (path, v, ph = "", rows = 2) => `<textarea data-focus-key="${path}" data-path="${path}" rows="${rows}" placeholder="${esc(ph)}">${esc(v)}</textarea>`,
  // A box with no words beside it is named by its tooltip.
  bool: (path, v, label, tip = "") => `<label class="pct-chk" ${tip ? `data-tooltip-text="${esc(tip)}"` : ""}><input type="checkbox" data-focus-key="${path}" data-path="${path}" data-type="bool" ${v ? "checked" : ""}${!label && tip ? ` aria-label="${esc(tip)}"` : ""}> <span>${esc(label)}</span></label>`,
  select: (path, v, opts) => `<select data-focus-key="${path}" data-path="${path}">${opts.map(([val, lab]) => `<option value="${esc(val)}" ${String(val) === String(v) ? "selected" : ""}>${esc(lab)}</option>`).join("")}</select>`,
  date: (path, v) => `<input type="text" data-focus-key="${path}" data-path="${path}" data-type="date" value="${esc(v ? fmtDate(v, { year: true }) : "")}" placeholder="${esc(exampleDate())}" class="pct-date">`,
};
/** A menu behind a "More" button: `items` (empty ones skipped), then `last` set apart (Delete). */
const moreMenu = (key, items, last = "") => `<details class="pct-more" data-focus-key="${esc(`more:${key}`)}"><summary class="pct-btn"${labelAttr(lz("More"))}><i class="fa-solid fa-ellipsis" aria-hidden="true"></i></summary><div class="pct-menu">${items.filter(Boolean).join("")}${last ? `<hr>${last}` : ""}</div></details>`;
const L = (label, inner, cls = "") => `<label class="pct-field ${cls}"><span>${esc(label)}</span>${inner}</label>`;

const eye = (path, on) => A("pctToggle", on ? "fa-solid fa-eye" : "fa-solid fa-eye-slash", { name: lz("ShownToPlayers"), pressed: on, tip: on ? lz("ShownToPlayersClickToHide") : lz("HiddenFromPlayersClickToShow"), data: { path: `${path}.revealed` }, cls: `pct-eye ${on ? "pct-on" : ""}` });

function stepper(path, value, { steps = [1], label = "", tip = "", fmt = (v) => v } = {}) {
  const named = (s) => `${label ? `${label}: ` : ""}${s < 0 ? "minus" : "plus"} ${Math.abs(s)}`;
  const minus = [...steps].reverse().map((s) => A("pctStep", "", { label: `-${s}`, name: named(-s), data: { path, delta: -s }, cls: "pct-step" })).join("");
  const plus = steps.map((s) => A("pctStep", "", { label: `+${s}`, name: named(s), data: { path, delta: s }, cls: "pct-step" })).join("");
  return `<span class="pct-stepper" ${tip ? `data-tooltip-text="${esc(tip)}"` : ""}>${label ? `<span class="pct-step-label">${esc(label)}</span>` : ""}${minus}<span class="pct-value">${esc(fmt(value))}</span>${plus}</span>`;
}

function listEditor(path, rows, rowFn, addLabel) {
  const body = rows.map((r, i) => {
    const p = `${path}.${i}`;
    const tools = `${A("pctMove", "fa-solid fa-arrow-up", { data: { path: p, dir: -1 }, tip: lz("MoveUp") })}${A("pctMove", "fa-solid fa-arrow-down", { data: { path: p, dir: 1 }, tip: lz("MoveDown") })}${A("pctRemove", "fa-solid fa-xmark", { data: { path: p }, tip: lz("Remove") })}`;
    return `<div class="pct-row"><div class="pct-row-main">${rowFn(r, p, i)}</div><span class="pct-row-tools">${tools}</span></div>`;
  }).join("");
  return `<div class="pct-list">${body}</div>${A("pctAdd", "fa-solid fa-plus", { label: addLabel, data: { list: path }, cls: "pct-add" })}`;
}

const SKILLS = ["perception", "acrobatics", "arcana", "athletics", "crafting", "deception", "diplomacy", "intimidation", "medicine", "nature", "occultism", "performance", "religion", "society", "stealth", "survival", "thievery", "fortitude", "reflex", "will"];
const skillList = () => `<datalist id="pct-skills">${SKILLS.map((s) => `<option value="${s}">${esc(skillLabel(s))}</option>`).join("")}</datalist>`;

function checkEdit(c, p, { research = false, bare = false } = {}) {
  const head = `${L(lz("Skill"), `<input type="text" list="pct-skills" data-focus-key="${p}.skill" data-path="${p}.skill" value="${esc(c.skill)}" placeholder="${esc(lz("AthleticsSailingLore"))}" class="pct-skill">`)}
    ${L("DC", F.num(`${p}.dc`, c.dc, "", "pct-dc"))}`;
  if (bare) return head;
  return `${head}
    ${research ? L(lz("MaxRP"), F.num(`${p}.maxRP`, c.maxRP, "none", "pct-dc")) : ""}
    ${L(lz("For"), F.text(`${p}.label`, c.label, research ? lz("WhereOrWhat") : lz("WhatTheCheckDoes")), "pct-grow")}`;
}

function thresholdEdit(th, p, what = lz("At")) {
  return `${L(what, F.num(`${p}.at`, th.at, "", "pct-dc"))}${L(lz("WhatHappens"), F.text(`${p}.text`, th.text), "pct-grow")}`;
}

/** Points for each result. An empty field uses the PF2e rules, whose number is its placeholder ("?" when there is none). */
function degreesEdit(t) {
  const tip = lz("LeaveAFieldEmptyToUse");
  return `<div class="pct-degrees"${tipAttr(tip)}><span class="pct-sub">${lz("PointsForEachResult")}</span>${DEGREES.map((d) => L(DEGREE_LABEL[d], F.num(`degrees.${d}`, t.degrees?.[d], String(systemPoints(d) ?? "?"), "pct-dc"))).join("")}</div>`;
}

/** An infiltration's infiltration and awareness points for each result, the same way. */
function infiltrationDegreesEdit(t) {
  const tip = lz("LeaveAFieldEmptyToUse");
  return `<div class="pct-degrees"${tipAttr(tip)}><span class="pct-sub">${lz("PointsForEachResultInfiltrationAwareness")}</span>${DEGREES.map((d) => {
    const sys = systemInfiltration(d);
    return L(DEGREE_LABEL[d], `${F.num(`degrees.${d}.ip`, t.degrees?.[d]?.ip, String(sys?.infiltration ?? "?"), "pct-dc")}${F.num(`degrees.${d}.ap`, t.degrees?.[d]?.ap, String(sys?.awareness ?? "?"), "pct-dc")}`);
  }).join("")}</div>`;
}

/** A check as a roll button. The GM sees the DC. */
function checkButton(t, target, c, { gm }) {
  const dc = gm && c.dc !== null && c.dc !== undefined && c.dc !== "" ? ` <em>DC ${esc(c.dc)}</em>` : "";
  const rp = c.maxRP !== null && c.maxRP !== undefined && c.maxRP !== "" && c.earned !== null ? ` <span class="pct-chip" ${tipAttr(lz("ResearchPointsEarnedHereOfThe"))}>${num(c.earned)} / ${c.maxRP}</span>` : "";
  return `<button type="button" class="pct-roll" data-action="pctRoll" data-target="${esc(target)}" data-check="${esc(c.id)}" ${tipAttr(gm ? lz("RollForTheSelectedTokens") : lz("RollForYourCharacter"))}><i class="fa-solid fa-dice-d20"></i> <strong>${esc(skillLabel(c.skill))}</strong>${dc}</button>${c.label ? `<span class="pct-for">${esc(c.label)}</span>` : ""}${rp}`;
}

function checkRows(t, target, checks, { gm, perCheckTarget = false, revealEach = false, path = "" }) {
  if (!checks.length) return "";
  return `<div class="pct-checks">${checks.map((c, i) => `<div class="pct-check">${gm && revealEach ? eye(`${path}.${i}`, c.revealed) : ""}${checkButton(t, perCheckTarget ? c.id : target, c, { gm })}</div>`).join("")}</div>`;
}

const cardBtn = (target, tip = lz("PostTheseChecksToChatFor")) => A("pctCard", "fa-solid fa-share-from-square", { tip, data: { target }, cls: "pct-card-post" });

function thresholdRows(list, value, { gm, path = "", unit = "" }) {
  if (!list.length) return "";
  const rows = (gm ? reached(list.map((x, i) => ({ ...x, _i: i })), value) : list).map((th) => {
    const r = th.reached;
    return `<li class="${r ? "pct-reached" : ""}">${gm ? eye(`${path}.${th._i}`, th.revealed) : ""}<i class="fa-${r ? "solid fa-circle-check" : "regular fa-circle"}" aria-hidden="true"></i> ${th.at !== null && th.at !== undefined ? `<strong>${esc(th.at)}${unit}</strong> ` : ""}${para(th.text)}</li>`;
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

/**
 * Points at an individual obstacle held by someone who isn't in the party now: a character who left it, a creature
 * the GM rolled for, or a roll made with no character. They count toward the total, so they get a row too.
 */
function othersAt(o, pcs, { zeros = false } = {}) {
  const inParty = new Set(pcs.map((pc) => pc.id));
  return Object.entries(o.byActor ?? {})
    .filter(([k, v]) => !inParty.has(k) && /^[A-Za-z0-9]{1,32}$/.test(k) && (zeros || num(v) !== 0))
    .map(([k, v]) => {
      const actor = k === "party" ? null : game.actors.get(k);
      // Every actor reaches every client, so a player is told the name only of someone they can see.
      const known = actor && (game.user.isGM || actor.testUserPermission?.(game.user, "LIMITED"));
      return { id: k, value: num(v), name: k === "party" ? lz("NoCharacter") : known ? pcName(actor) : lz("SomeoneElse") };
    });
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
  const word = k < now ? lz("Closed") : k === now ? lz("ClosesToday2") : lz("Closes");
  return `<span class="pct-date-chip ${cls}">${word} ${esc(fmtDate(date))}</span>`;
}

/** A due date on a quest. */
function dueChip(date, open = true) {
  const k = dkey(date);
  if (k === null) return "";
  const now = dkey(today());
  const cls = !open ? "" : k < now ? "pct-closed" : k === now ? "pct-today" : "";
  return `<span class="pct-date-chip ${cls}">${k < now ? lz("WasDue") : k === now ? lz("DueToday") : lz("Due")} ${esc(fmtDate(date))}</span>`;
}

const GOAL_ICON = { open: "fa-regular fa-square", done: "fa-solid fa-square-check", failed: "fa-solid fa-square-xmark" };

/** The quest's picture, status, category, giver, location and due date, shared by the GM's and the players' views. */
function questHead(q, { gm }) {
  const giver = gm
    ? q.giver
      ? `<div class="pct-npc" data-drop="giver">${q.giver.img ? `<img src="${esc(q.giver.img)}" alt="">` : ""}<span><span class="pct-k">${lz("GivenBy")}</span> <strong>${esc(q.giver.name)}</strong></span>${A("pctQClear", "fa-solid fa-xmark", { tip: lz("Unlink"), data: { path: "giver" } })}</div>`
      : q.giverText ? `<span><span class="pct-k">${lz("GivenBy")}</span> ${esc(q.giverText)}</span>` : ""
    : q.giver ? `<div class="pct-npc">${q.giver.img ? `<img src="${esc(q.giver.img)}" alt="">` : ""}<span><span class="pct-k">${lz("GivenBy")}</span> <strong>${esc(q.giver.name)}</strong></span></div>` : "";
  const open = q.status === "active" || q.status === "lead";
  const facts = [
    `<span class="pct-chip pct-qs-${esc(q.status)}">${esc(QSTATUS_LABEL[q.status] ?? q.status)}</span>`,
    q.category ? `<span class="pct-chip">${esc(q.category)}</span>` : "",
    giver,
    q.location ? `<span><span class="pct-k">${lz("Where")}</span> ${esc(q.location)}</span>` : "",
    dueChip(q.deadline, open),
  ].filter(Boolean).join("");
  return `<div class="pct-qhead">${q.img ? `<img class="pct-qimg" src="${esc(q.img)}" alt="">` : ""}<div class="pct-line">${facts}</div></div>`;
}

/** Text only the GM sees on a quest, in a box marked as such. */
const gmBox = (text) => `<div class="pct-gm pct-gmbox"><span class="pct-gmtag" ${tipAttr(lz("OnlyYouSeeThis"))}><i class="fa-solid fa-eye-slash"></i>GM</span><span>${para(text)}</span></div>`;

/**
 * An objective or step as one line: state box, text, optional, count, steps and (GM) link chips. The GM's box is a
 * button: click done, right-click failed.
 */
function goalLine(g, path, { gm, steps = null, mode = "all", tick = false, party = false, counts = false }) {
  const can = tick && (g.state === "open" || (g.state === "done" && g.doneBy === "player"));
  const box = gm
    ? A("pctQState", GOAL_ICON[g.state] ?? GOAL_ICON.open, { name: lz("GoalState", { text: shortText(g.text, 80) || lz("NoText2"), state: GOAL_STATE_WORD()[g.state] ?? g.state }), tip: lz("GoalBoxTip"), data: { goal: g.id }, cls: `pct-qbox pct-q-${g.state}` })
    : can
      ? A("pctQTick", GOAL_ICON[g.state] ?? GOAL_ICON.open, { tip: g.state === "open" ? (party ? lz("MarkDone") : lz("MarkDoneTheGMIsTold")) : lz("MarkOpenAgain"), data: { goal: g.id, to: g.state === "open" ? "done" : "open" }, cls: `pct-qbox pct-q-${g.state}` })
      : `<i class="pct-qbox pct-q-${esc(g.state)} ${GOAL_ICON[g.state] ?? GOAL_ICON.open}" ${g.state === "done" && g.doneBy === "gm" && tick ? `${tipAttr(lz("MarkedByTheGM"))}` : ""}></i>`;
  const count = g.count !== null && g.count !== undefined
    ? gm || counts ? stepper(`${path}.have`, num(g.have), { fmt: (v) => lz("XOfY", { x: v, y: g.count }) }) : `<span class="pct-chip">${lz("XOfY", { x: num(g.have), y: g.count })}</span>`
    : "";
  let stepNote = "";
  if (steps && steps.length) {
    const sp = stepProgress({ mode }, steps);
    stepNote = `<span class="pct-chip"${tipAttr(mode === "any" ? lz("DoneWhenAnyOneStepIs") : lz("DoneWhenEveryStepNotMarked"))}>${mode === "any" ? `${lz("AnyOneOf", { length: steps.length })}` : `${lz("OfSteps", { done: sp.done, of: sp.of })}`}${sp.complete && g.state === "open" ? lz("ReadyToMarkDone") : ""}</span>`;
  }
  let link = "";
  if (gm && g.link?.tid) {
    const ls = linkState(g.link, Store.data.trackers);
    link = `<span class="pct-chip pct-qlinkchip ${ls.met ? "pct-met" : ""}" ${tipAttr(lz(ls.met ? "WatchingGot" : "WatchingGets"))}><i class="fa-solid fa-link"></i> ${esc(ls.name || "?")}: ${esc(ls.text)}</span>`;
  }
  return `${box}<span class="pct-qtext">${para(g.text) || (gm ? `<em>${lz("NoText")}</em>` : "")}</span>${g.optional ? `<span class="pct-chip">${lz("OptionalLower")}</span>` : ""}${count}${stepNote}${link}`;
}

/** How a goal stands, in words, for its box's name. */
const GOAL_STATE_WORD = () => ({ open: lz("StateOpen"), done: lz("StateDone"), failed: lz("StateFailed") });

/** Quest groups (Followed leads, filed clues) opened or closed away from their default, kept in this browser for this world and user. */
let foldCache = null;
function foldMap() {
  if (foldCache) return foldCache;
  if (!local.key("folds")) return {};
  foldCache = plainObject(local.get("folds", {}, { from: oldKey("folds") }));
  return foldCache;
}
function foldOpen(key, byDefault) {
  const folds = foldMap();
  return Object.hasOwn(folds, key) ? !!folds[key] : byDefault;
}
/** Keep a fold's state (only when it isn't its default). Without storage it goes back to its default next time. */
function setFold(key, open, byDefault) {
  if (open === foldOpen(key, byDefault)) return;
  const folds = foldMap();
  if (open === byDefault) delete folds[key];
  else folds[key] = open;
  local.set("folds", folds);
}
function onFoldToggle(ev) {
  const d = ev.target;
  if (!(d instanceof HTMLDetailsElement) || !d.dataset.pctFold) return;
  const key = d.dataset.pctFold;
  setFold(key, d.open, d.dataset.foldDefault === "open");
}

/** A goal of a quest by id, with a heading for its clue group: the objective, or "objective: step". */
function goalHeading(q, id) {
  for (const o of q.objectives ?? []) {
    if (o.id === id) return { g: o, label: shortText(o.text, 70) || lz("NoText") };
    for (const st of o.steps ?? []) if (st.id === id) return { g: st, label: `${shortText(o.text, 40) || lz("NoText")}: ${shortText(st.text, 40) || lz("NoText")}` };
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
  return `<li class="pct-qhidden"><details data-pct-fold="${esc(key)}" data-focus-key="${esc(key)}" data-fold-default="open"${foldOpen(key, true) ? " open" : ""}><summary>${lz("Hidden", { length: rows.length })}</summary><ul class="${cls}">${rows.map(li).join("")}</ul></details></li>`;
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
    const steps = o.steps.map((st, j) => `<li class="pct-q-${esc(st.state)}"${drop(st.id)}>${gm ? eye(`${p}.steps.${j}`, st.revealed) : ""}${rl(st.id)}${goalLine(st, `${p}.steps.${j}`, { gm, tick, party: own, counts: party })}${gm && st.revealed && !o.revealed ? `<span class="pct-chip" data-tooltip-text="${esc(lz("PlayersSeeAStepOnlyWith"))}">${lz("WaitsForItsObjective")}</span>` : ""}${filedChip(st.id)}${rlEnd(st.id)}${gm && st.gm ? gmBox(st.gm) : ""}</li>`).join("");
    return `<li class="pct-q-${esc(o.state)}"><div class="pct-qrow"${drop(o.id)}>${gm ? eye(p, o.revealed) : ""}${rl(o.id)}${goalLine(o, p, { gm, steps: o.steps, mode: o.mode, tick, party: own, counts: party })}${filedChip(o.id)}${rlEnd(o.id)}</div>
        ${gm && o.gm ? gmBox(o.gm) : ""}
        ${steps ? `<ul class="pct-qsteps"><li class="pct-k">${o.mode === "any" ? lz("AnyOneOfThese") : lz("AllOfThese")}</li>${steps}</ul>` : ""}</li>`;
  }).join("");
  // Who can file clues: the GM, and players who can tick (or on their party quest), by dragging onto goals.
  const sortable = (gm && can) || tick;
  const drop = (id) => (sortable ? ` data-goal-drop="${esc(id)}"` : "");
  const clues = clueOrder(q.entries);
  const clueLi = ({ e, i }) => {
    const hiddenUnder = gm && e.revealed === false && e.under ? goalHeading(q, e.under) : null;
    const grip = (gm && can) || (tick && e.revealed !== false) ? `<span class="pct-clue-grip" draggable="true" role="button" tabindex="0" ${act("pctClueFile")} data-clue="${esc(e.id)}"${labelAttr(lz("FileItDragOntoAnObjective"))}><i class="fa-solid fa-grip-vertical" aria-hidden="true"></i></span>` : "";
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
    return `<li class="pct-qgroup"><details data-pct-fold="${esc(key)}" data-focus-key="${esc(key)}" data-fold-default="${open ? "open" : "closed"}"${foldOpen(key, open) ? " open" : ""}${drop(gid)}><summary>${esc(h.label)} <span class="pct-k">${rows.length}</span></summary><ul class="pct-qjournal">${rows.map(clueLi).join("")}</ul></details></li>`;
  }).join("");
  const top = unsorted.map(clueLi).join("") + groupHtml;
  const entries = top + hiddenFold(`h:${q.id}:entries`, clues.hidden, clueLi, "pct-qjournal");
  // How many clues are filed under each goal (a players' copy has only what they can see).
  const filedChip = (id) => {
    const n = (q.entries ?? []).filter((e) => e.under === id).length;
    return n ? `<span class="pct-chip pct-qclues" ${tipAttr(lz("CluesFiledUnderIt"))}><i class="fa-solid fa-magnifying-glass"></i> ${n}</span>` : "";
  };
  const leadRows = q.leads.map((l, i) => ({ l, i }));
  // GM data names who followed by user id or "gm"; a players' copy by "gm" or "player".
  const followBox = (l) => {
    const on = !!l.followed;
    const icon = on ? "fa-solid fa-square-check" : "fa-regular fa-square";
    if (l.revealed === false) return "";
    if (gm && can) return A("pctLeadFollow", icon, { tip: on ? lz("MarkNotFollowed") : lz("MarkFollowed"), data: { lead: l.id, to: on ? "open" : "done" }, cls: "pct-qbox pct-lead-box" });
    if (tick && (!on || l.followedBy !== "gm")) return A("pctLeadFollow", icon, { tip: on ? lz("MarkNotFollowed") : own ? lz("MarkFollowed") : lz("MarkFollowedTheGMIsTold"), data: { lead: l.id, to: on ? "open" : "done" }, cls: "pct-qbox pct-lead-box" });
    return on ? `<i class="pct-qbox pct-lead-box ${icon}" ${tick ? `${tipAttr(lz("MarkedByTheGM"))}` : ""}></i>` : "";
  };
  const leadLi = ({ l, i }) => {
    const to = gm ? all.find((x) => x.id === l.to && x.kind === "quest") : l.to;
    const linked = gm ? (l.clues ?? []).map((id) => (q.entries ?? []).find((e) => e.id === id)).filter(Boolean) : [];
    const go = (to ? `<button type="button" class="pct-qlink" ${act("pctQuestGo")} data-qid="${esc(to.id)}"><i class="fa-solid fa-arrow-right" aria-hidden="true"></i> ${esc(to.name)}${gm && !to.revealed ? ` ${lz("HiddenMark")}` : ""}</button>` : "")
      + linked.map((clue) => `<span class="pct-qlink" data-tooltip-text="${esc(clue.text)}"><i class="fa-solid fa-magnifying-glass"></i> ${esc(shortText(clue.text, 30) || lz("ClueWord"))}${clue.revealed ? "" : ` ${lz("HiddenMark")}`}</span>`).join("");
    return `<li${l.followed ? ` class="pct-followed"` : ""}>${gm ? eye(`leads.${i}`, l.revealed) : ""}${rl(l.id)}${followBox(l) || `<i class="fa-solid fa-signs-post"></i>`}<span>${para(l.text)}</span>${go}${rlEnd(l.id)}${gm && l.gm ? gmBox(l.gm) : ""}</li>`;
  };
  const followed = leadRows.filter((r) => r.l.followed && r.l.revealed !== false);
  const leads = leadRows.filter((r) => !r.l.followed && r.l.revealed !== false).map(leadLi).join("") + hiddenFold(`h:${q.id}:leads`, leadRows.filter((r) => r.l.revealed === false), leadLi, "pct-qleads")
    + (followed.length ? `<li class="pct-qfollowed"><details data-pct-fold="${esc(`f:${q.id}`)}" data-focus-key="${esc(`f:${q.id}`)}" data-fold-default="closed"${foldOpen(`f:${q.id}`, false) ? " open" : ""}><summary>${lz("Followed", { length: followed.length })}</summary><ul class="pct-qleads">${followed.map(leadLi).join("")}</ul></details></li>` : "");
  const rewards = q.rewards.map((r, i) => {
    const actor = r.actor ? `<button type="button" class="pct-npc" ${act("pctOpenActor")} data-uuid="${esc(r.actor.uuid)}"${tipAttr(lz("OpenTheSheet"))}>${r.actor.img ? `<img src="${esc(r.actor.img)}" alt="">` : ""}<strong>${esc(r.actor.name)}</strong></button>` : "";
    return `<li>${gm ? eye(`rewards.${i}`, r.revealed) : ""}${rl(r.id)}<i class="fa-solid fa-gem"></i><span>${para(r.text)}</span>${actor}${rlEnd(r.id)}${gm && r.gm ? gmBox(r.gm) : ""}</li>`;
  }).join("");
  // F6: each section folds to its heading, remembered per quest (read-only HTML shows everything).
  const secKey = (sec) => `s:${q.id}:${sec}`;
  const secOpen = (sec) => readOnly || foldOpen(secKey(sec), true);
  const secFold = (sec, title) => (readOnly ? "" : A("pctSecFold", secOpen(sec) ? "fa-solid fa-caret-down" : "fa-solid fa-caret-right", { name: title, tip: secOpen(sec) ? `${lz("Fold")} ${title.toLowerCase()}` : `${lz("Show")} ${title.toLowerCase()}`, expanded: secOpen(sec), data: { fold: secKey(sec) }, cls: "pct-secfold" }));
  const notes = partyNotes(q, { gm, readOnly, fold: secFold("notes", lz("PartyJournal")), shut: !secOpen("notes") });
  const goalsHtml = objectives();
  if (!gm && !party) {
    const sub = (sec, title, html, cls, attrs = "") => (html ? `<div class="pct-sub"${attrs}>${secFold(sec, title)}${esc(title)}</div>${secOpen(sec) ? `<ul class="${cls}"${attrs}>${html}</ul>` : ""}` : "");
    return `${sub("objectives", lz("Objectives"), goalsHtml, "pct-qgoals")}
      ${sub("entries", lz("Clues"), entries, "pct-qjournal", drop(""))}
      ${sub("leads", lz("Leads"), leads, "pct-qleads")}
      ${sub("rewards", lz("Rewards"), rewards, "pct-qrewards")}
      ${notes}`;
  }
  const section = (sec, title, list, add, html, cls) => {
    const editing = open.has(sec);
    const shut = !editing && !secOpen(sec);
    return `<div class="pct-qsec" data-sec="${sec}"><div class="pct-sub"${sec === "entries" ? drop("") : ""}>${editing ? "" : secFold(sec, title)}${esc(title)}
        ${A("pctQSec", editing ? "fa-solid fa-check" : "fa-solid fa-pen", { tip: editing ? lz("Done") : lz("EditSection", { what: title.toLowerCase() }), data: { sec }, cls: `pct-qsec-btn ${editing ? "pct-on" : ""}` })}
        ${A("pctAdd", "fa-solid fa-plus", { tip: `${lz("Add", { add: add })}`, data: { list, sec }, cls: "pct-qsec-btn" })}</div>
      ${shut ? "" : editing ? `<div class="pct-qsec-edit">${(party ? QEDIT_PARTY : QEDIT)[sec](q)}</div>` : html ? `<ul class="${cls}"${sec === "entries" ? drop("") : ""}>${html}</ul>` : `<p class="pct-hint">${lz("NoneYet")}</p>`}</div>`;
  };
  const from = all.flatMap((x) => (x.kind === "quest" && x.id !== q.id ? x.leads.filter((l) => l.to === q.id).map((l) => ({ x, l })) : []));
  const fromHtml = gm && from.length ? `<div class="pct-qfrom"><span class="pct-k">${lz("PointedToBy")}</span>${from.map(({ x, l }) => `<button type="button" class="pct-qlink" ${act("pctQuestGo")} data-qid="${esc(x.id)}"${tipAttr(l.text)}>${l.revealed ? "" : `<i class="fa-solid fa-eye-slash" aria-hidden="true"></i><span class="pct-sr"> ${lz("HiddenMark")}</span> `}${esc(x.name)}</button>`).join("")}</div>` : "";
  return `${section("objectives", lz("Objectives"), "objectives", lz("AnObjective"), goalsHtml, "pct-qgoals")}
    ${section("entries", lz("Clues"), "entries", lz("AClueAdd"), entries, "pct-qjournal")}
    ${section("leads", lz("Leads"), "leads", lz("ALead"), leads, "pct-qleads")}${fromHtml}
    ${section("rewards", lz("Rewards"), "rewards", lz("AReward"), rewards, "pct-qrewards")}
    ${notes}`;
}

/** The quest's Party Journal: anyone writes an entry, signed; its author or the GM deletes it. */
function partyNotes(q, { gm, readOnly = false, fold = "", shut = false }) {
  const preview = readOnly || (!gm && game.user.isGM);
  const isClue = (n) => (q.entries ?? []).some((e) => e.from === n.id);
  const toClue = (n) => (!gm ? "" : isClue(n)
    ? `<i class="fa-solid fa-magnifying-glass pct-qnote-kept" ${tipAttr(lz("AClue"))}></i>`
    : A("pctQNoteJournal", "fa-solid fa-magnifying-glass", { tip: lz("MakeItAClueDatedToday"), data: { note: n.id } }));
  const rows = (q.pnotes ?? []).map((n) => `<li><strong>${esc(n.name)}</strong><span>${para(n.text)}</span>${toClue(n)}${!preview && (gm || n.by === game.user.id) ? A("pctQNoteDel", "fa-solid fa-xmark", { tip: lz("DeleteThisEntry"), data: { note: n.id } }) : ""}</li>`).join("");
  if (shut) return `<div class="pct-qnotes"><div class="pct-sub">${lz("PartyJournal2", { fold: fold })}</div></div>`;
  return `<div class="pct-qnotes"><div class="pct-sub">${lz("PartyJournal2", { fold: fold })}</div>${rows ? `<ul>${rows}</ul>` : `<p class="pct-hint">${lz("NothingYet")}${gm ? "" : lz("AnythingThePartyWantsToRemember")}</p>`}
      ${preview ? "" : `<div class="pct-qnote-add"><textarea rows="2" data-focus-key="pnote" aria-label="${esc(lz("ANewPartyJournalEntry"))}" placeholder="${esc(gm ? lz("AnEntrySignedGM") : lz("WriteInThePartyJournal"))}" maxlength="${NOTE_LEN}"></textarea>${A("pctQNoteAdd", "fa-solid fa-plus", { label: lz("Add2") })}</div>`}</div>`;
}

/** A party quest in a player's window: the same sections as the GM's, with the editors players may use. */
function questParty(t, open) {
  const detailsOpen = open.has("details");
  const details = detailsOpen
    ? `<div class="pct-qsec-edit">${QEDIT_PARTY.details(t)}</div>`
    : `${t.desc ? `<p class="pct-desc">${para(t.desc)}</p>` : ""}${questHead(t, { gm: false })}`;
  return `${partyLine(t, false)}
    <div class="pct-qsec" data-sec="details"><div class="pct-sub">${lz("Details")} ${A("pctQSec", detailsOpen ? "fa-solid fa-check" : "fa-solid fa-pen", { tip: detailsOpen ? lz("Done") : lz("EditTheNameSummaryStatusCategory"), data: { sec: "details" }, cls: `pct-qsec-btn ${detailsOpen ? "pct-on" : ""}` })}</div>${details}</div>
    ${questBody(t, { gm: false, party: true, open })}`;
}

/** Who made a party quest, above it. */
function partyLine(t, gm) {
  if (!t.party) return "";
  const by = t.party.by === game.user.id ? lz("You") : t.party.name || lz("APlayer");
  const tools = gm
    ? `<span class="pct-partytools">${![lz("Main"), "Main"].includes(t.category) ? A("pctQMain", "fa-solid fa-flag", { label: lz("MakeItAMainQuest"), tip: lz("SetItsCategoryToMainIt") }) : ""}${A("pctQTake", "fa-solid fa-hand", { label: lz("TakeItOver"), tip: lz("MakeItYourQuestYouCan") })}</span>`
    : "";
  return `<p class="pct-hint pct-partyline"><i class="fa-solid fa-users"></i> <span>${lz("APartyQuestMadeBy2", { by: esc(by) })} ${gm ? (partyQuestsOn() ? lz("PlayersCanEditIt") : lz("PlayersCanTEditItWhile")) : lz("AnyoneInThePartyCanEdit2")}</span>${tools}</p>`;
}

/** The GM's quest, with the details and GM notes editable in place too. */
function questGM(t, open, pick = null) {
  const details = open.has("details")
    ? `<div class="pct-qsec-edit">${QEDIT.details(t)}</div>`
    : `${t.desc ? `<p class="pct-desc">${para(t.desc)}</p>` : ""}${questHead(t, { gm: true })}`;
  const notesOpen = open.has("notes");
  const detailsOpen = open.has("details");
  return `${partyLine(t, true)}<div class="pct-qsec" data-sec="details"><div class="pct-sub">${lz("Details")} ${A("pctQSec", detailsOpen ? "fa-solid fa-check" : "fa-solid fa-pen", { tip: detailsOpen ? lz("Done") : lz("EditTheNameSummaryStatusCategory2"), data: { sec: "details" }, cls: `pct-qsec-btn ${detailsOpen ? "pct-on" : ""}` })}</div>${details}</div>
    ${pick ? rlBar(t, pick) : ""}${questBody(t, { gm: true, all: Store.data.trackers, open, pick })}
    <div class="pct-qsec" data-sec="notes"><div class="pct-sub">${lz("GMNotes")} ${A("pctQSec", notesOpen ? "fa-solid fa-check" : "fa-solid fa-pen", { tip: notesOpen ? lz("Done") : lz("EditGMNotes"), data: { sec: "notes" }, cls: `pct-qsec-btn ${notesOpen ? "pct-on" : ""}` })}</div>
      ${notesOpen ? `<div class="pct-qsec-edit">${QEDIT.notes(t)}</div>` : t.notes ? gmBox(t.notes) : `<p class="pct-hint">${lz("None")}</p>`}</div>`;
}


export { dataAttrs, inert, readOnlyHTML, act, A, F, moreMenu, L, eye, stepper, listEditor, SKILLS, skillList, checkEdit, thresholdEdit, degreesEdit, infiltrationDegreesEdit, checkButton, checkRows, cardBtn, thresholdRows, clockSVG, othersAt, partyMembers, pcName, dateStatus, dueChip, GOAL_ICON, questHead, gmBox, goalLine, GOAL_STATE_WORD, foldCache, foldMap, foldOpen, setFold, onFoldToggle, goalHeading, clueOrder, hiddenFold, questBody, partyNotes, questParty, partyLine, questGM };
