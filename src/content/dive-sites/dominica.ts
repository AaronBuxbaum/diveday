// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/**
 * Dominica. The Soufrière-Scotts Head Marine Reserve publishes no coordinates, so every pin is an
 * approximate pin: a point in the water at the named landmark (Champagne Reef, Scotts Head,
 * Pointe Guignard and Soufrière are named places on OpenStreetMap), good to about 2 km, not a
 * mooring. wannadive.net positions were used only to choose the point beside the landmark.
 */
const RESERVE_FEE =
  "Inside the Soufrière-Scotts Head Marine Reserve: visitors pay a marine park user fee, the sites have permanent moorings, and the rule is look but do not touch.";

export const DOMINICA: DiveSiteTemplate[] = [
  {
    slug: "champagne-reef-dominica",
    version: 1,
    area: "dominica",
    sources: [
      "https://www.ssmrdominica.com/dive-sites-in-the-ssmr/",
      "https://divedominica.com/dominica-dive-sites/",
      "https://scubadiverlife.com/best-scuba-diving-dominica",
      "https://www.wannadive.net/spot/Central_America/Dominica/Champagne_Beach/index.html",
    ],
    briefing: {
      name: "Champagne Reef",
      locationName: "Soufrière, Dominica",
      // Approximate pin: Champagne Reef is a named place at Pointe Michel on OpenStreetMap
      // (15.2447, -61.3733) and the northernmost reserve site per the SSMR; placed about 60 m
      // offshore of that point, in the water, where the spring lies in about 4.5 m (15 ft).
      forecastLatitude: 15.2445,
      forecastLongitude: -61.374,
      description:
        "A shore dive over a volcanic hot spring, where gas and warm water rise in streams of bubbles through the rocks. Boulders in the shallows slope to a low wall, and the bubble field comes at the end of the dive.",
      marineLife: "Porcupinefish · soapfish · arrow crabs · flying gurnards · squid",
      marineLifeDescription:
        "Squid gather in the shallows near the bubbles and flying gurnards cruise the sand. Porcupinefish and soapfish sit among the tube sponges, and seahorses and frogfish turn up for a patient eye.",
      conservationNote: RESERVE_FEE,
      difficultyLevel: "beginner",
      // The spring sits in about 4.5 m; the shore reef slopes to a wall at about 10 m and the
      // source holds the dive well above 18 m.
      depthMinMeters: 3,
      maxDepthMeters: 18,
      currentNote:
        "Usually light. The shore entry is over loose stones, baseball-sized at the edge and larger below, with urchins among them, so step carefully. Volcanic gas vents here and the water near the bubbles can be hot to the touch, so keep hands and gear clear. A fireworm may sit on a warm rock. Vent gas is volcanic; never breathe from it. Snorkelers share the entry; exit where you entered.",
      divePlan:
        "Circle the reef in the shallows, follow the gentle wall at 10 m, and finish the safety stop in the shallows beside, not in, the bubble field.",
      fitTone: "welcoming",
      fitNote:
        "Shallow, warm and slow. A calm place to practice buoyancy over rocks you should not touch.",
      creatureSlugs: [
        "porcupinefish",
        "greater-soapfish",
        "arrow-crab",
        "flying-gurnard",
        "caribbean-reef-squid",
        "stoplight-parrotfish",
        "yellow-tube-sponge",
      ],
    },
  },
  {
    slug: "scotts-head-pinnacle",
    version: 1,
    area: "dominica",
    sources: [
      "https://www.ssmrdominica.com/dive-sites-in-the-ssmr/",
      "https://divedominica.com/dominica-dive-sites/",
      "https://scubadiverlife.com/best-scuba-diving-dominica",
      "https://www.wannadive.net/spot/Central_America/Dominica/Scott_s_Head_Pinnacle_/index.html",
    ],
    briefing: {
      name: "Scotts Head Pinnacle and Swiss Cheese",
      locationName: "Scotts Head, Dominica",
      // Approximate pin: the pinnacle lies off the point of Scotts Head (a named place on
      // OpenStreetMap, 15.2146, -61.3734) where the SSMR puts the meeting of the Atlantic and the
      // Caribbean; placed in the water about 400 m west of that point.
      forecastLatitude: 15.2156,
      forecastLongitude: -61.3771,
      description:
        "The dive begins on the rocks of Swiss Cheese, crosses coral-crusted rock to the pinnacle, and finishes along the steep inside wall of the volcanic crater.",
      marineLife: "Blackbar soldierfish · grunts · lobster · sea fans",
      marineLifeDescription:
        "Soldierfish and grunts pack the rocks of Swiss Cheese, and deep-water sea fans and gorgonians cover the wall behind the pinnacle.",
      conservationNote: RESERVE_FEE,
      difficultyLevel: "advanced",
      depthMinMeters: 11,
      maxDepthMeters: 30,
      currentNote:
        "Where the Atlantic and Caribbean meet, current can be strong; carry an SMB and stay on the mooring. Swim-throughs at Swiss Cheese and through the pinnacle at about 11 m are overhead; stay out of them.",
      divePlan:
        "Down the mooring to Swiss Cheese, across the rocks to the pinnacle, along the crater wall no deeper than 30 m, and back up on the mooring line or an SMB with reserve gas. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote:
        "A crater wall that keeps falling past the plan, where two seas meet. For divers who can hold a floor.",
      // The wall falls away past recreational depth (the SSMR: more than 120 ft; one listing gives
      // 42 m) where two seas meet, so the gate is Advanced Open Water; the 30 m floor is the
      // plan's, not the bottom.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "blackbar-soldierfish",
        "french-grunt",
        "spiny-lobster",
        "common-sea-fan",
        "giant-barrel-sponge",
        "creole-wrasse",
      ],
    },
  },
  {
    slug: "craters-edge-dominica",
    version: 1,
    area: "dominica",
    sources: [
      "https://www.ssmrdominica.com/dive-sites-in-the-ssmr/",
      "https://divedominica.com/dominica-dive-sites/",
      "https://scubadiverlife.com/best-scuba-diving-dominica",
    ],
    briefing: {
      name: "Crater's Edge",
      locationName: "Scotts Head, Dominica",
      // Approximate pin: the reserve and the operator both put the site at the end of the volcanic
      // ridge that runs northwest from Scotts Head Pinnacle, and a third source puts it at the
      // southernmost point of the Soufrière crater, i.e. at Scotts Head; placed in the water about
      // 500 m northwest of the Pinnacle pin (good to about 2 km).
      forecastLatitude: 15.2185,
      forecastLongitude: -61.3805,
      description:
        "A pinnacle on the outer rim of the volcanic crater, at the end of a ridge that runs northwest from Scotts Head Pinnacle. Predators patrol the blue water beside a sponge-covered wall.",
      marineLife: "Bar jacks · rainbow runners · barracuda · Creole wrasse",
      marineLifeDescription:
        "Predators chase baitfish out in the blue, while Creole wrasse and chromis stream past the wall.",
      conservationNote: RESERVE_FEE,
      difficultyLevel: "advanced",
      maxDepthMeters: 30,
      currentNote:
        "Calm Caribbean water meets the Atlantic here and the current can be strong, so operators dive it only when conditions allow. Open water: carry an SMB and stay with the mooring or your guide.",
      divePlan:
        "Down the mooring to the pinnacle, once around it no deeper than 30 m, and up the mooring line or an SMB with reserve gas. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote:
        "Open water, a possible current and a wall. A dive for experienced divers on a good day.",
      // Gate: the sources call it a current dive for experienced divers in open water.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "bar-jack",
        "rainbow-runner",
        "great-barracuda",
        "creole-wrasse",
        "brown-chromis",
        "giant-barrel-sponge",
        "yellowtail-snapper",
      ],
    },
  },
  {
    slug: "scotts-head-drop-off",
    version: 1,
    area: "dominica",
    sources: [
      "https://www.ssmrdominica.com/dive-sites-in-the-ssmr/",
      "https://divedominica.com/dominica-dive-sites/",
      "https://scubadiverlife.com/best-scuba-diving-dominica",
      "https://www.wannadive.net/spot/Central_America/Dominica/Scott_s_Head_Dropoff/index.html",
    ],
    briefing: {
      name: "Scotts Head Drop-Off",
      locationName: "Scotts Head, Dominica",
      // Approximate pin: the SSMR puts the dive at the western point of the sheltered
      // Soufrière-Scotts Head bay, i.e. Scotts Head Point (OpenStreetMap, 15.2146, -61.3734); placed
      // in the bay about 200 m east of that point, in the water.
      forecastLatitude: 15.2146,
      forecastLongitude: -61.3715,
      description:
        "A colorful wall on the sheltered bay side of Scotts Head, reached over sand and coral heads. Vase, tube and icing sponges cover it from about 12 m down, and the nooks hold lobster and cleaner shrimp. A shelf at about 40 m and the crater below it lie past the plan.",
      marineLife: "Vase sponges · tube sponges · lobster · cleaner shrimp · frogfish",
      marineLifeDescription:
        "Small life lives in the nooks of the wall. Look for frogfish and shrimp rather than across the blue.",
      conservationNote: RESERVE_FEE,
      difficultyLevel: "advanced",
      depthMinMeters: 12,
      maxDepthMeters: 30,
      currentNote:
        "One listing notes boat traffic, so carry an SMB and listen for engines. The bay is sheltered and waves and current are rare.",
      divePlan:
        "Over the sandy shallows to the lip of the wall, along it no deeper than 30 m, and back up for a safety stop among the sponges on the mooring line or an SMB. The 40 m shelf is past the plan; stay above it.",
      fitTone: "demanding",
      fitNote: "A wall that does not stop where the plan does. For divers who can hold a floor.",
      // RULE 2: the wall drops to a 40 m shelf and on into the crater, past recreational depth; the
      // 30 m floor is the plan's and the shelf is worded as past the plan.
      // Advanced Open Water gate, as the listing rates it (CMAS ** / AOW).
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "azure-vase-sponge",
        "yellow-tube-sponge",
        "spiny-lobster",
        "spotted-cleaner-shrimp",
        "longlure-frogfish",
        "smallmouth-grunt",
      ],
    },
  },
  {
    slug: "labym-dominica",
    version: 1,
    area: "dominica",
    sources: [
      "https://www.ssmrdominica.com/dive-sites-in-the-ssmr/",
      "https://divedominica.com/dominica-dive-sites/",
      "https://www.wannadive.net/spot/Central_America/Dominica/L_Abym/index.html",
    ],
    briefing: {
      name: "L'Abym (La Sourcière)",
      locationName: "Soufrière, Dominica",
      // Approximate pin: the SSMR and the operator describe the wall dropping from the cliff face
      // north of Soufrière village (OpenStreetMap, 15.2331, -61.3604); placed in the water about
      // 600 m west of the village, below the cliff (good to about 2 km).
      forecastLatitude: 15.2345,
      forecastLongitude: -61.3661,
      description:
        "A steep wall that drops from the cliff face into deep water. The dive starts on a shelf.",
      marineLife: "Seahorses · scorpionfish · turtles · barracuda",
      marineLifeDescription:
        "Seahorses and scorpionfish sit in the quiet corners of the shelf, and turtles pass along the wall.",
      conservationNote: RESERVE_FEE,
      difficultyLevel: "advanced",
      depthMinMeters: 8,
      maxDepthMeters: 30,
      currentNote:
        "Current varies, from none to 1 to 2 knots; carry an SMB. The wall plunges far past the plan.",
      divePlan:
        "Start on the shelf at 8 m, follow the wall from 12 m, and hold no deeper than 30 m. The wall falls away far past the plan, so watch your depth, not the blue. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote: "A bottomless wall with a current that varies. Hold the floor.",
      // Dive Dominica runs it as an all-levels dive from a shelf at 25 ft (8 m) with the wall dived
      // from 40 ft; the SSMR has the wall falling 1500 ft, and a second listing reports 1-2 knots,
      // a deep wall (it lists 56.7 m) and a depth hazard. The wall is bottomless, so the plan holds
      // a 30 m floor and the gate is Advanced Open Water.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "longsnout-seahorse",
        "spotted-scorpionfish",
        "green-sea-turtle",
        "great-barracuda",
        "longlure-frogfish",
      ],
    },
  },
  {
    slug: "coral-gardens-dominica",
    version: 1,
    area: "dominica",
    sources: [
      "https://www.ssmrdominica.com/dive-sites-in-the-ssmr/",
      "https://divedominica.com/dominica-dive-sites/",
      "https://www.wannadive.net/spot/Central_America/Dominica/Coral_Gardens_South/index.html",
    ],
    briefing: {
      name: "Coral Gardens",
      locationName: "Soufrière, Dominica",
      // Approximate pin: the SSMR puts Coral Gardens inshore of Dangleben's Pinnacles, just south of
      // Pointe Guignard (OpenStreetMap, 15.2415, -61.3733), and the operator's Coral Gardens North
      // lies just south of the same point; placed in the water about 400 m south of it. The two
      // names are read as one reef stretch, which is uncertain; the depth is the deeper figure
      // (40 ft start, 52 ft maximum).
      forecastLatitude: 15.2381,
      forecastLongitude: -61.3711,
      description:
        "A shallow, colorful reef inshore of Dangleben's Pinnacles, with big sponges and wide beds of finger and pencil coral. Turtles are frequent.",
      marineLife: "Finger coral · pencil coral · barrel sponges · horse-eye jacks · turtles",
      marineLifeDescription:
        "Jacks gather over the reef when the current suits, and yellowhead jawfish tend burrows in the sand at the end of the dive.",
      conservationNote: RESERVE_FEE,
      difficultyLevel: "intermediate",
      depthMinMeters: 12,
      maxDepthMeters: 16,
      currentNote:
        "The current can run strong on some days and be flat on others, so carry an SMB and let the crew call it on the day.",
      divePlan:
        "Start at about 12 m, follow the reef gently downhill to the west, and finish over the sand at about 12 m. The crew confirms the stretch at the briefing.",
      fitTone: "unknown",
      fitNote: "A shallow reef with big sponges, and a current that decides how easy it is.",
      // Gate: sources report strong current on some days, so the conservative reading is Advanced
      // Open Water.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "finger-coral",
        "yellow-pencil-coral",
        "giant-barrel-sponge",
        "horse-eye-jack",
        "yellowhead-jawfish",
        "creole-wrasse",
      ],
    },
  },
  {
    slug: "point-guignard",
    version: 1,
    area: "dominica",
    sources: [
      "https://www.ssmrdominica.com/dive-sites-in-the-ssmr/",
      "https://divedominica.com/dominica-dive-sites/",
      "https://www.wannadive.net/spot/Central_America/Dominica/Pointe_Guignard/index.html",
    ],
    briefing: {
      name: "Point Guignard",
      locationName: "Soufrière, Dominica",
      // Approximate pin: Pointe Guignard is a named place on OpenStreetMap (15.2415, -61.3733);
      // placed in the water off the point, just north of Coral Gardens as the SSMR describes it.
      forecastLatitude: 15.2409,
      forecastLongitude: -61.373,
      description:
        "A gently sloping reef just north of Coral Gardens, good for small life. Seahorses, frogfish, nudibranchs and sea slugs turn up on the slope, and turtles visit in season.",
      marineLife: "Seahorses · frogfish · turtles · sea slugs",
      marineLifeDescription:
        "Go slowly and look at the small things. Frogfish and seahorses reward a patient eye.",
      conservationNote: RESERVE_FEE,
      difficultyLevel: "advanced",
      // The listing's maximum of 25.9 m is the only stated depth; the operator names a cave at about
      // 15 m. The headland sits beside Coral Gardens, where current can run strong, and no source
      // settles whether that reaches this point, so the conservative reading gates Advanced Open
      // Water; the plan holds an 18 m floor and asks for a log check.
      depthMinMeters: 0,
      maxDepthMeters: 26,
      currentNote:
        "One listing gives a low current, but the neighboring reef can run strong, so carry an SMB. A narrow cave at about 15 m silts up quickly and is overhead. Stay out of the cave.",
      divePlan:
        "Down the slope, back along the reef no deeper than 18 m, and finish in the shallows with reserve gas. The slope continues deeper beyond the plan. Staff confirm the diver's log before boarding.",
      fitTone: "unknown",
      fitNote: "A slope for slow looking, with a cave nearby that stays out of the plan.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "longsnout-seahorse",
        "longlure-frogfish",
        "green-sea-turtle",
        "lettuce-sea-slug",
      ],
    },
  },
];
