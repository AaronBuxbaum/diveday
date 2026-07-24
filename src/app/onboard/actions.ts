"use server";

import { hash } from "bcryptjs";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { getDb } from "@/db/client";
import { people, personRoles, shops, userAccounts, waiverTemplates } from "@/db/schema";
import { signIn } from "@/lib/auth";
import { onboardSchema } from "@/lib/onboarding";
import { checkRateLimit, RATE_LIMIT_MESSAGE, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import { DEFAULT_WAIVER_BODY, DEFAULT_WAIVER_TITLE } from "@/lib/waivers";

export async function onboardAction(formData: FormData) {
  const ip = await clientIp();
  if (!checkRateLimit(rateLimitKey("onboard", ip), RATE_LIMITS.onboard).allowed) {
    redirect(`/onboard?error=${encodeURIComponent(RATE_LIMIT_MESSAGE)}`);
  }

  const rawData = Object.fromEntries(formData.entries());
  const parsed = onboardSchema.safeParse(rawData);

  if (!parsed.success) {
    const firstError = parsed.error.issues[0]?.message || "Invalid input";
    redirect(`/onboard?error=${encodeURIComponent(firstError)}`);
  }

  const { shopName, shopSlug, timezone, ownerName, ownerEmail, ownerPassword } = parsed.data;

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
          // A real shop is never seeded and is never a demo. Sample/fake data
          // lives only in a freshly-minted demo shop (createDemoShop), so a shop
          // that later imports its real roster never has seeded rows mixed in.
          // See ADR 20260724-per-visitor-demo-shops.
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

      // Every new shop starts clean: just its default waiver, ready for the
      // owner's own trips and divers. No sample data — that only ever lives in
      // a demo shop (ADR 20260724-per-visitor-demo-shops).
      await tx.insert(waiverTemplates).values({
        shopId: newShop.id,
        title: DEFAULT_WAIVER_TITLE,
        version: 1,
        body: DEFAULT_WAIVER_BODY,
      });
    });
  } catch (err) {
    if (onboardingError) {
      redirect(`/onboard?error=${encodeURIComponent(onboardingError)}`);
    }
    // Never surface a raw exception to an unauthenticated visitor — it can
    // carry internal detail (a DB driver error, a stack fragment). The real
    // cause goes to the server log, where the shop's technical owner can see
    // it; the visitor gets a generic, actionable message (CR-014).
    console.error("onboardAction: failed to create shop", err);
    redirect(
      `/onboard?error=${encodeURIComponent("Something went wrong creating your shop. Please try again.")}`,
    );
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
