-- Fake WoW API for testing Advice.lua outside the game (Lua 5.3 VM, so 5.1 shims first).
unpack = table.unpack
table.maxn = function(t) local n = 0 for k in pairs(t) do if type(k) == "number" and k > n then n = k end end return n end

OUT = {}
date = os.date
UISpecialFrames = {}
function print(s) OUT[#OUT + 1] = tostring(s) end

PLAYER = "Legally UnDead"
function UnitName() return PLAYER end
function GetRealmName() return "Ragnaros" end
MONEY = 150000
function GetMoney() return MONEY end
function InCombatLockdown() return false end
function time() return 1000000 end

-- Items: id -> name, quality, sellPrice, equipLoc, bindType
ITEMS = {
  [2318] = { "Light Leather", 1, 15, "", 0 },
  [4306] = { "Silk Cloth", 1, 37, "", 0 },
  [2770] = { "Copper Ore", 1, 5, "", 0 },
  [3300] = { "Rabbit's Foot", 0, 21, "", 0 },
  [4338] = { "Mageweave Cloth", 1, 25, "", 0 },
  [9999] = { "Cheap Herb", 1, 100, "", 0 },
  [1111] = { "Bound Belt", 2, 400, "INVTYPE_WAIST", 1 },
  [2222] = { "Green Sword", 2, 900, "INVTYPE_WEAPON", 2 },
}
local function linkOf(id) return "|cffffffff|Hitem:" .. id .. "::::|h[" .. ITEMS[id][1] .. "]|h|r" end
C_Item = {
  GetItemInfo = function(item)
    local id = type(item) == "number" and item or tonumber(tostring(item):match("item:(%d+)"))
    local i = ITEMS[id]
    if not i then return nil end
    return i[1], linkOf(id), i[2], 1, 1, "Trade", "Misc", 20, i[4], 0, i[3], 0, 0, i[5]
  end,
}
AH = { [2770] = 40, [4306] = 140, [4338] = 220, [9999] = 90, [2222] = 5000 }
Auctionator = { API = { v1 = {
  GetAuctionPriceByItemLink = function(caller, link) return AH[tonumber(link:match("item:(%d+)"))] end,
  GetAuctionPriceByItemID = function(caller, id) return AH[id] end,
} } }

-- Bag 0 contents: { id, count, bound }
BAG = {
  { 2318, 20, false }, { 4306, 10, false }, { 2770, 30, false }, { 3300, 4, false },
  { 9999, 5, false }, { 1111, 1, true }, { 2222, 1, false }, { 4338, 3, false },
}
USED = {}
C_Container = {
  GetContainerNumSlots = function(bag) return bag == 0 and #BAG or 0 end,
  GetContainerItemInfo = function(bag, slot)
    local e = bag == 0 and BAG[slot]
    if not e then return nil end
    return { itemID = e[1], stackCount = e[2], hyperlink = linkOf(e[1]), isBound = e[3] }
  end,
  UseContainerItem = function(bag, slot) USED[#USED + 1] = BAG[slot][1] end,
}

-- Generic UI object: every method works and returns a usable value.
local function mock(name)
  local o = { _name = name, _scripts = {}, _text = "" }
  return setmetatable(o, { __index = function(t, k)
    if k == "SetScript" or k == "HookScript" then return function(self, ev, fn) self._scripts[ev] = fn end end
    if k == "SetText" then return function(self, s) self._text = s end end
    if k == "GetText" then return function(self) return self._text end end
    if k == "GetStringHeight" then return function() return 10 end end
    if k == "CreateFontString" or k == "CreateTexture" then return function() return mock("region") end end
    if k == "GetPoint" then return function() return "TOP", nil, "TOP", 0, 0 end end
    if k == "IsShown" then return function(self) return self._shown end end
    if k == "Show" then return function(self) self._shown = true end end
    if k == "Hide" then return function(self) self._shown = false end end
    if k == "SetEnabled" then return function(self, v) self._enabled = v end end
    return function() return nil end
  end })
end
FRAMES = {}
function CreateFrame(kind, name)
  local f = mock(name or kind)
  if kind == "Button" then f.SetText = function(self, s) self._text = s end end
  FRAMES[#FRAMES + 1] = f
  return f
end
UIParent, MerchantFrame, MailFrame, MailFrameTab2 = mock("UIParent"), mock("Merchant"), mock("Mail"), mock("Tab2")
SendMailNameEditBox = mock("SendTo")
function MailFrameTab_OnClick() end
TIP = { lines = {} }
GameTooltip = setmetatable({ AddLine = function(self, s) TIP.lines[#TIP.lines + 1] = s end, Show = function() end,
  GetItem = function() return TIP.name, TIP.link end }, { __index = function() return function() end end })
ItemRefTooltip = mock("ref")
Enum = { TooltipDataType = { Item = 0 } }
TOOLTIP_CB = nil
TooltipDataProcessor = { AddTooltipPostCall = function(_, fn) TOOLTIP_CB = fn end }
C_Timer = { After = function(_, fn) fn() end, NewTicker = function(_, fn) TICK = fn end }
function GetCoinTextureString(c) return tostring(c) .. "c" end
SlashCmdList = { GOLDTRACKER = function(msg) BASE_CALLED = msg end }

GoldTrackerDB = {
  chars = {
    ["Legally UnDead-Ragnaros"] = { gold = 150000, class = "ROGUE", skills = { Skinning = { 150, 150 }, Leatherworking = { 120, 150 } } },
    ["Legally Dead-Ragnaros"] = { gold = 2500000, class = "MAGE", skills = { Tailoring = { 150, 150 }, Enchanting = { 100, 150 } } },
  },
  recipes = {
    ["Leatherworking:2300"] = { p = "Leatherworking", out = 2300, n = 1, r = { [2318] = 4 } },
    ["Tailoring:4245"] = { p = "Tailoring", out = 4245, n = 1, r = { [4306] = 3 } },
  },
}
