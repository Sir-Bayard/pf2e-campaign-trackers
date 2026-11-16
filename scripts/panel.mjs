/** The tracked-quest panel on screen, and what each browser keeps for it. */

import { captureFocus, focusStyle, restoreFocus, windowKeys } from "./kit/keyboard.mjs";
import { esc, labelAttr, tipAttr } from "./kit/safe-text.mjs";
import { loadUI, onPanelClick, refresh } from "./app.mjs";
import { promptCompletion } from "./chat.mjs";
import { FOCUS_SCOPE, MOD, local, lz, num, oldKey, para } from "./core.mjs";
import { OPEN_Q, clamp, findGoal, stepProgress } from "./data.mjs";
import { A, dataAttrs, dueChip, foldMap, questBody, questHead, readOnlyHTML } from "./html.mjs";
import { plainObject, seenMap, waitingQuests } from "./notices.mjs";
import { storeReady } from "./presets.mjs";
import { Store, mutateTracker, partyTicks, project, visibleTrackers } from "./store.mjs";

/* ------------------------------------------------------------------ */
/* Tracked-quest panel                                                 */
/* ------------------------------------------------------------------ */

const PIN_KEY = "pins", PANEL_KEY = "panel", PANEL_MAX = 3;
/** A value kept in this browser for this world and user (pins, the panel's place and folds). */
const readJSON = (what, fallback) => local.get(what, fallback, { from: oldKey(what) });
/** Without storage it lasts until the page reloads. */
const writeJSON = (what, value) => {
  if (what === PIN_KEY) forgetPins();
  local.set(what, value);
};
/**
 * Forget what this browser keeps for trackers that are gone: New/Updated marks, quest folds, pins, the panel's folds,
 * folded cards and open notes. `ids` holds every tracker this user can see; with `all: false` only the marks go.
 */
function pruneKept(ids, { all = true } = {}) {
  if (!local.key("ui")) return;
  // Fold keys read "f:<quest>", "g:<quest>:<goal>" or "h:<quest>:<list>", and a quest id may hold anything but a space.
  const foldQuest = (key) => {
    const rest = key.slice(2);
    if (ids.has(rest)) return true;
    for (const id of ids) if (rest.startsWith(`${id}:`)) return true;
    return false;
  };
  const seen = seenMap();
  const goneSeen = Object.keys(seen).filter((id) => !ids.has(id));
  for (const id of goneSeen) delete seen[id];
  if (goneSeen.length) local.set("seen", seen);
  if (!all) return;
  const folds = foldMap();
  const goneFolds = Object.keys(folds).filter((k) => !foldQuest(k));
  for (const k of goneFolds) delete folds[k];
  if (goneFolds.length) local.set("folds", folds);
  const pins = pinned();
  if (pins.some((id) => !ids.has(id))) writeJSON(PIN_KEY, pins.filter((id) => ids.has(id)));
  const panel = plainObject(readJSON(PANEL_KEY, {}));
  if (Array.isArray(panel.folded) && panel.folded.some((id) => !ids.has(id))) writeJSON(PANEL_KEY, { ...panel, folded: panel.folded.filter((id) => ids.has(id)) });
  const ui = loadUI();
  const keep = (list) => (Array.isArray(list) ? list.filter((id) => ids.has(id)) : []);
  if (keep(ui.closed).length !== (ui.closed?.length ?? 0) || keep(ui.notesOpen).length !== (ui.notesOpen?.length ?? 0)) {
    local.set("ui", { ...ui, closed: keep(ui.closed), notesOpen: keep(ui.notesOpen) });
  }
}

/** The quests this user pinned, kept in this browser; read once per redraw (each quest card asks). */
let pinCache = null;
function pinned() {
  if (!pinCache) {
    const v = readJSON(PIN_KEY, []);
    pinCache = Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  }
  return [...pinCache];
}
/** Read the pins again at the next ask (a redraw starts, or they were just written). */
const forgetPins = () => void (pinCache = null);

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
    if (focus.includes(id)) return void ui.notifications.info(lz("ThatQuestIsThePartyS"));
    if (kept.length + focus.length >= PANEL_MAX) {
      ui.notifications.warn(lz("PanelFull", { max: PANEL_MAX, focus: focus.length ? lz("OfThemThePartySFocus", { length: focus.length }) : "" }));
      return;
    }
    writeJSON(PIN_KEY, [...kept, id]);
    if (!game.settings.get(MOD, "questPanel")) ui.notifications.info(lz("PinnedTheQuestPanelIsTurned"));
  }
  refresh();
}

/** The focus star (GM) and the pin, for a quest's card header. */
function pinTools(t, gm) {
  const out = [];
  if (gm) out.push(focusTool(t));
  const pin = pinTool(t);
  if (pin) out.push(pin);
  return out.join("");
}

