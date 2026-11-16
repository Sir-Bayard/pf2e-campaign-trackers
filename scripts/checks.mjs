/** Rolling a subsystem check through the PF2e system, with the tag that ties the roll to its tracker. */

import { esc } from "./kit/safe-text.mjs";
import { CDEG, DEGREES, DEGREE_LABEL, MOD, lz, num, signed, uid } from "./core.mjs";
import { STATUS_TEXT, bounds, challengeStatus, clamp, findRow, nullNum } from "./data.mjs";
import { infiltrationPointsFor, pointsFor } from "./rules.mjs";

/* ------------------------------------------------------------------ */
/* Checks                                                              */
/* ------------------------------------------------------------------ */

const titleCase = (s) => String(s).replace(/\b\w/g, (c) => c.toUpperCase());

function skillLabel(slug) {
  if (!slug) return lz("Check");
  const s = String(slug).toLowerCase();
  if (s === "perception") return lz("Perception");
  const sk = globalThis.CONFIG?.PF2E?.skills?.[s];
  if (sk) return game.i18n.localize(sk.label ?? sk);
  const sv = globalThis.CONFIG?.PF2E?.saves?.[s];
  if (sv) return game.i18n.localize(sv.label ?? sv);
  if (s.endsWith("-lore")) return `${titleCase(s.slice(0, -5).replace(/-/g, " "))} ${lz("Lore")}`;
  return titleCase(s.replace(/-/g, " "));
}

/** The roll option that ties a roll to a tracker: pf2e-campaign-trackers:<tracker>:<target>:<check>. */
const rollTag = (tid, target, checkId) => `${MOD}:${tid}:${target}:${checkId}`;
/** The tracker id on rolls from proposals made outside a skill challenge. */
const FREE_TID = "~free";
function parseTag(options) {
  const tag = (options ?? []).find((o) => typeof o === "string" && o.startsWith(`${MOD}:`));
  if (!tag) return null;
  const [, tid, target, checkId] = tag.split(":");
  return tid && target ? { tid, target, checkId } : null;
}

/** Who rolls: the selected tokens the user owns, or their assigned character. */
function rollers() {
  const fromTokens = (globalThis.canvas?.tokens?.controlled ?? []).map((t) => t.actor).filter((a) => a?.isOwner);
  if (fromTokens.length) return [...new Set(fromTokens)];
  return game.user.character ? [game.user.character] : [];
}

async function rollCheck({ tid, target, check, title, hideDC = false }) {
  const actors = rollers();
  if (!actors.length) return ui.notifications.warn(game.user.isGM ? lz("SelectTheTokensOfTheCharacters") : lz("SelectYourTokenOrAskThe"));
  for (const actor of actors) await rollAs(actor, { tid, target, check, title, hideDC });
}

/** A roll option on rolls whose DC players must not see, whatever the world's "show check DCs" setting. */
const HIDE_DC = "pct-hide-dc";

/** Roll one actor's check, tagged for a tracker. Returns the roll, or null if there was none. */
async function rollAs(actor, { tid, target, check, title, hideDC = false }) {
  const stat = actor.getStatistic?.(String(check.skill || "").toLowerCase());
  if (!stat) {
    ui.notifications.warn(lz("HasNoToRoll", { name: esc(actor.name), skill: esc(skillLabel(check.skill)) }));
    return null;
  }
  const dc = Number.isFinite(Number(check.dc)) && check.dc !== null && check.dc !== "" ? { value: Number(check.dc), ...(hideDC ? { visible: false } : {}) } : undefined;
  return (await stat.roll({ dc, label: title, extraRollOptions: [rollTag(tid, target, check.id), ...(hideDC ? [HIDE_DC] : [])] })) ?? null;
}

/** The thing a roll targets inside a tracker, and the checks it offers. */
function locate(t, target) {
  if (target === "main") return { type: "main", obj: t, checks: t.checks ?? [], name: "" };
  const found = findRow(t, target);
  if (!found) return null;
  const list = found.list;
  const row = found.row;
  if (list === "approaches") return { type: "approach", obj: row, checks: row.checks ?? [], name: row.label || "" };
  if (list === "adhoc") {
    // A check the GM called on the fly: it counts as an approach when the GM linked one.
    const linked = row.approach ? (t.approaches ?? []).find((a) => a.id === row.approach) : null;
    const checks = [{ id: row.id, skill: row.skill }];
    if (linked) return { type: "approach", obj: linked, checks, name: linked.label || "" };
    return { type: "adhoc", obj: row, checks, name: row.label || skillLabel(row.skill) };
  }
  if (["obstacles", "complications", "opportunities"].includes(list)) return { type: list.slice(0, -1), obj: row, checks: row.checks ?? [], name: row.name, index: Number(found.path.split(".")[1]) };
  if (["skills", "discovery", "checks"].includes(list)) return { type: list === "discovery" ? "discover" : "check", obj: row, checks: [row], name: row.label || skillLabel(row.skill) };
  return null;
}

