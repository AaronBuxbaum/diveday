import { and, eq } from "drizzle-orm";
import type { AppDb } from "./client";
import { leads, people } from "./schema";
import { livePerson } from "./trips-live";

export async function ownerId(db: AppDb, shopId: string) {
  const [row] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.shopId, shopId), eq(people.fullName, "Dana Reyes"), livePerson()));
  if (!row) throw new Error("seed owner missing");
  return row.id;
}

/** A date lead written straight at the table, so a test can place its dates. */
export async function addLead(
  db: AppDb,
  shopId: string,
  fields: {
    interest: string;
    preferredDate?: string | null;
    alternateDate?: string | null;
    dateFlexible?: boolean;
    email?: string | null;
    phone?: string | null;
    name?: string | null;
    askedAt?: Date;
  },
) {
  const [row] = await db
    .insert(leads)
    .values({
      shopId,
      scope: "date",
      askedBy: "diver",
      interest: fields.interest,
      name: fields.name ?? null,
      email: fields.email ?? null,
      phone: fields.phone ?? null,
      experienceLevel: "certified",
      preferredDate: fields.preferredDate ?? null,
      alternateDate: fields.alternateDate ?? null,
      dateFlexible: fields.dateFlexible ?? false,
      ...(fields.askedAt ? { askedAt: fields.askedAt } : {}),
    })
    .returning({ id: leads.id });
  if (!row) throw new Error("lead insert failed");
  return row.id;
}

export async function leadRow(db: AppDb, id: string) {
  const [row] = await db.select().from(leads).where(eq(leads.id, id));
  if (!row) throw new Error("lead missing");
  return row;
}
