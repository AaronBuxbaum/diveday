// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Roatán and Cayos Cochinos. */
export const HONDURAS_ROATAN: DiveSiteTemplate[] = [
  // Denominator row: Black Rock
  {
    slug: "black-rock-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://web.archive.org/web/20260508085919/https://coconuttreedivers.com/scuba-diving-roatan/over-80-dive-sites-to-visit-in-caribbean-roatan-honduras/",
      "https://bluereefexplorers.com/diving/dive-sites",
      "https://roatanet.com/diving-guide-to-roatans-west-endsandy-bay-marine-reserve/",
    ],
    briefing: {
      name: "Black Rock",
      locationName: "West Bay, Roatán",
      forecastLatitude: 16.2703,
      forecastLongitude: -86.6029,
      description:
        "A wall at the southwest tip of the island, one of the four sites of The Point, where the flows along the island’s two coasts converge. The mooring sits at about 15 m (50 ft) and the wall below it falls away past recreational depth, with black coral, barrel sponges and sea fans along its face.",
      marineLife: "Black coral · barrel sponges · barracuda · creole wrasse",
      marineLifeDescription:
        "Sea fans and sponges crowd the wall, and schooling fish gather where the current is strongest.",
      difficultyLevel: "advanced",
      depthMinMeters: 15,
      maxDepthMeters: 30,
      currentNote:
        "Boats work this coast, so carry an SMB and listen for engines on the way up. Currents from both shores converge at the tip and the surface can be rough, so the site depends on the weather. It is run as a drift.",
      divePlan:
        "Down the mooring line to the lip of the wall at about 15 m, drift along it no deeper than 30 m (100 ft), and finish over the shallower top with reserve gas.",
      fitTone: "demanding",
      fitNote:
        "A drift on a wall that keeps falling, at the exposed end of the island. For divers who hold a depth without a reference.",
      // The wall drops far past recreational depth; the plan's floor of 30 m is the maximum, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The wall",
          kind: "reefFormation",
          note: "A wall that starts near 15 m (50 ft), hung with black coral, barrel sponges and sea fans.",
        },
      ],
      creatureSlugs: [
        "black-coral",
        "giant-barrel-sponge",
        "great-barracuda",
        "creole-wrasse",
        "common-sea-fan",
        "horse-eye-jack",
      ],
    },
  },
  // Denominator row: Mandy's Eel Garden (Temptation Reef)
  {
    slug: "mandys-eel-garden-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://roatansplashinn.com/en/roatan-diving-sites/mandys-eel-garden/",
      "https://sundiversroatan.com/2022/07/13/best-dive-sites-in-roatan/",
      "https://sundiversroatan.com/2026/02/24/discover-the-best-beginner-dive-sites-in-roatan-honduras/",
      "https://roatanet.com/diving-guide-to-roatans-west-endsandy-bay-marine-reserve/",
    ],
    briefing: {
      name: "Mandy's Eel Garden",
      locationName: "West Bay, Roatán",
      forecastLatitude: 16.2725,
      forecastLongitude: -86.6021,
      description:
        "A sand patch at the foot of a shallow reef wall just off West Bay beach, with garden eels on the sand. A short swim-through links the sand to the wall; it is an overhead, so stay out of it. The reef crest starts near 6 m (20 ft) and the base of the wall is about 20 m (65 ft).",
      marineLife: "Garden eels · spotted eagle rays · southern stingrays · green moray",
      marineLifeDescription:
        "The eels stay in their holes if you come too close, so watch from a few meters back. Peacock flounder and squid use the sand and coral heads.",
      difficultyLevel: "intermediate",
      depthMinMeters: 6,
      maxDepthMeters: 20,
      currentNote:
        "The site is off West Bay beach, so listen for engines on the way up and carry an SMB. Currents are mild.",
      divePlan:
        "Cross the sand patch to the wall and turn back along the crest. The short swim-through is an overhead; stay out of it. Watch the eels from the edge of the sand, which lies near 20 m (65 ft), and hold your depth there.",
      fitTone: "unknown",
      fitNote:
        "Shallow, clear and gentle along the crest, but the eel field sits at 20 m, so the site is held to Advanced Open Water.",
      // The eel field and the base of the wall are at about 20 m, past the 18 m Open Water limit, so the gate is Advanced Open Water. A shop that dives only the crest at 18 m or less can lower it.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Garden eel field",
          kind: "pointOfInterest",
          note: "Sand at the base of the wall, where the eels stand out of their burrows at about 20 m (65 ft).",
        },
      ],
      creatureSlugs: [
        "garden-eel",
        "spotted-eagle-ray",
        "southern-stingray",
        "green-moray",
        "peacock-flounder",
        "caribbean-reef-squid",
      ],
    },
  },
  // Denominator row: Butcher's Bank
  {
    slug: "butchers-bank-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://sundiversroatan.com/2026/02/24/discover-the-best-beginner-dive-sites-in-roatan-honduras/",
      "https://roatandivers.com/blog/the-best-dive-sites-in-roatan",
      "https://roatanet.com/diving-guide-to-roatans-west-endsandy-bay-marine-reserve/",
    ],
    briefing: {
      name: "Butcher's Bank",
      locationName: "West Bay, Roatán",
      forecastLatitude: 16.2786,
      forecastLongitude: -86.6042,
      description:
        "Sand patches and coral platforms on a shallow bank, with the wall further out. Pipefish, flounder and tube anemones live in the sand, and the coral platform is a place to look for turtles.",
      marineLife: "Pipefish · flounder · stingrays · jacks",
      marineLifeDescription:
        "Slow, close looking pays off on the sand, with jacks, snapper and parrotfish over the coral.",
      difficultyLevel: "beginner",
      depthMinMeters: 12,
      maxDepthMeters: 18,
      currentNote:
        "West Bay's boat traffic is close, so listen for engines on the way up and carry an SMB. Currents are low.",
      divePlan:
        "Work the sand patches and coral platform at 12 to 18 m (40 to 60 ft) and turn before the wall. The wall beyond the platform drops past the plan.",
      fitTone: "welcoming",
      fitNote: "Easy to read and good for a second dive, with small animals that reward slow fins.",
      landmarks: [
        {
          name: "Coral platform",
          kind: "reefFormation",
          note: "A platform of coral between the sand patches and the wall.",
        },
      ],
      creatureSlugs: [
        "southern-stingray",
        "horse-eye-jack",
        "gray-snapper",
        "stoplight-parrotfish",
      ],
    },
  },
  // Denominator row: Seaquest Deep (Sea Quest)
  {
    slug: "seaquest-deep-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://sundiversroatan.com/2022/07/13/best-dive-sites-in-roatan/",
      "https://sundiversroatan.com/2026/02/24/discover-the-best-beginner-dive-sites-in-roatan-honduras/",
      "https://roatandivers.com/blog/the-best-dive-sites-in-roatan",
      "https://roatanet.com/diving-guide-to-roatans-west-endsandy-bay-marine-reserve/",
    ],
    briefing: {
      name: "Seaquest Deep",
      locationName: "West End, Roatán",
      forecastLatitude: 16.2871,
      forecastLongitude: -86.6037,
      description:
        "Sandy plateaus ringed by patch reef, flowing out to a short wall. The mooring is in 12 m (40 ft), and the Roatán Marine Park's coral nursery trees stand here, so part of the dive is a swim through the nursery.",
      marineLife: "Coral nursery trees · stingrays · turtles · reef fish",
      marineLifeDescription:
        "Nursery fragments draw small fish, and the sand holds the occasional southern stingray.",
      difficultyLevel: "intermediate",
      depthMinMeters: 12,
      maxDepthMeters: 18,
      currentNote:
        "Current not documented; ask the crew on the day. Listen for engines on the way up and carry an SMB.",
      divePlan:
        "Down the mooring at 12 m, through the nursery and across the plateaus, and turn before the wall. The wall continues past the plan.",
      fitTone: "welcoming",
      fitNote:
        "A step beyond the shallow sites, because the mooring is already at 12 m. The dive itself asks little beyond a watch on gas and no-stop time.",
      landmarks: [
        {
          name: "Coral nursery trees",
          kind: "pointOfInterest",
          note: "The Roatán Marine Park's coral nursery, where fragments are grown on frames in the water column.",
        },
      ],
      creatureSlugs: ["southern-stingray", "staghorn-coral", "elkhorn-coral", "peacock-flounder"],
    },
  },
  // Denominator row: The Chief's Quarters
  {
    slug: "chiefs-quarters-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://sundiversroatan.com/2026/02/24/discover-the-best-beginner-dive-sites-in-roatan-honduras/",
    ],
    briefing: {
      name: "The Chief's Quarters",
      locationName: "West End, Roatán",
      forecastLatitude: 16.2943,
      forecastLongitude: -86.6021,
      description:
        "A coral ridge on a gentle slope, mostly at 9 to 15 m (30 to 50 ft), and a coral outplanting site. Schools of fish gather over the ridge and a nurse shark sometimes lies in the sand.",
      marineLife: "Schooling fish · nurse shark · hard corals",
      marineLifeDescription:
        "Schools sit over the ridge, and the sand beside it is where a nurse shark rests.",
      difficultyLevel: "beginner",
      depthMinMeters: 8,
      maxDepthMeters: 15,
      currentNote:
        "Currents are minimal on most days. Listen for engines on the way up and carry an SMB.",
      divePlan:
        "Follow the ridge along its length at 9 to 15 m (30 to 50 ft) and return along the same line.",
      fitTone: "welcoming",
      fitNote:
        "Shallow, easy to navigate and calm, which makes it a common first reef dive for new divers.",
      landmarks: [
        {
          name: "Coral outplant area",
          kind: "pointOfInterest",
          note: "Restored coral on the ridge. Keep fins and hands clear of the young colonies.",
        },
      ],
      creatureSlugs: ["nurse-shark", "sergeant-major", "bluehead-wrasse", "french-grunt"],
    },
  },
  // Denominator row: Lighthouse (Lighthouse Reef)
  {
    slug: "lighthouse-reef-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://web.archive.org/web/20260508085919/https://coconuttreedivers.com/scuba-diving-roatan/over-80-dive-sites-to-visit-in-caribbean-roatan-honduras/",
      "https://roatandivers.com/blog/the-best-dive-sites-in-roatan",
      "https://roatanet.com/diving-guide-to-roatans-west-endsandy-bay-marine-reserve/",
    ],
    briefing: {
      name: "Lighthouse Reef",
      locationName: "West End, Roatán",
      forecastLatitude: 16.3047,
      forecastLongitude: -86.5977,
      description:
        "A shallow reef beside the West End channel, with a sand patch and a vertical wall nearby. A short boat ride from West End, and a common site for students.",
      marineLife: "Hawksbill turtles · black grouper · blue tang",
      marineLifeDescription: "Turtles, groupers and schools of blue tang work the shallow top.",
      difficultyLevel: "beginner",
      depthMinMeters: 6,
      maxDepthMeters: 18,
      currentNote:
        "The site is near the West End channel and its boat traffic, so listen for engines, carry an SMB, and surface only after checking above you. Currents are not documented; ask the crew on the day.",
      divePlan:
        "Stay on the shallow reef and sand patch, visit the top of the wall at 18 m (60 ft) at most, and return along the reef. The wall below falls away past the plan.",
      fitTone: "welcoming",
      fitNote: "Close to the dock and shallow, with a wall to look over.",
      landmarks: [
        {
          name: "Sand patch",
          kind: "pointOfInterest",
          note: "A sand patch near the channel, a long-used spot for open water training.",
        },
      ],
      creatureSlugs: [
        "hawksbill-turtle",
        "black-grouper",
        "blue-tang",
        "sergeant-major",
        "french-grunt",
      ],
    },
  },
  // Denominator row: Moonlight
  {
    slug: "moonlight-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://web.archive.org/web/20260508085919/https://coconuttreedivers.com/scuba-diving-roatan/over-80-dive-sites-to-visit-in-caribbean-roatan-honduras/",
      "https://roatandivers.com/blog/the-best-dive-sites-in-roatan",
    ],
    briefing: {
      name: "Moonlight",
      locationName: "West End, Roatán",
      forecastLatitude: 16.3055,
      forecastLongitude: -86.5974,
      description:
        "A bright, shallow reef with a vertical stretch of wall close at hand, a short boat ride from the West End docks.",
      marineLife: "Hawksbill turtles · black grouper · blue tang",
      marineLifeDescription: "Turtles and groupers on the reef top, and blue tang in schools.",
      difficultyLevel: "beginner",
      depthMinMeters: 6,
      maxDepthMeters: 18,
      currentNote:
        "Currents are not documented; ask the crew on the day. Boats from West End pass nearby, so carry an SMB and listen for engines.",
      divePlan:
        "Stay on the shallow reef, look over the wall from no deeper than 18 m (60 ft), and come back along the top. The wall falls away past the plan.",
      fitTone: "welcoming",
      fitNote:
        "Shallow and close to the dock, with a wall to look over for divers with a plan to turn.",
      creatureSlugs: [
        "hawksbill-turtle",
        "black-grouper",
        "blue-tang",
        "sergeant-major",
        "french-grunt",
      ],
    },
  },
  // Denominator row: Dixie's Place
  {
    slug: "dixies-place-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://web.archive.org/web/20260508085919/https://coconuttreedivers.com/scuba-diving-roatan/over-80-dive-sites-to-visit-in-caribbean-roatan-honduras/",
      "https://www.roatandivingnativesons.com/fun-dives-1",
      "https://roatanet.com/diving-guide-to-roatans-west-endsandy-bay-marine-reserve/",
    ],
    briefing: {
      name: "Dixie's Place",
      locationName: "West End, Roatán",
      forecastLatitude: 16.3065,
      forecastLongitude: -86.5974,
      description:
        "One of three moorings on the wall off West End, running from the shallows to well past recreational depth. Gorgonians, orange elephant ear sponges and overhangs line the deeper face, and flamingo tongues sit on the fans in the shallows.",
      marineLife: "Gorgonians · elephant ear sponges · lobsters · flamingo tongues",
      marineLifeDescription:
        "Lobsters and crabs sit in the crevices, and flamingo tongue snails are on the sea fans in the shallows.",
      difficultyLevel: "advanced",
      depthMinMeters: 3,
      maxDepthMeters: 18,
      currentNote:
        "The wall sits off the West End shore, so listen for engines on the way up and carry an SMB. It shares the wall with Half Moon Bay, where the current usually runs north and some days carries you past several sites; ask the crew before you go.",
      divePlan:
        "Drop to the top of the wall, follow the shallow channels and coral fingers, and stay at or above 18 m (60 ft). The wall falls away past the plan.",
      fitTone: "demanding",
      fitNote:
        "A wall dive that can be kept shallow, on a wall whose current can sweep a group along it.",
      // Gated Advanced Open Water: the wall is shared with the Half Moon Bay mooring, whose sources describe a current that can carry divers past several sites. The plan floor of 18 m is the plan's own; the wall falls away past it.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The wall",
          kind: "reefFormation",
          note: "A vertical wall off the West End shore, shared with the Half Moon Bay and Divemaster's Choice moorings.",
        },
      ],
      creatureSlugs: [
        "spiny-lobster",
        "flamingo-tongue",
        "orange-elephant-ear-sponge",
        "common-sea-fan",
        "creole-wrasse",
      ],
    },
  },
  // Denominator row: Hole in the Wall
  {
    slug: "hole-in-the-wall-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://roatansplashinn.com/en/roatan-diving-sites/hole-in-the-wall/",
      "https://web.archive.org/web/20260508085919/https://coconuttreedivers.com/scuba-diving-roatan/over-80-dive-sites-to-visit-in-caribbean-roatan-honduras/",
      "https://www.roatandivingnativesons.com/fun-dives-1",
      "https://roatanet.com/diving-guide-to-roatans-west-endsandy-bay-marine-reserve/",
      "https://roatandivers.com/blog/the-best-dive-sites-in-roatan",
    ],
    briefing: {
      name: "Hole in the Wall",
      locationName: "West End, Roatán",
      forecastLatitude: 16.3138,
      forecastLongitude: -86.5918,
      description:
        "A sand chute that tunnels down through the wall from about 12 m (40 ft) and comes out on the deep face at about 30 m (100 ft), a little deeper by some accounts. Shallow canyons lie on top of the wall; their swim-throughs are overheads, so stay out. The wall keeps falling past the chute.",
      marineLife: "Eagle rays · turtles · creole wrasse · glassy sweepers",
      marineLifeDescription:
        "Rays and turtles pass along the wall, with glassy sweepers in the shallows and silversides in the late summer.",
      difficultyLevel: "advanced",
      depthMinMeters: 12,
      maxDepthMeters: 33,
      currentNote:
        "Boats work the West End coast, so carry an SMB and listen for engines on the way up. The wall is exposed to open water. Currents are not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring to the top of the sand chute, along the open wall no deeper than 27 m (90 ft), and back up the mooring line for the safety stop. Do not go through the chute: it is described as a tunnel that comes out at 30 to 33 m, so the plan's floor of 27 m keeps divers 3 m above the exit mouth. The slope below the exit and the abyss lie past the plan. The chute, the cave system at the end of the canyons and every roofed passage are overheads; stay out.",
      fitTone: "demanding",
      fitNote:
        "The deep dive of the West End, kept here to a 27 m floor, above the chute exit. The chute and the cave at the end of the canyons are overheads and stay out of the plan.",
      // The chute starts at 40 ft (12 m) and exits at 100 to 110 ft (30 to 33 m) in the sources. Operators run the full dive to 40 m (130 ft) as a Deep dive, and one calls the actual hole technical. The exit mouth at 33 m is a bounded structure the prose names, so maxDepthMeters is 33 and the gate is Advanced Open Water with the Deep specialty; the plan's own floor is 27 m, 3 m above the mouth.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "The sand chute",
          kind: "reefFormation",
          note: "A sand chute tunnel through the wall that starts near 12 m (40 ft) and comes out on the deep face at about 30 m (100 ft).",
        },
        {
          name: "Swiss-cheese canyons",
          kind: "reefFormation",
          note: "Shallow canyons on top of the wall. Where they are roofed they are overheads; stay out.",
        },
      ],
      creatureSlugs: [
        "spotted-eagle-ray",
        "creole-wrasse",
        "blue-tang",
        "glassy-sweeper",
        "spotted-scorpionfish",
        "nurse-shark",
        "spotted-drum",
      ],
    },
  },
  // Denominator row: Pillar Coral
  {
    slug: "pillar-coral-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://web.archive.org/web/20260508085919/https://coconuttreedivers.com/scuba-diving-roatan/over-80-dive-sites-to-visit-in-caribbean-roatan-honduras/",
      "https://www.roatandivingnativesons.com/fun-dives-1",
      "https://roatanet.com/diving-guide-to-roatans-west-endsandy-bay-marine-reserve/",
    ],
    briefing: {
      name: "Pillar Coral",
      locationName: "Sandy Bay, Roatán",
      forecastLatitude: 16.3263,
      forecastLongitude: -86.5809,
      description:
        "A pinnacle of coral standing off the wall at about 27 m (90 ft), between Overheat Reef and the El Aguila wreck. A drift in either direction along the top of the wall, with fish crowded along the edge.",
      marineLife: "Pillar coral · grunts · parrotfish · blue tang",
      marineLifeDescription:
        "Schools of sergeant majors, grunts and chubs stack up along the top of the wall.",
      difficultyLevel: "intermediate",
      depthMinMeters: 11,
      maxDepthMeters: 30,
      currentNote:
        "Run as a drift in either direction. The wreck next door is popular, so expect boat and diver traffic: listen for engines and carry an SMB.",
      divePlan:
        "Drop to the top of the wall near 11 m, drift along it, visit the pinnacle at 27 m (90 ft) at the deepest, and come back up the reef. The swim-through cavern by the mooring is an overhead; stay out.",
      fitTone: "demanding",
      fitNote:
        "A drift along a wall with a pinnacle at 27 m, for divers who like to choose their own depth. ",
      // The wall falls away past recreational depth. The pinnacle at 27 m is the deepest feature briefed, so the plan holds 30 m and the gate is Advanced Open Water.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The pinnacle",
          kind: "reefFormation",
          note: "A coral pinnacle that stands off the wall at about 27 m (90 ft).",
        },
      ],
      creatureSlugs: [
        "pillar-coral",
        "french-grunt",
        "blue-tang",
        "sergeant-major",
        "bermuda-chub",
      ],
    },
  },
  // Denominator row: Overheat Reef
  {
    slug: "overheat-reef-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://web.archive.org/web/20260508085919/https://coconuttreedivers.com/scuba-diving-roatan/over-80-dive-sites-to-visit-in-caribbean-roatan-honduras/",
      "https://roatanet.com/diving-guide-to-roatans-west-endsandy-bay-marine-reserve/",
    ],
    briefing: {
      name: "Overheat Reef",
      locationName: "Sandy Bay, Roatán",
      forecastLatitude: 16.3234,
      forecastLongitude: -86.5829,
      description: "A reef and wall in Sandy Bay with canyons and small critters in the shallows.",
      marineLife: "Hawksbill turtles · black grouper · neck crabs",
      marineLifeDescription:
        "Turtles and groupers on the shallow reef, and neck crabs in the rubble and sponges.",
      difficultyLevel: "beginner",
      depthMinMeters: 9,
      maxDepthMeters: 18,
      currentNote:
        "Currents are not documented; ask the crew on the day. Boats from Sandy Bay use the mooring, so listen for engines and carry an SMB.",
      divePlan:
        "Stay on the shallow reef, go to the top of the wall at 18 m (60 ft) at most, and return along the reef. The wall below falls away past the plan.",
      fitTone: "welcoming",
      fitNote: "A bright shallow reef that is easy to shorten, with a wall to look over.",
      creatureSlugs: [
        "hawksbill-turtle",
        "black-grouper",
        "blue-tang",
        "sergeant-major",
        "french-grunt",
      ],
    },
  },
  // Denominator row: Spooky Channel
  {
    slug: "spooky-channel-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://roatansplashinn.com/en/roatan-diving-sites/spooky-channel/",
      "https://web.archive.org/web/20260508085919/https://coconuttreedivers.com/scuba-diving-roatan/over-80-dive-sites-to-visit-in-caribbean-roatan-honduras/",
      "https://www.roatandivingnativesons.com/fun-dives-1",
      "https://roatanet.com/diving-guide-to-roatans-west-endsandy-bay-marine-reserve/",
      "https://sundiversroatan.com/2022/07/13/best-dive-sites-in-roatan/",
    ],
    briefing: {
      name: "Spooky Channel",
      locationName: "Sandy Bay, Roatán",
      forecastLatitude: 16.3394,
      forecastLongitude: -86.5645,
      description:
        "An old river gorge that links the murky lagoon to the outer reef, named for its low light. The channel is narrow and about 29 m (95 ft) deep, and its walls close to a gap only about 1.5 m (5 ft) wide near the surface. The dive here stays on the outer reef at the mouth, because the channel itself is an overhead dive.",
      marineLife: "Starfish · lobsters · snapper · barracuda",
      marineLifeDescription:
        "The channel itself holds little life. Snapper, grouper and barracuda wait near the mooring on the outer reef.",
      difficultyLevel: "advanced",
      depthMinMeters: 11,
      maxDepthMeters: 30,
      currentNote:
        "Water from the lagoon mixes in and can leave the visibility poor. Currents are not documented; ask the crew on the day.",
      divePlan:
        "Down the outer mooring to the reef and the wall at the mouth of the channel, no deeper than 30 m (100 ft), and stay in daylight. Do not enter the channel at all; it is an overhead. The swim-throughs that lead to the shallow reef are overheads too; stay out. The wall below the plan falls away.",
      fitTone: "demanding",
      fitNote:
        "The channel is dark, deep and closed overhead, so it is not part of this plan. The outer wall suits an Advanced diver who watches depth.",
      // The channel is 29 m (95 ft) deep, has a roof gap about 1.5 m wide, and loses light in its deeper parts, so it lies beyond a cavern's light zone: stay-out prose, no Cavern gate. The plan keeps to the outer reef and wall, whose floor is 30 m, so the gate is Advanced Open Water.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "cushion-sea-star",
        "spiny-lobster",
        "great-barracuda",
        "schoolmaster-snapper",
        "black-grouper",
      ],
    },
  },
  // Denominator row: Bear's Den
  {
    slug: "bears-den-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://roatansplashinn.com/en/roatan-diving-sites/bears-den/",
      "https://roatanet.com/diving-guide-to-roatans-west-endsandy-bay-marine-reserve/",
      "https://web.archive.org/web/20260508085919/https://coconuttreedivers.com/scuba-diving-roatan/over-80-dive-sites-to-visit-in-caribbean-roatan-honduras/",
      "https://sundiversroatan.com/2022/07/13/best-dive-sites-in-roatan/",
    ],
    briefing: {
      name: "Bear's Den",
      locationName: "Sandy Bay, Roatán",
      forecastLatitude: 16.3368,
      forecastLongitude: -86.5689,
      description:
        "A cavern site on the north shore. At the top of a honeycombed coral wall, a large cavern opens at about 8 to 9 m (25 to 30 ft), with sunbeams on a sandy floor and glassy sweepers. A narrow 36 m (120 ft) chimney chute at about 15 m (50 ft) also leads to the wall, and it is not part of this dive.",
      marineLife: "Glassy sweepers · nudibranchs · spotted drum · seahorses",
      marineLifeDescription:
        "Glassy sweepers hang in the light shafts, and lettuce-leaf sea slugs and spotted drum live on the rocks at the entrance.",
      difficultyLevel: "advanced",
      depthMinMeters: 8,
      maxDepthMeters: 15,
      currentNote:
        "Currents are not documented; ask the crew on the day. The cavern is small, so wait outside until the guide calls your group.",
      divePlan:
        "Staff confirm the diver’s log before boarding. Carry a primary and a backup light, and turn on thirds. Down the mooring and along the open wall, then swim in at the cavern entrance at the top of the wall. Cavern-trained divers go in only as far as the daylight, in sight of the entrance. The guide sets the order, and one small group is inside at a time. The chimney chute, the volcanic tunnels and the swim-throughs past the mooring are overheads; stay out.",
      fitTone: "demanding",
      fitNote:
        "A small cavern entered one group at a time. For divers with cavern training, led by a guide who knows it.",
      // Overhead cavern, so Cavern is required, with Advanced Open Water because the sources rate the site Advanced. The plan stays in the lit entrance zone; the 36 m chimney chute and the tunnels beyond are stay-out. Depth is 15 m or less.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["cavern"],
      landmarks: [
        {
          name: "Chimney swim-through",
          kind: "reefFormation",
          note: "A narrow tunnel about 36 m (120 ft) long at 15 m (50 ft) that opens onto a honeycombed coral wall. Not part of the dive.",
        },
        {
          name: "The cavern",
          kind: "reefFormation",
          note: "A small circular chamber with a sandy floor, entered at the top of the wall near 8 to 9 m (25 to 30 ft).",
        },
      ],
      creatureSlugs: [
        "glassy-sweeper",
        "spotted-drum",
        "lettuce-sea-slug",
        "longsnout-seahorse",
        "spiny-lobster",
        "black-coral",
      ],
    },
  },
  // Denominator row: White Hole
  {
    slug: "white-hole-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://roatansplashinn.com/en/roatan-diving-sites/white-hole/",
      "https://roatanet.com/diving-guide-to-roatans-west-endsandy-bay-marine-reserve/",
    ],
    briefing: {
      name: "White Hole",
      locationName: "Sandy Bay, Roatán",
      forecastLatitude: 16.3376,
      forecastLongitude: -86.5664,
      description:
        "A round patch of white sand at 11 m (35 ft) surrounded by coral heads, with the wall beyond. The reef forms a plateau near 18 m (60 ft) and then falls off the wall.",
      marineLife: "Shrimp · anemones · lobsters · schooling fish",
      marineLifeDescription:
        "Anemones, shrimp and lobsters live on the coral heads, and big schools come in from the blue along the wall.",
      difficultyLevel: "intermediate",
      depthMinMeters: 11,
      maxDepthMeters: 30,
      currentNote:
        "Currents are not documented; ask the crew on the day. Carry an SMB at the wall. A night dive needs a guide.",
      divePlan:
        "Start on the sand patch at 11 m, follow the coral heads to the plateau near 18 m (60 ft), and go no deeper than 30 m (100 ft) on the wall. The sand slope and the wall below fall away past the plan.",
      fitTone: "demanding",
      fitNote: "A relaxed dive that can be stretched along a wall. Keep the depth under control.",
      // The wall falls away past recreational depth; the plan's floor of 30 m is the maximum, so the gate is Advanced Open Water.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The white sand patch",
          kind: "pointOfInterest",
          note: "A circular patch of sand at 11 m (35 ft) where the dive starts.",
        },
      ],
      creatureSlugs: [
        "spiny-lobster",
        "giant-anemone",
        "banded-coral-shrimp",
        "pederson-cleaner-shrimp",
      ],
    },
  },
  // Denominator row: El Aguila (Deep Eel Garden)
  {
    slug: "el-aguila-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://anthonyskey.com/dive-sites/",
      "https://web.archive.org/web/20260508085919/https://coconuttreedivers.com/scuba-diving-roatan/over-80-dive-sites-to-visit-in-caribbean-roatan-honduras/",
      "https://www.roatandivingnativesons.com/fun-dives-1",
      "https://sundiversroatan.com/diving/roatan-wreck-diving/",
      "https://bluereefexplorers.com/diving/dive-sites",
    ],
    briefing: {
      name: "El Aguila",
      locationName: "Sandy Bay, Roatán",
      forecastLatitude: 16.3275,
      forecastLongitude: -86.579,
      description:
        "A cargo ship of about 65 to 70 m (210 to 230 ft), sunk on purpose in 1997 and split into three sections by Hurricane Mitch the following year. She lies on a sand patch near 33 m (110 ft) with garden eels around the stern, and the dive usually ends on the wall behind her.",
      marineLife: "Groupers · garden eels · green moray · southern stingrays",
      marineLifeDescription:
        "Big groupers and snappers circle the hull, garden eels cover the sand, and blennies and nudibranchs live on the mast.",
      difficultyLevel: "advanced",
      depthMinMeters: 24,
      maxDepthMeters: 33,
      currentNote:
        "Boat and diver traffic is heavy on this popular wreck, so listen for engines, carry an SMB, and ascend along the line or the wall. Currents are not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring to the stern, forward along the outside of the wreck for about 15 minutes, then up the wall to the reef for the stop. Stay outside the hull. The small cave and the cavern on the wall are overheads; stay out.",
      fitTone: "demanding",
      fitNote:
        "Deep, popular and busy. A deep wreck for a diver with the card who tracks gas and no-stop time.",
      // Sand at 33 m (110 ft), so Advanced Open Water and Deep. Sources give 30 to 33 m for the sand; the deeper is used.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "The mast",
          kind: "wreckFeature",
          note: "The intact mast, covered with sponges and small life.",
        },
        {
          name: "The stern and garden eels",
          kind: "wreckFeature",
          note: "The stern rises from sand carpeted with swaying garden eels.",
        },
      ],
      creatureSlugs: [
        "black-grouper",
        "garden-eel",
        "green-moray",
        "midnight-parrotfish",
        "schoolmaster-snapper",
      ],
    },
  },
  // Denominator row: The Odyssey
  {
    slug: "odyssey-wreck-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://anthonyskey.com/dive-sites/",
      "https://www.roatandivingnativesons.com/fun-dives-1",
      "https://sundiversroatan.com/diving/roatan-wreck-diving/",
      "https://www.roatandivecenter.com/roatan-wreck-dives",
      "https://roatansplashinn.com/en/roatan-diving-sites/the-odyssey/",
    ],
    briefing: {
      name: "The Odyssey",
      locationName: "Sandy Bay, Roatán",
      forecastLatitude: 16.3523,
      forecastLongitude: -86.5443,
      description:
        "The biggest wreck on Roatán, a cargo ship of about 90 m sunk in 2002 on a sand flat. The top of the mast is at 12 m (40 ft), the cargo-hold level near 24 m (80 ft), the bow at 33 m (107 ft) and the stern at 37 m (120 ft). The stern stands almost upright.",
      marineLife: "Barracuda · snapper · groupers · fan corals",
      marineLifeDescription:
        "Barracuda hold over the hull, schools of snapper move through, and coral has begun to grow along the cargo hull.",
      difficultyLevel: "advanced",
      depthMinMeters: 12,
      maxDepthMeters: 37,
      currentNote:
        "Boat traffic uses the wreck, so listen for engines and carry an SMB. Currents are not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring, along the outside of the superstructure and the cargo level, no deeper than 37 m (120 ft) at the stern, then to the reef wall for the stop. Stay outside the hull.",
      fitTone: "demanding",
      fitNote:
        "Large enough that several boats can dive it at once, and deep enough to be treated as a deep dive. ",
      // The stern is at 37 m (120 ft) and sources give the sand at 30 to 35 m, so Advanced Open Water and Deep. The deepest figure, from the resort that owns her, is used.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "The mast",
          kind: "wreckFeature",
          note: "The top of the mast at about 12 m (40 ft), the shallowest part of the wreck.",
        },
        {
          name: "The stern",
          kind: "wreckFeature",
          note: "The stern, almost upright and the deepest point at about 37 m (120 ft).",
        },
      ],
      creatureSlugs: [
        "great-barracuda",
        "schoolmaster-snapper",
        "red-rope-sponge",
        "common-sea-fan",
      ],
    },
  },
  // Denominator row: Mary's Place
  {
    slug: "marys-place-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://cocoviewresort.com/?p=500",
      "https://www.roatandivecenter.com/roatan-dive-sites",
      "https://sundiversroatan.com/2022/07/13/best-dive-sites-in-roatan/",
      "https://bluereefexplorers.com/diving/dive-sites",
      "https://roatanet.com/diving-guide-to-roatans-west-endsandy-bay-marine-reserve/",
    ],
    briefing: {
      name: "Mary's Place",
      locationName: "South shore, Roatán",
      forecastLatitude: 16.3377,
      forecastLongitude: -86.4686,
      description:
        "A south shore plateau split by an old earthquake into deep crevices. The mooring is at about 9 m (30 ft), the plateau falls to 18 m (60 ft), and the crevices run to about 30 m (100 ft) before they end on a wall. The walls and the sand below them fall away past recreational depth.",
      marineLife: "Black coral · horse-eye jacks · sea fans · channel clinging crabs",
      marineLifeDescription:
        "Black coral and sea fans cover the crevice walls, and schools of horse-eye jacks move through.",
      difficultyLevel: "advanced",
      depthMinMeters: 9,
      maxDepthMeters: 30,
      currentNote:
        "The south shore is often windy with rough water, so the trip depends on the weather. Currents are not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring onto the plateau, along the lips of the crevices and out along the outer face of the wall no deeper than 30 m (100 ft), then up the reef with reserve gas. Do not descend into the crevices, and stay out of any enclosed swim-through; both are overheads.",
      fitTone: "demanding",
      fitNote:
        "Delicate corals and sponges, so excellent buoyancy matters here. Not for novices, and the weather decides whether it is possible.",
      // The crevices and walls drop past recreational depth; the plan's floor of 30 m is the maximum, so the gate is Advanced Open Water. The plan stays on the lips and the outer faces and never enters the crevices, so no Cavern specialty.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The crevices",
          kind: "reefFormation",
          note: "A system of deep cracks through the plateau, coated in hard and soft corals, that ends on the wall.",
        },
        {
          name: "The plateau",
          kind: "reefFormation",
          note: "A plateau shaped like an elbow, from about 9 m (30 ft) at the mooring to 18 m (60 ft) at its tip.",
        },
      ],
      creatureSlugs: [
        "black-coral",
        "horse-eye-jack",
        "common-sea-fan",
        "giant-barrel-sponge",
        "channel-clinging-crab",
        "spiny-lobster",
      ],
    },
  },
  // Denominator row: Shark Dive (Cara a Cara, Marco's Place)
  {
    slug: "shark-dive-cara-a-cara-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://www.roatandivecenter.com/roatan-dive-sites",
      "https://anthonyskey.com/dive-sites/",
      "https://bluereefexplorers.com/diving/dive-sites",
      "https://roatanet.com/diving-guide-to-roatans-west-endsandy-bay-marine-reserve/",
    ],
    briefing: {
      name: "Roatán Shark Dive (Cara a Cara)",
      locationName: "Airport Banks, Roatán",
      forecastLatitude: 16.2874,
      forecastLongitude: -86.5201,
      description:
        "A scheduled, provisioned dive on the offshore bank opposite the airport: the sharks are drawn in with bait, and Caribbean reef sharks gather at about 21 to 24 m (70 to 80 ft). Operators run it with a group of 8 to 15 divers and a briefing. Sharks gather on the bait, and numbers vary.",
      marineLife: "Caribbean reef sharks · coral heads · reef fish",
      marineLifeDescription:
        "Reef sharks gather on the bait and move along the coral in front of the group. Numbers vary, and no animal is promised.",
      difficultyLevel: "advanced",
      depthMinMeters: 18,
      maxDepthMeters: 24,
      currentNote:
        "Ships use the Coxen Hole and Mahogany Bay approaches near this bank, so listen for engines and carry an SMB. It is open water on a bank about 20 minutes offshore by boat. Currents are not documented; ask the crew on the day. Medical care is far; confirm the boat's oxygen and plan.",
      divePlan:
        "Down the mooring line to about 21 m (70 ft), watch from where the guide places the group, and follow the crew's briefing for the whole dive. Stay put, keep the group together, keep nothing dangling, and never chase or touch a shark. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote:
        "An observation dive with sharks drawn in by bait, not a free swim. Follow the crew's briefing exactly.",
      // The viewing depth is 21 to 24 m (70 to 80 ft) in open water with sharks, so Advanced Open Water is the conservative reading.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The viewing area",
          kind: "pointOfInterest",
          note: "The coral area at the end of the mooring line, near 21 m (70 ft), where the group watches the sharks.",
        },
      ],
      creatureSlugs: ["caribbean-reef-shark", "creole-wrasse", "blue-tang", "sergeant-major"],
    },
  },
  // Denominator row: Insidious Reef (Insidious Wall)
  {
    slug: "insidious-reef-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://roatansplashinn.com/en/roatan-diving-sites/insidious-wall/",
      "https://bluereefexplorers.com/diving/dive-sites",
      "https://www.roatandivecenter.com/roatan-dive-sites",
      "https://roatanet.com/diving-guide-to-roatans-west-endsandy-bay-marine-reserve/",
    ],
    briefing: {
      name: "Insidious Reef",
      locationName: "Airport Banks, Roatán",
      forecastLatitude: 16.2933,
      forecastLongitude: -86.5188,
      description:
        "A sloping offshore bank roughly 800 m south of the main reef. The crest starts at about 16 m (52 ft) and then plunges toward the deep trench, with black coral, pillar coral and boulder coral along the wall.",
      marineLife: "Black coral · pillar coral · triggerfish · barracuda",
      marineLifeDescription:
        "Triggerfish, hogfish and barracuda cruise the crest, and the wall holds many kinds of coral.",
      difficultyLevel: "intermediate",
      depthMinMeters: 16,
      maxDepthMeters: 30,
      currentNote:
        "Ships use the Coxen Hole and Mahogany Bay approaches near this bank, so listen for engines and carry an SMB. It is open water offshore, so the trip depends on the weather. Currents are not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring to the crest at about 16 m, along the wall no deeper than 30 m (100 ft), and back up the crest. The wall falls away past the plan.",
      fitTone: "demanding",
      fitNote: "A wall dive that is not hard but is deep and offshore; good buoyancy matters.",
      // The wall plunges far past recreational depth; the plan's floor of 30 m is the maximum, so the gate is Advanced Open Water.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The crest",
          kind: "reefFormation",
          note: "The top of the bank at about 16 m (52 ft), before the wall drops away.",
        },
      ],
      creatureSlugs: [
        "black-coral",
        "pillar-coral",
        "ocean-triggerfish",
        "queen-triggerfish",
        "great-barracuda",
        "hogfish",
      ],
    },
  },
  // Denominator row: John's Spot
  {
    slug: "johns-spot-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://cocoviewresort.com/?p=500",
    ],
    briefing: {
      name: "John's Spot",
      locationName: "Barefoot Cay, Roatán",
      forecastLatitude: 16.3337,
      forecastLongitude: -86.473,
      description:
        "Coral ridges on the upper reef lead to the edge of the wall at about 12 m (40 ft). The wall is steep, covered in sponges, and ends at a sand channel, with large overhangs. It falls away past recreational depth.",
      marineLife: "Sponges · hard corals · reef fish",
      marineLifeDescription:
        "Big sponges make the overhangs, and the dense hard coral on top holds reef fish.",
      difficultyLevel: "intermediate",
      depthMinMeters: 6,
      maxDepthMeters: 18,
      currentNote:
        "Growth on the wall moves in the current. Currents are not documented; ask the crew on the day.",
      divePlan:
        "Follow the coral ridges to the edge of the wall at 12 m (40 ft), look over from no deeper than 18 m (60 ft), and come back along the ridge. The wall below falls away past the plan.",
      fitTone: "welcoming",
      fitNote: "A shallow reef top with a wall to look over; the floor is the diver's to hold.",
      landmarks: [
        {
          name: "The wall edge",
          kind: "reefFormation",
          note: "The lip of a steep, sponge-covered wall at about 12 m (40 ft).",
        },
      ],
      creatureSlugs: [
        "giant-barrel-sponge",
        "orange-elephant-ear-sponge",
        "common-sea-fan",
        "creole-wrasse",
      ],
    },
  },
  // Denominator row: Cemetery Wall
  {
    slug: "cemetery-wall-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://sundiversroatan.com/2022/07/13/best-dive-sites-in-roatan/",
    ],
    briefing: {
      name: "Cemetery Wall",
      locationName: "Barefoot Cay, Roatán",
      forecastLatitude: 16.3366,
      forecastLongitude: -86.4717,
      description:
        "A sheer wall on the south shore with fields of flowing soft corals. The mooring is at about 9 m (30 ft).",
      marineLife: "Soft corals · sponges · reef fish",
      marineLifeDescription: "Soft corals sway on the wall in the current.",
      difficultyLevel: "advanced",
      depthMinMeters: 9,
      maxDepthMeters: 30,
      currentNote:
        "The south side is unpredictable, so the trip depends on the weather. Currents are not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring to the top of the wall, along it no deeper than 30 m (100 ft), and back up the reef. The wall falls away past the plan.",
      fitTone: "demanding",
      fitNote: "A south shore wall that is visited only when the weather allows.",
      // Sheer wall that drops past recreational depth; the plan's floor of 30 m is the maximum, so the gate is Advanced Open Water.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["common-sea-fan", "giant-barrel-sponge", "creole-wrasse", "sergeant-major"],
    },
  },
  // Denominator row: Mr. Bud
  {
    slug: "mr-bud-wreck-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://cocoviewresort.com/?p=500",
      "https://www.roatandivecenter.com/roatan-wreck-dives",
    ],
    briefing: {
      name: "Mr. Bud",
      locationName: "French Key, Roatán",
      forecastLatitude: 16.3484,
      forecastLongitude: -86.4461,
      description:
        "A small cargo boat of about 23 m, put on the bottom in the mid-1990s as a dive attraction near French Cay Cut. She lies on her side on sand at about 18 m (60 ft), with her cabin roof near 14 m (45 ft) and her bow wedged in the reef.",
      marineLife: "Seahorses · garden eels · stingrays · jawfish",
      marineLifeDescription:
        "Jawfish and garden eels live in the sand, and a seahorse can turn up in the sea plumes.",
      difficultyLevel: "intermediate",
      depthMinMeters: 14,
      maxDepthMeters: 18,
      currentNote:
        "Boats pass through French Cay Cut nearby, so listen for engines on the way up and carry an SMB. Currents are not documented; ask the crew on the day.",
      divePlan:
        "Down the line to the stern at 18 m, along the outside of the hull and over the cabin roof, then up the reef for the stop. Stay outside the hull.",
      fitTone: "welcoming",
      fitNote: "A small wreck with time to study it, in water shallow enough for a long dive.",
      landmarks: [
        {
          name: "The cabin roof",
          kind: "wreckFeature",
          note: "The roof of the cabin at about 14 m (45 ft), the shallowest part of the wreck.",
        },
        {
          name: "The bow",
          kind: "wreckFeature",
          note: "The bow, wedged into the reef at the foot of the upper wall.",
        },
      ],
      creatureSlugs: [
        "longsnout-seahorse",
        "garden-eel",
        "southern-stingray",
        "yellowhead-jawfish",
        "sea-plume",
      ],
    },
  },
  // Denominator row: Gold Chain Reef
  {
    slug: "gold-chain-reef-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://cocoviewresort.com/?p=500",
    ],
    briefing: {
      name: "Gold Chain Reef",
      locationName: "French Key, Roatán",
      forecastLatitude: 16.351,
      forecastLongitude: -86.4396,
      description:
        "A reef top at 3 to 9 m (10 to 30 ft) that slopes out like fingers to a large sand slope, thick with elkhorn, staghorn and lettuce coral. The mooring lies in 8 to 12 m (25 to 40 ft), depending on the source.",
      marineLife: "Elkhorn coral · staghorn coral · lettuce coral",
      marineLifeDescription: "Shallow, dense coral with plenty of small fish.",
      difficultyLevel: "beginner",
      depthMinMeters: 3,
      maxDepthMeters: 12,
      currentNote:
        "Watch for surge on the reef top. Currents are not documented; ask the crew on the day.",
      divePlan:
        "Keep to the reef top and the upper slope no deeper than 12 m (40 ft), well off the coral.",
      fitTone: "welcoming",
      fitNote:
        "A shallow coral garden where buoyancy matters more than depth, because the surge moves you over the coral.",
      creatureSlugs: ["elkhorn-coral", "staghorn-coral", "lettuce-coral", "sergeant-major"],
    },
  },
  // Denominator row: Newman's Wall
  {
    slug: "newmans-wall-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://cocoviewresort.com/?p=500",
    ],
    briefing: {
      name: "Newman's Wall",
      locationName: "East End, Roatán",
      forecastLatitude: 16.3536,
      forecastLongitude: -86.435,
      description:
        "A wall across the channel from a resort house reef, worth the trip on a calm day. Long sand chutes run across the top, with vertical walls below, covered in soft corals and sea fans.",
      marineLife: "Soft corals · sea fans · reef fish",
      marineLifeDescription: "Soft corals and sea fans cover the top and upper wall.",
      difficultyLevel: "advanced",
      depthMinMeters: 12,
      maxDepthMeters: 30,
      currentNote:
        "The trip crosses a channel, so it depends on a calm day. Currents are not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring to the top, along the chutes, and over the wall no deeper than 30 m (100 ft). The wall below falls away past the plan.",
      fitTone: "demanding",
      fitNote: "A vertical wall that keeps going; the floor is the diver's to hold.",
      // Vertical wall that drops past recreational depth; the plan's floor of 30 m is the maximum, so the gate is Advanced Open Water.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Sand chutes",
          kind: "reefFormation",
          note: "Long chutes of sand across the top of the wall.",
        },
      ],
      creatureSlugs: ["common-sea-fan", "creole-wrasse", "sergeant-major", "bluehead-wrasse"],
    },
  },
  // Denominator row: Too Tall Too Small (Two Tall Two Small)
  {
    slug: "too-tall-too-small-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://cocoviewresort.com/?p=500",
    ],
    briefing: {
      name: "Too Tall Too Small",
      locationName: "East End, Roatán",
      forecastLatitude: 16.3575,
      forecastLongitude: -86.4266,
      description:
        "A shallow wall that slopes away below its edge, with sea fans along the lip. The mooring lies in 6 to 12 m (20 to 40 ft), depending on the source.",
      marineLife: "Sea fans · reef fish",
      marineLifeDescription: "Sea fans line the top of the wall.",
      difficultyLevel: "beginner",
      depthMinMeters: 6,
      maxDepthMeters: 12,
      currentNote:
        "Watch for east-west surge. Currents are not documented; ask the crew on the day.",
      divePlan:
        "Stay on the top of the wall and the upper slope no deeper than 12 m (40 ft), off the fans.",
      fitTone: "welcoming",
      fitNote: "Shallow and uncomplicated, with surge to manage.",
      creatureSlugs: ["common-sea-fan", "sergeant-major", "bluehead-wrasse", "french-grunt"],
    },
  },
  // Denominator row: Anka's Place
  {
    slug: "ankas-place-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://cocoviewresort.com/?p=500",
    ],
    briefing: {
      name: "Anka's Place",
      locationName: "East End, Roatán",
      forecastLatitude: 16.3581,
      forecastLongitude: -86.4246,
      description:
        "A shallow wall that winds along the reef, hung with rope, tube and barrel sponges. In the 2009 earthquake a large stretch of reef broke away into deep water.",
      marineLife: "Rope sponges · tube sponges · barrel sponges",
      marineLifeDescription: "Sponges and cascading corals make up the wall.",
      difficultyLevel: "beginner",
      depthMinMeters: 6,
      maxDepthMeters: 8,
      currentNote: "Currents are not documented; ask the crew on the day.",
      divePlan: "Stay on the shallow top and the winding wall, and keep clear of the broken edge.",
      fitTone: "welcoming",
      fitNote: "A shallow wall with delicate sponges.",
      landmarks: [
        {
          name: "The 2009 break",
          kind: "reefHistory",
          note: "The place where a large section of the reef fell away in the 2009 earthquake.",
        },
      ],
      creatureSlugs: [
        "giant-barrel-sponge",
        "brown-tube-sponge",
        "red-rope-sponge",
        "common-sea-fan",
      ],
    },
  },
  // Denominator row: Inside Outside
  {
    slug: "inside-outside-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://cocoviewresort.com/?p=500",
    ],
    briefing: {
      name: "Inside Outside",
      locationName: "Parrot Tree, Roatán",
      forecastLatitude: 16.3597,
      forecastLongitude: -86.4158,
      description:
        "The edge of the reef is thick with lettuce coral and cut by deep, narrow channels. Coral reaches within 2 to 3 m (5 to 10 ft) of the surface. The mooring is at about 8 m (25 ft).",
      marineLife: "Lettuce coral · reef fish",
      marineLifeDescription: "Lettuce coral covers the edge of the reef.",
      difficultyLevel: "beginner",
      depthMinMeters: 2,
      maxDepthMeters: 9,
      currentNote: "Currents are not documented; ask the crew on the day.",
      divePlan: "Stay on the reef top and in the channels, well clear of the coral.",
      fitTone: "welcoming",
      fitNote: "Shallow reef where good buoyancy protects the coral.",
      creatureSlugs: ["lettuce-coral", "sergeant-major", "bluehead-wrasse", "french-grunt"],
    },
  },
  // Denominator row: Carib Point
  {
    slug: "carib-point-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://cocoviewresort.com/?p=500",
    ],
    briefing: {
      name: "Carib Point",
      locationName: "Half Moon Bay, Roatán",
      forecastLatitude: 16.3686,
      forecastLongitude: -86.3891,
      description:
        "The upper part of the wall is a gently sloped plateau between 9 and 12 m (30 and 40 ft). Currents here let deep-water sea fans grow in large numbers, with schools of creole wrasse, yellowtail snapper, blue chromis and black durgon over them.",
      marineLife: "Sea fans · creole wrasse · blue chromis · black durgon",
      marineLifeDescription: "Schools of creole wrasse and chromis hang over the sea fans.",
      difficultyLevel: "advanced",
      depthMinMeters: 9,
      maxDepthMeters: 14,
      currentNote:
        "Current can exceed a diver's swimming ability; staff brief the day's flow. Carry an SMB.",
      divePlan:
        "Stay on the plateau at 9 to 14 m (30 to 45 ft) and turn before the edge. The wall below falls away past the plan.",
      fitTone: "demanding",
      fitNote: "A shallow plateau where the current is the hazard; staff brief the day's flow.",
      // Gated Advanced Open Water for the current, not the depth: the sources say currents here feed the sea fans and the plan stays on the 9 to 14 m plateau.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Sea fan plateau",
          kind: "reefFormation",
          note: "A gentle upper plateau of the wall at 9 to 12 m (30 to 40 ft), thick with deep-water sea fans.",
        },
      ],
      creatureSlugs: [
        "common-sea-fan",
        "creole-wrasse",
        "blue-chromis",
        "yellowtail-snapper",
        "black-durgon",
      ],
    },
  },
  // Denominator row: Calvin's Crack
  {
    slug: "calvins-crack-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://cocoviewresort.com/?p=500",
    ],
    briefing: {
      name: "Calvin's Crack",
      locationName: "Jonesville, Roatán",
      forecastLatitude: 16.3812,
      forecastLongitude: -86.3713,
      description:
        "An elbow-shaped plateau on the east side, with a long crevice that volcanic activity created. The crack begins at 9 m (30 ft) and ends at 24 m (80 ft) where it opens on the wall face.",
      marineLife: "Sponges · sea fans · reef fish",
      marineLifeDescription: "The walls of the crack are covered in growth and small life.",
      difficultyLevel: "advanced",
      depthMinMeters: 9,
      maxDepthMeters: 24,
      currentNote: "Currents are not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring at 9 to 12 m (30 to 40 ft), along the plateau and the lip of the crack, then out along the wall face no deeper than 24 m (80 ft), and back up the reef. Do not descend into the crack; it is a narrow crevice and a possible overhead. The wall below falls away past the plan.",
      fitTone: "demanding",
      fitNote:
        "A crack that drops from 9 m to 24 m, popular with visiting divers. The plan stays on the plateau, the lip and the wall face.",
      // The crack runs to 24 m (80 ft) and opens on a wall that falls away; Advanced Open Water is the conservative reading.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The crack",
          kind: "reefFormation",
          note: "A long crevice from 9 m to 24 m (30 to 80 ft) that exits on the wall face.",
        },
      ],
      creatureSlugs: [
        "common-sea-fan",
        "giant-barrel-sponge",
        "orange-elephant-ear-sponge",
        "creole-wrasse",
      ],
    },
  },
  // Denominator row: Fish Den
  {
    slug: "fish-den-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://sundiversroatan.com/2026/02/24/discover-the-best-beginner-dive-sites-in-roatan-honduras/",
      "https://roatanet.com/diving-guide-to-roatans-west-endsandy-bay-marine-reserve/",
    ],
    briefing: {
      name: "Fish Den",
      locationName: "West End, Roatán",
      forecastLatitude: 16.3173,
      forecastLongitude: -86.5887,
      description:
        "The mooring sits on a coral mound inside a horseshoe-shaped canyon. The reef starts at about 3 m (10 ft), runs down a rubble canyon, and reaches a mountain of a wall with barrel and tube sponges.",
      marineLife: "Sergeant majors · grunts · seahorses · neck crabs",
      marineLifeDescription:
        "Hundreds of small reef fish gather around the mound, and the gorgonians shelter small crabs and seahorses.",
      difficultyLevel: "beginner",
      depthMinMeters: 3,
      maxDepthMeters: 18,
      currentNote:
        "Boats work the West End coast, so listen for engines on the way up and carry an SMB. Currents are not documented; ask the crew on the day.",
      divePlan:
        "Circle the mound, follow the rubble canyon toward the wall no deeper than 18 m (60 ft), and come back along the shallows. The optional swim-through is an overhead; stay out. The wall below falls away past the plan.",
      fitTone: "welcoming",
      fitNote:
        "A shallow reef with the wall close by, so students can visit the edge briefly, and slow looking pays off.",
      landmarks: [
        {
          name: "The horseshoe canyon",
          kind: "reefFormation",
          note: "A horseshoe-shaped canyon with a coral mound at its center, where the mooring lies.",
        },
      ],
      creatureSlugs: [
        "sergeant-major",
        "french-grunt",
        "longsnout-seahorse",
        "giant-barrel-sponge",
        "common-sea-fan",
      ],
    },
  },
  // Denominator row: Pablo's Place
  // Approximate pin: no Marine Park mooring carries the name; placed on the south side of the island's western tip, where the sources put the wall (starts near 15 m, current runs east to west, near Flowers Bay), about 240 m from the West End Wall pin.
  {
    slug: "pablos-place-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://roatansplashinn.com/en/roatan-diving-sites/pablos-place/",
      "https://web.archive.org/web/20260508085919/https://coconuttreedivers.com/scuba-diving-roatan/over-80-dive-sites-to-visit-in-caribbean-roatan-honduras/",
      "https://bluereefexplorers.com/diving/dive-sites",
      "https://roatanet.com/diving-guide-to-roatans-west-endsandy-bay-marine-reserve/",
      "https://roatandivers.com/blog/the-best-dive-sites-in-roatan",
    ],
    briefing: {
      name: "Pablo's Place",
      locationName: "West End, Roatán",
      forecastLatitude: 16.2656,
      forecastLongitude: -86.6033,
      description:
        "A vertical coral wall on the island’s western end. The face starts at about 15 m (50 ft) and keeps falling past recreational depth, with black coral, black gorgonians and big barrel sponges on it. Sharks and eagle rays pass on occasion.",
      marineLife: "Black coral · barrel sponges · barracuda · eagle rays",
      marineLifeDescription:
        "Barracuda, trumpetfish, snapper and jacks school along the wall, and a nurse or reef shark turns up now and then.",
      difficultyLevel: "advanced",
      depthMinMeters: 15,
      maxDepthMeters: 30,
      currentNote:
        "Run as a drift. The current usually flows east to west, light to moderate, and the day depends on the weather and current. Carry an SMB.",
      divePlan:
        "Down the mooring to the lip of the wall at about 15 m, drift along it no deeper than 30 m (100 ft), and come up over the shallow top with reserve gas. The wall falls away past the plan.",
      fitTone: "demanding",
      fitNote:
        "A wall that does not end where you should. Go in the early to mid-morning, when the light is on the face.",
      // The wall drops far past recreational depth; the plan's floor of 30 m is the maximum, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The wall",
          kind: "reefFormation",
          note: "A vertical wall from about 15 m (50 ft) with black coral colonies and big barrel sponges.",
        },
      ],
      creatureSlugs: [
        "black-coral",
        "giant-barrel-sponge",
        "great-barracuda",
        "trumpetfish",
        "dog-snapper",
        "spotted-eagle-ray",
        "nurse-shark",
      ],
    },
  },
  // Denominator row: Texas
  // Approximate pin: no mooring is named Texas; placed on the Salt Life Point mooring on the Marine Park list, which is the southern edge of the Texas plains off the Keyhole stretch of the island's tip. About 365 m from the Pablo's Place pin.
  {
    slug: "texas-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://roatansplashinn.com/en/roatan-diving-sites/texas/",
      "https://web.archive.org/web/20260508085919/https://coconuttreedivers.com/scuba-diving-roatan/over-80-dive-sites-to-visit-in-caribbean-roatan-honduras/",
      "https://bluereefexplorers.com/diving/dive-sites",
      "https://roatanet.com/diving-guide-to-roatans-west-endsandy-bay-marine-reserve/",
      "https://sundiversroatan.com/2022/07/13/best-dive-sites-in-roatan/",
    ],
    briefing: {
      name: "Texas",
      locationName: "West End, Roatán",
      forecastLatitude: 16.2661,
      forecastLongitude: -86.5999,
      description:
        "Flat plains of oversized barrel sponges at the southern tip of the island, one of the four sites of The Point. The plains lie at about 15 m (50 ft) and the wall at their edge drops past the plan.",
      marineLife: "Barrel sponges · sargassum triggerfish · black durgon · groupers",
      marineLifeDescription:
        "Sponges big enough to hide in, queen triggerfish and black durgon over the plains, and the shy sargassum triggerfish in the coral patches.",
      difficultyLevel: "advanced",
      depthMinMeters: 12,
      maxDepthMeters: 27,
      currentNote:
        "The current runs east to west across the plains, and it is stronger along the wall. The surface can be rough, so the site depends on the weather. Carry an SMB.",
      divePlan:
        "Drift across the plains at about 15 m (50 ft) and stay off the top of the wall; the maximum depth is 27 m (90 ft). The wall at the edge falls away past the plan.",
      fitTone: "demanding",
      fitNote:
        "Rewarding for photographers, but sources recommend Advanced Open Water, and the wall edge is for experienced divers.",
      // Sources give a maximum of 90 ft (27 m) and recommend Advanced Open Water; the wall at the edge falls past recreational depth.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The plains",
          kind: "reefFormation",
          note: "Flat ground covered in giant barrel sponges, some large enough to fit inside.",
        },
      ],
      creatureSlugs: [
        "giant-barrel-sponge",
        "sargassum-triggerfish",
        "queen-triggerfish",
        "black-durgon",
        "atlantic-spadefish",
        "hogfish",
      ],
    },
  },
  // Denominator row: West End Wall
  // Approximate pin: the mooring name is not on the Marine Park list; the sources put the wall at the southwest tip, one of the four sites of The Point, so it is placed on the Michelle Sharpe's Smile mooring on the west shore between Black Rock and Pablo's Place, about 330 m from the Black Rock pin and 240 m from the Pablo's Place pin.
  {
    slug: "west-end-wall-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://roatansplashinn.com/en/roatan-diving-sites/west-end-wall/",
      "https://sundiversroatan.com/2022/07/13/best-dive-sites-in-roatan/",
      "https://roatandivers.com/blog/the-best-dive-sites-in-roatan",
      "https://roatanet.com/diving-guide-to-roatans-west-endsandy-bay-marine-reserve/",
      "https://web.archive.org/web/20260508085919/https://coconuttreedivers.com/scuba-diving-roatan/over-80-dive-sites-to-visit-in-caribbean-roatan-honduras/",
    ],
    briefing: {
      name: "West End Wall",
      locationName: "West End, Roatán",
      forecastLatitude: 16.2676,
      forecastLongitude: -86.6041,
      description:
        "A wall at the southwest tip, starting close to the ironshore at about 6 m (20 ft). The crest is knit with stony coral and sea fans, and the base of the wall is at about 27 m (90 ft), with sand sloping away beyond.",
      marineLife: "Eagle rays · stingrays · groupers · creole wrasse",
      marineLifeDescription:
        "Spotted eagle rays and southern stingrays hunt along the base, and creole wrasse and jacks stream past on the current.",
      difficultyLevel: "advanced",
      depthMinMeters: 6,
      maxDepthMeters: 27,
      currentNote: "A steady current runs along the wall, so it is run as a drift. Carry an SMB.",
      divePlan:
        "Start at the crest near the ironshore, drift along the wall no deeper than 27 m (90 ft), and finish in the shallows. The caverns cut into the wall are overheads; stay out. Silversides fill the crevices in August.",
      fitTone: "demanding",
      fitNote:
        "A popular wall on the island's tip, run as a steady drift. If nitrox is used, a nitrox mix is analyzed and its MOD set for the deepest point of the dive; staff confirm the mix before boarding.",
      // The base of the wall is at 27 m (90 ft), with sand sloping deeper; Advanced Open Water because operators send only Advanced divers to the deeper part.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The crest",
          kind: "reefFormation",
          note: "The top of the wall starts near the ironshore at about 6 m (20 ft).",
        },
      ],
      creatureSlugs: [
        "spotted-eagle-ray",
        "southern-stingray",
        "black-grouper",
        "creole-wrasse",
        "common-sea-fan",
      ],
    },
  },
  // Denominator row: Blue Channel
  // Approximate pin: placed on the Tabyannas mooring, in the water between West End and West Bay where the sources put the channel (off the beach bar, parallel to the shore); about 300 m from the Seaquest Deep pin.
  {
    slug: "blue-channel-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://roatansplashinn.com/en/roatan-diving-sites/blue-channel/",
      "https://web.archive.org/web/20260508085919/https://coconuttreedivers.com/scuba-diving-roatan/over-80-dive-sites-to-visit-in-caribbean-roatan-honduras/",
      "https://sundiversroatan.com/2022/07/13/best-dive-sites-in-roatan/",
      "https://bluereefexplorers.com/diving/dive-sites",
      "https://roatanet.com/diving-guide-to-roatans-west-endsandy-bay-marine-reserve/",
    ],
    briefing: {
      name: "Blue Channel",
      locationName: "West End, Roatán",
      forecastLatitude: 16.2842,
      forecastLongitude: -86.6045,
      description:
        "A channel that cuts the shallow reef off West End, running parallel to the shore from just inside the reef out to the ridge. The top of the wall slopes gently from 3 m (10 ft) down to 14 m (45 ft), and the channel ends in a shallow seagrass bed.",
      marineLife: "Green moray · pipefish · jawfish · silversides",
      marineLifeDescription:
        "Green moray eels and pipefish live at the entrance, and in late summer silversides fill the channel so thickly you cannot see across it.",
      difficultyLevel: "beginner",
      depthMinMeters: 3,
      maxDepthMeters: 14,
      currentNote:
        "The channel is close to West End shore and its boat traffic: listen for engines, carry an SMB, and come up in the channel only after checking above you. Current not documented; ask the crew on the day.",
      divePlan:
        "Follow the open channel from the wall to the seagrass bed at 3 to 6 m (10 to 20 ft). The swim-through network and the caves in the south wall are overheads; stay out, with or without a guide. In late summer, silversides can hide the swim-throughs. Keep your fins off the coral.",
      fitTone: "welcoming",
      fitNote:
        "A shallow dive that rewards good buoyancy. Keep out of the swim-throughs, even with a guide.",
      landmarks: [
        {
          name: "The channel",
          kind: "reefFormation",
          note: "A channel that links the inner reef with the outer ridge, ending in a seagrass bed.",
        },
      ],
      creatureSlugs: [
        "green-moray",
        "yellowhead-jawfish",
        "sergeant-major",
        "spotted-drum",
        "turtle-grass",
      ],
    },
  },
  // Denominator row: Half Moon Bay Wall
  // Approximate pin: the wall is shared by the Dixie's, Half Moon Bay and Divemaster's Choice moorings; placed on the Vern's Dropoff mooring at the north end of the same wall, about 300 m from the Dixie's Place pin.
  {
    slug: "half-moon-bay-wall-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://roatansplashinn.com/en/roatan-diving-sites/half-moon-bay-wall/",
      "https://web.archive.org/web/20260508085919/https://coconuttreedivers.com/scuba-diving-roatan/over-80-dive-sites-to-visit-in-caribbean-roatan-honduras/",
      "https://www.roatandivingnativesons.com/fun-dives-1",
      "https://sundiversroatan.com/2022/07/13/best-dive-sites-in-roatan/",
      "https://roatanet.com/diving-guide-to-roatans-west-endsandy-bay-marine-reserve/",
    ],
    briefing: {
      name: "Half Moon Bay Wall",
      locationName: "West End, Roatán",
      forecastLatitude: 16.3092,
      forecastLongitude: -86.5961,
      description:
        "A small semicircular wall almost directly off the West End beach. The reef starts at about 5 m (15 ft) and the wall drops past 45 m (150 ft). Black coral, gorgonians and orange elephant ear sponges hang on the sides, with flamingo tongue snails on the fans.",
      marineLife: "Eagle rays · groupers · creole wrasse · blue chromis",
      marineLifeDescription:
        "Eagle rays cruise along the reef, and groupers, chromis and creole wrasse work the sides of the wall.",
      difficultyLevel: "intermediate",
      depthMinMeters: 5,
      maxDepthMeters: 30,
      currentNote:
        "Boats work the West End beach, so listen for engines on the way up and carry an SMB. Currents usually run north, and on some days hard enough to carry you past several sites; ask the crew before you go.",
      divePlan:
        "Start on the top of the reef, follow the channels onto the wall no deeper than 30 m (100 ft), and finish over the shallows. The tunnel up the reef is an overhead; stay out. The wall falls away past the plan.",
      fitTone: "unknown",
      fitNote:
        "Light current on some days and a hard drift on others, along a wall that falls far past the plan; ask the crew which day it is.",
      // The wall drops to 45 m and beyond, and sources call for Advanced Open Water to go deep; the plan's floor of 30 m is the maximum.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The wall",
          kind: "reefFormation",
          note: "A semicircular wall off West End beach with black coral and orange elephant ear sponges.",
        },
      ],
      creatureSlugs: [
        "spotted-eagle-ray",
        "black-grouper",
        "creole-wrasse",
        "blue-chromis",
        "flamingo-tongue",
        "black-coral",
      ],
    },
  },
  // Denominator row: Canyon Reef
  // Approximate pin: no mooring is named Canyon Reef; placed on the Chloe Bean's Canyons mooring between Hole in the Wall and Fish Den, where the sources put it (the drift ends at Fish Den); about 240 m from either pin.
  {
    slug: "canyon-reef-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://roatansplashinn.com/en/roatan-diving-sites/canyon-reef/",
      "https://web.archive.org/web/20260508085919/https://coconuttreedivers.com/scuba-diving-roatan/over-80-dive-sites-to-visit-in-caribbean-roatan-honduras/",
      "https://roatanet.com/diving-guide-to-roatans-west-endsandy-bay-marine-reserve/",
      "https://roatandivers.com/blog/the-best-dive-sites-in-roatan",
    ],
    briefing: {
      name: "Canyon Reef",
      locationName: "West End, Roatán",
      forecastLatitude: 16.3158,
      forecastLongitude: -86.5904,
      description:
        "A series of canyons and ravines in a double-walled reef, starting at about 3 m (10 ft) and running down to about 18 m (60 ft), then a gentle slope of soft coral stands. Pillar coral towers stand along the reef.",
      marineLife: "Eagle rays · seahorses · octopus · banded coral shrimp",
      marineLifeDescription:
        "Eagle rays cruise the slope, and seahorses and octopus live among the soft coral stands.",
      difficultyLevel: "intermediate",
      depthMinMeters: 3,
      maxDepthMeters: 18,
      currentNote:
        "Boats work the West End coast, so listen for engines on the way up and carry an SMB. Run as a drift. Current strength is not documented; ask the crew on the day.",
      divePlan:
        "Work the canyons in order from the middle, no deeper than 18 m (60 ft), and drift to Fish Den to finish. Roofed overhangs and passages are overheads; stay out. The sand lies past the plan.",
      fitTone: "welcoming",
      fitNote:
        "A canyon dive that is a lesson in buoyancy. If you would rather drift along the wall, stay above the group.",
      landmarks: [
        {
          name: "The canyons",
          kind: "reefFormation",
          note: "Ravines cut into the reef, many formed when the wall was above water.",
        },
      ],
      creatureSlugs: [
        "spotted-eagle-ray",
        "longsnout-seahorse",
        "caribbean-reef-octopus",
        "banded-coral-shrimp",
        "pillar-coral",
      ],
    },
  },
  // Denominator row: Gibson Bight
  // Approximate pin: no mooring is named Gibson Bight; the sources put it between Overheat Reef and Fish Den, so it is placed on the Lee's One Love mooring in that gap, about 280 m from the Overheat Reef pin.
  {
    slug: "gibson-bight-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://roatansplashinn.com/en/roatan-diving-sites/gibson-bight/",
      "https://web.archive.org/web/20260508085919/https://coconuttreedivers.com/scuba-diving-roatan/over-80-dive-sites-to-visit-in-caribbean-roatan-honduras/",
      "https://sundiversroatan.com/2022/07/13/best-dive-sites-in-roatan/",
      "https://roatanet.com/diving-guide-to-roatans-west-endsandy-bay-marine-reserve/",
    ],
    briefing: {
      name: "Gibson Bight",
      locationName: "Sandy Bay, Roatán",
      forecastLatitude: 16.3209,
      forecastLongitude: -86.5857,
      description:
        "A wall off the northern shore with a canyon near the mooring that leads onto it. The shallows begin at about 3 m (10 ft), and the wall is nearly vertical to about 27 m (90 ft) and drops deeper in places. A J-shaped canyon with an overhang opens onto the wall.",
      marineLife: "Spotted eagle rays · seahorses · dog snapper · balloonfish",
      marineLifeDescription:
        "Eagle rays drift toward the bay, and seahorses turn up in the gorgonians.",
      difficultyLevel: "advanced",
      depthMinMeters: 3,
      maxDepthMeters: 27,
      currentNote:
        "Nutrient-rich water from Gibson Bay runs through the site. Current not documented in strength; ask the crew on the day.",
      divePlan:
        "Down the mooring, stay on the lip and the outer face of the wall no deeper than 27 m (90 ft), then return through the shallow ravines. The J-shaped canyon with its overhang and any enclosed swim-through are overheads; stay out.",
      fitTone: "demanding",
      fitNote:
        "Sources rate it for intermediate and advanced divers, because the deeper profile is the draw.",
      // Wall to 27 m (90 ft), dropping deeper; sources suit it to intermediate and advanced divers.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The canyon",
          kind: "reefFormation",
          note: "A canyon beside the mooring that leads to the wall. Its J-shaped section and overhang are overheads; stay out.",
        },
      ],
      creatureSlugs: [
        "spotted-eagle-ray",
        "longsnout-seahorse",
        "dog-snapper",
        "balloonfish",
        "pillar-coral",
        "giant-barrel-sponge",
      ],
    },
  },
  // Denominator row: Peter's Place (Pete's Place)
  // Approximate pin: the sources put it just north of the El Aguila wreck, toward Bear's Den; placed on the Barry's Corner mooring on that stretch of wall, about 270 m from the El Aguila pin.
  {
    slug: "peters-place-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://roatansplashinn.com/en/roatan-diving-sites/petes-place/",
      "https://web.archive.org/web/20260508085919/https://coconuttreedivers.com/scuba-diving-roatan/over-80-dive-sites-to-visit-in-caribbean-roatan-honduras/",
      "https://roatanet.com/diving-guide-to-roatans-west-endsandy-bay-marine-reserve/",
    ],
    briefing: {
      name: "Peter's Place",
      locationName: "Sandy Bay, Roatán",
      forecastLatitude: 16.3292,
      forecastLongitude: -86.5772,
      description:
        "A wall just north of the El Aguila wreck, with nooks, crevices and mini canyons over a slanting sand slope. Reef formations and sand patches lie at about 14 m (45 ft), and the wall holds big groupers.",
      marineLife: "Groupers · dog snapper · creole wrasse · eagle rays",
      marineLifeDescription:
        "At least four big groupers hold on the wall, with dog snapper and creole wrasse beside them.",
      difficultyLevel: "advanced",
      depthMinMeters: 6,
      maxDepthMeters: 30,
      currentNote:
        "Run as a drift. Current strength is not documented; ask the crew on the day. Do not drift north past the end of the dive.",
      divePlan:
        "Drift the face of the wall no deeper than 30 m (100 ft), then work the crevices on the reef top. The wall falls away past the plan.",
      fitTone: "demanding",
      fitNote: "Sources recommend intermediate to advanced divers for the multi-level drift.",
      // The wall runs to about 30 m (100 ft); Advanced Open Water on sources' intermediate-to-advanced rating.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The wall face",
          kind: "reefFormation",
          note: "A wall with canyons and overhangs over a slanting sand slope.",
        },
      ],
      creatureSlugs: [
        "black-grouper",
        "dog-snapper",
        "creole-wrasse",
        "spotted-eagle-ray",
        "green-moray",
      ],
    },
  },
  // Denominator row: Green Outhouse Wall
  // Approximate pin: no mooring is named Green Outhouse; the sources put it between Overheat Reef and Pillar Coral, so it is placed in the water between the Overheat Reef and Pillar Coral pins, a little seaward of the line joining them, about 210 m from each.
  {
    slug: "green-outhouse-wall-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://roatanet.com/diving-guide-to-roatans-west-endsandy-bay-marine-reserve/",
      "https://web.archive.org/web/20260508085919/https://coconuttreedivers.com/scuba-diving-roatan/over-80-dive-sites-to-visit-in-caribbean-roatan-honduras/",
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
    ],
    briefing: {
      name: "Green Outhouse Wall",
      locationName: "Sandy Bay, Roatán",
      forecastLatitude: 16.3253,
      forecastLongitude: -86.5826,
      description:
        "The mooring is on coral in about 6 m (20 ft). The dive crosses a sandy area at about 15 m (50 ft) among healthy coral, then reaches a wall that drops off steeply, with canyon after canyon in the shallows.",
      marineLife: "Green moray · gorgonians · hawksbill turtles · blue tang",
      marineLifeDescription:
        "A very large gorgonian bends in the current, and green morays live in the canyons.",
      difficultyLevel: "beginner",
      depthMinMeters: 6,
      maxDepthMeters: 18,
      currentNote:
        "Boats from Sandy Bay use the mooring, so listen for engines and carry an SMB. The current usually flows north.",
      divePlan:
        "Out to the sand at 15 m (50 ft), a look along the top of the wall no deeper than 18 m (60 ft), then back through the shallow canyons. The wall falls away past the plan.",
      fitTone: "welcoming",
      fitNote:
        "A sandy area and shallow canyons, with the wall edge as the limit. Hold 18 m at most.",
      landmarks: [
        {
          name: "The wall",
          kind: "reefFormation",
          note: "A steep wall beyond the sand at about 15 m (50 ft), with canyons in the shallows above it.",
        },
      ],
      creatureSlugs: [
        "green-moray",
        "hawksbill-turtle",
        "blue-tang",
        "common-sea-fan",
        "black-grouper",
      ],
    },
  },
  // Denominator row: Prince Albert
  // Approximate pin: no mooring carries the wreck's name; the sources put her right in front of CoCo View Resort, a few fin kicks from it, in the channel near Newman's Wall. The resort is at 16.3594, -86.4331 in OpenStreetMap, so the pin is in the water about 270 m south of it, 420 m from the Newman's Wall pin. Good to about 2 km.
  {
    slug: "prince-albert-wreck-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://cocoviewresort.com/?p=500",
      "https://www.roatandivecenter.com/roatan-wreck-dives",
      "https://www.roatandivingnativesons.com/fun-dives-1",
    ],
    briefing: {
      name: "Prince Albert",
      locationName: "East End, Roatán",
      forecastLatitude: 16.357,
      forecastLongitude: -86.4332,
      description:
        "A freighter of about 43 m (140 ft) sitting upright on sand, covered in soft coral, in front of a resort. Her bow and aft decks carry forests of soft coral. Divers stay outside the hull.",
      marineLife: "Eagle rays · southern stingrays · squid · soft corals",
      marineLifeDescription:
        "Eagle rays, southern stingrays and squid pass along the hull, and the sand holds small life.",
      difficultyLevel: "intermediate",
      depthMinMeters: 12,
      maxDepthMeters: 24,
      currentNote:
        "Listen for engines on the way up. Current not documented; ask the crew on the day. Shore entries run from the resort: ask about the entry point, any surf or rocks and the exit route before you go, and night dives need a guide.",
      divePlan:
        "Down the line to the hull, along the outside of the deck from stern to bow, then back over the sand. Stay outside the hull.",
      fitTone: "demanding",
      fitNote:
        "Upright, tidy and covered in coral. Sources disagree on the depth (65 ft to 80 ft), so plan for the deeper.",
      // Sources give 40 to 80 ft (12 to 24 m); the deeper figure is used, with Advanced Open Water.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Bow and aft decks",
          kind: "wreckFeature",
          note: "Soft coral forests cover the decks of the upright hull.",
        },
      ],
      creatureSlugs: [
        "spotted-eagle-ray",
        "southern-stingray",
        "caribbean-reef-squid",
        "common-sea-fan",
      ],
    },
  },
  // Denominator row: Sandra's Grotto
  {
    slug: "sandras-grotto-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://anthonyskey.com/daily-dive-sites-log/",
    ],
    briefing: {
      name: "Sandra's Grotto",
      locationName: "West Bay, Roatán",
      forecastLatitude: 16.2673,
      forecastLongitude: -86.599,
      description:
        "A steep coral wall cut with small overhangs and sandy pockets near West Bay Point. Sea plumes and tube sponges crowd the lip of the wall, where schools of blue chromis feed in the current.",
      marineLife: "Blue chromis · brown tube sponges · hawksbill turtles · creole wrasse",
      marineLifeDescription:
        "Hawksbill turtles graze along the sponge-lined overhangs, while creole wrasse stream past in open water.",
      difficultyLevel: "intermediate",
      depthMinMeters: 10,
      maxDepthMeters: 24,
      currentNote:
        "Currents pick up near the point. Carry an SMB and listen for boat traffic overhead during ascent.",
      divePlan:
        "Descend the mooring line to 10 m (33 ft), follow the wall crest eastward to a maximum depth of 24 m (80 ft), and ascend to the reef top for the safety stop.",
      fitTone: "welcoming",
      fitNote:
        "A classic wall profile with mild to moderate drift, well suited for divers comfortable managing neutral buoyancy along an open drop-off.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The Grotto Overhangs",
          kind: "reefFormation",
          note: "Shallow recesses in the reef face between 12 and 18 m (40 to 60 ft) sheltering cleaner shrimp and resting nurse sharks.",
        },
      ],
      creatureSlugs: [
        "blue-chromis",
        "brown-tube-sponge",
        "hawksbill-turtle",
        "creole-wrasse",
        "nurse-shark",
      ],
    },
  },
  // Denominator row: Seaquest Shallow
  {
    slug: "seaquest-shallow-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://www.roatandivecenter.com/west-end-roatan-dive-sites",
    ],
    briefing: {
      name: "Seaquest Shallow",
      locationName: "West End, Roatán",
      forecastLatitude: 16.2908,
      forecastLongitude: -86.6026,
      description:
        "A sunlit spur-and-groove plateau just inshore from Seaquest Deep. Broad sand channels separate rolling mounds of brain coral and sea plumes in calm, sheltered water.",
      marineLife: "Yellowhead jawfish · peacock flounder · sergeant majors · southern stingrays",
      marineLifeDescription:
        "Jawfish hover over their burrows in the white sand channels, while juvenile reef fish flutter through staghorn thickets.",
      difficultyLevel: "beginner",
      depthMinMeters: 6,
      maxDepthMeters: 15,
      currentNote:
        "Water is usually calm with light surge near the shallowest coral heads. Watch for boat traffic when surfacing.",
      divePlan:
        "Descend to the sandy channel at 8 m (26 ft), explore the coral ridges up to 15 m (50 ft), and loop back toward the mooring in shallow water.",
      fitTone: "welcoming",
      fitNote:
        "Easy navigation, excellent natural light, and very mild water movement make this an ideal refresher or relaxed second dive.",
      minimumCertificationLevel: "open_water",
      landmarks: [
        {
          name: "Jawfish Flats",
          kind: "pointOfInterest",
          note: "A wide white sand clearing dotted with yellowhead jawfish burrows and resting stingrays.",
        },
      ],
      creatureSlugs: [
        "yellowhead-jawfish",
        "peacock-flounder",
        "sergeant-major",
        "southern-stingray",
      ],
    },
  },
  // Denominator row: Chris Fisher
  {
    slug: "chris-fisher-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://roatandivers.com/blog/the-best-dive-sites-in-roatan",
    ],
    briefing: {
      name: "Chris Fisher",
      locationName: "West End, Roatán",
      forecastLatitude: 16.2998,
      forecastLongitude: -86.6002,
      description:
        "A sloping spur reef running out toward the West End drop-off. Tall pillar corals and azure vase sponges rise along the ridge lines, with sandy gullies cutting through the reef toward blue water.",
      marineLife: "Spotted eagle rays · pillar coral · green morays · trumpetfish",
      marineLifeDescription:
        "Spotted eagle rays often glide off the outer drop-off, while green morays tuck into limestone fissures.",
      difficultyLevel: "intermediate",
      depthMinMeters: 10,
      maxDepthMeters: 22,
      currentNote:
        "Light to moderate longshore current is common. Deploy an SMB when ascending away from the mooring line.",
      divePlan:
        "Drop down the pin to 10 m (33 ft), follow the spur out toward the blue up to 22 m (72 ft), and zig-zag back across the shallower crest.",
      fitTone: "welcoming",
      fitNote:
        "Straightforward spur navigation with clear visibility and rewarding reef structure.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Pillar Ridge",
          kind: "reefFormation",
          note: "A prominent coral spine hosting healthy pillar coral spires and schools of blue tang.",
        },
      ],
      creatureSlugs: [
        "spotted-eagle-ray",
        "pillar-coral",
        "green-moray",
        "trumpetfish",
        "blue-tang",
      ],
    },
  },
  // Denominator row: Bikini Bottom
  {
    slug: "bikini-bottom-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://anthonyskey.com/daily-dive-sites-log/",
    ],
    briefing: {
      name: "Bikini Bottom",
      locationName: "West End, Roatán",
      forecastLatitude: 16.2978,
      forecastLongitude: -86.6009,
      description:
        "A gently sloping reef with wide sandy channels and expansive fields of sea whips and fans. Sheltered by the bend of the coast, this site offers gentle conditions and bright ambient sunlight.",
      marineLife: "Caribbean reef squid · French grunts · balloonfish · cushion sea stars",
      marineLifeDescription:
        "Squid hover in small squads just beneath the surface, while balloonfish rest among the gorgonian branches.",
      difficultyLevel: "beginner",
      depthMinMeters: 8,
      maxDepthMeters: 18,
      currentNote: "Currents are generally slight. Keep an eye on boat traffic when surfacing.",
      divePlan:
        "Descend to the reef crest at 8 m (26 ft), tour the sand grooves down to 18 m (60 ft), and work your way back along the top of the coral heads.",
      fitTone: "welcoming",
      fitNote:
        "Calm, colorful, and shallow enough for generous bottom times and stress-free buoyancy practice.",
      minimumCertificationLevel: "open_water",
      landmarks: [
        {
          name: "Squid Shallows",
          kind: "pointOfInterest",
          note: "A sunlit sand channel where reef squid reliably gather near the mooring line.",
        },
      ],
      creatureSlugs: ["caribbean-reef-squid", "french-grunt", "balloonfish", "cushion-sea-star"],
    },
  },
  // Denominator row: El Aquario
  {
    slug: "el-aquario-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://roatandivers.com/blog/the-best-dive-sites-in-roatan",
    ],
    briefing: {
      name: "El Aquario",
      locationName: "West End, Roatán",
      forecastLatitude: 16.3022,
      forecastLongitude: -86.5982,
      description:
        "Living up to its name, this section of the West End reef bursts with concentrated schools of snappers, grunts, and parrotfish milling over dense coral heads.",
      marineLife: "Stoplight parrotfish · yellowtail snapper · black durgon · queen triggerfish",
      marineLifeDescription:
        "Thick schools of yellowtail snapper follow divers around the reef top, and queen triggerfish browse the sand channels.",
      difficultyLevel: "beginner",
      depthMinMeters: 9,
      maxDepthMeters: 18,
      currentNote:
        "Generally calm with gentle water movement. Listen for engines before surfacing.",
      divePlan:
        "Descend to the main coral cluster at 10 m (33 ft), meander along the reef wall to 18 m (60 ft), and spend the end of the dive circling the shallow bommies.",
      fitTone: "welcoming",
      fitNote:
        "Dense fish life and moderate depths make this an engaging dive for all experience levels.",
      minimumCertificationLevel: "open_water",
      landmarks: [
        {
          name: "The Aquarium Bommies",
          kind: "reefFormation",
          note: "A tight grouping of star coral heads bustling with juvenile reef fish and cleaner stations.",
        },
      ],
      creatureSlugs: [
        "stoplight-parrotfish",
        "yellowtail-snapper",
        "black-durgon",
        "queen-triggerfish",
      ],
    },
  },
  // Denominator row: Vern's Dropoff
  {
    slug: "verns-dropoff-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://roatandivers.com/blog/the-best-dive-sites-in-roatan",
    ],
    briefing: {
      name: "Vern's Dropoff",
      locationName: "West End, Roatán",
      forecastLatitude: 16.3092,
      forecastLongitude: -86.5961,
      description:
        "A dramatic vertical drop-off starting near Half Moon Bay. The reef terrace abruptly plunges into deep blue water, adorned with gigantic barrel sponges and bushy black coral trees.",
      marineLife: "Giant barrel sponge · black coral · great barracuda · horse-eye jack",
      marineLifeDescription:
        "Jacks and barracudas patrol the open wall face, while cleaner shrimp occupy sponges along the rim.",
      difficultyLevel: "advanced",
      depthMinMeters: 12,
      maxDepthMeters: 28,
      currentNote:
        "Longshore currents can run parallel to the wall. Drift with the current and ascend with an SMB.",
      divePlan:
        "Descend to the reef rim at 12 m (40 ft), glide along the vertical face down to 28 m (92 ft), and ascend to the terrace to finish your dive in the shallows.",
      fitTone: "demanding",
      fitNote:
        "True wall diving with deep blue below. Divers should maintain strict depth and air monitoring.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The Deep Face",
          kind: "reefFormation",
          note: "A shear limestone wall covered in large barrel sponges and wiry black coral colonies.",
        },
      ],
      creatureSlugs: ["giant-barrel-sponge", "black-coral", "great-barracuda", "horse-eye-jack"],
    },
  },
  // Denominator row: The Wife
  {
    slug: "the-wife-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://anthonyskey.com/daily-dive-sites-log/",
    ],
    briefing: {
      name: "The Wife",
      locationName: "West End, Roatán",
      forecastLatitude: 16.3124,
      forecastLongitude: -86.5939,
      description:
        "A stepped reef structure stepping down in two distinct tiers toward the drop-off. Healthy brain and lettuce corals blanket each terrace, cut by narrow sand chutes.",
      marineLife: "Hawksbill turtle · lettuce coral · hogfish · bluehead wrasse",
      marineLifeDescription:
        "Hawksbill turtles are regular visitors here, nibbling sponges on the lower step while schools of wrasse swarm the upper reef.",
      difficultyLevel: "intermediate",
      depthMinMeters: 10,
      maxDepthMeters: 22,
      currentNote: "Usually mild currents, but water can push across the tiers on incoming tides.",
      divePlan:
        "Follow the mooring line down to 10 m (33 ft), cross the first terrace to the second drop at 22 m (72 ft), and return along the upper ledge.",
      fitTone: "welcoming",
      fitNote: "Terraced architecture makes multilevel diving intuitive and easy to manage.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Lower Terrace Ledge",
          kind: "reefFormation",
          note: "A pronounced coral step at 20 m (65 ft) with small crevices hiding spiny lobsters.",
        },
      ],
      creatureSlugs: [
        "hawksbill-turtle",
        "lettuce-coral",
        "hogfish",
        "bluehead-wrasse",
        "spiny-lobster",
      ],
    },
  },
  // Denominator row: Dennis' Dropoff
  {
    slug: "dennis-dropoff-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://roatandivers.com/blog/the-best-dive-sites-in-roatan",
    ],
    briefing: {
      name: "Dennis' Dropoff",
      locationName: "West End, Roatán",
      forecastLatitude: 16.3198,
      forecastLongitude: -86.5866,
      description:
        "A steep drop-off punctuated by deep fissures and undercut ledges. The lip begins around 12 m (40 ft) before plunging toward the depths of the Cayman Trench.",
      marineLife: "Caribbean reef shark · giant barrel sponge · black grouper · horse-eye jack",
      marineLifeDescription:
        "Reef sharks occasionally patrol along the deep wall, and large black groupers lurk beneath the overhangs.",
      difficultyLevel: "advanced",
      depthMinMeters: 12,
      maxDepthMeters: 30,
      currentNote:
        "Can experience brisk drift. Maintain buddy contact and watch no-decompression limits carefully.",
      divePlan:
        "Descend to the reef rim at 12 m (40 ft), drift along the wall between 20 and 30 m (65 to 100 ft), and ascend to the shallow plateau before deploying an SMB.",
      fitTone: "demanding",
      fitNote: "Deep wall profile intended for advanced divers with good buoyancy and gas control.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The Fissure Notch",
          kind: "reefFormation",
          note: "A deep vertical fracture cutting into the wall face, sheltering groupers and glassy sweepers.",
        },
      ],
      creatureSlugs: [
        "caribbean-reef-shark",
        "giant-barrel-sponge",
        "black-grouper",
        "horse-eye-jack",
      ],
    },
  },
  // Denominator row: Scuba Mermaids
  {
    slug: "scuba-mermaids-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://anthonyskey.com/daily-dive-sites-log/",
    ],
    briefing: {
      name: "Scuba Mermaids",
      locationName: "Sandy Bay, Roatán",
      forecastLatitude: 16.324,
      forecastLongitude: -86.5825,
      description:
        "A lovely sandy plateau edged by rolling coral spurs near the entrance to Sandy Bay. Gentle topography and wide clear sand patches make navigation effortless.",
      marineLife: "Spotted drum · southern stingray · flamingo tongue · trumpetfish",
      marineLifeDescription:
        "Juvenile spotted drums flutter beneath coral overhangs, and flamingo tongues feed on purple sea fans.",
      difficultyLevel: "beginner",
      depthMinMeters: 8,
      maxDepthMeters: 18,
      currentNote:
        "Currents are typically mild. Watch for surface watercraft when returning to the boat.",
      divePlan:
        "Descend onto the shallow sand clearing at 8 m (26 ft), follow the reef spur down to 18 m (60 ft), and return along the coral heads.",
      fitTone: "welcoming",
      fitNote: "Gentle slopes, bright sand, and abundant macro life offer a relaxed, easy dive.",
      minimumCertificationLevel: "open_water",
      landmarks: [
        {
          name: "Mermaid Coral Head",
          kind: "reefFormation",
          note: "A distinct, tall coral head in 12 m (40 ft) hosting multiple cleaner stations and sea fans.",
        },
      ],
      creatureSlugs: [
        "spotted-drum",
        "southern-stingray",
        "flamingo-tongue",
        "trumpetfish",
        "common-sea-fan",
      ],
    },
  },
  // Denominator row: Diane's Delight
  {
    slug: "dianes-delight-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://anthonyskey.com/daily-dive-sites-log/",
    ],
    briefing: {
      name: "Diane's Delight",
      locationName: "Sandy Bay, Roatán",
      forecastLatitude: 16.3247,
      forecastLongitude: -86.5829,
      description:
        "A picturesque reef garden featuring sprawling mounds of hard coral and clusters of azure vase sponges. The reef slopes steadily from the mooring down to a defined wall edge.",
      marineLife: "Hawksbill turtle · French angelfish · red rope sponge · creole wrasse",
      marineLifeDescription:
        "Curious French angelfish frequently accompany divers, while hawksbills forage among the sponges.",
      difficultyLevel: "intermediate",
      depthMinMeters: 10,
      maxDepthMeters: 20,
      currentNote:
        "Mild to moderate current can develop along the north shore; monitor your drift relative to the boat.",
      divePlan:
        "Drop to 10 m (33 ft) at the mooring, explore the reef crest and slope down to 20 m (65 ft), and ascend to the shallow garden for the safety stop.",
      fitTone: "welcoming",
      fitNote: "Vibrant marine life and manageable depth make this an engaging reef exploration.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Vase Sponge Garden",
          kind: "pointOfInterest",
          note: "A dense cluster of colorful tube and vase sponges lining the 15 m (50 ft) contour.",
        },
      ],
      creatureSlugs: ["hawksbill-turtle", "red-rope-sponge", "creole-wrasse", "blue-tang"],
    },
  },
  // Denominator row: Conrad Cave
  {
    slug: "conrad-cave-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://anthonyskey.com/daily-dive-sites-log/",
    ],
    briefing: {
      name: "Conrad Cave",
      locationName: "Sandy Bay, Roatán",
      forecastLatitude: 16.3321,
      forecastLongitude: -86.5742,
      description:
        "A cavernous swim-through feature cut through a high coral wall off Sandy Bay. The open pocket opens at 15 m (50 ft) with ample ambient light streaming into the wide entrance. Divers stay in daylight outside deep overheads.",
      marineLife: "Glassy sweepers · green moray · spiny lobster · black grouper",
      marineLifeDescription:
        "Schools of glassy sweepers shimmer in the cave mouth, while large spiny lobsters pack the surrounding crevices.",
      difficultyLevel: "advanced",
      depthMinMeters: 12,
      maxDepthMeters: 26,
      currentNote:
        "Surge can occasionally be felt near the cave entrance in rough surface conditions. Stay clear of the rock walls.",
      divePlan:
        "Descend to the wall top at 12 m (40 ft), peer into the cavern mouth at 18 m (60 ft) staying strictly in natural light, and drift along the wall up to 26 m (85 ft).",
      fitTone: "demanding",
      fitNote:
        "Dramatic overhead architecture that requires excellent buoyancy control to avoid silt or coral contact.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Conrad Cave Arch",
          kind: "reefFormation",
          note: "A wide limestone archway opening onto the outer wall face at 18 m (60 ft).",
        },
      ],
      creatureSlugs: ["glassy-sweeper", "green-moray", "spiny-lobster", "black-grouper"],
    },
  },
  // Denominator row: Green Pearl
  {
    slug: "green-pearl-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://roatandivers.com/blog/the-best-dive-sites-in-roatan",
    ],
    briefing: {
      name: "Green Pearl",
      locationName: "Sandy Bay, Roatán",
      forecastLatitude: 16.3349,
      forecastLongitude: -86.5714,
      description:
        "A pristine spur-and-groove reef system on the Sandy Bay marine reserve boundary. The coral ridges are densely cloaked in lettuce coral, brain coral, and waving gorgonians.",
      marineLife: "Lettuce-leaf sea slug · nurse shark · Bermuda chub · blue chromis",
      marineLifeDescription:
        "Nurse sharks frequently snooze under the undercut ledges of the spurs, while Bermuda chubs shadow divers along the surface.",
      difficultyLevel: "intermediate",
      depthMinMeters: 10,
      maxDepthMeters: 22,
      currentNote:
        "Variable current depending on offshore trade winds; SMB recommended for blue water ascents.",
      divePlan:
        "Descend the mooring to 10 m (33 ft), navigate seaward along the spur ridge to 22 m (72 ft), and return along an adjacent sand channel.",
      fitTone: "welcoming",
      fitNote:
        "Vibrant coral health and moderate depths make for an easygoing, visually rich reef profile.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The Pearl Ledge",
          kind: "reefFormation",
          note: "An undercut coral spur at 16 m (52 ft) where nurse sharks and stingrays regularly rest.",
        },
      ],
      creatureSlugs: ["lettuce-sea-slug", "nurse-shark", "bermuda-chub", "blue-chromis"],
    },
  },
  // Denominator row: Zack's Patch
  {
    slug: "zacks-patch-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://roatandivers.com/blog/the-best-dive-sites-in-roatan",
      "https://anthonyskey.com/daily-dive-sites-log/",
    ],
    briefing: {
      name: "Zack's Patch",
      locationName: "Sandy Bay, Roatán",
      forecastLatitude: 16.3341,
      forecastLongitude: -86.5717,
      description:
        "An isolated cluster of vibrant coral mounds surrounded by sparkling white sand flats. The patch structure concentrates marine life into an active biological hub.",
      marineLife: "Spotted eagle ray · yellowtail snapper · trumpetfish · queen triggerfish",
      marineLifeDescription:
        "Eagle rays often feed in the surrounding sand, unearthing mollusks while snappers school around the patch.",
      difficultyLevel: "beginner",
      depthMinMeters: 8,
      maxDepthMeters: 18,
      currentNote:
        "Current is generally light. Surface with care as Sandy Bay boat traffic passes nearby.",
      divePlan:
        "Drop to 8 m (26 ft), circumnavigate the main patch reef out to 18 m (60 ft), and spend your remaining bottom time exploring the shallower coral outcroppings.",
      fitTone: "welcoming",
      fitNote:
        "Compact site with simple navigation and plentiful marine life, great for photography and easy diving.",
      minimumCertificationLevel: "open_water",
      landmarks: [
        {
          name: "Central Patch Reef",
          kind: "reefFormation",
          note: "A large isolated coral mound standing 5 m proud of the surrounding sand floor.",
        },
      ],
      creatureSlugs: [
        "spotted-eagle-ray",
        "yellowtail-snapper",
        "trumpetfish",
        "queen-triggerfish",
      ],
    },
  },
  // Denominator row: Nelson's Nest
  {
    slug: "nelsons-nest-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://anthonyskey.com/daily-dive-sites-log/",
    ],
    briefing: {
      name: "Nelson's Nest",
      locationName: "Sandy Bay, Roatán",
      forecastLatitude: 16.3325,
      forecastLongitude: -86.5723,
      description:
        "A steep coral buttress stepping down into deep water. Intersecting sand channels create natural pathways through the reef, dotted with large orange elephant ear sponges.",
      marineLife: "Orange elephant ear sponge · green moray · Caribbean reef shark · French grunt",
      marineLifeDescription:
        "Reef sharks often cruise along the outer drop, while green morays poke their snouts out from the buttress base.",
      difficultyLevel: "intermediate",
      depthMinMeters: 11,
      maxDepthMeters: 25,
      currentNote:
        "Can experience brisk north shore tidal currents. Watch your depth gauge along the wall.",
      divePlan:
        "Descend to the buttress crest at 11 m (36 ft), track along the wall face to 25 m (82 ft), and ascend through the sand chute back to the mooring.",
      fitTone: "welcoming",
      fitNote:
        "Rewarding wall dive featuring dramatic sponge formations and frequent pelagic sightings.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Elephant Ear Wall",
          kind: "reefFormation",
          note: "A sheer section of the buttress adorned with massive orange elephant ear sponges.",
        },
      ],
      creatureSlugs: [
        "orange-elephant-ear-sponge",
        "green-moray",
        "caribbean-reef-shark",
        "french-grunt",
      ],
    },
  },
  // Denominator row: Baby Stan
  {
    slug: "baby-stan-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://anthonyskey.com/daily-dive-sites-log/",
    ],
    briefing: {
      name: "Baby Stan",
      locationName: "Sandy Bay, Roatán",
      forecastLatitude: 16.3356,
      forecastLongitude: -86.5703,
      description:
        "A gentle coral ridge fronting Sandy Bay with an easy profile and clear, calm conditions. The top of the reef is a bustling nursery for young reef fish.",
      marineLife: "Bluehead wrasse · sergeant major · hawksbill turtle · stoplight parrotfish",
      marineLifeDescription:
        "Thick clouds of juvenile wrasses and damselfish feed above the coral heads, accompanied by grazing parrotfish.",
      difficultyLevel: "beginner",
      depthMinMeters: 7,
      maxDepthMeters: 16,
      currentNote: "Current is typically slight to none. Listen for boat motors before ascending.",
      divePlan:
        "Descend to 7 m (23 ft) at the mooring pin, swim along the upper ridge to 16 m (52 ft), and finish with a long, relaxed safety stop over the coral top.",
      fitTone: "welcoming",
      fitNote:
        "Calm, shallow, and full of color. Ideal for novice divers, families, and long relaxing dives.",
      minimumCertificationLevel: "open_water",
      landmarks: [
        {
          name: "Nursery Ridge",
          kind: "reefFormation",
          note: "A shallow, sunny crest of staghorn and fire coral alive with juvenile fish.",
        },
      ],
      creatureSlugs: [
        "bluehead-wrasse",
        "sergeant-major",
        "hawksbill-turtle",
        "stoplight-parrotfish",
      ],
    },
  },
  // Denominator row: CJ's Place
  {
    slug: "cjs-place-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://anthonyskey.com/daily-dive-sites-log/",
    ],
    briefing: {
      name: "CJ's Place",
      locationName: "Sandy Bay, Roatán",
      forecastLatitude: 16.3374,
      forecastLongitude: -86.568,
      description:
        "A defined coral wall marked by deep vertical crevices and undercut ledges. Giant barrel sponges jut out into the blue, creating ideal photo vantage points.",
      marineLife: "Giant barrel sponge · black coral · horse-eye jack · great barracuda",
      marineLifeDescription:
        "Horse-eye jacks often circle in the blue water off the wall, and barracudas linger near the surface mooring.",
      difficultyLevel: "advanced",
      depthMinMeters: 12,
      maxDepthMeters: 28,
      currentNote:
        "Longshore drift can pick up without warning. Deploy an SMB when surfacing off the mooring line.",
      divePlan:
        "Drop down the pin to 12 m (40 ft), explore the wall face between 18 and 28 m (60 to 92 ft), and ascend to the reef crest to bleed off nitrogen.",
      fitTone: "demanding",
      fitNote: "Deep wall diving requiring disciplined depth awareness and good buoyancy control.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The CJ Crevice",
          kind: "reefFormation",
          note: "A wide fracture running vertically down the wall face from 14 to 26 m (46 to 85 ft).",
        },
      ],
      creatureSlugs: ["giant-barrel-sponge", "black-coral", "horse-eye-jack", "great-barracuda"],
    },
  },
  // Denominator row: Wrasse Hole
  {
    slug: "wrasse-hole-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://anthonyskey.com/daily-dive-sites-log/",
    ],
    briefing: {
      name: "Wrasse Hole",
      locationName: "Sandy Bay, Roatán",
      forecastLatitude: 16.3405,
      forecastLongitude: -86.5619,
      description:
        "A circular sand bowl framed by towering coral ridges near Sandy Bay. Swarms of wrasses and cleaner gobies maintain busy cleaning stations along the bowl's perimeter.",
      marineLife: "Creole wrasse · bluehead wrasse · southern stingray · gray snapper",
      marineLifeDescription:
        "Bands of creole wrasse swirl in dynamic feeding ribbons while stingrays rest partially buried in the sand bowl.",
      difficultyLevel: "beginner",
      depthMinMeters: 8,
      maxDepthMeters: 17,
      currentNote: "Well sheltered from prevailing swell; currents are usually negligible.",
      divePlan:
        "Descend to the lip of the bowl at 8 m (26 ft), explore the sandy floor down to 17 m (56 ft), and complete your safety stop over the coral rim.",
      fitTone: "welcoming",
      fitNote:
        "Protected bowl topography makes navigation foolproof and marine life observation effortless.",
      minimumCertificationLevel: "open_water",
      landmarks: [
        {
          name: "The Wrasse Bowl",
          kind: "reefFormation",
          note: "A distinct circular amphitheater of sand surrounded by coral bommies and cleaning stations.",
        },
      ],
      creatureSlugs: ["creole-wrasse", "bluehead-wrasse", "southern-stingray", "gray-snapper"],
    },
  },
  // Denominator row: Barry's Reef
  {
    slug: "barrys-reef-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://anthonyskey.com/daily-dive-sites-log/",
    ],
    briefing: {
      name: "Barry's Reef",
      locationName: "Sandy Bay, Roatán",
      forecastLatitude: 16.3418,
      forecastLongitude: -86.5614,
      description:
        "A continuous coral barrier with prominent finger spurs extending toward the outer drop-off. Elkhorn coral skeletons provide intricate habitat for macro critters and reef fish.",
      marineLife: "Spiny lobster · channel clinging crab · French grunt · stoplight parrotfish",
      marineLifeDescription:
        "Channel clinging crabs and spiny lobsters shelter under the thick coral overhangs during daylight hours.",
      difficultyLevel: "intermediate",
      depthMinMeters: 9,
      maxDepthMeters: 20,
      currentNote: "Light to moderate drift along the reef line. Carry an SMB.",
      divePlan:
        "Descend to 9 m (30 ft) at the mooring, track outward along the coral finger to 20 m (65 ft), and return along the upper reef crest.",
      fitTone: "welcoming",
      fitNote:
        "Classic Roatán north shore spur-and-groove diving with rewarding structure and crustacean life.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Barry's Finger",
          kind: "reefFormation",
          note: "A long, pronounced coral spur reaching out into blue water at 18 m (60 ft).",
        },
      ],
      creatureSlugs: [
        "spiny-lobster",
        "channel-clinging-crab",
        "french-grunt",
        "stoplight-parrotfish",
      ],
    },
  },
  // Denominator row: Mora Channel
  {
    slug: "mora-channel-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://anthonyskey.com/daily-dive-sites-log/",
    ],
    briefing: {
      name: "Mora Channel",
      locationName: "Sandy Bay, Roatán",
      forecastLatitude: 16.349,
      forecastLongitude: -86.5514,
      description:
        "A broad oceanic cut cutting through the barrier reef system. The channel funnels nutrient-rich water, attracting pelagic fish, rays, and passing sea turtles.",
      marineLife: "Spotted eagle ray · great barracuda · hawksbill turtle · horse-eye jack",
      marineLifeDescription:
        "Eagle rays often cruise through the channel center against the tide, while schools of jacks hold station along the channel walls.",
      difficultyLevel: "intermediate",
      depthMinMeters: 10,
      maxDepthMeters: 24,
      currentNote:
        "Tidal flow can create noticeable currents through the channel; time your swim with the flow.",
      divePlan:
        "Drop into the channel rim at 10 m (33 ft), cross along the channel slope to 24 m (80 ft), and ascend to the channel shoulder for your safety stop.",
      fitTone: "welcoming",
      fitNote:
        "Engaging topography and higher chances of seeing passing pelagic animals in open water.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Channel Mouth",
          kind: "reefFormation",
          note: "Where the sandy channel floor drops away toward the deep outer shelf.",
        },
      ],
      creatureSlugs: ["spotted-eagle-ray", "great-barracuda", "hawksbill-turtle", "horse-eye-jack"],
    },
  },
  // Denominator row: Big Surprise
  {
    slug: "big-surprise-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://anthonyskey.com/daily-dive-sites-log/",
    ],
    briefing: {
      name: "Big Surprise",
      locationName: "South Shore, Roatán",
      forecastLatitude: 16.3649,
      forecastLongitude: -86.516,
      description:
        "An unexpected offshore pinnacle rising from the south shore shelf. Covered in delicate soft corals, black coral, and deep-water gorgonians, the pinnacle draws ocean wanderers.",
      marineLife: "Caribbean reef shark · black coral · horse-eye jack · ocean triggerfish",
      marineLifeDescription:
        "Reef sharks and jacks frequently circle the pinnacle crest, with ocean triggerfish cruising the blue edge.",
      difficultyLevel: "advanced",
      depthMinMeters: 15,
      maxDepthMeters: 30,
      currentNote:
        "Strong currents can sweep across the open pinnacle. Divers must be able to complete a blue water negative descent.",
      divePlan:
        "Descend quickly to the pinnacle crest at 15 m (50 ft), circle the structure down to 30 m (100 ft), and ascend up the mooring line.",
      fitTone: "demanding",
      fitNote:
        "Exposed offshore structure subject to current and open-ocean conditions, reserved for experienced divers.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The Pinnacle Summit",
          kind: "reefFormation",
          note: "The top of the coral spire at 15 m (50 ft), crowded with sea fans and schooling jacks.",
        },
      ],
      creatureSlugs: ["caribbean-reef-shark", "black-coral", "horse-eye-jack", "ocean-triggerfish"],
    },
  },
  // Denominator row: Lita's Hole
  {
    slug: "litas-hole-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://www.roatandivecenter.com/roatan-dive-sites",
    ],
    briefing: {
      name: "Lita's Hole",
      locationName: "South Shore, Roatán",
      forecastLatitude: 16.3193,
      forecastLongitude: -86.4946,
      description:
        "A steep, winding crevice on Roatán's south shore cut deep into the reef wall. The chasm floor is lined with coarse white sand, while the vertical rock faces carry giant barrel sponges.",
      marineLife: "Giant barrel sponge · green moray · spiny lobster · glassy sweeper",
      marineLifeDescription:
        "Glassy sweepers cluster inside shaded undercut notches, and large green morays wind between coral boulders.",
      difficultyLevel: "advanced",
      depthMinMeters: 12,
      maxDepthMeters: 28,
      currentNote:
        "South shore chop and swell can be present at the surface; currents along the wall are generally manageable.",
      divePlan:
        "Descend to 12 m (40 ft) at the mooring, navigate into the wide open cleft down to 28 m (92 ft), and ascend along the outer wall.",
      fitTone: "demanding",
      fitNote:
        "Dramatic relief and sheer vertical rock faces require disciplined buoyancy and depth management.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The Crevice Floor",
          kind: "reefFormation",
          note: "A sandy chute at 24 m (80 ft) flanked by towering limestone walls.",
        },
      ],
      creatureSlugs: ["giant-barrel-sponge", "green-moray", "spiny-lobster", "glassy-sweeper"],
    },
  },
  // Denominator row: D2T
  {
    slug: "d2t-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://www.roatandivecenter.com/roatan-dive-sites",
    ],
    briefing: {
      name: "D2T",
      locationName: "South Shore, Roatán",
      forecastLatitude: 16.3203,
      forecastLongitude: -86.4928,
      description:
        "A dramatic south shore wall dive featuring deep vertical fissures and overhangs draped in black coral and rope sponges. The wall plunges into oceanic depths.",
      marineLife: "Black coral · red rope sponge · great barracuda · horse-eye jack",
      marineLifeDescription:
        "Jacks and barracudas hunt in the blue water along the wall, while rope sponges cascade down the vertical faces.",
      difficultyLevel: "advanced",
      depthMinMeters: 14,
      maxDepthMeters: 30,
      currentNote:
        "Currents can run swiftly along this exposed south wall; drift diving protocol applies.",
      divePlan:
        "Drop down the pin to 14 m (46 ft), drift along the wall between 20 and 30 m (65 to 100 ft), and ascend to the shallow reef top for your safety stop.",
      fitTone: "demanding",
      fitNote:
        "Deep wall diving along an exposed coastline, suited for divers experienced with drift and depth discipline.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The Vertical Cut",
          kind: "reefFormation",
          note: "A narrow vertical fault slicing through the wall face from 16 to 30 m (52 to 100 ft).",
        },
      ],
      creatureSlugs: ["black-coral", "red-rope-sponge", "great-barracuda", "horse-eye-jack"],
    },
  },
  // Denominator row: Shark Bait Deep
  {
    slug: "shark-bait-deep-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://www.roatandivecenter.com/roatan-dive-sites",
    ],
    briefing: {
      name: "Shark Bait Deep",
      locationName: "South Shore, Roatán",
      forecastLatitude: 16.3218,
      forecastLongitude: -86.4854,
      description:
        "An impressive drop-off along the outer south reef known for pelagic encounters. The wall starts around 14 m (46 ft) and drops vertically, with large barrel sponges clinging to the rock face.",
      marineLife: "Caribbean reef shark · spotted eagle ray · giant barrel sponge · dog snapper",
      marineLifeDescription:
        "Reef sharks routinely patrol the depths below the wall rim, accompanied by eagle rays cruising the blue.",
      difficultyLevel: "advanced",
      depthMinMeters: 14,
      maxDepthMeters: 30,
      currentNote:
        "South coast currents can be brisk. Maintain close buddy contact and deploy an SMB upon ascent.",
      divePlan:
        "Descend to the reef rim at 14 m (46 ft), cruise the wall face down to 30 m (100 ft) keeping watch into open water, and ascend to the reef crest.",
      fitTone: "demanding",
      fitNote:
        "Deep wall dive with open-ocean exposure, best for confident divers comfortable monitoring air and depth.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The Shark Ledge",
          kind: "reefFormation",
          note: "A wide limestone shelf at 25 m (82 ft) overlooking the deep oceanic drop.",
        },
      ],
      creatureSlugs: [
        "caribbean-reef-shark",
        "spotted-eagle-ray",
        "giant-barrel-sponge",
        "dog-snapper",
      ],
    },
  },
  // Denominator row: Marilyn's Front Porch
  {
    slug: "marilyns-front-porch-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://www.roatandivecenter.com/roatan-dive-sites",
      "https://anthonyskey.com/daily-dive-sites-log/",
    ],
    briefing: {
      name: "Marilyn's Front Porch",
      locationName: "South Shore, Roatán",
      forecastLatitude: 16.3258,
      forecastLongitude: -86.4824,
      description:
        "A wide coral shelf extending from the south shore reef like a veranda before dropping off into deep water. Dense clusters of sea fans, plumes, and sponges blanket the plateau.",
      marineLife: "Hawksbill turtle · common sea fan · French grunt · stoplight parrotfish",
      marineLifeDescription:
        "Turtles are frequently seen resting on the porch shelf, surrounded by schools of grunts and parrotfish.",
      difficultyLevel: "intermediate",
      depthMinMeters: 10,
      maxDepthMeters: 22,
      currentNote:
        "Currents are moderate along the shelf edge; stay on the sheltered side of the reef if current builds.",
      divePlan:
        "Descend to the shelf at 10 m (33 ft), explore the outer rim to 22 m (72 ft), and return across the vibrant plateau to safety stop depth.",
      fitTone: "welcoming",
      fitNote:
        "Terraced structure and gentle current make for an enjoyable, scenic drift across the reef.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The Front Porch",
          kind: "reefFormation",
          note: "A wide, flat coral terrace extending outward at 14 m (46 ft).",
        },
      ],
      creatureSlugs: ["hawksbill-turtle", "common-sea-fan", "french-grunt", "stoplight-parrotfish"],
    },
  },
  // Denominator row: Connie's Dream
  {
    slug: "connies-dream-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://anthonyskey.com/daily-dive-sites-log/",
    ],
    briefing: {
      name: "Connie's Dream",
      locationName: "South Shore, Roatán",
      forecastLatitude: 16.3237,
      forecastLongitude: -86.4838,
      description:
        "A sloping south shore reef rich with dramatic coral heads and winding sand gullies. High biodiversity and excellent coral cover make this a favorite site for underwater photographers.",
      marineLife: "Spotted drum · flamingo tongue · southern stingray · queen triggerfish",
      marineLifeDescription:
        "Flamingo tongues graze sea fans along the slope, while spotted drums flit among the low limestone caverns.",
      difficultyLevel: "intermediate",
      depthMinMeters: 10,
      maxDepthMeters: 20,
      currentNote:
        "Surface swell can develop on breezy days; underwater currents are typically gentle.",
      divePlan:
        "Drop down to 10 m (33 ft), meander through the coral gullies to 20 m (65 ft), and ascend gradually along the reef slope.",
      fitTone: "welcoming",
      fitNote: "Engaging topography and rich macro life suitable for all intermediate divers.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Connie's Coral Spire",
          kind: "reefFormation",
          note: "A large isolated coral pinnacle rising from 18 m to 11 m (60 to 36 ft).",
        },
      ],
      creatureSlugs: ["spotted-drum", "flamingo-tongue", "southern-stingray", "queen-triggerfish"],
    },
  },
  // Denominator row: MacCallum Girls
  {
    slug: "maccallum-girls-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://www.roatandivecenter.com/roatan-dive-sites",
    ],
    briefing: {
      name: "MacCallum Girls",
      locationName: "South Shore, Roatán",
      forecastLatitude: 16.3284,
      forecastLongitude: -86.4822,
      description:
        "A series of high coral mounds rising from a sand plain near Brick Bay. Dense soft corals and sponges cover the tops, while the sand channels harbor rays and jawfish.",
      marineLife: "Yellowhead jawfish · peacock flounder · hawksbill turtle · French grunt",
      marineLifeDescription:
        "Jawfish pop up and down in the sandy alleys, while hawksbills graze the sponge-encrusted mounds.",
      difficultyLevel: "beginner",
      depthMinMeters: 8,
      maxDepthMeters: 18,
      currentNote: "Usually calm with minimal current. Listen for boat traffic before ascending.",
      divePlan:
        "Descend to the sand at 8 m (26 ft), circle the coral mounds out to 18 m (60 ft), and return to the mooring across the shallow reef crest.",
      fitTone: "welcoming",
      fitNote: "Relaxed, shallow diving with generous bottom times and excellent natural lighting.",
      minimumCertificationLevel: "open_water",
      landmarks: [
        {
          name: "Twin Coral Mounds",
          kind: "reefFormation",
          note: "Two prominent adjacent coral formations rising 6 m proud of the seabed.",
        },
      ],
      creatureSlugs: ["yellowhead-jawfish", "peacock-flounder", "hawksbill-turtle", "french-grunt"],
    },
  },
  // Denominator row: Brick Bay Wall
  {
    slug: "brick-bay-wall-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://www.roatandivecenter.com/roatan-dive-sites",
    ],
    briefing: {
      name: "Brick Bay Wall",
      locationName: "South Shore, Roatán",
      forecastLatitude: 16.3298,
      forecastLongitude: -86.4808,
      description:
        "A sheer wall off Brick Bay dropping into the abyss. Deep crevices cut into the face, hosting yellow tube sponges, black coral, and sheltering groupers.",
      marineLife: "Black grouper · giant barrel sponge · black coral · horse-eye jack",
      marineLifeDescription:
        "Groupers watch from deep recesses while schools of jacks flash past in the open blue.",
      difficultyLevel: "advanced",
      depthMinMeters: 12,
      maxDepthMeters: 28,
      currentNote:
        "Currents can run parallel to the coast; drift diving skills and an SMB are recommended.",
      divePlan:
        "Descend to the wall crest at 12 m (40 ft), cruise along the face between 18 and 28 m (60 to 92 ft), and ascend to the reef flat to end your dive.",
      fitTone: "demanding",
      fitNote: "A true wall experience with significant vertical relief and deep water below.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The Brick Bay Buttress",
          kind: "reefFormation",
          note: "A projecting coral buttress offering wide panoramic views into the deep channel.",
        },
      ],
      creatureSlugs: ["black-grouper", "giant-barrel-sponge", "black-coral", "horse-eye-jack"],
    },
  },
  // Denominator row: Doc's Retreat
  {
    slug: "docs-retreat-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://cocoviewresort.com/?p=500",
      "https://www.roatandivecenter.com/roatan-dive-sites",
    ],
    briefing: {
      name: "Doc's Retreat",
      locationName: "South Shore, Roatán",
      forecastLatitude: 16.3372,
      forecastLongitude: -86.47,
      description:
        "A favorite south shore dive site near French Harbor characterized by rolling coral ridges and clear sandy troughs. Coral cover is thick and healthy, teeming with macro life.",
      marineLife: "Spiny lobster · green moray · stoplight parrotfish · blue tang",
      marineLifeDescription:
        "Morays and lobsters share deep holes in the reef, while blue tang schools graze the algae-rich crests.",
      difficultyLevel: "intermediate",
      depthMinMeters: 10,
      maxDepthMeters: 22,
      currentNote: "Currents are typically mild. Watch for south shore chop during boarding.",
      divePlan:
        "Descend to 10 m (33 ft) at the mooring, follow the main ridge line to 22 m (72 ft), and zig-zag back through the sand gullies.",
      fitTone: "welcoming",
      fitNote:
        "Pleasant topography with gentle slopes and abundant fish life, suitable for all skill levels.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Doc's Ridge",
          kind: "reefFormation",
          note: "A coral ridge covered in sea plumes running perpendicular to the shoreline.",
        },
      ],
      creatureSlugs: ["spiny-lobster", "green-moray", "stoplight-parrotfish", "blue-tang"],
    },
  },
  // Denominator row: Osman's Reef
  {
    slug: "osmans-reef-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://www.roatandivecenter.com/roatan-dive-sites",
    ],
    briefing: {
      name: "Osman's Reef",
      locationName: "South Shore, Roatán",
      forecastLatitude: 16.3485,
      forecastLongitude: -86.4487,
      description:
        "A rich coral terrace on the south coast sloping toward French Cay Cut. Expansive beds of leaf and plate corals provide shelter for schools of grunts and snappers.",
      marineLife: "Schoolmaster snapper · French grunt · southern stingray · trumpetfish",
      marineLifeDescription:
        "Thick schools of snappers hover over the plate corals, while stingrays feed along the sand borders.",
      difficultyLevel: "intermediate",
      depthMinMeters: 10,
      maxDepthMeters: 20,
      currentNote:
        "Current can sweep toward French Cay Cut on tidal changes; monitor your position relative to the boat.",
      divePlan:
        "Drop down to 10 m (33 ft), explore the coral slope down to 20 m (65 ft), and ascend to the shallow terrace to finish your dive.",
      fitTone: "welcoming",
      fitNote: "Vibrant coral garden with gentle slopes and great ambient light.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Plate Coral Terrace",
          kind: "reefFormation",
          note: "A wide reef flat covered in overlapping layers of plate and lettuce corals.",
        },
      ],
      creatureSlugs: ["schoolmaster-snapper", "french-grunt", "southern-stingray", "trumpetfish"],
    },
  },
  // Denominator row: French Cay Cut
  {
    slug: "french-cay-cut-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://cocoviewresort.com/?p=500",
      "https://www.roatandivecenter.com/roatan-dive-sites",
    ],
    briefing: {
      name: "French Cay Cut",
      locationName: "South Shore, Roatán",
      forecastLatitude: 16.3502,
      forecastLongitude: -86.446,
      description:
        "A prominent pass through the south barrier reef where ocean swells meet the sheltered lagoon. The current-swept walls host large sponges and schooling jacks.",
      marineLife: "Spotted eagle ray · Caribbean reef shark · great barracuda · horse-eye jack",
      marineLifeDescription:
        "Eagle rays glide effortlessly against the tidal flow while reef sharks cruise the channel entrance.",
      difficultyLevel: "advanced",
      depthMinMeters: 12,
      maxDepthMeters: 28,
      currentNote: "Strong tidal currents regularly flow through this cut. Run as a drift dive.",
      divePlan:
        "Drop into the cut entrance at 12 m (40 ft), drift along the channel wall to 28 m (92 ft), and ascend with a surface marker buoy in open water.",
      fitTone: "demanding",
      fitNote:
        "Current-rich pass dive requiring comfortable drift diving skills and rapid descent capability.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The Cut Wall",
          kind: "reefFormation",
          note: "A sheer channel wall scoured clean by tidal currents and lined with rope sponges.",
        },
      ],
      creatureSlugs: [
        "spotted-eagle-ray",
        "caribbean-reef-shark",
        "great-barracuda",
        "horse-eye-jack",
      ],
    },
  },
  // Denominator row: Valley of the Kings
  {
    slug: "valley-of-the-kings-roatan",
    version: 1,
    area: "honduras-roatan",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://www.roatandivecenter.com/roatan-dive-sites",
      "https://anthonyskey.com/daily-dive-sites-log/",
    ],
    briefing: {
      name: "Valley of the Kings",
      locationName: "South Shore, Roatán",
      forecastLatitude: 16.351,
      forecastLongitude: -86.4378,
      description:
        "A monumental reef landscape of towering coral buttresses separated by majestic sandy canyons near French Harbor. Giant barrel sponges crown each massive coral structure.",
      marineLife: "Giant barrel sponge · black coral · Caribbean reef shark · dog snapper",
      marineLifeDescription:
        "Reef sharks navigate the sandy canyons between buttresses, while dog snappers hover beneath deep overhangs.",
      difficultyLevel: "advanced",
      depthMinMeters: 12,
      maxDepthMeters: 30,
      currentNote:
        "Can experience brisk currents along the buttress flanks. Keep track of your navigation reference.",
      divePlan:
        "Descend to the buttress top at 12 m (40 ft), glide down through the central canyon to 30 m (100 ft), and weave through the shallower monoliths on your ascent.",
      fitTone: "demanding",
      fitNote:
        "Grand underwater architecture with significant vertical relief, suited for experienced divers.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The Royal Canyon",
          kind: "reefFormation",
          note: "A wide sandy valley at 26 m (85 ft) flanked by towering 10-meter-tall coral buttresses.",
        },
      ],
      creatureSlugs: ["giant-barrel-sponge", "black-coral", "caribbean-reef-shark", "dog-snapper"],
    },
  },
];
