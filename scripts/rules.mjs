/**
 * Rules numbers read from the PF2e system at run time: the DC for each level, the DC adjustments, the reputation
 * tiers, and the points each degree of success earns in victory points and in an infiltration. No table is copied
 * here. When one can't be read, the GM is told once (by the kit's reader) and the feature asks the GM for the number.
 */

import { pf2eRules } from "./kit/pf2e-rules.mjs";
import { esc, tipAttr } from "./kit/safe-text.mjs";
import { MOD, lz, num, signed } from "./core.mjs";

const TABLES = ["dcsByLevel", "dcAdjustments", "reputation", "victoryPointDegrees", "infiltrationDegrees"];
let rules = pf2eRules({ module: MOD, title: "PF2e Campaign Trackers", tables: TABLES });

/** Read the tables (once, at ready, on a GM's client). */
const loadRules = () => rules.load();
/** For the node tests: a stand-in with the reader's get(). */
function useRules(r) {
  rules = r;
}
/** A table's value, or null when it couldn't be read. */
function table(name) {
  const r = rules.get(name);
  return r?.ok ? r.value : null;
}
const given = (x) => x !== null && x !== undefined && x !== "" && Number.isFinite(Number(x));

/** The DC for a level, the level held to the table's own range; null when the table couldn't be read. */
function levelDC(level) {
  const rows = table("dcsByLevel");
  if (!rows?.length) return null;
  const levels = rows.map((r) => r.level);
  const l = Math.min(Math.max(Math.round(num(level)), Math.min(...levels)), Math.max(...levels));
  return rows.find((r) => r.level === l)?.dc ?? null;
}

/** The DC adjustments nearest zero, the easier one first: [{ label, adjustment }], none when unread. */
function dcSteps() {
  const rows = table("dcAdjustments");
  if (!rows) return [];
  const easier = rows.filter((r) => r.adjustment < 0).sort((a, b) => b.adjustment - a.adjustment)[0];
  const harder = rows.filter((r) => r.adjustment > 0).sort((a, b) => a.adjustment - b.adjustment)[0];
  return [easier, harder].filter(Boolean).map((r) => ({ label: r.label, adjustment: r.adjustment }));
}
/** Buttons for those steps beside a DC field (each carries data-adj). */
const dcStepButtons = () => dcSteps().map((s) => `<button type="button" data-adj="${s.adjustment}" ${tipAttr(`${s.label}: ${signed(s.adjustment)}`)}>${esc(s.label)}</button>`).join("");

/** The reputation scale: { min, max, tiers } with tiers lowest first, or null when unread. */
function reputationScale() {
  const rows = table("reputation");
  if (!rows?.length) return null;
  const used = new Set();
  const bare = (s) => String(s ?? "").trim().replace(/\.$/, "");
  const tiers = [...rows].reverse().map((r, i) => {
    let id = String(r.label).toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || `tier${i}`;
    if (used.has(id)) id = `${id}-${i}`;
    used.add(id);
    const gm = [bare(r.raisedBy) && `${lz("RaisedBy")} ${bare(r.raisedBy)}.`, bare(r.loweredBy) && `${lz("LoweredBy")} ${bare(r.loweredBy)}.`].filter(Boolean).join(" ");
    return { id, label: r.label, min: r.min, text: "", gm };
  });
  return { min: rows.at(-1).min, max: rows[0].max, tiers };
}

/** What the system gives a degree of success in victory points (accumulating), or null where it gives no plain number. */
function systemPoints(outcome) {
  const v = table("victoryPointDegrees")?.accumulating;
  if (!v || v.missing?.includes(outcome) || v.conditional?.includes(outcome)) return null;
  return v.points?.[outcome] ?? null;
}
/** A tracker's points for a result: the GM's own number when set, else the system's; null when neither gives one. */
function pointsFor(t, outcome) {
  const own = t.degrees?.[outcome];
  return given(own) ? Number(own) : systemPoints(outcome);
}

/** What the system gives a degree of success in an infiltration: { infiltration, awareness }, or null. */
function systemInfiltration(outcome) {
  const v = table("infiltrationDegrees");
  if (!v || v.missing?.includes(outcome) || v.conditional?.includes(outcome)) return null;
  return v.points?.[outcome] ?? null;
}
/** An infiltration's points for a result: { ip, ap }, each the GM's number or the system's, null when neither. */
function infiltrationPointsFor(t, outcome) {
  const own = t.degrees?.[outcome] ?? {};
  const sys = systemInfiltration(outcome);
  return { ip: given(own.ip) ? Number(own.ip) : (sys?.infiltration ?? null), ap: given(own.ap) ? Number(own.ap) : (sys?.awareness ?? null) };
}


export { TABLES, rules, loadRules, useRules, table, given, levelDC, dcSteps, dcStepButtons, reputationScale, systemPoints, pointsFor, systemInfiltration, infiltrationPointsFor };
