-- Full bags helper: when the game says "Inventory is full", suggest the bag stack worth the least
-- and offer a Delete button. Safety rules:
--   * Only poor (grey) and common (white) items are suggested; never gear above grey.
--   * Never: Hearthstone, profession tools, quest items, materials for your own professions,
--     items you marked "keep" with /gt protect.
--   * One click deletes one stack. Nothing happens without the click.
-- Value = the better of the AH price after the AH cut and the vendor price (same rules as Advice.lua).
-- Loaded after Advice.lua.

local _, ns = ...
local A = ns and ns.advice
if not A then return end

-- Item ids that are never suggested: Hearthstone, skinning knives, mining picks,
-- blacksmith hammer, fishing poles, enchanting rods, flint and tinder, Arclight Spanner.
local PROTECTED = {
  [6948] = true, [7005] = true, [12709] = true, [19901] = true, [2901] = true, [20723] = true,
  [5956] = true, [6256] = true, [6365] = true, [6366] = true, [6367] = true, [12225] = true,
  [19022] = true, [19970] = true, [6218] = true, [6339] = true, [11130] = true, [11145] = true,
  [16207] = true, [4471] = true, [6219] = true,
}

local function cfg()
  local a = A.cfg()
  if a.fullbags == nil then a.fullbags = true end
  a.protect = a.protect or {}
  return a
end

local function itemId(link) return tonumber((link or ""):match("item:(%d+)")) end

-- The stack worth the least that is safe to suggest, or nil.
local function worstStack()
  local best
  for _, e in ipairs(A.scanBags()) do
    local id = itemId(e.link)
    local quality = e.quality or 1
    local d = e.d
    local safe = id and not PROTECTED[id] and not cfg().protect[id]
      and quality <= 1
      and (e.equipLoc == "" or quality == 0)
      and d.action ~= "keep"
    local value = 0
    if safe then
      local _, _, sell, _, bindType = A.itemFacts(e.link)
      if bindType == 4 then safe = false end -- quest item
      -- The item's own value: vendor price or AH price after the cut, whichever is higher.
      local vendor = (sell or 0) * e.count
      local unit = A.ahPrice(e.link, id)
      local ah = unit and math.floor(unit * e.count * (1 - A.cfg().ahCut / 100)) or 0
      value = math.max(vendor, ah)
      -- No known value (e.g. an unopened trunk, a new item): never suggest it.
      if value <= 0 then safe = false end
    end
    if safe then
      if not best or value < best.value then
        best = { bag = e.bag, slot = e.slot, link = e.link, count = e.count, value = value, id = id }
      end
    end
  end
  return best
end

local popup, current, lastShown = nil, nil, 0

