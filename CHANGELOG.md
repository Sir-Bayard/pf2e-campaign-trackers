# Changelog

## 2.7.0

**Rules from the PF2e system**
- The DC for each level, the Easy and Hard steps beside a DC, GM Core's reputation tiers and range, and the points each degree of success earns in Victory Points, Influence, Research, Chases and Infiltration are read from the PF2e system's GM Screen journal when a GM logs in. The module keeps no copy of these tables. If one can't be read (a system update moved it), you're told once, and the feature asks you for the number.
- Points for each result: an empty field uses the rules, shown faintly. A result the rules give no plain number for (on PF2e 8.7.0, a failure in Victory Points, Influence, Research and Chases) says so on the roll card, with nothing to apply, until you set one (0 counts it as no points). Trackers you already have keep the numbers they had.
- Infiltration is won when the party has overcome every obstacle (a group obstacle at its points, one for each character when every party member has). The old Objective is now an optional IP goal, which counts infiltration points as before. Infiltration and awareness points follow the rules, and you can set your own. A new infiltration has no awareness thresholds: you pick them, as the rules have no table for them.
- Verified on PF2e 8.7.0.

**Keyboard**
- The whole window and the quest panel work from the keyboard: every button, tab, eye, box and fold takes focus, Enter and Space press them, the arrow keys move along the tab list, focus stays put when the window redraws, and the window's keys no longer reach Foundry's own while you work in it (Space doesn't pause the game). Shift+Enter does what a right-click does on an objective's box or a clock segment.
- File a clue without dragging it: its grip opens a list of the objectives and steps. Copy a quest's link from its menu. Move the quest panel with the arrow keys on its Move button.

**New**
- **Undo** at the foot of the tab list (or Ctrl+Z) takes back the last change you made in the window or the quest panel: a tick, a counter, an edit, a deleted row or tracker. Up to twenty, newest first. Roll cards keep their own Undo.
- **Duplicate**, **Export this tracker** and **Import a tracker**: reuse a skill challenge, build next session's chase from the last one, or share a quest with another GM.
- **Apply these as they are rolled** on a check you call in a skill challenge: each called character's first roll goes on as it's rolled, at the check's DC, with Undo on each card. **Apply all** on a tracker's card applies every roll waiting in chat.
- With one check per character per round, a skill challenge shows who has rolled this round.
- **Since last session** on the Quests tab: what the party learned and did since a time (reveals, objectives done or failed, leads followed, status changes). `api.since()` gives it to macros.
- Players who log in to quests that changed while they were away get one notice, and the quest panel's header counts them.
- Pressure tracks can keep their band from players ("Players see the band"); Influence and Research can keep their totals ("Players see the number"), and then show players no threshold numbers or points per check either.
- A quest's sections fold to their headings, remembered for each quest.

**Changed**
- A quest's header keeps the focus star, the eye and post to chat in sight; the rest is in a menu, with Delete last and set apart. Every other tracker's Delete moves into its menu too.
- On a quest, the eyes of rows already revealed are dimmed, so what players can't see yet stands out.
- Chat cards speak as their tracker, not as its kind.
- The module's text is in `lang/en.json`, ready for translation.
- A player's request (a tick, a follow, a note, a party quest edit) always gets an answer from the GM's client; with none in fifteen seconds, the player is told it may not have gone through.
- Date reminders pause if the world's calendar isn't the one the dates were set on (a calendar module turned off, say), instead of firing for every date; **Use this calendar** resumes them.

**Fixed**
- Edits and a row's buttons find their row by its id, so a row added, moved or removed meanwhile (in another tab, or by a player) no longer sends a click or an edit to the wrong row.
- The window redraws only the trackers that changed, and does less work on each draw.
- A roll card's Undo brings back a result that the challenge's list of fifty had pushed out.
- Two GMs approving the same proposal at the same moment add it once.
- A drop onto a reveal link while that page's editor is open is refused (the editor's save would undo it), and the notice names the page.
- In a reveal link's list, a step unticks with the objective it sits under.
- On an infiltration, a row for someone outside the party has its own button to take it away.
- A player's request about a row they can't see gets the same answer as one about a row that doesn't exist.
- Restoring the window from minimized while it redraws no longer leaves it marked minimized; it opens whole from the quest panel and the hotkey.
- The chase's other side shows as "Quarry" when it has no name.
- A renamed character redraws the window only when it's open.

