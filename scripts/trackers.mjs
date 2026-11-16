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
 *
 * This file is the entry: settings, hooks and the API. The rest lives in the files it imports.
 */

import { esc } from "./kit/safe-text.mjs";
import { TrackersApp, openApps, openQuest, refresh } from "./app.mjs";
import { dkey, fmtDate, parseDate, scheduleReminders, today } from "./calendar.mjs";
import { applyArgs, applyCard, onRenderMessage, proposalOf, proposeDialog, rerollKey, rerollStash } from "./chat.mjs";
import { HIDE_DC, parseTag } from "./checks.mjs";
import { MOD, SCOPE, clone, lz, num, tabs } from "./core.mjs";
import { QSTATUS_LABEL, bounds, clamp } from "./data.mjs";
import { onFoldToggle } from "./html.mjs";
import { QUEST_LINK, REVEAL_LINK, enrichQuestLink, enrichRevealLink, onQuestLink, onRevealDragLeave, onRevealDragOver, onRevealDrop, onRevealLink, repaintQuestLinks, revealFromLink, revealLinkText } from "./links.mjs";
import { markSeen, noteLogin, questNotices, questsOf, setLastQuests, unseen, waitingQuests } from "./notices.mjs";
import { placePanel, pruneKept, questReadOnly, questsOpen, renderPanel } from "./panel.mjs";
import { registerPreset, setStoreReady, storeReady, syncPresets } from "./presets.mjs";
import { loadRules } from "./rules.mjs";
import { SOCKET, onSocket } from "./socket.mjs";
import { Store, mutateTracker, project, publish, since, visibleTrackers } from "./store.mjs";

/* ------------------------------------------------------------------ */
/* Registration                                                       */
/* ------------------------------------------------------------------ */

Hooks.once("init", () => {
  CONFIG.TextEditor.enrichers.push({ pattern: QUEST_LINK, enricher: async (match) => enrichQuestLink(match) });
  CONFIG.TextEditor.enrichers.push({ pattern: REVEAL_LINK, enricher: async (match, options) => enrichRevealLink(match, options) });
  // One capture-phase click listener for both kinds of link; each returns at once for anything else.
  document.addEventListener("click", (ev) => {
    onQuestLink(ev);
    onRevealLink(ev);
  }, true);
  document.addEventListener("toggle", onFoldToggle, true);
  document.addEventListener("dragover", onRevealDragOver, true);
  document.addEventListener("dragleave", onRevealDragLeave, true);
  document.addEventListener("drop", onRevealDrop, true);
  game.settings.register(MOD, "public", { scope: "world", config: false, type: Object, default: { trackers: [] }, onChange: (v) => {
    questNotices(v);
    refresh({ data: true });
  } });
  game.settings.register(MOD, "playerTicks", {
    name: "PCT.PlayersCanTickObjectivesFollowLeads",
    hint: "PCT.OnRevealedQuestsPlayersMarkObjectives",
    scope: "world", config: true, type: Boolean, default: true, onChange: () => refresh(),
  });
  game.settings.register(MOD, "partyQuests", {
    name: "PCT.PlayersCanMakeQuests",
    hint: "PCT.PlayersMakeQuestsOfTheirOwn",
    scope: "world", config: true, type: Boolean, default: true, onChange: () => refresh(),
  });
  game.settings.register(MOD, "questPanel", {
    name: "PCT.ShowTheQuestPanel",
    hint: "PCT.ASmallPanelWithTheParty",
    scope: "client", config: true, type: Boolean, default: true, onChange: () => {
      renderPanel();
      refresh();
    },
  });
  game.settings.register(MOD, "questSound", {
    name: "PCT.QuestNoticeSound",
    hint: "PCT.ASoundPlayersHearWithThe",
    scope: "world", config: true, type: String, default: "", filePicker: "audio",
  });
  game.settings.register(MOD, "reminders", {
    name: "PCT.DateReminders",
    hint: "PCT.WhisperTheGMWhenTheCalendar",
    scope: "world", config: true, type: Boolean, default: true,
  });
  game.settings.register(MOD, "playerAccess", {
    name: "PCT.PlayersCanOpenTheTrackers",
    hint: "PCT.PlayersSeeOnlyWhatYouVe",
    scope: "world", config: true, type: Boolean, default: true, onChange: () => refresh(),
  });
  game.keybindings.register(MOD, "open", {
    name: "PCT.OpenCampaignTrackers",
    hint: "PCT.OpensTheTrackersWindowOrBrings",
    editable: [{ key: "KeyT", modifiers: ["Alt"] }],
    onDown: () => {
      Promise.resolve(TrackersApp.open()).then((app) => app?.focusWindow?.());
      return true;
    },
  });
});

