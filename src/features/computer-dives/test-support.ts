import { randomUUID } from "node:crypto";
import type { AppDb } from "@/db/client";
import { createPerson } from "@/db/people";
import { shops, userAccounts } from "@/db/schema";
import { previewComputerFiles } from "./store";
export const file = (id = "one", depth = "20") => ({
  name: "private.csv",
  bytes: new TextEncoder().encode(
    `local_start,utc_offset,device,source_id,duration_seconds,max_depth_m\n2026-01-01T23:50:00,unknown,Computer,${id},1800,${depth}\n`,
  ),
});
export async function computerFixture(db: AppDb) {
  const [shop] = await db
    .insert(shops)
    .values({ name: "Computer shop", timezone: "UTC", slug: `computer-${randomUUID()}` })
    .returning();
  const actor = await createPerson(db, {
    shopId: shop.id,
    fullName: "Staff",
    email: `${randomUUID()}@example.com`,
    phone: null,
    origin: "seed",
    roles: ["owner"],
  });
  await db
    .insert(userAccounts)
    .values({ personId: actor.id, email: actor.email ?? "missing@example.com", status: "active" });
  const person = await createPerson(db, {
    shopId: shop.id,
    fullName: "Diver",
    email: null,
    phone: null,
    origin: "seed",
  });
  return { shopId: shop.id, personId: person.id, actorPersonId: actor.id };
}
export async function selectedInput(
  db: AppDb,
  scope: Awaited<ReturnType<typeof computerFixture>>,
  files = [file()],
) {
  const preview = await previewComputerFiles(db, scope, files);
  return {
    files,
    selectedKeys: preview.dives.map((d) => d.key),
    requestKey: randomUUID(),
    confirmedPersonId: scope.personId,
    timeOffsets: Object.fromEntries(preview.dives.map((d) => [d.key, null])),
  };
}
