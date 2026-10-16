// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Barbados. */
export const BARBADOS: DiveSiteTemplate[] = [
  {
    slug: "stavronikita",
    version: 1,
    area: "barbados",
    sources: [
      "https://totallybarbados.com/articles/sports/scuba-diving/top-ten-dive-spots",
      "https://www.divehightide.com/dive-sites",
      "https://divewestsidescuba.com/diving/dive-sites/",
      "https://www.underwaterphotography.com/Dive-Sites/Country.aspx?ID=201",
    ],
    briefing: {
      name: "SS Stavronikita",
      locationName: "Fitts Village, west coast Barbados",
      // Approximate pin: off Fitts Village on the west coast, about 700 m offshore. Sources give 'off Fitts Village' and 'about 400 yards offshore'; no coordinates published (method: village coordinates from OpenStreetMap, moved seaward; good to about 2 km).
      forecastLatitude: 13.1475,
      forecastLongitude: -59.645,
      description:
        "A 111 m Greek freighter scuttled in 1978 after an engine-room fire, sitting upright with her masts reaching to about 6 m from the surface. The deck lies near 24 m and the stern drops to about 43 m. The sand lies deeper than the 40 m limit, so the plan stops above it.",
      marineLife: "Barracuda · jacks · hawksbill turtle · lobster",
      marineLifeDescription:
        "Barracuda and jacks patrol the hull, and the upper structure is crusted with coral and sponge.",
      difficultyLevel: "advanced",
      depthMinMeters: 6,
      maxDepthMeters: 40,
      currentNote:
        "Open water off the west coast. Current not documented; ask the crew on the day, and carry an SMB for the ascent.",
      divePlan:
        "Down to the deck at about 24 m, along the hull no deeper than 40 m (130 ft), and back up with a safety stop on the boat's line or an SMB. Stay outside the hull.",
      fitTone: "demanding",
      fitNote:
        "A deep wreck for divers with Advanced and Deep training who are comfortable in open water. Staff confirm the diver's log before boarding.",
      // Sources put the stern at 40 m (B, H, T) to 43 m (C); the plan is capped at the 40 m recreational limit and the sand lies deeper. Gate: depth.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "Masts",
          kind: "wreckFeature",
          note: "The masts rise to about 6 m from the surface, the shallowest part of the wreck.",
        },
      ],
      creatureSlugs: [
        "great-barracuda",
        "horse-eye-jack",
        "hawksbill-turtle",
        "spiny-lobster",
        "giant-barrel-sponge",
      ],
    },
  },
  {
    slug: "berwyn",
    version: 1,
    area: "barbados",
    sources: [
      "https://divebarbadosblue.com/about-us/dive-sites",
      "https://www.divehightide.com/dive-sites",
      "https://www.scubaguybarbados.com/divesites",
      "https://en.wikivoyage.org/wiki/Diving_in_Barbados",
    ],
    briefing: {
      name: "Berwyn",
      locationName: "Carlisle Bay Marine Park, Barbados",
      // Approximate pin: Carlisle Bay Marine Park off Bridgetown. No source publishes coordinates, so the pin sits in the bay and is spaced from the neighboring wreck pins (method: landmark plus spacing, good to about 1 km).
      forecastLatitude: 13.0862,
      forecastLongitude: -59.6119,
      description:
        "A 21 m French tug, damaged in the First World War and scuttled in 1919. She sits so shallow that her top lies only a few meters under the surface, wrapped in coral.",
      marineLife: "Frogfish · seahorses · eels · tropical reef fish",
      marineLifeDescription:
        "Small animals live in the wreck's growth, so slow down and look closely.",
      difficultyLevel: "beginner",
      depthMinMeters: 3,
      maxDepthMeters: 8,
      currentNote:
        "Carlisle Bay is a working harbor beside Bridgetown's port, with cruise ship, cargo and small boat traffic. No diving while a ship is moving or alongside, carry an SMB, listen for engines and surface on the line. No current is documented here.",
      divePlan:
        "Descend at the wreck and circle it slowly. Return to the line and ascend; if you move on to a neighboring wreck, surface only under an SMB. Stay outside the hull.",
      fitTone: "welcoming",
      fitNote:
        "Shallow, calm and easy to hold a depth on. Good for a first wreck or a relaxed second dive.",
      // Depth: B 25 ft, G 8 m; A and D give the top at 2-3 m.
      creatureSlugs: [
        "longlure-frogfish",
        "longsnout-seahorse",
        "spotted-moray",
        "green-moray",
        "sergeant-major",
      ],
    },
  },
  {
    slug: "ce-trek",
    version: 1,
    area: "barbados",
    sources: [
      "https://divebarbadosblue.com/about-us/dive-sites",
      "https://www.divehightide.com/dive-sites",
      "https://www.scubaguybarbados.com/divesites",
    ],
    briefing: {
      name: "Ce-Trek",
      locationName: "Carlisle Bay Marine Park, Barbados",
      // Approximate pin: Carlisle Bay Marine Park off Bridgetown. No source publishes coordinates, so the pin sits in the bay and is spaced from the neighboring wreck pins (method: landmark plus spacing, good to about 1 km).
      forecastLatitude: 13.0905,
      forecastLongitude: -59.616,
      description:
        "A cement-hulled work boat sunk in January 1986 at the northern edge of the marine park. Coral and sponge now cover her.",
      marineLife: "Soft corals · sponges · reef fish · eels",
      marineLifeDescription:
        "Sponges and soft corals have settled on the concrete, and small fish shelter under it.",
      difficultyLevel: "beginner",
      maxDepthMeters: 14,
      currentNote:
        "Carlisle Bay is a working harbor beside Bridgetown's port, with cruise ship, cargo and small boat traffic. No diving while a ship is moving or alongside, carry an SMB, listen for engines and surface on the line. No current is documented here.",
      divePlan:
        "Down to the wreck and once around it at its own depth. Return to the line and ascend; if you move on, surface only under an SMB. Stay outside the hull.",
      fitTone: "welcoming",
      fitNote:
        "Deeper than its neighbors but still an easy wreck dive. Stay with your buddy and watch your gauge.",
      // Depth 14 m (A, B); G lists 12 m. Position: A places it at the northern edge of the park.
      creatureSlugs: [
        "spotted-moray",
        "green-moray",
        "blue-tang",
        "french-angelfish",
        "queen-parrotfish",
      ],
    },
  },
  {
    slug: "eillon",
    version: 1,
    area: "barbados",
    sources: [
      "https://divebarbadosblue.com/about-us/dive-sites",
      "https://www.divehightide.com/dive-sites",
      "https://www.scubaguybarbados.com/divesites",
    ],
    briefing: {
      name: "Eillon",
      locationName: "Carlisle Bay Marine Park, Barbados",
      // Approximate pin: Carlisle Bay Marine Park off Bridgetown. No source publishes coordinates, so the pin sits in the bay and is spaced from the neighboring wreck pins (method: landmark plus spacing, good to about 1 km).
      forecastLatitude: 13.0872,
      forecastLongitude: -59.6152,
      description:
        "A 34 m former freighter sunk in 1996, long known as a smuggler's boat. She rests upright on sand with reef fish gathered along her hull.",
      marineLife: "Reef fish · lobster · eels · stingrays",
      marineLifeDescription:
        "The hull gives shelter to schools of small fish, and rays work the sand around it.",
      difficultyLevel: "beginner",
      maxDepthMeters: 17,
      currentNote:
        "Carlisle Bay is a working harbor beside Bridgetown's port, with cruise ship, cargo and small boat traffic. No diving while a ship is moving or alongside, carry an SMB, listen for engines and surface on the line. No current is documented here.",
      divePlan:
        "Down to the wreck, along the hull and back, with a safety stop on the line. Stay outside the hull.",
      fitTone: "welcoming",
      fitNote: "A wreck at 17 m with an easy profile. Keep to the outside and mind your gas.",
      // Depth 17 m (A, B); G lists 16 m. Also spelled Eilon.
      creatureSlugs: [
        "southern-stingray",
        "spiny-lobster",
        "green-moray",
        "french-angelfish",
        "blue-tang",
      ],
    },
  },
  {
    slug: "bajan-queen",
    version: 1,
    area: "barbados",
    sources: [
      "https://divebarbadosblue.com/about-us/dive-sites",
      "https://www.divehightide.com/dive-sites",
      "https://en.wikivoyage.org/wiki/Diving_in_Barbados",
    ],
    briefing: {
      name: "Bajan Queen",
      locationName: "Carlisle Bay Marine Park, Barbados",
      // Approximate pin: Carlisle Bay Marine Park off Bridgetown. No source publishes coordinates, so the pin sits in the bay and is spaced from the neighboring wreck pins (method: landmark plus spacing, good to about 1 km).
      forecastLatitude: 13.085,
      forecastLongitude: -59.6142,
      description:
        "A former tug that later served as a party boat, sunk as an artificial reef in 2002. Fish and coral are still moving in.",
      marineLife: "Reef fish · coral · seahorses",
      marineLifeDescription: "Young coral and schooling fish are settling on the steel.",
      difficultyLevel: "beginner",
      depthMinMeters: 9,
      maxDepthMeters: 12,
      currentNote:
        "Carlisle Bay is a working harbor beside Bridgetown's port, with cruise ship, cargo and small boat traffic. No diving while a ship is moving or alongside, carry an SMB, listen for engines and surface on the line. No current is documented here.",
      divePlan:
        "Descend and circle the wreck once. Return to the line and ascend; if you move on to a neighboring wreck, surface only under an SMB. Stay outside the hull.",
      fitTone: "welcoming",
      fitNote: "A gentle wreck for newer divers, helped by the clear, sheltered bay.",
      // Depth: A 11 m, B 12 m, G 9 m; the deeper is used.
      creatureSlugs: [
        "sergeant-major",
        "blue-tang",
        "french-grunt",
        "longsnout-seahorse",
        "queen-angelfish",
      ],
    },
  },
  {
    slug: "cornwallis",
    version: 1,
    area: "barbados",
    sources: [
      "https://divebarbadosblue.com/about-us/dive-sites",
      "https://www.divehightide.com/dive-sites",
      "https://www.scubaguybarbados.com/divesites",
    ],
    briefing: {
      name: "Cornwallis",
      locationName: "Carlisle Bay Marine Park, Barbados",
      // Approximate pin: Carlisle Bay Marine Park off Bridgetown. No source publishes coordinates, so the pin sits in the bay and is spaced from the neighboring wreck pins (method: landmark plus spacing, good to about 1 km).
      forecastLatitude: 13.0838,
      forecastLongitude: -59.617,
      description:
        "A Canadian freighter moved into the marine park after her old anchorage proved too busy with boat traffic. She lies shallow, with plenty of light.",
      marineLife: "Reef fish · porcupinefish · coral",
      marineLifeDescription: "Shallow wrecks like this give small fish plenty of cover.",
      difficultyLevel: "beginner",
      maxDepthMeters: 5,
      currentNote:
        "Carlisle Bay is a working harbor beside Bridgetown's port, with cruise ship, cargo and small boat traffic. No diving while a ship is moving or alongside, carry an SMB, listen for engines and surface on the line. No current is documented here.",
      divePlan:
        "Circle the wreck at depth. Return to the line and ascend; if you move on to a neighboring site, surface only under an SMB. Stay outside the hull.",
      fitTone: "welcoming",
      fitNote:
        "The shallowest of the park's larger wrecks. Good for snorkelers, new divers and a long relaxed hour.",
      // Depth 5 m (A, B). The site was moved from a high-traffic area, which is why traffic leads the note.
      creatureSlugs: ["porcupinefish", "sergeant-major", "blue-tang", "yellowtail-snapper"],
    },
  },
  {
    slug: "barge",
    version: 1,
    area: "barbados",
    sources: [
      "https://divebarbadosblue.com/about-us/dive-sites",
      "https://www.divehightide.com/dive-sites",
      "https://www.scubaguybarbados.com/divesites",
    ],
    briefing: {
      name: "Barge",
      locationName: "Carlisle Bay Marine Park, Barbados",
      // Approximate pin: Carlisle Bay Marine Park off Bridgetown. No source publishes coordinates, so the pin sits in the bay and is spaced from the neighboring wreck pins (method: landmark plus spacing, good to about 1 km).
      forecastLatitude: 13.0835,
      forecastLongitude: -59.6122,
      description:
        "A naval landing barge sunk off Bridgetown, now a flat shelter for reef fish in very shallow water.",
      marineLife: "Porcupinefish · reef fish",
      marineLifeDescription: "Porcupinefish tuck in around the flat deck.",
      difficultyLevel: "beginner",
      depthMinMeters: 3,
      maxDepthMeters: 5,
      currentNote:
        "Carlisle Bay is a working harbor beside Bridgetown's port, with cruise ship, cargo and small boat traffic. No diving while a ship is moving or alongside, carry an SMB, listen for engines and surface on the line. No current is documented here.",
      divePlan: "Circle the barge at depth and move on. Stay outside the hull.",
      fitTone: "welcoming",
      fitNote: "Very shallow. A good first wreck and one for a relaxed hour.",
      // Depth: B 3 m, A 4 m, D 4.6 m; the deepest is used.
      creatureSlugs: ["porcupinefish", "sergeant-major", "blue-tang", "french-angelfish"],
    },
  },
  {
    slug: "trident-wreck",
    version: 1,
    area: "barbados",
    sources: [
      "https://divewestsidescuba.com/diving/dive-sites/",
      "https://www.scubaguybarbados.com/divesites",
      "https://en.wikivoyage.org/wiki/Diving_in_Barbados",
    ],
    briefing: {
      name: "Trident",
      locationName: "Carlisle Bay Marine Park, Barbados",
      // Approximate pin: Carlisle Bay Marine Park off Bridgetown. No source publishes coordinates, so the pin sits in the bay and is spaced from the neighboring wreck pins (method: landmark plus spacing, good to about 1 km).
      forecastLatitude: 13.088,
      forecastLongitude: -59.621,
      description:
        "A former coast guard vessel sunk in Carlisle Bay as an artificial reef. She sits deeper than the park's older wrecks.",
      marineLife: "Reef fish · coral",
      marineLifeDescription: "She is still young, and growth is building on her.",
      difficultyLevel: "intermediate",
      depthMinMeters: 6,
      maxDepthMeters: 24,
      currentNote:
        "Carlisle Bay is a working harbor beside Bridgetown's port, with cruise ship, cargo and small boat traffic. No diving while a ship is moving or alongside, carry an SMB, listen for engines and surface on the line. No current is documented here.",
      divePlan:
        "Descend the line, look around the outside of the wreck, then return with a safety stop on the line. Open Water divers turn at 18 m. Stay outside the hull.",
      fitTone: "unknown",
      fitNote:
        "The wreck reaches 24 m. Open Water divers turn at 18 m; stay within your certification depth.",
      // Intermediate: the wreck lies to 24 m, so the plan states an 18 m turn for Open Water divers. Depth: C 6-21 m, D 24 m (80 ft), G 20 m; the deepest is used. Year sunk: C 2013, G 2016.
      creatureSlugs: ["blue-tang", "french-angelfish", "sergeant-major", "queen-parrotfish"],
    },
  },
  {
    slug: "bottle-ground",
    version: 1,
    area: "barbados",
    sources: [
      "https://divebarbadosblue.com/about-us/dive-sites",
      "https://www.divehightide.com/dive-sites",
    ],
    briefing: {
      name: "Bottle Ground",
      locationName: "Carlisle Bay Marine Park, Barbados",
      // Approximate pin: Carlisle Bay Marine Park off Bridgetown. No source publishes coordinates, so the pin sits in the bay and is spaced from the neighboring wreck pins (method: landmark plus spacing, good to about 1 km).
      forecastLatitude: 13.0895,
      forecastLongitude: -59.626,
      description:
        "The old anchorage of Carlisle Bay, where centuries of ships left bottles on the sand. A slope with scattered coral and rubble, outside the wrecks.",
      marineLife: "Reef fish · rays · eels",
      marineLifeDescription: "Sand and rubble hold rays and small bottom dwellers, so look low.",
      difficultyLevel: "intermediate",
      depthMinMeters: 14,
      maxDepthMeters: 30,
      currentNote:
        "Carlisle Bay is a working harbor beside Bridgetown's port, with cruise ship, cargo and small boat traffic. No diving while a ship is moving or alongside, carry an SMB, listen for engines and surface on the line. No current is documented here.",
      divePlan:
        "Down the line, a slow loop over the slope, then back up with a safety stop on the line. Leave what you find where it lies.",
      fitTone: "unknown",
      fitNote:
        "A sand-and-rubble slope down to 30 m. Hold your depth and plan your gas from the deepest point.",
      // Depth 14-30 m (A, B). 19-30 m is not a gate.
      creatureSlugs: ["southern-stingray", "spotted-moray", "green-moray", "blue-tang"],
    },
  },
  {
    slug: "old-fort",
    version: 1,
    area: "barbados",
    sources: [
      "https://divebarbadosblue.com/about-us/dive-sites",
      "https://www.seahorsediversbb.com/",
      "https://divewestsidescuba.com/diving/dive-sites/",
    ],
    briefing: {
      name: "Old Fort",
      locationName: "South coast, Barbados",
      // Approximate pin: off Needham's Point on Barbados's south coast, about 1 km offshore. The sources name the landmark and no source publishes coordinates (method: landmark coordinates from OpenStreetMap, moved seaward; good to about 2 km).
      forecastLatitude: 13.0715,
      forecastLongitude: -59.6125,
      description:
        "A shallow barrier reef off Needham's Point, with small reef fish, old cannonballs and antique bottles among the coral.",
      marineLife: "Small reef fish · coral · cannonballs",
      marineLifeDescription:
        "Look in the cracks and sand pockets for historic debris and small fish.",
      difficultyLevel: "intermediate",
      depthMinMeters: 9,
      maxDepthMeters: 27,
      currentNote:
        "The reef lies off the mouth of Carlisle Bay, next to Bridgetown's port and its cruise ship and cargo traffic. No diving while a ship is moving or alongside, carry an SMB and listen for engines. Sources describe a drift dive, with the odd stronger current.",
      divePlan:
        "Drop onto the reef and drift along its length. Ascend on the boat's cue and make the safety stop on an SMB or the boat's line, not under the boat.",
      fitTone: "unknown",
      fitNote:
        "A reef down to 27 m, run as a drift, with the odd stronger current. Carry an SMB and hold your depth.",
      // Depth 9-27 m (A, F). Drift (A); C notes occasional stronger currents on the inner reefs. The point lies at the mouth of Carlisle Bay, so traffic leads the note. 19-30 m is not a gate.
      creatureSlugs: ["queen-angelfish", "french-angelfish", "blue-tang", "sergeant-major"],
    },
  },
  {
    slug: "lobster-reef",
    version: 1,
    area: "barbados",
    sources: [
      "https://divebarbadosblue.com/about-us/dive-sites",
      "https://www.seahorsediversbb.com/",
      "https://divewestsidescuba.com/diving/dive-sites/",
    ],
    briefing: {
      name: "Lobster Reef",
      locationName: "South coast, Barbados",
      // Approximate pin: off Drill Hall beach on Barbados's south coast, about 1 km offshore. The sources name the landmark and no source publishes coordinates (method: landmark coordinates from OpenStreetMap, moved seaward; good to about 2 km).
      forecastLatitude: 13.0715,
      forecastLongitude: -59.607,
      description:
        "An inner reef off Drill Hall beach, run as a drift dive, with the odd stingray over its sand.",
      marineLife: "Stingrays · lobster · reef fish",
      marineLifeDescription: "Rays rest on the sand between the reef heads.",
      difficultyLevel: "intermediate",
      depthMinMeters: 9,
      maxDepthMeters: 24,
      currentNote:
        "The reef lies just south of Carlisle Bay and Bridgetown's port, where cruise ship, cargo and small boat traffic is busy. No diving while a ship is moving or alongside, carry an SMB and listen for engines. Sources describe a drift dive.",
      divePlan:
        "Drop onto the reef and drift along its length. Make the safety stop on an SMB or the boat's line.",
      fitTone: "unknown",
      fitNote: "An inner-reef drift down to 24 m. Carry an SMB and hold your depth.",
      // Depth 9-24 m (A, F). Combined with Friar's Craig on some trips (A). Near the Carlisle Bay approaches, traffic is noted.
      creatureSlugs: ["southern-stingray", "spiny-lobster", "french-angelfish", "queen-parrotfish"],
    },
  },
  {
    slug: "castle-bank",
    version: 1,
    area: "barbados",
    sources: [
      "https://divebarbadosblue.com/about-us/dive-sites",
      "https://www.seahorsediversbb.com/",
      "https://divewestsidescuba.com/diving/dive-sites/",
    ],
    briefing: {
      name: "Castle Bank",
      locationName: "South coast, Barbados",
      // Approximate pin: off Drill Hall beach on Barbados's south coast, about 1 km offshore. The sources name the landmark and no source publishes coordinates (method: landmark coordinates from OpenStreetMap, moved seaward; good to about 2 km).
      forecastLatitude: 13.066,
      forecastLongitude: -59.6085,
      description:
        "A barrier reef with slow drop-offs on both sides, and barracuda that gather along it.",
      marineLife: "Barracuda · reef fish · coral",
      marineLifeDescription: "Barracuda hang along the edges of the reef.",
      difficultyLevel: "intermediate",
      depthMinMeters: 15,
      maxDepthMeters: 37,
      currentNote:
        "Outer reef off the south coast. Sources describe slow drop-offs on both sides, and the sea can be rougher in bad weather. Carry an SMB.",
      divePlan:
        "Drop onto the reef top and drift along it, holding the reef depth the crew sets; 37 m (120 ft) is a hard floor. Ascend with a safety stop on an SMB. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote:
        "A deeper outer reef. Divers need Advanced and Deep training and good air consumption.",
      // The sources give no separate reef-top depth, so the plan leaves it to the crew and holds 37 m as the floor. Depth 15-37 m (A, F; C gives outer reefs 15-37 m). Gate: depth over 30 m.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: ["great-barracuda", "french-angelfish", "queen-parrotfish", "blue-tang"],
    },
  },
  {
    slug: "fork-reef",
    version: 1,
    area: "barbados",
    sources: [
      "https://divebarbadosblue.com/about-us/dive-sites",
      "https://www.seahorsediversbb.com/",
    ],
    briefing: {
      name: "Fork Reef",
      locationName: "South coast, Barbados",
      // Approximate pin: off Hastings on Barbados's south coast, about 1 km offshore. The sources name the landmark and no source publishes coordinates (method: landmark coordinates from OpenStreetMap, moved seaward; good to about 2 km).
      forecastLatitude: 13.0675,
      forecastLongitude: -59.599,
      description:
        "A barrier reef off Hastings with drop-offs on both sides, schooling snapper, barracuda and cavalli.",
      marineLife: "Barracuda · snapper · jacks",
      marineLifeDescription: "Schools gather along the edge of the reef.",
      difficultyLevel: "intermediate",
      depthMinMeters: 18,
      maxDepthMeters: 37,
      currentNote:
        "Outer reef off the south coast, with drop-offs on both sides. Current not documented; ask the crew on the day. Carry an SMB.",
      divePlan:
        "Drop onto the reef and follow its edge, holding the reef depth the crew sets; 37 m (120 ft) is a hard floor. Ascend with a safety stop on an SMB. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote: "A deeper outer reef. Divers need Advanced and Deep training.",
      // The sources give no separate reef-top depth, so the plan leaves it to the crew and holds 37 m as the floor. Depth 18-37 m (A, F). Gate: depth over 30 m.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "great-barracuda",
        "yellowtail-snapper",
        "horse-eye-jack",
        "queen-parrotfish",
      ],
    },
  },
  {
    slug: "pieces-of-eight",
    version: 1,
    area: "barbados",
    sources: [
      "https://divebarbadosblue.com/about-us/dive-sites",
      "https://www.seahorsediversbb.com/",
    ],
    briefing: {
      name: "Pieces of Eight",
      locationName: "South coast, Barbados",
      // Approximate pin: off Hastings on Barbados's south coast, about 1 km offshore. The sources name the landmark and no source publishes coordinates (method: landmark coordinates from OpenStreetMap, moved seaward; good to about 2 km).
      forecastLatitude: 13.0705,
      forecastLongitude: -59.5975,
      description:
        "A drift dive over a busy shallow reef at Hastings, with plenty of small fish, which makes it popular with photographers.",
      marineLife: "Reef fish · coral",
      marineLifeDescription: "Reef fish are plentiful, which is why photographers like the site.",
      difficultyLevel: "intermediate",
      depthMinMeters: 12,
      maxDepthMeters: 18,
      currentNote:
        "Sources describe a drift dive; its strength is not documented, so ask the crew on the day. Carry an SMB. Deploy the SMB at the start of the ascent and keep it up through the stop.",
      divePlan:
        "Drop onto the reef, drift along it, and make the safety stop on an SMB or the boat's line.",
      fitTone: "unknown",
      fitNote: "A drift over a reef at 12 to 18 m. Carry an SMB.",
      // Depth 12-18 m (A, F). Drift (A).
      creatureSlugs: ["queen-angelfish", "french-angelfish", "blue-tang", "sergeant-major"],
    },
  },
  {
    slug: "accra",
    version: 1,
    area: "barbados",
    sources: [
      "https://divebarbadosblue.com/about-us/dive-sites",
      "https://www.seahorsediversbb.com/",
    ],
    briefing: {
      name: "Accra",
      locationName: "South coast, Barbados",
      // Approximate pin: off Rockley Beach on Barbados's south coast, about 1 km offshore. The sources name the landmark and no source publishes coordinates (method: landmark coordinates from OpenStreetMap, moved seaward; good to about 2 km).
      forecastLatitude: 13.0675,
      forecastLongitude: -59.588,
      description:
        "A shallow reef off Rockley Beach, suited to newer divers, with big schools of Bermuda chub.",
      marineLife: "Bermuda chub · reef fish",
      marineLifeDescription: "Chub gather in large schools over the reef.",
      difficultyLevel: "beginner",
      depthMinMeters: 6,
      maxDepthMeters: 18,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan: "Drop onto the reef, circle at your own pace, and ascend with a safety stop.",
      fitTone: "welcoming",
      fitNote: "A shallow reef that suits a first reef dive.",
      // Depth 6-18 m (A, F).
      creatureSlugs: ["bermuda-chub", "queen-angelfish", "blue-tang", "sergeant-major"],
    },
  },
  {
    slug: "boot",
    version: 1,
    area: "barbados",
    sources: [
      "https://divebarbadosblue.com/about-us/dive-sites",
      "https://www.seahorsediversbb.com/",
      "https://divewestsidescuba.com/diving/dive-sites/",
    ],
    briefing: {
      name: "Boot",
      locationName: "South coast, Barbados",
      // Approximate pin: off Sandy Beach on Barbados's south coast, about 1 km offshore. The sources name the landmark and no source publishes coordinates (method: landmark coordinates from OpenStreetMap, moved seaward; good to about 2 km).
      forecastLatitude: 13.0645,
      forecastLongitude: -59.5795,
      description:
        "A drift dive over a reef off Sandy Beach, with turtles, eagle rays and a small sunken Coast Guard boat.",
      marineLife: "Turtles · eagle rays · reef fish",
      marineLifeDescription: "Turtles and rays pass over the reef.",
      difficultyLevel: "intermediate",
      depthMinMeters: 12,
      maxDepthMeters: 24,
      currentNote:
        "Sources describe a drift dive. Run as a drift; carry an SMB. Deploy the SMB at the start of the ascent and keep it up through the stop.",
      divePlan:
        "Drop onto the reef, drift along it, and ascend with a safety stop on an SMB. Stay outside the boat wreck.",
      fitTone: "unknown",
      fitNote: "A drift down to 24 m. Carry an SMB and hold your depth.",
      // Depth 12-24 m (A, F). Drift (A).
      landmarks: [
        {
          name: "Small boat",
          kind: "wreckFeature",
          note: "A small Coast Guard boat sunk on the reef. Stay outside it.",
        },
      ],
      creatureSlugs: [
        "green-sea-turtle",
        "hawksbill-turtle",
        "spotted-eagle-ray",
        "queen-angelfish",
      ],
    },
  },
  {
    slug: "the-muff",
    version: 1,
    area: "barbados",
    sources: [
      "https://divebarbadosblue.com/about-us/dive-sites",
      "https://www.seahorsediversbb.com/",
      "https://divewestsidescuba.com/diving/dive-sites/",
    ],
    briefing: {
      name: "The Muff",
      locationName: "South coast, Barbados",
      // Approximate pin: off Worthing on Barbados's south coast, about 1 km offshore. The sources name the landmark and no source publishes coordinates (method: landmark coordinates from OpenStreetMap, moved seaward; good to about 2 km).
      forecastLatitude: 13.06,
      forecastLongitude: -59.583,
      description:
        "A deep, little-visited barrier reef off Worthing, with a standout sponge, horse-eye jacks and barracuda.",
      marineLife: "Horse-eye jacks · barracuda · sponges",
      marineLifeDescription: "Jacks and barracuda patrol the outer reef.",
      difficultyLevel: "intermediate",
      depthMinMeters: 18,
      maxDepthMeters: 40,
      currentNote:
        "Sources describe a drift dive. Run as a drift; carry an SMB. Deploy the SMB at the start of the ascent and keep it up through the stop.",
      divePlan:
        "Drop onto the reef, follow it no deeper than 40 m (130 ft), and ascend with a safety stop on an SMB. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote: "A deep outer reef. Divers need Advanced and Deep training.",
      // Depth 18-40 m (A, F). Gate: depth over 30 m.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: ["horse-eye-jack", "great-barracuda", "giant-barrel-sponge", "blue-tang"],
    },
  },
  {
    slug: "mount-charlie",
    version: 1,
    area: "barbados",
    sources: [
      "https://divebarbadosblue.com/about-us/dive-sites",
      "https://www.seahorsediversbb.com/",
    ],
    briefing: {
      name: "Mount Charlie",
      locationName: "South coast, Barbados",
      // Approximate pin: off Dover on Barbados's south coast, about 1 km offshore. The sources name the landmark and no source publishes coordinates (method: landmark coordinates from OpenStreetMap, moved seaward; good to about 2 km).
      forecastLatitude: 13.0605,
      forecastLongitude: -59.5735,
      description: "A deep outer barrier reef off Dover with turtles, snapper and barracuda.",
      marineLife: "Turtles · snapper · barracuda",
      marineLifeDescription: "Turtles and big fish cruise the outer reef.",
      difficultyLevel: "intermediate",
      depthMinMeters: 21,
      maxDepthMeters: 37,
      currentNote:
        "Sources describe a drift dive. Run as a drift; carry an SMB. Deploy the SMB at the start of the ascent and keep it up through the stop.",
      divePlan:
        "Drop onto the reef, follow it no deeper than 37 m (120 ft), and ascend with a safety stop on an SMB. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote: "A deep outer reef. Divers need Advanced and Deep training.",
      // Depth 21-37 m (A, F). Gate: depth over 30 m.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "green-sea-turtle",
        "yellowtail-snapper",
        "great-barracuda",
        "queen-parrotfish",
      ],
    },
  },
  {
    slug: "high-wire",
    version: 1,
    area: "barbados",
    sources: [
      "https://divebarbadosblue.com/about-us/dive-sites",
      "https://www.seahorsediversbb.com/",
      "https://totallybarbados.com/articles/sports/scuba-diving/top-ten-dive-spots",
    ],
    briefing: {
      name: "High Wire",
      locationName: "South coast, Barbados",
      // Approximate pin: off Dover on Barbados's south coast, about 1 km offshore. The sources name the landmark and no source publishes coordinates (method: landmark coordinates from OpenStreetMap, moved seaward; good to about 2 km).
      forecastLatitude: 13.06,
      forecastLongitude: -59.569,
      description:
        "A deep reef between Mount Charlie and Close Encounters, with underwater cables strung over it.",
      marineLife: "Reef fish · queen angelfish · snapper",
      marineLifeDescription: "Angelfish and snapper work the reef under the cables.",
      difficultyLevel: "intermediate",
      depthMinMeters: 21,
      maxDepthMeters: 37,
      currentNote:
        "Sources describe a drift dive, and one lists the water here as choppy. Underwater cables cross the reef, so keep clear of them. Carry an SMB.",
      divePlan:
        "Drop onto the reef, drift along it no deeper than 37 m (120 ft), and ascend with a safety stop on an SMB. Keep clear of the cables. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote: "A deep reef. Divers need Advanced and Deep training.",
      // Depth 21-37 m (A, F; T lists 18-37 m). Cables are a documented hazard. Gate: depth over 30 m.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "Underwater cables",
          kind: "pointOfInterest",
          note: "Cables run over the reef. Keep well clear of them.",
        },
      ],
      creatureSlugs: ["queen-angelfish", "yellowtail-snapper", "blue-tang", "french-angelfish"],
    },
  },
  {
    slug: "close-encounters",
    version: 1,
    area: "barbados",
    sources: [
      "https://divebarbadosblue.com/about-us/dive-sites",
      "https://www.seahorsediversbb.com/",
    ],
    briefing: {
      name: "Close Encounters",
      locationName: "South coast, Barbados",
      // Approximate pin: off Dover on Barbados's south coast, about 1 km offshore. The sources name the landmark and no source publishes coordinates (method: landmark coordinates from OpenStreetMap, moved seaward; good to about 2 km).
      forecastLatitude: 13.063,
      forecastLongitude: -59.5645,
      description:
        "An inner reef off Dover, where fish and stingrays gather. Underwater cables cross it.",
      marineLife: "Stingrays · reef fish",
      marineLifeDescription: "Rays and reef fish gather on the sandy edges.",
      difficultyLevel: "intermediate",
      depthMinMeters: 12,
      maxDepthMeters: 24,
      currentNote:
        "Underwater cables pass over the reef, so keep clear of them. Sources describe a drift dive. Carry an SMB.",
      divePlan:
        "Drop onto the reef, drift along it, and ascend with a safety stop on an SMB. Keep clear of the cables.",
      fitTone: "unknown",
      fitNote:
        "A reef down to 24 m with cables to avoid. Hold your depth and keep clear of the cables.",
      // Depth 12-24 m (A, F). Cables noted by A.
      landmarks: [
        {
          name: "Underwater cables",
          kind: "pointOfInterest",
          note: "Cables pass over the reef. Keep well clear of them.",
        },
      ],
      creatureSlugs: ["southern-stingray", "queen-angelfish", "blue-tang", "sergeant-major"],
    },
  },
  {
    slug: "round-bar-reef",
    version: 1,
    area: "barbados",
    sources: [
      "https://www.seahorsediversbb.com/",
      "https://divewestsidescuba.com/diving/dive-sites/",
    ],
    briefing: {
      name: "Round Bar Reef",
      locationName: "South coast, Barbados",
      // Approximate pin: off Hastings on Barbados's south coast, about 1 km offshore. The sources name the landmark and no source publishes coordinates (method: landmark coordinates from OpenStreetMap, moved seaward; good to about 2 km).
      forecastLatitude: 13.07,
      forecastLongitude: -59.604,
      description:
        "A reef off Hastings that falls away to depth. Operators pair its shallow top with the Friar's Craig dive.",
      marineLife: "Reef fish · coral",
      marineLifeDescription: "The shallow top is a typical south-coast reef.",
      difficultyLevel: "advanced",
      depthMinMeters: 12,
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day. Carry an SMB.",
      divePlan:
        "Drop onto the reef top, keep to the reef no deeper than 30 m (100 ft), and ascend with a safety stop on an SMB.",
      fitTone: "demanding",
      fitNote: "Only for divers who stay above the plan floor.",
      // F lists 12-55 m (40-180 ft); C runs the combined dive at 9-18 m. The reef keeps falling past 30 m, so the plan floor is 30 m and the gate is Advanced (walls rule).
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["queen-angelfish", "blue-tang", "french-angelfish", "sergeant-major"],
    },
  },
  {
    slug: "clarkes-bank",
    version: 1,
    area: "barbados",
    sources: [
      "https://divebarbadosblue.com/about-us/dive-sites",
      "https://www.divehightide.com/dive-sites",
      "https://divewestsidescuba.com/diving/dive-sites/",
    ],
    briefing: {
      name: "Clarke's Bank",
      locationName: "Brighton Beach, west coast Barbados",
      // Approximate pin: off Brighton Beach, about 1.3 km offshore. Sources give 'off Brighton Beach'; no coordinates published (method: beach coordinates from OpenStreetMap, moved seaward; good to about 2 km).
      forecastLatitude: 13.1215,
      forecastLongitude: -59.644,
      description:
        "A bank off Brighton Beach and the Bridgetown harbor, with horse-eye jacks, eels and barracuda. A tourist submarine works the site.",
      marineLife: "Horse-eye jacks · eels · barracuda · yellowtail snapper",
      marineLifeDescription: "Jacks and barracuda hold along the reef.",
      difficultyLevel: "advanced",
      depthMinMeters: 9,
      maxDepthMeters: 40,
      currentNote:
        "The bank lies close to Bridgetown's port, with cruise ship and cargo traffic, and a tourist submarine works the site and may circle divers. No diving while a ship is moving or alongside, carry an SMB, listen for engines and stay clear of the submarine. Current not documented; ask the crew on the day.",
      divePlan:
        "Drop onto the bank and hold the 24 m (80 ft) dive depth the sources give; 40 m (130 ft) is a hard floor. The bank falls past 49 m, beyond this plan. Ascend only on an SMB, clear of the submarine, with a safety stop. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote: "A deep bank near harbor traffic. Divers need Advanced and Deep training.",
      // Depth 9-40 m (A); B lists the reef at 50-160 ft (15-49 m), a dive depth of 80 ft (24 m) and the submarine that circles divers; the plan is capped at 40 m. Gate: depth and traffic.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "horse-eye-jack",
        "great-barracuda",
        "green-moray",
        "yellowtail-snapper",
        "creole-wrasse",
      ],
    },
  },
  {
    slug: "dottins",
    version: 1,
    area: "barbados",
    sources: [
      "https://divebarbadosblue.com/about-us/dive-sites",
      "https://www.scubaguybarbados.com/divesites",
      "https://scubadiving.bb/dive/",
      "https://totallybarbados.com/articles/sports/scuba-diving/top-ten-dive-spots",
    ],
    briefing: {
      name: "Dottins",
      locationName: "Folkestone Marine Park, Holetown, Barbados",
      // Approximate pin: off Holetown inside Folkestone Marine Park, about 800 m offshore. Sources name Holetown and the park; no coordinates published (method: town coordinates from OpenStreetMap, moved seaward; good to about 2 km).
      forecastLatitude: 13.187,
      forecastLongitude: -59.647,
      description:
        "A popular west-coast reef inside the Folkestone Marine Park, with coral heads, schooling fish, turtles and barracuda.",
      marineLife: "Turtles · barracuda · bar jacks · moray eels",
      marineLifeDescription:
        "Turtles and barracuda patrol the reef, and eels rest in the sand patches.",
      conservationNote: "The reef lies inside the Folkestone Marine Park.",
      difficultyLevel: "intermediate",
      depthMinMeters: 12,
      maxDepthMeters: 30,
      currentNote:
        "Sources describe a reef and drift dive. Boat traffic is not documented; this is a popular marine-park site, so ascend on an SMB.",
      divePlan: "Drop onto the reef, drift along it, and ascend with a safety stop on an SMB.",
      fitTone: "unknown",
      fitNote:
        "A reef dive to 30 m inside the marine park. Hold your depth and plan your gas from the deepest point.",
      // Depth 12-30 m (A); T lists 12-21 m. 19-30 m is not a gate.
      creatureSlugs: [
        "hawksbill-turtle",
        "great-barracuda",
        "bar-jack",
        "spotted-moray",
        "spotted-drum",
      ],
    },
  },
  {
    slug: "little-sandy-lane",
    version: 1,
    area: "barbados",
    sources: [
      "https://divebarbadosblue.com/about-us/dive-sites",
      "https://scubadiving.bb/dive/",
      "https://en.wikivoyage.org/wiki/Diving_in_Barbados",
    ],
    briefing: {
      name: "Little Sandy Lane",
      locationName: "Sandy Lane, west coast Barbados",
      // Approximate pin: off the Sandy Lane Hotel, about 800 m offshore. Sources name the hotel; no coordinates published (method: hotel coordinates from OpenStreetMap, moved seaward; good to about 2 km).
      forecastLatitude: 13.17,
      forecastLongitude: -59.647,
      description:
        "A reef system off Sandy Lane with big schools of small fish and barracuda. Lobsters hide in the reef, and the lower part falls below the plan.",
      marineLife: "Barracuda · reef fish · lobster",
      marineLifeDescription:
        "Barracuda cruise above the reef while lobsters tuck into the crevices.",
      difficultyLevel: "advanced",
      depthMinMeters: 21,
      maxDepthMeters: 40,
      currentNote: "Current not documented; ask the crew on the day. Carry an SMB.",
      divePlan:
        "Drop onto the reef, stay no deeper than 40 m (130 ft), and ascend with a safety stop on an SMB.",
      fitTone: "demanding",
      fitNote:
        "A deep reef. Divers need Advanced and Deep training. Staff confirm the diver's log before boarding.",
      // A lists 21-43 m (70-140 ft) for 'Sandy Lane' off the hotel, the same reef system scubadiving.bb calls Little Sandy Lane (an excellent multilevel dive); no source gives Little Sandy Lane its own depth, so the deeper figure is used and the plan is capped at 40 m. Gate: depth.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: ["great-barracuda", "spiny-lobster", "queen-parrotfish", "blue-tang"],
    },
  },
  {
    slug: "pamir",
    version: 1,
    area: "barbados",
    sources: [
      "https://www.divehightide.com/dive-sites",
      "https://www.scubaguybarbados.com/divesites",
      "https://scubadiving.bb/dive/",
      "https://totallybarbados.com/articles/sports/scuba-diving/top-ten-dive-spots",
    ],
    briefing: {
      name: "Pamir",
      locationName: "Mullins Bay, west coast Barbados",
      // Approximate pin: off Mullins Bay, about 700 m offshore. Totally Barbados places the wreck near Mullins Bay and Wikivoyage lists it in the Speightstown section; no coordinates are published (method: beach coordinates from OpenStreetMap, moved seaward; good to about 2 km).
      forecastLatitude: 13.234,
      forecastLongitude: -59.649,
      description:
        "A 50 m freighter lying upright in sheltered water close to shore at the northern end of the west coast. Frogfish and bar jacks live around her.",
      marineLife: "Frogfish · bar jacks · sergeant majors · blue tang",
      marineLifeDescription:
        "The wreck is a home for small fish and a good place for slow close-ups.",
      difficultyLevel: "beginner",
      maxDepthMeters: 18,
      currentNote: "Sheltered water close to shore. No current is documented here.",
      divePlan:
        "Descend the line, circle the wreck, and finish with a safety stop on the line. Stay outside the hull.",
      fitTone: "welcoming",
      fitNote: "Calm, clear and a good first wreck.",
      // Depth 18 m (B, E); D gives 16-18 m; scubadiving.bb gives 16-18 m (51-60 ft); the deeper is used.
      creatureSlugs: [
        "longlure-frogfish",
        "bar-jack",
        "sergeant-major",
        "blue-tang",
        "spiny-lobster",
      ],
    },
  },
  {
    slug: "bell-buoy",
    version: 1,
    area: "barbados",
    sources: [
      "https://www.divehightide.com/dive-sites",
      "https://www.scubaguybarbados.com/divesites",
      "https://divewestsidescuba.com/diving/dive-sites/",
    ],
    briefing: {
      name: "Bell Buoy",
      locationName: "Needham's Point, Barbados",
      // Approximate pin: off Needham's Point, about 900 m west of the lighthouse. Sources place the reef off the point; no coordinates published (method: lighthouse coordinates from OpenStreetMap, moved seaward; good to about 2 km).
      forecastLatitude: 13.075,
      forecastLongitude: -59.62,
      description:
        "A nearly round, dome-shaped reef with forests of brown coral, schools of chromis and parrotfish.",
      marineLife: "Chromis · parrotfish · reef fish",
      marineLifeDescription: "Fish school over the brown coral.",
      difficultyLevel: "intermediate",
      depthMinMeters: 6,
      maxDepthMeters: 21,
      currentNote:
        "The reef lies off the mouth of Carlisle Bay, next to Bridgetown's port and its cruise ship and cargo traffic. No diving while a ship is moving or alongside, carry an SMB and listen for engines. Currents on the west-coast reefs vary.",
      divePlan:
        "Drop onto the dome, circle at your own pace, and ascend with a safety stop on an SMB. Open Water divers turn at 18 m.",
      fitTone: "welcoming",
      fitNote: "A bright reef down to 21 m that suits a relaxed dive.",
      // Depth 6-21 m (B); D lists 6-18 m.
      creatureSlugs: ["brown-chromis", "queen-parrotfish", "stoplight-parrotfish", "blue-tang"],
    },
  },
  {
    slug: "shark-bank",
    version: 1,
    area: "barbados",
    sources: [
      "https://www.divehightide.com/dive-sites",
      "https://www.scubaguybarbados.com/divesites",
    ],
    briefing: {
      name: "Shark Bank",
      locationName: "Bridgetown, Barbados",
      // Approximate pin: off Bridgetown, about 1.5 km west of the harbor mouth. Sources give 'off the capital' only, and one says cruise ships once dumped here, so the bank lies close to the port; no coordinates published (method: harbor coordinates from OpenStreetMap, moved seaward; good to about 2 km).
      forecastLatitude: 13.0975,
      forecastLongitude: -59.6435,
      description:
        "The nearest thing Barbados has to a reef wall. It is a deep coral reef with turtles and parrotfish, falling to about 44 m, below the plan.",
      marineLife: "Turtles · parrotfish · reef fish",
      marineLifeDescription: "Turtles and parrotfish graze along the reef.",
      difficultyLevel: "advanced",
      depthMinMeters: 18,
      maxDepthMeters: 40,
      currentNote:
        "Open water off Bridgetown's port, with cruise ship, cargo and small boat traffic. No diving while a ship is moving or alongside, carry an SMB and listen for engines. Current not documented; ask the crew on the day.",
      divePlan:
        "Drop onto the reef and hold the reef depth the sources give (24 to 27 m); 40 m (130 ft) is a hard floor. Ascend with a safety stop on an SMB. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote:
        "A deep, open-water dive for Advanced and Deep divers. Staff confirm the diver's log before boarding.",
      // B: reef 18-44 m, dived at 24-27 m; D: 41-44 m. The plan is capped at 40 m. Gate: depth, open water and traffic. The reef's name comes from cruise-ship dumping, not sharks.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "green-sea-turtle",
        "hawksbill-turtle",
        "stoplight-parrotfish",
        "queen-parrotfish",
      ],
    },
  },
  {
    slug: "brightledge",
    version: 1,
    area: "barbados",
    sources: [
      "https://totallybarbados.com/articles/sports/scuba-diving/top-ten-dive-spots",
      "https://www.divehightide.com/dive-sites",
      "https://en.wikivoyage.org/wiki/Diving_in_Barbados",
    ],
    briefing: {
      name: "Brightledge",
      locationName: "Speightstown, west coast Barbados",
      // Approximate pin: off Almond Beach Village near Speightstown, about 800 m offshore. Totally Barbados gives the beach and Wikivoyage lists the reef in the Speightstown section; no coordinates published (method: town coordinates from OpenStreetMap, moved seaward; good to about 2 km).
      forecastLatitude: 13.2575,
      forecastLongitude: -59.65,
      description:
        "A bright reef off Speightstown with good visibility, hawksbill turtles and schooling tropical fish.",
      marineLife: "Hawksbill turtles · barracuda · squirrelfish · parrotfish",
      marineLifeDescription: "Turtles and barracuda patrol the reef.",
      difficultyLevel: "advanced",
      depthMinMeters: 18,
      maxDepthMeters: 37,
      currentNote: "Sources describe a drift dive. Carry an SMB.",
      divePlan:
        "Drop onto the reef, drift along it no deeper than 37 m (120 ft), and ascend with a safety stop on an SMB. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote: "A deeper drift for Advanced and Deep divers.",
      // Depth 18-37 m (T). Gate: depth over 30 m and drift.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: ["hawksbill-turtle", "great-barracuda", "squirrelfish", "queen-parrotfish"],
    },
  },
  {
    slug: "maycocks-bay",
    version: 1,
    area: "barbados",
    sources: [
      "https://totallybarbados.com/articles/sports/scuba-diving/top-ten-dive-spots",
      "https://www.divehightide.com/dive-sites",
      "https://www.scubaguybarbados.com/divesites",
    ],
    briefing: {
      name: "Maycocks Bay",
      locationName: "Maycocks Bay, Barbados",
      // Approximate pin: off Maycocks Bay, about 1 km offshore. Sources name the bay; no coordinates published (method: bay coordinates from OpenStreetMap, moved seaward; good to about 2 km).
      forecastLatitude: 13.2915,
      forecastLongitude: -59.658,
      description:
        "Large coral reefs separated by white sand channels at the northern tip of the west coast, with rays, barracuda and sponge formations.",
      marineLife: "Rays · barracuda · hogfish · Bermuda chub",
      marineLifeDescription: "Rays rest in the sand channels between the reefs.",
      difficultyLevel: "advanced",
      depthMinMeters: 15,
      maxDepthMeters: 40,
      currentNote:
        "Run as a drift through sand channels that can carry a current. Carry an SMB. The north of the island is exposed to swell.",
      divePlan:
        "Drop onto the reef, drift along it no deeper than 40 m (130 ft), and ascend with a safety stop on an SMB. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote: "A remote drift at depth. Divers need Advanced and Deep training.",
      // Depth 15-40 m (T). Gate: depth over 30 m and drift. The far north is remote from medical care.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: ["southern-stingray", "great-barracuda", "hogfish", "bermuda-chub"],
    },
  },
];
