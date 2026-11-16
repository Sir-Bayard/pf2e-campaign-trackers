/* Sir Bayard's module kit: gm-tabs 2. Copied unchanged into each module that uses it; edit the kit's source, not
 * this copy. */

/**
 * One GM in two browser tabs must not do the GM's work twice.
 *
 * Foundry's active GM is a user, not a tab: every tab of that user passes `game.users.activeGM.isSelf`, a stale tab
 * left open included. Each GM tab here takes a random id and tells the GM's other tabs about itself on the module's
 * socket (hello when it starts, then every 15 s). Only the tab with the lowest id among the active GM's live tabs
 * leads.
 *
 * - A new tab leads nothing for its first 1.5 s. Tabs it hears in that time were there before it and count at once;
 *   a tab the others hear of later counts for them a little before its own 1.5 s are up, so when a new tab takes the
 *   lead the old one lets go first: a short gap, never two leads. leadNow() in the new tab waits out the gap, so a
 *   request that arrives in it is still answered.
 * - A background tab's timers can slow to about once a minute, so a silent tab is forgotten only after 150 s, and a tab
 *   answers a hello at once and, at most every 5 s, any word from a tab with a higher id (socket messages aren't
 *   slowed).
 * - A tab going away says goodbye to the same browser's other tabs on a BroadcastChannel: a socket message sent while
 *   a page unloads never arrives (seen in the dev world, 14 Nov).
 * - A tab that vanishes without a goodbye (closed in another browser, crashed, frozen) holds the lead for up to 150 s
 *   for isLead(); leadNow() asks it first and takes over when it doesn't answer within 3 s. A lead that was only busy
 *   (a long scene load) and answers later gets the lead back at once; anything both tabs handled in between was done
 *   twice, so keep to leadNow() for work that is safe that way, or check the document first.
 * - leadNow() asks at most once every 5 s: a lower tab heard from in that time is taken to be there. A module whose
 *   work on a hook must not be dropped (a recorder) passes `fresh: 0`: a tab that isn't the lead then always asks, so
 *   a lead that has just gone without a goodbye the others got (a reload in another browser) is noticed within 3 s.
 *   The lead answers at once, so this costs a socket message each way only while the GM has two tabs.
 * - A tab that was asleep or frozen (its own beat late by more than 150 s) forgets what it knew and starts over with a
 *   hello and a new 1.5 s, rather than leading on a stale view.
 *
 * Each module runs its own election (its own socket and channel). The module needs `"socket": true` in module.json.
 * Call start() in every client, players included (it does nothing for them but lets settled() and leadNow() answer).
 * Use:
 *   const tabs = gmTabs(MODULE_ID);                    // at load
 *   Hooks.once("ready", () => {
 *     game.socket.on(`module.${MODULE_ID}`, onSocket);  // the handler first, so no answer is missed
 *     tabs.start();
 *   });
 *   in the module's socket handler, first:   if (tabs.handle(msg, senderId)) return;
 *   GM work on an event (a player's request, a hook):   if (!(await tabs.leadNow())) return;
 *   where waiting isn't possible (drawing, a sync check):   if (!tabs.isLead()) return;
 *   work done once at startup:   if (await tabs.leadNow()) ...   (leadNow waits out the first 1.5 s)
 *
 * @param {string} module   the module's id
 * @param {object} [opts]   `fresh` in ms (see above; default 5000); for tests: `now` (a clock), `ttl`, `beat`, `grace`,
 *                          `answer` in ms
 */
