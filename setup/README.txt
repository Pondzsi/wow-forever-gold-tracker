Forever Gold Tracker - setup

1. Install Auctionator in WoW (CurseForge or Wago). It provides the AH prices.
2. Double-click setup.bat. It:
   - finds World of Warcraft and asks which game version to track (default: _forever_),
   - installs the Gold Tracker addon,
   - starts a small background copier (also at Windows start) that copies the addon's
     saved data to Documents\ForeverGoldTracker,
   - opens the dashboard: https://pondzsi.github.io/wow-forever-gold-tracker/
3. In the dashboard (Chrome or Edge): Sync & to-do -> Choose WoW folder ->
   pick Documents\ForeverGoldTracker. Allow access on every visit.
4. Play. WoW saves the data when you log out, or type /gt sync in game.
   Switch to the dashboard tab and it updates by itself.

If setup says it has no permission, right-click setup.bat -> Run as administrator.
Run setup.bat again to update the addon or to track another game version.
uninstall.bat removes the addon and the copier. Your dashboard data stays in the browser.
