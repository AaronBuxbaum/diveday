// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Bonaire and Klein Bonaire. */
export const BONAIRE: DiveSiteTemplate[] = [
  // Denominator row: Nukove (Doblet)
  // Position: OpenStreetMap node 663869422 (Nukove), within 0.1 km of bonaire.com's coordinates.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "nukove-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/nukove/",
      "https://bonaire.com/en/dive-sites/nukove/",
      "https://www.openstreetmap.org/node/663869422",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Nukove",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.2407,
      forecastLongitude: -68.4128,
      description:
        "A northwest-coast shore dive from a small sandy cove, on a reef that slopes away from shore. Few divers come this far, and the hard coral is healthy.",
      marineLife: "Parrotfish · stingrays · groupers · barracuda",
      marineLifeDescription:
        "Healthy hard coral in the shallows, with bigger fish out in the blue.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "5–30 m (15–100 ft)",
      maxDepthMeters: 30,
      divePlan:
        "Enter from the cove, follow the slope out from shore, no deeper than 30 m (100 ft), and return along the shallower reef.",
      fitTone: "demanding",
      fitNote:
        "Remote, with a rough track, no facilities and stones at the waterline, so it suits experienced divers. The reef drops past this plan's 30 m floor. Check with STINAPA that this coast is open.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "rainbow-parrotfish",
        "southern-stingray",
        "great-barracuda",
        "nassau-grouper",
        "common-sea-fan",
      ],
    },
  },
  // Denominator row: Carel's Vision
  // Position: OpenStreetMap node 854130125 (Carel's Vision), within 0.1 km of bonaire.com's coordinates.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "carels-vision-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/carels-vision/",
      "https://bonaire.com/en/dive-sites/carels-vision/",
      "https://www.openstreetmap.org/node/854130125",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Carel’s Vision",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.2307,
      forecastLongitude: -68.4127,
      description:
        "A northwest-coast shore dive beside Nukove, with dense hard coral and wide views that suit a wide-angle lens.",
      marineLife: "Hard corals · parrotfish · angelfish",
      marineLifeDescription: "Dense hard coral makes this a landscape dive.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "advanced",
      depthRange: "6–30 m (20–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "Can be strong according to bonaire.com, enough to carry divers away from the exit.",
      divePlan:
        "Enter from shore, swim into any current first, work the reef no deeper than 30 m (100 ft), and keep the exit in sight.",
      fitTone: "demanding",
      fitNote:
        "A 4WD track and a short walk lead to the water. Check with STINAPA that the site is open, because coral disease has closed sites on this coast. The reef drops past this plan's 30 m floor.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "boulder-star-coral",
        "great-star-coral",
        "queen-angelfish",
        "princess-parrotfish",
        "common-sea-fan",
      ],
    },
  },
  // Denominator row: Karpata
  // Position: OpenStreetMap node 663869440 (Karpata), within 0.1 km of bonaire.com's coordinates.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "karpata-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/karpata/",
      "https://bonaire.com/en/dive-sites/karpata-dive/",
      "https://www.openstreetmap.org/node/663869440",
      "https://www.padi.com/dive-site/bonaire/karpata/",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Karpata",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.2191,
      forecastLongitude: -68.3523,
      description:
        "A shore dive at the end of the one-way section of the coastal road. Elkhorn coral stands in the shallows right up to the surface, and the reef steps down in buttresses split by sand channels.",
      marineLife: "Elkhorn coral · parrotfish · turtles · sea fans",
      marineLifeDescription: "Good visibility and a reef that works for wide-angle photography.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "6–30 m (20–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "None to moderate, stronger around tide changes. Chop or a north wind makes the entry harder.",
      divePlan:
        "Enter from the platform, descend at the mooring and dive south. The King Willem-Alexander Reserve begins to the north and is closed to diving.",
      fitTone: "demanding",
      fitNote:
        "The buttresses drop past this plan's 30 m floor. Use the cement platform to get in.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Anchor",
          kind: "reefHistory",
          note: "An old anchor lies at about 11 m, a short swim south of the mooring.",
        },
        {
          name: "Concrete platform",
          kind: "pointOfInterest",
          note: "The entry platform at the foot of the stairs.",
        },
      ],
      creatureSlugs: [
        "elkhorn-coral",
        "stoplight-parrotfish",
        "hawksbill-turtle",
        "common-sea-fan",
        "french-angelfish",
      ],
    },
  },
  // Denominator row: La Dania's Leap
  // Position: OpenStreetMap node 663869441 (La Denia's Leap), within 0.1 km of bonaire.com's coordinates.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "la-danias-leap-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/la-danias-leap/",
      "https://bonaire.com/en/dive-sites/la-danias-leap/",
      "https://www.openstreetmap.org/node/663869441",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "La Dania’s Leap",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.2178,
      forecastLongitude: -68.348,
      description:
        "One of Bonaire's few vertical walls, cut by canyons and sand chutes. You leap from the ledge and drift along the wall toward Karpata.",
      marineLife: "Sunshinefish · sponges · sea fans",
      marineLifeDescription: "Look for juvenile sunshinefish on the mid to deep wall.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "5–30 m (15–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "A drift dive; the current can be stronger than expected. The wall continues below this plan's 30 m floor.",
      divePlan:
        "Leap from the ledge, take the deeper wall first, and drift toward Karpata no deeper than 30 m (100 ft).",
      fitTone: "demanding",
      fitNote:
        "A drift along a wall. Set it up with a driver and a second car at Karpata, and carry a delayed SMB.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "sunshinefish",
        "orange-elephant-ear-sponge",
        "common-sea-fan",
        "french-angelfish",
      ],
    },
  },
  // Denominator row: Rappel
  // Position: Placed between its numbered neighbors on the STINAPA map, whose OpenStreetMap positions are known; good to about 0.5 km, so a shop should re-pin it.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "rappel-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/scuba-diving/dive-site-map/rappell/",
      "https://bonaire.com/en/dive-sites/rappel-dive/",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Bruce’s Rappel",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.217,
      forecastLongitude: -68.345,
      description:
        "A busy site renamed Bruce's Rappel in 2021 in memory of Bruce Bowker. Large sea fans and gorgonians fill the shallows.",
      marineLife: "Sea fans · gorgonians · angelfish",
      marineLifeDescription: "Big gorgonians crowd the shallows.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "9–30 m (30–100 ft)",
      maxDepthMeters: 30,
      divePlan:
        "Descend at the mooring, work along the reef no deeper than 30 m (100 ft), and stay out of the shallow cave.",
      fitTone: "demanding",
      fitNote:
        "The mooring is close to the ledge, so boats rock. A shallow cave near the entry gets awkward in a swell; stay out of it. The reef drops past this plan's 30 m floor.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "common-sea-fan",
        "encrusting-gorgonian",
        "queen-angelfish",
        "french-angelfish",
      ],
    },
  },
  // Denominator row: Bloodlet
  // Position: Between Rappel and Tolo on the STINAPA map; Duikersgids lists 12.2163, -68.3428, which agrees.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 25 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "bloodlet-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/bloodlet/",
      "https://bonaire.com/en/dive-sites/bloodlet/",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Bloodlet",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.2163,
      forecastLongitude: -68.3428,
      description:
        "A dense reef of tube sponges and schooling blue tangs, where turtles turn up often.",
      marineLife: "Blue tang · tube sponges · turtles",
      marineLifeDescription: "Tube sponges in yellow and green, with plenty of grazers.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "advanced",
      depthRange: "6–25 m (20–80 ft)",
      maxDepthMeters: 25,
      currentNote: "Moderate to strong according to bonaire.com.",
      divePlan:
        "Descend at the mooring, work the reef no deeper than 25 m (80 ft), and return along the shallower tube sponges.",
      fitTone: "demanding",
      fitNote:
        "The shore entry is tricky and can hurt, which gave the site its name, so most divers come by boat.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["blue-tang", "yellow-tube-sponge", "green-sea-turtle", "hawksbill-turtle"],
    },
  },
  // Denominator row: Tolo (Ol' Blue, Boka di Tolo)
  // Position: OpenStreetMap node 663869427 (Boka di Tolo), within 0.1 km of bonaire.com's coordinates.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 25 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "tolo-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/ol-blue-tolo/",
      "https://bonaire.com/en/dive-sites/tolo-dive/",
      "https://www.openstreetmap.org/node/663869427",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Tolo (Ol’ Blue)",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.215,
      forecastLongitude: -68.3374,
      description:
        "A reef off a long beach of coral stones, just north of 1000 Steps. French angelfish and schooling fish are plentiful.",
      marineLife: "French angelfish · schooling fish",
      marineLifeDescription: "Listen for the coral stones rattling in the wash on the beach.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "6–25 m (20–80 ft)",
      maxDepthMeters: 25,
      divePlan:
        "Enter from the beach of coral stones, follow the reef out, no deeper than 25 m (80 ft), and return along the shallower coral.",
      fitTone: "demanding",
      fitNote:
        "A shore dive for divers with Advanced Open Water. The reef drops past this plan's 25 m floor.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["french-angelfish", "blue-tang", "creole-wrasse", "brown-chromis"],
    },
  },
  // Denominator row: Country Garden
  // Position: PADI lists 12.2137, -68.3349 and Duikersgids 12.2132, -68.3366, which agree.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 25 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "country-garden-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/country-garden/",
      "https://bonaire.com/en/dive-sites/country-garden/",
      "https://www.padi.com/dive-site/bonaire/country-garden/",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Country Garden",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.2137,
      forecastLongitude: -68.3349,
      description:
        "Three pillars that broke from the shore cliff stand in about 9 m of water, grown over with hard coral, gorgonians and sponges. The site is also called Mushroom City.",
      marineLife: "Schoolmasters · grunts · goatfish",
      marineLifeDescription: "The pillars shelter schoolmasters, grunts and goatfish.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "6–25 m (20–80 ft)",
      maxDepthMeters: 25,
      divePlan:
        "Descend at the mooring, circle the three pillars in about 9 m, and work the slope no deeper than 25 m (80 ft).",
      fitTone: "demanding",
      fitNote: "Reached by boat only. The reef drops past this plan's 25 m floor.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The pillars",
          kind: "reefFormation",
          note: "Three pillars fallen from the cliff, standing at about 9 m.",
        },
      ],
      creatureSlugs: [
        "schoolmaster-snapper",
        "french-grunt",
        "spotted-goatfish",
        "common-sea-fan",
        "boulder-star-coral",
      ],
    },
  },
  // Denominator row: 1000 Steps
  // Position: PADI lists 12.2106, -68.3217 and bonaire.com 12.2108, -68.3216, which agree.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "1000-steps-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/1000-steps/",
      "https://bonaire.com/en/dive-sites/1000-steps-dive/",
      "https://www.padi.com/dive-site/bonaire/1000-steps/",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "1000 Steps",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.2104,
      forecastLongitude: -68.3218,
      description:
        "Named for the stairs down from the road, which feel endless on the way back up. Star coral forms hollow towers under the mooring, and the reef drops into a steep wall from about 9 m.",
      marineLife: "Sergeant majors · hawksbill turtles · star coral",
      marineLifeDescription: "Look inside the hollow pagodas for sergeant major egg patches.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "6–30 m (20–100 ft)",
      maxDepthMeters: 30,
      divePlan:
        "Descend at the mooring, follow the wall no deeper than 30 m (100 ft), and leave gas and time for the climb up the steps.",
      fitTone: "demanding",
      fitNote:
        "A shore dive with a long stair climb at the end; the steps can be slippery. The wall continues below this plan's 30 m floor.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Coral pagodas",
          kind: "reefFormation",
          note: "Tall hollow star-coral towers directly under the mooring.",
        },
      ],
      creatureSlugs: [
        "sergeant-major",
        "hawksbill-turtle",
        "boulder-star-coral",
        "mountainous-star-coral",
      ],
    },
  },
  // Denominator row: Weber's Joy (Witch's Hut)
  // Position: OpenStreetMap node 636400689 (Weber's Joy), within 0.1 km of bonaire.com's coordinates.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "webers-joy-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/webers-joywitchs-hut/",
      "https://bonaire.com/en/dive-sites/webers-joy/",
      "https://www.openstreetmap.org/node/636400689",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Weber’s Joy (Witch’s Hut)",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.2062,
      forecastLongitude: -68.3168,
      description:
        "A shore dive south of 1000 Steps with rock beauties, angelfish and butterflyfish. A big lavender stovepipe sponge sits just south of the mooring.",
      marineLife: "Rock beauty · angelfish · butterflyfish",
      marineLifeDescription: "A good wide-angle site with plenty of fish.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "6–30 m (20–100 ft)",
      maxDepthMeters: 30,
      divePlan:
        "Enter from shore, dive south past the mooring, no deeper than 30 m (100 ft), and come back up the reef.",
      fitTone: "demanding",
      fitNote:
        "A shore dive for divers with Advanced Open Water. The reef drops past this plan's 30 m floor.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "rock-beauty",
        "queen-angelfish",
        "foureye-butterflyfish",
        "stovepipe-sponge",
      ],
    },
  },
  // Denominator row: Jeff Davis Memorial
  // Position: OpenStreetMap node 636400684 (Jeff Davis Memorial), within 0.5 km of bonaire.com's coordinates.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "jeff-davis-memorial-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/jeff-davis-memorial/",
      "https://bonaire.com/en/dive-sites/jeff-davis-memorial/",
      "https://www.openstreetmap.org/node/636400684",
      "https://www.duikersgids.nl/en/jeff-davis-memorial",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Jeff Davis Memorial",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.2047,
      forecastLongitude: -68.3143,
      description:
        "Gorgonians cover the shallows, and ridges of coral form chutes that lead down to sand. Turtles and seahorses are good bets.",
      marineLife: "Gorgonians · turtles · seahorses",
      marineLifeDescription: "Coral chutes lead down to a sandy floor.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "6–30 m (20–100 ft)",
      maxDepthMeters: 30,
      divePlan:
        "Cross the rocky entry, follow the coral ridges down the chutes no deeper than 30 m (100 ft), and return along the gorgonians.",
      fitTone: "demanding",
      fitNote:
        "A shore dive over a rocky entry that gets hard in north wind and swell. The reef drops past this plan's 30 m floor.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "encrusting-gorgonian",
        "hawksbill-turtle",
        "longsnout-seahorse",
        "common-sea-fan",
      ],
    },
  },
  // Denominator row: Kalli's Reef
  // Position: Midway between Jeff Davis Memorial and Oil Slick Leap, as infobonaire places it; bonaire.com's pin (12.2016, -68.3108) is within 0.2 km.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "kallis-reef-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/kallis-reef/",
      "https://bonaire.com/en/dive-sites/kallis-reef/",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Kalli’s Reef",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.2018,
      forecastLongitude: -68.311,
      description:
        "A reef between Jeff Davis Memorial and Oil Slick Leap, named for a former marine park manager. Seahorses and turtles are regular finds.",
      marineLife: "Seahorses · turtles",
      marineLifeDescription: "A well-liked reef with small animals to find.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "9–30 m (30–100 ft)",
      maxDepthMeters: 30,
      divePlan:
        "Descend at the mooring, work along the reef no deeper than 30 m (100 ft), and return along the shallower coral.",
      fitTone: "demanding",
      fitNote:
        "Mostly a boat dive. The rocky shore entry is slippery and unsafe in strong north wind. The reef drops past this plan's 30 m floor.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["longsnout-seahorse", "hawksbill-turtle", "green-sea-turtle", "blue-tang"],
    },
  },
  // Denominator row: Oil Slick Leap
  // Position: OpenStreetMap node 663869425 (Oil Slick Leap), within 0.1 km of bonaire.com's coordinates.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 25 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "oil-slick-leap-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/oil-slick-leap/",
      "https://bonaire.com/en/dive-sites/oil-slick-leap/",
      "https://www.openstreetmap.org/node/663869425",
      "https://www.duikersgids.nl/en/oil-slick-leap",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Oil Slick Leap",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.1999,
      forecastLongitude: -68.3088,
      description:
        "An oil terminal was once proposed here and never built, hence the name. Barracuda gather in schools. Boats visit the site, and a steel ladder gives a shore entry.",
      marineLife: "Barracuda · reef fish",
      marineLifeDescription: "Large schools of barracuda are often seen.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "6–25 m (20–80 ft)",
      maxDepthMeters: 25,
      divePlan:
        "Use the steel ladder or the boat, work the reef no deeper than 25 m (80 ft), and return along the shallower coral.",
      fitTone: "demanding",
      fitNote:
        "Mostly a boat dive. The ladder rungs can be slippery. The reef drops past this plan's 25 m floor.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Steel ladder",
          kind: "pointOfInterest",
          note: "A ladder from the shore into the water.",
        },
      ],
      creatureSlugs: ["great-barracuda", "blue-tang", "french-angelfish"],
    },
  },
  // Denominator row: Barkadera
  // Position: Between Oil Slick Leap and Andrea II, opposite the marine park headquarters; bonaire.com's pin is within 0.3 km of the straight line between their OpenStreetMap positions.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "barkadera-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/barcadera/",
      "https://bonaire.com/en/dive-sites/barkadera/",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Barkadera",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.1975,
      forecastLongitude: -68.3047,
      description:
        "A boat dive across from the marine park headquarters, with elkhorn coral and blue tangs in the shallows.",
      marineLife: "Blue tang · elkhorn coral",
      marineLifeDescription: "Elkhorn shallows and grazing tangs.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "9–30 m (30–100 ft)",
      maxDepthMeters: 30,
      currentNote: "Light according to bonaire.com.",
      divePlan:
        "Descend at the mooring, work the elkhorn shallows and the slope no deeper than 30 m (100 ft), and finish on the shallows.",
      fitTone: "demanding",
      fitNote:
        "A boat dive. The current is light but can surprise people who are changing depth. The reef drops past this plan's 30 m floor.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["blue-tang", "elkhorn-coral", "french-angelfish"],
    },
  },
  // Denominator row: Andrea II
  // Position: OpenStreetMap node 636400643 (Andrea II), within 0.1 km of bonaire.com's coordinates.
  // Gate: ungated Open Water dive, because infobonaire calls it a beginner or novice site and its terrace is run that way; the plan's floor is 18 m and the slope falls away beyond it.
  {
    slug: "andrea-ii-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/andrea-i-and-andrea-ii-pali-coco/",
      "https://bonaire.com/en/dive-sites/andrea-ii/",
      "https://www.openstreetmap.org/node/636400643",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Andrea II",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.1912,
      forecastLongitude: -68.298,
      description:
        "Half a mile north of the desalination plant. Anemones and soft corals shelter small predators and prey, seahorses have been found, and big parrotfish graze the shallows.",
      marineLife: "Seahorses · anemones · parrotfish",
      marineLifeDescription:
        "Soft corals and anemones are the interest, with big parrotfish in the shallows.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "beginner",
      depthRange: "6–18 m (20–60 ft)",
      maxDepthMeters: 18,
      divePlan:
        "Enter over the rocks, work the reef no deeper than 18 m (60 ft), and return through the shallow parrotfish grazing area.",
      fitTone: "welcoming",
      fitNote:
        "A calm dive for newer divers and snorkelers, with a rocky shore entry that needs care. A wall falls away past this plan's 18 m floor.",
      creatureSlugs: [
        "longsnout-seahorse",
        "blue-parrotfish",
        "midnight-parrotfish",
        "rainbow-parrotfish",
      ],
    },
  },
  // Denominator row: Andrea I
  // Position: OpenStreetMap node 663869426 (Andrea I), within 0.1 km of bonaire.com's coordinates.
  // Gate: ungated Open Water dive, because infobonaire calls it a beginner or novice site and its terrace is run that way; the plan's floor is 18 m and the slope falls away beyond it.
  {
    slug: "andrea-i-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/andrea-i-and-andrea-ii-pali-coco/",
      "https://bonaire.com/en/dive-sites/andrea-i-dive/",
      "https://www.openstreetmap.org/node/663869426",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Andrea I",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.1883,
      forecastLongitude: -68.297,
      description:
        "Next to Andrea II, with anemones, soft corals and seahorses. Three kinds of large parrotfish feed in the shallows.",
      marineLife: "Seahorses · parrotfish · anemones",
      marineLifeDescription: "The shallows are good snorkeling too.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "beginner",
      depthRange: "6–18 m (20–60 ft)",
      maxDepthMeters: 18,
      divePlan:
        "Enter over the rocks, work the reef no deeper than 18 m (60 ft), and return through the shallows.",
      fitTone: "welcoming",
      fitNote:
        "A calm dive for newer divers and snorkelers, with a rocky shore entry that needs care. The reef falls away past this plan's 18 m floor.",
      creatureSlugs: [
        "longsnout-seahorse",
        "blue-parrotfish",
        "midnight-parrotfish",
        "rainbow-parrotfish",
      ],
    },
  },
  // Denominator row: Small Wall
  // Position: Duikersgids lists 12.1796, -68.2935 and bonaire.com the same pin, which agree.
  // Gate: ungated; the sources give a shallow depth range with no drop-off in it.
  {
    slug: "small-wall-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/small-wall/",
      "https://bonaire.com/en/dive-sites/small-wall/",
      "https://www.duikersgids.nl/en/small-wall",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Small Wall",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.1796,
      forecastLongitude: -68.2935,
      description:
        "A vertical wall off a small inn, starting at about 6 m, with one of the calmest surfaces on the island. A cave near 18 m lies outside the plan.",
      marineLife: "Wall fish · sponges · gorgonians",
      marineLifeDescription: "Fish along the wall and sponges and gorgonians on its face.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "beginner",
      depthRange: "6–15 m (20–50 ft)",
      maxDepthMeters: 18,
      divePlan:
        "Descend the wall from about 6 m, turn at 15 m (49 ft), and return along the shallower face. The cave near 18 m is a no-go.",
      fitTone: "welcoming",
      fitNote:
        "Usually a boat dive, since shore divers need permission to cross private property. The plan stops at 15 m, above the cave.",
      creatureSlugs: ["french-angelfish", "common-sea-fan", "blue-tang", "queen-parrotfish"],
    },
  },
  // Denominator row: Cliff
  // Position: OpenStreetMap node 663869433 (Cliff), within 0.1 km of bonaire.com's coordinates.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 23 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "cliff-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/cliff/",
      "https://www.openstreetmap.org/node/663869433",
      "https://www.duikersgids.nl/en/cliff",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Cliff",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.1741,
      forecastLongitude: -68.2906,
      description:
        "Reached from a resort house reef or by boat on the west coast. A stone memorial to departed divers, set by Captain Don, sits under the mooring beside a small step in the reef.",
      marineLife: "Reef fish · gorgonians",
      marineLifeDescription: "A memorial plaque and a small cliff to find.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "6–23 m (20–75 ft)",
      maxDepthMeters: 23,
      divePlan:
        "Descend at the mooring, visit the memorial and the small step in the reef, and work the reef no deeper than 23 m (75 ft).",
      fitTone: "demanding",
      fitNote: "Entry is through a resort or by boat. The wall drops past this plan's 23 m floor.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Stone memorial",
          kind: "underwaterMonument",
          note: "Captain Don's memorial to divers who have gone before, marked with a plaque and a flag.",
        },
      ],
      creatureSlugs: ["french-angelfish", "blue-tang", "queen-parrotfish", "common-sea-fan"],
    },
  },
  // Denominator row: La Machaca
  // Position: OpenStreetMap node 635094207 (La Machaca), within 0.1 km of bonaire.com's coordinates.
  // Gate: ungated Open Water dive, because infobonaire calls it a beginner or novice site and its terrace is run that way; the plan's floor is 18 m and the slope falls away beyond it.
  {
    slug: "la-machaca-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/la-machaca/",
      "https://bonaire.com/en/dive-sites/la-machaca/",
      "https://www.openstreetmap.org/node/635094207",
      "https://www.duikersgids.nl/en/la-machaca",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "La Machaca",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.1717,
      forecastLongitude: -68.2894,
      description:
        "A locally built boat about 14 m long rests in 15 m of water, 30 yards off a resort shore. A shallow first wreck for newer divers.",
      marineLife: "Wreck fish · reef fish",
      marineLifeDescription: "A small wreck close to shore.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "beginner",
      depthRange: "6–18 m (20–60 ft)",
      maxDepthMeters: 18,
      divePlan:
        "Swim out to the boat, circle the hull on the outside, and return along the reef, no deeper than 18 m (60 ft).",
      fitTone: "welcoming",
      fitNote:
        "Stay outside the hull and approach with care. Entry is through a resort and needs its permission. The reef continues past this plan's 18 m floor.",
      landmarks: [
        {
          name: "Locally built boat",
          kind: "wreckFeature",
          note: "A 45 ft (14 m) boat lying at about 15 m, 30 yards from shore.",
        },
      ],
      creatureSlugs: ["french-angelfish", "blue-tang", "sergeant-major"],
    },
  },
  // Denominator row: Reef Scientifico
  // Position: OpenStreetMap node 663869438 (Reef Scientifico), within 0.1 km of bonaire.com's coordinates.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  // Sources disagree: infobonaire gives 13 m, bonaire.com 3–30 m; the deeper figure is taken.
  {
    slug: "reef-scientifico-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/reef-scientifico/",
      "https://bonaire.com/en/dive-sites/reef-scientifico/",
      "https://www.openstreetmap.org/node/663869438",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Reef Scientifico",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.1714,
      forecastLongitude: -68.2893,
      description:
        "South of La Machaca, named for a grid built to track algae growth on the reef. Free-swimming morays and sleeping parrotfish appear on night dives.",
      marineLife: "Moray eels · sleeping parrotfish",
      marineLifeDescription: "After dark the morays swim free.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "3–30 m (10–100 ft)",
      maxDepthMeters: 30,
      divePlan:
        "Enter over the rocks, work the reef no deeper than 30 m (100 ft), and return along the shallower coral.",
      fitTone: "demanding",
      fitNote:
        "A night-dive favorite. The rocky entry needs care. The reef drops past this plan's 30 m floor.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "green-moray",
        "queen-parrotfish",
        "stoplight-parrotfish",
        "french-angelfish",
      ],
    },
  },
  // Denominator row: Buddy's Reef
  // Position: OpenStreetMap node 635094204 (Buddy's Reef), within 0.1 km of bonaire.com's coordinates.
  // Gate: ungated Open Water dive, because infobonaire calls it a beginner or novice site and its terrace is run that way; the plan's floor is 18 m and the slope falls away beyond it.
  {
    slug: "buddys-reef-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/buddys-reef/",
      "https://bonaire.com/en/dive-sites/buddys-reef/",
      "https://www.openstreetmap.org/node/635094204",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Buddy’s Reef",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.171,
      forecastLongitude: -68.2888,
      description:
        "A resort house reef. Black crinoids perch on coral heads in the shallows, and a resident tarpon often joins night dives.",
      marineLife: "Tarpon · black crinoids · reef fish",
      marineLifeDescription: "A resident tarpon joins the night dives.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "beginner",
      depthRange: "9–18 m (30–60 ft)",
      maxDepthMeters: 18,
      divePlan:
        "Enter from the resort pier area, work the reef no deeper than 18 m (60 ft), and keep clear of the boats at the pier.",
      fitTone: "welcoming",
      fitNote:
        "A calm dive for newer divers. The drop-off begins at about 8 m and the reef continues past this plan's 18 m floor. Carry an SMB for boats at the resort pier.",
      creatureSlugs: ["tarpon", "french-angelfish", "blue-tang", "queen-parrotfish"],
    },
  },
  // Denominator row: Bari Reef
  // Position: OpenStreetMap node 313862678 (Bari Reef), within 0.1 km of bonaire.com's coordinates.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "bari-reef-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/bari-reef-sand-dollar-resort-condominiums/",
      "https://bonaire.com/en/dive-sites/bari-reef/",
      "https://www.openstreetmap.org/node/313862678",
      "https://www.duikersgids.nl/en/bari-reef",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Bari Reef",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.1675,
      forecastLongitude: -68.2877,
      description:
        "Entered through Isidel Beach Park by a concrete ramp. Recorded fish counts here are among the highest in the Caribbean.",
      marineLife: "Reef fish · parrotfish · angelfish",
      marineLifeDescription: "A rich fish list for a shore reef.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "9–30 m (30–100 ft)",
      maxDepthMeters: 30,
      divePlan:
        "Go down the concrete ramp, work the reef no deeper than 30 m (100 ft), and watch the boats near the small pier on the way back.",
      fitTone: "demanding",
      fitNote:
        "The ramp is slippery, and boats work near the small pier. The bottom drops quickly, so hold this plan's 30 m floor.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["queen-parrotfish", "french-angelfish", "blue-tang", "spotted-goatfish"],
    },
  },
  // Denominator row: Front Porch
  // Position: OpenStreetMap node 639106013 (Front Porch), within 0.1 km of bonaire.com's coordinates.
  // Gate: ungated Open Water dive, because infobonaire calls it a beginner or novice site and its terrace is run that way; the plan's floor is 18 m and the slope falls away beyond it.
  {
    slug: "front-porch-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/front-porch-coco-beach/",
      "https://bonaire.com/en/dive-sites/front-porch/",
      "https://www.openstreetmap.org/node/639106013",
      "https://www.duikersgids.nl/en/front-porch",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Front Porch",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.1667,
      forecastLongitude: -68.2874,
      description:
        "A relaxed dive beside Bari Reef, entered from the shore by the Den Laman Apartments or from Eden Beach. The broken remains of a tugboat lie below the old Sunset pier, deeper than the plan.",
      marineLife: "Garden eels · scorpionfish · morays",
      marineLifeDescription: "Rubble and old machinery shelter small animals.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "beginner",
      depthRange: "6–24 m (20–80 ft)",
      maxDepthMeters: 24,
      divePlan:
        "Enter from the shore, work the garden-eel sand and the reef no deeper than 18 m (60 ft), and stay outside the tug remains at about 24 m.",
      fitTone: "welcoming",
      fitNote:
        "Sharp metal lies on the seabed. The tug remains are at about 24 m, below this plan's 18 m floor; stay outside them.",
      landmarks: [
        {
          name: "Tugboat remains",
          kind: "wreckFeature",
          note: "A broken tug at about 24 m below the old Sunset pier, deeper than the plan.",
        },
      ],
      creatureSlugs: ["garden-eel", "spotted-scorpionfish", "green-moray", "french-angelfish"],
    },
  },
  // Denominator row: Something Special
  // Position: OpenStreetMap node 635942336 (Something Special), within 0.1 km of bonaire.com's coordinates.
  // Gate: ungated Open Water dive, because infobonaire calls it a beginner or novice site and its terrace is run that way; the plan's floor is 18 m and the slope falls away beyond it.
  {
    slug: "something-special-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/something-special-pali-grandi/",
      "https://bonaire.com/en/dive-sites/something-special/",
      "https://www.openstreetmap.org/node/635942336",
      "https://www.duikersgids.nl/en/something-special",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Something Special",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.1613,
      forecastLongitude: -68.284,
      description:
        "Little coral beside the marina entrance, but the rubble and sand hold plenty of fish and rays. Garden eels sit at about 17 m.",
      marineLife: "Rays · garden eels · reef fish",
      marineLifeDescription: "More unusual sightings than at most sites, helped by the marina.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "beginner",
      depthRange: "6–18 m (20–60 ft)",
      maxDepthMeters: 18,
      currentNote:
        "Boats use the marina entrance, so carry an SMB and listen for engines. Current is limited, sometimes strong, according to bonaire.com.",
      divePlan:
        "Enter from the shore, work the sand and rubble no deeper than 18 m (60 ft), and surface well away from the marina entrance.",
      fitTone: "unknown",
      fitNote:
        "Dive the marina side by day only. Easy entry. Current is limited but can be strong, especially near the marina. The reef continues past this plan's 18 m floor.",
      landmarks: [
        {
          name: "Coral nursery",
          kind: "pointOfInterest",
          note: "A Reef Renewal Foundation Bonaire coral nursery.",
        },
      ],
      creatureSlugs: ["garden-eel", "southern-stingray", "spotted-eagle-ray", "french-angelfish"],
    },
  },
  // Denominator row: Calabas Reef
  // Position: OpenStreetMap node 663869423 (Calabas Reef), within 0.4 km of bonaire.com's coordinates.
  // Gate: ungated Open Water dive, because infobonaire calls it a beginner or novice site and its terrace is run that way; the plan's floor is 18 m and the slope falls away beyond it.
  {
    slug: "calabas-reef-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/calabas-reef/",
      "https://bonaire.com/en/dive-sites/calabas-reef/",
      "https://www.openstreetmap.org/node/663869423",
      "https://www.duikersgids.nl/en/calabas-reef",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Calabas Reef",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.1445,
      forecastLongitude: -68.2767,
      description:
        "A resort house reef, a good place for a check-out dive or a dive with a guide. Turtles and rays pass through.",
      marineLife: "Reef fish · turtles · rays",
      marineLifeDescription: "Plenty of fish to meet with a guide.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "beginner",
      depthRange: "6–18 m (20–60 ft)",
      maxDepthMeters: 18,
      divePlan:
        "Enter from the resort shore, work the reef no deeper than 18 m (60 ft), and watch for boats when you surface.",
      fitTone: "welcoming",
      fitNote:
        "A calm check-out dive. Watch for boats when you surface. The drop-off begins at about 15 m, past this plan's 18 m floor.",
      creatureSlugs: ["french-angelfish", "blue-tang", "green-sea-turtle", "southern-stingray"],
    },
  },
  // Denominator row: 18th Palm (Eighteenth Palm)
  // Position: OpenStreetMap node 854130076 (18th Palm), within 0.1 km of bonaire.com's coordinates.
  // Position: OpenStreetMap lists 12.1386, -68.2765 and PADI the same.
  // Gate: ungated Open Water dive, because infobonaire calls it a beginner or novice site and its terrace is run that way; the plan's floor is 18 m and the slope falls away beyond it.
  {
    slug: "eighteen-palms-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/eighteen-palms/",
      "https://bonaire.com/en/dive-sites/eighteenth-palm/",
      "https://www.openstreetmap.org/node/854130076",
      "https://www.padi.com/dive-site/bonaire/18th-palm/",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Eighteen Palms",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.1386,
      forecastLongitude: -68.2766,
      description:
        "In front of the Lieutenant Governor's house, entered from a resort. The reef first splits into a double reef here, and tarpon have been seen sleeping on it by day.",
      marineLife: "Tarpon · southern stingrays · eagle rays",
      marineLifeDescription: "Rays on the sand, and tarpon resting on the reef.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "beginner",
      depthRange: "6–27 m (20–90 ft)",
      maxDepthMeters: 27,
      divePlan:
        "Enter from the resort, work both arms of the double reef no deeper than 18 m (60 ft), and leave the outer reef at about 27 m alone.",
      fitTone: "welcoming",
      fitNote:
        "A calm dive for newer divers. The outer reef at about 27 m lies beyond this plan's 18 m floor.",
      landmarks: [
        {
          name: "Double reef",
          kind: "reefFormation",
          note: "The inner reef by the shore and a second reef across a sand channel, the second at about 27 m.",
        },
      ],
      creatureSlugs: ["tarpon", "southern-stingray", "spotted-eagle-ray", "french-angelfish"],
    },
  },
  // Denominator row: Windsock
  // Position: OpenStreetMap node 663869430 (Windsock), within 0.1 km of bonaire.com's coordinates.
  // Gate: ungated Open Water dive, because infobonaire calls it a beginner or novice site and its terrace is run that way; the plan's floor is 18 m and the slope falls away beyond it.
  {
    slug: "windsock-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/windsock-riba-ruina/",
      "https://bonaire.com/en/dive-sites/windsock-steep/",
      "https://www.openstreetmap.org/node/663869430",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Windsock",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.1336,
      forecastLongitude: -68.2819,
      description:
        "A sandy-shallows site where rays and turtles cruise, with the reef dropping to a wall at about 18 m.",
      marineLife: "Rays · turtles",
      marineLifeDescription: "A beach site for easy dives.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "beginner",
      depthRange: "6–18 m (20–60 ft)",
      maxDepthMeters: 18,
      divePlan:
        "Enter over the rocks, cross the sandy shallows where the rays and turtles rest, no deeper than 18 m (60 ft), and return the same way.",
      fitTone: "welcoming",
      fitNote:
        "Suits snorkelers and novice divers. A wall begins at about 18 m and falls past recreational depth, beyond this plan's 18 m floor. The rocky entry is hard in high waves.",
      creatureSlugs: [
        "southern-stingray",
        "green-sea-turtle",
        "hawksbill-turtle",
        "french-angelfish",
      ],
    },
  },
  // Denominator row: Corporal Meiss (North Belnem)
  // Position: OpenStreetMap node 635881836 (Corporal Meiss), within 0.4 km of bonaire.com's coordinates.
  // Gate: infobonaire calls it easy but bonaire.com calls it for experienced divers with a rocky entry and 40 m depth; the stricter reading wins, so Advanced Open Water with a 30 m floor.
  {
    slug: "corporal-meiss-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/north-belnam/",
      "https://bonaire.com/en/dive-sites/corporal-meiss/",
      "https://www.openstreetmap.org/node/635881836",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Corporal Meiss",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.131,
      forecastLongitude: -68.2848,
      description: "Also called Dick's Place. Large schools of blue tang gather over the reef.",
      marineLife: "Blue tang · reef fish",
      marineLifeDescription: "Blue tangs school over the reef.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "6–30 m (20–100 ft)",
      maxDepthMeters: 30,
      divePlan:
        "Enter over the rocks in calm wind only, work the reef no deeper than 30 m (100 ft), and return along the shallower coral.",
      fitTone: "demanding",
      fitNote:
        "Sources disagree on difficulty, and the rocky entry is dangerous in northeast wind, so it is gated for Advanced Open Water. The reef drops past this plan's 30 m floor.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["blue-tang", "french-angelfish", "queen-parrotfish"],
    },
  },
  // Denominator row: Bachelor's Beach
  // Position: OpenStreetMap node 663869413 (Bachelor's Beach), within 0.1 km of bonaire.com's coordinates.
  // Gate: ungated Open Water dive, because infobonaire calls it a beginner or novice site and its terrace is run that way; the plan's floor is 18 m and the slope falls away beyond it.
  {
    slug: "bachelors-beach-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/bachelors-beach-fondu-di-kalki/",
      "https://bonaire.com/en/dive-sites/bachelors-beach-dive/",
      "https://www.openstreetmap.org/node/663869413",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Bachelor’s Beach",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.1257,
      forecastLongitude: -68.2876,
      description:
        "Seven steps lead to a small beach. A good place for a snorkeler or newer diver to build experience, with turtles and rays passing.",
      marineLife: "Turtles · rays",
      marineLifeDescription: "Keep an eye out for turtles and rays.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "beginner",
      depthRange: "5–20 m (15–65 ft)",
      maxDepthMeters: 20,
      divePlan:
        "Go down the seven steps, work the reef no deeper than 18 m (60 ft), and stay shallow of the edge at 15 to 20 m.",
      fitTone: "welcoming",
      fitNote:
        "Boats cross to Klein Bonaire here, so carry an SMB. The reef edge at 15 to 20 m turns into a wall past this plan's 18 m floor.",
      creatureSlugs: ["green-sea-turtle", "southern-stingray", "french-angelfish", "blue-tang"],
    },
  },
  // Denominator row: Chez Hines
  // Position: Midway between Bachelor’s Beach and Lighthouse Point, its numbered neighbors on the STINAPA map; bonaire.com's pin is within 0.2 km. Good to about 0.5 km.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "chez-hines-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/chez-hines/",
      "https://bonaire.com/en/dive-sites/chez-hines/",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Chez Hines",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.1191,
      forecastLongitude: -68.2932,
      description:
        "Also known as South Belnem. From here south the shore entries get harder, and turtles are seen often.",
      marineLife: "Turtles · reef fish",
      marineLifeDescription: "Turtles are common.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "advanced",
      depthRange: "9–30 m (30–100 ft)",
      maxDepthMeters: 30,
      currentNote: "Limited to strong according to bonaire.com.",
      divePlan:
        "Descend at the mooring, work the reef no deeper than 30 m (100 ft), and check the current with the guide first.",
      fitTone: "demanding",
      fitNote:
        "Reached by boat according to bonaire.com. Current ranges from limited to strong, so check with your guide.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["green-sea-turtle", "hawksbill-turtle", "blue-tang"],
    },
  },
  // Denominator row: Lighthouse Point
  // Position: OpenStreetMap node 663869398 (Lighthouse Point), within 0.1 km of bonaire.com's coordinates.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "lighthouse-point-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/lighthouse-point/",
      "https://bonaire.com/en/dive-sites/lighthouse-point/",
      "https://www.openstreetmap.org/node/663869398",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Lighthouse Point",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.1141,
      forecastLongitude: -68.2953,
      description:
        "A southern site with a sandy bottom and rays in the shallows, used by divers and snorkelers.",
      marineLife: "Rays · reef fish",
      marineLifeDescription: "Rays in the shallows over sand.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "advanced",
      depthRange: "9–30 m (30–100 ft)",
      maxDepthMeters: 30,
      currentNote: "Unpredictable according to bonaire.com.",
      divePlan:
        "Descend at the mooring, work the reef no deeper than 30 m (100 ft), and surface with the boat following your marker.",
      fitTone: "demanding",
      fitNote:
        "For experienced divers; the current can be unpredictable. The reef drops past this plan's 30 m floor.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["southern-stingray", "french-angelfish", "blue-tang", "queen-parrotfish"],
    },
  },
  // Denominator row: Punt Vierkant
  // Position: OpenStreetMap node 663869399 (Punt Vierkant), within 0.1 km of bonaire.com's coordinates.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "punt-vierkant-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/punt-vierkant/",
      "https://bonaire.com/en/dive-sites/punt-vierkant/",
      "https://www.openstreetmap.org/node/663869399",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Punt Vierkant",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.1085,
      forecastLongitude: -68.2919,
      description:
        "The name means square point. The double reef starts here, with schools of fish over both reefs.",
      marineLife: "Schooling fish · reef fish",
      marineLifeDescription: "Schooling fish over the first of the double reefs.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "8–30 m (25–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "Usually minimal on the inner reef and stronger on the outer reef, according to bonaire.com.",
      divePlan:
        "Descend at the mooring, work the inner reef first, cross to the outer reef only if the current allows, no deeper than 30 m (100 ft).",
      fitTone: "demanding",
      fitNote: "Watch your depth on the way to the outer reef, where current can be stronger.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["blue-tang", "creole-wrasse", "french-angelfish", "brown-chromis"],
    },
  },
  // Denominator row: The Lake
  // Position: OpenStreetMap node 663869417 (The Lake), within 0.1 km of bonaire.com's coordinates.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "the-lake-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/the-lake/",
      "https://bonaire.com/en/dive-sites/the-lake/",
      "https://www.openstreetmap.org/node/663869417",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "The Lake",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.1068,
      forecastLongitude: -68.2904,
      description:
        "The second of the double reef dives. Gorgonians fill the shallows and fish circle over the reef.",
      marineLife: "Gorgonians · schooling reef fish",
      marineLifeDescription: "Gorgonians in the shallows, schools circling over them.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "5–30 m (15–100 ft)",
      maxDepthMeters: 30,
      currentNote: "Limited according to bonaire.com.",
      divePlan:
        "Dive the inner reef, cross the sand to the outer reef, no deeper than 30 m (100 ft), and return the same way.",
      fitTone: "demanding",
      fitNote: "A double-reef site for divers with Advanced Open Water.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["encrusting-gorgonian", "blue-tang", "creole-wrasse", "french-angelfish"],
    },
  },
  // Denominator row: Hilma Hooker
  // Position: OpenStreetMap node 635881808 (Hilma Hooker), within 0.2 km of bonaire.com's coordinates.
  // Gate: sources give the deck at 18 m, the mast at 30 m, the deepest part at 34 m (bonaire.com) and a 40 m maximum (PADI); the deeper figure is taken, so Advanced Open Water with the Deep specialty.
  {
    slug: "hilma-hooker-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/the-wreck-of-the-hilma-hooker/",
      "https://bonaire.com/en/dive-sites/hilma-hooker/",
      "https://www.padi.com/dive-site/bonaire/hilma-hooker/",
      "https://www.openstreetmap.org/node/635881808",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Hilma Hooker",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.1038,
      forecastLongitude: -68.2901,
      description:
        "A 72 m freighter sunk on 12 September 1984, lying on her side on sand just off the reef near the start of the double reef. Her top is at about 18 m and the mast reaches about 30 m, with the deepest part near 40 m.",
      marineLife: "Tarpon · barracuda · reef fish · sponges",
      marineLifeDescription:
        "Coral and sponge growth on the hull shows how an artificial reef develops.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "advanced",
      depthRange: "18–40 m (60–130 ft)",
      maxDepthMeters: 40,
      currentNote:
        "Moderate to strong according to bonaire.com. Carry an SMB, because boats work this area.",
      divePlan:
        "Usually dived from a boat on one of the three yellow moorings. Drop to the wreck, circle the hull outside and keep to 40 m (130 ft) at most.",
      fitTone: "demanding",
      fitNote:
        "A deep wreck for divers with Advanced Open Water and the Deep specialty. Stay outside the hull.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "Hilma Hooker wreck",
          kind: "wreckFeature",
          note: "The 1984 freighter: top of the ship at about 18 m, mast to about 30 m, deepest part near 40 m.",
        },
      ],
      creatureSlugs: [
        "tarpon",
        "great-barracuda",
        "french-angelfish",
        "queen-parrotfish",
        "orange-elephant-ear-sponge",
      ],
    },
  },
  // Denominator row: Angel City
  // Position: OpenStreetMap node 663869415 (Angel City), within 0.1 km of bonaire.com's coordinates.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "angel-city-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/angel-city/",
      "https://bonaire.com/en/dive-sites/angel-city/",
      "https://www.openstreetmap.org/node/663869415",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Angel City",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.1032,
      forecastLongitude: -68.2876,
      description:
        "A double reef dive with a sand channel between the two reefs, where garden eels and stingrays live. Angelfish and parrotfish come close.",
      marineLife: "French angelfish · parrotfish · garden eels · stingrays",
      marineLifeDescription: "The sand channel is home to garden eels and rays.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "6–30 m (20–100 ft)",
      maxDepthMeters: 30,
      currentNote: "Mild to moderate along the outer drop-off, according to bonaire.com.",
      divePlan:
        "Dive the inner reef, cross the sand channel to the outer reef, no deeper than 30 m (100 ft), and navigate by compass.",
      fitTone: "demanding",
      fitNote: "Shore divers can lose their way on the double reef, so navigate by compass.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["french-angelfish", "garden-eel", "southern-stingray", "queen-parrotfish"],
    },
  },
  // Denominator row: Alice in Wonderland
  // Position: OpenStreetMap node 635881804 (Alice in Wonderland), within 0.1 km of bonaire.com's coordinates.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "alice-in-wonderland-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/alice-in-wonderland/",
      "https://bonaire.com/en/dive-sites/alice-in-wonderland/",
      "https://www.openstreetmap.org/node/635881804",
      "https://www.padi.com/dive-site/bonaire/alice-in-wonderland/",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Alice in Wonderland",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.0996,
      forecastLongitude: -68.2857,
      description:
        "A good dive for seeing the double reef. A mooring buoy sits about 40 m offshore.",
      marineLife: "Reef fish · hard corals",
      marineLifeDescription: "The crossing from inner to outer reef is the feature.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "9–30 m (30–100 ft)",
      maxDepthMeters: 30,
      currentNote: "Minimal to moderate according to bonaire.com.",
      divePlan:
        "Descend at the mooring, cross the sand between the reefs at 24 to 30 m with the gauge in view, and stay no deeper than 30 m (100 ft).",
      fitTone: "demanding",
      fitNote: "Check your depth gauge when crossing the sand between the reefs, at 24 to 30 m.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["french-angelfish", "queen-parrotfish", "blue-tang", "boulder-star-coral"],
    },
  },
  // Denominator row: Aquarius
  // Position: OpenStreetMap node 663869409 (Aquarius), within 0.1 km of bonaire.com's coordinates.
  // Gate: ungated Open Water dive, because infobonaire calls it a beginner or novice site and its terrace is run that way; the plan's floor is 18 m and the slope falls away beyond it.
  {
    slug: "aquarius-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/aquarius/",
      "https://bonaire.com/en/dive-sites/aquarius-dive/",
      "https://www.openstreetmap.org/node/663869409",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Aquarius",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.0983,
      forecastLongitude: -68.2852,
      description: "An easy shore dive over a sandy bottom to a first reef, with schools of fish.",
      marineLife: "Schooling fish · reef fish",
      marineLifeDescription: "Schooling fish over sand.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "beginner",
      depthRange: "6–18 m (20–60 ft)",
      maxDepthMeters: 18,
      divePlan:
        "Enter over the rocks, cross the sand to the first reef, and stay on it, no deeper than 18 m (60 ft).",
      fitTone: "welcoming",
      fitNote:
        "Easy for beginners. A steeper second reef lies deeper than this plan's 18 m floor, so keep to the first. Rocks at the entry are slippery.",
      creatureSlugs: ["blue-tang", "creole-wrasse", "french-angelfish", "brown-chromis"],
    },
  },
  // Denominator row: Larry's Lair
  // Position: OpenStreetMap node 663869410 (Larry's Lair), within 0.1 km of bonaire.com's coordinates.
  // Gate: ungated Open Water dive, because infobonaire calls it a beginner or novice site and its terrace is run that way; the plan's floor is 18 m and the slope falls away beyond it.
  {
    slug: "larrys-lair-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/larrys-lair/",
      "https://bonaire.com/en/dive-sites/larrys-lair/",
      "https://www.openstreetmap.org/node/663869410",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Larry’s Lair",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.0953,
      forecastLongitude: -68.2845,
      description: "An easy site with sandy shallows where rays and turtles rest.",
      marineLife: "Rays · turtles",
      marineLifeDescription: "Sandy shallows with rays and turtles.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "beginner",
      depthRange: "9–18 m (30–60 ft)",
      maxDepthMeters: 18,
      divePlan:
        "Enter from shore, navigate by compass to the first reef, and stay on it, no deeper than 18 m (60 ft).",
      fitTone: "welcoming",
      fitNote:
        "Easy. No yellow mooring buoy marks it, so navigate by compass. The second reef is deeper than this plan's 18 m floor.",
      creatureSlugs: [
        "southern-stingray",
        "green-sea-turtle",
        "hawksbill-turtle",
        "french-angelfish",
      ],
    },
  },
  // Denominator row: Jeannie's Glory
  // Position: OpenStreetMap node 663869412 (Jeannie's Glory), within 0.2 km of bonaire.com's coordinates.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "jeannies-glory-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/jeannies-glory/",
      "https://bonaire.com/en/dive-sites/jeannies-glory/",
      "https://www.openstreetmap.org/node/663869412",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Jeannie’s Glory",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.0866,
      forecastLongitude: -68.2831,
      description:
        "Soft coral in the shallows and a sand floor where rays rest. Turtles are common along these southern sites.",
      marineLife: "Rays · turtles · soft corals",
      marineLifeDescription: "Soft corals in the shallows over a sandy floor.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "9–30 m (30–100 ft)",
      maxDepthMeters: 30,
      divePlan:
        "Enter from shore, work the soft coral and sand, no deeper than 30 m (100 ft), and return along the shallower reef.",
      fitTone: "demanding",
      fitNote: "A shore dive for divers with Advanced Open Water.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "southern-stingray",
        "green-sea-turtle",
        "hawksbill-turtle",
        "common-sea-fan",
      ],
    },
  },
  // Denominator row: Salt Pier
  // Position: OpenStreetMap node 663869401 (Salt Pier), within 0.2 km of bonaire.com's coordinates.
  // Gate: ungated; the sources give a shallow depth range with no drop-off in it.
  {
    slug: "salt-pier-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/salt-pier-waf-di-salina/",
      "https://bonaire.com/en/dive-sites/salt-pier-dive/",
      "https://www.openstreetmap.org/node/663869401",
      "https://www.padi.com/dive-site/bonaire/salt-pier/",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Salt Pier",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.0835,
      forecastLongitude: -68.2824,
      description:
        "An easy entry and good light for photography. The pier pillars are crusted with sponges and coral, and fish shelter in the shade under the loading pier.",
      marineLife: "Schooling fish · sponges · pillar coral growth",
      marineLifeDescription: "Pillars crusted in sponge and coral.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "5–18 m (15–60 ft)",
      maxDepthMeters: 18,
      currentNote:
        "Do not dive when a ship is at the pier. Current can be limited to strong, and it pushes into the pillars, which have sharp edges.",
      divePlan:
        "Enter from shore, work the reef no deeper than 18 m (60 ft), keep well clear of the pillars, and leave if a ship comes to the pier.",
      fitTone: "demanding",
      fitNote:
        "A pier dive with a strong-current risk and sharp pillar edges. Do not dive when a ship is alongside.",
      // Sources give limited to strong current into the pier pillars, and a ban on diving when a ship is at the pier, so
      // the gate is Advanced Open Water even though the depth is 18 m.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Salt pier pillars",
          kind: "pointOfInterest",
          note: "The pier's pillars, crusted with sponges and coral.",
        },
      ],
      creatureSlugs: ["blue-tang", "french-angelfish", "queen-parrotfish", "stovepipe-sponge"],
    },
  },
  // Denominator row: Salt City (Saliña Abou)
  // Position: OpenStreetMap node 663869403 (Salt City), within 0.3 km of bonaire.com's coordinates.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "salt-city-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/salt-city/",
      "https://bonaire.com/en/dive-sites/salt-city/",
      "https://www.openstreetmap.org/node/663869403",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Salt City",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.0796,
      forecastLongitude: -68.2811,
      description: "Part of the double reef system, with good chances of turtles and eagle rays.",
      marineLife: "Turtles · eagle rays",
      marineLifeDescription: "Turtles and eagle rays are likely.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "9–30 m (30–100 ft)",
      maxDepthMeters: 30,
      divePlan:
        "Enter from shore, work the double reef, no deeper than 30 m (100 ft), and navigate by compass.",
      fitTone: "demanding",
      fitNote: "A shore dive for divers with Advanced Open Water.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["green-sea-turtle", "spotted-eagle-ray", "hawksbill-turtle", "blue-tang"],
    },
  },
  // Denominator row: Invisibles
  // Position: OpenStreetMap node 663869402 (Invisibles), within 0.1 km of bonaire.com's coordinates.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "invisibles-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/invisibles/",
      "https://bonaire.com/en/dive-sites/invisibles/",
      "https://www.openstreetmap.org/node/663869402",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Invisibles",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.0775,
      forecastLongitude: -68.2806,
      description:
        "One of the few places to see garden eels in shallow water, near the end of the double reef sites.",
      marineLife: "Garden eels · reef fish",
      marineLifeDescription: "Garden eels in shallow water.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "6–30 m (20–100 ft)",
      maxDepthMeters: 30,
      divePlan:
        "Enter from shore, find the garden eels in the shallows, work the reef no deeper than 30 m (100 ft), and return the same way.",
      fitTone: "demanding",
      fitNote: "A shore dive for divers with Advanced Open Water.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["garden-eel", "blue-tang", "french-angelfish"],
    },
  },
  // Denominator row: Tori's Reef
  // Position: OpenStreetMap node 663869405 (Tori's Reef), within 0.1 km of bonaire.com's coordinates.
  // Position: OpenStreetMap lists 12.0702, -68.2805 and PADI 12.0706, -68.2807, which agree; bonaire.com's page pin is wrong.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "toris-reef-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/toris-reef/",
      "https://bonaire.com/en/dive-sites/toris-reef/",
      "https://www.openstreetmap.org/node/663869405",
      "https://www.padi.com/dive-site/bonaire/toris-reef/",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Tori’s Reef",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.0709,
      forecastLongitude: -68.2807,
      description:
        "Opposite the salt works outflow, entered through the channel that runs under the road. Strands of elkhorn coral grow on sand, and fire coral grows near the exit route.",
      marineLife: "Elkhorn coral · eels · reef fish",
      marineLifeDescription: "Elkhorn coral on sand, and rare fish and eels in the fire coral.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "6–30 m (20–100 ft)",
      maxDepthMeters: 30,
      currentNote: "Variable; strong when the outflow doors are open.",
      divePlan:
        "Enter through the channel only with the outflow doors shut, work the elkhorn and the reef no deeper than 30 m (100 ft), and avoid the fire coral on the way out.",
      fitTone: "demanding",
      fitNote:
        "Check that the outflow doors are shut before you enter, and watch for fire coral on the way out.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["elkhorn-coral", "fire-coral", "green-moray", "blue-tang"],
    },
  },
  // Denominator row: Pink Beach (Kabayé)
  // Position: OpenStreetMap node 663869404 (Pink Beach), within 0.1 km of bonaire.com's coordinates.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "pink-beach-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/pink-beach/",
      "https://bonaire.com/en/dive-sites/pink-beach-dive/",
      "https://www.openstreetmap.org/node/663869404",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Pink Beach",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.0628,
      forecastLongitude: -68.2823,
      description:
        "Off one of Bonaire's best-known beaches, where stingrays and bonefish forage on the sandy shallows.",
      marineLife: "Stingrays · bonefish",
      marineLifeDescription: "Rays along the shallow sand.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "advanced",
      depthRange: "8–30 m (25–100 ft)",
      maxDepthMeters: 30,
      currentNote: "Strong in places, according to infobonaire.",
      divePlan:
        "Enter from the beach, work the sand and the reef edge no deeper than 30 m (100 ft), and exit early if the current builds.",
      fitTone: "demanding",
      fitNote: "The current can be strong, so this is for confident divers.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["southern-stingray", "french-angelfish", "blue-tang", "bonefish"],
    },
  },
  // Denominator row: White Slave
  // Position: OpenStreetMap node 663869408 (White Slave), within 0.1 km of bonaire.com's coordinates.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "white-slave-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/white-slave/",
      "https://bonaire.com/en/dive-sites/white-slave/",
      "https://www.openstreetmap.org/node/663869408",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "White Slave",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.0576,
      forecastLongitude: -68.2813,
      description:
        "Named for the white pinnacle and slave huts ashore opposite the mooring. Turtles are almost always around.",
      marineLife: "Turtles · reef fish",
      marineLifeDescription: "Turtles are nearly always here.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "advanced",
      depthRange: "6–30 m (20–100 ft)",
      maxDepthMeters: 30,
      currentNote: "Moderate to strong according to bonaire.com.",
      divePlan:
        "Descend at the mooring, work the reef no deeper than 30 m (100 ft), and check the current with the guide first.",
      fitTone: "demanding",
      fitNote: "A southern site that can carry a current; confirm it with your guide.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "White pinnacle and slave huts",
          kind: "pointOfInterest",
          note: "On shore opposite the mooring.",
        },
      ],
      creatureSlugs: ["green-sea-turtle", "hawksbill-turtle", "blue-tang"],
    },
  },
  // Denominator row: Margate Bay
  // Position: OpenStreetMap node 663869400 (Margate Bay), within 0.1 km of bonaire.com's coordinates.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "margate-bay-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/margate-bay/",
      "https://bonaire.com/en/dive-sites/margate-bay-dive/",
      "https://www.openstreetmap.org/node/663869400",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Margate Bay",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.0512,
      forecastLongitude: -68.2723,
      description:
        "Black margates and other snappers sleep among the gorgonians along the drop-off, and turtles are common.",
      marineLife: "Black margate · snappers · turtles",
      marineLifeDescription: "Margates and snappers rest among the gorgonians.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "6–30 m (20–100 ft)",
      maxDepthMeters: 30,
      divePlan:
        "Descend at the mooring, follow the drop-off no deeper than 30 m (100 ft), and look for the margates among the gorgonians.",
      fitTone: "demanding",
      fitNote: "A drop-off site; hold the plan's floor.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "black-margate",
        "schoolmaster-snapper",
        "green-sea-turtle",
        "encrusting-gorgonian",
      ],
    },
  },
  // Denominator row: Red Beryl
  // Position: OpenStreetMap node 663869407 (Red Beryl), within 0.1 km of bonaire.com's coordinates.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "red-beryl-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/red-beryl/",
      "https://bonaire.com/en/dive-sites/red-beryl/",
      "https://www.openstreetmap.org/node/663869407",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Red Beryl",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.0466,
      forecastLongitude: -68.2685,
      description: "Turtles and rays are regular, and schools of fish feed near the surface.",
      marineLife: "Turtles · rays · schooling fish",
      marineLifeDescription: "Turtles and rays on the reef, schools nearer the surface.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "9–30 m (30–100 ft)",
      maxDepthMeters: 30,
      divePlan:
        "Enter from shore, follow the reef edge no deeper than 30 m (100 ft), and keep your hands off the fire coral.",
      fitTone: "demanding",
      fitNote:
        "The reef edge drops quickly; hold this plan's 30 m floor. Fire coral grows here, so keep your hands off the reef.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["green-sea-turtle", "southern-stingray", "blue-tang"],
    },
  },
  // Denominator row: Atlantis
  // Position: OpenStreetMap node 663869406 (Atlantis), within 0.1 km of bonaire.com's coordinates.
  // Position: OpenStreetMap lists 12.0449, -68.2675 and PADI the same area; bonaire.com's page pin is wrong.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "atlantis-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/atlantis/",
      "https://bonaire.com/en/dive-sites/atlantis/",
      "https://www.openstreetmap.org/node/663869406",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Atlantis",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.0449,
      forecastLongitude: -68.2675,
      description:
        "Hard and soft corals line the reef edge, with turtles and bigger fish. The beach is also a kiteboarding spot.",
      marineLife: "Turtles · larger fish · hard and soft corals",
      marineLifeDescription: "Corals along the reef edge and bigger fish passing.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "advanced",
      depthRange: "9–30 m (30–100 ft)",
      maxDepthMeters: 30,
      currentNote: "Moderate to strong according to bonaire.com, mostly at the drop-off.",
      divePlan:
        "Enter away from the kiteboarders, follow the reef edge no deeper than 30 m (100 ft), and carry an SMB.",
      fitTone: "demanding",
      fitNote:
        "Best skipped on windy days because of the kiteboarders. Enter and exit away from them, stay off the surface in their area and carry an SMB.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "green-sea-turtle",
        "hawksbill-turtle",
        "boulder-star-coral",
        "common-sea-fan",
      ],
    },
  },
  // Denominator row: Vista Blue
  // Position: OpenStreetMap node 663869396 (Vista Blue), within 0.1 km of bonaire.com's coordinates.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "vista-blue-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/vista-blue/",
      "https://bonaire.com/en/dive-sites/vista-blue/",
      "https://www.openstreetmap.org/node/663869396",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Vista Blue",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.0388,
      forecastLongitude: -68.2649,
      description:
        "A reef much like its neighbors, where the current can change or build during the dive.",
      marineLife: "Blue tang · French angelfish · queen parrotfish",
      marineLifeDescription: "A southern reef where the current changes.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "advanced",
      depthRange: "8–30 m (25–100 ft)",
      maxDepthMeters: 30,
      currentNote: "Can change or increase during the dive, according to infobonaire.",
      divePlan:
        "Enter from shore, work the reef no deeper than 30 m (100 ft), and turn early if the current builds.",
      fitTone: "demanding",
      fitNote: "Take care with the current. Kiteboarders use the water nearby, so carry an SMB.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["blue-tang", "french-angelfish", "queen-parrotfish"],
    },
  },
  // Denominator row: Sweet Dreams
  // Position: OpenStreetMap node 663869395 (Sweet Dreams), within 0.1 km of bonaire.com's coordinates.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "sweet-dreams-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/sweet-dreams/",
      "https://bonaire.com/en/dive-sites/sweet-dreams/",
      "https://www.openstreetmap.org/node/663869395",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Sweet Dreams",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.0349,
      forecastLongitude: -68.2627,
      description:
        "Many kinds of gorgonian in the shallows, and large sponges and coral heads against pale sand deeper down.",
      marineLife: "Gorgonians · sponges · coral heads",
      marineLifeDescription: "Large sponges and coral heads against pale sand.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "advanced",
      depthRange: "9–30 m (30–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "This area can challenge even the strongest swimmers, according to infobonaire. If the current builds, abort the dive and exit at once.",
      divePlan:
        "Enter from shore, work the gorgonians and the deeper sand no deeper than 30 m (100 ft), and exit at once if the current builds.",
      fitTone: "demanding",
      fitNote:
        "For strong swimmers only. Abort and exit at the first sign of a building current. For divers with recent drift experience; check at the desk.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "encrusting-gorgonian",
        "giant-barrel-sponge",
        "boulder-star-coral",
        "blue-tang",
      ],
    },
  },
  // Denominator row: Red Slave (Peleké)
  // Position: OpenStreetMap node 663869397 (Red Slave), within 0.1 km of bonaire.com's coordinates.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 25 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "red-slave-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/red-slave/",
      "https://bonaire.com/en/dive-sites/red-slave/",
      "https://www.openstreetmap.org/node/663869397",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Red Slave",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.0261,
      forecastLongitude: -68.2515,
      description:
        "Beside the second set of slave huts. Horse-eye jacks and turtles are common, and baitfish schools offshore draw predators.",
      marineLife: "Horse-eye jacks · turtles · baitfish",
      marineLifeDescription: "Jacks and turtles, with baitfish offshore.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "advanced",
      depthRange: "6–25 m (20–80 ft)",
      maxDepthMeters: 25,
      currentNote: "Unpredictable and strong according to bonaire.com.",
      divePlan:
        "Enter from shore, work the reef no deeper than 25 m (80 ft), and exit if the current changes direction.",
      fitTone: "demanding",
      fitNote:
        "For experienced divers only; the current can change direction within seconds. For divers with recent drift experience; check at the desk.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Slave huts",
          kind: "pointOfInterest",
          note: "The second set of slave huts, adjacent to the site.",
        },
      ],
      creatureSlugs: ["horse-eye-jack", "green-sea-turtle", "hawksbill-turtle", "bar-jack"],
    },
  },
  // Denominator row: Willemstoren Lighthouse
  // Position: OpenStreetMap node 663869394 (Willemstoren Lighthouse), within 0.1 km of bonaire.com's coordinates.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 25 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "willemstoren-lighthouse-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/willemstoren-lighthouse/",
      "https://bonaire.com/en/dive-sites/willemstoren-lighthouse-dive/",
      "https://www.openstreetmap.org/node/663869394",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Willemstoren Lighthouse",
      locationName: "Bonaire National Marine Park",
      forecastLatitude: 12.0277,
      forecastLongitude: -68.2368,
      description:
        "At the southern tip, with schooling fish, lobsters under the corals and the odd turtle or tarpon. Strong current can make the shore entry rough.",
      marineLife: "Schooling fish · lobsters · turtles · tarpon",
      marineLifeDescription: "Lobsters hide under the corals.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "advanced",
      depthRange: "6–25 m (20–80 ft)",
      maxDepthMeters: 25,
      currentNote: "Strong and unpredictable according to the sources.",
      divePlan:
        "Enter from shore only when the water is calm, work the reef no deeper than 25 m (80 ft), and exit before the current builds.",
      fitTone: "demanding",
      fitNote:
        "For advanced divers only, because of the current and the rough entry. For divers with recent drift experience; check at the desk.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Willemstoren Lighthouse",
          kind: "navigationMark",
          note: "The lighthouse at the southern tip of the island.",
        },
      ],
      creatureSlugs: ["spiny-lobster", "tarpon", "green-sea-turtle", "blue-tang"],
    },
  },
  // Denominator row: No Name (Playita)
  // Position: bonaire.com lists 12.1687, -68.3052, in front of No Name Beach; it lies on the OpenStreetMap shoreline and fits the STINAPA map's letter order.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "no-name-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/no-name-at-klein-bonaire/",
      "https://bonaire.com/en/dive-sites/no-name-klein-bonaire/",
      "https://stinapabonaire.org/wp-content/uploads/2026/04/STINAPA-BNMP-folder-pag.2-scaled.jpg",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "No Name",
      locationName: "Klein Bonaire, Bonaire National Marine Park",
      forecastLatitude: 12.1687,
      forecastLongitude: -68.3052,
      description:
        "Off No Name Beach, one of the most visited sites on Klein. Coral heads are scarce in the shallows, but the sand holds yellowhead jawfish and sailfin blennies.",
      marineLife: "Yellowhead jawfish · sailfin blennies",
      marineLifeDescription: "Jawfish pop out of the rubble in the sand.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "9–30 m (30–100 ft)",
      maxDepthMeters: 30,
      divePlan:
        "Descend at the mooring, work the sandy shallows and the slope no deeper than 30 m (100 ft), and finish near the beach.",
      fitTone: "demanding",
      fitNote:
        "A boat dive; water taxis land day visitors on the beach. The east side picks up wind and swell. Boats use the Klein Bonaire channel, so carry an SMB.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["yellowhead-jawfish", "sailfin-blenny", "french-angelfish", "sand-diver"],
    },
  },
  // Denominator row: Ebo's Reef
  // Position: Placed by its letter on the STINAPA map, which runs clockwise round the island, interpolated along the OpenStreetMap shoreline between sites whose positions are confirmed; good to about 0.5 km, so a shop should re-pin it.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "ebos-reef-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/ebos-reef-at-klein-bonaire/",
      "https://bonaire.com/en/dive-sites/ebos-reef/",
      "https://stinapabonaire.org/wp-content/uploads/2026/04/STINAPA-BNMP-folder-pag.2-scaled.jpg",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Ebo’s Reef",
      locationName: "Klein Bonaire, Bonaire National Marine Park",
      forecastLatitude: 12.1675,
      forecastLongitude: -68.3009,
      description:
        "Named for Ebo Domacasse, a pioneer of Bonaire diving. Giant orange elephant ear sponges, often topped with black crinoids, and big lavender stovepipe sponges.",
      marineLife: "Elephant ear sponges · crinoids · stovepipe sponges",
      marineLifeDescription: "A good wide-angle site with large sponges.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "12–40 m (40–130 ft)",
      maxDepthMeters: 40,
      currentNote:
        "The swim across blue water from the mooring is short but has no reference. The mooring barrel lies at about 43 m, so leave the line at the reef.",
      divePlan:
        "Leave the mooring line at the reef, swim the short stretch of blue water, and work the sponges no deeper than 30 m (100 ft). Never follow the line down to the barrel at 43 m.",
      fitTone: "demanding",
      fitNote:
        "The mooring barrel lies at about 43 m, deeper than the reef, so the plan's floor is yours to hold. Expect two short blue-water swims. Stay out of caves and overhangs.",
      // infobonaire gives the mooring barrel at 140 ft (43 m) and the reef at 12–30 m; bonaire.com gives 25 m. The barrel
      // at 43 m is capped at the 40 m recreational limit, so the gate is Advanced Open Water plus Deep. The plan holds a 30 m
      // floor and keeps divers off the line below the reef.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "orange-elephant-ear-sponge",
        "stovepipe-sponge",
        "golden-crinoid",
        "blue-tang",
      ],
    },
  },
  // Denominator row: Jerry's Reef (Jerry's Sponges)
  // Position: Placed by its letter on the STINAPA map, which runs clockwise round the island, interpolated along the OpenStreetMap shoreline between sites whose positions are confirmed; good to about 0.5 km, so a shop should re-pin it.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "jerrys-reef-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/jerrys-sponges-also-known-as-jerrys-reef-at-klein-bonaire/",
      "https://bonaire.com/en/dive-sites/jerrys-reef/",
      "https://stinapabonaire.org/wp-content/uploads/2026/04/STINAPA-BNMP-folder-pag.2-scaled.jpg",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Jerry’s Reef",
      locationName: "Klein Bonaire, Bonaire National Marine Park",
      forecastLatitude: 12.1649,
      forecastLongitude: -68.2972,
      description:
        "Known for turtles and rays, with crinoids, elephant ear sponges and fern-like black coral. The mooring sits in deep water, and no source gives its depth.",
      marineLife: "Turtles · eagle rays · stingrays · black coral",
      marineLifeDescription: "Rays and turtles, with sponge and black coral gardens.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "9–35 m (30–115 ft)",
      maxDepthMeters: 35,
      divePlan:
        "Leave the mooring line at the reef and do not follow it into deep water. Work the reef no deeper than 30 m (100 ft).",
      fitTone: "demanding",
      fitNote:
        "The mooring depth is not documented, so the plan's floor is yours to hold. Leave the line at the reef.",
      // infobonaire gives the reef at 9–30 m and says the mooring is in deep water without a figure; bonaire.com lists 35 m in
      // its text and 25 m in its header. The mooring depth could not be established, so the range takes the deeper 35 m figure
      // and the gate is Advanced Open Water plus Deep. The plan holds a 30 m floor and keeps divers off the line below the reef.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "green-sea-turtle",
        "spotted-eagle-ray",
        "southern-stingray",
        "black-coral",
        "orange-elephant-ear-sponge",
      ],
    },
  },
  // Denominator row: Just a Nice Dive
  // Position: Placed by its letter on the STINAPA map, which runs clockwise round the island, interpolated along the OpenStreetMap shoreline between sites whose positions are confirmed; good to about 0.5 km, so a shop should re-pin it.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "just-a-nice-dive-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/just-a-nice-dive-at-klein-bonaire/",
      "https://bonaire.com/en/dive-sites/just-a-nice-dive/",
      "https://stinapabonaire.org/wp-content/uploads/2026/04/STINAPA-BNMP-folder-pag.2-scaled.jpg",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Just a Nice Dive",
      locationName: "Klein Bonaire, Bonaire National Marine Park",
      forecastLatitude: 12.1615,
      forecastLongitude: -68.2943,
      description:
        "Yellow pencil coral and sheet corals are plentiful, with schooling fish at the top of the reef and solitary fish such as ocean triggerfish.",
      marineLife: "Pencil coral · ocean triggerfish · schooling fish",
      marineLifeDescription: "Pencil and leaf coral and schools above the reef.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "6–30 m (20–100 ft)",
      maxDepthMeters: 30,
      divePlan:
        "Descend at the mooring, work the reef no deeper than 30 m (100 ft), and finish in the schooling fish at the top.",
      fitTone: "demanding",
      fitNote: "A boat dive. Boats use the Klein Bonaire channel, so carry an SMB.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["yellow-pencil-coral", "ocean-triggerfish", "blue-tang", "french-angelfish"],
    },
  },
  // Denominator row: Nearest Point (Piedra Kolet)
  // Position: Klein Bonaire site: bonaire.com's pin lies on the OpenStreetMap shoreline and fits the STINAPA map's letter order.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "nearest-point-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/nearest-point-at-klein-bonaire/",
      "https://bonaire.com/en/dive-sites/nearest-point/",
      "https://stinapabonaire.org/wp-content/uploads/2026/04/STINAPA-BNMP-folder-pag.2-scaled.jpg",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Nearest Point",
      locationName: "Klein Bonaire, Bonaire National Marine Park",
      forecastLatitude: 12.1538,
      forecastLongitude: -68.2931,
      description:
        "The point of Klein closest to Bonaire. A deep mooring and a short swim reach healthy coral on pale sand, with purple sea fans, black coral and large tube sponges at depth.",
      marineLife: "Sea fans · mountain coral · tube sponges · black coral",
      marineLifeDescription: "Healthy coral on pale sand, with sea fans and tube sponges.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "6–40 m (20–130 ft)",
      maxDepthMeters: 40,
      divePlan:
        "Leave the deep mooring at the reef, take the short swim to the coral, and work it no deeper than 30 m (100 ft).",
      fitTone: "demanding",
      fitNote:
        "Best dived in the morning, when the wind is lightest. The mooring depth is not documented, so hold the plan's floor. Boats use the Klein Bonaire channel, so carry an SMB.",
      // infobonaire gives 6–30 m and a deep mooring without a figure; bonaire.com lists 10–40 m and experienced divers
      // only. The mooring depth could not be established, so the range takes the deeper 40 m figure and the gate is Advanced
      // Open Water plus Deep. The plan holds a 30 m floor and keeps divers off the line below the reef.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "common-sea-fan",
        "mountainous-star-coral",
        "black-coral",
        "yellow-tube-sponge",
      ],
    },
  },
  // Denominator row: Bonaventure
  // Position: Klein Bonaire site: bonaire.com's pin lies on the OpenStreetMap shoreline and fits the STINAPA map's letter order.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "bonaventure-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/bonaventure-at-klein-bonaire/",
      "https://bonaire.com/en/dive-sites/bonaventure/",
      "https://stinapabonaire.org/wp-content/uploads/2026/04/STINAPA-BNMP-folder-pag.2-scaled.jpg",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Bonaventure",
      locationName: "Klein Bonaire, Bonaire National Marine Park",
      forecastLatitude: 12.1454,
      forecastLongitude: -68.308,
      description:
        "Star coral pagodas and gorgonians in the shallows, often with a seahorse among them. Angelfish and black durgons follow divers along the reef.",
      marineLife: "Seahorses · black durgons · angelfish",
      marineLifeDescription: "Seahorses in the gorgonians.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "6–30 m (20–100 ft)",
      maxDepthMeters: 30,
      currentNote: "Mild according to bonaire.com.",
      divePlan:
        "Descend at the mooring, work the star coral pagodas and the slope no deeper than 30 m (100 ft), and finish in the shallows.",
      fitTone: "demanding",
      fitNote: "A boat dive; bonaire.com describes a mild current.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "longsnout-seahorse",
        "black-durgon",
        "french-angelfish",
        "boulder-star-coral",
      ],
    },
  },
  // Denominator row: Monte's Divi (Monte's Divi Tree)
  // Position: Placed by its letter on the STINAPA map, which runs clockwise round the island, interpolated along the OpenStreetMap shoreline between sites whose positions are confirmed; good to about 0.5 km, so a shop should re-pin it.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "montes-divi-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/montes-divi/",
      "https://bonaire.com/en/dive-sites/montes-divi/",
      "https://stinapabonaire.org/wp-content/uploads/2026/04/STINAPA-BNMP-folder-pag.2-scaled.jpg",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Monte’s Divi",
      locationName: "Klein Bonaire, Bonaire National Marine Park",
      forecastLatitude: 12.1468,
      forecastLongitude: -68.3092,
      description:
        "A good chance of a seahorse, with big stands of staghorn coral in the shallows. A lone divi-divi tree stands on shore opposite the mooring.",
      marineLife: "Seahorses · staghorn coral",
      marineLifeDescription: "Staghorn stands in the shallows.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "5–30 m (15–100 ft)",
      maxDepthMeters: 30,
      divePlan:
        "Descend at the mooring, look for seahorses in the staghorn shallows, and work the slope no deeper than 30 m (100 ft).",
      fitTone: "demanding",
      fitNote: "A boat dive.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Divi-divi tree",
          kind: "pointOfInterest",
          note: "A lone tree on shore directly opposite the mooring.",
        },
      ],
      creatureSlugs: ["longsnout-seahorse", "staghorn-coral", "french-angelfish", "blue-tang"],
    },
  },
  // Denominator row: Rock Pile
  // Position: Placed by its letter on the STINAPA map, which runs clockwise round the island, interpolated along the OpenStreetMap shoreline between sites whose positions are confirmed; good to about 0.5 km, so a shop should re-pin it.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  // infobonaire prints the range as 6–100 m; read as 6–30 m (20–100 ft), matching the feet figure.
  {
    slug: "rock-pile-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/rock-pile-at-klein-bonaire/",
      "https://bonaire.com/en/dive-sites/rock-pile/",
      "https://stinapabonaire.org/wp-content/uploads/2026/04/STINAPA-BNMP-folder-pag.2-scaled.jpg",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Rock Pile",
      locationName: "Klein Bonaire, Bonaire National Marine Park",
      forecastLatitude: 12.1477,
      forecastLongitude: -68.3103,
      description:
        "The mooring sits off a pile of rocks. A large staghorn colony shelters daytime schools of grunts and snappers, and a big green moray has hidden among the boulder corals.",
      marineLife: "Staghorn coral · grunts · snappers · green moray",
      marineLifeDescription: "Grunts and snappers shelter in the staghorn.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "6–30 m (20–100 ft)",
      maxDepthMeters: 30,
      divePlan:
        "Descend at the mooring beside the rock pile, work the reef no deeper than 30 m (100 ft), and finish in the staghorn.",
      fitTone: "demanding",
      fitNote: "A boat dive.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["staghorn-coral", "french-grunt", "schoolmaster-snapper", "green-moray"],
    },
  },
  // Denominator row: Joanne's Sunchi
  // Position: Klein Bonaire site: bonaire.com's pin lies on the OpenStreetMap shoreline and fits the STINAPA map's letter order.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "joannes-sunchi-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/joannes-sunchi-at-klein-bonaire/",
      "https://bonaire.com/en/dive-sites/joannes-sunchi/",
      "https://stinapabonaire.org/wp-content/uploads/2026/04/STINAPA-BNMP-folder-pag.2-scaled.jpg",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Joanne’s Sunchi",
      locationName: "Klein Bonaire, Bonaire National Marine Park",
      forecastLatitude: 12.1481,
      forecastLongitude: -68.3117,
      description:
        "Sunchi is Papiamentu for kiss. Sand chutes and large tube sponges, with rubble piles under the boat where sand tilefish nest.",
      marineLife: "Sand tilefish · tube sponges",
      marineLifeDescription: "Sand tilefish nest in the rubble.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "6–30 m (20–100 ft)",
      maxDepthMeters: 30,
      divePlan:
        "Descend at the mooring, follow the sand chutes, no deeper than 30 m (100 ft), and look for the tilefish nests under the boat.",
      fitTone: "demanding",
      fitNote: "A boat dive. Moderate current can come with spring tides.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["sand-tilefish", "yellow-tube-sponge", "french-angelfish", "blue-tang"],
    },
  },
  // Denominator row: Captain Don's Reef
  // Position: Klein Bonaire site: bonaire.com's pin lies on the OpenStreetMap shoreline and fits the STINAPA map's letter order.
  // Gate: ungated Open Water dive, because infobonaire calls it a beginner or novice site and its terrace is run that way; the plan's floor is 18 m and the slope falls away beyond it.
  {
    slug: "captain-dons-reef-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/captain-dons-reef-at-klein-bonaire/",
      "https://bonaire.com/en/dive-sites/captain-dons-reef/",
      "https://stinapabonaire.org/wp-content/uploads/2026/04/STINAPA-BNMP-folder-pag.2-scaled.jpg",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Captain Don’s Reef",
      locationName: "Klein Bonaire, Bonaire National Marine Park",
      forecastLatitude: 12.1501,
      forecastLongitude: -68.3174,
      description:
        "Open to every level. A plaque at the mooring honors Don Stewart, who pioneered diving on Bonaire.",
      marineLife: "Blue tang · French angelfish · queen parrotfish",
      marineLifeDescription: "A plaque at the mooring thanks Captain Don.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "beginner",
      depthRange: "6–18 m (20–60 ft)",
      maxDepthMeters: 18,
      divePlan:
        "Descend at the mooring, see the plaque, work the reef no deeper than 18 m (60 ft), and return the same way.",
      fitTone: "welcoming",
      fitNote: "For all levels. The reef continues past this plan's 18 m floor.",
      landmarks: [
        {
          name: "Captain Don plaque",
          kind: "underwaterMonument",
          note: "A plaque at the mooring for Don Stewart, Bonaire's pioneer diver.",
        },
      ],
      creatureSlugs: ["french-angelfish", "blue-tang", "queen-parrotfish"],
    },
  },
  // Denominator row: South Bay
  // Position: Klein Bonaire site: bonaire.com's pin lies on the OpenStreetMap shoreline and fits the STINAPA map's letter order.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "south-bay-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/south-bay-at-klein-bonaire/",
      "https://bonaire.com/en/dive-sites/south-bay-dive/",
      "https://stinapabonaire.org/wp-content/uploads/2026/04/STINAPA-BNMP-folder-pag.2-scaled.jpg",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "South Bay",
      locationName: "Klein Bonaire, Bonaire National Marine Park",
      forecastLatitude: 12.1497,
      forecastLongitude: -68.3201,
      description:
        "Groupers, plus bar jacks and horse-eye jacks that feed on schools of boga just off the reef.",
      marineLife: "Groupers · bar jacks · horse-eye jacks",
      marineLifeDescription: "Jacks work the schools of boga off the reef.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "9–30 m (30–100 ft)",
      maxDepthMeters: 30,
      currentNote: "Mild to none according to bonaire.com.",
      divePlan:
        "Descend at the mooring, work the reef edge no deeper than 30 m (100 ft), and watch the jacks feeding on the boga.",
      fitTone: "demanding",
      fitNote: "A boat dive; bonaire.com describes mild to no current.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["bar-jack", "horse-eye-jack", "boga", "black-grouper"],
    },
  },
  // Denominator row: Hands Off
  // Position: Klein Bonaire site: bonaire.com's pin lies on the OpenStreetMap shoreline and fits the STINAPA map's letter order.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "hands-off-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/hands-off-at-klein-bonaire/",
      "https://bonaire.com/en/dive-sites/hands-off/",
      "https://stinapabonaire.org/wp-content/uploads/2026/04/STINAPA-BNMP-folder-pag.2-scaled.jpg",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Hands Off",
      locationName: "Klein Bonaire, Bonaire National Marine Park",
      forecastLatitude: 12.1488,
      forecastLongitude: -68.3264,
      description:
        "Set up to gauge diver impact on the reef, so photographers and careless diving were kept out. Many small coral hills and valleys.",
      marineLife: "Reef fish · coral heads",
      marineLifeDescription: "Tongue-and-groove coral in small ridges.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "9–30 m (30–100 ft)",
      maxDepthMeters: 30,
      divePlan:
        "Descend at the mooring, drift between the coral hills no deeper than 30 m (100 ft), and keep your buoyancy off the reef.",
      fitTone: "demanding",
      fitNote: "Good buoyancy matters most here.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["boulder-star-coral", "french-angelfish", "blue-tang", "queen-parrotfish"],
    },
  },
  // Denominator row: Sharon's Serenity
  // Position: Placed by its letter on the STINAPA map, which runs clockwise round the island, interpolated along the OpenStreetMap shoreline between sites whose positions are confirmed; good to about 0.5 km, so a shop should re-pin it.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "sharons-serenity-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/sharons-serenity-at-klein-bonaire/",
      "https://bonaire.com/en/dive-sites/sharons-serenity/",
      "https://stinapabonaire.org/wp-content/uploads/2026/04/STINAPA-BNMP-folder-pag.2-scaled.jpg",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Sharon’s Serenity",
      locationName: "Klein Bonaire, Bonaire National Marine Park",
      forecastLatitude: 12.1572,
      forecastLongitude: -68.3267,
      description:
        "On Klein's southwest corner, with the mooring close to shore. Elkhorn, staghorn and soft corals, big groupers, and basket stars for night dives.",
      marineLife: "Groupers · basket stars · elkhorn coral",
      marineLifeDescription: "Basket stars come out on night dives.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "6–30 m (20–100 ft)",
      maxDepthMeters: 30,
      divePlan:
        "Descend at the mooring close to shore, work the corals no deeper than 30 m (100 ft), and return along the shallows.",
      fitTone: "demanding",
      fitNote: "A boat dive.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["black-grouper", "giant-basket-star", "elkhorn-coral", "staghorn-coral"],
    },
  },
  // Denominator row: Mi Dushi (Johanna's Revenge)
  // Position: Klein Bonaire site: bonaire.com's pin lies on the OpenStreetMap shoreline and fits the STINAPA map's letter order.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "mi-dushi-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/mi-dushi-at-klein-bonaire/",
      "https://bonaire.com/en/dive-sites/mi-dushi/",
      "https://stinapabonaire.org/wp-content/uploads/2026/04/STINAPA-BNMP-folder-pag.2-scaled.jpg",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Mi Dushi",
      locationName: "Klein Bonaire, Bonaire National Marine Park",
      forecastLatitude: 12.1615,
      forecastLongitude: -68.3249,
      description:
        "Mi dushi is Papiamentu for my sweetheart. Staghorn and yellow pencil coral fill the shallows, with small fish such as yellowhead jawfish and sailfin blennies, and seahorses at about 15 m.",
      marineLife: "Seahorses · jawfish · sailfin blennies",
      marineLifeDescription: "A site for small animals, seahorses above all.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "8–30 m (25–100 ft)",
      maxDepthMeters: 30,
      divePlan:
        "Descend at the mooring, work the staghorn shallows and the slope no deeper than 30 m (100 ft), and look for seahorses near 15 m.",
      fitTone: "demanding",
      fitNote: "A boat dive.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "longsnout-seahorse",
        "yellowhead-jawfish",
        "sailfin-blenny",
        "staghorn-coral",
      ],
    },
  },
  // Denominator row: Carl's Hill (Punt P'abou)
  // Position: PADI lists 12.1652, -68.3232 and bonaire.com the same; it is on the shoreline.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "carls-hill-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/carls-hill-at-klein-bonaire/",
      "https://bonaire.com/en/dive-sites/carls-hill/",
      "https://stinapabonaire.org/wp-content/uploads/2026/04/STINAPA-BNMP-folder-pag.2-scaled.jpg",
      "https://www.padi.com/dive-site/bonaire/carls-hill/",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Carl’s Hill",
      locationName: "Klein Bonaire, Bonaire National Marine Park",
      forecastLatitude: 12.1652,
      forecastLongitude: -68.3232,
      description:
        "Named for photographer Carl Roessler. A sheer wall begins 20 yards offshore and drops to sand at about 21 m, its face covered in sponges and gorgonians.",
      marineLife: "Sponges · gorgonians · barracuda · blue tang",
      marineLifeDescription: "A photographer's wall.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "advanced",
      depthRange: "6–30 m (20–100 ft)",
      maxDepthMeters: 30,
      currentNote: "Strong current is possible, according to bonaire.com.",
      divePlan:
        "Enter from shore, swim the 20 yards to the sheer face, follow it to the sand near 21 m, and stay no deeper than 30 m (100 ft).",
      fitTone: "demanding",
      fitNote: "A wall for divers with Advanced Open Water. Current can be strong.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["great-barracuda", "bar-jack", "blue-tang", "common-sea-fan"],
    },
  },
  // Denominator row: Ebo's Special
  // Position: Placed by its letter on the STINAPA map, which runs clockwise round the island, interpolated along the OpenStreetMap shoreline between sites whose positions are confirmed; good to about 0.5 km, so a shop should re-pin it.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "ebos-special-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/ebos-specialjerrys-jam-at-klein-bonaire/",
      "https://bonaire.com/en/dive-sites/ebos-special/",
      "https://stinapabonaire.org/wp-content/uploads/2026/04/STINAPA-BNMP-folder-pag.2-scaled.jpg",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Ebo’s Special",
      locationName: "Klein Bonaire, Bonaire National Marine Park",
      forecastLatitude: 12.1657,
      forecastLongitude: -68.3194,
      description:
        "Also known as Jerry's Jam. It shares Carl's Hill's mooring design, a helix anchor bolt installed after the 1999 storm surge.",
      marineLife: "Blue tang · French angelfish · queen parrotfish",
      marineLifeDescription: "Same helix-bolt mooring as Carl's Hill.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "8–30 m (25–100 ft)",
      maxDepthMeters: 30,
      divePlan:
        "Descend at the mooring, work the wall no deeper than 30 m (100 ft), and stay out of the caves.",
      fitTone: "demanding",
      fitNote: "A boat dive. bonaire.com describes caves along the wall; stay out of them.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["french-angelfish", "blue-tang", "queen-parrotfish"],
    },
  },
  // Denominator row: Leonora's Reef
  // Position: Placed by its letter on the STINAPA map, which runs clockwise round the island, interpolated along the OpenStreetMap shoreline between sites whose positions are confirmed; good to about 0.5 km, so a shop should re-pin it.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "leonoras-reef-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/leonaras-reef-at-klein-bonaire/",
      "https://bonaire.com/en/dive-sites/leonoras-reef/",
      "https://stinapabonaire.org/wp-content/uploads/2026/04/STINAPA-BNMP-folder-pag.2-scaled.jpg",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Leonora’s Reef",
      locationName: "Klein Bonaire, Bonaire National Marine Park",
      forecastLatitude: 12.1667,
      forecastLongitude: -68.3159,
      description: "A typical sloping reef with huge hollow coral heads that shelter many animals.",
      marineLife: "Coral formations · reef fish",
      marineLifeDescription: "Huge, hollow, ancient coral heads.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "8–30 m (25–100 ft)",
      maxDepthMeters: 30,
      divePlan:
        "Descend at the mooring, work the coral heads no deeper than 30 m (100 ft), and stay out of the tunnels.",
      fitTone: "demanding",
      fitNote:
        "A boat dive. bonaire.com mentions tunnels through the coral; stay out of them. Boats use the Klein Bonaire channel, so carry an SMB.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["boulder-star-coral", "french-angelfish", "blue-tang"],
    },
  },
  // Denominator row: Knife
  // Position: Placed by its letter on the STINAPA map, which runs clockwise round the island, interpolated along the OpenStreetMap shoreline between sites whose positions are confirmed; good to about 0.5 km, so a shop should re-pin it.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "knife-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/knife-at-klein-bonaire/",
      "https://bonaire.com/en/dive-sites/knife/",
      "https://stinapabonaire.org/wp-content/uploads/2026/04/STINAPA-BNMP-folder-pag.2-scaled.jpg",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Knife",
      locationName: "Klein Bonaire, Bonaire National Marine Park",
      forecastLatitude: 12.1683,
      forecastLongitude: -68.3128,
      description:
        "Coral rubble and sand in the shallows suit big parrotfish, and the sloping reef has coral heads of many heights. Sea rods and sea plumes grow near the drop-off.",
      marineLife: "Parrotfish · sea plumes",
      marineLifeDescription: "Large parrotfish graze the rubble.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "6–30 m (20–100 ft)",
      maxDepthMeters: 30,
      divePlan:
        "Descend at the mooring, work the slope no deeper than 30 m (100 ft), and finish in the rubble shallows.",
      fitTone: "demanding",
      fitNote: "A boat dive. Boats use the Klein Bonaire channel, so carry an SMB.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["midnight-parrotfish", "rainbow-parrotfish", "sea-plume", "black-sea-rod"],
    },
  },
  // Denominator row: Sampler
  // Position: Placed by its letter on the STINAPA map, which runs clockwise round the island, interpolated along the OpenStreetMap shoreline between sites whose positions are confirmed; good to about 0.5 km, so a shop should re-pin it.
  // Gate: the reef drops off past recreational depth (bonaire.com prints deeper figures for some sites); the plan's floor is 30 m, so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "sampler-bonaire",
    version: 1,
    area: "bonaire",
    sources: [
      "https://infobonaire.com/sampler-at-klein-bonaire/",
      "https://bonaire.com/en/dive-sites/sampler/",
      "https://stinapabonaire.org/wp-content/uploads/2026/04/STINAPA-BNMP-folder-pag.2-scaled.jpg",
      "https://stinapabonaire.org/rules-and-regulations/diving/",
    ],
    briefing: {
      name: "Sampler",
      locationName: "Klein Bonaire, Bonaire National Marine Park",
      forecastLatitude: 12.1688,
      forecastLongitude: -68.3089,
      description:
        "On Klein's north coast, with friendly angelfish and sand-bottom animals such as sand divers, yellowhead jawfish and sailfin blennies.",
      marineLife: "Angelfish · sand divers · jawfish",
      marineLifeDescription: "Angelfish approach divers.",
      conservationNote:
        "Marine park rules apply: no gloves, no touching or collecting, and keep your buoyancy off the reef. The STINAPA nature fee tag is required.",
      difficultyLevel: "intermediate",
      depthRange: "6–30 m (20–100 ft)",
      maxDepthMeters: 30,
      divePlan:
        "Descend at the mooring, work the sand and the slope no deeper than 30 m (100 ft), and expect a light current from east to west.",
      fitTone: "demanding",
      fitNote:
        "A popular boat dive. A light current from east to west is possible. Boats use the Klein Bonaire channel, so carry an SMB.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["french-angelfish", "sand-diver", "yellowhead-jawfish", "sailfin-blenny"],
    },
  },
];
