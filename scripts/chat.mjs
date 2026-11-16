/** Chat cards: the GM's Apply box on roll cards, proposals, check cards, completion and follow cards. */

import { esc, tipAttr } from "./kit/safe-text.mjs";
import { FREE_TID, applyRoll, locate, parseTag, rollAs, rollCheck, rollTitle, rollers, shortText, skillLabel } from "./checks.mjs";
import { KIND_INFO, MOD, SCOPE, clone, lz, num, para } from "./core.mjs";
import { TPL, bounds, clamp, completionOffers, findGoal, findRow, leadClues, leadOffers, nullNum, offerRows, revealLabel, revealLeadOffers, revealRow, rowShown } from "./data.mjs";
import { SKILLS, partyMembers, pcName } from "./html.mjs";
import { dcStepButtons, levelDC } from "./rules.mjs";
import { Store, mutate, mutateTracker, shown, visibleTrackers } from "./store.mjs";

/* ------------------------------------------------------------------ */
/* Chat                                                                */
/* ------------------------------------------------------------------ */

const gmIds = () => game.users.filter((u) => u.isGM).map((u) => u.id);

function whisperGM(lines, icon = "fa-solid fa-bell", title = "Campaign Trackers") {
  if (!game.user.isGM || !lines.length) return;
  return ChatMessage.create({
    content: `<div class="pct-chat"><header><i class="${icon}"></i> <strong>${esc(title)}</strong></header><ul>${lines.map((l) => `<li>${l}</li>`).join("")}</ul></div>`,
    speaker: { alias: "Campaign Trackers" },
    whisper: gmIds(),
  });
}

/**
 * Post checks as buttons anyone can click to roll: the checks of one obstacle, complication or
 * opportunity (target), or the revealed checks of a list such as influence skills (list).
 */
async function postCheckCard(t, { target = null, list = null } = {}) {
  let checks, title, text = "";
  if (list) {
    checks = (t[list] ?? []).filter((c) => c.revealed).map((c) => ({ ...c, target: c.id }));
    title = `${t.name}${list === "discovery" ? ": Discover" : ""}`;
  } else {
    const where = locate(t, target);
    if (!where) return;
    checks = (where.type === "main" ? where.checks.filter((c) => c.revealed) : where.checks).map((c) => ({ ...c, target }));
    title = rollTitle(t, target);
    if (where.type !== "main" && where.obj.text && where.obj.revealed && t.kind !== "chase" && t.kind !== "infiltration") text = `<p>${para(where.obj.text)}</p>`;
  }
  if (!checks.length) return ui.notifications.warn(list || target === "main" ? lz("RevealAtLeastOneCheckFirst") : lz("ThereAreNoChecksToPost"));
  const buttons = checks.map((c) => `<button type="button" data-pct-roll="${esc(c.id)}"><strong>${esc(skillLabel(c.skill))}</strong>${c.label ? ` <span>${esc(c.label)}</span>` : ""}</button>`).join("");
  await ChatMessage.create({
    content: `<div class="pct-chat pct-request"><header><i class="${KIND_INFO[t.kind].icon}"></i> <strong>${esc(title)}</strong></header>${text}<div class="pct-req">${buttons}</div><p class="pct-hint">${lz("SelectYourTokenAndClickA")}</p></div>`,
    speaker: { alias: t.name || KIND_INFO[t.kind].label },
    flags: { [SCOPE]: { request: { tid: t.id, title, checks: checks.map((c) => ({ id: c.id, skill: c.skill, dc: c.dc, label: c.label, target: c.target })) } } },
  });
}

/** The skills a challenge's approaches use, each once, in the order they first appear. */
function challengeSkills(t) {
  return [...new Set(t.approaches.flatMap((a) => a.checks.map((c) => String(c.skill || "").trim().toLowerCase()).filter(Boolean)))];
}

/**
 * Post a skill challenge to chat. "skills" lists every skill its approaches use, hidden ones
 * included, with no buttons and no DCs: players say what they do. "options" lists the revealed
 * approaches by their players' names, each with its skills as roll buttons (no DCs shown).
 */
async function postChallengeCard(t, mode) {
  const head = `<header><i class="${KIND_INFO.challenge.icon}"></i> <strong>${esc(t.name)}</strong></header>`;
  const desc = t.desc ? `<p>${para(t.desc)}</p>` : "";
  const speaker = { alias: t.name || KIND_INFO.challenge.label };
  if (mode === "skills") {
    const skills = challengeSkills(t);
    if (!skills.length) return ui.notifications.warn(lz("GiveTheApproachesSomeSkillsFirst"));
    return ChatMessage.create({
      content: `<div class="pct-chat pct-challenge">${head}${desc}<p>${lz("SkillsThatCouldHelp")}</p><ul class="pct-skill-list">${skills.map((x) => `<li>${esc(skillLabel(x))}</li>`).join("")}</ul><p class="pct-hint">${lz("SayWhatYourCharacterDoesAnd")}</p>${PROPOSE_BTN(t.id)}</div>`,
      speaker,
      flags: { [SCOPE]: { challenge: { tid: t.id, mode, name: t.name, explain: t.explain !== false } } },
    });
  }
  const open = shown(t.approaches).filter((a) => a.checks.some((c) => c.skill) && !(nullNum(a.uses) !== null && num(a.used) >= num(a.uses)));
  if (!open.length) return ui.notifications.warn(lz("RevealAtLeastOneApproachWith"));
  const checks = [];
  const blocks = open.map((a) => {
    const title = a.label ? `${t.name}: ${a.label}` : t.name;
    const mine = a.checks.filter((c) => c.skill).map((c) => ({ id: c.id, skill: c.skill, dc: c.dc, label: "", target: a.id, title }));
    checks.push(...mine);
    const left = nullNum(a.uses) !== null ? Math.max(0, num(a.uses) - num(a.used)) : null;
    return `<div class="pct-opt"><strong>${esc(a.label || lz("AnotherWay"))}</strong>${left !== null ? ` <span class="pct-hint">${lz(left === 1 ? "UseLeft" : "UsesLeft", { n: left })}</span>` : ""}<div class="pct-req pct-req-row">${mine.map((c) => `<button type="button" data-pct-roll="${esc(c.id)}"><i class="fa-solid fa-dice-d20"></i> ${esc(skillLabel(c.skill))}</button>`).join("")}</div></div>`;
  }).join("");
  return ChatMessage.create({
    content: `<div class="pct-chat pct-request pct-challenge">${head}${desc}${blocks}<p class="pct-hint">${lz("SelectYourTokenAndClickA2")}</p>${PROPOSE_BTN(t.id)}</div>`,
    speaker,
    flags: { [SCOPE]: { challenge: { tid: t.id, mode, name: t.name, explain: t.explain !== false }, request: { tid: t.id, title: t.name, hideDC: true, checks } } },
  });
}

/** An approach the DC prefill may pick: revealed, and not used up. Hidden or spent ones are the GM's to pick by hand. */
const prefillable = (a) => a.revealed && !(nullNum(a.uses) !== null && num(a.used) >= num(a.uses));


/** An actor's skills as [slug, label], Perception first, lores included. */
function actorSkills(actor) {
  const out = [];
  if (actor?.perception) out.push(["perception", lz("Perception")]);
  for (const st of Object.values(actor?.skills ?? {})) if (st?.slug) out.push([st.slug, st.label ?? skillLabel(st.slug)]);
  return out;
}

