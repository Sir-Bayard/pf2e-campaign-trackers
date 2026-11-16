/** The GM's view of each kind of tracker. */

import { esc, tipAttr } from "./kit/safe-text.mjs";
import { dkey, fmtDate, today } from "./calendar.mjs";
import { skillLabel } from "./checks.mjs";
import { DEGREE_LABEL, lz, num, para, signed } from "./core.mjs";
import { STATUS_TEXT, challengeStatus, clamp, currentTier, infiltrationIP, infiltrationProgress, nullNum, obstacleOvercome, tierLadder } from "./data.mjs";
import { A, F, cardBtn, checkRows, clockSVG, dateStatus, eye, othersAt, partyMembers, pcName, questGM, stepper, thresholdRows } from "./html.mjs";

/* ------------------------------------------------------------------ */
/* GM view of each kind                                                */
/* ------------------------------------------------------------------ */

/** A row of marks: `have` filled out of `of` (more than `of` shows as extra filled marks). */
function pips(have, of, cls) {
  const n = Math.max(num(have), num(of));
  if (!n) return "";
  return `<span class="pct-pips ${cls}">${Array.from({ length: Math.min(n, 30) }, (_, i) => `<i class="${i < num(have) ? "fa-solid" : "fa-regular"} fa-circle"></i>`).join("")}</span>`;
}

/** The counts of a skill challenge as marks, for the GM and for players who may see them. */
function challengeTally(successes, goal, failures, limit, { numbers = true } = {}) {
  const n = (v, of) => (numbers ? `<span>${of ? lz("XOfY", { x: num(v), y: of }) : num(v)}</span>` : "");
  return `<div class="pct-tally">
      <span class="pct-tally-row"><span class="pct-k">${lz("Successes")}</span>${pips(successes, goal, "pct-pips-ok")}${n(successes, goal)}</span>
      <span class="pct-tally-row"><span class="pct-k">${lz("Failures")}</span>${pips(failures, limit, "pct-pips-bad")}${n(failures, limit)}</span>
    </div>`;
}

/** U6: with one check per character per round, who has rolled this round (from the challenge's results). */
function rolledThisRound(t) {
  if (!t.oncePerRound) return "";
  const pcs = partyMembers();
  if (!pcs.length) return "";
  const did = new Set((t.log ?? []).filter((x) => num(x.round) === num(t.round) && x.actorId).map((x) => x.actorId));
  return `<div class="pct-line pct-rolled"><span class="pct-k">${lz("RolledThisRound")}</span>${pcs.map((pc) => {
    const yes = did.has(pc.id);
    return `<span class="pct-chip ${yes ? "pct-met" : ""}"><i class="${yes ? "fa-solid fa-check" : "fa-regular fa-circle"}" aria-hidden="true"></i> ${esc(pcName(pc))}<span class="pct-sr">${yes ? lz("RolledSR") : lz("NotYet3")}</span></span>`;
  }).join("")}</div>`;
}

