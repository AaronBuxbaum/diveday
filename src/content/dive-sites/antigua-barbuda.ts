// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/**
 * Antigua and Barbuda. No agency publishes coordinates for these sites, so every pin is an
 * approximate pin placed in the water from a mapped landmark the operators tie the site to
 * (OpenStreetMap maps the Pillars of Hercules and Indian Creek; Wikipedia gives Cades Reef; the
 * US NGA GeoNames file names Nanton Point); each
 * says so in a comment. Where an operator gives a deeper figure than the other, the deeper is used.
 */
export const ANTIGUA_BARBUDA: DiveSiteTemplate[] = [
  {
    slug: "pillars-of-hercules",
    version: 1,
    area: "antigua-barbuda",
    sources: [
      "https://www.divecarib.com/dive-sites/",
      "https://web.archive.org/web/2026/http://www.dockyard-divers.com/divesites.html",
      "https://www.deepblu.com/mag/?p=1089",
    ],
    briefing: {
      name: "Pillars of Hercules",
      locationName: "English Harbor, Antigua",
      // Approximate pin: both operators put the site just outside English Harbor, about 100 ft off
      // the cliff below Shirley Heights; OpenStreetMap names the Pillars of Hercules at 17.0011,
      // -61.7612 and the pin is in the water 120 m south of that point. Depth: 4 m to 15 m
      // (DiveCarib), 20 ft to 45 ft (Dockyard Divers).
      forecastLatitude: 17.0,
      forecastLongitude: -61.7612,
      description:
        "Pillar-shaped rock formations mark the cliff above the site, and coral-covered boulders run beneath them. A large old anchor lies on the bottom, and spotted eagle rays pass through in winter.",
      marineLife: "Spotted eagle rays · green turtles · hawksbill turtles",
      marineLifeDescription:
        "Rays are most common in the winter months, and a resident turtle may be near the anchor.",
      difficultyLevel: "beginner",
      depthMinMeters: 4,
      maxDepthMeters: 15,
      currentNote:
        "Close to English Harbor; yachts and boats pass, so carry an SMB and listen for engines. The headland often breaks the waves, but check conditions. Current not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring line to the boulders, along the cliff face to the anchor, and back up the line for the safety stop.",
      fitTone: "welcoming",
      fitNote: "Shallow, sheltered and short to reach. A good second dive or a refresher.",
      creatureSlugs: ["spotted-eagle-ray", "green-sea-turtle", "hawksbill-turtle"],
    },
  },
  {
    slug: "barracuda-reef-antigua",
    version: 1,
    area: "antigua-barbuda",
    sources: [
      "https://www.divecarib.com/dive-sites/",
      "https://web.archive.org/web/2026/http://www.dockyard-divers.com/divesites.html",
    ],
    briefing: {
      name: "Barracuda Reef",
      locationName: "English Harbor, Antigua",
      // Approximate pin: DiveCarib puts the reef between Falmouth Harbour and English Harbour about
      // half a mile off shore, and Dockyard Divers on the south coast; placed in the water 800 m
      // south of the coast (OpenStreetMap, Charlotte Point at 17.0010, -61.7608) midway between the
      // two harbor mouths. Depth: 12 m to 25 m or more (DiveCarib), a wall from 60 ft to 120 ft
      // (Dockyard Divers); the deeper figure, 120 ft or 37 m, is used.
      forecastLatitude: 16.9935,
      forecastLongitude: -61.767,
      description:
        "A wall dive with a coral garden at the top, home to staghorn coral. South of that plateau the reef steps down in ledges with coves, where barracuda and turtles are found.",
      marineLife: "Barracuda · nurse sharks · turtles · spiny lobster · staghorn coral",
      marineLifeDescription:
        "The staghorn garden is worth a slow look, and turtles and nurse sharks use the ledges below it.",
      difficultyLevel: "advanced",
      depthMinMeters: 12,
      maxDepthMeters: 37,
      currentNote:
        "An exposed drift dive with no permanent mooring. Local operators dive it rarely, only in good conditions. Carry an SMB. The wall falls to about 37 m.",
      divePlan:
        "Drop onto the coral garden, drift south down the ledges no deeper than 30 m, a shallower floor than the wall's 37 m foot, and ascend on an SMB with reserve gas. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote: "A drift along a wall in open water. For divers with deep training.",
      // RULE 1: the wall runs from 60 ft to 120 ft (37 m) by Dockyard Divers' numbers (a stated foot
      // at or under 40 m), so maxDepthMeters is 37 while the plan holds 30 m; DiveCarib asks
      // for Advanced Open Water; the deeper figure takes the Deep specialty as well, and the exposed
      // drift keeps the Advanced Open Water gate.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "great-barracuda",
        "nurse-shark",
        "green-sea-turtle",
        "hawksbill-turtle",
        "spiny-lobster",
        "staghorn-coral",
      ],
    },
  },
  {
    slug: "sunken-rock-antigua",
    version: 1,
    area: "antigua-barbuda",
    sources: [
      "https://www.divecarib.com/dive-sites/",
      "https://web.archive.org/web/2026/http://www.dockyard-divers.com/divesites.html",
    ],
    briefing: {
      name: "Sunken Rock",
      locationName: "Indian Creek, Antigua",
      // Approximate pin: DiveCarib places the rock close to Indian Creek and Mamora Bay on the
      // windward side; placed in the water about 800 m south-east of Indian Creek (OpenStreetMap,
      // 17.0041, -61.7383), good to about 2 km. Depth: a wall from 2 m to 25 m or more (DiveCarib),
      // a trail through a split in the rock to 120 ft (Dockyard Divers). The 120 ft (37 m) figure
      // belongs to the split, which is overhead and off the plan, so it is not the wall's depth;
      // the wall is held at DiveCarib's 25 m, the plan's floor. No source puts the open reef deeper
      // than 25 m; the 37 m is only the split, which is overhead and off the plan.
      forecastLatitude: 16.999,
      forecastLongitude: -61.733,
      description:
        "A rock pinnacle just awash, with a vertical wall on its outer side covered in gorgonians and sponges. Caribbean reef sharks and ocean triggerfish are often seen here.",
      marineLife: "Caribbean reef sharks · ocean triggerfish · gorgonians · sponges",
      marineLifeDescription:
        "Reef sharks and triggerfish patrol the outer wall, and the rock face is dressed in sea fans.",
      difficultyLevel: "advanced",
      depthMinMeters: 2,
      maxDepthMeters: 25,
      currentNote:
        "Exposed to the Atlantic and often run as a drift despite a mooring, so carry an SMB. The rock is awash in swell. The wall continues deeper than the plan, so the floor is the diver's to hold. A split runs through the rock itself; it is overhead, so stay out of it.",
      divePlan:
        "Drop down the outside of the rock, drift along the wall no deeper than 25 m, and ascend on an SMB or the mooring line, away from the rock. If reef sharks come by: stay put, keep nothing dangling, do not chase or touch, stay together and follow the crew's briefing. Sightings are not promised. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote:
        "The furthest site on the windward side, exposed and walled. For divers comfortable drifting in open water.",
      // Gate: an exposed Atlantic drift beside a wall that continues past the plan's 25 m floor, so
      // Advanced Open Water.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "caribbean-reef-shark",
        "ocean-triggerfish",
        "common-sea-fan",
        "giant-barrel-sponge",
        "yellow-tube-sponge",
      ],
    },
  },
  {
    slug: "cades-reef",
    version: 1,
    area: "antigua-barbuda",
    sources: [
      "https://antigua-barbuda.org/Agdive01.htm",
      "https://www.divein.com/diving/destination/diving-in-antigua-and-barbudo",
      "https://www.sandals.com/blog/scuba-diving-antigua/",
      "https://en.wikipedia.org/wiki/Cades_Bay",
    ],
    briefing: {
      name: "Cades Reef",
      locationName: "Cades Bay, Antigua",
      // Approximate pin: Wikipedia's position for Cades Reef (17°00′26.4″ N, 61°52′39.4″ W), a long
      // barrier reef off Cades Bay on Antigua's southwest coast, in the water; the tourism board
      // and two guides place the reef off the southwest coast, so the pin is good to about 2 km
      // along the reef.
      forecastLatitude: 17.0073,
      forecastLongitude: -61.8776,
      description:
        "A long barrier reef off the southwest coast, partly inside a marine park and close enough to shore for snorkelers too. It runs from a sloping shallow edge to a deeper outer section.",
      marineLife: "Parrotfish · lobster · eagle rays · nurse sharks · barracuda",
      marineLifeDescription:
        "Parrotfish and lobster work the reef. Eagle rays and barracuda cruise farther out, and nurse sharks are reported too.",
      difficultyLevel: "advanced",
      maxDepthMeters: 26,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Start on the shallow, sloping edge as a check dive, then work the outer reef no deeper than 26 m, the plan's floor. A small cave on its ridge is overhead; stay out of it. The slope past the outer reef drops off beyond the plan. Staff confirm the diver's log before boarding.",
      fitTone: "unknown",
      fitNote:
        "A shallow edge to settle in and an outer reef at 26 m, with a drop-off beyond the plan.",
      // RULE 2: the outer section's slope drops off past the reef, so the gate is Advanced Open
      // Water with the plan's 26 m floor; no source says operators run the outer reef as an Open Water
      // dive.
      minimumCertificationLevel: "advanced_open_water",
      // The depth is the deepest named site along the reef (the outer Chimney site, 26 m); the
      // sources do not give one depth for the whole reef.
      creatureSlugs: [
        "stoplight-parrotfish",
        "spiny-lobster",
        "spotted-eagle-ray",
        "nurse-shark",
        "great-barracuda",
      ],
    },
  },
  {
    slug: "nanton-point-antigua",
    version: 1,
    area: "antigua-barbuda",
    sources: [
      "https://www.divecarib.com/dive-sites/",
      "https://web.archive.org/web/2026/http://www.dockyard-divers.com/divesites.html",
      "https://www.scubatravel.co.uk/americas/antigua-diving.html",
      "https://geonames.nga.mil/geon-ags/rest/services/RESEARCH/GIS_OUTPUT/MapServer/0/query?where=full_name%3D%27Nanton+Point%27&outFields=full_name,lat_dd,long_dd&f=json",
    ],
    briefing: {
      name: "Nanton Point",
      locationName: "Nanton Point, Antigua",
      // Approximate pin: the US National Geospatial-Intelligence Agency's GeoNames record puts
      // Nanton Point, a headland on Antigua's south coast east of English Harbor, at 16.9982,
      // -61.7547; both operators name the dive for that point and describe boulders at the foot of
      // a cliff. The pin is in the water about 100 m south of the headland's tip (OpenStreetMap
      // coastline, 16.9974, -61.7545), good to about 2 km along the shore.
      // Depth: 4 m to 23 m (DiveCarib), 30 ft to 45 ft (Dockyard Divers); the deeper figure is used.
      forecastLatitude: 16.997,
      forecastLongitude: -61.755,
      description:
        "Big boulders pile against a cliff on the south coast, and rocky ridges reach out from the face like short walls. Corals and sponges crust the stone, and reef sharks are sometimes reported along the outer edge.",
      marineLife: "Spotted eagle rays · green turtles · morays",
      marineLifeDescription:
        "Eagle rays patrol the outer ridges, and turtles are a regular sight. Reef sharks are sometimes reported, not promised. Morays and small reef life tuck into the gaps between the boulders.",
      difficultyLevel: "advanced",
      depthMinMeters: 4,
      maxDepthMeters: 23,
      currentNote:
        "Yachts use the water off English Harbor: carry an SMB, listen for engines, and surface only after the SMB is up. Close to a cliff and open to the Atlantic, with a current whose direction is unpredictable, so local operators usually run it as a drift from the boat. Keep a few meters clear of the cliff foot; surge can move you into the boulders. The water off the headland is often rough and the site is not always diveable.",
      divePlan:
        "Drift with the current along the boulders and ridges, hold no deeper than 23 m, and make the safety stop on an SMB in open water, away from the cliff. If reef sharks come by: stay with the group, keep nothing dangling, do not chase or touch, and follow the crew's briefing. Sightings are not promised. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote:
        "A boat drift beside a cliff on the exposed coast. For divers who are at ease with current and an SMB.",
      // Gate: depth is not the reason (23 m). The sources call for divers confident in drifting,
      // and the site is exposed to the Atlantic with an unpredictable current, so Advanced Open Water.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "spotted-eagle-ray",
        "green-sea-turtle",
        "green-moray",
        "caribbean-reef-shark",
      ],
    },
  },
];
