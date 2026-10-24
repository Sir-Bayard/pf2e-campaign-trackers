# PF2e Campaign Trackers

GM Core's subsystems and a few table-neutral trackers in one window: Reputation, Pressure, Victory Points, Influence, Research, Chases, Infiltration, Clocks and Checklists. Everything is hidden from players until the GM reveals it. Checks roll through the PF2e system and the GM applies the result from the roll card. Dates on clocks and checklists send the GM a whisper when the calendar reaches them. Other modules can ship campaign content as a preset.

## What it looks like

One window, a tab for each kind of tracker. Everything starts hidden: reveal a tracker, a threshold or a check when the players should see it. Checks roll from the window through the PF2e system.

<table>
<tr>
<td width="50%" valign="top"><img src="docs/images/influence.png" alt="Influence, GM view"></td>
<td width="50%" valign="top"><img src="docs/images/influence-player.png" alt="Influence, player view"></td>
</tr>
<tr>
<td valign="top"><b>Influence</b>, as the GM sees it: DCs, every threshold, and a weakness the party hasn't found yet.</td>
<td valign="top">The same tracker in the players' window: only what's been revealed, and no DCs.</td>
</tr>
</table>
<table>
<tr>
<td width="50%" valign="top"><img src="docs/images/reputation.png" alt="Reputation"></td>
<td width="50%" valign="top"><img src="docs/images/pressure.png" alt="Pressure track"></td>
</tr>
<tr>
<td valign="top"><b>Reputation.</b> How a faction regards the party, on GM Core's tiers or your own. Each tier says what it means and what moves it.</td>
<td valign="top"><b>Pressure.</b> Something building against the party (heat, alarm, suspicion) in named bands that you move by judgment.</td>
</tr>
</table>
<table>
<tr>
<td width="50%" valign="top"><img src="docs/images/victory-points.png" alt="Victory Points"></td>
<td width="50%" valign="top"><img src="docs/images/research.png" alt="Research"></td>
</tr>
<tr>
<td valign="top"><b>Victory Points.</b> Progress toward a goal, with thresholds that unlock as the party reaches them and the checks that earn points.</td>
<td valign="top"><b>Research.</b> A library or archive, with research points per source and what each threshold turns up.</td>
</tr>
</table>
<table>
<tr>
<td width="50%" valign="top"><img src="docs/images/chase.png" alt="Chase"></td>
<td width="50%" valign="top"><img src="docs/images/infiltration.png" alt="Infiltration"></td>
</tr>
<tr>
<td valign="top"><b>Chases.</b> A run of obstacles, the party's progress through each one, and how far ahead the quarry is.</td>
<td valign="top"><b>Infiltration.</b> Awareness, edge, obstacles, complications and opportunities, with GM Core's awareness thresholds built in.</td>
</tr>
</table>
<table>
<tr>
<td width="50%" valign="top"><img src="docs/images/clock.png" alt="Clock"></td>
<td width="50%" valign="top"><img src="docs/images/checklist.png" alt="Checklist"></td>
</tr>
<tr>
<td valign="top"><b>Clocks.</b> A segmented clock. Give segments in-game dates and you get a whisper when the calendar reaches them.</td>
<td valign="top"><b>Checklists.</b> Things to gather or prepare, what earns each one and what it pays off, with optional closing dates.</td>
</tr>
</table>

## Install

In Foundry, go to **Add-on Modules**, then **Install Module**, and paste this into **Manifest URL**:

```
https://github.com/Sir-Bayard/pf2e-campaign-trackers/releases/latest/download/module.json
```

Foundry's **Update** button then picks up each new release. You can also download `module.zip` from the [latest release](https://github.com/Sir-Bayard/pf2e-campaign-trackers/releases/latest) and unzip it into `Data/modules/pf2e-campaign-trackers`.

Requires Foundry VTT 14 (verified on 14.369) and the Pathfinder 2e system 8.0.0 or later.

