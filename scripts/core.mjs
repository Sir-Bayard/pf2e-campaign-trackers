/** Names, kinds and small helpers every other file uses, and the module's tab election and browser storage. */

import { gmTabs } from "./kit/gm-tabs.mjs";
import { esc } from "./kit/safe-text.mjs";
import { storage } from "./kit/storage.mjs";

const MOD = "pf2e-campaign-trackers";
/**
 * Display text from lang/<language>.json: lz("Key"), or lz("Key", { name }) with {name} in the text. Values aren't
 * escaped: escape what goes into HTML. Before Foundry's translations load it gives the key back.
 */
const lz = (key, data) => {
  const i18n = globalThis.game?.i18n;
  const k = `PCT.${key}`;
  if (!i18n?.translations || !Object.keys(i18n.translations).length) return k;
  return data ? i18n.format(k, data) : i18n.localize(k);
};
/** Where the kit draws the keyboard focus outline: the window, its dialogs and the quest panel. */
const FOCUS_SCOPE = ".pct-app, .pct-qpanel, .pct-dialog";
/** Flag scope for the data journal and chat cards. */
const SCOPE = MOD;

const KINDS = ["quest", "reputation", "pressure", "points", "challenge", "influence", "research", "chase", "infiltration", "clock", "checklist"];
const KIND_INFO = {
  quest: { get label() {
    return lz("Quest");
  }, get tab() {
    return lz("Quests");
  }, icon: "fa-solid fa-scroll", get blurb() {
    return lz("ThePartySQuestsAndLeads");
  } },
  reputation: { get label() {
    return lz("Reputation");
  }, get tab() {
    return lz("Reputation");
  }, icon: "fa-solid fa-scale-balanced", get blurb() {
    return lz("HowAGroupRegardsTheParty");
  } },
  pressure: { get label() {
    return lz("PressureTrack");
  }, get tab() {
    return lz("Pressure");
  }, icon: "fa-solid fa-gauge-high", get blurb() {
    return lz("SomethingBuildingAgainstThePartyIn");
  } },
  points: { get label() {
    return lz("VictoryPoints");
  }, get tab() {
    return lz("VictoryPoints");
  }, icon: "fa-solid fa-flag-checkered", get blurb() {
    return lz("ProgressThePartyEarnsWithChecks");
  } },
  challenge: { get label() {
    return lz("SkillChallenge");
  }, get tab() {
    return lz("SkillChallenges");
  }, icon: "fa-solid fa-route", get blurb() {
    return lz("AGoalThePartyReachesWith");
  } },
  influence: { get label() {
    return lz("Influence");
  }, get tab() {
    return lz("Influence");
  }, icon: "fa-solid fa-comments", get blurb() {
    return lz("WinningSomeoneOverAcrossAFew");
  } },
  research: { get label() {
    return lz("Research");
  }, get tab() {
    return lz("Research");
  }, icon: "fa-solid fa-book-open", get blurb() {
    return lz("DiggingThroughALibraryOrArchive");
  } },
  chase: { get label() {
    return lz("Chase");
  }, get tab() {
    return lz("Chases");
  }, icon: "fa-solid fa-person-running", get blurb() {
    return lz("APursuitThroughARunOf");
  } },
  infiltration: { get label() {
    return lz("Infiltration");
  }, get tab() {
    return lz("Infiltration");
  }, icon: "fa-solid fa-mask", get blurb() {
    return lz("GettingInOrOutBeforeAnyone");
  } },
  clock: { get label() {
    return lz("Clock");
  }, get tab() {
    return lz("Clocks");
  }, icon: "fa-solid fa-clock", get blurb() {
    return lz("ASegmentedClockDatesOnSegments");
  } },
  checklist: { get label() {
    return lz("Checklist");
  }, get tab() {
    return lz("Checklists");
  }, icon: "fa-solid fa-list-check", get blurb() {
    return lz("NamedEntriesToTickOffWith");
  } },
};

const DEGREES = ["criticalSuccess", "success", "failure", "criticalFailure"];
const DEGREE_LABEL = { get criticalSuccess() {
    return lz("CriticalSuccess");
  }, get success() {
    return lz("Success");
  }, get failure() {
    return lz("Failure");
  }, get criticalFailure() {
    return lz("CriticalFailure");
  } };
/** What each result adds to a skill challenge: s successes and f failures. */
const CDEG = () => ({ criticalSuccess: { s: 2, f: 0 }, success: { s: 1, f: 0 }, failure: { s: 0, f: 1 }, criticalFailure: { s: 0, f: 1 } });

/** Plain text with line breaks kept. */
const para = (s) => esc(s).replace(/\n/g, "<br>");
const uid = () => foundry.utils.randomID(10).toLowerCase();
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const num = (v, d = 0) => (Number.isFinite(Number(v)) && v !== "" && v !== null ? Number(v) : d);
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
/* Foundry's active GM is a user, not a browser tab: of the active GM's tabs, the kit's election picks one to do the
 * GM's work (answering players, publishing the players' copy, reminders). */
// Work on events (a player's request, a roll to mark) must not be dropped when a lead tab went without a goodbye.
const tabs = gmTabs(MOD, { fresh: 0 });
/** What this browser keeps for the module (marks, folds, pins, the window), per world and per user. */
const local = storage(MOD);
/** The key a value had when it was kept for the whole browser; read once while this world and user have none. */
const oldKey = (what) => `${MOD}.${what}`;


export { MOD, lz, FOCUS_SCOPE, SCOPE, KINDS, KIND_INFO, DEGREES, DEGREE_LABEL, CDEG, para, uid, clone, num, signed, tabs, local, oldKey };
