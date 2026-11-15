/* Sir Bayard's module kit: safe-text 1. Copied unchanged into each module that uses it; edit the kit's source, not
 * this copy. */

/* Foundry 14 runs notification text and `data-tooltip` through cleanHTML, which strips script but keeps other markup,
 * so a name a player or an imported file wrote can show as markup in someone else's client. An element with
 * `data-tooltip=""` and an `aria-label` shows the label the same way. `data-tooltip-text` is set as plain text, and an
 * `aria-label` with no `data-tooltip` is never shown as a tooltip (checked in 14.370's TooltipManager). */

/** Text made safe to put inside HTML, as element content or as a quoted attribute value. */
export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/**
 * A tag for template literals: the text written in the code is kept as it is, every `${value}` is escaped.
 * Use it for every notification that carries a value: ui.notifications.warn(safe`Couldn't read ${name}.`).
 * Called as a plain function on anything else, it escapes the whole of it.
 * Not with Foundry's own `{ format }` option, which escapes its values already: use one or the other. But
 * game.i18n.format() escapes nothing: escape what goes into it (`{ name: esc(name) }`).
 */
export function safe(strings, ...values) {
  if (!Array.isArray(strings?.raw)) return esc(strings);
  let out = strings[0] ?? "";
  for (let i = 0; i < values.length; i++) out += esc(values[i]) + (strings[i + 1] ?? "");
  return out;
}

/** A tooltip shown as plain text: ` data-tooltip-text="..."`, with a leading space, ready to put in a tag. */
export function tipAttr(text) {
  return ` data-tooltip-text="${esc(text)}"`;
}

/**
 * The name of a button that shows only an icon: ` aria-label="..." data-tooltip-text="..."`, with a leading space.
 * The label is for screen readers; the same words go in a plain-text tooltip (an aria-label alone shows none).
 */
export function labelAttr(text) {
  return ` aria-label="${esc(text)}"${tipAttr(text)}`;
}
