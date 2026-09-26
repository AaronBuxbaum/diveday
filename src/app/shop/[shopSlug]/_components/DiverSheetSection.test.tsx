import { and, eq, isNotNull } from "drizzle-orm";
import Link from "next/link";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { bookings, people } from "@/db/schema";
import { displayStoredPhone } from "@/lib/forgiving-fields";
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

  /**
   * **A phone number is one unit** (pixel-craft class 8, K-450). The sheet's
   * subtitle joined the email and the grouped number with ordinary spaces, so
   * the line broke inside the number — "+1 305 555" over "0110" — which is a
   * different number to anybody dialling it off the screen. The groups are
   * held together; the line may still break at the separator.
   */
  it("keeps the diver's phone number whole in the subtitle", async () => {
    const { db, shop } = await seededShopContext();
    vi.mocked(getDb).mockResolvedValue(db);
    const [reachable] = await db
      .select({ id: people.id, phone: people.phone })
      .from(people)
      .where(and(eq(people.shopId, shop.id), isNotNull(people.phone), isNotNull(people.email)))
      .limit(1);
    if (!reachable?.phone) throw new Error("seeded shop has no diver with a phone and an email");

    const tree = await DiverSheetSection({ shop, personId: reachable.id, locale: "en-US" });
    const subtitle = (tree as ReactElement<{ subtitle?: unknown }> | null)?.props.subtitle;
    if (typeof subtitle !== "string") throw new Error("the sheet was given no subtitle");

    const [, number] = subtitle.split(" · ");
    expect(number).toBeDefined();
    // Grouped for reading, and not one of the groups can be split off.
    expect(number).toMatch(/\u00a0/);
    expect(number).not.toMatch(/ /);
    expect(number?.replaceAll("\u00a0", " ")).toBe(displayStoredPhone(reachable.phone));
  });

  /**
   * **The arrow keeps a word's distance from the words** (pixel-craft class 2,
   * K-591). The link is `inline-flex`, so the JSX space before the arrow ended
   * the label's anonymous flex item and was dropped: "record→", 2px apart,
   * where the link's own word spaces are 4–5px. The gap is the container's.
   */
  it("spaces the record door's arrow with the link's own gap, not a dropped space", async () => {
    const { db, shop } = await seededShopContext();
    vi.mocked(getDb).mockResolvedValue(db);
    const [booked] = await db
      .select({ personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.shopId, shop.id))
      .limit(1);
    if (!booked) throw new Error("seeded shop has no booked diver");

    const tree = await DiverSheetSection({ shop, personId: booked.personId, locale: "en-US" });
    const door = findElements<{ href?: unknown; className?: string; children?: ReactNode }>(
      tree,
      Link,
    ).find((link) => link.props.href === `/shop/${shop.slug}/divers/${booked.personId}`);
    if (!door) throw new Error("the sheet rendered no door to the record");

    expect(door.props.className?.split(/\s+/)).toContain("gap-1");
    const blanks = [door.props.children]
      .flat()
      .filter((child) => typeof child === "string" && child.trim() === "");
    expect(blanks).toEqual([]);
  });
});
