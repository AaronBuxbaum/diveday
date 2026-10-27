import { describe, expect, it } from "vitest";
import { diverStateEmail } from "./diver-state-email";

/** Intl's narrow and non-breaking spaces, as plain ones, for reading a body as a person would. */
const flat = (text: string) => text.replace(/[\u00a0\u202f]/g, " ");

describe("diverStateEmail: week_out and tonight (the reminders)", () => {
  const base = {
    locale: "en-US" as const,
    shopName: "Blue Mantis",
    tripTitle: "Two-Tank Reef",
    startsAt: new Date("2026-08-01T13:00:00.000Z"),
    timezone: "America/New_York",
    open: 0,
    readinessUrl: "https://diveday.test/ready/abc.def",
  };

  const night = new Date("2026-07-31T22:00:00.000Z");

  it("week_out is the state in the subject, one sentence, the link and the shop's line", () => {
    const email = diverStateEmail({ ...base, state: "week_out" });
    expect(email.subject).toBe("You sail this week: Two-Tank Reef");
    expect(flat(email.text)).toBe(
      [
        "Two-Tank Reef sails Aug 1, 9:00 AM EDT.",
        "",
        "See what’s left before you sail:",
        "https://diveday.test/ready/abc.def",
        // The shop's sign-off is added for every shop email in `render.ts`
        // (`withShopSignOff`, B31).
        "",
      ].join("\n"),
    );
    expect(email.html).toContain('href="https://diveday.test/ready/abc.def"');
  });

  it("tonight names the dock call time, not the departure", () => {
    const email = diverStateEmail({ ...base, state: "tonight", now: night, dockCallMinutes: 45 });
    expect(flat(email.text)).toContain("be at the dock by 8:15 AM EDT.");
  });

  it("says today, not tomorrow, once the send is held to the morning of the trip", () => {
    const morning = new Date("2026-08-01T12:01:00.000Z");
    const email = diverStateEmail({ ...base, state: "tonight", now: morning, dockCallMinutes: 30 });
    expect(email.subject).toBe("You sail today: Two-Tank Reef");
    expect(flat(email.text)).toContain("sails today; be at the dock by 8:30 AM EDT.");
    expect(email.text).not.toContain("tomorrow");
    // The shop's calendar day decides, not UTC: 01:00 UTC is still the night before in New York.
    const late = diverStateEmail({
      ...base,
      state: "tonight",
      now: new Date("2026-08-01T03:00:00.000Z"),
    });
    expect(late.subject).toBe("You sail tomorrow: Two-Tank Reef");
  });

  it("gives a medical review its own sentence instead of a count", () => {
    const email = diverStateEmail({ ...base, state: "week_out", medicalReview: true, open: 2 });
    expect(flat(email.text)).toContain(
      "and a doctor must sign off your medical answers before you dive.",
    );
    expect(email.text).not.toContain("left to finish");
    const es = diverStateEmail({
      ...base,
      locale: "es-ES",
      state: "week_out",
      medicalReview: true,
    });
    expect(es.text).toContain("un médico debe aprobar");
  });

  it("tonight names the hour and carries none of the old brief", () => {
    const email = diverStateEmail({ ...base, state: "tonight", now: night });
    expect(email.subject).toBe("You sail tomorrow: Two-Tank Reef");
    expect(flat(email.text)).toContain(
      "Two-Tank Reef sails tomorrow; be at the dock by 9:00 AM EDT.",
    );
    for (const gone of ["Conditions", "What to bring", "Text us", "First boat dive"]) {
      expect(email.text).not.toContain(gone);
    }
  });

  it("says what is left in the same sentence, singular and plural", () => {
    const one = diverStateEmail({ ...base, state: "week_out", open: 1 });
    expect(flat(one.text)).toContain("9:00 AM EDT, and 1 thing is left to finish.");
    const two = diverStateEmail({ ...base, state: "tonight", open: 2, now: night });
    expect(two.text).toContain("and 2 things are left to finish.");
    expect(two.text.split(". ").length).toBe(1);
  });

  it("says a course starts, not sails", () => {
    const week = diverStateEmail({ ...base, state: "week_out", courseSession: true });
    expect(week.subject).toBe("Your course starts this week: Two-Tank Reef");
    expect(flat(week.text)).toContain("starts Aug 1");
    expect(week.text).not.toContain("sails");
    const tonight = diverStateEmail({ ...base, state: "tonight", courseSession: true, now: night });
    expect(tonight.subject).toBe("Your course starts tomorrow: Two-Tank Reef");
  });

  it("keeps the reply line a fact of the channel, under the link", () => {
    const on = diverStateEmail({ ...base, state: "tonight", replyKeywords: true });
    expect(on.text).toContain("Reply C to cancel your seat");
    expect(on.text.indexOf("Blue Mantis\n")).toBeLessThan(on.text.indexOf("Reply C"));
    expect(diverStateEmail({ ...base, state: "tonight" }).text).not.toContain("Reply C");
  });

  it("escapes the shop's words in the html", () => {
    const email = diverStateEmail({
      ...base,
      state: "week_out",
      shopName: "<b>Mantis</b>",
      tripTitle: "<i>Reef</i>",
    });
    expect(email.html).not.toContain("<b>Mantis</b>");
    expect(email.html).not.toContain("<i>Reef</i>");
  });

  it("is Spanish for a Spanish reader, with the same single sentence", () => {
    const week = diverStateEmail({ ...base, state: "week_out", locale: "es-ES", open: 2 });
    expect(week.subject).toBe("Sales esta semana: Two-Tank Reef");
    expect(week.text).toContain("y te quedan 2 cosas por resolver.");
    const tonight = diverStateEmail({ ...base, state: "tonight", locale: "es-ES", now: night });
    expect(tonight.subject).toBe("Sales mañana: Two-Tank Reef");
    expect(tonight.text).toContain("sale mañana; preséntate en el muelle a las");
  });

  // Ux-delight sheet 2026-10-22, item 1 (H-150): the rule in hours, never a clock time.
  it("says the fly-safe rule in hours under the dock time, the night before a last boat", () => {
    const email = diverStateEmail({
      ...base,
      state: "tonight",
      now: night,
      dockCallMinutes: 30,
      flySafeHours: 24,
    });
    const lines = flat(email.text).split("\n");
    expect(lines.slice(0, 3)).toEqual([
      "Two-Tank Reef sails tomorrow; be at the dock by 8:30 AM EDT.",
      "",
      "Plan to fly no earlier than 24 hours after your last dive, and longer if you make decompression stops.",
    ]);
    expect(email.html).toContain(
      "<p>Plan to fly no earlier than 24 hours after your last dive, and longer if you make decompression stops.</p>",
    );
    expect(email.html.indexOf("Plan to fly")).toBeLessThan(email.html.indexOf("href="));
    // Hours only: no clock time rides on the line.
    expect(lines[2]).not.toMatch(/\d:\d\d/);
    const spanish = diverStateEmail({
      ...base,
      state: "tonight",
      locale: "es-ES",
      now: night,
      flySafeHours: 18,
    });
    expect(spanish.text).toContain(
      "Planea volar como mínimo 18 horas después de tu última inmersión, y más si haces paradas de descompresión.",
    );
  });

  it("renders crew guidance in both languages when the previous figure cannot be verified", () => {
    const english = diverStateEmail({
      ...base,
      state: "tonight",
      now: night,
      flySafeAskCrew: true,
    });
    expect(english.text).toContain("Ask the crew how long to wait before flying.");
    expect(english.html).toContain("Ask the crew how long to wait before flying.");
    const spanish = diverStateEmail({
      ...base,
      state: "tonight",
      locale: "es-ES",
      now: night,
      flySafeAskCrew: true,
    });
    expect(spanish.text).toContain(
      "Consulta con la tripulación cuánto tiempo debes esperar antes de volar.",
    );
  });

  it("says nothing about flying without the hours, or on the week-out nudge", () => {
    const tonight = diverStateEmail({ ...base, state: "tonight", now: night, dockCallMinutes: 30 });
    expect(tonight.text).not.toMatch(/fly/i);
    const week = diverStateEmail({ ...base, state: "week_out", flySafeHours: 24 });
    expect(week.text).not.toMatch(/fly/i);
    expect(week.html).not.toMatch(/fly/i);
  });

  it("omits the link block when the thread link could not be minted", () => {
    const email = diverStateEmail({ ...base, state: "week_out", readinessUrl: undefined });
    expect(email.text).not.toContain("See what’s left");
    expect(email.html).not.toContain("<a ");
  });
});

