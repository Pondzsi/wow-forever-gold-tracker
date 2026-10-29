// Runs Advice.lua against the fake WoW API in harness.lua and checks the results.
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');

const ADDON = path.join(__dirname, '..', '..', 'addon', 'GoldTracker');
const ADVICE = path.join(ADDON, 'Advice.lua');
const WINDOW = path.join(ADDON, 'Window.lua');
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);

function run(code, name) {
  if (lauxlib.luaL_loadbuffer(L, to_luastring(code), null, to_luastring(name)) !== lua.LUA_OK ||
      lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) {
    throw new Error(name + ': ' + lua.lua_tojsstring(L, -1));
  }
  const r = lua.lua_isstring(L, -1) ? lua.lua_tojsstring(L, -1) : null;
  lua.lua_pop(L, 1);
  return r;
}

run(fs.readFileSync(path.join(__dirname, 'harness.lua'), 'utf8'), 'harness');
// Advice.lua starts with `local ADDON_NAME = ...`; run it as a chunk with an argument.
// Each file gets the addon name and the shared namespace table, like in WoW.
run('NS = {}', 'ns');
for (const [file, label] of [[ADVICE, 'Advice.lua'], [WINDOW, 'Window.lua']]) {
  run('local f = assert(load(' + JSON.stringify(fs.readFileSync(file, 'utf8')) + ', "' + label + '")) f("GoldTracker", NS)', 'load ' + label);
}

let failed = 0;
function check(label, got, want) {
  const ok = want instanceof RegExp ? want.test(got) : got === want;
  if (!ok) failed++;
  console.log((ok ? 'PASS ' : 'FAIL ') + label + (ok ? '' : `\n     got: ${got}\n     want: ${want}`));
}
const get = (expr) => run('return tostring(' + expr + ')', 'get');

// Login on the Rogue, with the bank alt set via the slash command.
run('SlashCmdList.GOLDTRACKER("bankalt legally dead")', 'slash');
check('bank alt saved with capital letter', get('GoldTrackerDB.advice.bankAlt'), 'Legally dead');
check('send panel recipient uses full name', 'x', 'x');
run('SlashCmdList.GOLDTRACKER("bankalt Legally Dead")', 'slash2');
run('for _, f in ipairs(FRAMES) do if f._scripts.OnEvent then f._scripts.OnEvent(f, "PLAYER_LOGIN") end end', 'login');
check('tooltip hook registered', get('TOOLTIP_CB ~= nil'), 'true');

// Tooltip lines: hover each item.
function tip(id) {
  run(`TIP.lines = {}; TIP.link = "|cffffffff|Hitem:${id}::::|h[x]|h|r"; TOOLTIP_CB(GameTooltip)`, 'tip');
  return get('TIP.lines[1]');
}
check('Light Leather on Rogue: keep (Leatherworking)', tip(2318), /Keep: Leatherworking material/);
check('Silk Cloth on Rogue: send (Tailoring)', tip(4306), /Send to Legally Dead \(Tailoring\)/);
check('Copper Ore on Rogue: send to sell', tip(2770), /Send to Legally Dead to sell/);
check('Rabbit\'s Foot (grey): vendor junk', tip(3300), /Vendor: junk/);
check('Cheap Herb: AH 90c*0.95=85 < vendor 100: vendor', tip(9999), /Vendor: AH pays less after fees/);

// Login summary was printed on PLAYER_LOGIN.
check('login summary printed', get('OUT[#OUT]'), /to send to Legally Dead/);

// Vendor panel: only safe items are sold.
run('USED = {}; for _, f in ipairs(FRAMES) do if f._scripts.OnEvent then f._scripts.OnEvent(f, "MERCHANT_SHOW") end end', 'merchant');
run('local p = GoldTrackerVendorPanelRef; for _, f in ipairs(FRAMES) do if f._name == "GoldTrackerVendorPanel" then VP = f end end', 'findvp');
check('vendor panel shown', get('VP and VP._shown'), 'true');
run('for _, f in ipairs(FRAMES) do if f._scripts.OnClick and f._text and f._text:match("Sell these") then SELLBTN = f end end', 'btn');
check('sell button text', get('SELLBTN and SELLBTN._text'), /Sell these \(2\)/);
run('SELLBTN._scripts.OnClick(SELLBTN)', 'click');
check('sold: junk + cheap herb, not the bound belt', get('table.concat(USED, ",")'), '3300,9999');

