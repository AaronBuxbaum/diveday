import { expect, READ_ONLY, test } from "./fixtures";

function instant(event: string, field: string): Date {
  const value = new RegExp(`${field}:(\\d{4})(\\d{2})(\\d{2})T(\\d{2})(\\d{2})(\\d{2})Z`).exec(
    event,
  );
  if (!value) throw new Error(`Missing ${field}`);
  return new Date(`${value[1]}-${value[2]}-${value[3]}T${value[4]}:${value[5]}:${value[6]}Z`);
}

for (const course of [
  {
    title: "Open Water Diver — three-day course",
    slug: "open-water-diver",
    hours: [
      [8, 17],
      [8, 17],
      [8, 16],
    ],
  },
  { title: "Discover Scuba — Pool & Reef", slug: "discover-scuba-diving", hours: [[14, 17]] },
]) {
  test(`downloads accurate course meetings: ${course.title}`, { tag: READ_ONLY }, async ({
    page,
  }) => {
    await page.goto(`/s/blue-mantis/courses/${course.slug}`);
    await page.getByRole("link", { name: "Book this date", exact: true }).first().click();
    await expect(page).toHaveURL(/\/trips\/[0-9a-f-]{36}/);
    await expect(page.getByRole("heading", { name: course.title, exact: true })).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "Add to calendar" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("blue-mantis-trip.ics");
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const file = Buffer.concat(chunks).toString("utf8");
    await test.info().attach("course-calendar.ics", { body: file, contentType: "text/calendar" });
    const events = file.split("BEGIN:VEVENT").slice(1);
    expect(events).toHaveLength(course.hours.length);
    const clock = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      hourCycle: "h23",
    });
    for (const [index, event] of events.entries()) {
      const [startHour, endHour] = course.hours[index];
      const startsAt = instant(event, "DTSTART");
      const endsAt = instant(event, "DTEND");
      expect(clock.format(startsAt)).toBe(`${String(startHour).padStart(2, "0")}:00`);
      expect(clock.format(endsAt)).toBe(`${endHour}:00`);
      expect(endsAt.getTime() - startsAt.getTime()).toBe((endHour - startHour) * 3_600_000);
      if (index > 0)
        expect(startsAt.getTime()).toBeGreaterThan(instant(events[index - 1], "DTEND").getTime());
    }
    expect(file).toMatch(/confined water/i);
    expect(file).not.toMatch(/Dock call|We leave|LOCATION:/);
  });
}
