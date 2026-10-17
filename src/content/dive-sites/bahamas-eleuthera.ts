// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Eleuthera and Harbour Island. */
export const BAHAMAS_ELEUTHERA: DiveSiteTemplate[] = [
  // Denominator row: Devil's Backbone (Devil's Backbone Wrecks)
  {
    slug: "devils-backbone-eleuthera",
    version: 1,
    area: "bahamas-eleuthera",
    sources: [
      "https://www.myoutislands.com/bahamas-islands/eleuthera/diving",
      "https://www.dive-the-world.com/posts/eleuthera/eleuthera-diving-guide-premier-dive-sites-bahamas.php",
      "https://sites.google.com/site/projecteleuthera/underwater-sites",
      "https://www.zentacle.com/Beach/3567/devils-backbone",
    ],
    briefing: {
      name: "Devil’s Backbone Wrecks",
      locationName: "Devil’s Backbone, North Eleuthera",
      // Approximate pin: only one listing publishes a position (25.5770, -76.6869). It is in the
      // water about 2 km north-northeast of Preacher’s Cave beach (25.5580, -76.6961 in
      // OpenStreetMap), which fits Project Eleuthera’s “just off the north tip near Preacher’s
      // Cave” and the Cienfuegos “five miles north of Harbour Island”. Good to about 2 km. The reef
      // runs along the whole north coast, so a shop edits the point to the wreck it moors at.
      forecastLatitude: 25.577,
      forecastLongitude: -76.6869,
      description:
        "A long, shallow rock reef off Eleuthera’s north coast that has sunk more ships than any other reef in the Bahamas. Several wrecks lie a short swim apart, among them the Cienfuegos, a steamer lost in 1895, and the Train Wreck, a barge that carried a locomotive in 1865.",
      marineLife: "Spotted trunkfish · angelfish · parrotfish · snapper",
      marineLifeDescription:
        "Iron and plating are covered in coral and sponge, and fish gather around the larger pieces. Look at the small things on the wreckage as much as the big ones.",
      difficultyLevel: "intermediate",
      depthMinMeters: 5,
      maxDepthMeters: 11,
      currentNote:
        "Called off when the surf breaks over the wrecks. Carry an SMB and surface only where the crew can reach you, away from the breaking reef. Breakers pound this shallow, ragged reef and the surf is rarely calm, so expect surge among the wrecks. Tidal water flows around the north end of the island; current is otherwise not documented, so ask the crew on the day. Shore dives to the wrecks are difficult, so go by boat. The wrecks lie flattened, with twisted plates and beams: keep your hands and your gear clear of torn metal.",
      divePlan:
        "Enter and exit from the boat. Follow the guide from one wreck to the next in the shallows, keeping clear of the reef. Stay outside every hull and boiler.",
      fitTone: "demanding",
      fitNote:
        "Shallow water and good light, with surge to handle in the wrecks. Best on a calmer day, with a guide who knows the reef.",
      // Gated Advanced Open Water for the surf and surge on the breaking reef, consistent with Cow and Calf and Bronco Billy.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Cienfuegos",
          kind: "pointOfInterest",
          note: "A steamer lost here in 1895, lying flattened, with the bow, engine and boilers still recognizable. Stay outside the hull and the boilers.",
        },
        {
          name: "Train Wreck",
          kind: "pointOfInterest",
          note: "Wheels, trucks and boiler plates from a barge that carried a locomotive in 1865, in about 5 m (15 ft).",
        },
      ],
      creatureSlugs: [
        "spotted-trunkfish",
        "queen-angelfish",
        "stoplight-parrotfish",
        "gray-snapper",
        "queen-conch",
      ],
    },
  },
  // Denominator row: Carnarvon (wreck)
  {
    slug: "carnarvon-wreck-eleuthera",
    version: 1,
    area: "bahamas-eleuthera",
    sources: [
      "https://www.myoutislands.com/bahamas-islands/eleuthera/diving",
      "https://www.dive-the-world.com/posts/eleuthera/eleuthera-diving-guide-premier-dive-sites-bahamas.php",
      "https://sites.google.com/site/projecteleuthera/underwater-sites",
    ],
    briefing: {
      name: "Carnarvon",
      locationName: "Devil’s Backbone, North Eleuthera",
      // Approximate pin: no source publishes coordinates. Project Eleuthera puts the wreck on the
      // southern edge of the Devil’s Backbone, northeast of the Preacher’s Cave beach (25.5580,
      // -76.6961 in OpenStreetMap), and the two dive guides tie it to the same reef. The pin is
      // in the water about 1 km north-northeast of that beach, 1.3 km from the Devil’s Backbone
      // wreck-cluster pin, and good to about 2 km. A shop confirms its mooring and edits the point.
      forecastLatitude: 25.5655,
      forecastLongitude: -76.692,
      description:
        "A 186-foot steel freighter that served the Bahamas lighthouses and went aground on a coral head in 1916. Her steam engine, driveshaft and boiler are still there, in shallow water off the southern edge of the Devil’s Backbone. The boiler is overhead; stay out.",
      marineLife: "Angelfish · parrotfish · snapper · spotted trunkfish",
      marineLifeDescription:
        "The wreck is an artificial reef for the usual shallow-water crowd. Move slowly around the engine and boiler for the small residents.",
      difficultyLevel: "intermediate",
      depthMinMeters: 5,
      // The sources disagree: one guide gives 25 ft and Project Eleuthera 15–25 ft, another 35 ft.
      // The deeper figure is used.
      maxDepthMeters: 11,
      currentNote:
        "Called off when the surf breaks over the wrecks. Carry an SMB and surface only where the crew can reach you, away from the breaking reef. The wreck lies on the Devil’s Backbone, where breakers pound the shallow reef and the surf is rarely calm, so expect surge. Current is not documented; ask the crew on the day. Go by boat: shore dives to these wrecks are difficult.",
      divePlan:
        "Circle the wreck in the shallows, starting at the engine and driveshaft. Enter and exit from the boat. The boiler is overhead; stay out. Stay outside the hull.",
      fitTone: "demanding",
      fitNote:
        "Shallow and well lit, with surge in the shallows that eases on a calmer day. Keep your fins off the machinery and the sand.",
      // Gated Advanced Open Water for the surf and surge on the breaking reef, as at the Devil’s Backbone wrecks.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "queen-angelfish",
        "stoplight-parrotfish",
        "gray-snapper",
        "spotted-trunkfish",
        "common-sea-fan",
      ],
    },
  },
  // Denominator row: Current Cut
  {
    slug: "current-cut-eleuthera",
    version: 1,
    area: "bahamas-eleuthera",
    sources: [
      "https://www.dive-the-world.com/posts/eleuthera/eleuthera-diving-guide-premier-dive-sites-bahamas.php",
      "https://www.myoutislands.com/bahamas-islands/eleuthera/diving",
      "https://sailabacos.com/bahamas/dive-sites/current-cut",
      "https://www.zentacle.com/Beach/3565/current-cut",
    ],
    briefing: {
      name: "Current Cut",
      locationName: "Current Cut, North Eleuthera",
      // Approximate pin: one listing (25.4036, -76.7922) puts the site on the shore at the gap
      // between North Eleuthera and Current Island, and another (25.3970, -76.7700) is 2.3 km
      // southeast, which is farther than the channel’s stated length of about a kilometer, so the two
      // do not agree. The pin is in the water of the gap beside the first (OpenStreetMap shows
      // water there), good to about 2 km. A shop edits it to its entry point.
      forecastLatitude: 25.4028,
      forecastLongitude: -76.7923,
      description:
        "A fast drift through a narrow channel between North Eleuthera and Current Island, about 100 yards wide. The ride covers nearly a kilometer in roughly ten minutes, past sea fans and sponges with eagle rays and blacktip sharks along the sides.",
      marineLife: "Eagle rays · blacktip sharks · barracuda · spiny lobster",
      marineLifeDescription:
        "The current packs fish into the channel. Look along the edges as you pass for lobster, morays and resting animals.",
      difficultyLevel: "advanced",
      depthMinMeters: 15,
      maxDepthMeters: 18,
      currentNote:
        "Dived only in moderate flow near slack, never at peak, when the tide runs through the channel at 6 to 10 knots. Even then it is a strong drift with no stopping or turning back once you are in it. The crew picks the tide, best on an incoming tide, and calls it off when the flow is too strong. Carry an SMB, because you can surface hundreds of meters from where you started. Visibility is lower than on the reef sites, and the bottom is rocky.",
      divePlan:
        "Agree the tide, the entry and the exit with the crew before you drop. Keep clear of the bottom and do not stop or hold on to the rock. If you can’t keep pace, signal and go up on your SMB. Otherwise send the SMB up on the calmer water at the far end. Staff confirm the diver’s log of drift dives before boarding.",
      fitTone: "demanding",
      fitNote:
        "A fast, one-way ride that asks for sharp buoyancy and calm in moving water. Operators may want a checkout dive first. The cut is a boat ride from Harbour Island, so medical care is far; confirm the boat’s oxygen and plan.",
      // No source documents boat traffic in the cut, so none is claimed; the drift still starts with an SMB.
      // Strong current (6–10 knots) and the sources’ own Advanced rating: Advanced Open Water, an SMB and tide timing.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "spotted-eagle-ray",
        "blacktip-shark",
        "great-barracuda",
        "spiny-lobster",
        "green-moray",
        "common-sea-fan",
      ],
    },
  },
];
