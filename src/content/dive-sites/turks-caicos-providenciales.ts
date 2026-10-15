// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts

import type { DiveSiteTemplate } from "./types";

/** Providenciales, West Caicos and French Cay. */
export const TURKS_CAICOS_PROVIDENCIALES: DiveSiteTemplate[] = [
  {
    slug: "coral-gables-providenciales",
    version: 1,
    area: "turks-caicos-providenciales",
    sources: [
      "https://www.tcreef.org/s/TCI-Dive_Site_Summary_List_20_Oct_16.pdf",
      "https://diveprovo.com/dive-sites/",
      "https://www.timespub.tc/2022/01/treasures-on-the-reef/",
    ],
    briefing: {
      // Gated AOW at an 18 m plan floor: a gentle slope where divers pick their depth (Dive Provo) leading to a wall, and no source rates it as an Open Water run, so the conservative gate applies; the wall lies beyond the plan.
      // Position: Turks & Caicos Reef Fund mooring list, 20 Oct 2016 (degrees and decimal minutes converted); mooring about 30 ft.
      name: "Coral Gables",
      locationName: "Grace Bay, Providenciales",
      forecastLatitude: 21.8163,
      forecastLongitude: -72.1845,
      description:
        "The reef slopes gently toward the wall, and each diver can settle at a depth that suits. Sand chutes run down the slope, with big stacks of coral standing between them.",
      marineLife: "Grunts · snappers · groupers",
      marineLifeDescription:
        "Grunts, snappers and groupers crowd the coral stacks between the chutes.",
      difficultyLevel: "intermediate",
      depthRange: "9–18 m (30–60 ft)",
      maxDepthMeters: 18,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring at about 9 m (30 ft), ease down the slope and turn at 18 m (60 ft). The wall lies beyond this plan; stay on the reef side.",
      fitTone: "unknown",
      fitNote: "The slope lets each diver set a depth. Set yours before you drop and keep it.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["white-grunt", "yellowtail-snapper", "nassau-grouper", "bluehead-wrasse"],
    },
  },
  {
    slug: "cathedral-providenciales",
    version: 1,
    area: "turks-caicos-providenciales",
    sources: [
      "https://www.tcreef.org/s/TCI-Dive_Site_Summary_List_20_Oct_16.pdf",
      "https://diveprovo.com/dive-sites/",
      "https://www.timespub.tc/2022/01/treasures-on-the-reef/",
    ],
    briefing: {
      // Advanced Open Water: part of the site is a short vertical stretch of wall (Dive Provo) and the wall bottoms near 30 m (Times of the Islands, 'a mere 100 feet'); the plan floor is 30 m, so no Deep specialty.
      // Position: Turks & Caicos Reef Fund mooring list, 20 Oct 2016 (degrees and decimal minutes converted); mooring about 30 ft.
      name: "Cathedral",
      locationName: "Grace Bay, Providenciales",
      forecastLatitude: 21.8153,
      forecastLongitude: -72.1852,
      description:
        "The reef has two natural markers: a brief vertical step in the wall at one end and a bend in the reef at the other. The wall below lies at about 30 m.",
      marineLife: "Reef fish · plate corals",
      marineLifeDescription: "Fish gather at the reef corner, where water and food move through.",
      difficultyLevel: "intermediate",
      depthRange: "9–30 m (30–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "Currents are noted at the reef corner at one end of the site; elsewhere current is not documented. Ask the crew on the day and carry an SMB.",
      divePlan:
        "Down the mooring to about 9 m (30 ft), along the wall no deeper than 30 m (100 ft), and back up the reef with reserve gas. The wall drops far below this floor. Use the wall stretch and the reef corner to keep your bearings.",
      fitTone: "demanding",
      fitNote: "A wall with two clear landmarks and a floor you set in advance. Hold it.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["queen-angelfish", "french-grunt", "bluehead-wrasse", "sergeant-major"],
    },
  },
  {
    slug: "pinnacles-providenciales",
    version: 1,
    area: "turks-caicos-providenciales",
    sources: [
      "https://www.tcreef.org/s/TCI-Dive_Site_Summary_List_20_Oct_16.pdf",
      "https://diveprovo.com/dive-sites/",
      "https://www.timespub.tc/2022/01/treasures-on-the-reef/",
    ],
    briefing: {
      // Gated AOW at an 18 m plan floor: the mooring sits in about 11 m (Reef Fund) in a Grace Bay site east of the barrier reef break (Times of the Islands), but no source rates it as an Open Water run, so the conservative gate applies.
      // Position: Turks & Caicos Reef Fund mooring list, 20 Oct 2016 (degrees and decimal minutes converted); mooring about 35 ft.
      name: "Pinnacles",
      locationName: "Grace Bay, Providenciales",
      forecastLatitude: 21.8142,
      forecastLongitude: -72.187,
      description:
        "Pillar coral grows in big stands here, and every stand has its own set of residents. It repays a second look.",
      marineLife: "Pillar coral · reef fish",
      marineLifeDescription:
        "Each coral stand has its own residents; a second pass often shows something new.",
      difficultyLevel: "intermediate",
      depthRange: "11–18 m (35–60 ft)",
      maxDepthMeters: 18,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring at about 11 m (35 ft), circle the coral stands, and turn at 18 m (60 ft). Deeper water lies beyond the plan; stay on the reef side.",
      fitTone: "unknown",
      fitNote: "A reef of coral stands and a plan that stays on top of it.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["pillar-coral", "queen-angelfish", "french-grunt", "sergeant-major"],
    },
  },
  {
    slug: "graceland-providenciales",
    version: 1,
    area: "turks-caicos-providenciales",
    sources: [
      "https://www.tcreef.org/s/TCI-Dive_Site_Summary_List_20_Oct_16.pdf",
      "https://diveprovo.com/dive-sites/",
    ],
    briefing: {
      // Advanced Open Water: a wall with a plan floor of 30 m; the wall drops far past it.
      // Overhead: the swim-through leading to the wall (Dive Provo) is a stay-out.
      // The Reef Fund list shows no mooring here (2016).
      // Position: Turks & Caicos Reef Fund mooring list, 20 Oct 2016 (degrees and decimal minutes converted).
      name: "Graceland",
      locationName: "Grace Bay, Providenciales",
      forecastLatitude: 21.8133,
      forecastLongitude: -72.1871,
      description:
        "A big sand chute lies under the boat. A swim-through opens toward the wall near 15 m, where buttresses and indentations break up the face. Reef sharks may cruise the depths alongside.",
      marineLife: "Reef sharks · wall fish",
      marineLifeDescription:
        "The wall is cut with buttresses and hollows; look out into the blue for sharks.",
      difficultyLevel: "intermediate",
      depthRange: "15–30 m (50–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "Current not documented. The 2016 mooring list shows no buoy here, so the crew will brief how the boat is secured. Carry an SMB.",
      divePlan:
        "Down the mooring to about 15 m (50 ft), along the wall no deeper than 30 m (100 ft), and back up the reef with reserve gas. The wall drops far below this floor. The swim-through is overhead; stay out of it and reach the wall over the open reef. If sharks appear, stay put and with the group, keep your gear tucked in, and do not chase or touch them. Follow the crew's briefing; sightings are not promised.",
      fitTone: "demanding",
      fitNote:
        "A wall with a swim-through you leave alone. Hold your floor and stay with your buddy.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["caribbean-reef-shark", "horse-eye-jack", "bar-jack", "french-grunt"],
    },
  },
  {
    slug: "grouper-hole-providenciales",
    version: 1,
    area: "turks-caicos-providenciales",
    sources: [
      "https://www.tcreef.org/s/TCI-Dive_Site_Summary_List_20_Oct_16.pdf",
      "https://diveprovo.com/dive-sites/",
    ],
    briefing: {
      // Gated AOW at an 18 m plan floor: a gently sloping wall reached from a 12 m mooring (Dive Provo, Reef Fund); no source rates it as an Open Water run, so the conservative gate applies, and the slope runs deeper beyond the plan.
      // Position: Turks & Caicos Reef Fund mooring list, 20 Oct 2016 (degrees and decimal minutes converted); mooring about 40 ft.
      name: "Grouper Hole",
      locationName: "Grace Bay, Providenciales",
      forecastLatitude: 21.8127,
      forecastLongitude: -72.1894,
      description:
        "A deep sandy hollow lies beside the mooring, and a lone coral head rises from the sand chute that runs out to a gently sloping wall. Groupers were fed here before the marine park existed.",
      marineLife: "Nassau grouper · coral head · sand chute",
      marineLifeDescription:
        "Groupers keep to the coral head and the grotto edge; watch them from the sand.",
      difficultyLevel: "intermediate",
      depthRange: "12–18 m (40–60 ft)",
      maxDepthMeters: 18,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring at about 12 m (40 ft), follow the chute past the coral head to the slope, and turn at 18 m (60 ft). The slope runs deeper beyond the plan.",
      fitTone: "unknown",
      fitNote:
        "A sand-and-coral dive with a clear landmark. Keep the group together near the coral head.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["nassau-grouper", "black-grouper", "garden-eel", "white-grunt"],
    },
  },
  {
    slug: "aquarium-west-providenciales",
    version: 1,
    area: "turks-caicos-providenciales",
    sources: [
      "https://www.tcreef.org/s/TCI-Dive_Site_Summary_List_20_Oct_16.pdf",
      "https://diveprovo.com/dive-sites/",
    ],
    briefing: {
      // Advanced Open Water: a spur-and-groove wall with a plan floor of 30 m; the sand chutes run to about 30 m (Dive Provo, 100 ft).
      // Position: Turks & Caicos Reef Fund mooring list, 20 Oct 2016 (degrees and decimal minutes converted); mooring about 60 ft.
      name: "Aquarium West",
      locationName: "Grace Bay, Providenciales",
      forecastLatitude: 21.8085,
      forecastLongitude: -72.226,
      description:
        "Dense schools of grunts and snappers blanket the lip of the wall. The spur-and-groove face is cut by sand chutes that run down through the reef.",
      marineLife: "Grunts · snappers",
      marineLifeDescription:
        "The schools are thickest along the top of the wall; the chutes show the reef's structure.",
      difficultyLevel: "intermediate",
      depthRange: "18–30 m (60–100 ft)",
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day and carry an SMB.",
      divePlan:
        "Down the mooring to about 18 m (60 ft), along the wall no deeper than 30 m (100 ft), and back up the reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote:
        "A busy wall with a mooring already at 18 m. Set your floor before you drop and hold it.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["french-grunt", "yellowtail-snapper", "bluestriped-grunt", "white-grunt"],
    },
  },
  {
    slug: "shark-hotel-providenciales",
    version: 1,
    area: "turks-caicos-providenciales",
    sources: [
      "https://www.tcreef.org/s/TCI-Dive_Site_Summary_List_20_Oct_16.pdf",
      "https://diveprovo.com/dive-sites/",
      "https://dan.org/alert-diver/article/diving-in-the-turks-and-caicos-islands/",
    ],
    briefing: {
      // Advanced Open Water: a wall with a plan floor of 30 m; Dive Provo puts the plateau at 24 to 30 m before the wall plunges.
      // Position: Turks & Caicos Reef Fund mooring list, 20 Oct 2016 (degrees and decimal minutes converted); mooring about 45 ft.
      name: "Shark Hotel",
      locationName: "Northwest Point, Providenciales",
      forecastLatitude: 21.8443,
      forecastLongitude: -72.3418,
      description:
        "The wall starts near 14 m and falls to a shelf at 24 to 30 m before dropping away. Grunts, snappers and goatfish school over the top, and a large stand of pillar coral stands near the mooring.",
      marineLife: "Grunts · snappers · goatfish · reef sharks · pillar coral",
      marineLifeDescription:
        "Schools hold along the top of the wall; small reef sharks work the blue beyond it.",
      difficultyLevel: "intermediate",
      depthRange: "14–30 m (45–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "Current not documented for this site; the northernmost Northwest Point sites regularly have some. Ask the crew on the day and carry an SMB.",
      divePlan:
        "Down the mooring to about 14 m (45 ft), along the wall no deeper than 30 m (100 ft), and back up the reef with reserve gas. The wall drops far below this floor. If sharks appear, stay put and with the group, keep your gear tucked in, and do not chase or touch them. Follow the crew's briefing; sightings are not promised.",
      fitTone: "demanding",
      fitNote:
        "A deep wall where small reef sharks may be seen. Stay near the group and hold your floor. Northwest Point is a boat ride from shore, so medical care is far; confirm the boat’s oxygen and plan.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "caribbean-reef-shark",
        "pillar-coral",
        "spotted-goatfish",
        "french-grunt",
        "yellowtail-snapper",
      ],
    },
  },
  {
    slug: "amphitheatre-providenciales",
    version: 1,
    area: "turks-caicos-providenciales",
    sources: [
      "https://www.tcreef.org/s/TCI-Dive_Site_Summary_List_20_Oct_16.pdf",
      "https://diveprovo.com/dive-sites/",
      "https://dan.org/alert-diver/article/diving-in-the-turks-and-caicos-islands/",
      "https://www.timespub.tc/2022/01/treasures-on-the-reef/",
    ],
    briefing: {
      // Advanced Open Water: a wall with a plan floor of 30 m; the undercut hollow has a sand floor near 26 m and rope sponges near 27 m (Dive Provo). The plan floor is the 26 m sand, above the hollow, so the range stops there; the wall drops far below.
      // Position: Turks & Caicos Reef Fund mooring list, 20 Oct 2016 (degrees and decimal minutes converted); mooring about 35 ft.
      name: "Amphitheater",
      locationName: "Northwest Point, Providenciales",
      forecastLatitude: 21.8412,
      forecastLongitude: -72.3412,
      description:
        "Pillar coral stands beneath the boat, with horse-eye jacks around it. The wall falls to a hollow undercut by 3 to 5 m, with a sand floor near 26 m. The undercut is overhead; stay out. A big elephant ear sponge and black coral grow along its lip.",
      marineLife: "Horse-eye jacks · pillar coral · black coral · reef sharks",
      marineLifeDescription:
        "Jacks hang over the pillar coral; the undercut holds sponges, plate coral and black coral along its lip.",
      difficultyLevel: "intermediate",
      depthRange: "11–26 m (35–85 ft)",
      maxDepthMeters: 26,
      currentNote:
        "Current not documented for this site; the northernmost Northwest Point sites regularly have some. Ask the crew on the day and carry an SMB.",
      divePlan:
        "Down the mooring to about 11 m (35 ft), along the wall no deeper than 26 m (85 ft), above the sand floor of the hollow, and back up the mooring line with reserve gas. The wall drops far below this floor. The undercut is overhead; stay out. If sharks appear, stay put and with the group, keep your gear tucked in, and do not chase or touch them. Follow the crew's briefing; sightings are not promised.",
      fitTone: "demanding",
      fitNote:
        "A wall with an undercut hollow to stay out of. Hold your floor and your buddy. Northwest Point is a boat ride from shore, so medical care is far; confirm the boat’s oxygen and plan.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "horse-eye-jack",
        "pillar-coral",
        "black-coral",
        "orange-elephant-ear-sponge",
        "caribbean-reef-shark",
      ],
    },
  },
  {
    slug: "the-crack-providenciales",
    version: 1,
    area: "turks-caicos-providenciales",
    sources: [
      "https://www.tcreef.org/s/TCI-Dive_Site_Summary_List_20_Oct_16.pdf",
      "https://diveprovo.com/dive-sites/",
      "https://dan.org/alert-diver/article/diving-in-the-turks-and-caicos-islands/",
    ],
    briefing: {
      // Advanced Open Water: a wall with a plan floor of 30 m; the crevice runs from about 15 to 30 m (Dive Provo, 50 to 100 ft).
      // Position: Turks & Caicos Reef Fund mooring list, 20 Oct 2016 (degrees and decimal minutes converted); mooring about 40 ft.
      name: "The Crack",
      locationName: "Northwest Point, Providenciales",
      forecastLatitude: 21.8354,
      forecastLongitude: -72.3413,
      description:
        "A narrow fissure splits the wall face between about 15 and 30 m. Groupers and snappers gather along the face among black coral and sea fans. The crack is narrow; stay out of it. Sharks and spotted eagle rays may pass along the wall.",
      marineLife: "Groupers · snappers · eagle rays · sharks",
      marineLifeDescription:
        "Groupers and snappers gather along the face; rays and sharks pass along the wall outside the crack.",
      difficultyLevel: "intermediate",
      depthRange: "12–30 m (40–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "Current not documented for this site; the northernmost Northwest Point sites regularly have some. Ask the crew on the day and carry an SMB.",
      divePlan:
        "Down the mooring to about 12 m (40 ft), along the wall no deeper than 30 m (100 ft), and back up the reef with reserve gas. The wall drops far below this floor. The crack is narrow; stay out of it. If sharks appear, stay put and with the group, keep your gear tucked in, and do not chase or touch them. Follow the crew's briefing; sightings are not promised.",
      fitTone: "demanding",
      fitNote:
        "A tall wall with a fissure you leave alone. Hold your floor. Northwest Point is a boat ride from shore, so medical care is far; confirm the boat’s oxygen and plan.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "black-coral",
        "spotted-eagle-ray",
        "nassau-grouper",
        "caribbean-reef-shark",
        "giant-barrel-sponge",
      ],
    },
  },
  {
    slug: "hole-in-the-wall-providenciales",
    version: 1,
    area: "turks-caicos-providenciales",
    sources: [
      "https://www.tcreef.org/s/TCI-Dive_Site_Summary_List_20_Oct_16.pdf",
      "https://diveprovo.com/dive-sites/",
      "https://dan.org/alert-diver/article/diving-in-the-turks-and-caicos-islands/",
    ],
    briefing: {
      // Advanced Open Water: a wall with a plan floor of 30 m.
      // Overhead: the hole is a stay-out; the operator describes room for one diver at a time.
      // Position: Turks & Caicos Reef Fund mooring list, 20 Oct 2016 (degrees and decimal minutes converted); mooring about 45 ft.
      name: "Hole in the Wall",
      locationName: "Northwest Point, Providenciales",
      forecastLatitude: 21.8222,
      forecastLongitude: -72.347,
      description:
        "A wall with a tight vertical shaft. Overhead; stay out. Sheet coral covers the wall around it.",
      marineLife: "Sheet corals · reef fish",
      marineLifeDescription: "Sheet coral and small fish line the wall.",
      difficultyLevel: "intermediate",
      depthRange: "14–30 m (45–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "Current not documented for this site; the northernmost Northwest Point sites regularly have some. Ask the crew on the day and carry an SMB.",
      divePlan:
        "Down the mooring to about 14 m (45 ft), along the wall no deeper than 30 m (100 ft), and back up the reef with reserve gas. The wall drops far below this floor. The shaft is overhead; stay out.",
      fitTone: "demanding",
      fitNote:
        "A wall with a shaft you leave alone. Hold your floor. Northwest Point is a boat ride from shore, so medical care is far; confirm the boat’s oxygen and plan.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "lamarcks-sheet-coral",
        "common-sea-fan",
        "black-coral",
        "caribbean-reef-shark",
      ],
    },
  },
  {
    slug: "eel-garden-providenciales",
    version: 1,
    area: "turks-caicos-providenciales",
    sources: [
      "https://www.tcreef.org/s/TCI-Dive_Site_Summary_List_20_Oct_16.pdf",
      "https://diveprovo.com/dive-sites/",
      "https://dan.org/alert-diver/article/diving-in-the-turks-and-caicos-islands/",
      "https://www.timespub.tc/2022/01/treasures-on-the-reef/",
    ],
    briefing: {
      // Advanced Open Water: a vertical wall a few fin kicks from the mooring (Dive Provo) with a plan floor of 30 m.
      // Position: Turks & Caicos Reef Fund mooring list, 20 Oct 2016 (degrees and decimal minutes converted); mooring about 40 ft.
      name: "Eel Garden",
      locationName: "Northwest Point, Providenciales",
      forecastLatitude: 21.8343,
      forecastLongitude: -72.341,
      description:
        "Garden eels fill a sandy bowl under the mooring, and the vertical wall begins a short swim away. The eels sink into their burrows as you near, so stay low and move slowly.",
      marineLife: "Garden eels · southern stingrays · reef fish",
      marineLifeDescription:
        "Keep low and slow on the sand and the eels stay up; the wall edge is close.",
      difficultyLevel: "intermediate",
      depthRange: "12–30 m (40–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "Current not documented for this site; the northernmost Northwest Point sites regularly have some. Ask the crew on the day and carry an SMB.",
      divePlan:
        "Down the mooring to about 12 m (40 ft), along the wall no deeper than 30 m (100 ft), and back up the reef with reserve gas. The wall drops far below this floor. Keep fins off the sand and finish over the bowl.",
      fitTone: "demanding",
      fitNote:
        "Start with patience on the sand, then stay near the group at the wall. Hold your floor. Northwest Point is a boat ride from shore, so medical care is far; confirm the boat’s oxygen and plan.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["garden-eel", "southern-stingray", "common-sea-fan", "giant-barrel-sponge"],
    },
  },
  {
    slug: "thunderdome-providenciales",
    version: 1,
    area: "turks-caicos-providenciales",
    sources: [
      "https://www.tcreef.org/s/TCI-Dive_Site_Summary_List_20_Oct_16.pdf",
      "https://dan.org/alert-diver/article/diving-in-the-turks-and-caicos-islands/",
      "https://www.timespub.tc/2022/01/treasures-on-the-reef/",
      "https://www.visittci.com/providenciales/things-to-do/diving",
    ],
    briefing: {
      // Ungated: the dome debris lies on sand at 11 m with its top at about 5 m (Alert Diver); no wall in the plan.
      // Position: Turks & Caicos Reef Fund mooring list, 20 Oct 2016 (degrees and decimal minutes converted); mooring about 30 ft.
      name: "Thunderdome",
      locationName: "Northwest Point, Providenciales",
      forecastLatitude: 21.8371,
      forecastLongitude: -72.341,
      description:
        "A metal-mesh dome built for a French television game show, now collapsed into pieces scattered on a sand bottom at 11 m. Fish, groupers, nurse sharks and morays shelter around the pieces.",
      marineLife: "Groupers · nurse sharks · moray eels · schooling grunts",
      marineLifeDescription:
        "Look closely at the frame and sand around it; small blennies, crabs and morays use the structure.",
      difficultyLevel: "beginner",
      depthRange: "5–11 m (15–35 ft)",
      maxDepthMeters: 11,
      currentNote:
        "Snorkelers visit the debris from the surface interval, so listen for engines and surface with an SMB. Current is regular at Northwest Point; ask the crew about it on the day.",
      divePlan:
        "Down the mooring to the debris, circle it slowly at 5 to 11 m (15 to 35 ft), and come up the line with a safety stop. Stay off and out from under the fallen pieces.",
      fitTone: "unknown",
      fitNote:
        "A shallow, slow dive for small things. Keep your fins off the sand and away from the frame. Northwest Point is a boat ride from shore, so medical care is far; confirm the boat’s oxygen and plan.",
      landmarks: [
        {
          name: "The dome",
          kind: "pointOfInterest",
          note: "The remains of a metal-mesh dome from a 1990s television game show, broken into pieces on the sand.",
        },
      ],
      creatureSlugs: [
        "nassau-grouper",
        "nurse-shark",
        "green-moray",
        "schoolmaster-snapper",
        "bluestriped-grunt",
      ],
    },
  },
  {
    slug: "highway-to-heaven-west-caicos",
    version: 1,
    area: "turks-caicos-providenciales",
    sources: [
      "https://www.tcreef.org/s/TCI-Dive_Site_Summary_List_20_Oct_16.pdf",
      "https://diveprovo.com/dive-sites/",
      "https://dan.org/alert-diver/article/diving-in-the-turks-and-caicos-islands/",
    ],
    briefing: {
      // Advanced Open Water: a wall with a plan floor of 30 m; the arches and swim-throughs sit at 24 to 30 m (Dive Provo, 80 to 100 ft).
      // Overhead: the arches and swim-throughs are stay-outs.
      // Position: Turks & Caicos Reef Fund mooring list, 20 Oct 2016 (degrees and decimal minutes converted); mooring about 50 ft.
      name: "Highway to Heaven",
      locationName: "West Caicos, Turks and Caicos",
      forecastLatitude: 21.6907,
      forecastLongitude: -72.4698,
      description:
        "You start over a sand flat at 15 m where a big colony of garden eels lives, with many stingrays resting nearby. The wall below carries coral arches and swim-throughs at 24 to 30 m. Sharks may be seen.",
      marineLife: "Garden eels · stingrays · reef sharks",
      marineLifeDescription:
        "Eels and rays work the flat; sharks and larger fish pass along the wall.",
      difficultyLevel: "intermediate",
      depthRange: "15–30 m (50–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "Usually light; it can change, so carry an SMB. Current is not documented site by site; ask the crew on the day.",
      divePlan:
        "Down the mooring to about 15 m (50 ft), along the wall no deeper than 30 m (100 ft), and back up the reef with reserve gas. The wall drops far below this floor. The arches and swim-throughs are overhead; stay out of them. If sharks appear, stay put and with the group, keep your gear tucked in, and do not chase or touch them. Follow the crew's briefing; sightings are not promised. Medical care is far; confirm the boat’s oxygen and plan.",
      fitTone: "demanding",
      fitNote:
        "A flat full of eels above a wall with overhead arches to stay out of. Hold your floor.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["garden-eel", "southern-stingray", "caribbean-reef-shark", "horse-eye-jack"],
    },
  },
  {
    slug: "elephant-ear-canyon-west-caicos",
    version: 1,
    area: "turks-caicos-providenciales",
    sources: [
      "https://www.tcreef.org/s/TCI-Dive_Site_Summary_List_20_Oct_16.pdf",
      "https://diveprovo.com/dive-sites/",
      "https://dan.org/alert-diver/article/diving-in-the-turks-and-caicos-islands/",
    ],
    briefing: {
      // Advanced Open Water: a wall with a plan floor of 30 m.
      // Position: Turks & Caicos Reef Fund mooring list, 20 Oct 2016 (degrees and decimal minutes converted); mooring about 50 ft.
      name: "Elephant Ear Canyon",
      locationName: "West Caicos, Turks and Caicos",
      forecastLatitude: 21.6833,
      forecastLongitude: -72.4698,
      description:
        "The reef on top of the wall lies at about 15 m, divided by sand chutes. The canyon opens into a wide sloping sand chute, and the wall face below it is crowded with sponges. Garden eels, stingrays and tilefish live on the sand under the boat.",
      marineLife: "Sponges · garden eels · stingrays · hawksbill turtles",
      marineLifeDescription:
        "The chute holds small life in the seagrass; hawksbills are common, and garden eels and stingrays work the sand under the boat.",
      difficultyLevel: "intermediate",
      depthRange: "15–30 m (50–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "Usually light; it can change, so carry an SMB. Current is not documented site by site; ask the crew on the day.",
      divePlan:
        "Down the mooring to about 15 m (50 ft), along the wall no deeper than 30 m (100 ft), and back up the reef with reserve gas. The wall drops far below this floor. Make the safety stop on the mooring line. Medical care is far; confirm the boat’s oxygen and plan.",
      fitTone: "demanding",
      fitNote: "A canyon and a sponge wall with plenty to see before the drop. Hold your floor.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "orange-elephant-ear-sponge",
        "southern-stingray",
        "garden-eel",
        "hawksbill-turtle",
        "yellowhead-jawfish",
      ],
    },
  },
  {
    slug: "the-gully-west-caicos",
    version: 1,
    area: "turks-caicos-providenciales",
    sources: [
      "https://www.tcreef.org/s/TCI-Dive_Site_Summary_List_20_Oct_16.pdf",
      "https://diveprovo.com/dive-sites/",
      "https://dan.org/alert-diver/article/diving-in-the-turks-and-caicos-islands/",
    ],
    briefing: {
      // Advanced Open Water: a wall with a plan floor of 30 m.
      // Position: Turks & Caicos Reef Fund mooring list, 20 Oct 2016 (degrees and decimal minutes converted); mooring about 50 ft.
      name: "The Gully",
      locationName: "West Caicos, Turks and Caicos",
      forecastLatitude: 21.677,
      forecastLongitude: -72.4697,
      description:
        "The lip of the wall is a thick coral reef with many cleaning stations. A cut through it, the gully of the name, splits the reef in two just before the vertical drop. Undercuts on the face carry sponges and black coral.",
      marineLife: "Black coral · sponges · cleaning stations",
      marineLifeDescription:
        "Watch the cleaning stations on the reef lip; sponges and black coral grow on the undercut face.",
      difficultyLevel: "intermediate",
      depthRange: "15–30 m (50–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "Usually light; it can change, so carry an SMB. Current is not documented site by site; ask the crew on the day.",
      divePlan:
        "Down the mooring to about 15 m (50 ft), along the wall no deeper than 30 m (100 ft), and back up the reef with reserve gas. The wall drops far below this floor. Make the safety stop on the mooring line. Medical care is far; confirm the boat’s oxygen and plan.",
      fitTone: "demanding",
      fitNote: "A cut through the reef lip and a wall below it. Hold your floor.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["black-coral", "caribbean-reef-shark", "blue-tang", "common-sea-fan"],
    },
  },
  {
    slug: "driveway-west-caicos",
    version: 1,
    area: "turks-caicos-providenciales",
    sources: [
      "https://www.tcreef.org/s/TCI-Dive_Site_Summary_List_20_Oct_16.pdf",
      "https://diveprovo.com/dive-sites/",
      "https://dan.org/alert-diver/article/diving-in-the-turks-and-caicos-islands/",
    ],
    briefing: {
      // Advanced Open Water: a wall with a plan floor of 30 m; the chute's ledge lies at 15 to 30 m (Dive Provo, 50 to 100 fsw).
      // Position: Turks & Caicos Reef Fund mooring list, 20 Oct 2016 (degrees and decimal minutes converted); mooring about 40 ft.
      name: "Driveway",
      locationName: "West Caicos, Turks and Caicos",
      forecastLatitude: 21.659,
      forecastLongitude: -72.4707,
      description:
        "The boat sits over sand and coral heads at 12 m. From there a sand chute slices down through the reef and ends at a ledge, below which the wall falls straight away. Plate and star corals thrive on the ledge, and black coral and purple tube sponges line the wall.",
      marineLife: "Sharks · groupers · black durgon · plate corals",
      marineLifeDescription:
        "Sharks and groupers work the ledge; black durgon school over the reef.",
      difficultyLevel: "intermediate",
      depthRange: "12–30 m (40–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "Usually light; it can change, so carry an SMB. Current is not documented site by site; ask the crew on the day.",
      divePlan:
        "Down the mooring to about 12 m (40 ft), along the wall no deeper than 30 m (100 ft), and back up the reef with reserve gas. The wall drops far below this floor. The chute ends at a ledge; hold the plan floor there. If sharks appear, stay put and with the group, keep your gear tucked in, and do not chase or touch them. Follow the crew's briefing; sightings are not promised. Medical care is far; confirm the boat’s oxygen and plan.",
      fitTone: "demanding",
      fitNote: "A varied site where the chute leads to a deep ledge. Hold your floor.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["caribbean-reef-shark", "black-grouper", "black-durgon", "black-coral"],
    },
  },
  {
    slug: "whiteface-west-caicos",
    version: 1,
    area: "turks-caicos-providenciales",
    sources: [
      "https://www.tcreef.org/s/TCI-Dive_Site_Summary_List_20_Oct_16.pdf",
      "https://diveprovo.com/dive-sites/",
      "https://dan.org/alert-diver/article/diving-in-the-turks-and-caicos-islands/",
    ],
    briefing: {
      // Advanced Open Water: a wall with a plan floor of 30 m.
      // Position: Turks & Caicos Reef Fund mooring list, 20 Oct 2016 (degrees and decimal minutes converted); mooring about 45 ft.
      name: "Whiteface",
      locationName: "West Caicos, Turks and Caicos",
      forecastLatitude: 21.6457,
      forecastLongitude: -72.475,
      description:
        "The site is named for the steep white cliffs on shore. A rich reef runs along the top of the wall with stands of pillar coral. North of the mooring, a large anchor sits wedged in a crack in the wall at about 21 m, and the wall is undercut to near 30 m.",
      marineLife: "Pillar coral · barracuda · parrotfish · French angelfish",
      marineLifeDescription:
        "Pillar coral stands crowd the reef top; barracuda, groupers and angelfish cruise over it.",
      difficultyLevel: "intermediate",
      depthRange: "14–30 m (45–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "Usually light; it can change, so carry an SMB. Current is not documented site by site; ask the crew on the day.",
      divePlan:
        "Down the mooring to about 14 m (45 ft), along the wall no deeper than 30 m (100 ft), and back up the reef with reserve gas. The wall drops far below this floor. Visit the anchor at 21 m (70 ft) and go no deeper. Medical care is far; confirm the boat’s oxygen and plan.",
      fitTone: "demanding",
      fitNote: "A pretty reef with an anchor to find. Hold your floor.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The anchor",
          kind: "pointOfInterest",
          note: "A large anchor sits wedged in a crack in the wall, north of the mooring, at about 21 m.",
        },
      ],
      creatureSlugs: ["pillar-coral", "great-barracuda", "french-angelfish", "nassau-grouper"],
    },
  },
  {
    slug: "double-d-french-cay",
    version: 1,
    area: "turks-caicos-providenciales",
    sources: [
      "https://www.tcreef.org/s/TCI-Dive_Site_Summary_List_20_Oct_16.pdf",
      "https://diveprovo.com/dive-sites/",
      "https://dan.org/alert-diver/article/diving-in-the-turks-and-caicos-islands/",
      "https://www.timespub.tc/2022/01/treasures-on-the-reef/",
    ],
    briefing: {
      // Advanced Open Water: a remote, exposed open-water wall where the reef meets current (Dive Provo, Alert Diver), plan floor 30 m.
      // Position: Turks & Caicos Reef Fund mooring list, 20 Oct 2016 (degrees and decimal minutes converted); mooring about 45 ft.
      name: "Double D",
      locationName: "French Cay, Turks and Caicos",
      forecastLatitude: 21.4898,
      forecastLongitude: -72.2071,
      description:
        "Two large pinnacles rise from the sea floor off French Cay's bird sanctuary, beside a wall that slopes gradually under a thick carpet of coral. Jacks, black durgon and groupers gather around the pinnacles, and reef sharks may be seen.",
      marineLife: "Jacks · black durgon · groupers · reef sharks",
      marineLifeDescription:
        "The pinnacles draw schools of jacks and durgon; large tube sponges make good wide-angle subjects.",
      difficultyLevel: "intermediate",
      depthRange: "14–30 m (45–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "Open to the sea off the French Cay bird sanctuary, where the reef meets current. Carry an SMB with line, stay with the group, and expect the trip to run only in good weather.",
      divePlan:
        "Down the mooring to about 14 m (45 ft), circle the two pinnacles, then follow the wall no deeper than 30 m (100 ft) and come back up the reef with reserve gas. The wall drops far below this floor. Sharks may appear: stay with the group, keep your gear tucked in, and do not chase or touch them. Staff confirm the diver’s log before boarding. Make the safety stop on the mooring line or an SMB. Medical care is far, a 60 to 90 minute boat run from Providenciales; confirm the boat’s oxygen and plan.",
      fitTone: "demanding",
      fitNote:
        "Open water, current and sharks, a long way from help. Stay with the group and hold your floor.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "black-durgon",
        "horse-eye-jack",
        "nassau-grouper",
        "caribbean-reef-shark",
        "spotted-eagle-ray",
      ],
    },
  },
  {
    slug: "g-spot-french-cay",
    version: 1,
    area: "turks-caicos-providenciales",
    sources: [
      "https://www.tcreef.org/s/TCI-Dive_Site_Summary_List_20_Oct_16.pdf",
      "https://diveprovo.com/dive-sites/",
      "https://dan.org/alert-diver/article/diving-in-the-turks-and-caicos-islands/",
      "https://www.timespub.tc/2022/01/treasures-on-the-reef/",
    ],
    briefing: {
      // Advanced Open Water: a remote, exposed open-water wall where the reef meets current, plan floor 30 m.
      // Position: Turks & Caicos Reef Fund mooring list, 20 Oct 2016 (degrees and decimal minutes converted); mooring about 45 ft.
      name: "G-Spot",
      locationName: "French Cay, Turks and Caicos",
      forecastLatitude: 21.4925,
      forecastLongitude: -72.2154,
      description:
        "You drop over a plateau of soft coral and reach the wall at a V-shaped notch with a sheer drop. The wall sides are busy with life, and the water behind you is open blue. Nurse sharks sleep or cruise on the shallow reef top, with reef sharks around.",
      marineLife: "Nurse sharks · reef sharks · soft corals",
      marineLifeDescription:
        "Look for nurse sharks on the reef top; keep checking the blue behind you.",
      difficultyLevel: "intermediate",
      depthRange: "14–30 m (45–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "Open blue water lies behind the notch, and the reef meets current. Carry an SMB with line, keep checking the group, and expect the trip to run only in good weather.",
      divePlan:
        "Down the mooring to about 14 m (45 ft), cross the plateau to the V-shaped notch, and hold no deeper than 30 m (100 ft) on the wall before returning over the reef top with reserve gas. The wall drops far below this floor. If sharks appear, stay put, keep your gear tucked in, and do not chase or touch them; sightings are not promised. Staff confirm the diver’s log before boarding. Make the safety stop on the mooring line or an SMB. Medical care is far, a 60 to 90 minute boat run from Providenciales; confirm the boat’s oxygen and plan.",
      fitTone: "demanding",
      fitNote: "A sheer corner with open blue behind you, far from help. Hold your floor.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["nurse-shark", "caribbean-reef-shark", "spotted-eagle-ray"],
    },
  },
  {
    slug: "rock-and-roll-french-cay",
    version: 1,
    area: "turks-caicos-providenciales",
    sources: [
      "https://www.tcreef.org/s/TCI-Dive_Site_Summary_List_20_Oct_16.pdf",
      "https://diveprovo.com/dive-sites/",
      "https://dan.org/alert-diver/article/diving-in-the-turks-and-caicos-islands/",
      "https://www.timespub.tc/2022/01/treasures-on-the-reef/",
    ],
    briefing: {
      // Advanced Open Water: a remote, exposed, near-vertical open-water wall that is dived in windy conditions (Dive Provo), plan floor 30 m.
      // Position: Turks & Caicos Reef Fund mooring list, 20 Oct 2016 (degrees and decimal minutes converted); mooring about 45 ft.
      name: "Rock and Roll",
      locationName: "French Cay, Turks and Caicos",
      forecastLatitude: 21.492,
      forecastLongitude: -72.2188,
      description:
        "A very vertical stretch of wall with grunts, groupers and sharks cruising along it. The name comes from the rough water that is common here.",
      marineLife: "Grunts · groupers · reef sharks",
      marineLifeDescription: "The wall holds the larger animals; sharks cruise along it.",
      difficultyLevel: "intermediate",
      depthRange: "14–30 m (45–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "The site gets its name from windy, rough conditions at French Cay, which is remote and open to the sea. Expect surface chop and current, carry an SMB with line, and stay with the group.",
      divePlan:
        "Down the mooring to about 14 m (45 ft) and along the near-vertical wall no deeper than 30 m (100 ft), then back up the reef with reserve gas. The wall drops far below this floor. If sharks appear, stay with the group and do not chase or touch them; sightings are not promised. Staff confirm the diver’s log before boarding, and in rough water the crew decides whether the dive runs. Make the safety stop on the mooring line or an SMB. Medical care is far, a 60 to 90 minute boat run from Providenciales; confirm the boat’s oxygen and plan.",
      fitTone: "demanding",
      fitNote: "A vertical wall that can be bumpy on the surface, far from help. Hold your floor.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["caribbean-reef-shark", "nassau-grouper", "french-grunt", "white-grunt"],
    },
  },
  {
    slug: "half-mile-reef-french-cay",
    version: 1,
    area: "turks-caicos-providenciales",
    sources: [
      "https://www.tcreef.org/s/TCI-Dive_Site_Summary_List_20_Oct_16.pdf",
      "https://diveprovo.com/dive-sites/",
      "https://dan.org/alert-diver/article/diving-in-the-turks-and-caicos-islands/",
      "https://www.timespub.tc/2022/01/treasures-on-the-reef/",
    ],
    briefing: {
      // Advanced Open Water: a remote, exposed wall where the reef meets current (the bowl is the sheltered part), plan floor 30 m.
      // Position: Turks & Caicos Reef Fund mooring list, 20 Oct 2016 (degrees and decimal minutes converted); mooring about 45 ft.
      name: "Half Mile Reef",
      locationName: "French Cay, Turks and Caicos",
      forecastLatitude: 21.498,
      forecastLongitude: -72.2074,
      description:
        "A reef about half a mile long lies east of French Cay. A large bowl in the wall breaks the current found elsewhere on the reef. Schools of barracuda and mahogany snappers fill it, and two big elephant ear sponges sit about 6 m (20 ft) apart at the 26 m contour.",
      marineLife: "Barracuda · mahogany snappers · reef sharks · elephant ear sponges",
      marineLifeDescription:
        "The bowl shelters big schools; reef sharks may shadow divers over the reef top.",
      difficultyLevel: "intermediate",
      depthRange: "14–30 m (45–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "Current meets the reef outside the bowl, and French Cay is remote and open to the sea. Carry an SMB with line, stay with the group, and expect the trip to run only in good weather.",
      divePlan:
        "Down the mooring to about 14 m (45 ft), work along the wall and the bowl no deeper than 30 m (100 ft), and come back up the reef with reserve gas. The wall drops far below this floor. Sharks may shadow the group over the reef top: keep your gear tucked in and do not chase or touch them. Staff confirm the diver’s log before boarding. Make the safety stop on the mooring line or an SMB. Medical care is far, a 60 to 90 minute boat run from Providenciales; confirm the boat’s oxygen and plan.",
      fitTone: "demanding",
      fitNote:
        "A wall with a sheltered bowl and open water outside it, far from help. Hold your floor.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "mahogany-snapper",
        "great-barracuda",
        "orange-elephant-ear-sponge",
        "caribbean-reef-shark",
      ],
    },
  },
];
