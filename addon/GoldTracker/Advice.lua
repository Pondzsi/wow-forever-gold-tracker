-- Gold Tracker advice: the dashboard's sell / vendor / send decisions, in game.
--
--   * Tooltip line on every item: sell on the AH, vendor, keep, or send to the bank alt.
--   * Vendor panel: what is better vendored, with a "Sell these" button.
--   * Mailbox panel (on other characters): what to send to the bank alt, with an "Attach" button.
--   * Session window: gold and gold per hour of the running session.
--   * Login summary: one chat line with what is waiting for you.
--
-- Prices come from Auctionator's public addon API. The buttons act only when you
-- click them; nothing sells or sends by itself. Every panel can be switched off.
-- Settings live in GoldTrackerDB.advice. Loaded after GoldTracker.lua.

local ADDON_NAME, ns = ...
ns = ns or {}
local PREFIX = "|cffffd100Gold Tracker:|r "
local CALLER = "GoldTracker"

local function say(msg) print(PREFIX .. msg) end

local function try(fn, ...)
  if type(fn) ~= "function" then return end
  local res = { pcall(fn, ...) }
  if res[1] then return unpack(res, 2, table.maxn(res)) end
end

local function secret(v) return issecretvalue ~= nil and issecretvalue(v) or false end

local GetItemInfoFn = (C_Item and C_Item.GetItemInfo) or GetItemInfo

local function me() return (UnitName("player") or "?") .. "-" .. (GetRealmName() or "?") end

-------------------------------------------------------------------------------
-- Settings
-------------------------------------------------------------------------------

local DEFAULTS = {
  tooltip = true, vendor = true, mail = true, summary = true, window = true,
  ahCut = 5,           -- AH cut in percent (Classic value; check after your first sale)
  postage = 30,        -- copper per mail (Classic value; unverified for Forever)
}

local function cfg()
  GoldTrackerDB = GoldTrackerDB or {}
  local a = GoldTrackerDB.advice or {}
  GoldTrackerDB.advice = a
  for k, v in pairs(DEFAULTS) do if a[k] == nil then a[k] = v end end
  a.lastGold = a.lastGold or {}
  return a
end

-------------------------------------------------------------------------------
-- Money text: 12g 34s 56c with the game's coin icons
-------------------------------------------------------------------------------

local function money(copper)
  copper = math.floor((copper or 0) + 0.5)
  if GetCoinTextureString then
    local s = try(GetCoinTextureString, copper)
    if s then return s end
  end
  local g, s, c = math.floor(copper / 10000), math.floor(copper / 100) % 100, copper % 100
  if g > 0 then return ("%dg %ds %dc"):format(g, s, c) end
  if s > 0 then return ("%ds %dc"):format(s, c) end
  return ("%dc"):format(c)
end

-------------------------------------------------------------------------------
-- Prices and item facts
-------------------------------------------------------------------------------

local function auctionatorReady()
  return Auctionator and Auctionator.API and Auctionator.API.v1 and true or false
end

-- Latest Auctionator price for one unit, or nil.
local function ahPrice(itemLink, itemID)
  if not auctionatorReady() then return nil end
  local api = Auctionator.API.v1
  local p
  if itemLink and api.GetAuctionPriceByItemLink then p = try(api.GetAuctionPriceByItemLink, CALLER, itemLink) end
  if not p and itemID and api.GetAuctionPriceByItemID then p = try(api.GetAuctionPriceByItemID, CALLER, itemID) end
  if type(p) == "number" and p > 0 then return p end
  return nil
end

local function itemIdFromLink(link)
  if type(link) ~= "string" or secret(link) then return nil end
  return tonumber(link:match("item:(%d+)"))
end

-- name, quality, sellPrice, equipLoc, bindType for an item link or id.
local function itemFacts(item)
  local name, _, quality, _, _, _, _, _, equipLoc, _, sell, _, _, bindType = try(GetItemInfoFn, item)
  return name, quality, sell or 0, equipLoc or "", bindType
end