/** Text cut to a length for titles and labels. */
const shortText = (s, n = 60) => {
  const x = String(s ?? "").replace(/\s+/g, " ").trim();
  if (x.length <= n) return x;
  const cut = x.slice(0, n);
  const space = cut.lastIndexOf(" ");
  return `${(space > n / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, "")}...`;
};

/** The roll title on the card: tracker name and what the check is for. */
function rollTitle(t, target) {
  const where = locate(t, target);
  return where?.name && where.type !== "check" ? `${t.name}: ${where.name}` : t.name;
}

/**
 * A skill challenge roll: add the result's successes and failures, count a use of the approach,
 * and log it. Returns the line for the roll card.
 */
function applyChallenge(t, where, { outcome, actorId, logName, skill }) {
  const d = t.degrees?.[outcome] ?? CDEG()[outcome];
  const s = num(d.s), f = num(d.f);
  const before = challengeStatus(t);
  t.successes = Math.max(0, num(t.successes) + s);
  t.failures = Math.max(0, num(t.failures) + f);
  const again = !!t.oncePerRound && !!actorId && (t.log ?? []).some((x) => x.actorId === actorId && num(x.round) === num(t.round));
  const a = where.type === "approach" ? where.obj : null;
  if (a) a.used = num(a.used) + 1;
  const over = a && nullNum(a.uses) !== null && num(a.used) > num(a.uses);
  const what = a ? a.label || lz("AnApproach") : where.name || lz("ACheck");
  t.log = [...(t.log ?? []), { id: uid(), round: num(t.round), actorId: actorId ?? null, name: logName || "", approach: a?.id ?? null, what, skill: skill || "", outcome, s, f }].slice(-50);
  const goal = nullNum(t.goal), limit = nullNum(t.limit);
  const parts = [];
  const of = (n, max) => (max ? lz("NOfMax", { n, max }) : String(n));
  if (s) parts.push(lz(s === 1 || s === -1 ? "SignedSuccess" : "SignedSuccesses", { n: signed(s), now: of(num(t.successes), goal) }));
  if (f) parts.push(lz(f === 1 || f === -1 ? "SignedFailure" : "SignedFailures", { n: signed(f), now: of(num(t.failures), limit) }));
  let line = `${logName ? `${logName}: ` : ""}${lz("ResultAt", { res: DEGREE_LABEL[outcome], what })}, ${parts.join(lz("AndJoin")) || lz("NoChange")}.`;
  const after = challengeStatus(t);
  if (after && after !== before) line += ` ${STATUS_TEXT[after]}.`;
  if (again) line += ` ${logName || lz("They")} ${lz("AlreadyRolledThisRound")}`;
  if (over) line += ` ${lz(num(a.uses) === 1 ? "PastLimitUse" : "PastLimitUses", { uses: num(a.uses) })}`;
  return line;
}

/**
 * Apply a roll's degree of success to a tracker. Changes the tracker in place and returns a line
 * saying what happened, or null if the roll doesn't apply.
 */