Hooks.once("ready", () => {
  // The rules numbers (DCs, reputation tiers, points per result) are read from the PF2e system on the GM's client.
  if (game.user.isGM) loadRules().then(() => refresh());
  game.socket.on(SOCKET, onSocket);
  tabs.start();
  // Players start from what is already shared, so only later changes bring notices.
  if (!game.user.isGM) setLastQuests(questsOf(game.settings.get(MOD, "public")));
  // F4: when this GM logs in, for "since last session".
  if (game.user.isGM) noteLogin();
  // F3: what changed while this player was away, in one notice (the quest panel's header keeps the count). After
  // every module's ready, so the Campaign Journal can say it tells them itself (its api.tellsTrackerQuests).
  if (!game.user.isGM) setTimeout(() => {
    const n = waitingQuests();
    if (!n || game.modules.get("bayards-campaign-journal")?.api?.tellsTrackerQuests) return;
    ui.notifications.info(n === 1 ? lz("CampaignTrackersAQuestIsNew") : `${lz("CampaignTrackersQuestsAreNewOr", { n: n })}`);
  }, 1500);
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
    /** How many quests are New or Updated for this player (0 for a GM). */
    waitingQuests: () => waitingQuests(),
    /**
     * GM only: what the party learned and did since a time (ms since 1970, or a Date): quests and rows revealed, goals
     * done or failed, leads followed, status changes, as [{ at, tid, quest, what, text }], oldest first.
     */
    since: (time) => (game.user.isGM ? since(time instanceof Date ? time.getTime() : time) : []),
    quests: () => (questsOpen() ? visibleTrackers() : []).filter((t) => t.kind === "quest").map((t) => {
      const main = (t.objectives ?? []).filter((o) => !o.optional);
      const shown = game.user.isGM ? (project(t, { all: Store.data.trackers })?.objectives ?? []).filter((o) => !o.optional) : main;
      return {
        shownDone: shown.filter((o) => o.state === "done").length, shownTotal: shown.length,
        id: t.id, name: t.name, status: t.status, statusLabel: QSTATUS_LABEL[t.status] ?? lz("Active"), category: t.category ?? "",
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
    /**
     * Change a field by an amount, e.g. adjust("my-heat", "value", 1). For a player it reaches only a party quest they
     * may edit, through the same checks as the window.
     */
    adjust: (id, path, delta) => mutateTracker(id, (t) => {
      const [lo, hi] = bounds(t, path);
      foundry.utils.setProperty(t, path, clamp(num(foundry.utils.getProperty(t, path)) + Number(delta), lo, hi));
    }),
    /** Set a field, e.g. set("my-clock", "segments.2.state", "filled"). For a player, as adjust. */
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
      if (!j || !game.user.isGM) return ui.notifications.warn(lz("CampaignTrackersNoSuchJournalEntry"));
      await j.setFlag(SCOPE, "allowDelete", true);
      ui.notifications.info(lz("CampaignTrackersCanBeDeletedNow", { name: esc(j.name) }));
    },
  };
  game.modules.get(MOD).api = api;
  if (game.user.isGM) {
    await Store.ensure();
    Store.load();
    setStoreReady(true);
    // Links drawn before the data loaded (chat at startup) said so; draw them again.
    repaintQuestLinks();
    // Chat drew its messages before the data was loaded, so Apply boxes and the controls on proposal, check,
    // completion and follow cards are missing: draw them again.
    for (const m of game.messages.contents.slice(-100)) {
      const f = m.flags?.[SCOPE];
      if (f?.proposal || f?.adhoc || f?.qprompt || f?.qfollow || parseTag(m.flags?.pf2e?.context?.options)) ui.chat.updateMessage(m);
    }
    if (storeReady && !Store.broken) pruneKept(new Set(Store.data.trackers.map((t) => t.id)));
    Hooks.callAll(`${MOD}.ready`, api);
    // The lead tab brings the players' copy up to date and loads presets. The election takes a moment to settle,
    // so the rest of startup doesn't wait for it.
    (async () => {
      if (!Store.broken && (await tabs.leadNow())) await publish(Store.data);
      await syncPresets();
      scheduleReminders();
    })().catch((err) => console.error(`${MOD} | startup`, err));
  } else {
    const pub = game.settings.get(MOD, "public");
    // A player sees only what's revealed: prune only their marks, not their pins and folds.
    if (Array.isArray(pub?.trackers)) pruneKept(new Set(pub.trackers.map((t) => t.id)), { all: false });
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
  refresh({ data: true });
});
/** The data journal can't be deleted by accident: it needs the allowDelete flag (api.unlockStore). */
Hooks.on("preDeleteJournalEntry", (doc) => {
  if (!doc.getFlag(SCOPE, "store") || doc.getFlag(SCOPE, "allowDelete")) return;
  ui.notifications.warn(lz("CampaignTrackersHoldsYourTrackerData", { name: esc(doc.name), MOD: esc(MOD), id: esc(doc.id) }));
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
Hooks.on("createChatMessage", async (message) => {
  if (!message.flags?.pf2e?.context?.isReroll || !(await tabs.leadNow())) return;
  const key = rerollKey(message);
  const hit = key ? rerollStash.get(key) : null;
  if (!hit) return;
  message.setFlag(SCOPE, "rerolled", { text: hit.text, changes: hit.changes }).finally(() => rerollStash.delete(key));
});
/**
 * A roll from a GM's check card ticks that character off on the card, and a roll from an approved
 * proposal marks the proposal rolled. The active GM's client does it, since it can change anyone's message.
 */
Hooks.on("createChatMessage", async (message) => {
  if (!parseTag(message.flags?.pf2e?.context?.options) || !(await tabs.leadNow())) return;
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
  // F8: a check the GM called with "Apply these as they are rolled": a character the GM called, the first roll each,
  // at the check's DC. Anything else waits for the GM's Apply.
  const t = Store.get(tag.tid);
  const row = t?.adhoc?.find((r) => r.id === tag.target);
  const called = (row?.actors?.length ? row.actors : ad?.actors ?? []).includes(ctx.actor);
  const first = !autoApplied.has(`${tag.target}:${ctx.actor}`) && !ad?.rolled?.[ctx.actor];
  const atDC = row?.dc === null || row?.dc === undefined || Number(ctx.dc?.value) === Number(row.dc);
  if (ctx.outcome && row?.auto && called && first && atDC) {
    autoApplied.add(`${tag.target}:${ctx.actor}`);
    await applyCard(message, t.id, applyArgs(message, t, tag));
  }
  // F9: a card left for the GM shows in the waiting count once the lead tab's moment to apply it has passed.
  if (row?.auto) setTimeout(() => refresh(), 15500);
});
/** Checks applied as they're rolled, by row and character, on this tab: a character's second roll waits for Apply. */
const autoApplied = new Set();
/** F9: the GM's window counts the roll cards waiting for Apply. */
Hooks.on("createChatMessage", (message) => {
  if (game.user.isGM && parseTag(message.flags?.pf2e?.context?.options)) refresh();
});
Hooks.on("deleteChatMessage", (message) => {
  if (game.user.isGM && parseTag(message.flags?.pf2e?.context?.options)) refresh();
});
Hooks.on("updateActor", (actor, changes) => {
  if (changes.name === undefined && changes.prototypeToken?.name === undefined) return;
  if (actor.type === "character" && (openApps.size || document.getElementById("pct-qpanel"))) refresh();
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
    onChange: () => Promise.resolve(TrackersApp.open()).then((app) => app?.focusWindow?.()),
  };
});
