# Forever Gold Tracker

A dashboard for gold, prices, crafting profit, professions and farming/fishing sessions in WoW: Forever.
Most data comes from the game by itself: the **Gold Tracker** addon (in this repo) and **Auctionator**.

**Open the dashboard:** https://pondzsi.github.io/wow-forever-gold-tracker/
**Overview page to share:** https://pondzsi.github.io/wow-forever-gold-tracker/demo/

![Forever Gold Tracker overview](docs/media/forever-gold-tracker-demo.png)

You need Windows, Chrome or Edge, and the Auctionator addon.

## Setup (once)

1. **Auctionator:** install it in WoW (CurseForge or Wago). It provides the AH prices.
2. **Setup:** open the dashboard, go to **Sync & to-do** and click **Download setup**
   (`ForeverGoldTracker-setup.zip`). Unzip it and double-click `setup.bat`. It:
   - finds World of Warcraft and installs the Gold Tracker addon into every game version folder
     (`_forever_`, `_retail_`, ...),
   - starts a background copier (also at Windows start). It copies `GoldTracker.lua` and
     `Auctionator.lua` to `Documents\ForeverGoldTracker\<game version>\<account>\SavedVariables\`,
   - opens the dashboard.
   If setup has no permission to write to the game folder, right-click `setup.bat` → **Run as administrator**.
3. **Connect the folder:** on **Sync & to-do**, click **Choose folder…** and pick
   `Documents\ForeverGoldTracker`. When the browser asks, choose **Allow on every visit**.
4. **Game version:** pick it in the sidebar (default: WoW: Forever). Each version has its own data.
5. **Play.** Log in, then type `/reload`. Switch to the dashboard tab: it syncs by itself.

Run `setup.bat` again to update the addon. `uninstall.bat` removes the addon, the copier and its
startup entry. It keeps `Documents\ForeverGoldTracker` and your dashboard data.

## Daily use

- Play normally. The addon records gold, income/expenses, bags, bank (when you open it), skills,
  recipes (when you open a profession window), AH sale and purchase mails (when you open the mailbox)
  and fishing sessions (they start on your first catch).
- At the AH, run an Auctionator scan now and then. Its prices feed the dashboard.
- WoW writes addon data only on logout, exit or `/reload`. Type `/reload` (or `/gt sync`) to save now,
  then switch to the dashboard tab.
- **Sync & to-do** lists what still needs you, ranked High / Medium / Low.
- **Send to bank alt** lists what your other characters should mail to the bank alt. Choose the bank alt there once.
- **Sell list → Copy Auctionator shopping list:** every item without a (recent) AH price in one Auctionator
  shopping list. In game: Auctionator → Shopping → Import, paste, then Search, then `/reload`.
- **Overview → Sell now:** items you hold whose latest AH price is at least 15% above their 7-day average.

## Slash commands

| Command | What it does |
|---|---|
| `/gt` | Opens the **Gold Tracker window** (see below). `/goldtracker` works too. |
| `/gt help` | Shows the command list. |
| `/gt start farming` | Starts a farming session. `/gt start` alone also starts farming. |
| `/gt start fishing` | Starts a fishing session by hand. It does not stop by itself when idle. |
| `/gt stop` | Ends the running session and saves it. |
| `/gt status` | Shows how many events wait for the dashboard, the running session and the last addon error. |
| `/gt check` | Tests every game call the addon uses. Type `/reload` after it so the dashboard gets the result. |
| `/gt sync` | Reloads the UI (same as `/reload`), so WoW saves the data now. |

Fishing sessions also start by themselves on your first catch. They end after 15 minutes without a catch,
or on a zone change. A `/reload` (or `/gt sync`) keeps a running session; logging out ends it.
A session reaches the dashboard after it ends.

## Gold Tracker window (addon 0.4.0)

Type `/gt` in game. The window has four tabs; `/gt sell`, `/gt send`, `/gt gold` or `/gt goals` opens one directly.

- **Sell:** every stack in your bags with what to do: sell on the AH, vendor, keep or check the AH, with values.
- **Send:** what this character should mail to the bank alt, with the number of mails and the postage.
- **Gold:** gold of all your characters, the total, and the change since yesterday and over 7 days.
- **Goals:** savings goals with progress and an estimated date. `/gt goal 1000g Epic mount` adds one,
  `/gt goal remove 1` removes one.

Hover a row for the item tooltip. Drag the window to move it; Escape closes it. Gold history in the
window starts with addon 0.4.0 (one value per character per day).

## Full bags helper (addon 0.5.0)

When the game says "Inventory is full", a popup suggests the bag stack worth the least and offers **Delete**.

- Value = vendor price or AH price after the AH cut, whichever is higher.
- Only grey and white items are suggested. Never: gear above grey, the Hearthstone, profession tools, quest items,
  materials for your own professions, or items with no known value (for example an unopened trunk).
- **Never this** stops suggesting that item. **Not now** closes the popup. Nothing is deleted without your click.
- `/gt worst` shows the current suggestion, `/gt fullbags off` switches the helper off, `/gt protect clear` resets
  the "Never this" list.

## In-game advice (addon 0.3.0)

With Auctionator loaded, the addon shows the dashboard's decisions in the game:

- **Item tooltips:** a "Gold Tracker:" line: sell on the AH (price after the AH cut), vendor, keep (your profession's material) or send to the bank alt.
- **Vendor panel:** at a vendor, the items that are better vendored, with a **Sell these** button. The button never sells gear above grey quality; that gear is only listed.
- **Mailbox panel:** on characters other than the bank alt, the items to send, with an **Attach** button. You press Send yourself.
- **Session window:** gold, gold per hour and catches of the running session. Drag to move.
- **Login summary:** one chat line with what waits for you.

| Command | What it does |
|---|---|
| `/gt bankalt Name` | Sets the bank alt (same realm). `/gt bankalt none` clears it. |
| `/gt cut 5` | AH cut in percent for the advice (5 = Classic/retail value; unverified for Forever). |
| `/gt advice` | Shows the advice settings. |
| `/gt tooltip`, `/gt vendor`, `/gt mail`, `/gt summary`, `/gt window` | Switch each part on or off (add `on` or `off`). |

The advice uses Auctionator's latest price for the item, the vendor price from the game, and the
recipes the addon read from your profession windows. It is not verified in WoW: Forever yet.

**Addon health:** the addon tests itself silently 10 seconds after each login. The **Addon health** card on
**Sync & to-do** shows what works in this game version. Type `/gt check` (for example with a profession
window open), then `/reload`, to test again.

## Your data

- Data is saved in your browser (IndexedDB), one database per game version, for the site address you use.
- Use the same browser and the same address, or you see an empty dashboard.
- Clearing browser data deletes it. Turn on **Settings → Turn on daily backup**: the dashboard then saves a
  backup into `DocumentsForeverGoldTrackerackups` once a day when it syncs, and keeps the last 14.
  **Download backup** saves one by hand.
  A backup holds the game version you see at that time.
- The dashboard only reads `GoldTracker.lua` and `Auctionator.lua`. It never writes to the game folder.

## Money input

Any of these work: `12g 34s 56c`, `12g`, `50s`, `123456c`, or `12.3456` (gold).

## Development

Needs Node.js. Design record: [docs/v1-spec.md](docs/v1-spec.md).

```bash
npm install
npm run dev       # dashboard at http://localhost:5173 (or double-click start-dashboard.bat)
npm test          # unit tests (money, profit, SavedVariables parser, importers, to-do list)
npm run typecheck # TypeScript check
npm run build     # production build into dist/
```

A local copy at `http://localhost:5173` has its own browser data, separate from the GitHub Pages site.
`setup/setup.ps1` also works from the repo: it takes the addon from `addon/GoldTracker`.

Every push to `main` deploys to GitHub Pages (`.github/workflows/pages.yml`). The workflow runs the tests,
builds the site and packs `ForeverGoldTracker-setup.zip` from `setup/*` and `addon/GoldTracker`.

The addon's game API calls are written for the retail client that Forever runs on. They are not verified
in-game yet; every call is guarded so a missing API skips that data instead of breaking the addon.
