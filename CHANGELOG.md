# Changelog

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
