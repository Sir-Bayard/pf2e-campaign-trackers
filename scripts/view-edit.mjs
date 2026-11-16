/** The GM's editor for each kind of tracker. */

import { esc } from "./kit/safe-text.mjs";
import { shortText } from "./checks.mjs";
import { DEGREES, DEGREE_LABEL, KIND_INFO, lz } from "./core.mjs";
import { LINK_CONDS, QSTATUS, QSTATUS_LABEL, linkCond, rowLabel } from "./data.mjs";
import { A, F, L, checkEdit, degreesEdit, infiltrationDegreesEdit, listEditor, thresholdEdit } from "./html.mjs";
import { Store } from "./store.mjs";

/* ------------------------------------------------------------------ */
/* Editing each kind                                                   */
/* ------------------------------------------------------------------ */

/**
 * A goal's fields in the editor: what players see, the GM's note, optional, a count, and (given the quest) its link
 * and reveals.
 */
const goalEdit = (g, p, what, t) => `<div class="pct-line">${L(what, F.text(`${p}.text`, g.text, what === lz("Step") ? lz("GetDisguises") : lz("GainAccessToTheCastle")), "pct-grow")}${L(lz("Count"), F.num(`${p}.count`, g.count, "none", "pct-dc"))}${F.bool(`${p}.optional`, g.optional, lz("Optional"))}</div>
    ${L(lz("GMOnly"), F.text(`${p}.gm`, g.gm, lz("WhatItReallyTakesWhatIt")), "pct-block")}${t ? `${linkEdit(g, p)}${onDoneEdit(g, p, t)}` : ""}`;

/** "Done when the Alarm clock is full": a goal watching another tracker. */
function linkEdit(g, p) {
  const others = Store.data.trackers.filter((x) => x.kind !== "quest" && LINK_CONDS[x.kind]);
  const t = others.find((x) => x.id === g.link?.tid) ?? null;
  const pick = L(lz("Watch"), F.select(`${p}.link.tid`, t ? t.id : "", [["", "nothing"], ...others.map((x) => [x.id, `${KIND_INFO[x.kind].label}: ${x.name}`])]));
  if (!t) return `<div class="pct-line pct-qlinkedit">${pick}</div>`;
  const cond = linkCond(g.link, t);
  const conds = LINK_CONDS[t.kind];
  const how = conds.length > 1 ? F.select(`${p}.link.cond`, cond, conds) : `<span>${esc(conds[0][1])}</span>`;
  const extra = cond === "atLeast"
    ? F.num(`${p}.link.at`, g.link.at, "value", "pct-dc")
    : cond === "entry" ? F.select(`${p}.link.entry`, g.link.entry ?? "", [["", lz("PickAnEntry")], ...(t.entries ?? []).map((e) => [e.id, shortText(e.label, 40) || "(untitled)"])]) : "";
  return `<div class="pct-line pct-qlinkedit">${pick}${how}${extra}<span class="pct-hint">${lz("WhenItDoesYouGetA")}</span></div>`;
}

/** <details> boxes the GM has open in an editor, kept across redraws in this window. */
const openDetails = new Set();

/** A lead's clues to reveal with it, as checkboxes in a fold. */
function leadCluesEdit(l, p, t) {
  const key = `${t.id}:${l.id}:clues`;
  const picked = new Set(l.clues ?? []);
  const boxes = (t.entries ?? []).map((e) => `<label class="pct-chk"><input type="checkbox" data-focus-key="${p}.clues:${esc(e.id)}" data-path="${p}.clues" data-type="idlist" value="${esc(e.id)}" ${picked.has(e.id) ? "checked" : ""}> <span>${esc(shortText(e.text, 70) || lz("NoText"))}${e.revealed ? "" : ` ${lz("HiddenMark")}`}</span></label>`).join("");
  return `<details class="pct-ondone" data-key="${esc(key)}" data-focus-key="${esc(key)}" ${openDetails.has(key) ? "open" : ""}><summary>${lz("RevealsClues", { size: picked.size })}</summary>${boxes || `<p class="pct-hint">${lz("NoCluesInThisQuestYet")}</p>`}</details>`;
}

