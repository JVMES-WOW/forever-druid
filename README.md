# WoW Forever Toolkit

A static, browser-based toolkit for planning characters and groups in **World of Warcraft: Forever**.

**Open the site:** [jvmes-wow.github.io/forever-druid](https://jvmes-wow.github.io/forever-druid/)

> This is a community project, not an official Blizzard Entertainment or WoW Forever product. Game data can change as the server evolves.

## Tools

### Talent calculators

- Current calculators for all nine classes: Druid, Hunter, Mage, Paladin, Priest, Rogue, Shaman, Warlock, and Warrior.
- 27 talent trees and 467 talents with ranks, prerequisites, row requirements, and point limits.
- Per-class local saves, undo, reset, portable build codes, and shareable links.
- Share links preserve talent identities across layout changes. Older builds remain importable; points in removed talents or branches with unmet requirements are refunded with a notice.
- Locally hosted game icons with no third-party requests during normal use.

### Druid abilities

- Trained Druid spells and ranks from level 1 through 60.
- Full hover, keyboard-focus, and pinned tooltips with spell details and icons.
- Active talent abilities shown at the earliest level at which their talent can be learned.
- Filters for Balance, Feral, Restoration, utility, and shapeshift abilities.

### Raid composition planner

- 5-, 10-, 20-, and 40-player rosters organized into five-player groups.
- Character naming, movement, swapping, inspection, and removal.
- Party effects, raid buffs, boss debuffs, equivalent effects, and provider conflicts.
- Suggestions for specializations that fill current coverage gaps.
- Per-player Blessing priorities, selectable Air Totems, and manual debuff-provider overrides.
- Profession camp buffs for five-player groups, with party-wide effects and redundancy warnings.
- Shareable links that preserve the complete plan.

## Privacy and storage

The site has no account system, analytics, or backend. Local drafts use browser storage. Shared builds are encoded in the URL fragment, which browsers do not send to the web server.

This repository contains the sanitized static site used by GitHub Pages. Private source captures, research notes, and authoring tools are excluded from publication.

## Data and artwork

- Current Forever talent data: [Sixty Upgrades](https://sixtyupgrades.com/forever/)
- Spell data and Druid tooltips: [Forever Warcraft Database](https://forever.warcraftdb.com/)
- Blizzard game artwork and cross-references: [Wowhead](https://www.wowhead.com/)

The social preview cards are deterministic layouts made from real site data and existing game artwork. They do not use AI-generated art.

Warcraft, World of Warcraft, and Blizzard Entertainment are trademarks or registered trademarks of Blizzard Entertainment, Inc. This repository is an unaffiliated fan project.