**Documentation**
- The README is short, with the details in [the guide](docs/guide.md), [Quests](docs/quests.md) and [Skill challenges](docs/skill-challenges.md): what `api.adjust` and `api.set` do when a player runs them, DCs on cards in the privacy note, Alt+T in Firefox, what needs a GM logged in, and what isn't tamper-proof.

## 2.6.1

- A player's "followed a lead" card keeps its buttons after you reload, instead of saying the lead is gone.
- The Apply line on a roll card keeps up when other rolls are applied first, so it always shows where the tracker will end up.
- Infiltration: points at an "Each PC" obstacle earned by someone outside the party (a character who has left it, or a roll made with no character) show as their own row, and you can change them there.
- Halve no longer takes a track below its lowest value.
- New and Updated marks, pins, folds, the last tab and the window's size and place are kept for each world and each user, so two people logging in from one browser no longer share them. What you had carries over (New and Updated marks to the first player to log in from that browser); the GM's saved state for trackers that are gone is cleared, and players' marks for quests they can't see.
- A quest left on screen in a minimized window keeps its Updated mark until the window is restored.
- Opening the window twice in quick succession (the hotkey, a macro, another module) no longer makes two windows.
- When you close or reload one of two browser tabs logged in as the GM, the other takes over answering players within moments, instead of after up to two and a half minutes.
- Names in notices and tooltips show as written, never as formatting.
- A date a player gives a party quest has to be a real day on your calendar.
- A drag of the quest panel that the browser cancels ends cleanly.
- The date box's example uses your calendar's first month.
- README: what `api.adjust` and `api.set` do when a player runs them, DCs on cards in the privacy note, and Alt+T in Firefox.

## 2.6.0

- Quests stay readable as they grow. Clues show newest revealed first, for you and the players (clues revealed before this version keep their order, below new ones).
- File a clue under the objective or step it belongs to: drag it there by the grip at the end of its row, or pick one under "Filed under" in the clue's editor. Clues not filed yet come first, then a fold for each objective or step, the one with the newest clue first; a done or failed objective's fold starts closed. Objectives show how many clues are filed under them. Drag a clue onto the Clues heading to unfile it.
- Leads can be marked followed with the box in front of them: struck through and moved into a closed Followed fold. Following a lead whose quest or clues are still hidden offers them, ticked.
- A lead can reveal several clues ("Reveals clues" in its editor). A lead's single clue carries over, and a clue that was deleted drops off the lead.
- On your side, hidden clues and leads sit in a Hidden fold under each list. A hidden clue filed ahead of time shows a tag naming its fold.
- Players can mark leads followed (you get a card offering what it points to) and file clues under the objectives they can see, along with ticking objectives. The setting is now "Players can tick objectives, follow leads and file clues". They can undo a player's mark, not yours.
- Folds you open or close are kept in your browser.
- Long clue text no longer wraps under its eye.
- Post to chat quotes the quest's newest revealed clue.
- For macros: a lead from `api.get()` now lists its clues as `clues` (ids), in place of `clue`.

## 2.5.0

- Quests: the Journal section is now **Clues** (what the party has learned), and Party notes are now the **Party Journal**. Nothing in your quests changes but the names.
- A lead can reveal a clue: pick one under "Reveals clue" in the lead's editor. Revealing the lead offers its clue (and the quest it points to) ticked, from the eye, the completion card or a reveal link.
- The magnifying glass on a Party Journal entry makes it a clue (it was the book that added a party note to the journal).
- A proposal card shows an answer (approved, declined, rolled) only when a GM gave it; a player's own edit to the card's data leaves it waiting.
- Proposals outside a skill challenge: a player can propose a check in ordinary play, with the skill (lores included), what they do and why, from a hotbar macro running `game.modules.get("pf2e-campaign-trackers").api.propose()`. You set the skill and DC (the character's level DC to start, Easy and Hard) and approve or decline it on the card, as in a challenge. Approved, it's a roll button for the player, who never sees the DC.

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