/** Which rows of the quest finishing this goal offers to reveal. */
function onDoneEdit(g, p, t) {
  const rows = [];
  for (const o of t.objectives) {
    if (o.id !== g.id) rows.push(o);
    for (const st of o.steps) if (st.id !== g.id) rows.push(st);
  }
  rows.push(...t.entries, ...t.leads, ...t.rewards);
  const key = `${t.id}:${g.id}`;
  const picked = new Set(g.onDone ?? []);
  const boxes = rows.map((r) => `<label class="pct-chk"><input type="checkbox" data-focus-key="${p}.onDone:${esc(r.id)}" data-path="${p}.onDone" data-type="idlist" value="${esc(r.id)}" ${picked.has(r.id) ? "checked" : ""}> <span>${esc(rowLabel(t, r.id))}</span></label>`).join("");
  return `<details class="pct-ondone" data-key="${esc(key)}" data-focus-key="${esc(key)}" ${openDetails.has(key) ? "open" : ""}><summary>${lz("WhenItSDoneOfferTo", { size: picked.size })}</summary>${boxes || `<p class="pct-hint">${lz("NothingElseInThisQuestYet")}</p>`}</details>`;
}

/** Quest editors, one per section, so the GM can edit a part without opening the whole quest. */
const QEDIT = {
  meta(t) {
    const cats = [...new Set([lz("Main"), lz("Side"), ...Store.data.trackers.filter((x) => x.kind === "quest").map((x) => x.category).filter(Boolean)])];
    const giver = t.giver
      ? `<div class="pct-npc" data-drop="giver">${t.giver.img ? `<img src="${esc(t.giver.img)}" alt="">` : ""}<strong>${esc(t.giver.name)}</strong>${A("pctQClear", "fa-solid fa-xmark", { tip: lz("Unlink"), data: { path: "giver" } })}</div>`
      : `<div class="pct-npc pct-drop" data-drop="giver"><i class="fa-solid fa-user-plus"></i> ${lz("DropTheQuestGiverHere")}</div>`;
    return `<div class="pct-line">${L(lz("Status"), F.select("status", t.status, QSTATUS.map((x) => [x, QSTATUS_LABEL[x]])))}
        ${L(lz("Category"), `<input type="text" list="pct-qcats" data-focus-key="category" data-path="category" value="${esc(t.category)}" placeholder="${esc(lz("Main"))}" class="pct-w8">`)}<datalist id="pct-qcats">${cats.map((c) => `<option value="${esc(c)}">`).join("")}</datalist>
        ${L(lz("Due"), F.date("deadline", t.deadline))}${F.bool("showDue", t.showDue !== false, lz("PlayersSeeTheDueDate"), lz("OffASecretDeadlineYouStill"))}</div>
      <div class="pct-line">${giver}${t.giver ? "" : L(lz("OrNameThem"), F.text("giverText", t.giverText, lz("MaudHolloway")), "pct-grow")}${L(lz("Where"), F.text("location", t.location, lz("RidgeRoad")), "pct-grow")}</div>
      <div class="pct-line">${L(lz("Picture"), F.text("img", t.img, lz("PathToAnImage")), "pct-grow")}${A("pctQImg", "fa-solid fa-file-image", { tip: lz("ChooseAPicture") })}</div>`;
  },
  details: (t) => `<div class="pct-edit">${L(lz("Name"), F.text("name", t.name), "pct-block")}
      ${L(lz("PlayersSee"), F.area("desc", t.desc, lz("TheQuestSSummaryShownTo")), "pct-block")}${QEDIT.meta(t)}</div>`,
  notes: (t) => F.area("notes", t.notes, lz("OnlyTheGMSeesThese"), 4),
  objectives: (t) => listEditor("objectives", t.objectives, (o, p) => `${goalEdit(o, p, lz("Objective"), t)}
      <div class="pct-line"><span class="pct-k">${lz("Steps")}</span>${L(lz("DoneWhen"), F.select(`${p}.mode`, o.mode, [["all", lz("EveryStepIsDone")], ["any", lz("AnyOneStepIsDone")]]))}</div>
      <div class="pct-nested">${listEditor(`${p}.steps`, o.steps, (st, sp) => goalEdit(st, sp, lz("Step"), t), lz("Step"))}</div>`, lz("Objective")),
  entries(t) {
    const hid = (g) => (g.revealed === false ? ` ${lz("HiddenMark")}` : "");
    const goals = (t.objectives ?? []).flatMap((o) => [[o.id, `${shortText(o.text, 40) || lz("NoText")}${hid(o)}`], ...(o.steps ?? []).map((st) => [st.id, `\u2003${shortText(st.text, 40) || lz("NoText")}${hid(st)}`])]);
    return listEditor("entries", t.entries, (e, p) => `${L(lz("Date"), F.date(`${p}.date`, e.date))}${L(lz("Clue"), F.area(`${p}.text`, e.text, lz("TheFerrywomanSawRidersCrossAt"), 2), "pct-grow")}${goals.length ? L(lz("FiledUnder"), F.select(`${p}.under`, e.under ?? "", [["", "nothing"], ...goals])) : ""}`, lz("Clue"));
  },
  leads(t) {
    const others = Store.data.trackers.filter((x) => x.kind === "quest" && x.id !== t.id);
    return listEditor("leads", t.leads, (l, p) => `<div class="pct-line">${L(lz("Lead"), F.text(`${p}.text`, l.text, lz("ASmugglerAtTheDocksKnows")), "pct-grow")}${L(lz("PointsTo"), F.select(`${p}.to`, l.to, [["", "nothing"], ...others.map((x) => [x.id, x.name])]))}</div>
      ${leadCluesEdit(l, p, t)}${L(lz("GMOnly"), F.text(`${p}.gm`, l.gm), "pct-block")}`, lz("Lead"));
  },
  rewards: (t) => listEditor("rewards", t.rewards, (r, p) => `<div class="pct-line">${L(lz("Reward"), F.text(`${p}.text`, r.text, lz("200GpAndTheCaptainS")), "pct-grow")}
        ${r.actor ? `<div class="pct-npc" data-drop="${p}.actor">${r.actor.img ? `<img src="${esc(r.actor.img)}" alt="">` : ""}<strong>${esc(r.actor.name)}</strong>${A("pctQClear", "fa-solid fa-xmark", { tip: lz("Unlink"), data: { path: `${p}.actor` } })}</div>` : `<div class="pct-npc pct-drop" data-drop="${p}.actor"><i class="fa-solid fa-box-open"></i> ${lz("DropALootActor")}</div>`}</div>
      ${L(lz("GMOnly"), F.text(`${p}.gm`, r.gm), "pct-block")}`, lz("Reward")),
};