function applyRoll(t, { target, outcome, actorId = null, actorName = "", logName = "", skill = "" }) {
  if (!DEGREES.includes(outcome)) return null;
  const where = locate(t, target);
  if (!where) return null;
  if (t.kind === "challenge") return applyChallenge(t, where, { outcome, actorId, logName, skill });
  const deg = pointsFor(t, outcome);
  const res = DEGREE_LABEL[outcome];
  const who = actorName ? `${actorName}: ` : "";
  // No number for this result: a note for the Apply box, never applied (see applyRecorded).
  const unset = { unset: lz("NoPointsAreSetForThis", { who, res }) };
  switch (t.kind) {
    case "points": {
      if (deg === null) return unset;
      const [lo, hi] = bounds(t, "value");
      const before = num(t.value);
      t.value = clamp(before + deg, lo, hi);
      return `${lz("ToNow", { who: who, res: res, x: signed(t.value - before), name: t.name, value: t.value })}`;
    }
    case "influence": {
      if (where.type === "discover") {
        const what = { criticalSuccess: lz("LearnTwoThingsAboutThem"), success: lz("LearnOneThingAboutThem"), failure: lz("LearnNothing"), criticalFailure: lz("LearnOneThingAndItS") }[outcome];
        return lz("DiscoverLine", { who, res, what });
      }
      if (deg === null) return unset;
      const before = num(t.value);
      t.value = Math.max(0, before + deg);
      return `${lz("InfluenceNow", { who: who, res: res, x: signed(t.value - before), value: t.value })}`;
    }
    case "research": {
      if (deg === null) return unset;
      const c = where.obj;
      let pts = deg;
      const max = nullNum(c.maxRP);
      if (pts > 0 && max !== null) pts = Math.max(0, Math.min(pts, max - num(c.earned)));
      if (pts > 0) c.earned = num(c.earned) + pts;
      const before = num(t.value);
      t.value = Math.max(0, before + pts);
      const capped = deg > 0 && pts < deg ? ` ${c.label || skillLabel(c.skill)} ${lz("HasNothingMoreToGive")}` : "";
      return `${lz("ResearchPointsNow", { who: who, res: res, x: signed(t.value - before), value: t.value, capped: capped })}`;
    }
    case "chase": {
      if (where.type !== "obstacle") return null;
      if (deg === null) return unset;
      const o = where.obj;
      const before = num(o.progress);
      o.progress = clamp(before + deg, 0, num(o.points));
      let line = lz("ChaseLine", { who, res, n: signed(o.progress - before), name: o.name || lz("ObstacleN", { n: where.index + 1 }), now: lz("NOfMax", { n: o.progress, max: o.points }) });
      if (o.progress >= num(o.points) && where.index === num(t.current)) {
        t.current = num(t.current) + 1;
        line += lz("ObstacleCleared");
      }
      return line;
    }
    case "infiltration": {
      const o = where.obj;
      if (where.type === "obstacle") {
        const { ip, ap } = infiltrationPointsFor(t, outcome);
        if (ip === null || ap === null) return unset;
        const parts = [];
        if (ip) {
          if (o.type === "individual") {
            const key = actorId || "party";
            o.byActor = { ...(o.byActor ?? {}) };
            const before = num(o.byActor[key]);
            o.byActor[key] = clamp(before + ip, 0, num(o.points));
            parts.push(`${lz("InfiltrationAtOfForThem", { x: signed(o.byActor[key] - before), name: o.name, x2: o.byActor[key], points: o.points })}`);
          } else {
            const before = num(o.progress);
            o.progress = clamp(before + ip, 0, num(o.points));
            parts.push(`${lz("InfiltrationAtOf", { x: signed(o.progress - before), name: o.name, progress: o.progress, points: o.points })}`);
          }
        }
        if (ap) {
          t.awareness = Math.max(0, num(t.awareness) + ap);
          parts.push(`${lz("AwarenessNow", { ap: signed(ap), awareness: t.awareness })}`);
        }
        return parts.length ? `${who}${res}, ${parts.join(", ")}.` : `${lz("AtNoChange", { who: who, res: res, name: o.name })}`;
      }
      if (where.type === "complication") {
        if (outcome === "success" || outcome === "criticalSuccess") {
          o.done = true;
          return `${lz("IsDealtWith", { who: who, res: res, name: o.name })}`;
        }
        const { ap } = infiltrationPointsFor(t, outcome);
        if (ap === null) return unset;
        t.awareness = Math.max(0, num(t.awareness) + ap);
        return `${lz("AgainstAwarenessNow", { who: who, res: res, name: o.name, ap: signed(ap), awareness: t.awareness })}`;
      }
      if (where.type === "opportunity") {
        if (outcome === "success" || outcome === "criticalSuccess") o.done = true;
        return `${lz("ResultAtName", { who, res, name: o.name })}${o.done ? lz("MarkedAsTaken") : ""}`;
      }
      return null;
    }
  }
  return null;
}


export { titleCase, skillLabel, rollTag, FREE_TID, parseTag, rollers, rollCheck, HIDE_DC, rollAs, locate, shortText, rollTitle, applyChallenge, applyRoll };
