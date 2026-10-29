Forever Gold Tracker - setup

You need Windows, Chrome or Edge, and the Auctionator addon.

1. Install Auctionator in WoW (CurseForge or Wago). It provides the AH prices.
2. Double-click setup.bat. It:
   - finds World of Warcraft and installs the Gold Tracker addon into every game version
     folder (_forever_, _retail_, ...). If it can't find WoW, it asks for the folder.
   - starts a small background copier (also at Windows start). It copies GoldTracker.lua
     and Auctionator.lua to
     Documents\ForeverGoldTracker\<game version>\<account>\SavedVariables\
   - opens the dashboard: https://pondzsi.github.io/wow-forever-gold-tracker/
3. In the dashboard: Sync & to-do -> Choose folder... -> pick Documents\ForeverGoldTracker
   -> Select Folder. When the browser asks, choose "Allow on every visit".
4. Pick your game version in the dashboard's sidebar (default: WoW: Forever).
   Each version keeps its own data.
5. Play. WoW saves the data when you log out or type /reload (or /gt sync).
   Switch to the dashboard tab and it updates by itself.

In game, type /gt to open the Gold Tracker window, or /gt help for the list of commands.

If setup says it has no permission, right-click setup.bat -> Run as administrator.
Run setup.bat again to update the addon.
uninstall.bat removes the addon, the copier and its startup entry.
Documents\ForeverGoldTracker and your dashboard data (in the browser) stay.
