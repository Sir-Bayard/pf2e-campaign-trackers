/** Quest links and reveal links in journal pages and chat. */

import { esc, labelAttr, tipAttr } from "./kit/safe-text.mjs";
import { openQuest } from "./app.mjs";
import { letPlayersOpen, lootToOpen } from "./chat.mjs";
import { shortText } from "./checks.mjs";
import { MOD, lz } from "./core.mjs";
import { ROW_KIND, findRow, leadClues, revealLabel, revealRow, rowLabel, rowShown } from "./data.mjs";
import { A } from "./html.mjs";
import { questsOpen } from "./panel.mjs";
import { storeReady } from "./presets.mjs";
import { Store, mutate, visibleTrackers } from "./store.mjs";

/* ------------------------------------------------------------------ */
/* Reveal links                                                        */
/* ------------------------------------------------------------------ */

/** Characters an id in a reveal link can't hold (they'd end or split the link). Preset keys could contain them. */
const RL_BAD = /[,\]|{}\r\n]/;
/** A part's reveal-link tool in the GM's view: a link icon to drag or click (copy), or a box while picking parts. */
function rlTool(id, pick) {
  if (RL_BAD.test(String(id))) return pick ? `<span class="pct-rlpick pct-rl-bad" ${tipAttr(lz("ItsIdHasACharacterA"))}><i class="fa-solid fa-link-slash"></i></span>` : "";
  if (pick) return `<label class="pct-rlpick"${tipAttr(pick.has(id) ? lz("InTheRevealLinkClickTo") : lz("ClickToPutItInThe"))}><input type="checkbox" data-rl-pick="${esc(id)}" ${pick.has(id) ? "checked" : ""} aria-label="${esc(lz("InTheRevealLink"))}"><i class="fa-solid fa-link" aria-hidden="true"></i></label>`;
  return `<a class="pct-rl-drag pct-rl-one" draggable="true" tabindex="0" role="button" data-action="pctRLCopy" data-rl="${esc(id)}"${labelAttr(lz("RevealLinkDragItIntoA"))}><i class="fa-solid fa-link" aria-hidden="true"></i></a>`;
}

/** Above a quest while the GM picks parts for one reveal link. */
function rlBar(t, pick) {
  const have = revealableIds(t);
  const n = [...pick].filter((id) => have.includes(id)).length;
  const what = n ? `${n} ${n === 1 ? "part" : "parts"} picked.` : lz("NothingPickedYetTheLinkReveals");
  return `<div class="pct-rlbar"><i class="fa-solid fa-link"></i><span>${lz("RevealLinkTickThePartsIt", { what: what })}</span>
    <a class="pct-btn pct-rl-drag pct-rl-chip" draggable="true" role="button" tabindex="0" data-action="pctRLCopy" data-rl="*" ${tipAttr(lz("DragItIntoAJournalPage"))}><i class="fa-solid fa-grip-vertical"></i><span>${lz("DragOrCopy")}</span></a>
    ${n ? A("pctRLClear", "fa-solid fa-eraser", { tip: lz("UntickThemAll") }) : ""}${A("pctRLPick", "fa-solid fa-check", { label: lz("Done"), tip: lz("StopPicking") })}</div>`;
}

/** Every part a reveal link can name, in the quest's own order. */
function revealableIds(t) {
  return [
    ...(t.objectives ?? []).flatMap((o) => [o.id, ...(o.steps ?? []).map((st) => st.id)]),
    ...(t.entries ?? []).map((e) => e.id),
    ...(t.leads ?? []).map((l) => l.id),
    ...(t.rewards ?? []).map((r) => r.id),
  ];
}

/** The text of a reveal link: @QuestReveal[quest|part,part]{label}. One part is labeled with its text, else the
 * quest's name. */
