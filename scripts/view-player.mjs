/** What a player sees of each kind, drawn from the revealed copy only. */

import { esc } from "./kit/safe-text.mjs";
import { KIND_INFO, lz, num, para, signed } from "./core.mjs";
import { QSTATUS_LABEL, STATUS_TEXT, clamp } from "./data.mjs";
import { A, GOAL_ICON, checkRows, clockSVG, clueOrder, dateStatus, othersAt, partyMembers, pcName, questBody, questHead, thresholdRows } from "./html.mjs";
import { challengeTally } from "./view-gm.mjs";

/* ------------------------------------------------------------------ */
/* Player view of each kind (works on the revealed copy)               */
/* ------------------------------------------------------------------ */

const PLAYER = {
  quest(p) {
    return `${questHead(p, { gm: false })}${questBody(p, { gm: false })}`;
  },

  challenge(p) {
    const tally = p.successes !== null ? challengeTally(p.successes, p.goal, p.failures, p.limit) : "";
    const status = p.status ? `<p class="pct-big">${STATUS_TEXT[p.status]}</p>` : "";
    const round = p.rounds ? `<span class="pct-chip">${lz("RoundOf", { round: p.round, rounds: p.rounds })}</span>` : "";
    const approaches = p.approaches.map((a) => {
      const out = a.left === 0;
      return `<div class="pct-obstacle pct-approach ${out ? "pct-done" : ""}"><div class="pct-line"><strong>${esc(a.label || lz("AnotherWay"))}</strong>${a.left !== null ? `<span class="pct-chip">${out ? lz("UsedUp") : lz(a.left === 1 ? "UseLeft" : "UsesLeft", { n: a.left })}</span>` : ""}</div>
          ${out ? "" : checkRows(p, a.id, a.checks, { gm: false })}</div>`;
    }).join("");
    return `${status}${round ? `<div class="pct-line">${round}</div>` : ""}${tally}${thresholdRows(p.thresholds, 0, { gm: false })}
      ${approaches ? `<div class="pct-sub">${lz("Approaches")}</div>${approaches}` : ""}
      <div class="pct-line">${A("pctPropose", "fa-solid fa-lightbulb", { label: lz("ProposeAnApproach"), tip: lz("SayWhatYourCharacterDoesAnd2") })}</div>`;
  },

  reputation(p) {
    return `<div class="pct-rep"><div class="pct-tier-now">${p.tiers.filter((x) => x.id === p.tier).map((x) => `<strong>${esc(x.label)}</strong>${p.value !== null ? ` <span class="pct-range">${signed(p.value)}</span>` : ""}${x.text ? `<p>${para(x.text)}</p>` : ""}`).join("")}</div></div>
      <ol class="pct-ladder">${[...p.tiers].reverse().map((x) => `<li class="${x.id === p.tier ? "pct-current" : ""}"><strong>${esc(x.label)}</strong> <span class="pct-range">${esc(x.range)}</span>${x.text ? ` <span class="pct-for">${esc(x.text)}</span>` : ""}</li>`).join("")}</ol>`;
  },
  pressure(p) {
    const tier = p.tiers.find((x) => x.id === p.tier);
    return `<div class="pct-tier-now">${tier ? `<strong>${esc(tier.label)}</strong>${p.value !== null ? ` <span class="pct-range">${p.max !== null ? lz("XOfY", { x: p.value, y: p.max }) : p.value}</span>` : ""}${tier.text ? `<p>${para(tier.text)}</p>` : ""}` : p.value !== null ? `<strong>${p.max !== null ? lz("XOfY", { x: p.value, y: p.max }) : p.value}</strong>` : ""}</div>${thresholdRows(p.thresholds, p.value, { gm: false })}`;
  },
  points(p) {
    const val = p.value !== null ? `<div class="pct-big">${p.value}${p.max !== null ? ` / ${p.max}` : ""}</div>` : "";
    const bar = p.value !== null && p.max ? `<div class="pct-bar"><div style="width:${clamp((p.value / p.max) * 100, 0, 100)}%"></div></div>` : "";
    return `${val}${bar}${thresholdRows(p.thresholds, p.value, { gm: false })}${checkRows(p, "main", p.checks, { gm: false })}`;
  },
  influence(p) {
    const npc = p.npc ? `<div class="pct-npc"><img src="${esc(p.npc.img)}" alt=""><strong>${esc(p.npc.name)}</strong></div>` : "";
    const list = (xs, title) => (xs.length ? `<div class="pct-sub">${title}</div><ul class="pct-notes">${xs.map((x) => `<li>${para(x)}</li>`).join("")}</ul>` : "");
    return `<div class="pct-line">${npc}${p.value !== null ? `<span class="pct-chip">${p.value} influence</span>` : ""}<span class="pct-chip">${lz("RoundOf2", { roundsUsed: p.roundsUsed, rounds: p.rounds })}</span></div>
      ${thresholdRows(p.thresholds, p.value, { gm: false })}
      ${p.skills.length ? `<div class="pct-sub">${lz("Influence")}</div>${checkRows(p, "", p.skills, { gm: false, perCheckTarget: true })}` : ""}
      ${p.discovery.length ? `<div class="pct-sub">${lz("Discover")}</div>${checkRows(p, "", p.discovery, { gm: false, perCheckTarget: true })}` : ""}
      ${list(p.resistances, lz("Resistances"))}${list(p.weaknesses, lz("Weaknesses"))}`;
  },
  research(p) {
    return `${p.value !== null ? `<div class="pct-big">${p.value} <span>${lz("ResearchPoints2")}</span></div>` : ""}${thresholdRows(p.thresholds, p.value, { gm: false })}${checkRows(p, "", p.checks, { gm: false, perCheckTarget: true })}`;
  },
  chase(p) {
    const n = p.obstacles.length;
    const cur = p.current;
    const q = p.quarry ? p.quarry.at : null;
    const track = `<ol class="pct-track">${p.obstacles.map((o, i) => `<li class="${i < cur ? "pct-done" : i === cur ? "pct-current" : ""}"><span class="pct-track-n">${i + 1}</span><span class="pct-track-name">${o.hidden ? "?" : esc(o.name || `${lz("Obstacle2", { x: i + 1 })}`)}</span>${o.hidden ? "" : `<span class="pct-track-pts">${o.progress}/${o.points}</span>`}<span class="pct-marks">${i === cur ? `<i class="fa-solid fa-users"></i>` : ""}${q === i + 1 ? `<i class="fa-solid fa-person-running pct-quarry" data-tooltip-text="${esc(p.quarry.label)}"></i>` : ""}</span></li>`).join("")}</ol>`;
    const o = p.obstacles[cur];
    const now = o && !o.hidden ? `<div class="pct-obstacle pct-current"><strong>${esc(o.name)}</strong> <span class="pct-chip">${lz("XOfY", { x: o.progress, y: o.points })}</span>${checkRows(p, o.id, o.checks, { gm: false })}</div>` : "";
    const status = cur >= n ? lz("ThePartyIsThrough") : q !== null && q > n ? lz("QuarryGotAway", { quarry: esc(p.quarry.label.toLowerCase()) }) : "";
    return `<div class="pct-line"><span class="pct-chip">${lz("Round2", { round: p.round })}</span>${status ? `<span>${status}</span>` : ""}</div>${track}${now}`;
  },
  infiltration(p) {
    const pcs = partyMembers();
    const obstacles = p.obstacles.map((o) => `<div class="pct-obstacle"><div class="pct-line"><strong>${esc(o.name)}</strong><span class="pct-chip">${o.type === "individual" ? lz("EachPC") : lz("XOfY", { x: o.progress, y: o.points })}</span></div>
      ${o.type === "individual" ? `<div class="pct-indiv">${pcs.map((pc) => `<span class="pct-pc">${esc(pcName(pc))} ${num(o.byActor?.[pc.id])}/${o.points}</span>`).join("")}${othersAt(o, pcs).map((x) => `<span class="pct-pc pct-other">${esc(x.name)} ${x.value}/${o.points}</span>`).join("")}</div>` : ""}
      ${checkRows(p, o.id, o.checks, { gm: false })}</div>`).join("");
    const extras = (list, title) => (list.length ? `<div class="pct-sub">${title}</div>${list.map((o) => `<div class="pct-obstacle ${o.done ? "pct-done" : ""}"><strong>${esc(o.name)}</strong>${o.done ? "" : checkRows(p, o.id, o.checks, { gm: false })}</div>`).join("")}` : "");
    return `<div class="pct-line">${p.awareness !== null ? `<span class="pct-chip">${lz("Awareness2", { awareness: p.awareness })}</span>` : ""}<span class="pct-chip">${lz("Edge2", { edge: p.edge })}</span><span class="pct-chip">${lz("Round2", { round: p.round })}</span>${p.overcome ? `<span class="pct-chip">${lz("OfObstacles", { done: p.overcome.done, of: p.overcome.of })}</span>` : ""}<span class="pct-chip">${p.objective ? lz("IPOfGoal", { ip: p.ip, goal: p.objective }) : lz("IPShort", { ip: p.ip })}</span></div>
      ${obstacles}${extras(p.complications, lz("Complications"))}${extras(p.opportunities, lz("Opportunities"))}`;
  },
  clock(p) {
    const filled = p.segments.filter((s) => s.state === "filled").length;
    const labels = p.segments.some((s) => s.label) ? `<ol class="pct-segs">${p.segments.map((s, i) => `<li class="pct-seg pct-seg-${s.state}"><span class="pct-seg-n">${i + 1}</span><span class="pct-seg-label">${esc(s.label)}</span></li>`).join("")}</ol>` : "";
    return `<div class="pct-clockwrap">${clockSVG(p.segments, 84)}<div><div class="pct-big">${filled} / ${p.segments.length}</div>${labels}</div></div>`;
  },
  checklist(p) {
    return p.entries.length ? `<ul class="pct-entries">${p.entries.map((e) => `<li class="${e.done ? "pct-done" : ""}"><i class="fa-${e.done ? "solid fa-square-check" : "regular fa-square"}" aria-hidden="true"></i><div class="pct-entry"><strong>${esc(e.label)}</strong> ${dateStatus(e.closes, e.done)}</div></li>`).join("")}</ul>` : "";
  },
};