/** The party's focus, a toggle. */
function focusTool(t) {
  return A("pctQFocus", t.focus ? "fa-solid fa-star" : "fa-regular fa-star", { name: lz("ThePartySFocus"), pressed: !!t.focus, tip: t.focus ? lz("ThePartySFocusItShows") : lz("MakeThisThePartySFocus"), cls: t.focus ? "pct-on" : "" });
}

/** Pin to this user's quest panel: a toggle, or a menu entry (`menu`). Empty when the quest can't be pinned. */
function pinTool(t, { menu = false } = {}) {
  const on = pinned().includes(t.id);
  if (!on && !OPEN_Q.includes(t.status)) return "";
  if (menu) return A("pctQPin", "fa-solid fa-thumbtack", { label: on ? lz("UnpinFromYourQuestPanel") : lz("PinToYourQuestPanel") });
  return A("pctQPin", "fa-solid fa-thumbtack", { name: lz("PinnedToYourQuestPanel"), pressed: on, tip: on ? lz("PinnedToYourQuestPanelClick") : lz("PinToYourQuestPanel"), cls: on ? "pct-on" : "" });
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
  }, { notify: false, undo: true });
  if (done) await promptCompletion(Store.get(tid), done);
}

let panelEl = null;
/** A panel button. Its data-focus-key brings focus back to it after a redraw. */
const qpBtn = (qp, icon, tip, data = {}, extra = "") => `<button type="button" class="pct-qp-btn" data-qp="${qp}" ${dataAttrs(data)} data-focus-key="${esc(`${qp}:${data.tid ?? ""}`)}"${labelAttr(tip)}${extra}><i class="${icon}" aria-hidden="true"></i></button>`;