function revealLinkText(t, ids = [], label = null) {
  if (RL_BAD.test(t.id)) return null;
  const order = revealableIds(t);
  const parts = [...new Set(ids)].filter((id) => order.includes(id) && !RL_BAD.test(String(id))).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const text = label ?? (parts.length === 1 ? shortText(findRow(t, parts[0])?.row.text, 40) : t.name);
  const clean = String(text ?? "").replace(/[{}[\]\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  return `@QuestReveal[${t.id}${parts.length ? `|${parts.join(",")}` : ""}]{${clean || lz("Reveal")}}`;
}

async function copyText(text) {
  try {
    if (game.clipboard?.copyPlainText) await game.clipboard.copyPlainText(text);
    else await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** The quest a reveal link names: by id, by its preset key (the id without the preset's prefix), or by its exact
 * name. Keys and names count only when they name one quest. */
function revealQuest(ref) {
  const key = String(ref ?? "").trim();
  const quests = Store.data.trackers.filter((t) => t.kind === "quest");
  const hit = quests.find((t) => t.id === key);
  if (hit) return hit;
  const byKey = quests.filter((t) => t.preset && t.id === `${t.preset}-${key}`);
  if (byKey.length === 1) return byKey[0];
  const byName = quests.filter((t) => String(t.name ?? "").trim().toLowerCase() === key.toLowerCase());
  return byName.length === 1 ? byName[0] : null;
}

/** What a reveal link names, read from the GM's data: the quest, its parts (with where they sit) and ids not found. */
function resolveReveal(questRef, partList) {
  if (!game.user.isGM) return { error: lz("OnlyTheGMCanReveal") };
  if (!storeReady || Store.broken) return { error: lz("CampaignTrackersHasnTLoadedIts") };
  const q = revealQuest(questRef);
  if (!q) return { error: `${lz("NoQuest")}${String(questRef ?? "").trim()}${lz("InCampaignTrackers")}` };
  const refs = [...new Set(String(partList ?? "").split(",").map((x) => x.trim()).filter(Boolean))];
  const parts = [], missing = [];
  for (const id of refs) {
    const f = findRow(q, id);
    if (f && ROW_KIND[f.list]) parts.push({ id, ...f });
    else missing.push(id);
  }
  return { q, parts, missing, questOnly: !refs.length };
}

/** Whether one part a link names shows to players (see rowShown). */

/** What a click would reveal, as the checklist's rows (all ticked to start): the quest if hidden, each hidden part,
 * the objective a step sits under, the hidden quest a lead points to, and loot players can't open yet. */
async function revealPlan({ q, parts, questOnly = false }) {
  const rows = [], already = [];
  // A link whose parts are all gone mustn't reveal the quest on its own.
  if (!q.revealed && (questOnly || parts.length)) rows.push({ name: "quest", value: q.id, label: parts.length ? lz("TheQuestItselfPlayersSeeNone") : lz("TheQuestItself") });
  const leadqs = new Set(), leadcs = new Set();
  for (const p of parts) {
    if (rowShown(p)) {
      already.push(p);
      continue;
    }
    // A step's row reveals its objective too (the same rule as the eye).
    rows.push({ name: "row", value: p.id, label: revealLabel(q, p) });
    if (p.row.revealed) continue;
    if (p.list === "leads") {
      const to = Store.data.trackers.find((x) => x.id === p.row.to && x.kind === "quest" && !x.revealed && x.id !== q.id);
      // A quest or clue two leads share is listed once, under the first, and comes with either of them.
      const shared = (name, value) => rows.find((x) => x.name === name && x.value === value);
      if (to && leadqs.has(to.id)) shared("leadq", to.id).for += ` ${p.id}`;
      else if (to) {
        leadqs.add(to.id);
        rows.push({ name: "leadq", value: to.id, label: `${lz("AndRevealTheQuestItPoints", { name: to.name })}`, indent: true, for: p.id });
      }
      for (const clue of leadClues(q, p.row)) {
        if (parts.some((x) => x.row.id === clue.id)) continue;
        if (leadcs.has(clue.id)) {
          shared("leadc", clue.id).for += ` ${p.id}`;
          continue;
        }
        leadcs.add(clue.id);
        rows.push({ name: "leadc", value: clue.id, label: `${lz("AndRevealItsClue")} ${shortText(clue.text, 60) || lz("NoText")}`, indent: true, for: p.id });
      }
    }
    if (p.list === "rewards") {
      const actor = await lootToOpen(q, p.id);
      if (actor) rows.push({ name: "loot", value: p.id, label: `${lz("AndLetPlayersOpen", { name: actor.name })}`, indent: true, for: p.id });
    }
  }
  // A step whose hidden objective is listed too counts only with it: unticking the objective keeps both hidden.
  for (const x of rows) {
    const p = x.name === "row" ? parts.find((y) => y.id === x.value) : null;
    if (p?.list === "objectives.steps" && p.parent?.id && rows.some((y) => y.name === "row" && y.value === p.parent.id)) x.for = p.parent.id;
  }
  return { rows, already };
}

/** The checklist a reveal link opens: untick anything to leave hidden. Null when the GM cancels. */
async function chooseReveal(r, plan) {
  const row = (x) => `<label class="pct-chk ${x.indent ? "pct-indent" : ""}"><input type="checkbox" name="${x.name}" value="${esc(x.value)}" ${x.for ? `data-for="${esc(x.for)}"` : ""} checked> <span>${esc(x.label)}</span></label>`;
  const shown = plan.already.map((p) => `<div class="pct-rl-note"><i class="fa-solid fa-check"></i> <span>${esc(rowLabel(r.q, p.id))}</span> <em>${lz("PlayersSeeIt")}</em></div>`).join("");
  const missing = r.missing.map((id) => `<div class="pct-rl-note pct-rl-missing"><i class="fa-solid fa-xmark"></i> <span>${lz("NotFound", { id: esc(id) })}</span></div>`).join("");
  const res = await foundry.applications.api.DialogV2.wait({
    window: { title: `Reveal: ${r.q.name}` },
    classes: ["pct-reveal-dialog"],
    content: `<div class="pct-rl-rows">${plan.rows.map(row).join("")}</div>${shown}${missing}
      <p class="pct-hint">${lz("ShiftClickARevealLinkTo")}</p>`,
    buttons: [
      { action: "reveal", label: lz("Reveal"), icon: "fa-solid fa-eye", default: true, callback: (ev, button) => readRevealForm(button.form) },
      { action: "cancel", label: lz("Cancel") },
    ],
    // Ticking a step ticks its objective; unticking an objective unticks its steps.
    render: (ev, dlg) => {
      const root = dlg instanceof HTMLElement ? dlg : dlg?.element;
      root?.addEventListener("change", (e) => {
        const i = e.target;
        if (!(i instanceof HTMLInputElement) || i.name !== "row") return;
        if (i.checked && i.dataset.for) {
          for (const f of i.dataset.for.split(" ")) {
            const up = root.querySelector(`input[name="row"][value="${CSS.escape(f)}"]`);
            if (up) up.checked = true;
          }
        }
        if (!i.checked) for (const c of root.querySelectorAll('input[name="row"][data-for]')) if (c.dataset.for.split(" ").includes(i.value)) c.checked = false;
      });
    },
    rejectClose: false,
  });
  return res && typeof res === "object" ? res : null;
}

/**
 * The checklist's ticks. An indented row (the quest a lead points to, its clue, loot) counts only with the row above
 * it, and a step only with its objective's row when that's listed.
 */
function readRevealForm(form) {
  const ticked = (n) => [...form.querySelectorAll(`input[name="${n}"]:checked`)];
  const picked = new Set(ticked("row").map((i) => i.value));
  const rows = ticked("row").filter((i) => !i.dataset.for || i.dataset.for.split(" ").some((f) => picked.has(f))).map((i) => i.value);
  const withParent = (n) => ticked(n).filter((i) => !i.dataset.for || i.dataset.for.split(" ").some((f) => rows.includes(f))).map((i) => i.value);
  return { quest: ticked("quest").length > 0, rows, leadq: withParent("leadq"), leadc: withParent("leadc"), loot: withParent("loot") };
}

const REVEAL_WORDS = { objectives: ["objective", "objectives"], "objectives.steps": ["step", "steps"], entries: ["clue", "clues"], leads: ["lead", "leads"], rewards: ["reward", "rewards"] };

/** Reveal what was chosen in one change, then open any loot, and say what happened. */
async function applyReveal(qid, choice) {
  choice.leadc ??= [];
  if (!choice.quest && !choice.rows.length && !choice.leadq.length && !choice.leadc.length && !choice.loot.length) return void ui.notifications.info(lz("NothingRevealed"));
  const cur = Store.get(qid);
  if (cur?.kind !== "quest") return void ui.notifications.warn(lz("ThatQuestNoLongerExists"));
  const hidden = (choice.quest && !cur.revealed)
    || [...choice.rows, ...choice.leadc].some((id) => { const f = findRow(cur, id); return !!f && !rowShown(f); })
    || choice.leadq.some((id) => Store.get(id)?.revealed === false);
  const res = !hidden ? { name: cur.name, quest: false, kinds: {}, quests: [] } : await mutate((d) => {
    const tr = d.trackers.find((x) => x.id === qid && x.kind === "quest");
    if (!tr) return undefined;
    const out = { name: tr.name, quest: false, kinds: {}, quests: [] };
    if (choice.quest && !tr.revealed) out.quest = tr.revealed = true;
    for (const id of [...choice.rows, ...choice.leadc]) {
      const f = findRow(tr, id);
      if (!f || !ROW_KIND[f.list]) continue;
      for (const list of revealRow(f)) out.kinds[list] = (out.kinds[list] ?? 0) + 1;
    }
    for (const id of choice.leadq) {
      const o = d.trackers.find((x) => x.id === id && x.kind === "quest");
      if (o && !o.revealed) {
        o.revealed = true;
        out.quests.push(o.name);
      }
    }
    return out;
  }, { notify: false });
  if (!res) return;
  const opened = [], failed = [];
  for (const rid of choice.loot) {
    const r = (Store.get(qid)?.rewards ?? []).find((x) => x.id === rid);
    if (!r?.actor?.uuid) continue;
    try {
      if (await letPlayersOpen(r.actor.uuid)) opened.push(r.actor.name);
    } catch (err) {
      console.warn(`${MOD} | couldn't open ${r.actor.uuid} to players`, err);
      failed.push(r.actor.name);
    }
  }
  const bits = [
    res.quest && lz("TheQuest"),
    ...Object.entries(REVEAL_WORDS).filter(([k]) => res.kinds[k]).map(([k, [one, many]]) => `${res.kinds[k]} ${res.kinds[k] === 1 ? one : many}`),
    ...res.quests.map((n) => `${lz("TheQuest2", { n: n })}`),
  ].filter(Boolean);
  const list = bits.length > 1 ? `${bits.slice(0, -1).join(", ")}${lz("AndJoin")}${bits.at(-1)}` : bits[0];
  // Names can be players' own (party quests): escaped, since notices keep markup.
  const said = [bits.length && `${lz("RevealedIn", { name: res.name, list: list })}`, opened.length && lz("PlayersCanOpenNow", { list: opened.join(lz("AndJoin")) }), failed.length && lz("CouldNotOpen", { list: failed.join(lz("AndJoin")) })].filter(Boolean).join(" ");
  ui.notifications.info(esc(said || `${lz("PlayersAlreadySeeAllOfThat", { name: res.name })}`));
}

/** One reveal at a time per link, so a double click doesn't open two lists. */
const revealBusy = new Set();
/** Reveal what a link names: with the checklist, or (ask false, a Shift-click) everything it would tick. */
async function revealFromLink(questRef, partList, { ask = true, trusted = true } = {}) {
  if (!game.user.isGM) return void ui.notifications.warn(lz("OnlyTheGMCanReveal"));
  const key = `${questRef}|${partList ?? ""}`;
  if (revealBusy.has(key)) return;
  revealBusy.add(key);
  try {
    const r = resolveReveal(questRef, partList);
    if (r.error) return void ui.notifications.warn(esc(r.error));
    const plan = await revealPlan(r);
    if (!plan.rows.length) {
      if (r.missing.length) ui.notifications.warn(lz("NothingWithId", { name: esc(r.q.name), ids: esc(r.missing.join(", ")) }));
      if (r.questOnly || r.parts.length) ui.notifications.info(lz("PlayersAlreadySeeAllOfThat", { name: esc(r.q.name) }));
      return;
    }
    // A link a player may have written (chat, a page a player last changed) always shows the list.
    if (!trusted) ask = true;
    if (!ask && r.missing.length) ui.notifications.warn(lz("NothingWithId", { name: esc(r.q.name), ids: esc(r.missing.join(", ")) }));
    const all = (n) => plan.rows.filter((x) => x.name === n).map((x) => x.value);
    const choice = ask ? await chooseReveal(r, plan) : { quest: all("quest").length > 0, rows: all("row"), leadq: all("leadq"), leadc: all("leadc"), loot: all("loot") };
    if (choice) await applyReveal(r.q.id, choice);
  } finally {
    revealBusy.delete(key);
  }
}

/** @QuestReveal[quest|part,part]{label}: for the GM a button that reveals those parts; for players the label as
 * plain text, which says nothing of what's behind it. The quest is anything but "]" and "|" (a name can have spaces);
 * parts and the label stay on one line. */
const REVEAL_LINK = /@QuestReveal\[([^\]|\n]{1,200})(?:\|([^\]{}\n]{0,1000}))?\](?:\{([^}\n]{0,500})\})?/g;
/** Did a GM write this link? Only a journal page (or entry) a GM last changed counts; chat gives no document. */
function gmWrote(doc) {
  const by = doc?._stats?.lastModifiedBy ?? doc?.parent?._stats?.lastModifiedBy;
  return !!by && !!game.users?.get(by)?.isGM && ["JournalEntryPage", "JournalEntry"].includes(doc?.documentName);
}
function enrichRevealLink(match, options = {}) {
  const [, ref, parts = "", label] = match;
  const quest = ref.trim();
  const text = String(label ?? "").trim() || lz("Reveal");
  if (!game.user.isGM) {
    const span = document.createElement("span");
    span.className = "pct-reveal-text";
    span.textContent = text;
    return span;
  }
  const a = document.createElement("a");
  a.className = "pct-reveal-link";
  a.dataset.quest = quest;
  a.dataset.parts = parts;
  a.dataset.label = text;
  if (!gmWrote(options?.relativeTo)) a.dataset.ask = "always";
  // In a journal page the GM can drop more parts onto it.
  const doc = options?.relativeTo;
  if (doc?.documentName === "JournalEntryPage" && !doc.pack && a.dataset.ask !== "always") a.dataset.page = doc.uuid;
  paintRevealLink(a);
  return a;
}
/** Draw a reveal link as things stand: its tooltip lists what it covers (ticked if players see it), it fades with a
 * check once players see it all, and it's dashed when something it names can't be found. */
function paintRevealLink(a) {
  const r = resolveReveal(a.dataset.quest, a.dataset.parts);
  let done = false, broken = true;
  const lines = [];
  if (r.error) lines.push(esc(r.error));
  else {
    broken = r.missing.length > 0;
    const mark = (on) => (on ? "✓" : "○");
    if (r.questOnly || !r.q.revealed) lines.push(`${mark(r.q.revealed)} ${lz("TheQuestItself")}`);
    const named = new Set(r.parts.map((p) => p.id));
    for (const p of r.parts) {
      lines.push(`${mark(rowShown(p))} ${esc(rowLabel(r.q, p.id))}`);
      if (p.list === "objectives.steps" && !p.parent.revealed && !named.has(p.parent.id)) {
        named.add(p.parent.id);
        lines.push(`${lz("AndTheObjectiveItSitsUnder2", { text: esc(shortText(p.parent.text, 50)) })}`);
      }
    }
    for (const id of r.missing) lines.push(`${lz("NotFound2", { id: esc(id) })}`);
    done = !!r.q.revealed && !broken && r.parts.every(rowShown);
    if (a.dataset.page) lines.push(lz("DropMorePartsOfThisQuest"));
    const how = a.dataset.ask === "always" ? lz("ClickToChooseWhatToReveal") : lz("ClickToChooseWhatToReveal2");
    lines.push(`<em>${done ? lz("PlayersSeeAllOfThis") : how}</em>`);
  }
  const tip = `${r.q ? `<strong>${esc(r.q.name)}</strong><br>` : ""}${lines.join("<br>")}`;
  const state = `${done}|${broken}`;
  // Repainted on every change, so touch the link only when something about it changed.
  if (a.dataset.tooltipHtml === tip && a.dataset.state === state && a.firstChild) return;
  a.dataset.tooltipHtml = tip;
  a.dataset.state = state;
  a.classList.toggle("pct-done", done);
  a.classList.toggle("pct-broken", broken);
  const icon = document.createElement("i");
  icon.className = done ? "fa-solid fa-check" : "fa-solid fa-eye";
  a.replaceChildren(icon, document.createTextNode(a.dataset.label || lz("Reveal")));
}
/**
 * A link's parts with the new ones after them, in the quest's order: { parts, added }, or null when nothing is new.
 */
function partsWithMore(t, have, add) {
  const order = revealableIds(t);
  const fresh = [...new Set(add)].filter((id) => !have.includes(id) && order.includes(id) && !RL_BAD.test(String(id)))
    .sort((x, y) => order.indexOf(x) - order.indexOf(y));
  return fresh.length ? { parts: [...have, ...fresh], added: fresh } : null;
}
/** Is this match (of REVEAL_LINK) the link `a` was drawn from? Compared the way the enricher reads it. */
function sameLink(m, a) {
  const label = String(m[3] ?? "").trim() || lz("Reveal");
  return m[1].trim() === a.dataset.quest && splitIds(m[2]).join(",") === splitIds(a.dataset.parts).join(",") && label === a.dataset.label;
}
/** In plain text (a text node, or a Markdown source), give every copy of link `a` these parts. Each copy keeps its own
 * quest ref and label as written, and a link with no label stays without one. */
function rewriteLinks(text, a, parts) {
  let count = 0;
  const out = String(text).replace(new RegExp(REVEAL_LINK.source, "g"), (...g) => {
    if (!sameLink(g, a)) return g[0];
    count++;
    return `@QuestReveal[${g[1]}|${parts.join(",")}]${g[3] === undefined ? "" : `{${g[3]}}`}`;
  });
  return { text: out, count };
}
/** The same in stored HTML: rewrite inside text nodes, as the enricher reads them (entities, nbsp and quoting don't
 * matter). Null when no copy was found. */
function rewriteLinksInHTML(html, a, parts) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT);
  let count = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue.includes("@QuestReveal[")) continue;
    const r = rewriteLinks(n.nodeValue, a, parts);
    if (r.count) {
      n.nodeValue = r.text;
      count += r.count;
    }
  }
  return count ? { text: tpl.innerHTML, count } : null;
}
const splitIds = (x) => String(x ?? "").split(",").map((v) => v.trim()).filter(Boolean);
/** Pages being written to by a drop, so a second drop waits for the first. */
const dropBusy = new Set();
/** Parts dropped on a reveal link in a journal page: add them to the link in the page's text. */
async function addToRevealLink(a, droppedQuest, droppedParts) {
  if (!game.user.isGM) return;
  // A link a player may have written isn't changed by a drop (the change would make the page the GM's).
  if (a.dataset.ask === "always") return void ui.notifications.warn(lz("ThisLinkMayHaveBeenWritten"));
  const t = revealQuest(a.dataset.quest);
  if (!t) return void ui.notifications.warn(lz("ThisRevealLinkSQuestCan"));
  if (revealQuest(droppedQuest)?.id !== t.id) return void ui.notifications.warn(lz("ThatSFromAnotherQuestA"));
  const add = splitIds(droppedParts);
  if (!add.length) return void ui.notifications.info(lz("DropAPartSLinkIcon"));
  const next = partsWithMore(t, splitIds(a.dataset.parts), add);
  if (!next) return void ui.notifications.info(lz("ThisRevealLinkAlreadyCoversThat"));
  if (next.parts.join(",").length > 1000) return void ui.notifications.warn(lz("ThatWouldMakeTheLinkToo"));
  const page = await fromUuid(a.dataset.page);
  if (!page?.isOwner || page.pack) return void ui.notifications.warn(lz("YouCanTChangeThatPage"));
  if (dropBusy.has(page.uuid)) return void ui.notifications.info(lz("StillSavingTheLastDropOn"));
  // Its editor's next save would put back the text from before the drop.
  if (page.sheet?.rendered) return void ui.notifications.warn(lz("ThePageIsOpenForEditing", { name: esc(page.name) }));
  dropBusy.add(page.uuid);
  try {
    const changes = {};
    let count = 0;
    const html = rewriteLinksInHTML(page.text?.content ?? "", a, next.parts);
    // A Markdown page keeps its source in text.markdown and its HTML in text.content; both must change.
    const md = page.text?.format === CONST.JOURNAL_ENTRY_PAGE_FORMATS?.MARKDOWN;
    if (md) {
      const r = rewriteLinks(page.text?.markdown ?? "", a, next.parts);
      if (!r.count || (page.text?.content && !html)) return void ui.notifications.warn(lz("CouldnTFindThisLinkIn"));
      changes["text.markdown"] = r.text;
      if (html) changes["text.content"] = html.text;
      count = r.count;
    } else {
      if (!html) return void ui.notifications.warn(lz("CouldnTFindThisLinkIn"));
      changes["text.content"] = html.text;
      count = html.count;
    }
    await page.update(changes);
    const what = next.added.map((id) => rowLabel(t, id)).join("; ").replace(/[.!?]+$/, "");
    // The link may be shown somewhere else (embedded in another page): say which page changed.
    ui.notifications.info(esc(`${lz("AddedToTheRevealLinkIn", { name: page.name })}${count > 1 ? ` ${lz("AllCopiesInThePage", { count: count })}` : ""}: ${what}.`));
  } catch (err) {
    console.warn(`${MOD} | couldn't add to a reveal link`, err);
    ui.notifications.warn(lz("CouldnTChangeThePageEdit"));
  } finally {
    dropBusy.delete(page.uuid);
  }
}
const dropLink = (ev) => (game.user.isGM ? ev.target.closest?.("a.pct-reveal-link[data-page]") : null);
function onRevealDragOver(ev) {
  const a = dropLink(ev);
  if (!a || !ev.dataTransfer?.types?.includes("text/plain")) return;
  ev.preventDefault();
  ev.dataTransfer.dropEffect = "copy";
  a.classList.add("pct-drop-on");
}
function onRevealDragLeave(ev) {
  const a = ev.target.closest?.("a.pct-reveal-link");
  // Moving onto the icon inside the link isn't leaving it.
  if (a && !a.contains(ev.relatedTarget)) a.classList.remove("pct-drop-on");
}
function onRevealDrop(ev) {
  const a = dropLink(ev);
  if (!a) return;
  a.classList.remove("pct-drop-on");
  const m = [...String(ev.dataTransfer?.getData("text/plain") ?? "").matchAll(REVEAL_LINK)][0];
  // Anything else dropped here goes on to Foundry as usual.
  if (!m) return;
  ev.preventDefault();
  ev.stopPropagation();
  addToRevealLink(a, m[1].trim(), m[2] ?? "").catch((err) => console.warn(`${MOD} | reveal link drop`, err));
}

