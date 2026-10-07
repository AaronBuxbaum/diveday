import { useEffect, useMemo, useRef, useState } from "react";
import { applyFormFields } from "@/components/apply-form-fields";
import type { FormDraftProps } from "@/components/FormDraft";
import { cachedListFormat } from "@/lib/intl-cache";
import type {
  BuilderInitialCourse,
  BuilderInitialSite,
  BuilderOptions,
  BuilderPattern,
  BuilderRequestPlan,
  BuilderTideWindowInput,
  DiveMode,
} from "./builder-types";

/**
 * **What the add panel holds while a departure is being written** — the
 * disclosure, the controlled selects, the two facts both depths share, the
 * tide line and the weekday pattern (`AddPanel` draws them). One hook, so the
 * panel's view reads as markup and its state reads as rules.
 */
export function useAddPanel({
  locale,
  addDraft,
  loadPattern,
  loadTideWindow,
  dateIso,
  options,
  initialCourse,
  initialSite,
  requestPlan,
  startExpanded,
}: {
  locale: string;
  addDraft: FormDraftProps["draft"];
  loadPattern?: (dateIso: string) => Promise<BuilderPattern | null>;
  loadTideWindow?: (input: BuilderTideWindowInput) => Promise<string | null>;
  dateIso: string;
  options: BuilderOptions | null;
  initialCourse: BuilderInitialCourse | null;
  initialSite?: BuilderInitialSite | null;
  requestPlan?: BuilderRequestPlan | null;
  startExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(startExpanded);
  // Controlled, unlike every other select here: the catalogue arrives on its own
  // fetch, so an uncontrolled preselection from `?course=` would be reconciled
  // away the moment the real options replaced the stand-in row below.
  const [courseId, setCourseId] = useState(initialCourse?.id ?? "");

  // **What this shop actually runs, in the order the select offers it.** Boat
  // is no longer assumed: a shore-and-pool operation must not be able to put a
  // departure on a hull it has told us it does not have, and its form should
  // open on the mode it does run rather than on one it has to change away from
  // every time. `options` is undefined until the board's lazy fetch lands, and
  // boat-only is the right stand-in for that beat because it is the default a
  // fresh shop carries.
  const offeredModes: DiveMode[] = useMemo(
    () =>
      options
        ? ([
            options.hasBoatDiving ? "boat" : null,
            options.hasShoreDiving ? "shore" : null,
            options.hasPoolDiving ? "pool" : null,
          ].filter(Boolean) as DiveMode[])
        : ["boat"],
    [options],
  );
  const defaultMode: DiveMode = offeredModes[0] ?? "boat";
  const [diveMode, setDiveMode] = useState<DiveMode>(defaultMode);
  // The options arrive after first paint, so a shop whose first offered mode is
  // not `boat` would otherwise sit on a stale default until somebody touched
  // the select — and submit `boat` if they never did.
  useEffect(() => {
    setDiveMode((current) => (offeredModes.includes(current) ? current : defaultMode));
  }, [offeredModes, defaultMode]);
  const [selectedBoatId, setSelectedBoatId] = useState<string>("");
  const [capacity, setCapacity] = useState<number>(requestPlan?.suggestedCapacity ?? 12);

  /**
   * The two facts both depths ask for, held here so the disclosure can never
   * eat them: collapsed they are the "Dives" box and the "Dive site" select,
   * expanded they are the dive plan's own count and dive one's site. State in
   * the panel, not in either control, is what lets a staff member type 3 dives,
   * open More options, and still be scheduling three dives.
   */
  const [plannedDives, setPlannedDives] = useState(2);
  const [diveSiteId, setDiveSiteId] = useState(initialSite?.id ?? "");
  /**
   * The dive plan is mounted from the first expansion onward and only hidden
   * afterwards — never unmounted, because React drops an unmounted subtree's
   * state and those are typed dive briefings. Seeded once, from whatever the
   * quick row held at that moment; later toggles must not re-seed it or they
   * would overwrite the cards with the quick row again.
   */
  const [diveSeed, setDiveSeed] = useState<{ count: number; siteId: string } | null>(
    startExpanded || initialSite ? { count: 2, siteId: initialSite?.id ?? "" } : null,
  );
  const toggleExpanded = () => {
    setExpanded((current) => {
      if (!current && diveSeed === null) setDiveSeed({ count: plannedDives, siteId: diveSiteId });
      return !current;
    });
  };
  /** The departure's date, mirrored so the repeat fieldset can seed its weekday. */
  const [startDate, setStartDate] = useState(dateIso);

  /**
   * **The tide at the chosen site**, one line under the site select (ADR
   * 20260907-noaa-tide-predictions): that select's own description, and dive
   * one's once the form is expanded, so it is set and read the way every
   * field's description is (K-337). Asked of the server the moment a site
   * is picked and again whenever the form's own "when" changes — the date is
   * state, but the time and mode are uncontrolled boxes, so the form's
   * `change` event is what re-asks. The answer is already a sentence in the
   * reader's language; null is the ordinary case and renders nothing.
   */
  const [tideLine, setTideLine] = useState<string | null>(null);
  /** The quick row's site select: always mounted, so the effect reaches the form through it. */
  const tideAnchor = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (!loadTideWindow || !diveSiteId) {
      setTideLine(null);
      return;
    }
    const form = tideAnchor.current?.form ?? null;
    let live = true;
    // Typing a time fires `change` per keystroke-committed box, so two asks
    // can be in flight at once and the network decides which lands last.
    // Only the newest one may write, or a stale answer overwrites the fresh.
    let latest = 0;
    const ask = () => {
      const fields = form ? new FormData(form) : null;
      latest += 1;
      const asked = latest;
      void loadTideWindow({
        diveSiteId,
        date: startDate,
        startTime: String(fields?.get("startTime") ?? ""),
        diveMode: String(fields?.get("diveMode") ?? "boat"),
      }).then(
        (line) => {
          if (live && asked === latest) setTideLine(line);
        },
        () => {
          if (live && asked === latest) setTideLine(null);
        },
      );
    };
    ask();
    form?.addEventListener("change", ask);
    return () => {
      live = false;
      form?.removeEventListener("change", ask);
    };
  }, [loadTideWindow, diveSiteId, startDate]);

  /**
   * **The add panel already knows the weekday** (ADR 20260906-before-you-ask,
   * decision 3). A panel opened plainly — no draft to pick up, no course, site
   * or request that brought it here — asks what this weekday usually is and
   * fills its own fields from the answer once the option lists it needs are
   * on screen, the way a keystroke would. One line says so, with "start blank"
   * as the one act; the crew come as chips that can be taken off; a second
   * departure most of those days carried is one row, ticked on to add.
   *
   * Read once, for the day the panel opened on: a date changed afterwards is
   * the desk's own edit, and the pattern never writes over an edit.
   */
  // The form is `FieldGrid as="form"`, which takes no ref; the anchor below is
  // its first child, and `closest("form")` is the form.
  const patternAnchor = useRef<HTMLSpanElement>(null);
  const ownForm = () => patternAnchor.current?.closest("form") ?? null;
  const plain = addDraft === null && !initialCourse && !initialSite && !requestPlan;
  const [pattern, setPattern] = useState<BuilderPattern | null>(null);
  const [patternApplied, setPatternApplied] = useState(false);
  /** The trip tag, controlled so "Start blank" can reset it. */
  const [lensId, setLensId] = useState("");
  const [crew, setCrew] = useState<BuilderPattern["crew"]>([]);
  useEffect(() => {
    if (!plain || !loadPattern) return;
    let live = true;
    void loadPattern(dateIso).then((found) => {
      if (live && found) setPattern(found);
    });
    return () => {
      live = false;
    };
  }, [plain, loadPattern, dateIso]);
  useEffect(() => {
    const element = patternAnchor.current?.closest("form");
    if (!pattern || patternApplied || !options || !element) return;
    applyFormFields(element, pattern.fields);
    setCrew(pattern.crew);
    setPatternApplied(true);
  }, [pattern, patternApplied, options]);
  const startBlank = () => {
    const element = ownForm();
    if (element) {
      applyFormFields(element, {
        ...Object.fromEntries(Object.keys(pattern?.fields ?? {}).map((name) => [name, ""])),
        startTime: "08:30",
        endTime: "12:30",
        capacity: "12",
        diveMode: offeredModes[0] ?? "boat",
      });
    }
    setCrew([]);
    setPattern(null);
    setLensId("");
  };
  const crewNames = cachedListFormat(locale, { style: "long", type: "conjunction" }).format(
    crew.map((member) => member.name),
  );

  return {
    expanded,
    courseId,
    setCourseId,
    offeredModes,
    diveMode,
    setDiveMode,
    selectedBoatId,
    setSelectedBoatId,
    capacity,
    setCapacity,
    plannedDives,
    setPlannedDives,
    diveSiteId,
    setDiveSiteId,
    diveSeed,
    toggleExpanded,
    startDate,
    setStartDate,
    tideLine,
    tideAnchor,
    patternAnchor,
    pattern,
    patternApplied,
    lensId,
    setLensId,
    crew,
    setCrew,
    startBlank,
    crewNames,
  };
}
