/* Sir Bayard's module kit: storage 1. Copied unchanged into each module that uses it; edit the kit's source, not
 * this copy. */

/**
 * Browser storage for one module, kept per world and per user: two worlds on one server share a browser's
 * localStorage, and so do two users who log in from the same browser.
 *
 * Keys read `<module>.<what>.<world id>.<user id>`. Nothing here throws: storage that is blocked, full or holding
 * junk gives the fallback, and a write that fails is dropped. Before the world and the user are known (before
 * `setup`) nothing is read or written.
 *
 * @param {string} module   the module's id
 */
export function storage(module) {
  const key = (what) => {
    const world = globalThis.game?.world?.id;
    const user = globalThis.game?.user?.id;
    return world && user ? `${module}.${what}.${world}.${user}` : null;
  };
  const read = (k) => {
    try {
      const raw = globalThis.localStorage?.getItem(k);
      return raw == null ? undefined : JSON.parse(raw);
    } catch {
      return undefined;
    }
  };
  const write = (k, value) => {
    try {
      if (!globalThis.localStorage) return false;
      globalThis.localStorage.setItem(k, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  };

  return {
    /** The full key for `what`, or null before the world and user are known. */
    key,

    /**
     * The value stored for `what`, or `fallback`.
     * @param {string} what
     * @param {*} [fallback]
     * @param {object} [opts]
     * @param {string|string[]} [opts.from]  older keys (whole keys, as the module wrote them before) to copy from
     *   once when this key holds nothing. The old key is left in place: it may be shared with other worlds.
     */
    get(what, fallback = undefined, { from } = {}) {
      const k = key(what);
      if (!k) return fallback;
      let v = read(k);
      if (v === undefined && from) {
        for (const old of [from].flat()) {
          if (typeof old !== "string" || !old) continue;
          const o = read(old);
          if (o === undefined || o === null) continue;
          v = o;
          write(k, o);
          break;
        }
      }
      return v === undefined || v === null ? fallback : v;
    },

    /** Store `value` (anything JSON can hold; not undefined) for `what`. Returns false when it wasn't stored. */
    set(what, value) {
      const k = key(what);
      return k && value !== undefined ? write(k, value) : false;
    },
  };
}
