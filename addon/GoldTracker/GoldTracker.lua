-- Gold Tracker: records data for the Forever Gold Tracker dashboard.
--
-- Rules this addon follows:
--   * It only observes. It never clicks, buys, sells, posts or casts anything.
--   * It saves to GoldTrackerDB. WoW writes that file on logout or /reload.
--   * Every game API call is guarded, because the WoW: Forever API is not
--     fully documented. A failed call skips that data instead of erroring.
--
-- AH market prices come from Auctionator (its own SavedVariables file),
-- so this addon does not scan the Auction House.

local ADDON_NAME = ...
local DB_VERSION = 1
local MAX_EVENTS = 20000
local FISHING_IDLE_SECONDS = 15 * 60
local PREFIX = "|cffffd100Gold Tracker:|r "

local db, me, char
local frame = CreateFrame("Frame")

-------------------------------------------------------------------------------
-- Helpers
-------------------------------------------------------------------------------

local function say(msg) print(PREFIX .. msg) end

-- pcall wrapper that returns the function's results, or nothing on error.
local function try(fn, ...)
  if type(fn) ~= "function" then return end
  local res = { pcall(fn, ...) }
  if res[1] then return unpack(res, 2, table.maxn(res)) end
end

-- Midnight-era clients hide some values from addons ("secret values").
local function secret(v)
  return issecretvalue ~= nil and issecretvalue(v) or false
end

local function money()
  local m = try(GetMoney)
  if m == nil or secret(m) then return nil end
  return m
end

local function itemIdFromLink(link)
  if type(link) ~= "string" or secret(link) then return nil end
  return tonumber(link:match("item:(%d+)"))
end

local GetItemInfoFn = (C_Item and C_Item.GetItemInfo) or GetItemInfo

-- Remembers item names and vendor sell prices (game data, always exact).
local function noteItem(itemID, link)
  if not itemID or not db then return end
  local it = db.items[itemID] or {}
  if link and not it.n and not secret(link) then it.n = link:match("%[(.-)%]") end
  if not it.n or it.v == nil or it.bt == nil or it.q == nil then
    -- 3rd value: quality (0 poor ... 5 legendary). 14th value: bind type (0 none,
    -- 1 on pickup, 2 on equip, 3 on use, 4 quest, 7/8 account/warbound, 9 warbound until equipped).
    local name, _, quality, _, _, _, _, _, _, _, sell, _, _, bindType = try(GetItemInfoFn, itemID)
    if name and not it.n then it.n = name end
    if quality ~= nil and not secret(quality) then it.q = quality end
    if sell ~= nil and not secret(sell) then it.v = sell end
    if bindType ~= nil and not secret(bindType) then it.bt = bindType end
  end
  db.items[itemID] = it
end

