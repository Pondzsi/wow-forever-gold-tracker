# WoW: Forever Gold Tracker — Version 1 Spec

Status: draft for review. No code written yet.
Date: 2026-10-28. Game launch: 2026-11-04.

## 1. Goal

Track gold and profession profit for two characters with minimal manual work.

- Characters: **Legally UnDead** (Rogue, Skinning + Leatherworking + Fishing) and **Legally Dead** (Mage, Tailoring + Enchanting + Fishing).
- Same account, same realm (Horde, Normal).
- All prices come from recorded data or manual input. No invented prices.

## 2. Architecture

```
WoW client ──(logout or /reload)──> SavedVariables file (.lua)
                                          │
                              "Sync" button (Chrome/Edge folder access)
                                          ▼
                         Local React app ──> IndexedDB (browser)
                                          │
                                   JSON export (backup)
```

- **App:** Vite + React + TypeScript. Runs locally (`npm run dev` or a built static page).
- **Storage:** IndexedDB through Dexie.
- **Charts:** Recharts.
- **Lua parsing:** a small custom parser. SavedVariables only uses simple Lua tables.
- **Theme:** dark. No decorative work until the core features work.

## 3. Money rules

- Store all amounts as **integer copper**.
- Display as `12g 34s 56c`. Input accepts `12g 34s 56c`, `12.3456`, or `123456c`.
- AH cut % and deposit are **settings**. Forever's values are not verified yet.

## 4. Data model

| Table | Key fields |
|---|---|
| `characters` | id, name, class, professions |
| `goldSnapshots` | characterId, time, copper, source (`addon` / `manual`) |
| `ledger` | id, characterId, time, copper (+/-), category, note, source |
| `items` | itemId, name, vendorPrice (copper, optional), depositPerUnit (copper, optional) |
| `inventory` | characterId, location (`bags` / `bank`), itemId, count, snapshotTime |
| `prices` | itemId, time, copper (per unit), source (`AH` / `manual` / `import`), note |
| `recipes` | id, profession, productItemId, productCount, reagents [{itemId, count}], patternCost (optional) |
| `professionSnapshots` | characterId, profession, skill, maxSkill, time |
| `sessions` | id, characterId, type (`farming` / `fishing`), zone, start, end, notes, fishing fields |
| `sessionItems` | sessionId, itemId, countDelta |
| `containerOpens` | id, sessionId, containerItemId, time, contents [{itemId, count}], copper |
| `goals` | id, name, targetCopper, characterIds |
| `settings` | ahCutPercent, depositNote, lastSyncTime |

Ledger categories: `vendor`, `auction`, `mail`, `trade`, `quest/loot`, `training`, `repair`, `profession`, `other`.

Fishing fields on a session: `poolsOrOpenWater`, `fishRackUsed`, `lureUsed`, `fishingSkillStart`, `fishingSkillEnd`.

## 5. Screens

1. **Overview**
   - Gold per character and in total.
   - Change today, this week, and since start.
   - A gold-over-time chart and progress on goals.
2. **Ledger**
   - Income and expenses by character, category, and date.
   - Add entries by hand.
   - Entries from the addon are marked as such.
3. **Inventory**
   - Combined bags and bank of both characters.
   - Shows the estimated value using the latest recorded price. Shows "no price" if none exists.
4. **Prices**
   - Record AH prices quickly: item, price, date.
   - Price history per item.
   - Prices are flagged as stale after a set number of days (setting).
5. **Crafting**
   - Recipe list.
   - Per recipe: material cost (latest prices), sale value after AH cut, profit, and margin.
   - Verdict: **Craft**, **Sell mats**, **Vendor**, or **Keep**. Shows "unknown" when a price is missing.
6. **Professions**
   - Skill level per profession over time, Fishing included.
   - Materials spent on leveling, valued at the price at the time.
7. **Sessions**
   - Start and stop a farming or fishing session (also possible in-game with `/gt`).
   - Results: gold change, items gained, estimated value, and gold per hour.
   - Fishing-only data:
     - Container opens (trunks, bloated fish) with their contents.
     - Average value per container type.
     - Pools vs. open water comparison.
     - Rack used or not.
8. **Goals:** target amount, current progress, and estimated date based on recent gold per hour.
9. **Sync & Backup**
   - Choose the WoW folder once.
   - "Sync now" button and last sync time.
   - Export and import as JSON.

## 6. Decision logic (Crafting screen)

For one craft:

- `matCost` = sum of (reagent count × latest price).
- `saleNet` = product price × count × (1 − AH cut %).
- `profit` = `saleNet` − `matCost`.

The verdict compares four values:

- `profit`
- selling the mats directly: `matCost` × (1 − AH cut %)
- the vendor price
- (later) the expected disenchant value

The highest value wins. If any input price is missing, the verdict is "unknown" and the missing items are listed.

Fees: AH cut % is a setting. The deposit is recorded per item. A setting says whether it is refunded on sale (Classic) or lost (subtract it). Both are unverified for Forever.

