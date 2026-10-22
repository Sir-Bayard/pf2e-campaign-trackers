PF2e Campaign Trackers 0.1.3
Foundry VTT 14, Pathfinder 2e system 8.0 or later.

WHAT IT DOES
GM Core's subsystems and a few table-neutral trackers in one window, one tab
each: Reputation, Pressure, Victory Points, Influence, Research, Chases,
Infiltration, Clocks and Checklists. Everything is hidden from players until you reveal it.
Checks roll through the PF2e system and you apply the result from the roll
card. Dates on clocks and checklist entries whisper you a reminder when the
calendar reaches them. Another module can ship campaign content as a preset.

It replaces PF2e Subsystems. Rebuild any event you had there as a tracker
here, then turn PF2e Subsystems and PF2e Subsystem Theming off.

INSTALL
Easiest: in Foundry, Install Module, then paste
  https://github.com/Sir-Bayard/pf2e-campaign-trackers/releases/latest/download/module.json
into Manifest URL. Or by hand:
1. Unzip module.zip (from the latest release) into a new folder Data/modules/pf2e-campaign-trackers, so you end up
   with Data/modules/pf2e-campaign-trackers/module.json.
2. Enable "PF2e Campaign Trackers" in Manage Modules and reload.

OPENING IT
Token controls on the left: the list icon at the bottom of the list.
Keyboard: Alt+T (change it under Configure Controls).
Macro: game.modules.get("pf2e-campaign-trackers").api.open()
The window remembers its tab, which cards are folded and which GM-notes boxes
are open, in this browser.

THE TABS
Reputation      A number with named tiers. Starts with GM Core's tiers
                (Hunted to Revered, -50 to +50); change them to your own.
                Each tier has text players see and text only you see.
Pressure        Something building against the party: heat, alarm, suspicion,
                doom. A number in named bands, each with text for players and
                for you, plus events at set values. You move it with + and -;
                it has no checks. Hidden number by default, and a Halve button.
Victory Points  Progress the party earns with checks toward a goal, with
                thresholds along the way.
Influence       An NPC, influence points, thresholds, influence skills,
                Discover checks, resistances, weaknesses and rounds.
Research        Research points, thresholds, and research checks, each with
                the most points it can give.
Chases          A run of obstacles with chase points, the party's position and
                the other side's (the quarry, or pursuers).
Infiltration    Awareness with GM Core's thresholds, edge points, group and
                individual obstacles, complications and opportunities.
Clocks          Segmented clocks. Click a segment to fill or empty it;
                right-click marks it broken by the party. A segment can have
                a date.
Checklists      Named entries in groups, with a tag, a closing date, what earns
                them and what they pay off.

Click New on a tab to add one. The pencil edits it, the eye shows or hides
it, the speech bubble posts it to chat, the bin deletes it.

HIDDEN UNTIL REVEALED
Every tracker starts hidden. The eye on a tracker shows it to players; inside
it, the eyes on tiers, thresholds, checks, obstacles and entries show those
too. Players never see your notes or the "GM only" text, and roll cards show
DCs only as PF2e's own "show DCs" setting allows. "Player view"
at the bottom of the tab list shows you the window as players see it.

Your data is kept in a journal entry called "Campaign Trackers (GM data)",
hidden from players. Leave it where it is: the module refuses to delete it,
and warns if a copy of it turns up. Players get a copy of what you have
revealed, nothing more.

BACKUP: EXPORT AND IMPORT
The window's title-bar menu has "Export data", which downloads everything as
a JSON file, and "Import data", which replaces everything with such a file
after asking. Export before a session, and before you upgrade.
If the stored data ever can't be read, nothing can be changed until it's
fixed: export it (you get the text as it is), fix the file, import it.
To delete the data journal on purpose (say, to remove a duplicate), export
first, then run
  game.modules.get("pf2e-campaign-trackers").api.unlockStore("<journal id>")
and delete it. Without an id it unlocks the journal in use.
If you have the window open in two tabs, the one that saves second reloads
the other's data instead of overwriting it, and tells you.

