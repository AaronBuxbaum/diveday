// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Aruba. */
export const ARUBA: DiveSiteTemplate[] = [
  // Denominator row: Antilla Wreck
  {
    slug: "antilla-wreck-aruba",
    version: 1,
    area: "aruba",
    sources: [
      "https://jadsaruba.com/scuba/dive-sites/",
      "https://www.puredivingaruba.com/diving-aruba/wrecks/antilla/",
      "https://www.aquawindies.com/divesites",
      "https://en.wikipedia.org/wiki/SS_Antilla_(1939)",
    ],
    briefing: {
      name: "Antilla Wreck",
      locationName: "Malmok, Aruba",
      // Wikipedia gives 12.602, -70.058 and PADI's site page 12.5934, -70.0634, about 1.1 km
      // apart. The point is midway between them, off Malmok Bay.
      forecastLatitude: 12.5977,
      forecastLongitude: -70.0607,
      description:
        "A German freighter scuttled by her own crew on 10 May 1940, about 120 m long. She lies on her port side on sand in Malmok Bay, with tube sponges and coral over the steel. Storms broke her in two long ago. Stay outside the hull.",
      marineLife: "Tube sponges · green turtles · moray eels · octopus",
      marineLifeDescription:
        "Tube sponges and coral on the steel, with turtles, morays and octopus around the wreck.",
      difficultyLevel: "intermediate",
      depthRange: "Up to 20 m (65 ft)",
      maxDepthMeters: 20,
      currentNote:
        "Not dived as a drift. Dive boats, jet skis and parasail boats work this coast, so carry an SMB and listen for engines.",
      divePlan:
        "Down to the hull, along the outside of the wreck, and back up the same side with reserve gas.",
      fitTone: "demanding",
      fitNote: "Large, old and broken. The outside of the hull is the dive.",
      // Sources give 16.5 m, 17 m, 18 m and 20 m. The deeper figure is the ceiling, and 20 m is past
      // the Open Water limit, so the gate is Advanced Open Water. The upper hull is shallower, so
      // a shop running Open Water divers on it can lower the gate.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "yellow-tube-sponge",
        "branching-tube-sponge",
        "green-sea-turtle",
        "green-moray",
        "caribbean-reef-octopus",
      ],
    },
  },
  // Denominator row: Pedernales
  {
    slug: "pedernales-wreck-aruba",
    version: 1,
    area: "aruba",
    sources: [
      "https://www.puredivingaruba.com/diving-aruba/wrecks/pedernales/",
      "https://www.palmbeachdiversaruba.com/dive-sites/",
      "https://www.aquawindies.com/divesites",
      "https://en.wikipedia.org/wiki/SS_Pedernales",
    ],
    briefing: {
      name: "Pedernales",
      locationName: "Palm Beach, Aruba",
      forecastLatitude: 12.5788,
      forecastLongitude: -70.0585,
      description:
        "The midsection of an oil tanker torpedoed by a German submarine in 1942, lying in about 8 m off Palm Beach. Cabin pieces, washbasins and pipework are scattered between the coral heads. Stay outside the hull.",
      marineLife: "Stingrays · turtles · lobster · grunts",
      marineLifeDescription:
        "Stingrays and turtles over the sand, with grunts and goatfish schooling around the wreckage.",
      difficultyLevel: "beginner",
      depthRange: "8 m (25 ft)",
      maxDepthMeters: 8,
      currentNote:
        "Shallow and open to the sea. Jet skis, parasail boats and dive boats work the Palm Beach coast, so carry an SMB and listen for engines.",
      fitTone: "welcoming",
      fitNote: "Shallow, scattered wreck among coral. A relaxed one for a new wreck diver.",
      creatureSlugs: [
        "southern-stingray",
        "green-sea-turtle",
        "spiny-lobster",
        "french-grunt",
        "yellow-goatfish",
      ],
    },
  },
  // Denominator row: Arashi Reef (Arashi Airplane)
  {
    slug: "arashi-reef-aruba",
    version: 1,
    area: "aruba",
    sources: [
      "https://jadsaruba.com/scuba/dive-sites/",
      "https://www.palmbeachdiversaruba.com/dive-sites/",
      "https://www.aquawindies.com/divesites",
    ],
    briefing: {
      name: "Arashi Reef",
      locationName: "Arashi Beach, Aruba",
      // PADI's site page gives 12.6099, -70.0566; Arashi Beach itself is at 12.6094, -70.0531
      // (Wikipedia), about 0.4 km inshore.
      forecastLatitude: 12.6099,
      forecastLongitude: -70.0566,
      description:
        "A young, flat reef with patches of hard and soft coral and scattered pieces of a Lockheed Lodestar in about 11 m. Green and hawksbill turtles use it as a cleaning station.",
      marineLife: "Green turtle · hawksbill · stingrays · parrotfish · angelfish",
      marineLifeDescription:
        "Turtles at the cleaning station, stingrays on the sand, and parrotfish and angelfish around the plane remains.",
      difficultyLevel: "beginner",
      depthRange: "Up to 16 m (50 ft)",
      maxDepthMeters: 16,
      currentNote: "Local operators run their boat dives here as drifts. Carry an SMB.",
      fitTone: "welcoming",
      fitNote: "Shallow and good for beginners, with turtles as the reason to go.",
      creatureSlugs: [
        "green-sea-turtle",
        "hawksbill-turtle",
        "southern-stingray",
        "queen-parrotfish",
        "french-angelfish",
      ],
    },
  },
  // Denominator row: Jane Sea Wreck (Jane C)
  {
    slug: "jane-sea-wreck-aruba",
    version: 1,
    area: "aruba",
    sources: [
      "https://jadsaruba.com/scuba/dive-sites/",
      "https://www.puredivingaruba.com/diving-aruba/wrecks/jane-c/",
      "https://www.aquawindies.com/divesites",
      "https://www.padi.com/dive-site/aruba/jane-sea/",
    ],
    briefing: {
      name: "Jane Sea Wreck",
      locationName: "Barcadera, Aruba",
      // PADI's site page gives 12.4736, -69.9951, just south of Barcadera harbor (12.4820, -69.9916
      // on Wikipedia), about 1 km away. Treat it as approximate and confirm with the shop.
      forecastLatitude: 12.4736,
      forecastLongitude: -69.9951,
      description:
        "A Venezuelan cement freighter sunk as a reef in 1988, standing nearly upright beside the reef off Barcadera harbor. Her bow is at about 18 m, the top of the stern at 15 to 18 m and the propeller near 28 m. She is collapsing, so stay outside the hull.",
      marineLife: "Angelfish · barracuda · cobia · spotted eagle rays",
      marineLifeDescription:
        "Angelfish and schooling fish around the wreck, with barracuda at the stern and the occasional eagle ray.",
      difficultyLevel: "advanced",
      depthRange: "15–28 m (50–90 ft)",
      maxDepthMeters: 28,
      currentNote:
        "Barcadera is a working harbor, so listen for ship engines and keep clear of the channel. Current can be strong, and the dive is run as a drift. The bow leans and the structure is weakening. Carry an SMB.",
      divePlan:
        "Down to the bow at 18 m, along the outside of the hull, and no deeper than the propeller at 28 m.",
      fitTone: "demanding",
      fitNote: "An upright wreck with the propeller at 28 m. Hold the plan and stay outside.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "french-angelfish",
        "great-barracuda",
        "cobia",
        "spotted-eagle-ray",
        "blue-tang",
      ],
    },
  },
  // Denominator row: Mangel Halto Reef
  {
    slug: "mangel-halto-aruba",
    version: 1,
    area: "aruba",
    sources: [
      "https://jadsaruba.com/scuba/dive-sites/",
      "https://www.aquawindies.com/divesites",
      "https://www.in-aruba.com/arubadivesites",
      "https://en.wikipedia.org/wiki/Mangel_Halto",
    ],
    briefing: {
      name: "Mangel Halto Reef",
      locationName: "Mangel Halto, Aruba",
      // Wikipedia gives 12.4649, -69.9695 and PADI's site page 12.4653, -69.9712. The entry is
      // from the beach there; the pin sits about 100 m south of it, over the water.
      forecastLatitude: 12.4642,
      forecastLongitude: -69.97,
      description:
        "A shore dive from an easy beach into a shallow sandy bowl that suits training. A small wreck, the Kappel, lies at about 15 m. Outside the bowl the reef drops steeply to about 30 m, and a slope continues to 34 m.",
      marineLife: "Anemones · octopus · nurse shark · queen parrotfish",
      marineLifeDescription:
        "Anemones and octopus on the inner reef and a nurse shark has been seen near the wreck.",
      difficultyLevel: "intermediate",
      depthRange: "5–34 m (15–110 ft)",
      maxDepthMeters: 34,
      currentNote:
        "The outer reef falls past the plan's 18 m floor, to 30 m and beyond. Turn inside the bowl and stay on the inner reef and the wreck.",
      divePlan:
        "Enter from the beach, swim over the bowl to the Kappel at about 15 m, and turn there. Stay inside the bowl, no deeper than 18 m, and do not cross onto the outer reef.",
      fitTone: "demanding",
      fitNote:
        "A shore dive with an easy beach entry. The turn point is inside the bowl, before the outer reef.",
      // The sources give 33–34 m on the outer reef and none states an Open Water limit (one calls the bowl ideal for training).
      // The range takes the slope's 34 m, so the gate is Advanced Open Water plus Deep because nothing but the plan keeps
      // a shore diver off the outer reef; a shop that supervises the bowl as a training dive can lower it.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      // The outer reef reaches 30 m and the slope 34 m; the plan holds an 18 m floor on the inner
      // reef and the wreck, which a local operator describes as ideal for training dives.
      creatureSlugs: [
        "giant-anemone",
        "atlantic-common-octopus",
        "nurse-shark",
        "queen-parrotfish",
      ],
    },
  },
  // Denominator row: Baby Beach Reef
  {
    slug: "baby-beach-reef-aruba",
    version: 1,
    area: "aruba",
    sources: [
      "https://jadsaruba.com/scuba/dive-sites/",
      "https://www.aquawindies.com/divesites",
      "https://www.in-aruba.com/arubadivesites",
      "https://www.padi.com/dive-site/aruba/baby-beach/",
    ],
    briefing: {
      name: "Baby Beach Reef",
      locationName: "Baby Beach, Aruba",
      // Wikipedia gives Baby Beach at 12.4138, -69.8796 and PADI's site page 12.4118, -69.8809.
      forecastLatitude: 12.413,
      forecastLongitude: -69.88,
      description:
        "A shore dive off the southern tip into open water, over large elkhorn and sheet coral with crabs, octopus and lobster. The Aruba to Venezuela telephone cable can be seen. Entry and exit can be rough.",
      marineLife: "Elkhorn coral · crabs · octopus · lobster",
      marineLifeDescription: "Elkhorn and sheet coral give cover to crabs, octopus and lobster.",
      difficultyLevel: "advanced",
      depthRange: "Up to 18 m (60 ft)",
      maxDepthMeters: 18,
      currentNote:
        "A shore drift in open water with a rough entry and exit. Currents can be strong at times. Carry an SMB. The sources do not say where the drift ends, so agree the exit point or a boat pickup before you enter.",
      divePlan:
        "Enter at the beach, drift along the reef no deeper than 18 m (59 ft), and surface for a pickup or an agreed exit with reserve gas.",
      fitTone: "demanding",
      fitNote: "Shallow, but a challenging shore dive in open water. Ask the shop about the day.",
      // JADS calls it a drift with a rough entry and exit and Aqua Windies calls it challenging,
      // so the gate is Advanced Open Water on the conditions rather than the depth.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "elkhorn-coral",
        "lamarcks-sheet-coral",
        "caribbean-reef-octopus",
        "spiny-lobster",
      ],
    },
  },
  // Denominator row: Hole in the Wall (Rocky Beach, Pos Chiquito)
  {
    slug: "hole-in-the-wall-aruba",
    version: 1,
    area: "aruba",
    sources: [
      "https://jadsaruba.com/scuba/dive-sites/",
      "https://www.aquawindies.com/divesites",
      "https://en.wikipedia.org/wiki/Pos_Chiquito",
    ],
    briefing: {
      name: "Hole in the Wall",
      locationName: "Pos Chiquito, Aruba",
      // The shore dive is entered at Pos Chiquito, also called Rocky Beach, which Wikipedia places
      // at 12.4651, -69.9684. That point is on the shore, so the pin sits about 150 m south, over the reef.
      forecastLatitude: 12.4637,
      forecastLongitude: -69.9684,
      description:
        "A shore dive at Rocky Beach down a sloping coral wall, with many kinds of stony coral. Rays and turtles pass by, and the site was once known for its snapper.",
      marineLife: "Rays · turtles · snapper · star coral",
      marineLifeDescription:
        "Star-coral castles with snapper around them, and rays and turtles on the slope.",
      difficultyLevel: "advanced",
      depthRange: "5–30 m (15–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "The entry is over a rocky beach, with surf on this exposed southeast coast. A sloping wall reaches 30 m, so hold the plan's depth.",
      divePlan:
        "Enter from Rocky Beach, descend the slope and follow the wall no deeper than 30 m (100 ft), then return up the slope with reserve gas.",
      fitTone: "demanding",
      fitNote: "A shore dive from a rocky beach onto a wall. Hold the 30 m floor.",
      // JADS gives a maximum of 30 m on a sloping wall. The plan holds that floor, so the gate is
      // Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "mountainous-star-coral",
        "grooved-brain-coral",
        "pillar-coral",
        "spotted-eagle-ray",
        "green-sea-turtle",
        "gray-snapper",
      ],
    },
  },
  // Denominator row: Renaissance Airplanes (Sonesta Airplanes)
  {
    slug: "renaissance-airplanes-aruba",
    version: 1,
    area: "aruba",
    sources: [
      "https://jadsaruba.com/scuba/dive-sites/",
      "https://www.puredivingaruba.com/diving-aruba/wrecks/airplanes/",
      "https://www.aquawindies.com/divesites",
    ],
    briefing: {
      name: "Renaissance Airplanes",
      locationName: "Oranjestad, Aruba",
      forecastLatitude: 12.4992,
      forecastLongitude: -70.0295,
      description:
        "Two aircraft sunk on purpose on a sloping reef in front of Renaissance Island: a Convair broken up by storms and an intact YS-11 once flown by Air Aruba. The Convair's wing tip is at about 14 m and the YS-11's tail at 27 m. Stay outside the fuselages.",
      marineLife: "Barracuda · octopus · moray eels · soft corals",
      marineLifeDescription:
        "Barracuda under the wings, octopus and morays in the wreckage, and soft corals on the reef around the planes.",
      difficultyLevel: "advanced",
      depthRange: "14–27 m (45–90 ft)",
      maxDepthMeters: 27,
      currentNote: "Local operators dive the southeast boat sites as drifts. Carry an SMB.",
      divePlan:
        "Down to the Convair's wing tip at about 14 m, along the slope to the YS-11 tail at 27 m, then back up with reserve gas.",
      fitTone: "demanding",
      fitNote: "Two aircraft on a slope, the deeper at 27 m. Stay outside the fuselages.",
      // PADI places the YS-11 at 12.49917, -70.02949 and an aircraft-wreck database at 12.49916, -70.02996,
      // 0.3 km apart; the point is PADI's. Pure Diving Aruba puts both planes in front of Renaissance Island.
      // Pure Diving gives the YS-11 tail at 27 m and JADS 26 m, so the deeper figure is used. The gate is
      // Advanced Open Water.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "great-barracuda",
        "caribbean-reef-octopus",
        "green-moray",
        "common-sea-fan",
        "spotted-eagle-ray",
      ],
    },
  },
  // Denominator row: Sponge Reef
  {
    slug: "sponge-reef-aruba",
    version: 1,
    area: "aruba",
    sources: [
      "https://jadsaruba.com/scuba/dive-sites/",
      "https://www.aquawindies.com/divesites",
      "https://www.in-aruba.com/arubadivesites",
    ],
    briefing: {
      name: "Sponge Reef",
      locationName: "Oranjestad, Aruba",
      forecastLatitude: 12.4987,
      forecastLongitude: -70.0283,
      description:
        "A sloping reef known for its sponges in many colors: elephant ears, tubes, vases and baskets, with plate and leaf corals between them. Turtles are often seen.",
      marineLife: "Elephant-ear sponges · tube sponges · vase sponges · turtles",
      marineLifeDescription: "Sponges of many shapes on the slope, with turtles passing through.",
      difficultyLevel: "advanced",
      depthRange: "Up to 28 m (90 ft)",
      maxDepthMeters: 28,
      currentNote: "Dived as a drift. Carry an SMB.",
      divePlan:
        "Drift along the slope no deeper than 28 m (92 ft) and ascend with the boat following your marker.",
      fitTone: "demanding",
      fitNote: "A sloping reef to 28 m, run as a drift, with sponges as the reason to go.",
      // Position is PADI's dive-site page for this reef. The ScubaCaribe diving map and JADS order the
      // south-coast sites the same way along the coast, so it sits where the pair around it say.
      // The deepest point is past the Open Water limit (18 m), so the gate is Advanced Open Water.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "orange-elephant-ear-sponge",
        "yellow-tube-sponge",
        "branching-vase-sponge",
        "lamarcks-sheet-coral",
        "green-sea-turtle",
      ],
    },
  },
  // Denominator row: Tire Reef
  {
    slug: "tire-reef-aruba",
    version: 1,
    area: "aruba",
    sources: [
      "https://jadsaruba.com/scuba/dive-sites/",
      "https://www.aquawindies.com/divesites",
      "https://www.in-aruba.com/arubadivesites",
    ],
    briefing: {
      name: "Tire Reef",
      locationName: "Barcadera, Aruba",
      forecastLatitude: 12.4825,
      forecastLongitude: -70.0104,
      description:
        "A reef named for the coral-encrusted tires once here. Black coral, sea whips and gorgonians cover the slope, and green morays and eagle rays are seen now and then. Maximum depth 27 m.",
      marineLife: "Black coral · sea fans · green moray · eagle rays",
      marineLifeDescription: "Black coral and gorgonians on the reef.",
      difficultyLevel: "advanced",
      depthRange: "Up to 27 m (90 ft)",
      maxDepthMeters: 27,
      currentNote:
        "Barcadera is a working harbor, so listen for ship engines and keep clear of the channel. Dived as a drift. Carry an SMB.",
      divePlan:
        "Drift along the slope no deeper than 27 m (89 ft) and ascend with the boat following your marker.",
      fitTone: "demanding",
      fitNote: "A drift to 27 m on a slope near a working harbor.",
      // Position is PADI's dive-site page for this reef. The ScubaCaribe diving map and JADS order the
      // south-coast sites the same way along the coast, so it sits where the pair around it say.
      // The deepest point is past the Open Water limit (18 m), so the gate is Advanced Open Water.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "black-coral",
        "common-sea-fan",
        "sea-plume",
        "green-moray",
        "spotted-eagle-ray",
      ],
    },
  },
  // Denominator row: Barcadera Reef
  {
    slug: "barcadera-reef-aruba",
    version: 1,
    area: "aruba",
    sources: [
      "https://jadsaruba.com/scuba/dive-sites/",
      "https://www.aquawindies.com/divesites",
      "https://www.in-aruba.com/arubadivesites",
      "https://www.padi.com/dive-site/aruba/barcadera-reef/",
    ],
    briefing: {
      name: "Barcadera Reef",
      locationName: "Barcadera, Aruba",
      forecastLatitude: 12.4759,
      forecastLongitude: -70.0027,
      description:
        "A healthy hard-coral reef off Barcadera harbor, with large brain corals and sea fans in the shallows. It is usually dived together with the Jane Sea wreck, which lies within the reef. Slopes run to 28 m.",
      marineLife: "Brain coral · sea fans",
      marineLifeDescription: "Brain coral heads and big sea fans that sway in the current.",
      difficultyLevel: "advanced",
      depthRange: "Up to 28 m (90 ft)",
      maxDepthMeters: 28,
      currentNote:
        "Barcadera is a working harbor, so listen for ship engines and keep clear of the channel. Usually dived as a drift together with the Jane Sea, and the sea fans sway with the current. Carry an SMB.",
      divePlan:
        "Work the reef and slope no deeper than 28 m (92 ft), drifting toward the Jane Sea if the boat is set up for it, and ascend with the boat following your marker.",
      fitTone: "demanding",
      fitNote: "A drift on a hard-coral slope to 28 m, beside the harbor and the Jane Sea.",
      // Position is PADI's dive-site page for this reef. The ScubaCaribe diving map and JADS order the
      // south-coast sites the same way along the coast, so it sits where the pair around it say.
      // The deepest point is past the Open Water limit (18 m), so the gate is Advanced Open Water.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "knobby-brain-coral",
        "common-sea-fan",
        "boulder-star-coral",
        "queen-angelfish",
      ],
    },
  },
  // Denominator row: Skalahein (Skalaheim)
  {
    slug: "skalahein-aruba",
    version: 1,
    area: "aruba",
    sources: [
      "https://jadsaruba.com/scuba/dive-sites/",
      "https://www.aquawindies.com/divesites",
      "https://www.in-aruba.com/arubadivesites",
    ],
    briefing: {
      name: "Skalahein",
      locationName: "Balashi, Aruba",
      forecastLatitude: 12.4706,
      forecastLongitude: -69.9868,
      description:
        "Colorful hard coral, sponges and many tropical fish on a reef that slopes into deep water, with a large population of barracuda. A good drift.",
      marineLife: "Barracuda · schooling fish · hard coral",
      marineLifeDescription: "Barracuda and schools of fish over the coral.",
      difficultyLevel: "advanced",
      depthRange: "5–30 m (15–100 ft)",
      maxDepthMeters: 30,
      currentNote: "A good drift dive. The reef slopes past the plan's floor. Carry an SMB.",
      divePlan:
        "Drift along the slope no deeper than 30 m (100 ft), then work back up the reef with reserve gas.",
      fitTone: "demanding",
      fitNote: "A drift down a slope that runs into deep water. Barracuda hold over the coral.",
      // Position is PADI's dive-site page for this reef. JADS gives a maximum of 25 m and a listing gives
      // 100 ft on a slope into deep water, so the deeper figure is the plan's floor. The gate is Advanced Open Water.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["great-barracuda", "boulder-star-coral", "queen-angelfish", "french-grunt"],
    },
  },
  // Denominator row: De Palm Slope (Palm Slope)
  {
    slug: "de-palm-slope-aruba",
    version: 1,
    area: "aruba",
    sources: [
      "https://redsailaruba.com/dive-sites/",
      "https://www.aquawindies.com/divesites",
      "https://www.in-aruba.com/arubadivesites",
    ],
    briefing: {
      name: "De Palm Slope",
      locationName: "Balashi, Aruba",
      forecastLatitude: 12.4688,
      forecastLongitude: -69.9854,
      description:
        "Coral formations that slope away into deep water, well known for barracuda. Spotted eagle rays are often seen, and it is dived as a drift. Look up the slope now and then.",
      marineLife: "Barracuda · eagle rays · coral",
      marineLifeDescription:
        "Barracuda over coral formations on the slope, with eagle rays now and then.",
      difficultyLevel: "advanced",
      depthRange: "5–30 m (15–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "The slope runs to great depths, past the plan's floor. Dived as a drift, so carry an SMB.",
      divePlan:
        "Drift along the slope no deeper than 30 m (100 ft), looking up now and then, and ascend with the boat following your marker.",
      fitTone: "demanding",
      fitNote:
        "A drift down a slope that runs to great depths. Look up for the rays and keep the gauge in view.",
      // Position is PADI's dive-site page for this reef. The ScubaCaribe diving map and JADS order the
      // south-coast sites the same way along the coast, so it sits where the pair around it say.
      // The slope drops past recreational depth; the plan holds a 30 m floor, so the gate is Advanced Open
      // Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "great-barracuda",
        "boulder-star-coral",
        "common-sea-fan",
        "spotted-eagle-ray",
      ],
    },
  },
  // Denominator row: The Finger (Fingers Reef)
  {
    slug: "the-finger-aruba",
    version: 1,
    area: "aruba",
    sources: [
      "https://redsailaruba.com/dive-sites/",
      "https://www.aquawindies.com/divesites",
      "https://www.in-aruba.com/arubadivesites",
    ],
    briefing: {
      name: "The Finger",
      locationName: "Balashi, Aruba",
      forecastLatitude: 12.4646,
      forecastLongitude: -69.9798,
      description:
        "A reef that points like a finger toward deep water, with coral formations along it and sea fans in the sand around it. Turtles are often seen, and moray eels on most dives. The ridge runs past 30 m.",
      marineLife: "Turtles · moray eels · sea fans · coral",
      marineLifeDescription: "Turtles on the ridge and sea fans in the sand around it.",
      difficultyLevel: "advanced",
      depthRange: "5–30 m (15–100 ft)",
      maxDepthMeters: 30,
      currentNote: "The ridge runs into deep water, past the plan's floor. Carry an SMB.",
      divePlan:
        "Follow the ridge out toward deep water no deeper than 30 m (100 ft), then return along the coral and ascend with reserve gas.",
      fitTone: "demanding",
      fitNote: "A ridge that points at deep water. The turn comes at 30 m or earlier.",
      // Position is PADI's dive-site page for this reef. The ScubaCaribe diving map and JADS order the
      // south-coast sites the same way along the coast, so it sits where the pair around it say.
      // The slope drops past recreational depth; the plan holds a 30 m floor, so the gate is Advanced Open
      // Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "green-sea-turtle",
        "common-sea-fan",
        "boulder-star-coral",
        "hawksbill-turtle",
      ],
    },
  },
  // Denominator row: Santo Largo
  {
    slug: "santo-largo-aruba",
    version: 1,
    area: "aruba",
    sources: [
      "https://jadsaruba.com/scuba/dive-sites/",
      "https://www.aquawindies.com/divesites",
      "https://www.in-aruba.com/arubadivesites",
      "https://www.padi.com/dive-site/aruba/santa-largo/",
    ],
    briefing: {
      name: "Santo Largo",
      locationName: "Savaneta, Aruba",
      forecastLatitude: 12.4508,
      forecastLongitude: -69.9561,
      description:
        "A shore dive after a longer surface swim, on a sloping hard-coral reef that few people dive, so the coral is in good shape. The slope reaches 27 m. Watch for fire coral.",
      marineLife: "Hard coral · fire coral · queen angelfish",
      marineLifeDescription: "Hard coral over the slope, with fire coral along the edge.",
      difficultyLevel: "advanced",
      depthRange: "Up to 27 m (90 ft)",
      maxDepthMeters: 27,
      currentNote:
        "A long swim out, and the dive can turn into a drift depending on the current, so agree the exit point or a boat pickup before you enter. Fire coral grows here, so keep your hands off the reef.",
      divePlan:
        "Swim out to the slope, work it no deeper than 27 m (89 ft), and turn with enough gas for the long swim back.",
      fitTone: "demanding",
      fitNote:
        "A long swim out and a slope to 27 m. Fire coral lines the reef, so keep your hands to yourself.",
      // Position is PADI's dive-site page for this reef (12.45076, -69.95607; its Santa Largo page gives 12.45116, -69.95600).
      // JADS and PADI give 27 m; a listing says the slope drops far deeper, so 27 m is the plan's floor and
      // the gate is Advanced Open Water.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["boulder-star-coral", "fire-coral", "queen-angelfish", "french-grunt"],
    },
  },
  // Denominator row: Harbour Reef (Pilot Boat, Tugboat)
  {
    slug: "harbor-reef-aruba",
    version: 1,
    area: "aruba",
    sources: [
      "https://jadsaruba.com/scuba/dive-sites/",
      "https://www.aquawindies.com/divesites",
      "https://www.in-aruba.com/arubadivesites",
      "https://www.padi.com/dive-site/aruba/harbor-reef/",
    ],
    briefing: {
      name: "Harbour Reef",
      locationName: "Oranjestad, Aruba",
      forecastLatitude: 12.5155,
      forecastLongitude: -70.0469,
      description:
        "A gently sloping reef of soft and hard coral in front of the Oranjestad cruise ship terminal. It leads down to a sunken tugboat where a pair of green morays live, at about 30 m. Stay outside the hull.",
      marineLife: "Green morays · soft coral · hard coral",
      marineLifeDescription:
        "A pair of green morays live at the tug, with soft coral on the slope.",
      difficultyLevel: "advanced",
      depthRange: "5–30 m (15–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "The reef lies in front of the cruise ship terminal, so no diving while a cruise ship is alongside. Check the berthing schedule first, listen for engines and thrusters, and carry an SMB.",
      divePlan:
        "Follow the slope to the tug at about 30 m, stay outside the hull, and ascend with reserve gas.",
      fitTone: "demanding",
      fitNote: "A tug at 30 m beside a cruise terminal that closes the site when ships dock.",
      // Position is PADI's dive-site page for Harbor Reef, about 0.6 km from Paardenbaai (Wikipedia), the
      // harbor the reef is named for. The deepest point is the tug at 30 m, so the gate is Advanced Open Water.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["green-moray", "sea-plume", "boulder-star-coral", "common-sea-fan"],
    },
  },
  // Denominator row: Malmok Reef and Debbie II (Blue Reef)
  {
    slug: "malmok-reef-debbie-ii-aruba",
    version: 1,
    area: "aruba",
    sources: [
      "https://www.aquawindies.com/divesites",
      "https://www.in-aruba.com/arubadivesites",
      "https://www.palmbeachdiversaruba.com/dive-sites/",
      "https://www.padi.com/dive-site/aruba/malmok/",
    ],
    briefing: {
      name: "Malmok Reef and Debbie II",
      locationName: "Malmok, Aruba",
      forecastLatitude: 12.5993,
      forecastLongitude: -70.0534,
      description:
        "A shallow reef entered from the rocky shore at Malmok, with leaf and brain coral and young fish. The Debbie II, a 120 ft fuel barge sunk in 1992, lies further out at about 24 m, reached by a surface swim. Stay outside the hull.",
      marineLife: "Leaf coral · brain coral · stingrays · lobster · frogfish",
      marineLifeDescription:
        "A nursery reef with young fish, lobster and the odd frogfish or seahorse.",
      difficultyLevel: "advanced",
      depthRange: "Up to 24 m (80 ft)",
      maxDepthMeters: 24,
      currentNote:
        "The entry is over rocky ironshore, so step with care. The reef is shallow, and the barge lies deeper and further out across open water. Carry an SMB.",
      divePlan:
        "Enter over the rocks, work the shallow reef, and swim out to the Debbie II at about 24 m only with gas to spare for the swim back.",
      fitTone: "demanding",
      fitNote: "A rocky entry and a surface swim to a barge at 24 m. Stay outside the hull.",
      // Position is PADI's Malmok page (12.5993, -70.0534) and Wikipedia's Malmok (12.60, -70.05) agreeing: the
      // shore entry. The Debbie II lies further out, by an unstated distance. Sources give the barge at 21 m and 24 m;
      // the deeper is used and puts the gate at Advanced Open Water. The shallow reef is an Open Water dive a shop can
      // open by lowering it.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "lamarcks-sheet-coral",
        "grooved-brain-coral",
        "southern-stingray",
        "spiny-lobster",
        "longlure-frogfish",
      ],
    },
  },
  // Denominator row: Star Gerren (Star Green)
  {
    slug: "star-gerren-aruba",
    version: 1,
    area: "aruba",
    sources: [
      "https://www.aquawindies.com/divesites",
      "https://www.palmbeachdiversaruba.com/dive-sites/",
      "https://redsailaruba.com/dive-sites/",
    ],
    briefing: {
      name: "Star Gerren",
      locationName: "Palm Beach, Aruba",
      forecastLatitude: 12.5798,
      forecastLongitude: -70.062,
      description:
        "A cargo ship sunk in August 2000 in front of the Palm Beach high-rise strip, lying close to upside down with her propeller the shallowest point. Coral is starting to grow, and schools of grunts, snapper and goatfish have moved in. Stay outside the hull.",
      marineLife: "Grunts · snapper · blue tang · goatfish",
      marineLifeDescription: "Schools of grunts, snapper and goatfish around the hull.",
      difficultyLevel: "advanced",
      depthRange: "Up to 20 m (65 ft)",
      maxDepthMeters: 20,
      currentNote:
        "Open water off the Palm Beach coast, where jet skis, parasail boats and dive boats work. Carry an SMB and listen for engines.",
      divePlan:
        "Down to the propeller, around the outside of the hull, and back up with reserve gas, no deeper than 20 m.",
      fitTone: "demanding",
      fitNote:
        "A cargo ship lying nearly upside down, with the propeller at the top. Stay outside the hull.",
      // Position is PADI's Star Gerren page (12.5798, -70.062), 0.35 km from the Pedernales (12.5789, -70.0583 on
      // Wikipedia), which the ScubaCaribe map numbers next to it, off the Palm Beach and Hadicurari strip Aqua Windies names.
      // Sources give 18 m and 20 m; the deeper is used. That is past the Open Water limit, so the gate is Advanced Open Water.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "french-grunt",
        "bluestriped-grunt",
        "blue-tang",
        "yellow-goatfish",
        "lane-snapper",
      ],
    },
  },
  // Denominator row: Kantil Reef
  {
    slug: "kantil-reef-aruba",
    version: 1,
    area: "aruba",
    sources: [
      "https://jadsaruba.com/scuba/dive-sites/",
      "https://redsailaruba.com/dive-sites/",
      "https://www.aquawindies.com/divesites",
      "https://www.in-aruba.com/arubadivesites",
    ],
    briefing: {
      name: "Kantil Reef",
      locationName: "Balashi, Aruba",
      forecastLatitude: 12.4724,
      forecastLongitude: -69.9927,
      description:
        "A reef that slopes into a drop-off, close to a wall. Boulders of brain and star coral, with leaf and sheet corals and large sea fans. A good drift.",
      marineLife: "Brain coral · star coral · sea fans",
      marineLifeDescription: "Boulder corals and sea fans on the drop-off.",
      difficultyLevel: "advanced",
      depthRange: "5–30 m (15–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "A good drift dive. The wall falls past 30 m, with one source reporting about 33 m at one point, so the plan's floor is yours to hold. Carry an SMB.",
      divePlan:
        "Drift along the slope no deeper than 30 m (100 ft) and do not follow the wall below it.",
      fitTone: "demanding",
      fitNote: "A drift beside a drop-off that runs deeper than the plan. Watch the gauge.",
      // Position is derived, not surveyed: between Jane Sea (12.4736, -69.9951) and Plonco Reef (12.4712, -69.9903), about 0.3 km
      // from each, so no derived pin sits within 200 m of another site. The ScubaCaribe map and in-aruba.com order it between
      // Barcadera Reef and Skalahein. Confirm the mooring with the shop.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "knobby-brain-coral",
        "boulder-star-coral",
        "lamarcks-sheet-coral",
        "common-sea-fan",
      ],
    },
  },
  // Denominator row: Plonco Reef (Balashi Reef)
  {
    slug: "plonco-reef-aruba",
    version: 1,
    area: "aruba",
    sources: [
      "https://jadsaruba.com/scuba/dive-sites/",
      "https://www.aquawindies.com/divesites",
      "https://www.in-aruba.com/arubadivesites",
    ],
    briefing: {
      name: "Plonco Reef",
      locationName: "Balashi, Aruba",
      forecastLatitude: 12.4712,
      forecastLongitude: -69.9903,
      description:
        "Hard and soft coral in spur and groove with sand between, and big green morays and lobsters. Depending on the current you may see a slope or a wall.",
      marineLife: "Green morays · lobster · coral",
      marineLifeDescription: "Large morays and lobsters among the coral spurs.",
      difficultyLevel: "advanced",
      depthRange: "6–30 m (20–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "Local operators run the southeast boat dives as drifts, and the current decides what you see. Carry an SMB.",
      divePlan:
        "Drift along the spurs no deeper than 30 m (100 ft), whether the current shows you a slope or a wall.",
      fitTone: "demanding",
      fitNote: "A drift over spur and groove where the current picks the scenery. Watch the gauge.",
      // Position is derived, not surveyed: the point is midway between the Jane Sea and De Palm Slope, the sites on either side of
      // it on the ScubaCaribe diving map. JADS puts Balashi (Plonco) Reef before Skalahein, which agrees with a point west of
      // Skalahein. The point is within about 1 km of the reef. Confirm the mooring with the shop.
      // Sources give 22 m (JADS) and 100 ft (listing); the deeper is used.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["green-moray", "spiny-lobster", "boulder-star-coral", "common-sea-fan"],
    },
  },
  // Denominator row: Captain's Choice
  {
    slug: "captains-choice-aruba",
    version: 1,
    area: "aruba",
    sources: [
      "https://redsailaruba.com/dive-sites/",
      "https://www.oceanatik.com/destination/aruba/sites/captain-s-choice-2184.html",
      "https://www.in-aruba.com/arubadivesites",
    ],
    briefing: {
      name: "Captain's Choice",
      locationName: "Balashi, Aruba",
      forecastLatitude: 12.4667,
      forecastLongitude: -69.9826,
      description:
        "A drop-off with huge brain and star corals and sea fans along the slope, and spotted moray eels on most dives. The slope runs on below 30 m.",
      marineLife: "Spotted moray eels · sea fans · brain coral",
      marineLifeDescription: "Spotted morays are common among the big corals.",
      difficultyLevel: "advanced",
      depthRange: "5–30 m (15–100 ft)",
      maxDepthMeters: 30,
      currentNote: "The slope runs deeper than the plan's floor. Carry an SMB.",
      divePlan:
        "Drift along the drop-off no deeper than 30 m (100 ft), then work back up the slope with reserve gas.",
      fitTone: "demanding",
      fitNote: "A drop-off with big corals and a slope that runs below 30 m. Turn at the floor.",
      // Position is derived, not surveyed: the point is midway between De Palm Slope and The Finger, the sites on either side of
      // it on the ScubaCaribe diving map and on in-aruba.com's list (where the same slot is called Gino's Choice). Those
      // two are 0.8 km apart. JADS uses the name for sites chosen on the day, so confirm the mooring with the shop.
      // Oceanatik gives 32 m; the plan holds a 30 m floor.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "spotted-moray",
        "common-sea-fan",
        "knobby-brain-coral",
        "boulder-star-coral",
      ],
    },
  },
];
