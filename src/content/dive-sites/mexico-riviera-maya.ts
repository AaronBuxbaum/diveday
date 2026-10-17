// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Cancún, Isla Mujeres and the Riviera Maya. */
export const MEXICO_RIVIERA_MAYA: DiveSiteTemplate[] = [
  // Denominator row: Cave of the Sleeping Sharks (Cueva de los Tiburones Dormidos)
  // Position: Cancún Scuba Center map pin, 580 m from the Scubago pin. Depth: the map gives an average of 20 m and a maximum of 30 m; Scubago says 16 m, so the range runs from 16 m. Advanced gate: the map rates it CMAS 2-star / AOW. The cave is an overhead; the briefing keeps divers outside it.
  {
    slug: "sleeping-shark-cave-isla-mujeres",
    version: 1,
    area: "mexico-riviera-maya",
    sources: [
      "https://www.google.com/maps/d/kml?mid=1PKwNU0zIRLFWcorRixr9C5Dc9bc&forcekml=1",
      "https://www.scubago.com/en/explore/divesite/sleeping-shark-cave-592732",
      "https://www.pocnadivecenter.com/dive-sites",
    ],
    briefing: {
      name: "Cave of the Sleeping Sharks",
      locationName: "Isla Mujeres, Mexico",
      forecastLatitude: 21.2673,
      forecastLongitude: -86.7353,
      description:
        "A cave site about 30 minutes by boat from Isla Mujeres, documented by Jacques Cousteau and Ramón Bravo in 1970. Sharks appear to sleep in the caves, and divers watch from outside.",
      marineLife: "Resting sharks · reef fish · coral",
      marineLifeDescription:
        "Sharks rest in the cave and are rarely visible from the mouth. Keep your distance and stay outside the cave.",
      difficultyLevel: "advanced",
      depthMinMeters: 16,
      maxDepthMeters: 30,
      currentNote: "Low current on most days, a little at times.",
      divePlan:
        "Down to the site, watch from a distance outside the cave, and come back up with reserve gas. The cave is overhead; stay out. Sharks are rarely visible from the mouth. Medical care is far; confirm the boat's oxygen and plan.",
      fitTone: "demanding",
      fitNote:
        "Depth puts this at Advanced Open Water, with a floor near 30 m. You watch from outside and leave the cave alone.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["french-grunt", "great-barracuda", "spiny-lobster", "green-moray"],
    },
  },
  // Denominator row: Ultrafreeze (El Frío)
  // Position: Cancún Scuba Center map pin. Depth: the map says 33 m, Squalo says 30 m; taking the deeper. Deep gate follows from 33 m. Pocna says the hull has openings; the briefing says stay outside.
  {
    slug: "ultrafreeze-wreck-isla-mujeres",
    version: 1,
    area: "mexico-riviera-maya",
    sources: [
      "https://www.google.com/maps/d/kml?mid=1PKwNU0zIRLFWcorRixr9C5Dc9bc&forcekml=1",
      "https://squaloadventures.com/tours/isla-mujeres-scuba-diving/2-tank-dive-shipwreck-drift-dive/",
      "https://www.pocnadivecenter.com/dive-sites",
      "https://www.scubatotal.com/post/exploring-hidden-gems-unique-dive-spots-in-cancun-beyond-the-tourist-trail",
    ],
    briefing: {
      name: "Ultrafreeze",
      locationName: "Isla Mujeres, Mexico",
      forecastLatitude: 21.2676,
      forecastLongitude: -86.7189,
      description:
        "A 61 m former cargo ship sunk as a reef, the oldest wreck off Isla Mujeres. A hurricane split the hull in 1992. Far from the coast, deep, and covered in coral and sponges.",
      marineLife: "Groupers · jacks · eagle rays · barracuda",
      marineLifeDescription:
        "Fish crowd the broken hull, with groupers, jacks and barracuda along the decks.",
      difficultyLevel: "advanced",
      depthMinMeters: 30,
      maxDepthMeters: 33,
      currentNote: "Strong current. Carry an SMB and listen for boat engines on the ascent.",
      divePlan:
        "Down the line to the hull, along the outside of the wreck, and up with reserve gas.",
      fitTone: "demanding",
      fitNote: "Deep, far offshore and usually running with current. Stay outside the hull.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "great-barracuda",
        "spotted-eagle-ray",
        "horse-eye-jack",
        "black-grouper",
        "common-sea-fan",
      ],
    },
  },
  // Denominator row: MUSA, Manchones gallery (Underwater Museum, Casitas)
  // Position: Cancún Scuba Center map pin, 700 m from the Scubago pin. Depth: the map says 10 m; Wet Set gives 4 m for the shallow rooms and up to 12 m for the deeper ones, so taking 12 m.
  {
    slug: "musa-underwater-museum-cancun",
    version: 1,
    area: "mexico-riviera-maya",
    sources: [
      "https://www.google.com/maps/d/kml?mid=1PKwNU0zIRLFWcorRixr9C5Dc9bc&forcekml=1",
      "https://wetset.com/dive-sites/",
      "https://www.scubago.com/en/explore/divesite/cancun-underwater-museummusa-71431",
      "https://www.pocnadivecenter.com/dive-sites",
    ],
    briefing: {
      name: "MUSA Underwater Museum",
      locationName: "Isla Mujeres, Mexico",
      forecastLatitude: 21.2119,
      forecastLongitude: -86.746,
      description:
        "Hundreds of life-size sculptures standing on sand just outside the Manchones reef, placed to give coral and fish somewhere new to settle. The shallow rooms suit snorkelers; divers use the deeper rows.",
      marineLife: "Reef fish · juvenile coral · sponges",
      marineLifeDescription:
        "Figures are crusted with sponges and young coral. Look at the people, then at what lives on them.",
      difficultyLevel: "beginner",
      depthMinMeters: 4,
      maxDepthMeters: 12,
      currentNote:
        "Boat and snorkeler traffic. Carry an SMB and listen for engines. Low current, around 1 knot. Many operators visit, so midday is busy.",
      divePlan:
        "Follow the rows of figures at 10 m, one gallery at a time, and keep fins off the sculptures.",
      fitTone: "welcoming",
      fitNote: "Shallow, clear and easy. Go early to have the figures to yourself.",
      landmarks: [
        {
          name: "Sculpture rooms",
          kind: "underwaterMonument",
          note: "Rows of figures by international artists, including the Casitas houses.",
        },
      ],
      creatureSlugs: ["french-grunt", "queen-parrotfish", "sergeant-major", "spiny-lobster"],
    },
  },
  // Denominator row: Manchones (Manchones Grande, Manchones Chico, Manchones 1, Manchones 2)
  // Position: Manchones Grande, Cancún Scuba Center map pin (Scubago's pin is 300 m away). Depth: the map gives an average of 8 m and a maximum of 9.5 m; the park programme gives an average of 10 m.
  {
    slug: "manchones-reef-isla-mujeres",
    version: 1,
    area: "mexico-riviera-maya",
    sources: [
      "https://www.google.com/maps/d/kml?mid=1PKwNU0zIRLFWcorRixr9C5Dc9bc&forcekml=1",
      "https://faolex.fao.org/docs/pdf/mex157815.pdf",
      "https://squaloadventures.com/tours/isla-mujeres-scuba-diving/2-tank-reef-dive-isla-mujeres-manchones-grande-atlantis-squalo-adventures/",
      "https://www.scubatotal.com/post/top-8-dive-sites-in-cancun-a-diver-s-guide-to-the-caribbean-s-hidden-treasures",
    ],
    briefing: {
      name: "Manchones Reef",
      locationName: "Isla Mujeres, Mexico",
      forecastLatitude: 21.2055,
      forecastLongitude: -86.7444,
      description:
        "Patch reefs separated by sand, with coral heads 3 to 5 m tall. Hurricanes have battered it, but turtles and schooling fish still use it, and it is the island's standard training site.",
      marineLife: "Sea turtles · schooling grunts · rays · nurse sharks",
      marineLifeDescription:
        "Turtles feed on the patches, and a nurse shark turns up now and then.",
      difficultyLevel: "beginner",
      depthMinMeters: 8,
      maxDepthMeters: 10,
      currentNote:
        "Boat and snorkeler traffic. Carry an SMB and listen for engines. Low current, under 1 knot. A few swim-throughs cut the reef; they are overheads, so stay out of them.",
      fitTone: "welcoming",
      fitNote: "Shallow, bright and calm. A good first reef dive in Isla Mujeres.",
      creatureSlugs: [
        "green-sea-turtle",
        "french-grunt",
        "nurse-shark",
        "southern-stingray",
        "sergeant-major",
      ],
    },
  },
  // Denominator row: Punta Sur (Isla Mujeres)
  // Position derived: the midpoint of the Cancún Scuba Center map pin (1.4 km south-southwest of the tip, in open water) and the Scubago pin on the point itself, so it is within 700 m of both and over the drift off the tip. Advanced gate: the map rates the current at 2 knots for advanced divers.
  {
    slug: "punta-sur-isla-mujeres",
    version: 1,
    area: "mexico-riviera-maya",
    sources: [
      "https://www.google.com/maps/d/kml?mid=1PKwNU0zIRLFWcorRixr9C5Dc9bc&forcekml=1",
      "https://www.scubago.com/en/explore/divesite/punta-sur-isla-mujeres-258767",
      "https://www.mundacadivers.com/dives-for-certified-divers",
    ],
    briefing: {
      name: "Punta Sur",
      locationName: "Isla Mujeres, Mexico",
      forecastLatitude: 21.1959,
      forecastLongitude: -86.7135,
      description:
        "A drift dive off the southern tip of Isla Mujeres, about 15 minutes by boat from the north of the island. Big turtles pass through from May to July.",
      marineLife: "Sea turtles · reef fish",
      marineLifeDescription: "Turtles are the draw in May to July.",
      difficultyLevel: "advanced",
      depthMinMeters: 10,
      maxDepthMeters: 11,
      currentNote:
        "Current around 2 knots, run as a drift. Carry an SMB and plan where the boat will pick you up.",
      divePlan: "Drop in uptide of the point and drift with the boat following your SMB.",
      fitTone: "demanding",
      fitNote:
        "Shallow water, but the current makes it a diver's dive. Comfortable drift skills first.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["green-sea-turtle", "hawksbill-turtle", "french-grunt", "great-barracuda"],
    },
  },
  // Denominator row: La Bandera (Banderas)
  // Position: Cancún Scuba Center map pin. Depth: average 8 m, maximum 9.2 m on the map. Advanced gate: the map and Scuba Total both call the current strong, and Mundaca runs it as a drift; Pocna calls it light, so the stricter reading wins.
  {
    slug: "la-bandera-reef-cancun",
    version: 1,
    area: "mexico-riviera-maya",
    sources: [
      "https://www.google.com/maps/d/kml?mid=1PKwNU0zIRLFWcorRixr9C5Dc9bc&forcekml=1",
      "https://faolex.fao.org/docs/pdf/mex157815.pdf",
      "https://www.scubatotal.com/post/top-8-dive-sites-in-cancun-a-diver-s-guide-to-the-caribbean-s-hidden-treasures",
      "https://www.pocnadivecenter.com/dive-sites",
    ],
    briefing: {
      name: "La Bandera",
      locationName: "Cancún, Mexico",
      forecastLatitude: 21.1679,
      forecastLongitude: -86.7268,
      description:
        "A low-relief reef between Isla Mujeres and Punta Cancún, dense with sea fans and tube sponges. Fewer boats come here than to Manchones.",
      marineLife: "Barracuda · snapper · angelfish · sea fans",
      marineLifeDescription: "Gorgonians cover the flat rock and the fish sit in them.",
      difficultyLevel: "advanced",
      depthMinMeters: 8,
      maxDepthMeters: 9,
      currentNote:
        "Usually strong current, and some days it cannot be dived. Carry an SMB. The reef has two swim-throughs, which are overheads: stay out of them.",
      fitTone: "demanding",
      fitNote:
        "Shallow, but the current is the reason the dive is called off. Drift-ready divers only.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "great-barracuda",
        "gray-snapper",
        "queen-angelfish",
        "common-sea-fan",
        "french-grunt",
      ],
    },
  },
  // Denominator row: Santo Remedio
  // Position: Cancún Scuba Center map pin, which puts it just east of Chitales as the park programme describes. The Scubago pin sits 3.6 km east and is not used. Depth: average 8 m, maximum 10.4 m on the map.
  // Gated Advanced Open Water for the 2-knot current, per domain review.
  {
    slug: "santo-remedio-reef-cancun",
    version: 1,
    area: "mexico-riviera-maya",
    sources: [
      "https://www.google.com/maps/d/kml?mid=1PKwNU0zIRLFWcorRixr9C5Dc9bc&forcekml=1",
      "https://faolex.fao.org/docs/pdf/mex157815.pdf",
      "https://www.scubago.com/en/explore/divesite/santo-remedio-78423",
    ],
    briefing: {
      name: "Santo Remedio",
      locationName: "Cancún, Mexico",
      forecastLatitude: 21.151,
      forecastLongitude: -86.7391,
      description:
        "A very small reef in the bay east of Chitales, with little relief and many soft corals.",
      marineLife: "Soft corals · reef fish",
      marineLifeDescription: "Soft corals and small reef fish.",
      difficultyLevel: "intermediate",
      depthMinMeters: 8,
      maxDepthMeters: 11,
      currentNote:
        "Boat and snorkeler traffic. Carry an SMB and listen for engines. Medium current, 1 to 2 knots, and up to 2 knots at times. Plan it as a drift.",
      fitTone: "demanding",
      fitNote:
        "Quiet and little visited, with a current that reaches 2 knots. For divers who carry an SMB and drift comfortably.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["common-sea-fan", "french-grunt", "sergeant-major", "bluehead-wrasse"],
    },
  },
  // Denominator row: Chitales (Chitales Grande, Chitales Chico)
  // Position: Cancún Scuba Center map pin, 1 km from the Scubago pin. Depth: the map says 8 to 9 m, the park programme and the tourism board say 10 m.
  {
    slug: "chitales-reef-cancun",
    version: 1,
    area: "mexico-riviera-maya",
    sources: [
      "https://www.google.com/maps/d/kml?mid=1PKwNU0zIRLFWcorRixr9C5Dc9bc&forcekml=1",
      "https://faolex.fao.org/docs/pdf/mex157815.pdf",
      "https://web.archive.org/web/20241005035901/https://mexicancaribbean.travel/cancun/things-to-do/nature-and-adventure/diving.html",
      "https://www.scubatotal.com/post/dive-into-paradise-best-9-scuba-sites-in-cancun",
    ],
    briefing: {
      name: "Chitales",
      locationName: "Cancún, Mexico",
      forecastLatitude: 21.1462,
      forecastLongitude: -86.7482,
      description:
        "Two patch reefs 30 m apart on a sand channel, near the north point of Punta Cancún. Hurricanes took much of the live coral.",
      marineLife: "Sea turtles · lobster · rays · groupers",
      marineLifeDescription: "Turtles feed here and rays cross the sand.",
      difficultyLevel: "beginner",
      depthMinMeters: 8,
      maxDepthMeters: 10,
      currentNote:
        "Boat and snorkeler traffic. Carry an SMB and listen for engines. Current at Chitales is not documented, and the neighboring reef, Santo Remedio, runs 1 to 2 knots; ask the crew on the day.",
      fitTone: "unknown",
      fitNote:
        "Shallow, with turtles, but the neighboring reefs run 1 to 2 knots. The reef is worn, so the visit is about the animals.",
      // Gated Advanced Open Water: no source calls Chitales calm, and Santo Remedio, just east of it, is documented at 1 to 2 knots.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "green-sea-turtle",
        "spiny-lobster",
        "southern-stingray",
        "nassau-grouper",
        "french-grunt",
      ],
    },
  },
  // Denominator row: Atlantis
  // Position derived: the park programme places the reef balls of the old Atlantis submarine route in the south of Manchones, and Pocna says the dive ends at Manchones. The pin sits 600 m south of Manchones Grande. Depth: the park programme gives 25 to 30 ft (7.6 to 9.1 m) for the reef balls.
  {
    slug: "atlantis-reef-isla-mujeres",
    version: 1,
    area: "mexico-riviera-maya",
    sources: [
      "https://faolex.fao.org/docs/pdf/mex157815.pdf",
      "https://www.pocnadivecenter.com/dive-sites",
      "https://squaloadventures.com/tours/isla-mujeres-scuba-diving/2-tank-reef-dive-isla-mujeres-manchones-grande-atlantis-squalo-adventures/",
    ],
    briefing: {
      name: "Atlantis Reef",
      locationName: "Isla Mujeres, Mexico",
      forecastLatitude: 21.2,
      forecastLongitude: -86.744,
      description:
        "Reef balls placed south of Manchones, with a small wreck among them. Stay outside the hull. A gentle drift carries you over them and onto the Manchones reef.",
      marineLife: "Reef fish · juvenile grunts",
      marineLifeDescription: "The reef balls are young habitat, and small fish have moved in.",
      difficultyLevel: "beginner",
      depthMinMeters: 8,
      maxDepthMeters: 9,
      currentNote:
        "Boat and snorkeler traffic. Carry an SMB and listen for engines. A gentle drift current carries you toward Manchones.",
      divePlan:
        "Start over the reef balls, follow the drift, and finish on the Manchones reef. Stay outside the hull.",
      fitTone: "welcoming",
      fitNote: "Shallow, calm and short on hazards. A good second dive after Manchones.",
      creatureSlugs: ["french-grunt", "sergeant-major", "bluehead-wrasse", "queen-angelfish"],
    },
  },
  // Denominator row: Los Arcos
  // Position: Scubago pin. Depth: Pro Dive gives 21 to 30 m and Dressel 30 m. The wall drops past 30 m; the plan's floor is 30 m, so the gate is Advanced Open Water without the Deep specialty.
  {
    slug: "los-arcos-playa-del-carmen",
    version: 1,
    area: "mexico-riviera-maya",
    sources: [
      "https://www.scubago.com/en/explore/divesite/los-arcos-playa-del-carmen-17439",
      "https://www.prodiveinternational.com/dive-site/los-arcos/",
      "https://dresseldivers.com/dive/mexico/playa-del-carmen-scuba-diving",
    ],
    briefing: {
      name: "Los Arcos",
      locationName: "Playa del Carmen, Mexico",
      forecastLatitude: 20.6454,
      forecastLongitude: -87.0319,
      description:
        "A wall named for its two arches, north of Pared Verde. The reef plateau sits above it, and the wall falls away into the blue.",
      marineLife: "Turtles · rays · moray eels · groupers",
      marineLifeDescription:
        "Big animals pass along the wall; look under the ledges for crustaceans.",
      difficultyLevel: "advanced",
      depthMinMeters: 21,
      maxDepthMeters: 30,
      currentNote:
        "Boat traffic first: ferries to Cozumel and dive boats use this water, so carry an SMB, send it up before you ascend and listen for engines. Strong current.",
      divePlan:
        "Start at the south end, go down beside the wall no deeper than 30 m, work north, and finish on the plateau with reserve gas.",
      fitTone: "demanding",
      fitNote:
        "A wall dive in current, where the depth is yours to hold. If nitrox is used, a nitrox mix is analyzed and its MOD set for the deepest point of the dive; staff confirm the mix before boarding.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "green-sea-turtle",
        "southern-stingray",
        "green-moray",
        "black-grouper",
        "spiny-lobster",
      ],
    },
  },
  // Denominator row: Pared Verde (Green Wall)
  // Position derived: Pro Dive places Pared Verde north of Moc-Che and south of Los Arcos; the pin is the midpoint of the Scubago pins for Moc-Che Deep and Los Arcos, 500 m from each. Depth 21 to 30 m at Pro Dive, 20 to 30 m at Dressel. The wall drops past 30 m; the floor is the plan's.
  {
    slug: "pared-verde-playa-del-carmen",
    version: 1,
    area: "mexico-riviera-maya",
    sources: [
      "https://www.prodiveinternational.com/dive-site/pared-verde/",
      "https://dresseldivers.com/dive/mexico/playa-del-carmen-scuba-diving",
      "https://scubaplaya.com/en/playa-del-carmen-diving/",
    ],
    briefing: {
      name: "Pared Verde",
      locationName: "Playa del Carmen, Mexico",
      forecastLatitude: 20.6425,
      forecastLongitude: -87.0356,
      description:
        "The Green Wall: a wall reef that ranges from short walls divided by sand to a long stretch that drops off into the blue. Rich in coral.",
      marineLife: "Lobster · king crab · turtles · stingrays",
      marineLifeDescription: "Crustaceans in the ledges and turtles along the face.",
      difficultyLevel: "advanced",
      depthMinMeters: 21,
      maxDepthMeters: 30,
      currentNote:
        "Boat traffic first: ferries to Cozumel and dive boats use this water, so carry an SMB, send it up before you ascend and listen for engines. Medium to strong current.",
      divePlan:
        "Go down at the south end with the reef on your left, follow the wall north no deeper than 30 m, and come up with reserve gas.",
      fitTone: "demanding",
      fitNote: "A wall that keeps going, with a current. You hold the floor.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "spiny-lobster",
        "green-sea-turtle",
        "southern-stingray",
        "horse-eye-jack",
        "green-moray",
      ],
    },
  },
  // Denominator row: Moc-Che Deep
  // Position: Scubago pin. Depth: Pro Dive 20 to 30 m, Scubago 26 to 28 m, Dressel 24 to 25 m at the south end. The wall's top is within the range; the drop below 30 m is the plan's floor.
  {
    slug: "moc-che-deep-playa-del-carmen",
    version: 1,
    area: "mexico-riviera-maya",
    sources: [
      "https://www.scubago.com/en/explore/divesite/moc-che-deep-13493",
      "https://www.prodiveinternational.com/dive-site/moc-che-deep/",
      "https://www.dresseldivers.com/blog/playa-carmen-reefs-scuba-diving/",
    ],
    briefing: {
      name: "Moc-Che Deep",
      locationName: "Playa del Carmen, Mexico",
      forecastLatitude: 20.6396,
      forecastLongitude: -87.0393,
      description:
        "A wall of 5 to 6 m running along the reef, north of Coco Beach. You drop to the bottom at the south end and drift north along it.",
      marineLife: "Groupers · jacks · moray eels · eagle rays",
      marineLifeDescription:
        "Eagle rays pass along the wall; bull sharks are seasonal, so follow the crew's briefing.",
      difficultyLevel: "advanced",
      depthMinMeters: 20,
      maxDepthMeters: 30,
      currentNote:
        "Boat traffic first: ferries to Cozumel and dive boats use this water, so carry an SMB, send it up before you ascend and listen for engines. Changing, medium to strong current.",
      divePlan:
        "Drop at the south end, drift north along the wall no deeper than 30 m, and ascend with reserve gas. Bull sharks are seasonal, and out of season it is a wall dive without them; no animal is promised. If one appears, stay put, keep the group together, keep nothing dangling, never chase or touch, and follow the crew's briefing.",
      fitTone: "demanding",
      fitNote: "A drift along a wall at depth. Good air management and a plan for the surface.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "green-moray",
        "horse-eye-jack",
        "spotted-eagle-ray",
        "spiny-lobster",
        "black-grouper",
      ],
    },
  },
  // Denominator row: Moc-Che (Moc-Che Shallow)
  // Position derived: Pro Dive puts the shallow reef in front of Moc-Che Deep, so the pin is 600 m inshore of the Scubago pin for Moc-Che Deep. Depth 24 to 50 ft at Pro Dive.
  {
    slug: "moc-che-shallow-playa-del-carmen",
    version: 1,
    area: "mexico-riviera-maya",
    sources: [
      "https://www.prodiveinternational.com/dive-site/moc-che-shallow/",
      "https://www.dresseldivers.com/blog/playa-carmen-reefs-scuba-diving/",
      "https://scubaplaya.com/en/playa-del-carmen-diving/",
    ],
    briefing: {
      name: "Moc-Che Shallow",
      locationName: "Playa del Carmen, Mexico",
      forecastLatitude: 20.6396,
      forecastLongitude: -87.045,
      description:
        "The shortest of the shallow reefs here, covered in small coral formations in front of Moc-Che Deep, with a small arch of fish and sponges at the north end.",
      marineLife: "Reef fish · sponges · coral",
      marineLifeDescription:
        "Small coral heads, with fish packed around the arch at the north end. The arch is overhead; stay out.",
      difficultyLevel: "beginner",
      depthMinMeters: 7,
      maxDepthMeters: 14,
      currentNote:
        "Boat traffic first: ferries to Cozumel and dive boats use this water, so carry an SMB, send it up before you ascend and listen for engines. Current is usually light; it can change, so carry an SMB.",
      divePlan:
        "Start at the south tip, swim north slowly, and turn the dive before the arch at the north end. The arch is overhead; stay out.",
      fitTone: "welcoming",
      fitNote: "Short and shallow, a relaxed second dive. Stay out of the arch.",
      creatureSlugs: ["french-grunt", "queen-parrotfish", "bluehead-wrasse", "common-sea-fan"],
    },
  },
  // Denominator row: Cueva del Pargo
  // Position: Scubago pin (listed as Pargo Cave). Depth 33 ft (10 m) at Pro Dive, 40 ft (12 m) at Dressel.
  {
    slug: "cueva-del-pargo-playa-del-carmen",
    version: 1,
    area: "mexico-riviera-maya",
    sources: [
      "https://www.scubago.com/en/explore/divesite/pargo-cave-78398",
      "https://www.prodiveinternational.com/dive-site/cueva-del-pargo/",
      "https://dresseldivers.com/dive/mexico/playa-del-carmen-scuba-diving",
    ],
    briefing: {
      name: "Cueva del Pargo",
      locationName: "Playa del Carmen, Mexico",
      forecastLatitude: 20.6357,
      forecastLongitude: -87.0548,
      description:
        "A reef with a large round overhang filled with snappers, and a conch-shell statue of the Virgen del Carmen over 2 m high.",
      marineLife: "Snappers · reef fish · lobster",
      marineLifeDescription:
        "Snappers fill the overhang. Overhead; stay out. Look from outside the ledge and keep off the bottom.",
      difficultyLevel: "beginner",
      depthMinMeters: 10,
      maxDepthMeters: 12,
      currentNote:
        "Boat traffic first: ferries to Cozumel and dive boats use this water, so carry an SMB, send it up before you ascend and listen for engines. Weak current.",
      fitTone: "welcoming",
      fitNote: "Shallow with little current and plenty of time. Good for photography.",
      landmarks: [
        {
          name: "Virgen del Carmen",
          kind: "underwaterMonument",
          note: "A conch-shell statue over 2 m high, a favorite for a photo.",
        },
      ],
      creatureSlugs: ["schoolmaster-snapper", "french-grunt", "spiny-lobster", "queen-angelfish"],
    },
  },
  // Denominator row: Shangri-La
  // Position: Scubago pin. Depth 8 to 10 m at Pro Dive, 39 ft (12 m) at Dressel.
  {
    slug: "shangri-la-playa-del-carmen",
    version: 1,
    area: "mexico-riviera-maya",
    sources: [
      "https://www.scubago.com/en/explore/divesite/shangri-la-playa-del-carmen-106759",
      "https://www.prodiveinternational.com/dive-site/shangri-la/",
      "https://dresseldivers.com/dive/mexico/playa-del-carmen-scuba-diving",
    ],
    briefing: {
      name: "Shangri-La",
      locationName: "Playa del Carmen, Mexico",
      forecastLatitude: 20.6283,
      forecastLongitude: -87.0626,
      description:
        "A reef that runs parallel to the shore, five minutes by boat from Playa del Carmen. Many sponges, hard corals and tropical fish.",
      marineLife: "Sponges · hard corals · reef fish",
      marineLifeDescription: "Sponges and hard coral crowd the reef, with fish in every gap.",
      difficultyLevel: "beginner",
      depthMinMeters: 8,
      maxDepthMeters: 12,
      currentNote:
        "Boat traffic first: ferries to Cozumel and dive boats use this water, so carry an SMB, send it up before you ascend and listen for engines. Mild current. Dive it north to south or the reverse, depending on the current that day.",
      fitTone: "welcoming",
      fitNote: "Easy navigation along a straight reef. Good for first reef dives here.",
      creatureSlugs: [
        "french-grunt",
        "queen-angelfish",
        "azure-vase-sponge",
        "giant-barrel-sponge",
        "green-moray",
      ],
    },
  },
  // Denominator row: Chun Zumbul (Chun-Zumbul Shallow)
  // Position: Scubago pin (the shallow reef, not Chun Zumbul Deep). Depth 20 to 45 ft at Pro Dive.
  {
    slug: "chun-zumbul-playa-del-carmen",
    version: 1,
    area: "mexico-riviera-maya",
    sources: [
      "https://www.scubago.com/en/explore/divesite/chun-zumbul-141367",
      "https://www.prodiveinternational.com/dive-site/chun-zumbul/",
      "https://scubaplaya.com/en/playa-del-carmen-diving/",
    ],
    briefing: {
      name: "Chun Zumbul",
      locationName: "Playa del Carmen, Mexico",
      forecastLatitude: 20.6319,
      forecastLongitude: -87.0587,
      description:
        "A long, shallow reef in front of Coco Beach, close enough to shore for a short boat ride. Garden-like coral with overhangs along its length.",
      marineLife: "Rays · moray eels · flounders · arrow crabs",
      marineLifeDescription: "Look on the sand beside the reef for rays and flounders.",
      difficultyLevel: "beginner",
      depthMinMeters: 6,
      maxDepthMeters: 13,
      currentNote:
        "Boat traffic first: ferries to Cozumel and dive boats use this water, so carry an SMB, send it up before you ascend and listen for engines. Current is usually light; it can change, so carry an SMB. Drift north along the reef from its southern end.",
      divePlan: "Start at the south end and drift north along the reef.",
      fitTone: "welcoming",
      fitNote:
        "One of the longest shallow dives here, and a short boat ride. Good for anyone who dislikes long crossings.",
      creatureSlugs: [
        "green-moray",
        "southern-stingray",
        "peacock-flounder",
        "arrow-crab",
        "french-grunt",
      ],
    },
  },
  // Denominator row: Cerebros (Brains)
  // Position: Scubago pin. Depth 20 to 45 ft at Pro Dive, 39 ft (12 m) at Dressel.
  {
    slug: "cerebros-playa-del-carmen",
    version: 1,
    area: "mexico-riviera-maya",
    sources: [
      "https://www.scubago.com/en/explore/divesite/cerebros-17445",
      "https://www.prodiveinternational.com/dive-site/cerebros/",
      "https://dresseldivers.com/dive/mexico/playa-del-carmen-scuba-diving",
    ],
    briefing: {
      name: "Cerebros",
      locationName: "Playa del Carmen, Mexico",
      forecastLatitude: 20.6519,
      forecastLongitude: -87.0321,
      description:
        "Brain and mountain corals line the reef edge, north of Los Arcos in front of Tres Rios. The least dived reef here because it is farthest from town.",
      marineLife: "Lobster · king crab · moray eels · reef fish",
      marineLifeDescription: "Brain corals carry the dive, with lobsters and crabs underneath.",
      difficultyLevel: "beginner",
      depthMinMeters: 6,
      maxDepthMeters: 13,
      currentNote:
        "Boat traffic first: ferries to Cozumel and dive boats use this water, so carry an SMB, send it up before you ascend and listen for engines. Current is usually light; it can change.",
      divePlan:
        "Start at the south end and follow the reef edge, in calm weather for the best view.",
      fitTone: "welcoming",
      fitNote: "Easy, shallow and quiet. Good visibility on calm days.",
      creatureSlugs: ["boulder-brain-coral", "spiny-lobster", "green-moray", "french-grunt"],
    },
  },
  // Denominator row: Jardines (Playa del Carmen)
  // Position: Scubago pin. Depth 20 to 45 ft at Pro Dive, 12 m at Dressel.
  {
    slug: "jardines-playa-del-carmen",
    version: 1,
    area: "mexico-riviera-maya",
    sources: [
      "https://www.scubago.com/en/explore/divesite/jardines-80316",
      "https://www.prodiveinternational.com/dive-site/jardines/",
      "https://www.dresseldivers.com/blog/playa-carmen-reefs-scuba-diving/",
    ],
    briefing: {
      name: "Jardines",
      locationName: "Playa del Carmen, Mexico",
      forecastLatitude: 20.6246,
      forecastLongitude: -87.0608,
      description:
        "A shallow reef with a small coral and sponge wall about 2 m tall, with small caves and overhangs where fish shelter. Overhead; stay out.",
      marineLife: "Green morays · trunkfish · parrotfish · lobster",
      marineLifeDescription: "Look in the crevices for morays and under the ledges for lobsters.",
      difficultyLevel: "beginner",
      depthMinMeters: 6,
      maxDepthMeters: 13,
      currentNote:
        "Boat traffic first: the reef lies under the boats' route, so send up an SMB before you ascend and listen for engines. Current is little to none, and it can change direction quickly.",
      divePlan:
        "Stroll the middle of the reef, swim along its top, and send the SMB before the ascent.",
      fitTone: "welcoming",
      fitNote: "Calm and rewarding for slow divers. Mind the boats above on the way up.",
      creatureSlugs: [
        "green-moray",
        "spotted-trunkfish",
        "queen-parrotfish",
        "spiny-lobster",
        "trumpetfish",
      ],
    },
  },
  // Denominator row: Tortugas (Turtles)
  // Position: Scubago pin. Depth: Pro Dive 16 to 30 m on a flat reef that slopes from 15 to 40 m, Dressel 22 m. The slope runs past the plan; the floor is 30 m, so the gate is Advanced Open Water without the Deep specialty.
  {
    slug: "tortugas-playa-del-carmen",
    version: 1,
    area: "mexico-riviera-maya",
    sources: [
      "https://www.scubago.com/en/explore/divesite/tortugas-reef-152480",
      "https://www.prodiveinternational.com/dive-site/tortugas/",
      "https://www.dresseldivers.com/blog/playa-carmen-reefs-scuba-diving/",
    ],
    briefing: {
      name: "Tortugas",
      locationName: "Playa del Carmen, Mexico",
      forecastLatitude: 20.5751,
      forecastLongitude: -87.1049,
      description:
        "A flat reef that slopes gently away past the plan's 30 m floor, covered in coral and big barrel sponges, with many hawksbill turtles. In summer, tarpon gather near the end of the dive.",
      marineLife: "Hawksbill turtles · barracuda · jacks · stingrays",
      marineLifeDescription:
        "Hawksbill turtles are common; bull sharks are seasonal, so follow the crew's briefing.",
      difficultyLevel: "advanced",
      depthMinMeters: 16,
      maxDepthMeters: 30,
      currentNote:
        "Boat traffic first: ferries to Cozumel and dive boats use this water, so carry an SMB, send it up before you ascend and listen for engines. Medium to strong current, running south to north.",
      divePlan:
        "Start at the south end, drift with the current, hold 18 to 22 m (60 to 70 ft), and stay no deeper than 30 m. Bull sharks are seasonal, and out of season it is a drift without them; no animal is promised. If one appears, stay put, keep the group together, keep nothing dangling, never chase or touch, and follow the crew's briefing.",
      fitTone: "demanding",
      fitNote: "A drift over a slope that goes deeper than you should. Hold your depth.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "hawksbill-turtle",
        "great-barracuda",
        "horse-eye-jack",
        "southern-stingray",
        "giant-barrel-sponge",
        "tarpon",
      ],
    },
  },
  // Denominator row: Barracuda
  // Position: Scubago pin (this is the Playa del Carmen reef, not Cozumel's Barracuda). Depth 36 to 46 ft (12 to 14 m) at Dressel. Advanced gate: Scubago calls the current strong; Scuba Playa calls the reef an intermediate drift.
  {
    slug: "barracuda-playa-del-carmen",
    version: 1,
    area: "mexico-riviera-maya",
    sources: [
      "https://www.scubago.com/en/explore/divesite/barracuda-playa-del-carmen-148275",
      "https://www.dresseldivers.com/blog/playa-carmen-reefs-scuba-diving/",
      "https://scubaplaya.com/en/playa-del-carmen-diving/",
    ],
    briefing: {
      name: "Barracuda",
      locationName: "Playa del Carmen, Mexico",
      forecastLatitude: 20.5783,
      forecastLongitude: -87.1092,
      description:
        "A reef shaped like a hand, with bays between the fingers. The current carries you from bay to bay, and the bays are sheltered enough to stop and look.",
      marineLife: "Barracuda · giant morays · lobster · crabs",
      marineLifeDescription: "Barracuda hunt the small fish, and big morays sit in the bays.",
      difficultyLevel: "advanced",
      depthMinMeters: 12,
      maxDepthMeters: 14,
      currentNote:
        "Boat traffic first: ferries to Cozumel and dive boats use this water, so carry an SMB, send it up before you ascend and listen for engines. Strong current at times.",
      fitTone: "demanding",
      fitNote: "Shallow, but the current decides the dive. Use the bays to rest.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["great-barracuda", "green-moray", "spiny-lobster", "french-grunt"],
    },
  },
  // Denominator row: Shark Point (Bull Shark Point)
  // Position: Scubago pin. Depth: the observation area is a sandy bottom at about 27 m reached by a fixed line (Tank-Ha); the site is a deep dive of up to 30 m. Season: Tank-Ha says mid-November to mid-February; Pro Dive says December to March; Scubago's sightings peak in November and December.
  {
    slug: "shark-point-playa-del-carmen",
    version: 1,
    area: "mexico-riviera-maya",
    sources: [
      "https://www.scubago.com/en/explore/divesite/shark-point-playa-del-carmen-126031",
      "https://tankha.com/diving/bull-shark-observation-dive",
      "https://www.prodiveinternational.com/dive-site/bull-shark-point/",
    ],
    briefing: {
      name: "Shark Point",
      locationName: "Playa del Carmen, Mexico",
      forecastLatitude: 20.6228,
      forecastLongitude: -87.0567,
      description:
        "A seasonal bull shark dive, five minutes by boat from Playa del Carmen. Pregnant females visit the waters off town from about mid-November to mid-February, tapering through March. Divers descend a fixed line to a sandy bottom and watch.",
      marineLife: "Bull sharks in season · southern stingrays · green morays",
      marineLifeDescription:
        "Observation only, with no bait and no feeding. Sharks are seasonal and never certain. Out of season the dive is a sand dive at 27 m with no sharks.",
      difficultyLevel: "advanced",
      maxDepthMeters: 28,
      currentNote:
        "Boat traffic first: ferries to Cozumel and dive boats use this water, so carry an SMB, send it up before you ascend and listen for engines. The crew confirms the current before the dive.",
      divePlan:
        "Follow the crew's briefing. Down the fixed line to the sand, and stay behind the line or on the bottom where briefed. Do not chase or touch a shark, keep nothing dangling, and keep the group together. Bottom time at 27 m is short, so watch your no-decompression time. If nitrox is used, a nitrox mix is analyzed and its MOD set for the deepest point of the dive; staff confirm the mix before boarding. Come up the line with reserve gas.",
      fitTone: "demanding",
      fitNote:
        "Staff confirm recent logged dives before boarding. Calm breathing matters whether or not the sharks come.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["bull-shark", "southern-stingray", "green-moray", "great-barracuda"],
    },
  },
  // Denominator row: Mama Viña
  // Position: Scubago pin. Depth: Pro Dive 18 to 30 m; Dressel puts the deck near 15 m and the deeper parts near 28 m; Scubago 28 m. Pro Dive describes entering the lower deck; the briefing says stay outside.
  {
    slug: "mama-vina-wreck-playa-del-carmen",
    version: 1,
    area: "mexico-riviera-maya",
    sources: [
      "https://www.scubago.com/en/explore/divesite/mama-via-wreck-197199",
      "https://www.prodiveinternational.com/dive-site/mama-vina-wreck/",
      "https://www.dresseldivers.com/blog/playa-carmen-reefs-scuba-diving/",
    ],
    briefing: {
      name: "Mama Viña",
      locationName: "Playa del Carmen, Mexico",
      forecastLatitude: 20.5695,
      forecastLongitude: -87.1173,
      description:
        "A former shrimp boat sunk in 1995, small enough to tour in one dive. A hurricane moved it, and it now rests across the current in front of Xcaret.",
      marineLife: "Groupers · barracuda · turtles · green morays",
      marineLifeDescription: "Fish shelter on the hull and morays hide in the plating.",
      difficultyLevel: "advanced",
      depthMinMeters: 18,
      maxDepthMeters: 30,
      currentNote:
        "Boat traffic first: ferries to Cozumel and dive boats use this water, so carry an SMB, send it up before you ascend and listen for engines. Medium to strong current, running across the wreck from south to north.",
      divePlan:
        "Enter the water south of the wreck, hold 10 m until the bow shows, drop to the bottom, and circle the hull. Stay outside the hull.",
      fitTone: "demanding",
      fitNote: "A small wreck at depth in current. Stay outside the hull.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "black-grouper",
        "great-barracuda",
        "green-sea-turtle",
        "green-moray",
        "spiny-lobster",
      ],
    },
  },
  // Denominator row: C-56 Juan Escutia
  // Position: Scubago pin. Depth: Wet Set 28 m, Scubago 27 m, Koox 25 to 30 m, tourism board 30 m; taking 30 m. Wet Set says penetration needs wreck training; the briefing says stay outside.
  {
    slug: "c-56-juan-escutia-wreck-puerto-morelos",
    version: 1,
    area: "mexico-riviera-maya",
    sources: [
      "https://www.scubago.com/en/explore/divesite/barco-hundido-wreck-cadete-juan-escutia-c-56-475142",
      "https://wetset.com/dive-sites/",
      "https://www.kooxdiving.com/actividades/buceo-en-el-mar/buceo-arrecife-puerto-morelos/",
      "https://web.archive.org/web/20241005030020/https://mexicancaribbean.travel/puerto-morelos/things-to-do/water-activities.html",
    ],
    briefing: {
      name: "C-56 Juan Escutia",
      locationName: "Puerto Morelos, Mexico",
      forecastLatitude: 20.86,
      forecastLongitude: -86.8284,
      description:
        "A World War II minesweeper later used by the Mexican Navy, sunk on purpose as a reef and now sitting upright in the Puerto Morelos reef park. The deepest dive in Puerto Morelos.",
      marineLife: "Eagle rays · barracuda · sardines · garden eels",
      marineLifeDescription:
        "Twenty or more eagle rays circle the ship in season, and garden eels sway in the sand about 25 m south of the hull.",
      difficultyLevel: "advanced",
      depthMinMeters: 25,
      maxDepthMeters: 30,
      currentNote: "Moderate current as a rule; the tourism board calls it strong. Carry an SMB.",
      divePlan: "Down to the hull, along the outside of the deck, and back up with reserve gas.",
      fitTone: "demanding",
      fitNote: "Deep and in current, in a marine park. Stay outside the hull.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "spotted-eagle-ray",
        "great-barracuda",
        "porcupinefish",
        "garden-eel",
        "horse-eye-jack",
      ],
    },
  },
  // Denominator row: Puentes (Puente)
  // Position: Scubago pin. Depth about 20 m at Scubago; Wet Set calls it a deeper site with a gentle current. 20 m is past the Open Water limit, so the gate is Advanced Open Water.
  {
    slug: "puentes-reef-puerto-morelos",
    version: 1,
    area: "mexico-riviera-maya",
    sources: [
      "https://www.scubago.com/en/explore/divesite/puentes-475224",
      "https://wetset.com/dive-sites/",
      "https://web.archive.org/web/20241005030020/https://mexicancaribbean.travel/puerto-morelos/things-to-do/water-activities.html",
    ],
    briefing: {
      name: "Puentes",
      locationName: "Puerto Morelos, Mexico",
      forecastLatitude: 20.8107,
      forecastLongitude: -86.8632,
      description:
        "A ridge that ends in an enormous coral arch near the far end, the Bridge. Porkfish and French grunts gather in the light under it.",
      marineLife: "Porkfish · French grunts · lobster · crabs",
      marineLifeDescription: "Schools fill the arch, and lobsters sit along the ridge.",
      difficultyLevel: "intermediate",
      maxDepthMeters: 20,
      currentNote: "A gentle current that follows the ridge toward the arch.",
      divePlan: "Follow the ridge to the arch with the current and look at it from the side.",
      fitTone: "welcoming",
      fitNote: "Gentle current and a photogenic finish. Twenty meters, so Advanced Open Water.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["porkfish", "french-grunt", "spiny-lobster", "green-moray"],
    },
  },
  // Denominator row: Rodman (Rodman's Reef)
  // Position: Scubago pin. Depth 7 m at Scubago.
  {
    slug: "rodman-reef-puerto-morelos",
    version: 1,
    area: "mexico-riviera-maya",
    sources: [
      "https://www.scubago.com/en/explore/divesite/rodman-475222",
      "https://wetset.com/dive-sites/",
      "https://web.archive.org/web/20241005030020/https://mexicancaribbean.travel/puerto-morelos/things-to-do/water-activities.html",
    ],
    briefing: {
      name: "Rodman's Reef",
      locationName: "Puerto Morelos, Mexico",
      forecastLatitude: 20.8587,
      forecastLongitude: -86.8479,
      description:
        "A simple, shallow reef the boats pass on the way out. Calm diving with the occasional nurse shark along the bottom.",
      marineLife: "Nurse sharks · reef fish",
      marineLifeDescription: "Reef fish and the odd resting nurse shark.",
      difficultyLevel: "beginner",
      maxDepthMeters: 7,
      currentNote:
        "Boat traffic first: dive boats pass this reef on the way out, so carry an SMB, send it up before you ascend and listen for engines. Current is usually light; it can change. Visibility varies and can be limited.",
      fitTone: "welcoming",
      fitNote: "Shallow and calm, when the water is clear.",
      creatureSlugs: ["nurse-shark", "french-grunt", "queen-parrotfish", "common-sea-fan"],
    },
  },
  // Denominator row: Jardines (Puerto Morelos)
  // Position: Scubago pin. Depth: Scubago says the site starts at about 12 m.
  {
    slug: "jardines-puerto-morelos",
    version: 1,
    area: "mexico-riviera-maya",
    sources: [
      "https://www.scubago.com/en/explore/divesite/jardines-475238",
      "https://wetset.com/dive-sites/",
      "https://web.archive.org/web/20241005030020/https://mexicancaribbean.travel/puerto-morelos/things-to-do/water-activities.html",
    ],
    briefing: {
      name: "Jardines",
      locationName: "Puerto Morelos, Mexico",
      forecastLatitude: 20.8274,
      forecastLongitude: -86.8529,
      description:
        "An L-shaped section of reef where fans move in the current. The outer edge can be rough and the inside is calm, with a grassy area along the inner curve.",
      marineLife: "Trunkfish · small stingrays · triggerfish",
      marineLifeDescription:
        "The grass inside the curve holds juvenile fish, trunkfish and small stingrays.",
      difficultyLevel: "beginner",
      maxDepthMeters: 12,
      currentNote: "The outer edge can be rough; the inside is calm.",
      fitTone: "welcoming",
      fitNote: "Peaceful when conditions are right, and good for slow, small-animal divers.",
      creatureSlugs: [
        "spotted-trunkfish",
        "southern-stingray",
        "queen-triggerfish",
        "common-sea-fan",
      ],
    },
  },
];
