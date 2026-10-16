// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Miami-Dade: Sunny Isles to Biscayne National Park. */
export const FLORIDA_MIAMI: DiveSiteTemplate[] = [
  {
    slug: "neptune-memorial-reef",
    version: 2,
    area: "florida-miami",
    sources: [
      "https://nmreef.com/overview/",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Neptune%20Memorial%20Reef%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
    ],
    briefing: {
      name: "Neptune Memorial Reef",
      locationName: "Miami, Florida",
      forecastLatitude: 25.7006,
      forecastLongitude: -80.0902,
      description:
        "An underwater columned city in 12 m of sand off Miami — a cremation memorial built as an artificial reef, with gates, lions and columns colonizing fast.",
      marineLife: "Angelfish · barracuda · sponges · sea fans",
      marineLifeDescription:
        "Purpose-built structure on open sand, which means everything that lives here chose to come.",
      difficultyLevel: "beginner",
      depthRange: "12–14 m (40–45 ft)",
      maxDepthMeters: 14,
      currentNote: "Open water off Miami; a mild drift is common.",
      divePlan:
        "One circuit of the structure with the current, then back through the middle — the whole site fits in a dive.",
      fitTone: "welcoming",
      fitNote:
        "Flat, shallow and easy. It is also a memorial, and divers are asked to treat it as one.",
      landmarks: [
        {
          name: "The gates and lions",
          kind: "underwaterMonument",
          note: "The entrance to the memorial, and the picture the site is known for.",
        },
        {
          name: "The columns",
          kind: "underwaterMonument",
          note: "Standing pillars carrying placed remains. Look, and keep your hands to yourself.",
        },
      ],
      creatureSlugs: [
        "gray-angelfish",
        "great-barracuda",
        "yellow-tube-sponge",
        "common-sea-fan",
        "porkfish",
        "spanish-hogfish",
      ],
    },
  },
  // Denominator row: Emerald Reef
  {
    slug: "emerald-reef",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://floridadep.gov/sites/default/files/SEFLMooringBuoys-Print_BrochurePDF_05152024_KJCAP.pdf",
      "https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/MarineBuoy_gdb/FeatureServer/0/query?where=NAME%3D%27Emerald%20Reef%27&outFields=NAME,BUOYID,DEPTH,LATDMS,LONDMS&returnGeometry=false&f=json",
      "https://diversparadise.miami/divesites/",
      "https://www.divemiamibeach.com/dive-sites",
    ],
    briefing: {
      name: "Emerald Reef",
      locationName: "off Key Biscayne, Florida",
      forecastLatitude: 25.6774,
      forecastLongitude: -80.0974,
      description:
        "The southernmost of the three buoyed reef patches off Key Biscayne, and by local account the largest natural reef near Miami. Big limestone heads and undercuts give the small animals plenty of places to hide.",
      marineLife: "Grunts · snapper · barracuda · angelfish · stingrays · spiny lobster",
      marineLifeDescription:
        "Schooling grunts over the heads, lobster in the cracks, and a stingray on the sand more often than not.",
      difficultyLevel: "beginner",
      depthRange: "6–9 m (21–30 ft)",
      maxDepthMeters: 9,
      currentNote:
        "Usually an easy reef dive, with a mild northerly drift on some days. Use the county mooring buoys rather than anchoring on the reef, and fly a dive flag: Florida law asks boats to keep 300 ft from it in open water and divers to surface within 300 ft of it.",
      fitTone: "welcoming",
      fitNote: "Shallow, roomy and full of life. A good first ocean dive.",
      creatureSlugs: [
        "bluestriped-grunt",
        "great-barracuda",
        "french-angelfish",
        "southern-stingray",
        "spiny-lobster",
        "giant-anemone",
      ],
    },
  },
  // Denominator row: Rainbow Reef
  {
    slug: "rainbow-reef-miami",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://floridadep.gov/sites/default/files/SEFLMooringBuoys-Print_BrochurePDF_05152024_KJCAP.pdf",
      "https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/MarineBuoy_gdb/FeatureServer/0/query?where=NAME%3D%27Rainbow%20Reef%27&outFields=NAME,BUOYID,DEPTH,LATDMS,LONDMS&returnGeometry=false&f=json",
      "https://diversparadise.miami/divesites/",
      "https://www.divemiamibeach.com/dive-sites",
    ],
    briefing: {
      name: "Rainbow Reef",
      locationName: "off Key Biscayne, Florida",
      forecastLatitude: 25.692,
      forecastLongitude: -80.0972,
      description:
        "A medium-profile natural reef about three miles out, with hard and soft corals on every head and tropical fish all over them. Local shops use it for newer divers because it is shallow, buoyed and easy to find your way around.",
      marineLife: "Parrotfish · grunts · sergeant majors · sea fans · brain coral",
      marineLifeDescription:
        "The name fits: a little of every reef fish Miami has, over a good mix of the corals.",
      difficultyLevel: "beginner",
      depthRange: "5–9 m (17–30 ft)",
      maxDepthMeters: 9,
      currentNote:
        "Normally gentle, though a northerly set can turn it into a slow drift. Tie up to a mooring buoy instead of anchoring, and keep the dive flag up for passing boat traffic.",
      fitTone: "welcoming",
      fitNote: "One of the area's go-to reefs for new and returning divers.",
      creatureSlugs: [
        "stoplight-parrotfish",
        "bluestriped-grunt",
        "sergeant-major",
        "common-sea-fan",
        "boulder-brain-coral",
      ],
    },
  },
  // Denominator row: Flamingo Reef
  {
    slug: "flamingo-reef",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://floridadep.gov/sites/default/files/SEFLMooringBuoys-Print_BrochurePDF_05152024_KJCAP.pdf",
      "https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/MarineBuoy_gdb/FeatureServer/0/query?where=NAME%3D%27Flamingo%20Reef%27&outFields=NAME,BUOYID,DEPTH,LATDMS,LONDMS&returnGeometry=false&f=json",
      "https://diversparadise.miami/divesites/",
    ],
    briefing: {
      name: "Flamingo Reef",
      locationName: "off Key Biscayne, Florida",
      forecastLatitude: 25.7039,
      forecastLongitude: -80.0997,
      description:
        "A buoyed natural reef between Rainbow Reef and RJ's Ledge, busy with schooling tropical fish. Its name comes from a stand of elkhorn coral that local divers say is shaped like a flamingo.",
      marineLife: "Schooling tropicals · blue tangs · grunts · parrotfish · sea fans",
      difficultyLevel: "beginner",
      depthRange: "7–10 m (22–32 ft)",
      maxDepthMeters: 10,
      currentNote:
        "Generally mild, with the occasional northerly drift. Elkhorn coral is a protected species, so keep fins and hands well clear, use the mooring buoys, and fly a dive flag.",
      fitTone: "welcoming",
      creatureSlugs: [
        "blue-tang",
        "bluestriped-grunt",
        "sergeant-major",
        "stoplight-parrotfish",
        "common-sea-fan",
      ],
    },
  },
  // Denominator row: RJ's Ledge
  {
    slug: "rjs-ledge",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://floridadep.gov/sites/default/files/SEFLMooringBuoys-Print_BrochurePDF_05152024_KJCAP.pdf",
      "https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/MarineBuoy_gdb/FeatureServer/0/query?where=NAME%3D%27RJ%27%27s%20Ledge%27&outFields=NAME,BUOYID,DEPTH,LATDMS,LONDMS&returnGeometry=false&f=json",
      "https://diversparadise.miami/divesites/",
      "https://www.divemiamibeach.com/dive-sites",
    ],
    briefing: {
      name: "RJ's Ledge",
      locationName: "off Key Biscayne, Florida",
      forecastLatitude: 25.7224,
      forecastLongitude: -80.0992,
      description:
        "Patch reef north of Rainbow Reef, broken up by limestone outcrops and low ledges. All those overhangs make it one of the better places off Miami to find lobster and eels at home.",
      marineLife: "Spiny lobster · moray eels · grunts · reef fish",
      marineLifeDescription:
        "Look under every ledge: lobster antennae and moray heads are the reward.",
      difficultyLevel: "beginner",
      depthRange: "7–9 m (23–30 ft)",
      maxDepthMeters: 9,
      currentNote:
        "Usually easy, with a mild drift on some days. Use the county mooring buoys and keep a dive flag up. Expect more boats and lobster hunters in the summer lobster season.",
      fitTone: "welcoming",
      creatureSlugs: [
        "spiny-lobster",
        "green-moray",
        "spotted-moray",
        "bluestriped-grunt",
        "french-grunt",
      ],
    },
  },
  // Denominator row: Graceland Reef
  {
    slug: "graceland-reef",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://floridadep.gov/sites/default/files/SEFLMooringBuoys-Print_BrochurePDF_05152024_KJCAP.pdf",
      "https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/MarineBuoy_gdb/FeatureServer/0/query?where=NAME%3D%27Graceland%27&outFields=NAME,BUOYID,DEPTH,LATDMS,LONDMS&returnGeometry=false&f=json",
      "https://diversparadise.miami/divesites/",
    ],
    briefing: {
      name: "Graceland Reef",
      locationName: "off Sunny Isles Beach, Florida",
      forecastLatitude: 25.9355,
      forecastLongitude: -80.1107,
      description:
        "A long stretch of plate reef north of Haulover Inlet where a section broke and dropped a meter or so, leaving a ledge with small hollows underneath. It runs for several hundred meters, so there is more here than one dive covers.",
      marineLife: "Nurse sharks · lobster · porkfish · grunts · hogfish",
      marineLifeDescription:
        "Nurse sharks often rest under the ledge, so bring a light and look in without crowding them.",
      difficultyLevel: "beginner",
      depthRange: "4–7 m (14–22 ft)",
      maxDepthMeters: 7,
      currentNote:
        "Shallow and usually relaxed, which makes it a common second dive. The hollows under the ledge are too small to enter. Boats run in and out of Haulover Inlet nearby, so stay close to the flag and surface carefully.",
      fitTone: "welcoming",
      fitNote: "Easy depth and a long ledge to follow. A calm dive for any open water diver.",
      landmarks: [
        {
          name: "The ledge",
          kind: "reefFormation",
          note: "Where the plate reef broke and dropped, with small hollows underneath. Look in with a light; do not go in.",
        },
      ],
      creatureSlugs: ["nurse-shark", "spiny-lobster", "porkfish", "french-grunt", "hogfish"],
    },
  },
  // Denominator row: The Pillars
  {
    slug: "the-pillars-miami",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://floridadep.gov/sites/default/files/SEFLMooringBuoys-Print_BrochurePDF_05152024_KJCAP.pdf",
      "https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/MarineBuoy_gdb/FeatureServer/0/query?where=NAME%3D%27Pillars%27&outFields=NAME,BUOYID,DEPTH,LATDMS,LONDMS&returnGeometry=false&f=json",
      "https://diversparadise.miami/divesites/",
    ],
    briefing: {
      name: "The Pillars",
      locationName: "off Miami Beach, Florida",
      forecastLatitude: 25.8603,
      forecastLongitude: -80.0996,
      description:
        "A buoyed reef off northern Miami Beach where an old, half-buried pipeline and a structure with two big steel I-beams sit among the rock. Its easy layout makes it a regular training site.",
      marineLife: "Hogfish · grunts · sergeant majors · spiny lobster",
      difficultyLevel: "beginner",
      depthRange: "8–11 m (27–35 ft)",
      maxDepthMeters: 11,
      currentNote:
        "Usually mild. Use the mooring buoys, fly a dive flag, and watch for boat traffic between Government Cut and Haulover Inlet when you come up.",
      fitTone: "welcoming",
      landmarks: [
        {
          name: "The pipeline and I-beams",
          kind: "pointOfInterest",
          note: "A partly buried old pipeline, with a steel structure on two large I-beams beside it.",
        },
      ],
      creatureSlugs: ["hogfish", "bluestriped-grunt", "sergeant-major", "spiny-lobster"],
    },
  },
  // Denominator row: Jose Cuervo (underwater bar)
  {
    slug: "jose-cuervo-underwater-bar",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://floridadep.gov/sites/default/files/SEFLMooringBuoys-Print_BrochurePDF_05152024_KJCAP.pdf",
      "https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/ArtificialReef_gdb/FeatureServer/0/query?where=REEF_NAME%3D%27Jose%20Cuervo%20Reef%27&outFields=REEF_NAME,REEF_DESCRIPTION,REEF_DEPTH,LATITUDE,LONGITUDE,DATE_DEPLOYED&returnGeometry=false&f=json",
      "https://diversparadise.miami/divesites/",
    ],
    briefing: {
      name: "Jose Cuervo Underwater Bar",
      locationName: "South Beach, Miami Beach, Florida",
      forecastLatitude: 25.7689,
      forecastLongitude: -80.1282,
      description:
        "A five-ton concrete bar sunk off Second Street in South Beach in May 2000 as a promotion and handed to the county reef program. Small enough to see in a few minutes, and a fun stop for divers and snorkelers.",
      marineLife: "Sergeant majors · porkfish · grunts · small reef fish",
      difficultyLevel: "beginner",
      depthRange: "5–6 m (15–20 ft)",
      maxDepthMeters: 6,
      currentNote:
        "Very close to the beach and to Government Cut, so expect swimmers, jet skis and boat traffic. Fly a dive flag: Florida law asks boats to stay 300 ft away in open water and 100 ft in inlets and channels, and divers to stay within that distance of the flag.",
      fitTone: "welcoming",
      fitNote: "Shallow and quirky. Good for snorkelers and brand-new divers.",
      landmarks: [
        {
          name: "The bar",
          kind: "underwaterMonument",
          note: "The concrete bar itself, placed in May 2000 with a concrete tetrahedron beside it.",
        },
      ],
      creatureSlugs: ["sergeant-major", "porkfish", "bluestriped-grunt", "french-grunt"],
    },
  },
  // Denominator row: Half Moon
  {
    slug: "half-moon-preserve",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://museumsinthesea.com/half-moon/",
      "https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/MarineBuoy_gdb/FeatureServer/0/query?where=NAME%3D%27Half%20Moon%27&outFields=NAME,BUOYID,DEPTH,LATDMS,LONDMS&returnGeometry=false&f=json",
      "https://www.ace-diving.com/dive-sites",
      "https://diversparadise.miami/divesites/",
    ],
    briefing: {
      name: "Half Moon",
      locationName: "Bear Cut, Key Biscayne, Florida",
      forecastLatitude: 25.7276,
      forecastLongitude: -80.1345,
      description:
        "The steel hull of a racing schooner built in Germany in 1908 as Germania, seized by Britain in 1914 and later moored off Miami as a floating saloon until she sank in the early 1930s. Now a Florida Underwater Archaeological Preserve, lying on shallow sand just outside Bear Cut.",
      marineLife: "Sergeant majors · porkfish · spiny lobster · scorpionfish · angelfish",
      marineLifeDescription:
        "Juvenile reef fish shelter under the hull plates, and the scorpionfish are easy to miss until they move.",
      difficultyLevel: "beginner",
      depthRange: "3–4 m (10–12 ft)",
      maxDepthMeters: 4,
      currentNote:
        "Tidal current runs through Bear Cut, so dive it on a high, slack tide. Red day marker 2 is close by; use a county mooring buoy or anchor in sand well clear of the wreck, and watch for other boats and swimmers. A state preserve: nothing may be taken.",
      divePlan:
        "Swim the outline of the hull from one end to the other, then look under the plating for the small stuff.",
      fitTone: "welcoming",
      fitNote: "Shallow and calm on the right tide. A shipwreck snorkelers can enjoy too.",
      landmarks: [
        {
          name: "The hull",
          kind: "wreckFeature",
          note: "The steel frame and plating of the schooner, covered in soft corals and sponges.",
        },
        {
          name: "Red day marker 2",
          kind: "navigationMark",
          note: "The channel marker just outside Bear Cut that the wreck lies near.",
        },
      ],
      creatureSlugs: [
        "sergeant-major",
        "porkfish",
        "spiny-lobster",
        "spotted-scorpionfish",
        "queen-angelfish",
        "stoplight-parrotfish",
      ],
    },
  },
  // Denominator row: Mandalay
  {
    slug: "mandalay-wreck",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://www.nps.gov/bisc/learn/historyculture/mandalay.htm",
      "https://www.nps.gov/bisc/learn/historyculture/maritime-heritage-trail.htm",
      "https://www.ace-diving.com/dive-sites",
    ],
    briefing: {
      name: "Mandalay",
      locationName: "Long Reef, Biscayne National Park, Florida",
      forecastLatitude: 25.4422,
      forecastLongitude: -80.1217,
      description:
        "A 1928 steel schooner that sailed as a Windjammer cruise ship until she ran onto Long Reef on New Year's Day 1966, with everyone aboard rescued. Her flattened hull is now part of the reef and a stop on the park's Maritime Heritage Trail.",
      marineLife: "Reef fish · parrotfish · sergeant majors · grunts · barracuda",
      marineLifeDescription: "The wreck sits on a living reef, so the fish life is the reef's own.",
      difficultyLevel: "beginner",
      depthRange: "2–6 m (6–20 ft)",
      maxDepthMeters: 6,
      currentNote:
        "Very shallow on an exposed outer reef, so wind and surge decide the day. The park puts mooring buoys on the heritage trail sites: tie up to one and never anchor on coral. Taking anything from the wreck is against federal law, and dive operators running trips in the park need a park permit.",
      fitTone: "welcoming",
      fitNote: "Best as a snorkel or a shallow, relaxed dive in calm weather.",
      landmarks: [
        {
          name: "The hull",
          kind: "wreckFeature",
          note: "The schooner's steel skeleton, embedded in Long Reef.",
        },
      ],
      creatureSlugs: [
        "stoplight-parrotfish",
        "sergeant-major",
        "blue-tang",
        "french-grunt",
        "great-barracuda",
      ],
    },
  },
  // Denominator row: Anchorage Wreck Trek (Miami Wreck Trek, Radio Tower Wreck Trek: Patricia, Miss Karline, Radio Towers, Billy's Barge, Koppin, Larsen Barge)
  {
    slug: "anchorage-wreck-trek",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://floridadep.gov/sites/default/files/SEFLMooringBuoys-Print_BrochurePDF_05152024_KJCAP.pdf",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Radio%20Towers%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Patricia%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://diversparadise.miami/divesites/",
      "https://www.ace-diving.com/dive-sites",
      "https://www.divemiamibeach.com/dive-sites",
    ],
    briefing: {
      name: "Anchorage Wreck Trek",
      locationName: "off Miami Beach, Florida",
      forecastLatitude: 25.8115,
      forecastLongitude: -80.0907,
      description:
        "A cluster of small artificial reefs in Miami's offshore anchorage that divers link into one dive: two steel tugs, the Patricia and the Miss Karline, nineteen pyramids cut from an old Radio Mambi broadcast tower in 1988, and a handful of barges and boulder piles. Everything sits on sand at a similar depth, so you can see several in one tank.",
      marineLife: "Schooling fish · spiny lobster · barracuda · morays · nurse sharks",
      marineLifeDescription:
        "The tower pyramids hold schools of small fish day and night, and lobster tuck in under every barge.",
      difficultyLevel: "beginner",
      depthRange: "14–18 m (45–60 ft)",
      maxDepthMeters: 18,
      currentNote:
        "Often run as a drift, since the current here usually sets north. This is where large ships anchor waiting for the port, and boat traffic from Government Cut and Haulover passes close by, so carry a surface marker and come up under the flag.",
      divePlan:
        "Start at the radio tower pyramids and drift north to the Patricia and Miss Karline, or begin at the Army Tanks and Matthew Lawrence and work across. Rebar stakes on the sand link some of the sites.",
      fitTone: "welcoming",
      fitNote:
        "Easy depths and lots to see. A favorite for new divers and for navigation practice.",
      landmarks: [
        {
          name: "Radio tower pyramids",
          kind: "reefHistory",
          note: "Nineteen steel pyramids, each about 6 m tall, cut from a Radio Mambi transmitter tower and sunk in 1988.",
        },
        {
          name: "Patricia and Miss Karline",
          kind: "wreckFeature",
          note: "Two steel tugs sunk in 1989 and 1990 a short swim apart. Hurricane Andrew tore the Miss Karline open; the Patricia is more intact.",
        },
        {
          name: "John C. Koppin Memorial barge",
          kind: "underwaterMonument",
          note: "A steel barge placed in memory of John Koppin, a Miami Beach police officer.",
        },
      ],
      creatureSlugs: [
        "spiny-lobster",
        "great-barracuda",
        "green-moray",
        "nurse-shark",
        "gray-snapper",
        "tomtate",
      ],
    },
  },
  // Denominator row: Army Tanks
  {
    slug: "miami-army-tanks",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27US%20Army%20Tanks%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://diversparadise.miami/divesites/",
      "https://www.divemiamibeach.com/dive-sites",
      "https://www.ace-diving.com/dive-sites",
    ],
    briefing: {
      name: "Army Tanks",
      locationName: "off Miami Beach, Florida",
      forecastLatitude: 25.8113,
      forecastLongitude: -80.0913,
      description:
        "Two M60 battle tanks placed by Miami-Dade County in 1994 with about a thousand tons of limestone boulders around them. Three decades of sponge, coral and oyster growth have turned them into a busy little reef.",
      marineLife: "Spiny lobster · green moray · nurse shark · reef fish",
      marineLifeDescription:
        "Local shops know a resident nurse shark and a large green moray here; lobster fill the boulders.",
      difficultyLevel: "beginner",
      depthRange: "12–15 m (40–49 ft)",
      maxDepthMeters: 15,
      currentNote:
        "Part of the Anchorage reef site, where freighters wait at anchor and the current usually sets north. Divers often start here and drift on to the radio towers and nearby wrecks, so carry a surface marker and fly a dive flag.",
      fitTone: "welcoming",
      landmarks: [
        {
          name: "The two tanks",
          kind: "wreckFeature",
          note: "M60 tanks lying close together among limestone boulders.",
        },
      ],
      creatureSlugs: ["spiny-lobster", "green-moray", "nurse-shark", "gray-snapper", "porkfish"],
    },
  },
  // Denominator row: Matthew Lawrence
  {
    slug: "matthew-lawrence",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Matthew%20Lawerance%20Memorial%20Reef%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://diversparadise.miami/divesites/",
      "https://www.ace-diving.com/dive-sites",
      "https://www.scubadivinginmiami.com/dive-sites/page/2/",
    ],
    briefing: {
      name: "Matthew Lawrence",
      locationName: "off Miami Beach, Florida",
      forecastLatitude: 25.8114,
      forecastLongitude: -80.0901,
      description:
        "A 110-foot steel vessel sunk by the county in 1996 in memory of Matthew Lawrence, a Miami diver and underwater video pioneer. It stands about 5 m off the sand a short swim from the Army Tanks.",
      marineLife: "Grunts · snapper · barracuda · lobster · morays",
      difficultyLevel: "beginner",
      depthRange: "11–15 m (35–50 ft)",
      maxDepthMeters: 15,
      currentNote:
        "In the Anchorage reef site, with freighters at anchor nearby and a current that usually sets north. Rebar stakes on the sand lead toward the neighboring sites. Stay outside the structure.",
      fitTone: "welcoming",
      fitNote: "A good first wreck: shallow, compact and easy to find again.",
      landmarks: [
        {
          name: "Memorial plaque",
          kind: "underwaterMonument",
          note: "A plaque to Matthew Lawrence on top of the pilot house.",
        },
      ],
      creatureSlugs: [
        "bluestriped-grunt",
        "gray-snapper",
        "great-barracuda",
        "spiny-lobster",
        "green-moray",
      ],
    },
  },
  // Denominator row: Belcher Barge
  {
    slug: "belcher-barge",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Belcher%20Barge%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://diversparadise.miami/divesites/",
      "https://www.ace-diving.com/dive-sites",
      "https://www.divemiamibeach.com/dive-sites",
    ],
    briefing: {
      name: "Belcher Barge",
      locationName: "off Key Biscayne, Florida",
      forecastLatitude: 25.6968,
      forecastLongitude: -80.088,
      description:
        "A 195-foot steel barge sunk in 1985 that rolled over on the way down and landed upside down. It anchors the Belcher Wreck Trek, with three tugs and two more barges a short swim away.",
      marineLife: "Barracuda · grunts · snapper · lobster · stingrays",
      difficultyLevel: "intermediate",
      depthRange: "15–18 m (48–60 ft)",
      maxDepthMeters: 18,
      currentNote:
        "Part of the Key Biscayne reef site, about three miles out, where the current usually sets north and can be strong enough to run as a drift. Fishing boats work these wrecks, so watch for line, carry a surface marker and fly a dive flag. Stay outside the hull.",
      divePlan:
        "Look over the barge, then follow the rebar markers on the sand to Belzona One and Two or to the Parker and Schurger's barges; Belzona Three is deeper and gated on its own. The neighboring wrecks sit deeper, so plan gas for the trek, not for the barge alone.",
      fitTone: "welcoming",
      fitNote: "Shallow for a Miami wreck, and the start of the area's most popular wreck trek.",
      landmarks: [
        {
          name: "Key Biscayne Connectivity boulder piles",
          kind: "pointOfInterest",
          note: "Limestone boulder piles the county placed from 2011 onward to link the wrecks around the barge.",
        },
      ],
      creatureSlugs: [
        "great-barracuda",
        "bluestriped-grunt",
        "gray-snapper",
        "spiny-lobster",
        "southern-stingray",
      ],
    },
  },
  // Denominator row: Belzona Barge
  {
    slug: "belzona-barge",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Belzona%20Barge%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://diversparadise.miami/divesites/",
      "https://www.ace-diving.com/dive-sites",
    ],
    briefing: {
      name: "Belzona Barge",
      locationName: "off Key Biscayne, Florida",
      forecastLatitude: 25.7011,
      forecastLongitude: -80.0892,
      description:
        "A steel barge sunk in 1991 in deeper water, which Hurricane Andrew picked up and dropped in the shallows a year later. Little of the shape is left, but the broken steel is thick with sea fans and soft corals.",
      marineLife: "Sea fans · sea rods · reef fish · barracuda",
      marineLifeDescription:
        "Gorgonians sway over the wreckage, so it reads more like a reef than a barge.",
      difficultyLevel: "beginner",
      depthRange: "9–12 m (30–40 ft)",
      maxDepthMeters: 12,
      currentNote:
        "The shallowest wreck in the Key Biscayne site, but the same northerly current runs here. Watch for fishing line on the broken steel, and fly a dive flag for passing boats.",
      fitTone: "welcoming",
      creatureSlugs: [
        "common-sea-fan",
        "black-sea-rod",
        "sea-plume",
        "great-barracuda",
        "sergeant-major",
      ],
    },
  },
  // Denominator row: Belzona One
  {
    slug: "belzona-one",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Belzona%20One%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://diversparadise.miami/divesites/",
      "https://www.ace-diving.com/dive-sites",
    ],
    briefing: {
      name: "Belzona One",
      locationName: "off Key Biscayne, Florida",
      forecastLatitude: 25.6958,
      forecastLongitude: -80.087,
      description:
        "An 85-foot steel tug, damaged by fire and donated to the county, sunk upright on sand in 1990. Hurricane Andrew sheared off her upper deck, which now lies beside the hull.",
      marineLife: "Stingrays · grunts · snapper · barracuda",
      marineLifeDescription: "Stingrays are regulars on the sand around the hull.",
      difficultyLevel: "intermediate",
      depthRange: "15–22 m (48–71 ft)",
      maxDepthMeters: 22,
      currentNote:
        "On the Belcher Wreck Trek in the Key Biscayne reef site. The current usually sets north, fishing boats work the area, and line snags on steel, so carry a cutter and a surface marker. Stay outside the hull.",
      fitTone: "welcoming",
      landmarks: [
        {
          name: "The upper deck",
          kind: "wreckFeature",
          note: "Torn off by Hurricane Andrew in 1992 and lying on the sand next to the hull.",
        },
      ],
      creatureSlugs: ["southern-stingray", "bluestriped-grunt", "gray-snapper", "great-barracuda"],
    },
  },
  // Denominator row: Belzona Two (Belzona II)
  {
    slug: "belzona-two",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Belzona%20Two%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://diversparadise.miami/divesites/",
      "https://www.ace-diving.com/dive-sites",
    ],
    briefing: {
      name: "Belzona Two",
      locationName: "off Key Biscayne, Florida",
      forecastLatitude: 25.696,
      forecastLongitude: -80.0877,
      description:
        "A small steel tug built in 1915 and earmarked by the US Navy in 1917 as a possible patrol boat, scuttled here in 1991. She is still largely in one piece, though Hurricane Andrew opened up her midsection.",
      marineLife: "Grunts · snapper · barracuda · lobster",
      difficultyLevel: "intermediate",
      depthRange: "14–18 m (45–60 ft)",
      maxDepthMeters: 18,
      currentNote:
        "On the Belcher Wreck Trek, with rebar stakes on the sand linking her to the other Belzona tugs. Expect a northerly current, fishing boats overhead and the odd tangle of line. Stay outside the hull.",
      fitTone: "welcoming",
      creatureSlugs: ["bluestriped-grunt", "gray-snapper", "great-barracuda", "spiny-lobster"],
    },
  },
  // Denominator row: Belzona Three
  {
    slug: "belzona-three",
    version: 2,
    area: "florida-miami",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Belzona%20Three%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://diversparadise.miami/divesites/",
      "https://www.ace-diving.com/dive-sites",
    ],
    briefing: {
      name: "Belzona Three",
      locationName: "off Key Biscayne, Florida",
      forecastLatitude: 25.6958,
      forecastLongitude: -80.0873,
      description:
        "A 100-foot tug built in 1953 as the Carinthia, which worked for decades before her engine failed. Sunk in 1991, she is the largest and most intact of the three Belzona tugs.",
      marineLife: "Barracuda · snapper · grunts · goliath grouper",
      difficultyLevel: "advanced",
      depthRange: "21–30 m (70–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "The deepest stop on the Belcher Wreck Trek. The current usually sets north and can be strong at this depth, and fishing line collects on the wreck. Stay outside the hull.",
      fitTone: "demanding",
      fitNote: "Close to 30 m on the sand, with current. Nitrox helps.",
      // Gated below 30 m: the sand is at about 26 m, and Miami operators run their 60–100 ft wrecks for Advanced divers.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["great-barracuda", "gray-snapper", "bluestriped-grunt", "goliath-grouper"],
    },
  },
  // Denominator row: HAV Parker III Barge
  {
    slug: "hav-parker-iii-barge",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Hav%20Parker%20III%20Barge%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://diversparadise.miami/divesites/",
      "https://www.ace-diving.com/dive-sites",
    ],
    briefing: {
      name: "H.A.V. Parker III Barge",
      locationName: "off Key Biscayne, Florida",
      forecastLatitude: 25.697,
      forecastLongitude: -80.0872,
      description:
        "A 120-foot steel deck barge placed in 1998 beside Schurger's Barge, the two making the far end of the Belcher Wreck Trek. Flat and low, it is a home for fish rather than a structure to explore.",
      marineLife: "Grunts · snapper · lobster · stingrays",
      difficultyLevel: "intermediate",
      depthRange: "18–21 m (61–70 ft)",
      maxDepthMeters: 21,
      currentNote:
        "In the Key Biscayne reef site, where the current usually sets north. It is the longest swim of the Belcher trek, so watch gas and time, and carry a surface marker in case you come up away from the boat.",
      fitTone: "welcoming",
      creatureSlugs: ["bluestriped-grunt", "gray-snapper", "spiny-lobster", "southern-stingray"],
    },
  },
  // Denominator row: Schurger's Barge
  {
    slug: "schurgers-barge",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/ArtificialReef_gdb/FeatureServer/0/query?where=REEF_NAME%3D%27Schurger%27%27s%20Barge%27&outFields=REEF_NAME,REEF_DESCRIPTION,REEF_DEPTH,LATITUDE,LONGITUDE,DATE_DEPLOYED&returnGeometry=false&f=json",
      "https://diversparadise.miami/divesites/",
      "https://www.ace-diving.com/dive-sites",
    ],
    briefing: {
      name: "Schurger's Barge",
      locationName: "off Key Biscayne, Florida",
      forecastLatitude: 25.697,
      forecastLongitude: -80.087,
      description:
        "A 90-foot steel barge the county sank in 1996, lying with the H.A.V. Parker III barge east of the Belcher Barge. Usually visited as part of the Belcher Wreck Trek.",
      marineLife: "Grunts · snapper · lobster · reef fish",
      difficultyLevel: "intermediate",
      depthRange: "20–23 m (64–74 ft)",
      maxDepthMeters: 23,
      currentNote:
        "Expect the usual northerly set of the Key Biscayne reef site, fishing boats overhead and line on the steel. Carry a surface marker, and keep the swim back to the Belcher in your gas plan.",
      fitTone: "welcoming",
      creatureSlugs: ["bluestriped-grunt", "gray-snapper", "spiny-lobster", "porkfish"],
    },
  },
  // Denominator row: Biscayne (Banana Freighter)
  {
    slug: "biscayne-wreck",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Biscayne%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://diversparadise.miami/divesites/",
      "https://www.ace-diving.com/dive-sites",
    ],
    briefing: {
      name: "Biscayne",
      locationName: "off Key Biscayne, Florida",
      forecastLatitude: 25.7044,
      forecastLongitude: -80.0884,
      description:
        'A 120-foot steel freighter, the old "banana freighter", sunk in 1974 and one of the oldest wrecks off Miami. Bow and stern have collapsed, and the scattered remains of the Miracles Express, pushed onto her by Hurricane Andrew, lie alongside.',
      marineLife: "Baitfish · snapper · grunts · angelfish · morays",
      marineLifeDescription:
        "Fifty years of growth and a dense crowd of fish. Shops like it as a night dive.",
      difficultyLevel: "beginner",
      depthRange: "12–18 m (40–60 ft)",
      maxDepthMeters: 18,
      currentNote:
        "In the Key Biscayne reef site, where the current usually sets north. Fishing line collects on the old steel, so carry a cutter, a surface marker and a dive flag. Stay outside the hull.",
      fitTone: "welcoming",
      fitNote: "One of the shallower Key Biscayne wrecks, and one of the liveliest.",
      landmarks: [
        {
          name: "Miracles Express debris",
          kind: "wreckFeature",
          note: "Pieces of a 100-foot freighter that Hurricane Andrew drove onto the Biscayne in 1992.",
        },
      ],
      creatureSlugs: [
        "great-barracuda",
        "schoolmaster-snapper",
        "bluestriped-grunt",
        "gray-angelfish",
        "spotted-moray",
      ],
    },
  },
  // Denominator row: Proteus
  {
    slug: "proteus-miami",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Proteus%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://diversparadise.miami/divesites/",
      "https://www.ace-diving.com/dive-sites",
      "https://www.divemiamibeach.com/dive-sites",
    ],
    briefing: {
      name: "Proteus",
      locationName: "off Key Biscayne, Florida",
      forecastLatitude: 25.7055,
      forecastLongitude: -80.0873,
      description:
        "A 220-foot freighter, built in 1957 and once a Great Lakes ferry, sunk in 1985 with volunteer help after years idle on the Miami River. Hurricane Andrew broke her into several large sections spread across the sand.",
      marineLife: "Morays · grunts · barracuda · angelfish",
      marineLifeDescription: "The twisted sections hold more life than the intact ship did.",
      difficultyLevel: "intermediate",
      depthRange: "16–23 m (54–75 ft)",
      maxDepthMeters: 23,
      currentNote:
        "Part of the Key Biscayne wreck field, where the current usually sets north and boats often drift several wrecks in a dive. Watch for fishing line and keep a surface marker ready. Stay outside the wreck.",
      fitTone: "welcoming",
      fitNote: "A good first deeper wreck, with plenty to see at modest depth.",
      creatureSlugs: [
        "green-moray",
        "bluestriped-grunt",
        "great-barracuda",
        "gray-angelfish",
        "goliath-grouper",
      ],
    },
  },
  // Denominator row: Rio Miami
  {
    slug: "rio-miami",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Rio%20Miami%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://diversparadise.miami/divesites/",
      "https://www.ace-diving.com/dive-sites",
      "https://www.divemiamibeach.com/dive-sites",
    ],
    briefing: {
      name: "Rio Miami",
      locationName: "off Key Biscayne, Florida",
      forecastLatitude: 25.7028,
      forecastLongitude: -80.0872,
      description:
        "A 105-foot steel tug built in 1949, sunk in 1989 on camera for a national TV news special about Miami's reefs. She sits upright, and her cabin reaches to within about 9 m of the surface.",
      marineLife: "Barracuda · snapper · jacks · grunts",
      difficultyLevel: "intermediate",
      depthRange: "9–22 m (30–72 ft)",
      maxDepthMeters: 22,
      currentNote:
        "In the Key Biscayne wreck field, where the current usually sets north. Rebar stakes run from her bow toward the Paraiso. Fishing boats work these wrecks, so watch for line, and stay outside the hull.",
      divePlan:
        "Circle the tug from the sand up to the cabin, then follow the stakes off the bow to the Paraiso if gas and current allow.",
      fitTone: "welcoming",
      fitNote: "One of the most intact wrecks in the area, and an easy one to read.",
      landmarks: [
        {
          name: "The cabin",
          kind: "wreckFeature",
          note: "The upright cabin and ladders, the shallowest part of the wreck.",
        },
      ],
      creatureSlugs: ["great-barracuda", "gray-snapper", "bar-jack", "bluestriped-grunt"],
    },
  },
  // Denominator row: DEMA Trader
  {
    slug: "dema-trader",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Dema%20Trader%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://diversparadise.miami/divesites/",
      "https://www.ace-diving.com/dive-sites",
      "https://www.divemiamibeach.com/dive-sites",
      "https://www.scubadivinginmiami.com/sites/dema-trader/",
    ],
    briefing: {
      name: "DEMA Trader",
      locationName: "off Key Biscayne, Florida",
      forecastLatitude: 25.7036,
      forecastLongitude: -80.0869,
      description:
        "A 165-foot cargo freighter, the GGD Trader, seized by US Customs and sunk in October 2003, named for the dive trade show in Miami that year. She sits upright, and her hold was filled with concrete culverts that add habitat and weight.",
      marineLife: "Barracuda · jacks · snapper · grunts",
      difficultyLevel: "intermediate",
      depthRange: "14–24 m (46–80 ft)",
      maxDepthMeters: 24,
      // Below 30 m, but the sand at 24 m is past an Open Water diver's depth and the northward drift is common.
      minimumCertificationLevel: "advanced_open_water",
      currentNote:
        "Just north of the Rio Miami in the Key Biscayne wreck field, where the current usually sets north. Fishing line collects on the superstructure. Stay outside.",
      fitTone: "welcoming",
      fitNote: "A tall, intact wreck that rewards a slow look from the top down.",
      creatureSlugs: [
        "great-barracuda",
        "horse-eye-jack",
        "gray-snapper",
        "bluestriped-grunt",
        "goliath-grouper",
      ],
    },
  },
  // Denominator row: Princess Britney
  {
    slug: "princess-britney",
    version: 2,
    area: "florida-miami",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Princess%20Britney%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://diversparadise.miami/divesites/",
      "https://www.ace-diving.com/dive-sites",
      "https://www.divemiamibeach.com/dive-sites",
    ],
    briefing: {
      name: "Princess Britney",
      locationName: "off Key Biscayne, Florida",
      forecastLatitude: 25.7005,
      forecastLongitude: -80.0868,
      description:
        "A 165-foot freighter seized in Operation River Walk, a 2001 drug investigation, after cocaine was found under her engine-room deck, and sunk in 2003. She rests upright and intact on sand, with the South Seas wreck to the southwest.",
      marineLife: "Barracuda · jacks · basket stars · snapper",
      marineLifeDescription:
        "Schools of barracuda and jacks hang over the deck, and basket stars open on the structure at night.",
      difficultyLevel: "advanced",
      depthRange: "18–30 m (60–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "Among the deeper wrecks of the Key Biscayne field, where the current usually sets north and boats often drift from wreck to wreck. Fishing line is common. Stay outside.",
      fitTone: "demanding",
      fitNote: "Close to 30 m at the sand, with current. Nitrox and a firm turn time help.",
      // Gated below 30 m: the sand is at about 27 m, and Miami operators run their 60–100 ft wrecks for Advanced divers.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "great-barracuda",
        "horse-eye-jack",
        "giant-basket-star",
        "gray-snapper",
        "goliath-grouper",
      ],
    },
  },
  // Denominator row: Paraiso
  {
    slug: "paraiso-wreck",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Paraiso%20Ship%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/ArtificialReef_gdb/FeatureServer/0/query?where=REEF_NAME%3D%27Paraiso%20III%27&outFields=REEF_NAME,REEF_DESCRIPTION,REEF_DEPTH,LATITUDE,LONGITUDE,DATE_DEPLOYED&returnGeometry=false&f=json",
      "https://diversparadise.miami/divesites/",
      "https://www.ace-diving.com/dive-sites",
    ],
    briefing: {
      name: "Paraiso",
      locationName: "off Key Biscayne, Florida",
      forecastLatitude: 25.7015,
      forecastLongitude: -80.0873,
      description:
        "A 115-foot steel ship, probably built as an offshore supply vessel and later used for research, sunk by the county in 2000. She lies between the Rio Miami and the Princess Britney, which makes her an easy middle stop on a Key Biscayne wreck drift.",
      marineLife: "Snapper · grunts · barracuda · reef fish",
      difficultyLevel: "intermediate",
      depthRange: "16–23 m (54–76 ft)",
      maxDepthMeters: 23,
      currentNote:
        "In the Key Biscayne wreck field, where the current usually sets north. Rebar stakes link her to the Rio Miami's bow. Watch for fishing line, and stay outside.",
      fitTone: "welcoming",
      creatureSlugs: ["gray-snapper", "bluestriped-grunt", "great-barracuda", "porkfish"],
    },
  },
  // Sheri-Lyn
  {
    slug: "sheri-lyn-wreck",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27DA0072%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.miamidade.gov/resources/environment/documents/artificial-reef-catalog.pdf",
      "https://diversparadise.miami/divesites/",
      "https://www.divemiamibeach.com/dive-sites",
      "https://www.ace-diving.com/dive-sites",
    ],
    briefing: {
      name: "Sheri-Lyn",
      locationName: "off Key Biscayne, Florida",
      forecastLatitude: 25.7023,
      forecastLongitude: -80.0861,
      description:
        "A 235-foot Dutch-built freighter from 1952, sunk by the county in 1987 about three miles off Key Biscayne. Hurricane Andrew broke her in two, and the wreckage, with a field of old steel tanks off the bow, now holds more fish than the intact ship ever did.",
      marineLife: "Barracuda · goliath grouper · arrow crabs · snapper",
      marineLifeDescription:
        "Big fish over the hull and small ones in it: barracuda and goliaths above, arrow crabs and critters in every seam.",
      difficultyLevel: "advanced",
      depthRange: "26–33 m (85–110 ft)",
      maxDepthMeters: 33,
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      currentNote:
        "Usually a mild northward current, which keeps the visibility good even with several boats on her. Fishing line snags on the wreck, so carry a cutter, and surface under a marker within 300 ft of your boat's divers-down flag.",
      divePlan:
        "Down the line to the larger section, work the hull with the current, and save the bow and the tank field for the second half. Nitrox stretches the bottom time.",
      landmarks: [
        {
          name: "The two hull sections",
          kind: "wreckFeature",
          note: "Hurricane Andrew split the ship in 1992; the bow lies about 60 ft from the rest of her.",
        },
        {
          name: "The tank field",
          kind: "pointOfInterest",
          note: "Some fifty old steel tanks, each about 30 ft long, lie south of the bow.",
        },
      ],
      creatureSlugs: [
        "great-barracuda",
        "goliath-grouper",
        "arrow-crab",
        "gray-snapper",
        "lionfish",
        "horse-eye-jack",
      ],
    },
  },
  // Tacoma
  {
    slug: "tacoma-wreck",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27DA0143%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.miamidade.gov/resources/environment/documents/artificial-reef-catalog.pdf",
      "https://diversparadise.miami/divesites/",
      "https://www.divemiamibeach.com/dive-sites",
      "https://www.ace-diving.com/dive-sites",
    ],
    briefing: {
      name: "Tacoma",
      locationName: "off Key Biscayne, Florida",
      forecastLatitude: 25.7002,
      forecastLongitude: -80.0845,
      description:
        "A 165-foot steel freighter seized in Operation River Walk, the 2001 Miami River drug investigation, and sunk in 2002. She sits upright and intact, and because few boats visit her she often has big fish around her.",
      marineLife: "Amberjack · barracuda · jacks · snapper",
      difficultyLevel: "advanced",
      depthRange: "29–40 m (95–130 ft)",
      maxDepthMeters: 40,
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      currentNote:
        "Sources give the sand at 120 to 135 ft (37–41 m), so the bottom lies at or past recreational limits; plan the dive on the hull. Gulf Stream current is common this far out and can be strong. Carry an SMB and surface under it within 300 ft of your boat's divers-down flag; expect a live-boat pickup if you leave the line.",
      fitTone: "demanding",
      fitNote:
        "A deep, rarely visited wreck for divers comfortable with depth, current and a short no-stop time.",
      creatureSlugs: [
        "greater-amberjack",
        "great-barracuda",
        "horse-eye-jack",
        "gray-snapper",
        "goliath-grouper",
      ],
    },
  },
  // Ophelia Brian
  {
    slug: "ophelia-brian-wreck",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27DA0173%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.miamidade.gov/resources/environment/documents/artificial-reef-catalog.pdf",
      "https://diversparadise.miami/divesites/",
      "https://www.ace-diving.com/dive-sites",
      "https://www.scubadivinginmiami.com/dive-sites/page/3/",
    ],
    briefing: {
      name: "Ophelia Brian",
      locationName: "off Key Biscayne, Florida",
      forecastLatitude: 25.7058,
      forecastLongitude: -80.0858,
      description:
        "A 210-foot German freighter, last called Sea Taxi, sunk on 30 December 2009 by and for Miami's dive community and renamed for the daughter of the family who paid for her. She is a sister ship of the Ultra Freeze and the Deep Freeze, and one of the biggest wrecks off Miami.",
      marineLife: "Barracuda · jacks · snapper · corals and sponges",
      difficultyLevel: "advanced",
      depthRange: "21–34 m (70–110 ft)",
      maxDepthMeters: 34,
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      currentNote:
        "Open water three miles out, where a northward current is common. Her high profile means much of the dive can stay well above the sand. Carry an SMB and surface under it within 300 ft of your boat's divers-down flag; expect a live-boat pickup if you leave the line.",
      creatureSlugs: [
        "great-barracuda",
        "horse-eye-jack",
        "gray-snapper",
        "goliath-grouper",
        "lionfish",
      ],
    },
  },
  // Miami River Barge (ZT 202)
  {
    slug: "miami-river-barge-zt-202",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27DA0161%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.miamidade.gov/resources/environment/documents/artificial-reef-catalog.pdf",
      "https://www.ace-diving.com/dive-sites",
    ],
    briefing: {
      name: "Miami River Barge (ZT 202)",
      locationName: "off Key Biscayne, Florida",
      forecastLatitude: 25.7024,
      forecastLongitude: -80.085,
      description:
        "A 210-foot hopper barge taken out of the Miami River and sunk in November 2008, a short swim east of the Sheri-Lyn. She sits upright and whole on the sand.",
      marineLife: "Jacks · snapper · lionfish",
      difficultyLevel: "advanced",
      depthRange: "31–37 m (103–120 ft)",
      maxDepthMeters: 37,
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      currentNote:
        "Deep from deck to sand, with little time at depth and a northward current common. Sheri-Lyn lies about 400 ft to the west. Carry an SMB and surface under it within 300 ft of your boat's divers-down flag; expect a live-boat pickup if you leave the line.",
      creatureSlugs: ["horse-eye-jack", "gray-snapper", "lionfish", "great-barracuda"],
    },
  },
  // Orion
  {
    slug: "orion-tug",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27DA0023%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.miamidade.gov/resources/environment/documents/artificial-reef-catalog.pdf",
      "https://diversparadise.miami/divesites/",
      "https://www.divemiamibeach.com/dive-sites",
      "https://www.ace-diving.com/dive-sites",
    ],
    briefing: {
      name: "Orion",
      locationName: "off Key Biscayne, Florida",
      forecastLatitude: 25.691,
      forecastLongitude: -80.0863,
      description:
        "A 118-foot tug that worked the Panama Canal, sunk in December 1981 as one of the first wrecks of Miami-Dade's reef program. Hurricane Andrew tore off her pilot house and set it down whole on the sand beside her.",
      marineLife: "Baitfish schools · grouper · gorgonians · sponges",
      marineLifeDescription:
        "The fallen pilot house is usually full of baitfish, and the west side of the deck is thick with sea fans.",
      difficultyLevel: "advanced",
      depthRange: "24–29 m (80–95 ft)",
      maxDepthMeters: 29,
      // Gated below 30 m on purpose: the sand is at 27–29 m, close enough to the line that shops run it as an advanced dive.
      minimumCertificationLevel: "advanced_open_water",
      currentNote:
        "A northward current is common, and the Cascades ledges just north make a drift dive from here when it runs. Bring a light for the growth under the deck edges. Carry an SMB and surface under it within 300 ft of your boat's divers-down flag; expect a live-boat pickup if you leave the line.",
      landmarks: [
        {
          name: "The pilot house",
          kind: "wreckFeature",
          note: "Torn off by Hurricane Andrew in 1992 and resting upright in the sand about 50 ft from the hull.",
        },
      ],
      creatureSlugs: [
        "black-grouper",
        "common-sea-fan",
        "gray-snapper",
        "great-barracuda",
        "lionfish",
      ],
    },
  },
  // South Seas
  {
    slug: "south-seas-wreck",
    version: 1,
    area: "florida-miami",
    // Position from the Miami-Dade catalog. FWC's point sits about 4 km to the south-east, but Ace places the wreck 250 ft from the Princess Britney, which agrees with the county.
    sources: [
      "https://www.miamidade.gov/resources/environment/documents/artificial-reef-catalog.pdf",
      "https://www.ace-diving.com/dive-sites",
      "https://diversparadise.miami/divesites/",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27DA0031%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
    ],
    briefing: {
      name: "South Seas",
      locationName: "off Key Biscayne, Florida",
      forecastLatitude: 25.6998,
      forecastLongitude: -80.0871,
      description:
        "A 1928 luxury yacht that served the Navy in the Second World War and later spent years as a Miami River restaurant, sunk as a reef in February 1983. Storms have scattered her across the sand, but the wreckage still draws clouds of baitfish and barracuda.",
      marineLife: "Baitfish · barracuda · goliath grouper · stingrays",
      difficultyLevel: "intermediate",
      depthRange: "20–23 m (65–75 ft)",
      maxDepthMeters: 23,
      currentNote:
        "The current usually runs north here, so shops may drift on to the Princess Britney, a deeper site with its own gate, only when your trip lists it. Stay with the guide and the marker line between wrecks.",
      fitNote:
        "Low, broken wreckage that is best as the first stop of a drift along several wrecks.",
      creatureSlugs: [
        "great-barracuda",
        "goliath-grouper",
        "southern-stingray",
        "gray-snapper",
        "lionfish",
      ],
    },
  },
  // Miracles Express
  {
    slug: "miracles-express",
    version: 1,
    area: "florida-miami",
    // Position from the Miami-Dade catalog, beside the Biscayne wreck, which matches Ace's account of Hurricane Andrew pushing her onto it. FWC's point lies about 4 km south-east.
    sources: [
      "https://www.miamidade.gov/resources/environment/documents/artificial-reef-catalog.pdf",
      "https://www.ace-diving.com/dive-sites",
      "https://diversparadise.miami/divesites/",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27DA0073%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
    ],
    briefing: {
      name: "Miracles Express",
      locationName: "off Key Biscayne, Florida",
      forecastLatitude: 25.704,
      forecastLongitude: -80.0882,
      description:
        "A 100-foot inter-island freighter seized by the Coast Guard for people smuggling and sunk in July 1987. Hurricane Andrew threw her onto the neighboring Biscayne wreck, and what is left is a low spread of plates and debris, usually visited on the same dive.",
      marineLife: "Grunts · snapper · lionfish · stingrays",
      difficultyLevel: "intermediate",
      depthRange: "17–20 m (55–65 ft)",
      maxDepthMeters: 20,
      currentNote:
        "A low-profile debris field that shops rarely dive on its own; plan it with the Biscayne. A northward current is common.",
      creatureSlugs: ["tomtate", "gray-snapper", "lionfish", "southern-stingray"],
    },
  },
  // Ultra Freeze
  {
    slug: "ultra-freeze-wreck",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27DA0040%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.miamidade.gov/resources/environment/documents/artificial-reef-catalog.pdf",
      "https://diversparadise.miami/divesites/",
      "https://www.divemiamibeach.com/dive-sites",
      "https://www.ace-diving.com/dive-sites",
    ],
    briefing: {
      name: "Ultra Freeze",
      locationName: "off Key Biscayne, Florida",
      forecastLatitude: 25.629,
      forecastLongitude: -80.0869,
      description:
        "A 1959 German refrigerated freighter, abandoned on the Miami River after a cargo of shrimp rotted in her holds, and sunk in July 1984. She still stands about 45 ft off the sand, with her hull bent by Hurricane Andrew.",
      marineLife: "Amberjack · barracuda · jacks · tarpon · snook",
      difficultyLevel: "advanced",
      depthRange: "26–40 m (85–130 ft)",
      maxDepthMeters: 40,
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      currentNote:
        "Sources put the sand at 120 to 135 ft (37–41 m), so keep the dive on the wreck. Gulf Stream current is common this far out. Andrew opened the starboard side and the structure is deteriorating, with fallen cables inside; stay outside. Carry an SMB and surface under it within 300 ft of your boat's divers-down flag; expect a live-boat pickup if you leave the line.",
      fitTone: "demanding",
      fitNote: "A deep, current-swept wreck for experienced divers on a tight no-stop plan.",
      creatureSlugs: [
        "greater-amberjack",
        "great-barracuda",
        "horse-eye-jack",
        "tarpon",
        "common-snook",
      ],
    },
  },
  // Tarpoon
  {
    slug: "tarpoon-wreck",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27DA0078%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.miamidade.gov/resources/environment/documents/artificial-reef-catalog.pdf",
      "https://diversparadise.miami/divesites/",
      "https://www.ace-diving.com/dive-sites",
      "https://www.nps.gov/bisc/planyourvisit/fishing.htm",
    ],
    briefing: {
      name: "Tarpoon",
      locationName: "off Key Biscayne, Florida",
      forecastLatitude: 25.6219,
      forecastLongitude: -80.091,
      description:
        "A Haitian freighter sunk in May 1988 in memory of Mike Kevorkian, who owned Tarpoon Diving Center. Hurricane Andrew broke her up and moved her against the reef, where the pieces are now wrapped in schooling fish.",
      marineLife: "Schooling grunts · snapper · reef fish · lionfish",
      difficultyLevel: "intermediate",
      depthRange: "15–20 m (50–65 ft)",
      maxDepthMeters: 20,
      currentNote:
        "Usually run as a drift along the wreckage and the reef beside it, so stay with your buddy and the guide's marker. The wreck lies just inside Biscayne National Park's offshore boundary: take nothing from the wreck and leave goliath grouper and coral alone; fishing and lobstering follow the park's rules.",
      fitTone: "welcoming",
      fitNote:
        "A relaxed drift over broken wreckage and reef, within reach of a newly advanced diver.",
      creatureSlugs: ["tomtate", "gray-snapper", "porkfish", "lionfish", "great-barracuda"],
    },
  },
  // St. Anne d'Auray
  {
    slug: "st-anne-dauray",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27DA0058%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.miamidade.gov/resources/environment/documents/artificial-reef-catalog.pdf",
      "https://diversparadise.miami/divesites/",
      "https://www.ace-diving.com/dive-sites",
      "https://www.scubadivinginmiami.com/dive-sites/page/4/",
    ],
    briefing: {
      name: "St. Anne d'Auray",
      locationName: "off Key Biscayne, Florida",
      forecastLatitude: 25.6177,
      forecastLongitude: -80.0905,
      description:
        "A 110-foot North Atlantic trawler sunk in March 1986, known to local divers as the St. Anne. Parts of her were scattered by Hurricane Andrew, and the rest is heavy with soft coral and growth.",
      marineLife: "Goliath grouper · soft corals · reef fish",
      marineLifeDescription: "A few goliath groupers live on the wreck.",
      difficultyLevel: "intermediate",
      depthRange: "12–23 m (40–75 ft)",
      maxDepthMeters: 23,
      currentNote:
        "Gulf Stream water brings good visibility and often a northward current. The Tarpoon lies about 1,200 ft to the north. Carry an SMB and surface under it within 300 ft of your boat's divers-down flag; expect a live-boat pickup if you leave the line.",
      creatureSlugs: ["goliath-grouper", "sea-plume", "common-sea-fan", "gray-snapper", "lionfish"],
    },
  },
  // Blue Fire
  {
    slug: "blue-fire-wreck",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27DA0030%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.miamidade.gov/resources/environment/documents/artificial-reef-catalog.pdf",
      "https://diversparadise.miami/divesites/",
      "https://www.ace-diving.com/dive-sites",
    ],
    briefing: {
      name: "Blue Fire",
      locationName: "off Fowey Rocks, Miami, Florida",
      forecastLatitude: 25.5666,
      forecastLongitude: -80.0905,
      description:
        "A 175-foot freighter seized after a 1980 Mariel boatlift run and sunk in January 1983, one of the southernmost wrecks dived from Miami. Hurricane Andrew tore off her aft superstructure and folded the hull, and forty years of growth have made the wreck a magnet for big fish and small critters alike.",
      marineLife: "Jacks · snapper · cobia · barracuda · goliath grouper",
      difficultyLevel: "advanced",
      depthRange: "27–37 m (90–120 ft)",
      maxDepthMeters: 37,
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      currentNote:
        "Operators warn that the current here can be strong; expect a live-boat pickup and surface under a marker within 300 ft of your boat's divers-down flag.",
      fitTone: "demanding",
      fitNote: "For divers at ease with depth and a strong current.",
      creatureSlugs: [
        "horse-eye-jack",
        "gray-snapper",
        "cobia",
        "great-barracuda",
        "goliath-grouper",
      ],
    },
  },
  // Almirante
  {
    slug: "almirante-wreck",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27DA0011%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.miamidade.gov/resources/environment/documents/artificial-reef-catalog.pdf",
      "https://diversparadise.miami/divesites/",
      "https://www.ace-diving.com/dive-sites",
    ],
    briefing: {
      name: "Almirante",
      locationName: "off Elliott Key, Florida",
      forecastLatitude: 25.416,
      forecastLongitude: -80.118,
      description:
        "A 200-foot refrigerated freighter abandoned on the Miami River, stripped of her superstructure and sunk in the mid-1970s, one of the oldest wrecks in the county's program. She sits upright, her stern twisted to port by Hurricane Andrew, with red gorgonians on the steel.",
      marineLife: "Goliath grouper · red gorgonians · jacks",
      difficultyLevel: "advanced",
      depthRange: "32–40 m (105–130 ft)",
      maxDepthMeters: 40,
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      currentNote:
        "Sources give the sand at 125 to 135 ft (38–41 m), so the whole dive is deep with little no-stop time. Offshore of the reef line, where Gulf Stream current is common. Carry an SMB and surface under it within 300 ft of your boat's divers-down flag; expect a live-boat pickup if you leave the line.",
      fitTone: "demanding",
      fitNote: "For experienced deep divers; there is no shallow part to retreat to.",
      creatureSlugs: ["goliath-grouper", "horse-eye-jack", "great-barracuda", "lionfish"],
    },
  },
  // Belcher Barge II (deep)
  {
    slug: "belcher-barge-ii",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27DA0012%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.miamidade.gov/resources/environment/documents/artificial-reef-catalog.pdf",
      "https://www.ace-diving.com/dive-sites",
    ],
    briefing: {
      name: "Belcher Barge II",
      locationName: "off Elliott Key, Florida",
      forecastLatitude: 25.4129,
      forecastLongitude: -80.1191,
      description:
        "An 85-foot steel barge sunk in October 1975 in deep water south of Miami, a few hundred meters from the Almirante. Not to be confused with the shallow Belcher Barge off Key Biscayne.",
      marineLife: "Jacks · snapper · lionfish",
      difficultyLevel: "advanced",
      depthRange: "34–37 m (110–120 ft)",
      maxDepthMeters: 37,
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      currentNote:
        "A low barge on deep sand, so nearly the whole dive is at depth. Little is published about her; Gulf Stream current is common this far offshore. Carry an SMB and surface under it within 300 ft of your boat's divers-down flag; expect a live-boat pickup if you leave the line.",
      creatureSlugs: ["horse-eye-jack", "gray-snapper", "lionfish", "great-barracuda"],
    },
  },
  // Tortuga
  {
    slug: "tortuga-wreck",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27DA0112%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.miamidade.gov/resources/environment/documents/artificial-reef-catalog.pdf",
      "https://diversparadise.miami/divesites/",
      "https://www.divemiamibeach.com/dive-sites",
      "https://www.ace-diving.com/dive-sites",
      "https://www.scubadivinginmiami.com/dive-sites/page/4/",
    ],
    briefing: {
      name: "Tortuga",
      locationName: "off Miami Beach, Florida",
      forecastLatitude: 25.8209,
      forecastLongitude: -80.0848,
      description:
        "A 165-foot steel ship blown up and sunk in April 1995 for the final scene of the film Fair Game. She landed upright in the Pflueger reef site north of Government Cut, with her wheelhouse and twin propellers intact and plenty of growth since.",
      marineLife: "Snapper · barracuda · trunkfish · jacks",
      difficultyLevel: "advanced",
      depthRange: "27–36 m (90–117 ft)",
      maxDepthMeters: 36,
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      currentNote:
        "The deck is at about 90 ft and the sand near 115 ft, with a northward current common. The St. Henry Express lies about 300 ft north; Haulover and Government Cut boat traffic means surfacing under a marker near your divers-down flag.",
      landmarks: [
        {
          name: "Wheelhouse and twin propellers",
          kind: "wreckFeature",
          note: "Both still intact; the propellers are at the stern near the sand.",
        },
      ],
      creatureSlugs: [
        "gray-snapper",
        "great-barracuda",
        "spotted-trunkfish",
        "horse-eye-jack",
        "lionfish",
      ],
    },
  },
  // Deep Freeze
  {
    slug: "deep-freeze-wreck",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27DA0014%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.miamidade.gov/resources/environment/documents/artificial-reef-catalog.pdf",
      "https://diversparadise.miami/divesites/",
      "https://www.divemiamibeach.com/dive-sites",
      "https://www.ace-diving.com/dive-sites",
    ],
    briefing: {
      name: "Deep Freeze",
      locationName: "off Miami Beach, Florida",
      forecastLatitude: 25.8217,
      forecastLongitude: -80.0825,
      description:
        "A German-built refrigerated freighter gutted by fire in 1972, stripped of her superstructure and sunk in October 1976. She is one of Miami's oldest wrecks and one of its most popular advanced dives, sister ship to the Ultra Freeze and the Ophelia Brian.",
      marineLife: "Jacks · snapper · grouper · amberjack",
      difficultyLevel: "advanced",
      depthRange: "34–40 m (110–130 ft)",
      maxDepthMeters: 40,
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      currentNote:
        "The top deck is at about 110 ft and the sand at 135 ft (41 m), past recreational limits, so plan on the deck. Fairly strong current is the norm, the wreck is a favorite of spearfishers and carries a lot of monofilament, and silt stirs easily: carry a cutter. Carry an SMB and surface under it within 300 ft of your boat's divers-down flag; expect a live-boat pickup if you leave the line.",
      fitTone: "demanding",
      fitNote:
        "For experienced deep divers only; operators recommend it to advanced divers because of the current, line and silt.",
      landmarks: [
        {
          name: "The broken stern",
          kind: "wreckFeature",
          note: "Hurricane Andrew separated a 35 ft section of the stern from the hull in 1992.",
        },
      ],
      creatureSlugs: [
        "horse-eye-jack",
        "gray-snapper",
        "black-grouper",
        "greater-amberjack",
        "great-barracuda",
      ],
    },
  },
  // St Henry Express
  {
    slug: "st-henry-express",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27DA0118%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.miamidade.gov/resources/environment/documents/artificial-reef-catalog.pdf",
      "https://www.ace-diving.com/dive-sites",
    ],
    briefing: {
      name: "St. Henry Express",
      locationName: "off Miami Beach, Florida",
      forecastLatitude: 25.822,
      forecastLongitude: -80.085,
      description:
        "A 120-foot freighter sunk in February 1997 in the Pflueger reef site, between the Tortuga and the Betek Ar Pen. She carries less growth than her neighbors and is usually visited as part of a dive on the group.",
      marineLife: "Snapper · jacks · lionfish",
      difficultyLevel: "advanced",
      depthRange: "28–35 m (92–113 ft)",
      maxDepthMeters: 35,
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      currentNote:
        "The Tortuga lies about 300 ft south and the Betek Ar Pen about 150 ft north; a northward current is common, so link them with the current. Boat traffic off Haulover and Government Cut is heavy.",
      creatureSlugs: ["gray-snapper", "horse-eye-jack", "lionfish", "great-barracuda"],
    },
  },
  // Betek AR Pen Ship
  {
    slug: "betek-ar-pen",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27DA0119%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.miamidade.gov/resources/environment/documents/artificial-reef-catalog.pdf",
      "https://www.ace-diving.com/dive-sites",
    ],
    briefing: {
      name: "Betek Ar Pen",
      locationName: "off Miami Beach, Florida",
      forecastLatitude: 25.8226,
      forecastLongitude: -80.0852,
      description:
        "A 70-foot former dive boat sunk in June 1997 in the Pflueger reef site, just north of the St. Henry Express. Small enough to circle in a few minutes, so it is usually one stop on a dive across the neighboring wrecks.",
      marineLife: "Snapper · jacks · lionfish",
      difficultyLevel: "advanced",
      depthRange: "29–34 m (95–110 ft)",
      maxDepthMeters: 34,
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      currentNote:
        "Deep sand and a common northward current; the St. Henry Express is about 150 ft south. Surface under a marker, as boat traffic off Haulover and Government Cut is heavy.",
      creatureSlugs: ["gray-snapper", "horse-eye-jack", "lionfish"],
    },
  },
  // Gimrock / Atlas Recycling Barge
  {
    slug: "gimrock-atlas-recycling-barge",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27DA0128%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.miamidade.gov/resources/environment/documents/artificial-reef-catalog.pdf",
      "https://www.ace-diving.com/dive-sites",
    ],
    briefing: {
      name: "Gimrock Atlas Recycling Barge",
      locationName: "off Miami Beach, Florida",
      forecastLatitude: 25.8204,
      forecastLongitude: -80.0844,
      description:
        "A big 195-foot steel hopper barge sunk in August 1998 in the Pflueger reef site, just south of the Tortuga. Little is written about her, but she stands nearly 20 ft off the sand.",
      marineLife: "Snapper · jacks · lionfish",
      difficultyLevel: "advanced",
      depthRange: "29–34 m (93–112 ft)",
      maxDepthMeters: 35,
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      currentNote:
        "Deep, with a northward current common. Boat traffic off Haulover and Government Cut is heavy; surface under a marker close to your divers-down flag.",
      creatureSlugs: ["gray-snapper", "horse-eye-jack", "lionfish", "great-barracuda"],
    },
  },
  // Pimelious
  {
    slug: "pimelious-wreck",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27DA0005%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.miamidade.gov/resources/environment/documents/artificial-reef-catalog.pdf",
      "https://www.ace-diving.com/dive-sites",
    ],
    briefing: {
      name: "Pimelious",
      locationName: "off Miami Beach, Florida",
      forecastLatitude: 25.836,
      forecastLongitude: -80.0821,
      description:
        "A flat 120-foot hull, perhaps a converted barge, sunk in May 1971 with a crane truck parked on her stern. The wooden deck is long gone, leaving a frame of steel beams, and the truck now lies in the sand beside her.",
      marineLife: "Snapper · jacks · lionfish",
      difficultyLevel: "advanced",
      depthRange: "37–40 m (120–130 ft)",
      maxDepthMeters: 40,
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      currentNote:
        "The sand is at about 135 ft (41 m), past recreational limits, and the low hull gives little height above it, so no-stop time is very short. A northward current is common. Carry an SMB and surface under it within 300 ft of your boat's divers-down flag; expect a live-boat pickup if you leave the line.",
      fitTone: "demanding",
      fitNote: "For experienced deep divers; the whole dive is at the edge of recreational limits.",
      landmarks: [
        {
          name: "The crane truck",
          kind: "wreckFeature",
          note: "Rolled off the stern into the sand; the cab has rusted away.",
        },
      ],
      creatureSlugs: ["gray-snapper", "horse-eye-jack", "lionfish"],
    },
  },
  // Shamrock
  {
    slug: "shamrock-wreck",
    version: 1,
    area: "florida-miami",
    // Position from the Miami-Dade catalog (Anchorage reef site). FWC's point lies about 4 km south and puts Billy's Barge there too, while the county places both in the Anchorage cluster.
    sources: [
      "https://www.miamidade.gov/resources/environment/documents/artificial-reef-catalog.pdf",
      "https://www.ace-diving.com/dive-sites",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27DA0045%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
    ],
    briefing: {
      name: "Shamrock",
      locationName: "off Miami Beach, Florida",
      forecastLatitude: 25.8103,
      forecastLongitude: -80.0935,
      description:
        "A Second World War landing craft turned cargo ship, seized in a 1978 smuggling case, later sold to the county and sunk in June 1985. She came to rest upside down off Miami Beach and makes an easy, fishy wreck for newer divers.",
      marineLife: "Grunts · snapper · reef fish · lionfish",
      difficultyLevel: "beginner",
      depthRange: "9–15 m (30–50 ft)",
      maxDepthMeters: 15,
      currentNote:
        "Shallow and usually gentle, but boat traffic off Miami Beach is heavy: fly a divers-down flag, stay within 300 ft of it, and come up on a marker.",
      fitTone: "welcoming",
      fitNote: "Shallow and simple to navigate, a good first wreck.",
      creatureSlugs: ["tomtate", "gray-snapper", "sergeant-major", "lionfish", "porkfish"],
    },
  },
  // C-One
  {
    slug: "c-one-tug",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27DA0092%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.miamidade.gov/resources/environment/documents/artificial-reef-catalog.pdf",
      "https://diversparadise.miami/divesites/",
      "https://www.ace-diving.com/dive-sites",
      "https://www.scubadivinginmiami.com/dive-sites/",
    ],
    briefing: {
      name: "C-One",
      locationName: "off Sunny Isles Beach, Florida",
      forecastLatitude: 25.9087,
      forecastLongitude: -80.0901,
      description:
        "A former Navy tug bought by the county and sunk in November 1990 off Haulover Inlet; the tug towing her to Miami sank on the way, and its crew was rescued. She lies intact with a 45 degree list, at the center of the Sunny Isles reef site.",
      marineLife: "Grunts · snapper · goliath grouper · reef fish",
      difficultyLevel: "intermediate",
      depthRange: "12–25 m (40–82 ft)",
      maxDepthMeters: 25,
      // Below 30 m, but the sand and scour hole sit at 25 m, past an Open Water diver's depth.
      minimumCertificationLevel: "advanced_open_water",
      currentNote:
        "The sand is at about 70 ft, with a scour hole under her midships reaching 82 ft. A northward drift is common, and Haulover Inlet boat traffic is close: stay within 300 ft of your divers-down flag and surface on a marker.",
      divePlan:
        "Rebar stakes on the sand link the C-One to the Lady Carmen just west and the Conception to the north, so the group fits in one dive.",
      landmarks: [
        {
          name: "The scour hole",
          kind: "pointOfInterest",
          note: "Cut by the current under the middle of the hull; the deepest point of the dive.",
        },
      ],
      creatureSlugs: ["tomtate", "gray-snapper", "goliath-grouper", "great-barracuda", "lionfish"],
    },
  },
  // Carmen
  {
    slug: "lady-carmen-tug",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27DA0132%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.miamidade.gov/resources/environment/documents/artificial-reef-catalog.pdf",
      "https://diversparadise.miami/divesites/",
      "https://www.ace-diving.com/dive-sites",
    ],
    briefing: {
      name: "Lady Carmen",
      locationName: "off Sunny Isles Beach, Florida",
      forecastLatitude: 25.9089,
      forecastLongitude: -80.0906,
      description:
        "A small 45-foot steel tug sunk by the county in July 1999 in the Sunny Isles reef site, right beside the C-One. Most divers see her on the same dive as the C-One and the Conception.",
      marineLife: "Grunts · snapper · reef fish",
      difficultyLevel: "intermediate",
      depthRange: "17–21 m (55–70 ft)",
      maxDepthMeters: 21,
      currentNote:
        "Rebar stakes lead from here to the C-One and on to the Conception. Haulover Inlet boat traffic is close: stay within 300 ft of your divers-down flag.",
      creatureSlugs: ["tomtate", "gray-snapper", "sergeant-major", "lionfish"],
    },
  },
  // Conception
  {
    slug: "conception-wreck",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27DA0094%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.miamidade.gov/resources/environment/documents/artificial-reef-catalog.pdf",
      "https://diversparadise.miami/divesites/",
      "https://www.ace-diving.com/dive-sites",
      "https://www.scubadivinginmiami.com/dive-sites/",
    ],
    briefing: {
      name: "Conception",
      locationName: "off Sunny Isles Beach, Florida",
      forecastLatitude: 25.9094,
      forecastLongitude: -80.09,
      description:
        "A Dutch coastal freighter that dragged anchor and spent weeks beached on South Beach in 1991 before she was towed off and sunk that June. Hurricane Andrew broke her in two, and her two sections lie about 150 ft north of the C-One.",
      marineLife: "Grunts · snapper · reef fish · lionfish",
      marineLifeDescription: "Fish gather on her most early and late in the day.",
      difficultyLevel: "intermediate",
      depthRange: "18–22 m (58–71 ft)",
      maxDepthMeters: 22,
      currentNote:
        "The cargo area has collapsed to a low profile, with the stern lying about 40 ft north of the main section. Haulover Inlet boat traffic is close: stay within 300 ft of your divers-down flag.",
      creatureSlugs: ["tomtate", "gray-snapper", "lionfish", "great-barracuda"],
    },
  },
  // White Coast tug
  {
    slug: "white-coast-tug",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27DA0113%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.miamidade.gov/resources/environment/documents/artificial-reef-catalog.pdf",
      "https://www.ace-diving.com/dive-sites",
    ],
    briefing: {
      name: "White Coast",
      locationName: "off Sunny Isles Beach, Florida",
      forecastLatitude: 25.9088,
      forecastLongitude: -80.0901,
      description:
        "A small steel tug sunk in May 1995 in the Sunny Isles reef site, an easy swim from the C-One, the Lady Carmen and the Conception.",
      marineLife: "Grunts · snapper · reef fish",
      difficultyLevel: "intermediate",
      depthRange: "18–21 m (58–68 ft)",
      maxDepthMeters: 21,
      currentNote:
        "A small wreck usually seen as part of the Sunny Isles group. Haulover Inlet boat traffic is close: stay within 300 ft of your divers-down flag.",
      creatureSlugs: ["tomtate", "gray-snapper", "lionfish"],
    },
  },
  // Timothy Allen Reed Reef
  {
    slug: "timothy-allen-reed-reef",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27DA0133%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.miamidade.gov/resources/environment/documents/artificial-reef-catalog.pdf",
      "https://www.ace-diving.com/dive-sites",
    ],
    briefing: {
      name: "Timothy Allen Reed Reef",
      locationName: "off Sunny Isles Beach, Florida",
      forecastLatitude: 25.9084,
      forecastLongitude: -80.0905,
      description:
        "An 80-foot steel deck barge sunk by the county in 1999 at the south-west edge of the Sunny Isles reef site, close to the Lady Carmen and the C-One.",
      marineLife: "Grunts · snapper · reef fish",
      difficultyLevel: "intermediate",
      depthRange: "17–20 m (55–65 ft)",
      maxDepthMeters: 20,
      currentNote:
        "A low barge, best added to a dive on the Sunny Isles wrecks. Haulover Inlet boat traffic is close: stay within 300 ft of your divers-down flag.",
      creatureSlugs: ["tomtate", "gray-snapper", "lionfish"],
    },
  },
  // Andro
  {
    slug: "andro-wreck",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27DA0055%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.miamidade.gov/resources/environment/documents/artificial-reef-catalog.pdf",
      "https://diversparadise.miami/divesites/",
      "https://www.ace-diving.com/dive-sites",
    ],
    briefing: {
      name: "Andro",
      locationName: "off Haulover Inlet, Florida",
      forecastLatitude: 25.8937,
      forecastLongitude: -80.0854,
      description:
        "A 1926 yacht built for ocean research expeditions, later a wartime patrol boat and a freighter, seized for smuggling and sunk in December 1985. Hurricane Andrew broke her into three sections, and her twin propellers, two stacks and wheelhouse make her a favorite with photographers.",
      marineLife: "Snapper · jacks · barracuda · reef fish",
      difficultyLevel: "advanced",
      depthRange: "19–32 m (62–104 ft)",
      maxDepthMeters: 32,
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      currentNote:
        "The sand is near 100 ft, but her high profile lets much of the dive stay shallower. Current is common on the wrecks along the 100 ft line here, and the Narwal nearby is the usual alternative when the Andro cannot be dived. Carry an SMB and surface under it within 300 ft of your boat's divers-down flag; expect a live-boat pickup if you leave the line.",
      landmarks: [
        {
          name: "Twin propellers and stacks",
          kind: "wreckFeature",
          note: "Both propellers, both smokestacks and the large wheelhouse are still there.",
        },
        {
          name: "The exposed engine block",
          kind: "wreckFeature",
          note: "Laid open when Hurricane Andrew broke the ship into three sections in 1992.",
        },
      ],
      creatureSlugs: [
        "gray-snapper",
        "horse-eye-jack",
        "great-barracuda",
        "goliath-grouper",
        "lionfish",
      ],
    },
  },
  // Narwal
  {
    slug: "narwal-wreck",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27DA0059%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.miamidade.gov/resources/environment/documents/artificial-reef-catalog.pdf",
      "https://diversparadise.miami/divesites/",
      "https://www.ace-diving.com/dive-sites",
    ],
    briefing: {
      name: "Narwal",
      locationName: "off Haulover Inlet, Florida",
      forecastLatitude: 25.9107,
      forecastLongitude: -80.0842,
      description:
        "A 137-foot Dutch coastal freighter from 1939, sunk in April 1986. Hurricane Andrew broke her up and moved her into slightly deeper water, and she is now mostly flattened hull plates on the sand.",
      marineLife: "Snapper · jacks · lionfish",
      difficultyLevel: "advanced",
      depthRange: "35–38 m (115–126 ft)",
      maxDepthMeters: 39,
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      currentNote:
        "Low wreckage on deep sand, so the whole dive is near its maximum depth and no-stop time is short. Strong current is common on the wrecks along the 100 ft line here. Carry an SMB and surface under it within 300 ft of your boat's divers-down flag; expect a live-boat pickup if you leave the line.",
      fitTone: "demanding",
      fitNote: "For experienced deep divers comfortable in current.",
      creatureSlugs: ["gray-snapper", "horse-eye-jack", "lionfish", "great-barracuda"],
    },
  },
  // Tenneco Towers (shallow towers)
  {
    slug: "tenneco-towers",
    version: 1,
    area: "florida-miami",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27DA0048%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.miamidade.gov/resources/environment/documents/artificial-reef-catalog.pdf",
      "https://diversparadise.miami/divesites/",
      "https://www.ace-diving.com/dive-sites",
      "https://www.scubadivinginmiami.com/dive-sites/page/4/",
      "https://seaxp.com/south-florida-wrecks/",
    ],
    briefing: {
      name: "Tenneco Towers",
      locationName: "off Golden Beach, Florida",
      forecastLatitude: 25.9825,
      forecastLongitude: -80.085,
      description:
        "Five oil production platforms from the Gulf of Mexico, brought around the Keys by Tenneco and laid in an east-west line in October 1985, the largest artificial reef in south-east Florida. The three shoreward towers are within recreational limits, and the steel is buried in soft coral and orange cup coral.",
      marineLife: "Barracuda · amberjack · queen angelfish · Spanish hogfish · turtles",
      marineLifeDescription:
        "Big pelagic fish pass through the open framework, and the struts are covered in orange cup coral.",
      difficultyLevel: "advanced",
      depthRange: "18–37 m (60–120 ft)",
      maxDepthMeters: 37,
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      currentNote:
        "The shallow towers top out around 60 ft over sand at 100 to 120 ft. The two deep towers to the east stand in about 190 ft and lean at nearly 45 degrees after Hurricane Andrew; they are technical dives and not part of this briefing. Current flows through the site freely, so stay with the structure.",
      divePlan:
        "One tower per dive: descend to the top of the structure, work down the legs no deeper than planned, and ascend on the tower or the line.",
      landmarks: [
        {
          name: "The three shallow towers",
          kind: "wreckFeature",
          note: "In a line running east, each a little deeper than the last; the second is about 100 yards from the first and the third about 85 yards further.",
        },
      ],
      creatureSlugs: [
        "orange-cup-coral",
        "great-barracuda",
        "greater-amberjack",
        "queen-angelfish",
        "spanish-hogfish",
      ],
    },
  },
];
