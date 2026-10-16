import type { DbExecutor } from "./client";
import { isMarineLifeSlug, marineLifeImage } from "./marine-life-catalog";
import { type DiveSpecialty, diveSiteCreatures, diveSites } from "./schema";
import { publishedTemplateId } from "./seed-dive-site-catalog";
import { commonsImage } from "./seed-images";

/**
 * Where the shop dives: its own site records, and the field guide on each —
 * creatures a diver might see and the moments worth surfacing for.
 *
 * The catalog these are *sourced* from is published separately
 * (`./seed-dive-site-catalog.ts`): those rows belong to DiveDay, not to this
 * shop, and every shop in the database shares them.
 *
 * One seeded site is left with an empty field guide on purpose. A site the shop
 * has nothing to say about is the ordinary case at a real shop, and the surface
 * has to read well in that state too.
 */
export async function seedDiveSites(db: DbExecutor, shopId: string) {
  // Sourced from v1 while the catalog publishes v3: the library's "update ready" badge.
  const molassesTemplateId = await publishedTemplateId(db, "molasses-reef");

  const siteRows = await db
    .insert(diveSites)
    .values([
      {
        shopId,
        // The slugs are written out rather than derived: these are the URLs the
        // e2e and visual suites navigate to, and a fixture whose address is
        // computed moves the day the grammar does
        // (`src/lib/dive-site-slug.ts`).
        sourceTemplateId: molassesTemplateId,
        sourceTemplateVersion: molassesTemplateId ? 1 : null,
        name: "Molasses Reef",
        slug: "molasses-reef",
        locationName: "Key Largo National Marine Sanctuary",
        forecastLatitude: 25.0117,
        forecastLongitude: -80.3764,
        description:
          "A bright outer-reef classic with a relaxed profile and plenty of room to explore.",
        marineLife: "Parrotfish · angelfish · southern stingrays · nurse sharks",
        marineLifeDescription:
          "Look along the coral heads for schooling grunts and curious damselfish; rays often cruise the sandy channels.",
        difficultyLevel: "beginner",
        snorkelSuitable: true,
        depthRange: "20–40 ft",
        maxDepthMeters: 12,
        currentNote: "Usually gentle.",
        divePlan:
          "Follow the coral ridge, pause at the sand channels, then drift back along the shallow garden.",
        // Structured, with the shop's own note on each: the paragraph a diver
        // reads used to come from a hard-coded table keyed by site name, so a
        // rename silently deleted it and no real shop could ever write one.
        landmarks: [
          {
            name: "Molasses Reef Light",
            kind: "navigationMark" as const,
            note: "The steel tower is the easiest above-water reference on the reef, and the way to stay oriented all dive.",
          },
          {
            name: "Historic ship's winch",
            kind: "reefHistory" as const,
            note: "A ship's winch in a sand patch at about 7.5 m, worn smooth and grown over. A spotted moray usually has its head out of the drum.",
            photoUrl: marineLifeImage("spotted-moray"),
          },
          {
            name: "Spanish anchor",
            kind: "reefHistory" as const,
            note: "An old anchor among the coral, with sea fans growing off the stock. Let the crew point it out — it disappears into the reef remarkably well.",
            photoUrl: marineLifeImage("common-sea-fan"),
          },
          {
            name: "The big brain coral",
            kind: "reefFormation" as const,
            note: "A brain coral wider than a diver is tall, on the sand edge near the mooring. A good place to regroup.",
            photoUrl: commonsImage("Brain coral 2 Molasses Reef 20080309.jpg"),
          },
          {
            name: "Azure vase sponge",
            kind: "reefFormation" as const,
            note: "A bright blue vase sponge on the ridge. Look, don't touch: it bruises.",
            photoUrl: commonsImage("Sponge 06 Molasses Reef 20230714.jpg"),
          },
        ],
        fitTone: "welcoming" as const,
        fitNote:
          "Shallow, bright and forgiving — a good first ocean dive after a pool course, and still worth a hundredth.",
        // The elkhorn frame is the shop's cover photo, so the site leads with
        // a frame of its own (UX review 2026-10-10, item 19).
        imageUrls: [
          commonsImage("French Angelfish Molasses Reef 20080309.jpg"),
          commonsImage("Blue Parrotfish on Molasses Outer Reef, Key Largo (15274849398).jpg"),
        ],
        // The three routes below used to be hand-authored SVG in
        // `src/lib/dive-site-map.ts`, keyed by site name — which is why only
        // DiveDay's own demo sites ever had one. They are ordinary rows now:
        // the waypoints a staffer would have clicked, on a site any shop could
        // have drawn (ADR 20260809-shop-drawn-dive-routes).
        routePoints: [
          { x: 16, y: 67 },
          { x: 44, y: 29 },
          { x: 72, y: 52 },
          { x: 84, y: 78 },
        ],
        routeLabel: "Reef garden loop",
        routeNote:
          "A relaxed sweep from the mooring along the coral ridge and back by the sand channels.",
      },
      {
        shopId,
        name: "Spiegel Grove",
        slug: "spiegel-grove",
        locationName: "Key Largo, Florida",
        // The glossary's canonical gate: a deep wreck dived externally needs
        // AOW + Deep. (Wreck specialty is for penetration, not the whole site.)
        // Every trip that visits inherits at least this (readiness composes it).
        minimumCertificationLevel: "advanced_open_water" as const,
        requiredSpecialties: ["deep"] as DiveSpecialty[],
        forecastLatitude: 25.0666,
        forecastLongitude: -80.3108,
        description:
          "A deliberately sunk former Navy ship with dramatic structure and blue-water scale.",
        marineLife: "Goliath grouper · barracuda · jacks · soft coral",
        marineLifeDescription:
          "Expect big silhouettes, moving schools, and changing light along the exterior decks.",
        difficultyLevel: "advanced",
        snorkelSuitable: false,
        depthRange: "60–130 ft",
        maxDepthMeters: 40,
        currentNote: "Open-water current can be strong.",
        divePlan:
          "Descend together on the mooring line, tour the exterior flight deck and well deck, then return to the ascent line with reserve gas.",
        landmarks: [
          {
            name: "Flight deck and cranes",
            kind: "wreckFeature" as const,
            note: "The broad deck and paired cranes make the ship's scale click into place. Stay outside the structure and follow the guide's line.",
            photoUrl: commonsImage("USS Spiegel Grove (LSD-32) flight deck 1984.jpg"),
          },
          {
            name: "Well deck",
            kind: "wreckFeature" as const,
            note: "The open stern dock landing craft once drove into, and the most dramatic exterior room on the wreck.",
            photoUrl: commonsImage("USS Spiegel Grove (LSD-32) well deck 1984.jpg"),
          },
        ],
        fitTone: "demanding" as const,
        fitNote:
          "Deep, exposed and current-prone. Nitrox and recent deep experience turn this from a short look into a proper dive.",
        imageUrls: [
          commonsImage("FKNMS - Goliath Grouper With Remora (27094933605).jpg"),
          commonsImage("AtlanticGoliathGrouper.jpg"),
        ],
        routePoints: [
          { x: 18, y: 63 },
          { x: 49, y: 35 },
          { x: 75, y: 60 },
          { x: 84, y: 78 },
        ],
        routeLabel: "Exterior circuit",
        routeNote: "Descend together, trace the superstructure, then return to the ascent line.",
      },
      {
        shopId,
        name: "Christ of the Abyss",
        slug: "christ-of-the-abyss",
        locationName: "Key Largo Dry Rocks, Florida Keys National Marine Sanctuary",
        forecastLatitude: 25.1245,
        forecastLongitude: -80.2972,
        description: "A shallow, iconic statue site that rewards an unhurried reef dive.",
        marineLife: "Sergeant majors · blue tangs · French angelfish · coral gardens",
        marineLifeDescription:
          "A gentle route with lots to notice near the reef and plenty of light for photos.",
        difficultyLevel: "beginner",
        snorkelSuitable: true,
        depthRange: "15–25 ft",
        maxDepthMeters: 8,
        currentNote: "Usually gentle.",
        divePlan:
          "Arc from the mooring through the bright sand channels, pause at the statue, then return across the shallow coral garden.",
        landmarks: [
          {
            name: "Christ of the Abyss",
            kind: "underwaterMonument" as const,
            note: "A third casting of the 1954 Italian original, placed here in 1965. It is the reason most people are on the boat.",
            photoUrl: commonsImage("Christ of the Abyss, Key Largo, FL - panoramio.jpg"),
          },
          {
            name: "Dry Rocks sand channels",
            kind: "reefFormation" as const,
            note: "Bright channels weaving between the coral, and a good place to look for rays and grouper.",
            photoUrl: marineLifeImage("southern-stingray"),
          },
        ],
        fitTone: "welcoming" as const,
        fitNote:
          "Shallow, sheltered and busy. Snorkelers share the site, so stay low and let the surface belong to them.",
        imageUrls: [
          commonsImage("Christ of the Abyss, Key Largo, FL - panoramio.jpg"),
          commonsImage("French Angelfish Pickles Reef 20230713.jpg"),
        ],
        routePoints: [
          { x: 17, y: 68 },
          { x: 49, y: 36 },
          { x: 72, y: 56 },
          { x: 84, y: 79 },
        ],
        routeLabel: "Shallow statue arc",
        routeNote:
          "An easy, shallow arc around the statue and coral garden before a calm return to the mooring.",
      },
      {
        shopId,
        name: "Benwood Wreck",
        slug: "benwood-wreck",
        locationName: "Key Largo, Florida",
        forecastLatitude: 25.0527,
        forecastLongitude: -80.3337,
        description: "A broken freighter lying in shallow sand — wreck scale without wreck depth.",
        marineLife: "Sergeant majors · glassy sweepers · moray eels · yellowtail snapper",
        marineLifeDescription:
          "The hull is a fish apartment block: look into every gap and something is home.",
        difficultyLevel: "intermediate",
        depthRange: "25–50 ft",
        maxDepthMeters: 15,
        currentNote: "Mild, but the site sits in open water.",
        divePlan:
          "Swim the length of the hull from bow to stern along the sand, then return over the plates at 30 feet.",
        landmarks: [
          {
            name: "Bow section",
            kind: "wreckFeature" as const,
            note: "The most intact piece, standing proud of the sand and the easiest place to get your bearings. Sweepers fill the shade under the bow.",
            photoUrl: marineLifeImage("glassy-sweeper"),
          },
          {
            name: "Collapsed midships plates",
            kind: "wreckFeature" as const,
            note: "Where the hull opened up. Swim over it rather than into it — the gaps are fish holes, not doorways, and a green moray has the biggest one.",
            photoUrl: marineLifeImage("green-moray"),
          },
        ],
        imageUrls: [commonsImage("Benwood-28.jpg")],
      },
      {
        shopId,
        name: "French Reef",
        slug: "french-reef",
        locationName: "Key Largo National Marine Sanctuary",
        forecastLatitude: 25.0353,
        forecastLongitude: -80.3494,
        description: "Swim-throughs, ledges, and overhangs on a shallow spur-and-groove reef.",
        marineLife: "Nurse sharks · green morays · parrotfish · barracuda",
        marineLifeDescription:
          "The overhangs hide sleeping nurse sharks; check the ceilings, not just the sand.",
        difficultyLevel: "beginner",
        depthRange: "20–45 ft",
        maxDepthMeters: 14,
        currentNote: "Usually gentle.",
        divePlan:
          "Drop on the mooring, work the ledges and swim-throughs into the current, then drift back over the coral heads.",
        landmarks: [
          {
            name: "Christmas Tree Cave",
            kind: "reefFormation" as const,
            note: "A short swim-through with two exits; the Christmas tree worms on the coral over the entrance are where it gets its name.",
            photoUrl: marineLifeImage("christmas-tree-worm"),
          },
          {
            name: "Hourglass Cave",
            kind: "reefFormation" as const,
            note: "Narrow in the middle and open at both ends — a good look at what lives on a ceiling, soldierfish mostly.",
            photoUrl: marineLifeImage("blackbar-soldierfish"),
          },
          {
            name: "White Sand Bottom Cave",
            kind: "reefFormation" as const,
            note: "The brightest of the tunnels, and usually the one with a nurse shark parked in it.",
            photoUrl: marineLifeImage("nurse-shark"),
          },
        ],
        fieldGuideTipsHeading: "Look up, not just down",
        imageUrls: [
          commonsImage("Stingray on French Reef, Key Largo (15274940277).jpg"),
          commonsImage("FGBNMS - nurse shark (27551309652).jpg"),
        ],
      },
      {
        shopId,
        name: "USCGC Duane",
        slug: "uscgc-duane",
        locationName: "Key Largo, Florida",
        // A second deep advanced wreck, gated the same way Spiegel Grove is.
        minimumCertificationLevel: "advanced_open_water" as const,
        requiredSpecialties: ["deep"] as DiveSpecialty[],
        forecastLatitude: 24.9898,
        forecastLongitude: -80.3815,
        description:
          "A decommissioned Coast Guard cutter sunk upright. Her guns and forward mast came off before she went down, but the aft mast and crow's nest still stand.",
        marineLife: "Goliath grouper · barracuda · amberjack · schooling grunts",
        marineLifeDescription:
          "A resident goliath grouper often holds near the wheelhouse; look into the blue for jacks working the current.",
        difficultyLevel: "advanced",
        depthRange: "50–120 ft",
        maxDepthMeters: 37,
        currentNote: "Can run strong on the surface.",
        divePlan:
          "Descend the mooring to the deck, tour the superstructure and the wheelhouse, then ascend on reserve gas with a safety stop.",
        landmarks: [
          {
            name: "Wheelhouse",
            kind: "wreckFeature" as const,
            note: "Open, recognizable, and usually holding the resident grouper. Approach along the deck, not from above.",
            photoUrl: marineLifeImage("goliath-grouper"),
          },
          {
            name: "Crow's nest",
            kind: "wreckFeature" as const,
            note: "The shallowest point at about 18 m — where the safety stop happens on a good day.",
            photoUrl: commonsImage("Crow's nest of the USCGC Duane (2007).jpg"),
          },
        ],
        fitTone: "demanding" as const,
        imageUrls: [
          commonsImage("AtlanticGoliathGrouper.jpg"),
          commonsImage("FKNMS - Goliath Grouper With Remora (27094933605).jpg"),
        ],
      },
      {
        shopId,
        name: "Pickles Reef",
        slug: "pickles-reef",
        locationName: "Key Largo National Marine Sanctuary",
        forecastLatitude: 24.9883,
        forecastLongitude: -80.4127,
        description:
          "A shallow spur-and-groove reef named for the barrels of cement, set hard on an old wreck, that lie among its coral heads.",
        marineLife: "Blue tangs · stoplight parrotfish · French angelfish · sergeant majors",
        marineLifeDescription:
          "Grazing parrotfish work the coral heads all day; blue tangs move through in loose, easy groups.",
        difficultyLevel: "beginner",
        depthRange: "15–40 ft",
        maxDepthMeters: 12,
        currentNote: "Usually gentle.",
        divePlan:
          "Drift the coral ridge from the mooring, pause over the barrel-shaped heads, then loop back over the sand.",
        landmarks: [
          {
            name: "Barrel coral heads",
            kind: "reefFormation" as const,
            note: "Cement that set in its barrels after a wreck around the turn of the last century, now grown over by star coral.",
            photoUrl: marineLifeImage("boulder-star-coral"),
          },
          {
            name: "Anchor chain remnant",
            kind: "reefHistory" as const,
            note: "A length of chain grown into the reef, running off toward the sand. Lobsters back into the links.",
            photoUrl: marineLifeImage("spiny-lobster"),
          },
        ],
        imageUrls: [
          commonsImage(
            "School of Gruntfish and Sergeant Majors on Pickles Reef, Key Largo (15275701928).jpg",
          ),
          commonsImage("French Angelfish Pickles Reef 20230713.jpg"),
        ],
      },
      // The night dive's wreck. The departure named it for years with no site
      // behind it, so the one trip a diver books in the dark was the one with
      // no briefing, no landmarks and no field guide.
      {
        shopId,
        name: "City of Washington",
        slug: "city-of-washington",
        locationName: "Elbow Reef, Key Largo National Marine Sanctuary",
        forecastLatitude: 25.1439,
        forecastLongitude: -80.2575,
        description:
          "An 1870s steamer that ran onto Elbow Reef in 1917, flattened into a long field of ribs and plates in shallow water.",
        marineLife: "Tarpon · octopus · squirrelfish · glassy sweepers · moray eels",
        marineLifeDescription:
          "By day it is a quiet scatter of steel; after dark the ribs fill with soldierfish and squirrelfish, octopus come out to hunt, and tarpon work the edge of your light.",
        difficultyLevel: "beginner",
        depthRange: "15–25 ft",
        maxDepthMeters: 8,
        currentNote: "Usually gentle on the inside of the reef; it can run along the outer edge.",
        divePlan:
          "Drop on the mooring at dusk, follow the keel line from the stern to the bow, then turn back over the ribs with your light low so the reef wakes up around you.",
        landmarks: [
          {
            name: "Elbow mooring",
            kind: "navigationMark" as const,
            note: "The descent and the way home. A pair of tarpon usually hangs under the boat once the lights go on.",
            photoUrl: marineLifeImage("tarpon"),
          },
          {
            name: "Keel and ribs",
            kind: "wreckFeature" as const,
            note: "The spine of the wreck, the easiest line to follow in the dark.",
            photoUrl: commonsImage("City Of Washington (38741160925).jpg"),
          },
          {
            name: "Stern plates",
            kind: "wreckFeature" as const,
            note: "Where the hull lies open. Sweep your light slowly along the plates: this is where the octopus hunt.",
            photoUrl: marineLifeImage("caribbean-reef-octopus"),
          },
        ],
        fitTone: "welcoming" as const,
        fitNote:
          "Shallow and easy to navigate, which is why it is the shop's first night dive for anyone who has never been in the dark.",
        imageUrls: [commonsImage("City Of Washington (38741160925).jpg")],
        routePoints: [
          { x: 22, y: 70 },
          { x: 40, y: 52 },
          { x: 62, y: 40 },
          { x: 80, y: 28 },
        ],
        routeLabel: "Keel line at dusk",
        routeNote: "Stern to bow along the keel, then back over the ribs to the mooring.",
      },
    ])
    .returning();
  const siteByName = new Map(siteRows.map((site) => [site.name, site]));
  const molasses = siteByName.get("Molasses Reef");
  const spiegel = siteByName.get("Spiegel Grove");
  const christ = siteByName.get("Christ of the Abyss");
  const benwood = siteByName.get("Benwood Wreck");
  const french = siteByName.get("French Reef");
  const duane = siteByName.get("USCGC Duane");
  const pickles = siteByName.get("Pickles Reef");
  const washington = siteByName.get("City of Washington");

  /**
   * Each site's field guide, as catalog slugs.
   *
   * The words used to be written out here, per site, per species — eleven
   * hand-typed rows for Molasses alone, several of them saying the same thing
   * about the same fish at a different site. A slug is now the whole row, which
   * is exactly what a real shop's field guide is: a selection from
   * `./marine-life-catalog.ts`, rendered in the reader's own language.
   *
   * One seeded site (`Christ of the Abyss` keeps its own; `Pickles Reef` is the
   * deliberate blank) is left with no guide at all. A site the shop has nothing
   * to say about is the ordinary case at a real shop, and the briefing has to
   * read well in that state too.
   */
  const fieldGuides: Array<{ site: typeof molasses; slugs: string[] }> = [
    {
      site: molasses,
      slugs: [
        "stoplight-parrotfish",
        "southern-stingray",
        "blue-tang",
        "french-angelfish",
        "yellowtail-snapper",
        "goliath-grouper",
        "grooved-brain-coral",
      ],
    },
    {
      site: spiegel,
      slugs: ["goliath-grouper", "yellowtail-snapper", "remora", "horse-eye-jack"],
    },
    {
      site: christ,
      slugs: ["sergeant-major", "french-angelfish", "blue-tang"],
    },
    { site: benwood, slugs: ["glassy-sweeper", "spotted-moray", "caribbean-reef-octopus"] },
    { site: french, slugs: ["nurse-shark", "stoplight-parrotfish", "green-moray", "squirrelfish"] },
    { site: duane, slugs: ["goliath-grouper", "horse-eye-jack", "bluestriped-grunt"] },
    { site: pickles, slugs: [] },
    {
      site: washington,
      slugs: [
        "tarpon",
        "caribbean-reef-octopus",
        "squirrelfish",
        "glassy-sweeper",
        "spotted-moray",
      ],
    },
  ];
  const creatureRows = fieldGuides.flatMap(({ site, slugs }) =>
    site
      ? slugs.filter(isMarineLifeSlug).map((slug, index) => ({
          shopId,
          diveSiteId: site.id,
          catalogSlug: slug,
          position: index,
        }))
      : [],
  );
  if (creatureRows.length > 0) await db.insert(diveSiteCreatures).values(creatureRows);

  /**
   * A dated session for a catalog course, or nothing at all when this shop does
   * not carry that title. Spread into the trips list so a missing course drops
   * its session quietly instead of throwing the whole seed.
   */
  return { siteByName, benwood, french };
}
