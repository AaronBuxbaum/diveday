// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Ambergris Caye and Caye Caulker. */
export const BELIZE_NORTH: DiveSiteTemplate[] = [
  // Denominator row: Hol Chan Marine Reserve (Hol Chan Cut)
  {
    slug: "hol-chan-marine-reserve",
    version: 1,
    area: "belize-north",
    sources: [
      "https://ramons.com/scuba-trips/",
      "https://www.belizebudgetsuites.com/belize-barrier-reef-dive-sites.html",
      "https://ambergrisdivers.com/ambergris-caye-dive-sites/",
    ],
    briefing: {
      name: "Hol Chan Marine Reserve",
      locationName: "Hol Chan Marine Reserve, Ambergris Caye",
      // Approximate pin: the Hol Chan Cut itself, the gap in the barrier reef south of San Pedro. No
      // source publishes coordinates; the point is OpenStreetMap's "Hol Chan Cut" node (17.8628,
      // -87.9772), which sits in the gap between two sections of the mapped reef outline. Good to
      // about 2 km.
      forecastLatitude: 17.8628,
      forecastLongitude: -87.9772,
      description:
        "A cut through the barrier reef south of San Pedro, and the name means little channel. The reserve is shallow and busy with fish.",
      marineLife: "Nurse sharks · spotted eagle rays · green moray eels · spiny lobsters",
      marineLifeDescription:
        "Large groupers, turtles and morays sit among the coral, with eagle rays and nurse sharks working the sand. Southern stingrays turn up on the night dive, which needs a guide.",
      conservationNote: "A marine reserve: look, but do not touch or take anything.",
      difficultyLevel: "intermediate",
      depthMinMeters: 6,
      maxDepthMeters: 9,
      currentNote:
        "Boats use the cut, so carry an SMB and listen for engines. Strong tidal current runs through it, hardest in the middle of the channel, and most divers cannot swim against it at peak exchange. Time the dive for slack water and stay close to the channel sides.",
      fitTone: "demanding",
      fitNote:
        "Shallow, but the tide decides how hard it is. A weaker swimmer should dive it at slack water.",
      // The depth is 9 m, but a source calls the tide in the middle of the cut impossible to swim
      // against, so the gate is Advanced Open Water. A shop that dives only slack water along the
      // channel sides can lower it.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "nurse-shark",
        "spotted-eagle-ray",
        "green-moray",
        "spiny-lobster",
        "southern-stingray",
      ],
    },
  },
  // Denominator row: Esmeralda (Esmeralda Canyons)
  {
    slug: "esmeralda-canyons",
    version: 1,
    area: "belize-north",
    sources: [
      "https://www.frenchiesdivingbelize.com/",
      "https://www.travelbelize.org/blog/best-diving-spots-belize/",
      "https://belizeontop.com/top-7-scuba-diving-spots-san-pedro-belize/",
    ],
    briefing: {
      name: "Esmeralda Canyons",
      locationName: "Esmeralda Canyons, Ambergris Caye",
      // Approximate pin: on the barrier reef crest off San Pedro Town, south of the town channel.
      // Frenchie's, the Belize Tourism Board and Belize On Top all place the site just offshore of
      // San Pedro; no source publishes coordinates. Good to about 2 km.
      forecastLatitude: 17.902,
      forecastLongitude: -87.948,
      description:
        "Coral ridges separated by sand-floored canyons on the reef off San Pedro. A local operator runs it as a 45-minute dive to 21 m.",
      marineLife: "Nurse sharks · black groupers · green moray eels · snappers",
      marineLifeDescription:
        "Nurse sharks, groupers and turtles turn up along the ridges, snappers gather in schools, and green moray eels live in the crevices.",
      difficultyLevel: "intermediate",
      maxDepthMeters: 21,
      currentNote:
        "Strong currents reported on the ridges; carry an SMB and ask the crew on the day.",
      divePlan:
        "Follow the canyons between the ridges no deeper than 21 m (70 ft), then work back up a ridge with reserve gas. Any swim-through is an overhead; stay out.",
      fitTone: "demanding",
      fitNote: "A 21 m canyon dive of 45 minutes, so gas and depth need watching from the start.",
      // The operator page sells this to every certified diver; at 21 m it is held to Advanced Open
      // Water here, and a shop can lower the gate.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "nurse-shark",
        "black-grouper",
        "green-moray",
        "green-sea-turtle",
        "schoolmaster-snapper",
      ],
    },
  },
  // Denominator row: Tackle Box (Tackle Box Canyons)
  {
    slug: "tackle-box-canyons",
    version: 1,
    area: "belize-north",
    sources: [
      "https://www.frenchiesdivingbelize.com/",
      "https://www.belizebudgetsuites.com/belize-barrier-reef-dive-sites.html",
      "https://belizeontop.com/top-7-scuba-diving-spots-san-pedro-belize/",
    ],
    briefing: {
      name: "Tackle Box Canyons",
      locationName: "Tackle Box Canyons, Ambergris Caye",
      // Approximate pin: on the reef a short boat ride off San Pedro Town, beside Tuffy Rocks.
      // Belize Budget Suites puts it a few minutes from shore near San Pedro, next to Tuffy; Belize
      // On Top also places it near San Pedro. No source publishes coordinates. Good to about 2 km.
      forecastLatitude: 17.911,
      forecastLongitude: -87.9455,
      description:
        "Deep, narrow canyons with steep sides on the reef off San Pedro, reached from a mooring buoy. A tunnel and a small cavern lie nearby; both are overhead, so stay out of them.",
      marineLife: "Spiny lobsters · green moray eels · nurse sharks · eagle rays",
      marineLifeDescription:
        "Lobsters sit in the recesses, with moray eels and nurse sharks along the ridges and an occasional eagle ray or turtle.",
      difficultyLevel: "intermediate",
      depthMinMeters: 12,
      maxDepthMeters: 30,
      currentNote:
        "Current is not documented; ask the crew on the day. The canyons are narrow, so keep clear of the walls.",
      divePlan:
        "Down the mooring to the canyon floor, along the canyons no deeper than 30 m, and back up the reef with reserve gas. Stay out of the tunnel and the cavern.",
      fitTone: "demanding",
      fitNote:
        "Narrow canyons that run to 30 m, with a tunnel and cavern nearby that are not part of the dive.",
      // Sources give 18 m (an operator page), 12 to 24 m and 20 to 30 m (66 to 100 ft); the deepest
      // is taken. The plan holds the floor at 30 m, so the gate is Advanced Open Water without the
      // Deep specialty. The tunnel and cavern are overhead, so the plan stays out of both.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "spiny-lobster",
        "green-moray",
        "nurse-shark",
        "spotted-eagle-ray",
        "green-sea-turtle",
      ],
    },
  },
  // Denominator row: Cypress Canyons (Cypress Tunnels)
  {
    slug: "cypress-canyons",
    version: 1,
    area: "belize-north",
    sources: [
      "https://www.belizebudgetsuites.com/belize-barrier-reef-dive-sites.html",
      "https://ramons.com/scuba-trips/",
      "https://ambergrisdivers.com/ambergris-caye-dive-sites/",
    ],
    briefing: {
      name: "Cypress Canyons",
      locationName: "Cypress Canyons, Ambergris Caye",
      // Approximate pin: on the reef just north of Hol Chan Marine Reserve. Belize Budget Suites
      // puts it close to Hol Chan; no source publishes coordinates. Placed about 1.5 km north of
      // the Hol Chan Cut pin. Good to about 2 km.
      forecastLatitude: 17.876,
      forecastLongitude: -87.9705,
      description:
        "Spur-and-groove reef with deep, narrow canyons and orange and white elkhorn coral. The spurs crest at 15 to 21 m and the sand-floored cuts fall away to about 33 m.",
      marineLife: "Elkhorn coral · schoolmaster snappers · sailfin blennies",
      marineLifeDescription:
        "Snappers school over the spurs, and small blennies live around the mooring line. Do not feed the fish.",
      difficultyLevel: "intermediate",
      depthMinMeters: 15,
      maxDepthMeters: 33,
      currentNote: "Current is not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring line at about 15 m, along the spurs, no deeper than 33 m in the cuts, and back up the reef with reserve gas. The tunnels and swim-throughs are overheads; stay out.",
      fitTone: "demanding",
      fitNote:
        "Narrow cuts that drop toward 33 m, with tunnels beside the route that stay out of the plan.",
      // Sources give 50-109 ft (33 m) for the deepest cuts; the deepest is taken, so past 30 m the
      // gate is Advanced Open Water with the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: ["elkhorn-coral", "schoolmaster-snapper", "sailfin-blenny", "common-sea-fan"],
    },
  },
  // Denominator row: Paradise Canyons
  {
    slug: "paradise-canyons-ambergris",
    version: 1,
    area: "belize-north",
    sources: [
      "https://ambergrisdivers.com/ambergris-caye-dive-sites/",
      "https://www.belizebudgetsuites.com/belize-barrier-reef-dive-sites.html",
      "https://ramons.com/scuba-trips/",
    ],
    briefing: {
      name: "Paradise Canyons",
      locationName: "Paradise Canyons, Ambergris Caye",
      // Approximate pin: on the reef off the north end of San Pedro Town. Ramon's Village places the
      // site toward the north end of San Pedro; no source publishes coordinates. Good to about 2 km.
      forecastLatitude: 17.94,
      forecastLongitude: -87.938,
      description:
        "Finger canyons of dense coral separated by wide white sand, with plenty of small tropical life. A concrete crucifix stands on the site.",
      marineLife: "Reef fish · hard corals · sea fans",
      marineLifeDescription:
        "Bright, busy coral heads along the canyon sides. Expect reef fish rather than large animals.",
      difficultyLevel: "intermediate",
      depthMinMeters: 18,
      maxDepthMeters: 21,
      currentNote: "Current is not documented; ask the crew on the day.",
      fitTone: "demanding",
      fitNote: "Canyons at 18 to 21 m, deeper than a first Open Water dive.",
      // Sources give 60-70 ft; at 21 m the site is held to Advanced Open Water here.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "french-angelfish",
        "queen-angelfish",
        "bluestriped-grunt",
        "schoolmaster-snapper",
      ],
    },
  },
];
