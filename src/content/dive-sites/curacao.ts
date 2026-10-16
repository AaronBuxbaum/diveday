// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

// Positions below are read from Dive Travel Curaçao's published dive-site map (embedded on
// divecuracao.info, one pin per site) and cross-read against the landmark each second source
// names. Depths are the numbers the cited operator pages print; where two pages disagree the
// deeper figure is used, or the plan's own floor where the site drops away.

/** Curaçao. */
export const CURACAO: DiveSiteTemplate[] = [
  // Denominator row: Tugboat
  {
    slug: "tugboat-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://fundivingcuracao.com/en/dive-sites",
      "https://www.divecuracao.info/dive/curacao-diving-guide/tugboat/",
      "https://www.oceanencounters.com/excursions/curacao-dive-sites/",
    ],
    briefing: {
      name: "Tugboat",
      locationName: "Caracasbaai, Curaçao",
      forecastLatitude: 12.0678,
      forecastLongitude: -68.862,
      description:
        "A small tug lying intact in 1–5 m of water beside Director's Bay, furred with sponge and coral. Shallow enough to snorkel over. Stay outside the hull.",
      marineLife: "Blue tang · yellow goatfish · trumpetfish · seahorses",
      marineLifeDescription:
        "Blue tang, goatfish and trumpetfish live on the wreck. Seahorses and frogfish turn up with some luck.",
      difficultyLevel: "beginner",
      depthMinMeters: 1,
      maxDepthMeters: 5,
      currentNote: "Sheltered water, but boats work this coast. Tow an inflated surface marker.",
      divePlan: "A short surface swim from the beach to the tug, then circle it in the shallows.",
      fitTone: "welcoming",
      fitNote: "Shallow, close to the beach and easy to read. Good for a first look at a wreck.",
      creatureSlugs: [
        "blue-tang",
        "yellow-goatfish",
        "trumpetfish",
        "longsnout-seahorse",
        "longlure-frogfish",
        "brown-tube-sponge",
      ],
    },
  },
  // Denominator row: Director's Bay
  {
    slug: "directors-bay-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://fundivingcuracao.com/en/dive-sites",
      "https://www.divecuracao.info/dive/curacao-diving-guide/directors-bay/",
      "https://www.oceanencounters.com/excursions/curacao-dive-sites/",
    ],
    briefing: {
      name: "Director's Bay",
      locationName: "Caracasbaai, Curaçao",
      forecastLatitude: 12.0657,
      forecastLongitude: -68.8601,
      description:
        "A narrow sand shelf, then a drop-off about 6 m from the shoreline and a steep wall below it. Sand gullies, sponges, yellow pencil coral and giant anemones along the edge, with old surge-fence panels now crusted in coral.",
      marineLife: "Seahorses · frogfish · moray eels · octopus",
      marineLifeDescription:
        "East along the wall, the rubble and fence hold the small animals. Look slowly, not far.",
      difficultyLevel: "advanced",
      depthMinMeters: 6,
      maxDepthMeters: 30,
      currentNote:
        "Plan gas and the way back before heading west toward the Tugboat. Boats work this coast, so tow an inflated surface marker. The wall continues to about 45 m, past the plan's floor.",
      divePlan:
        "East along the wall, mostly near 15 m for the small animals and never below 30 m (100 ft), or west toward the Tugboat with a ride arranged back.",
      fitTone: "demanding",
      fitNote:
        "A beach entry onto a wall that does not end where it should. Hold the floor of the plan.",
      // The wall falls to about 45 m; the plan holds a 30 m floor, so the gate is Advanced Open
      // Water without the Deep specialty. The shallow shelf and the 15 m wall edge are an Open
      // Water dive a shop can open by lowering this.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "longsnout-seahorse",
        "longlure-frogfish",
        "green-moray",
        "caribbean-reef-octopus",
        "peacock-flounder",
        "yellow-pencil-coral",
      ],
    },
  },
  // Denominator row: Diver's Leap
  {
    slug: "divers-leap-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://fundivingcuracao.com/en/dive-sites",
      "https://www.divecuracao.info/dive/curacao-diving-guide/divers-leap/",
      "https://www.oceanencounters.com/excursions/curacao-dive-sites/",
      "https://www.divers-guide.com/en/divers-leap",
    ],
    briefing: {
      name: "Diver's Leap",
      locationName: "Jan Thiel, Curaçao",
      forecastLatitude: 12.0734,
      forecastLongitude: -68.8786,
      description:
        "A shallow plateau, then a wall that starts around 10 m and falls steeply. The most life sits along the edge between 8 and 15 m, with seahorses near the mooring on the plateau.",
      marineLife: "Seahorses · barracuda · tarpon · pillar coral",
      marineLifeDescription:
        "Coral and sponge on the wall edge, deep-water fish out over the drop, seahorses on the plateau.",
      difficultyLevel: "intermediate",
      depthMinMeters: 8,
      maxDepthMeters: 40,
      currentNote:
        "Can run as a drift toward Jan Thiel Bay, and the current can increase and change direction. The wall falls to about 40 m, well beyond the plan. Tow an inflated surface marker.",
      divePlan:
        "Drop onto the plateau, follow the top of the wall at 8–15 m, and turn at 15 m, or at once if the current picks up. Come back along the shallow plateau and never go over the edge below 15 m.",
      fitTone: "demanding",
      fitNote:
        "A wall edge worked at 15 m, in current that can change, with a 40 m drop beside you. Keep the edge on one shoulder and the gauge in view.",
      // The wall falls to about 40 m, so maxDepthMeters is 40 and the gate is Advanced Open Water with the Deep specialty (above 30 m).
      // The current can change direction too. The plan holds the 8–15 m edge, with the wall beyond it.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "longsnout-seahorse",
        "great-barracuda",
        "tarpon",
        "pillar-coral",
        "giant-barrel-sponge",
      ],
    },
  },
  // Denominator row: Sweet Bottom
  {
    slug: "sweet-bottom-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://fundivingcuracao.com/en/dive-sites",
      "https://www.divecuracao.info/dive/curacao-diving-guide/sweet-bottom/",
      "https://www.divers-guide.com/en/sweet-bottom",
    ],
    briefing: {
      name: "Sweet Bottom",
      locationName: "Jan Thiel, Curaçao",
      forecastLatitude: 12.0777,
      forecastLongitude: -68.8844,
      description:
        "A wall dive off Jan Thiel Beach. The drop-off starts near 10 m, and the plan follows the wall to about 15 m before turning back over the shallow top, where the coral is most varied.",
      marineLife: "Parrotfish · trumpetfish · trunkfish · butterflyfish · snapper",
      marineLifeDescription:
        "Parrotfish and snapper along the wall, trunkfish and butterflyfish on the shallow top. A turtle passes now and then.",
      difficultyLevel: "intermediate",
      depthMinMeters: 10,
      maxDepthMeters: 18,
      currentNote:
        "The wall plunges far beyond recreational depth, which is the technical divers' dive, not this plan. Sweet Bottom is also a coral restoration site, so keep clear of the nurseries. Tow an inflated surface marker.",
      divePlan:
        "Swim out of the bay, descend the wall to no deeper than 15 m, turn there, and return along the shallow top. Never follow the wall below 15 m.",
      fitTone: "demanding",
      fitNote: "A wall worked at 15 m with the drop beside you. The turn depth is the whole plan.",
      // The wall plunges past recreational depth. The 10–15 m edge is described as relaxed, but with a drop of this size
      // beside it the gate is Advanced Open Water, with an 18 m floor.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "queen-parrotfish",
        "trumpetfish",
        "smooth-trunkfish",
        "banded-butterflyfish",
        "schoolmaster-snapper",
        "green-sea-turtle",
      ],
    },
  },
  // Denominator row: Superior Producer
  {
    slug: "superior-producer-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://fundivingcuracao.com/en/dive-sites",
      "https://www.divecuracao.info/dive/curacao-diving-guide/superior-producer/",
      "https://www.oceanencounters.com/excursions/curacao-dive-sites/",
    ],
    briefing: {
      name: "Superior Producer",
      locationName: "Willemstad, Curaçao",
      forecastLatitude: 12.1049,
      forecastLongitude: -68.9447,
      description:
        "A 50 m freighter lost in 1977, resting almost upright on sand beside Double Reef. Her superstructure rises to about 17–22 m and her keel sits on sand at 30–34 m. Stay outside the hull.",
      marineLife: "Tarpon · barracuda · jacks · gorgonians",
      marineLifeDescription:
        "Tarpon and jacks hold over the decks, with sponge and whip coral on the steel.",
      difficultyLevel: "advanced",
      depthMinMeters: 17,
      maxDepthMeters: 34,
      currentNote:
        "Current can be very strong at the harbor mouth. The wreck lies in the Mega Pier berth, so no diving while a cruise ship is alongside. Check the berthing schedule first, and tow an inflated surface marker.",
      divePlan:
        "Down to the superstructure, along the deck on the outside of the hull, and back up with reserve gas. Watch the no-decompression clock near 30 m.",
      fitTone: "demanding",
      fitNote:
        "Deep, with current and a berth that closes when ships dock. For divers with the card and the gas for it.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: ["tarpon", "great-barracuda", "horse-eye-jack", "sea-plume", "black-sea-rod"],
    },
  },
  // Denominator row: Double Reef
  {
    slug: "double-reef-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/double-reef/",
      "https://www.oceanencounters.com/excursions/curacao-dive-sites/",
      "https://fundivingcuracao.com/en/dive-sites",
    ],
    briefing: {
      name: "Double Reef",
      locationName: "Otrobanda, Curaçao",
      forecastLatitude: 12.1069,
      forecastLongitude: -68.9484,
      description:
        "Two reefs with sand between them. The first bottoms out at about 14 m, the larger outer reef starts around 18 m and drops beyond recreational depth. It runs from the Superior Producer toward the old desalination plant.",
      marineLife: "Brain coral · morays · cowfish · anemones · green turtles",
      marineLifeDescription:
        "Large brain corals and anemones with cleaner shrimp in them. Look in the sand between the two reefs for the small animals.",
      difficultyLevel: "intermediate",
      depthMinMeters: 14,
      maxDepthMeters: 18,
      currentNote:
        "From shore, check the current before you enter and do not go if it runs hard west toward the Water Factory. The entry and exit are the harder part. Stay shallow when it runs, and tow an inflated surface marker.",
      divePlan:
        "Enter from shore, work the first reef at about 14 m, cross to the top of the outer reef at 18 m only in quiet water, and turn there. Never follow the outer reef below 18 m.",
      fitTone: "demanding",
      fitNote:
        "A good reef at 14–18 m when the water is quiet. The westward current and the shore exit decide the day.",
      // The outer reef drops past recreational depth; the plan stops at its top (18 m). The shore current runs hard
      // west at times, so the gate is Advanced Open Water.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "knobby-brain-coral",
        "green-moray",
        "scrawled-cowfish",
        "giant-anemone",
        "green-sea-turtle",
        "pederson-cleaner-shrimp",
      ],
    },
  },
  // Denominator row: Marie Pampoen (Car Pile, Pierbaai Reef, Oswaldo's Drop-off)
  {
    slug: "marie-pampoen-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://fundivingcuracao.com/en/dive-sites",
      "https://www.divecuracao.info/dive/curacao-diving-guide/car-pile/",
    ],
    briefing: {
      name: "Marie Pampoen and the Car Pile",
      locationName: "Willemstad, Curaçao",
      forecastLatitude: 12.0903,
      forecastLongitude: -68.9057,
      description:
        "A shore dive out of a small bay onto the drop-off, then left along the wall to the Car Pile: cars, trucks, metal beams and a small wreck sunk as an artificial reef. The pile starts at about 15 m, a barge lies near 30 m, and the debris runs on below 40 m.",
      marineLife: "Porcupinefish · tarpon · moray eels · lionfish",
      marineLifeDescription:
        "Morays shelter under the beams and tarpon watch from a distance. Lionfish hide in the scrap.",
      difficultyLevel: "advanced",
      depthMinMeters: 15,
      maxDepthMeters: 30,
      currentNote: "Boats work this coast, so tow an inflated surface marker.",
      divePlan:
        "Out of the bay to the wall, left to the Car Pile, and back along the edge at 30 m or shallower.",
      fitTone: "demanding",
      fitNote: "An artificial reef on a drop-off. The pile continues past the plan's floor.",
      // The pile runs below 40 m; the plan holds a 30 m floor, so the gate is Advanced Open Water
      // without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["porcupinefish", "tarpon", "green-moray", "spotted-moray", "lionfish"],
    },
  },
  // Denominator row: Mushroom Forest
  {
    slug: "mushroom-forest-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.oceanencounters.com/excursions/curacao-dive-sites/",
      "https://www.divecuracao.info/dive/curacao-diving-guide/mushroom-forest/",
      "https://www.gowestdiving.com/diving-curacao/dive-sites/",
    ],
    briefing: {
      name: "Mushroom Forest",
      locationName: "Santa Cruz, Curaçao",
      forecastLatitude: 12.3002,
      forecastLongitude: -69.1545,
      description:
        "Eroded star-coral heads shaped like mushrooms, sheltered by the cliffs along this stretch of the northwest coast. A gently sloping reef, reached by boat.",
      marineLife: "Turtles · porcupinefish · trunkfish · morays",
      marineLifeDescription:
        "Brain corals and anemones among the heads, with turtles and trunkfish moving through the gaps.",
      difficultyLevel: "intermediate",
      depthMinMeters: 12,
      maxDepthMeters: 30,
      currentNote:
        "Usually calm. The heads make it easy to lose your bearings, so carry a compass. The slope continues beyond 18 m, past the plan. Tow an inflated surface marker.",
      divePlan: "Work the heads at 12–18 m, with a compass bearing back to the boat.",
      fitTone: "welcoming",
      fitNote:
        "A forgiving slope with coral heads that are easy to lose your way among. Hold the 18 m floor.",
      // Sources differ on the bottom (12–18 m, or 10–30 m on a slope that carries on deeper), so maxDepthMeters is 30,
      // ungated at the ceiling. The plan holds the 18 m shelf, which the operators dive as an Open Water site.
      creatureSlugs: [
        "green-sea-turtle",
        "porcupinefish",
        "smooth-trunkfish",
        "green-moray",
        "boulder-star-coral",
        "giant-anemone",
      ],
    },
  },
  // Denominator row: Black Sand Beach (Boca Santu Pretu, Catherine wreck)
  {
    slug: "black-sand-beach-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.gowestdiving.com/diving-curacao/dive-sites/",
      "https://www.divecuracao.info/dive/curacao-diving-guide/black-sand-beach/",
      "https://www.divers-guide.com/en/santa-pretu",
    ],
    briefing: {
      name: "Black Sand Beach and the Catherine",
      locationName: "Santa Cruz, Curaçao",
      forecastLatitude: 12.3036,
      forecastLongitude: -69.1494,
      description:
        "The Catherine, a 37 m wreck lying upside down in about 6 m of water, split in two and crusted with brain coral and sponge. Garden eels colonize the sand around her. Stay outside the hull.",
      marineLife: "Garden eels · brain coral · sponges",
      marineLifeDescription:
        "Garden eels on the sand, and brain coral and sponge growing on the steel.",
      difficultyLevel: "beginner",
      maxDepthMeters: 6,
      currentNote: "Boats work this coast, so tow an inflated surface marker.",
      divePlan: "Circle the wreck, then cross the sandy plateau beyond it to finish.",
      fitTone: "welcoming",
      fitNote: "Remote, with no help nearby. Tell someone where you are diving before you go in.",
      // Access: sources report the road to the beach is closed, so expect it to be empty. Confirm before driving out.
      creatureSlugs: ["garden-eel", "knobby-brain-coral", "brown-tube-sponge", "red-rope-sponge"],
    },
  },
  // Denominator row: Saba (tugboat wreck)
  {
    slug: "saba-tugboat-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/saba-tugboat/",
      "https://www.oceanencounters.com/excursions/curacao-dive-sites/",
      "https://www.divers-guide.com/en/saba-wreck",
      "https://www.padi.com/dive-site/curacao/saba/",
    ],
    briefing: {
      name: "Saba Tugboat",
      locationName: "Jan Thiel, Curaçao",
      forecastLatitude: 12.0808,
      forecastLongitude: -68.89,
      description:
        "A small tug past the inlet to the Jan Thiel salt flats, with its wheelhouse gone and its deck weathered, now an artificial reef. A drop-off lies a few meters from the wreck. Stay outside the hull.",
      marineLife: "Blue chromis · rock beauty · moray eels · seahorses",
      marineLifeDescription:
        "Blue chromis and rock beauties over the wreck, with doctorfish and parrotfish on the wall beside it.",
      difficultyLevel: "intermediate",
      depthMinMeters: 5,
      maxDepthMeters: 12,
      minimumCertificationLevel: "advanced_open_water",
      currentNote:
        "Reached by boat only, and the current is sometimes strong. If it runs, stay on the wall side of the wreck and tow an inflated surface marker.",
      divePlan:
        "Enter, follow the reef wall down to the wreck at 5–12 m, and come back along the wall.",
      fitTone: "demanding",
      fitNote:
        "Check conditions with the guide before entering. A small, shallow wreck beside a wall; the current decides whether it is an easy dive.",
      // Sources differ on the depth (under 9 m, or 12 m), so the deeper figure is used.
      creatureSlugs: [
        "blue-chromis",
        "rock-beauty",
        "green-moray",
        "longsnout-seahorse",
        "doctorfish",
        "queen-parrotfish",
      ],
    },
  },
  // Denominator row: The Blue Room
  {
    slug: "blue-room-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/blue-room-curacao/",
      "https://www.oceanencounters.com/excursions/curacao-dive-sites/",
      "https://www.padi.com/dive-site/curacao/blue-room/",
    ],
    briefing: {
      name: "The Blue Room",
      locationName: "Santa Cruz, Curaçao",
      forecastLatitude: 12.2973,
      forecastLongitude: -69.1555,
      description:
        "A small sea cave beside Mushroom Forest, about 5 m down. Sunlight through the underwater entrance turns the water in the chamber blue. A narrow opening at water level leads to an air-filled space with a bat colony overhead.",
      marineLife: "Silversides · nurse shark",
      marineLifeDescription: "Silversides in the light, and now and then a sleeping nurse shark.",
      difficultyLevel: "advanced",
      maxDepthMeters: 5,
      currentNote:
        "Reached by boat with a guide, and only with the guide. Swell along this coast can change the entrance. Do not remove your regulator or breathe the air in the chamber, and keep away from the bats' roost.",
      divePlan:
        "Enter the cave behind the guide, look at the blue light from the chamber, and leave the way you came in with the regulator in your mouth.",
      fitTone: "unknown",
      fitNote:
        "Short and shallow, but an enclosed space whose entrance depends on the swell. Guide only. Entry is a staff decision at the desk, with the guide and the swell.",
      // An enclosed sea cave: entered through a low underwater opening into a chamber. Treated as a cavern-class overhead,
      // so the cavern specialty is required even though it is short, and the gate is Advanced Open Water.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["cavern"],
      creatureSlugs: ["nurse-shark", "glassy-sweeper"],
    },
  },
  // Denominator row: Vaersenbaai Car Wrecks (Lover's Beach)
  {
    slug: "vaersenbaai-car-wrecks-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/car-wrecks-vaersensenbaai/",
      "https://www.divers-guide.com/en/vaersenbaai-car-wrecks-1652",
      "https://www.padi.com/dive-site/curacao/vaersenbaai-kokomo-beach/",
    ],
    briefing: {
      name: "Vaersenbaai Car Wrecks",
      locationName: "Vaersenbaai, Curaçao",
      forecastLatitude: 12.1579,
      forecastLongitude: -69.0048,
      description:
        "Cars, trucks and a pontoon barge sunk as a reef project, scattered between 20 and 50 m. A buoy at 5 m marks the wrecks after a surface swim of ten to twenty minutes from Kokomo Beach. A tugboat wreck lies nearby, and one guide puts it at 50 m. Stay outside the hulls.",
      marineLife: "Black coral · reef fish",
      marineLifeDescription:
        "Black coral grows on the deeper metal. The wrecks are deep and the swim out is long.",
      difficultyLevel: "advanced",
      depthMinMeters: 20,
      maxDepthMeters: 40,
      currentNote:
        "A long surface swim and a deep dive, for divers in good shape. Boats work this coast, so tow an inflated surface marker. The wrecks continue to 50 m, which is past the plan.",
      divePlan:
        "Swim out from Kokomo Beach to the buoy, descend to the wrecks, stay outside them, and keep to 40 m (131 ft) at most with gas for the swim back.",
      fitTone: "demanding",
      fitNote: "Deep, with a swim out and back. Plan gas for both.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: ["black-coral", "queen-angelfish", "blue-tang", "porcupinefish"],
    },
  },
  // Denominator row: Blue Bay: The Wall
  {
    slug: "blue-bay-wall-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/blue-bay-wall/",
      "https://www.divers-guide.com/en/blue-bay-wall",
      "https://bluebay-curacao.com/activities/diving",
    ],
    briefing: {
      name: "Blue Bay: The Wall",
      locationName: "Blue Bay, Curaçao",
      forecastLatitude: 12.1349,
      forecastLongitude: -68.9871,
      description:
        "A house reef off Blue Bay Beach. A gradual slope, patchy coral near the sand that thickens to near-solid cover after fifteen minutes, then a vertical wall from about 10 m to below 30 m, about 25 minutes out.",
      marineLife: "Turtles · barracuda · sea fans · soft coral",
      marineLifeDescription:
        "Large sea fans and soft coral at 10–15 m on the way back, turtles and barracuda on the reef.",
      difficultyLevel: "advanced",
      depthMinMeters: 10,
      maxDepthMeters: 30,
      currentNote:
        "Go right if the current allows. The current is sometimes strong and can change direction, so stay close to the wall. Move at a brisk pace at a moderate depth to reach the wall sooner. Boats work this coast, so tow an inflated surface marker. The wall continues below 30 m, past the plan.",
      divePlan:
        "A brisk pace right along the slope at a moderate depth to the wall, no deeper than 30 m, then back along the 10–15 m shelf.",
      fitTone: "demanding",
      fitNote: "A beach entry onto a real wall. Hold the floor of the plan.",
      // The wall falls below 30 m; the plan holds the floor at 30 m, so the gate is Advanced Open
      // Water without the Deep specialty. The sloping reef nearer the beach is an Open Water dive.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "green-sea-turtle",
        "great-barracuda",
        "common-sea-fan",
        "boulder-star-coral",
        "giant-barrel-sponge",
      ],
    },
  },
  // Denominator row: Grote Knip (Kenepa Grandi)
  {
    slug: "grote-knip-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/playa-kenepa-grandi/",
      "https://www.divers-guide.com/en/playa-abou-grote-knip",
    ],
    briefing: {
      name: "Grote Knip (Playa Kenepa Grandi)",
      locationName: "Westpunt, Curaçao",
      forecastLatitude: 12.352,
      forecastLongitude: -69.1524,
      description:
        "A shore dive from a popular beach on the Kenepa plantation. A sandy plateau reaches out to the shoulder of the reef at about 13 m, then the seabed steps down to a sandy plain at about 25 m.",
      marineLife: "Sponges · coral · rays · dolphins",
      marineLifeDescription:
        "Coral and sponge on the shoulder. Look out over the blue for rays and dolphins.",
      difficultyLevel: "advanced",
      depthMinMeters: 13,
      maxDepthMeters: 25,
      currentNote: "Boats work this coast, so tow an inflated surface marker.",
      divePlan:
        "Swim out across the plateau to the shoulder of the reef at about 13 m, work the step down no deeper than 25 m, and head back with reserve gas.",
      fitTone: "demanding",
      fitNote:
        "A beach entry, a ten-minute surface swim and a long plateau. The sandy plain at 25 m is past the Open Water limit.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "spotted-eagle-ray",
        "bottlenose-dolphin",
        "common-sea-fan",
        "orange-elephant-ear-sponge",
      ],
    },
  },
  // Denominator row: Snake Bay (Playa Wachi)
  {
    slug: "snake-bay-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/snake-bay/",
      "https://www.divers-guide.com/en/slangenbaai",
    ],
    briefing: {
      name: "Snake Bay (Playa Wachi)",
      locationName: "Sint Michiel, Curaçao",
      forecastLatitude: 12.1394,
      forecastLongitude: -68.9978,
      description:
        "A shore dive across a sand plateau to the drop-off at 10–13 m, then a 45-degree slope of hard coral and sponge. East is the preferred way; the return along 10–15 m is the better half.",
      marineLife: "Hard coral · sponges · macro life",
      marineLifeDescription:
        "Hard coral and sponge on the slope, and small animals on the sand plateau to the west.",
      difficultyLevel: "intermediate",
      depthMinMeters: 10,
      maxDepthMeters: 18,
      currentNote:
        "Choose your direction by the current. In heavy waves, cross the plateau underwater rather than at the surface. The slope continues deeper, past the plan. Tow an inflated surface marker.",
      divePlan:
        "Out across the plateau to the drop-off, left (east) along the slope, then back at 10–15 m.",
      fitTone: "unknown",
      fitNote:
        "Check conditions with the guide before entering. A shore dive across a plateau to a slope. Keep to 15 m and it stays simple.",
      // The slope continues below the plan. The 10–15 m shelf is the described dive, so the gate
      // stays at Open Water with an 18 m floor.
      creatureSlugs: [
        "boulder-star-coral",
        "orange-elephant-ear-sponge",
        "red-rope-sponge",
        "branching-tube-sponge",
      ],
    },
  },
  // Denominator row: Sweet Alice (Playa Forti)
  {
    slug: "sweet-alice-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/sweet-alice/",
      "https://www.divers-guide.com/en/playa-forti",
    ],
    briefing: {
      name: "Sweet Alice (Playa Forti)",
      locationName: "Westpunt, Curaçao",
      forecastLatitude: 12.3664,
      forecastLongitude: -69.1539,
      description:
        "A shore dive from the cliffs at Playa Forti, down the stairs and a short swim from the sand. The reef begins around 9 m and slopes to about 36 m.",
      marineLife: "Trumpetfish · turtles",
      marineLifeDescription: "Trumpetfish on the slope, turtles in the shallows.",
      difficultyLevel: "advanced",
      depthMinMeters: 9,
      maxDepthMeters: 36,
      currentNote:
        "Choose your direction by the current. Boats use the cove, and swimmers jump from the cliffs, so stay clear of the rocks. The slope continues to about 36 m, past the plan's floor.",
      divePlan:
        "Take the stairs, swim out to the reef and follow the slope no deeper than 30 m (100 ft), then return up the reef with reserve gas.",
      fitTone: "demanding",
      fitNote: "A cliff entry onto a slope that reaches 36 m. The turn comes at 30 m.",
      // The slope reaches about 36 m, so the gate is Advanced Open Water plus Deep. The plan holds
      // a 30 m floor in the divePlan.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: ["trumpetfish", "green-sea-turtle", "queen-parrotfish", "common-sea-fan"],
    },
  },
  // Denominator row: Alice in Wonderland (Playa Kalki)
  {
    slug: "alice-in-wonderland-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.gowestdiving.com/diving-curacao/shore-diving-curacao/",
      "https://www.divecuracao.info/dive/curacao-diving-guide/alice-in-wonderland/",
      "https://www.padi.com/dive-site/curacao/playa-kalki/",
      "https://www.scuba-diving-smiles.com/curacao-scuba-diving.html",
    ],
    briefing: {
      name: "Alice in Wonderland (Playa Kalki)",
      locationName: "Westpunt, Curaçao",
      forecastLatitude: 12.3749,
      forecastLongitude: -69.1579,
      description:
        "A house reef 100 feet straight out from the end of a pier. A reference rope leads from the pier down to the coral. The reef starts shallow and slopes past 30 m.",
      marineLife: "Green moray · lobster · lettuce sea slug · parrotfish · turtles",
      marineLifeDescription:
        "Morays, lobster and sea slugs under the pier and along the rope. Turtles and the odd eagle ray over the reef.",
      difficultyLevel: "beginner",
      depthMinMeters: 5,
      maxDepthMeters: 30,
      currentNote:
        "Calm water is usual. The slope runs below 30 m, which is past the plan. Tow an inflated surface marker.",
      divePlan:
        "Follow the reference rope from the pier end down to the reef, go either way along the slope, and turn at 18 m. Never follow the slope below it.",
      fitTone: "welcoming",
      fitNote:
        "An easy beach entry and a reef that begins close to shore. The slope runs past 30 m, so the turn at 18 m matters.",
      // The reef slopes past 30 m, so maxDepthMeters is 30, ungated at the ceiling. The shop runs shore packages for
      // certified Open Water divers, so the plan holds an 18 m floor.
      creatureSlugs: [
        "green-moray",
        "spiny-lobster",
        "lettuce-sea-slug",
        "queen-parrotfish",
        "green-sea-turtle",
        "spotted-eagle-ray",
      ],
    },
  },
  // Denominator row: Watamula
  {
    slug: "watamula-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/watamula/",
      "https://www.gowestdiving.com/diving-curacao/dive-sites/",
      "https://www.divers-guide.com/en/watamula",
      "https://divearoo.com/destinations/curacao",
    ],
    briefing: {
      name: "Watamula",
      locationName: "Westpunt, Curaçao",
      forecastLatitude: 12.3857,
      forecastLongitude: -69.1599,
      description:
        "A boat-only reef off the island's west tip, where converging currents keep bands of hard and soft coral clean. The reef drops from shallow gardens into steeper walls and sand patches, and the depth depends on the route the captain takes.",
      marineLife: "Ocean triggerfish · grunts · turtles · eagle rays",
      marineLifeDescription:
        "Dense coral with schools of triggerfish and grunts. Turtles and eagle rays pass along the edge.",
      difficultyLevel: "advanced",
      depthMinMeters: 6,
      maxDepthMeters: 36,
      currentNote:
        "Currents can be unpredictable and strong, and the dive is only run in calm weather with a local guide. Shore access is not recommended. Expect a drift. Carry an SMB. The route can run deeper than 30 m, past the plan's floor.",
      divePlan:
        "Drift the reef from the shallow gardens along the wall, no deeper than 30 m (100 ft), and ascend with the boat following your marker.",
      fitTone: "demanding",
      fitNote:
        "A boat drift in current that changes. The captain's route can run deeper than the plan. For divers with recent drift experience; check at the desk.",
      // Depth runs 6–28 m on two pages and up to 36 m on another, route dependent. The range takes
      // the deeper figure, since the captain picks the route, so the gate is Advanced Open Water plus Deep. The plan holds a 30 m floor.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "ocean-triggerfish",
        "white-grunt",
        "queen-angelfish",
        "green-sea-turtle",
        "spotted-eagle-ray",
        "nurse-shark",
      ],
    },
  },
  // Denominator row: Rediho
  {
    slug: "rediho-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/rediho-dive-site/",
      "https://www.gowestdiving.com/diving-curacao/dive-sites/",
      "https://www.divers-guide.com/en/rediho",
      "https://www.padi.com/dive-site/curacao/rediho/",
    ],
    briefing: {
      name: "Rediho",
      locationName: "Soto, Curaçao",
      forecastLatitude: 12.2802,
      forecastLongitude: -69.1473,
      description:
        "A boat dive between Black Coral Garden and Playa Hulu. Current flushes over steep drop-offs and sand channels, keeping the soft and hard coral clean. The mooring sits at 4.5 m, so the safety stop is a pleasant hover over the coral.",
      marineLife: "Eagle rays · seahorses · turtles · barracuda · porcupinefish",
      marineLifeDescription: "Eagle rays and seahorses are regulars, with frogfish in the sponges.",
      difficultyLevel: "advanced",
      depthMinMeters: 11,
      maxDepthMeters: 26,
      currentNote:
        "Deep-water current flushes the site, and it is dived as a drift. Carry an SMB. Drop-offs fall beyond the 26 m best-viewing range.",
      divePlan:
        "Drift over the drop-offs between 11 and 26 m, hold 26 m (85 ft) at most, and hover over the coral on the 4.5 m mooring for the safety stop.",
      fitTone: "demanding",
      fitNote: "A drift over drop-offs. The best of it is between 11 and 26 m.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "spotted-eagle-ray",
        "longsnout-seahorse",
        "green-sea-turtle",
        "great-barracuda",
        "porcupinefish",
        "longlure-frogfish",
      ],
    },
  },
  // Denominator row: Sponge Forest
  {
    slug: "sponge-forest-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.gowestdiving.com/diving-curacao/dive-sites/",
      "https://www.divecuracao.info/dive/curacao-diving-guide/sponge-forest/",
      "https://www.divers-guide.com/en/sponge-forest",
      "https://www.padi.com/dive-site/curacao/sponge-forest/",
    ],
    briefing: {
      name: "Sponge Forest",
      locationName: "Santa Cruz, Curaçao",
      forecastLatitude: 12.2961,
      forecastLongitude: -69.1569,
      description:
        "A gently sloping wall beside Mushroom Forest and the Blue Room, covered in orange elephant-ear sponges, large barrel sponges and purple stovepipes. A boat dive.",
      marineLife: "Elephant-ear sponges · barrel sponges · stovepipe sponges",
      marineLifeDescription:
        "Sponges of every size on the wall, with fish moving through them. Good for wide-angle.",
      difficultyLevel: "advanced",
      depthMinMeters: 11,
      maxDepthMeters: 26,
      currentNote:
        "Boat only. Current not documented; ask the crew on the day. Tow an inflated surface marker.",
      divePlan:
        "Work along the sponge wall between 11 and 26 m, hold 26 m (85 ft) at most, and return along the shallower sponges.",
      fitTone: "demanding",
      fitNote: "A sponge wall at 11–26 m. Keep your hands off the sponges and an eye on the gauge.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "orange-elephant-ear-sponge",
        "giant-barrel-sponge",
        "stovepipe-sponge",
        "red-rope-sponge",
        "queen-angelfish",
      ],
    },
  },
  // Denominator row: Black Rock (Piedra Pretu)
  {
    slug: "black-rock-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/black-rock/",
      "https://www.oceanencounters.com/excursions/curacao-dive-sites/",
    ],
    briefing: {
      name: "Black Rock (Piedra Pretu)",
      locationName: "Eastpoint, Curaçao",
      forecastLatitude: 12.042,
      forecastLongitude: -68.7665,
      description:
        "Coral-covered walls on the open blue, inside the Curaçao Marine Park and reached only by boat. Schools of snapper and grunts pour over the reef, with barracuda and eagle rays passing the edge.",
      marineLife: "Snapper · grunts · barracuda · eagle rays",
      marineLifeDescription:
        "Walls of coral, sponge and sea fan with schools along them. Nurse sharks are reported.",
      difficultyLevel: "advanced",
      depthMinMeters: 5,
      maxDepthMeters: 30,
      currentNote:
        "Currents can run, and operators recommend Advanced Open Water. Boat only, so tow an inflated surface marker. The wall drops past the plan's floor.",
      divePlan:
        "Drop onto the coral wall, follow it no deeper than 30 m (100 ft) as the boat tracks your marker, and finish on the shallow terrace.",
      fitTone: "demanding",
      fitNote: "Walls on open blue water with current that can run. The boat is the only way in.",
      // The wall falls past recreational depth; the plan holds a 30 m floor, so the gate is Advanced
      // Open Water without the Deep specialty (walls rule). A shop that runs the shallow terrace as Open
      // Water can lower it.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "french-grunt",
        "bluestriped-grunt",
        "great-barracuda",
        "spotted-eagle-ray",
        "nurse-shark",
        "common-sea-fan",
      ],
    },
  },
  // Denominator row: Smokey's (Punti Sanchi) and Kathy's Paradise
  {
    slug: "smokeys-kathys-paradise-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/smokeys/",
      "https://www.oceanencounters.com/excursions/curacao-dive-sites/",
      "https://www.divers-guide.com/en/smokeys",
    ],
    briefing: {
      name: "Smokey's and Kathy's Paradise",
      locationName: "Fuikbaai, Curaçao",
      forecastLatitude: 12.0402,
      forecastLongitude: -68.8107,
      description:
        "A boat drift east along a wall, from Smokey's to Kathy's Paradise, past coral overhangs and sharp drop-offs inside the Curaçao Marine Park. Not reachable from land.",
      marineLife: "Stingrays · turtles · sea fans",
      marineLifeDescription:
        "Dense coral overhangs along the wall, with rays and turtles in the open water beside it.",
      difficultyLevel: "advanced",
      depthMinMeters: 5,
      maxDepthMeters: 30,
      currentNote:
        "Run as a drift dive, and the current is sometimes hard and changes direction. High waves are common. Carry an SMB and keep the boat in mind. The reef slopes to 30 m and then to sand, which is the plan's floor.",
      divePlan:
        "Drift east along the wall from Smokey's toward Kathy's Paradise, no deeper than 30 m (100 ft), and ascend with the boat following your marker.",
      fitTone: "demanding",
      fitNote:
        "A drift along a wall with hard current and high waves. For divers at ease with a marker and a boat pickup. For divers with recent drift experience; check at the desk.",
      // The slope reaches 30 m and then sand (a source also describes sharp drop-offs). The plan holds a 30 m floor, so the gate is
      // Advanced Open Water without the Deep specialty (walls rule). Sources call it a site for experienced divers.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "southern-stingray",
        "green-sea-turtle",
        "common-sea-fan",
        "boulder-star-coral",
      ],
    },
  },
  // Denominator row: Newport (Nieuwpoort)
  {
    slug: "newport-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/newport-dive-site/",
      "https://www.oceanencounters.com/excursions/curacao-dive-sites/",
    ],
    briefing: {
      name: "Newport (Nieuwpoort)",
      locationName: "Fuikbaai, Curaçao",
      forecastLatitude: 12.0464,
      forecastLongitude: -68.8268,
      description:
        "A sloping reef of star and brain coral and gorgonians that leads to a wall plunging into the blue, just east of Fuikbaai. Boat only.",
      marineLife: "Eagle rays · turtles · barracuda · barrel sponges",
      marineLifeDescription:
        "Barrel sponges and gorgonians on the slope, eagle rays and turtles over it.",
      difficultyLevel: "advanced",
      depthMinMeters: 5,
      maxDepthMeters: 30,
      currentNote:
        "Boat only, with exposure on the open coast. Tow an inflated surface marker. The wall drops past the plan's floor.",
      divePlan:
        "Down the reef slope, along the top of the wall no deeper than 30 m (100 ft), and back up the slope with the boat following your marker.",
      fitTone: "demanding",
      fitNote:
        "An open-coast boat dive where the slope ends at a wall. Turn before the plan's floor.",
      // The wall falls past recreational depth; the plan holds a 30 m floor, so the gate is Advanced
      // Open Water without the Deep specialty (walls rule). A shop that runs the shallow terrace as Open
      // Water can lower it.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "spotted-eagle-ray",
        "green-sea-turtle",
        "great-barracuda",
        "giant-barrel-sponge",
        "common-sea-fan",
      ],
    },
  },
  // Denominator row: Booby Trap
  {
    slug: "booby-trap-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/booby-trap/",
      "https://www.oceanencounters.com/excursions/curacao-dive-sites/",
      "https://www.divers-guide.com/en/booby-trap",
    ],
    briefing: {
      name: "Booby Trap",
      locationName: "Fuikbaai, Curaçao",
      forecastLatitude: 12.0516,
      forecastLongitude: -68.837,
      description:
        "A sloping drop-off with a sandy and rubble plateau outside the Fuikbaai breakwater, between Eel Valley and Newport. A good place to learn sponges: barrel, tube, rope and vase.",
      marineLife: "Barrel sponges · tube sponges · eagle rays · turtles",
      marineLifeDescription:
        "Sponges of many kinds on the slope, with juvenile fish among the boulder corals.",
      difficultyLevel: "advanced",
      depthMinMeters: 5,
      maxDepthMeters: 30,
      currentNote:
        "Boat only. Current not documented; ask the crew on the day. Tow an inflated surface marker.",
      divePlan:
        "Work the plateau and the sponge-covered drop-off no deeper than 30 m (100 ft), then return along the shallower slope.",
      fitTone: "demanding",
      fitNote:
        "A sponge slope outside the Fuikbaai breakwater. The drop-off continues past the plan.",
      // The operator pages disagree on the level, so the gate is the stricter one.
      // The wall falls past recreational depth; the plan holds a 30 m floor, so the gate is Advanced Open
      // Water without the Deep specialty (walls rule). A shop that runs the shallow terrace as Open
      // Water can lower it.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "giant-barrel-sponge",
        "branching-tube-sponge",
        "red-rope-sponge",
        "branching-vase-sponge",
        "spotted-eagle-ray",
        "green-sea-turtle",
      ],
    },
  },
  // Denominator row: Eel Valley
  {
    slug: "eel-valley-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/eel-valley/",
      "https://www.oceanencounters.com/excursions/curacao-dive-sites/",
      "https://www.divers-guide.com/en/eel-valley",
    ],
    briefing: {
      name: "Eel Valley",
      locationName: "Santa Barbara, Curaçao",
      forecastLatitude: 12.0583,
      forecastLongitude: -68.8433,
      description:
        "A sandy plateau with sand chutes and coral heads that lead down to a steep drop-off and a wall, in front of the Santa Barbara golf course. Southern stingrays and garden eels on the sand.",
      marineLife: "Southern stingrays · garden eels · coral heads",
      marineLifeDescription: "Rays and garden eels on the plateau, small animals among the heads.",
      difficultyLevel: "advanced",
      depthMinMeters: 5,
      maxDepthMeters: 30,
      currentNote:
        "Boat only. Current not documented; ask the crew on the day. Tow an inflated surface marker.",
      divePlan:
        "Down the sand chutes to the drop-off, along the wall no deeper than 30 m (100 ft), and back up over the coral heads.",
      fitTone: "demanding",
      fitNote: "Sand, garden eels and stingrays above a wall that runs below the plan's floor.",
      // The operator pages disagree on the level, so the gate is the stricter one.
      // The wall falls past recreational depth; the plan holds a 30 m floor, so the gate is Advanced Open
      // Water without the Deep specialty (walls rule). A shop that runs the shallow terrace as Open
      // Water can lower it.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["southern-stingray", "garden-eel", "boulder-star-coral", "sharptail-eel"],
    },
  },
  // Denominator row: Barracuda Point (Punt'i Piku)
  {
    slug: "barracuda-point-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/barracuda-point/",
      "https://www.oceanencounters.com/excursions/curacao-dive-sites/",
      "https://www.divers-guide.com/en/barracuda-point",
    ],
    briefing: {
      name: "Barracuda Point (Punt'i Piku)",
      locationName: "Caracasbaai, Curaçao",
      forecastLatitude: 12.0623,
      forecastLongitude: -68.8559,
      description:
        "Dense boulder coral, gorgonians and coral fields on the east point of the Caracasbaai peninsula, across the channel from a resort. The reef eases down to 15 m before it steepens. Often a drift toward Director's Bay.",
      marineLife: "Barracuda · green turtles · horse-eye jacks · parrotfish",
      marineLifeDescription: "Turtles, jacks and barracuda over the coral fields.",
      difficultyLevel: "advanced",
      depthMinMeters: 5,
      maxDepthMeters: 30,
      currentNote:
        "Boats and shipping work the channel nearby, so listen for engines. Often run as a drift. Carry an SMB. The reef steepens below 15 m and falls past the plan's floor.",
      divePlan:
        "Drift along the boulder coral at about 15 m, drop to the steeper reef only as far as 30 m (100 ft), and ascend with the boat following your marker.",
      fitTone: "demanding",
      fitNote: "A drift on a point with channel traffic. The reef steepens past 15 m.",
      // The wall falls past recreational depth; the plan holds a 30 m floor, so the gate is Advanced
      // Open Water without the Deep specialty (walls rule). A shop that runs the shallow terrace as Open
      // Water can lower it.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "great-barracuda",
        "green-sea-turtle",
        "horse-eye-jack",
        "queen-parrotfish",
        "common-sea-fan",
      ],
    },
  },
  // Denominator row: Lost Anchor
  {
    slug: "lost-anchor-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/lost-anchor/",
      "https://www.oceanencounters.com/excursions/curacao-dive-sites/",
      "https://www.divers-guide.com/en/lost-anchor",
    ],
    briefing: {
      name: "Lost Anchor",
      locationName: "Caracasbaai, Curaçao",
      forecastLatitude: 12.0743,
      forecastLongitude: -68.869,
      description:
        "A short plateau, then a steep wall along the shore under the Jan Thiel cliff, hung with gorgonians and sea fans. A coral-covered anchor chain runs down it. The dive ends on a shallow plateau where seahorses live.",
      marineLife: "Seahorses · gorgonians · sea fans",
      marineLifeDescription: "Gorgonian garden on the wall, seahorses on the plateau at the end.",
      difficultyLevel: "advanced",
      depthMinMeters: 5,
      maxDepthMeters: 30,
      currentNote:
        "Inside the Curaçao Marine Park, with boats nearby. Current not documented; ask the crew on the day. Tow an inflated surface marker.",
      divePlan:
        "Down the wall beside the anchor chain, no deeper than 30 m (100 ft), then finish on the shallow plateau with the seahorses.",
      fitTone: "demanding",
      fitNote: "A steep wall under a cliff, with a gentle plateau to finish on.",
      // The operator pages disagree on the level, so the gate is the stricter one.
      // The wall falls past recreational depth; the plan holds a 30 m floor, so the gate is Advanced Open
      // Water without the Deep specialty (walls rule). A shop that runs the shallow terrace as Open
      // Water can lower it.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["longsnout-seahorse", "common-sea-fan", "encrusting-gorgonian", "sea-plume"],
    },
  },
  // Denominator row: Beacon Point (Kabes di Baranka)
  {
    slug: "beacon-point-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/beacon-point/",
      "https://www.oceanencounters.com/excursions/curacao-dive-sites/",
      "https://www.divers-guide.com/en/beacon-point",
    ],
    briefing: {
      name: "Beacon Point (Kabes di Baranka)",
      locationName: "Jan Thiel, Curaçao",
      forecastLatitude: 12.0708,
      forecastLongitude: -68.8738,
      description:
        "A vertical wall that drops 30 m, with stands of pillar coral on the shallow plateau above it, at the west tip of Caracasbaai. Look out into the blue for jacks, grouper and barracuda.",
      marineLife: "Pillar coral · jacks · grouper · barracuda",
      marineLifeDescription:
        "Pillar coral on the plateau and big fish out on the edge of the blue.",
      difficultyLevel: "advanced",
      depthMinMeters: 5,
      maxDepthMeters: 30,
      currentNote:
        "A boat dive in current, usually run as a drift. Carry an SMB. The wall drops about 30 m, to the plan's floor.",
      divePlan:
        "Start on the pillar-coral plateau, follow the wall no deeper than 30 m (100 ft), and ascend with the boat following your marker.",
      fitTone: "demanding",
      fitNote: "A vertical wall with current. Look out into the blue and watch the gauge.",
      // The wall falls past recreational depth; the plan holds a 30 m floor, so the gate is Advanced
      // Open Water without the Deep specialty (walls rule). A shop that runs the shallow terrace as Open
      // Water can lower it.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["pillar-coral", "horse-eye-jack", "black-grouper", "great-barracuda"],
    },
  },
  // Denominator row: Black Coral Garden
  {
    slug: "black-coral-garden-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/black-coral-garden/",
      "https://www.gowestdiving.com/diving-curacao/dive-sites/",
      "https://www.divers-guide.com/en/black-coral-garden",
      "https://www.divecentercuracao.com/en/coraldivers/divesitescuracao",
    ],
    briefing: {
      name: "Black Coral Garden",
      locationName: "Soto, Curaçao",
      forecastLatitude: 12.2749,
      forecastLongitude: -69.1419,
      description:
        "A boat dive on a slope with rare black coral, sea fans and bottlebrush coral, dived along the wall and back to the boat. It is simple to drift deeper than you meant to.",
      marineLife: "Black coral · sea fans · schooling fish",
      marineLifeDescription:
        "Black coral and sea fans on the wall. Black coral takes a century to regrow, so keep clear of it.",
      difficultyLevel: "advanced",
      depthMinMeters: 5,
      maxDepthMeters: 30,
      currentNote:
        "Sources disagree on the current: one reports little to none, others report mild to strong. The wall falls away, so watch your depth and time. Tow an inflated surface marker.",
      divePlan:
        "Dive the slope along the wall, no deeper than 30 m (100 ft), and return to the boat along the shallower coral.",
      fitTone: "demanding",
      fitNote:
        "A slope with black coral where it is easy to drift deeper than planned. Watch the gauge.",
      // The wall falls past recreational depth; the plan holds a 30 m floor, so the gate is Advanced
      // Open Water without the Deep specialty (walls rule). A shop that runs the shallow terrace as Open
      // Water can lower it.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["black-coral", "common-sea-fan", "sea-plume", "queen-angelfish"],
    },
  },
  // Denominator row: Mako's Mountain
  {
    slug: "makos-mountain-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/makos-mountain/",
      "https://www.gowestdiving.com/diving-curacao/dive-sites/",
      "https://www.divers-guide.com/en/makos-mountain-1",
    ],
    briefing: {
      name: "Mako's Mountain",
      locationName: "Soto, Curaçao",
      forecastLatitude: 12.2685,
      forecastLongitude: -69.1369,
      description:
        "A field of soft coral in the shallows, then a drop-off with hard coral on the face. Porcupinefish, rays, morays and lobster in the reef. Sharks have been seen here.",
      marineLife: "Porcupinefish · rays · moray eels · lobster",
      marineLifeDescription:
        "Soft coral shallows and a hard coral face, with rays and morays in the reef.",
      difficultyLevel: "advanced",
      depthMinMeters: 5,
      maxDepthMeters: 30,
      currentNote:
        "Currents can be strong, and the entry is rough in waves. Sources call it a dive for experienced divers. Carry an SMB.",
      divePlan:
        "Cross the soft coral shallows, follow the drop-off no deeper than 30 m (100 ft), and return along the shallow field.",
      fitTone: "demanding",
      fitNote:
        "A drop-off with strong current and a rough entry in waves. Carry a marker and keep the exit in mind.",
      // The wall falls past recreational depth; the plan holds a 30 m floor, so the gate is Advanced
      // Open Water without the Deep specialty (walls rule). A shop that runs the shallow terrace as Open
      // Water can lower it.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "porcupinefish",
        "spotted-eagle-ray",
        "green-moray",
        "spiny-lobster",
        "tarpon",
      ],
    },
  },
  // Denominator row: Hell's Corner
  {
    slug: "hells-corner-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/hells-corner/",
      "https://www.divers-guide.com/en/hells-corner",
    ],
    briefing: {
      name: "Hell's Corner",
      locationName: "Soto, Curaçao",
      forecastLatitude: 12.2708,
      forecastLongitude: -69.1402,
      description:
        "A steep wall off Soto, named for the strong current at the nearby point. The mooring has been moved west of the point to calmer water. Brain coral, tube sponges, large gorgonians and schooling jacks.",
      marineLife: "Jacks · barracuda · turtles · morays",
      marineLifeDescription:
        "Gorgonians and brain coral on the wall with schools of jacks along it.",
      difficultyLevel: "advanced",
      depthMinMeters: 5,
      maxDepthMeters: 30,
      currentNote:
        "Strong current at the point, and high waves. It is dived in calm weather, as a drift. Carry an SMB. The wall falls past the plan's floor.",
      divePlan:
        "Drift along the wall west of the point, no deeper than 30 m (100 ft), and ascend with the boat following your marker.",
      fitTone: "demanding",
      fitNote:
        "A steep wall named for the current at the point. Dive it in calm weather only. For divers with recent drift experience; check at the desk.",
      // The wall falls past recreational depth; the plan holds a 30 m floor, so the gate is Advanced
      // Open Water without the Deep specialty (walls rule). A shop that runs the shallow terrace as Open
      // Water can lower it.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "horse-eye-jack",
        "great-barracuda",
        "green-sea-turtle",
        "spotted-moray",
        "green-moray",
        "giant-barrel-sponge",
      ],
    },
  },
  // Denominator row: Dwayne's Release (Scooter)
  {
    slug: "duanes-release-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/duanes-release/",
      "https://www.gowestdiving.com/diving-curacao/dive-sites/",
      "https://www.divers-guide.com/en/duanes-release",
    ],
    briefing: {
      name: "Duane's Release (Scooter)",
      locationName: "Soto, Curaçao",
      forecastLatitude: 12.2834,
      forecastLongitude: -69.1509,
      description:
        "A boat dive between Rediho and Playa Hulu on a densely covered reef. Sea rods, star and brain coral, big orange elephant-ear sponges and gorgonians fill it, and the folds of the reef shelter octopus, arrow crabs and eels. A memorial plaque is fixed at the mooring.",
      marineLife: "Angelfish · octopus · eagle rays · arrow crabs",
      marineLifeDescription: "Angelfish in numbers, with octopus and eagle rays in the reef folds.",
      difficultyLevel: "advanced",
      depthMinMeters: 5,
      maxDepthMeters: 30,
      currentNote: "A slight current, run as a drift. Carry an SMB.",
      divePlan:
        "Drift over the reef from the mooring, no deeper than 30 m (100 ft), and ascend with the boat following your marker.",
      fitTone: "demanding",
      fitNote:
        "A densely covered reef in a slight current. The slope beside it runs below the plan.",
      // The wall falls past recreational depth; the plan holds a 30 m floor, so the gate is Advanced
      // Open Water without the Deep specialty (walls rule). A shop that runs the shallow terrace as Open
      // Water can lower it.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "queen-angelfish",
        "french-angelfish",
        "caribbean-reef-octopus",
        "spotted-eagle-ray",
        "arrow-crab",
        "orange-elephant-ear-sponge",
      ],
    },
  },
  // Denominator row: Playa Hulu
  {
    slug: "playa-hulu-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/playa-hulu/",
      "https://www.gowestdiving.com/diving-curacao/dive-sites/",
      "https://www.divers-guide.com/en/play-hulu",
    ],
    briefing: {
      name: "Playa Hulu",
      locationName: "Santa Cruz, Curaçao",
      forecastLatitude: 12.288,
      forecastLongitude: -69.1523,
      description:
        "A boat dive on a steep wall of mountainous star coral near Mushroom Forest, the Blue Room and Sponge Forest. Seahorses and frogfish live in the coral.",
      marineLife: "Mountainous star coral · seahorses · frogfish",
      marineLifeDescription: "Star coral on the wall, with small animals tucked into it.",
      difficultyLevel: "advanced",
      depthMinMeters: 5,
      maxDepthMeters: 30,
      currentNote:
        "Boat only. Current not documented; ask the crew on the day. Tow an inflated surface marker. The wall falls past the plan's floor.",
      divePlan:
        "Follow the star-coral wall no deeper than 30 m (100 ft) and return along the shallower coral.",
      fitTone: "demanding",
      fitNote: "A steep star-coral wall where the small animals live in the shallows.",
      // The wall falls past recreational depth; the plan holds a 30 m floor, so the gate is Advanced
      // Open Water without the Deep specialty (walls rule). A shop that runs the shallow terrace as Open
      // Water can lower it.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "mountainous-star-coral",
        "longsnout-seahorse",
        "longlure-frogfish",
        "queen-angelfish",
      ],
    },
  },
  {
    slug: "seldom-reef-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/seldom-reef/",
      "https://www.divers-guide.com/en/seldom-reef",
      "https://www.divecentercuracao.com/en/coraldivers/divesitescuracao",
    ],
    briefing: {
      name: "Seldom Reef",
      locationName: "Bullenbaai, Curaçao",
      forecastLatitude: 12.1923,
      forecastLongitude: -69.0531,
      description:
        "A drift dive inside Bullenbaai, northeast of Kaap Sint Marie, along a sheer wall of about 90 ft. It is dived rarely because it needs a particular wind and calm seas.",
      marineLife: "Coral · sponges · reef fish",
      marineLifeDescription: "Coral and sponge on a sheer wall, for experienced drift divers.",
      difficultyLevel: "advanced",
      depthMinMeters: 5,
      maxDepthMeters: 30,
      currentNote:
        "Bullenbaai is a tanker terminal, so tankers berth and maneuver here. Keep clear of the terminal and its restricted water, listen for engines and carry an SMB. Strong current is reported, and the dive is for calm weather only.",
      divePlan:
        "Drift along the wall no deeper than 30 m (100 ft) and ascend with the boat following your marker.",
      fitTone: "demanding",
      fitNote:
        "A drift along a sheer wall beside a tanker terminal, dived only in a particular wind and calm seas.",
      // The wall falls past recreational depth; the plan holds a 30 m floor, so the gate is Advanced
      // Open Water without the Deep specialty (walls rule). A shop that runs the shallow terrace as Open
      // Water can lower it.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "common-sea-fan",
        "orange-elephant-ear-sponge",
        "giant-barrel-sponge",
        "queen-angelfish",
      ],
    },
  },
  // Denominator row: Eastpoint
  {
    slug: "eastpoint-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/eastpoint/",
      "https://www.oceanencounters.com/excursions/curacao-dive-sites/",
      "https://www.divers-guide.com/en/tarpon-bridge",
    ],
    briefing: {
      name: "Eastpoint (Oostpunt)",
      locationName: "Oostpunt, Curaçao",
      forecastLatitude: 12.0441,
      forecastLongitude: -68.736,
      description:
        "The fringing reef at the island's eastern tip, reached only by boat. Tarpon Bridge, a natural coral arch about 7 m high and 12 m wide at roughly 20 m, shelters a school of tarpon. Eagle rays, large barracuda and turtles are seen here, and sharks are possible.",
      marineLife: "Tarpon · eagle rays · barracuda · turtles",
      marineLifeDescription:
        "A school of tarpon at the bridge, with rays and barracuda around the reef.",
      difficultyLevel: "advanced",
      maxDepthMeters: 20,
      currentNote:
        "Strong currents and surge, and the site is not always accessible. Carry an SMB.",
      divePlan:
        "Drift to Tarpon Bridge at about 20 m, look from the outside of the arch, and ascend with the boat following your marker.",
      fitTone: "demanding",
      fitNote:
        "A remote tip with strong current and surge, and a bridge at 20 m. It is not always accessible.",
      // Tarpon Bridge sits at about 20 m, past the Open Water limit, in current and surge.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "tarpon",
        "spotted-eagle-ray",
        "great-barracuda",
        "green-sea-turtle",
        "caribbean-reef-shark",
        "common-sea-fan",
      ],
    },
  },
  // Denominator row: Klein Curaçao
  {
    slug: "klein-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/klein-curacao/",
      "https://www.oceanencounters.com/excursions/curacao-dive-sites/",
      "https://fundivingcuracao.com/en/dive-sites",
    ],
    briefing: {
      name: "Klein Curaçao",
      locationName: "Klein Curaçao",
      forecastLatitude: 11.9852,
      forecastLongitude: -68.6456,
      description:
        "An uninhabited island about 11 km southeast of Curaçao, a day trip of roughly 90 minutes by boat. Reef slopes into a wall on the windward side, with shallower coral on the leeward flats. Turtles are often seen.",
      marineLife: "Turtles · ocean triggerfish · grouper",
      marineLifeDescription: "Turtles on the leeward flats, big fish along the windward wall.",
      difficultyLevel: "advanced",
      depthMinMeters: 5,
      maxDepthMeters: 30,
      currentNote:
        "Current is a regular feature, often enough to dive it as a drift, and the surface is choppier than at the mainland. Carry an SMB and have topside support.",
      divePlan:
        "Dive the leeward flats or drift the windward slope, no deeper than 30 m (100 ft), and ascend with the boat following your marker.",
      fitTone: "demanding",
      fitNote: "A day trip with regular current and a choppy surface. Topside support matters.",
      // The wall falls past recreational depth; the plan holds a 30 m floor, so the gate is Advanced
      // Open Water without the Deep specialty (walls rule). A shop that runs the shallow terrace as Open
      // Water can lower it.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["green-sea-turtle", "ocean-triggerfish", "black-grouper", "hawksbill-turtle"],
    },
  },
  // Denominator row: Small Wall (Kabayé)
  {
    slug: "small-wall-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/small-wall/",
      "https://www.oceanencounters.com/excursions/curacao-dive-sites/",
      "https://www.divers-guide.com/en/small-wall",
    ],
    briefing: {
      name: "Small Wall (Kabayé)",
      locationName: "Caracasbaai, Curaçao",
      forecastLatitude: 12.0633,
      forecastLongitude: -68.8601,
      description:
        "A giant stride onto a sandy plateau, then a small wall that leads to a bigger drop-off beyond recreational limits. Crevices hold morays, shrimp and lobster. Between Barracuda Point and Director's Bay.",
      marineLife: "Moray eels · cleaner shrimp · lobster",
      marineLifeDescription: "Crevices along the wall are full of small animals.",
      difficultyLevel: "intermediate",
      depthMinMeters: 5,
      maxDepthMeters: 18,
      currentNote:
        "Inside the Curaçao Marine Park, with boats nearby. The drop-off beyond the wall is past the plan's floor. Tow an inflated surface marker.",
      divePlan:
        "Giant stride onto the plateau, follow the small wall to 18 m, and turn there. The bigger drop-off beyond is not part of this dive.",
      fitTone: "welcoming",
      fitNote: "A small wall on a sandy plateau. Turn at 18 m, before the larger drop.",
      // Sources describe a shallow terrace or slope that is run as an Open Water dive; the plan holds an
      // 18 m floor and anything deeper lies beyond it.
      creatureSlugs: [
        "green-moray",
        "banded-coral-shrimp",
        "spiny-lobster",
        "pederson-cleaner-shrimp",
      ],
    },
  },
  // Denominator row: Jan Thiel (Jan Thiel Bay)
  {
    slug: "jan-thiel-bay-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/jan-thiel-bay/",
      "https://www.oceanencounters.com/excursions/curacao-dive-sites/",
      "https://www.divers-guide.com/en/jan-thiel-baai",
    ],
    briefing: {
      name: "Jan Thiel Bay",
      locationName: "Jan Thiel, Curaçao",
      forecastLatitude: 12.0759,
      forecastLongitude: -68.8824,
      description:
        "An easy entry to a sandy plateau and gentle slope, with coral gardens, sea fans and the wreck of the sailboat Strea inside the bay.",
      marineLife: "Turtles · reef squid · donkey dung sea cucumbers · long-spined urchins",
      marineLifeDescription: "Turtles and squid over the slope, small animals on the sand.",
      difficultyLevel: "intermediate",
      depthMinMeters: 5,
      maxDepthMeters: 18,
      currentNote:
        "Boats and swimmers share the bay. Tow an inflated surface marker. Walls lie beyond the plateau and past the plan.",
      divePlan:
        "Enter at the bay, cross the plateau and gentle slope to 18 m, and look for the Strea wreck inside the bay on the way back.",
      fitTone: "welcoming",
      fitNote: "A gentle bay slope shared with boats and swimmers. Stay inside the plan's 18 m.",
      // Sources describe a shallow terrace or slope that is run as an Open Water dive; the plan holds an
      // 18 m floor and anything deeper lies beyond it.
      creatureSlugs: [
        "green-sea-turtle",
        "caribbean-reef-squid",
        "donkey-dung-sea-cucumber",
        "long-spined-urchin",
        "queen-parrotfish",
      ],
    },
  },
  // Denominator row: Sandy's Plateau (Boka di Sorsaka)
  {
    slug: "sandys-plateau-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/sandys-plateau/",
      "https://www.oceanencounters.com/excursions/curacao-dive-sites/",
    ],
    briefing: {
      name: "Sandy's Plateau (Boka di Sorsaka)",
      locationName: "Jan Thiel, Curaçao",
      forecastLatitude: 12.0789,
      forecastLongitude: -68.8866,
      description:
        "A wide, shallow plateau that ends at a wall of gorgonians and hard coral, east of the Jan Thiel salt pans inlet. Spiny lobster shelter under the overhangs, and crabs sit inside the barrel sponges.",
      marineLife: "Spiny lobster · crabs · gorgonians · barrel sponges",
      marineLifeDescription: "Lobster under the overhangs and crabs in the sponges.",
      difficultyLevel: "intermediate",
      depthMinMeters: 5,
      maxDepthMeters: 18,
      currentNote:
        "Boat only. The wall past the plateau falls beyond the plan's floor. Tow an inflated surface marker.",
      divePlan:
        "Work the wide plateau to the edge of the wall at 18 m, look under the overhangs, and turn there.",
      fitTone: "welcoming",
      fitNote: "A wide shallow plateau ending at a wall. Turn at its edge.",
      // Sources describe a shallow terrace or slope that is run as an Open Water dive; the plan holds an
      // 18 m floor and anything deeper lies beyond it.
      creatureSlugs: [
        "spiny-lobster",
        "giant-barrel-sponge",
        "encrusting-gorgonian",
        "common-sea-fan",
      ],
    },
  },
  // Denominator row: Cornelius Bay
  {
    slug: "cornelius-bay-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/cornelius-bay/",
      "https://www.oceanencounters.com/excursions/curacao-dive-sites/",
      "https://www.padi.com/dive-site/curacao/cornelius-bay/",
    ],
    briefing: {
      name: "Cornelius Bay",
      locationName: "Bapor Kibra, Curaçao",
      forecastLatitude: 12.0838,
      forecastLongitude: -68.8929,
      description:
        "An undeveloped bay next to the Curaçao Sea Aquarium Park. The sea floor drops to a sloping wall of coral within a hundred meters of shore, with large colonies of elkhorn and other threatened corals and many gorgonians.",
      marineLife: "Elkhorn coral · seahorses · lobsters · gorgonians",
      marineLifeDescription:
        "Big coral colonies, and seahorses among the gorgonians along the wall.",
      difficultyLevel: "intermediate",
      depthMinMeters: 5,
      maxDepthMeters: 18,
      currentNote: "Boat only, and boats work this coast. Tow an inflated surface marker.",
      divePlan:
        "Follow the slope of the wall down from the elkhorn colonies to 18 m, and turn there.",
      fitTone: "welcoming",
      fitNote: "A sloping wall within a hundred meters of shore. Turn at 18 m.",
      // Sources describe a shallow terrace or slope that is run as an Open Water dive; the plan holds an
      // 18 m floor and anything deeper lies beyond it.
      creatureSlugs: ["elkhorn-coral", "longsnout-seahorse", "spiny-lobster", "common-sea-fan"],
    },
  },
  // Denominator row: Paradise
  {
    slug: "paradise-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/paradise/",
      "https://www.gowestdiving.com/diving-curacao/dive-sites/",
      "https://www.divers-guide.com/en/paradise",
    ],
    briefing: {
      name: "Paradise",
      locationName: "Westpunt, Curaçao",
      forecastLatitude: 12.3348,
      forecastLongitude: -69.1545,
      description:
        "Big hard coral colonies and colorful sponges between Kleine Knip and Playa Jeremi, with barracuda, green morays and lobster. A small cave along the shoreline is an overhead space and not part of this plan.",
      marineLife: "Barracuda · green morays · lobster · hard coral",
      marineLifeDescription:
        "Barracuda over the coral, with morays and lobster among the colonies.",
      difficultyLevel: "intermediate",
      depthMinMeters: 5,
      maxDepthMeters: 18,
      currentNote:
        "Boat only. The shoreline cave is an overhead space, so leave it alone. Tow an inflated surface marker.",
      divePlan:
        "Follow the reef along the coral colonies at 5–18 m and turn at 18 m. Stay out of the shoreline cave.",
      fitTone: "welcoming",
      fitNote: "Hard coral and sponges on a shallow reef, and a cave you do not enter.",
      // Sources describe a shallow terrace or slope that is run as an Open Water dive; the plan holds an
      // 18 m floor and anything deeper lies beyond it.
      creatureSlugs: [
        "great-barracuda",
        "green-moray",
        "spiny-lobster",
        "boulder-star-coral",
        "orange-elephant-ear-sponge",
      ],
    },
  },
  // Denominator row: Kortape
  {
    slug: "kortape-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/kortape/",
      "https://www.gowestdiving.com/diving-curacao/dive-sites/",
      "https://www.divers-guide.com/en/korta-pe",
    ],
    briefing: {
      name: "Kortape",
      locationName: "Westpunt, Curaçao",
      forecastLatitude: 12.3614,
      forecastLongitude: -69.1576,
      description:
        "A rarely visited reef beside a resort, about 30 ft above a plateau at roughly 15 m, with healthy hard and soft coral and plenty of sponges. Gently sloping.",
      marineLife: "Sponges · hard coral · soft coral · turtles",
      marineLifeDescription: "Sponges, hard and soft coral on the slope.",
      difficultyLevel: "advanced",
      depthMinMeters: 9,
      maxDepthMeters: 18,
      currentNote:
        "Often a strong current toward Playa Piskado, so a boat dive is the better choice. From shore, do not enter if it is running. Tow an inflated surface marker.",
      divePlan:
        "Enter at the shore, work the reef toward the plateau at 15 m against the current, and turn at 18 m with the current behind you.",
      fitTone: "demanding",
      fitNote:
        "A quiet reef with a strong current toward Playa Piskado. Take the boat, or skip it when the water is running.",
      // Operators run the gentle reef as an Open Water dive, but the often strong current makes the gate Advanced Open
      // Water, with an 18 m floor.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "orange-elephant-ear-sponge",
        "giant-barrel-sponge",
        "green-sea-turtle",
        "common-sea-fan",
      ],
    },
  },
  // Denominator row: Piscadera Playa Largu (Long Beach)
  {
    slug: "long-beach-piscadera-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/long-beach/",
      "https://www.divers-guide.com/en/piscadera",
    ],
    briefing: {
      name: "Piscadera Long Beach",
      locationName: "Piscadera, Curaçao",
      forecastLatitude: 12.1242,
      forecastLongitude: -68.9717,
      description:
        "A shallow plateau at the mouth of Piscadera Bay with ridges and sand channels. The reef wall begins at 6 m, with steep sections and big overhangs, and runs to 40 m, far past the plan's floor. Barracuda hunt along it.",
      marineLife: "Barracuda · sea fans · stony coral",
      marineLifeDescription:
        "Barracuda along the wall, with sea fans and stony coral on the plateau.",
      difficultyLevel: "intermediate",
      depthMinMeters: 6,
      maxDepthMeters: 40,
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      currentNote:
        "Best by boat, with boats nearby. The wall to 40 m is the hazard on this dive, well past the plan's floor. Tow an inflated surface marker.",
      divePlan:
        "Work the plateau and the top of the wall at 6–18 m and turn at 18 m. Never follow the wall below it.",
      fitTone: "demanding",
      fitNote:
        "A shallow plateau at the lip of a 40 m wall, with boats nearby. The plan's floor is 18 m; keep the gauge in view.",
      // The wall runs from 6 m to 40 m beside the diver, so maxDepthMeters is 40 and the gate is Advanced Open Water
      // with the Deep specialty (above 30 m), as at Diver's Leap. The plan holds an 18 m floor and anything deeper lies beyond it.
      creatureSlugs: ["great-barracuda", "common-sea-fan", "boulder-star-coral", "blue-tang"],
    },
  },
  // Denominator row: Boka Sami
  {
    slug: "boca-sami-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/boca-sami/",
      "https://www.divers-guide.com/en/boca-sami",
    ],
    briefing: {
      name: "Boka Sami",
      locationName: "Sint Michiel, Curaçao",
      forecastLatitude: 12.1466,
      forecastLongitude: -68.9997,
      description:
        "A shore dive across a large shallow bay to a 45-degree drop-off, with a buoy outside the bay to find your way back. Coral thins in front of the bay and thickens to near-full cover after fifteen minutes to the right.",
      marineLife: "Hard coral · sponges · turtles",
      marineLifeDescription: "Healthy coral and sponge along the slope.",
      difficultyLevel: "intermediate",
      depthMinMeters: 5,
      maxDepthMeters: 18,
      currentNote:
        "A long swim over the shallow bay, with tankers mooring outside it. Tow an inflated surface marker.",
      divePlan:
        "Swim across the bay to the drop-off, follow the slope to 18 m, and use the buoy outside the bay to find the way back.",
      fitTone: "unknown",
      fitNote:
        "Check conditions with the guide before entering. A long swim over a shallow bay with tankers mooring outside it. The buoy is your landmark.",
      // Sources describe a shallow terrace or slope that is run as an Open Water dive; the plan holds an
      // 18 m floor and anything deeper lies beyond it.
      creatureSlugs: [
        "boulder-star-coral",
        "orange-elephant-ear-sponge",
        "green-sea-turtle",
        "spotted-eagle-ray",
      ],
    },
  },
  // Denominator row: Kokomo Beach (Vaersenbaai)
  {
    slug: "kokomo-beach-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/kokomo-beach/",
      "https://www.padi.com/dive-site/curacao/vaersenbaai-kokomo-beach/",
    ],
    briefing: {
      name: "Kokomo Beach",
      locationName: "Vaersenbaai, Curaçao",
      forecastLatitude: 12.1608,
      forecastLongitude: -69.0054,
      description:
        "A shore dive with entry points marked by buoys, over shallow coral gardens and a submerged pontoon barge, with deeper reef beyond. The site runs to 36 m. The sources give no depth for the barge or the deeper reef, and the Vaersenbaai car wrecks lie east of it at 20 m and deeper.",
      marineLife: "Parrotfish · angelfish · nudibranchs · turtles",
      marineLifeDescription: "Coral outcrops on sand, and turtles and rays on the deeper reef.",
      difficultyLevel: "intermediate",
      depthMinMeters: 5,
      maxDepthMeters: 36,
      currentNote:
        "Boats work this coast. Tow an inflated surface marker. Deeper reef lies beyond the plan's floor.",
      divePlan:
        "Enter at the buoys, work the shallow coral gardens, and turn at 18 m. Leave the barge and the deeper reef to a guide who knows their depth.",
      fitTone: "demanding",
      fitNote:
        "Shallow gardens beside deeper reef and a barge of unknown depth. Hold the 18 m turn.",
      // The listing gives 10–36 m and an Open Water minimum, but no depth for the pontoon barge or the deeper reef, and
      // Vaersenbaai's wrecks lie at 20–50 m beside it. The listing's 36 m is the range, so the gate is Advanced Open Water plus Deep; the plan holds an 18 m floor.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "queen-parrotfish",
        "queen-angelfish",
        "green-sea-turtle",
        "spotted-eagle-ray",
        "common-sea-fan",
      ],
    },
  },
  // Denominator row: Rif Sint Marie
  {
    slug: "rif-sint-marie-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/rif-sint-marie/",
      "https://www.divecentercuracao.com/en/coraldivers/divesitescuracao",
      "https://www.divers-guide.com/en/rif-marie",
    ],
    briefing: {
      name: "Rif Sint Marie",
      locationName: "Coral Estate, Curaçao",
      forecastLatitude: 12.1982,
      forecastLongitude: -69.0795,
      description:
        "A resort house reef reached from the pier. Coral heads with parrotfish, puffers, trumpetfish, barracuda and turtles.",
      marineLife: "Parrotfish · puffers · trumpetfish · barracuda · turtles",
      marineLifeDescription:
        "Fish moving around the coral heads, with deep-water visitors now and then.",
      difficultyLevel: "intermediate",
      depthMinMeters: 5,
      maxDepthMeters: 18,
      currentNote: "The entry is from a pier. Tow an inflated surface marker.",
      divePlan:
        "Enter at the pier, work the coral heads at 5–18 m, and return along the same line.",
      fitTone: "welcoming",
      fitNote: "A pier entry onto coral heads with a good mix of fish.",
      // Sources describe a shallow terrace or slope that is run as an Open Water dive; the plan holds an
      // 18 m floor and anything deeper lies beyond it.
      // Access: the pier is used after a check-in with the shop.
      creatureSlugs: [
        "queen-parrotfish",
        "bandtail-puffer",
        "trumpetfish",
        "great-barracuda",
        "green-sea-turtle",
      ],
    },
  },
  // Denominator row: Daaibooi
  {
    slug: "daaibooi-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/daaibooi/",
      "https://www.zentacle.com/Beach/287/daaibooi",
    ],
    briefing: {
      name: "Daaibooi",
      locationName: "Sint Willibrordus, Curaçao",
      forecastLatitude: 12.212,
      forecastLongitude: -69.0858,
      description:
        "A shore dive from a secluded beach, across a large sandy plateau. The drop-off is a long swim out, ten minutes or more, and rewards it with soft coral, elephant-ear sponges and brain coral.",
      marineLife: "Soft coral · elephant-ear sponges · brain coral",
      marineLifeDescription: "Healthy coral and sponge beyond the plateau.",
      difficultyLevel: "intermediate",
      depthMinMeters: 5,
      maxDepthMeters: 18,
      currentNote:
        "A long surface swim to the drop-off, so watch the current on the way. Tow an inflated surface marker.",
      divePlan:
        "Cross the sandy plateau to the drop-off, work its edge to 18 m, and turn with gas for the swim back.",
      fitTone: "unknown",
      fitNote:
        "Check conditions with the guide before entering. A ten-minute swim out to the drop-off, so the surface swim is part of the dive.",
      // Sources describe a shallow terrace or slope that is run as an Open Water dive; the plan holds an
      // 18 m floor and anything deeper lies beyond it.
      creatureSlugs: ["orange-elephant-ear-sponge", "knobby-brain-coral", "common-sea-fan"],
    },
  },
  // Denominator row: Porto Marie (The Valley)
  {
    slug: "porto-mari-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/porto-mari/",
      "https://www.padi.com/dive-site/curacao/porto-mari/",
      "https://www.divers-guide.com/en/porto-marie",
    ],
    briefing: {
      name: "Porto Marie (The Valley)",
      locationName: "Porto Mari, Curaçao",
      forecastLatitude: 12.2183,
      forecastLongitude: -69.0867,
      description:
        "A double reef off a sandy beach, with a sandy valley between. A gentle slope from about 9 m near the buoy reaches the first reef at about 15 m, then sand, then the second reef from about 18 m. Little current and wave action.",
      marineLife: "Blue tang · trunkfish · cornetfish · eagle rays",
      marineLifeDescription:
        "Blue tangs and trunkfish in the shallows, and eagle rays over the valley floor.",
      difficultyLevel: "intermediate",
      depthMinMeters: 9,
      maxDepthMeters: 18,
      currentNote: "Little current. Tow an inflated surface marker.",
      divePlan:
        "Down the gentle slope from the buoy to the first reef at about 15 m, cross the sand, and turn at the second reef from 18 m.",
      fitTone: "welcoming",
      fitNote: "A double reef with a sandy valley and little current.",
      // Sources describe a shallow terrace or slope that is run as an Open Water dive; the plan holds an
      // 18 m floor and anything deeper lies beyond it.
      creatureSlugs: [
        "blue-tang",
        "smooth-trunkfish",
        "spotted-eagle-ray",
        "creole-wrasse",
        "nurse-shark",
        "yellowtail-snapper",
      ],
    },
  },
  // Denominator row: Cas Abou (Kas Abou, Lower House)
  {
    slug: "cas-abou-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/cas-abao-beach/",
      "https://www.padi.com/dive-site/curacao/cas-abou/",
      "https://www.gowestdiving.com/diving-curacao/shore-diving-curacao/",
    ],
    briefing: {
      name: "Cas Abou",
      locationName: "Cas Abao, Curaçao",
      forecastLatitude: 12.2277,
      forecastLongitude: -69.093,
      description:
        "A shore dive from a large white-sand beach onto a fringing reef a few fin kicks out. Eagle rays, stingrays, turtles, morays, seahorses and frogfish.",
      marineLife: "Eagle rays · stingrays · turtles · morays · seahorses",
      marineLifeDescription:
        "A fringing reef with rays and turtles over it, and small animals in it.",
      difficultyLevel: "intermediate",
      depthMinMeters: 5,
      maxDepthMeters: 18,
      currentNote: "Tow an inflated surface marker.",
      divePlan: "Enter from the beach, work the fringing reef at 5–18 m, and turn at 18 m.",
      fitTone: "welcoming",
      fitNote: "A white-sand beach with a reef a few fin kicks out and plenty of small life.",
      // Sources describe a shallow terrace or slope that is run as an Open Water dive; the plan holds an
      // 18 m floor and anything deeper lies beyond it.
      // Access: the beach has an entrance fee.
      creatureSlugs: [
        "spotted-eagle-ray",
        "southern-stingray",
        "green-sea-turtle",
        "green-moray",
        "longsnout-seahorse",
        "longlure-frogfish",
      ],
    },
  },
  // Denominator row: Playa Largu (San Juan)
  {
    slug: "playa-largu-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/playa-largu/",
      "https://www.padi.com/dive-site/curacao/playa-largu/",
      "https://www.gowestdiving.com/diving-curacao/shore-diving-curacao/",
    ],
    briefing: {
      name: "Playa Largu (San Juan)",
      locationName: "San Juan, Curaçao",
      forecastLatitude: 12.2351,
      forecastLongitude: -69.1005,
      description:
        "A shore dive from a beach of coral rubble. The drop-off is close to shore and steep, about 45 degrees. Coral cover is above 50 percent and sandy beyond 30 m. A rich variety of sponges.",
      marineLife: "Elephant-ear sponges · barrel sponges · rope sponges · soft coral",
      marineLifeDescription: "Sponges of many kinds on the slope and soft coral on the shoulders.",
      difficultyLevel: "intermediate",
      depthMinMeters: 5,
      maxDepthMeters: 30,
      currentNote:
        "Choose your direction by the current. The slope continues past the plan's floor. Tow an inflated surface marker.",
      divePlan: "Enter over the coral rubble, follow the steep slope to 18 m, and turn there.",
      fitTone: "unknown",
      fitNote:
        "Check conditions with the guide before entering. A steep slope close to the shore, with a rubble entry.",
      // Sources describe a shallow terrace or slope that is run as an Open Water dive; the plan holds an
      // 18 m floor and anything deeper lies beyond it.
      // Access: the site is open Thursday to Sunday only.
      creatureSlugs: [
        "orange-elephant-ear-sponge",
        "giant-barrel-sponge",
        "red-rope-sponge",
        "branching-vase-sponge",
      ],
    },
  },
  // Denominator row: Playa Lagun
  {
    slug: "playa-lagun-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/playa-lagun/",
      "https://www.padi.com/dive-site/curacao/playa-lagun/",
    ],
    briefing: {
      name: "Playa Lagun",
      locationName: "Lagun, Curaçao",
      forecastLatitude: 12.3181,
      forecastLongitude: -69.1517,
      description:
        "A small bay between steep cliffs with a long, narrow, shallow channel full of reef fish. Turtles are common. Calm water and good visibility make it a good first dive on the northwest coast.",
      marineLife: "Turtles · moray eels · parrotfish",
      marineLifeDescription: "Fish in the shallow channel and turtles through it.",
      difficultyLevel: "intermediate",
      depthMinMeters: 5,
      maxDepthMeters: 18,
      currentNote: "Calm in the bay. Tow an inflated surface marker.",
      divePlan: "Enter in the bay, follow the channel out, and turn at 18 m.",
      fitTone: "welcoming",
      fitNote: "A calm cliff-sheltered bay and a first dive on the northwest coast.",
      // Sources describe a shallow terrace or slope that is run as an Open Water dive; the plan holds an
      // 18 m floor and anything deeper lies beyond it.
      creatureSlugs: ["green-sea-turtle", "green-moray", "queen-parrotfish", "french-grunt"],
    },
  },
  // Denominator row: Playa Jeremi
  {
    slug: "playa-jeremi-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/playa-jeremi/",
      "https://www.divers-guide.com/en/playa-jeremi",
      "https://www.gowestdiving.com/diving-curacao/shore-diving-curacao/",
    ],
    briefing: {
      name: "Playa Jeremi",
      locationName: "Lagun, Curaçao",
      forecastLatitude: 12.3292,
      forecastLongitude: -69.1512,
      description:
        "A small cove reached by uneven steps cut into the rock. A reef wall with large stony corals, a shallow area where squid hold, yellowhead jawfish on the sand, and rays and cornetfish further out.",
      marineLife: "Squid · yellowhead jawfish · rays · cornetfish",
      marineLifeDescription: "Squid in the shallows and jawfish on the sand.",
      difficultyLevel: "intermediate",
      depthMinMeters: 5,
      maxDepthMeters: 18,
      currentNote: "Steps to the water are uneven. Tow an inflated surface marker.",
      divePlan: "Go down the rock steps, work the reef wall, and turn at 18 m.",
      fitTone: "welcoming",
      fitNote: "A small cove with uneven steps to the water. Take care going in and out.",
      // Sources describe a shallow terrace or slope that is run as an Open Water dive; the plan holds an
      // 18 m floor and anything deeper lies beyond it.
      creatureSlugs: [
        "caribbean-reef-squid",
        "yellowhead-jawfish",
        "southern-stingray",
        "boulder-star-coral",
      ],
    },
  },
  // Denominator row: Kleine Knip (Playa Kenepa Chikitu)
  {
    slug: "kleine-knip-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/playa-kenepa-chikitu/",
      "https://www.divers-guide.com/en/kenepa-kleine-knip",
      "https://www.gowestdiving.com/diving-curacao/shore-diving-curacao/",
    ],
    briefing: {
      name: "Kleine Knip (Playa Kenepa Chikitu)",
      locationName: "Westpunt, Curaçao",
      forecastLatitude: 12.3413,
      forecastLongitude: -69.153,
      description:
        "A shore dive from a small, popular beach, heading for the drop-off along the cliffs. Gorgonians, orange cup coral and schools of fingerlings.",
      marineLife: "Gorgonians · orange cup coral · fingerlings · turtles",
      marineLifeDescription: "Gorgonians and cup coral, with turtles and squid.",
      difficultyLevel: "intermediate",
      depthMinMeters: 5,
      maxDepthMeters: 18,
      currentNote: "Tow an inflated surface marker.",
      divePlan: "Enter from the beach, follow the drop-off along the cliffs, and turn at 18 m.",
      fitTone: "welcoming",
      fitNote: "A small popular beach with a drop-off along the cliffs.",
      // Sources describe a shallow terrace or slope that is run as an Open Water dive; the plan holds an
      // 18 m floor and anything deeper lies beyond it.
      creatureSlugs: [
        "encrusting-gorgonian",
        "orange-cup-coral",
        "green-sea-turtle",
        "caribbean-reef-squid",
      ],
    },
  },
  // Denominator row: Playa Hundu
  {
    slug: "playa-hundu-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/playa-hundu/",
      "https://www.divers-guide.com/en/playa-hundu",
    ],
    briefing: {
      name: "Playa Hundu",
      locationName: "Soto, Curaçao",
      forecastLatitude: 12.2598,
      forecastLongitude: -69.1203,
      description:
        "A shore dive east of Santa Martha Bay. Head out at 240 degrees to a drop-off close to shore, with a reef slope of about 45 degrees. Sandy valleys give easy landmarks. Large gorgonians, stovepipe and elephant-ear sponges.",
      marineLife: "Gorgonians · stovepipe sponges · elephant-ear sponges",
      marineLifeDescription: "Sponge and gorgonian groups mark the entry point.",
      difficultyLevel: "advanced",
      depthMinMeters: 5,
      maxDepthMeters: 18,
      currentNote:
        "A remote site with no facilities. Sources report limited to strong current, and rocks and the odd wave at the entry. Tow an inflated surface marker.",
      divePlan:
        "Head out at 240 degrees to the drop-off, follow the slope to 18 m, and return on the same bearing.",
      fitTone: "demanding",
      fitNote:
        "A remote shore dive with no facilities and rocks at the entry. Tell someone where you are diving.",
      // Divers' Guide rates the site for experienced divers and reports up to strong current, while the Dive Travel
      // page lists Open Water as the minimum. The gate takes the stricter reading, with an 18 m floor.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "encrusting-gorgonian",
        "stovepipe-sponge",
        "orange-elephant-ear-sponge",
        "pillar-coral",
      ],
    },
  },
  // Denominator row: Playa Piskadó (Playa Grandi, Neptune's Reef)
  {
    slug: "playa-piskado-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.gowestdiving.com/diving-curacao/shore-diving-curacao/",
      "https://www.divecuracao.info/dive/curacao-diving-guide/playa-piskado/",
      "https://www.divers-guide.com/en/playa-piscado",
    ],
    briefing: {
      name: "Playa Piskadó (Playa Grandi)",
      locationName: "Westpunt, Curaçao",
      forecastLatitude: 12.3694,
      forecastLongitude: -69.1545,
      description:
        "A fishermen's beach where turtles gather for the fish scraps, with a King Neptune statue at about 9 m at the top of the drop-off. The turtles are used to being fed, so keep your distance. Mostly hard coral.",
      marineLife: "Green turtles · hard coral",
      marineLifeDescription:
        "Turtles are guaranteed in the shallows. Give them room and do not feed them.",
      difficultyLevel: "intermediate",
      depthMinMeters: 5,
      maxDepthMeters: 18,
      currentNote:
        "Fishermen use the beach and the current is variable, so tow an inflated surface marker. Do not touch, feed or chase the turtles.",
      divePlan:
        "Enter from the beach, follow the drop-off past the statue at about 9 m, and turn at 18 m.",
      fitTone: "welcoming",
      fitNote:
        "A fishermen's beach with turtles that are used to people. Watch, and keep your distance.",
      // Sources describe a shallow terrace or slope that is run as an Open Water dive; the plan holds an
      // 18 m floor and anything deeper lies beyond it.
      creatureSlugs: ["green-sea-turtle", "boulder-star-coral", "queen-parrotfish"],
    },
  },
  // Denominator row: Blue Bay: The Garden
  {
    slug: "blue-bay-garden-curacao",
    version: 1,
    area: "curacao",
    sources: [
      "https://www.divecuracao.info/dive/curacao-diving-guide/blue-bay-garden/",
      "https://www.divers-guide.com/en/blue-bay-house-reef",
      "https://bluebay-curacao.com/activities/diving",
    ],
    briefing: {
      name: "Blue Bay: The Garden",
      locationName: "Blue Bay, Curaçao",
      forecastLatitude: 12.1329,
      forecastLongitude: -68.9852,
      description:
        "A house reef a few fin kicks from Blue Bay Beach, over coral gardens with turtles and barracuda.",
      marineLife: "Turtles · barracuda · reef fish",
      marineLifeDescription: "Coral gardens close to the beach.",
      difficultyLevel: "intermediate",
      depthMinMeters: 5,
      maxDepthMeters: 18,
      currentNote: "Tow an inflated surface marker.",
      divePlan:
        "Enter from the beach and work the coral gardens at 5–18 m, then return along the same line.",
      fitTone: "welcoming",
      fitNote: "A short swim to coral gardens in a sheltered bay.",
      // Sources describe a shallow terrace or slope that is run as an Open Water dive; the plan holds an
      // 18 m floor and anything deeper lies beyond it.
      // Access: the beach shop checks divers in.
      creatureSlugs: ["green-sea-turtle", "great-barracuda", "queen-parrotfish", "common-sea-fan"],
    },
  },
];
