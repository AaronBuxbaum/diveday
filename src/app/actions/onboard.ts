"use server";

import { hash } from "bcryptjs";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { z } from "zod";
import { getDb } from "@/db/client";
import { people, personRoles, shops, userAccounts, waiverTemplates } from "@/db/schema";
import { seedShopWithDemoData } from "@/db/seed";
import { signIn } from "@/lib/auth";
import { DEFAULT_WAIVER_BODY, DEFAULT_WAIVER_TITLE } from "@/lib/waivers";

const onboardSchema = z.object({
  shopName: z.string().trim().min(1, "Shop name is required").max(100),
  shopSlug: z
    .string()
    .trim()
    .min(1, "Slug is required")
    .max(50)
    .toLowerCase()
    .regex(/^[a-z0-9-]+$/, "Slug must only contain letters, numbers, and hyphens"),
  timezone: z.string().trim().min(1, "Timezone is required"),
  ownerName: z.string().trim().min(1, "Owner name is required").max(100),
  ownerEmail: z.string().trim().email("Invalid email address").max(150),
  ownerPassword: z.string().min(6, "Password must be at least 6 characters"),
  seedDemoData: z.preprocess((val) => val === "on" || val === true, z.boolean()),
});

export async function onboardAction(formData: FormData) {
  const rawData = Object.fromEntries(formData.entries());
  const parsed = onboardSchema.safeParse(rawData);

  if (!parsed.success) {
    const firstError = parsed.error.issues[0]?.message || "Invalid input";
    redirect(`/onboard?error=${encodeURIComponent(firstError)}`);
  }

  const { shopName, shopSlug, timezone, ownerName, ownerEmail, ownerPassword, seedDemoData } =
    parsed.data;

  const db = await getDb();
  let onboardingError: string | null = null;

  try {
    await db.transaction(async (tx) => {
      // Check if slug is taken
      const [existingShop] = await tx.select().from(shops).where(eq(shops.slug, shopSlug)).limit(1);

      if (existingShop) {
        onboardingError = `The slug "${shopSlug}" is already taken.`;
        tx.rollback();
        return;
      }

      // Check if email is taken
      const [existingAccount] = await tx
        .select()
        .from(userAccounts)
        .where(eq(userAccounts.email, ownerEmail.toLowerCase()))
        .limit(1);

      if (existingAccount) {
        onboardingError = "This email is already registered.";
        tx.rollback();
        return;
      }

      // Create Shop
      const [newShop] = await tx
        .insert(shops)
        .values({
          name: shopName,
          slug: shopSlug,
          timezone,
          // Seeding sample data is a convenience, not demo mode: a real trial
          // shop must not get the Demo Playground banner or the destructive
          // "Reset demo data" button. isDemo is reserved for the canonical
          // seeded demo tenant (seedIfEmpty / enterDemoAction).
          isDemo: false,
        })
        .returning();

      if (!newShop) {
        throw new Error("Failed to create shop");
      }

      // Create owner person
      const [newPerson] = await tx
        .insert(people)
        .values({
          shopId: newShop.id,
          fullName: ownerName,
          email: ownerEmail.toLowerCase(),
          // No placeholder emergency contact: a literal "On file" reads as a real
          // contact on the manifest and hides the gap. Left null until captured.
        })
        .returning();

      if (!newPerson) {
        throw new Error("Failed to create owner person");
      }

      // Assign owner & manager roles
      await tx.insert(personRoles).values([
        { personId: newPerson.id, role: "owner" },
        { personId: newPerson.id, role: "manager" },
      ]);

      // Hash password (cost 10)
      const hashedPassword = await hash(ownerPassword, 10);

      // Create user account
      await tx.insert(userAccounts).values({
        personId: newPerson.id,
        email: ownerEmail.toLowerCase(),
        hashedPassword,
      });

      if (!seedDemoData) {
        await tx.insert(waiverTemplates).values({
          shopId: newShop.id,
          title: DEFAULT_WAIVER_TITLE,
          version: 1,
          body: DEFAULT_WAIVER_BODY,
        });
      } else {
        await seedShopWithDemoData(tx, newShop.id);
      }
    });
  } catch (err) {
    if (onboardingError) {
      redirect(`/onboard?error=${encodeURIComponent(onboardingError)}`);
    }
    const message =
      err instanceof Error ? err.message : "An unexpected error occurred during onboarding.";
    redirect(`/onboard?error=${encodeURIComponent(message)}`);
  }

  // 2. Sign in the new owner and redirect to dashboard
  try {
    await signIn("credentials", {
      email: ownerEmail.toLowerCase(),
      password: ownerPassword,
      redirectTo: `/shop/${shopSlug}`,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      redirect("/onboard?error=Authentication+failed+after+onboarding");
    }
    throw error; // Propagate NEXT_REDIRECT
  }
}