local function push(e)
  e.id = me .. ":" .. db.seq
  db.seq = db.seq + 1
  e.t = e.t or time()
  e.c = me
  local ev = db.events
  ev[#ev + 1] = e
  if #ev > MAX_EVENTS then
    -- Drop the oldest 1000. The dashboard has normally imported them long ago.
    local keep = {}
    for i = 1001, #ev do keep[#keep + 1] = ev[i] end
    db.events = keep
  end
end

-------------------------------------------------------------------------------
-- Bags and bank
-------------------------------------------------------------------------------

local function containerSlots(bag)
  if C_Container and C_Container.GetContainerNumSlots then
    return try(C_Container.GetContainerNumSlots, bag) or 0
  end
  return try(GetContainerNumSlots, bag) or 0
end

-- Whether the item in a slot is soulbound (can't be sold on the AH).
local function slotBound(bag, slot)
  if C_Item and C_Item.IsBound and ItemLocation and ItemLocation.CreateFromBagAndSlot then
    local loc = try(ItemLocation.CreateFromBagAndSlot, ItemLocation, bag, slot)
    if loc then return try(C_Item.IsBound, loc) end
  end
end

-- Returns itemID, count, link, isBound for one slot.
local function containerItem(bag, slot)
  if C_Container and C_Container.GetContainerItemInfo then
    local info = try(C_Container.GetContainerItemInfo, bag, slot)
    if info and info.itemID then
      local bound = info.isBound
      if bound == nil then bound = slotBound(bag, slot) end
      return info.itemID, info.stackCount or 1, info.hyperlink, bound
    end
    return
  end
  local _, count, _, _, _, _, link, _, _, id = try(GetContainerItemInfo, bag, slot)
  if id then return id, count or 1, link, slotBound(bag, slot) end
end

local function bagIds()
  local ids = { 0, 1, 2, 3, 4 }
  if Enum and Enum.BagIndex and Enum.BagIndex.ReagentBag then ids[#ids + 1] = Enum.BagIndex.ReagentBag end
  return ids
end

local function bankIds()
  local ids, seen = {}, {}
  if Enum and Enum.BagIndex then
    for k, v in pairs(Enum.BagIndex) do
      -- Character bank only. The shared account/warband bank is skipped.
      -- Two names can share one container id; read each container once so items are not counted twice.
      if type(k) == "string" and k:find("Bank") and not k:find("Account") and not k:find("Warband") and not seen[v] then
        seen[v] = true
        ids[#ids + 1] = v
      end
    end
  end
  if #ids == 0 then ids = { -1, 5, 6, 7, 8, 9, 10, 11 } end
  return ids
end

local function readContainers(ids)
  local out, allBound = {}, {}
  for _, bag in ipairs(ids) do
    for slot = 1, containerSlots(bag) do
      local id, count, link, bound = containerItem(bag, slot)
      if id and not secret(id) then
        out[id] = (out[id] or 0) + (count or 1)
        noteItem(id, link)
        if bound ~= nil and not secret(bound) then
          -- Bound only if every copy is bound; one unbound copy can still be sold.
          allBound[id] = (allBound[id] ~= false) and (bound and true or false)
        end
      end
    end
  end
  for id, b in pairs(allBound) do db.items[id].b = b end
  return out
end

local bagsPending = false
local function snapshotBags()
  bagsPending = false
  if InCombatLockdown() then bagsPending = true return end
  char.bags = readContainers(bagIds())
  char.bagsT = time()
end

local function queueBags()
  if bagsPending then return end
  bagsPending = true
  C_Timer.After(3, function() if bagsPending then snapshotBags() end end)
end

local function snapshotBank()
  char.bank = readContainers(bankIds())
  char.bankT = time()
end

-------------------------------------------------------------------------------
-- Professions and recipes
-------------------------------------------------------------------------------

local function readSkills()
  local out = {}
  if GetProfessions and GetProfessionInfo then
    local list = { try(GetProfessions) }
    for i = 1, 6 do
      local idx = list[i]
      if idx then
        local name, _, rank, max = try(GetProfessionInfo, idx)
        if name and rank and not secret(rank) then out[name] = { rank, max } end
      end
    end
  end
  if next(out) == nil and GetNumSkillLines then
    -- Classic-style skill list. Only lines under the profession headers.
    local header
    for i = 1, (try(GetNumSkillLines) or 0) do
      local name, isHeader, _, rank, _, _, max = try(GetSkillLineInfo, i)
      if isHeader then
        header = name
      elseif name and header and (header:find("Profession") or header:find("Secondary")) then
        out[name] = { rank, max }
      end
    end
  end
  return out
end

local function fishingSkill()
  if GetProfessions then
    local _, _, _, fish = try(GetProfessions)
    if fish then
      local _, _, rank = try(GetProfessionInfo, fish)
      if rank and not secret(rank) then return rank end
    end
  end
  local s = readSkills()["Fishing"]
  return s and s[1] or nil
end

local function checkSkills()
  local skills = readSkills()
  char.skills = char.skills or {}
  for name, v in pairs(skills) do
    local old = char.skills[name]
    if not old or old[1] ~= v[1] or old[2] ~= v[2] then
      push({ k = "skill", n = name, r = v[1], m = v[2] })
    end
  end
  char.skills = skills
end

-- Reads the learned recipes of the open profession window (yours only).
local function scanRecipes()
  if InCombatLockdown() then return end
  local count = 0
  if C_TradeSkillUI and C_TradeSkillUI.GetAllRecipeIDs and C_TradeSkillUI.GetRecipeSchematic then
    if try(C_TradeSkillUI.IsTradeSkillLinked) or try(C_TradeSkillUI.IsTradeSkillGuild) or try(C_TradeSkillUI.IsNPCCrafting) then
      return
    end
    local base = try(C_TradeSkillUI.GetBaseProfessionInfo)
    local prof = base and base.professionName
    if not prof then return end
    for _, rid in ipairs(try(C_TradeSkillUI.GetAllRecipeIDs) or {}) do
      local info = try(C_TradeSkillUI.GetRecipeInfo, rid)
      if info and info.learned then
        local sch = try(C_TradeSkillUI.GetRecipeSchematic, rid, false)
        if sch and sch.outputItemID then
          local reagents, any = {}, false
          for _, slot in ipairs(sch.reagentSlotSchematics or {}) do
            local basic = not (Enum and Enum.CraftingReagentType) or slot.reagentType == Enum.CraftingReagentType.Basic
            local r = slot.reagents and slot.reagents[1]
            if basic and r and r.itemID then
              reagents[r.itemID] = slot.quantityRequired or 1
              noteItem(r.itemID)
              any = true
            end
          end
          if any then
            noteItem(sch.outputItemID)
            db.recipes[prof .. ":" .. sch.outputItemID] = {
              p = prof, out = sch.outputItemID, n = sch.quantityMin or 1, r = reagents, c = me, t = time(),
            }
            count = count + 1
          end
        end
      end
    end
  elseif GetNumTradeSkills then
    local prof = try(GetTradeSkillLine)
    if not prof or prof == "UNKNOWN" then return end
    for i = 1, (try(GetNumTradeSkills) or 0) do
      local _, kind = try(GetTradeSkillInfo, i)
      local out = itemIdFromLink(try(GetTradeSkillItemLink, i))
      if kind and kind ~= "header" and out then
        local reagents, any = {}, false
        for j = 1, (try(GetTradeSkillNumReagents, i) or 0) do
          local _, _, need = try(GetTradeSkillReagentInfo, i, j)
          local rid = itemIdFromLink(try(GetTradeSkillReagentItemLink, i, j))
          if rid and need then
            reagents[rid] = need
            noteItem(rid)
            any = true
          end
        end
        if any then
          noteItem(out)
          db.recipes[prof .. ":" .. out] = {
            p = prof, out = out, n = try(GetTradeSkillNumMade, i) or 1, r = reagents, c = me, t = time(),
          }
          count = count + 1
        end
      end
    end
  end
  if count > 0 then char.recipesT = time() end
end

-------------------------------------------------------------------------------
-- Gold changes and where they came from
-------------------------------------------------------------------------------

local ctx = {}            -- which game windows are open
local repairPending = false
local mailSales = {}      -- mail money amount -> item name, for AH sale mails
local lastMoney

local function category(delta)
  if repairPending and delta < 0 then
    repairPending = false
    return "repair"
  end
  if ctx.auction then return "auction" end
  if ctx.mail then
    if delta > 0 and mailSales[delta] then return "auction", "sold: " .. mailSales[delta] end
    return "mail"
  end
  if ctx.merchant then return "vendor" end
  if ctx.trade then return "trade" end
  if ctx.trainer then return "training" end
  if ctx.loot or ctx.quest then return "quest/loot" end
  if ctx.taxi then return "other", "flight" end
  return "other"
end

local function onMoney()
  local m = money()
  if not m then return end
  if lastMoney and m ~= lastMoney then
    local d = m - lastMoney
    local cat, note = category(d)
    push({ k = "money", d = d, g = m, cat = cat, note = note })
  end
  lastMoney = m
  char.gold = m
  char.goldT = time()
  local s = char.session
  if s and ctx.loot then s.gLast = m end
end

-- AH mail invoices give the exact sale price, deposit and AH cut.
local function scanInbox()
  mailSales = {}
  for i = 1, (try(GetInboxNumItems) or 0) do
    local _, _, _, _, mailMoney, _, daysLeft = try(GetInboxHeaderInfo, i)
    local kind, itemName, _, bid, buyout, deposit, cut, _, _, _, count = try(GetInboxInvoiceInfo, i)
    if kind == "seller" and itemName and bid then
      local saleT = time() - math.floor((30 - (daysLeft or 30)) * 86400)
      local key = table.concat({ kind, itemName, bid, deposit or 0, cut or 0, math.floor(saleT / 3600) }, "|")
      if not db.seenInvoices[key] then
        db.seenInvoices[key] = time()
        push({ k = "sale", item = itemName, n = count or 1, bid = bid, dep = deposit, cut = cut, got = mailMoney, t = saleT })
      end
      if mailMoney and mailMoney > 0 then mailSales[mailMoney] = itemName end
    elseif kind == "buyer" and itemName and bid then
      local key = table.concat({ kind, itemName, bid, math.floor((time() - (30 - (daysLeft or 30)) * 86400) / 3600) }, "|")
      if not db.seenInvoices[key] then
        db.seenInvoices[key] = time()
        push({ k = "buy", item = itemName, n = count or 1, bid = bid })
      end
    end
  end
  -- Forget invoice keys older than 31 days.
  local cutoff = time() - 31 * 86400
  for key, t in pairs(db.seenInvoices) do
    if t < cutoff then db.seenInvoices[key] = nil end
  end
end

-------------------------------------------------------------------------------
-- Sessions: fishing starts by itself, farming with /gt start farming
-------------------------------------------------------------------------------

local function zoneName()
  local z, sub = try(GetRealZoneText), try(GetSubZoneText)
  if sub and sub ~= "" and sub ~= z then return (z or "?") .. " / " .. sub end
  return z or "?"
end

local function startSession(kind, auto)
  if char.session then return end
  local m = money()
  char.session = {
    id = me .. ":s" .. db.seq, type = kind, auto = auto, zone = zoneName(),
    start = time(), last = time(), g0 = m, gLast = m, fs0 = fishingSkill(),
    catches = 0, loot = {}, containers = {},
  }
  db.seq = db.seq + 1
  say(("%s session started%s. /gt stop to end it."):format(kind, auto and " automatically" or ""))
end

local function stopSession(reason)
  local s = char.session
  if not s then return end
  if s.auto then
    -- Auto sessions end at the last catch, so idle time is not counted.
    s.stop, s.g1 = s.last, s.gLast
  else
    -- A session closed after a logout ends at the logout, not at the next login.
    s.stop, s.g1 = s.pausedAt or time(), s.gPause or money()
  end
  s.pausedAt, s.gPause = nil, nil
  s.fs1 = fishingSkill()
  s.reason = reason
  push({ k = "session", s = s })
  char.session = nil
  say(("%s session saved (%s)."):format(s.type, reason or "stopped"))
end

-------------------------------------------------------------------------------
-- Loot: fishing catches and opened containers (trunks, bloated fish...)
-------------------------------------------------------------------------------

local lastUsed            -- last item used from the bags, for container detection
local lootHandled = false
local openContainer       -- container record waiting for its coins

local function hookItemUse()
  local function remember(bag, slot)
    local id, _, link = containerItem(bag, slot)
    if id then lastUsed = { id = id, link = link, at = GetTime() } end
  end
  if C_Container and C_Container.UseContainerItem then
    hooksecurefunc(C_Container, "UseContainerItem", remember)
  elseif UseContainerItem then
    hooksecurefunc("UseContainerItem", remember)
  end
end

local function onLootReady()
  if lootHandled then return end
  lootHandled = true

  local fishing = try(IsFishingLoot) and true or false
  local containerID
  local items, any = {}, false
  for i = 1, (try(GetNumLootItems) or 0) do
    local src = try(GetLootSourceInfo, i)
    if type(src) == "string" and not secret(src) and src:find("^Item%-") then
      containerID = containerID
        or (C_Item and C_Item.GetItemIDByGUID and try(C_Item.GetItemIDByGUID, src))
        or (lastUsed and GetTime() - lastUsed.at < 3 and lastUsed.id)
    end
    local link = try(GetLootSlotLink, i)
    local id = itemIdFromLink(link)
    if id then
      local _, _, qty = try(GetLootSlotInfo, i)
      noteItem(id, link)
      items[id] = (items[id] or 0) + ((qty and not secret(qty)) and qty or 1)
      any = true
    end
  end

  if fishing and not char.session then startSession("fishing", true) end
  local s = char.session
  if not s then return end

  if containerID then
    openContainer = { item = containerID, t = time(), copper = 0, items = items, m0 = money() }
    noteItem(containerID)
    s.containers[#s.containers + 1] = openContainer
    -- The container was probably caught earlier in this session: don't count it twice.
    if (s.loot[containerID] or 0) > 0 then s.loot[containerID] = s.loot[containerID] - 1 end
  elseif any then
    for id, n in pairs(items) do s.loot[id] = (s.loot[id] or 0) + n end
  end
  if fishing then s.catches = s.catches + 1 end
  s.last = time()
  s.gLast = money()
end

local function onLootClosed()
  lootHandled = false
  if openContainer then
    local m = money()
    if m and openContainer.m0 then openContainer.copper = math.max(0, m - openContainer.m0) end
    openContainer.m0 = nil
    openContainer = nil
    local s = char.session
    if s then s.gLast = money() end
  end
end

-------------------------------------------------------------------------------
-- Health check: which data sources work in this client (/gt check)
-------------------------------------------------------------------------------

local HEARTHSTONE = 6948

-- Names of the given global functions that don't exist. "C_Item.IsBound" style names look inside tables.
local function missingFns(names)
  local out = {}
  for _, full in ipairs(names) do
    local v = _G
    for part in full:gmatch("[^%.]+") do v = type(v) == "table" and v[part] or nil end
    if type(v) ~= "function" then out[#out + 1] = full end
  end
  return out
end

local function fnsCheck(names, okText)
  local miss = missingFns(names)
  if #miss > 0 then return false, "missing: " .. table.concat(miss, ", ") end
  return true, okText
end

-- First readable item in the bags: bag, slot, itemID.
local function firstBagItem()
  for _, bag in ipairs(bagIds()) do
    for slot = 1, containerSlots(bag) do
      local id = containerItem(bag, slot)
      if id and not secret(id) then return bag, slot, id end
    end
  end
end

local function itemInfoFor(itemID)
  local name, _, quality, _, _, _, _, _, _, _, sell, _, _, bindType = try(GetItemInfoFn, itemID)
  local miss = {}
  if name == nil or secret(name) then miss[#miss + 1] = "name" end
  if quality == nil or secret(quality) then miss[#miss + 1] = "quality" end
  if sell == nil or secret(sell) then miss[#miss + 1] = "sell price" end
  if bindType == nil or secret(bindType) then miss[#miss + 1] = "bind type" end
  return name, miss
end

-- Each check only reads. It returns ok, detail. Errors are caught by runHealthCheck.
local HEALTH_CHECKS = {
  { "gold", function()
    if type(GetMoney) ~= "function" then return false, "GetMoney is missing" end
    local m = GetMoney()
    if secret(m) then return false, "gold is hidden (secret value)" end
    if type(m) ~= "number" then return false, "GetMoney returned " .. type(m) end
    return true, "gold is readable"
  end },
  { "bags", function()
    local n = containerSlots(0)
    if secret(n) then return false, "backpack size is hidden (secret value)" end
    if not n or n <= 0 then return false, "backpack size could not be read" end
    local bag, slot = firstBagItem()
    if not bag then return false, ("backpack has %d slots, but no item could be read (bags empty?)"):format(n) end
    return true, ("backpack has %d slots, item in bag %d slot %d is readable"):format(n, bag, slot)
  end },
  { "itemInfo", function()
    local name, miss = itemInfoFor(HEARTHSTONE)
    local what = "Hearthstone"
    if #miss > 0 then
      local _, _, id = firstBagItem()
      if id then
        name, miss = itemInfoFor(id)
        what = "item " .. id
      end
    end
    if #miss == 4 then return false, "no item data (it may still be loading: run /gt check again)" end
    if #miss > 0 then return false, what .. ": missing " .. table.concat(miss, ", ") end
    return true, ("name, quality, sell price and bind type read for %s"):format(name or what)
  end },
  { "bound", function()
    local bag, slot = firstBagItem()
    if bag and C_Container and C_Container.GetContainerItemInfo then
      local info = try(C_Container.GetContainerItemInfo, bag, slot)
      if info and type(info.isBound) == "boolean" then return true, "isBound is in the bag slot info" end
    end
    if bag then
      local b = slotBound(bag, slot)
      if type(b) == "boolean" then return true, "C_Item.IsBound works" end
      return false, "bag slot info has no isBound and C_Item.IsBound gave no answer"
    end
    return fnsCheck({ "C_Item.IsBound", "ItemLocation.CreateFromBagAndSlot" }, "C_Item.IsBound is present (no bag item to test)")
  end },
  { "professions", function()
    local names = {}
    for name in pairs(readSkills()) do names[#names + 1] = name end
    if #names == 0 then return false, "no professions found (none learned, or the game hides them)" end
    table.sort(names)
    return true, table.concat(names, ", ")
  end },
  { "recipes", function()
    if C_TradeSkillUI and C_TradeSkillUI.GetAllRecipeIDs and C_TradeSkillUI.GetRecipeSchematic then
      local ids = try(C_TradeSkillUI.GetAllRecipeIDs)
      if type(ids) == "table" and #ids > 0 then return true, ("%d recipes readable in the open profession window"):format(#ids) end
      return true, "functions present; open a profession window and run /gt check again to test a real read"
    end
    if GetNumTradeSkills and GetTradeSkillItemLink then
      return true, "classic recipe functions present; open a profession window and run /gt check again"
    end
    return false, "missing: C_TradeSkillUI.GetAllRecipeIDs / GetRecipeSchematic"
  end },
  { "mail", function()
    return fnsCheck({ "GetInboxNumItems", "GetInboxHeaderInfo", "GetInboxInvoiceInfo" }, "mail and AH invoice functions present")
  end },
  { "loot", function()
    return fnsCheck({ "GetNumLootItems", "GetLootSlotLink", "GetLootSourceInfo", "IsFishingLoot", "C_Item.GetItemIDByGUID" },
      "loot, fishing and container functions present")
  end },
  { "itemUseHook", function()
    if type(hooksecurefunc) ~= "function" then return false, "hooksecurefunc is missing" end
    if C_Container and type(C_Container.UseContainerItem) == "function" then return true, "C_Container.UseContainerItem can be hooked" end
    if type(UseContainerItem) == "function" then return true, "UseContainerItem can be hooked" end
    return false, "missing: C_Container.UseContainerItem and UseContainerItem"
  end },
  { "zone", function()
    local z = try(GetRealZoneText)
    if secret(z) then return false, "zone name is hidden (secret value)" end
    if type(z) ~= "string" or z == "" then return false, "GetRealZoneText returned no name" end
    return true, z
  end },
  { "timers", function()
    return fnsCheck({ "C_Timer.After", "C_Timer.NewTicker" }, "C_Timer.After and NewTicker present")
  end },
}

-- Tests every data source and saves the result in GoldTrackerDB.health.
local function runHealthCheck(loud)
  if not db then return end
  local checks, okCount = {}, 0
  for _, c in ipairs(HEALTH_CHECKS) do
    local res = { pcall(c[2]) }
    local ok, detail = res[2], res[3]
    if not res[1] then ok, detail = false, "error: " .. tostring(res[2]) end
    ok = ok and true or false
    if type(detail) ~= "string" or secret(detail) then detail = "" end
    checks[c[1]] = { ok = ok, detail = detail }
    if ok then okCount = okCount + 1 end
  end
  local version, build, _, iface = try(GetBuildInfo)
  local metadata = (C_AddOns and C_AddOns.GetAddOnMetadata) or GetAddOnMetadata
  db.health = {
    t = time(),
    client = iface,
    build = version and (version .. "." .. tostring(build)) or nil,
    addonVersion = try(metadata, ADDON_NAME, "Version"),
    checks = checks,
    lastError = db.lastError,
  }
  if loud then
    print(("|cffffd100Gold Tracker check:|r %d of %d OK. Type /reload to save."):format(okCount, #HEALTH_CHECKS))
    for _, c in ipairs(HEALTH_CHECKS) do
      local r = checks[c[1]]
      if not r.ok then say("|cffff6060" .. c[1] .. "|r: " .. r.detail) end
    end
    if db.lastError then say("Last error: " .. db.lastError) end
  end
end

-------------------------------------------------------------------------------
-- Setup
-------------------------------------------------------------------------------

local function initDB()
  GoldTrackerDB = GoldTrackerDB or {}
  db = GoldTrackerDB
  db.version = DB_VERSION
  db.seq = db.seq or 1
  db.chars = db.chars or {}
  db.events = db.events or {}
  db.items = db.items or {}
  db.recipes = db.recipes or {}
  db.seenInvoices = db.seenInvoices or {}

  me = (UnitName("player") or "?") .. "-" .. (GetRealmName() or "?")
  db.chars[me] = db.chars[me] or {}
  char = db.chars[me]
  char.name = UnitName("player")
  char.realm = GetRealmName()
  char.class = select(2, UnitClass("player"))
  char.faction = UnitFactionGroup("player")
  char.level = UnitLevel("player")
end

local handlers = {}

function handlers.PLAYER_LOGIN()
  initDB()
  hookItemUse()
  if RepairAllItems then hooksecurefunc("RepairAllItems", function() repairPending = true end) end
  lastMoney = money()
  if lastMoney then push({ k = "gold", g = lastMoney }) end
  char.gold, char.goldT = lastMoney, time()
  -- A running session is decided in PLAYER_ENTERING_WORLD: kept after /reload, closed after a logout.
  C_Timer.After(5, function()
    snapshotBags()
    checkSkills()
  end)
  -- Silent health check once per login, so the dashboard always has fresh results.
  C_Timer.After(10, function() pcall(runHealthCheck, false) end)
  C_Timer.NewTicker(60, function()
    local s = char.session
    if s and s.auto and time() - s.last > FISHING_IDLE_SECONDS then stopSession("no catches for 15 min") end
  end)
end

-- PLAYER_LOGOUT also fires on /reload, so a session is only paused here.
-- PLAYER_ENTERING_WORLD tells a reload (keep the session) from a new login (close it).
function handlers.PLAYER_LOGOUT()
  local s = char and char.session
  if s then s.pausedAt, s.gPause = time(), money() end
  if char then char.level = UnitLevel("player") end
end

function handlers.PLAYER_ENTERING_WORLD(isInitialLogin, isReloadingUi)
  local s = char and char.session
  if not s then return end
  if isReloadingUi then
    s.pausedAt, s.gPause = nil, nil
    say(("%s session continues after the reload."):format(s.type))
  elseif isInitialLogin then
    -- Logged out (or crashed) with a session running: close it where it stopped.
    if not s.pausedAt and not s.auto then s.pausedAt, s.gPause = s.last or s.start, s.gLast end
    stopSession("closed after logout")
  end
end

handlers.PLAYER_MONEY = onMoney
handlers.BAG_UPDATE_DELAYED = queueBags
function handlers.PLAYER_REGEN_ENABLED() if bagsPending then snapshotBags() end end
handlers.SKILL_LINES_CHANGED = function() C_Timer.After(1, checkSkills) end
handlers.CHAT_MSG_SKILL = function() C_Timer.After(1, checkSkills) end
handlers.TRADE_SKILL_LIST_UPDATE = function() C_Timer.After(1, scanRecipes) end
handlers.TRADE_SKILL_SHOW = function() C_Timer.After(2, scanRecipes) end
handlers.GET_ITEM_INFO_RECEIVED = function(itemID) if db and db.items[itemID] then noteItem(itemID) end end
handlers.LOOT_READY = onLootReady
handlers.LOOT_OPENED = function() ctx.loot = true; onLootReady() end
handlers.LOOT_CLOSED = function() ctx.loot = false; onLootClosed() end
handlers.ZONE_CHANGED_NEW_AREA = function()
  local s = char and char.session
  if s and s.auto then stopSession("zone changed") end
end

-- Windows that tell us where a gold change came from.
local windows = {
  MERCHANT_SHOW = { "merchant", true }, MERCHANT_CLOSED = { "merchant", false },
  MAIL_SHOW = { "mail", true }, MAIL_CLOSED = { "mail", false },
  AUCTION_HOUSE_SHOW = { "auction", true }, AUCTION_HOUSE_CLOSED = { "auction", false },
  TRADE_SHOW = { "trade", true }, TRADE_CLOSED = { "trade", false },
  TRAINER_SHOW = { "trainer", true }, TRAINER_CLOSED = { "trainer", false },
  TAXIMAP_OPENED = { "taxi", true }, TAXIMAP_CLOSED = { "taxi", false },
  QUEST_COMPLETE = { "quest", true }, QUEST_FINISHED = { "quest", false },
  BANKFRAME_OPENED = { "bank", true }, BANKFRAME_CLOSED = { "bank", false },
}
for event, w in pairs(windows) do
  handlers[event] = function()
    ctx[w[1]] = w[2]
    -- Gold from a quest reward arrives just after the window closes.
    if event == "QUEST_FINISHED" then ctx.quest = true; C_Timer.After(1, function() ctx.quest = false end) end
    if event == "BANKFRAME_OPENED" then C_Timer.After(1, snapshotBank) end
    if event == "MAIL_SHOW" then C_Timer.After(1, scanInbox) end
  end
end
handlers.MAIL_INBOX_UPDATE = function() if ctx.mail then scanInbox() end end
handlers.PLAYERBANKSLOTS_CHANGED = function() if ctx.bank then C_Timer.After(1, snapshotBank) end end

frame:SetScript("OnEvent", function(_, event, ...)
  if event ~= "PLAYER_LOGIN" and not db then return end
  local h = handlers[event]
  if h then
    local ok, err = pcall(h, ...)
    if not ok and db then db.lastError = event .. ": " .. tostring(err) end
  end
end)
for event in pairs(handlers) do
  -- Some events may not exist in this client. Registering them must not error.
  pcall(frame.RegisterEvent, frame, event)
end

-------------------------------------------------------------------------------
-- Slash commands
-------------------------------------------------------------------------------

SLASH_GOLDTRACKER1 = "/gt"
SLASH_GOLDTRACKER2 = "/goldtracker"
SlashCmdList.GOLDTRACKER = function(msg)
  local cmd, arg = (msg or ""):lower():match("^(%S*)%s*(.-)$")
  if cmd == "start" then
    local kind = (arg == "fishing") and "fishing" or "farming"
    if char.session then say("A session is already running. /gt stop first.") return end
    startSession(kind, false)
  elseif cmd == "stop" then
    if not char.session then say("No session is running.") return end
    stopSession("stopped")
  elseif cmd == "status" then
    local s = char.session
    say(("%d events waiting for the dashboard."):format(#db.events))
    if s then
      say(("%s session in %s, %d min, %d catches."):format(s.type, s.zone, math.floor((time() - s.start) / 60), s.catches))
    end
    if db.lastError then say("Last error: " .. db.lastError) end
  elseif cmd == "check" then
    runHealthCheck(true)
  elseif cmd == "sync" then
    say("Saving data for the dashboard...")
    ReloadUI()
  else
    say("/gt start farming | /gt start fishing | /gt stop | /gt status")
    say("/gt check (test which game data works, then /reload) | /gt sync (same as /reload: saves data now)")
    say("Fishing sessions start by themselves on your first catch. A /reload keeps a running session; logging out ends it.")
  end
end
