// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Saint Lucia. */
export const SAINT_LUCIA: DiveSiteTemplate[] = [
  // Denominator row: Anse Chastanet Reef
  {
    slug: "anse-chastanet-reef",
    version: 1,
    area: "saint-lucia",
    sources: [
      "https://stlucia.org/en_uk/things-to-do/diving/",
      "https://scubastlucia.com/diving/",
      "https://www.easterncaribbeandivingstlucia.com/dive-sites-list",
      "https://www.viceroyhotelsandresorts.com/pt/node/1251",
      "https://blog.padi.com/5-must-dive-sites-st-lucia/",
    ],
    briefing: {
      name: "Anse Chastanet Reef",
      locationName: "Anse Chastanet, Soufrière, Saint Lucia",

      // Approximate pin: the beach at Anse Chastanet (OpenStreetMap beach point 13.8647, -61.0768), moved 150 m west onto the reef just off the beach, as the tourism board, the resort dive operation's list and the Viceroy list describe a reef a few steps from the sand. No source publishes coordinates.
      forecastLatitude: 13.8649,
      forecastLongitude: -61.0787,
      description:
        "A shore dive from the beach in front of the resort. A shallow plateau of gorgonians, soft coral and sponges sits just off the sand, then the reef falls away into deep water. The drop-off lies beyond this plan.",
      marineLife: "Trumpetfish · seahorses · frogfish · hawksbill turtles · blennies",
      marineLifeDescription:
        "Small animals are the draw here: look into the sponges and along the plateau edge. Night dives need staff approval and a briefed plan.",
      conservationNote:
        "Inside the Soufrière Marine Management Area, which charges divers a user fee; confirm the current rate with the crew. Fishing and collecting are controlled here, so touch and take nothing.",
      difficultyLevel: "beginner",
      depthMinMeters: 5,
      maxDepthMeters: 18,
      currentNote:
        "Beach entry in front of the resort; No entry hazard is documented. Current not documented; ask the crew on the day.",
      divePlan:
        "Walk in from the beach, stay on the plateau and turn the dive on your gas, well before the edge of the drop-off. No deeper than 18 m.",
      fitTone: "welcoming",
      fitNote: "A shallow shore dive that suits a first dive and a slow look. Keep to the plateau.",
      creatureSlugs: [
        "trumpetfish",
        "longsnout-seahorse",
        "longlure-frogfish",
        "hawksbill-turtle",
        "redlip-blenny",
      ],
    },
  },
  // Denominator row: Turtle Reef
  {
    slug: "turtle-reef-saint-lucia",
    version: 1,
    area: "saint-lucia",
    sources: [
      "https://stlucia.org/en_uk/things-to-do/diving/",
      "https://scubastlucia.com/diving/",
      "https://www.viceroyhotelsandresorts.com/pt/node/1251",
      "https://stolentime.com/dive-sites-in-saint-lucia",
      "https://www.underwaterphotography.com/dive-sites/Country.aspx?ID=418",
    ],
    briefing: {
      name: "Turtle Reef",
      locationName: "Anse Chastanet Bay, Soufrière, Saint Lucia",

      // Approximate pin: Anse Chastanet Bay, offshore of the resort beach. The Viceroy list and the dive-site database place the half-moon reef in the bay (north side); no source publishes coordinates. Placed 280 m from the Anse Chastanet Reef pin.
      forecastLatitude: 13.8662,
      forecastLongitude: -61.081,
      description:
        "A crescent of reef in Anse Chastanet Bay that starts over large rocks, builds to a main reef with pillar coral and barrel sponges, then falls to a sandy, grassy floor well past recreational depth. The drop lies beyond this plan.",
      marineLife: "Hawksbill turtles · green turtles · pillar coral · barrel sponges",
      marineLifeDescription:
        "The reef borders turtle grass beds, which is why turtles are likely rather than certain. Give them room.",
      conservationNote:
        "Inside the Soufrière Marine Management Area, which charges divers a user fee; confirm the current rate with the crew. Fishing and collecting are controlled here, so touch and take nothing.",
      difficultyLevel: "intermediate",
      depthMinMeters: 5,
      maxDepthMeters: 18,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Start on the rocks, work along the main reef and turn the dive before the edge. No deeper than 18 m.",
      fitTone: "welcoming",
      fitNote: "A reef held to 18 m on the plateau, with the slope below left out of the plan.",
      // Sourcing: the tourism board calls it a dive for all levels on the plateau.
      creatureSlugs: [
        "pillar-coral",
        "giant-barrel-sponge",
        "hawksbill-turtle",
        "green-sea-turtle",
        "turtle-grass",
      ],
    },
  },
  // Denominator row: Fairyland
  {
    slug: "fairyland-saint-lucia",
    version: 1,
    area: "saint-lucia",
    sources: [
      "https://scubastlucia.com/diving/",
      "https://stolentime.com/dive-sites-in-saint-lucia",
      "https://www.viceroyhotelsandresorts.com/pt/node/1251",
      "https://blog.padi.com/5-must-dive-sites-st-lucia/",
      "https://www.moorings.com/blog/best-diving-st-lucia",
    ],
    briefing: {
      name: "Fairyland",
      locationName: "West Point, Anse Chastanet, Soufrière, Saint Lucia",

      // Approximate pin: the headland of West Point below the cliffs, just off Anse Chastanet. The stolentime list puts Fairyland next to Turtle Reef starting at West Point, and the Moorings guide places it below the cliffs of West Pointe off Anse Chastanet; no source publishes coordinates.
      forecastLatitude: 13.869,
      forecastLongitude: -61.083,
      description:
        "A broad plateau of soft coral and large barrel sponges that slopes gently from about 12 m, ending at a colorful wall. It sits off a headland, so the water moves.",
      marineLife: "Hawksbill turtles · horse-eye jacks · creole wrasse · barrel sponges",
      marineLifeDescription:
        "Schools hang over the plateau and turtles graze it. Large boulders shelter the smaller fish.",
      conservationNote:
        "Inside the Soufrière Marine Management Area, which charges divers a user fee; confirm the current rate with the crew. Fishing and collecting are controlled here, so touch and take nothing.",
      difficultyLevel: "intermediate",
      depthMinMeters: 12,
      maxDepthMeters: 18,
      currentNote:
        "Strong at times off the headland, and the site is run as a drift. Carry an SMB.",
      divePlan:
        "Drop onto the plateau, drift along it no deeper than 18 m, and ascend on an SMB line. The wall beyond is not part of the plan.",
      fitTone: "demanding",
      fitNote: "Colorful and busy with fish. For divers comfortable drifting with an SMB.",
      // Gated for the strong current off the headland (two sources call it very strong at times) and the wall beyond the plateau, not for depth.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "hawksbill-turtle",
        "horse-eye-jack",
        "creole-wrasse",
        "giant-barrel-sponge",
        "blue-chromis",
      ],
    },
  },
  // Denominator row: Trou Diable
  {
    slug: "trou-diable-saint-lucia",
    version: 1,
    area: "saint-lucia",
    sources: [
      "https://www.moorings.com/blog/best-diving-st-lucia",
      "https://stolentime.com/dive-sites-in-saint-lucia",
      "https://www.easterncaribbeandivingstlucia.com/dive-sites-list",
      "https://scubaverse.com/dive-guide/caribbean/saint-lucia/",
    ],
    briefing: {
      name: "Trou Diable",
      locationName: "Off Anse Chastanet, Soufrière, Saint Lucia",

      // Approximate pin: off the Soufrière coast near Anse Chastanet. The Moorings guide places Trou Diable near Fairyland and the eastern Caribbean operator list puts it between the Pinnacles and Fairyland; no source publishes coordinates. Good to about 2 km.
      forecastLatitude: 13.8628,
      forecastLongitude: -61.08,
      description:
        "Devil's Hole: a steep slope of large barrel sponges and coral heads that runs from a shallow shelf down into deep water. The deepest water lies beyond this plan.",
      marineLife: "Barrel sponges · chromis · grunts · gold-spotted eels · spotted drums",
      marineLifeDescription:
        "Schools gather over the coral heads, and eels and spotted drums sit under the ledges.",
      conservationNote:
        "Inside the Soufrière Marine Management Area, which charges divers a user fee; confirm the current rate with the crew. Fishing and collecting are controlled here, so touch and take nothing.",
      difficultyLevel: "advanced",
      depthMinMeters: 6,
      maxDepthMeters: 30,
      currentNote: "Reported as strong at times, with a drift along the slope. Carry an SMB.",
      divePlan:
        "Drift down the slope to about 18 m, no deeper than 30 m, and ascend with a safety stop on an SMB line. The rock hole in the reef is overhead; stay out of it. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote: "A steep slope with current, for divers cleared for Advanced Open Water.",
      // Sourcing: one source calls it advanced only.
      // Gated for the current and the slope that keeps falling; the plan's 30 m floor is ours, from the stated option to go to about 30 m. The rock hole is overhead and not on the plan.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "giant-barrel-sponge",
        "blue-chromis",
        "bluestriped-grunt",
        "spotted-drum",
        "goldspotted-eel",
      ],
    },
  },
  // Denominator row: SK2 Wreck
  {
    slug: "sk2-wreck",
    version: 1,
    area: "saint-lucia",
    sources: [
      "https://stlucia.org/en_uk/things-to-do/diving/",
      "https://www.easterncaribbeandivingstlucia.com/dive-sites-list",
    ],
    briefing: {
      name: "SK2 Wreck",
      locationName: "Anse Cochon, Anse La Raye, Saint Lucia",

      // Approximate pin: offshore of Anse Cochon. The tourism board and the eastern Caribbean operator list both place the wreck at Anse Cochon; no source publishes coordinates. Spaced 335 m from the Vicky B pin.
      forecastLatitude: 13.9283,
      forecastLongitude: -61.0655,
      description:
        "A sand and aggregate barge that ran aground at Soufrière, capsized, and was sunk off Anse Cochon in March 2018 as an artificial reef. Small reefs and sandy patches lie around it.",
      marineLife: "Stingrays · turtles · reef fish",
      marineLifeDescription:
        "Rays settle in the sand beside the hull, and the young reef growing on the steel draws small fish.",
      difficultyLevel: "intermediate",
      depthMinMeters: 21,
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Down the line to the wreck, once around the outside, and back up with a safety stop. Staff confirm the diver's log before boarding. Stay outside the hull.",
      fitTone: "demanding",
      fitNote:
        "The steel starts near 21 m and the sand lies at 30 m, so the whole dive is below Open Water depth. Stay outside the hull.",
      // Advanced Open Water because the whole wreck lies at 21-30 m, below 18 m throughout.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["southern-stingray", "green-sea-turtle", "hawksbill-turtle", "french-grunt"],
    },
  },
  // Denominator row: Vicky B Wreck
  {
    slug: "vicky-b-wreck",
    version: 1,
    area: "saint-lucia",
    sources: [
      "https://stlucia.org/en_uk/things-to-do/diving/",
      "https://www.easterncaribbeandivingstlucia.com/dive-sites-list",
    ],
    briefing: {
      name: "Vicky B Wreck",
      locationName: "Anse Cochon, Anse La Raye, Saint Lucia",

      // Approximate pin: Anse Cochon Bay. The tourism board and the eastern Caribbean operator list both place the wreck in Anse Cochon Bay; no source publishes coordinates. Spaced 350 m from the Lesleen M pin.
      forecastLatitude: 13.9268,
      forecastLongitude: -61.0628,
      description:
        "A freighter about 50 m long, sunk in May 2018 with her bow facing the open sea. She lies in about 24 m of water, with the shallowest part near 15 m.",
      marineLife: "Green morays · frogfish · jacks · Bermuda chub",
      marineLifeDescription: "A young wreck, already drawing morays, frogfish and schooling jacks.",
      difficultyLevel: "intermediate",
      depthMinMeters: 15,
      maxDepthMeters: 24,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Down the line to the shallow side, along the outside of the hull to the bow, and back up with a safety stop. Stay outside the hull.",
      fitTone: "welcoming",
      fitNote: "Mid-depth wreck in a sheltered bay. Stay outside the hull.",
      creatureSlugs: ["green-moray", "longlure-frogfish", "horse-eye-jack", "bermuda-chub"],
    },
  },
  // Denominator row: Lesleen M
  {
    slug: "lesleen-m-wreck",
    version: 1,
    area: "saint-lucia",
    sources: [
      "https://scubastlucia.com/diving/",
      "https://www.easterncaribbeandivingstlucia.com/dive-sites-list",
      "https://stolentime.com/dive-sites-in-saint-lucia",
      "https://blog.padi.com/5-must-dive-sites-st-lucia/",
    ],
    briefing: {
      name: "Lesleen M",
      locationName: "Anse Cochon, Anse La Raye, Saint Lucia",

      // Approximate pin: Anse Cochon Bay. The resort dive operation's page, the eastern Caribbean operator list and the PADI article place the wreck in Anse Cochon Bay (one list says Anse La Raye); no source publishes coordinates. Spaced 330 m from the Anse Cochon pin.
      forecastLatitude: 13.9298,
      forecastLongitude: -61.0615,
      description:
        "A 50 m freighter sunk in 1986 as an artificial reef. She sits upright on sand, with the deck at about 9 m and the stern near 20 m, covered in soft coral, sponges and hydroids.",
      marineLife: "Moray eels · frogfish · lobsters · French angelfish",
      marineLifeDescription:
        "Young angelfish and Nassau grouper shelter in the growth, with morays and frogfish tucked into the steel.",
      difficultyLevel: "intermediate",
      depthMinMeters: 9,
      maxDepthMeters: 20,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Down the bow line to the deck at 9 m, along the outside of the hull, and back up with a safety stop. Open Water divers turn at 18 m, before the 20 m stern. Stay outside the hull.",
      fitTone: "welcoming",
      fitNote:
        "Upright, with the deck at 9 m and the stern near 20 m. The hold and engine room are overhead: stay outside the hull.",
      creatureSlugs: [
        "french-angelfish",
        "queen-angelfish",
        "green-moray",
        "longlure-frogfish",
        "nassau-grouper",
        "spiny-lobster",
      ],
    },
  },
  // Denominator row: Coral Gardens
  {
    slug: "coral-gardens-soufriere",
    version: 1,
    area: "saint-lucia",
    sources: [
      "https://stlucia.org/en_uk/things-to-do/diving/",
      "https://www.viceroyhotelsandresorts.com/pt/node/1251",
      "https://stolentime.com/dive-sites-in-saint-lucia",
    ],
    briefing: {
      name: "Coral Gardens",
      locationName: "Gros Piton, Soufrière, Saint Lucia",

      // Approximate pin: the western base of Gros Piton. The tourism board, the Viceroy list and the stolentime list all place Coral Gardens at the base of Gros Piton; no source publishes coordinates.
      forecastLatitude: 13.813,
      forecastLongitude: -61.076,
      description:
        "At the foot of Gros Piton, where the mountain's slope carries on underwater. Five-finger coral and barrel sponges sit on a reef that is mostly shallow, with sandy patches, before the slope keeps falling.",
      marineLife: "Sargassum triggerfish · barracuda · juvenile reef fish · barrel sponges",
      marineLifeDescription:
        "Dense sea plume forests in the shallows shelter young fish, and triggerfish work the deeper edge.",
      conservationNote:
        "Inside the Soufrière Marine Management Area, which charges divers a user fee; confirm the current rate with the crew. Fishing and collecting are controlled here, so touch and take nothing.",
      difficultyLevel: "intermediate",
      depthMinMeters: 5,
      maxDepthMeters: 27,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Stay on the reef at about 15 m, no deeper than 27 m, and watch your depth: the slope keeps falling beyond the plan. Safety stop on the boat's line or an SMB. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote: "The reef is easy, the slope below it is not. Watch your depth closely.",
      // Sourcing: one source tells divers to watch their depth closely.
      // Gated because the slope below continues for hundreds of feet (two sources) and the plan holds the tourism board's 27 m floor.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "sargassum-triggerfish",
        "great-barracuda",
        "giant-barrel-sponge",
        "sea-plume",
        "hogfish",
      ],
    },
  },
  // Denominator row: Piton Wall
  {
    slug: "piton-wall",
    version: 1,
    area: "saint-lucia",
    sources: [
      "https://stlucia.org/en_uk/things-to-do/diving/",
      "https://www.easterncaribbeandivingstlucia.com/dive-sites-list",
      "https://stolentime.com/dive-sites-in-saint-lucia",
      "https://www.viceroyhotelsandresorts.com/pt/node/1251",
    ],
    briefing: {
      name: "Piton Wall",
      locationName: "Petit Piton, Soufrière, Saint Lucia",

      // Approximate pin: Jalousie Bay at the foot of Petit Piton. The Viceroy list places the wall in Jalousie Bay, the tourism board, the eastern Caribbean list and the stolentime list at the base of Petit Piton; no source publishes coordinates.
      forecastLatitude: 13.8298,
      forecastLongitude: -61.069,
      description:
        "The underwater face of Petit Piton: a wall that falls from the surface to many hundreds of feet, hung with sea whips, gorgonians and feather duster worms. The depth beyond the plan is not for recreational diving.",
      marineLife: "Seahorses · feather duster worms · hawksbill turtles · crustaceans",
      marineLifeDescription:
        "Look small: seahorses and crustaceans live in the soft coral on the wall.",
      conservationNote:
        "Inside the Soufrière Marine Management Area, which charges divers a user fee; confirm the current rate with the crew. Fishing and collecting are controlled here, so touch and take nothing.",
      difficultyLevel: "intermediate",
      depthMinMeters: 5,
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Down to the top of the wall, along it no deeper than 30 m, and back up the wall with a safety stop on the boat's line or an SMB. The wall falls past that depth. The floor is the plan's: 30 m (100 ft). Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote: "A wall that does not end where you should. The floor is yours to hold.",
      // The wall drops hundreds of feet; the plan's 30 m floor is ours, so it is gated Advanced Open Water.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "longsnout-seahorse",
        "feather-duster-worm",
        "hawksbill-turtle",
        "lettuce-sea-slug",
        "arrow-crab",
      ],
    },
  },
  // Denominator row: Superman's Flight
  {
    slug: "supermans-flight",
    version: 1,
    area: "saint-lucia",
    sources: [
      "https://stlucia.org/en_uk/things-to-do/diving/",
      "https://www.easterncaribbeandivingstlucia.com/dive-sites-list",
      "https://blog.padi.com/5-must-dive-sites-st-lucia/",
      "https://stolentime.com/dive-sites-in-saint-lucia",
      "https://scubaverse.com/dive-guide/caribbean/saint-lucia/",
    ],
    briefing: {
      name: "Superman's Flight",
      locationName: "Petit Piton, Soufrière, Saint Lucia",

      // Approximate pin: the west face of Petit Piton. The tourism board, the eastern Caribbean list, the PADI article and the stolentime list all place Superman's Flight at the base of Petit Piton; no source publishes coordinates. Placed 750 m from the Piton Wall pin.
      forecastLatitude: 13.8365,
      forecastLongitude: -61.0705,
      description:
        "A drift along the steep slope at the foot of Petit Piton, named for the cliff used in Superman II. Soft coral, large barrel sponges and orange sponges line the slope, with plenty of fish.",
      marineLife: "Barrel sponges · creole wrasse · parrotfish · eagle rays",
      marineLifeDescription:
        "Fish stream along the slope on the current, and the sponges are large.",
      conservationNote:
        "Inside the Soufrière Marine Management Area, which charges divers a user fee; confirm the current rate with the crew. Fishing and collecting are controlled here, so touch and take nothing.",
      difficultyLevel: "advanced",
      depthMinMeters: 5,
      maxDepthMeters: 30,
      currentNote:
        "Often strong and sometimes moderate, carrying divers along the slope; some days there is none. Carry an SMB.",
      divePlan:
        "Drop in at the start, drift along the slope no deeper than 30 m, and ascend with a safety stop on an SMB line for the boat to pick up. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote:
        "A drift on a slope that keeps falling. For divers confident with an SMB and holding a depth.",
      // Gated for the drift (sources call the current strong) and the slope below the plan, whose 30 m floor is ours.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "giant-barrel-sponge",
        "creole-wrasse",
        "queen-parrotfish",
        "spotted-eagle-ray",
        "orange-cup-coral",
      ],
    },
  },
  // Denominator row: Anse Cochon
  {
    slug: "anse-cochon",
    version: 1,
    area: "saint-lucia",
    sources: [
      "https://stlucia.org/en_uk/things-to-do/diving/",
      "https://www.easterncaribbeandivingstlucia.com/dive-sites-list",
      "https://scubastlucia.com/diving/",
      "https://etbtravelphotography.com/dive-sites-in-st-lucia/",
    ],
    briefing: {
      name: "Anse Cochon",
      locationName: "Anse Cochon, Anse La Raye, Saint Lucia",

      // Approximate pin: the north side of Anse Cochon Bay. The tourism board, the eastern Caribbean list and the resort dive operation's page all name Anse Cochon (north and south sides of the beach); no source publishes coordinates.
      forecastLatitude: 13.9328,
      forecastLongitude: -61.0605,
      description:
        "Two reefs, north and south of the beach: coral patches, boulder fields and sand, with a steep slope of sponge-covered boulders on the deeper side. The shallows hold seahorses and scorpionfish.",
      marineLife: "Turtles · octopus · moray eels · seahorses · scorpionfish",
      marineLifeDescription:
        "Look under the boulders and along the sand edges. Cleaner shrimp work the shallows.",
      difficultyLevel: "beginner",
      depthMinMeters: 2,
      maxDepthMeters: 18,
      currentNote:
        "Reached by boat or from the beach. No entry hazard is documented. Current not documented; ask the crew on the day.",
      divePlan:
        "Pick the north or south reef, stay on the coral and boulders, and turn the dive before the slope falls away. No deeper than 18 m.",
      fitTone: "welcoming",
      fitNote:
        "Shallow reefs in a bay, with a good snorkel on top. The south reef is the shallower of the two.",
      creatureSlugs: [
        "atlantic-common-octopus",
        "spotted-scorpionfish",
        "longsnout-seahorse",
        "hawksbill-turtle",
        "spotted-cleaner-shrimp",
      ],
    },
  },
  // Denominator row: Anse La Raye Wall
  {
    slug: "anse-la-raye-wall",
    version: 1,
    area: "saint-lucia",
    sources: [
      "https://stlucia.org/en_uk/things-to-do/diving/",
      "https://blog.padi.com/5-must-dive-sites-st-lucia/",
      "https://scubastlucia.com/diving/",
      "https://www.easterncaribbeandivingstlucia.com/dive-sites-list",
    ],
    briefing: {
      name: "Anse La Raye Wall",
      locationName: "Anse La Raye, Saint Lucia",

      // Approximate pin: offshore of the town of Anse La Raye, in the bay. The PADI article, the tourism board and the resort dive operation's page place the wall at Anse La Raye; no source publishes coordinates.
      forecastLatitude: 13.9395,
      forecastLongitude: -61.0495,
      description:
        "Bay of the Rays: a steep sloping reef and wall covered in gorgonians, sea whips and large barrel sponges. Stingrays and eagle rays are common.",
      marineLife: "Stingrays · eagle rays · turtles · barrel sponges",
      marineLifeDescription: "The bay is named for its rays. Keep your distance and your hands in.",
      difficultyLevel: "advanced",
      depthMinMeters: 18,
      maxDepthMeters: 34,
      currentNote: "Prone to current; drift experience is recommended. Carry an SMB.",
      divePlan:
        "Drift along the wall, no deeper than 34 m, and ascend with a safety stop on an SMB line. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote: "Deep wall with current, for Advanced Open Water divers or higher.",
      // Sourcing: the PADI article recommends Advanced Open Water or higher.
      // The main wall runs 18–34 m (two sources), so the Deep specialty applies; the current adds to the gate.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "southern-stingray",
        "spotted-eagle-ray",
        "green-sea-turtle",
        "giant-barrel-sponge",
        "common-sea-fan",
      ],
    },
  },
  // Denominator row: Pigeon Island
  {
    slug: "pigeon-island-dive",
    version: 1,
    area: "saint-lucia",
    sources: [
      "https://stlucia.org/en_uk/things-to-do/diving/",
      "https://blog.padi.com/5-must-dive-sites-st-lucia/",
      "https://www.easterncaribbeandivingstlucia.com/dive-sites-list",
      "https://www.underwaterphotography.com/dive-sites/Country.aspx?ID=418",
    ],
    briefing: {
      name: "Pigeon Island",
      locationName: "Pigeon Island, Gros Islet, Saint Lucia",

      // Approximate pin: the south shore of Pigeon Island, offshore of the park beach. The PADI article places the dive just offshore of the island, and the eastern Caribbean list says the southern side can be entered from the beach in the park; no source publishes coordinates.
      forecastLatitude: 14.0895,
      forecastLongitude: -60.964,
      description:
        "Sand and coral that run to boulders and bommies at the base of Pigeon Island. Shallow areas on the north and south sides suit seahorses.",
      marineLife: "Spotted eagle rays · moray eels · barracuda · snappers · jacks",
      marineLifeDescription:
        "Rays pass over the boulder field, and the shallows hold small animals.",
      difficultyLevel: "beginner",
      depthMinMeters: 5,
      maxDepthMeters: 18,
      currentNote:
        "Reached by a short boat ride, or from the beach in the park on the south side. No entry hazard is documented. Current not documented; ask the crew on the day.",
      divePlan:
        "Follow the coral and boulders along the island's base, no deeper than 18 m, and turn the dive on your gas.",
      fitTone: "welcoming",
      fitNote: "A shallow, mixed reef held to 18 m.",
      // Sourcing: the PADI article lists it for all levels from Open Water up.
      creatureSlugs: [
        "spotted-eagle-ray",
        "spotted-moray",
        "great-barracuda",
        "schoolmaster-snapper",
        "longsnout-seahorse",
      ],
    },
  },
  // Denominator row: La Roche
  {
    slug: "la-roche",
    version: 1,
    area: "saint-lucia",
    sources: [
      "https://stlucia.org/en_uk/things-to-do/diving/",
      "https://stolentime.com/dive-sites-in-saint-lucia",
      "https://scubaverse.com/dive-guide/caribbean/saint-lucia/",
      "https://www.underwaterphotography.com/dive-sites/Country.aspx?ID=418",
    ],
    briefing: {
      name: "La Roche",
      locationName: "Pigeon Island, Gros Islet, Saint Lucia",

      // Approximate pin: a small rock about a quarter mile off Pigeon Island, outside Rodney Bay. The stolentime list and the Scubaverse guide place La Roche off Pigeon Island and the dive-site database puts it 15 minutes from Rodney Bay; direction not given, no coordinates published. Good to about 2 km.
      forecastLatitude: 14.087,
      forecastLongitude: -60.968,
      description:
        "Barrel O' Beef: a small island with canyon-like trenches and valleys, home to big lobsters and schools of southern sennet.",
      marineLife: "Spiny lobsters · southern sennet · barracuda · triggerfish",
      marineLifeDescription:
        "Big lobsters in the trenches; schools hang in the open water beside the rock.",
      difficultyLevel: "intermediate",
      depthMinMeters: 5,
      maxDepthMeters: 15,
      currentNote:
        "Strong currents are reported, and the site is a drift in the direction of the tide. Carry an SMB.",
      divePlan:
        "Drift over the trenches no deeper than 15 m, deploy the SMB in open water and ascend on it.",
      fitTone: "demanding",
      fitNote: "A small rock in open water with current, suited to advanced divers.",
      // Gated for the current: the Scubaverse guide calls it strong and recommends advanced divers. Depth alone (15 m) would not gate it.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "spiny-lobster",
        "great-barracuda",
        "gray-triggerfish",
        "sergeant-major",
        "southern-sennet",
      ],
    },
  },
  // Denominator row: Smugglers Cove
  {
    slug: "smugglers-cove-reef",
    version: 1,
    area: "saint-lucia",
    sources: [
      "https://stlucia.org/en_uk/things-to-do/diving/",
      "https://www.easterncaribbeandivingstlucia.com/dive-sites-list",
      "https://www.underwaterphotography.com/dive-sites/Country.aspx?ID=418",
    ],
    briefing: {
      name: "Smugglers Cove",
      locationName: "Smugglers Cove, Cap Estate, Gros Islet, Saint Lucia",

      // Approximate pin: offshore of Smugglers Cove beach at Cap Maison (OpenStreetMap beach point 14.1005, -60.9500), the reef just off it. The dive-site database places the site at the Cap Maison beach; the tourism board and the eastern Caribbean list say beach entry. No source publishes coordinates.
      forecastLatitude: 14.1005,
      forecastLongitude: -60.952,
      description:
        "A beach dive over trenches, shelves, rocks and coral heads, with sandy patches between.",
      marineLife: "Octopus · lobsters · trumpetfish · flying gurnards",
      marineLifeDescription: "Sandy patches hold gurnards and the rocks hide octopus and lobsters.",
      difficultyLevel: "beginner",
      depthMinMeters: 3,
      maxDepthMeters: 12,
      currentNote:
        "Sandy beach entry; No entry hazard is documented. Current not documented; ask the crew on the day. Some of the rocks hold small overhead spaces; stay out of them.",
      divePlan:
        "Enter from the beach, follow the trenches and shelves out to the coral heads, and return the same way. No deeper than 12 m.",
      fitTone: "welcoming",
      fitNote:
        "Shallow beach entry over rocks and trenches. Stay out of the overhead spaces in the rocks.",
      // Sourcing: the tourism board lists it for beginners.
      creatureSlugs: [
        "atlantic-common-octopus",
        "spiny-lobster",
        "trumpetfish",
        "bluehead-wrasse",
        "flying-gurnard",
      ],
    },
  },
  // Denominator row: Saline Point
  {
    slug: "saline-point",
    version: 1,
    area: "saint-lucia",
    sources: [
      "https://stlucia.org/en_uk/things-to-do/diving/",
      "https://www.easterncaribbeandivingstlucia.com/dive-sites-list",
    ],
    briefing: {
      name: "Saline Point",
      locationName: "Saline Point, Cap Estate, Gros Islet, Saint Lucia",

      // Approximate pin: offshore of Saline Point, the northernmost dive on the island. The tourism board and the eastern Caribbean list both put the site at Saline Point (in front of a hotel, beach entry); no source publishes coordinates.
      forecastLatitude: 14.1066,
      forecastLongitude: -60.95,
      description:
        "The island's northernmost dive: a shallow start at 6 m that deepens toward the point, with scorpionfish, puffers, grunts and rays. The shallows are also good snorkeling.",
      marineLife: "Scorpionfish · puffers · grunts · stingrays · eels",
      marineLifeDescription:
        "Check the sand and the ledges; rays rest in the open and eels in the rock.",
      difficultyLevel: "beginner",
      depthMinMeters: 6,
      maxDepthMeters: 18,
      currentNote:
        "Beach entry is possible; No entry hazard is documented. Current not documented; ask the crew on the day.",
      divePlan:
        "Enter from the beach, follow the bottom out toward the point as it deepens, and turn the dive before 18 m.",
      fitTone: "welcoming",
      fitNote: "Gentle shallows that deepen slowly toward the point, with an easy beach entry.",
      creatureSlugs: [
        "spotted-scorpionfish",
        "sharpnose-puffer",
        "bluestriped-grunt",
        "southern-stingray",
        "spotted-moray",
      ],
    },
  },
  // Denominator row: Keyhole Pinnacles
  {
    slug: "keyhole-pinnacles",
    version: 1,
    area: "saint-lucia",
    sources: [
      "https://stolentime.com/dive-sites-in-saint-lucia",
      "https://www.divessi.com/en/blog/st-lucia-678",
      "https://stlucia.org/en/things-to-do/diving/",
      "https://www.underwaterphotography.com/dive-sites/Country.aspx?ID=418",
    ],
    briefing: {
      name: "Keyhole Pinnacles",
      locationName: "Soufrière Bay, Soufrière, Saint Lucia",

      // Approximate pin: off the mouth of Soufrière Bay. The stolentime list puts the pinnacles outside the bay of Soufrière and the SSI article puts them in Soufrière Bay across from the Pitons; no source publishes coordinates. Good to about 2 km.
      forecastLatitude: 13.8535,
      forecastLongitude: -61.076,
      description:
        "Four volcanic pinnacles that rise from deep water to within a few feet of the surface, encrusted with black and orange gorgonians and whip corals. Beyond the plan the pinnacles fall away to great depth.",
      marineLife: "Trumpetfish · filefish · grouper · jacks · seahorses",
      marineLifeDescription:
        "Look for small animals in the gorgonians, and for grouper and jacks off the sides of the peaks.",
      conservationNote:
        "Inside the Soufrière Marine Management Area, which charges divers a user fee; confirm the current rate with the crew. Fishing and collecting are controlled here, so touch and take nothing.",
      difficultyLevel: "intermediate",
      depthMinMeters: 3,
      maxDepthMeters: 30,
      currentNote:
        "Open water between the pinnacles, and boats work the tops: ascend on the SMB, not up a pinnacle. Current not documented; ask the crew on the day. Medical care is far; confirm the boat's oxygen and plan.",
      divePlan:
        "Start on the top of a pinnacle, work down its side no deeper than 30 m, and finish with a safety stop on an SMB line in open water. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote:
        "Seamounts in open water, with the sea floor far below. The tops are easy; the sides are not.",
      // Gated for open water over seamounts that fall far past the plan, whose 30 m floor is ours (uwphoto lists 0-30 m typical). Not gated for depth alone.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "trumpetfish",
        "orangespotted-filefish",
        "black-grouper",
        "bar-jack",
        "longsnout-seahorse",
        "common-sea-fan",
      ],
    },
  },
  // Denominator row: Grand Caille
  {
    slug: "grand-caille",
    version: 1,
    area: "saint-lucia",
    sources: [
      "https://stlucia.org/en/things-to-do/diving/",
      "https://stolentime.com/dive-sites-in-saint-lucia",
      "https://scubastlucia.com/diving/",
      "https://www.viceroyhotelsandresorts.com/pt/node/1251",
    ],
    briefing: {
      name: "Grand Caille",
      locationName: "Anse Chastanet Bay, Soufrière, Saint Lucia",

      // Approximate pin: the headland at the edge of Anse Chastanet Bay. The tourism board says the dive returns over the lip into shallows near where Fairyland dives often end; the stolentime list gives no place, and no source publishes coordinates. Placed 280 m from the Fairyland pin.
      forecastLatitude: 13.8665,
      forecastLongitude: -61.085,
      description:
        "The Big House: boulders on a terrace starting at about 12 m, then the lip of a steep wall hung with deep-water gorgonians, whip corals, large brain corals and barrel sponges. Beyond the plan the wall falls to depth.",
      marineLife: "Gorgonians · whip corals · barrel sponges · barracuda",
      marineLifeDescription:
        "Gorgonians and whip corals hang on the wall. Large barracuda sometimes come in close.",
      conservationNote:
        "Inside the Soufrière Marine Management Area, which charges divers a user fee; confirm the current rate with the crew. Fishing and collecting are controlled here, so touch and take nothing.",
      difficultyLevel: "intermediate",
      depthMinMeters: 12,
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Over the terrace, along the wall no deeper than 30 m, then back over the lip into the shallows. Safety stop on the boat's line or an SMB. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote: "A wall dive with a plan floor. The terrace is gentle; the wall beyond it is not.",
      // The sources describe a sheer wall below a 12-15 m terrace; the plan's 30 m floor is ours, so it is gated Advanced Open Water.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "great-barracuda",
        "giant-barrel-sponge",
        "boulder-brain-coral",
        "common-sea-fan",
        "sea-plume",
      ],
    },
  },
  // Denominator row: Virgin's Cove
  {
    slug: "virgins-cove",
    version: 1,
    area: "saint-lucia",
    sources: [
      "https://stlucia.org/en/things-to-do/diving/",
      "https://stolentime.com/dive-sites-in-saint-lucia",
      "https://www.easterncaribbeandivingstlucia.com/dive-sites-list",
    ],
    briefing: {
      name: "Virgin's Cove",
      locationName: "Anse La Raye, Saint Lucia",

      // Sources disagree on depth (21 m and 30 m), so the deeper is used. A wall dive lies near the north point in a source, but it is not part of this plan. Approximate pin: the coast of Anse La Raye. The tourism board lists Virgin's Cove at Anse La Raye, with a cross on the point above the site; no other source names a place and none publishes coordinates. Placed 670 m from the Anse La Raye Wall pin. Good to about 2 km.
      forecastLatitude: 13.9455,
      forecastLongitude: -61.049,
      description:
        "A sheltered coral garden on a plateau at about 12 m that slopes to deeper water, with large barrel sponges, brain coral and stingrays.",
      marineLife: "Stingrays · yellowtail snappers · barracuda · barrel sponges",
      marineLifeDescription:
        "Rays rest on the sand between the coral formations, and snappers hold above the garden.",
      difficultyLevel: "advanced",
      depthMinMeters: 12,
      maxDepthMeters: 30,
      currentNote:
        "A slight current near the points; the lagoon itself is sheltered. Carry an SMB.",
      divePlan:
        "Across the plateau, along the slope no deeper than 30 m, with a safety stop on the boat's line or an SMB.",
      fitTone: "unknown",
      fitNote: "A sheltered garden at 12 m that slopes to deeper water; the plan holds 30 m.",
      // Gate: a plateau that slopes to deeper water held at a 30 m plan floor, as the other
      // Saint Lucia slopes; no source says operators run it as an Open Water terrace dive, so it
      // takes Advanced Open Water.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "southern-stingray",
        "giant-barrel-sponge",
        "boulder-brain-coral",
        "yellowtail-snapper",
        "great-barracuda",
      ],
    },
  },
  // Denominator row: Bone Yard
  {
    slug: "bone-yard",
    version: 1,
    area: "saint-lucia",
    sources: [
      "https://stlucia.org/en_uk/things-to-do/diving/",
      "https://www.easterncaribbeandivingstlucia.com/dive-sites-list",
    ],
    briefing: {
      name: "Bone Yard",
      locationName: "Castries Harbor, Castries, Saint Lucia",

      // Approximate pin: the north side of the mouth of Castries Harbor, off Vigie. The tourism board and the eastern Caribbean list both place the site on the northern side of the harbor mouth; no source publishes coordinates.
      forecastLatitude: 14.02,
      forecastLongitude: -61.008,
      description:
        "A World War II vessel and what looks like an airplane wing on the north side of the harbor mouth, home to lobsters and tropical fish.",
      marineLife: "Spiny lobsters · tropical reef fish",
      marineLifeDescription: "Lobsters sit in the wreckage and small reef fish gather around it.",
      difficultyLevel: "intermediate",
      depthMinMeters: 11,
      maxDepthMeters: 14,
      currentNote:
        "Mouth of Castries Harbor: ships use the entrance. No diving while a ship is moving or alongside, carry an SMB and listen for engines. Current not documented; ask the crew on the day.",
      divePlan:
        "Down to the wreckage, a slow look around the outside, and up with a safety stop on an SMB line. Stay outside the hull.",
      fitTone: "welcoming",
      fitNote:
        "Shallow wreckage by a working harbor, so the traffic is the thing to plan around. Stay outside the hull.",
      creatureSlugs: ["spiny-lobster", "french-grunt", "sergeant-major", "bluehead-wrasse"],
    },
  },
  // Denominator row: Daini Koyomaru
  {
    slug: "daini-koyomaru-wreck",
    version: 1,
    area: "saint-lucia",
    sources: [
      "https://smmainc.com/dive-sites/",
      "https://www.easterncaribbeandivingstlucia.com/dive-sites-list",
      "https://www.moorings.com/blog/best-diving-st-lucia",
      "https://stlucia.org/en/things-to-do/diving/",
      "https://divingaway.com/en/wreck-335/daini-koyomaru",
    ],
    briefing: {
      name: "Daini Koyomaru",
      locationName: "Anse Cochon, Anse La Raye, Saint Lucia",

      // Approximate pin: the south end of Anse Cochon Bay. The Soufrière Marine Management Association
      // says the dredger was sunk at the south end of Anse Cochon, Divingaway puts it south of Anse
      // Cochon and the Moorings guide close to Anse Cochon; no operator publishes coordinates (one
      // crowd-sourced directory gives 13.91306, -61.09404, about 3.4 km west of this pin, which no
      // other source supports, so it is not used). OpenStreetMap maps the bay at 13.9273, -61.0590 and
      // its southern neighbor Anse la Verdure at 13.9204, -61.0608. Placed in the water 427 m offshore
      // of the mapped coast, 389 m from the Vicky B pin and 558 m from the SK2 pin. Good to about 2 km.
      // Depth: the management association, Saint Lucia's tourist board and Divingaway give 33 m (108
      // ft), the operator list 110 ft and the Moorings guide 10 m to 33 m; the deepest is used. How she
      // lies is reported two ways (on her side per the association and the tourist board, inverted per
      // one diver's account), so the text says no more than that she is on her side, on a slope that
      // runs from about 10 m to 33 m (the Moorings guide). No source names a mooring or a line, so the
      // plan has the crew set one. No source gives the seabed past her, so the plan stays with the
      // wreck. No source mentions boat traffic at Anse Cochon, so there is no traffic line.
      forecastLatitude: 13.9235,
      forecastLongitude: -61.064,
      description:
        "A Japanese dredger 75 m long, put down in 1996 to make a reef. She is a wreck lying on her side on a slope, with eels, barracuda and jacks around her.",
      marineLife: "Green moray · barracuda · horse-eye jack · angelfish · turtles",
      marineLifeDescription:
        "Morays sit in the plating, so do not reach into it. Barracuda and jacks hold along the hull.",
      difficultyLevel: "advanced",
      depthMinMeters: 10,
      maxDepthMeters: 33,
      currentNote:
        "Strong currents are reported in the area of the wreck. If the current is running at the surface, the crew may call the dive. Open water: carry an SMB.",
      divePlan:
        "Descend together on a line the crew sets; do not free-descend in current. Work along the outside of the wreck from her shallowest part near 10 m, keep the gauge in view as she falls toward 33 m (108 ft), the limit, and ascend together on one SMB line, deployed at the stop and not at depth, with reserve gas. The seabed past her is not documented; stay with the wreck. Stay outside the hull. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote:
        "A big wreck down to 33 m in a strong current. For divers with deep training who read their gauge.",
      // Gate: the deepest point is 33 m, so maxDepthMeters is 33 and the Deep specialty joins
      // Advanced Open Water. The management association recommends the wreck for experienced divers
      // because of depth and current.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: ["green-moray", "great-barracuda", "horse-eye-jack", "green-sea-turtle"],
    },
  },
];
