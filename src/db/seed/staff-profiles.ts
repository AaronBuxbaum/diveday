import { and, eq, isNull } from "drizzle-orm";
import type { PublicStaffProfile } from "@/lib/public-staff-profile";
import type { DbExecutor } from "../client";
import { people, shops } from "../schema";
import { DEMO_STAFF_PORTRAIT_PATHS } from "./staff-portraits";

type CastKey = keyof typeof DEMO_STAFF_PORTRAIT_PATHS;

/**
 * **"Who you'll dive with" in the demo** (#4928): five of the six crew have chosen to appear, each
 * in their own words with their existing portrait. Yusra Idrissi has not, so the opt-in shows: a
 * person who never wrote a profile is simply not on the page. Only a person with an active
 * sign-in appears on the storefront, so on the canonical demo that is Dana, Marcus, Keiko and Sal;
 * Talia shows on a minted demo shop, which gives every crew member an account.
 *
 * Words are first person and the crew's own. Languages are the profile's own line, apart from the
 * shop's spoken-languages record that `staffDefs` keeps unseeded.
 */
// i18n-exempt: each profile is written by the person it describes, like a shop's tagline.
const PROFILES = {
  dana: {
    firstName: "Dana",
    role: "Owner",
    sinceYear: 1998,
    languages: "English, Spanish",
    description:
      "I run the desk most mornings and take the first boat on Saturdays. I will always tell you if the water is not right for your first dive.",
  },
  marcus: {
    firstName: "Marcus",
    role: "Instructor",
    sinceYear: 2014,
    languages: "English",
    description:
      "I teach most of our first-time divers. We go at the pace of whoever is slowest to relax, and I never mind how many times you ask.",
  },
  keiko: {
    firstName: "Keiko",
    role: "Divemaster",
    sinceYear: 2017,
    languages: "English, Japanese",
    description:
      "I lead the reef boats and know where the nurse sharks sleep at Molasses. If you want to see something small, tell me before we descend.",
  },
  talia: {
    firstName: "Talia",
    role: "Instructor and captain",
    sinceYear: 2019,
    languages: "English, Igbo",
    description:
      "I split my week between the classroom and the helm. The pool is where most people decide they love this, and I like being there for it.",
  },
  sal: {
    firstName: "Sal",
    role: "Captain",
    sinceYear: 2005,
    languages: "English, Italian",
    description:
      "I have run these moorings for more than twenty years. I check the current at dawn, and the boat sails only when I would put my own family on it.",
  },
} as const satisfies Partial<Record<CastKey, Omit<PublicStaffProfile, "photoUrls">>>;

/** Switch on public profiles for the demo crew who wrote one. Demo shops only. */
export async function seedStaffProfiles(
  db: DbExecutor,
  shopId: string,
  cast: readonly { id: string; local: CastKey }[],
): Promise<void> {
  const [shop] = await db.select({ isDemo: shops.isDemo }).from(shops).where(eq(shops.id, shopId));
  if (!shop?.isDemo) return;
  for (const person of cast) {
    const profile = PROFILES[person.local as keyof typeof PROFILES];
    if (!profile) continue;
    await db
      .update(people)
      .set({
        publicStaffProfileEnabled: true,
        publicStaffProfile: {
          ...profile,
          photoUrls: [DEMO_STAFF_PORTRAIT_PATHS[person.local]],
        } satisfies PublicStaffProfile,
      })
      .where(
        and(
          eq(people.shopId, shopId),
          eq(people.id, person.id),
          isNull(people.deletedAt),
          isNull(people.publicStaffProfile),
        ),
      );
  }
}

/**
 * The same profiles for a demo database seeded before they existed: the crew are found by their
 * demo address (`<local>@demo.invalid`, `canonicalStaffEmail` in `index.ts`).
 */
export async function seedStaffProfilesByEmail(db: DbExecutor, shopId: string): Promise<void> {
  const crew = await db
    .select({ id: people.id, email: people.email })
    .from(people)
    .where(and(eq(people.shopId, shopId), isNull(people.deletedAt)));
  await seedStaffProfiles(
    db,
    shopId,
    crew.flatMap((person) => {
      const local = person.email?.replace(/@demo\.invalid$/, "");
      return local && local in DEMO_STAFF_PORTRAIT_PATHS
        ? [{ id: person.id, local: local as CastKey }]
        : [];
    }),
  );
}
