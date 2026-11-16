/** The trackers window: one at a time, its tabs, actions and redraws. */

import { keyboardWindow } from "./kit/keyboard.mjs";
import { esc, safe, tipAttr } from "./kit/safe-text.mjs";
import { singleWindow } from "./kit/single-window.mjs";
import { rememberWindow } from "./kit/window-memory.mjs";
import { calendarSig, exampleDate, parseDate, sameCalendar, scheduleReminders, today } from "./calendar.mjs";
import { adhocDialog, applyAll, letPlayersOpen, lootToOpen, postChallengeCard, postCheckCard, proposeDialog, refreshPreviews, waitingCards } from "./chat.mjs";
import { locate, rollCheck, rollTitle, shortText } from "./checks.mjs";
import { FOCUS_SCOPE, KINDS, KIND_INFO, MOD, clone, local, lz, num, oldKey, para, uid } from "./core.mjs";
import { NOTE_MAX, QGROUPS, QSTATUS, QSTATUS_LABEL, TPL, applyQuestNote, blank, bounds, clamp, findGoal, normalize, offerLead, remapPath, summary, tplFor } from "./data.mjs";
import { A, foldOpen, goalHeading, moreMenu, questGM, questParty, setFold, skillList } from "./html.mjs";
import { copyText, repaintQuestLinks, revealLinkText } from "./links.mjs";
import { followToGM, lastSession, markSeen, plainObject, sortToGM, tickToGM, unseen } from "./notices.mjs";
import { PANEL_KEY, focusTool, forgetPins, panelEl, pinTool, pinTools, pinned, readJSON, renderPanel, setGoalState, togglePin, writeJSON } from "./panel.mjs";
import { presets, syncPresets } from "./presets.mjs";
import { CLUE_DRAG, sendToGM } from "./socket.mjs";
import { Store, canPartyEdit, lastChange, mutate, mutateTracker, partyQuestsOn, project, since, stripStamps, undoLast, visibleTrackers } from "./store.mjs";
import { editView, openDetails } from "./view-edit.mjs";
import { GM } from "./view-gm.mjs";
import { PLAYER, chatCard } from "./view-player.mjs";

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

/**
 * What changed in the trackers this user sees since the last redraw: the ids and kinds, and whether any came or went.
 * The first call counts everything as changed.
 */
let lastShown = null;
function trackersChanged() {
  const now = new Map(visibleTrackers().map((t) => [t.id, { kind: t.kind, json: JSON.stringify(t) }]));
  const ids = new Set();
  const kinds = new Set();
  let came = !lastShown;
  for (const [id, x] of now) {
    const was = lastShown?.get(id);
    if (!was) came = true;
    if (!was || was.json !== x.json) {
      ids.add(id);
      kinds.add(x.kind);
    }
  }
  for (const [id, x] of lastShown ?? []) {
    if (!now.has(id)) {
      came = true;
      ids.add(id);
      kinds.add(x.kind);
    }
  }
  lastShown = now;
  return { ids, kinds, came };
}

/**
 * Draw again what shows the trackers. `data: true` says only the trackers changed (a save, a load, the players' copy):
 * then a window draws again only when what it shows changed, the Quests tab on any change (quests show links to every
 * kind). Any other call (a setting, the calendar, a mark) draws everything.
 */
