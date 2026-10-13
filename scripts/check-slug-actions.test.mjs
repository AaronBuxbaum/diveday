import { describe, expect, it } from "vitest";
import {
  exportReachesSurface,
  findSlugActionsOnStaffSession,
  isServerModule,
  repositoryImports,
} from "./check-slug-actions.mjs";

const names = (source) => findSlugActionsOnStaffSession(source).map((finding) => finding.name);

describe("a slug-taking server action", () => {
  it("is refused when it gates on requireStaffSession", () => {
    expect(
      names(`"use server";

export async function saveAction(shopSlug: string, formData: FormData) {
  const session = await requireStaffSession();
  redirect(shopPath(shopSlug, "x"));
}
`),
    ).toEqual(["saveAction"]);
  });

  it("is refused when a helper of the same module takes the gate for it", () => {
    expect(
      names(`"use server";

async function requireAuthor(shopSlug: string) {
  const session = await requireStaffSession();
  return session;
}

export async function moveAction(shopSlug: string, formData: FormData) {
  const session = await requireAuthor(shopSlug);
}
`),
    ).toEqual(["moveAction"]);
  });

  it("is refused as a const arrow export too", () => {
    expect(
      names(`"use server";

export const removeAction = async (shopSlug: string) => {
  await requireStaffSession();
};
`),
    ).toEqual(["removeAction"]);
  });

  it("is refused when the slug arrives inside a bound context object", () => {
    expect(
      names(`"use server";

export async function noteAction(ctx: ManifestTripContext, formData: FormData) {
  const staff = await requireStaffSession();
  revalidatePath(shopPath(ctx.shopSlug, "trips", ctx.tripId));
}
`),
    ).toEqual(["noteAction"]);
  });

  it("is refused when the context object reaches a path helper that destructures the slug", () => {
    expect(
      names(`"use server";

function manifestPath({ shopSlug, tripId }: ManifestTripContext): string {
  return shopPath(shopSlug, "trips", tripId, "manifest");
}

export async function rollCallAction(ctx: ManifestActionContext, formData: FormData) {
  const staff = await requireStaffSession();
  revalidatePath(manifestPath(ctx));
}
`),
    ).toEqual(["rollCallAction"]);
  });

  it("passes a context-object action that opens with requireShopSurface", () => {
    expect(
      names(`"use server";

async function manifestStaff(ctx: ManifestTripContext) {
  return (await requireShopSurface(ctx.shopSlug)).session;
}

export async function noteAction(ctx: ManifestTripContext, formData: FormData) {
  const staff = await manifestStaff(ctx);
  revalidatePath(shopPath(ctx.shopSlug, "trips", ctx.tripId));
}
`),
    ).toEqual([]);
  });

  it("passes an action whose only slug is the session's own", () => {
    expect(
      names(`"use server";

export async function pushAction(tripId: string) {
  const staff = await requireStaffSession();
  revalidatePath(shopPath(staff.user.shopSlug, "trips", tripId));
}
`),
    ).toEqual([]);
  });

  it("passes when it opens with requireShopSurface", () => {
    expect(
      names(`"use server";

export async function saveAction(shopSlug: string, formData: FormData): Promise<{ ok: true }> {
  const { session } = await requireShopSurface(shopSlug);
  return { ok: true };
}
`),
    ).toEqual([]);
  });
});