-- Bind types that can never go on the AH or in the mail: pickup, quest, account/warbound.
local NO_TRADE_BIND = { [1] = true, [4] = true, [7] = true, [8] = true, [9] = true }

local function slotBound(bag, slot)
  if C_Container and C_Container.GetContainerItemInfo then
    local info = try(C_Container.GetContainerItemInfo, bag, slot)
    if info and info.isBound ~= nil then return info.isBound end
  end
  if C_Item and C_Item.IsBound and ItemLocation and ItemLocation.CreateFromBagAndSlot then
    local loc = try(ItemLocation.CreateFromBagAndSlot, ItemLocation, bag, slot)
    if loc then return try(C_Item.IsBound, loc) end
  end
  return nil
end

-------------------------------------------------------------------------------
-- Who knows which recipe (from the recipes the addon read in profession windows)
-------------------------------------------------------------------------------

local function charProfessions(key)
  local c = GoldTrackerDB and GoldTrackerDB.chars and GoldTrackerDB.chars[key]
  local out = {}
  if c and c.skills then for name in pairs(c.skills) do out[name] = true end end
  return out
end

local function bankAltKey()
  local name = cfg().bankAlt
  if not name or name == "" then return nil end
  if name:find("-") then return name end
  return name .. "-" .. (GetRealmName() or "?")
end

-- itemID -> list of { profession, product } for recipes that use it.
local reagentIndex
local function reagentsOf(itemID)
  if not reagentIndex then
    reagentIndex = {}
    for _, r in pairs((GoldTrackerDB and GoldTrackerDB.recipes) or {}) do
      for rid in pairs(r.r or {}) do
        reagentIndex[rid] = reagentIndex[rid] or {}
        table.insert(reagentIndex[rid], { profession = r.p, product = r.out })
      end
    end
  end
  return reagentIndex[itemID]
end