const PROPOSE_BTN = (tid) => `<p class="pct-propose"><button type="button" data-pct-propose="${esc(tid)}"><i class="fa-solid fa-lightbulb"></i> ${lz("ProposeAnApproach")}</button></p>`;

/**
 * A player proposes an approach to a skill challenge, or a check in free play (no tid): a skill of
 * their character, what they do and why the skill fits. It goes to chat as a card the GM approves or declines.
 */
async function proposeDialog(tid, fallback = {}) {
  const t = tid ? visibleTrackers().find((x) => x.id === tid) : null;
  const name = tid ? t?.name ?? fallback.name ?? KIND_INFO.challenge.label : lz("Proposal");
  const explain = (t ? t.explain : fallback.explain) !== false;
  const actor = rollers()[0];
  if (!actor) return ui.notifications.warn(game.user.isGM ? lz("SelectTheTokenOfTheCharacter") : lz("SelectYourTokenOrAskThe"));
  const skills = actorSkills(actor);
  if (!skills.length) return ui.notifications.warn(lz("HasNoSkillsToProposeWith", { name: esc(actor.name) }));
  const opt = explain ? "" : " (optional)";
  let v = { skill: skills.find(([x]) => x !== "perception")?.[0] ?? skills[0][0], what: "", why: "" };
  for (;;) {
    const res = await foundry.applications.api.DialogV2.wait({
      window: { title: tid ? lz("ProposeName", { name }) : lz("ProposeACheck") },
      classes: ["pct-propose-dialog"],
      content: `<p>${lz("ProposingFor")} <strong>${esc(pcName(actor))}</strong>.</p>
        <div class="form-group"><label>${lz("Skill")}</label><select name="skill">${skills.map(([x, l]) => `<option value="${esc(x)}" ${x === v.skill ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>
        <div class="form-group stacked"><label>${lz("WhatDoYouDo", { opt: opt })}</label><textarea name="what" rows="2">${esc(v.what)}</textarea></div>
        <div class="form-group stacked"><label>${lz("WhyDoesThisSkillFit", { opt: opt })}</label><textarea name="why" rows="2">${esc(v.why)}</textarea></div>`,
      buttons: [
        { action: "send", label: lz("Propose"), icon: "fa-solid fa-lightbulb", default: true, callback: (ev, button) => {
          const f = button.form.elements;
          return { skill: f.skill.value, what: f.what.value.trim(), why: f.why.value.trim() };
        } },
        { action: "cancel", label: lz("Cancel") },
      ],
      rejectClose: false,
    });
    if (!res || res === "cancel" || typeof res !== "object") return;
    v = res;
    if (explain && (!v.what || !v.why)) {
      ui.notifications.warn(lz("SayWhatYourCharacterDoesAnd"));
      continue;
    }
    break;
  }
  await ChatMessage.create({
    content: `<div class="pct-chat pct-proposal"><header><i class="fa-solid fa-lightbulb"></i> <strong>${esc(name)}</strong></header>
      <p><span class="pct-k">${lz("Proposes")}</span> <strong>${esc(skillLabel(v.skill))}</strong></p>
      ${v.what ? `<p>${para(v.what)}</p>` : ""}${v.why ? `<p><span class="pct-k">${lz("Why")}</span> ${para(v.why)}</p>` : ""}
      <div class="pct-prop-state"></div></div>`,
    speaker: ChatMessage.getSpeaker({ actor }),
    flags: { [SCOPE]: { proposal: { tid: tid || null, actorId: actor.id, userId: game.user.id, skill: v.skill, what: v.what, why: v.why, status: "pending" } } },
  });
}

/**
 * A proposal card's flags as far as they can be trusted. The player owns the message and can change its flags, so
 * an answer (approved, declined, rolled) counts only when a GM changed the message last; otherwise it's still waiting.
 */
function proposalOf(message) {
  const prop = message?.getFlag?.(SCOPE, "proposal");
  if (!prop || prop.status === "pending") return prop ?? null;
  if (game.users.get(message._stats?.lastModifiedBy)?.isGM) return prop;
  const { finalSkill, dc, target, checkId, title, rolled, reason, ...rest } = prop;
  return { ...rest, status: "pending" };
}

/** The live part of a proposal card: the GM's controls while it waits, then the roll button or the answer. */
function renderProposal(message, prop, root) {
  const box = root.querySelector(".pct-prop-state");
  if (!box) return;
  const actor = game.actors.get(prop.actorId) ?? null;
  const skill = prop.finalSkill || prop.skill;
  if (prop.status === "declined") {
    box.innerHTML = `<p class="pct-prop-no"><i class="fa-solid fa-xmark"></i> ${lz("NotThisTime")}${prop.reason ? `: ${esc(prop.reason)}` : "."}</p>`;
    return;
  }
  if (prop.status === "approved") {
    const swapped = skill !== prop.skill ? ` as <strong>${esc(skillLabel(skill))}</strong>` : "";
    const dc = game.user.isGM && prop.dc !== null && prop.dc !== undefined ? ` <span class="pct-hint">DC ${esc(prop.dc)}</span>` : "";
    if (prop.rolled) {
      box.innerHTML = `<p class="pct-prop-ok"><i class="fa-solid fa-check"></i> ${lz("ApprovedRolled", { swapped: swapped, dc: dc })}</p>`;
      return;
    }
    const can = game.user.isGM || actor?.isOwner;
    box.innerHTML = `<p class="pct-prop-ok"><i class="fa-solid fa-check"></i> ${lz("Approved", { swapped: swapped, dc: dc })}</p>${can ? `<div class="pct-req"><button type="button" data-pct-prop-roll><i class="fa-solid fa-dice-d20"></i> ${lz("Roll", { skill: esc(skillLabel(skill)) })}${actor ? ` for ${esc(pcName(actor))}` : ""}</button></div>` : ""}`;
    box.querySelector("[data-pct-prop-roll]")?.addEventListener("click", async (ev) => {
      ev.preventDefault();
      if (!actor) return ui.notifications.warn(lz("TheCharacterWhoProposedThisNo"));
      const b = ev.currentTarget;
      b.disabled = true;
      const roll = await rollAs(actor, { tid: prop.tid || FREE_TID, target: prop.target, check: { id: prop.checkId, skill, dc: prop.dc }, title: prop.title, hideDC: true });
      // The active GM marks the card rolled when the roll arrives (see createChatMessage below).
      if (!roll) b.disabled = false;
    });
    return;
  }
  if (!game.user.isGM) {
    box.innerHTML = `<p class="pct-hint">${lz("WaitingForTheGM")}</p>`;
    return;
  }
  box.replaceChildren(proposalControls(message, prop, actor));
}

/** The GM's controls on a waiting proposal: skill, DC, which approach it counts as, approve or decline. */
function proposalControls(message, prop, actor) {
  const el = document.createElement("div");
  el.className = "pct-prop-gm";
  const free = !prop.tid;
  const t = free ? null : Store.get(prop.tid);
  if (!free && !t) {
    el.innerHTML = `<p class="pct-hint">${lz("ThatSkillChallengeNoLongerExists")}</p>`;
    return el;
  }
  const skills = actorSkills(actor);
  if (!skills.some(([x]) => x === prop.skill)) skills.unshift([prop.skill, skillLabel(prop.skill)]);
  el.innerHTML = `<div class="pct-prop-row"><label>${lz("Skill")} <select name="skill">${skills.map(([x, l]) => `<option value="${esc(x)}" ${x === prop.skill ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
      <label>DC <input type="number" name="dc" placeholder="${esc(levelDC(0) === null ? lz("SetADC") : "")}"></label>
      ${dcStepButtons()}</div>
    ${free ? "" : `<div class="pct-prop-row"><label>${lz("CountsAs")} <select name="approach"><option value="">${lz("OnItsOwn")}</option>${t.approaches.map((a) => `<option value="${esc(a.id)}">${esc(a.label || lz("UnnamedApproach"))}${a.revealed ? "" : lz("HiddenSuffix")}</option>`).join("")}</select></label>
      <label class="pct-prop-save" ${tipAttr(lz("AddItToTheChallengeS"))}><input type="checkbox" name="save"> ${lz("SaveAsAnApproach")}</label></div>`}
    <div class="pct-prop-row"><button type="button" data-act="approve"><i class="fa-solid fa-check"></i> ${lz("Approve")}</button></div>
    <div class="pct-prop-row"><input type="text" name="reason" placeholder="${esc(lz("ReasonIfYouDeclineOptional"))}"><button type="button" data-act="decline"><i class="fa-solid fa-xmark"></i> ${lz("Decline")}</button></div>`;
  const $ = (n) => el.querySelector(`[name="${n}"]`);
  const sync = () => {
    if (free) return;
    const linked = !!$("approach").value;
    $("save").disabled = linked;
    if (linked) $("save").checked = false;
  };
  // An approach that already uses the skill gives the DC and the link; otherwise the character's level does.
  const prefill = () => {
    if (free) return void ($("dc").value = levelDC(actor?.level ?? 0) ?? "");
    const skill = $("skill").value;
    const a = t.approaches.find((x) => prefillable(x) && x.checks.some((c) => String(c.skill).toLowerCase() === skill && c.dc !== null && c.dc !== ""));
    const c = a?.checks.find((x) => String(x.skill).toLowerCase() === skill);
    $("dc").value = c ? num(c.dc) : (levelDC(actor?.level ?? 0) ?? "");
    $("approach").value = a?.id ?? "";
    sync();
  };
  prefill();
  $("skill").addEventListener("change", prefill);
  $("approach")?.addEventListener("change", sync);
  for (const b of el.querySelectorAll("[data-adj]")) b.addEventListener("click", (ev) => {
    ev.preventDefault();
    $("dc").value = num($("dc").value) + Number(b.dataset.adj);
  });
  el.querySelector('[data-act="approve"]').addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.currentTarget.disabled = true;
    const dc = $("dc").value === "" ? null : num($("dc").value);
    const pick = { skill: $("skill").value, dc, approach: $("approach")?.value ?? "", save: !!$("save")?.checked };
    onceFor(message, (m) => (free ? approveFree(m, prop, pick) : approveProposal(m, prop, pick)));
  });
  el.querySelector('[data-act="decline"]').addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.currentTarget.disabled = true;
    const reason = $("reason").value.trim();
    onceFor(message, async (m) => {
      if (proposalOf(m)?.status !== "pending") return;
      await m.update({ [`flags.${SCOPE}.proposal`]: { ...prop, status: "declined", reason } });
    });
  });
  return el;
}

/** Approve a free-play proposal: the skill and DC, and the roll button for its character. */
async function approveFree(message, prop, { skill, dc }) {
  if (!game.user.isGM || proposalOf(message)?.status !== "pending") return;
  const id = foundry.utils.randomID(10);
  await message.update({ [`flags.${SCOPE}.proposal`]: { ...prop, status: "approved", finalSkill: skill, dc, target: id, checkId: id, title: shortText(prop.what) || skillLabel(skill) } });
}

/**
 * Approve a proposal: link it to an approach, or save it as a new one, and open its roll. The roll
 * targets a row in the GM's data (like a check called on the fly), so it applies even if the
 * proposal is deleted, and nothing the player can edit on their own message decides what it counts as.
 */
async function approveProposal(message, prop, { skill, dc, approach, save }) {
  const t = Store.get(prop.tid);
  if (!t || !game.user.isGM) return;
  if (proposalOf(message)?.status !== "pending") return;
  const what = shortText(prop.what) || skillLabel(skill);
  let linked = approach ? t.approaches.find((x) => x.id === approach) ?? null : null;
  let added = null;
  if (!linked && save) {
    const who = pcName(game.actors.get(prop.actorId));
    // Ids from the proposal's message: a second GM approving the same card finds them already there.
    added = { ...TPL.approach(), id: `pa${message.id}`, label: what, gm: `${lz("ProposedBy", { who: who })}${prop.why ? ` ${prop.why}` : ""}`, revealed: true, checks: [{ ...TPL.check(), skill, dc }] };
  }
  const row = { ...TPL.adhoc(), id: `pp${message.id}`, skill, dc, label: what, approach: (linked ?? added)?.id ?? null };
  const ok = await mutateTracker(t.id, (tr) => {
    if ((tr.adhoc ?? []).some((x) => x.id === row.id)) return undefined;
    if (added && !tr.approaches.some((x) => x.id === added.id)) tr.approaches.push(added);
    tr.adhoc = [...(tr.adhoc ?? []), row].slice(-200);
    return true;
  }, { notify: false });
  if (!ok) return;
  // A hidden approach's name stays off the public roll card.
  const title = `${t.name}: ${linked?.revealed && linked.label ? linked.label : what}`;
  await message.update({ [`flags.${SCOPE}.proposal`]: { ...prop, status: "approved", finalSkill: skill, dc, target: row.id, checkId: row.id, title } });
}

/**
 * The GM calls for a check on the fly: which characters, which skill, the DC (from a matching
 * approach, else the highest chosen level), and what it counts as. Then a chat card with a roll
 * button for each character, or the rolls at once.
 */
async function adhocDialog(t) {
  const pcs = partyMembers();
  if (!pcs.length) return ui.notifications.warn(lz("ThereAreNoPlayerCharactersTo"));
  const skills = new Map([["perception", lz("Perception")], ...SKILLS.filter((x) => !["perception", "fortitude", "reflex", "will"].includes(x)).map((x) => [x, skillLabel(x)])]);
  for (const a of pcs) for (const [x, l] of actorSkills(a)) if (!skills.has(x)) skills.set(x, l);
  const lc = (x) => String(x ?? "").trim().toLowerCase();
  const controlled = (globalThis.canvas?.tokens?.controlled ?? []).map((x) => x.actor?.id).filter(Boolean);
  let v = { pcs: new Set(pcs.filter((a) => controlled.includes(a.id)).map((a) => a.id)), skill: challengeSkills(t)[0] ?? "perception", dc: undefined, approach: "", what: "", auto: false };
  for (;;) {
    const read = (mode) => (ev, button) => {
      const f = button.form;
      return { mode, pcs: new Set([...f.querySelectorAll("input[name=pc]:checked")].map((i) => i.value)), skill: f.elements.skill.value, dc: f.elements.dc.value, approach: f.elements.approach.value, what: f.elements.what.value.trim(), auto: !!f.elements.auto?.checked };
    };
    const res = await foundry.applications.api.DialogV2.wait({
      window: { title: lz("CheckName", { name: t.name }) },
      classes: ["pct-adhoc-dialog"],
      content: `<div class="form-group"><label>${lz("Who")}</label><div class="form-fields pct-pcs">${pcs.map((a) => `<label><input type="checkbox" name="pc" value="${esc(a.id)}" ${v.pcs.has(a.id) ? "checked" : ""}> ${esc(pcName(a))}</label>`).join("")}</div></div>
        <div class="form-group"><label>${lz("Skill")}</label><select name="skill">${[...skills].map(([x, l]) => `<option value="${esc(x)}" ${x === v.skill ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>
        <div class="form-group"><label>DC</label><div class="form-fields"><input type="number" name="dc" value="${esc(v.dc ?? "")}" placeholder="${esc(levelDC(0) === null ? lz("SetADC") : "")}">${dcStepButtons()}</div></div>
        <div class="form-group"><label>${lz("CountsAs")}</label><select name="approach"><option value="">${lz("OnItsOwn")}</option>${t.approaches.map((a) => `<option value="${esc(a.id)}" ${a.id === v.approach ? "selected" : ""}>${esc(a.label || lz("UnnamedApproach"))}${a.revealed ? "" : lz("HiddenSuffix")}</option>`).join("")}</select></div>
        <div class="form-group"><label>${lz("For")}</label><input type="text" name="what" value="${esc(v.what)}" placeholder="${esc(lz("WhatTheyReDoingOptional"))}"></div>
        <div class="form-group"><label class="checkbox"><input type="checkbox" name="auto" ${v.auto ? "checked" : ""}> ${lz("ApplyTheseAsTheyAreRolled")}</label></div>
        <p class="hint">${lz("PlayersSeeTheResultNotThe")}</p>`,
      render: (ev, d) => {
        const root = d instanceof HTMLElement ? d : d?.element;
        if (!root) return;
        const $ = (n) => root.querySelector(`[name="${n}"]`);
        const prefill = (fromSkill) => {
          const skill = $("skill").value;
          const hasDC = (c) => lc(c.skill) === skill && c.dc !== null && c.dc !== "";
          if (fromSkill) $("approach").value = t.approaches.find((a) => prefillable(a) && a.checks.some(hasDC))?.id ?? "";
          const c = t.approaches.find((a) => a.id === $("approach").value)?.checks.find(hasDC);
          const chosen = [...root.querySelectorAll("input[name=pc]:checked")].map((i) => game.actors.get(i.value));
          const levels = (chosen.length ? chosen : pcs).map((a) => num(a?.level));
          $("dc").value = c ? num(c.dc) : (levelDC(Math.max(0, ...levels)) ?? "");
        };
        if (v.dc === undefined) prefill(true);
        $("skill").addEventListener("change", () => prefill(true));
        $("approach").addEventListener("change", () => prefill(false));
        for (const i of root.querySelectorAll("input[name=pc]")) i.addEventListener("change", () => prefill(false));
        for (const b of root.querySelectorAll("[data-adj]")) b.addEventListener("click", (e) => {
          e.preventDefault();
          $("dc").value = num($("dc").value) + Number(b.dataset.adj);
        });
      },
      buttons: [
        { action: "send", label: lz("SendToPlayers"), icon: "fa-solid fa-share-from-square", default: true, callback: read("send") },
        { action: "roll", label: lz("RollNow"), icon: "fa-solid fa-dice-d20", callback: read("roll") },
        { action: "cancel", label: lz("Cancel") },
      ],
      rejectClose: false,
    });
    if (!res || typeof res !== "object") return;
    v = res;
    if (!v.pcs.size) {
      ui.notifications.warn(lz("PickAtLeastOneCharacter"));
      continue;
    }
    break;
  }
  const dc = v.dc === "" ? null : num(v.dc);
  const linked = t.approaches.find((a) => a.id === v.approach) ?? null;
  const row = { ...TPL.adhoc(), skill: v.skill, dc, label: v.what, approach: linked?.id ?? null, auto: !!v.auto, actors: [...v.pcs] };
  await mutateTracker(t.id, (tr) => {
    tr.adhoc = [...(tr.adhoc ?? []), row].slice(-200);
  }, { notify: false });
  const title = `${t.name}: ${v.what ? shortText(v.what) : (linked?.revealed && linked.label) || skillLabel(v.skill)}`;
  const ids = [...v.pcs];
  if (v.mode === "roll") {
    for (const id of ids) {
      const actor = game.actors.get(id);
      if (actor) await rollAs(actor, { tid: t.id, target: row.id, check: { id: row.id, skill: v.skill, dc }, title, hideDC: true });
    }
    return;
  }
  await ChatMessage.create({
    content: `<div class="pct-chat pct-adhoc"><header><i class="${KIND_INFO.challenge.icon}"></i> <strong>${esc(t.name)}</strong></header>
      <p><strong>${esc(skillLabel(v.skill))}</strong>${v.what ? `: ${esc(v.what)}` : ""}</p><div class="pct-adhoc-state"></div></div>`,
    speaker: { alias: t.name || KIND_INFO.challenge.label },
    flags: { [SCOPE]: { adhoc: { tid: t.id, row: row.id, actors: ids, skill: v.skill, dc, title, rolled: {} } } },
  });
}

/** A check card from the GM: a roll button for each character, for that character's owner. */
function renderAdhoc(message, ad, root) {
  const box = root.querySelector(".pct-adhoc-state");
  if (!box) return;
  box.innerHTML = `${game.user.isGM && ad.dc !== null && ad.dc !== undefined ? `<p class="pct-hint">DC ${esc(ad.dc)}</p>` : ""}<div class="pct-req pct-req-row"></div>`;
  const row = box.querySelector(".pct-req");
  for (const id of ad.actors ?? []) {
    const actor = game.actors.get(id);
    const name = actor ? pcName(actor) : "?";
    if (ad.rolled?.[id]) {
      row.insertAdjacentHTML("beforeend", `<span class="pct-adhoc-done"><i class="fa-solid fa-check"></i> ${esc(name)}</span>`);
    } else if (actor && (game.user.isGM || actor.isOwner)) {
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML = `<i class="fa-solid fa-dice-d20"></i> ${esc(name)}`;
      b.addEventListener("click", async (ev) => {
        ev.preventDefault();
        b.disabled = true;
        const roll = await rollAs(actor, { tid: ad.tid, target: ad.row, check: { id: ad.row, skill: ad.skill, dc: ad.dc }, title: ad.title, hideDC: true });
        if (!roll) b.disabled = false;
      });
      row.append(b);
    } else {
      row.insertAdjacentHTML("beforeend", `<span class="pct-hint">${esc(name)}</span>`);
    }
  }
}

/**
 * What applying a roll changed in a tracker, so it can be undone without touching anything changed
 * since: numbers as amounts, other values as from and to, rows added to a list by their id, rows it pushed out (a
 * list kept to a length) whole with their place. A step through a list of rows is the row's id, so later reordering
 * or trimming doesn't misplace it.
 */
function diffTracker(a, b, path = []) {
  const out = [];
  if (Array.isArray(b)) {
    const old = Array.isArray(a) ? a : [];
    if (!b.every((x) => x && typeof x === "object" && x.id)) return out;
    for (const row of b) {
      const was = old.find((x) => x?.id === row.id);
      if (!was) out.push({ path, add: row.id });
      else out.push(...diffTracker(was, row, [...path, { id: row.id }]));
    }
    old.forEach((row, at) => {
      if (row?.id && !b.some((x) => x?.id === row.id)) out.push({ path, remove: clone(row), at });
    });
    // Rows both have, in another order (a move): the order they had.
    const was = old.map((x) => x?.id).filter((id) => id && b.some((x) => x.id === id));
    const now = b.map((x) => x.id).filter((id) => old.some((x) => x?.id === id));
    if (was.join("\n") !== now.join("\n")) out.push({ path, order: was });
    return out;
  }
  if (b && typeof b === "object") {
    for (const k of new Set([...Object.keys(a ?? {}), ...Object.keys(b)])) out.push(...diffTracker(a?.[k], b[k], [...path, k]));
    return out;
  }
  if (a !== b && !(a === undefined && b === undefined)) out.push({ path, from: a ?? null, to: b ?? null });
  return out;
}

function walkPath(obj, path) {
  let at = obj;
  for (const step of path) {
    if (at == null) return undefined;
    at = typeof step === "object" ? (Array.isArray(at) ? at.find((x) => x?.id === step.id) : undefined) : at[step];
  }
  return at;
}

/** Take back what diffTracker recorded: numbers by the amount they moved, the rest only if unchanged since. */
function undoChanges(t, changes) {
  for (const c of changes ?? []) {
    if (c.add) {
      const list = walkPath(t, c.path);
      const i = Array.isArray(list) ? list.findIndex((x) => x?.id === c.add) : -1;
      if (i >= 0) list.splice(i, 1);
      continue;
    }
    if (c.remove) {
      const list = walkPath(t, c.path);
      if (Array.isArray(list) && !list.some((x) => x?.id === c.remove.id)) list.splice(Math.min(num(c.at), list.length), 0, clone(c.remove));
      continue;
    }
    if (c.order) {
      // The rows it knew go back into that order, in the places such rows hold now; others stay where they are.
      const list = walkPath(t, c.path);
      if (!Array.isArray(list)) continue;
      const pos = new Map(c.order.map((id, i) => [id, i]));
      const known = list.filter((x) => pos.has(x?.id)).sort((x, y) => pos.get(x.id) - pos.get(y.id));
      let k = 0;
      for (let i = 0; i < list.length; i++) if (pos.has(list[i]?.id)) list[i] = known[k++];
      continue;
    }
    const parent = walkPath(t, c.path.slice(0, -1));
    const key = c.path.at(-1);
    if (!parent || typeof parent !== "object" || typeof key === "object") continue;
    if (typeof c.to === "number" && (c.from === null || typeof c.from === "number")) {
      const back = num(parent[key]) - (c.to - num(c.from));
      // Never past a field's limits: a plain field has its own; anything inside a row stops at 0.
      const [lo, hi] = c.path.every((x) => typeof x === "string") ? bounds(t, c.path.join(".")) : [0, null];
      if (c.from === null && back === 0) delete parent[key];
      else parent[key] = clamp(back, lo, hi);
    } else if (parent[key] === c.to) parent[key] = c.from;
  }
}

/** An approach's GM-only consequence for a critical failure, shown on the GM's Apply box (never stored on the card). */
function critFailNote(t, target, outcome) {
  if (t?.kind !== "challenge" || outcome !== "criticalFailure") return "";
  const where = locate(t, target);
  return where?.type === "approach" ? String(where.obj.critFail ?? "").trim() : "";
}

/** Apply a roll and record what it changed. Returns { text, changes } or null. */
function applyRecorded(tr, args) {
  const before = clone(tr);
  const text = applyRoll(tr, args);
  return typeof text === "string" && text ? { text, changes: diffTracker(before, tr) } : null;
}

/** The line a roll card's Apply box shows ("+1 success (2 of 4)"), from the tracker as it is now. */
function previewText(t, args, prior) {
  const copy = clone(t);
  if (prior) undoChanges(copy, prior.changes);
  return applyRoll(copy, args);
}
/** The Apply line's words, for a result to apply or one with no points set. */
const previewLine = (t, args, prior) => {
  const p = previewText(t, args, prior);
  return typeof p === "object" && p ? p.unset : p;
};
/** Roll cards drawn with an Apply line, by message id, so the line can follow its tracker as other rolls are applied. */
const previewShown = new Map();
/** Draw again the roll cards whose Apply line no longer matches their tracker. */
function refreshPreviews(tids = null) {
  if (!game.user.isGM) return;
  for (const [id, p] of previewShown) {
    if (tids && !tids.has(p.tid)) continue;
    // Its own Apply is under way: the tracker already counts this roll and the card's flag is about to land.
    if (busyCards.has(id)) continue;
    const m = game.messages.get(id);
    const t = Store.get(p.tid);
    if (!m || !t || m.getFlag(SCOPE, "applied") || m.getFlag(SCOPE, "replaced")) {
      previewShown.delete(id);
      continue;
    }
    if (previewLine(t, p.args, p.prior) === p.text) continue;
    previewShown.delete(id);
    ui.chat.updateMessage(m);
  }
}

/**
 * A reroll (a hero point) deletes the roll card and posts a new one. When the first card had been
 * applied, what it applied is kept here for a short while, so the new card can offer to replace it.
 */
const rerollStash = new Map();
const rerollKey = (message) => {
  const ctx = message.flags?.pf2e?.context;
  const tag = ctx?.options?.find((o) => typeof o === "string" && o.startsWith(`${MOD}:`));
  return tag ? `${tag}|${ctx.actor ?? ""}` : null;
};
function priorApplied(message) {
  // Once replaced, the first roll's result is gone: an Undo after that leaves a plain Apply.
  if (message.getFlag(SCOPE, "replaced")) return null;
  const flagged = message.getFlag(SCOPE, "rerolled");
  if (flagged) return flagged;
  if (!message.flags?.pf2e?.context?.isReroll) return null;
  const hit = rerollStash.get(rerollKey(message));
  return hit && Date.now() - hit.at < 120000 ? hit : null;
}

/**
 * Card actions (Apply, Undo, Replace, approve, decline) run one at a time per card, on the card as it is when the
 * click lands.
 */
const busyCards = new Set();
async function onceFor(message, fn) {
  if (busyCards.has(message.id)) return;
  busyCards.add(message.id);
  try {
    await fn(game.messages?.get(message.id) ?? message);
  } finally {
    busyCards.delete(message.id);
  }
}

/** Give every player Observer on a loot actor, so they can open it and take what's inside. */
async function letPlayersOpen(uuid) {
  const actor = uuid ? await fromUuid(uuid) : null;
  const OBS = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
  if (!actor || num(actor.ownership?.default) >= OBS) return false;
  await actor.update({ "ownership.default": OBS });
  return true;
}

/** A reward's loot actor that players can't open yet, or null. */
async function lootToOpen(t, rewardId) {
  const r = (t.rewards ?? []).find((x) => x.id === rewardId);
  if (!r?.actor?.uuid) return null;
  const actor = await fromUuid(r.actor.uuid);
  return actor && num(actor.ownership?.default) < CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER ? actor : null;
}

/**
 * A goal was finished: whisper the GM a card with what it offers. Players' ticks always send one,
 * so the GM hears of them; the GM's own ticks send one only when there is something to offer.
 */
async function promptCompletion(t, goalId, { who = null, why = null } = {}) {
  const found = t ? findGoal(t, goalId) : null;
  if (!found) return;
  // A link (another tracker reaching something) offers the goal itself; it isn't done yet, so its reveals wait.
  const self = why && found.g.state === "open" ? goalId : null;
  const { reveal, parent } = self ? { reveal: completionOffers(t, goalId).reveal, parent: null } : completionOffers(t, goalId);
  if (!who && !self && !reveal.length && !parent) return;
  const what = shortText(found.g.text, 80) || lz("AnObjective");
  const line = self ? `${esc(why)}, so <em>${esc(what)}</em> ${lz("MayBeDone")}` : `${who ? `<strong>${esc(who)}</strong> marked` : lz("Marked")} <em>${esc(what)}</em> done.`;
  await ChatMessage.create({
    content: `<div class="pct-chat pct-qprompt"><header><i class="${KIND_INFO.quest.icon}"></i> <strong>${esc(t.name)}</strong></header>
      <p>${line}</p><div class="pct-qprompt-state"></div></div>`,
    speaker: { alias: t.name || KIND_INFO.quest.label },
    whisper: gmIds(),
    flags: { [SCOPE]: { qprompt: { tid: t.id, goal: goalId, self, reveal, parent, status: "open" } } },
  });
}

/** A player followed a lead: whisper the GM a card, with what the lead can reveal that players can't see yet. */
async function promptFollow(t, leadId, who) {
  const lead = (t?.leads ?? []).find((l) => l.id === leadId);
  if (!lead) return;
  // A card for this lead still waiting on the GM is redrawn rather than posted again.
  const open = game.messages.contents.slice(-100).find((m) => {
    const f = m.getFlag?.(SCOPE, "qfollow");
    return f?.status === "open" && f.tid === t.id && f.lead === leadId;
  });
  if (open) return void ui.chat.updateMessage(open);
  const what = shortText(lead.text, 80) || lz("ALead");
  await ChatMessage.create({
    content: `<div class="pct-chat pct-qprompt"><header><i class="${KIND_INFO.quest.icon}"></i> <strong>${esc(t.name)}</strong></header>
      <p>${lz("FollowedLead", { who: `<strong>${esc(who)}</strong>`, what: `<em>${esc(what)}</em>` })}${/[.!?]$/.test(what) ? "" : "."}</p><div class="pct-qprompt-state"></div></div>`,
    speaker: { alias: t.name || KIND_INFO.quest.label },
    whisper: gmIds(),
    flags: { [SCOPE]: { qfollow: { tid: t.id, lead: leadId, status: "open" } } },
  });
}

/**
 * The frame both GM offer cards share (a follow card and an On-completion card): the result once answered; else, for
 * a GM, a note, the rows to tick, then Reveal and Not yet. `draw()` gives { gone, note, rows, none, any, read, go,
 * after, skipped }: `gone` a line when what the card is about is gone, `read(box)` what was ticked, `go(picked)` the
 * reveal (the result line, or undefined when nothing was saved), `after(picked)` what follows a saved reveal.
 */
async function offerCard(message, flag, data, root, draw) {
  const box = root.querySelector(".pct-qprompt-state");
  if (!box) return;
  if (data.status !== "open") return void (box.innerHTML = `<p class="pct-hint">${esc(data.result || lz("Done2"))}</p>`);
  if (!game.user.isGM) return;
  const c = await draw();
  if (c.gone) return void (box.innerHTML = `<p class="pct-hint">${esc(c.gone)}</p>`);
  box.innerHTML = `${c.note ? `<p class="pct-hint">${esc(c.note)}</p>` : ""}${c.rows ? `<div class="pct-qprompt-rows">${c.rows}</div>` : `<p class="pct-hint">${esc(c.none)}</p>`}
    <div class="pct-req pct-req-row">${c.any ? `<button type="button" data-act="go"><i class="fa-solid fa-eye" aria-hidden="true"></i> ${lz("Reveal")}</button>` : ""}<button type="button" data-act="skip">${c.any ? lz("NotYet") : "OK"}</button></div>`;
  box.querySelector('[data-act="go"]')?.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.currentTarget.disabled = true;
    const picked = c.read(box);
    onceFor(message, async (m) => {
      if (m.getFlag(SCOPE, flag)?.status !== "open") return;
      const result = await c.go(picked);
      if (result === undefined) return;
      await m.update({ [`flags.${SCOPE}.${flag}.status`]: "done", [`flags.${SCOPE}.${flag}.result`]: result });
      await c.after?.(picked);
    });
  });
  box.querySelector('[data-act="skip"]').addEventListener("click", (ev) => {
    ev.preventDefault();
    onceFor(message, async (m) => {
      if (m.getFlag(SCOPE, flag)?.status !== "open") return;
      await m.update({ [`flags.${SCOPE}.${flag}.status`]: "skipped", [`flags.${SCOPE}.${flag}.result`]: c.skipped });
    });
  });
}

/** The GM's choices on a follow card: tick what to reveal, then Reveal or Not yet. */
function renderFollow(message, qf, root) {
  return offerCard(message, "qfollow", qf, root, () => {
    const t = Store.get(qf.tid);
    const lead = (t?.leads ?? []).find((l) => l.id === qf.lead);
    if (!lead) return { gone: lz("ThatLeadNoLongerExists") };
    const offers = leadOffers(t, lead);
    const undone = !lead.followed;
    return {
      note: undone ? lz("ItHasBeenMarkedNotFollowed") : "",
      rows: offers.length ? offerRows(offers, !undone) : "",
      none: lz("NothingHiddenToReveal"),
      any: offers.length > 0,
      read: (box) => offers.filter((o) => box.querySelector(`input[name="${CSS.escape(o.key)}"]`)?.checked).map((o) => o.key),
      go: async (keys) => {
        const now = Store.get(qf.tid);
        const n = await revealLeadOffers(qf.tid, leadOffers(now, (now?.leads ?? []).find((l) => l.id === qf.lead)), keys);
        if (n === undefined) return void ui.notifications.error(lz("CampaignTrackersTheRevealDidnT"));
        return n ? lz("DoneRevealedN", { n }) : lz("Done2");
      },
      skipped: offers.length ? lz("LeftForLaterRevealFromThe") : lz("Seen"),
    };
  });
}

/** The GM's choices on an On-completion card: tick what to reveal, then Reveal or Not yet. */
function renderCompletion(message, qp, root) {
  return offerCard(message, "qprompt", qp, root, async () => {
    const t = Store.get(qp.tid);
    if (!t) return { gone: lz("ThatQuestNoLongerExists") };
    const rows = [], clues = new Map();
    const reopened = !qp.self && findGoal(t, qp.goal)?.g.state !== "done";
    if (qp.self) {
      const sg = findGoal(t, qp.self)?.g;
      if (sg && sg.state === "open") rows.push(`<label class="pct-chk"><input type="checkbox" name="self" checked> <span>${lz("Mark")} <em>${esc(shortText(sg.text, 70))}</em> done</span></label>`);
    }
    if (qp.parent) {
      const pg = findGoal(t, qp.parent)?.g;
      if (pg && pg.state === "open") rows.push(`<label class="pct-chk"><input type="checkbox" name="parent" checked> <span>${lz("Mark")} <em>${esc(shortText(pg.text, 70))}</em> ${lz("DoneTooItsStepsAddUp")}</span></label>`);
    }
    for (const id of qp.reveal) {
      const f = findRow(t, id);
      if (!f || rowShown(f)) continue;
      rows.push(`<label class="pct-chk"><input type="checkbox" name="reveal" value="${esc(id)}" checked> <span>${lz("Reveal")} ${esc(revealLabel(t, f))}</span></label>`);
      if (f.list === "leads") {
        const to = Store.data.trackers.find((x) => x.id === f.row.to && x.kind === "quest" && !x.revealed);
        if (to) rows.push(`<label class="pct-chk pct-indent"><input type="checkbox" name="leadq" value="${esc(to.id)}" data-for="${esc(id)}" checked> <span>${lz("AndRevealTheQuestItPoints", { name: esc(to.name) })}</span></label>`);
        for (const clue of leadClues(t, f.row)) {
          if (qp.reveal.includes(clue.id)) continue;
          // A clue two leads share is listed once, under the first, and comes with either of them.
          if (clues.has(clue.id)) {
            const at = clues.get(clue.id);
            rows[at] = rows[at].replace(/data-for="([^"]*)"/, (m0, ids) => `data-for="${ids} ${esc(id)}"`);
            continue;
          }
          clues.set(clue.id, rows.length);
          rows.push(`<label class="pct-chk pct-indent"><input type="checkbox" name="leadc" value="${esc(clue.id)}" data-for="${esc(id)}" checked> <span>${lz("AndRevealItsClue")} ${esc(shortText(clue.text, 60) || lz("NoText"))}</span></label>`);
        }
      }
      if (f.list === "rewards" && (await lootToOpen(t, id))) rows.push(`<label class="pct-chk pct-indent"><input type="checkbox" name="loot" value="${esc(id)}" data-for="${esc(id)}" checked> <span>${lz("AndLetPlayersOpen", { name: esc(f.row.actor.name) })}</span></label>`);
    }
    const shownRows = reopened ? rows.map((r) => r.replace(" checked>", ">")) : rows;
    return {
      note: reopened ? lz("ItHasBeenMarkedOpenAgain") : "",
      rows: shownRows.join(""),
      none: lz("NothingWasSetToBeRevealed"),
      any: rows.length > 0,
      read: (box) => {
        const ids = [...box.querySelectorAll('input[name="reveal"]:checked')].map((i) => i.value);
        // An indented "and ..." row counts only with the reveal above it.
        const under = (n) => [...box.querySelectorAll(`input[name="${n}"]:checked`)].filter((i) => !i.dataset.for || i.dataset.for.split(" ").some((f) => ids.includes(f))).map((i) => i.value);
        return { ids, loot: under("loot"), leadq: under("leadq"), leadc: under("leadc"), doParent: !!box.querySelector('input[name="parent"]:checked'), doSelf: !!box.querySelector('input[name="self"]:checked') };
      },
      go: async ({ ids, loot, leadq, leadc, doParent, doSelf }) => {
        let revealedN = 0;
        const done = await mutate((d) => {
          const tr = d.trackers.find((x) => x.id === qp.tid);
          if (!tr) return undefined;
          for (const qid of leadq) {
            const other = d.trackers.find((x) => x.id === qid);
            if (other) other.revealed = true;
          }
          if (doSelf) {
            const sg = findGoal(tr, qp.self)?.g;
            if (sg && sg.state === "open") {
              sg.state = "done";
              sg.doneBy = "gm";
            }
          }
          for (const id of [...ids, ...leadc]) revealedN += revealRow(findRow(tr, id)).length;
          if (doParent) {
            const pg = findGoal(tr, qp.parent)?.g;
            if (pg && pg.state === "open") {
              pg.state = "done";
              pg.doneBy = "gm";
            }
          }
          return true;
        }, { notify: false });
        if (!done) return undefined;
        for (const rid of loot) {
          const r = (Store.get(qp.tid)?.rewards ?? []).find((x) => x.id === rid);
          if (r?.actor?.uuid) await letPlayersOpen(r.actor.uuid);
        }
        const parts = [doSelf && lz("MarkedItDone"), revealedN && lz("RevealedN", { n: revealedN }), leadq.length && (leadq.length === 1 ? lz("RevealedAQuest") : lz("RevealedNQuests", { n: leadq.length })), doParent && lz("MarkedTheObjectiveDone"), loot.length && lz("OpenedTheLootToPlayers")].filter(Boolean);
        return parts.length ? `Done: ${parts.join(", ")}.` : lz("Done2");
      },
      // Marking it done can complete the objective above it, or bring more to reveal.
      after: async ({ doSelf, doParent }) => {
        if (doSelf) await promptCompletion(Store.get(qp.tid), qp.self);
        if (doParent) await promptCompletion(Store.get(qp.tid), qp.parent);
      },
      skipped: lz("LeftForLaterRevealFromThe"),
    };
  });
}

/** What applying a tagged roll card to its tracker needs: the target, the result, and who rolled. */
function applyArgs(message, t, tag) {
  const ctx = message.flags?.pf2e?.context;
  const actor = ctx?.actor ? game.actors.get(ctx.actor) : null;
  return { target: tag.target, outcome: ctx?.outcome, actorId: actor?.id ?? null, actorName: "", logName: actor ? pcName(actor) : "", skill: locate(t, tag.target)?.checks?.find((c) => c.id === tag.checkId)?.skill ?? tag.checkId ?? "" };
}

/** Apply a tagged roll card's result to its tracker, once (the card keeps what it did, for Undo). */
function applyCard(message, tid, args) {
  return onceFor(message, async (m) => {
    if (m.getFlag(SCOPE, "applied")) return;
    const done = await mutateTracker(tid, (tr) => applyRecorded(tr, args));
    if (done) await m.setFlag(SCOPE, "applied", done);
  });
}

/** F9: a tracker's roll cards waiting for Apply, oldest first: a result, not applied, not a reroll (that has its own
 * offer), and a target the tracker still has. Among the last hundred messages. */
function waitingCards(tid) {
  const t = Store.get(tid);
  if (!t) return [];
  return game.messages.contents.slice(-100).filter((m) => {
    const ctx = m.flags?.pf2e?.context;
    const tag = parseTag(ctx?.options);
    if (tag?.tid !== tid || !ctx.outcome || ctx.isReroll || m.flags?.[SCOPE]?.applied || m.flags?.[SCOPE]?.rerolled || !locate(t, tag.target)) return false;
    // A check applied as it's rolled is the active GM's lead tab's to apply.
    if (t.adhoc?.find((r) => r.id === tag.target)?.auto && Date.now() - (m.timestamp ?? 0) < 15000) return false;
    return typeof previewText(t, applyArgs(m, t, tag), null) === "string";
  });
}

/** F9: apply every waiting card, in the order they were rolled. Returns how many were applied. */
async function applyAll(tid) {
  let n = 0;
  for (const m of waitingCards(tid)) {
    const t = Store.get(tid);
    if (!t) break;
    await applyCard(m, tid, applyArgs(m, t, parseTag(m.flags.pf2e.context.options)));
    if (game.messages.get(m.id)?.getFlag(SCOPE, "applied")) n++;
  }
  return n;
}

/**
 * Wire up this module's chat cards: roll and propose buttons, proposals, GM check cards, completion cards, and the
 * GM's Apply box on tagged roll cards.
 */
function onRenderMessage(message, html) {
  const root = html;
  if (!(root instanceof HTMLElement)) return;
  const req = message.getFlag?.(SCOPE, "request");
  if (req) {
    for (const b of root.querySelectorAll("[data-pct-roll]")) {
      b.addEventListener("click", (ev) => {
        ev.preventDefault();
        const check = req.checks.find((c) => c.id === b.dataset.pctRoll);
        if (check) rollCheck({ tid: req.tid, target: check.target ?? req.target, check, title: check.title ?? req.title, hideDC: !!req.hideDC });
      });
    }
  }
  const prop = proposalOf(message);
  if (prop) renderProposal(message, prop, root);
  const ad = message.getFlag?.(SCOPE, "adhoc");
  if (ad) renderAdhoc(message, ad, root);
  const qp = message.getFlag?.(SCOPE, "qprompt");
  if (qp) renderCompletion(message, qp, root);
  const qf = message.getFlag?.(SCOPE, "qfollow");
  if (qf) renderFollow(message, qf, root);
  for (const b of root.querySelectorAll("[data-pct-propose]")) {
    b.addEventListener("click", (ev) => {
      ev.preventDefault();
      const c = message.getFlag?.(SCOPE, "challenge") ?? {};
      proposeDialog(b.dataset.pctPropose, { name: c.name, explain: c.explain });
    });
  }
  if (!game.user.isGM) return;
  const ctx = message.flags?.pf2e?.context;
  const tag = parseTag(ctx?.options);
  if (!tag) return;
  const t = Store.get(tag.tid);
  if (!t) return;
  const box = document.createElement("div");
  box.className = "pct-apply";
  const applied = message.getFlag(SCOPE, "applied");
  const args = applyArgs(message, t, tag);
  const prior = applied ? null : priorApplied(message);
  if (applied) {
    box.innerHTML = `<i class="fa-solid fa-check"></i> ${esc(applied.text)}${applied.changes ? ` <button type="button" class="pct-undo"${tipAttr(`${lz("TakeThisResultBackOff", { name: t.name })}`)}><i class="fa-solid fa-rotate-left" aria-hidden="true"></i> ${lz("Undo")}</button>` : ""}`;
    box.querySelector(".pct-undo")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.currentTarget.classList.add("pct-busy");
      onceFor(message, async (m) => {
        const now = m.getFlag(SCOPE, "applied");
        if (!now?.changes) return;
        const ok = await mutateTracker(t.id, (tr) => {
          undoChanges(tr, now.changes);
          return true;
        });
        if (ok) await m.unsetFlag(SCOPE, "applied");
      });
    });
  } else if (!ctx.outcome) {
    box.innerHTML = `<i class="fa-solid fa-circle-info"></i> ${lz("NoDCOnThisRollSo", { name: esc(t.name) })}`;
  } else if (prior) {
    // The roll before this reroll was applied: offer to swap its result for this one's.
    const preview = previewText(t, args, prior);
    if (!preview) return;
    if (typeof preview === "object") {
      previewShown.set(message.id, { tid: t.id, args: clone(args), prior: clone(prior), text: preview.unset });
      box.innerHTML = `<p class="pct-preview">${lz("TheRollBeforeThisRerollWas", { text: esc(prior.text) })}</p><button type="button"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i> ${lz("TakeBackFirstRoll")}</button><div class="pct-preview">${esc(preview.unset)}</div>`;
      box.querySelector("button").addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.currentTarget.disabled = true;
        onceFor(message, async (m) => {
          if (m.getFlag(SCOPE, "applied") || m.getFlag(SCOPE, "replaced")) return;
          const done = await mutateTracker(t.id, (tr) => {
            undoChanges(tr, prior.changes);
            return true;
          });
          if (done) await m.update({ [`flags.${SCOPE}.applied`]: { text: lz("TookBackFirstRoll"), changes: null }, [`flags.${SCOPE}.replaced`]: true });
        });
      });
      (root.querySelector(".message-content") ?? root).append(box);
      return;
    }
    previewShown.set(message.id, { tid: t.id, args: clone(args), prior: clone(prior), text: preview });
    box.innerHTML = `<p class="pct-preview">${lz("TheRollBeforeThisRerollWas", { text: esc(prior.text) })}</p><button type="button"><i class="fa-solid fa-arrows-rotate"></i> ${lz("ReplaceItWithThisRoll")}</button><div class="pct-preview">${esc(preview)}</div>`;
    box.querySelector("button").addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.currentTarget.disabled = true;
      onceFor(message, async (m) => {
        if (m.getFlag(SCOPE, "applied") || m.getFlag(SCOPE, "replaced")) return;
        const done = await mutateTracker(t.id, (tr) => {
          undoChanges(tr, prior.changes);
          return applyRecorded(tr, args);
        });
        if (done) await m.update({ [`flags.${SCOPE}.applied`]: { text: `${lz("ReplacedTheFirstRoll", { text: done.text })}`, changes: done.changes }, [`flags.${SCOPE}.replaced`]: true });
      });
    });
  } else {
    const preview = previewText(t, args, null);
    if (!preview) return;
    // A result with no points set: say so, with nothing to apply until the GM sets a number.
    if (typeof preview === "object") {
      previewShown.set(message.id, { tid: t.id, args: clone(args), prior: null, text: preview.unset });
      box.innerHTML = `<i class="fa-solid fa-circle-info" aria-hidden="true"></i> ${esc(preview.unset)}`;
      const content = root.querySelector(".message-content") ?? root;
      content.append(box);
      return;
    }
    previewShown.set(message.id, { tid: t.id, args: clone(args), prior: null, text: preview });
    box.innerHTML = `<button type="button"><i class="${KIND_INFO[t.kind].icon}" aria-hidden="true"></i> ${lz("ApplyTo", { name: esc(t.name) })}</button><div class="pct-preview">${esc(preview)}</div>`;
    box.querySelector("button").addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.currentTarget.disabled = true;
      applyCard(message, t.id, args);
    });
  }
  const note = critFailNote(t, tag.target, ctx.outcome);
  if (note) box.insertAdjacentHTML("beforeend", `<div class="pct-preview"><strong>${lz("OnACriticalFailure")}</strong> ${esc(note)}</div>`);
  const content = root.querySelector(".message-content") ?? root;
  content.append(box);
}


export { gmIds, whisperGM, postCheckCard, challengeSkills, postChallengeCard, prefillable, actorSkills, PROPOSE_BTN, proposeDialog, proposalOf, renderProposal, proposalControls, approveFree, approveProposal, adhocDialog, renderAdhoc, diffTracker, walkPath, undoChanges, critFailNote, applyRecorded, previewText, previewLine, previewShown, refreshPreviews, rerollStash, rerollKey, priorApplied, busyCards, onceFor, letPlayersOpen, lootToOpen, promptCompletion, promptFollow, offerCard, renderFollow, renderCompletion, applyArgs, applyCard, waitingCards, applyAll, onRenderMessage };