/** A short status card for chat: what players would see. */
function chatCard(p) {
  const head = `<header><i class="${KIND_INFO[p.kind].icon}"></i> <strong>${esc(p.name)}</strong></header>`;
  const desc = p.desc ? `<p>${para(p.desc)}</p>` : "";
  const reachedList = (list) => {
    const r = (list ?? []).filter((x) => x.reached);
    return r.length ? `<ul>${r.map((x) => `<li>${para(x.text)}</li>`).join("")}</ul>` : "";
  };
  let body = "";
  switch (p.kind) {
    case "quest": {
      const goals = p.objectives.map((o) => `<li><i class="${GOAL_ICON[o.state] ?? GOAL_ICON.open}"></i> ${esc(o.text)}${o.count !== null ? ` (${lz("XOfY", { x: o.have, y: o.count })})` : ""}</li>`).join("");
      const latest = clueOrder(p.entries).shown[0]?.e;
      body = `<p><strong>${esc(QSTATUS_LABEL[p.status] ?? "")}</strong>${p.category ? `, ${esc(p.category)}` : ""}</p>${latest ? `<p><em>${para(latest.text)}</em></p>` : ""}${goals ? `<ul class="pct-chat-list">${goals}</ul>` : ""}`;
      break;
    }
    case "reputation": {
      const tier = p.tiers.find((x) => x.id === p.tier);
      body = `<p class="pct-chat-big">${esc(tier?.label ?? "")}${p.value !== null ? ` (${signed(p.value)})` : ""}</p>${tier?.text ? `<p>${para(tier.text)}</p>` : ""}`;
      break;
    }
    case "pressure": {
      const tier = p.tiers.find((x) => x.id === p.tier);
      body = `<p class="pct-chat-big">${esc(tier?.label ?? "")}${p.value !== null ? ` (${p.max !== null ? lz("NOfMax", { n: p.value, max: p.max }) : p.value})` : ""}</p>${tier?.text ? `<p>${para(tier.text)}</p>` : ""}${reachedList(p.thresholds)}`;
      break;
    }
    case "points":
      body = `${p.value !== null ? `<p class="pct-chat-big">${p.value}${p.max !== null ? ` / ${p.max}` : ""}</p>` : ""}${reachedList(p.thresholds)}`;
      break;
    case "challenge": {
      const counts = p.successes !== null ? `<p>${lz("ChallengeSummary", { s: p.goal ? lz("NOfMax", { n: p.successes, max: p.goal }) : p.successes, f: p.limit ? lz("NOfMax", { n: p.failures, max: p.limit }) : p.failures })}</p>` : "";
      body = `${p.status ? `<p class="pct-chat-big">${STATUS_TEXT[p.status]}</p>` : ""}${counts}${p.rounds ? `<p>${lz("RoundOf", { round: p.round, rounds: p.rounds })}</p>` : ""}${reachedList(p.thresholds)}`;
      break;
    }
    case "influence":
      body = `<p class="pct-chat-big">${p.npc ? esc(p.npc.name) : ""}${p.value !== null ? `${p.npc ? ": " : ""}${lz("NInfluence", { n: p.value })}` : ""}</p><p>${lz("RoundOf2", { roundsUsed: p.roundsUsed, rounds: p.rounds })}</p>${reachedList(p.thresholds)}`;
      break;
    case "research":
      body = `${p.value !== null ? `<p class="pct-chat-big">${lz("ResearchPoints", { value: p.value })}</p>` : ""}${reachedList(p.thresholds)}`;
      break;
    case "chase": {
      const n = p.obstacles.length;
      const o = p.obstacles[p.current];
      const where = p.current >= n ? lz("ThePartyIsThrough") : `${lz("ObstacleOf2", { x: p.current + 1, n: n })}${o && !o.hidden ? `: ${esc(o.name)} (${lz("XOfY", { x: o.progress, y: o.points })})` : ""}.`;
      const q = p.quarry ? (p.quarry.at > n ? ` ${lz("QuarryGotAway", { quarry: esc(p.quarry.label.toLowerCase()) })}` : p.quarry.at >= 1 ? ` ${lz("QuarryIsAt", { quarry: esc(p.quarry.label.toLowerCase()), at: p.quarry.at })}` : "") : "";
      body = `<p class="pct-chat-big">${lz("Round2", { round: p.round })}</p><p>${where}${q}</p>`;
      break;
    }
    case "infiltration":
      body = `<p class="pct-chat-big">${p.objective || !p.overcome ? lz("IPOf", { ip: p.ip, goal: p.objective || "?" }) : lz("OfObstaclesOvercome", { done: p.overcome.done, of: p.overcome.of })}</p><p>${p.awareness !== null ? lz("AwarenessN", { n: p.awareness }) : ""}${lz("EdgeRound", { edge: p.edge, round: p.round })}</p>`;
      break;
    case "clock": {
      const filled = p.segments.filter((s) => s.state === "filled").length;
      body = `<div class="pct-chat-clock">${clockSVG(p.segments, 48)}<span class="pct-chat-big">${filled} / ${p.segments.length}</span></div>`;
      break;
    }
    case "checklist":
      body = p.entries.length ? `<ul class="pct-chat-list">${p.entries.map((e) => `<li><i class="fa-${e.done ? "solid fa-square-check" : "regular fa-square"}" aria-hidden="true"></i> ${esc(e.label)}</li>`).join("")}</ul>` : `<p>${lz("NothingToShowYet")}</p>`;
      break;
  }
  return `<div class="pct-chat pct-post">${head}${desc}${body}</div>`;
}


export { PLAYER, chatCard };
