/** The GM's data in its journal entry: loading, saving with a revision check, and the copy players are sent. */

import { esc } from "./kit/safe-text.mjs";
import { refresh } from "./app.mjs";
import { diffTracker, promptCompletion, undoChanges, whisperGM } from "./chat.mjs";
import { MOD, SCOPE, clone, lz, num, para, signed, tabs, uid } from "./core.mjs";
import { QSTATUS_LABEL, challengeStatus, currentTier, findRow, infiltrationIP, infiltrationProgress, linkTriggers, normalize, nullNum, partyChanges, reached, rowShown, tierLadder } from "./data.mjs";
import { partyMembers } from "./html.mjs";
import { sendToGM } from "./socket.mjs";

/* ------------------------------------------------------------------ */
/* Storage                                                            */
/* ------------------------------------------------------------------ */

/**
 * The full data, GM only, is a JSON string in a flag on a journal entry nobody else can see.
 * Players read the "public" world setting, which holds only what has been revealed.
 */
const Store = {
  data: { v: 1, rev: 0, trackers: [], presets: {}, calendar: null },
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
      ui.notifications.warn(lz("DuplicateStores", { n: all.length, names: all.map((j) => `"${esc(j.name)}"`).join(", ") }));
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
      ui.notifications.error(lz("CampaignTrackersTheStoredDataCouldn"));
    }
    const wasImport = this.data.imported;
    this.data = { v: 1, rev: 0, trackers: [], presets: {}, ...(data ?? {}) };
    this.data.trackers = (this.data.trackers ?? []).map(normalize);
    this.rev = num(this.data.rev, 0);
    // Another tab imported a whole store: Undo can't reach across it here either.
    if (wasImport !== this.data.imported) history.length = 0;
  },

  /** Make sure there is a data journal: find it, or, as the active GM, create it with the current data. Never makes a second one. */
  async ensure() {
    this.journal = this.find();
    if (this.journal || !(await tabs.leadNow())) return;
    // Another GM may have made it while this tab waited for the election.
    this.journal = this.find();
    if (this.journal) return;
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
    this.conflict = false;
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
            this.conflict = true;
            this.load();
            refresh({ data: true });
            ui.notifications.warn(lz("CampaignTrackersAnotherWindowSavedNewer"));
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
          ui.notifications.error(lz("CampaignTrackersCouldnTSaveThe", { message: esc(err.message) }));
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
    this.data = { v: 1, rev: 0, trackers: [], presets: {}, ...data, imported: uid() };
    this.data.trackers = (this.data.trackers ?? []).map(normalize);
    this.broken = null;
    // Undo can't reach across a whole new store.
    history.length = 0;
    this.rev = this.storedRev() ?? 0;
    await this.save();
    refresh({ data: true });
  },
};

/**
 * Change the data (GM only). fn gets a copy to change and may return a value, which comes back only when the change
 * was saved (undefined otherwise). What notices() finds is whispered to the GM, and goals whose linked tracker just
 * got there get a completion card.
 */
/** F1: the last changes the GM made in the window or the quest panel on this client, newest last, for Undo (in memory
 * only). Players' requests, roll cards (they have their own Undo), reminders, presets and links aren't kept. */
const history = [];
const HISTORY = 20;

/** What a saved change did, tracker by tracker, kept for Undo. */
function record(before, after) {
  const items = [];
  for (const t of after.trackers) {
    const old = before.trackers.find((x) => x.id === t.id);
    if (!old) items.push({ tid: t.id, name: t.name, added: true });
    else {
      const changes = diffTracker(old, t);
      if (changes.length) items.push({ tid: t.id, name: t.name, changes });
    }
  }
  before.trackers.forEach((t, at) => {
    if (!after.trackers.some((x) => x.id === t.id)) items.push({ tid: t.id, name: t.name, removed: clone(t), at });
  });
  if (!items.length) return;
  const label = items.map((x) => (x.added ? lz("UndoAdded", { name: x.name }) : x.removed ? lz("UndoDeleted", { name: x.name }) : x.name)).join(", ");
  history.push({ at: Date.now(), label, items });
  if (history.length > HISTORY) history.shift();
}

/** The change Undo would take back, or null. */
const lastChange = () => history.at(-1) ?? null;