/** A reveal link was clicked (GM only: players get plain text). Shift reveals at once, as Shift skips a roll's
 * dialog. */
function onRevealLink(ev) {
  const a = ev.target.closest?.("a.pct-reveal-link");
  if (!a) return;
  ev.preventDefault();
  ev.stopPropagation();
  revealFromLink(a.dataset.quest, a.dataset.parts, { ask: !ev.shiftKey, trusted: a.dataset.ask !== "always" });
}

/** @Quest[id]{label} in journal text: a link that opens the quest. Ids are anything but "]" and spaces (preset ids
 * can hold dots). */
const QUEST_LINK = /@Quest\[([^\]\s]{1,100})\](?:\{([^}]{1,500})\})?/g;
function enrichQuestLink(match) {
  const [, id, label] = match;
  const a = document.createElement("a");
  a.className = "pct-quest-link";
  a.dataset.questId = id;
  if (label) a.dataset.label = label;
  paintQuestLink(a);
  return a;
}
/**
 * Draw a quest link as this user should see it. A player who can't see the quest sees neither its name nor the link's
 * label (a label could name a hidden quest), only "Unknown quest".
 */
function paintQuestLink(a) {
  const q = visibleTrackers().find((t) => t.id === a.dataset.questId && t.kind === "quest");
  const open = questsOpen();
  const known = !!q && open;
  a.classList.toggle("pct-quest-unknown", !known);
  if (known) delete a.dataset.tooltip;
  else a.dataset.tooltip = game.user.isGM ? lz("NoQuestWithThisId") : open ? lz("NotRevealedYet") : lz("TheGMHasnTOpenedThe2");
  const text = known ? a.dataset.label || q.name : game.user.isGM && a.dataset.label ? a.dataset.label : lz("UnknownQuest");
  const icon = document.createElement("i");
  icon.className = "fa-solid fa-scroll";
  a.replaceChildren(icon, document.createTextNode(text));
}
/** Links already on screen follow reveals, renames and the trackers loading after them. */
function repaintQuestLinks() {
  for (const a of document.querySelectorAll("a.pct-quest-link")) paintQuestLink(a);
  for (const a of document.querySelectorAll("a.pct-reveal-link")) paintRevealLink(a);
}
/** A quest link was clicked: another module may show it (return false from the hook), else the window opens on it. */
function onQuestLink(ev) {
  const a = ev.target.closest?.("a.pct-quest-link");
  if (!a) return;
  ev.preventDefault();
  ev.stopPropagation();
  const id = a.dataset.questId;
  if (!questsOpen()) return ui.notifications.info(lz("TheGMHasnTOpenedThe3"));
  if (!visibleTrackers().some((t) => t.id === id && t.kind === "quest")) return ui.notifications.info(lz("ThatQuestIsnTOpenTo"));
  if (Hooks.call(`${MOD}.questLink`, id, a) === false) return;
  openQuest(id);
}


export { RL_BAD, rlTool, rlBar, revealableIds, revealLinkText, copyText, revealQuest, resolveReveal, revealPlan, chooseReveal, readRevealForm, REVEAL_WORDS, applyReveal, revealBusy, revealFromLink, REVEAL_LINK, gmWrote, enrichRevealLink, paintRevealLink, partsWithMore, sameLink, rewriteLinks, rewriteLinksInHTML, splitIds, dropBusy, addToRevealLink, dropLink, onRevealDragOver, onRevealDragLeave, onRevealDrop, onRevealLink, QUEST_LINK, enrichQuestLink, paintQuestLink, repaintQuestLinks, onQuestLink };
