/* Sir Bayard's module kit: keyboard 1. Copied unchanged into each module that uses it; edit the kit's source, not
 * this copy. */

/*
 * One pattern for windows that work from the keyboard, the same in every module.
 *
 * Markup:
 * - Everything that does something on a click is a <button type="button">; a row that can be picked has a button
 *   filling the row. A button that shows only an icon gets labelAttr() from safe-text (an aria-label and a plain-text
 *   tooltip with the same words), and its icon aria-hidden="true".
 * - A toggle carries aria-pressed and keeps the same label in both states. A fold is a <details>, or a button with
 *   aria-expanded (and aria-controls naming what it opens).
 * - Tabs are buttons with role="tab", aria-selected and aria-controls, inside role="tablist"; the panel has
 *   role="tabpanel" and aria-labelledby. Each tab is its own Tab stop (on purpose: simpler than arrow keys between
 *   tabs). Buttons that only filter a list, with no panel, are aria-pressed toggles instead.
 * - Something that must be dragged may stay an element with role="button" and tabindex="0" (Firefox drags buttons
 *   badly); Enter and Space work it like a click. It must not hold other controls. Every drag also has a way to do the
 *   same from the keyboard (a button or a menu: Move to group, File under, Move up).
 * - Mark the place focus should go when its own control is gone with data-focus-home: the active tab, or a list with
 *   tabindex="-1" (it must be able to take focus). Mark a control whose identity the kit can't see with
 *   data-focus-key, and a scrolling list with data-keep-scroll="name".
 * - The kit adds data-keyboard-focus and data-kit-keys to the focused control while keys are its own: don't copy a
 *   control's whole dataset into data that is saved or sent.
 *
 * keyboardWindow(Base) keeps focus where it was across a redraw, keeps the window's keys from Foundry's keybindings,
 * and shows where focus is.
 */

/** Data attributes that say nothing about which element it is. */
const NOT_IDENTITY = new Set(["action", "tooltip", "tooltipText", "tooltipHtml", "tooltipDirection", "tooltipClass", "focusKey", "keepScroll", "focusHome", "keyboardFocus", "kitKeys"]);
/** Data attributes that usually name a thing (rather than its state), kept when the others don't find it again. */
const ID_LIKE = /^(id|key|uuid|index|idx|tab|name|path|slot|role|kind|type|section|group|part|field)$|[a-z0-9](Id|Key|Uuid|Index|Idx|Tab|Name|Path|Slot|Role|Kind|Type|Section|Group|Part|Field)$/;
const TEXT_TYPES = new Set(["text", "search", "url", "tel", "password", "email", "number"]);
const CONTROL = 'button, a[href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"]), [role="button"], [role="tab"]';