/**
 * Take back the last change made on this client: numbers by what they moved, other values and rows only where nothing
 * has changed them since, a deleted tracker put back, an added one taken away. Returns the change, or null.
 */
async function undoLast() {
  const entry = history.at(-1);
  if (!entry) return null;
  const ok = await mutate((d) => {
    for (const x of [...entry.items].reverse()) {
      if (x.added) d.trackers = d.trackers.filter((t) => t.id !== x.tid);
      else if (x.removed) {
        if (!d.trackers.some((t) => t.id === x.tid)) d.trackers.splice(Math.min(x.at, d.trackers.length), 0, clone(x.removed));
      } else {
        const t = d.trackers.find((t) => t.id === x.tid);
        if (t) undoChanges(t, x.changes);
      }
    }
    return true;
  }, { notify: false });
  if (!ok) return null;
  history.splice(history.indexOf(entry), 1);
  refresh();
  return entry;
}

async function mutate(fn, { notify = true, undo = false } = {}) {
  if (!game.user.isGM) return;
  if (Store.broken) return void ui.notifications.error(lz("CampaignTrackersTheStoredDataCouldn"));
  const before = clone(Store.data);
  const draft = clone(Store.data);
  const result = fn(draft);
  draft.trackers = draft.trackers.map(normalize);
  stampReveals(before, draft);
  Store.data = draft;
  refresh({ data: true });
  if (notify) {
    const lines = [];
    for (const t of draft.trackers) {
      const old = before.trackers.find((x) => x.id === t.id);
      if (old) lines.push(...notices(old, t));
    }
    if (lines.length) whisperGM(lines, "fa-solid fa-bullhorn");
  }
  const saved = await Store.save();
  // A save that failed without a conflict (a conflict loads the newer data): the data goes back to what is stored.
  if (!saved && !Store.conflict && !Store.broken) {
    if (Store.journal) Store.load();
    else Store.data = before;
    refresh({ data: true });
  }
  if (saved && undo) {
    record(before, draft);
    refresh();
  }
  if (saved) for (const tr of linkTriggers(before, draft)) promptCompletion(Store.get(tr.tid), tr.goal, { why: tr.why });
  return saved ? result : undefined;
}

/**
 * Times on a quest, for the newest clues first and for the GM's "since last session" list (F4): when a quest or any
 * of its rows was revealed (hiding clears it), when a goal was finished (opening it again clears it), when a lead was
 * followed, when the quest's status last changed.
 */
function stampReveals(before, after) {
  const now = Date.now();
  const stamp = (row, was, on, key) => {
    if (!on) row[key] = null;
    else row[key] = was && wasOn(was, key) ? (was[key] ?? null) : now;
  };
  const wasOn = (was, key) => (key === "revealedAt" ? !!was.revealed : key === "doneAt" ? was.state === "done" || was.state === "failed" : !!was.followed);
  for (const t of after.trackers) {
    if (t.kind !== "quest") continue;
    const old = before.trackers.find((x) => x.id === t.id);
    if (!old) continue;
    stamp(t, old, !!t.revealed, "revealedAt");
    t.statusAt = t.status !== old.status ? now : (old.statusAt ?? null);
    const rows = (list, oldList) => (list ?? []).map((r) => [r, (oldList ?? []).find((x) => x.id === r.id)]);
    for (const [e, was] of rows(t.entries, old.entries)) stamp(e, was, !!e.revealed, "revealedAt");
    for (const [r, was] of [...rows(t.leads, old.leads), ...rows(t.rewards, old.rewards)]) stamp(r, was, !!r.revealed, "revealedAt");
    for (const [l, was] of rows(t.leads, old.leads)) stamp(l, was, !!l.followed, "followedAt");
    for (const [o, was] of rows(t.objectives, old.objectives)) {
      for (const [g, w] of [[o, was], ...rows(o.steps, was?.steps)]) {
        stamp(g, w, !!g.revealed, "revealedAt");
        stamp(g, w, g.state === "done" || g.state === "failed", "doneAt");
      }
    }
  }
}

/** A copy or an imported tracker: the times on it belong to the original. */
function stripStamps(t) {
  const walk = (x) => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (!x || typeof x !== "object") return;
    for (const k of ["revealedAt", "statusAt", "doneAt", "followedAt"]) if (k in x) x[k] = null;
    Object.values(x).forEach(walk);
  };
  walk(t);
  return t;
}

