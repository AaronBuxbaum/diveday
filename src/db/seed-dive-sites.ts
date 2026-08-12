import { eq } from "drizzle-orm";
import type { DbExecutor } from "./client";
import {
  type DiveSpecialty,
  diveSiteCreatures,
  diveSiteMoments,
  diveSites,
  globalDiveSites,
  globalDiveSiteVersions,
} from "./schema";
import { commonsImage } from "./seed-images";

/**
 * Where the shop dives: the global site catalog entry it adopts, its own site
 * records, and the field guide on each — creatures a diver might see and the
 * moments worth surfacing for.
 *
 * One seeded site is left with an empty field guide on purpose. A site the shop
 * has nothing to say about is the ordinary case at a real shop, and the surface
 * has to read well in that state too.
 */
export async function seedDiveSites(db: DbExecutor, shopId: string) {
  const [existingMolassesTemplate] = await db
    .select()
    .from(globalDiveSites)
    .where(eq(globalDiveSites.slug, "molasses-reef"))
    .limit(1);
  let molassesTemplate = existingMolassesTemplate;
  if (!molassesTemplate) {
    [molassesTemplate] = await db
      .insert(globalDiveSites)
      .values({ slug: "molasses-reef", currentVersion: 2 })
      .returning();
    if (!molassesTemplate) throw new Error("seed: common-site template missing");
    await db.insert(globalDiveSiteVersions).values([
      {
        globalDiveSiteId: molassesTemplate.id,
        version: 1,
        briefing: {
          name: "Molasses Reef",
          locationName: "Key Largo National Marine Sanctuary",
          forecastLatitude: 25.0117,
          forecastLongitude: -80.3764,
          description: "A bright outer-reef classic with a relaxed profile.",
          marineLife: "Parrotfish · angelfish · southern stingrays",
        },
      },
      {
        globalDiveSiteId: molassesTemplate.id,
        version: 2,
        briefing: {
          name: "Molasses Reef",
          locationName: "Key Largo National Marine Sanctuary",
          forecastLatitude: 25.0117,
          forecastLongitude: -80.3764,
          description:
            "A bright outer-reef classic with a relaxed profile and plenty of room to explore.",
          marineLife: "Parrotfish · angelfish · southern stingrays · nurse sharks",
          marineLifeDescription:
            "Look along the coral heads for schooling grunts and curious damselfish; rays often cruise the sandy channels.",
          difficulty: "beginner",
          depthRange: "6–12 m",
          maxDepthMeters: 12,
          currentNote: "Usually gentle; the crew confirms the final plan.",
          divePlan:
            "Follow the coral ridge, pause at the sand channels, then drift back along the shallow garden.",
          landmarks: ["Molasses Reef Light", "Historic ship's winch", "Spanish anchor"],
          imageUrls: [
            commonsImage("Elkhorn coral 8 Molasses Reef 20080309.jpg"),
            commonsImage("French Angelfish Molasses Reef 20080309.jpg"),
            commonsImage("Blue Tangs Molasses Reef 1999.jpg"),
          ],
        },
      },
    ]);
  }

  const siteRows = await db
    .insert(diveSites)
    .values([
      {
        shopId,
        sourceTemplateId: molassesTemplate.id,
        sourceTemplateVersion: 1,
        name: "Molasses Reef",
        locationName: "Key Largo National Marine Sanctuary",
        forecastLatitude: 25.0117,
        forecastLongitude: -80.3764,
        description:
          "A bright outer-reef classic with a relaxed profile and plenty of room to explore.",
        marineLife: "Parrotfish · angelfish · southern stingrays · nurse sharks",
        marineLifeDescription:
          "Look along the coral heads for schooling grunts and curious damselfish; rays often cruise the sandy channels.",
        difficulty: "beginner",
        depthRange: "6–12 m",
        maxDepthMeters: 12,
        currentNote: "Usually gentle; the crew confirms the final plan.",
        divePlan:
          "Follow the coral ridge, pause at the sand channels, then drift back along the shallow garden.",
        landmarks: ["Molasses Reef Light", "Historic ship's winch", "Spanish anchor"],
        imageUrls: [
          commonsImage("Elkhorn coral 8 Molasses Reef 20080309.jpg"),
          commonsImage("French Angelfish Molasses Reef 20080309.jpg"),
          commonsImage("Blue Tangs Molasses Reef 1999.jpg"),
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
        locationName: "Key Largo, Florida",
        // The glossary's canonical gate: a deep wreck dived externally needs
        // AOW + Deep. (Wreck specialty is for penetration, not the whole site.)
        // Every trip that visits inherits at least this (readiness composes it).
        minimumCertificationLevel: "advanced_open_water" as const,
        requiredSpecialties: ["deep"] as DiveSpecialty[],
        forecastLatitude: 25.0789,
        forecastLongitude: -80.2186,
        description:
          "A deliberately sunk former Navy ship with dramatic structure and blue-water scale.",
        marineLife: "Goliath grouper · barracuda · jacks · soft coral",
        marineLifeDescription:
          "Expect big silhouettes, moving schools, and changing light along the exterior decks.",
        difficulty: "advanced",
        depthRange: "18–40 m",
        maxDepthMeters: 40,
        currentNote: "Open-water current can be strong; the crew confirms the line plan.",
        divePlan:
          "Descend together on the mooring line, tour the exterior flight deck and well deck, then return to the ascent line with reserve gas.",
        landmarks: ["Flight deck and cranes", "Well deck"],
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
        locationName: "John Pennekamp Coral Reef State Park",
        forecastLatitude: 25.1292,
        forecastLongitude: -80.4011,
        description: "A shallow, iconic statue site that rewards an unhurried reef dive.",
        marineLife: "Sergeant majors · blue tangs · French angelfish · coral gardens",
        marineLifeDescription:
          "A gentle route with lots to notice near the reef and plenty of light for photos.",
        difficulty: "beginner",
        depthRange: "5–8 m",
        maxDepthMeters: 8,
        currentNote: "Usually gentle; the crew confirms the final plan.",
        divePlan:
          "Arc from the mooring through the bright sand channels, pause at the statue, then return across the shallow coral garden.",
        landmarks: ["Christ of the Abyss", "Dry Rocks sand channels"],
        imageUrls: [
          commonsImage("French Angelfish Pickles Reef 20230713.jpg"),
          commonsImage("Blue Tang Pickles 20080310.jpg"),
          commonsImage("Elkhorn coral 8 Molasses Reef 20080309.jpg"),
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
        locationName: "Key Largo, Florida",
        forecastLatitude: 25.0561,
        forecastLongitude: -80.3222,
        description: "A broken freighter lying in shallow sand — wreck scale without wreck depth.",
        marineLife: "Sergeant majors · glassy sweepers · moray eels · yellowtail snapper",
        marineLifeDescription:
          "The hull is a fish apartment block: look into every gap and something is home.",
        difficulty: "intermediate",
        depthRange: "8–15 m",
        maxDepthMeters: 15,
        currentNote: "Mild, but the site sits in open water — the crew calls the drop.",
        divePlan:
          "Swim the length of the hull from bow to stern along the sand, then return over the plates at 9 meters (30 feet).",
        landmarks: ["Bow section", "Collapsed midships plates"],
        imageUrls: [
          commonsImage("Grouper 2 Molasses Reef 1999.jpg"),
          commonsImage("Yellowtail Snappers Molasses Reef 1999.jpg"),
        ],
      },
      {
        shopId,
        name: "French Reef",
        locationName: "Key Largo National Marine Sanctuary",
        forecastLatitude: 25.0333,
        forecastLongitude: -80.3494,
        description: "Swim-throughs, ledges, and overhangs on a shallow spur-and-groove reef.",
        marineLife: "Nurse sharks · green morays · parrotfish · barracuda",
        marineLifeDescription:
          "The overhangs hide sleeping nurse sharks; check the ceilings, not just the sand.",
        difficulty: "beginner",
        depthRange: "6–14 m",
        maxDepthMeters: 14,
        currentNote: "Usually gentle; the crew confirms the final plan.",
        divePlan:
          "Drop on the mooring, work the ledges and swim-throughs into the current, then drift back over the coral heads.",
        landmarks: ["Christmas Tree Cave", "Hourglass Cave", "White Sand Bottom Cave"],
        imageUrls: [
          commonsImage("FGBNMS - nurse shark (27551309652).jpg"),
          commonsImage("Stoplight parrotfish Pickles Reef.jpg"),
        ],
      },
      {
        shopId,
        name: "USCGC Duane",
        locationName: "Key Largo, Florida",
        // A second deep advanced wreck, gated the same way Spiegel Grove is.
        minimumCertificationLevel: "advanced_open_water" as const,
        requiredSpecialties: ["deep"] as DiveSpecialty[],
        forecastLatitude: 24.9989,
        forecastLongitude: -80.3903,
        description:
          "A decommissioned Coast Guard cutter sunk upright, with a mast and gun mounts still intact.",
        marineLife: "Goliath grouper · barracuda · amberjack · schooling grunts",
        marineLifeDescription:
          "A resident goliath grouper often holds near the wheelhouse; look into the blue for jacks working the current.",
        difficulty: "advanced",
        depthRange: "15–37 m",
        maxDepthMeters: 37,
        currentNote: "Can run strong on the surface; the crew calls the line and the drop.",
        divePlan:
          "Descend the mooring to the deck, tour the superstructure and gun mounts, then ascend on reserve gas with a safety stop.",
        landmarks: ["Wheelhouse", "Forward gun mount", "Crow's nest"],
        imageUrls: [
          commonsImage("AtlanticGoliathGrouper.jpg"),
          commonsImage("FKNMS - Goliath Grouper With Remora (27094933605).jpg"),
        ],
      },
      {
        shopId,
        name: "Pickles Reef",
        locationName: "Key Largo National Marine Sanctuary",
        forecastLatitude: 24.9928,
        forecastLongitude: -80.4092,
        description: "A shallow spur-and-groove reef named for its fossilized-barrel coral heads.",
        marineLife: "Blue tangs · stoplight parrotfish · French angelfish · sergeant majors",
        marineLifeDescription:
          "Grazing parrotfish work the coral heads all day; blue tangs move through in loose, easy groups.",
        difficulty: "beginner",
        depthRange: "5–12 m",
        maxDepthMeters: 12,
        currentNote: "Usually gentle; the crew confirms the final plan.",
        divePlan:
          "Drift the coral ridge from the mooring, pause over the barrel-shaped heads, then loop back over the sand.",
        landmarks: ["Barrel coral heads", "Anchor chain remnant"],
        imageUrls: [
          commonsImage("Stoplight parrotfish Pickles Reef.jpg"),
          commonsImage("Blue Tang Pickles 20080310.jpg"),
          commonsImage("French Angelfish Pickles Reef 20230713.jpg"),
        ],
      },
    ])
    .returning();
  const siteByName = new Map(siteRows.map((site) => [site.name, site]));
  const molasses = siteByName.get("Molasses Reef");
  if (molasses) {
    await db.insert(diveSiteCreatures).values([
      {
        shopId,
        diveSiteId: molasses.id,
        name: "Stoplight parrotfish",
        kind: "fish",
        imageUrl: commonsImage("Stoplight parrotfish Pickles Reef.jpg"),
        description: "A bright reef grazer with a beak-like mouth.",
        preparationTip: "Move slowly near coral heads and let the colour find you.",
      },
      {
        shopId,
        diveSiteId: molasses.id,
        name: "Elkhorn coral",
        kind: "coral",
        imageUrl: commonsImage("Elkhorn coral 8 Molasses Reef 20080309.jpg"),
        description: "Branching coral that makes a remarkable shallow reef silhouette.",
        preparationTip: "Practice neutral buoyancy; never touch or brace on coral.",
      },
      {
        shopId,
        diveSiteId: molasses.id,
        name: "Southern stingray",
        kind: "ray",
        imageUrl: commonsImage("Dasyatis americana NOAA.jpg"),
        description: "Often seen gliding over the sand channels.",
        preparationTip: "Give rays space and watch from the side, not above.",
      },
      {
        shopId,
        diveSiteId: molasses.id,
        name: "Blue tang",
        kind: "fish",
        imageUrl: commonsImage("Blue Tangs Molasses Reef 1999.jpg"),
        description: "Electric-blue reef fish that often travel in loose groups.",
        preparationTip: "Scan just above the reef for small groups moving together.",
      },
      {
        shopId,
        diveSiteId: molasses.id,
        name: "French angelfish",
        kind: "fish",
        imageUrl: commonsImage("French Angelfish Molasses Reef 20080309.jpg"),
        description: "A tall, dark fish edged with tiny flashes of yellow.",
        preparationTip: "Look beside tall sponges and coral faces where they feed.",
      },
      {
        shopId,
        diveSiteId: molasses.id,
        name: "Yellowtail snapper",
        kind: "schooling fish",
        imageUrl: commonsImage("Yellowtail Snappers Molasses Reef 1999.jpg"),
        description: "Silver schools marked by a bright yellow stripe and tail.",
        preparationTip: "Look into the blue beyond the reef instead of only looking down.",
      },
      {
        shopId,
        diveSiteId: molasses.id,
        name: "Goliath grouper",
        kind: "fish",
        imageUrl: commonsImage("AtlanticGoliathGrouper.jpg"),
        description: "Enormous and unbothered; usually parked under a ledge.",
        preparationTip: "Give it room and never block its way out from under an overhang.",
      },
      {
        shopId,
        diveSiteId: molasses.id,
        name: "Nurse shark",
        kind: "shark",
        imageUrl: commonsImage("FGBNMS - nurse shark (27551309652).jpg"),
        description: "A broad, mellow bottom-resting shark with rounded fins.",
        preparationTip: "Check quiet ledges without crowding or blocking an animal's path.",
      },
      {
        shopId,
        diveSiteId: molasses.id,
        name: "Reef grouper & grunt",
        kind: "reef fish",
        imageUrl: commonsImage("Grouper 2 Molasses Reef 1999.jpg"),
        description: "Chunky grouper often share the reef with striped grunts.",
        preparationTip: "Pause beside coral overhangs and let hidden fish emerge.",
      },
      {
        shopId,
        diveSiteId: molasses.id,
        name: "Grooved brain coral",
        kind: "coral",
        imageUrl: commonsImage("Brain coral 2 Molasses Reef 20080309.jpg"),
        description: "Rounded coral patterned with maze-like ridges and valleys.",
        preparationTip: "Notice the pattern while keeping fins and hands safely clear.",
      },
      {
        shopId,
        diveSiteId: molasses.id,
        name: "Finger sponge",
        kind: "sponge",
        imageUrl: commonsImage("Sponge 06 Molasses Reef 20230714.jpg"),
        description: "Bright tubular sponges that add colour and height to the reef.",
        preparationTip: "Look between coral heads for shapes that do not sway like plants.",
      },
    ]);
    await db.insert(diveSiteMoments).values({
      shopId,
      diveSiteId: molasses.id,
      caption: "A quiet moment watching a ray disappear into blue water.",
      imageUrl: commonsImage("Dasyatis americana NOAA.jpg"),
      isPublished: true,
    });
  }

  // A site with an empty field guide reads as a site the shop does not know.
  // Both of the other seeded sites get one, written to their own character:
  // the wreck is about scale and silhouettes, the statue about a slow shallow
  // reef you can spend an hour on.
  const spiegel = siteByName.get("Spiegel Grove");
  const christ = siteByName.get("Christ of the Abyss");
  const benwood = siteByName.get("Benwood Wreck");
  const french = siteByName.get("French Reef");
  const duane = siteByName.get("USCGC Duane");
  const pickles = siteByName.get("Pickles Reef");
  const laterCreatures = [
    ...(benwood
      ? [
          {
            diveSiteId: benwood.id,
            name: "Glassy sweeper",
            kind: "schooling fish",
            imageUrl: commonsImage("Yellowtail Snappers Molasses Reef 1999.jpg"),
            description: "Copper-colored clouds that fill the shaded spaces inside the hull.",
            preparationTip: "Stay outside the plates and let the school reform around you.",
          },
          {
            diveSiteId: benwood.id,
            name: "Reef grouper",
            kind: "fish",
            imageUrl: commonsImage("Grouper 2 Molasses Reef 1999.jpg"),
            description: "Holds a favorite gap in the wreckage and watches you go past.",
            preparationTip: "Approach slowly and from the side; a crowded fish just leaves.",
          },
        ]
      : []),
    ...(french
      ? [
          {
            diveSiteId: french.id,
            name: "Nurse shark",
            kind: "shark",
            imageUrl: commonsImage("FGBNMS - nurse shark (27551309652).jpg"),
            description: "Often asleep under the ledges, which is where divers miss them.",
            preparationTip: "Look up into the overhangs, and never block the way out of one.",
          },
          {
            diveSiteId: french.id,
            name: "Stoplight parrotfish",
            kind: "fish",
            imageUrl: commonsImage("Stoplight parrotfish Pickles Reef.jpg"),
            description: "You will hear them grazing the coral before you find them.",
            preparationTip: "Hold still near a coral head and follow the crunching sound.",
          },
        ]
      : []),
    ...(spiegel
      ? [
          {
            diveSiteId: spiegel.id,
            name: "Goliath grouper",
            kind: "fish",
            imageUrl: commonsImage("AtlanticGoliathGrouper.jpg"),
            description: "A car-sized grouper that holds station in the ship's shadows.",
            preparationTip: "Keep your distance and your buoyancy; never corner one in a doorway.",
          },
          {
            diveSiteId: spiegel.id,
            name: "Yellowtail snapper",
            kind: "schooling fish",
            imageUrl: commonsImage("Yellowtail Snappers Molasses Reef 1999.jpg"),
            description: "Silver schools that hang above the deck, facing into the current.",
            preparationTip: "Look out into the blue, not only down at the hull.",
          },
          {
            diveSiteId: spiegel.id,
            name: "Remora",
            kind: "fish",
            imageUrl: commonsImage("FKNMS - Goliath Grouper With Remora (27094933605).jpg"),
            description: "Riders that detach and circle when their host moves off.",
            preparationTip: "If one takes an interest in you, keep swimming — it loses interest.",
          },
        ]
      : []),
    ...(christ
      ? [
          {
            diveSiteId: christ.id,
            name: "Sergeant major",
            kind: "fish",
            imageUrl: commonsImage("Blue Tang Pickles 20080310.jpg"),
            description: "Small striped fish that guard purple egg patches on the statue's base.",
            preparationTip: "A guarding male will bump your mask; back off rather than push in.",
          },
          {
            diveSiteId: christ.id,
            name: "French angelfish",
            kind: "fish",
            imageUrl: commonsImage("French Angelfish Pickles Reef 20230713.jpg"),
            description: "Usually in pairs, moving unhurried between coral heads.",
            preparationTip: "Stay still for a moment and the pair will often come to you.",
          },
          {
            diveSiteId: christ.id,
            name: "Elkhorn coral",
            kind: "coral",
            imageUrl: commonsImage("Elkhorn coral 8 Molasses Reef 20080309.jpg"),
            description: "Shallow branching coral that catches the light on the way back.",
            preparationTip: "This is the shallowest part of the dive — watch your fins above it.",
          },
        ]
      : []),
    ...(duane
      ? [
          {
            diveSiteId: duane.id,
            name: "Goliath grouper",
            kind: "fish",
            imageUrl: commonsImage("AtlanticGoliathGrouper.jpg"),
            description: "A resident that holds near the wheelhouse and rarely moves for divers.",
            preparationTip: "Approach along the deck, not from above — it reads that as a threat.",
          },
          {
            diveSiteId: duane.id,
            name: "Amberjack",
            kind: "schooling fish",
            imageUrl: commonsImage("FKNMS - Goliath Grouper With Remora (27094933605).jpg"),
            description: "Fast-moving schools that patrol the blue water off the wreck.",
            preparationTip: "Look up and out past the structure, not only at the hull.",
          },
        ]
      : []),
    ...(pickles
      ? [
          {
            diveSiteId: pickles.id,
            name: "Blue tang",
            kind: "fish",
            imageUrl: commonsImage("Blue Tang Pickles 20080310.jpg"),
            description: "Loose, easy groups that move across the coral heads all day.",
            preparationTip: "Hover rather than chase — the school circles back on its own.",
          },
          {
            diveSiteId: pickles.id,
            name: "Stoplight parrotfish",
            kind: "fish",
            imageUrl: commonsImage("Stoplight parrotfish Pickles Reef.jpg"),
            description: "The reef's namesake grazer, working the barrel-shaped coral heads.",
            preparationTip: "Listen for the crunch of a beak on coral before you spot the fish.",
          },
        ]
      : []),
  ];
  if (laterCreatures.length > 0) {
    await db.insert(diveSiteCreatures).values(laterCreatures.map((row) => ({ shopId, ...row })));
  }
  const laterMoments = [
    spiegel
      ? {
          diveSiteId: spiegel.id,
          caption: "The moment the flight deck resolves out of the blue on the way down.",
          imageUrl: commonsImage("FKNMS - Goliath Grouper With Remora (27094933605).jpg"),
          isPublished: true,
        }
      : null,
    christ
      ? {
          diveSiteId: christ.id,
          caption: "Eight meters down — 25 feet — hands up, sunlight all the way to the sand.",
          imageUrl: commonsImage("French Angelfish Pickles Reef 20230713.jpg"),
          isPublished: true,
        }
      : null,
  ].filter((row) => row !== null);
  if (laterMoments.length > 0) {
    await db.insert(diveSiteMoments).values(laterMoments.map((row) => ({ shopId, ...row })));
  }

  /**
   * A dated session for a catalog course, or nothing at all when this shop does
   * not carry that title. Spread into the trips list so a missing course drops
   * its session quietly instead of throwing the whole seed.
   */
  return { siteByName, benwood, french };
}
