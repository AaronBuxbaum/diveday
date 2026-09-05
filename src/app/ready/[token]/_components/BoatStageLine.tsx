import { SiteMark } from "@/components/illustration/SiteMark";

/**
 * **The boat's own line on the diver's link** — ADR
 * 20260904-reef-all-the-way-down, decision 2, Budget rule 4.
 *
 * What the crew said, and when. Deliberately not an earned moment: the thread
 * spends coral exactly three times (booked, waiver complete, welcome home; ADR
 * 20260827-the-divers-thread), and a boat being out is none of them. Plain
 * ink, one drawing, no second claim about status — `ThreadStatus` says the
 * status, once, and this says where the boat is.
 */
export function BoatStageLine({ sentence, said }: { sentence: string; said: string }) {
  return (
    <div className="mt-6 flex items-start gap-3 rounded-panel bg-surface-sunken p-4">
      <SiteMark mark="boat" size="sm" ground="surface" coral={false} />
      <div className="min-w-0">
        <p className="text-base font-medium">{sentence}</p>
        <p className="mt-0.5 text-sm text-muted tabular-nums">{said}</p>
      </div>
    </div>
  );
}
