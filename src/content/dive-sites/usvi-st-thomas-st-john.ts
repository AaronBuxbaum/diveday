// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** St Thomas and St John. */
export const USVI_ST_THOMAS_ST_JOHN: DiveSiteTemplate[] = [
  {
    slug: "arches-and-tunnels-thatch-cay",
    version: 1,
    area: "usvi-st-thomas-st-john",
    sources: [
      "https://www.stthomasscubadiving.com/st-thomas-diving/st-thomas-dive-sites/",
      "https://www.padi.com/articles/top-10-dives-us-virgin-islands",
    ],
    briefing: {
      // Approximate pin: the north side of Thatch Cay (JJ Divers: north side of the cay; PADI: Tunnels of Thatch on the cay's north side). The pin is in open water about 100 m off the cay's northern shore, from OpenStreetMap outlines. No operator publishes coordinates, so the pin is good to about 2 km.
      // Depth: JJ Divers gives 40 to 70 ft (21 m). Gated AOW: JJ Divers calls it suited to beginning and experienced divers and PADI rates it intermediate, but both name surge at the tunnels, so the gate and the flat-calm-only line follow the surge.
      name: "Arches and Tunnels",
      locationName: "Thatch Cay, St Thomas",
      forecastLatitude: 18.3611,
      forecastLongitude: -64.8601,
      description:
        "The arches and tunnels here are overhead; stay out of them. Off the north side of Thatch Cay, sponge-covered canyons and fields of soft coral run past rock arches, with drop-offs beyond. Swell passing through a crevice in the rock makes a sound divers describe as a snoring sea monster.",
      marineLife: "Silversides · tarpon · soft corals · sponges",
      marineLifeDescription:
        "Silversides and tarpon move through the rock formations, and the canyon walls are crusted with sponges and soft corals.",
      difficultyLevel: "intermediate",
      depthMinMeters: 12,
      maxDepthMeters: 21,
      currentNote:
        "PADI calls the tunnels safe only when the surface is flat calm and the surge is down; swell passing through a crevice makes the snoring sound. The tunnels and caverns are overhead; stay out of them. Current not documented; ask the crew on the day.",
      divePlan:
        "Overhead; stay out of the arches and tunnels. Stay in the open canyons and on the sloping hillside, and surface with an SMB.",
      fitTone: "demanding",
      fitNote: "Advanced Open Water and a flat-calm day, because surge is the hazard here.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "tarpon",
        "hardhead-silverside",
        "common-sea-fan",
        "giant-barrel-sponge",
        "orange-cup-coral",
      ],
    },
  },
  {
    slug: "coki-beach-st-thomas",
    version: 1,
    area: "usvi-st-thomas-st-john",
    sources: [
      "https://www.stthomasscubadiving.com/st-thomas-diving/shore-diving/",
      "https://www.padi.com/dive-site/united-states-virgin-islands/coki-beach-2/",
      "https://www.scubago.com/en/explore/divesite/coki-point-beach-93567",
      "https://www.visitusvi.com/experience/scuba-diving-st-thomas/",
    ],
    briefing: {
      // Approximate pin: the reef off Coki Beach, on St Thomas's northeast coast. scubago.com places Coki Point Beach at 18.3497, -64.8661 and OpenStreetMap's beach outline agrees; the pin is the reef about 150 m north of the sand, good to about 500 m.
      // Depth: JJ Divers gives 40 to 55 ft, PADI 20 to 55 ft and scubago 50 to 60 ft; the deepest figure sets the range.
      // The pin is the reef, about 150 m off the sand, so the text does not promise a surface-swim-free entry; night and new-certification promotion were removed because no source states a log requirement.
      name: "Coki Beach",
      locationName: "Coki Point, St Thomas",
      forecastLatitude: 18.3508,
      forecastLongitude: -64.8667,
      description:
        "A beach dive on the northeast coast of St Thomas, with a sandy entry. Two reefs lie off the beach in clear water.",
      marineLife: "Reef fish · soft corals · sea fans",
      marineLifeDescription: "Plenty of tropical fish over the reefs.",
      difficultyLevel: "beginner",
      depthMinMeters: 6,
      maxDepthMeters: 18,
      currentNote:
        "A busy public beach: snorkelers, swimmers and SNUBA divers share the water off the sand. Surface well clear of them with an SMB. Usually light; it can change, so carry an SMB. Exit by the same sandy entry.",
      divePlan:
        "Walk in from the sand, follow the reef out, and return to the same entry. Keep the beach in sight on the way back.",
      fitTone: "welcoming",
      fitNote: "Shallow, with a sandy beach entry and a busy beach above.",
      creatureSlugs: [
        "blue-tang",
        "sergeant-major",
        "french-grunt",
        "queen-angelfish",
        "common-sea-fan",
        "trumpetfish",
      ],
    },
  },
  {
    slug: "congo-cay-st-thomas",
    version: 1,
    area: "usvi-st-thomas-st-john",
    sources: [
      "https://www.aadivers.com/scubadivesites.php",
      "https://www.stthomasscubadiving.com/st-thomas-diving/st-thomas-dive-sites/",
      "https://web.archive.org/web/2023/https://www.nps.gov/submerged/Parks/VIIS.html",
      "https://www.visitusvi.com/st-john/st-john-scuba-diving",
      "https://www.padi.com/articles/top-10-dives-us-virgin-islands",
    ],
    briefing: {
      // Approximate pin: the west end of Congo Cay (Aqua Action, NPS). The pin is in open water about 150 m off the cay's western end. Landmark positions from OpenStreetMap; no operator publishes coordinates, so the pin is good to about 2 km.
      // Depth: NPS gives a wall to 80–90 ft off Congo Point, the deepest of the sources. Gated AOW for the tidal current the NPS names around the point; visitusvi.com calls the shallow reefs ideal for beginners, but the plan here covers the wall off the point and holds 27 m. The sand chute's foot is not sourced, so the chute is left out of the plan.
      name: "Congo Cay",
      locationName: "Congo Cay, St Thomas and St John",
      forecastLatitude: 18.3678,
      forecastLongitude: -64.8066,
      description:
        "At the west end of Congo Cay, canyons and rock pinnacles run to a sand chute that drops like an underwater ski jump. Colorful sponges and octocorals, a wall of plate corals off the point, and big sand flats where stingrays lie buried.",
      marineLife: "Stingrays · eagle rays · nurse sharks · dolphins",
      marineLifeDescription:
        "Stingrays and nurse sharks work the sand flats, silversides gather by the rocks, and eagle rays and dolphins pass on the edge of deeper water.",
      difficultyLevel: "intermediate",
      depthMinMeters: 6,
      maxDepthMeters: 27,
      currentNote:
        "Tidal currents run past the cay and around Congo Point (NPS). Carry an SMB, and plan the dive with the guide for the current.",
      divePlan:
        "Follow the canyons and pinnacles at the west end, stay out of the sand chute, whose foot is not documented, and stay above 27 m (90 ft) on the wall.",
      fitTone: "demanding",
      fitNote: "A wall off the point that runs to 27 m (90 ft), with tidal current past the cay.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "southern-stingray",
        "spotted-eagle-ray",
        "nurse-shark",
        "bottlenose-dolphin",
        "hardhead-silverside",
        "tarpon",
      ],
    },
  },
  {
    slug: "carval-rock-st-thomas",
    version: 1,
    area: "usvi-st-thomas-st-john",
    sources: [
      "https://www.aadivers.com/scubadivesites.php",
      "https://www.stthomasscubadiving.com/st-thomas-diving/st-thomas-dive-sites/",
      "https://web.archive.org/web/2023/https://www.nps.gov/submerged/Parks/VIIS.html",
      "https://www.visitusvi.com/st-john/st-john-scuba-diving",
      "https://www.padi.com/articles/top-10-dives-us-virgin-islands",
    ],
    briefing: {
      // Approximate pin: Carval Rock, east of Congo Cay (NPS, visitusvi.com). The pin is about 100 m south of the rock, where Aqua Action puts the mooring. Landmark positions from OpenStreetMap; no operator publishes coordinates, so the pin is good to about 2 km.
      // Gated AOW: every source names a strong current; the north and east walls fall to 80 ft (24 m).
      name: "Carval Rock",
      locationName: "Between Congo Cay and Lovango Cay, St Thomas and St John",
      forecastLatitude: 18.3631,
      forecastLongitude: -64.7958,
      description:
        "A rock standing just east of Congo Cay, named for a 17th-century fighting ship. Steep rock formations with canyons and a channel called The Cut, a sheer wall at the east end, and tarpon feeding on the bait in the spring.",
      marineLife: "Tarpon · baitfish · nurse sharks · octopus",
      marineLifeDescription:
        "Tarpon hunt the baitfish in spring, and the shallow coral gardens on the way back hold nurse sharks, reef squid and octopus.",
      difficultyLevel: "advanced",
      depthMinMeters: 5,
      maxDepthMeters: 24,
      currentNote:
        "Strong, stiff current through The Cut and around the rock; check it before every dive. Carry an SMB. Mornings are usually calmest. The bottom on the outside slopes past the plan; stay above it.",
      divePlan:
        "Drop on the sheltered south side, let the current take you around the rock, past the formations and canyon, and return through the shallow coral gardens. No deeper than 24 m (80 ft).",
      fitTone: "demanding",
      fitNote:
        "Experienced divers only: stiff current, a deep wall and an open-water return. Advanced Open Water.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "tarpon",
        "nurse-shark",
        "caribbean-reef-squid",
        "atlantic-common-octopus",
        "horse-eye-jack",
        "common-sea-fan",
      ],
    },
  },
  {
    slug: "grass-cay-st-thomas",
    version: 1,
    area: "usvi-st-thomas-st-john",
    sources: [
      "https://www.aadivers.com/scubadivesites.php",
      "https://www.stthomasscubadiving.com/st-thomas-diving/st-thomas-dive-sites/",
      "https://www.visitusvi.com/st-john/st-john-scuba-diving",
    ],
    briefing: {
      // Approximate pin: Grass Cay, in Pillsbury Sound off eastern St Thomas (Aqua Action, JJ Divers, visitusvi.com). The side is not described; the pin is about 150 m south of the cay. Landmark positions from OpenStreetMap; no operator publishes coordinates, so the pin is good to about 2 km.
      // Depth: visitusvi.com gives 15 to 70 ft across the four Grass Cay sites; Aqua Action's dive reaches 55 ft. The deeper figure sets the range. Ungated: depth only, and the sources call it a site for beginners and new certifications.
      name: "Grass Cay",
      locationName: "Grass Cay, Pillsbury Sound",
      forecastLatitude: 18.3556,
      forecastLongitude: -64.834,
      description:
        "Large coral heads and big sea fans on a gently sloping reef off the cay, with sand flats and mounds of reef across the bottom. A varied dive on the eastern side of St Thomas.",
      marineLife: "Queen conch · turtles · parrotfish · rays",
      marineLifeDescription:
        "Sea turtles and rays glide over the sand flats, conch graze the sand, and the coral heads shelter parrotfish and lobsters.",
      difficultyLevel: "intermediate",
      depthMinMeters: 5,
      maxDepthMeters: 21,
      currentNote:
        "Pillsbury Sound has tidal flow; ask the crew about it on the day, and carry an SMB.",
      divePlan:
        "Circle the coral heads, cross the mounds on the sand flat, and work back along the sloping reef.",
      fitTone: "unknown",
      fitNote:
        "A gentle reef of coral heads on sand and a slope to 21 m (70 ft). Beginners stay on the top of the slope.",
      creatureSlugs: [
        "queen-conch",
        "green-sea-turtle",
        "queen-parrotfish",
        "southern-stingray",
        "common-sea-fan",
        "spiny-lobster",
      ],
    },
  },
  {
    slug: "mingo-cay-st-thomas",
    version: 1,
    area: "usvi-st-thomas-st-john",
    sources: [
      "https://www.aadivers.com/scubadivesites.php",
      "https://web.archive.org/web/2023/https://www.nps.gov/submerged/Parks/VIIS.html",
    ],
    briefing: {
      // Approximate pin: Mingo Cay, in Pillsbury Sound (Aqua Action, NPS). The side is not described for the reef; the pin is about 150 m south of the cay. Landmark positions from OpenStreetMap; no operator publishes coordinates, so the pin is good to about 2 km.
      // Depth: Aqua Action gives a maximum of 45 ft; the NPS gives no depth. Ungated: depth only, and Aqua Action says it is often used for training. The drift option at the west end was removed from the plan: a drift is not an Open Water plan without a sourced current.
      name: "Mingo Cay",
      locationName: "Mingo Cay, Pillsbury Sound",
      forecastLatitude: 18.3576,
      forecastLongitude: -64.8198,
      description:
        "Reef on the slopes around Mingo Cay, in the middle of three cays between St Thomas and St John. Small coral heads on a 45-degree slope pocked with small holes, and a western end with a coral canyon.",
      marineLife: "Squid · barracuda · crinoids · tube worms",
      marineLifeDescription:
        "Tube worms, crinoids and urchins in the small holes of the slope, and squid and a barracuda over the coral canyon at the west end.",
      difficultyLevel: "beginner",
      depthMinMeters: 5,
      maxDepthMeters: 14,
      currentNote:
        "Pillsbury Sound has tidal flow; ask the crew about it on the day, and carry an SMB.",
      divePlan:
        "Work down the slope among the coral heads and back up, looking into the small holes.",
      fitTone: "unknown",
      fitNote: "Often used for training, with a maximum depth of 14 m (45 ft). Bring a macro lens.",
      creatureSlugs: [
        "caribbean-reef-squid",
        "great-barracuda",
        "french-grunt",
        "blue-tang",
        "queen-angelfish",
      ],
    },
  },
  {
    slug: "cow-and-calf-rocks-st-thomas",
    version: 1,
    area: "usvi-st-thomas-st-john",
    sources: [
      "https://www.aadivers.com/scubadivesites.php",
      "https://www.stthomasscubadiving.com/st-thomas-diving/st-thomas-dive-sites/",
      "https://www.stthomasdivecenter.com/dive-sites-on-st-thomas-usvi",
      "https://diveaquamarine.com/dive-sites/",
      "https://www.padi.com/articles/top-10-dives-us-virgin-islands",
    ],
    briefing: {
      // Approximate pin: the two rocks, Cow Rock and Calf Rock, off the south side of St Thomas (all sources). The pin lies in the water between the two rocks, about 115 m from each, from OpenStreetMap positions. Landmark positions from OpenStreetMap; no operator publishes coordinates, so the pin is good to about 2 km.
      // Depth: Aqua Marine gives 25 to 45 ft, Aqua Action, the St Thomas Dive Center and PADI 40 to 45 ft.
      // Gated AOW: surge at the Champagne Cork is sourced and can push divers through, so the template is not a beginner dive even though the depth is 14 m.
      name: "Cow and Calf Rocks",
      locationName: "South of Great St James, St Thomas",
      forecastLatitude: 18.3037,
      forecastLongitude: -64.8466,
      description:
        "Two rocks off the south side of St Thomas with ridges, canyons and arches. Cow Rock has swim-throughs, which are overhead; stay out of them. Calf Rock has a long ledge with no swim-throughs. Soft and hard corals grow on both.",
      marineLife: "Lobsters · green morays · turtles · nurse sharks",
      marineLifeDescription:
        "Lobsters and brittle stars sit between the rocks, and turtles, tarpon and nurse sharks cruise the ledges.",
      conservationNote: "The rocks sit inside a marine preserve.",
      difficultyLevel: "intermediate",
      depthMinMeters: 8,
      maxDepthMeters: 14,
      currentNote:
        "Surge and wave action at Cow Rock: the swim-throughs can push divers through. They are overhead; stay out of them and keep to the open reef. Calm days only; the guide decides. Current not documented; ask the crew on the day.",
      divePlan:
        "Calm days only; the guide decides. Keep to Cow Rock’s open ridges and canyons, then cross to Calf Rock and follow its long ledge. The swim-throughs are overhead; stay out.",
      fitTone: "demanding",
      fitNote:
        "Shallow, but surge at Cow Rock can push divers through the swim-throughs. Advanced Open Water, calm days, with a guide.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The Champagne Cork",
          kind: "reefFormation",
          note: "A swim-through at Cow Rock where surge can launch a diver through the top. Overhead; stay out of it.",
        },
      ],
      creatureSlugs: [
        "spiny-lobster",
        "green-moray",
        "hawksbill-turtle",
        "nurse-shark",
        "tarpon",
        "elkhorn-coral",
      ],
    },
  },
  {
    slug: "stragglers-st-thomas",
    version: 1,
    area: "usvi-st-thomas-st-john",
    sources: [
      "https://www.aadivers.com/scubadivesites.php",
      "https://diveaquamarine.com/dive-sites/",
    ],
    briefing: {
      // Approximate pin: the rocks that straggle off Great St James (Aqua Action). The pin is in open water about 230 m off the island, from an OpenStreetMap outline; the side is not described. Landmark positions from OpenStreetMap; no operator publishes coordinates, so the pin is good to about 2 km.
      // Depth: Aqua Action gives a 40 ft dive and Aqua Marine 30 to 60 ft; the deeper figure sets the range.
      name: "Stragglers",
      locationName: "Great St James, St Thomas",
      forecastLatitude: 18.3088,
      forecastLongitude: -64.8338,
      description:
        "A string of volcanic fingers and big boulders that straggle off Great St James, cut by canyons. An open-water feel, with eels, octopus and lobsters in the walls.",
      marineLife: "Eagle rays · eels · octopus · lobsters",
      marineLifeDescription:
        "Spotted eagle rays pass overhead, and the canyon walls hold eels, octopus and lobster condos.",
      difficultyLevel: "intermediate",
      depthMinMeters: 9,
      maxDepthMeters: 18,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan: "Start out on the reef, then thread through the canyons between the boulders.",
      fitTone: "welcoming",
      fitNote:
        "Canyons between boulders, with an open-water feel. The deepest point is 18 m (60 ft), the Open Water limit.",
      creatureSlugs: [
        "spotted-eagle-ray",
        "green-moray",
        "atlantic-common-octopus",
        "spiny-lobster",
        "caribbean-reef-squid",
        "schoolmaster-snapper",
      ],
    },
  },
  {
    slug: "ledges-of-little-st-james",
    version: 1,
    area: "usvi-st-thomas-st-john",
    sources: [
      "https://www.aadivers.com/scubadivesites.php",
      "https://www.stthomasscubadiving.com/st-thomas-diving/st-thomas-dive-sites/",
      "https://www.stthomasdivecenter.com/dive-sites-on-st-thomas-usvi",
      "https://diveaquamarine.com/dive-sites/",
    ],
    briefing: {
      // Approximate pin: the west side of Little St James (St Thomas Dive Center). The pin is about 250 m west of the island, from an OpenStreetMap outline. Landmark positions from OpenStreetMap; no operator publishes coordinates, so the pin is good to about 2 km.
      // Depth: Aqua Marine gives 20 to 60 ft, and the St Thomas Dive Center 45 ft going out and 25 ft coming back; the deepest figure sets the range.
      name: "Ledges of Little St. James",
      locationName: "Little St James, St Thomas",
      forecastLatitude: 18.3004,
      forecastLongitude: -64.8312,
      description:
        "On the west side of Little St James, ledges, overhangs and undercuts where the sand has washed from beneath the coral ridges. Do not reach under the ledges. The ledges run at two depths, with low reef around them.",
      marineLife: "Turtles · eagle rays · nurse sharks · yellowtail snapper",
      marineLifeDescription:
        "Hawksbill turtles and spotted eagle rays are regular, nurse sharks sleep under the ledges, and big schools of yellowtail snapper hang over the reef.",
      difficultyLevel: "beginner",
      depthMinMeters: 6,
      maxDepthMeters: 18,
      currentNote: "Sheltered. Current not documented; ask the crew on the day.",
      divePlan:
        "Swim the deeper ledges on the way out and the shallower ledges on the way back. Keep your hands out from under the ledges.",
      fitTone: "welcoming",
      fitNote: "Sheltered, with lots to see in shallow water. Do not reach under ledges.",
      creatureSlugs: [
        "hawksbill-turtle",
        "spotted-eagle-ray",
        "nurse-shark",
        "yellowtail-snapper",
        "french-grunt",
        "yellowhead-jawfish",
      ],
    },
  },
  {
    slug: "joes-jam-coral-bowl-st-thomas",
    version: 1,
    area: "usvi-st-thomas-st-john",
    sources: [
      "https://www.aadivers.com/scubadivesites.php",
      "https://diveaquamarine.com/dive-sites/",
      "https://www.stthomasdivecenter.com/dive-sites-on-st-thomas-usvi",
      "https://www.visitusvi.com/experience/scuba-diving-st-thomas/",
    ],
    briefing: {
      // Approximate pin: the south side of the sand strip that joins Buck Island and Capella Island (St Thomas Dive Center). The pin is about 400 m south of the islands' centre, from OpenStreetMap outlines. Landmark positions from OpenStreetMap; no operator publishes coordinates, so the pin is good to about 2 km.
      // Depth: every source gives 80 ft (24 m). Ungated: depth only, and the sources call it a calm-day site.
      name: "Joe’s Jam (Coral Bowl)",
      locationName: "Buck Island, St Thomas",
      forecastLatitude: 18.2722,
      forecastLongitude: -64.8944,
      description:
        "A bowl-shaped slope off the south side of the strip joining Buck and Capella Islands. Tiers of hard and soft coral rise like an amphitheater from the sand at about 17 m to sea fans at about 6 m.",
      marineLife: "Sharks · southern stingrays · nurse sharks · Nassau grouper",
      marineLifeDescription:
        "Sharks and southern stingrays gather over the sandy center, and lobsters, eels and nurse sharks sit in the ledges.",
      difficultyLevel: "intermediate",
      depthMinMeters: 9,
      maxDepthMeters: 24,
      currentNote: "A calm-day site. Current not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring to the bowl, around the tiers from the sand up to the sea fans, and no deeper than 24 m (80 ft).",
      fitTone: "welcoming",
      fitNote:
        "A scenic site for calm days. The bowl floor lies at about 17 m (55 ft) and the deepest point is 24 m (80 ft).",
      landmarks: [
        {
          name: "The bowl",
          kind: "reefFormation",
          note: "A bowl-shaped slope with tiers of coral, sandy at its center.",
        },
      ],
      creatureSlugs: [
        "southern-stingray",
        "nurse-shark",
        "nassau-grouper",
        "spiny-lobster",
        "common-sea-fan",
      ],
    },
  },
  {
    slug: "miss-opportunity-st-thomas",
    version: 1,
    area: "usvi-st-thomas-st-john",
    sources: [
      "https://www.aadivers.com/scubadivesites.php",
      "https://www.visitusvi.com/experience/scuba-diving-st-thomas/",
      "https://divernet.com/world-dives/best-wreck-diving-in-the-caribbean/",
    ],
    briefing: {
      // Approximate pin: the airport runway on St Thomas's southwest shore (Divernet: tucked close inshore by the runway). The pin is about 100 m off the runway's south shore, from an OpenStreetMap outline. Landmark positions from OpenStreetMap; no operator publishes coordinates, so the pin is good to about 2 km.
      // Gated AOW: Aqua Action gives just over 90 ft and Divernet 27 m. visitusvi.com rates it for advanced divers and Divernet says most of the wreck is easily penetrable; the template says stay outside.
      name: "Miss Opportunity",
      locationName: "Off Cyril E. King Airport, St Thomas",
      forecastLatitude: 18.3288,
      forecastLongitude: -64.9728,
      description:
        "A former hospital ship, sunk in 1985 as an artificial reef and lying on her side close inshore by the runway. The wreck can be reached at about 12 m, and the sheltered water makes her a good choice when the sea is up.",
      marineLife: "Groupers · moray eels · sharks · amberjack",
      marineLifeDescription:
        "Large groupers and moray eels sit in the wreckage, sharks pass, and sponges and lionfish cover the decks.",
      difficultyLevel: "advanced",
      depthMinMeters: 12,
      maxDepthMeters: 28,
      currentNote:
        "The wreck lies by the airport runway and boats work this shore: listen for engines and carry an SMB. Protected inshore water. Current not documented; ask the crew on the day.",
      divePlan:
        "Down to the hull at about 12 m, along the outside of the decks, and no deeper than 28 m. Stay outside the hull.",
      fitTone: "demanding",
      fitNote: "A large wreck on her side in depth to 28 m. Advanced Open Water.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The hull",
          kind: "wreckFeature",
          note: "The wreck lies on her side and can be reached at about 12 m. Stay outside the hull.",
        },
      ],
      creatureSlugs: [
        "black-grouper",
        "green-moray",
        "greater-amberjack",
        "lionfish",
        "giant-barrel-sponge",
      ],
    },
  },
  {
    slug: "packet-rock-st-thomas",
    version: 1,
    area: "usvi-st-thomas-st-john",
    sources: [
      "https://www.aadivers.com/scubadivesites.php",
      "https://www.stthomasdivecenter.com/dive-sites-on-st-thomas-usvi",
      "https://diveaquamarine.com/dive-sites/",
    ],
    briefing: {
      // The ship's name and class are not confirmed by two sources, so the text says only "a mail packet".
      // Approximate pin: Packet Rock, in the cut between St Thomas and Buck Island, off Bolongo Bay (Aqua Action). The pin is OpenStreetMap's position for the rock, moved 20 m north into open water. Landmark positions from OpenStreetMap; no operator publishes coordinates, so the pin is good to about 2 km.
      name: "Packet Rock",
      locationName: "Between St Thomas and Buck Island",
      forecastLatitude: 18.2999,
      forecastLongitude: -64.8904,
      description:
        "A small pinnacle in the cut between St Thomas and Buck Island, where a mail packet hit the rocks in 1816. Rocks run from a few feet below the surface down to about 18 m, with a ship’s cauldron on the southeast side.",
      marineLife: "Barracuda · French angelfish · queen angelfish · hawksbill turtles",
      marineLifeDescription:
        "Schools of barracuda, big angelfish and hawksbill turtles over the rocks, with grunts and yellowtail on the north ledges. Roofing tiles, pottery shards and clay pipes lie in the reef; leave them.",
      difficultyLevel: "intermediate",
      depthMinMeters: 1,
      maxDepthMeters: 18,
      // Traffic: the rock sits in a cut between St Thomas and Buck Island; no source documents boat traffic there, so the line is a conservative caution.
      currentNote:
        "The rock lies in a cut between St Thomas and Buck Island: listen for engines, carry an SMB and surface close to the rocks. Current not documented; ask the crew on the day.",
      divePlan:
        "A short swim around the rocks, starting at the north ledges and ending on the southeast side by the cauldron.",
      fitTone: "unknown",
      fitNote: "Compact, with a bit of history on the reef, in a cut where the water can move.",
      creatureSlugs: [
        "great-barracuda",
        "french-angelfish",
        "queen-angelfish",
        "hawksbill-turtle",
        "french-grunt",
        "sergeant-major",
      ],
    },
  },
  {
    slug: "fish-stick-buck-island",
    version: 1,
    area: "usvi-st-thomas-st-john",
    sources: [
      "https://www.aadivers.com/scubadivesites.php",
      "https://diveaquamarine.com/dive-sites/",
      "https://www.scubago.com/en/explore/divesite/buck-island-point-submarine-alley-13309",
    ],
    briefing: {
      // Position: scubago.com's Buck Island Point (18.2766, -64.8995), in open water off the island; Aqua Action and the St Thomas Dive Center both start the dive at Buck Island Point and run it into the cove.
      // Depth: both sources give 80 ft (24 m). Gate: Advanced Open Water, because a one-way drift with a boat pickup is a blue-water SMB dive; Aqua Marine calls the drift gentle and no source names a strong current.
      name: "Fish Stick (Fish Sticks)",
      locationName: "Buck Island, St Thomas",
      forecastLatitude: 18.2766,
      forecastLongitude: -64.8995,
      description:
        "A one-way dive that starts at Buck Island Point and runs into the cove, the nearest thing to a drift dive off St Thomas. Pillars of rock stand along a reef wall with dense coral.",
      marineLife: "Southern stingrays · sharks · creole wrasse · jacks",
      marineLifeDescription:
        "Big southern stingrays and sharks, with schools of creole wrasse, snapper and jacks.",
      difficultyLevel: "intermediate",
      depthMinMeters: 12,
      maxDepthMeters: 24,
      currentNote:
        "A one-way drift with the current, and the boat follows your bubbles. Carry an SMB, send it up at the end, and watch your gas.",
      divePlan:
        "Enter at Buck Island Point, drift along the wall no deeper than 24 m (80 ft), and surface with the SMB for pickup. Staff confirm the diver’s log before boarding.",
      fitTone: "demanding",
      fitNote:
        "A one-way drift with the boat following your bubbles, to 24 m (80 ft). Staff confirm the diver’s log before boarding.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "southern-stingray",
        "creole-wrasse",
        "horse-eye-jack",
        "schoolmaster-snapper",
        "common-sea-fan",
      ],
    },
  },
  {
    slug: "dive-flag-rock-buck-island",
    version: 1,
    area: "usvi-st-thomas-st-john",
    sources: [
      "https://www.aadivers.com/scubadivesites.php",
      "https://diveaquamarine.com/dive-sites/",
      "https://www.stthomasdivecenter.com/dive-sites-on-st-thomas-usvi",
      "https://www.scubago.com/en/explore/divesite/dive-flag-rock-338140",
    ],
    briefing: {
      // Position: scubago.com's Dive Flag Rock (18.2780, -64.8974), in the water off the north side of Buck Island, where Aqua Action and the St Thomas Dive Center place the wall.
      // Depth: Aqua Action gives sand at 60–70 ft (21 m). Ungated: depth only.
      name: "Dive Flag Rock (Buck Island Wall)",
      locationName: "Buck Island, St Thomas",
      forecastLatitude: 18.278,
      forecastLongitude: -64.8974,
      description:
        "Off the north side of Buck Island, a wall that starts on a reef top at about 9 m and drops to the sand. Machinery left on the bottom in the 1960s is now covered in chromis, with the occasional eel or shark.",
      marineLife: "Hawksbill turtles · eagle rays · blue chromis · blacktip sharks",
      marineLifeDescription:
        "A cleaning station draws turtles and spotted eagle rays, young blacktip reef sharks patrol the wall, and the machinery shelters schooling chromis.",
      difficultyLevel: "intermediate",
      depthMinMeters: 9,
      maxDepthMeters: 21,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Drop to the shallow sand, cross to the coral cluster, and follow the wall down to the sand and back up.",
      fitTone: "welcoming",
      fitNote:
        "A multi-level dive: the reef top is at about 9 m (30 ft) and the sand at 21 m (70 ft).",
      creatureSlugs: [
        "hawksbill-turtle",
        "spotted-eagle-ray",
        "blue-chromis",
        "blacktip-shark",
        "southern-stingray",
        "great-barracuda",
      ],
    },
  },
  {
    slug: "wye-reef-buck-island",
    version: 1,
    area: "usvi-st-thomas-st-john",
    sources: [
      "https://www.aadivers.com/scubadivesites.php",
      "https://www.stthomasdivecenter.com/dive-sites-on-st-thomas-usvi",
      "https://www.scubago.com/en/explore/divesite/wye-reef-542495",
    ],
    briefing: {
      // Position: scubago.com's Wye Reef (18.2744, -64.8971), which it places at the southwest corner of Buck Island by Shipwreck Cove; Aqua Action puts the reef right off Buck Island Cove and the St Thomas Dive Center on a border of the cove, within 1 km.
      name: "Wye Reef",
      locationName: "Buck Island, St Thomas",
      forecastLatitude: 18.2744,
      forecastLongitude: -64.8971,
      description:
        "A reef beside Buck Island Cove, named for the HMS Wye, which sank on it in the 1867 hurricane that also sank the Rhone. No wreckage remains, but the reef drops in terraces among big boulders and barrel sponges.",
      marineLife: "Octopus · nurse sharks · sea turtles · schooling fish",
      marineLifeDescription:
        "Octopus in the rocks, nurse sharks and sea turtles over the terraces, and large groupings of schooling fish.",
      difficultyLevel: "intermediate",
      depthMinMeters: 11,
      maxDepthMeters: 18,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Start at about 11 m and work down the terraces to the edge at 18 m, then turn either way along it.",
      fitTone: "welcoming",
      fitNote: "Can be dived shallow or deeper, so it suits most levels.",
      creatureSlugs: [
        "atlantic-common-octopus",
        "nurse-shark",
        "green-sea-turtle",
        "giant-barrel-sponge",
        "french-grunt",
        "spiny-lobster",
      ],
    },
  },
  {
    slug: "cartanser-sr-buck-island",
    version: 1,
    area: "usvi-st-thomas-st-john",
    sources: [
      "https://www.aadivers.com/scubadivesites.php",
      "https://www.stthomasdivecenter.com/dive-sites-on-st-thomas-usvi",
      "https://diveaquamarine.com/dive-sites/",
      "https://www.visitusvi.com/experience/scuba-diving-st-thomas/",
      "https://www.scubago.com/en/explore/divesite/cartanza-wreck-21615",
    ],
    briefing: {
      // Position: scubago.com's Cartanza wreck (18.2761, -64.8980) in Shipwreck Cove; visitusvi.com places the wreck in Shipwreck Cove just off Buck Island, which agrees within 1 km.
      name: "Cartanser Sr (Cartanza Senora)",
      locationName: "Buck Island, St Thomas",
      forecastLatitude: 18.2761,
      forecastLongitude: -64.898,
      description:
        "A 190-foot freighter from World War II, now lying on her port side in three pieces in the cove off Buck Island. The engines are still visible, and corals and sponges cover the hull.",
      marineLife: "Yellowtail snapper · sea turtles · octopus · sharks",
      marineLifeDescription:
        "Yellowtail snapper follow divers along the hull, turtles rest on the deck, and octopus live along the hull.",
      difficultyLevel: "intermediate",
      depthMinMeters: 11,
      maxDepthMeters: 18,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Follow the three sections along the sand, then continue onto the neighboring reef. Stay outside the hull.",
      fitTone: "welcoming",
      fitNote: "A shallow wreck that suits most levels.",
      landmarks: [
        {
          name: "Engines",
          kind: "wreckFeature",
          note: "The ship’s engines are still intact. Stay outside the hull.",
        },
      ],
      creatureSlugs: [
        "yellowtail-snapper",
        "green-sea-turtle",
        "atlantic-common-octopus",
        "french-grunt",
        "orange-cup-coral",
      ],
    },
  },
];