// Mailbox panel on the Rogue attaches the send items.
run('USED = {}; for _, f in ipairs(FRAMES) do if f._scripts.OnEvent then f._scripts.OnEvent(f, "MAIL_SHOW") end end', 'mail');
run('for _, f in ipairs(FRAMES) do if f._scripts.OnClick and f._text and f._text:match("^Attach") then MAILBTN = f end end', 'mbtn');
check('attach button', get('MAILBTN and MAILBTN._text'), /Attach \d+ item/);
run('MAILBTN._scripts.OnClick(MAILBTN)', 'mclick');
check('recipient filled in', get('SendMailNameEditBox._text'), 'Legally Dead');
check('attached: silk, copper ore, green sword, mageweave', get('table.concat(USED, ",")'), '4306,2770,2222,4338');

// On the bank alt itself: Silk Cloth is kept (own Tailoring), Copper Ore is sold here.
run('PLAYER = "Legally Dead"', 'switch');
check('Silk Cloth on Mage: keep (Tailoring)', tip(4306), /Keep: Tailoring material/);
check('Copper Ore on Mage: sell on AH', tip(2770), /Sell on AH/);

// Session window with a running session.
run('GoldTrackerDB.chars["Legally Dead-Ragnaros"].session = { type = "fishing", start = 1000000 - 1800, g0 = 140000, catches = 12 }; TICK()', 'session');
run('for _, f in ipairs(FRAMES) do if f._name == "GoldTrackerSessionFrame" then SF = f end end', 'sf');
check('session window text', get('SF and SF.text._text'), /Fishing session.*30 min.*Catches: 12/s);

// Toggle and pass-through to the base /gt handler.
run('SlashCmdList.GOLDTRACKER("tooltip off")', 't');
check('tooltip toggled off', get('GoldTrackerDB.advice.tooltip'), 'false');
check('tooltip off adds no line', tip(2770), 'nil');
run('SlashCmdList.GOLDTRACKER("status")', 'st');
check('other commands reach GoldTracker.lua', get('BASE_CALLED'), 'status');

// ---------- Window (/gt) ----------
run('PLAYER = "Legally UnDead"; SlashCmdList.GOLDTRACKER("tooltip on")', 'reset');
run('SlashCmdList.GOLDTRACKER("")', 'open');
run('for _, f in ipairs(FRAMES) do if f._name == "GoldTrackerWindow" then WIN = f end end', 'win');
check('/gt opens the window', get('WIN and WIN._shown'), 'true');
// Junk, cheap herb and the soulbound belt are vendored; Light Leather is kept (Rogue's Leatherworking).
check('Sell tab header counts', get('WIN.header._text'), /Vendor 3.*Keep 1/);
check('Sell tab first row is a vendor or check row (Rogue sends AH items)', get('WIN.lines[1].right._text'), /Vendor|Check AH|Keep/);
function tab(name) { run('for _, b in ipairs(WIN.tabs) do if b.tabName == "' + name + '" then b._scripts.OnClick(b) end end', 'tab ' + name); }
tab('Send');
check('Send tab header', get('WIN.header._text'), /Send 4 stack\(s\) to Legally Dead/);
check('Send tab reason', get('WIN.lines[1].right._text'), /Tailoring|to sell/);
check('Send tab mail plan', get('WIN.footer._text'), /1 mail/);
tab('Gold');
check('Gold tab total', get('WIN.header._text'), 'Total: 2650000c');
check('Gold tab richest first, bank alt marked', get('WIN.lines[1].left._text'), /^Legally Dead \(bank alt\)/);
run('SlashCmdList.GOLDTRACKER("goal 500g Epic mount")', 'goal');
check('goal added', get('NS.advice.cfg().goals[1].target'), '5000000');
tab('Goals');
check('Goals tab row', get('WIN.lines[1].left._text'), /1. Epic mount/);
run('SlashCmdList.GOLDTRACKER("goal remove 1")', 'rm');
check('goal removed', get('#NS.advice.cfg().goals'), '0');
run('BASE_CALLED = nil; SlashCmdList.GOLDTRACKER("stop")', 'stop');
check('/gt stop still reaches GoldTracker.lua', get('BASE_CALLED'), 'stop');

console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