export function gmTabs(module, { now = () => Date.now(), ttl = 150000, beat = 15000, grace = 1500, answer = 3000, fresh = 5000 } = {}) {
  const channel = `module.${module}`;
  const me = globalThis.crypto?.randomUUID?.() ?? `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  /** Each other tab's id: when it was first and last heard from, and whether it failed to answer a ping. */
  const others = new Map();
  /** How much sooner than its own grace a newly heard tab counts for this one, so the hand-over leaves a gap. */
  const early = Math.min(500, grace / 3);
  let warned = false;
  let onHeard = null;
  let lastAnswer = -Infinity;
  let started = false;
  let isGM = false;
  let timer = null;
  let lastBeat = 0;
  let graceUntil = Infinity;
  let local = null;
  let asking = null;
  const listeners = [];

  let settle;
  let settledP = null;
  let settleTimer = null;
  /** The promise settled() hands out; a new one only once the last has resolved, so no one waits on a stale one. */
  const pending = () => {
    if (!settledP) {
      settledP = new Promise((r) => {
        settle = () => {
          settledP = null;
          r();
        };
      });
    }
    return settledP;
  };
  pending();
  /** A new grace: lead nothing until it ends; settled() resolves when it does. */
  const newGrace = () => {
    graceUntil = now() + grace;
    pending();
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => settle(), grace);
  };

  const isActiveGM = () => {
    const g = globalThis.game;
    return !!(g?.user?.isGM && g.users?.activeGM?.id === g.user.id);
  };
  const emit = (msg) => {
    try {
      globalThis.game?.socket?.emit(channel, msg);
    } catch {
      /* no socket yet: the next beat tries again */
    }
  };
  const announce = (hello = false) => {
    if (isGM) emit({ type: "gmtab", client: me, hello });
  };
  const bye = () => {
    try {
      local?.postMessage({ type: "gmbye", client: me });
    } catch {
      /* closing */
    }
    emit({ type: "gmbye", client: me });
  };
  const heard = (id) => {
    const o = others.get(id);
    const t = now();
    // A tab heard during this tab's own grace was there first (or started with it): it counts at once.
    others.set(id, { first: o?.first ?? (t < graceUntil ? -Infinity : t), at: t, quiet: false });
    onHeard?.(id);
  };
  const prune = () => {
    const t = now();
    for (const [id, o] of others) if (t - o.at > ttl) others.delete(id);
  };
  /** Start over after a sleep: what this tab knew may be stale. */
  const rejoin = () => {
    others.clear();
    lastBeat = now();
    newGrace();
    announce(true);
  };
  /** A beat late by more than the time to live means this tab was asleep or frozen. */
  const awake = () => {
    if (!started || !isGM) return;
    if (now() - lastBeat > ttl) rejoin();
  };
  /** Tabs with lower ids that count: not silent at the last ping, and known long enough. */
  const lower = () => {
    const t = now();
    return [...others].filter(([id, o]) => id < me && !o.quiet && t - o.first >= grace - early).map(([id]) => id);
  };
  const isLead = () => {
    if (!started || !isActiveGM()) return false;
    awake();
    if (now() < graceUntil) return false;
    prune();
    return lower().length === 0;
  };
  const validId = (id) => typeof id === "string" && id.length > 0 && id.length <= 64 && id !== me;

  /**
   * Ask the tabs with lower ids whether they're there. Any answer ends the wait; the ones that don't answer in time are
   * marked quiet (not counted) until they're heard again, keeping when they were first heard.
   */
  const ask = async () => {
    const ids = new Set(lower());
    if (!ids.size) return;
    let answered = false;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, answer);
      onHeard = (id) => {
        if (!ids.has(id)) return;
        answered = true;
        clearTimeout(timer);
        resolve();
      };
      // Listen first, then ask: an answer can come back before the next line runs.
      emit({ type: "gmping", client: me });
    });
    onHeard = null;
    if (answered) return;
    for (const id of ids) {
      const o = others.get(id);
      if (o) o.quiet = true;
    }
  };

  const beatOnce = () => {
    awake();
    lastBeat = now();
    announce(false);
  };

  const on = (target, type, fn) => {
    if (!target?.addEventListener) return;
    target.addEventListener(type, fn);
    listeners.push([target, type, fn]);
  };

  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
    if (started && isGM) bye();
    for (const [target, type, fn] of listeners.splice(0)) target.removeEventListener(type, fn);
    try {
      local?.close();
    } catch {
      /* already closed */
    }
    local = null;
    started = false;
  };

  return {
    /** This tab's id. */
    id: me,

    /** Start announcing this tab. Call once, at `ready`, after the socket handler is in place. */
    start() {
      if (started) return;
      started = true;
      const g = globalThis.game;
      isGM = !!g?.user?.isGM;
      if (!isGM) {
        graceUntil = -Infinity;
        pending();
        settle();
        return;
      }
      try {
        local = new globalThis.BroadcastChannel(`${module}.gm-tabs.${g.user.id}`);
        local.onmessage = (ev) => {
          const m = ev?.data;
          if (m?.type === "gmbye" && validId(m.client)) others.delete(m.client);
        };
      } catch {
        local = null;
      }
      lastBeat = now();
      newGrace();
      announce(true);
      timer = setInterval(beatOnce, beat);
      on(globalThis, "pagehide", bye);
      // Chrome may freeze a background tab and bring it back later, or keep a page to come back to (bfcache).
      on(globalThis.document, "freeze", bye);
      on(globalThis.document, "resume", rejoin);
      on(globalThis, "pageshow", (ev) => ev?.persisted && rejoin());
    },

    /** Stop announcing and say goodbye (tests, or a module turned off without a reload). */
    stop,

    /**
     * Take this kit's socket messages. Call first in the module's socket handler with Foundry's sender id; returns
     * true when the message was one of these (handled or ignored), so the handler stops there.
     */
    handle(msg, senderId) {
      if (msg?.type !== "gmtab" && msg?.type !== "gmbye" && msg?.type !== "gmping") return false;
      const g = globalThis.game;
      // Only the same GM user's other tabs count.
      if (!g?.user?.isGM || senderId !== g.user.id || !validId(msg.client)) return true;
      if (msg.type === "gmbye") {
        others.delete(msg.client);
        return true;
      }
      if (!started) return true;
      awake();
      heard(msg.client);
      if (msg.type === "gmping" || msg.hello === true) announce(false);
      else if (msg.client > me && now() - lastAnswer > 5000) {
        lastAnswer = now();
        announce(false);
      }
      return true;
    },

    /** True in the one tab that should do the GM's work: the active GM's live tab with the lowest id. */
    isLead,

    /**
     * Like isLead, but waits out this tab's first 1.5 s, and a tab that isn't the lead first asks the tabs with lower
     * ids whether they're there (up to 3 s, at most once every 5 s) and takes over from any that don't answer. The lead
     * answers at once.
     */
    async leadNow() {
      if (!started) {
        if (!warned) console.warn(`${module} | gm-tabs: leadNow() called before start(); call start() at ready`);
        warned = true;
        return false;
      }
      if (!isActiveGM()) return false;
      awake();
      if (now() < graceUntil) await new Promise((r) => setTimeout(r, Math.max(0, graceUntil - now())));
      if (isLead()) return true;
      // A lower tab heard from just now is there: no need to ask.
      const t = now();
      if (lower().every((id) => t - others.get(id).at < fresh)) return false;
      asking ??= ask().finally(() => (asking = null));
      await asking;
      return isLead();
    },

    /** Resolves when this tab's first 1.5 s are over (at once in a player's client, after start). */
    settled() {
      return settledP ?? Promise.resolve();
    },

    /** What this tab knows, for checking from the console. */
    info() {
      prune();
      return { me, others: [...others.keys()], lead: isLead() };
    },

    /** For tests: run one beat now, as the timer would. */
    _beat: beatOnce,
  };
}
