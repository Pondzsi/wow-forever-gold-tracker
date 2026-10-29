-- Gold Tracker window (/gt): the dashboard's daily views in game.
--   Sell  - what to do with each stack in your bags (sell, vendor, keep, check AH)
--   Send  - what this character should mail to the bank alt, with the mail plan
--   Gold  - gold of all characters, today and the last 7 days
--   Goals - savings goals with progress and an estimated date
-- Uses the same rules as the tooltips (Advice.lua). Loaded after Advice.lua.

local _, ns = ...
local A = ns and ns.advice
if not A then return end

local ROWS = 14
local ROW_H = 18
local TABS = { "Sell", "Send", "Gold", "Goals" }
local ORDER = { sell = 1, send = 2, vendor = 3, check = 4, keep = 5 }
local LABEL = { sell = "Sell on AH", send = "Send", vendor = "Vendor", check = "Check AH", keep = "Keep" }

local win, state = nil, { tab = "Sell", offset = 0, rows = {} }

local function color(action, text)
  return ("|c%s%s|r"):format(A.COLOR[action] or "ffffffff", text)
end

local function shortName(key) return (key or "?"):match("^[^-]+") end

-------------------------------------------------------------------------------
-- Tab contents: each returns header, rows { left, right, link }, footer
-------------------------------------------------------------------------------

