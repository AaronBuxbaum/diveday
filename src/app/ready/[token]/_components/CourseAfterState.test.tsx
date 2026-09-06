// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DiverMessageKey, DiverTranslator } from "@/i18n/messages";
import { CourseAfterState } from "./CourseAfterState";

afterEach(cleanup);

/** Keys and their interpolations, so an assertion can read what was said. */
const t = ((key: DiverMessageKey, params?: Record<string, unknown>) =>
  params ? `${key}(${Object.values(params).join(",")})` : key) as unknown as DiverTranslator;

/**
 * **The overclaim guard, as a test** (issues #1196, #1205).
 *
 * The one failure this feature could produce is a recap implying a
 * certification nobody issued. The reader hands over `certification` only for a
 * card this shop issued from this departure and marked verified; everything
 * else arrives null, and what renders then must name no level at all.
 */
describe("CourseAfterState", () => {
  it("says plainly that nothing was recorded, and names no level", () => {
    const { container } = render(
      <CourseAfterState
        t={t}
        courseTitle="Advanced Open Water Diver"
        shopName="Blue Mantis Divers"
        certification={null}
        nextStep={null}
      />,
    );
    expect(
      screen.getByText(
        "recap.course.notYetCertified(Advanced Open Water Diver,Blue Mantis Divers)",
      ),
    ).toBeInTheDocument();
    // Not "no certified sentence": no level word anywhere in the output, so a
    // future edit cannot smuggle one in beside the honest sentence.
    expect(container.textContent).not.toContain("certificationLevels");
    expect(container.textContent).not.toContain("recap.course.certified");
  });

  it("names the recorded level exactly once when the shop issued one", () => {
    const { container } = render(
      <CourseAfterState
        t={t}
        courseTitle="Advanced Open Water Diver"
        shopName="Blue Mantis Divers"
        certification={{ level: "advanced_open_water" }}
        nextStep={null}
      />,
    );
    const said = container.textContent ?? "";
    expect(said).toContain("recap.course.certified(Blue Mantis Divers,");
    expect(said).toContain("course.certificationLevels.advancedOpenWater");
    expect(said.split("course.certificationLevels.advancedOpenWater")).toHaveLength(2);
    expect(said).not.toContain("recap.course.notYetCertified");
  });

  it("renders no label and no empty quote when the instructor wrote nothing", () => {
    const { container } = render(
      <CourseAfterState
        t={t}
        courseTitle="Advanced Open Water Diver"
        shopName="Blue Mantis Divers"
        certification={null}
        nextStep={null}
      />,
    );
    expect(container.querySelector("figure")).toBeNull();
    expect(container.textContent).not.toContain("recap.course.nextStepBy");
    expect(container.textContent).not.toContain("recap.course.nextStepQuote");
  });

  it("prints the instructor's own words under their name", () => {
    render(
      <CourseAfterState
        t={t}
        courseTitle="Advanced Open Water Diver"
        shopName="Blue Mantis Divers"
        certification={null}
        nextStep={{ words: "Book your deep dive before the card arrives.", byName: "Keiko Tanaka" }}
      />,
    );
    expect(
      screen.getByText("recap.course.nextStepQuote(Book your deep dive before the card arrives.)"),
    ).toBeInTheDocument();
    expect(screen.getByText("recap.course.nextStepBy(Keiko Tanaka)")).toBeInTheDocument();
  });
});