const esc = (v) => (globalThis.CSS?.escape ? CSS.escape(String(v)) : String(v).replace(/[^\w-]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `));
const attrName = (key) => `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
const attr = (name, value) => `[${esc(name)}="${esc(value)}"]`;

/** querySelectorAll that never throws (a selector built from odd data can be invalid). */
function all(root, selector) {
  try {
    return [...root.querySelectorAll(selector)];
  } catch {
    return [];
  }
}

/** The element's own identity, or null: data-focus-key, id, or name (with the value for radios, checkboxes, buttons). */
function ownKey(el) {
  const tag = el.tagName.toLowerCase();
  if (el.dataset?.focusKey) return attr("data-focus-key", el.dataset.focusKey);
  if (el.id) return `#${esc(el.id)}`;
  const name = el.getAttribute("name");
  if (name) {
    const grouped = (tag === "input" && (el.type === "radio" || el.type === "checkbox")) || tag === "button";
    return `${tag}${attr("name", name)}${grouped && el.hasAttribute("value") ? attr("value", el.getAttribute("value")) : ""}`;
  }
  return null;
}

/** data-action with the element's other data attributes: all of them, or only the ones that name a thing. */
function actionKey(el, { idLike = false } = {}) {
  if (!el.dataset?.action) return null;
  let s = attr("data-action", el.dataset.action);
  for (const [k, v] of Object.entries(el.dataset)) {
    if (NOT_IDENTITY.has(k) || (idLike && !ID_LIKE.test(k))) continue;
    s += attr(attrName(k), v);
  }
  return s;
}

/** The nearest ancestor below `root` with an identity of its own (a row's data-id, a section's id). */
function ancestorKey(el, root) {
  for (let a = el.parentElement; a && a !== root; a = a.parentElement) {
    if (a.dataset?.focusKey) return attr("data-focus-key", a.dataset.focusKey);
    if (a.id) return `#${esc(a.id)}`;
    const named = Object.entries(a.dataset ?? {}).filter(([k]) => !NOT_IDENTITY.has(k) && ID_LIKE.test(k));
    if (named.length) return named.map(([k, v]) => attr(attrName(k), v)).join("");
  }
  return null;
}

/**
 * Ways to find the same element after a redraw, most exact first, each with which match it was (when several match).
 * A fold's <summary> is found by its <details> (data-focus-key, id or Foundry's data-sync).
 */
export function identify(el, root) {
  if (!el || el.nodeType !== 1 || !root) return [];
  const self = [];
  const own = ownKey(el);
  const anc = ancestorKey(el, root);
  // A named control repeated in each row (a box per row) is found by its row first.
  if (own && anc && !own.startsWith("#")) self.push(`${anc} ${own}`);
  if (own) self.push(own);
  if (el.tagName === "SUMMARY" && el.parentElement?.tagName === "DETAILS") {
    const d = el.parentElement;
    const of = d.dataset.focusKey ? attr("data-focus-key", d.dataset.focusKey) : d.id ? `#${esc(d.id)}` : d.dataset.sync ? `details${attr("data-sync", d.dataset.sync)}` : null;
    if (of) self.push(`${of} > summary`);
  }
  const full = actionKey(el);
  const named = actionKey(el, { idLike: true });
  if (full && anc) self.push(`${anc} ${full}`);
  if (named && anc && named !== full) self.push(`${anc} ${named}`);
  if (full) self.push(full);
  if (named && named !== full) self.push(named);
  const ways = [...new Set(self)].map((sel) => ({ sel }));
  // The plainest way, an action alone, may land on a neighbor when its own row is gone.
  const plain = full && attr("data-action", el.dataset.action);
  if (plain && !self.includes(plain)) ways.push({ sel: plain, plain: true });
  else if (plain) ways.find((w) => w.sel === plain).plain = true;
  for (const w of ways) {
    const matches = all(root, w.sel);
    w.index = Math.max(0, matches.indexOf(el));
    w.count = matches.length;
  }
  return ways;
}

/** The first way that still finds exactly what it found before; the plainest way may land on a neighbor. */
function resolve(root, ways) {
  for (const { sel, index, count, plain } of ways ?? []) {
    const matches = all(root, sel);
    if (!matches.length) continue;
    if (matches.length === 1 && count <= 1) return matches[0];
    if (matches.length === count) return matches[index];
    // An action alone: the same place in the list, or the nearest one left.
    if (plain) return matches[Math.min(index, matches.length - 1)];
  }
  return null;
}

const docOf = (root) => root?.ownerDocument ?? globalThis.document;
/** Is focus lost: on nothing, on the page's body, or on an element no longer in the page? */
const focusLost = (doc) => {
  const a = doc?.activeElement;
  return !a || a === doc.body || a === doc.documentElement || !a.isConnected;
};
const canFocus = (el) => el && !el.disabled && !el.closest("[inert]") && el.isConnected;
/** Focus `el` and say whether it took (a hidden element, or one that can't take focus, doesn't). */
const tryFocus = (el) => {
  if (!canFocus(el)) return false;
  el.focus({ preventScroll: true });
  return docOf(el).activeElement === el;
};
/**
 * How focus last moved in each page: "key" after a Tab, "pointer" after a press of the mouse, pen or finger. Like the
 * browser's own :focus-visible, but known to the kit and the same when a redraw puts focus back by script.
 */
const modes = new WeakMap();
const watched = new WeakSet();
function watchModality(doc) {
  if (!doc?.addEventListener || watched.has(doc)) return;
  watched.add(doc);
  moves.set(doc, 0);
  doc.addEventListener(
    "keydown",
    (ev) => {
      if (ev.key !== "Tab") return;
      modes.set(doc, "key");
      moves.set(doc, moves.get(doc) + 1);
    },
    true,
  );
  doc.addEventListener(
    "pointerdown",
    () => {
      modes.set(doc, "pointer");
      moves.set(doc, moves.get(doc) + 1);
    },
    true,
  );
}
const byKeyboard = (el) => modes.get(docOf(el)) === "key";

/**
 * What a redraw should give back: which element had focus, its caret, kept scroll positions, and whether focus is
 * still where an earlier restore put it (`retry`, see restoreFocus).
 */
export function captureFocus(root, { retry = null } = {}) {
  const doc = docOf(root);
  const active = doc?.activeElement;
  const inside = !!(root && active && active !== root && root.contains(active));
  const onPlaced = !!retry && !!active && (retry.placed ? resolve(root, retry.placed) === active : active === root);
  const state = { inside, onPlaced, ways: inside ? identify(active, root) : [], caret: null, scroll: [], kitKeys: !!active?.dataset && active.dataset.kitKeys !== undefined && root?.contains(active), name: inside ? active.getAttribute("name") : null };
  if (inside && (active.tagName === "TEXTAREA" || (active.tagName === "INPUT" && TEXT_TYPES.has(active.type)))) {
    try {
      state.caret = [active.selectionStart, active.selectionEnd, active.selectionDirection];
    } catch {
      /* a number box has no caret */
    }
  }
  const seen = {};
  for (const el of all(root, "[data-keep-scroll]")) {
    const k = el.dataset.keepScroll;
    seen[k] = (seen[k] ?? -1) + 1;
    state.scroll.push([k, seen[k], el.scrollTop, el.scrollLeft]);
  }
  return state;
}

/**
 * Put back what captureFocus saw, after a redraw. Focus goes back only when it was inside `root` and is now lost (so a
 * window never takes focus from where the user moved it): to the same element, else to `[data-focus-home]`, else to
 * `root` itself. One exception: core's Handlebars redraw puts a radio or checkbox group back by name alone, so a
 * control of the same name is corrected to the one that had focus.
 * `retry` is what an earlier call returned for a button it found disabled: tried again while focus is still where that
 * call put it, for a few redraws. Returns the same for this call, or null.
 */
export function restoreFocus(root, state, { retry = null, userMoved = false } = {}) {
  const doc = docOf(root);
  if (!root?.isConnected || !state) return null;
  for (const [k, i, top, left] of state.scroll) {
    const el = all(root, `[data-keep-scroll="${esc(k)}"]`)[i];
    if (el) Object.assign(el, { scrollTop: top, scrollLeft: left });
  }
  // The window keys' mark moves to the redrawn element (not the window itself, which never takes keys but Tab).
  const mark = (x) => {
    if (state.kitKeys && x?.dataset && x !== root && x.dataset.keyboardFocus === undefined) {
      x.dataset.keyboardFocus = "true";
      x.dataset.kitKeys = "";
    }
    return x;
  };
  // A button that was disabled: back to it once it's enabled, if focus was still where it was put when this redraw
  // began (and is there or lost now). Kept for a few redraws, dropped when the user moves focus.
  let pending = null;
  if (retry && retry.left > 0 && !userMoved && state.onPlaced) {
    const placed = retry.placed ? resolve(root, retry.placed) : root;
    const resting = focusLost(doc) || doc.activeElement === placed;
    if (resting) {
      const el = resolve(root, retry.ways);
      if (el && !el.disabled && tryFocus(mark(el))) return null;
      if (el?.disabled) pending = { ...retry, left: retry.left - 1 };
    }
  }
  if (!state.inside || userMoved) return null;
  const el = resolve(root, state.ways);
  if (!focusLost(doc)) {
    // Core put back a control of the same name (a radio group by name alone): correct it to the one that had focus.
    const a = doc.activeElement;
    if (el && a !== el && state.name && root.contains(a) && a.getAttribute("name") === state.name) tryFocus(mark(el));
    return pending;
  }
  if (el && !el.disabled && tryFocus(mark(el))) {
    if (state.caret && typeof el.setSelectionRange === "function") {
      try {
        el.setSelectionRange(...state.caret);
      } catch {
        /* not a text box any more */
      }
    }
    return pending;
  }
  const home = all(root, "[data-focus-home]").find(canFocus);
  let placed = null;
  if (home && tryFocus(mark(home))) placed = identify(home, root);
  else {
    if (!root.hasAttribute("tabindex")) root.setAttribute("tabindex", "-1");
    root.focus({ preventScroll: true });
  }
  if (el?.disabled) return { ways: state.ways, placed, left: 5 };
  return pending && { ...pending, placed: placed ?? pending.placed };
}

/** Elements that act like buttons but aren't, worked with Enter and Space. */
const PRESSABLE = '[role="button"]:not(button):not(a[href]), [role="tab"]:not(button), [role="menuitem"]:not(button)';
/**
 * Keys a window's controls use. Foundry 14 runs its keybindings whenever focus isn't in a text box (or a button inside
 * a <form>): Tab cycles the tokens on the map, Space pauses the game, the arrows pan, Delete removes the selected
 * tokens. So on a button in one of our windows, Tab never moved focus and Space paused the game instead of pressing it
 * (seen in the dev world, 14 Nov). Tab and Shift+Tab are always the window's. The others are the window's only when
 * focus last moved by Tab: after a click with the mouse, Space still pauses and the arrows still pan. (The PF2e system
 * goes further and takes focus off any button on mouseup, so there a click leaves focus on the page.)
 * Escape, other keys and keys with Ctrl, Alt or Meta (or Shift, but for Tab) still reach Foundry, as long as Foundry
 * doesn't treat the control as focused itself (a button in a window whose root is a <form> keeps every key).
 */
const WINDOW_KEYS = new Set(["Enter", " ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Delete", "Backspace"]);
const listening = new WeakSet();
/** Per page: a count of pointer presses and Tab presses, which move focus (see keyboardWindow's render). */
const moves = new WeakMap();

const unmark = (el) => {
  if (el?.dataset?.kitKeys === undefined) return;
  delete el.dataset.keyboardFocus;
  delete el.dataset.kitKeys;
};

/**
 * Keyboard handling for a window's root: the window's keys kept from Foundry's keybindings while one of its controls
 * has focus (Foundry is told so through its own `data-keyboard-focus` attribute, for that key only), and Enter and
 * Space on an element with role="button" (or tab or menuitem) that isn't a real button. Safe to call on every render:
 * it listens once per root. A control the module marks data-keyboard-focus itself is left alone.
 */
export function windowKeys(root) {
  // (each time: a detached window moves the same element into another page, which needs its own watcher)
  watchModality(docOf(root));
  if (!root?.addEventListener || listening.has(root)) return;
  listening.add(root);
  /**
   * Which keys stay with the window for the focused element: Tab and Shift+Tab anywhere in it (the window itself and
   * a home list included); the other window keys on a control or a home element, when focus came by keyboard.
   */
  const ours = (el, ev) => {
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return false;
    if (ev.key === "Tab") return true;
    if (ev.shiftKey || !WINDOW_KEYS.has(ev.key) || el === root) return false;
    return (el.matches(CONTROL) || el.hasAttribute("data-focus-home")) && byKeyboard(el);
  };
  const mark = (ev) => {
    const el = ev.target;
    if (!el?.dataset || !(el === root || root.contains(el))) return false;
    if (el.matches?.("input, select, textarea, [contenteditable]")) return false;
    if (el.dataset.keyboardFocus !== undefined && el.dataset.kitKeys === undefined) return false;
    const yes = ours(el, ev);
    if (yes) {
      el.dataset.keyboardFocus = "true";
      el.dataset.kitKeys = "";
    } else unmark(el);
    return yes;
  };
  // Foundry reads the attribute in its own window listener, which runs after these.
  root.addEventListener("keyup", mark, true);
  root.addEventListener(
    "keydown",
    (ev) => {
      const yes = mark(ev);
      if (ev.repeat || ev.defaultPrevented || ev.altKey || ev.ctrlKey || ev.metaKey) return;
      // Only the element itself, not a control inside it.
      const el = ev.target;
      if (!el?.matches?.(PRESSABLE) || el.getAttribute("aria-disabled") === "true") return;
      // Enter is no keybinding of Foundry's, so it always presses; Space only when it's the window's.
      if (ev.key === "Enter" || (ev.key === " " && yes)) {
        ev.preventDefault();
        el.click();
      }
    },
    true,
  );
  root.addEventListener("focusout", (ev) => unmark(ev.target), true);
}

/**
 * Show where focus is, in this module's windows: one :focus-visible rule under `scope` (a selector for the module's
 * window class), in Foundry's own focus color, inside the outline so a scrolling list doesn't clip it. Added once per
 * module to each page a window shows in (a detached window has its own).
 */
export function focusStyle(module, scope, doc = globalThis.document) {
  const id = `${module}-kit-focus`;
  if (!doc?.head || doc.getElementById(id)) return;
  const style = doc.createElement("style");
  style.id = id;
  style.textContent = `:is(${scope}) :is(button, a[href], summary, select, input, textarea, [tabindex], [role="button"], [role="tab"]):focus-visible {
  outline: 2px solid var(--button-focus-outline-color, var(--input-focus-outline-color, #b5563b));
  outline-offset: -2px;
}
:is(${scope})[tabindex="-1"]:focus { outline: none; }`;
  doc.head.append(style);
}

const LIVE_STYLE = { position: "absolute", width: "1px", height: "1px", margin: "-1px", padding: "0", border: "0", overflow: "hidden", clip: "rect(0 0 0 0)", clipPath: "inset(50%)", whiteSpace: "nowrap" };
const timers = new WeakMap();

/**
 * The page's polite live region (one for every module, on the page's body, so no redraw takes it away), made empty if
 * missing. keyboardWindow makes it at the first render: a region added just before a message is often not read.
 */
export function liveRegion(root) {
  const doc = docOf(root);
  if (!doc?.body) return null;
  let live = doc.getElementById("kit-live");
  if (!live) {
    live = doc.createElement("div");
    live.id = "kit-live";
    live.setAttribute("role", "status");
    live.setAttribute("aria-live", "polite");
    Object.assign(live.style, LIVE_STYLE);
    doc.body.append(live);
  }
  return live;
}

/**
 * Say something to screen readers without moving focus (a list filtered, a chip added). `root` is any element of the
 * window (for its page). A newer message replaces one not yet spoken.
 */
export function announce(root, text) {
  const live = liveRegion(root);
  if (!live) return;
  clearTimeout(timers.get(live));
  // Cleared first, so the same words twice are read twice.
  live.textContent = "";
  timers.set(
    live,
    setTimeout(() => (live.textContent = String(text ?? "")), 100),
  );
}

/**
 * Give an ApplicationV2 class the keyboard pattern: focus kept across every redraw (render, whole or in parts), the
 * window's keys kept from Foundry's keybindings, Enter and Space on role="button" elements, a live region for
 * this.announceText(text), and the focus outline.
 * @param {typeof ApplicationV2} Base
 * @param {object} opts
 * @param {string} opts.module   the module's id
 * @param {string} opts.scope    a selector for the module's windows, for the focus outline (".pf2e-marketplace")
 */
export function keyboardWindow(Base, { module, scope } = {}) {
  return class extends Base {
    #retry = null;

    /* All in render(), not the render hooks: a module's own _onFirstRender or _replaceHTML often doesn't call super. */
    async render(options = {}, _options = {}) {
      // (not `rendered`, which is false while another render runs)
      const root = this.element?.isConnected ? this.element : null;
      const state = root ? captureFocus(root, { retry: this.#retry }) : null;
      const doc = docOf(root);
      const before = root ? moves.get(doc) : 0;
      const result = await super.render(options, _options);
      const el = this.element;
      if (el?.isConnected) {
        if (module && scope) focusStyle(module, scope, docOf(el));
        windowKeys(el);
        liveRegion(el);
      }
      // A click (anywhere in the page) or a Tab while the redraw ran moved focus on purpose: leave it.
      if (state && el === root) this.#retry = restoreFocus(root, state, { retry: this.#retry, userMoved: moves.get(doc) !== before });
      return result;
    }

    /** Say something to screen readers (see announce). */
    announceText(text) {
      announce(this.element, text);
    }
  };
}