describe("leaves alone", () => {
  it("an action that takes no slug and builds paths from the session", () => {
    expect(
      names(`"use server";

export async function saveAction(slug: string, formData: FormData) {
  const staff = await requireStaffSession();
  redirect(shopPath(staff.user.shopSlug, "courses", slug));
}
`),
    ).toEqual([]);
  });

  it("a module that is not a server module", () => {
    expect(
      names(`export async function helper(shopSlug: string) {
  await requireStaffSession();
}
`),
    ).toEqual([]);
  });

  it("a comment or a string that names the gate", () => {
    expect(
      names(`"use server";

/** Not requireStaffSession(), see the rule. */
export async function saveAction(shopSlug: string) {
  // requireStaffSession() would be wrong here
  const label = "requireStaffSession()";
  await requireShopSurface(shopSlug);
}
`),
    ).toEqual([]);
  });

  it("an unexported helper that takes a slug, when no export reaches it", () => {
    expect(
      names(`"use server";

async function unused(shopSlug: string) {
  await requireStaffSession();
}

export async function saveAction(shopSlug: string) {
  await requireShopSurface(shopSlug);
}
`),
    ).toEqual([]);
  });
});

describe("the directive", () => {
  it("is read after a leading comment", () => {
    expect(isServerModule(`// a note\n/* more */\n"use server";\n`)).toBe(true);
  });

  it("is not read from further down the file", () => {
    expect(isServerModule(`import x from "y";\n"use server";\n`)).toBe(false);
  });
});

describe("a slug-taking staff action must reach requireShopSurface", () => {
  const staff = (source, importedGates = []) =>
    findSlugActionsOnStaffSession(source, { staffModule: true, importedGates }).map(
      (finding) => `${finding.name}:${finding.problem}`,
    );

  it("passes when it opens with requireShopSurface, directly or through a helper", () => {
    expect(
      staff(`"use server";

async function requireEditor(shopSlug: string) {
  return requireShopSurface(shopSlug);
}

export async function a(shopSlug: string) {
  await requireShopSurface(shopSlug);
}

export async function b(shopSlug: string) {
  await requireEditor(shopSlug);
}
`),
    ).toEqual([]);
  });

  it("is refused when it checks nothing, or signs in by hand", () => {
    expect(
      staff(`"use server";

export async function nothing(shopSlug: string, formData: FormData) {
  redirect(shopPath(shopSlug, "x"));
}

export async function byHand(shopSlug: string) {
  const session = await auth();
  if (session?.user.shopSlug !== shopSlug) notFound();
}
`),
    ).toEqual(["nothing:no-surface", "byHand:no-surface"]);
  });

  it("passes through a helper imported from a module where it reaches the gate", () => {
    const source = `"use server";

export async function addNote(shopSlug: string, personId: string) {
  const context = await requireDiverActionContext(shopSlug, personId);
}
`;
    expect(staff(source)).toEqual(["addNote:no-surface"]);
    expect(staff(source, ["requireDiverActionContext"])).toEqual([]);
  });

  it("finds the imported helper by what its own module does", () => {
    const helpers = `export async function requireDiverActionContext(shopSlug: string) {
  const { session } = await requireShopSurface(shopSlug);
  return session;
}

export async function looseContext(shopSlug: string) {
  return requireStaffSession();
}
`;
    expect(exportReachesSurface(helpers, "requireDiverActionContext")).toBe(true);
    expect(exportReachesSurface(helpers, "looseContext")).toBe(false);
    expect(
      repositoryImports(`import { a, b as c } from "./helpers";
import { z } from "zod";
import { type T, d } from "@/lib/x";`),
    ).toEqual([
      { name: "a", local: "a", from: "./helpers" },
      { name: "b", local: "c", from: "./helpers" },
      { name: "T", local: "T", from: "@/lib/x" },
      { name: "d", local: "d", from: "@/lib/x" },
    ]);
  });

  it("leaves a public action alone, and one that says it runs before sign-in", () => {
    const publicAction = `"use server";

export async function bookSpot(shopSlug: string, formData: FormData) {
  await createBooking(shopSlug, formData);
}
`;
    expect(findSlugActionsOnStaffSession(publicAction)).toEqual([]);
    expect(
      findSlugActionsOnStaffSession(`"use server";

export async function switchRole(role: string, shopSlug: string) {
  // diveday:slug-action-before-sign-in: how a visitor becomes staff here.
  const session = await auth();
}
`),
    ).toEqual([]);
  });
});