const GM = {
  quest(t) {
    return questGM(t, new Set());
  },

  challenge(t) {
    const goal = nullNum(t.goal), limit = nullNum(t.limit), rounds = nullNum(t.rounds);
    const st = challengeStatus(t);
    const approaches = t.approaches.map((a, i) => {
      const uses = nullNum(a.uses);
      const usedChip = uses !== null ? `<span class="pct-chip" ${tipAttr(lz("TimesUsedOfTheMostAllowed"))}>${lz("UsedOfUses", { used: num(a.used), uses })}</span>` : num(a.used) ? `<span class="pct-chip" ${tipAttr(lz("TimesUsed"))}>${lz("UsedN", { n: num(a.used) })}</span>` : "";
      return `<div class="pct-obstacle pct-approach ${uses !== null && num(a.used) >= uses ? "pct-done" : ""}">
          <div class="pct-line">${eye(`approaches.${i}`, a.revealed)}<strong>${a.label ? esc(a.label) : `<em>${lz("NoNameForPlayers")}</em>`}</strong>${usedChip}</div>
          ${a.gm ? `<p class="pct-gm">${para(a.gm)}</p>` : ""}
          ${a.critFail ? `<p class="pct-gm"><span class="pct-k">${lz("CriticalFailure2")}</span> ${para(a.critFail)}</p>` : ""}
          ${checkRows(t, a.id, a.checks.filter((c) => c.skill), { gm: true })}
        </div>`;
    }).join("");
    const log = (t.log ?? []).slice(-12).reverse().map((x) => `<li><span class="pct-chip">R${num(x.round)}</span> ${x.name ? `<strong>${esc(x.name)}</strong> ` : ""}${esc(DEGREE_LABEL[x.outcome] ?? x.outcome)}${x.skill ? ` (${esc(skillLabel(x.skill))})` : ""} ${lz("AtWhat", { what: esc(x.what) })}: ${[x.s ? signed(x.s) + " S" : "", x.f ? signed(x.f) + " F" : ""].filter(Boolean).join(", ") || lz("NoChange")}</li>`).join("");
    return `<div class="pct-line">
        ${stepper("successes", num(t.successes), { label: lz("Successes"), fmt: (v) => (goal ? `${v} / ${goal}` : v) })}
        ${stepper("failures", num(t.failures), { label: lz("Failures"), fmt: (v) => (limit ? `${v} / ${limit}` : v) })}
        ${rounds || t.oncePerRound ? stepper("round", num(t.round), { label: lz("Round"), fmt: (v) => (rounds ? lz("XOfY", { x: v, y: rounds }) : v) }) : ""}
        ${rounds || t.oncePerRound ? A("pctEndRound", "fa-solid fa-forward", { label: lz("EndRound") }) : ""}
        ${st ? `<span class="pct-chip pct-status-${st}">${STATUS_TEXT[st]}</span>` : ""}
        <span class="pct-push">${A("pctChallengeCheck", "fa-solid fa-dice-d20", { label: lz("Check"), tip: lz("CallForACheckOnThe") })}
        ${A("pctChallengePost", "fa-solid fa-list", { label: lz("PostSkills"), tip: lz("PostToChatTheSkillsThat"), data: { mode: "skills" } })}
        ${A("pctChallengePost", "fa-solid fa-share-from-square", { label: lz("PostOptions"), tip: lz("PostTheRevealedApproachesToChat"), data: { mode: "options" } })}</span>
      </div>
      ${challengeTally(t.successes, goal, t.failures, limit, { numbers: false })}
      ${rolledThisRound(t)}
      ${t.onSuccess ? `<p class="pct-gm"><span class="pct-k">${lz("OnSuccess")}</span> ${para(t.onSuccess)}</p>` : ""}
      ${t.onFailure ? `<p class="pct-gm"><span class="pct-k">${lz("OnFailure")}</span> ${para(t.onFailure)}</p>` : ""}
      ${t.thresholds.length ? `<div class="pct-sub">${lz("AlongTheWay")}</div>${thresholdRows(t.thresholds, t.successes, { gm: true, path: "thresholds", unit: " S" })}` : ""}
      <div class="pct-sub">${lz("Approaches")}</div>
      ${approaches || `<p class="pct-hint">${lz("NoApproachesYetAddThemUnder")}</p>`}
      ${log ? `<details class="pct-log" data-focus-key="log"><summary>${lz("ResultsN", { n: (t.log ?? []).length })}</summary><ul>${log}</ul></details>` : ""}`;
  },

  reputation(t) {
    const tier = currentTier(t);
    const ladder = tierLadder(t).reverse();
    return `<div class="pct-rep">
        ${stepper("value", num(t.value), { steps: (t.steps?.length ? t.steps : [1]).map(Number), fmt: signed })}
        <div class="pct-tier-now">${tier ? `<strong>${esc(tier.label)}</strong>${tier.text ? `<p>${para(tier.text)}</p>` : ""}${tier.gm ? `<p class="pct-gm">${para(tier.gm)}</p>` : ""}` : `<em>${lz("NoTiersSet")}</em>`}</div>
      </div>
      <ol class="pct-ladder">${ladder.map((x) => `<li class="${x.id === tier?.id ? "pct-current" : ""}"><strong>${esc(x.label)}</strong> <span class="pct-range">${esc(x.range)}</span></li>`).join("")}</ol>`;
  },

  pressure(t) {
    const tier = currentTier(t);
    const ladder = tierLadder(t);
    const max = nullNum(t.max);
    const meter = max ? `<div class="pct-meter">${ladder.map((x, i) => {
      // Slots 1..max; a band covers the slots from its start to the next band's.
      const lo = Math.max(1, i === 0 ? nullNum(t.min) ?? 0 : num(x.min));
      const hi = Math.min(ladder[i + 1] ? num(ladder[i + 1].min) : max + 1, max + 1);
      const span = Math.max(0, hi - lo);
      const fill = clamp(num(t.value) - lo + 1, 0, span);
      return `<div class="pct-band ${x.id === tier?.id ? "pct-current" : ""}" style="flex:${span}" data-tooltip-text="${esc(`${x.label}: ${x.range}`)}"><div style="width:${span ? (fill / span) * 100 : 0}%"></div></div>`;
    }).join("")}</div>` : "";
    return `<div class="pct-line">${stepper("value", num(t.value), { steps: (t.steps?.length ? t.steps : [1]).map(Number), fmt: (v) => (max !== null ? `${v} / ${max}` : v) })}
        ${t.halve ? A("pctHalve", "fa-solid fa-divide", { label: lz("Halve"), tip: lz("HalveTheValueRoundedDown") }) : ""}</div>
      ${meter}
      <div class="pct-tier-now">${tier ? `<strong>${esc(tier.label)}</strong> <span class="pct-range">${esc(tier.range)}</span>${tier.text ? `<p>${para(tier.text)}</p>` : ""}${tier.gm ? `<p class="pct-gm">${para(tier.gm)}</p>` : ""}` : `<em>${lz("NoBandsSet")}</em>`}</div>
      <ol class="pct-ladder">${[...ladder].reverse().map((x) => `<li class="${x.id === tier?.id ? "pct-current" : ""}"><strong>${esc(x.label)}</strong> <span class="pct-range">${esc(x.range)}</span></li>`).join("")}</ol>
      ${thresholdRows(t.thresholds, t.value, { gm: true, path: "thresholds" })}`;
  },

  points(t) {
    const max = nullNum(t.max);
    const bar = max ? `<div class="pct-bar"><div style="width:${clamp((num(t.value) / max) * 100, 0, 100)}%"></div></div>` : "";
    return `<div class="pct-line">${stepper("value", num(t.value), { fmt: (v) => (max !== null ? `${v} / ${max}` : v) })}
        ${t.halve ? A("pctHalve", "fa-solid fa-divide", { label: lz("Halve"), tip: lz("HalveTheValueRoundedDown") }) : ""}
        ${t.checks.length ? cardBtn("main") : ""}</div>
      ${bar}
      ${thresholdRows(t.thresholds, t.value, { gm: true, path: "thresholds" })}
      ${checkRows(t, "main", t.checks, { gm: true, revealEach: true, path: "checks" })}`;
  },

  influence(t) {
    const npc = t.npc
      ? `<div class="pct-npc" data-drop="npc"><img src="${esc(t.npc.img)}" alt=""><strong>${esc(t.npc.name)}</strong>${A("pctClearNpc", "fa-solid fa-xmark", { tip: lz("Unlink") })}</div>`
      : `<div class="pct-npc pct-drop" data-drop="npc"><i class="fa-solid fa-user-plus"></i> ${lz("DropAnNPCHere")}</div>`;
    const notes = (list, path, title) => (list.length ? `<div class="pct-sub">${title}</div><ul class="pct-notes">${list.map((x, i) => `<li>${eye(`${path}.${i}`, x.revealed)} ${para(x.text)}</li>`).join("")}</ul>` : "");
    return `<div class="pct-line">${npc}
        ${stepper("value", num(t.value), { label: lz("Influence") })}
        ${stepper("roundsUsed", num(t.roundsUsed), { label: lz("Round"), fmt: (v) => lz("XOfY", { x: v, y: num(t.rounds) }) })}
        ${A("pctEndRound", "fa-solid fa-forward", { label: lz("EndRound") })}</div>
      ${thresholdRows(t.thresholds, t.value, { gm: true, path: "thresholds" })}
      ${t.skills.length ? `<div class="pct-sub">${lz("Influence")} ${A("pctCardList", "fa-solid fa-share-from-square", { tip: lz("PostTheRevealedInfluenceSkillsTo"), data: { list: "skills" }, cls: "pct-card-post" })}</div>${checkRows(t, "", t.skills, { gm: true, perCheckTarget: true, revealEach: true, path: "skills" })}` : ""}
      ${t.discovery.length ? `<div class="pct-sub">${lz("Discover")} ${A("pctCardList", "fa-solid fa-share-from-square", { tip: lz("PostTheRevealedDiscoverChecksTo"), data: { list: "discovery" }, cls: "pct-card-post" })}</div>${checkRows(t, "", t.discovery, { gm: true, perCheckTarget: true, revealEach: true, path: "discovery" })}` : ""}
      ${notes(t.resistances, "resistances", lz("Resistances"))}
      ${notes(t.weaknesses, "weaknesses", lz("Weaknesses"))}
      ${t.penalty ? `<div class="pct-sub">${lz("Penalty")}</div><p class="pct-gm">${para(t.penalty)}</p>` : ""}`;
  },

  research(t) {
    return `<div class="pct-line">${stepper("value", num(t.value), { label: lz("ResearchPoints3") })}
        ${stepper("round", num(t.round), { label: lz("Rounds") })}
        ${A("pctCardList", "fa-solid fa-share-from-square", { tip: lz("PostTheRevealedResearchChecksTo"), data: { list: "checks" }, cls: "pct-card-post" })}</div>
      ${thresholdRows(t.thresholds, t.value, { gm: true, path: "thresholds" })}
      ${checkRows(t, "", t.checks, { gm: true, perCheckTarget: true, revealEach: true, path: "checks" })}`;
  },

  chase(t) {
    const n = t.obstacles.length;
    const cur = num(t.current);
    const q = t.quarry?.enabled ? num(t.quarry.at) : null;
    const qLabel = t.quarry?.label || lz("Quarry");
    const qText = q === null ? "" : q < 1 ? lz("NotStarted") : q > n ? lz("GotAway") : `${lz("AtObstacle", { q: q })}`;
    const track = `<ol class="pct-track">${t.obstacles.map((o, i) => `<li class="${i < cur ? "pct-done" : i === cur ? "pct-current" : ""}">
        <span class="pct-track-n">${i + 1}</span><span class="pct-track-name">${esc(o.name || `${lz("Obstacle2", { x: i + 1 })}`)}</span>
        <span class="pct-track-pts">${num(o.progress)}/${num(o.points)}</span>
        <span class="pct-marks">${i === cur ? `<i class="fa-solid fa-users" ${tipAttr(lz("TheParty2"))}></i>` : ""}${q === i + 1 ? `<i class="fa-solid fa-person-running pct-quarry" data-tooltip-text="${esc(qLabel)}"></i>` : ""}</span></li>`).join("")}</ol>`;
    const rows = t.obstacles.map((o, i) => `<div class="pct-obstacle ${i === cur ? "pct-current" : i < cur ? "pct-done" : ""}">
        <div class="pct-line">${eye(`obstacles.${i}`, o.revealed)}<strong>${i + 1}. ${esc(o.name || `${lz("Obstacle2", { x: i + 1 })}`)}</strong>
          ${stepper(`obstacles.${i}.progress`, num(o.progress), { fmt: (v) => lz("XOfY", { x: v, y: num(o.points) }) })}
          ${o.checks.length ? cardBtn(o.id) : ""}</div>
        ${o.text ? `<p class="pct-gm">${para(o.text)}</p>` : ""}
        ${checkRows(t, o.id, o.checks, { gm: true })}
      </div>`).join("");
    return `<div class="pct-line">
        ${stepper("round", num(t.round), { label: lz("Round") })}
        ${stepper("current", cur, { label: lz("PartyAt"), fmt: (v) => (v >= n ? lz("TheEnd") : `obstacle ${v + 1}`) })}
        ${q !== null ? stepper("quarry.at", q, { label: qLabel, fmt: () => qText }) : ""}
      </div>${track}${rows}`;
  },

  infiltration(t) {
    const pcs = partyMembers();
    const ip = infiltrationIP(t);
    const goal = num(t.objective);
    const done = infiltrationProgress(t, pcs);
    const obstacles = t.obstacles.map((o, i) => {
      const prog = o.type === "individual"
        ? `<div class="pct-indiv">${pcs.map((pc) => `<span class="pct-pc">${esc(pcName(pc))} ${stepper(`obstacles.${i}.byActor.${pc.id}`, num(o.byActor?.[pc.id]), { fmt: (v) => `${v}/${num(o.points)}` })}</span>`).join("")}${othersAt(o, pcs, { zeros: true }).map((x) => `<span class="pct-pc pct-other">${esc(x.name)} ${stepper(`obstacles.${i}.byActor.${x.id}`, x.value, { fmt: (v) => `${v}/${num(o.points)}` })}${A("pctIndivDrop", "fa-solid fa-xmark", { tip: lz("TakeThisRowAway"), data: { path: `obstacles.${i}.byActor`, key: x.id } })}</span>`).join("")}</div>`
        : stepper(`obstacles.${i}.progress`, num(o.progress), { fmt: (v) => lz("XOfY", { x: v, y: num(o.points) }) });
      return `<div class="pct-obstacle"><div class="pct-line">${eye(`obstacles.${i}`, o.revealed)}<strong>${esc(o.name || lz("Obstacle"))}</strong><span class="pct-chip">${o.type === "individual" ? lz("EachPC") : lz("Group")}</span>${obstacleOvercome(o, pcs) ? `<span class="pct-chip" ${tipAttr(lz("ThePartyHasOvercomeThisObstacle"))}><i class="fa-solid fa-check"></i> ${lz("Overcome")}</span>` : ""}${o.type === "individual" ? "" : prog}${o.checks.length ? cardBtn(o.id) : ""}</div>
        ${o.type === "individual" ? prog : ""}${o.text ? `<p class="pct-gm">${para(o.text)}</p>` : ""}${checkRows(t, o.id, o.checks, { gm: true })}</div>`;
    }).join("");
    const extras = (list, path, title) => (list.length ? `<div class="pct-sub">${title}</div>${list.map((o, i) => `<div class="pct-obstacle ${o.done ? "pct-done" : ""}"><div class="pct-line">${eye(`${path}.${i}`, o.revealed)}${F.bool(`${path}.${i}.done`, o.done, "", path === "complications" ? lz("DealtWith") : lz("Taken"))}<strong>${esc(o.name || lz("Untitled"))}</strong>${o.trigger ? `<span class="pct-chip">${esc(o.trigger)}</span>` : ""}${o.checks.length ? cardBtn(o.id) : ""}</div>${o.text ? `<p class="pct-gm">${para(o.text)}</p>` : ""}${checkRows(t, o.id, o.checks, { gm: true })}</div>`).join("")}` : "");
    return `<div class="pct-line">
        ${stepper("awareness", num(t.awareness), { label: lz("Awareness") })}
        ${stepper("edge", num(t.edge), { label: lz("Edge") })}
        ${stepper("round", num(t.round), { label: lz("Round") })}
        ${A("pctEndRound", "fa-solid fa-forward", { label: lz("EndRound"), tip: lz("NextRoundAnd1Awareness") })}
        <span class="pct-chip" ${tipAttr(lz("ObstaclesThePartyHasOvercome"))}>${lz("OfObstacles", { done: done.done, of: done.of })}</span>
        <span class="pct-chip" ${tipAttr(goal ? lz("InfiltrationPointsEarnedAndYourGoal") : lz("InfiltrationPointsEarned"))}>${goal ? lz("IPOfGoal", { ip, goal }) : lz("IPShort", { ip })}</span>
      </div>
      ${thresholdRows(t.awarenessThresholds, t.awareness, { gm: true, path: "awarenessThresholds", unit: " AP" })}
      ${obstacles ? `<div class="pct-sub">${lz("Obstacles")}</div>${obstacles}` : ""}
      ${extras(t.complications, "complications", lz("Complications"))}
      ${extras(t.opportunities, "opportunities", lz("Opportunities"))}`;
  },

  clock(t) {
    const rows = t.segments.map((s, i) => `<li class="pct-seg pct-seg-${s.state}">
        ${A("pctSeg", s.state === "filled" ? "fa-solid fa-circle" : s.state === "broken" ? "fa-solid fa-ban" : "fa-regular fa-circle", { name: lz("SegmentState", { n: i + 1, state: s.state === "filled" ? lz("SegFilled") : s.state === "broken" ? lz("SegBroken") : lz("SegEmpty") }), tip: lz("ClickToFillOrEmptyRight"), data: { path: `segments.${i}` } })}
        <span class="pct-seg-n">${i + 1}</span><span class="pct-seg-label">${esc(s.label || "")}${s.text ? `<span class="pct-gm">${para(s.text)}</span>` : ""}</span>
        ${s.date ? `<span class="pct-date-chip ${dkey(s.date) <= dkey(today()) && s.state === "empty" ? "pct-today" : ""}">${esc(fmtDate(s.date))}</span>` : ""}</li>`).join("");
    return `<div class="pct-clockwrap">${clockSVG(t.segments, 84)}<ol class="pct-segs">${rows}</ol></div>
      ${t.ordered ? `<p class="pct-hint">${lz("SegmentsFillInOrderADate")}</p>` : ""}`;
  },

  checklist(t) {
    const groups = [];
    t.entries.forEach((e, i) => {
      const g = e.group || "";
      let grp = groups.find((x) => x.name === g);
      if (!grp) groups.push((grp = { name: g, rows: [] }));
      grp.rows.push({ e, i });
    });
    return groups.map((g) => `${g.name ? `<div class="pct-sub">${esc(g.name)}</div>` : ""}<ul class="pct-entries">${g.rows.map(({ e, i }) => `<li class="${e.done ? "pct-done" : ""}">
        ${eye(`entries.${i}`, e.revealed)}${F.bool(`entries.${i}.done`, e.done, "", lz("Done"))}
        <div class="pct-entry"><div><strong>${esc(e.label || lz("Untitled"))}</strong>${e.tag ? ` <span class="pct-chip">${esc(e.tag)}</span>` : ""} ${dateStatus(e.closes, e.done)}</div>
          ${e.detail ? `<div class="pct-gm"><span class="pct-k">${lz("EarnedBy")}</span> ${para(e.detail)}</div>` : ""}
          ${e.effect ? `<div class="pct-gm"><span class="pct-k">${lz("PaysOff")}</span> ${para(e.effect)}</div>` : ""}</div></li>`).join("")}</ul>`).join("") || `<p class="pct-hint">${lz("NoEntriesYetAddThemUnder")}</p>`;
  },
};


export { pips, challengeTally, rolledThisRound, GM };
