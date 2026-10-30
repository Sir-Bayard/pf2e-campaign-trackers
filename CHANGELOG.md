# Changelog

## 1.0.0

- New Skill Challenges tab. A challenge is a number of successes before too many failures, with what each result adds, milestones, a round limit if you want one, and what happens on success and on failure.
- Approaches: each has a name players see (keep it free of spoilers), the real story for you, a consequence on a critical failure, an optional limit on uses, and its skills and DCs.
- Post skills puts the skills that could help in chat, with no approaches and no DCs. Post options puts the revealed approaches in chat with roll buttons.
- Players can propose an approach: a skill, what they do and why it fits. You change the skill or the DC, link it to an approach or save it as a new one, and approve or decline it. An approved proposal becomes a roll button for that player. Writing the what and why can be made optional per challenge.
- Check: call for a check on the fly from the challenge, and send the characters a roll button or roll for them now.
- Players never see a DC in a skill challenge, including on their own roll.
- Optional: one check per character per round, which Apply warns about.
- Undo on applied roll cards, taking back exactly what that roll applied. (Cards applied before 1.0.0 don't have it.)
- A hero-point reroll of an applied check offers to replace the first result with the new one. Before, the new card could be applied on top of the first.
- After a reload, the GM's Apply buttons on older roll cards came back missing until the next message. They're drawn once the tracker data is loaded.
- Presets can include skill challenges; an update keeps the counts, uses and results.
- The README now says plainly that hidden trackers are hidden from players' screens, not secret: Foundry sends the data to every browser.
- Going back to 0.1.4 after this turns skill challenges into Victory Points trackers. Export your data first if you might.

## 0.1.4

- A revealed Pressure track sends players only the band it's in. It used to send the whole ladder of band names, which players never saw in the window but could read from the game data.
- The module description lists Pressure among the trackers.

## 0.1.3

- The data journal can't be deleted by accident any more; `api.unlockStore()` lets it through. If more than one journal carries the data, you are warned and the one already in use is kept.
- A save that fails now says so in a notification instead of looking like it worked. A GM who isn't the active GM and has no data journal yet is told, rather than writing nowhere.
- Stored data that can't be read is no longer written over on the next save: changes are refused until you export it, fix it and import it.
- Export data and Import data in the window's title-bar menu, GM only.
- Tabbing through an edit form no longer loses focus or the last few keystrokes: the window waits while any field has focus and redraws when you leave the form.
- The window remembers its tab, folded cards and open GM-notes boxes across redraws and reopening. + and - no longer close the GM notes.
- The same GM in two tabs: the data carries a revision number, and a save from a tab that has fallen behind reloads instead of overwriting.
- A preset update keeps rows you added to a preset tracker (tiers, thresholds, checks, segments, entries). Preset trackers no longer carry a stray "key" field.
- Removing a row with anything written in it, and lowering a clock's segment count past filled, named or dated segments, ask first.
- Clock segments: click fills or empties; right-click marks broken.
- Alt+T opens the window (editable under Configure Controls).

## 0.1.2

- The "Notes (GM only)" text on chase obstacles and on infiltration obstacles, complications and opportunities no longer reaches players: it was copied into the players' data and, for complications and opportunities, drawn in their window. Players now see the names and the checks only.

## 0.1.1

- New Pressure tab, for things that build against the party, such as heat.
- Victory Points is now only for progress earned with checks.
