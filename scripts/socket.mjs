/** Players' requests to the GM's lead tab (ticks, notes, follows, filing, party quests) and the GM's answers. */

import { esc } from "./kit/safe-text.mjs";
import { openQuest } from "./app.mjs";
import { promptCompletion, promptFollow } from "./chat.mjs";
import { MOD, clone, lz, tabs, uid } from "./core.mjs";
import { NOTE_MAX, PARTY_PER_PLAYER, PARTY_QUEST_SIZE, QSTATUS_LABEL, applyClueSort, applyLeadFollow, applyPartyChanges, applyQuestNote, applyQuestTick, blank, findGoal, findRow, partyValue, same } from "./data.mjs";
import { pcName } from "./html.mjs";
import { storeReady } from "./presets.mjs";
import { Store, mutate, mutateTracker, partyTicks, visibleTrackers } from "./store.mjs";

const SOCKET = `module.${MOD}`;
/** The drag data type of a clue dragged within the window. */
const CLUE_DRAG = "application/x-pct-clue";

/**
 * A player's request to the active GM (ticks, Party Journal entries, party quests). False when no GM is logged in.
 */
/** Requests waiting for the GM's tab to answer, by id, each with its timer. */
const pendingReq = new Map();
function sendToGM(msg) {
  if (!game.users.activeGM) {
    ui.notifications.warn(lz("AGMNeedsToBeLogged"));
    return false;
  }
  const req = uid();
  pendingReq.set(req, setTimeout(() => {
    pendingReq.delete(req);
    ui.notifications.warn(lz("TheGMSClientDidnT"));
  }, 15000));
  game.socket.emit(SOCKET, { ...msg, userId: game.user.id, req });
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
/**
 * A player's change through the GM's lead tab. When the save finds newer data (another GM tab saved first) this tab
 * reloads and the change is tried once more on what's there now.
 */
async function playerChange(tid, fn) {
  const done = await mutateTracker(tid, fn, { notify: false });
  return done === undefined && Store.conflict ? mutateTracker(tid, fn, { notify: false }) : done;
}

/**
 * Whether players are shown this row of this quest. A request about a row they aren't shown gets the same answer as
 * one about a row that doesn't exist, so a guessed id tells a player nothing.
 */
function shownToPlayers(tid, rowId) {
  const q = (game.settings.get(MOD, "public")?.trackers ?? []).find((t) => t.id === tid);
  return !!q && !!findRow(q, rowId);
}

async function onSocket(msg, senderId) {
  if (!msg?.type) return;
  if (tabs.handle(msg, senderId)) return;
  const sender = game.users.get(senderId);
  // The active GM's client answers a player: a request it couldn't record, or the quest it made for them.
  if (msg.type === "qack") {
    if (!sender?.isGM || msg.to !== game.user.id) return;
    clearTimeout(pendingReq.get(msg.req));
    pendingReq.delete(msg.req);
    return;
  }
  if (msg.type === "qfail" || msg.type === "qmade") {
    if (!sender?.isGM || sender.id !== game.users.activeGM?.id || msg.to !== game.user.id) return;
    if (msg.type === "qfail") ui.notifications.warn(String(msg.text ?? lz("ThatDidnTGoThrough")));
    else openQuestWhenShared(msg.tid);
    return;
  }
  if (!(await tabs.leadNow())) return;
  const user = sender;
  if (!user || user.isGM || (msg.userId && msg.userId !== user.id)) return;
  const fail = (text) => game.socket.emit(SOCKET, { type: "qfail", to: user.id, text });
  if (!["qtick", "qfollow", "qsort", "qnote", "qnoteDel", "qnew", "qedit", "qdel"].includes(msg.type)) return;
  // TR18: answered, whatever happened, so the player's timer stops.
  try {
    await answerRequest(msg, user, fail);
  } finally {
    if (msg.req) game.socket.emit(SOCKET, { type: "qack", to: user.id, req: String(msg.req) });
  }
}

/** A player's request, on the active GM's lead tab. */
async function answerRequest(msg, user, fail) {
  if (!storeReady || Store.broken) return fail(lz("TheGMSTrackersArenT"));
  if (!game.settings.get(MOD, "playerAccess")) return;
  const who = user.character ? pcName(user.character) : user.name;
  if (["qnew", "qedit", "qdel"].includes(msg.type)) return partyRequest(msg, user, who, fail);
  if (["qtick", "qfollow", "qsort"].includes(msg.type)) {
    // Ticks, follows and filing are quick to click; a flood isn't.
    const now = Date.now();
    const recent = (markRate.get(user.id) ?? []).filter((at) => now - at < 5000);
    if (recent.length >= 20) return fail(lz("ThatSALotOfChanges"));
    markRate.set(user.id, [...recent, now]);
  }
  if (msg.type === "qtick") {
    const party = partyTicks(Store.get(msg.tid));
    if (!game.settings.get(MOD, "playerTicks") && !party) return;
    if (!applyQuestTick(clone(Store.get(msg.tid)), msg.goal, msg.to, user.id)) {
      const cur = Store.get(msg.tid);
      if (!cur || !shownToPlayers(msg.tid, msg.goal) || findGoal(cur, msg.goal)?.g.state !== msg.to) fail(lz("ThatTickDidnTGoThrough"));
      return;
    }
    const done = await playerChange(msg.tid, (t) => applyQuestTick(t, msg.goal, msg.to, user.id) || undefined);
    if (done && msg.to === "done" && !party) await promptCompletion(Store.get(msg.tid), msg.goal, { who });
    else if (!done) {
      const cur = Store.get(msg.tid);
      if (!cur || findGoal(cur, msg.goal)?.g.state !== msg.to) fail(lz("ThatTickDidnTGoThrough"));
    }
  } else if (msg.type === "qfollow") {
    const party = partyTicks(Store.get(msg.tid));
    if (!game.settings.get(MOD, "playerTicks") && !party) return;
    const leadNow = () => (Store.get(msg.tid)?.leads ?? []).find((x) => x.id === msg.lead);
    if (!applyLeadFollow(clone(Store.get(msg.tid)), msg.lead, msg.to, user.id)) {
      if (!leadNow() || !shownToPlayers(msg.tid, msg.lead) || leadNow().followed !== (msg.to === "done")) fail(lz("ThatDidnTGoThroughIt"));
      return;
    }
    const done = await playerChange(msg.tid, (t) => applyLeadFollow(t, msg.lead, msg.to, user.id) || undefined);
    if (done && msg.to === "done" && !party) await promptFollow(Store.get(msg.tid), msg.lead, who);
    else if (!done) {
      const l = (Store.get(msg.tid)?.leads ?? []).find((x) => x.id === msg.lead);
      if (!l || l.followed !== (msg.to === "done")) fail(lz("ThatDidnTGoThroughIt"));
    }
  } else if (msg.type === "qsort") {
    const party = partyTicks(Store.get(msg.tid));
    if (!game.settings.get(MOD, "playerTicks") && !party) return;
    const under = typeof msg.under === "string" ? msg.under : "";
    if (!applyClueSort(clone(Store.get(msg.tid)), msg.clue, under)) {
      const e = (Store.get(msg.tid)?.entries ?? []).find((x) => x.id === msg.clue);
      if (!e || !shownToPlayers(msg.tid, msg.clue) || (e.under ?? "") !== under) fail(lz("ThatDidnTGoThroughIt"));
      return;
    }
    const done = await playerChange(msg.tid, (t) => applyClueSort(t, msg.clue, under) || undefined);
    if (!done) {
      const e = (Store.get(msg.tid)?.entries ?? []).find((x) => x.id === msg.clue);
      if (!e || (e.under ?? "") !== under) fail(lz("ThatDidnTGoThroughIt"));
    }
  } else if (msg.type === "qnote") {
    const now = Date.now();
    if (now - (lastNoteAt.get(user.id) ?? 0) < 2000) return fail(lz("OneEntryAtATimePlease"));
    lastNoteAt.set(user.id, now);
    const t = Store.get(msg.tid);
    if ((t?.pnotes?.length ?? 0) >= NOTE_MAX) return fail(`${lz("ThePartyJournalOfHasEntries", { name: esc(t.name), NOTEMAX: NOTE_MAX })}`);
    const added = await playerChange(msg.tid, (tr) => applyQuestNote(tr, "add", { by: user.id, name: who, text: msg.text }) || undefined);
    if (!added) fail(lz("YourEntryDidnTGoThrough"));
  } else if (msg.type === "qnoteDel") {
    await playerChange(msg.tid, (t) => applyQuestNote(t, "delete", { id: msg.note, by: user.id }) || undefined);
  }
}

/** The GM's client: a player makes, edits or deletes a party quest. */
async function partyRequest(msg, user, who, fail) {
  if (!game.settings.get(MOD, "partyQuests")) return fail(lz("TheGMHasTurnedOffQuests"));
  // A burst of edits is fine; a flood isn't.
  const now = Date.now();
  const recent = (partyRate.get(user.id) ?? []).filter((t) => now - t < 5000);
  if (recent.length >= 30) return fail(lz("ThatSALotOfChanges"));
  partyRate.set(user.id, [...recent, now]);
  if (msg.type === "qnew") {
    const party = Store.data.trackers.filter((t) => t.kind === "quest" && t.party);
    if (party.length >= 100) return fail(lz("ThereAreAlready100PartyQuests"));
    if (party.filter((t) => t.party.by === user.id).length >= PARTY_PER_PLAYER) return fail(`${lz("YouVeMadePartyQuestsThe", { PARTYPERPLAYER: PARTY_PER_PLAYER })}`);
    const t = { ...blank("quest", partyValue("name", msg.name)), revealed: true, category: "", desc: partyValue("desc", msg.desc), party: { by: user.id, name: who } };
    const made = await mutate((d) => {
      d.trackers.push(t);
      return true;
    }, { notify: false });
    if (made) game.socket.emit(SOCKET, { type: "qmade", to: user.id, tid: t.id });
    else fail(lz("TheQuestWasnTMadeTry"));
  } else if (msg.type === "qedit") {
    const cur = Store.get(msg.tid);
    if (!cur?.party || !cur.revealed) return fail(lz("OnlyQuestsMadeByPlayersCan"));
    // Try it on a copy first: nothing to save when nothing changed, and no edit may make a quest too long.
    const test = clone(cur);
    try {
      applyPartyChanges(test, msg.changes);
    } catch (err) {
      console.warn(`${MOD} | a party quest edit couldn't be read`, err);
      return fail(lz("YourChangeCouldnTBeRead"));
    }
    if (same(test, cur)) return;
    const size = JSON.stringify(test).length;
    if (size > PARTY_QUEST_SIZE && size > JSON.stringify(cur).length) return fail(`${lz("ThatWouldMakeTooLongShorten", { name: esc(cur.name) })}`);
    const done = await mutateTracker(msg.tid, (t) => applyPartyChanges(t, msg.changes) || undefined, { notify: false });
    if (!done) fail(lz("YourChangeDidnTGoThrough"));
  } else if (msg.type === "qdel") {
    const t = Store.get(msg.tid);
    if (!t?.party || !t.revealed || t.party.by !== user.id) return fail(lz("OnlyThePlayerWhoMadeA"));
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
  const parts = [QSTATUS_LABEL[t.status] ?? lz("Active")];
  if (t.category) parts.push(t.category);
  if (main.length) parts.push(`${lz("OfObjectives", { done: done, length: main.length })}`);
  return parts.join(", ");
}


export { SOCKET, CLUE_DRAG, pendingReq, sendToGM, lastNoteAt, partyRate, markRate, playerChange, shownToPlayers, onSocket, answerRequest, partyRequest, openQuestWhenShared, questSummary };