/** The editors a player gets on a party quest: no GM text, links, reveals, giver actors or pictures. */
const partyGoalEdit = (g, p, what) => `<div class="pct-line">${L(what, F.text(`${p}.text`, g.text, what === lz("Step") ? lz("GetDisguises") : lz("FindOutWhoHiredTheSmugglers")), "pct-grow")}${L(lz("Count"), F.num(`${p}.count`, g.count, "none", "pct-dc"))}${F.bool(`${p}.optional`, g.optional, lz("Optional"))}</div>`;
const QEDIT_PARTY = {
  details(t) {
    // The players' copy carries a named giver as giver.name with no picture; a linked actor (with a picture) stays the GM's.
    const giverName = t.giver && !t.giver.img ? t.giver.name : "";
    return `<div class="pct-edit">${L(lz("Name"), F.text("name", t.name), "pct-block")}
      ${L(lz("Summary"), F.area("desc", t.desc, lz("WhatTheQuestIsAbout")), "pct-block")}
      <div class="pct-line">${L(lz("Status"), F.select("status", t.status, QSTATUS.map((x) => [x, QSTATUS_LABEL[x]])))}
        ${L(lz("Category"), F.text("category", t.category, lz("Side"), "pct-w8"))}${t.dueHidden ? "" : L(lz("Due"), F.date("deadline", t.deadline))}</div>
      <div class="pct-line">${t.giver?.img ? "" : L(lz("GivenBy"), F.text("giverText", giverName, lz("MaudHolloway")), "pct-grow")}${L(lz("Where"), F.text("location", t.location, lz("RidgeRoad")), "pct-grow")}</div></div>`;
  },
  objectives: (t) => listEditor("objectives", t.objectives, (o, p) => `${partyGoalEdit(o, p, lz("Objective"))}
      <div class="pct-line"><span class="pct-k">${lz("Steps")}</span>${L(lz("DoneWhen"), F.select(`${p}.mode`, o.mode, [["all", lz("EveryStepIsDone")], ["any", lz("AnyOneStepIsDone")]]))}</div>
      <div class="pct-nested">${listEditor(`${p}.steps`, o.steps, (st, sp) => partyGoalEdit(st, sp, lz("Step")), lz("Step"))}</div>`, lz("Objective")),
  entries: (t) => QEDIT.entries(t),
  leads: (t) => listEditor("leads", t.leads, (l, p) => `<div class="pct-line">${L(lz("Lead"), F.text(`${p}.text`, l.text, lz("ASmugglerAtTheDocksKnows")), "pct-grow")}</div>`, lz("Lead")),
  rewards: (t) => listEditor("rewards", t.rewards, (r, p) => `<div class="pct-line">${L(lz("Reward"), F.text(`${p}.text`, r.text, lz("200GpAndTheCaptainS")), "pct-grow")}</div>`, lz("Reward")),
};

