import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { enterDemoAction } from "@/app/actions/demo";
import { EntryShell } from "@/components/account/EntryShell";
import { FunnelTag } from "@/components/FunnelTag";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { DEMO_STORY_IDS, DEMO_STORY_KEYS, isDemoStoryId } from "@/lib/demo-stories";
import { storySource } from "@/lib/funnel";

/**
 * **One stable link per demo story** (issue #1215, delight report D55).
 *
 * A door somebody can paste into an email to a shop owner: `/demo/weather-day`
 * opens on the weather day and nothing else. That is what the ticket's first
 * slice asks for by "stable demo entry links", and it is what the 30-day goal
 * behind the owner's ruling — five shop conversations — actually needs.
 *
 * **Not three more buttons on `/`.** The landing page argues its own demo-door
 * count in as many words ("the page's demo-door count is exactly what it was")
 * and adding a second picker beside the existing CTAs would fight that for no
 * gain: nobody browsing the homepage is looking for a *story*, and the person
 * who is has been handed this URL.
 *
 * **A page with one button, not a GET that mints.** Entering builds a whole
 * seeded shop, and a bare GET doing that is a link an email scanner or a
 * prefetcher trips on its way past. So the link lands here, says which story it
 * is, and waits for the tap — one clear primary action, and the only claim on
 * the page is a description of what the visitor is about to see.
 */
// Only the three stories are valid routes; anything else 404s via the
// `notFound()` call in the body — `dynamicParams` is not compatible with Cache
// Components (nextConfig.cacheComponents), so the refusal for an unknown story
// is enforced in the page rather than in this config. Same arrangement, and the
// same reason, as `/switching/[competitor]`.
export function generateStaticParams() {
  return DEMO_STORY_IDS.map((story) => ({ story }));
}

export const instant = true;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ story: string }>;
}): Promise<Metadata> {
  const { story } = await params;
  if (!isDemoStoryId(story)) return {};
  const t = diverTranslator(await requestLocale());
  return { title: `${t(DEMO_STORY_KEYS[story].title)} — DiveDay` };
}

export default async function DemoStoryPage({ params }: { params: Promise<{ story: string }> }) {
  const { story } = await params;
  if (!isDemoStoryId(story)) notFound();
  const t = diverTranslator(await requestLocale());

  return (
    <EntryShell
      wordmark
      eyebrow={t("demo.stories.eyebrow")}
      title={t(DEMO_STORY_KEYS[story].title)}
      description={t(DEMO_STORY_KEYS[story].desc)}
      // The whole action is one button, so no box around it.
      panel={false}
    >
      <form action={enterDemoAction}>
        <FunnelTag source={storySource(story)} />
        <input type="hidden" name="story" value={story} />
        <SubmitButton
          pendingLabel={t("marketing.common.gettingReady")}
          className={buttonClass({ busy: true, className: "w-full" })}
        >
          {t("demo.stories.enter")}
        </SubmitButton>
      </form>
    </EntryShell>
  );
}