Updating keeps your trackers. Export them first anyway (see [Backup: export and import](#backup-export-and-import)).

## What it does

GM Core's subsystems and a few table-neutral trackers in one window, one tab each: Reputation, Pressure, Victory Points, Influence, Research, Chases, Infiltration, Clocks and Checklists. Everything is hidden from players until you reveal it. Checks roll through the PF2e system and you apply the result from the roll card. Dates on clocks and checklist entries whisper you a reminder when the calendar reaches them. Another module can ship campaign content as a preset.

It replaces PF2e Subsystems. Rebuild any event you had there as a tracker here, then turn PF2e Subsystems and PF2e Subsystem Theming off.

## Opening it

Token controls on the left: the list icon at the bottom of the list. Keyboard: Alt+T (change it under Configure Controls).

Macro: `game.modules.get("pf2e-campaign-trackers").api.open()`

The window remembers its tab, which cards are folded and which GM-notes boxes are open, in this browser.

## The tabs

- **Reputation**: A number with named tiers. Starts with GM Core's tiers (Hunted to Revered, -50 to +50); change them to your own. Each tier has text players see and text only you see.
- **Pressure**: Something building against the party: heat, alarm, suspicion, doom. A number in named bands, each with text for players and for you, plus events at set values. You move it with + and -; it has no checks. Hidden number by default, and a Halve button.
- **Victory Points**: Progress the party earns with checks toward a goal, with thresholds along the way.
- **Influence**: An NPC, influence points, thresholds, influence skills, Discover checks, resistances, weaknesses and rounds.
- **Research**: Research points, thresholds, and research checks, each with the most points it can give.
- **Chases**: A run of obstacles with chase points, the party's position and the other side's (the quarry, or pursuers).
- **Infiltration**: Awareness with GM Core's thresholds, edge points, group and individual obstacles, complications and opportunities.
- **Clocks**: Segmented clocks. Click a segment to fill or empty it; right-click marks it broken by the party. A segment can have a date.
- **Checklists**: Named entries in groups, with a tag, a closing date, what earns them and what they pay off.

Click New on a tab to add one. The pencil edits it, the eye shows or hides it, the speech bubble posts it to chat, the bin deletes it.

## Hidden until revealed

Every tracker starts hidden. The eye on a tracker shows it to players; inside it, the eyes on tiers, thresholds, checks, obstacles and entries show those too. Players never see your notes or the "GM only" text, and roll cards show DCs only as PF2e's own "show DCs" setting allows. "Player view" at the bottom of the tab list shows you the window as players see it.

Your data is kept in a journal entry called "Campaign Trackers (GM data)", hidden from players. Leave it where it is: the module refuses to delete it, and warns if a copy of it turns up. Players get a copy of what you have revealed, nothing more.

## Backup: export and import

The window's title-bar menu has "Export data", which downloads everything as a JSON file, and "Import data", which replaces everything with such a file after asking. Export before a session, and before you upgrade.

If the stored data ever can't be read, nothing can be changed until it's fixed: export it (you get the text as it is), fix the file, import it. To delete the data journal on purpose (say, to remove a duplicate), export first, then run

```
game.modules.get("pf2e-campaign-trackers").api.unlockStore("<journal id>")
```

and delete it. Without an id it unlocks the journal in use.

If you have the window open in two tabs, the one that saves second reloads the other's data instead of overwriting it, and tells you.

## Posting to chat

The speech bubble posts what players would see of a tracker: a standing's tier, a clock's face, where the chase stands. Use it when you tell the table something changed. On a hidden tracker it asks first.

## Checks and the apply button

Each check has a skill, a DC and what it's for. Skill is the PF2e slug: athletics, perception, will, or a lore such as sailing-lore.

- Click a check to roll it for the selected tokens (or a player's own character).
- The share icon posts the checks to chat as buttons players click to roll. On Influence, Research and Victory Points only revealed checks are posted.
- The roll card gets an Apply button that only you see. It says what it will do ("Success, +1 at The open lead") and does nothing until you click it. After that the card says what was applied.

Points per result follow GM Core (critical success 2, success 1, critical failure -1) and can be changed per tracker. Infiltration uses GM Core's rules: successes earn infiltration points, failures add awareness. A roll made from the character sheet isn't tied to a tracker and has no Apply button; use the + and - buttons instead. When a check is rerolled, apply the roll you keep.

## Reminders

When the in-game date reaches or passes a date on a clock segment or a checklist entry, you get one whispered reminder listing everything due, even after a time skip. Nothing changes by itself: you fill the segment or tick the entry. On a clock set to "Fills in order", each date fills the next empty segment. Turn reminders off in the module settings.

You also get a whisper when a threshold is crossed, a tier or band changes, or the party clears an obstacle or catches the quarry.

## Presets

A module can register trackers with

```
game.modules.get("pf2e-campaign-trackers").api.registerPreset({
  id, label, version, trackers: [...]
})
```

They are added hidden the first time. When the version changes, their text is updated and values, progress, ticks and reveals are kept. Tiers, thresholds, checks, segments and entries you added yourself stay (so do ones the preset dropped; remove those by hand). "Presets" at the bottom of the tab list reloads a preset's text by hand.

## For macros

```
const api = game.modules.get("pf2e-campaign-trackers").api;
api.adjust("tracker-id", "value", 1);
api.set("tracker-id", "segments.2.state", "filled");
api.reveal("tracker-id");
api.list()   // every tracker, with its id
```

## Changes

See [CHANGELOG.md](CHANGELOG.md).

## How it was made

This module was written with Claude, Anthropic's AI assistant, directed and tested by its author at a real table. It is shared as is, for free.

## Problems and suggestions

Open an [issue](https://github.com/Sir-Bayard/pf2e-campaign-trackers/issues).

## License

[MIT](LICENSE). Copyright (c) 2026 Sir Bayard.

## Pathfinder

PF2e Campaign Trackers is an unofficial, free module for the Pathfinder Second Edition system on Foundry VTT. It is not published, endorsed or specifically approved by Paizo Inc. Pathfinder is a trademark of Paizo Inc., used here only to say which game the module works with. The module follows the game's rules, which Paizo publishes under the ORC License, and refers to them by name; it doesn't reproduce Paizo's rules text, art or setting material.