POSTING TO CHAT
The speech bubble posts what players would see of a tracker: a standing's
tier, a clock's face, where the chase stands. Use it when you tell the table
something changed. On a hidden tracker it asks first.

CHECKS AND THE APPLY BUTTON
Each check has a skill, a DC and what it's for. Skill is the PF2e slug:
athletics, perception, will, or a lore such as sailing-lore.
- Click a check to roll it for the selected tokens (or a player's own
  character).
- The share icon posts the checks to chat as buttons players click to roll.
  On Influence, Research and Victory Points only revealed checks are posted.
- The roll card gets an Apply button that only you see. It says what it will
  do ("Success, +1 at The open lead") and does nothing until you click it.
  After that the card says what was applied.
Points per result follow GM Core (critical success 2, success 1, critical
failure -1) and can be changed per tracker. Infiltration uses GM Core's
rules: successes earn infiltration points, failures add awareness.
A roll made from the character sheet isn't tied to a tracker and has no
Apply button; use the + and - buttons instead. When a check is rerolled,
apply the roll you keep.

REMINDERS
When the in-game date reaches or passes a date on a clock segment or a
checklist entry, you get one whispered reminder listing everything due, even
after a time skip. Nothing changes by itself: you fill the segment or tick
the entry. On a clock set to "Fills in order", each date fills the next empty
segment. Turn reminders off in the module settings.
You also get a whisper when a threshold is crossed, a tier or band changes, or the
party clears an obstacle or catches the quarry.

PRESETS
A module can register trackers with
  game.modules.get("pf2e-campaign-trackers").api.registerPreset({
    id, label, version, trackers: [...]
  })
They are added hidden the first time. When the version changes, their text
is updated and values, progress, ticks and reveals are kept. Tiers,
thresholds, checks, segments and entries you added yourself stay (so do ones
the preset dropped; remove those by hand). "Presets" at the bottom of the
tab list reloads a preset's text by hand.

FOR MACROS
  const api = game.modules.get("pf2e-campaign-trackers").api;
  api.adjust("tracker-id", "value", 1);
  api.set("tracker-id", "segments.2.state", "filled");
  api.reveal("tracker-id");
  api.list()   // every tracker, with its id

UPDATING
Replace the module folder in Data/modules with the new one and reload. Your
trackers are kept.

CHANGES IN 0.1.3
- The data journal can't be deleted by accident any more; api.unlockStore()
  lets it through. If more than one journal carries the data, you are warned
  and the one already in use is kept.
- A save that fails now says so in a notification instead of looking like it
  worked. A GM who isn't the active GM and has no data journal yet is told,
  rather than writing nowhere.
- Stored data that can't be read is no longer written over on the next save:
  changes are refused until you export it, fix it and import it.
- Export data and Import data in the window's title-bar menu, GM only.
- Tabbing through an edit form no longer loses focus or the last few
  keystrokes: the window waits while any field has focus and redraws when you
  leave the form.
- The window remembers its tab, folded cards and open GM-notes boxes across
  redraws and reopening. + and - no longer close the GM notes.
- The same GM in two tabs: the data carries a revision number, and a save
  from a tab that has fallen behind reloads instead of overwriting.
- A preset update keeps rows you added to a preset tracker (tiers,
  thresholds, checks, segments, entries). Preset trackers no longer carry a
  stray "key" field.
- Removing a row with anything written in it, and lowering a clock's segment
  count past filled, named or dated segments, ask first.
- Clock segments: click fills or empties; right-click marks broken.
- Alt+T opens the window (editable under Configure Controls).

CHANGES IN 0.1.2
- The "Notes (GM only)" text on chase obstacles and on infiltration obstacles,
  complications and opportunities no longer reaches players: it was copied
  into the players' data and, for complications and opportunities, drawn in
  their window. Players now see the names and the checks only.

CHANGES IN 0.1.1
  New Pressure tab, for things that build against the party, such as heat.
  Victory Points is now only for progress earned with checks.
