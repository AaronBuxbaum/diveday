import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { shops } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = await getDb();
  const demoShop = await db
    .select({ slug: shops.slug })
    .from(shops)
    .where(eq(shops.isDemo, true))
    .limit(1);
  const demo = demoShop.length > 0;
  const demoSlug = demo ? demoShop[0].slug : null;
  return NextResponse.json({ demo, demoSlug });
}
