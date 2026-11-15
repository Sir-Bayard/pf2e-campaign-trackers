/* Sir Bayard's module kit: single-window 1. Copied unchanged into each module that uses it; edit the kit's source,
 * not this copy. */

/**
 * One window at a time for an ApplicationV2 class.
 *
 * A window that registers itself only once its first render is done can be opened twice: a second click, a hotkey
 * or another module's `api.open()` arriving while the first render awaits something builds a second window with the
 * same element id. Here the window is known from the moment it is made. A window that is closing (Foundry fades it
 * out) is let finish first, so the new one never shares its element id with the old one on the page.
 *
 * @param {(...args) => object} make   builds a new window from open()'s arguments
 * @param {object} [opts]
 * @param {(app, ...args) => void} [opts.reuse]   applies open()'s arguments to the window already open (a tab to
 *   show, an entry to select) before it is drawn again
 * @param {number} [opts.wait]   the longest open() waits for a close in progress (ms); past it, open() goes ahead
 * @returns {{ open: (...args) => Promise<object>, current: () => object|null }}
 */
export function singleWindow(make, { reuse, wait = 5000 } = {}) {
  let app = null;
  let closing = null;

  const forget = (a) => {
    if (app === a) app = null;
  };

  /** Make a new window, known at once, which forgets itself as soon as it starts to close. */
  const build = (args) => {
    const a = make(...args);
    const close = a.close;
    a.close = function (options) {
      if (app === a) {
        app = null;
        const done = (async () => close.call(a, options))();
        const settled = done
          .catch(() => {
            // A close that failed (a _preClose that threw) leaves the window drawn: it is still the one.
            if (app === null && a.rendered) app = a;
          })
          .finally(() => {
            if (closing === settled) closing = null;
          });
        closing = settled;
        return done;
      }
      return close.call(a, options);
    };
    // A close that doesn't go through close() (none known in Foundry 14) still forgets it.
    a.addEventListener?.("close", () => forget(a));
    app = a;
    return a;
  };

  async function open(...args) {
    // A close that never ends (a deadlocked window) mustn't block every later open() until a reload.
    const until = Date.now() + wait;
    while (closing && Date.now() < until) {
      await Promise.race([closing, new Promise((r) => setTimeout(r, Math.max(0, until - Date.now())))]);
    }
    // Given up on: later opens don't wait for it again.
    if (closing && Date.now() >= until) closing = null;
    let a = app;
    if (a) {
      reuse?.(a, ...args);
    } else a = build(args);
    try {
      if (a.minimized) await a.maximize?.();
      await a.render({ force: true });
    } catch (err) {
      // A first draw that failed leaves nothing worth keeping.
      if (!a.rendered) forget(a);
      throw err;
    }
    if (a.rendered && app === a) {
      try {
        a.bringToFront?.();
      } catch {
        /* bringToFront throws before the first render */
      }
    }
    return a;
  }

  return { open, current: () => app };
}