-------------------------------------------------------------------------------
-- The decision (same rules as the dashboard's Sell list and Send to bank alt)
-------------------------------------------------------------------------------

-- Returns a table { action = "sell"|"vendor"|"keep"|"send"|"check"|"none", text = ..., value = copper }
-- for `count` units of an item. `bound` is true/false when known from the bag slot.
local function decide(itemLink, count, bound)
  count = count or 1
  local itemID = itemIdFromLink(itemLink)
  if not itemID then return { action = "none" } end
  local _, quality, sell, equipLoc, bindType = itemFacts(itemLink)
  local vendor = (sell or 0) * count
  local cut = cfg().ahCut / 100
  local mine = me()
  local alt = bankAltKey()
  local isAlt = alt and alt == mine
  local tradable = not bound and not (bindType and NO_TRADE_BIND[bindType])

  -- Crafting materials: keep your own, send the bank alt's.
  local uses = reagentsOf(itemID)
  if uses and tradable then
    local myProfs = charProfessions(mine)
    for _, u in ipairs(uses) do
      if myProfs[u.profession] then
        return { action = "keep", text = "Keep: " .. u.profession .. " material", value = 0 }
      end
    end
    if alt and not isAlt then
      local altProfs = charProfessions(alt)
      for _, u in ipairs(uses) do
        if altProfs[u.profession] then
          return { action = "send", text = "Send to " .. alt:match("^[^-]+") .. " (" .. u.profession .. ")", value = 0 }
        end
      end
    end
  end

  if quality == 0 and vendor > 0 then
    return { action = "vendor", text = "Vendor: junk", value = vendor, junk = true }
  end
  if not tradable then
    if vendor > 0 then return { action = "vendor", text = "Vendor: can't go on the AH", value = vendor } end
    return { action = "none" }
  end

  local unit = ahPrice(itemLink, itemID)
  if unit then
    local net = math.floor(unit * count * (1 - cut))
    if vendor >= net and vendor > 0 then
      return { action = "vendor", text = "Vendor: AH pays less after fees", value = vendor, ahNet = net }
    end
    if alt and not isAlt then
      return { action = "send", text = "Send to " .. alt:match("^[^-]+") .. " to sell", value = net, ahNet = net }
    end
    return { action = "sell", text = "Sell on AH", value = net, ahNet = net }
  end

  if vendor > 0 then
    return { action = "check", text = "No AH price yet: search it with Auctionator", value = vendor }
  end
  return { action = "none" }
end

local COLOR = { sell = "ff6fd18a", vendor = "ffe9a23b", keep = "ffa89f8c", send = "ff8ab8ff", check = "ffa89f8c" }

-------------------------------------------------------------------------------
-- Bags
-------------------------------------------------------------------------------

local function bagIds()
  local ids = { 0, 1, 2, 3, 4 }
  if Enum and Enum.BagIndex and Enum.BagIndex.ReagentBag then ids[#ids + 1] = Enum.BagIndex.ReagentBag end
  return ids
end

-- Every bag stack with its decision: { bag, slot, link, count, quality, equipLoc, d }.
local function scanBags()
  local out = {}
  for _, bag in ipairs(bagIds()) do
    local n = (C_Container and try(C_Container.GetContainerNumSlots, bag)) or 0
    for slot = 1, n do
      local info = C_Container and try(C_Container.GetContainerItemInfo, bag, slot)
      if info and info.hyperlink and not secret(info.hyperlink) then
        local count = info.stackCount or 1
        local d = decide(info.hyperlink, count, slotBound(bag, slot))
        local _, quality, _, equipLoc = itemFacts(info.hyperlink)
        out[#out + 1] = { bag = bag, slot = slot, link = info.hyperlink, count = count, quality = quality, equipLoc = equipLoc, d = d }
      end
    end
  end
  return out
end

-------------------------------------------------------------------------------
-- 1. Tooltip line
-------------------------------------------------------------------------------

local function addTooltipLine(tooltip, link)
  if not cfg().tooltip or not link or InCombatLockdown() then return end
  local d = decide(link, 1, nil)
  if d.action == "none" then return end
  local text = d.text
  if d.ahNet then
    local _, _, sell = itemFacts(link)
    text = ("%s · %s each after fees (vendor %s)"):format(text, money(d.ahNet), money(sell or 0))
  elseif d.action == "vendor" and d.value > 0 then
    text = ("%s · %s each"):format(text, money(d.value))
  end
  tooltip:AddLine(("|c%sGold Tracker: %s|r"):format(COLOR[d.action] or "ffffffff", text))
  tooltip:Show()
end

local function hookTooltips()
  if TooltipDataProcessor and TooltipDataProcessor.AddTooltipPostCall and Enum and Enum.TooltipDataType then
    TooltipDataProcessor.AddTooltipPostCall(Enum.TooltipDataType.Item, function(tooltip)
      if tooltip ~= GameTooltip and tooltip ~= ItemRefTooltip then return end
      local _, link = try(tooltip.GetItem, tooltip)
      addTooltipLine(tooltip, link)
    end)
  elseif GameTooltip and GameTooltip.HookScript then
    GameTooltip:HookScript("OnTooltipSetItem", function(tooltip)
      local _, link = try(tooltip.GetItem, tooltip)
      addTooltipLine(tooltip, link)
    end)
  end
end

-------------------------------------------------------------------------------
-- Small panel used by the vendor and mailbox helpers
-------------------------------------------------------------------------------

local function makePanel(name, title)
  local f = CreateFrame("Frame", name, UIParent, BackdropTemplateMixin and "BackdropTemplate" or nil)
  f:SetSize(260, 120)
  f:SetFrameStrata("HIGH")
  if f.SetBackdrop then
    f:SetBackdrop({
      bgFile = "Interface\\Tooltips\\UI-Tooltip-Background",
      edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
      tile = true, tileSize = 16, edgeSize = 14,
      insets = { left = 3, right = 3, top = 3, bottom = 3 },
    })
    f:SetBackdropColor(0.08, 0.07, 0.05, 0.95)
    f:SetBackdropBorderColor(0.6, 0.5, 0.25, 1)
  end
  f.title = f:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  f.title:SetPoint("TOPLEFT", 10, -10)
  f.title:SetText(title)
  f.body = f:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  f.body:SetPoint("TOPLEFT", 10, -30)
  f.body:SetWidth(240)
  f.body:SetJustifyH("LEFT")
  f.button = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
  f.button:SetSize(150, 22)
  f.button:SetPoint("BOTTOMLEFT", 8, 8)
  f.close = CreateFrame("Button", nil, f, "UIPanelCloseButton")
  f.close:SetPoint("TOPRIGHT", 2, 2)
  f:Hide()
  return f
end

local function fill(panel, lines, total, buttonText, enabled)
  local shown = {}
  for i = 1, math.min(#lines, 10) do shown[i] = lines[i] end
  if #lines > 10 then shown[#shown + 1] = ("…and %d more"):format(#lines - 10) end
  shown[#shown + 1] = " "
  shown[#shown + 1] = "Total: " .. money(total)
  panel.body:SetText(table.concat(shown, "\n"))
  panel:SetHeight(panel.body:GetStringHeight() + 72)
  panel.button:SetText(buttonText)
  panel.button:SetEnabled(enabled)
end

-- Uses (sells or attaches) bag stacks one by one, with a short pause between them.
local function useSlots(list, onDone)
  local i = 0
  local function step()
    i = i + 1
    local e = list[i]
    if not e then if onDone then onDone() end return end
    local info = try(C_Container.GetContainerItemInfo, e.bag, e.slot)
    if info and info.hyperlink == e.link then try(C_Container.UseContainerItem, e.bag, e.slot) end
    C_Timer.After(0.2, step)
  end
  step()
end

-------------------------------------------------------------------------------
-- 2. Vendor helper
-------------------------------------------------------------------------------

local vendorPanel
local function showVendorPanel()
  if not cfg().vendor or not MerchantFrame then return end
  vendorPanel = vendorPanel or makePanel("GoldTrackerVendorPanel", "Gold Tracker: better vendored")
  vendorPanel:ClearAllPoints()
  vendorPanel:SetPoint("TOPLEFT", MerchantFrame, "TOPRIGHT", 4, 0)

  local sellable, lines, total, gear = {}, {}, 0, 0
  for _, e in ipairs(scanBags()) do
    if e.d.action == "vendor" then
      -- Safety: the button never sells gear above grey quality. That gear is listed only.
      local safe = e.d.junk or e.equipLoc == ""
      if safe then sellable[#sellable + 1] = e else gear = gear + 1 end
      total = total + e.d.value
      lines[#lines + 1] = ("%s x%d  %s%s"):format(e.link, e.count, money(e.d.value), safe and "" or " (gear: sell by hand)")
    end
  end
  if #lines == 0 then vendorPanel:Hide() return end
  fill(vendorPanel, lines, total, ("Sell these (%d)"):format(#sellable), #sellable > 0)
  vendorPanel.button:SetScript("OnClick", function(btn)
    btn:SetEnabled(false)
    useSlots(sellable, function() say("Sold " .. #sellable .. " stack(s).") vendorPanel:Hide() end)
  end)
  vendorPanel:Show()
end

-------------------------------------------------------------------------------
-- 3. Mailbox helper (on characters other than the bank alt)
-------------------------------------------------------------------------------

local mailPanel
local MAX_ATTACH = ATTACHMENTS_MAX_SEND or 12

local function showMailPanel()
  if not cfg().mail or not MailFrame then return end
  local alt = bankAltKey()
  if not alt or alt == me() then return end
  mailPanel = mailPanel or makePanel("GoldTrackerMailPanel", "Gold Tracker: send to bank alt")
  mailPanel:ClearAllPoints()
  mailPanel:SetPoint("TOPLEFT", MailFrame, "TOPRIGHT", 4, 0)

  local toSend, lines, total = {}, {}, 0
  for _, e in ipairs(scanBags()) do
    if e.d.action == "send" then
      toSend[#toSend + 1] = e
      total = total + (e.d.value or 0)
      lines[#lines + 1] = ("%s x%d"):format(e.link, e.count)
    end
  end
  if #toSend == 0 then mailPanel:Hide() return end
  local altName = alt:match("^[^-]+")
  mailPanel.title:SetText("Gold Tracker: send to " .. altName)
  local batch = {}
  for i = 1, math.min(#toSend, MAX_ATTACH) do batch[i] = toSend[i] end
  fill(mailPanel, lines, total, ("Attach %d item(s)"):format(#batch), true)
  mailPanel.button:SetScript("OnClick", function(btn)
    -- Open the Send Mail tab, fill in the bank alt, attach. You press Send yourself.
    if MailFrameTab2 then try(MailFrameTab_OnClick, MailFrameTab2, 2) end
    if SendMailNameEditBox then SendMailNameEditBox:SetText(altName) end
    btn:SetEnabled(false)
    useSlots(batch, function()
      say(("Attached %d item(s) for %s. Check the mail and press Send. Postage: about %s."):format(
        #batch, altName, money(cfg().postage)))
    end)
  end)
  mailPanel:Show()
end

-------------------------------------------------------------------------------
-- 4. Session window
-------------------------------------------------------------------------------

local sessionFrame
local function updateSessionFrame()
  local c = GoldTrackerDB and GoldTrackerDB.chars and GoldTrackerDB.chars[me()]
  local s = c and c.session
  if not cfg().window or not s then
    if sessionFrame then sessionFrame:Hide() end
    return
  end
  if not sessionFrame then
    sessionFrame = CreateFrame("Frame", "GoldTrackerSessionFrame", UIParent, BackdropTemplateMixin and "BackdropTemplate" or nil)
    sessionFrame:SetSize(190, 64)
    sessionFrame:SetMovable(true)
    sessionFrame:EnableMouse(true)
    sessionFrame:RegisterForDrag("LeftButton")
    sessionFrame:SetScript("OnDragStart", sessionFrame.StartMoving)
    sessionFrame:SetScript("OnDragStop", function(f)
      f:StopMovingOrSizing()
      local point, _, rel, x, y = f:GetPoint()
      cfg().windowPos = { point, rel, x, y }
    end)
    if sessionFrame.SetBackdrop then
      sessionFrame:SetBackdrop({
        bgFile = "Interface\\Tooltips\\UI-Tooltip-Background",
        edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
        tile = true, tileSize = 16, edgeSize = 12,
        insets = { left = 3, right = 3, top = 3, bottom = 3 },
      })
      sessionFrame:SetBackdropColor(0.08, 0.07, 0.05, 0.85)
      sessionFrame:SetBackdropBorderColor(0.6, 0.5, 0.25, 1)
    end
    sessionFrame.text = sessionFrame:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    sessionFrame.text:SetPoint("TOPLEFT", 8, -8)
    sessionFrame.text:SetJustifyH("LEFT")
    local pos = cfg().windowPos
    if pos then sessionFrame:SetPoint(pos[1], UIParent, pos[2], pos[3], pos[4])
    else sessionFrame:SetPoint("TOP", UIParent, "TOP", 0, -120) end
  end
  local m = try(GetMoney)
  local minutes = math.max(1, (time() - (s.start or time())) / 60)
  local gained = (m and s.g0 and not secret(m)) and (m - s.g0) or 0
  local perHour = gained / minutes * 60
  sessionFrame.text:SetText(("|cffe8c25a%s session|r  %d min\nGold: %s\nPer hour: %s%s"):format(
    s.type == "fishing" and "Fishing" or "Farming", math.floor(minutes),
    (gained < 0 and "-" or "") .. money(math.abs(gained)),
    (perHour < 0 and "-" or "") .. money(math.abs(perHour)),
    s.type == "fishing" and ("\nCatches: " .. (s.catches or 0)) or ""))
  sessionFrame:SetHeight(sessionFrame.text:GetStringHeight() + 16)
  sessionFrame:Show()
end

-------------------------------------------------------------------------------
-- 5. Login summary
-------------------------------------------------------------------------------

local function loginSummary()
  if not cfg().summary then return end
  local a = cfg()
  local key = me()
  local m = try(GetMoney)
  local parts = {}
  local last = a.lastGold[key]
  if m and last and not secret(m) then
    local d = m - last
    if d ~= 0 then parts[#parts + 1] = (d > 0 and "+" or "-") .. money(math.abs(d)) .. " since last time" end
  end
  local sellN, sellV, vendN, vendV, sendN, checkN = 0, 0, 0, 0, 0, 0
  for _, e in ipairs(scanBags()) do
    local act = e.d.action
    if act == "sell" then sellN, sellV = sellN + 1, sellV + e.d.value
    elseif act == "vendor" then vendN, vendV = vendN + 1, vendV + e.d.value
    elseif act == "send" then sendN = sendN + 1
    elseif act == "check" then checkN = checkN + 1 end
  end
  if sellN > 0 then parts[#parts + 1] = ("%d to sell on the AH (%s)"):format(sellN, money(sellV)) end
  if vendN > 0 then parts[#parts + 1] = ("%d to vendor (%s)"):format(vendN, money(vendV)) end
  if sendN > 0 then parts[#parts + 1] = ("%d to send to %s"):format(sendN, (bankAltKey() or "?"):match("^[^-]+")) end
  if checkN > 0 then parts[#parts + 1] = ("%d without AH price"):format(checkN) end
  if not auctionatorReady() then parts[#parts + 1] = "Auctionator not loaded: no AH prices" end
  if #parts > 0 then say(table.concat(parts, " · ")) end
end

-------------------------------------------------------------------------------
-- Events, health check addition, slash commands
-------------------------------------------------------------------------------

local frame = CreateFrame("Frame")
local handlers = {}

-- Daily gold per character, for the window's Gold and Goals tabs: history[YYYY-MM-DD][charKey] = copper.
local function today() return date("%Y-%m-%d") end
local function recordGold()
  local m = try(GetMoney)
  if not m or secret(m) then return end
  local h = cfg()
  h.history = h.history or {}
  local d = today()
  h.history[d] = h.history[d] or {}
  h.history[d][me()] = m
  -- Keep 120 days.
  local cutoff = date("%Y-%m-%d", time() - 120 * 86400)
  for day in pairs(h.history) do if day < cutoff then h.history[day] = nil end end
end

-- Total gold of all characters at the end of `day` (latest known value per character up to that day).
local function totalOn(day)
  local h = cfg().history or {}
  local latest = {}
  for d, chars in pairs(h) do
    if d <= day then
      for key, g in pairs(chars) do
        if not latest[key] or d > latest[key].d then latest[key] = { d = d, g = g } end
      end
    end
  end
  local sum, any = 0, false
  for _, v in pairs(latest) do sum, any = sum + v.g, true end
  return any and sum or nil
end

function handlers.PLAYER_LOGIN()
  cfg()
  recordGold()
  hookTooltips()
  C_Timer.After(6, loginSummary)
  -- Add the Auctionator check to the health check that GoldTracker.lua runs 10 s after login.
  C_Timer.After(12, function()
    local h = GoldTrackerDB and GoldTrackerDB.health
    if h and h.checks then
      h.checks.auctionatorApi = auctionatorReady()
        and { ok = true, detail = "Auctionator price API available" }
        or { ok = false, detail = "Auctionator not loaded: in-game sell advice has no AH prices" }
    end
  end)
  C_Timer.NewTicker(1, updateSessionFrame)
end

function handlers.PLAYER_LOGOUT()
  local m = try(GetMoney)
  if m and not secret(m) then cfg().lastGold[me()] = m end
end

handlers.MERCHANT_SHOW = function() C_Timer.After(0.3, showVendorPanel) end
handlers.MERCHANT_CLOSED = function() if vendorPanel then vendorPanel:Hide() end end
handlers.MAIL_SHOW = function() C_Timer.After(0.5, showMailPanel) end
handlers.MAIL_CLOSED = function() if mailPanel then mailPanel:Hide() end end
-- New recipes may arrive while playing.
handlers.TRADE_SKILL_LIST_UPDATE = function() reagentIndex = nil end
handlers.PLAYER_MONEY = recordGold

-- Shared with Window.lua (same addon namespace).
ns.advice = {
  say = say, try = try, money = money, me = me, cfg = cfg, decide = decide, scanBags = scanBags,
  bankAltKey = bankAltKey, auctionatorReady = auctionatorReady, totalOn = totalOn, today = today,
  COLOR = COLOR,
}

frame:SetScript("OnEvent", function(_, event, ...)
  local h = handlers[event]
  if h then
    local ok, err = pcall(h, ...)
    if not ok and GoldTrackerDB then GoldTrackerDB.lastError = "Advice " .. event .. ": " .. tostring(err) end
  end
end)
for event in pairs(handlers) do pcall(frame.RegisterEvent, frame, event) end

-- Extra /gt commands. Everything else goes to GoldTracker.lua's handler.
local base = SlashCmdList.GOLDTRACKER
local TOGGLES = { tooltip = "tooltip advice", vendor = "vendor panel", mail = "mailbox panel", summary = "login summary", window = "session window" }

SlashCmdList.GOLDTRACKER = function(msg)
  local raw = msg or ""
  local cmd, arg = raw:lower():match("^(%S*)%s*(.-)$")
  local a = cfg()
  if TOGGLES[cmd] then
    if arg == "on" or arg == "off" then a[cmd] = (arg == "on") else a[cmd] = not a[cmd] end
    say(TOGGLES[cmd] .. ": " .. (a[cmd] and "on" or "off"))
    if cmd == "window" then updateSessionFrame() end
    return
  elseif cmd == "bankalt" then
    -- The whole rest of the line, so "Name-Realm" and names with spaces both work.
    local name = raw:match("^%S+%s+(.-)%s*$")
    if name == "" then name = nil end
    if not name then
      say("Bank alt: " .. (a.bankAlt or "not set") .. ". Set it with /gt bankalt Name")
    elseif name:lower() == "none" then
      a.bankAlt = nil
      say("Bank alt cleared.")
    else
      a.bankAlt = name:sub(1, 1):upper() .. name:sub(2)
      reagentIndex = nil
      say("Bank alt: " .. a.bankAlt .. ". Other characters now get 'Send to " .. a.bankAlt .. "' advice.")
    end
    return
  elseif cmd == "cut" then
    local n = tonumber(arg)
    if n and n >= 0 and n <= 50 then a.ahCut = n say(("AH cut set to %s%%."):format(n))
    else say(("AH cut: %s%%. Change it with /gt cut 5"):format(a.ahCut)) end
    return
  elseif cmd == "advice" then
    for k, label in pairs(TOGGLES) do say(("%s: %s  (/gt %s)"):format(label, a[k] and "on" or "off", k)) end
    say(("Bank alt: %s (/gt bankalt Name) · AH cut: %s%% (/gt cut 5) · Auctionator: %s"):format(
      a.bankAlt or "not set", a.ahCut, auctionatorReady() and "loaded" or "not loaded"))
    return
  end
  base(msg)
  if cmd == "" or cmd == "help" then
    say("/gt advice (in-game advice settings) | /gt bankalt Name | /gt cut 5 | /gt tooltip | /gt vendor | /gt mail | /gt summary | /gt window")
  elseif cmd == "check" then
    local h = GoldTrackerDB and GoldTrackerDB.health
    if h and h.checks then
      h.checks.auctionatorApi = auctionatorReady()
        and { ok = true, detail = "Auctionator price API available" }
        or { ok = false, detail = "Auctionator not loaded: in-game sell advice has no AH prices" }
      say("Auctionator price API: " .. (auctionatorReady() and "OK" or "not loaded"))
    end
  end
end