describe("diverStateEmail: home (the recap)", () => {
  const recapBase = {
    state: "home" as const,
    locale: "en-US" as const,
    shopName: "Blue Mantis",
    tripTitle: "Two-Tank Reef",
    startsAt: new Date("2026-08-01T13:00:00.000Z"),
    timezone: "America/New_York",
    recapUrl: "https://diveday.test/recap/abc.def",
    unsubscribeUrl: "https://diveday.test/unsubscribe/xyz",
  };

  it("is the state in the subject, one sentence, the link and the shop's line", () => {
    const email = diverStateEmail(recapBase);
    expect(email.subject).toBe("Your dive with Blue Mantis: Two-Tank Reef");
    expect(flat(email.text)).toBe(
      [
        "Thanks for diving Two-Tank Reef with us on Sat, Aug 1.",
        "",
        "See the recap of your day:",
        "https://diveday.test/recap/abc.def",
        "",
        "Stop optional emails from Blue Mantis:",
        "https://diveday.test/unsubscribe/xyz",
        "",
      ].join("\n"),
    );
    expect(email.html).toContain('href="https://diveday.test/recap/abc.def"');
    expect(email.html).toContain('href="https://diveday.test/unsubscribe/xyz"');
    // The sites, the packing advice and the buddy line live on the thread.
    expect(email.text).not.toContain("bring a buddy");
  });

  it("says nothing about flying without a fly-safe result", () => {
    // No result, no sentence: the recap says nothing about flying rather than
    // guessing an interval from a record that could not say.
    expect(diverStateEmail(recapBase).text).not.toContain("before flying");
  });

  it("is the fly-safe sentence alone when there is one, so the recap is still one sentence", () => {
    const email = diverStateEmail({
      ...recapBase,
      flySafe: {
        from: new Date("2026-08-02T14:10:00.000Z"),
        hours: 24,
        anchor: "last_dive",
        reason: "one_dive",
      },
    });
    expect(email.text).not.toContain("Thanks for diving");
    expect(email.text.match(/before flying/g)).toHaveLength(1);
  });

  // The sentence is the shop asking, not the product announcing. An
  // unattributed "Earliest flight 10:10" followed by an attributed reason read
  // as a fact and then its justification, which handed the authority to the
  // time; naming the shop in the lead-in puts it where the claim is made. Two
  // more words carry two claims the code can support: "at least", because DAN
  // publishes consensus *minimums* and longer is safer, and "with us", because
  // the only dives DiveDay can see are the ones booked at this shop. The tail
  // is untouched: it attributes the figure to the shop and the practice to
  // DAN, which is the claim the code can support.
  it("carries the earliest-flight line in the shop's zone, worded off the last dive or the scheduled end", () => {
    // 2026-08-02T14:10Z is a Sunday, 10:10 AM in Key Largo.
    const from = new Date("2026-08-02T14:10:00.000Z");
    const afterDive = diverStateEmail({
      ...recapBase,
      flySafe: { from, hours: 24, anchor: "last_dive", reason: "dives_recorded" },
    });
    expect(afterDive.text).toContain(
      "We ask you to wait at least until Sunday\u00A010:10\u00A0AM before flying: 24 hours after your last dive with us, following DAN’s guidance.",
    );
    expect(afterDive.html).toContain("wait at least until Sunday\u00A010:10\u00A0AM before flying");

    const afterReturn = diverStateEmail({
      ...recapBase,
      flySafe: { from, hours: 18, anchor: "scheduled_return", reason: "one_dive" },
    });
    expect(afterReturn.text).toContain("18 hours after the day was due to end");

    const spanish = diverStateEmail({
      ...recapBase,
      locale: "es-ES",
      flySafe: { from, hours: 24, anchor: "last_dive", reason: "dives_recorded" },
    });
    expect(spanish.text).toContain(
      "Te pedimos esperar al menos hasta el domingo, 10:10 antes de volar: 24 horas después de tu última inmersión con nosotros, siguiendo las recomendaciones de DAN.",
    );
  });

  // The earlier-day route (issue #1439) reaches two more keys, one per anchor,
  // and nothing else in this file renders them — a lead-in swap applied to the
  // plain pair and missed on these two would ship a recap whose voice depended
  // on whether the diver had dived the day before (issue #1433). What the
  // clause states is the fact the lookback actually establishes: a dive day on
  // this shop's own record inside two local days. It said "this was not your
  // first day diving", which is true of every certified diver alive and reads
  // as a remark about experience rather than about this week.
  it("says an earlier dive day is why the wait is longer, in both anchors and both locales", () => {
    const from = new Date("2026-08-02T14:10:00.000Z");
    const afterDive = diverStateEmail({
      ...recapBase,
      flySafe: { from, hours: 24, anchor: "last_dive", reason: "earlier_day" },
    });
    expect(afterDive.text).toContain(
      "We ask you to wait at least until Sunday\u00A010:10\u00A0AM before flying: our records show another dive day in the last two days, so 24 hours after your last dive with us, following DAN’s guidance.",
    );

    const afterReturn = diverStateEmail({
      ...recapBase,
      flySafe: { from, hours: 24, anchor: "scheduled_return", reason: "earlier_day" },
    });
    expect(afterReturn.text).toContain(
      "We ask you to wait at least until Sunday\u00A010:10\u00A0AM before flying: our records show another dive day in the last two days, so 24 hours after the day was due to end, following DAN’s guidance.",
    );

    const spanish = diverStateEmail({
      ...recapBase,
      locale: "es-ES",
      flySafe: { from, hours: 24, anchor: "last_dive", reason: "earlier_day" },
    });
    expect(spanish.text).toContain(
      "nuestros registros muestran otro día de buceo en los últimos dos días",
    );
  });

  // The planned-dives route (the one the page cannot help with either: the
  // recap card carries no dive count, and this email carries no record at
  // all). The wait comes from what the shop planned, which is by construction
  // more than the crew logged and may be more than the diver dived, so a diver
  // who made one dive reads the two-dive figure while packing with nothing to
  // account for it — and a number a diver decides is a bug is a number they
  // ignore. One key, because the route only exists when the record is short of
  // its plan, which is what puts the anchor on the return.
  it("says a multi-dive plan is why the wait is longer, in both locales", () => {
    const from = new Date("2026-08-02T14:10:00.000Z");
    const planned = diverStateEmail({
      ...recapBase,
      flySafe: { from, hours: 24, anchor: "scheduled_return", reason: "dives_planned" },
    });
    expect(planned.text).toContain(
      "We ask you to wait at least until Sunday\u00A010:10\u00A0AM before flying: we planned more than one dive, so 24 hours after the day was due to end, following DAN’s guidance.",
    );
    // It may not claim the dive it cannot see: the crew logged at most one.
    expect(planned.text).not.toContain("your last dive with us");

    const spanish = diverStateEmail({
      ...recapBase,
      locale: "es-ES",
      flySafe: { from, hours: 24, anchor: "scheduled_return", reason: "dives_planned" },
    });
    expect(spanish.text).toContain(
      "planificamos más de una inmersión, así que 24 horas después del final previsto del día",
    );
  });

  // Three claims the sentence may not make, pinned across every shape it takes
  // and both locales rather than in the one wording above, because each of
  // them came back once already. It may not call the interval a flight the
  // shop can see ("Earliest flight", "Primer vuelo posible"), it may not state
  // the wait without the minimum DAN attaches to it, and it may not describe
  // as *your* last dive a dive it only knows because it was booked here.
  it("never states the interval as a flight, an unhedged wait, or a dive it cannot see", () => {
    const from = new Date("2026-08-02T14:10:00.000Z");
    for (const locale of ["en-US", "es-ES"] as const) {
      for (const anchor of ["last_dive", "scheduled_return"] as const) {
        for (const reason of ["dives_recorded", "earlier_day", "dives_planned"] as const) {
          const { text } = diverStateEmail({
            ...recapBase,
            locale,
            flySafe: { from, hours: 24, anchor, reason },
          });
          const where = `${locale} ${anchor} ${reason}`;
          expect(text, where).toContain(locale === "en-US" ? "at least until" : "al menos hasta");
          expect(text, where).not.toContain("Earliest flight");
          expect(text, where).not.toContain("vuelo posible");
          if (anchor === "last_dive") {
            expect(text, where).toContain(
              locale === "en-US" ? "your last dive with us" : "tu última inmersión con nosotros",
            );
          }
        }
      }
    }
  });
});