/**
 * F4: what the party learned and did since a time (ms), from the stamps above, oldest first: { at, tid, quest, what,
 * text }. `what` is "quest" (revealed), "status", "clue", "objective" (revealed), "done", "failed", "lead" (revealed),
 * "followed" or "reward" (revealed). GM data only.
 */
function since(time) {
  const from = Number(time) || 0;
  const out = [];
  const add = (q, at, what, text) => {
    if (typeof at === "number" && at > from) out.push({ at, tid: q.id, quest: q.name, what, text: String(text ?? "") });
  };
  for (const q of Store.data.trackers) {
    if (q.kind !== "quest" || !q.revealed) continue;
    add(q, q.revealedAt, "quest", q.name);
    add(q, q.statusAt, "status", QSTATUS_LABEL[q.status] ?? q.status);
    for (const e of q.entries ?? []) if (e.revealed) add(q, e.revealedAt, "clue", e.text);
    for (const o of q.objectives ?? []) {
      if (!o.revealed) continue;
      for (const g of [o, ...(o.steps ?? [])]) {
        if (!g.revealed) continue;
        add(q, g.revealedAt, "objective", g.text);
        add(q, g.doneAt, g.state === "failed" ? "failed" : "done", g.text);
      }
    }
    for (const l of q.leads ?? []) {
      if (!l.revealed) continue;
      add(q, l.revealedAt, "lead", l.text);
      add(q, l.followedAt, "followed", l.text);
    }
    for (const r of q.rewards ?? []) if (r.revealed) add(q, r.revealedAt, "reward", r.text);
  }
  return out.sort((a, b) => a.at - b.at);
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
      if (num(from) < num(th.at) && num(to) >= num(th.at)) out.push(`${lz("ReachedAt", { name: `<strong>${n}</strong>`, label, at: th.at })}${th.text ? `: ${para(th.text)}` : "."}`);
    }
  };
  switch (b.kind) {
    case "reputation": {
      const ta = currentTier(a), tb = currentTier(b);
      if (ta?.id !== tb?.id && tb) out.push(`<strong>${n}</strong> ${lz("IsNow", { label: esc(tb.label), value: signed(num(b.value)) })}`);
      break;
    }
    case "pressure": {
      const ta = currentTier(a), tb = currentTier(b);
      const up = num(b.value) > num(a.value);
      if (ta?.id !== tb?.id && tb) out.push(`<strong>${n}</strong> ${up ? lz("HasRisenTo") : lz("HasFallenTo")} ${esc(tb.label)} (${num(b.value)})${up && tb.gm ? `: ${para(tb.gm)}` : "."}`);
      crossed(b.thresholds, a.value, b.value, "");
      break;
    }
    case "points":
    case "influence":
    case "research":
      crossed(b.thresholds, a.value, b.value, b.kind === "influence" ? lz("InfluenceLower") : b.kind === "research" ? lz("ResearchPoints2") : "");
      break;
    case "challenge": {
      for (const th of b.thresholds ?? []) {
        if (num(a.successes) < num(th.at) && num(b.successes) >= num(th.at)) out.push(`${lz(num(th.at) === 1 ? "ReachedSuccess" : "ReachedSuccesses", { name: `<strong>${n}</strong>`, at: th.at })}${th.text ? `: ${para(th.text)}` : "."}`);
      }
      const sa = challengeStatus(a), sb = challengeStatus(b);
      if (sb && sb !== sa) {
        const text = sb === "won" ? b.onSuccess : b.onFailure;
        out.push(`<strong>${n}</strong>: ${sb === "won" ? lz("ThePartySucceeded") : sb === "lost" ? lz("ThePartyFailed") : lz("ThePartyRanOutOfTime")}${text ? `. ${para(text)}` : "."}`);
      }
      break;
    }
    case "infiltration":
      crossed(b.awarenessThresholds, a.awareness, b.awareness, lz("AwarenessLower"));
      break;
    case "chase": {
      const na = num(a.current), nb = num(b.current);
      if (nb > na) {
        for (let i = na; i < nb; i++) out.push(`<strong>${n}</strong>${lz("ThePartyIsPastObstacle", { x: i + 1 })}${b.obstacles[i]?.name ? `, ${esc(b.obstacles[i].name)}` : ""}.`);
        if (nb >= b.obstacles.length) out.push(`<strong>${n}</strong>${lz("ThePartyHasClearedTheLast")}`);
      }
      if (b.quarry?.enabled && nb < b.obstacles.length && nb + 1 >= num(b.quarry.at) && !(na + 1 >= num(a.quarry?.at))) {
        out.push(`<strong>${n}</strong>${lz("PartyCaughtUp", { quarry: esc((b.quarry.label || lz("QuarryWord")).toLowerCase()) })}`);
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
const pubCheck = (c, { hide = false } = {}) => ({ id: c.id, label: c.label, skill: c.skill, dc: c.dc, maxRP: hide ? null : (c.maxRP ?? null), earned: hide ? null : (c.earned ?? 0) });
/** Thresholds as players see them: with the number kept from them, no numbers that bracket it. */
const pubThresholds = (t, hide) => reached(shown(t.thresholds), t.value).map(({ at, text, reached: r }) => ({ at: hide ? null : at, text, reached: r }));

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
      const tier = t.showBand === false ? null : (tierLadder(t).find((x) => x.id === currentTier(t)?.id) ?? null);
      return { ...p, value: t.showValue ? num(t.value) : null, max: t.showValue ? nullNum(t.max) : null, tier: tier?.id ?? null, tiers: tier ? [{ id: tier.id, label: tier.label, range: t.showValue ? tier.range : "", text: tier.text }] : [], thresholds: reached(shown(t.thresholds), t.value).map(({ at, text, reached: r }) => ({ at: t.showValue ? at : null, text, reached: r })) };
    }
    case "points":
      return { ...p, value: t.showValue ? num(t.value) : null, max: t.showValue ? nullNum(t.max) : null, thresholds: reached(shown(t.thresholds), t.value).map(({ at, text, reached: r }) => ({ at: t.showValue ? at : null, text, reached: r })), checks: shown(t.checks).map((c) => pubCheck(c)) };
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
      return { ...p, npc: t.npc ? { name: t.npc.name, img: t.npc.img } : null, value: t.showValue === false ? null : num(t.value), rounds: num(t.rounds), roundsUsed: num(t.roundsUsed), thresholds: pubThresholds(t, t.showValue === false), skills: shown(t.skills).map((c) => pubCheck(c)), discovery: shown(t.discovery).map((c) => pubCheck(c)), resistances: shown(t.resistances).map((x) => x.text), weaknesses: shown(t.weaknesses).map((x) => x.text) };
    case "research":
      return { ...p, value: t.showValue === false ? null : num(t.value), thresholds: pubThresholds(t, t.showValue === false), checks: shown(t.checks).map((c) => pubCheck(c, { hide: t.showValue === false })) };
    case "chase":
      return { ...p, round: num(t.round), current: num(t.current), quarry: t.quarry?.enabled ? { label: String(t.quarry.label ?? "").trim() || lz("Quarry"), at: num(t.quarry.at) } : null, obstacles: t.obstacles.map((o) => (o.revealed ? { id: o.id, name: o.name, points: num(o.points), progress: num(o.progress), checks: o.checks.map((c) => pubCheck(c)) } : { id: o.id, hidden: true })) };
    case "infiltration":
      return { ...p, round: num(t.round), awareness: t.showAwareness ? num(t.awareness) : null, edge: num(t.edge), ip: infiltrationIP(t), objective: num(t.objective), overcome: infiltrationProgress(t, partyMembers(), shown(t.obstacles)), obstacles: shown(t.obstacles).map((o) => ({ id: o.id, name: o.name, type: o.type, points: num(o.points), progress: num(o.progress), byActor: o.byActor, checks: o.checks.map((c) => pubCheck(c)) })), complications: shown(t.complications).map((o) => ({ id: o.id, name: o.name, done: o.done, checks: o.checks.map((c) => pubCheck(c)) })), opportunities: shown(t.opportunities).map((o) => ({ id: o.id, name: o.name, done: o.done, checks: o.checks.map((c) => pubCheck(c)) })) };
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


export { Store, history, HISTORY, record, lastChange, undoLast, mutate, stampReveals, stripStamps, since, mutateTracker, partyQuestsOn, partyTicks, canPartyEdit, ownEdits, partyMutate, notices, shown, pubCheck, pubThresholds, project, publish, visibleTrackers };