Vendor floor: an item is flagged "Vendor it" when its vendor price is at least its AH price after fees.

Pattern payback: if a recipe has a pattern cost, show how many crafts at the current profit pay it back.

Disenchant value is **out of scope for version 1**. There is no verified disenchant data for Forever yet.

## 7. Addon ("GoldTracker")

Passive only. It observes and saves data. No automation of any kind.

**SavedVariables:** `GoldTrackerDB` (account-wide), so both characters write to one file:
`WTF\Account\<ACCOUNT>\SavedVariables\GoldTracker.lua`

**Records:**

| Data | How (to verify on launch) |
|---|---|
| Gold | Read gold at login and on every gold change. Store the time, new total, and difference. |
| Gold reason | Category comes from which window is open (merchant, mailbox, AH, trade, trainer). Otherwise `other`. |
| Bags and bank | Snapshot of bags after changes settle. Bank snapshot when the bank opens. |
| Professions | Skill levels from the profession API. The exact call depends on Forever's client and must be checked. |
| Sessions | `/gt start fishing <zone>`, `/gt stop`. Bags and gold are saved at the start and stop. |
| Container opens | When loot comes from an opened item (trunk or fish), save its contents. Fallback: compare bags before and after. |

**Data format:** an append-only event list. Each event has a unique id, so re-importing never creates duplicates. The list is trimmed once the dashboard has imported it (the addon keeps the last N events).

**Rules:**

- No combat-log use. It is blocked in Forever.
- Nothing runs in combat.
- No hidden communication with outside programs.

## 8. Sync

- Uses the File System Access API (Chrome/Edge).
- The folder handle is stored in IndexedDB. The browser may ask for permission again once per session.
- The file updates only at **logout, `/reload`, or game exit**.
- Process: parse the file, keep only events not seen before, then update the tables.
- Fallback: a normal file upload (Firefox, or if folder access fails).

## 9. Out of scope for version 1

- Own AH scanner. Prices are entered by hand first. Importing from an existing AH addon comes later if one supports Forever.
- Disenchant predictions.
- Loot from combat or chat.
- PvP and dungeon tracking.
- Hosted database, multiple devices, accounts.

## 9b. Automation update (2026-10-28)

Goal: no manual forms where the game can supply the data.

- **Auctionator is required.** AH prices come from `AUCTIONATOR_PRICE_DATABASE` in `Auctionator.lua`
  (per realm; per item `m` = latest min price, `h`/`l` = daily high/low, days since 2020-01-01).
  Only items the dashboard knows are imported. The Gold Tracker addon does not scan the AH.
  Format checked against Auctionator 9.x source; verify with a real Forever file at launch.
- **Addon also records:** vendor prices (game data), AH sale mails (exact price, deposit and cut, which
  verify the fee settings), recipes from the profession window, and fishing sessions that start on the
  first catch and end after 15 minutes without one. Trunk/fish contents are read from the loot window.
- **Sync:** the dashboard keeps read access to the WoW folder (Chrome/Edge) and imports both files
  whenever its tab gets focus. `/gt sync` reloads the UI so WoW writes the files right away.
- **Sync & to-do page:** lists what is still manual, ranked High / Medium / Low, plus a table of what is
  automatic.

## 9c. Addon health check (addon 0.2.0)

- `/gt check` tests each data source (gold, bags, item info, bound status, professions, recipes, mail,
  loot, item-use hook, zone, timers). It only reads. Results go to `GoldTrackerDB.health`
  (`t`, `client`, `build`, `addonVersion`, `lastError`, `checks[name] = { ok, detail }`) and a one-line
  summary is printed. The same check runs silently 10 seconds after each login.
- The dashboard stores the latest result in `meta.addonHealth` (per game version) and shows it in the
  **Addon health** card on the Sync page. A failed check is a High to-do; a sync without any health data
  is a Medium to-do.
- Recipes can only be read with a profession window open, so that check passes on the functions alone
  and asks for a second `/gt check` with the window open.

## 10. Milestones

1. **M1 — Manual dashboard (before launch).**
   - All screens working with manual input.
   - Money input and output, JSON backup.
   - Usable on day 1.
2. **M2 — Addon (launch week).**
   - Check every API call in the live game first.
   - Then gold, bag, bank, and profession snapshots.
3. **M3 — Sync.** Folder access, Lua parser, and event import.
4. **M4 — Fishing details.** Container contents, pools vs. open water stats, and rack tracking.

## 11. To verify at launch

- [ ] Which profession skill API works in Forever.
- [ ] Whether loot from an opened item can be read (for trunk contents).
- [ ] Retail-style or Classic-style Auction House, and its fee rates.
- [ ] Whether gold events fire normally during all activities.
- [ ] The game's install folder and `WTF` path for Forever.
- [ ] Fishing mechanics claimed in beta videos: Lure Master talent, fish rack buff, trunks in pools.

## 12. Install and setup

- Node.js LTS.
- Chrome or Edge.
- Addon folder copied into the game's `Interface\AddOns\` (exact path depends on Forever's install).