/** One open objective or step: a box to tick, its text, its count. The GM also sees what players don't. */
function panelGoal(q, g, tick, steps = null) {
  const gm = game.user.isGM;
  const box = tick
    ? `<button type="button" class="pct-qp-box" data-qp="tick" data-tid="${esc(q.id)}" data-goal="${esc(g.id)}" data-focus-key="${esc(`tick:${g.id}`)}" aria-label="${esc(`${lz("MarkDone2", { text: g.text })}`)}"${tipAttr(gm ? lz("PanelBoxTipGM") : partyTicks(q) ? lz("MarkDone") : lz("MarkDoneTheGMIsTold"))}><i class="fa-regular fa-square" aria-hidden="true"></i></button>`
    : `<i class="pct-qp-box fa-regular fa-square" aria-hidden="true"></i>`;
  const chips = [g.count !== null && g.count !== undefined ? lz("NOfMax", { n: num(g.have), max: g.count }) : "", g.optional ? lz("OptionalLower") : ""];
  if (steps?.length) {
    const sp = stepProgress(g, steps);
    chips.push(g.mode === "any" ? `${lz("AnyOneOf", { length: steps.length })}` : `${lz("OfSteps", { done: sp.done, of: sp.of })}`);
  }
  const hidden = gm && !g.revealed ? `<i class="fa-solid fa-eye-slash" ${tipAttr(lz("HiddenFromPlayers"))}></i> ` : "";
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
    gm && !q.revealed ? `<i class="fa-solid fa-eye-slash" ${tipAttr(lz("HiddenFromPlayers"))}></i>` : "",
    q.focus ? `<i class="fa-solid fa-star" ${tipAttr(lz("ThePartySFocus"))}></i>` : "",
  ].join("");
  const unpin = pins.includes(q.id) ? qpBtn("unpin", "fa-solid fa-xmark", lz("Unpin"), { tid: q.id }) : "";
  return `<div class="pct-qp-quest pct-qp-${esc(q.status)}">
      <div class="pct-qp-title">${qpBtn("fold", shut ? "fa-solid fa-caret-right" : "fa-solid fa-caret-down", shut ? lz("ShowObjectives") : lz("HideObjectives"), { tid: q.id }, ` aria-expanded="${!shut}"`)}<button type="button" class="pct-qp-name" data-qp="open" data-tid="${esc(q.id)}" data-focus-key="${esc(`open:${q.id}`)}"${tipAttr(lz("OpenInTheTrackersWindow"))}>${marks}${esc(q.name)}</button>${main.length ? `<span class="pct-qp-count">${done}/${main.length}</span>` : ""}${unpin}</div>
      ${shut ? "" : `${q.deadline ? `<div class="pct-qp-due">${dueChip(q.deadline)}</div>` : ""}${goals ? `<ul class="pct-qp-goals">${goals}</ul>` : `<p class="pct-qp-none">${lz("NoOpenObjectives")}</p>`}`}
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
    panelEl.addEventListener("keydown", onPanelKey);
    panelEl.setAttribute("aria-label", lz("Quests"));
    (document.getElementById("interface") ?? document.body).append(panelEl);
    // The kit keeps Tab, Enter, Space and the arrows here from Foundry's keybindings while focus came by keyboard.
    windowKeys(panelEl);
    focusStyle(MOD, FOCUS_SCOPE);
  }
  const st = readJSON(PANEL_KEY, {});
  const folded = new Set(Array.isArray(st.folded) ? st.folded : []);
  const pins = pinned();
  panelEl.classList.toggle("pct-qp-min", !!st.min);
  const html = `<header class="pct-qp-head" ${tipAttr(lz("DragToMove"))}><i class="fa-solid fa-scroll" aria-hidden="true"></i><span>${lz("Quests")}</span>${waitingQuests() ? `<span class="pct-qp-new"${tipAttr(lz("QuestsNewOrUpdatedSinceYou"))}>${lz("NNew", { n: waitingQuests() })}</span>` : ""}${qpBtn("move", "fa-solid fa-up-down-left-right", lz("MoveThePanelDragOrThe"))}${qpBtn("min", st.min ? "fa-solid fa-chevron-down" : "fa-solid fa-chevron-up", st.min ? lz("ShowThePanel") : lz("ShrinkThePanel"))}${qpBtn("close", "fa-solid fa-xmark", lz("HideTheQuestPanel"))}</header>
    ${st.min ? "" : `<div class="pct-qp-body" tabindex="-1" data-focus-home>${list.map((q) => panelQuest(q, folded, pins)).join("")}</div>`}`;
  // The same HTML again would only drop hover states and open tooltips. Focus comes back to the same button.
  if (html !== panelEl._pctHTML) {
    const focus = captureFocus(panelEl);
    panelEl.innerHTML = html;
    panelEl._pctHTML = html;
    restoreFocus(panelEl, focus);
  }
  placePanel(st);
}

/** Keep the panel where this user put it, inside the screen. It starts near the top, left of the sidebar. */
function placePanel(st = readJSON(PANEL_KEY, {})) {
  if (!panelEl) return;
  const w = panelEl.offsetWidth || 280;
  const side = document.getElementById("sidebar")?.getBoundingClientRect().left ?? window.innerWidth;
  const left = clamp(Number.isFinite(st.left) ? st.left : side - w - 16, 0, Math.max(0, window.innerWidth - w));
  const top = clamp(Number.isFinite(st.top) ? st.top : 64, 0, Math.max(0, window.innerHeight - 40));
  panelEl.style.left = `${left}px`;
  panelEl.style.top = `${top}px`;
}

/** The panel from the keyboard: Shift+Enter on a box marks it failed (the GM), the arrow keys on Move move the panel. */
function onPanelKey(ev) {
  const el = ev.target.closest?.("[data-qp]");
  if (!el || !panelEl?.contains(el) || ev.altKey || ev.ctrlKey || ev.metaKey) return;
  if (el.dataset.qp === "tick" && ev.key === "Enter" && ev.shiftKey) {
    if (!game.user.isGM) return;
    ev.preventDefault();
    ev.stopPropagation();
    onPanelClick({ type: "contextmenu", target: el, preventDefault: () => {} });
    return;
  }
  if (el.dataset.qp !== "move") return;
  const step = ev.shiftKey ? 80 : 20;
  const by = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
  if (!by) return;
  ev.preventDefault();
  ev.stopPropagation();
  const r = panelEl.getBoundingClientRect();
  writeJSON(PANEL_KEY, { ...readJSON(PANEL_KEY, {}), left: Math.round(r.left + by[0]), top: Math.round(r.top + by[1]) });
  placePanel();
}

function onPanelDrag(ev) {
  if (ev.button !== 0 || !ev.target.closest(".pct-qp-head") || ev.target.closest("[data-qp]:not([data-qp='move'])")) return;
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
    window.removeEventListener("pointercancel", up);
    if (!panelEl) return;
    const st = readJSON(PANEL_KEY, {});
    writeJSON(PANEL_KEY, { ...st, left: parseInt(panelEl.style.left, 10), top: parseInt(panelEl.style.top, 10) });
    placePanel();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
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
  // Drawn read-only: every action is written as data-pct-action, which this window doesn't answer.
  const html = readOnlyHTML(() => `${q.desc ? `<p class="pct-desc">${para(q.desc)}</p>` : ""}${questHead(q, { gm: false })}${questBody(q, { gm: false, readOnly: true })}`);
  return `<div class="pct-app pct-embed"><div class="pct">${html}</div></div>`;
}


export { PIN_KEY, PANEL_KEY, PANEL_MAX, readJSON, writeJSON, pruneKept, pinCache, pinned, forgetPins, panelQuests, togglePin, pinTools, focusTool, pinTool, setGoalState, panelEl, qpBtn, panelGoal, panelQuest, panelData, renderPanel, placePanel, onPanelKey, onPanelDrag, questsOpen, questReadOnly };
