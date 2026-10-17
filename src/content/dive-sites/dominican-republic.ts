// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Dominican Republic. */
export const DOMINICAN_REPUBLIC: DiveSiteTemplate[] = [
  // Denominator row: Airport Wall (Airport Wall / Elephant)
  // Approximate pin: Zentacle's map point for the Airport Wall reef, on the water in front of Puerto Plata's runway, tied to the operators' description (a wall in front of the airport, 10 to 15 minutes west of Sosúa by boat). Good to about 2 km.
  // Depth: the sources give 26 to 30 m for the bottom of the wall (Superior 26 m and more, Casa-22 28 m, Scuba Dive Sosúa 28 m, the tourism ministry almost 30 m); the deepest, 30 m, is the cap.
  // Gate: not depth alone. The wall faces open ocean with tunnels, and Casa-22 lists it among its advanced dives; the ministry calls it suitable for all levels, and a shop can lower the gate.
  {
    slug: "airport-wall-sosua",
    version: 1,
    area: "dominican-republic",
    sources: [
      "https://scubadivesosua.com/dive-sites",
      "https://superiordivesosua.com/diving-dominican-republic-dive-sites-sosua/",
      "https://www.godominicanrepublic.com/things-to-do/airport-wall",
      "https://www.casa-22.com/wp-content/uploads/2016/11/CASA-22-Dive-spots-special-vEN.pdf",
      "https://www.zentacle.com/Beach/4791/airport-puerto-plata",
    ],
    briefing: {
      name: "Airport Wall",
      locationName: "Sosúa, Dominican Republic",
      forecastLatitude: 19.7664,
      forecastLongitude: -70.5505,
      description:
        "A wall that follows the coast for 1 to 2 km in front of Puerto Plata’s airport, from about 5 to 10 m down to roughly 26 to 30 m, with coral-covered ledges, pinnacles and tunnels. It faces open water, which brings bigger fish along the wall.",
      marineLife: "Goliath grouper · great barracuda · spotted eagle ray · cleaner shrimp",
      marineLifeDescription:
        "Hard and soft corals and whip corals crowd the wall, and cleaner shrimp work the cracks.",
      difficultyLevel: "intermediate",
      depthMinMeters: 5,
      maxDepthMeters: 30,
      currentNote:
        "The wall is exposed to open ocean. Operators dive it in the morning, when wind and waves are lowest. Current is not documented; ask the crew on the day.",
      divePlan:
        "Drop onto the top of the wall, follow it along no deeper than 30 m (98 ft), and come back up the reef with reserve gas. The tunnels and swim-throughs are overhead; stay out of them.",
      fitTone: "demanding",
      fitNote:
        "A boat dive on a wall that reaches 30 m, exposed to open ocean, with tunnels to stay out of. One operator lists it among its advanced dives.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "goliath-grouper",
        "great-barracuda",
        "spotted-eagle-ray",
        "spotted-cleaner-shrimp",
      ],
    },
  },
  // Denominator row: Three Rocks (3 Rocks)
  // Approximate pin: Zentacle's map point for Three Rocks, a few minutes by boat from Sosúa beach in the bay. Good to about 2 km.
  // Depth: Scuba Dive Sosúa and Superior give 9 m; Casa-22 gives coral heads in 3 to 12 m; the deepest figure, 12 m, is the cap.
  {
    slug: "three-rocks-sosua",
    version: 1,
    area: "dominican-republic",
    sources: [
      "https://scubadivesosua.com/dive-sites",
      "https://superiordivesosua.com/diving-dominican-republic-dive-sites-sosua/",
      "https://www.casa-22.com/wp-content/uploads/2016/11/CASA-22-Dive-spots-special-vEN.pdf",
      "https://www.zentacle.com/Beach/5540/three-rocks",
    ],
    briefing: {
      name: "Three Rocks",
      locationName: "Sosúa, Dominican Republic",
      forecastLatitude: 19.773,
      forecastLongitude: -70.5149,
      description:
        "Three coral pinnacles stand alone on a sandy bottom a few minutes by boat from Sosúa beach. The sand around them keeps new divers well away from the coral, and young staghorn coral grows in nurseries close by.",
      marineLife: "Sergeant majors · blue tang · yellowtail snapper · staghorn coral",
      marineLifeDescription:
        "Fish crowd each pinnacle, and a sand snake eel lies in the sand between them with only its eyes showing.",
      conservationNote:
        "Staghorn coral nurseries grow close by. Look, but keep hands and fins away from them.",
      difficultyLevel: "beginner",
      depthMinMeters: 3,
      maxDepthMeters: 12,
      currentNote:
        "Boats leave from the beach; listen for engines, surface with an SMB. Current is rare here, according to a local operator.",
      divePlan:
        "Drop onto the first rock at about 3 m (10 ft), work from rock to rock across the sand, and keep the last stretch of the dive in the shallows.",
      fitTone: "welcoming",
      fitNote:
        "Shallow rocks with sand all around make a calm first ocean dive for newly certified divers.",
      creatureSlugs: [
        "sergeant-major",
        "blue-tang",
        "yellowtail-snapper",
        "staghorn-coral",
        "spotted-snake-eel",
      ],
    },
  },
  // Denominator row: Coral Gardens (Coral Garden, Coral Garden Wall)
  // Approximate pin: Zentacle's map point for Coral Garden, beyond Three Rocks in Sosúa Bay (the operators run Three Rocks and Coral Garden as one dive). Good to about 2 km; Scubago prints a point about 2 km west, so the pin could move.
  // Depth: Superior gives 18 m for the two sites together, Scuba Dive Sosúa 24 m for Coral Gardens, Zentacle 17 m. The deepest, 24 m, is the cap. Superior's outer Coral Garden Wall (40 m) is a separate dive and is not briefed here.
  // Gate: none. Depth alone (24 m, a reef slope with no drop-off held at a floor, no current or overhead named) does not gate; readiness compares the 24 m with each diver's card.
  {
    slug: "coral-gardens-sosua",
    version: 1,
    area: "dominican-republic",
    sources: [
      "https://scubadivesosua.com/dive-sites",
      "https://superiordivesosua.com/diving-dominican-republic-dive-sites-sosua/",
      "https://www.casa-22.com/wp-content/uploads/2016/11/CASA-22-Dive-spots-special-vEN.pdf",
      "https://www.zentacle.com/Beach/5521/coral-garden",
    ],
    briefing: {
      name: "Coral Gardens",
      locationName: "Sosúa, Dominican Republic",
      forecastLatitude: 19.7747,
      forecastLongitude: -70.5172,
      description:
        "A sloping reef beyond Three Rocks, with patches of soft coral, sea fans and whips scattered across the sand. Operators usually dive it as a second leg after Three Rocks.",
      marineLife: "Sea fans · sea whips · garden eels · sand snake eels",
      marineLifeDescription:
        "Garden eels dot the sand as you leave Three Rocks, and a sand snake eel lies low with only its eyes showing.",
      difficultyLevel: "intermediate",
      depthMinMeters: 9,
      maxDepthMeters: 24,
      currentNote:
        "Boats leave from the beach; listen for engines, surface with an SMB. Current not documented; ask the crew on the day.",
      divePlan:
        "Start at Three Rocks, follow the slope down to the fans and whips, and turn no deeper than 24 m (79 ft). Climb back through the shallows with reserve gas.",
      fitTone: "unknown",
      fitNote:
        "Sources put the reef at 18 to 24 m, past the Open Water ceiling. Open Water divers keep to the upper slope, no deeper than 18 m.",
      creatureSlugs: [
        "common-sea-fan",
        "black-sea-rod",
        "garden-eel",
        "sea-plume",
        "spotted-snake-eel",
      ],
    },
  },
  // Denominator row: Canyon (Rob's Rock)
  // Approximate pin: Zentacle's map point for Canyon, in the western part of Sosúa Bay. Scuba Dive Sosúa places it in the middle of the bay and Superior on the far left of it. Good to about 2 km.
  // Depth: Superior and Casa-22 give 18 m, Scuba Dive Sosúa 30 m. The deeper figure, 30 m, is the cap.
  // Gate: none. Depth alone (30 m at the deepest, no drop-off held at a floor, no current or overhead named) does not gate; readiness compares the 30 m with each diver's card.
  // Location: the sources disagree (middle of the bay, or its far left), so the pin stays at Zentacle's point.
  // fitTone unknown: the sources give the bottom at 18 m (Superior, Casa-22) and 30 m (Scuba Dive Sosúa) and none says the slope continues, so the 30 m floor is the deepest source figure, not a wall floor.
  // (The same reading holds for the other Sosúa reef sites: tone unknown, depth limits left to the diver's card.)
  {
    slug: "canyon-sosua",
    version: 1,
    area: "dominican-republic",
    sources: [
      "https://scubadivesosua.com/dive-sites",
      "https://superiordivesosua.com/diving-dominican-republic-dive-sites-sosua/",
      "https://www.casa-22.com/wp-content/uploads/2016/11/CASA-22-Dive-spots-special-vEN.pdf",
      "https://www.zentacle.com/Beach/5527/canyon",
    ],
    briefing: {
      name: "Canyon",
      locationName: "Sosúa, Dominican Republic",
      forecastLatitude: 19.7564,
      forecastLongitude: -70.5235,
      description:
        "A pinnacle called Rob’s Rock stands on sand inside the bay, and a split in the reef opens onto the outer slope. An old anchor, so encrusted that it looks like rock, lies along the route among large barrel sponges.",
      marineLife: "Barrel sponges · French grunts · sergeant majors",
      marineLifeDescription:
        "Schools of grunts circle the pinnacle, and big barrel sponges line the slope.",
      difficultyLevel: "intermediate",
      depthMinMeters: 9,
      maxDepthMeters: 30,
      currentNote:
        "Boats leave from the beach; listen for engines, surface with an SMB. Current is rare, according to a local operator.",
      divePlan:
        "Circle the pinnacle at 9 m (30 ft), head out along the reef to the slope, and follow it down no deeper than 30 m (98 ft). Finish back on the shallow reef.",
      fitTone: "unknown",
      fitNote:
        "Sources differ on the depth, from 18 to 30 m, so the plan holds 30 m. Open Water divers stay on the reef top; the slope past 18 m is for Advanced divers.",
      landmarks: [
        {
          name: "Rob’s Rock",
          kind: "reefFormation",
          note: "A large rock pinnacle standing on sand inside the reef.",
        },
        {
          name: "Encrusted anchor",
          kind: "reefHistory",
          note: "An old anchor, so overgrown that many divers swim over it without noticing.",
        },
      ],
      creatureSlugs: ["giant-barrel-sponge", "french-grunt", "sergeant-major", "common-sea-fan"],
    },
  },
  // Denominator row: La Puntilla (West Wall cannons)
  // Approximate pin: Zentacle's map point for La Puntilla, about 30 seconds by boat from the beach at the west end of the bay. Scubago puts West Wall 140 m away; each pin is the point its own source publishes for its own site, and they are not derived.
  // Depth: Scuba Dive Sosúa and Superior give 20 m; Casa-22's deeper Puntilla wall (40 m) is a separate dive and is not briefed here.
  // Gate: Advanced Open Water, per the walls rule. Casa-22 lists a deeper Puntilla wall to 40 m, so the wall continues past the plan; the 20 m floor is the plan's, from Scuba Dive Sosúa and Superior, and the surge near the rock adds to it.
  {
    slug: "la-puntilla-sosua",
    version: 1,
    area: "dominican-republic",
    sources: [
      "https://scubadivesosua.com/dive-sites",
      "https://superiordivesosua.com/diving-dominican-republic-dive-sites-sosua/",
      "https://www.casa-22.com/wp-content/uploads/2016/11/CASA-22-Dive-spots-special-vEN.pdf",
      "https://www.zentacle.com/Beach/10430/la-puntilla",
    ],
    briefing: {
      name: "La Puntilla",
      locationName: "Sosúa, Dominican Republic",
      forecastLatitude: 19.7617,
      forecastLongitude: -70.5207,
      description:
        "A reef and wall about 30 seconds by boat from the beach. Rocks that have fallen from the wall leave gaps and passages between them, and the coral is abundant.",
      marineLife: "Frogfish · seahorses · great barracuda · rays",
      marineLifeDescription:
        "Frogfish and seahorses hide in the coral, and barracuda and rays like the rocky ground close to the wall.",
      difficultyLevel: "intermediate",
      depthMinMeters: 5,
      maxDepthMeters: 20,
      currentNote:
        "Boats leave from the beach; listen for engines, surface with an SMB. Surge pushes in close to the wall and between the fallen rocks.",
      divePlan:
        "Drop in at the top of the wall at 5 m (16 ft), work along it no deeper than 20 m (66 ft), and keep out of the passages between the fallen rocks, which are overhead. The wall continues deeper than this plan; hold 20 m.",
      fitTone: "demanding",
      fitNote:
        "A short ride, but the wall continues past 20 m and the surge runs close to the rock. Advanced Open Water divers only.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "longlure-frogfish",
        "longsnout-seahorse",
        "great-barracuda",
        "yellow-stingray",
      ],
    },
  },
  // Denominator row: West Wall
  // Approximate pin: Scubago's point for West Wall, about 30 seconds by boat from shore at the west end of Sosúa Bay. Zentacle's point for La Puntilla is 140 m away; each pin is the point its own source publishes for its own site, and they are not derived.
  // Depth: Superior gives 5 to 20 m for West Wall and La Puntilla together, and Casa-22 treats it among the 18 m training spots; the deepest, 20 m, is the cap.
  // Gate: Advanced Open Water, per the walls rule: this is the same wall as La Puntilla, 140 m away, where Casa-22 lists a deeper wall to 40 m, so the wall continues past the plan. The 20 m floor is the plan's, from Superior and Casa-22.
  {
    slug: "west-wall-sosua",
    version: 1,
    area: "dominican-republic",
    sources: [
      "https://superiordivesosua.com/diving-dominican-republic-dive-sites-sosua/",
      "https://scubadivesosua.com/dive-sites",
      "https://www.scubago.com/en/explore/divesite/west-wall-3743",
      "https://www.casa-22.com/wp-content/uploads/2016/11/CASA-22-Dive-spots-special-vEN.pdf",
    ],
    briefing: {
      name: "West Wall",
      locationName: "Sosúa, Dominican Republic",
      forecastLatitude: 19.7604,
      forecastLongitude: -70.5207,
      description:
        "A healthy reef and wall about 30 seconds by boat from shore. Three cannons from an old galleon rest on the reef near the top of the wall, and grunts, wrasse and snapper hang over the edge.",
      marineLife: "French grunts · wrasse · yellowtail snapper",
      marineLifeDescription:
        "Fish stack up at the top of the wall, and more hide beneath the ledges when you drop over the edge.",
      difficultyLevel: "intermediate",
      depthMinMeters: 5,
      maxDepthMeters: 20,
      currentNote:
        "Boats leave from the beach; listen for engines, surface with an SMB. Surge is reported close to the wall at neighboring La Puntilla and can reach here. Current not documented; ask the crew on the day.",
      divePlan:
        "Start at the top of the wall near 5 m (16 ft), find the cannons, then follow the wall down no deeper than 20 m (66 ft) and come back up the reef. The wall continues deeper than this plan; hold 20 m.",
      fitTone: "demanding",
      fitNote:
        "The wall reaches 20 m, past the Open Water ceiling, and continues deeper. Advanced Open Water divers only.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Cannons",
          kind: "reefHistory",
          note: "Three sunken cannons from an old galleon rest on the reef near the top of the wall.",
        },
      ],
      creatureSlugs: ["french-grunt", "yellowtail-snapper", "creole-wrasse", "common-sea-fan"],
    },
  },
  // Denominator row: Larimar I and II
  // Approximate pin: Zentacle's map point for Larimar, in front of the hotel on the west side of Sosúa Bay. Good to about 2 km.
  // Depth: Casa-22 gives Larimar 1 a shallow start to 18 m; Superior gives the deeper Larimar a top at 18 m sloping past 30 m. The slope continues, so the plan's floor of 30 m is the cap.
  // Gate: the deeper reef is a slope that keeps falling past the plan's 30 m floor (Superior's header says 40 m) and Superior ties it to Advanced Open Water training dives, so Advanced Open Water without Deep stays, per the walls rule.
  {
    slug: "larimar-sosua",
    version: 1,
    area: "dominican-republic",
    sources: [
      "https://superiordivesosua.com/diving-dominican-republic-dive-sites-sosua/",
      "https://www.casa-22.com/wp-content/uploads/2016/11/CASA-22-Dive-spots-special-vEN.pdf",
      "https://scubadivesosua.com/dive-sites",
      "https://www.zentacle.com/Beach/5525/larimar",
    ],
    briefing: {
      name: "Larimar",
      locationName: "Sosúa, Dominican Republic",
      forecastLatitude: 19.7706,
      forecastLongitude: -70.5214,
      description:
        "A shallow reef at Larimar I slopes away from 3 m, and the deeper Larimar II lies beyond it with its top at 18 m and a slope that keeps falling. Long barrel sponges line the slope.",
      marineLife: "Barrel sponges · angelfish · turtle",
      marineLifeDescription:
        "Angelfish live on the slope, and a large turtle may make an appearance.",
      difficultyLevel: "intermediate",
      depthMinMeters: 3,
      maxDepthMeters: 30,
      currentNote:
        "Current is rare on the shallow Larimar I, according to local operators. It is not documented for the deeper reef, so ask the crew on the day.",
      divePlan:
        "Start on the shallow reef at Larimar I, follow it to its edge, and cross to the deeper reef only with Advanced training, no deeper than 30 m (98 ft). The slope keeps falling past that floor.",
      fitTone: "demanding",
      fitNote: "The shallow part is gentle, but the deeper reef falls past this plan’s 30 m floor.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "giant-barrel-sponge",
        "french-angelfish",
        "gray-angelfish",
        "hawksbill-turtle",
      ],
    },
  },
  // Denominator row: Ray Point (Chiquita Reef)
  // Approximate pin: Zentacle's map point for Ray Point, about 1.6 km off Playa Chiquita (OpenStreetMap places the beach at 19.7761, -70.5129), tied to Superior's 'in front of Playa Chiquita'. Good to about 2 km.
  // Depth: Superior puts the lip at 20 m and Casa-22 at 23 m; both say the wall drops to 40 m and deeper. The plan's floor is 30 m, the walls rule.
  // Gate: the lip alone is past the Open Water limit, so Advanced Open Water without Deep.
  {
    slug: "ray-point-sosua",
    version: 1,
    area: "dominican-republic",
    sources: [
      "https://superiordivesosua.com/diving-dominican-republic-dive-sites-sosua/",
      "https://www.casa-22.com/wp-content/uploads/2016/11/CASA-22-Dive-spots-special-vEN.pdf",
      "https://www.zentacle.com/Beach/4796/ray-point",
    ],
    briefing: {
      name: "Ray Point",
      locationName: "Sosúa, Dominican Republic",
      forecastLatitude: 19.7905,
      forecastLongitude: -70.5122,
      description:
        "A wall in front of Playa Chiquita whose lip lies at about 20 m, then drops away past recreational depth. Fan corals and yellow stingrays line it, and spotted eagle rays sometimes pass along the blue edge.",
      marineLife: "Spotted eagle ray · yellow stingray · French grunts · sea fans",
      marineLifeDescription: "Stingrays rest on the ledges, and eagle rays pass out in the blue.",
      difficultyLevel: "advanced",
      depthMinMeters: 20,
      maxDepthMeters: 30,
      currentNote:
        "Current not documented. The wall faces open water, so carry an SMB and ask the crew on the day.",
      divePlan:
        "Down to the lip at about 20 m (66 ft), along the wall no deeper than 30 m (98 ft), and back up the reef with reserve gas. Stay out from under the overhangs. The wall falls past recreational depth.",
      fitTone: "demanding",
      fitNote:
        "The dive starts at 20 m and the wall drops away past this plan’s 30 m floor, so it is for experienced Advanced divers.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["spotted-eagle-ray", "yellow-stingray", "french-grunt", "common-sea-fan"],
    },
  },
  // Denominator row: Zingara Wreck
  // Approximate pin: Zentacle's map point for the Zingara, in open water outside Sosúa Bay (15 minutes by boat per Scuba Dive Sosúa). Good to about 2 km.
  // Depth: Scuba Dive Sosúa gives 35 m, Superior and Zentacle 36 m, Casa-22 stingrays at 38 m near the stern. The deepest, 38 m, is the cap. Lengths differ too (30 m, 45 m); briefed as 30 to 45 m.
  // Gate: Advanced Open Water and Deep, past 30 m.
  {
    slug: "zingara-wreck-sosua",
    version: 1,
    area: "dominican-republic",
    sources: [
      "https://scubadivesosua.com/dive-sites",
      "https://superiordivesosua.com/diving-dominican-republic-dive-sites-sosua/",
      "https://www.casa-22.com/wp-content/uploads/2016/11/CASA-22-Dive-spots-special-vEN.pdf",
      "https://www.zentacle.com/Beach/10410/zingara-wreck",
    ],
    briefing: {
      name: "Zingara Wreck",
      locationName: "Sosúa, Dominican Republic",
      forecastLatitude: 19.7863,
      forecastLongitude: -70.5022,
      description:
        "A coastal freighter of 30 to 45 m (operators differ), sunk on purpose for divers in the early 1990s and standing in open ocean in about 35 m of water. Sponges and coral cover the steel, and a mooring line runs down to the chimney.",
      marineLife: "Green moray · great barracuda · French angelfish · southern stingray",
      marineLifeDescription:
        "A green moray and a large barracuda live on the wreck, and stingrays rest on the sand near the stern.",
      difficultyLevel: "advanced",
      depthMinMeters: 35,
      maxDepthMeters: 38,
      currentNote:
        "Open ocean: current and heavy winter swell touch the wreck. Carry an SMB, and plan the ascent on the mooring line or the SMB.",
      divePlan:
        "Down the mooring line to the chimney, once around the outside of the hull, then the reef to the south for the rest of the dive. Stay outside the hull. Bottom time is short; staff confirm the diver’s log before boarding.",
      fitTone: "demanding",
      fitNote:
        "A deep open-ocean wreck for divers with Advanced and Deep training who are comfortable on a mooring line.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "Chimney",
          kind: "wreckFeature",
          note: "The mooring line comes down to the chimney, a good place to start.",
        },
      ],
      creatureSlugs: [
        "green-moray",
        "great-barracuda",
        "french-angelfish",
        "southern-stingray",
        "french-grunt",
      ],
    },
  },
  // Denominator row: Piedra Bonita (The Tower), Cabo Cabrón
  // Position: Scubago's point for Piedra Bonita. Las Galeras Divers puts the tower about 80 m north of the cape; OpenStreetMap places Cabo Cabrón at 19.3602, -69.2180, about 0.3 km from the pin.
  // Depth: Las Galeras Divers gives 7 m at the top to 55 m; Scubago says the rock reaches about 55 m and is best dived above 35 m; the ministry describes a free fall and strong currents. The plan is capped at 40 m, the recreational limit, and the deeper foot is described as past it.
  // Gate: Advanced Open Water and Deep (40 m), with a strong-current note. The plan floor is 35 m (Scubago: best dived above 35 m); maxDepthMeters stays at the 40 m recreational cap.
  {
    slug: "piedra-bonita-cabo-cabron",
    version: 1,
    area: "dominican-republic",
    sources: [
      "https://web.archive.org/web/2025/http://www.las-galeras-divers.com/us/diving-sites/piedra-bonita.html",
      "https://www.godominicanrepublic.com/things-to-do/piedra-bonita",
      "https://www.scubago.com/en/explore/divesite/piedra-bonita-405871",
    ],
    briefing: {
      name: "Piedra Bonita",
      locationName: "Cabo Cabrón, Samaná, Dominican Republic",
      forecastLatitude: 19.3626,
      forecastLongitude: -69.2185,
      description:
        "A coral tower just north of Cabo Cabrón, also called the Tower, that rises from far below recreational depth to within 7 m of the surface. Sponges, giant gorgonians and coral cover the rock, and turtles, jacks and creole wrasse circle it.",
      marineLife: "Hawksbill turtle · horse-eye jack · creole wrasse · porcupinefish",
      marineLifeDescription:
        "Turtles and shoals of jacks and wrasse pass the rock, and sponges and gorgonians cover its sides.",
      difficultyLevel: "advanced",
      depthMinMeters: 7,
      maxDepthMeters: 40,
      currentNote:
        "Strong currents push divers around the rock, and the dive needs a calm sea. Carry an SMB and stay close to the rock.",
      divePlan:
        "Drop onto the top of the tower at 7 m (23 ft), work down the rock no deeper than 35 m (115 ft), turn on thirds, and ascend with an SMB. The rock reaches 40 m and the foot lies at 55 m, beyond the recreational limit. Staff confirm the diver’s log before boarding.",
      fitTone: "demanding",
      fitNote:
        "A deep pinnacle in open Atlantic water with strong current, for experienced Advanced and Deep divers. Medical care is far; confirm the boat’s oxygen and plan.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "hawksbill-turtle",
        "horse-eye-jack",
        "creole-wrasse",
        "porcupinefish",
        "common-sea-fan",
      ],
    },
  },
  // Denominator row: Tibisi 1 and 2 (Cabo Cabrón)
  // Approximate pin: Scubago's point for the Cabo Cabrón wall, moved about 100 m offshore (Scubago's own point sits 20 m from the rocks), in the western part of the cape's north coast, tied to Las Galeras Divers' 'in the western part of Cabo Cabrón' (the cape itself is at 19.3602, -69.2180 in OpenStreetMap, 2.3 km east). Good to about 2 km.
  // Depth: Las Galeras Divers gives 5 to 40 m between two slopes divided by a wall falling to 50 m; Scubago gives a wall from 6 m to 30 m and deeper. The plan's floor is 30 m, the walls rule.
  // Gate: the wall falls past the plan's floor, so Advanced Open Water without Deep.
  {
    slug: "tibisi-cabo-cabron",
    version: 1,
    area: "dominican-republic",
    sources: [
      "https://web.archive.org/web/2025/http://www.las-galeras-divers.com/us/diving-sites/tibisi1.html",
      "https://web.archive.org/web/2025/http://www.las-galeras-divers.com/us/diving-sites/tibisi2.html",
      "https://www.scubago.com/en/explore/divesite/cabo-cabron-the-wall-313255",
    ],
    briefing: {
      name: "Tibisi",
      locationName: "Cabo Cabrón, Samaná, Dominican Republic",
      forecastLatitude: 19.36,
      forecastLongitude: -69.241,
      description:
        "Two coral slopes in the protected western part of Cabo Cabrón, divided by a wall that falls away past recreational depth. Turtles and porcupinefish pass along the slopes.",
      marineLife: "Hawksbill turtle · porcupinefish · coral reef fish",
      marineLifeDescription: "Turtles and porcupinefish pass along the slopes, in clear water.",
      difficultyLevel: "intermediate",
      depthMinMeters: 5,
      maxDepthMeters: 30,
      currentNote:
        "Usually calm in this protected area, according to a local operator, though it can change. Carry an SMB.",
      divePlan:
        "Down onto one of the slopes at 5 m (16 ft), work along it and over the edge of the wall no deeper than 30 m (98 ft), and come back up the slope with reserve gas.",
      fitTone: "demanding",
      fitNote:
        "A 25 to 30 minute boat ride from Las Galeras, with medical care far away; confirm the boat’s oxygen and plan. The wall falls past this plan’s 30 m floor.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["hawksbill-turtle", "porcupinefish", "common-sea-fan", "giant-barrel-sponge"],
    },
  },
  // Denominator row: Astron Wreck
  // Position: the midpoint of Scubago's point (18.7320, -68.4531) and Zentacle's (18.7300, -68.4543), 0.24 km apart.
  // Depth: Pro Dive gives 12 to 15 m, Scubago 40 to 50 ft; the deepest, 15 m, is the cap.
  // Surge at the stern is a conservative caution from the review: the bow breaks the surface, so the wreck sits in the shore break zone.
  {
    slug: "astron-wreck-punta-cana",
    version: 1,
    area: "dominican-republic",
    sources: [
      "https://www.prodiveinternational.com/dive-site/astron-wreck/",
      "https://www.godominicanrepublic.com/things-to-do/diving-in-punta-cana",
      "https://www.scubago.com/en/explore/divesite/astron-wreck-8497",
      "https://www.zentacle.com/Beach/3930/astron-wreck",
      "https://divemasteraustin.com/destinations/dominican-republic",
    ],
    briefing: {
      name: "Astron Wreck",
      locationName: "Bávaro, Punta Cana, Dominican Republic",
      forecastLatitude: 18.731,
      forecastLongitude: -68.4537,
      description:
        "A 127 m freighter that ran aground in a storm on her way to Cuba and broke in two, with the bow above the water and the stern below it. She lies close to the beach, and coral and tropical fish cover the steel.",
      marineLife: "French angelfish · yellowtail snapper · French grunts",
      marineLifeDescription: "Reef fish and coral cover the wreckage.",
      difficultyLevel: "beginner",
      depthMinMeters: 12,
      maxDepthMeters: 15,
      currentNote:
        "Low, according to local operators. The bow breaks the surface: check the sea state before boarding; surge can reach the stern.",
      divePlan:
        "Descend onto the submerged stern, work along the outside of the wreck, and keep the last stretch in the shallows. Stay outside the hull.",
      fitTone: "welcoming",
      fitNote: "A shallow wreck in clear water that most certified divers can enjoy.",
      creatureSlugs: ["french-angelfish", "yellowtail-snapper", "french-grunt", "sergeant-major"],
    },
  },
  // Denominator row: Monica Wreck
  // Approximate pin: Zentacle's map point for the Monica, about half a mile off the coast (Grand Bay) on the Punta Cana and Bávaro reef. Good to about 2 km.
  // Depth: Grand Bay gives 5 to 15 m, Pro Dive 10 to 12 m; the deepest, 15 m, is the cap.
  // Gate: Pro Dive calls the current medium to strong and the site Advanced, while Grand Bay calls it an easy first wreck. The conservative reading, Advanced Open Water, applies.
  {
    slug: "monica-wreck-punta-cana",
    version: 1,
    area: "dominican-republic",
    sources: [
      "https://www.grandbay-puntacana.com/sites/wreck-monica",
      "https://www.prodiveinternational.com/dive-site/monica-wreck/",
      "https://www.zentacle.com/Beach/8411/monica-wreck",
      "https://www.godominicanrepublic.com/things-to-do/diving-in-punta-cana",
    ],
    briefing: {
      name: "Monica Wreck",
      locationName: "Punta Cana, Dominican Republic",
      forecastLatitude: 18.6544,
      forecastLongitude: -68.3468,
      description:
        "An 1880s French cargo ship that ran aground on the reef about half a mile off the coast. The propeller, part of the engine, the boiler and the rail material she carried still lie on the reef, and small, narrow gaps between the wreck and the reef shelter fish and lobster.",
      marineLife: "Spiny lobster · tropical reef fish · hard coral",
      marineLifeDescription: "Lobster and fish hide in the gaps between the wreck and the reef.",
      difficultyLevel: "intermediate",
      depthMinMeters: 5,
      maxDepthMeters: 15,
      currentNote:
        "Medium to strong, according to local operators. Carry an SMB and stay close to the group.",
      divePlan:
        "Descend beside the wreck, circle the outside of it, and finish over the reef. Stay outside the hull; the gaps between wreck and reef are overhead.",
      fitTone: "demanding",
      fitNote:
        "Shallow, but the current can run medium to strong, so the site is gated for divers with Advanced training.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Propeller and boiler",
          kind: "wreckFeature",
          note: "The propeller, engine parts and boiler are still visible on the reef.",
        },
      ],
      creatureSlugs: ["spiny-lobster", "yellowtail-snapper", "french-angelfish", "sergeant-major"],
    },
  },
  // Denominator row: Park Reef
  // Approximate pin: Zentacle's point (18.6993, -68.4190), on the Punta Cana and Bávaro reef. Scubago's point (18.6865, -68.4105) lies 1.6 km away and no source text settles between them, so the pin is one source's published point, not a midpoint. Good to about 2 km.
  // Depth: Pro Dive gives 10 to 12 m, Grand Bay 12 m; the deepest, 12 m, is the cap.
  {
    slug: "park-reef-punta-cana",
    version: 1,
    area: "dominican-republic",
    sources: [
      "https://www.grandbay-puntacana.com/sites/park-reef",
      "https://www.prodiveinternational.com/dive-site/parque-reef/",
      "https://www.zentacle.com/Beach/9537/park-reef",
      "https://www.scubago.com/en/explore/divesite/park-reef-199597",
    ],
    briefing: {
      name: "Park Reef",
      locationName: "Punta Cana, Dominican Republic",
      forecastLatitude: 18.6993,
      forecastLongitude: -68.419,
      description:
        "A set of coral-covered rock ridges, five to ten by one count, runs out from the coast over a sandy floor. It is a calm, easy dive over the rocks.",
      marineLife: "Sea turtles · spiny lobster · reef squid",
      marineLifeDescription:
        "Turtles, lobster and squid are often seen between and over the ridges.",
      difficultyLevel: "beginner",
      depthMinMeters: 10,
      maxDepthMeters: 12,
      currentNote: "Low, according to local operators.",
      divePlan:
        "Descend onto one ridge, follow the gap between the ridges, and cross the sand to the next one.",
      fitTone: "welcoming",
      fitNote: "Shallow rocks on sand with little current make an easy dive for new divers.",
      creatureSlugs: ["hawksbill-turtle", "spiny-lobster", "caribbean-reef-squid", "french-grunt"],
    },
  },
  // Denominator row: Cuevitas
  // Approximate pin: Zentacle's map point for Cuevitas on the Punta Cana and Bávaro reef, a short boat ride from the hotel dive bases. Good to about 2 km.
  // Depth: Grand Bay, Dressel and Zentacle all give 10 m as the maximum; the sources print no minimum, so the plan's range starts at 5 m.
  // Overhead: the site's small caves and swim-throughs are overhead. The brief keeps the plan on the open reef and tells divers to stay out; Grand Bay describes them as open and lit.
  {
    slug: "cuevitas-punta-cana",
    version: 1,
    area: "dominican-republic",
    sources: [
      "https://www.grandbay-puntacana.com/sites/cuevitas",
      "https://www.zentacle.com/Beach/9534/cuevitas",
      "https://www.dresseldivers.com/dive/dominican-republic/punta-cana-scuba-diving/",
    ],
    briefing: {
      name: "Cuevitas",
      locationName: "Punta Cana, Dominican Republic",
      forecastLatitude: 18.6722,
      forecastLongitude: -68.3917,
      description:
        "A shallow reef of rock and coral, a short boat ride from the Bávaro hotels. The open reef beside the rock is the dive.",
      marineLife: "Spiny lobster · cleaner shrimp · coral fish",
      marineLifeDescription: "Lobster and cleaner shrimp tuck into the rock along the reef.",
      difficultyLevel: "beginner",
      depthMinMeters: 5,
      maxDepthMeters: 10,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Descend onto the reef, follow it along the rock, and stay on the open reef. The small caves and swim-throughs are overhead; stay out of them.",
      fitTone: "welcoming",
      fitNote: "Shallow, at about 10 m, on the open reef.",
      creatureSlugs: ["spiny-lobster", "spotted-cleaner-shrimp", "french-grunt", "sergeant-major"],
    },
  },
  // Denominator row: Rondana
  // Approximate pin: Zentacle's map point for Rondana on the Punta Cana and Bávaro reef. Good to about 2 km.
  // Depth: Pro Dive gives 10 to 12 m, Dressel 12 m, Zentacle 10 m; the deepest, 12 m, is the cap. The sources give little else about the site, so the briefing stays short.
  {
    slug: "rondana-punta-cana",
    version: 1,
    area: "dominican-republic",
    sources: [
      "https://www.prodiveinternational.com/dive-site/rondana/",
      "https://www.zentacle.com/Beach/11054/rondana",
      "https://www.dresseldivers.com/dive/dominican-republic/punta-cana-scuba-diving/",
    ],
    briefing: {
      name: "Rondana",
      locationName: "Punta Cana, Dominican Republic",
      forecastLatitude: 18.7425,
      forecastLongitude: -68.4699,
      description: "A reef on the Punta Cana and Bávaro reef system, rated for Open Water divers.",
      marineLife: "Reef fish · hard corals · sponges",
      marineLifeDescription:
        "Ask the crew what the reef is showing that week; sightings are not documented.",
      difficultyLevel: "beginner",
      depthMinMeters: 10,
      maxDepthMeters: 12,
      currentNote: "Low, according to local operators.",
      divePlan:
        "Descend onto the reef, follow it for the dive, and keep the last stretch in the shallows.",
      fitTone: "welcoming",
      fitNote: "A shallow training reef with little current.",
      creatureSlugs: ["french-grunt", "sergeant-major", "blue-tang", "common-sea-fan"],
    },
  },
  // Denominator row: Coral Garden (Punta Cana)
  // Approximate pin: Zentacle's map point for Coral Garden, on the Punta Cana and Bávaro reef near the Astron wreck. Good to about 2 km.
  // Depth: Dressel gives 12 m, Zentacle 9 m; the deepest, 12 m, is the cap. The sources print no minimum, so the plan's range starts at 5 m. The sources give little else about the site, so the briefing stays short.
  {
    slug: "coral-garden-punta-cana",
    version: 1,
    area: "dominican-republic",
    sources: [
      "https://www.dresseldivers.com/dive/dominican-republic/punta-cana-scuba-diving/",
      "https://www.godominicanrepublic.com/things-to-do/diving-in-punta-cana",
      "https://www.zentacle.com/Beach/12712/coral-garden",
    ],
    briefing: {
      name: "Coral Garden",
      locationName: "Punta Cana, Dominican Republic",
      forecastLatitude: 18.725,
      forecastLongitude: -68.4502,
      description:
        "A shallow coral reef on the Punta Cana and Bávaro reef system, a short boat ride from the dive bases.",
      marineLife: "Reef fish · hard corals · sea fans",
      marineLifeDescription:
        "Ask the crew what the reef is showing that week; sightings are not documented.",
      difficultyLevel: "beginner",
      depthMinMeters: 5,
      maxDepthMeters: 12,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Descend onto the reef, follow it for the dive, and keep the last stretch in the shallows.",
      fitTone: "welcoming",
      fitNote: "A shallow reef close to the dive bases, suitable for most certified divers.",
      creatureSlugs: ["french-grunt", "sergeant-major", "blue-tang", "common-sea-fan"],
    },
  },
  // Denominator row: Atlantic Princess Wreck
  // Position: Divemaster Austin's dive log (18.3692, -68.8523), within 0.1 km of Zentacle's point and Scubago's (18.3690, -68.8525).
  // Depth: Go Dive Bayahibe, Coral Point and the ministry give 12 m; Divemaster Austin logged 7 m at the top.
  {
    slug: "atlantic-princess-wreck-bayahibe",
    version: 1,
    area: "dominican-republic",
    sources: [
      "https://www.coralpointdiving.com/En/divesite.html",
      "https://godivebayahibe.com/dive-sites-bayahibe/",
      "https://www.godominicanrepublic.com/things-to-do/atlantic-princess-shipwreck",
      "https://divemasteraustin.com/dive-sites/atlantic-princess-bayahibe",
      "https://www.scubago.com/en/explore/divesite/atlantic-princess-wreck-bayahibe-574610",
    ],
    briefing: {
      name: "Atlantic Princess Wreck",
      locationName: "Bayahibe, Dominican Republic",
      forecastLatitude: 18.3692,
      forecastLongitude: -68.8523,
      description:
        "A former tourist cruise ship, about 30 m long, that ran aground in 2008 and sank on her own in May 2009 close to Bayahibe. Storms have flattened her top, and the reef around her, split by sand channels, holds seahorses, rays and parrotfish.",
      marineLife: "Parrotfish · seahorses · stingrays · sergeant majors",
      marineLifeDescription:
        "Silvery fish gather along her sides and in the cracks, and rays and garden eels settle in the sand channels.",
      difficultyLevel: "beginner",
      depthMinMeters: 7,
      maxDepthMeters: 12,
      currentNote:
        "Minimal on a recent visit. The wreck lies off the Bayahibe waterfront, so surface with an SMB and listen for engines. Storms damage the shallow wreck, so check the sea state before boarding.",
      divePlan:
        "Descend beside the wreck, circle the outside of her, then work along the reef and sand channels around her. Stay outside the hull; storm damage has left loose parts.",
      fitTone: "welcoming",
      fitNote:
        "A shallow wreck that newly certified divers can enjoy from the outside, with plenty of air for a second lap.",
      creatureSlugs: [
        "princess-parrotfish",
        "longsnout-seahorse",
        "yellow-stingray",
        "garden-eel",
        "sergeant-major",
      ],
    },
  },
  // Denominator row: Saint George Wreck
  // Position: Divemaster Austin's dive log (18.3423, -68.8361), within 0.4 km of Zentacle's point (18.3422, -68.8325); the ministry places the wreck half a mile off the Dominicus coast.
  // Depth: the ministry and Divemaster Austin give 40 m, Go Dive Bayahibe, Coral Point and Ultra Marine give 44 m for the sand with the top at 15 m. The cap is the recreational limit, 40 m; the sand lies deeper.
  // Gate: Advanced Open Water and Deep. The plan floor is 35 m (most of the wreck lies at 25 to 35 m); maxDepthMeters stays at the 40 m recreational cap.
  {
    slug: "saint-george-wreck-bayahibe",
    version: 1,
    area: "dominican-republic",
    sources: [
      "https://www.coralpointdiving.com/En/divesite.html",
      "https://godivebayahibe.com/dive-sites-bayahibe/",
      "https://www.godominicanrepublic.com/things-to-do/st-george-shipwreck",
      "https://divemasteraustin.com/dive-sites/st-george-bayahibe",
      "https://ultramarinedivers.com/explore-dive-sites.html",
    ],
    briefing: {
      name: "Saint George Wreck",
      locationName: "Bayahibe, Dominican Republic",
      forecastLatitude: 18.3423,
      forecastLongitude: -68.8361,
      description:
        "A 73 m cargo ship built in Scotland in 1962 and sunk on purpose in 1999, about half a mile off Dominicus. She stands upright with her top near 15 m, and coral covers her. The sand lies deeper than the recreational limit, at about 44 m.",
      marineLife: "Great barracuda · moray eel · spotted eagle ray · grouper",
      marineLifeDescription:
        "Barracuda and schools of fish circle the structure, and eagle rays visit.",
      difficultyLevel: "advanced",
      depthMinMeters: 15,
      maxDepthMeters: 40,
      currentNote:
        "Surface current is common, and a strong current can cross the deck at depth, so carry an SMB. The wreck lies half a mile off Dominicus, so listen for engines.",
      divePlan:
        "Down the buoy line to the chimney near 15 m, where most of the wreck lies between 25 and 35 m. Work along the outside of the hull to no deeper than 35 m (115 ft), turn on thirds, and ascend with reserve gas. The sand lies deeper than the 40 m cap. Stay outside the hull. Staff confirm the diver’s log before boarding.",
      fitTone: "demanding",
      fitNote:
        "A deep wreck with short bottom times, for divers with Advanced and Deep training and recent experience.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: ["great-barracuda", "green-moray", "spotted-eagle-ray", "black-grouper"],
    },
  },
  // Denominator row: Viva Shallow
  // Position: the midpoint of Zentacle's point (18.3455, -68.8301) and Scubago's (18.3447, -68.8352), 0.55 km apart.
  // Depth: Pro Dive gives 7 to 12 m, Coral Point 6 to 10 m, Go Dive Bayahibe 5 to 9 m; the deepest, 12 m, is the cap.
  {
    slug: "viva-shallow-bayahibe",
    version: 1,
    area: "dominican-republic",
    sources: [
      "https://www.coralpointdiving.com/En/divesite.html",
      "https://godivebayahibe.com/dive-sites-bayahibe/",
      "https://www.prodiveinternational.com/diving/dominican-republic/bayahibe/local-diving/",
      "https://www.scubago.com/en/explore/divesite/viva-shallow-203547",
      "https://www.zentacle.com/Beach/10437/viva-shallow",
    ],
    briefing: {
      name: "Viva Shallow",
      locationName: "Bayahibe, Dominican Republic",
      forecastLatitude: 18.3451,
      forecastLongitude: -68.8326,
      description:
        "Coral fingers across a sandy bottom, a small wall about 3 m high, and old cannons and an anchor in the shallows from about 5 m. Seahorses wrap their tails around the sponges.",
      marineLife: "Seahorses · spotted moray · spiny lobster · yellow stingray",
      marineLifeDescription:
        "Look in the sponges for seahorses and in the coral holes for morays and lobster, and over the sand for rays.",
      difficultyLevel: "beginner",
      depthMinMeters: 5,
      maxDepthMeters: 12,
      currentNote: "Low, according to local operators.",
      divePlan:
        "Descend the buoy line, find the cannons and anchor in the shallows, then follow the reef fingers and the small wall. Keep the last stretch of the dive in the shallows.",
      fitTone: "welcoming",
      fitNote: "A shallow reef for training, photography and a relaxed second dive.",
      landmarks: [
        {
          name: "Cannons and anchor",
          kind: "reefHistory",
          note: "Old cannons and an anchor rest on the reef in the shallows, from about 5 m.",
        },
      ],
      creatureSlugs: [
        "longsnout-seahorse",
        "spotted-moray",
        "spiny-lobster",
        "yellow-stingray",
        "smooth-trunkfish",
      ],
    },
  },
  // Denominator row: Dominicus Reef
  // Approximate pin: Zentacle's map point for Dominicus Reef, 0.5 km off Dominicus beach. Coral Point places the reef straight off that beach, and Scubago's point (18.3366, -68.8461) sits 1.9 km west near Bayahibe, so Zentacle's stands.
  // Depth: Coral Point gives 12 to 16 m, Ultra Marine 12 to 18 m; the deepest, 18 m, is the cap.
  // Gate: Coral Point says the current is occasionally strong enough for a drift, so Advanced Open Water.
  {
    slug: "dominicus-reef-bayahibe",
    version: 1,
    area: "dominican-republic",
    sources: [
      "https://www.coralpointdiving.com/En/divesite.html",
      "https://ultramarinedivers.com/explore-dive-sites.html",
      "https://www.zentacle.com/Beach/10439/domenicus-reef",
      "https://www.scubago.com/en/explore/divesite/dominicus-reef-bayahibe-968953",
    ],
    briefing: {
      name: "Dominicus Reef",
      locationName: "Bayahibe, Dominican Republic",
      forecastLatitude: 18.3403,
      forecastLongitude: -68.8275,
      description:
        "A broad coral reef straight off Dominicus beach, with fingers of reef reaching toward shore across sand. Soft corals and anemones cover the bigger sections, and rays rest in the sand between the fingers.",
      marineLife: "Spiny lobster · porcupinefish · spotted scorpionfish · yellow stingray",
      marineLifeDescription:
        "Lobster and porcupinefish sit under the coral, and younger fish stay in the reef fingers.",
      difficultyLevel: "intermediate",
      depthMinMeters: 12,
      maxDepthMeters: 18,
      currentNote: "Occasionally strong, and the crew may run it as a drift. Carry an SMB.",
      divePlan:
        "Drop onto the main reef, follow it out along the fingers into any current, and turn with the current behind you for the last stretch.",
      fitTone: "demanding",
      fitNote:
        "A reef where the current is occasionally strong, so the gate asks for Advanced training.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["spiny-lobster", "porcupinefish", "spotted-scorpionfish", "yellow-stingray"],
    },
  },
  // Denominator row: Peñón (El Peñón I, II and III)
  // Approximate pin: Divemaster Austin's dive log point (18.2529, -68.7790), in front of the national park, about 25 minutes by boat from Bayahibe (Divemaster Austin and Blue Dreams). Scubago's point (18.2509, -68.7918) lies 1.4 km away; the pin is one source's published point, not a midpoint. Good to about 2 km.
  // Depth: Coral Point gives 12 to 14 m, Blue Dreams 12 to 16 m, Ultra Marine 12 to 18 m for Peñón II, Go Dive Bayahibe 8 to 10 m; the deepest, 18 m, is the cap. Ultra Marine's separate Peñón Deep section is not briefed.
  {
    slug: "el-penon-bayahibe",
    version: 1,
    area: "dominican-republic",
    sources: [
      "https://www.coralpointdiving.com/En/divesite.html",
      "https://divemasteraustin.com/dive-sites/el-penon-bayahibe",
      "https://www.buceoenrepublicadominicana.com/en/dive-sites/el-penon/",
      "https://ultramarinedivers.com/explore-dive-sites.html",
      "https://www.scubago.com/en/explore/divesite/el-pen-bayahibe-970169",
    ],
    briefing: {
      name: "El Peñón",
      locationName: "Bayahibe, Dominican Republic",
      forecastLatitude: 18.2529,
      forecastLongitude: -68.779,
      description:
        "A long reef inside the national park, divided into three dive sites marked by buoys, with a small coral wall and a sandy edge. No fishing or anchoring is allowed, and the coral and fish life are dense.",
      marineLife: "Spotted eagle ray · hawksbill turtle · southern stingray · nurse shark",
      marineLifeDescription:
        "Eagle rays and turtles pass the reef, and stingrays rest on the sand at its edge. Look out into open water for bigger animals.",
      conservationNote:
        "The reef lies inside Cotubanamá National Park (Parque Nacional del Este): no fishing, no anchoring. Ask the shop whether a park fee applies to the trip.",
      difficultyLevel: "beginner",
      depthMinMeters: 8,
      maxDepthMeters: 18,
      currentNote:
        "Minimal, according to local operators, with a light current at times that helps the return along the reef. Carry an SMB.",
      divePlan:
        "Drop in at the buoy, follow the reef along its small wall, and return over the reef top with any light current. Operators usually run two sections back to back.",
      fitTone: "welcoming",
      fitNote:
        "Shallow and calm, but 25 minutes from Bayahibe by boat. Medical care is far; confirm the boat’s oxygen and plan.",
      landmarks: [
        {
          name: "Small coral wall",
          kind: "reefFormation",
          note: "A small wall leads away from the buoy, then the route turns back over the reef top.",
        },
      ],
      creatureSlugs: [
        "spotted-eagle-ray",
        "hawksbill-turtle",
        "southern-stingray",
        "nurse-shark",
        "trumpetfish",
      ],
    },
  },
  // Denominator row: Guaraguao (I and II)
  // Approximate pin: Scubago's point for Guaraguao I, in the west end of the national park (Coral Point), 0.6 km off the coast. Good to about 2 km.
  // Depth: Coral Point and Ultra Marine give 12 to 16 m; Scubago prints 12 m. The deepest, 16 m, is the cap.
  // The sources say the current allows a gentle drift; the drift was removed from the plan and the tone set to unknown, since a drift is not a beginner plan.
  {
    slug: "guaraguao-bayahibe",
    version: 1,
    area: "dominican-republic",
    sources: [
      "https://www.coralpointdiving.com/En/divesite.html",
      "https://ultramarinedivers.com/explore-dive-sites.html",
      "https://www.scubago.com/en/explore/divesite/guaraguao-i-113213",
    ],
    briefing: {
      name: "Guaraguao",
      locationName: "Bayahibe, Dominican Republic",
      forecastLatitude: 18.3321,
      forecastLongitude: -68.818,
      description:
        "Soft and hard coral on a bed of sand at the west end of the national park, where the reef system begins that runs on toward Saona. Cannons, cannonballs and muskets from sunken Spanish ships were moved here for divers to see.",
      marineLife: "Sea fans · sponges · reef fish",
      marineLifeDescription:
        "Gorgonians and sponges cover the reef, with small creatures in every nook.",
      conservationNote:
        "The reef lies at the west end of Cotubanamá National Park (Parque Nacional del Este). Ask the shop whether a park fee applies to the trip.",
      difficultyLevel: "beginner",
      depthMinMeters: 12,
      maxDepthMeters: 16,
      currentNote: "Light to medium, according to local operators. Carry an SMB.",
      divePlan:
        "Drop onto the reef, find the cannons and muskets, then follow the reef as the crew briefs. Staff confirm the diver’s log before boarding.",
      fitTone: "unknown",
      fitNote:
        "A shallow reef with a light to medium current. Staff confirm the diver’s log before boarding.",
      landmarks: [
        {
          name: "Cannons and muskets",
          kind: "reefHistory",
          note: "Cannons, cannonballs and muskets from sunken Spanish ships were moved here for divers.",
        },
      ],
      creatureSlugs: ["common-sea-fan", "sea-plume", "branching-tube-sponge", "french-grunt"],
    },
  },
  // Denominator row: Coral Nursery (Coco Reef)
  // Approximate pin: Scubago's point for Coco Reef, about 500 m off the beach in front of the resort at Dominicus (Go Dive Bayahibe, Pro Dive). Good to about 2 km. It sits 220 m from the Dominicus Reef pin.
  // Depth: Pro Dive gives 10 to 12 m, Ultra Marine 10 to 14 m, Scubago and Go Dive Bayahibe 12 m; the deepest, 14 m, is the cap.
  {
    slug: "coral-nursery-bayahibe",
    version: 1,
    area: "dominican-republic",
    sources: [
      "https://godivebayahibe.com/dive-sites-bayahibe/",
      "https://www.prodiveinternational.com/diving/dominican-republic/bayahibe/local-diving/",
      "https://ultramarinedivers.com/explore-dive-sites.html",
      "https://www.scubago.com/en/explore/divesite/coco-reef-499145",
    ],
    briefing: {
      name: "Coral Nursery",
      locationName: "Bayahibe, Dominican Republic",
      forecastLatitude: 18.3387,
      forecastLongitude: -68.8288,
      description:
        "A coral restoration reef about 500 m off the beach, where fragments grow on ropes, tables and sculptures before they are planted out. Statues and a coral garden sit among a colorful local reef.",
      marineLife: "Reef octopus · reef squid · seahorses · reef fish",
      marineLifeDescription:
        "Octopus, squid and seahorses use the structures for cover, and the slow, careful diver sees the most.",
      conservationNote:
        "A coral restoration site run with FUNDEMAR. Keep hands and fins off the ropes, tables and sculptures.",
      difficultyLevel: "beginner",
      depthMinMeters: 10,
      maxDepthMeters: 14,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Descend the buoy line, move slowly among the structures, and keep your buoyancy off the nursery.",
      fitTone: "welcoming",
      fitNote:
        "A shallow site that rewards slow, careful buoyancy, where photographers have time to look.",
      landmarks: [
        {
          name: "Sculptures and statues",
          kind: "underwaterMonument",
          note: "Statues and sculptures were placed here to help the coral grow.",
        },
      ],
      creatureSlugs: [
        "caribbean-reef-octopus",
        "caribbean-reef-squid",
        "longsnout-seahorse",
        "yellowtail-snapper",
      ],
    },
  },
  // Denominator row: La Playita (Playta)
  // Approximate pin: Scubago's point for La Playita, off the Bayahibe waterfront 0.5 km north of the Atlantic Princess. Good to about 2 km.
  // Depth: Go Dive Bayahibe gives 6 to 9 m.
  {
    slug: "la-playita-bayahibe",
    version: 1,
    area: "dominican-republic",
    sources: [
      "https://godivebayahibe.com/dive-sites-bayahibe/",
      "https://www.scubago.com/en/explore/divesite/la-playita-bayahibe-966944",
    ],
    briefing: {
      name: "La Playita",
      locationName: "Bayahibe, Dominican Republic",
      forecastLatitude: 18.3739,
      forecastLongitude: -68.8519,
      description:
        "A shallow site in Bayahibe with coral formations on one side and a sandy bottom on the other. It is not usually busy.",
      marineLife: "Yellow stingray · reef fish · coral",
      marineLifeDescription: "Rays rest on the sand side, and the coral side holds reef fish.",
      difficultyLevel: "beginner",
      depthMinMeters: 6,
      maxDepthMeters: 9,
      currentNote:
        "Current not documented; ask the crew on the day. Boats work off the Bayahibe waterfront, so listen for engines.",
      divePlan:
        "Descend on the coral side, follow it along, then cross to the sand to look for rays.",
      fitTone: "welcoming",
      fitNote: "Shallow and quiet, a good place for a first dive or a relaxed refresher.",
      creatureSlugs: ["yellow-stingray", "sergeant-major", "french-grunt", "blue-tang"],
    },
  },
  // Denominator row: Catalina Wall (The Wall)
  // Position: the midpoint of Zentacle's point (18.3734, -69.0063) and Scubago's (18.3763, -69.0052), 0.4 km apart, on the east side of Catalina Island.
  // Depth: Grand Bay gives a terrace at 1.5 to 6 m beside a drop-off it caps at 30 m for every level, and Ultra Marine runs 5 to 30 m with the depth matched to certification; Coral Point lists it for all levels. The sources describe the terrace as a dive in its own right, so the terrace is the dive. Operators run the wall itself to 30 m, so the plan floor is 18 m, the Open Water limit, and the drop-off lies beyond the plan.
  // Gate: none, per the walls rule's terrace exception: the terrace is an Open Water dive in its own right and the floor is 18 m; a shop can raise the floor and the gate for Advanced divers.
  {
    slug: "catalina-wall",
    version: 1,
    area: "dominican-republic",
    sources: [
      "https://www.grandbay-puntacana.com/sites/the-wall-catalina",
      "https://ultramarinedivers.com/explore-dive-sites.html",
      "https://www.coralpointdiving.com/En/divesite.html",
      "https://www.zentacle.com/Beach/2662/santa-catalina-wall",
      "https://www.scubago.com/en/explore/divesite/catalina-the-wall-131313",
    ],
    briefing: {
      name: "Catalina Wall",
      locationName: "Catalina Island, Dominican Republic",
      forecastLatitude: 18.3749,
      forecastLongitude: -69.0058,
      description:
        "A coral-covered terrace, 1.5 to 6 m deep, on the east side of Catalina Island ends at a wall that drops away past recreational depth. Sponges and corals cover every part of the face, and rays, turtles and larger fish pass in the blue.",
      marineLife: "Spotted eagle ray · hawksbill turtle · sea fans · barrel sponges",
      marineLifeDescription:
        "The wall’s crevices are full of reef life, and bigger animals pass along the edge.",
      conservationNote:
        "Catalina Island is a natural park with limited access. Ask the shop whether a park fee applies to the trip.",
      difficultyLevel: "intermediate",
      depthMinMeters: 2,
      maxDepthMeters: 18,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Land on the terrace and stay on it, no deeper than 18 m (59 ft). The wall drops past recreational depth beyond the plan; stay on the terrace side of the edge.",
      fitTone: "welcoming",
      fitNote:
        "The terrace is the dive, and the wall falls far past it. Catalina is a boat ride from Bayahibe; medical care is far, so confirm the boat’s oxygen and plan.",
      landmarks: [
        {
          name: "Coral terrace",
          kind: "reefFormation",
          note: "A shallow terrace covered in sponges and coral leads to the edge of the wall.",
        },
      ],
      creatureSlugs: [
        "spotted-eagle-ray",
        "hawksbill-turtle",
        "common-sea-fan",
        "giant-barrel-sponge",
      ],
    },
  },
  // Denominator row: Catalina Aquarium
  // Position: the midpoint of Zentacle's point (18.3639, -69.0225) and Scubago's (18.3588, -69.0284), 0.9 km apart, on the west side of Catalina Island, moved 50 m offshore so it is not on the rocks.
  // Depth: Ultra Marine and Pro Dive both give 8 to 12 m.
  {
    slug: "catalina-aquarium",
    version: 1,
    area: "dominican-republic",
    sources: [
      "https://ultramarinedivers.com/explore-dive-sites.html",
      "https://www.prodiveinternational.com/dive-site/aquarium/",
      "https://www.scubago.com/en/explore/divesite/catalina-aquarium-146674",
      "https://www.coralpointdiving.com/En/divesite.html",
    ],
    briefing: {
      name: "Catalina Aquarium",
      locationName: "Catalina Island, Dominican Republic",
      forecastLatitude: 18.3618,
      forecastLongitude: -69.0268,
      description:
        "A bright, gently sloping reef on the west side of Catalina Island, usually the second dive of a Catalina trip. Stingrays rest on the sand, and moray eels and lobster tuck into the coral.",
      marineLife: "Southern stingray · spiny lobster · spotted moray · balloonfish",
      marineLifeDescription:
        "Rays settle in the sand beside the reef, and eels and lobster stay in the coral.",
      conservationNote:
        "Catalina Island is a natural park with limited access. Ask the shop whether a park fee applies to the trip.",
      difficultyLevel: "beginner",
      depthMinMeters: 8,
      maxDepthMeters: 12,
      currentNote: "Usually light; it can change, so carry an SMB.",
      divePlan:
        "Descend onto the reef, follow the gentle slope along the coral, and cross the sand to look for rays.",
      fitTone: "welcoming",
      fitNote:
        "A shallow, relaxed reef that suits most certified divers as the second dive of the day. Catalina is a boat ride from Bayahibe; medical care is far, so confirm the boat’s oxygen and plan.",
      creatureSlugs: ["southern-stingray", "spiny-lobster", "spotted-moray", "balloonfish"],
    },
  },
];
