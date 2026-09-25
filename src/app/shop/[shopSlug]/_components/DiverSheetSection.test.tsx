import { eq } from "drizzle-orm";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { bookings } from "@/db/schema";
import { seededShopContext } from "@/test/db";
import { findElements } from "@/test/jsx-inspect";
import { DiverStory } from "../divers/[personId]/_components/DiverStory";

// The section is invoked directly, outside Next's request scope, so the one
// thing that only exists inside one (the db handle) is stubbed.
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});

const { getDb } = await import("@/db/client");
const { DiverSheetSection } = await import("./DiverSheetSection");

type HostProps = { className?: unknown; children?: ReactNode };

/** The host element whose direct children include `target`, or null. */
function parentOf(node: unknown, target: ReactElement): ReactElement<HostProps> | null {
  if (node === null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = parentOf(child, target);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement<HostProps>(node)) return null;
  const children = [node.props.children].flat();
  if (children.includes(target)) return node;
  return parentOf(node.props.children, target);
}

describe("DiverSheetSection", () => {
  /**
   * **The sheet owns the space above the story.** `DiverStory` used to take a
   * `className` so the sheet could hang `mt-10` on it: `mt-*` on a section at
   * a call site, the pattern the diver record's one `space-y-10` replaced.
   * The story now carries no margin and takes no prop to hang one on, and the
   * sheet's own wrapper keeps the 40px it has always drawn.
   */
  it("wraps the story in the sheet's own mt-10 div and hands the story no className", async () => {
    const { db, shop } = await seededShopContext();
    vi.mocked(getDb).mockResolvedValue(db);
    const [booked] = await db
      .select({ personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.shopId, shop.id))
      .limit(1);
    if (!booked) throw new Error("seeded shop has no booked diver");

    const tree = await DiverSheetSection({ shop, personId: booked.personId, locale: "en-US" });
    const [story] = findElements<Record<string, unknown>>(tree, DiverStory);

    expect(story).toBeDefined();
    expect(story?.props).not.toHaveProperty("className");
    const wrapper = story ? parentOf(tree, story) : null;
    expect(wrapper?.type).toBe("div");
    expect(wrapper?.props.className).toBe("mt-10");
  });
});