let refreshAll = false;
function refresh({ data = false } = {}) {
  if (!data) refreshAll = true;
  clearTimeout(refreshTimer);
  changedSoon();
  refreshTimer = setTimeout(() => {
    const all = refreshAll;
    refreshAll = false;
    const changed = trackersChanged();
    forgetPins();
    renderPanel();
    refreshPreviews(all ? null : changed.ids);
    for (const app of openApps) {
      if (!app.rendered) continue;
      if (!all && !changed.came && !changed.kinds.has(app.state.tab) && !(app.state.tab === "quest" && changed.ids.size)) continue;
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

/** The tracker id of the card an element sits in, or null outside one (a click on a stray element). */
const tidOf = (el) => el?.closest?.("[data-tid]")?.dataset.tid ?? null;

/** Mark a control busy for a few seconds (a request on its way); false when it already is. */
function markBusy(el) {
  if (el.classList.contains("pct-busy")) return false;
  el.classList.add("pct-busy");
  setTimeout(() => el.classList.remove("pct-busy"), 5000);
  return true;
}

/** The window's own changes: kept for Undo (see store.mjs). */
const mutateHere = (fn, opts = {}) => mutate(fn, { ...opts, undo: true });
const mutateTrackerHere = (id, fn, opts = {}) => mutateTracker(id, fn, { ...opts, undo: true });

/** After a dialog the window opened: focus back in the window (the kit finds the same control after a redraw). */
function backTo(app, event) {
  const el = event?.target?.closest?.("[data-action]") ?? null;
  if (!app?.element?.isConnected) return;
  if (el?.isConnected) el.focus({ preventScroll: true });
  else app.focusWindow?.();
}

/** The trackers window: one at a time. open(setup) runs setup on the window, new or open, before drawing it. */
const theWindow = singleWindow((setup) => {
  const app = new TrackersApp();
  setup?.(app);
  return app;
}, { reuse: (app, setup) => setup?.(app) });

/** Open the window on a quest, with one of its sections open for editing if asked. */
function openQuest(id, sec = null) {
  if (!game.user.isGM && !game.settings.get(MOD, "playerAccess")) return;
  return theWindow.open((app) => {
    app.state.tab = "quest";
    app.state.quest = id;
    if (sec) app.state.qedit.add(`${id}:${sec}`);
    saveUI(app.state);
  });
}

async function onPanelClick(ev) {
  const el = ev.target.closest("[data-qp]");
  if (!el || !panelEl?.contains(el)) return;
  const { qp, tid } = el.dataset;
  const right = ev.type === "contextmenu";
  if (qp === "move" || (right && !(qp === "tick" && game.user.isGM))) return;
  ev.preventDefault();
  const st = readJSON(PANEL_KEY, {});
  if (qp === "min") {
    writeJSON(PANEL_KEY, { ...st, min: !st.min });
    renderPanel();
  } else if (qp === "close") {
    await game.settings.set(MOD, "questPanel", false);
    ui.notifications.info(lz("QuestPanelHiddenToBringIt"));
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
    if (!markBusy(el)) return;
    if (game.user.isGM) await setGoalState(tid, { goal: el.dataset.goal }, right);
    else if (!tickToGM(tid, el.dataset.goal, "done")) el.classList.remove("pct-busy");
  }
}

/** Tab, shown quest, folded cards and open GM-notes boxes, kept in this browser across redraws and reopening. */
const loadUI = () => plainObject(local.get("ui", {}, { from: oldKey("ui") }));
function saveUI(state) {
  // Without storage the state lives only in this window.
  local.set("ui", { tab: state.tab, closed: [...state.closed], notesOpen: [...state.notesOpen], quest: state.quest });
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

/** The window. Keys are its own while someone works in it (the kit's ownKeys): it is read and written in. */
class TrackersApp extends keyboardWindow(rememberWindow(foundry.applications.api.ApplicationV2, { module: MOD, name: "main", size: true, from: oldKey("size") }), { module: MOD, scope: FOCUS_SCOPE, ownKeys: true }) {
  static DEFAULT_OPTIONS = {
    id: MOD,
    classes: ["pct-app"],
    tag: "div",
    window: {
      title: "Campaign Trackers",
      icon: "fa-solid fa-list-check",
      resizable: true,
      controls: [
        { icon: "fa-solid fa-download", label: "PCT.ExportData", action: "pctExport" },
        { icon: "fa-solid fa-upload", label: "PCT.ImportData", action: "pctImport" },
        { icon: "fa-solid fa-file-import", label: "PCT.ImportATracker", action: "pctImportOne" },
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
      pctIndivDrop: TrackersApp.#onIndivDrop,
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
      pctSecFold: TrackersApp.#onSecFold,
      pctApplyAll: TrackersApp.#onApplyAll,
      pctUseCalendar: TrackersApp.#onUseCalendar,
      pctSince: TrackersApp.#onSince,
      pctUndo: () => TrackersApp.undo(),
      pctDuplicate: TrackersApp.#onDuplicate,
      pctExportOne: TrackersApp.#onExportOne,
      pctImportOne: TrackersApp.#onImportOne,
      pctClueFile: TrackersApp.#onClueFile,
      pctQCopy: TrackersApp.#onQCopy,
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

  /** The trackers this window shows, sorted; worked out again only when the data behind them changed. */
  trackers() {
    const from = game.user.isGM ? Store.data : game.settings.get(MOD, "public");
    const key = this.isGM ? "gm" : "player";
    if (this._list && this._listFrom === from && this._listKey === key) return this._list;
    const list = this.isGM ? Store.data.trackers : visibleTrackers({ asPlayer: true });
    this._list = [...list].sort((a, b) => num(a.sort) - num(b.sort) || String(a.name).localeCompare(String(b.name)));
    this._listFrom = from;
    this._listKey = key;
    return this._list;
  }

  /** The tracker a click came from: the full one for the GM, the revealed copy for players. */
  trackerFor(target) {
    const id = target.closest("[data-tid]")?.dataset.tid;
    if (!id) return null;
    return this.trackers().find((t) => t.id === id) ?? null;
  }

  /**
   * A path drawn into this window made right for the tracker now (see remapPath). Null when the row it named is gone:
   * the user is told and the window drawn again.
   */
  livePath(id, path, t) {
    const p = remapPath(this.drawn?.get(id), t, path);
    if (p === null) {
      ui.notifications.info(lz("ThatRowChangedOrWasRemoved"));
      this.render();
    }
    return p;
  }

  async _renderHTML() {
    const all = this.trackers();
    // The trackers as drawn, so a click on a view that's behind finds its row by id (livePath).
    this.drawn = new Map(all.map((t) => [t.id, t]));
    const kinds = this.isGM ? KINDS : KINDS.filter((k) => all.some((t) => t.kind === k) || (k === "quest" && partyQuestsOn()));
    if (!kinds.includes(this.state.tab)) this.state.tab = kinds[0] ?? null;
    const el = document.createElement("div");
    el.className = "pct";
    const rail = kinds.map((k) => {
      const n = all.filter((t) => t.kind === k).length;
      const dot = k === "quest" && !game.user.isGM && all.some((t) => t.kind === "quest" && unseen(t) && !(this.state.tab === "quest" && t.id === this.state.quest)) ? `<b class="pct-qdot" ${tipAttr(lz("SomethingNew"))}></b>` : "";
      const sel = this.state.tab === k;
      return `<button type="button" role="tab" id="pct-tab-${k}" aria-selected="${sel}" aria-controls="pct-tabpanel" data-action="pctTab" data-kind="${k}" class="pct-tab ${sel ? "active" : ""}"${sel ? " data-focus-home" : ""}><i class="${KIND_INFO[k].icon}" aria-hidden="true"></i><span>${esc(KIND_INFO[k].tab)}</span>${dot}${n ? `<em aria-label="${esc(lz(n === 1 ? "OneTracker" : "NTrackers", { n }))}">${n}</em>` : ""}</button>`;
    }).join("");
    const foot = game.user.isGM
      ? `<div class="pct-rail-foot">
          ${A("pctUndo", "fa-solid fa-rotate-left", { label: lz("Undo"), tip: lastChange() ? `${lz("UndoTheLastChangeCtrlZ")} ${lastChange().label}` : lz("NothingToUndoYet"), disabled: !lastChange() })}
          ${A("pctPreview", this.state.preview ? "fa-solid fa-user-shield" : "fa-solid fa-users", { label: this.state.preview ? lz("BackToGMView") : lz("PlayerView"), tip: lz("SeeTheWindowAsThePlayers"), cls: this.state.preview ? "pct-on" : "" })}
          ${presets.size ? A("pctPresets", "fa-solid fa-box-open", { label: lz("Presets"), tip: lz("ReloadAPresetSTextFrom") }) : ""}
          ${!sameCalendar() ? `<p class="pct-hint">${lz("DateRemindersArePausedTheWorld")} ${A("pctUseCalendar", "fa-solid fa-calendar-check", { label: lz("UseThisCalendar"), tip: lz("ReadEveryStoredDateOnThe") })}</p>` : ""}
          ${Store.broken ? `<p class="pct-hint">${lz("TheStoredDataCouldnTBe")}</p>` : ""}
        </div>`
      : "";
    el.innerHTML = `<nav class="pct-rail">${rail ? `<div class="pct-tabs" role="tablist" aria-orientation="vertical" aria-label="${esc(lz("KindsOfTracker"))}">${rail}</div>` : `<p class="pct-hint">${lz("NothingHasBeenSharedYet")}</p>`}${foot}</nav>
      <section class="pct-body" data-keep-scroll="body" id="pct-tabpanel"${this.state.tab ? ` role="tabpanel" aria-labelledby="pct-tab-${this.state.tab}"` : ""} data-focus-pane="body" data-focus-start tabindex="-1">${this.state.tab ? this.#tab(this.state.tab, all.filter((t) => t.kind === this.state.tab)) : ""}</section>
      ${this.isGM ? skillList() : ""}`;
    return el;
  }

  #tab(kind, list) {
    const info = KIND_INFO[kind];
    const head = `<header class="pct-tab-head"><div><h2><i class="${info.icon}"></i> ${esc(info.tab)}</h2>${this.isGM ? `<p class="pct-hint">${esc(info.blurb)}</p>` : ""}</div>
        ${this.isGM && kind === "quest" ? A("pctSince", "fa-solid fa-clock-rotate-left", { label: lz("SinceLastSession"), tip: lz("WhatThePartyLearnedAndDid") }) : ""}
        ${this.isGM ? A("pctNew", "fa-solid fa-plus", { label: `${lz("New")} ${info.label.toLowerCase()}`, data: { kind }, cls: "pct-new" }) : kind === "quest" && !game.user.isGM && partyQuestsOn() ? A("pctQNew", "fa-solid fa-plus", { label: lz("NewQuest"), tip: lz("AQuestTheWholePartyCan"), cls: "pct-new" }) : ""}</header>`;
    if (kind === "quest") {
      // Brought back here after the panel's own close button hid it.
      const panelOff = !game.settings.get(MOD, "questPanel") ? `<p class="pct-hint pct-panel-off">${lz("TheQuestPanelIsHiddenFor")} ${A("pctPanelOn", "fa-solid fa-scroll", { label: lz("ShowTheQuestPanel") })}</p>` : "";
      return head + panelOff + this.#quests(list);
    }
    const cards = list.map((t) => this.#card(t)).join("") || `<p class="pct-hint">${this.isGM ? lz("NoneYet") : lz("NothingHereYet")}</p>`;
    return head + cards;
  }

  /** Quests: a list grouped by status beside the chosen quest, like a journal. */
  #quests(list) {
    if (!list.length) return `<p class="pct-hint">${this.isGM ? lz("NoneYet") : lz("NothingHereYet")}</p>`;
    if (!list.some((q) => q.id === this.state.quest)) this.state.quest = (list.find((q) => q.status === "active") ?? list[0]).id;
    const pins = new Set(pinned());
    const groups = QGROUPS.map((st) => {
      const rows = list.filter((q) => (QSTATUS.includes(q.status) ? q.status : "active") === st);
      if (!rows.length) return "";
      return `<div class="pct-sub">${esc(QSTATUS_LABEL[st])} <em>${rows.length}</em></div><ul>${rows.map((q) => {
        const main = q.objectives.filter((o) => !o.optional);
        const done = main.filter((o) => o.state === "done").length;
        const mark = game.user.isGM || q.id === this.state.quest ? "" : unseen(q);
        return `<li><a data-action="pctQuestGo" data-qid="${esc(q.id)}" draggable="true" role="button" tabindex="0"${q.id === this.state.quest ? ` aria-current="true"` : ""} class="pct-qli-${esc(q.status)} ${q.id === this.state.quest ? "active" : ""} ${this.isGM && !q.revealed ? "pct-hiddenq" : ""}">
            ${this.isGM && !q.revealed ? `<i class="fa-solid fa-eye-slash" ${tipAttr(lz("HiddenFromPlayers"))}></i>` : ""}<span>${esc(q.name)}</span>${q.party ? `<i class="fa-solid fa-users pct-qli-ico" ${tipAttr(`${lz("APartyQuestMadeBy")} ${q.party.by === game.user.id ? lz("You") : q.party.name || lz("APlayer")}`)}></i>` : ""}${q.focus ? `<i class="fa-solid fa-star pct-qli-ico" ${tipAttr(lz("PartyFocus"))}></i>` : ""}${pins.has(q.id) ? `<i class="fa-solid fa-thumbtack pct-qli-ico" ${tipAttr(lz("PinnedToYourQuestPanel"))}></i>` : ""}${mark ? `<b class="pct-qnew">${mark === "new" ? lz("New") : lz("Updated")}</b>` : ""}
            <small>${[q.category, main.length ? `${done}/${main.length}` : ""].filter(Boolean).map(esc).join(" · ")}</small></a></li>`;
      }).join("")}</ul>`;
    }).join("");
    const chosen = list.find((q) => q.id === this.state.quest);
    // A minimized window shows nothing, so its quest isn't seen until it's restored. `collapsed`, not `minimized`:
    // this runs inside a render, when `minimized` reads false.
    if (chosen && !game.user.isGM && !this.collapsed) markSeen(chosen);
    return `<div class="pct-quests"><nav class="pct-qlist">${groups}</nav><div class="pct-qdetail">${chosen ? this.#card(chosen) : ""}</div></div>`;
  }

  #card(t) {
    const closed = this.state.closed.has(t.id);
    if (!this.isGM) {
      const party = canPartyEdit(t);
      const secs = new Set([...this.state.qedit].filter((k) => k.startsWith(`${t.id}:`)).map((k) => k.slice(t.id.length + 1)));
      const del = party && t.party.by === game.user.id ? A("pctQDel", "fa-solid fa-trash", { tip: lz("DeleteThisQuest") }) : "";
      const body = party ? questParty(t, secs) : `${t.desc ? `<p class="pct-desc">${para(t.desc)}</p>` : ""}${PLAYER[t.kind](t)}`;
      return `<article class="pct-card ${t.kind === "quest" ? `pct-qcard-${esc(t.status)}` : ""}" data-tid="${esc(t.id)}" data-focus-key="${esc(`card:${t.id}`)}">
          <header>${A("pctFold", closed ? "fa-solid fa-caret-right" : "fa-solid fa-caret-down", { cls: "pct-fold", name: t.name, tip: closed ? lz("Show") : lz("Fold"), expanded: !closed })}<h3>${esc(t.name)}</h3>${t.kind === "quest" ? `<span class="pct-tools">${pinTools(t, false)}${del}</span>` : ""}</header>
          ${closed ? "" : `<div class="pct-card-body">${body}</div>`}
        </article>`;
    }
    const editing = this.state.edit.has(t.id);
    const picking = this.state.rl?.qid === t.id && !editing;
    const reveal = A("pctReveal", t.revealed ? "fa-solid fa-eye" : "fa-solid fa-eye-slash", { name: lz("ShownToPlayers"), pressed: !!t.revealed, tip: t.revealed ? lz("ShownToPlayersClickToHide") : lz("HiddenFromPlayersClickToShow"), cls: `pct-eye ${t.revealed ? "pct-on" : ""}` });
    const post = A("pctPost", "fa-solid fa-comment", { tip: lz("PostToChatWhatPlayersSee") });
    const editBtn = A("pctEdit", editing ? "fa-solid fa-check" : "fa-solid fa-pen", { tip: editing ? lz("DoneEditing") : lz("Edit"), cls: editing ? "pct-on" : "" });
    // U2: a quest keeps focus, reveal and post to chat in sight (and Done or Stop while editing or picking); the
    // rest go in a menu, Delete last and set apart.
    const tools = t.kind === "quest"
      ? [
          focusTool(t),
          reveal,
          post,
          editing ? editBtn : "",
          picking ? A("pctRLPick", "fa-solid fa-link", { label: lz("StopPicking"), tip: lz("StopPickingPartsForAReveal"), cls: "pct-on" }) : "",
          moreMenu(t.id, [
            pinTool(t, { menu: true }),
            !editing && !picking ? A("pctRLPick", "fa-solid fa-link", { label: lz("MakeARevealLink"), tip: lz("PickThePartsItRevealsThen") }) : "",
            A("pctQCopy", "fa-solid fa-copy", { label: lz("CopyALinkToThisQuest"), tip: lz("ForAJournalPageTheSame") }),
            editing ? "" : A("pctEdit", "fa-solid fa-pen", { label: lz("Edit") }),
            A("pctDuplicate", "fa-solid fa-clone", { label: lz("Duplicate"), tip: lz("ACopyJustBelowHiddenFrom") }),
            A("pctExportOne", "fa-solid fa-file-export", { label: lz("ExportThisTracker"), tip: lz("AFileToImportIntoAnother") }),
          ], A("pctDelete", "fa-solid fa-trash", { label: lz("Delete"), cls: "pct-danger" })),
        ].join("")
      : [reveal, post, editBtn, moreMenu(t.id, [
          A("pctDuplicate", "fa-solid fa-clone", { label: lz("Duplicate"), tip: lz("ACopyJustBelowHiddenFrom") }),
          A("pctExportOne", "fa-solid fa-file-export", { label: lz("ExportThisTracker"), tip: lz("AFileToImportIntoAnother") }),
        ], A("pctDelete", "fa-solid fa-trash", { label: lz("Delete"), cls: "pct-danger" }))].join("");
    const secs = new Set([...this.state.qedit].filter((k) => k.startsWith(`${t.id}:`)).map((k) => k.slice(t.id.length + 1)));
    if (t.kind === "quest" && !closed && !editing) {
      return `<article class="pct-card pct-qcard-${esc(t.status)} ${t.revealed ? "" : "pct-hidden"}" data-tid="${esc(t.id)}" data-focus-key="${esc(`card:${t.id}`)}" data-drop-card>
          <header>${A("pctFold", "fa-solid fa-caret-down", { cls: "pct-fold", name: t.name, tip: lz("Fold"), expanded: true })}<h3>${esc(t.name)}</h3><span class="pct-sum">${esc(summary(t))}</span><span class="pct-tools">${tools}</span></header>
          <div class="pct-card-body">${questGM(t, secs, picking ? new Set(this.state.rl.ids) : null)}</div>
        </article>`;
    }
    const waiting = closed || editing ? 0 : waitingCards(t.id).length;
    const waitLine = waiting ? `<div class="pct-line pct-waiting"><span>${waiting === 1 ? lz("1RollWaits") : `${lz("RollsWait", { waiting: waiting })}`} ${lz("ForApplyInChat")}</span>${A("pctApplyAll", "fa-solid fa-check-double", { label: lz("ApplyAll"), tip: lz("ApplyEachWaitingRollInThe") })}</div>` : "";
    const body = closed ? "" : `<div class="pct-card-body">${waitLine}${editing ? editView(t) : `${t.desc ? `<p class="pct-desc">${para(t.desc)}</p>` : ""}${GM[t.kind](t)}${t.notes ? `<details class="pct-notes-box" data-focus-key="notes" ${this.state.notesOpen.has(t.id) ? "open" : ""}><summary>${lz("GMNotes")}</summary><div class="pct-gm">${para(t.notes)}</div></details>` : ""}`}</div>`;
    return `<article class="pct-card ${t.kind === "quest" ? `pct-qcard-${esc(t.status)}` : ""} ${t.revealed ? "" : "pct-hidden"}" data-tid="${esc(t.id)}" data-focus-key="${esc(`card:${t.id}`)}" data-drop-card>
        <header>${A("pctFold", closed ? "fa-solid fa-caret-right" : "fa-solid fa-caret-down", { cls: "pct-fold", name: t.name, tip: closed ? lz("Show") : lz("Fold"), expanded: !closed })}<h3>${esc(t.name)}</h3><span class="pct-sum">${esc(summary(t))}</span><span class="pct-tools">${tools}</span></header>
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
    // (Enter and Space on the draggable role="button" elements are the kit's.) Escape closes an open menu first;
    // Shift+Enter on a goal box or a clock segment does what a right-click does.
    this.element.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        const menu = ev.target.closest?.("details.pct-more[open]");
        if (!menu) return;
        ev.preventDefault();
        ev.stopPropagation();
        menu.open = false;
        menu.querySelector("summary")?.focus();
        return;
      }
      if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === "z" && game.user.isGM && !ev.target.closest?.("input, textarea, select, [contenteditable]")) {
        ev.preventDefault();
        ev.stopPropagation();
        TrackersApp.undo();
        return;
      }
      if (ev.key === "Enter" && ev.shiftKey && ev.target.matches?.('[data-action="pctQState"], [data-action="pctSeg"]')) {
        ev.preventDefault();
        ev.stopPropagation();
        const right = { type: "contextmenu", button: 2 };
        if (ev.target.dataset.action === "pctQState") TrackersApp.#onQState.call(this, right, ev.target);
        else TrackersApp.#onSeg.call(this, right, ev.target);
      }
    });
    // A click anywhere else, or on one of its entries, closes an open menu.
    this.element.addEventListener("click", (ev) => {
      const inMenu = ev.target.closest?.("details.pct-more");
      for (const m of this.element.querySelectorAll("details.pct-more[open]")) if (m !== inMenu || ev.target.closest(".pct-menu button")) m.open = false;
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

  /** A player's quest is seen once the window shows it again (the window's memory restores it whole). */
  async maximize() {
    const was = this.collapsed;
    const r = await super.maximize();
    if (was && !game.user.isGM && this.rendered && !this.collapsed) this.render();
    return r;
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
        ui.notifications.warn(lz("BadDate", { value: esc(el.value), a: esc(exampleDate()), b: esc(exampleDate(true)) }));
        return refresh();
      }
    } else if (type === "idlist") {
      const on = el.checked, rowId = el.value;
      return mutateTrackerHere(card.dataset.tid, (t) => {
        const p = this.livePath(card.dataset.tid, path, t);
        if (p === null) return undefined;
        const list = new Set(foundry.utils.getProperty(t, p) ?? []);
        on ? list.add(rowId) : list.delete(rowId);
        foundry.utils.setProperty(t, p, [...list]);
      }, { notify: false });
    } else if (type === "segcount") {
      value = clamp(Math.round(num(el.value, 6)), 1, 24);
      const dropped = (this.trackerFor(el)?.segments ?? []).slice(value).filter((s) => s.state !== "empty" || s.label || s.date);
      if (dropped.length) {
        const ok = await foundry.applications.api.DialogV2.confirm({
          window: { title: lz("FewerSegments") },
          content: `<p>${lz("GoingDownToSegmentsDropsThat", { value: value, length: dropped.length })} ${dropped.length === 1 ? "is" : "are"} ${lz("FilledBrokenNamedOrDatedDrop")} ${dropped.length === 1 ? "it" : "them"}?</p>`,
        });
        if (!ok) return this.render();
      }
    } else value = el.value;
    if (/\.link\.tid$/.test(path)) {
      const at = path.slice(0, -".link.tid".length);
      return mutateTrackerHere(card.dataset.tid, (t) => {
        const p = this.livePath(card.dataset.tid, at, t);
        if (p === null) return undefined;
        const g = foundry.utils.getProperty(t, p);
        if (g) g.link = value ? { tid: value, cond: null, at: null, entry: null } : null;
      }, { notify: false });
    }
    await mutateTrackerHere(card.dataset.tid, (t) => {
      if (type === "segcount") {
        while (t.segments.length < value) t.segments.push(TPL.segment());
        t.segments.length = value;
        return;
      }
      const p = this.livePath(card.dataset.tid, path, t);
      if (p === null) return undefined;
      foundry.utils.setProperty(t, p, value);
    });
  }

  /** F1: take back the last change made here. */
  static async undo() {
    if (!game.user.isGM) return;
    if (!lastChange()) return ui.notifications.info(lz("NothingToUndo"));
    const done = await undoLast();
    if (done) ui.notifications.info(lz("UndoneLabel", { label: esc(done.label) }));
    else ui.notifications.warn(lz("TheUndoDidnTSaveTry"));
  }

  /** F2: a copy of a tracker, hidden from players, just after it. */
  static async #onDuplicate(event, target) {
    const src = Store.get(tidOf(target));
    if (!src || !this.isGM) return;
    const copy = normalize({ ...stripStamps(clone(src)), id: uid(), name: lz("CopyName", { name: src.name }), revealed: false, ...(src.kind === "quest" ? { focus: false, party: null } : {}) });
    const ok = await mutateHere((d) => {
      const i = d.trackers.findIndex((x) => x.id === src.id);
      d.trackers.splice(i < 0 ? d.trackers.length : i + 1, 0, copy);
      return true;
    }, { notify: false });
    if (ok && copy.kind === "quest") {
      this.state.quest = copy.id;
      this.render();
    }
  }

  /** F2: one tracker as a file, to import into another world (or this one). */
  static #onExportOne(event, target) {
    const t = Store.get(tidOf(target));
    if (!t || !this.isGM) return;
    const slug = String(t.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || t.kind;
    foundry.utils.saveDataToFile(JSON.stringify({ module: MOD, version: game.modules.get(MOD)?.version ?? "", tracker: t }, null, 2), "application/json", `tracker-${slug}.json`);
  }

  /** F2: add one tracker from a file (one exported tracker), beside what is here, with a new id and hidden. */
  static async #onImportOne(event) {
    if (!game.user.isGM) return;
    const file = await foundry.applications.api.DialogV2.wait({
      window: { title: lz("ImportATracker") },
      classes: ["pct-dialog"],
      content: `<p>${lz("PickAFileMadeWith")} <strong>${lz("ExportThisTracker")}</strong>. It's added beside what is here, hidden from players.</p><input type="file" name="file" accept=".json,application/json" aria-label="${esc(lz("TheTrackerFile"))}">`,
      buttons: [
        { action: "import", label: lz("Import"), icon: "fa-solid fa-file-import", callback: (event, button) => button.form?.elements.file?.files?.[0] ?? null },
        { action: "cancel", label: lz("Cancel"), default: true },
      ],
      rejectClose: false,
    });
    backTo(this, event);
    if (!(file instanceof File)) return;
    let data;
    try {
      data = JSON.parse(await foundry.utils.readTextFromFile(file));
    } catch (err) {
      return ui.notifications.error(lz("CampaignTrackersIsnTValidJSON", { name: esc(file.name), message: esc(err.message) }));
    }
    const raw = data?.tracker ?? data;
    if (!plainObject(raw) || !KINDS.includes(raw.kind)) {
      const hint = Array.isArray(data?.trackers) ? lz("ItHoldsAllTheTrackersOf") : "";
      return ui.notifications.error(lz("CampaignTrackersDoesnTHoldOne", { name: esc(file.name), hint: esc(hint) }));
    }
    const t = normalize({ ...stripStamps(clone(raw)), id: uid(), revealed: false, ...(raw.kind === "quest" ? { focus: false, party: null } : {}) });
    const ok = await mutateHere((d) => {
      d.trackers.push(t);
      return true;
    }, { notify: false });
    if (!ok) return;
    this.state.tab = t.kind;
    if (t.kind === "quest") this.state.quest = t.id;
    saveUI(this.state);
    this.render();
    ui.notifications.info(lz("CampaignTrackersAddedHiddenFromPlayers", { name: esc(t.name) }));
  }

  /** F4: what the party learned and did since a time (by default the start of this GM's last session). */
  static async #onSince(event) {
    if (!this.isGM) return;
    const WHAT = { quest: lz("QuestRevealed"), status: lz("Status"), clue: lz("Clue"), objective: lz("ObjectiveRevealed"), done: lz("Done"), failed: lz("Failed"), lead: lz("LeadRevealed"), followed: lz("LeadFollowed"), reward: lz("RewardRevealed") };
    const local2 = (ms) => {
      const x = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
      return x.toISOString().slice(0, 16);
    };
    const list = (from) => {
      const rows = since(from);
      if (!rows.length) return `<p class="pct-hint">${lz("NothingSinceThen")}</p>`;
      const byQuest = new Map();
      for (const r of rows) {
        if (!byQuest.has(r.tid)) byQuest.set(r.tid, { name: r.quest, rows: [] });
        byQuest.get(r.tid).rows.push(r);
      }
      return [...byQuest.values()].map((q) => `<h4>${esc(q.name)}</h4><ul>${q.rows.map((r) => `<li><span class="pct-chip">${esc(WHAT[r.what] ?? r.what)}</span> ${esc(shortText(r.text, 140))} <span class="pct-hint">${esc(new Date(r.at).toLocaleString())}</span></li>`).join("")}</ul>`).join("");
    };
    const start = lastSession();
    await foundry.applications.api.DialogV2.prompt({
      window: { title: lz("SinceLastSession"), resizable: true },
      classes: ["pct-dialog", "pct-since"],
      position: { width: 560 },
      content: `<div class="form-group"><label for="pct-since-from">${lz("Since")}</label><input type="datetime-local" id="pct-since-from" name="from" value="${local2(start)}"></div><p class="hint">${lz("ItStartsAtYourLastSession")}</p><div class="pct-since-list" aria-live="polite">${list(start)}</div>`,
      render: (ev, dlg) => {
        const root = dlg instanceof HTMLElement ? dlg : dlg?.element;
        const input = root?.querySelector('[name="from"]');
        input?.addEventListener("change", () => {
          const t = new Date(input.value).getTime();
          if (Number.isFinite(t)) root.querySelector(".pct-since-list").innerHTML = list(t);
        });
      },
      ok: { label: lz("Close") },
      rejectClose: false,
    });
    backTo(this, event);
  }

  /** TR6: the GM keeps the stored dates on the calendar the world has now; reminders resume. */
  static async #onUseCalendar(event) {
    if (!this.isGM) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: lz("UseThisCalendar") },
      content: `<p>${lz("UseThisCalendarAsk")}</p>`,
    });
    backTo(this, event);
    if (!ok) return;
    await mutate((d) => void (d.calendar = calendarSig()), { notify: false });
    scheduleReminders();
    this.render();
  }

  /** F9: apply every roll card waiting for this tracker. */
  static async #onApplyAll(event, target) {
    const tid = tidOf(target);
    if (!tid) return;
    target.disabled = true;
    const n = await applyAll(tid);
    if (n) ui.notifications.info(n === 1 ? lz("AppliedOneRoll") : lz("AppliedRolls", { n }));
    this.render();
  }

  /** F6: fold or show a quest's section. */
  static #onSecFold(event, target) {
    const key = target.dataset.fold;
    if (!key) return;
    setFold(key, !foldOpen(key, true), true);
    this.render();
  }

  /** Decision 7: file a clue without dragging it, from a list of the quest's objectives and steps. */
  static async #onClueFile(event, target) {
    const tid = tidOf(target);
    const q = tid ? this.drawn?.get(tid) : null;
    const e = q?.entries?.find((x) => x.id === target.dataset.clue);
    if (!e) return;
    const ids = (q.objectives ?? []).flatMap((o) => [o.id, ...(o.steps ?? []).map((st) => st.id)]);
    const opts = [["", lz("NothingNotFiled")], ...ids.map((id) => {
      const h = goalHeading(q, id);
      return [id, `${h.label}${this.isGM && h.g.revealed === false ? lz("HiddenSuffix") : ""}`];
    })];
    const under = await foundry.applications.api.DialogV2.prompt({
      window: { title: lz("FileTheClue") },
      classes: ["pct-dialog"],
      content: `<p>${esc(shortText(e.text, 90))}</p><div class="form-group"><label for="pct-file-under">${lz("FileItUnder")}</label><select id="pct-file-under" name="under" autofocus>${opts.map(([v, l]) => `<option value="${esc(v)}"${v === (e.under ?? "") ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></div>`,
      ok: { label: lz("FileIt"), callback: (ev, button) => button.form.elements.under.value },
      rejectClose: false,
    });
    if (typeof under === "string") await this.#fileClue(tid, e.id, under);
    backTo(this, event);
  }

  /** Copy "@Quest[id]", as dragging the quest from the list gives. */
  static async #onQCopy(event, target) {
    const t = this.trackerFor(target);
    if (!t) return;
    if (await copyText(`@Quest[${t.id}]`)) ui.notifications.info(lz("QuestLinkCopiedPasteItInto"));
    else ui.notifications.warn(lz("TheBrowserWouldnTCopyIt"));
  }

  /** File a clue under a goal (or nothing): the GM directly, a player through the GM. */
  async #fileClue(tid, clueId, under) {
    if (this.isGM) {
      await mutateTrackerHere(tid, (t) => {
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
    if (where.endsWith(".actor") && actor.type !== "loot") ui.notifications.info(lz("IsnTALootActorLinked", { name: esc(actor.name) }));
    await mutateTrackerHere(card.dataset.tid, (t) => {
      if (where === "npc") t.npc = link;
      else if (where === "giver") t.giver = link;
      else if (/^rewards\.\d+\.actor$/.test(where)) {
        const p = this.livePath(card.dataset.tid, where, t);
        if (p !== null) foundry.utils.setProperty(t, p, link);
      }
    }, { notify: false });
  }

  static #onQTick(event, target) {
    const t = this.trackerFor(target);
    if (!t || !markBusy(target)) return;
    tickToGM(t.id, target.dataset.goal, target.dataset.to);
  }

  /** Mark a lead followed or not: the GM directly (then offers what it reveals), a player through the GM. */
  static async #onLeadFollow(event, target) {
    const t = this.trackerFor(target);
    if (!t) return;
    const { lead, to } = target.dataset;
    if (this.isGM) {
      const done = await mutateTrackerHere(t.id, (tr) => {
        const l = (tr.leads ?? []).find((x) => x.id === lead);
        if (!l || l.followed === (to === "done")) return undefined;
        l.followed = to === "done";
        l.followedBy = l.followed ? "gm" : null;
        return true;
      }, { notify: false });
      if (done && to === "done") await offerLead(t.id, lead, { undo: true });
      return;
    }
    if (game.user.isGM || !markBusy(target)) return;
    followToGM(t.id, lead, to);
  }

  static async #onQNoteAdd(event, target) {
    const t = this.trackerFor(target);
    const area = target.closest(".pct-qnote-add")?.querySelector("textarea");
    const text = area?.value.trim();
    if (!t || !text) return;
    if (this.isGM) {
      if ((t.pnotes?.length ?? 0) >= NOTE_MAX) return ui.notifications.warn(lz("ThePartyJournalOfHasEntries", { name: esc(t.name), NOTEMAX: esc(NOTE_MAX) }));
      await mutateTrackerHere(t.id, (tr) => applyQuestNote(tr, "add", { by: game.user.id, name: "GM", text, isGM: true }) || undefined, { notify: false });
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
    await mutateTrackerHere(t.id, (tr) => {
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
    if (this.isGM) await mutateTrackerHere(t.id, (tr) => applyQuestNote(tr, "delete", { id, isGM: true }) || undefined, { notify: false });
    else sendToGM({ type: "qnoteDel", tid: t.id, note: id });
  }

  static #onQSec(event, target) {
    const tid = tidOf(target);
    if (!tid) return;
    const key = `${tid}:${target.dataset.sec}`;
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
    if (!text) return void ui.notifications.warn(lz("ThisQuestSIdHasA"));
    if (await copyText(text)) ui.notifications.info(lz("RevealLinkCopiedPasteItInto"));
    else ui.notifications.warn(lz("TheBrowserWouldnTCopyIt2"));
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
    const tid = tidOf(target);
    if (tid) await setGoalState(tid, { goal: target.dataset.goal }, right);
  }

  static async #onQFocus(event, target) {
    const t = this.trackerFor(target);
    if (!t || !this.isGM) return;
    await mutateTrackerHere(t.id, (tr) => {
      tr.focus = !tr.focus;
    }, { notify: false });
  }

  /** A player makes a party quest: a name and a summary, then the GM's client makes it and it opens for them. */
  static async #onQNew() {
    if (game.user.isGM || !partyQuestsOn()) return;
    const data = await foundry.applications.api.DialogV2.wait({
      window: { title: lz("NewQuest"), icon: "fa-solid fa-scroll" },
      classes: ["pct-qnew-dialog"],
      position: { width: 420 },
      content: `<div class="pct-dialog-form"><label>${lz("Name")} <input type="text" name="name" placeholder="${esc(lz("WhoIsBuyingTheStolenLedgers"))}" autofocus></label>
        <label>${lz("Summary")} <textarea name="desc" rows="3" placeholder="${esc(lz("WhatThePartyWantsToFind"))}"></textarea></label>
        <p class="pct-hint">${lz("AnyoneInThePartyCanEdit")}</p></div>`,
      buttons: [
        { action: "ok", label: lz("MakeIt"), icon: "fa-solid fa-check", default: true, callback: (event, button) => ({ name: button.form.elements.name.value.trim(), desc: button.form.elements.desc.value.trim() }) },
        { action: "cancel", label: lz("Cancel") },
      ],
      rejectClose: false,
    });
    if (!data || typeof data !== "object" || !data.name) return;
    sendToGM({ type: "qnew", name: data.name, desc: data.desc });
  }

  static async #onQMain(event, target) {
    const t = this.trackerFor(target);
    if (!this.isGM || !t?.party) return;
    await mutateTrackerHere(t.id, (tr) => {
      tr.category = lz("Main");
    }, { notify: false });
  }

  /** The GM takes a party quest over: it becomes an ordinary quest of theirs, everything in it kept. */
  static async #onQTake(event, target) {
    const t = this.trackerFor(target);
    if (!this.isGM || !t?.party) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: lz("TakeItOver") },
      content: `<p>${lz("Make")} <strong>${esc(t.name)}</strong> ${lz("YourQuestEverythingInItStays")}</p>`,
    });
    if (!ok) return;
    await mutateTrackerHere(t.id, (tr) => {
      tr.party = null;
    }, { notify: false });
  }

  static async #onQDel(event, target) {
    const t = this.trackerFor(target);
    if (!t?.party || t.party.by !== game.user.id) return;
    const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: lz("DeleteQuest") }, content: `<p>${lz("Delete")} <strong>${esc(t.name)}</strong> ${lz("ForTheWholePartyThisCan")}</p>` });
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
    const id = tidOf(target);
    if (!id) return;
    const path = target.dataset.path;
    await mutateTrackerHere(id, (t) => {
      const p = this.livePath(id, path, t);
      if (p === null) return undefined;
      foundry.utils.setProperty(t, p, null);
    }, { notify: false });
  }

  static #onQImg(event, target) {
    const t = this.trackerFor(target);
    if (!t) return;
    const FP = foundry.applications.apps.FilePicker.implementation;
    new FP({ type: "image", current: t.img || "", callback: (path) => mutateTrackerHere(t.id, (tr) => {
      tr.img = path;
    }, { notify: false }) }).render(true);
  }

  static async #onOpenActor(event, target) {
    const actor = await fromUuid(target.dataset.uuid);
    if (!actor) return ui.notifications.warn(lz("ThatActorNoLongerExists"));
    if (!actor.testUserPermission(game.user, "LIMITED")) return ui.notifications.info(lz("YouCanTOpenYet", { name: esc(actor.name) }));
    actor.sheet.render(true);
  }

  static #onTab(event, target) {
    this.state.tab = target.dataset.kind;
    saveUI(this.state);
    this.render();
  }

  static async #onNew(event, target) {
    const t = blank(target.dataset.kind);
    if (t.kind === "reputation" && !t.tiers.length) ui.notifications.warn(lz("TheReputationTiersCouldnTBe"));
    this.state.edit.add(t.id);
    await mutateHere((d) => {
      d.trackers.push(t);
    }, { notify: false });
  }

  static #onFold(event, target) {
    const id = tidOf(target);
    if (!id) return;
    this.state.closed.has(id) ? this.state.closed.delete(id) : this.state.closed.add(id);
    saveUI(this.state);
    this.render();
  }

  static #onEdit(event, target) {
    const id = tidOf(target);
    if (!id) return;
    this.state.edit.has(id) ? this.state.edit.delete(id) : this.state.edit.add(id);
    this.render();
  }

  static async #onReveal(event, target) {
    const id = tidOf(target);
    if (!id) return;
    await mutateTrackerHere(id, (t) => {
      t.revealed = !t.revealed;
    }, { notify: false });
  }

  static async #onPost(event, target) {
    const t = this.trackerFor(target);
    if (!t) return;
    if (!t.revealed) {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: lz("PostToChat") },
        content: `<p><strong>${esc(t.name)}</strong> ${lz("IsHiddenFromPlayersPostingIt")}</p>`,
      });
      if (!ok) return;
    }
    await ChatMessage.create({ content: chatCard(project(t, { force: true })), speaker: { alias: t.name || KIND_INFO[t.kind].label } });
  }

  static async #onDelete(event, target) {
    const t = this.trackerFor(target);
    if (!t) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: lz("DeleteTracker") },
      content: `<p>${lz("Delete")} <strong>${esc(t.name)}</strong>${lz("UndoCanBringItBack")}${t.preset ? lz("ItCameFromAPresetWhich") : ""}</p>`,
    });
    if (!ok) return;
    await mutateHere((d) => {
      d.trackers = d.trackers.filter((x) => x.id !== t.id);
    }, { notify: false });
  }

  static async #onStep(event, target) {
    const id = tidOf(target);
    if (!id) return;
    const path = target.dataset.path;
    const delta = Number(target.dataset.delta);
    await mutateTrackerHere(id, (t) => {
      const p = this.livePath(id, path, t);
      if (p === null) return undefined;
      const [lo, hi] = bounds(t, p);
      const now = num(foundry.utils.getProperty(t, p));
      foundry.utils.setProperty(t, p, clamp(now + delta, lo, hi));
    });
  }

  /** Take away an individual obstacle's row for someone outside the party (its points with it). */
  static async #onIndivDrop(event, target) {
    const id = tidOf(target);
    const key = target.dataset.key;
    if (!id || !key) return;
    await mutateTrackerHere(id, (t) => {
      const p = this.livePath(id, target.dataset.path, t);
      const by = p === null ? null : foundry.utils.getProperty(t, p);
      if (!by || !Object.hasOwn(by, key)) return undefined;
      delete by[key];
      return true;
    });
  }

  static async #onToggle(event, target) {
    const id = tidOf(target);
    if (!id) return;
    const path = target.dataset.path;
    let at = null;
    const now = await mutateTrackerHere(id, (t) => {
      const p = this.livePath(id, path, t);
      if (p === null) return undefined;
      at = p;
      foundry.utils.setProperty(t, p, !foundry.utils.getProperty(t, p));
      const on = !!foundry.utils.getProperty(t, p);
      // A step shown under a hidden objective shows nothing: the objective comes too.
      const sm = on && t.kind === "quest" && p.match(/^objectives\.(\d+)\.steps\.\d+\.revealed$/);
      if (sm && t.objectives?.[Number(sm[1])]) t.objectives[Number(sm[1])].revealed = true;
      return on ? "on" : "off";
    }, { notify: false });
    if (!at) return;
    const lm = at.match(/^leads\.(\d+)\.revealed$/);
    if (now === "on" && lm) {
      const lead = Store.get(id)?.leads?.[Number(lm[1])];
      if (lead) await offerLead(id, lead.id, { undo: true });
      return;
    }
    const m = at.match(/^rewards\.(\d+)\.revealed$/);
    if (now !== "on" || !m) return;
    const t = Store.get(id);
    const reward = t?.rewards?.[Number(m[1])];
    const actor = reward ? await lootToOpen(t, reward.id) : null;
    if (!actor) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: lz("Treasure") },
      content: `<p>${lz("LetPlayersOpen")} <strong>${esc(actor.name)}</strong>${lz("SoTheyCanTakeWhatS")}</p>`,
    });
    if (ok) await letPlayersOpen(actor.uuid);
  }

  static async #onAdd(event, target) {
    const id = tidOf(target);
    if (!id) return;
    const list = target.dataset.list;
    if (target.dataset.sec) this.state.qedit.add(`${id}:${target.dataset.sec}`);
    await mutateTrackerHere(id, (t) => {
      const tpl = tplFor(t.kind, list);
      const p = this.livePath(id, list, t);
      if (p === null) return undefined;
      const arr = foundry.utils.getProperty(t, p);
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
    const id = tidOf(target);
    if (!id) return;
    const path = target.dataset.path;
    // A row with anything written in it asks first; a blank one just goes.
    const shown = this.trackerFor(target);
    const before = shown ? this.livePath(id, path, shown) : path;
    if (before === null) return;
    const row = foundry.utils.getProperty(shown ?? {}, before);
    const written = ["label", "name", "text", "detail", "effect", "trigger", "skill", "gm"].map((k) => String(row?.[k] ?? "").trim()).find(Boolean);
    if (written || row?.checks?.length) {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: lz("Remove") },
        content: `<p>${lz("Remove")} <strong>${esc(written || lz("ThisRow"))}</strong>${lz("UndoCanBringItBack")}</p>`,
      });
      if (!ok) return;
    }
    await mutateTrackerHere(id, (t) => {
      // Found again by id after the question: the list may have moved while it was open.
      const p = this.livePath(id, path, t);
      if (p === null) return undefined;
      const parts = p.split(".");
      const index = Number(parts.pop());
      foundry.utils.getProperty(t, parts.join("."))?.splice(index, 1);
    }, { notify: false });
  }

  static async #onMove(event, target) {
    const id = tidOf(target);
    if (!id) return;
    const path = target.dataset.path;
    const dir = Number(target.dataset.dir);
    await mutateTrackerHere(id, (t) => {
      const p = this.livePath(id, path, t);
      if (p === null) return undefined;
      const parts = p.split(".");
      const index = Number(parts.pop());
      const arr = foundry.utils.getProperty(t, parts.join("."));
      const to = index + dir;
      if (!arr || to < 0 || to >= arr.length) return;
      [arr[index], arr[to]] = [arr[to], arr[index]];
    }, { notify: false });
  }

  /** Click fills or empties a segment; right-click marks it broken (or empties a broken one). */
  static async #onSeg(event, target) {
    const id = tidOf(target);
    if (!id) return;
    const path = target.dataset.path;
    const right = event.button === 2 || event.type === "contextmenu";
    await mutateTrackerHere(id, (t) => {
      const p = this.livePath(id, path, t);
      if (p === null) return undefined;
      const s = foundry.utils.getProperty(t, p);
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
        window: { title: lz("PostToChat") },
        content: `<p><strong>${esc(t.name)}</strong> ${lz("IsHiddenFromPlayersSoThey")}</p>`,
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
    const id = tidOf(target);
    if (!id) return;
    await mutateTrackerHere(id, (t) => {
      if (t.kind === "influence") t.roundsUsed = num(t.roundsUsed) + 1;
      else t.round = num(t.round) + 1;
      if (t.kind === "infiltration") t.awareness = num(t.awareness) + 1;
    });
  }

  static async #onHalve(event, target) {
    const id = tidOf(target);
    if (!id) return;
    await mutateTrackerHere(id, (t) => {
      const [lo, hi] = bounds(t, "value");
      t.value = clamp(Math.floor(num(t.value) / 2), lo, hi);
    });
  }

  static async #onClearNpc(event, target) {
    const id = tidOf(target);
    if (!id) return;
    await mutateTrackerHere(id, (t) => {
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
      return `<li><strong>${esc(p.label)}</strong> version ${esc(p.version)}${have ? `${lz("LoadedVersion", { version: esc(have.version) })}` : lz("NotLoaded")}</li>`;
    }).join("");
    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: lz("Presets") },
      content: `<p>${lz("ReloadingAPresetPutsItsText")}</p><ul>${rows}</ul>`,
      buttons: [...list.map((p) => ({ action: p.id, label: `${lz("Reload", { label: p.label })}` })), { action: "cancel", label: lz("Cancel"), default: true }],
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
      window: { title: lz("ImportTrackerData") },
      content: `<p>${lz("PickAFileExportedFromCampaign")}</p><input type="file" name="file" accept=".json,application/json">`,
      buttons: [
        { action: "import", label: lz("Import"), icon: "fa-solid fa-upload", callback: (event, button) => button.form?.elements.file?.files?.[0] ?? null },
        { action: "cancel", label: lz("Cancel"), default: true },
      ],
      rejectClose: false,
    });
    if (!(file instanceof File)) return;
    let data;
    try {
      data = JSON.parse(await foundry.utils.readTextFromFile(file));
    } catch (err) {
      return ui.notifications.error(lz("CampaignTrackersIsnTValidJSON", { name: esc(file.name), message: esc(err.message) }));
    }
    if (!Array.isArray(data?.trackers)) return ui.notifications.error(lz("CampaignTrackersDoesnTHoldTracker", { name: esc(file.name) }));
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: lz("ImportTrackerData") },
      content: `<p>${lz("ReplaceEverythingHereTrackersWithThe", { length: Store.data.trackers.length, length2: data.trackers.length })} <strong>${esc(file.name)}</strong>${lz("ValuesRevealsAndNotesAllCome")}</p>`,
    });
    if (!ok) return;
    await Store.replace(data);
    ui.notifications.info(lz("CampaignTrackersImportedTrackersFrom", { length: esc(Store.data.trackers.length), name: esc(file.name) }));
  }

  /** Open the window, on a tab if one is named (see findTab). */
  static open(tab = null) {
    if (!game.user.isGM && !game.settings.get(MOD, "playerAccess")) return ui.notifications.warn(lz("TheGMHasnTOpenedThe"));
    const to = tab == null ? null : findTab(tab);
    if (tab != null && !to) console.warn(`${MOD} | api.open: no tab or tracker called "${tab}"; opening as last left`);
    return theWindow.open((app) => {
      if (!to) return;
      app.state.tab = to.kind;
      if (to.kind === "quest" && to.tid) app.state.quest = to.tid;
      saveUI(app.state);
    });
  }
}


export { openApps, refreshTimer, TYPING, changedTimer, changedSoon, lastShown, trackersChanged, refreshAll, refresh, tidOf, markBusy, mutateHere, mutateTrackerHere, backTo, theWindow, openQuest, onPanelClick, loadUI, saveUI, findTab, TrackersApp };
