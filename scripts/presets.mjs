/** Trackers shipped by other modules as presets: loading them and updating their text without losing play. */

import { esc } from "./kit/safe-text.mjs";
import { MOD, clone, lz, num, tabs } from "./core.mjs";
import { normalize } from "./data.mjs";
import { Store, mutate } from "./store.mjs";

/* ------------------------------------------------------------------ */
/* Presets                                                             */
/* ------------------------------------------------------------------ */

const presets = new Map();
let storeReady = false;
function setStoreReady(v) {
  storeReady = v;
}

/** Fields that belong to play, kept when a preset's text is updated. */
const STATE_KEYS = new Set(["value", "revealed", "round", "current", "awareness", "edge", "roundsUsed", "progress", "byActor", "done", "state", "earned", "reminded", "showValue", "showBand", "showAwareness", "showLabels", "npc", "successes", "failures", "used", "log", "showCount", "adhoc", "status", "have", "pnotes", "doneBy", "focus", "showDue", "revealedAt", "followed", "followedBy"]);
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
  if (!storeReady || Store.broken || !(await tabs.leadNow())) return;
  for (const preset of presets.values()) {
    if (only && preset.id !== only) continue;
    const have = Store.data.presets?.[preset.id];
    if (have && have.version === preset.version && !force) continue;
    const { added, updated } = (await mutate((d) => mergePreset(d, preset), { notify: false })) ?? {};
    const what = [added && lz("PresetAdded", { n: added }), updated && lz("PresetUpdatedN", { n: updated })].filter(Boolean).join(", ");
    ui.notifications.info(lz(have ? "PresetUpdated" : "PresetLoaded", { label: esc(preset.label), what: what || lz("PresetNoTrackers") }));
  }
}

/** Another module registers campaign content: { id, label, version, trackers: [...] }. */
function registerPreset(preset) {
  if (!preset?.id || !Array.isArray(preset.trackers)) throw new Error(`${MOD} | a preset needs an id and a trackers list`);
  presets.set(preset.id, { label: preset.id, version: "1", ...preset });
  if (storeReady) syncPresets({ only: preset.id });
}


export { presets, storeReady, setStoreReady, STATE_KEYS, KEEP_IF_EMPTY, isEmptyVal, keepState, fromPreset, mergePreset, syncPresets, registerPreset };
