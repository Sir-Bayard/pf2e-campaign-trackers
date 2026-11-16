/** What players are told when quests change, and the New and Updated marks kept in each player's browser. */

import { esc } from "./kit/safe-text.mjs";
import { changedSoon } from "./app.mjs";
import { MOD, local, lz, oldKey } from "./core.mjs";
import { findGoal } from "./data.mjs";
import { sendToGM } from "./socket.mjs";
import { ownEdits, visibleTrackers } from "./store.mjs";

/** A short fingerprint of what players see of a quest, to tell when it changed. */
function questHash(p) {
  const { pnotes, focus, ...rest } = p ?? {};
  const str = JSON.stringify(rest);
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** What each quest looked like when this player last opened it, kept in this browser for this world and user. */
let seenCache = null;
function seenMap() {
  if (seenCache) return seenCache;
  // Not before the world and user are known: there's nowhere to keep it yet. The GM has no marks.
  if (!local.key("seen") || game.user.isGM) return {};
  let v = local.get("seen");
  if (v === undefined) {
    const from = claimOldSeen();
    if (from) v = local.get("seen", undefined, { from });
  }
  seenCache = plainObject(v);
  return seenCache;
}
/**
 * The marks this browser kept before they were kept per world and user were one person's, so only the first player to
 * open a world after that takes them. Returns the old key for that one player, else null.
 */
function claimOldSeen() {
  try {
    const store = globalThis.localStorage;
    const claim = `${oldKey("seen")}.claimed`;
    if (!store || store.getItem(claim) || store.getItem(oldKey("seen")) == null) return null;
    store.setItem(claim, `${game.world.id}.${game.user.id}`);
    return oldKey("seen");
  } catch {
    return null;
  }
}
const plainObject = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
/** "new" for a quest this player has never opened, "updated" if it changed since, else "". */
/** F3: how many quests this player sees are New or Updated. */
function waitingQuests() {
  if (game.user.isGM || !game.settings.get(MOD, "playerAccess")) return 0;
  return visibleTrackers().filter((t) => t.kind === "quest" && unseen(t)).length;
}

/** F4: this GM's logins in this world and browser, newest last (the last twenty). */
function noteLogin() {
  const list = (local.get("logins", []) ?? []).filter((x) => Number.isFinite(x)).slice(-19);
  // A reload in the same evening isn't a new session.
  if (list.length && Date.now() - list.at(-1) < 4 * 3600 * 1000) return;
  local.set("logins", [...list, Date.now()]);
}
/** When this GM's last session began: the latest session start before this one (a start is a login four hours or more
 * after the one before), else a week ago. */
function lastSession() {
  const cut = Date.now() - 4 * 3600 * 1000;
  const list = (local.get("logins", []) ?? []).filter((x) => Number.isFinite(x) && x < cut);
  return list.length ? Math.max(...list) : Date.now() - 7 * 24 * 3600 * 1000;
}

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
  // Without storage the markers come back next time.
  local.set("seen", map);
  return true;
}

/** The quests as players last saw them in the shared copy, to say what changed when it changes. */
let lastQuests = null;
function setLastQuests(v) {
  lastQuests = v;
}
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
      if (!q.party) lines.push(`${lz("NewQuest2", { name: esc(q.name) })}`);
      else if (q.party.by !== game.user.id) lines.push(`${lz("NewQuestFrom")} ${esc(q.party.name || lz("TheParty"))}: ${esc(q.name)}`);
    } else if (old.status !== q.status && (q.status === "completed" || q.status === "failed")) lines.push(lz(q.status === "completed" ? "QuestCompleted" : "QuestFailed", { name: esc(q.name) }));
    else if (old.party && !q.party) lines.push(`${lz("TheGMTookOver", { name: esc(q.name) })}`);
    else if (questHash(old) !== questHash(q) && q.party) {
      // The party edits its own quests a lot: an Updated mark, no notice; nothing at all for this player's own edit.
      const mine = Date.now() - (ownEdits.get(id) ?? 0) < 15000 || onlyOwnTicks(old, q);
      if (mine && seenMap()[id] === questHash(old)) markSeen(q);
      ownTicks.delete(id);
    } else if (questHash(old) !== questHash(q)) {
      if (!onlyOwnTicks(old, q)) lines.push(`${lz("QuestUpdated", { name: esc(q.name) })}`);
      // Their own tick doesn't make the quest new to them either.
      else if (seenMap()[id] === questHash(old)) markSeen(q);
      ownTicks.delete(id);
    }
    if (old && q.focus && !old.focus && ["active", "lead"].includes(q.status)) lines.push(`${lz("PartyFocus2", { name: esc(q.name) })}`);
    if (old) {
      const had = new Set((old.pnotes ?? []).map((x) => x.id));
      const added = (q.pnotes ?? []).filter((x) => !had.has(x.id) && x.by !== game.user.id);
      if (added.length) lines.push(`${esc(added.at(-1).name)} ${lz("WroteInThePartyJournalOf", { name: esc(q.name) })}`);
    }
  }
  if (!lines.length) return;
  for (const l of lines.slice(0, 3)) ui.notifications.info(l);
  if (lines.length > 3) ui.notifications.info(lz("MoreQuestsChanged", { x: esc(lines.length - 3) }));
  const src = game.settings.get(MOD, "questSound");
  if (src) foundry.audio.AudioHelper.play({ src, volume: 0.6, autoplay: true, loop: false }, false);
}


export { questHash, seenCache, seenMap, claimOldSeen, plainObject, waitingQuests, noteLogin, lastSession, unseen, markSeen, lastQuests, setLastQuests, questsOf, ownTicks, tickToGM, sortToGM, followToGM, onlyOwnTicks, questNotices };
