import type { DiverMessageKey } from "@/i18n/messages";

/**
 * The five demo roles a visitor can experience DiveDay as. Shared between the
 * in-app role switcher (`DemoBanner`, on every `/shop/[shopSlug]` page of a
 * demo tenant) and the landing page's pre-entry role picker, so the roster
 * can never drift between "switch to" and "enter as."
 */
export type DemoRoleId = "owner" | "instructor" | "divemaster" | "captain" | "diver";

/** Data (icon/sample name), not copy — the words come from the `demo` message namespace. */
export const DEMO_ROLE_META: { id: DemoRoleId; icon: string; name: string }[] = [
  { id: "owner", icon: "👑", name: "Dana Reyes" },
  { id: "instructor", icon: "🎓", name: "Marcus Webb" },
  { id: "divemaster", icon: "🤿", name: "Keiko Tanaka" },
  { id: "captain", icon: "⚓", name: "Sal Moretti" },
  { id: "diver", icon: "🐬", name: "Public Guest" },
];

export const DEMO_ROLE_KEYS: Record<
  DemoRoleId,
  { title: DiverMessageKey; desc: DiverMessageKey; tryThis: DiverMessageKey }
> = {
  owner: {
    title: "demo.roles.owner.title",
    desc: "demo.roles.owner.desc",
    tryThis: "demo.roles.owner.tryThis",
  },
  instructor: {
    title: "demo.roles.instructor.title",
    desc: "demo.roles.instructor.desc",
    tryThis: "demo.roles.instructor.tryThis",
  },
  divemaster: {
    title: "demo.roles.divemaster.title",
    desc: "demo.roles.divemaster.desc",
    tryThis: "demo.roles.divemaster.tryThis",
  },
  captain: {
    title: "demo.roles.captain.title",
    desc: "demo.roles.captain.desc",
    tryThis: "demo.roles.captain.tryThis",
  },
  diver: {
    title: "demo.roles.diver.title",
    desc: "demo.roles.diver.desc",
    tryThis: "demo.roles.diver.tryThis",
  },
};