local function build()
  popup = CreateFrame("Frame", "GoldTrackerFullBags", UIParent, BackdropTemplateMixin and "BackdropTemplate" or nil)
  popup:SetSize(320, 96)
  popup:SetPoint("TOP", UIParent, "TOP", 0, -160)
  popup:SetFrameStrata("DIALOG")
  if popup.SetBackdrop then
    popup:SetBackdrop({
      bgFile = "Interface\\Tooltips\\UI-Tooltip-Background",
      edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
      tile = true, tileSize = 16, edgeSize = 14,
      insets = { left = 3, right = 3, top = 3, bottom = 3 },
    })
    popup:SetBackdropColor(0.08, 0.07, 0.05, 0.96)
    popup:SetBackdropBorderColor(0.6, 0.5, 0.25, 1)
  end
  popup.title = popup:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  popup.title:SetPoint("TOPLEFT", 10, -10)
  popup.title:SetText("Gold Tracker: bags are full")
  popup.text = popup:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  popup.text:SetPoint("TOPLEFT", 10, -30)
  popup.text:SetWidth(300)
  popup.text:SetJustifyH("LEFT")

  popup.delete = CreateFrame("Button", nil, popup, "UIPanelButtonTemplate")
  popup.delete:SetSize(110, 22)
  popup.delete:SetPoint("BOTTOMLEFT", 10, 10)
  popup.delete:SetText("Delete")
  popup.delete:SetScript("OnClick", function()
    local c = current
    popup:Hide()
    if not c then return end
    -- The slot must still hold the same item.
    local info = A.try(C_Container.GetContainerItemInfo, c.bag, c.slot)
    if not info or info.hyperlink ~= c.link then A.say("That item moved. Nothing deleted.") return end
    if CursorHasItem and CursorHasItem() then ClearCursor() end
    A.try(C_Container.PickupContainerItem, c.bag, c.slot)
    if CursorHasItem and CursorHasItem() then
      DeleteCursorItem()
      A.say(("Deleted %s x%d (worth %s)."):format(c.link, c.count, A.money(c.value)))
    else
      A.say("Could not pick up the item. Nothing deleted.")
    end
  end)

  popup.keep = CreateFrame("Button", nil, popup, "UIPanelButtonTemplate")
  popup.keep:SetSize(90, 22)
  popup.keep:SetPoint("LEFT", popup.delete, "RIGHT", 6, 0)
  popup.keep:SetText("Never this")
  popup.keep:SetScript("OnClick", function()
    if current and current.id then cfg().protect[current.id] = true A.say(current.link .. " will not be suggested again.") end
    popup:Hide()
  end)

  popup.close = CreateFrame("Button", nil, popup, "UIPanelButtonTemplate")
  popup.close:SetSize(80, 22)
  popup.close:SetPoint("LEFT", popup.keep, "RIGHT", 6, 0)
  popup.close:SetText("Not now")
  popup.close:SetScript("OnClick", function() popup:Hide() end)
  popup:Hide()
end

local function suggest()
  if not cfg().fullbags or InCombatLockdown() then return end
  if GetTime() - lastShown < 8 then return end -- one popup per full-bag moment
  current = worstStack()
  if not current then return end
  lastShown = GetTime()
  if not popup then build() end
  popup.text:SetText(("Delete %s x%d to make room?\nIt is worth %s, the least of your safe items."):format(
    current.link, current.count, A.money(current.value)))
  popup:Show()
end

local events = CreateFrame("Frame")
events:SetScript("OnEvent", function(_, event, ...)
  if event == "UI_ERROR_MESSAGE" then
    local _, message = ...
    local full = ERR_INV_FULL or "Inventory is full."
    if message == full or message == ERR_LOOT_GONE_FULL then pcall(suggest) end
  elseif event == "BAG_UPDATE_DELAYED" and popup and popup:IsShown() and current then
    -- Close the popup when the suggested item is gone (sold, deleted or moved).
    local info = A.try(C_Container.GetContainerItemInfo, current.bag, current.slot)
    if not info or info.hyperlink ~= current.link then popup:Hide() end
  end
end)
pcall(events.RegisterEvent, events, "UI_ERROR_MESSAGE")
pcall(events.RegisterEvent, events, "BAG_UPDATE_DELAYED")

-- /gt fullbags [on|off], /gt protect clear
local previous = SlashCmdList.GOLDTRACKER
SlashCmdList.GOLDTRACKER = function(msg)
  local cmd, arg = (msg or ""):lower():match("^(%S*)%s*(.-)$")
  if cmd == "fullbags" then
    local a = cfg()
    if arg == "on" or arg == "off" then a.fullbags = (arg == "on") else a.fullbags = not a.fullbags end
    A.say("Full bags helper: " .. (a.fullbags and "on" or "off"))
    return
  elseif cmd == "protect" and arg == "clear" then
    cfg().protect = {}
    A.say("All 'Never this' choices are cleared.")
    return
  elseif cmd == "worst" then
    local w = worstStack()
    A.say(w and ("Least valuable safe item: %s x%d (%s)."):format(w.link, w.count, A.money(w.value)) or "No safe item to suggest.")
    return
  end
  previous(msg)
end
