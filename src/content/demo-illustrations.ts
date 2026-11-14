/** Fictional artwork approved for demo tenants in #4381, never catalog evidence. */
export const DEMO_ILLUSTRATIONS = {
  boat: "A small dive boat tied to a wooden dock",
  fleet: "A small dive boat on turquoise water",
  dock: "Two adults talking beside fins at a coastal dock",
  briefing: "An instructor discussing a blank slate with adult guests",
  student: "An adult student and instructor talking in a training pool",
  reef: "Sunlit coral heads and sandy channels on a fictional reef",
  oxygen: "Adults discussing emergency oxygen equipment in a dry classroom",
} as const;

export type DemoIllustrationScene = keyof typeof DEMO_ILLUSTRATIONS;

export function demoIllustration(scene: DemoIllustrationScene) {
  return {
    url: `/demo-shop/generated/${scene}.webp`,
    // i18n-exempt: seeded shop-authored alt text, like the shop's tagline.
    alt: `Generated demo illustration: ${DEMO_ILLUSTRATIONS[scene]}`,
  };
}
