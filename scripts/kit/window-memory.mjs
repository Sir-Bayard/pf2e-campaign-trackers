/* Sir Bayard's module kit: window-memory 2. Copied unchanged into each module that uses it; edit the kit's source,
 * not this copy. Needs storage.mjs beside it. */

import { storage } from "./storage.mjs";

/* A window made with rememberWindow keeps the size and place the user gives it, in this browser, for this world and
 * user, and comes back from minimized whole: Foundry's restore animation can stall at the title bar's height (seen
 * on 14.370, core windows too) and Foundry sets the size while it runs, so a restored window came back as a strip. */

const MIN_W = 240;
const MIN_H = 120;

/** Wait for an element's own transitions to end; a hidden tab pauses them, so after a second they're finished by hand. */
async function settleWindow(el) {
  const anims = el?.getAnimations?.() ?? [];
  if (!anims.length) return;
  await Promise.race([Promise.all(anims.map((a) => a.finished.catch(() => null))), new Promise((r) => setTimeout(r, 1200))]);
  for (const a of el.getAnimations?.() ?? []) {
    try {
      a.finish();
    } catch {
      /* an animation that can't finish (infinite) is left alone */
    }
  }
}

/**
 * Give an ApplicationV2 class window memory.
 * @param {typeof ApplicationV2} Base
 * @param {object} opts
 * @param {string} opts.module          the module's id
 * @param {string} opts.name            the window's name within the module ("main", "archive")
 * @param {boolean|"width"} [opts.size] what to keep besides the place: true for width and height, "width" for a
 *   window whose height fits its content, false for a window sized wholly by its content
 * @param {string|string[]} [opts.from] the key or keys this window used before the kit, copied once
 */
export function rememberWindow(Base, { module, name, size = true, from } = {}) {
  const store = storage(module);
  const what = `window.${name}`;

  const load = () => {
    const v = store.get(what, null, { from });
    if (!v || typeof v !== "object") return {};
    const W = globalThis.innerWidth ?? 1920;
    const H = globalThis.innerHeight ?? 1080;
    const out = {};
    // Each dimension on its own; one below the least (saved while collapsed) is no size at all.
    if (size && v.width >= MIN_W) out.width = Math.min(v.width, W);
    if (size === true && v.height >= MIN_H) out.height = Math.min(v.height, H);
    const w = out.width ?? MIN_W;
    const h = out.height ?? MIN_H;
    if (Number.isFinite(v.left)) out.left = Math.max(0, Math.min(v.left, W - w));
    if (Number.isFinite(v.top)) out.top = Math.max(0, Math.min(v.top, H - h));
    return out;
  };

  let timer = null;
  /**
   * Save the place, and each dimension the window keeps that is a real size. A dimension that is "auto" (ApplicationV2's
   * default) or collapsed keeps what was saved before.
   */
  const save = (position) => {
    // Copy now: Foundry hands over its own live position object, which may change before the save runs.
    const v = { left: position.left, top: position.top };
    if (size && typeof position.width === "number" && position.width >= MIN_W) v.width = position.width;
    if (size === true && typeof position.height === "number" && position.height >= MIN_H) v.height = position.height;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const before = store.get(what, null, { from });
      const keep = before && typeof before === "object" ? before : {};
      const out = { ...v };
      if (size && out.width === undefined && keep.width >= MIN_W) out.width = keep.width;
      if (size === true && out.height === undefined && keep.height >= MIN_H) out.height = keep.height;
      store.set(what, out);
    }, 300);
  };

  return class extends Base {
    #beforeMin = null;
    #restoring = false;
    #restore = null;
    #minimizing = null;
    #collapsed = false;

    /**
     * True from a minimize until its restore is done. Unlike `minimized`, it holds during a redraw: ApplicationV2's
     * `minimized` reads false whenever the window isn't `rendered`, and `rendered` is false during every re-render, so
     * code a render runs (a "seen" mark) can't tell a minimized window from an open one by `minimized`.
     */
    get collapsed() {
      return this.#collapsed;
    }

    /** True while a restore from minimized (or a minimize a restore has to wait for) is under way. */
    get restoring() {
      return !!(this.#restore || this.#minimizing);
    }

    /** The window's options come first (as ApplicationV2's do); only a plain options object gets the saved place. */
    constructor(options = {}, ...rest) {
      const plain = options?.constructor === Object;
      super(plain ? foundry.utils.mergeObject({ position: load() }, options, { inplace: false }) : options, ...rest);
    }

    /** Restore a minimized window before drawing it: a draw that ends while it's collapsed takes the title bar's size. */
    async render(options = {}, _options = {}) {
      if ((this.minimized || this.#restore || this.#minimizing) && (options === true || options?.force)) {
        const open = this.rendered;
        await this.maximize();
        // Closed while it was being restored: don't open it again.
        const S = this.constructor.RENDER_STATES;
        if (open && S && (this.state === S.CLOSING || this.state === S.CLOSED)) return this;
      }
      return super.render(options, _options);
    }

    minimize() {
      if (this.#minimizing) return this.#minimizing;
      if (!this.minimized && this.rendered) {
        this.#collapsed = true;
        const auto = this.options.position ?? {};
        this.#beforeMin = {
          width: auto.width === "auto" ? "auto" : this.position.width,
          height: auto.height === "auto" ? "auto" : this.position.height,
        };
      }
      // Core marks the window minimized only once its animation ends; a restore asked for meanwhile waits for it.
      const p = (async () => super.minimize())();
      this.#minimizing = p.finally(() => (this.#minimizing = null));
      return this.#minimizing;
    }

    async maximize() {
      // Not forever: core's minimize waits for an animation frame, which a hidden tab never draws.
      if (this.#minimizing) await Promise.race([this.#minimizing.catch(() => null), new Promise((r) => setTimeout(r, 1200))]);
      // A restore already under way is the one to wait for.
      if (this.#restore) return this.#restore;
      if (!this.minimized) {
        this.#collapsed = false;
        return super.maximize();
      }
      this.#restore = this.#restoreWhole().finally(() => (this.#restore = null));
      return this.#restore;
    }

    async #restoreWhole() {
      const was = this.#beforeMin;
      this.#restoring = true;
      try {
        const pending = super.maximize();
        // getAnimations() flushes style, so the transition core just started exists and can be finished at once.
        for (const a of this.element?.getAnimations?.() ?? []) {
          try {
            a.finish();
          } catch {
            /* nothing to finish */
          }
        }
        await pending;
        this.#collapsed = false;
        await settleWindow(this.element);
        // Not if it was closed or minimized again meanwhile.
        if (was && this.rendered && !this.minimized) this.setPosition(was);
      } finally {
        this.#restoring = false;
      }
    }

    /** Remember the size and place the user gives the window (not while it's minimized or being restored). */
    _onPosition(position) {
      super._onPosition?.(position);
      if (!this.rendered || this.minimized || this.#minimizing || this.#restoring) return;
      if (![position.left, position.top].every(Number.isFinite)) return;
      save(position);
    }
  };
}