const EDIT = {
  quest: (t) => `${QEDIT.meta(t)}
      <div class="pct-sub">${lz("ObjectivesPlayersSeeEachOneWhen")}</div>${QEDIT.objectives(t)}
      <div class="pct-sub">${lz("CluesWhatThePartyHasLearned")}</div>${QEDIT.entries(t)}
      <div class="pct-sub">${lz("LeadsWhereToGoNextA")}</div>${QEDIT.leads(t)}
      <div class="pct-sub">${lz("RewardsDropALootActorOn")}</div>${QEDIT.rewards(t)}`,

  challenge: (t) => `<div class="pct-line">${L(lz("SuccessesNeeded"), F.num("goal", t.goal, "none"))}${L(lz("FailuresAllowed"), F.num("limit", t.limit, lz("NoLimit")))}${L(lz("Rounds"), F.num("rounds", t.rounds, lz("NoLimit")))}
      ${F.bool("showCount", t.showCount, lz("PlayersSeeTheCounts"), lz("OffPlayersSeeTheApproachesBut"))}
      ${F.bool("explain", t.explain !== false, lz("ProposalsNeedWhatAndWhy"), lz("OffPlayersCanProposeWithJust"))}
      ${F.bool("oncePerRound", t.oncePerRound, lz("OneCheckPerPCPerRound"), lz("ApplyTellsYouWhenACharacter"))}</div>
    <div class="pct-sub">${lz("EachResultAdds")}</div>
    <table class="pct-cdeg"><thead><tr><th></th><th>${lz("Successes")}</th><th>${lz("Failures")}</th></tr></thead><tbody>${DEGREES.map((d) => `<tr><th>${DEGREE_LABEL[d]}</th><td>${F.num(`degrees.${d}.s`, t.degrees?.[d]?.s, "0", "pct-dc")}</td><td>${F.num(`degrees.${d}.f`, t.degrees?.[d]?.f, "0", "pct-dc")}</td></tr>`).join("")}</tbody></table>
    <div class="pct-line">${L(lz("OnSuccessGMOnly"), F.text("onSuccess", t.onSuccess, lz("WhatThePartyGains")), "pct-grow")}${L(lz("OnFailureGMOnly"), F.text("onFailure", t.onFailure, lz("WhatItCostsThem")), "pct-grow")}</div>
    <div class="pct-sub">${lz("AlongTheWayAtANumber")}</div>${listEditor("thresholds", t.thresholds, (x, p) => thresholdEdit(x, p, lz("Successes")), lz("Milestone"))}
    <div class="pct-sub">${lz("ApproachesPlayersSeeOnlyTheName")}</div>
    ${listEditor("approaches", t.approaches, (a, p) => `<div class="pct-line">${L(lz("PlayersSee"), F.text(`${p}.label`, a.label, lz("SearchTheArea")), "pct-grow")}${L(lz("Uses"), F.num(`${p}.uses`, a.uses, "any", "pct-dc"))}</div>
      ${L(lz("GMOnly"), F.area(`${p}.gm`, a.gm, lz("WhatItReallyIsAndWhat"), 2), "pct-block")}
      ${L(lz("OnACriticalFailureGMOnly"), F.text(`${p}.critFail`, a.critFail, lz("AConsequenceBesidesTheFailure")), "pct-block")}
      <div class="pct-nested">${listEditor(`${p}.checks`, a.checks, (c, cp) => checkEdit(c, cp, { bare: true }), lz("Skill"))}</div>`, lz("Approach"))}`,

  reputation: (t) => `<div class="pct-line">${L(lz("Lowest"), F.num("min", t.min, "none"))}${L(lz("Highest"), F.num("max", t.max, "none"))}
      ${L(lz("Buttons"), `<input type="text" data-focus-key="steps" data-path="steps" data-type="steps" value="${esc((t.steps ?? []).join(", "))}" placeholder="1, 2, 5" class="pct-dc">`)}
      ${F.bool("showValue", t.showValue, lz("PlayersSeeTheNumber"), lz("OffPlayersSeeOnlyTheTier"))}</div>
    <div class="pct-sub">${lz("TiersFromLowestToHighestA")}</div>
    ${listEditor("tiers", t.tiers, (x, p, i) => `${L(lz("Tier"), F.text(`${p}.label`, x.label), "pct-w8")}${L(i === 0 ? lz("FromLowest") : lz("From"), F.num(`${p}.min`, x.min, "", "pct-dc"))}${L(lz("PlayersSee"), F.text(`${p}.text`, x.text), "pct-grow")}${L(lz("GMOnly"), F.text(`${p}.gm`, x.gm), "pct-grow")}`, lz("Tier"))}`,

  pressure: (t) => `<div class="pct-line">${L(lz("Lowest"), F.num("min", t.min, "none"))}${L(lz("Highest"), F.num("max", t.max, "none"))}
      ${L(lz("Buttons"), `<input type="text" data-focus-key="steps" data-path="steps" data-type="steps" value="${esc((t.steps ?? []).join(", "))}" placeholder="1, 2" class="pct-dc">`)}
      ${F.bool("showValue", t.showValue, lz("PlayersSeeTheNumber"), lz("OffPlayersSeeOnlyTheBand"))}${F.bool("showBand", t.showBand !== false, lz("PlayersSeeTheBand"), lz("OffARevealedTrackShowsPlayers"))}${F.bool("halve", t.halve, lz("HalveButton"))}</div>
    <div class="pct-sub">${lz("BandsFromLowestToHighestA")}</div>
    ${listEditor("tiers", t.tiers, (x, p, i) => `${L(lz("Band"), F.text(`${p}.label`, x.label), "pct-w8")}${L(i === 0 ? lz("FromLowest") : lz("From"), F.num(`${p}.min`, x.min, "", "pct-dc"))}${L(lz("PlayersSee"), F.text(`${p}.text`, x.text), "pct-grow")}${L(lz("GMOnly"), F.text(`${p}.gm`, x.gm), "pct-grow")}`, lz("Band"))}
    <div class="pct-sub">${lz("EventsAtAValueBesidesThe")}</div>${listEditor("thresholds", t.thresholds, (x, p) => thresholdEdit(x, p), lz("Event"))}`,

  points: (t) => `<div class="pct-line">${L(lz("Lowest"), F.num("min", t.min, "none"))}${L(lz("Highest"), F.num("max", t.max, "none"))}
      ${F.bool("showValue", t.showValue, lz("PlayersSeeTheNumber"))}${F.bool("halve", t.halve, lz("HalveButton"))}</div>
    ${degreesEdit(t)}
    <div class="pct-sub">${lz("Thresholds")}</div>${listEditor("thresholds", t.thresholds, (x, p) => thresholdEdit(x, p), lz("Threshold"))}
    <div class="pct-sub">${lz("ChecksThatEarnPoints")}</div>${listEditor("checks", t.checks, (x, p) => checkEdit(x, p), lz("Check"))}`,

  influence: (t) => `<div class="pct-line">${L(lz("Rounds"), F.num("rounds", t.rounds))}${F.bool("showValue", t.showValue !== false, lz("PlayersSeeTheNumber"), lz("OffPlayersSeeTheThresholdsReached"))}</div>
    ${degreesEdit(t)}
    <div class="pct-sub">${lz("InfluenceThresholds")}</div>${listEditor("thresholds", t.thresholds, (x, p) => thresholdEdit(x, p), lz("Threshold"))}
    <div class="pct-sub">${lz("InfluenceSkills")}</div>${listEditor("skills", t.skills, (x, p) => checkEdit(x, p), lz("Skill"))}
    <div class="pct-sub">${lz("Discover")}</div>${listEditor("discovery", t.discovery, (x, p) => checkEdit(x, p), lz("DiscoverCheck"))}
    <div class="pct-sub">${lz("Resistances")}</div>${listEditor("resistances", t.resistances, (x, p) => L(lz("Resistance"), F.text(`${p}.text`, x.text, lz("RaisesTheDCBy2When")), "pct-grow pct-nolabel"), lz("Resistance"))}
    <div class="pct-sub">${lz("Weaknesses")}</div>${listEditor("weaknesses", t.weaknesses, (x, p) => L(lz("Weakness"), F.text(`${p}.text`, x.text, lz("LowersTheDCBy2When")), "pct-grow pct-nolabel"), lz("Weakness"))}
    ${L(lz("PenaltyGMOnly"), F.area("penalty", t.penalty, lz("WhatHappensIfThePartyAntagonizes")), "pct-block")}`,

  research: (t) => `<div class="pct-line">${F.bool("showValue", t.showValue !== false, lz("PlayersSeeTheNumber"), lz("OffPlayersSeeTheThresholdsReached2"))}</div>${degreesEdit(t)}
    <div class="pct-sub">${lz("ResearchThresholds")}</div>${listEditor("thresholds", t.thresholds, (x, p) => thresholdEdit(x, p), lz("Threshold"))}
    <div class="pct-sub">${lz("ResearchChecks")}</div>${listEditor("checks", t.checks, (x, p) => checkEdit(x, p, { research: true }), lz("Check"))}`,

  chase: (t) => `<div class="pct-line">${F.bool("quarry.enabled", t.quarry?.enabled, lz("TrackTheOtherSide"))}${t.quarry?.enabled ? L(lz("Called"), F.text("quarry.label", t.quarry.label, lz("Quarry"))) : ""}</div>
    ${degreesEdit(t)}
    <div class="pct-sub">${lz("Obstacles")}</div>
    ${listEditor("obstacles", t.obstacles, (o, p) => `<div class="pct-line">${L(lz("Obstacle"), F.text(`${p}.name`, o.name), "pct-grow")}${L(lz("Points"), F.num(`${p}.points`, o.points, "", "pct-dc"))}</div>
      ${L(lz("NotesGMOnly"), F.area(`${p}.text`, o.text, "", 2), "pct-block")}
      <div class="pct-nested">${listEditor(`${p}.checks`, o.checks, (c, cp) => checkEdit(c, cp), lz("Check"))}</div>`, lz("Obstacle"))}`,

  infiltration: (t) => `<div class="pct-line">${L(lz("IPGoalOptional"), F.num("objective", t.objective, "none"))}${F.bool("showAwareness", t.showAwareness, lz("PlayersSeeAwareness"))}</div>
    <p class="pct-hint">${lz("TheInfiltrationIsWonWhenThe")}</p>
    ${infiltrationDegreesEdit(t)}
    <div class="pct-sub">${lz("AwarenessThresholds")}</div>${listEditor("awarenessThresholds", t.awarenessThresholds, (x, p) => thresholdEdit(x, p, "AP"), lz("Threshold"))}
    <div class="pct-sub">${lz("Obstacles")}</div>
    ${listEditor("obstacles", t.obstacles, (o, p) => `<div class="pct-line">${L(lz("Obstacle"), F.text(`${p}.name`, o.name), "pct-grow")}${L(lz("Points"), F.num(`${p}.points`, o.points, "", "pct-dc"))}${L(lz("Type"), F.select(`${p}.type`, o.type, [["group", lz("Group")], ["individual", lz("EachPC")]]))}</div>
      ${L(lz("NotesGMOnly"), F.area(`${p}.text`, o.text, "", 2), "pct-block")}
      <div class="pct-nested">${listEditor(`${p}.checks`, o.checks, (c, cp) => checkEdit(c, cp), lz("Check"))}</div>`, lz("Obstacle"))}
    <div class="pct-sub">${lz("Complications")}</div>
    ${listEditor("complications", t.complications, (o, p) => `<div class="pct-line">${L(lz("Complication"), F.text(`${p}.name`, o.name), "pct-grow")}${L(lz("Trigger"), F.text(`${p}.trigger`, o.trigger, "5 AP"))}</div>
      ${L(lz("NotesGMOnly"), F.area(`${p}.text`, o.text, "", 2), "pct-block")}
      <div class="pct-nested">${listEditor(`${p}.checks`, o.checks, (c, cp) => checkEdit(c, cp), lz("Check"))}</div>`, lz("Complication"))}
    <div class="pct-sub">${lz("Opportunities")}</div>
    ${listEditor("opportunities", t.opportunities, (o, p) => `<div class="pct-line">${L(lz("Opportunity"), F.text(`${p}.name`, o.name), "pct-grow")}</div>
      ${L(lz("NotesGMOnly"), F.area(`${p}.text`, o.text, "", 2), "pct-block")}
      <div class="pct-nested">${listEditor(`${p}.checks`, o.checks, (c, cp) => checkEdit(c, cp), lz("Check"))}</div>`, lz("Opportunity"))}`,

  clock: (t) => `<div class="pct-line">${L(lz("Segments"), `<input type="number" data-focus-key="segments" data-path="segments" data-type="segcount" value="${t.segments.length}" min="1" max="24" class="pct-num pct-dc">`)}
      ${F.bool("ordered", t.ordered, lz("FillsInOrder"), lz("OnEachDateFillsTheNext"))}
      ${F.bool("showLabels", t.showLabels, lz("PlayersSeeSegmentNames"))}</div>
    ${listEditor("segments", t.segments, (s, p) => `${L(lz("Segment"), F.text(`${p}.label`, s.label), "pct-grow")}${L(lz("Date"), F.date(`${p}.date`, s.date))}${L(lz("NotesGMOnly"), F.text(`${p}.text`, s.text), "pct-grow")}`, lz("Segment"))}`,

  checklist: (t) => listEditor("entries", t.entries, (e, p) => `<div class="pct-line">${L(lz("Group"), F.text(`${p}.group`, e.group), "pct-w8")}${L(lz("Entry"), F.text(`${p}.label`, e.label), "pct-grow")}${L(lz("Tag"), F.text(`${p}.tag`, e.tag, "hidden"), "pct-w6")}${L(lz("Closes"), F.date(`${p}.closes`, e.closes))}</div>
      <div class="pct-line">${L(lz("EarnedByGMOnly"), F.text(`${p}.detail`, e.detail), "pct-grow")}${L(lz("PaysOffGMOnly"), F.text(`${p}.effect`, e.effect), "pct-grow")}</div>`, lz("Entry")),
};

function editView(t) {
  return `<div class="pct-edit">
      <div class="pct-line">${L(lz("Name"), F.text("name", t.name), "pct-grow")}</div>
      ${L(lz("PlayersSee"), F.area("desc", t.desc, lz("ADescriptionShownToPlayersWhen")), "pct-block")}
      ${L(lz("GMNotes"), F.area("notes", t.notes, lz("OnlyTheGMSeesThese"), 3), "pct-block")}
      ${EDIT[t.kind](t)}
    </div>`;
}


export { goalEdit, linkEdit, openDetails, leadCluesEdit, onDoneEdit, QEDIT, partyGoalEdit, QEDIT_PARTY, EDIT, editView };
