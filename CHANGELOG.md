# Changelog

## 2.4.0

- Reveal links for your prep notes: a button in a journal page that reveals parts of a quest when the moment comes. Drag an objective, step, journal entry, lead or reward from your view of the quest into a page, or click its link icon to copy the link. For one button that reveals several parts, click the link icon in the quest's header, tick the parts, and drag or copy the link. To add parts to a link later, drop them on its button while reading the page.
- Clicking the button lists what it will reveal, all ticked: the quest if players can't see it yet, the objective a step sits under, the quest a lead points to, and loot to open. Untick anything to keep it hidden. Shift-click reveals it all without the list, as Shift skips the dialog when you roll. Either way it's one change, with one notice for players.
- Pointing at the button lists what it covers. It fades once players see it all, keeps up with reveals made anywhere else, and shows a dashed border when something it names is gone. Players see only its label, as plain text. A link in chat, or in a page a player changed last, always shows the list.
- Revealing a step now reveals the objective it sits under too, with the eye, from the completion card or from a reveal link, since players see nothing of a step under a hidden objective. The completion card says when it will.
- For macros: `api.revealLink(questId, partIds, label)` gives a reveal link's text, and `api.revealParts(questId, partIds, { ask })` reveals as a reveal link does.

## 2.3.0

- The window remembers its size and place, in each browser.
- `api.open()` can open the window on a tab: `api.open("reputation")`, a tab's label such as `api.open("Victory Points")`, or a tracker's id (its tab, and for a quest that quest). A name it doesn't know opens the window where it was left.
- Restoring the window from minimized brings it back at its full size (on Foundry 14.370 it came back as a thin strip), including when it's opened while minimized.
- Quest links in journal text: write `@Quest[id]` (or `@Quest[id]{a label}`) in any journal page and it shows as a link that opens the quest. Drag a quest from the Quests list into a journal page to make one. A link shows the quest's current name; a player sees a quest they can't open yet as a faded "Unknown quest", whatever the link's label says.
- For other modules: `api.quests()` now gives each quest's status label, objectives done and in all, whether players can see it, whether it's a party quest or the focus, and the user's New/Updated mark; `api.questHTML(id)` draws a quest read-only as players see it; `api.markQuestSeen(id)` clears its mark; the hook `pf2e-campaign-trackers.changed` fires when trackers or marks change, and `pf2e-campaign-trackers.questLink` lets a module show a clicked quest link itself (Bayard's Campaign Journal uses these for its Quests tab).
- Verified on Foundry 14.370.

## 2.2.0

- GM notes on a quest (on the quest itself and on each objective, step, lead and reward) show in a purple box marked GM, so they never read as something players see.
- The GM can add a party note to the quest's journal with the book beside it: the entry is dated today, revealed, and signed with the player's name. A gold book shows a note that's already there.

## 2.1.0

- Party quests: players make quests of their own (New quest on the Quests tab), and anyone in the party can edit them: the name, summary, status, category, giver, place, due date, objectives and steps, journal entries, leads and rewards. A GM needs to be logged in, since the GM's client records every change. Only the player who made a party quest, or the GM, can delete it, and each player can make up to 20. Ticks and counts on a party quest need no GM card. The rest of the party gets a notice when one is made; edits show as Updated without a notice. A setting, "Players can make quests", turns this off.
- On a party quest, the GM has two buttons: Make it a main quest (it stays a party quest) and Take it over, which makes it an ordinary GM quest. Players keep seeing it, go back to ticking and notes, and get a notice that the GM took it over.
- A GM logged in from two browser tabs no longer answers players' requests twice (a note or a party quest could be added twice). One tab answers.
- Players' requests (ticks, notes, party quests) are checked against the user Foundry says sent them, so a player can't act as another.
- The quest panel has its own close button. It hides the panel for you until you choose Show the quest panel on the Quests tab (or turn the setting back on).
- For other modules: `api.openQuest(id)` opens the window on a quest, and `api.quests()` lists the quests the user can see.

## 2.0.0

- New Quests tab: a quest log with a list grouped by status (Lead, Active, Completed, Failed) beside the chosen quest. Completed quests show green and failed ones red. Categories are yours to name (Main and Side to start).
- A quest has a picture, who gave it, where, a due date, objectives with optional steps (done when all or any one is done), journal entries, leads, rewards and GM notes. Objectives and steps can be optional and have counts. Every part starts hidden and has its own eye.
- Each section of a quest has its own pencil and +, so you can add an objective or a note without editing the whole quest.
- Marking an objective done whispers you a card offering the parts you prepared to reveal, and to mark its objective done when its steps add up. Nothing is revealed until you click.
- Leads can point to another quest. Revealing a lead to a hidden quest offers to reveal that quest, and a quest shows which leads point to it.
- Objectives can watch another tracker (a clock, a skill challenge, points, research, influence, reputation, pressure, a checklist entry, a chase or an infiltration), show its progress, and bring you a card when it gets there.
- Rewards can link a loot actor; revealing one offers to let players open it.
- Due dates bring you a reminder. Players see them unless you make the deadline secret.
- Players can tick revealed objectives (a setting, on by default) and add notes signed with their character's name (up to 60 a quest). You get a card for each tick. Both need a GM logged in, and both stop when players can't open the trackers.
- Players get a short notice and New or Updated markers when a quest is revealed or changes, with an optional sound.
- The quest panel: the party's focus (the star, set by you) and up to three quests each person pins, with their open objectives, on screen. Players can tick from it. Each person can turn it off.
- Presets can include quests; an update keeps status, ticks, counts, notes, reveals and the focus.
- Going back to 1.0.0 after this turns quests into Victory Points trackers. Export your data first if you might.

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
