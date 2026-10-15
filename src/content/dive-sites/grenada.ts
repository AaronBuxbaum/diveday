// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Grenada and Carriacou. */
export const GRENADA: DiveSiteTemplate[] = [
  {
    // Approximate pin: Moliniere Bay, just south of Moliniere Point (geocoded with Nominatim; PADI places Dragon Bay just north). Eco Dive, Native Spirit and Caribbean Authority tie the park to Molinere Bay. No source publishes coordinates.
    slug: "molinere-underwater-sculpture-park",
    version: 1,
    area: "grenada",
    sources: [
      "https://nativespiritscuba.com/signature-dive-sites/",
      "https://dan.org/alert-diver/article/grenada/",
      "https://caribbeanauthority.com/18-unmissable-dive-sites-in-grenada-videos-included/",
      "https://www.ecodivegrenada.com/about-us/dive-sites/",
    ],
    briefing: {
      name: "Molinere Underwater Sculpture Park",
      locationName: "Molinere Bay, Grenada",
      forecastLatitude: 12.0815,
      forecastLongitude: -61.764,
      description:
        "A gallery of life-sized figures and geometric forms by the artist Jason deCaires Taylor, sunk in a marine protected area to become reef. Shallow and clear, and made for looking slowly.",
      marineLife: "Parrotfish · damselfish · jawfish · sea plumes",
      marineLifeDescription:
        "Fish and crustaceans move in and out of the figures, while coral and other growth settles on the stone. Keep your fins off the figures.",
      conservationNote:
        "Inside Grenada's Molinere marine protected area, where a park permit is required; the crew arranges it, so confirm the cost on the day. Touch and take nothing.",
      difficultyLevel: "beginner",
      depthRange: "5–9 m (15–30 ft)",
      maxDepthMeters: 9,
      currentNote:
        "Snorkelers and tour boats above: ascend on the line or an SMB and look up. Described as calm; no current is documented, so ask the crew on the day.",
      divePlan:
        "Start at the first figures, circle each group once, and keep your fins off the figures. Work back along the shallow edge of the reef.",
      fitTone: "welcoming",
      fitNote:
        "Shallow enough for a long, unhurried dive, and a kind first look at Grenada for a newly certified diver.",
      creatureSlugs: [
        "queen-parrotfish",
        "threespot-damselfish",
        "yellowhead-jawfish",
        "sea-plume",
        "black-sea-rod",
        "spiny-lobster",
      ],
    },
  },
  {
    // Position from PADI's published point (12.08834, -61.76308); Nominatim's Dragon Bay lies about 300 m from it. Depth: Eco Dive 5–28 m, Native Spirit 8–29 m; the deeper figure is kept. A steep slope with a listed foot, so no plan floor is needed and no depth gate.
    slug: "dragon-bay-reef",
    version: 1,
    area: "grenada",
    sources: [
      "https://www.ecodivegrenada.com/about-us/dive-sites/",
      "https://nativespiritscuba.com/reefs/",
      "https://www.padi.com/dive-site/grenada/dragon-bay/",
    ],
    briefing: {
      name: "Dragon Bay Reef",
      locationName: "Dragon Bay, Grenada",
      forecastLatitude: 12.0883,
      forecastLongitude: -61.7631,
      description:
        "Finger-shaped coral patches and sand channels cut through angular volcanic rock in the shallows, then a steep slope running south toward Molinere Point. A small tugboat wreck lies on the way.",
      marineLife: "Grouper · French angelfish · chromis · spotted moray",
      marineLifeDescription:
        "Morays tuck into the rock crevices, and clouds of chromis hang over the slope.",
      conservationNote:
        "Inside Grenada's Molinere marine protected area, where a park permit is required; the crew arranges it, so confirm the cost on the day. Touch and take nothing.",
      difficultyLevel: "intermediate",
      depthRange: "5–29 m (15–95 ft)",
      maxDepthMeters: 29,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Cross the coral patches, look at the tugboat from outside, and turn along the slope with the shallow rock for the way back. Open Water divers hold the slope no deeper than 18 m; deeper only with Advanced Open Water. Stay outside the hull.",
      fitTone: "unknown",
      fitNote:
        "Shallow rock and sand to start, and a slope that runs to 29 m. Open Water divers stay above 18 m.",
      creatureSlugs: [
        "french-angelfish",
        "brown-chromis",
        "spotted-moray",
        "black-sea-rod",
        "sea-plume",
        "common-sea-fan",
      ],
    },
  },
  {
    // Position from PADI's published point (12.09165, -61.75801); Nominatim's Flamingo Bay lies within 150 m. Depth: Eco Dive and Native Spirit give 28 m (90 ft), DAN reports it ranging past 100 ft; the deeper figure is kept as the plan's floor. Gate is Advanced Open Water because the wall is not bounded in the sources and the plan floor is the 30 m figure. The shallow bay itself is an Open Water snorkel and dive a shop can open by lowering this.
    slug: "flamingo-bay",
    version: 1,
    area: "grenada",
    sources: [
      "https://www.ecodivegrenada.com/about-us/dive-sites/",
      "https://nativespiritscuba.com/reefs/",
      "https://www.padi.com/dive-site/grenada/flamingo-bay/",
      "https://dan.org/alert-diver/article/grenada/",
    ],
    briefing: {
      name: "Flamingo Bay",
      locationName: "Flamingo Bay, Grenada",
      forecastLatitude: 12.0917,
      forecastLongitude: -61.758,
      description:
        "A fringing reef in the Grenada Marine Park. A protected shallow bay gives way to a wall and steep slope hung with whip coral, sponges and sea fans.",
      marineLife: "Chromis · squirrelfish · parrotfish · grouper",
      marineLifeDescription:
        "Blue clouds of chromis stream along the slope, with squirrelfish in the crannies and jacks and rays lower on the wall.",
      conservationNote:
        "Inside Grenada's Molinere marine protected area, where a park permit is required; the crew arranges it, so confirm the cost on the day. Touch and take nothing.",
      difficultyLevel: "intermediate",
      depthRange: "5–30 m (15–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "Sheltered in the bay; current not documented along the wall, so ask the crew on the day.",
      divePlan:
        "Drop into the bay, follow the slope out to the wall, and hold no deeper than 30 m (100 ft). Come back up the reef with reserve gas.",
      fitTone: "demanding",
      fitNote:
        "Gentle in the bay and serious on the wall. The depth rating decides which part of the dive is yours.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "brown-chromis",
        "blue-chromis",
        "longjaw-squirrelfish",
        "queen-parrotfish",
        "common-sea-fan",
        "sea-plume",
      ],
    },
  },
  {
    // Position from PADI's published point (12.09094, -61.76054), 280 m from PADI's Flamingo Bay point. Depth: Eco Dive and PADI give 6–28 m, Native Spirit's listing says 6–30 m and its text 9–37 m; the deepest figure is kept, so the gate is Advanced Open Water with Deep. The sunken cars are Native Spirit's note.
    slug: "happy-valley",
    version: 1,
    area: "grenada",
    sources: [
      "https://www.ecodivegrenada.com/about-us/dive-sites/",
      "https://nativespiritscuba.com/reefs/",
      "https://www.padi.com/dive-site/grenada/happy-valley/",
    ],
    briefing: {
      name: "Happy Valley",
      locationName: "Happy Valley, Grenada",
      forecastLatitude: 12.0909,
      forecastLongitude: -61.7605,
      description:
        "A wall that starts in a shallow forest of brown coral and shelves down through gorgonians and pillar coral, with an old Admiralty anchor resting on it. Sunken cars also lie on the slope, now furred with sponges.",
      marineLife: "Pillar coral · gorgonians · grouper · snapper",
      marineLifeDescription:
        "Reef fish gather around the pillar coral and the sunken cars. Look at the cars from outside.",
      conservationNote:
        "Inside Grenada's Molinere marine protected area, where a park permit is required; the crew arranges it, so confirm the cost on the day. Touch and take nothing.",
      difficultyLevel: "advanced",
      depthRange: "6–37 m (20–120 ft)",
      maxDepthMeters: 37,
      currentNote:
        "When the tide runs it becomes a gentle drift south toward Dragon Bay. Carry an SMB.",
      divePlan:
        "Start in the shallow coral, follow the wall down no deeper than 37 m (120 ft), and drift back up the slope toward Dragon Bay. Stay outside the sunken cars. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote:
        "The shallow start is easy and the wall is not. Plan the dive from the deepest figure, not the shallowest.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "pillar-coral",
        "encrusting-gorgonian",
        "common-sea-fan",
        "black-grouper",
        "schoolmaster-snapper",
        "sea-plume",
      ],
    },
  },
  {
    // Approximate pin: the middle section of the reef off Grand Anse Beach, just outside St. George's harbor (Eco Dive, Native Spirit and Active Caribbean Travel all place the reef outside the harbor and off Grand Anse). No source publishes coordinates; at least 200 m from every neighboring pin.
    slug: "boss-reef",
    version: 1,
    area: "grenada",
    sources: [
      "https://www.ecodivegrenada.com/about-us/dive-sites/",
      "https://nativespiritscuba.com/reefs/",
      "https://activecaribbeantravel.com/grenada-diving/grenada-diving-st-georges-harbour-and-grand-anse-marine-protected-area/",
    ],
    briefing: {
      name: "Boss Reef",
      locationName: "Grand Anse Marine Protected Area, Grenada",
      forecastLatitude: 12.031,
      forecastLongitude: -61.765,
      description:
        "A long, gently sloping reef that starts just outside St. George's harbor and runs southwest, cut by sand patches and canyons. It divides into three sections, with hard coral in the east and gorgonians, sea plumes and staghorn coral in the west.",
      marineLife: "Creole wrasse · lobster · stingrays · octopus",
      marineLifeDescription:
        "Creole wrasse stream over the reef in numbers, with moray eels and cleaner fish in the structure.",
      difficultyLevel: "intermediate",
      depthRange: "6–25 m (20–80 ft)",
      maxDepthMeters: 25,
      currentNote:
        "Ship traffic from St. George's harbor reaches this reef. No diving while a ship is moving or alongside, listen for engines and carry an SMB. Otherwise no current is documented.",
      divePlan:
        "Pick one section for the dive and follow the slope along the sand patches. Open Water divers turn at 18 m; others hold the depth the crew sets, no deeper than 25 m (80 ft).",
      fitTone: "unknown",
      fitNote:
        "A slope that runs to 25 m. Which section you dive depends on the day's conditions and the crew.",
      creatureSlugs: [
        "creole-wrasse",
        "spiny-lobster",
        "southern-stingray",
        "queen-conch",
        "caribbean-reef-octopus",
        "staghorn-coral",
      ],
    },
  },
  {
    // Position from PADI's published point (12.02001, -61.78968); an Active Caribbean-style shop listing puts the reef about 1 km from Grand Anse. DAN groups Kohanee with the adjacent Black Wall at 30–90 ft; this template keeps Kahonee's own 10–15 m range. Native Spirit calls the current consistent and the dive usually a drift, which gives no strength figure, so the conservative reading gates Advanced Open Water.
    slug: "kahonee",
    version: 1,
    area: "grenada",
    sources: [
      "https://www.ecodivegrenada.com/about-us/dive-sites/",
      "https://nativespiritscuba.com/reefs/",
      "https://www.padi.com/dive-site/grenada/kahonee/",
    ],
    briefing: {
      name: "Kahonee",
      locationName: "Grand Anse, Grenada",
      forecastLatitude: 12.02,
      forecastLongitude: -61.7897,
      description:
        "An undulating patch reef where glades of pale sand alternate with thickets of coral, purple sea fans, sponges and brain coral domes, bordered by sandy channels.",
      marineLife: "Lobster · spotted moray · nurse shark · stingrays",
      marineLifeDescription:
        "Nurse sharks are often asleep on the sand, and lobsters and morays sit in the coral thickets.",
      difficultyLevel: "advanced",
      depthRange: "10–15 m (30–50 ft)",
      maxDepthMeters: 15,
      currentNote:
        "A consistent current, so the dive is usually run as a drift; its strength is not documented. Carry an SMB.",
      divePlan:
        "Drift along the patches with the current, make the safety stop on an SMB line, and let the crew pick you up. The crew briefs a turn at 15 m. The sandy channels are the easy way to find your direction.",
      minimumCertificationLevel: "advanced_open_water",
      fitTone: "unknown",
      fitNote: "Shallow and colorful. The consistent current is the one thing to plan for.",
      creatureSlugs: [
        "spiny-lobster",
        "spotted-moray",
        "nurse-shark",
        "southern-stingray",
        "common-sea-fan",
        "grooved-brain-coral",
      ],
    },
  },
  {
    // Position from PADI's published point (12.01968, -61.80067). Depth: Eco Dive 6–25 m, Native Spirit 11–30 m; the deeper figure is kept. The gate is Advanced Open Water for the current, not the depth: Eco Dive puts it at a steady 2 knots.
    slug: "purple-rain",
    version: 1,
    area: "grenada",
    sources: [
      "https://www.ecodivegrenada.com/about-us/dive-sites/",
      "https://nativespiritscuba.com/reefs/",
      "https://www.padi.com/dive-site/grenada/purple-rain/",
    ],
    briefing: {
      name: "Purple Rain",
      locationName: "Grand Anse, Grenada",
      forecastLatitude: 12.0197,
      forecastLongitude: -61.8007,
      description:
        "A reef that runs parallel to the coast, named for the Creole wrasse that pour over it in schools. Run as a drift, with sponges and coral along the way.",
      marineLife: "Creole wrasse · barracuda · morays · lobster",
      marineLifeDescription:
        "Wrasse in the hundreds, with rays, turtles and angelfish working the reef.",
      difficultyLevel: "advanced",
      depthRange: "6–30 m (20–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "A steady current of about 2 knots; this is a drift dive. Carry an SMB and stay with the group.",
      divePlan:
        "Descend together, drift along the reef with the current, and ascend on an SMB line for the safety stop. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote: "The current sets the pace, and the crew picks you up at the end of the drift.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "creole-wrasse",
        "great-barracuda",
        "spotted-moray",
        "giant-barrel-sponge",
        "spiny-lobster",
        "nurse-shark",
      ],
    },
  },
  {
    // The sources document no shark season, so none is stated. Position from PADI's published point (11.98139, -61.78179), just off the south shore. Depth: Eco Dive 10–20 m, Native Spirit 11–21 m, PADI's maximum says 17 m; the deepest figure is kept. The gate is Advanced Open Water for the strong current and Atlantic exposure.
    slug: "shark-reef-grenada",
    version: 1,
    area: "grenada",
    sources: [
      "https://www.ecodivegrenada.com/about-us/dive-sites/",
      "https://nativespiritscuba.com/reefs/",
      "https://www.padi.com/dive-site/grenada/shark-reef/",
    ],
    briefing: {
      name: "Shark Reef",
      locationName: "South coast, Grenada",
      forecastLatitude: 11.9814,
      forecastLongitude: -61.7818,
      description:
        "A drift dive just off the south shore, open to the Atlantic. Stingrays, nurse sharks, eagle rays and turtles are reported over a reef of coral mounds and sand, with a pillar coral shaped like a giraffe.",
      marineLife: "Southern stingray · nurse shark · eagle ray · queen conch",
      marineLifeDescription:
        "Stingrays and nurse sharks rest on the sand or ride the current; conch and lobster work the coral mounds. Sightings are not promised.",
      difficultyLevel: "advanced",
      depthRange: "10–21 m (35–70 ft)",
      maxDepthMeters: 21,
      currentNote:
        "Strong and variable, with rougher surface conditions on the Atlantic side. Run as a drift; carry an SMB.",
      divePlan:
        "Descend as a group and drift along the reef. If sharks or rays appear, stay put, keep nothing dangling, do not chase or touch them, group together and follow the crew's briefing. The season is not documented, so ask the crew what the dive offers on the day. Ascend on an SMB line. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote:
        "Shallow, but the Atlantic current is the whole dive. A diver comfortable in a strong drift will enjoy it.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "southern-stingray",
        "nurse-shark",
        "spotted-eagle-ray",
        "queen-conch",
        "spiny-lobster",
        "pillar-coral",
      ],
    },
  },
  {
    // Approximate pin: beside the Bianca C, in the Grand Anse Marine Protected Area (Native Spirit routes the Bianca C dive across to Whibble Reef; X-Ray Magazine and Active Caribbean Travel place it in the same area). No source publishes coordinates; Bianca C's pin is ours and about 400 m away. Depth: Eco Dive 15–30 m, Native Spirit 18–30 m, with a sand wall to about 50 m in other sources; the plan floor is 30 m, so the gate is Advanced Open Water (a sloping sand wall that falls away past it, run as a drift).
    slug: "whibble-reef",
    version: 1,
    area: "grenada",
    sources: [
      "https://www.ecodivegrenada.com/about-us/dive-sites/",
      "https://nativespiritscuba.com/reefs/",
      "https://activecaribbeantravel.com/grenada-diving/grenada-diving-st-georges-harbour-and-grand-anse-marine-protected-area/",
      "https://xray-mag.com/content/grenada-spice-isle-caribbean",
    ],
    briefing: {
      name: "Whibble Reef",
      locationName: "Grand Anse Marine Protected Area, Grenada",
      forecastLatitude: 12.0335,
      forecastLongitude: -61.7805,
      description:
        "A sloping sand wall that drops away into deeper water, dived as a drift. It is dived separately after the Bianca C, after a surface interval, with star boulder and brain coral in good condition.",
      marineLife: "Jacks · rainbow runners · wrasse · eagle rays",
      marineLifeDescription:
        "Jacks and rainbow runners patrol the slope, with lobsters in the coral and turtles and eagle rays passing.",
      difficultyLevel: "advanced",
      depthRange: "15–30 m (50–100 ft)",
      maxDepthMeters: 30,
      currentNote: "Run as a drift; current strength is not documented. Carry an SMB.",
      divePlan:
        "Drift along the slope no deeper than 30 m (100 ft), turn up the reef with reserve gas, and make the safety stop on an SMB line. The sand wall falls away past the plan's floor.",
      fitTone: "demanding",
      fitNote:
        "A drift along a wall that does not end where the plan does. Staff confirm the diver's log before boarding.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "horse-eye-jack",
        "great-barracuda",
        "spotted-eagle-ray",
        "spiny-lobster",
        "bluehead-wrasse",
        "boulder-star-coral",
        "rainbow-runner",
      ],
    },
  },
  {
    // Approximate pin: the start of Boss Reef off Grand Anse Beach (Bradt places the wreck off Grand Anse Beach; Eco Dive and Native Spirit tie it to Boss Reef). No source publishes coordinates. Depth: Eco Dive 6–15 m, Native Spirit 9–15 m, Aquanauts 17 m; the deepest is kept. Native Spirit says the current is minimal, one account found it strong; the note says it varies.
    slug: "veronica-l-wreck",
    version: 1,
    area: "grenada",
    sources: [
      "https://www.ecodivegrenada.com/about-us/dive-sites/",
      "https://nativespiritscuba.com/wrecks/",
      "https://www.aquanautsgrenada.com/the-sunken-trail",
      "https://www.bradtguides.com/grenadas-best-wreck-dives/",
    ],
    briefing: {
      name: "Veronica L Wreck",
      locationName: "Grand Anse, Grenada",
      forecastLatitude: 12.036,
      forecastLongitude: -61.764,
      description:
        "A 120 ft cargo barge with an open hold, deck machinery and a freight crane, moved from the mouth of St. George's harbor to make room for the cruise terminal and set upright on the reef.",
      marineLife: "Squirrelfish · trumpetfish · frogfish · seahorses",
      marineLifeDescription:
        "Small animals live in the machinery and crane, and the wreck is also dived at night.",
      difficultyLevel: "intermediate",
      depthRange: "6–17 m (20–55 ft)",
      maxDepthMeters: 17,
      currentNote:
        "Ship traffic from St. George's harbor reaches this reef. No diving while a ship is moving or alongside, listen for engines and carry an SMB. Current is minimal on some days and strong enough on others.",
      divePlan:
        "Circle the barge once from outside, then carry on into the shallow reef beyond. The open hold is a way into the hull; stay out of it. Stay outside the hull.",
      fitTone: "unknown",
      fitNote: "Shallow and compact, to 17 m. Check the day's current before the dive.",
      creatureSlugs: [
        "squirrelfish",
        "trumpetfish",
        "longlure-frogfish",
        "banded-coral-shrimp",
        "longsnout-seahorse",
        "spotted-moray",
      ],
    },
  },
  {
    // Approximate pin (moved off the Quarantine Point headland into the water, 450 m west of the Tyrrel Bay pin): the edge of the Grand Anse reef, in the Grand Anse Marine Protected Area (Native Spirit says it lies at the edge of Grand Anse Reef; Active Caribbean Travel lists it in the Grand Anse protected area). No source publishes coordinates. Depth: Native Spirit 11–14 m, Aquanauts 11 m, Active Caribbean 6–20 m; the deepest is kept.
    slug: "quarter-wreck",
    version: 1,
    area: "grenada",
    sources: [
      "https://nativespiritscuba.com/wrecks/",
      "https://www.aquanautsgrenada.com/the-sunken-trail",
      "https://activecaribbeantravel.com/grenada-diving/grenada-diving-st-georges-harbour-and-grand-anse-marine-protected-area/",
    ],
    briefing: {
      name: "Quarter Wreck",
      locationName: "Grand Anse Marine Protected Area, Grenada",
      forecastLatitude: 12.0265,
      forecastLongitude: -61.7705,
      description:
        "The stern section of a large cargo ship, with its propeller, deckhouse and engine still in place, lying at the edge of the Grand Anse reef.",
      marineLife: "Reef fish · hard coral · sponges",
      marineLifeDescription:
        "Coral is healthiest on the deeper parts of the wreck, with reef fish around the propeller and deckhouse.",
      difficultyLevel: "intermediate",
      depthRange: "6–20 m (20–70 ft)",
      maxDepthMeters: 20,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Start at the propeller, work forward along the outside of the deckhouse, and finish over the reef. Open Water divers turn at 18 m. Stay outside the hull.",
      fitTone: "unknown",
      fitNote: "A recognizable wreck to 20 m. Open Water divers turn at 18 m.",
      creatureSlugs: ["sergeant-major", "bluehead-wrasse", "brown-chromis", "common-sea-fan"],
    },
  },
  {
    // Approximate pin: about 2.5 km west of Grand Anse Beach (Wikipedia says about 2 km off the beach, X-Ray Magazine about 3 km). No source publishes coordinates. Depth: Eco Dive 28–40 m, Native Spirit 27–43 m, Aquanauts 50 m; recreational limit applies, so the template caps at 40 m and the prose says the sand lies deeper. Gate is Advanced Open Water with Deep and strong current. The catalog never recommends a gas mix.
    slug: "bianca-c-wreck",
    version: 1,
    area: "grenada",
    sources: [
      "https://www.ecodivegrenada.com/about-us/dive-sites/",
      "https://nativespiritscuba.com/signature-dive-sites/",
      "https://www.aquanautsgrenada.com/the-sunken-trail",
      "https://xray-mag.com/content/grenada-spice-isle-caribbean",
      "https://en.wikipedia.org/wiki/MV_Bianca_C",
    ],
    briefing: {
      name: "Bianca C Wreck",
      locationName: "Grand Anse, Grenada",
      forecastLatitude: 12.03,
      forecastLongitude: -61.779,
      description:
        "A 600 ft cruise liner that caught fire in St. George's harbor in 1961 and sank upright. The top of the wreck lies about 27 m down, the bow is intact, and the deck pool is a landmark. The stern collapsed in the 1990s, and the sand lies at about 50 m, beyond recreational depth.",
      marineLife: "Barracuda · eagle rays · jacks · black coral",
      marineLifeDescription:
        "Jacks and barracuda hang above the hull, and the deeper steel carries black coral, hydroids and sponges.",
      difficultyLevel: "advanced",
      depthRange: "27–40 m (90–130 ft)",
      maxDepthMeters: 40,
      currentNote:
        "Strong tidal current; the boat drops divers up-current of the wreck. Carry an SMB.",
      divePlan:
        "Descend together on the line or the crew's drop, equalize early, and hold the descent rate the crew sets. Follow the deck toward the bow and begin the ascent early, with the safety stop on an SMB line. Bottom time is about 10 minutes, so plan more than one dive; Whibble Reef is a separate dive after a surface interval. Staff confirm the diver's log before boarding, and many operators ask for a checkout dive first. Stay outside the hull.",
      fitTone: "demanding",
      fitNote: "A serious dive. Depth, current and short bottom time all apply.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "great-barracuda",
        "spotted-eagle-ray",
        "horse-eye-jack",
        "black-coral",
        "nurse-shark",
        "atlantic-spadefish",
      ],
    },
  },
  {
    // Approximate pin: 3 miles south of Point Salines (Eco Dive, Native Spirit and Bradt each give about 3 miles off the south coast; DAN says 2). No source publishes coordinates. Depth: Eco Dive 28–33 m, Native Spirit 30 m, Aquanauts 31 m, Bradt 100 ft.
    slug: "hema-1-wreck",
    version: 1,
    area: "grenada",
    sources: [
      "https://www.ecodivegrenada.com/about-us/dive-sites/",
      "https://nativespiritscuba.com/wrecks/",
      "https://www.aquanautsgrenada.com/the-sunken-trail",
      "https://www.bradtguides.com/grenadas-best-wreck-dives/",
    ],
    briefing: {
      name: "Hema 1 Wreck",
      locationName: "South coast, Grenada",
      forecastLatitude: 11.96,
      forecastLongitude: -61.79,
      description:
        "A 170 ft coastal freighter that sank in the mid-2000s and lies on its side about 3 miles off the south coast. The Atlantic current moves over her. Nurse sharks, reef sharks and eagle rays are reported here, and sightings are not promised.",
      marineLife: "Nurse shark · reef shark · eagle ray · lobster",
      marineLifeDescription: "Sharks and rays use the hull and the current alongside it.",
      difficultyLevel: "advanced",
      depthRange: "28–33 m (90–110 ft)",
      maxDepthMeters: 33,
      currentNote:
        "Strong current, run as a drift, with rough surface conditions. Carry an SMB. Medical care is far; confirm the boat's oxygen and plan.",
      divePlan:
        "Drift onto the hull with the group and keep the sharks at a distance: if sharks appear, stay put, keep nothing dangling, do not chase or touch them, and follow the crew's briefing. Begin the ascent early, deploy the SMB at the start and make the safety stop on it. Stay outside the hull. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote: "Deep, open and fast. For a diver with the depth card and recent drift experience.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: ["nurse-shark", "caribbean-reef-shark", "spotted-eagle-ray", "spiny-lobster"],
    },
  },
  {
    // Position from PADI's published point (12.02455, -61.78565), off Quarantine Point per Eco Dive; Nominatim puts Quarantine Point about 1.2 km east of it. Depth: Eco Dive and PADI 16–30 m, Native Spirit 24–28 m, Aquanauts 31 m, Bradt 105 ft (32 m); the deepest is kept, so the gate is Advanced Open Water with Deep.
    slug: "shakem-wreck",
    version: 1,
    area: "grenada",
    sources: [
      "https://www.ecodivegrenada.com/about-us/dive-sites/",
      "https://nativespiritscuba.com/wrecks/",
      "https://www.padi.com/dive-site/grenada/shakem/",
      "https://www.bradtguides.com/grenadas-best-wreck-dives/",
    ],
    briefing: {
      name: "Shakem Wreck",
      locationName: "Quarantine Point, Grenada",
      forecastLatitude: 12.0246,
      forecastLongitude: -61.7857,
      description:
        "A 180 ft freighter that capsized in a storm in 2001 and now sits upright. A central crane overhangs the cargo hold, still full of cement bags, and a spiral tower rises toward the bridge.",
      marineLife: "Gorgonians · hydroids · sponges · green moray",
      marineLifeDescription:
        "Black gorgonians, hydroids and sponges cover the structure, with seahorses and lobsters on a good day.",
      difficultyLevel: "advanced",
      depthRange: "16–32 m (55–105 ft)",
      maxDepthMeters: 32,
      currentNote:
        "The wreck is near the harbor entrance: no diving while a ship is moving or alongside, listen for engines and carry an SMB. Otherwise described as calm and manageable.",
      divePlan:
        "Down the line to the deck, along the outside of the hull past the crane and tower, and back up with reserve gas. Stay outside the hull.",
      fitTone: "demanding",
      fitNote: "Upright, intact and deep. Staff confirm the diver's log before boarding.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "green-moray",
        "spiny-lobster",
        "longsnout-seahorse",
        "encrusting-gorgonian",
        "red-rope-sponge",
      ],
    },
  },
  {
    // Native Spirit notes recent storm damage on the nearby reef. Gate: the wreck lies at 18-27 m, so no part of it is an Open Water dive. Approximate pin: about 300 m west of the Molinere sculpture-park pin, at the base of the Molinere Bay reef wall (Eco Dive, X-Ray Magazine and Native Spirit tie the wreck to the Molinere reef). No source publishes coordinates. Depth: Eco Dive 18–25 m, Aquanauts 22 m, Native Spirit 27 m; the deepest is kept.
    slug: "buccaneer-wreck",
    version: 1,
    area: "grenada",
    sources: [
      "https://www.ecodivegrenada.com/about-us/dive-sites/",
      "https://nativespiritscuba.com/wrecks/",
      "https://www.aquanautsgrenada.com/the-sunken-trail",
      "https://xray-mag.com/content/grenada-spice-isle-caribbean",
    ],
    briefing: {
      name: "Buccaneer Wreck",
      locationName: "Molinere Bay, Grenada",
      forecastLatitude: 12.0818,
      forecastLongitude: -61.767,
      description:
        "A 42 ft steel schooner on her side near the base of the Molinere reef wall. A short swim from the reef, she makes a natural second dive after it.",
      marineLife: "Black coral · angelfish · reef fish",
      marineLifeDescription: "Black coral grows near the wreck, with angelfish around the hull.",
      difficultyLevel: "advanced",
      depthRange: "18–27 m (60–90 ft)",
      maxDepthMeters: 27,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Follow the wall down to its base, circle the hull from outside, and return up the wall. Stay outside the hull.",
      fitTone: "demanding",
      fitNote:
        "A small wreck at the base of the wall, from 18 m down. Easy to find from the wall, and below Open Water depth.",
      // Advanced Open Water because the whole wreck lies below 18 m.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["black-coral", "french-angelfish", "queen-angelfish", "common-sea-fan"],
    },
  },
  {
    // Approximate pin: midway between PADI's Kahonee and Purple Rain points, in the sand channel Eco Dive names between those two reefs (Divernet also places the wreck near Purple Rain). No source publishes the wreck's coordinates. Depth: Eco Dive 20–33 m, Aquanauts 32 m, Active Caribbean and Divernet 30 m; the deepest is kept.
    slug: "anina-wreck",
    version: 1,
    area: "grenada",
    sources: [
      "https://www.ecodivegrenada.com/about-us/dive-sites/",
      "https://www.aquanautsgrenada.com/the-sunken-trail",
      "https://activecaribbeantravel.com/grenada-diving/grenada-diving-st-georges-harbour-and-grand-anse-marine-protected-area/",
      "https://divernet.com/world-dives/passing-through-where-they-know-how-to-put-on-a-show/",
    ],
    briefing: {
      name: "Anina Wreck",
      locationName: "Grand Anse, Grenada",
      forecastLatitude: 12.0198,
      forecastLongitude: -61.7952,
      description:
        "A freighter that sank on her side in March 2018 during a clean-up job, now lying in a sand channel between Kahonee and Purple Rain. Orange cup coral is already growing under the hull.",
      marineLife: "Angelfish · orange cup coral",
      marineLifeDescription:
        "A young wreck, with cup coral under the hull and angelfish already in residence.",
      difficultyLevel: "advanced",
      depthRange: "20–33 m (70–110 ft)",
      maxDepthMeters: 33,
      currentNote:
        "Current not documented; Purple Rain next door is a drift, so ask the crew on the day and carry an SMB.",
      divePlan:
        "Down the line to the hull, along the outside from bow to stern, and back up with reserve gas. Stay outside the hull.",
      fitTone: "demanding",
      fitNote: "Deep and recent. A first look at a wreck still becoming a reef.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: ["orange-cup-coral", "queen-angelfish", "french-angelfish", "bluehead-wrasse"],
    },
  },
  {
    // Approximate pin: off Boss Reef in the Grand Anse Marine Protected Area (Eco Dive, Active Caribbean Travel and Divernet place this wreck off Boss Reef). Native Spirit instead puts a tug of the same name at Carriacou's Tyrrel Bay; the Grenada sources outnumber it and agree with Aquanauts' Grenada wreck list, so this is the Grenada wreck. No source publishes coordinates. Depth: Eco Dive and Active Caribbean 15–20 m, Divernet 16 m, Aquanauts 23 m; the deepest is kept.
    slug: "tyrrel-bay-wreck-grenada",
    version: 1,
    area: "grenada",
    sources: [
      "https://www.ecodivegrenada.com/about-us/dive-sites/",
      "https://activecaribbeantravel.com/grenada-diving/grenada-diving-st-georges-harbour-and-grand-anse-marine-protected-area/",
      "https://www.aquanautsgrenada.com/the-sunken-trail",
      "https://divernet.com/world-dives/passing-through-where-they-know-how-to-put-on-a-show/",
    ],
    briefing: {
      name: "Tyrrel Bay Wreck (Grand Anse)",
      locationName: "Grand Anse Marine Protected Area, Grenada",
      forecastLatitude: 12.027,
      forecastLongitude: -61.7665,
      description:
        "A retired Coast Guard vessel sunk on purpose and sitting upright off Boss Reef. Decks and hull are easy to read from the outside.",
      marineLife: "Reef fish · sponges",
      marineLifeDescription: "The hull is growing in, with small fish already using the decks.",
      difficultyLevel: "intermediate",
      depthRange: "15–23 m (50–75 ft)",
      maxDepthMeters: 23,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Circle the wreck once from outside at the deck line, then finish along the reef. Open Water divers turn at 18 m. Stay outside the hull.",
      fitTone: "unknown",
      fitNote:
        "Upright and simple to navigate, but the wreck reaches 23 m. Open Water divers turn at 18 m.",
      creatureSlugs: ["sergeant-major", "bluehead-wrasse", "brown-chromis", "common-sea-fan"],
    },
  },
  {
    // Approximate pin: the northern end of Boss Reef, off St. George's harbor (Eco Dive runs it as the second half of the Veronica L dive; Native Spirit and Active Caribbean list it with Boss Reef). No source publishes coordinates. Depth: Eco Dive 6–23 m, Active Caribbean 6–22 m, Native Spirit 9–27 m; the deepest is kept.
    slug: "northern-exposure",
    version: 1,
    area: "grenada",
    sources: [
      "https://www.ecodivegrenada.com/about-us/dive-sites/",
      "https://nativespiritscuba.com/reefs/",
      "https://activecaribbeantravel.com/grenada-diving/grenada-diving-st-georges-harbour-and-grand-anse-marine-protected-area/",
    ],
    briefing: {
      name: "Northern Exposure",
      locationName: "Grand Anse Marine Protected Area, Grenada",
      forecastLatitude: 12.041,
      forecastLongitude: -61.764,
      description:
        "A gently sloping reef of sea fans, sea rods, sponges and star coral, with coral heads reaching out past the shallows. Often dived right after the Veronica L.",
      marineLife: "Barracuda · spadefish · goatfish · parrotfish",
      marineLifeDescription:
        "Blue chromis and goatfish work the slope, with shrimp and crabs for a slow look.",
      difficultyLevel: "intermediate",
      depthRange: "6–27 m (20–90 ft)",
      maxDepthMeters: 27,
      currentNote:
        "Ship traffic from St. George's harbor reaches this reef. No diving while a ship is moving or alongside, listen for engines and carry an SMB. Otherwise calm conditions are described.",
      divePlan:
        "Follow the slope out along the coral heads and turn up the reef. Open Water divers turn at 18 m; others hold the depth the crew sets, no deeper than 27 m (90 ft).",
      fitTone: "unknown",
      fitNote: "A slope that runs to 27 m, with room to go slowly. Open Water divers turn at 18 m.",
      creatureSlugs: [
        "great-barracuda",
        "atlantic-spadefish",
        "blue-chromis",
        "spotted-goatfish",
        "common-sea-fan",
        "branching-vase-sponge",
      ],
    },
  },
];