local function sellTab()
  local list, totals = {}, {}
  for _, e in ipairs(A.scanBags()) do
    local act = e.d.action
    if act ~= "none" and act ~= "send" then
      list[#list + 1] = e
      totals[act] = totals[act] or { n = 0, v = 0 }
      totals[act].n = totals[act].n + 1
      totals[act].v = totals[act].v + (e.d.value or 0)
    end
  end
  table.sort(list, function(a, b)
    if ORDER[a.d.action] ~= ORDER[b.d.action] then return ORDER[a.d.action] < ORDER[b.d.action] end
    return (a.d.value or 0) > (b.d.value or 0)
  end)
  local rows = {}
  for _, e in ipairs(list) do
    local value = (e.d.value or 0) > 0 and ("  " .. A.money(e.d.value)) or ""
    rows[#rows + 1] = { left = e.link .. " x" .. e.count, right = color(e.d.action, LABEL[e.d.action]) .. value, link = e.link, tip = e.d.text }
  end
  local parts = {}
  for _, act in ipairs({ "sell", "vendor", "check", "keep" }) do
    local t = totals[act]
    if t then parts[#parts + 1] = color(act, ("%s %d"):format(LABEL[act], t.n)) .. (t.v > 0 and (" " .. A.money(t.v)) or "") end
  end
  local header = #parts > 0 and table.concat(parts, "   ") or "Nothing to do with your bags."
  local footer = A.auctionatorReady()
    and ("Prices: Auctionator. AH cut %s%% (/gt cut). Hover a row for details."):format(A.cfg().ahCut)
    or "Auctionator is not loaded: no AH prices."
  return header, rows, footer
end

local function sendTab()
  local alt = A.bankAltKey()
  if not alt then return "No bank alt set.", {}, "Set it with /gt bankalt Name" end
  if alt == A.me() then return "This character is the bank alt.", {}, "Log in on another character to see what to send here." end
  local rows, value = {}, 0
  for _, e in ipairs(A.scanBags()) do
    if e.d.action == "send" then
      value = value + (e.d.value or 0)
      local reason = e.d.text:match("%((.-)%)") or "to sell"
      rows[#rows + 1] = { left = e.link .. " x" .. e.count, right = color("send", reason), link = e.link, tip = e.d.text }
    end
  end
  if #rows == 0 then return "Nothing to send to " .. shortName(alt) .. ".", {}, "" end
  local perMail = ATTACHMENTS_MAX_SEND or 12
  local mails = math.ceil(#rows / perMail)
  local header = ("Send %d stack(s) to %s"):format(#rows, shortName(alt))
  local footer = ("%d mail(s) · postage about %s · value %s. At a mailbox, use Attach."):format(
    mails, A.money(mails * A.cfg().postage), A.money(value))
  return header, rows, footer
end

local function changeSince(daysBack)
  local now = A.totalOn(A.today())
  local before = A.totalOn(date("%Y-%m-%d", time() - daysBack * 86400))
  if not now or not before then return nil end
  return now - before
end

local function signed(c)
  if not c then return "|cffa89f8cno data yet|r" end
  if c == 0 then return A.money(0) end
  return (c > 0 and "|cff6fd18a+" or "|cfff07a6e-") .. A.money(math.abs(c)) .. "|r"
end

local function goldTab()
  local rows, total = {}, 0
  local chars = {}
  for key, c in pairs((GoldTrackerDB and GoldTrackerDB.chars) or {}) do
    if c.gold then chars[#chars + 1] = { key = key, c = c } end
  end
  table.sort(chars, function(a, b) return a.c.gold > b.c.gold end)
  for _, e in ipairs(chars) do
    total = total + e.c.gold
    local tag = e.key == A.bankAltKey() and " (bank alt)" or ""
    rows[#rows + 1] = { left = shortName(e.key) .. tag .. " |cffa89f8c" .. (e.c.class or "") .. "|r", right = A.money(e.c.gold) }
  end
  local header = "Total: " .. A.money(total)
  local footer = ("Since yesterday: %s   Last 7 days: %s"):format(signed(changeSince(1)), signed(changeSince(7)))
  return header, rows, footer
end

local function goalsTab()
  local goals = A.cfg().goals or {}
  local total = A.totalOn(A.today()) or 0
  local week = changeSince(7)
  local perDay = week and week / 7 or nil
  local rows = {}
  for i, g in ipairs(goals) do
    local pct = math.min(100, math.floor(total / g.target * 100))
    local left = g.target - total
    local eta
    if left <= 0 then eta = "|cff6fd18areached|r"
    elseif perDay and perDay > 0 then eta = ("about %d day(s)"):format(math.ceil(left / perDay))
    else eta = "|cffa89f8cno estimate|r" end
    -- "|" starts an escape code in WoW text, so the bar uses "=".
    local filled = math.floor(pct / 5)
    local bar = string.rep("=", filled) .. "|cff3a342a" .. string.rep("=", 20 - filled) .. "|r"
    rows[#rows + 1] = { left = ("%d. %s  |cffe8c25a%s|r"):format(i, g.name, bar), right = ("%d%% · %s"):format(pct, eta), tip = A.money(total) .. " of " .. A.money(g.target) }
  end
  local header = #goals > 0 and ("All characters: " .. A.money(total)) or "No goals yet."
  local footer = "Add: /gt goal 1000g Epic mount   Remove: /gt goal remove 1"
  return header, rows, footer
end

local BUILD = { Sell = sellTab, Send = sendTab, Gold = goldTab, Goals = goalsTab }

-------------------------------------------------------------------------------
-- Frame
-------------------------------------------------------------------------------

local function render()
  if not win or not win:IsShown() then return end
  local header, rows, footer = BUILD[state.tab]()
  state.rows = rows
  local maxOffset = math.max(0, #rows - ROWS)
  if state.offset > maxOffset then state.offset = maxOffset end
  win.header:SetText(header)
  win.footer:SetText(footer)
  for i = 1, ROWS do
    local r = rows[i + state.offset]
    local line = win.lines[i]
    if r then
      line.left:SetText(r.left)
      line.right:SetText(r.right)
      line.data = r
      line:Show()
    else
      line.data = nil
      line:Hide()
    end
  end
  win.empty:SetText(#rows == 0 and "Nothing to show." or "")
  win.scroll:SetText(#rows > ROWS and ("%d-%d of %d"):format(state.offset + 1, math.min(#rows, state.offset + ROWS), #rows) or "")
  for _, b in ipairs(win.tabs) do b:SetEnabled(b.tabName ~= state.tab) end
end

local function build()
  win = CreateFrame("Frame", "GoldTrackerWindow", UIParent, BackdropTemplateMixin and "BackdropTemplate" or nil)
  win:SetSize(460, 22 + 30 + 22 + ROWS * ROW_H + 44)
  win:SetFrameStrata("DIALOG")
  win:SetMovable(true)
  win:EnableMouse(true)
  win:RegisterForDrag("LeftButton")
  win:SetScript("OnDragStart", win.StartMoving)
  win:SetScript("OnDragStop", function(f)
    f:StopMovingOrSizing()
    local point, _, rel, x, y = f:GetPoint()
    A.cfg().mainPos = { point, rel, x, y }
  end)
  local pos = A.cfg().mainPos
  if pos then win:SetPoint(pos[1], UIParent, pos[2], pos[3], pos[4]) else win:SetPoint("CENTER") end
  if win.SetBackdrop then
    win:SetBackdrop({
      bgFile = "Interface\\Tooltips\\UI-Tooltip-Background",
      edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
      tile = true, tileSize = 16, edgeSize = 14,
      insets = { left = 3, right = 3, top = 3, bottom = 3 },
    })
    win:SetBackdropColor(0.08, 0.07, 0.05, 0.96)
    win:SetBackdropBorderColor(0.6, 0.5, 0.25, 1)
  end
  if UISpecialFrames then table.insert(UISpecialFrames, "GoldTrackerWindow") end -- Escape closes it

  win.title = win:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
  win.title:SetPoint("TOPLEFT", 12, -10)
  win.title:SetText("Gold Tracker")
  local close = CreateFrame("Button", nil, win, "UIPanelCloseButton")
  close:SetPoint("TOPRIGHT", 2, 2)

  win.tabs = {}
  for i, name in ipairs(TABS) do
    local b = CreateFrame("Button", nil, win, "UIPanelButtonTemplate")
    b:SetSize(80, 22)
    b:SetPoint("TOPLEFT", 12 + (i - 1) * 84, -34)
    b:SetText(name)
    b.tabName = name
    b:SetScript("OnClick", function()
      state.tab, state.offset = name, 0
      A.cfg().lastTab = name
      render()
    end)
    win.tabs[i] = b
  end

  win.header = win:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  win.header:SetPoint("TOPLEFT", 14, -64)
  win.header:SetWidth(432)
  win.header:SetJustifyH("LEFT")

  win.lines = {}
  for i = 1, ROWS do
    local line = CreateFrame("Button", nil, win)
    line:SetSize(436, ROW_H)
    line:SetPoint("TOPLEFT", 12, -84 - (i - 1) * ROW_H)
    line.left = line:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    line.left:SetPoint("LEFT", 2, 0)
    line.left:SetWidth(270)
    line.left:SetJustifyH("LEFT")
    line.right = line:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    line.right:SetPoint("RIGHT", -2, 0)
    line.right:SetJustifyH("RIGHT")
    local hl = line:CreateTexture(nil, "HIGHLIGHT")
    hl:SetAllPoints()
    hl:SetColorTexture(1, 0.85, 0.4, 0.08)
    line:SetScript("OnEnter", function(self)
      local d = self.data
      if not d then return end
      GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
      if d.link then GameTooltip:SetHyperlink(d.link) end
      if d.tip and not d.link then GameTooltip:AddLine(d.tip, 1, 1, 1) end
      GameTooltip:Show()
    end)
    line:SetScript("OnLeave", function() GameTooltip:Hide() end)
    win.lines[i] = line
  end

  win.empty = win:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  win.empty:SetPoint("TOPLEFT", 16, -90)
  win.scroll = win:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  win.scroll:SetPoint("BOTTOMRIGHT", -14, 30)
  win.footer = win:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  win.footer:SetPoint("BOTTOMLEFT", 14, 12)
  win.footer:SetWidth(432)
  win.footer:SetJustifyH("LEFT")

  win:EnableMouseWheel(true)
  win:SetScript("OnMouseWheel", function(_, delta)
    state.offset = math.max(0, state.offset - delta * 3)
    render()
  end)
  win:SetScript("OnShow", render)
  win:Hide()
end

local function toggle(tab)
  if not win then build() end
  if tab then state.tab, state.offset = tab, 0 end
  if win:IsShown() and not tab then win:Hide() return end
  state.tab = state.tab or A.cfg().lastTab or "Sell"
  win:Show()
  render()
end

-- Refresh while open, when bags or gold change.
local events = CreateFrame("Frame")
events:SetScript("OnEvent", function() if win and win:IsShown() then render() end end)
for _, e in ipairs({ "BAG_UPDATE_DELAYED", "PLAYER_MONEY" }) do pcall(events.RegisterEvent, events, e) end

-------------------------------------------------------------------------------
-- Slash: /gt opens the window; /gt goal manages goals; the rest goes on.
-------------------------------------------------------------------------------

local function parseGold(text)
  text = (text or ""):lower():gsub("%s+", "")
  if text == "" then return nil end
  if text:match("^%d+$") then return tonumber(text) * 10000 end
  local total, found = 0, false
  for n, unit in text:gmatch("(%d+)([gsc])") do
    total = total + tonumber(n) * (unit == "g" and 10000 or unit == "s" and 100 or 1)
    found = true
  end
  return found and total or nil
end

local previous = SlashCmdList.GOLDTRACKER
SlashCmdList.GOLDTRACKER = function(msg)
  local raw = msg or ""
  local cmd, arg = raw:lower():match("^(%S*)%s*(.-)$")
  if cmd == "" then toggle() return end
  if cmd == "sell" or cmd == "send" or cmd == "gold" or cmd == "goals" then
    toggle(cmd:sub(1, 1):upper() .. cmd:sub(2))
    return
  end
  if cmd == "goal" then
    local a = A.cfg()
    a.goals = a.goals or {}
    local n = arg:match("^remove%s+(%d+)$")
    if n then
      local g = table.remove(a.goals, tonumber(n))
      A.say(g and ("Goal removed: " .. g.name) or "No goal with that number.")
    else
      local amount, name = raw:match("^%S+%s+(%S+)%s+(.+)$")
      local target = parseGold(amount)
      if not target or target <= 0 or not name then
        A.say("Use: /gt goal 1000g Epic mount  (or 1000 for gold)   Remove: /gt goal remove 1")
        return
      end
      table.insert(a.goals, { name = name, target = target })
      A.say(("Goal added: %s, %s."):format(name, A.money(target)))
    end
    if win and win:IsShown() then render() end
    return
  end
  if cmd == "help" then
    previous("")
    A.say("/gt opens the Gold Tracker window. /gt sell | send | gold | goals open a tab. /gt goal 1000g Name adds a goal.")
    return
  end
  previous(msg)
end
