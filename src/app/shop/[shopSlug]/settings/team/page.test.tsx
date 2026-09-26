import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { getShopBySlug } from "@/db/shops";
import type { StaffMember } from "@/db/staff-accounts";
import type { DiveDaySession } from "@/lib/auth";
import { seededTestDb } from "@/test/db";
import { nextHeadersStub } from "@/test/next-headers";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";

// Same mocking shape as ../embed/page.test.tsx: the page is invoked directly,
// outside Next's request scope, so the three things that only exist inside one
// (the db handle, better-auth, and request headers) are stubbed and nothing else.
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<DiveDaySession | null>>() }));
vi.mock("next/headers", () => nextHeadersStub());

const { getDb } = await import("@/db/client");
const authModule = (await import("@/lib/auth")) as unknown as {
  auth: ReturnType<typeof vi.fn<() => Promise<DiveDaySession | null>>>;
};
const auth = authModule.auth;
const TeamSettingsPage = (await import("./page")).default;

type StaffRowProps = { member: StaffMember; [prop: string]: unknown };
type HostProps = { className?: unknown; children?: ReactNode };

/** Every `StaffRow` the page built, found by name: the page does not export it. */
function staffRows(node: unknown, found: ReactElement<StaffRowProps>[] = []) {
  if (node === null || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    for (const child of node) staffRows(child, found);
    return found;
  }
  if (isValidElement<{ children?: unknown }>(node)) {
    if (typeof node.type === "function" && node.type.name === "StaffRow") {
      found.push(node as ReactElement<StaffRowProps>);
    }
    staffRows(node.props.children, found);
  }
  return found;
}

/** The first host element whose class list holds every one of `classes`. */
function hostWithClasses(node: unknown, classes: string[]): ReactElement<HostProps> | null {
  if (node === null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = hostWithClasses(child, classes);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement<HostProps>(node)) return null;
  const tokens = typeof node.props.className === "string" ? node.props.className.split(" ") : [];
  if (typeof node.type === "string" && classes.every((c) => tokens.includes(c))) return node;
  return hostWithClasses(node.props.children, classes);
}

/** Every `SubmitButton` (the one element with a `pendingLabel`) in a tree, in render order. */
function submitButtons(node: unknown, found: ReactElement<HostProps>[] = []) {
  if (node === null || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    for (const child of node) submitButtons(child, found);
    return found;
  }
  if (isValidElement<HostProps & { pendingLabel?: unknown }>(node)) {
    if (typeof node.props.pendingLabel === "string") found.push(node);
    submitButtons(node.props.children, found);
  }
  return found;
}

/** A staff row's own tree, rendered one level: `StaffRow` is a plain function of its props. */
function rowTree(row: ReactElement<StaffRowProps>, member: StaffMember = row.props.member) {
  const render = row.type as (props: StaffRowProps) => ReactNode;
  return render({ ...row.props, member });
}

async function renderTeam() {
  const db: AppDb = await seededTestDb();
  const shop = await getShopBySlug(db, "blue-mantis");
  if (!shop) throw new Error("demo shop missing");
  const personId = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(auth).mockResolvedValue({
    user: {
      personId,
      shopId: shop.id,
      shopSlug: "blue-mantis",
      name: "Dana Reyes",
      email: SEEDED_OWNER_EMAIL,
      roles: ["owner", "manager"],
    },
  });
  return TeamSettingsPage({
    params: Promise.resolve({ shopSlug: "blue-mantis" }),
    searchParams: Promise.resolve({}),
  });
}

/** The row at the foot of a staff card: resend an invitation, or switch the account off. */
const ACCOUNT_ROW = ["flex", "flex-col", "gap-2", "sm:flex-row"];

describe("a staff card's account row", () => {
  /**
   * The row holds one of two things: Resend for somebody still invited, or
   * Disable / Delete for everybody else. It used to hold both slots always,
   * the first an empty `<div>` for every account past the invitation, so the
   * pixel probe found that div taking the row's 8px gap on every staff card of
   * settings-team, pushing the buttons 8px down on a phone.
   */
  it("holds only what it shows, whether or not an invitation is pending", async () => {
    const rows = staffRows(await renderTeam());
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      for (const accountStatus of ["active", "disabled", "invited"] as const) {
        const tree = rowTree(row, { ...row.props.member, accountStatus });
        const accountRow = hostWithClasses(tree, ACCOUNT_ROW);
        expect(accountRow, `${row.props.member.fullName} (${accountStatus})`).not.toBeNull();
        const shown = Children.toArray(accountRow?.props.children);
        expect(shown, accountStatus).toHaveLength(1);
        for (const child of shown) {
          const content = isValidElement<{ children?: ReactNode }>(child)
            ? Children.toArray(child.props.children)
            : [child];
          expect(content.length, `an empty box on a ${accountStatus} row`).toBeGreaterThan(0);
        }
      }
    }
  });

  /**
   * "Disable" gives the unseen lower half of its 44px box to the card's 16px
   * padding (`outdent`), so the box ends 4px above the row's rule: the outset
   * ring, 5px past the box, painted over the `divide-y` hairline on every card
   * and lost its bottom pixel to the list's `overflow-hidden` on the last
   * (K-43). It rings inside instead. "Enable" is a bordered box with no
   * outdent, 16px clear of the rule, and keeps the app's ring.
   */
  it("rings Disable inside the card, whose padding its outdent leaves 4px of", async () => {
    const [row] = staffRows(await renderTeam());
    const toggle = (accountStatus: StaffMember["accountStatus"]) => {
      const tree = rowTree(row, { ...row.props.member, accountStatus });
      const [first] = submitButtons(hostWithClasses(tree, ACCOUNT_ROW));
      expect(first, accountStatus).toBeDefined();
      return String(first?.props.className ?? "").split(" ");
    };
    const disable = toggle("active");
    expect(disable).toContain("focus-visible:focus-ring-inset");
    const enable = toggle("disabled");
    expect(enable).not.toContain("focus-visible:focus-ring-inset");
  });
});
