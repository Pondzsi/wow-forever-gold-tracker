GoldTrackerDB = {
	["version"] = 1,
	["seq"] = 9,
	["items"] = {
		[2589] = { ["n"] = "Linen Cloth", ["v"] = 13 },
		[4306] = { ["n"] = "Silk Cloth", ["v"] = 37 },
		[4305] = { ["n"] = "Bolt of Silk Cloth", ["v"] = 150 },
		[4245] = { ["n"] = "Small Silk Pack", ["v"] = 500, ["b"] = false },
		[2000] = { ["n"] = "Bound Gear |A:Professions-ChatIcon-Quality-12-Tier2:17:15::1|a", ["v"] = 900, ["b"] = true, ["q"] = 4 },
		[21150] = { ["n"] = "Iron Bound Trunk" },
		[6358] = { ["n"] = "Oily Blackmouth", ["v"] = 4 },
	},
	["chars"] = {
		["Legally Dead-Realm"] = {
			["name"] = "Legally Dead", ["class"] = "MAGE", ["gold"] = 52000,
			["bags"] = { [4306] = 20, [2589] = 40 }, ["bagsT"] = 1793000000,
			["skills"] = { ["Tailoring"] = { 150, 150 }, ["Fishing"] = { 80, 150 } },
		},
		["Newalt-Realm"] = { ["name"] = "Newalt", ["class"] = "WARLOCK" },
	},
	["events"] = {
		{ ["id"] = "Legally Dead-Realm:1", ["c"] = "Legally Dead-Realm", ["t"] = 1793000000, ["k"] = "gold", ["g"] = 50000 },
		{ ["id"] = "Legally Dead-Realm:2", ["c"] = "Legally Dead-Realm", ["t"] = 1793000100, ["k"] = "money", ["d"] = -500, ["g"] = 49500, ["cat"] = "repair" },
		{ ["id"] = "Legally Dead-Realm:3", ["c"] = "Legally Dead-Realm", ["t"] = 1793000200, ["k"] = "money", ["d"] = 2500, ["g"] = 52000, ["cat"] = "auction", ["note"] = "sold: Small Silk Pack" },
		{ ["id"] = "Legally Dead-Realm:4", ["c"] = "Legally Dead-Realm", ["t"] = 1793000150, ["k"] = "sale", ["item"] = "Small Silk Pack", ["n"] = 1,
		  ["bid"] = 2000, ["dep"] = 60, ["cut"] = 100, ["got"] = 1960 },
		{ ["id"] = "Legally Dead-Realm:5", ["c"] = "Legally Dead-Realm", ["t"] = 1793000300, ["k"] = "skill", ["n"] = "Fishing", ["r"] = 80, ["m"] = 150 },
		{ ["id"] = "Legally Dead-Realm:6", ["c"] = "Legally Dead-Realm", ["t"] = 1793003600, ["k"] = "session", ["s"] = {
			["type"] = "fishing", ["auto"] = true, ["zone"] = "Alterac Mountains / Lordamere Lake",
			["start"] = 1793000000, ["stop"] = 1793003600, ["g0"] = 50000, ["g1"] = 52000,
			["fs0"] = 75, ["fs1"] = 80, ["catches"] = 40,
			["loot"] = { [6358] = 30 },
			["containers"] = {
				{ ["item"] = 21150, ["t"] = 1793001000, ["copper"] = 450, ["items"] = { [4306] = 3 } },
			},
		} },
	},
	["recipes"] = {
		["Tailoring:4245"] = { ["p"] = "Tailoring", ["out"] = 4245, ["n"] = 1, ["r"] = { [4305] = 3, [2589] = 1 } },
	},
}
