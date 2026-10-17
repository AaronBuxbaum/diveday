// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Turneffe, Lighthouse Reef and Glover's Reef atolls. */
export const BELIZE_ATOLLS: DiveSiteTemplate[] = [
  // Denominator row: Great Blue Hole (Blue Hole)
  {
    slug: "great-blue-hole",
    version: 1,
    area: "belize-atolls",
    sources: [
      "https://splashbelize.com/scuba-diving-sites/lighthouse-atoll-and-the-great-blue-hole/",
      "https://www.blackbirdresort.com/scuba-diving/day-trips",
      "https://www.tflats.com/belize-diving/favorite-dive-sites",
      "https://theplacencia.com/scuba-snorkel",
    ],
    briefing: {
      name: "Great Blue Hole",
      locationName: "Lighthouse Reef Atoll, Belize",
      // OpenStreetMap 17.3160, -87.5347 and Wikipedia 17.3153, -87.5344 agree within 100 m.
      forecastLatitude: 17.316,
      forecastLongitude: -87.5347,
      description:
        "A round sinkhole about 300 m across in the middle of Lighthouse Reef, where a collapsed cave roof left a sheer-sided blue pit well over 120 m deep. The dive follows the wall and rim of the hole down to 40 m (130 ft).",
      marineLife: "Blacktip sharks · groupers · snappers · horse-eye jacks",
      marineLifeDescription:
        "Groupers, snappers and jacks swim up to inspect divers near the top of the wall. Blacktip sharks patrol the deeper water.",
      conservationNote: "Protected as a Natural Monument, within the World Heritage reef system.",
      difficultyLevel: "advanced",
      depthMinMeters: 5,
      maxDepthMeters: 40,
      currentNote:
        "Current not documented; ask the crew on the day, and carry an SMB. Operators report a thermocline somewhere between 15 and 27 m (50 to 90 ft).",
      divePlan:
        "Staff confirm the diver’s log (30 or more dives, recent deep dives) before boarding. Down the open wall, no deeper than 40 m (130 ft). The crew briefs the ledge depth; the ledge that begins near 33 m is an overhead, so stay out from under it. The no-stop time on air at 40 m is short, and the plan’s bottom time is about eight minutes. Then up the wall to the rim for the safety stop.",
      fitTone: "demanding",
      fitNote:
        "Deep, short and far from help. The boat ride to the atoll runs from about an hour out of Turneffe to nearly four hours out of Placencia, and medical care is at least that far away; confirm the boat’s oxygen and plan. One operator takes only Advanced divers with 30 or more dives, and good buoyancy matters for the stop.",
      // 40 m is the plan's limit, so Advanced Open Water with the Deep specialty. The stalactites
      // hang from a ledge that starts near 33 m (110 to 120 ft in the sources): the plan stays outside
      // it and does not offer it as a draw. The hole lies well past 120 m; the dive does not.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: ["blacktip-shark", "black-grouper", "gray-snapper", "horse-eye-jack"],
    },
  },
  // Denominator row: Half Moon Caye Wall (Half Moon Wall)
  {
    slug: "half-moon-caye-wall",
    version: 1,
    area: "belize-atolls",
    sources: [
      "https://splashbelize.com/scuba-diving-sites/lighthouse-atoll-and-the-great-blue-hole/",
      "https://theplacencia.com/scuba-snorkel",
      "https://www.hamanasi.com/belize/tours/diving/best-dive-sites-in-belize-youve-never-heard-of/",
    ],
    briefing: {
      name: "Half Moon Caye Wall",
      locationName: "Half Moon Caye Natural Monument, Lighthouse Reef Atoll",
      // Approximate pin: Half Moon Caye (OpenStreetMap 17.2054, -87.5364). The sources put the wall
      // off the caye without a bearing, so the pin is an assumption: in the water 0.0042 degrees
      // (about 465 m) south of that point, off the caye's south side. Good to about 2 km.
      forecastLatitude: 17.2012,
      forecastLongitude: -87.535,
      description:
        "One of the best-known walls in Belize, off Half Moon Caye. The top starts shallow, with gullies and overhangs, gorgonians and sponges, and a sandy flat above the reef where garden eels live.",
      marineLife: "Eagle rays · tarpon · garden eels · hogfish",
      marineLifeDescription:
        "Eagle rays, sharks and tarpon pass along the wall, with stingrays and hogfish working the sand above it and a colony of garden eels beyond.",
      conservationNote: "Half Moon Caye is a Natural Monument. Take nothing and touch nothing.",
      difficultyLevel: "advanced",
      depthMinMeters: 6,
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day, and carry an SMB.",
      divePlan:
        "Down to the lip of the wall at 6–9 m, along it no deeper than 30 m (100 ft), then back up onto the top of the reef and the sand flat with reserve gas. The overhangs and swim-throughs are overheads; stay out.",
      fitTone: "demanding",
      fitNote:
        "A wall that does not end at the plan’s floor. For divers who hold their own depth. Medical care is far; confirm the boat’s oxygen and plan.",
      // The wall drops past recreational depth; the 30 m floor is the plan's, so Advanced Open
      // Water without the Deep specialty. The top of the wall at 6–9 m is shallow enough for an
      // Open Water dive if a shop wants to lower this.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["spotted-eagle-ray", "tarpon", "garden-eel", "hogfish", "southern-stingray"],
    },
  },
  // Denominator row: The Elbow (Turneffe Elbow)
  {
    slug: "the-elbow-turneffe",
    version: 1,
    area: "belize-atolls",
    sources: [
      "https://www.tflats.com/belize-diving/favorite-dive-sites",
      "https://splashbelize.com/scuba-diving-sites/turneffe-atoll/",
      "https://www.hamanasi.com/belize/tours/diving/best-dive-sites-in-belize-youve-never-heard-of/",
    ],
    briefing: {
      name: "The Elbow",
      locationName: "Turneffe Atoll, Belize",
      // Approximate pin: all sources put it at Turneffe's southernmost point. OpenStreetMap's mapped
      // reef outline reaches its southern limit at 17.1549, -87.9107, and the Caye Bokel spawning
      // aggregation reserve's point is 17.1506, -87.9104; the pin sits between them.
      forecastLatitude: 17.153,
      forecastLongitude: -87.9105,
      description:
        "A wall at the southern tip of Turneffe, where currents running down both sides of the atoll meet. That is why it draws schools of jacks and snappers, sharks and eagle rays, and the occasional dolphin.",
      marineLife: "Horse-eye jacks · dog snappers · eagle rays · Caribbean reef sharks",
      marineLifeDescription:
        "Big schools gather in the current, with large gorgonians and sponges on the wall. Permit and Atlantic spadefish join the jacks.",
      difficultyLevel: "advanced",
      depthMinMeters: 18,
      maxDepthMeters: 30,
      currentNote:
        "Strong current, about 2 knots out of the north depending on the tide, and the dive is a drift. Most of it is spent in mid-water, and divers can be separated. Every diver carries an SMB and a whistle or air horn.",
      divePlan:
        "Roll in over the top of the wall and drift with the group, no deeper than 30 m (100 ft). The wall keeps dropping below the plan, so the floor is the diver’s to hold. Staff confirm the diver’s log before boarding. If you lose your buddy, search for one minute, then surface.",
      fitTone: "demanding",
      fitNote:
        "A fast, exposed drift in deep water. For confident divers who carry their own signaling gear. Medical care is far; confirm the boat’s oxygen and plan.",
      // The wall crest is 18–30 m and the wall continues deeper; the 30 m floor is the plan's.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "horse-eye-jack",
        "dog-snapper",
        "spotted-eagle-ray",
        "caribbean-reef-shark",
        "atlantic-spadefish",
        "permit-fish",
      ],
    },
  },
  // Denominator row: Long Caye Wall (Glover's Reef)
  {
    slug: "long-caye-wall-glovers-reef",
    version: 1,
    area: "belize-atolls",
    sources: [
      "https://www.hamanasi.com/belize-vacation/glovers-reef/",
      "https://belizescuba.com/diving-snorkeling/glovers-reef/",
      "https://offthewallbelize.com/diving",
    ],
    briefing: {
      name: "Long Caye Wall",
      locationName: "Glover’s Reef Atoll, Belize",
      // Approximate pin: Long Caye at Glover's, whose east shore is mapped near -87.7793 in
      // OpenStreetMap. Belize Scuba says the wall is about 200 m from the caye, and Hamanasi puts the
      // walls on the atoll's east side, so the pin is in the water 200 m east of the shore.
      forecastLatitude: 16.7557,
      forecastLongitude: -87.7775,
      description:
        "A wall off Long Caye on the atoll’s eastern rim, reached over a field of white sand at about 12 m. The coral grows in chunks out of the sand, and channels of sand run down through it into small canyons.",
      marineLife: "Southern stingrays · garden eels · eagle rays · spiny lobsters",
      marineLifeDescription:
        "Stingrays and garden eels live on the sand, with lobsters in the coral and eagle rays gliding past the edge. Mantas are sometimes reported along the wall.",
      conservationNote: "Glover’s Reef is a marine reserve and part of the World Heritage site.",
      difficultyLevel: "advanced",
      depthMinMeters: 12,
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day, and carry an SMB.",
      divePlan:
        "Down the mooring to the sand at about 12 m, across to the crest, along the wall no deeper than 30 m (100 ft), and back up through the sand channels with reserve gas.",
      fitTone: "demanding",
      fitNote:
        "A wall that falls far beyond the plan. Visibility often opens it up, so watch your depth. Medical care is far; confirm the boat’s oxygen and plan.",
      // The wall drops thousands of feet; the 30 m floor is the plan's, so Advanced Open Water
      // without the Deep specialty. The sand at 12 m is a gentle start for a shop to lower this.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["southern-stingray", "garden-eel", "spotted-eagle-ray", "spiny-lobster"],
    },
  },
  // Denominator row: The Aquarium (Long Caye Aquarium, Long Caye Wall)
  {
    slug: "the-aquarium-lighthouse-reef",
    version: 1,
    area: "belize-atolls",
    sources: [
      "https://www.blackbirdresort.com/scuba-diving/day-trips",
      "https://www.tflats.com/belize-diving/favorite-dive-sites",
      "https://theplacencia.com/scuba-snorkel",
      "https://www.hamanasi.com/belize/tours/diving/best-dive-sites-in-belize-youve-never-heard-of/",
    ],
    briefing: {
      name: "The Aquarium, Lighthouse Reef",
      locationName: "Long Caye, Lighthouse Reef Atoll",
      // Approximate pin: the northeast corner of Long Caye at Lighthouse Reef, as Blackbird describes
      // it. The caye's mapped outline in OpenStreetMap peaks at 17.2212, -87.5919 there; the pin
      // sits about 100 m offshore.
      forecastLatitude: 17.2212,
      forecastLongitude: -87.591,
      description:
        "A shallow dive over the reef top and the lip of the wall off Long Caye, named for the crowds of fish. Star-coral heads, orange elephant ear sponges and blue tunicates cover the wall.",
      marineLife: "Schoolmaster snappers · creole wrasse · queen angelfish · banded butterflyfish",
      marineLifeDescription:
        "Schoolmasters and creole wrasse fill the water over the coral, and decorator and neck crabs cling to the sea fans.",
      difficultyLevel: "intermediate",
      maxDepthMeters: 15,
      currentNote: "Current not documented; ask the crew on the day, and carry an SMB.",
      divePlan:
        "Stay on the reef top and the edge of the wall, no deeper than 15 m (50 ft). The wall falls away below that and is not part of the plan.",
      fitTone: "welcoming",
      fitNote:
        "Shallow and bright, and often the last dive of the day after Half Moon Caye. Medical care is far; confirm the boat’s oxygen and plan.",
      creatureSlugs: [
        "schoolmaster-snapper",
        "creole-wrasse",
        "queen-angelfish",
        "banded-butterflyfish",
        "orange-elephant-ear-sponge",
      ],
    },
  },
  // Denominator row: The Wit (Witconcrete Wreck)
  {
    slug: "witconcrete-wreck",
    version: 1,
    area: "belize-atolls",
    sources: [
      "https://www.blackbirdresort.com/scuba-diving/day-trips",
      "https://ramons.com/scuba-trips/",
    ],
    briefing: {
      name: "Witconcrete Wreck",
      locationName: "Turneffe Atoll, Belize",
      // Approximate pin: Blackbird Caye (OpenStreetMap 17.3655, -87.8094, the middle of a long caye)
      // plus 0.75 mile northeast, as the resort places the wreck: 850 m north and 850 m east.
      // Treat the pin as good to a kilometre or two.
      forecastLatitude: 17.3732,
      forecastLongitude: -87.8014,
      description:
        "A former sugar carrier sunk as an artificial reef at Turneffe, in the Soldier Caye reserve. Coral has grown over the hull.",
      marineLife: "Snappers · groupers · sponges · corals",
      marineLifeDescription:
        "Coral growth covers the hull, and reef fish shelter around the steel.",
      difficultyLevel: "advanced",
      // Ramon's gives 80 ft (24 m); Blackbird's quick facts say 60 ft. The deeper figure is kept.
      maxDepthMeters: 24,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Dive around the outside of the hull. Stay outside the hull. Medical care is far; confirm the boat’s oxygen and plan.",
      fitTone: "demanding",
      fitNote: "Deeper than the Open Water limit. Watch your no-decompression time at 24 m.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "schoolmaster-snapper",
        "black-grouper",
        "common-sea-fan",
        "boulder-star-coral",
      ],
    },
  },
  // Denominator row: The Pinnacles (Pinnacle)
  {
    slug: "the-pinnacles-glovers-reef",
    version: 1,
    area: "belize-atolls",
    sources: [
      "https://chabilmarvillas.com/?p=359",
      "https://splashbelize.com/scuba-diving-sites/glovers-reef/",
      "https://belizescuba.com/diving-snorkeling/glovers-reef/",
      "https://belizedivehaven.com/top-5-dive-sites-on-glovers-reef/",
    ],
    briefing: {
      name: "The Pinnacles",
      locationName: "Glover’s Reef Atoll, Belize",
      // Approximate pin: Chabil Mar places the site in the southwest corner of the atoll. Southwest
      // Caye is at 16.7163, -87.8474 (OpenStreetMap); the pin sits about 1 km southwest of it in the
      // water, clear of the Manta Wall pin. Good to a kilometre or two. Depths: Chabil Mar and
      // Belize Dive Haven give 25–100 ft; Splash and Belize Scuba say the pinnacles rise from 100 ft.
      forecastLatitude: 16.71,
      forecastLongitude: -87.856,
      description:
        "A field of tall coral pinnacles standing on the sand at the southwest corner of the atoll. They are crowded with sponges, plate corals and gorgonians, and sand channels run between them.",
      marineLife: "Schoolmaster snappers · hog snappers · reef sharks · barracuda · tarpon",
      marineLifeDescription:
        "Hog snappers and schoolmasters hold in the sand channels. Reef sharks, tarpon and barracuda pass through now and then.",
      conservationNote: "Glover’s Reef is a marine reserve and part of the World Heritage site.",
      difficultyLevel: "advanced",
      depthMinMeters: 8,
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day, and carry an SMB.",
      divePlan:
        "Swim around the pinnacles from the tops at about 8 m (25 ft), no deeper than 30 m (100 ft) at their feet. Do not swim through the pinnacles, and finish on the shallow tops with reserve gas.",
      fitTone: "demanding",
      fitNote:
        "The bases stand at the limit of the plan. Divers who watch their depth gauge and their gas enjoy it most. Medical care is far; confirm the boat’s oxygen and plan.",
      // The pinnacles rise from about 100 ft (30 m); operators rate it intermediate, but the floor
      // is 30 m so it is gated at Advanced Open Water. Hamanasi runs it only in good visibility.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "schoolmaster-snapper",
        "caribbean-reef-shark",
        "great-barracuda",
        "tarpon",
        "common-sea-fan",
      ],
    },
  },
  // Denominator row: The Aquarium (Glover's Reef)
  {
    slug: "the-aquarium-glovers-reef",
    version: 1,
    area: "belize-atolls",
    sources: [
      "https://chabilmarvillas.com/?p=359",
      "https://splashbelize.com/scuba-diving-sites/glovers-reef/",
      "https://belizedivehaven.com/top-5-dive-sites-on-glovers-reef/",
      "https://www.steveroper.ca/glovers-atoll-draft/",
    ],
    briefing: {
      name: "The Aquarium, Glover’s Reef",
      locationName: "Middle Caye, Glover’s Reef Atoll",
      // Approximate pin: Chabil Mar places it east of Middle Caye (OpenStreetMap 16.7400, -87.8120);
      // the pin sits about 850 m east of the caye. Depth: Chabil Mar, Belize Dive Haven and Steve
      // Roper give 30–100 ft; Slickrock says about 80 ft. The deeper figure is kept.
      forecastLatitude: 16.74,
      forecastLongitude: -87.804,
      description:
        "A wall dive east of Middle Caye in very clear water, named for the schools that fill it. Yellowtail snappers and creole wrasse gather around the cleaning stations, and jacks and durgons hang along the edge of the wall.",
      marineLife: "Yellowtail snappers · creole wrasse · horse-eye jacks · black durgons",
      marineLifeDescription:
        "Big schools gather early in the morning and late in the afternoon, which operators call the best times. Dolphins and turtles are sometimes reported.",
      conservationNote: "Glover’s Reef is a marine reserve and part of the World Heritage site.",
      difficultyLevel: "advanced",
      depthMinMeters: 10,
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day, and carry an SMB.",
      divePlan:
        "Down to the reef top and along the lip of the wall, no deeper than 30 m (100 ft), then back up the reef with reserve gas. The wall falls away below the plan.",
      fitTone: "demanding",
      fitNote:
        "The wall continues past the plan’s floor, so the edge is easy to follow down. Decide your depth before you roll in. Medical care is far; confirm the boat’s oxygen and plan.",
      // Operators rate it intermediate, but the plan reaches 30 m along a wall that drops beyond
      // it, so it is gated at Advanced Open Water.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "yellowtail-snapper",
        "creole-wrasse",
        "horse-eye-jack",
        "black-durgon",
        "bottlenose-dolphin",
        "green-sea-turtle",
      ],
    },
  },
  // Denominator row: Manta Wall
  {
    slug: "manta-wall-glovers-reef",
    version: 1,
    area: "belize-atolls",
    sources: [
      "https://chabilmarvillas.com/?p=359",
      "https://splashbelize.com/scuba-diving-sites/glovers-reef/",
      "https://belizedivehaven.com/top-5-dive-sites-on-glovers-reef/",
      "https://belizescuba.com/diving-snorkeling/glovers-reef/",
    ],
    briefing: {
      name: "Manta Wall",
      locationName: "Southwest Caye, Glover’s Reef Atoll",
      // Approximate pin: Chabil Mar puts it south of Southwest Caye, and Belize Dive Haven and Splash
      // say it is named for the nearby island resort, which ourbelizevacation.com's Glover's listing puts on Southwest
      // Caye (OpenStreetMap 16.7163, -87.8474). The pin sits about 400 m south of the caye's centre
      // in the water. Depth 35–90 ft from Chabil Mar and Belize Dive Haven.
      forecastLatitude: 16.7125,
      forecastLongitude: -87.847,
      description:
        "A wall of stony corals south of Southwest Caye, reached over sand. Great star, boulder star and mound corals grow in broad masses with grooves between them, and the sand below holds conch.",
      marineLife: "Nurse sharks · black groupers · queen conchs",
      marineLifeDescription:
        "Nurse sharks and big groupers shelter in the coral. Conchs crawl across the sand at the start of the dive.",
      conservationNote: "Glover’s Reef is a marine reserve and part of the World Heritage site.",
      difficultyLevel: "advanced",
      depthMinMeters: 11,
      maxDepthMeters: 27,
      currentNote: "Current not documented; ask the crew on the day, and carry an SMB.",
      divePlan:
        "Cross the sand to the foot of the wall and head south along it, no deeper than 27 m (90 ft), then work back up the coral with reserve gas. The swim-throughs in the coral are overheads; stay out.",
      fitTone: "demanding",
      fitNote:
        "A steady wall dive past 18 m. Comfortable buoyancy and a close eye on your gauge matter more than strength. Medical care is far; confirm the boat’s oxygen and plan.",
      // Operators rate it intermediate; the range reaches 27 m, past the Open Water limit, so it
      // is gated at Advanced Open Water.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "nurse-shark",
        "black-grouper",
        "queen-conch",
        "great-star-coral",
        "boulder-star-coral",
      ],
    },
  },
];