describe("diverStateEmail: fly_safe_correction (#2927)", () => {
  const base = {
    locale: "en-US" as const,
    shopName: "Blue Mantis",
    tripTitle: "Two-Tank Reef",
    startsAt: new Date("2026-08-01T13:00:00.000Z"),
    timezone: "America/New_York",
    state: "fly_safe_correction" as const,
  };

  it("says the figure no longer applies and to ask the crew, in one sentence and no figure", () => {
    const email = diverStateEmail(base);
    expect(email.subject).toBe("An update to your flying guidance");
    expect(email.text).toBe(
      [
        "The flying interval in our earlier reminder may no longer apply. Ask the crew how long to wait before you fly.",
        "",
      ].join("\n"),
    );
    // No new number to hold instead: DAN gives none for a dive with stops (H-84).
    expect(email.text).not.toMatch(/\d+ hours?/);
    expect(email.html).not.toContain("<a ");
  });

  it("speaks the diver's language and escapes the shop's words", () => {
    const es = diverStateEmail({ ...base, locale: "es-ES", tripTitle: "Arrecife <dos>" });
    expect(es.subject).toBe("Una actualización sobre cuándo puedes volar");
    expect(es.text).toContain("Pregúntale a la tripulación cuánto esperar antes de volar.");
    expect(es.html).not.toContain("Arrecife");
    expect(es.html).not.toContain("<dos>");
  });
});
