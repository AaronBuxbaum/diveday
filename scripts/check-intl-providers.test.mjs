import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ERROR_BOUNDARIES_WITH_COPY,
  providedNamespaces,
  providerProblems,
  requiredNamespaces,
} from "./check-intl-providers.mjs";

async function fixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), "intl-composition-"));
  const baseline = {
    "src/components/BookingPartyFields.tsx": '"use client"; const t = useTranslations("party");',
    "src/app/booking/page.tsx":
      'import { BookingPartyFields } from "@/components/BookingPartyFields"; export default function Page() { return <DiverIntlProvider namespaces={["party"]}><BookingPartyFields /></DiverIntlProvider>; }',
    ...Object.fromEntries(
      ERROR_BOUNDARIES_WITH_COPY.map((file) => [
        `src/app/${file}`,
        '"use client"; const t = useTranslations("errorBoundary"); <ErrorBoundaryIntlProvider />;',
      ]),
    ),
  };
  for (const [file, source] of Object.entries({ ...baseline, ...files })) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), source);
  }
  return root;
}

const COMPOSED_TRIP = {
  "src/app/trip/page.tsx":
    'import { TripDetail } from "./TripDetail"; export default function Page() { return <TripDetail />; }',
  "src/app/trip/TripDetail.tsx":
    'import { TripPrices } from "./TripPrices"; export function TripDetail() { return <DiverIntlProvider namespaces={["trip"]}><TripPrices /></DiverIntlProvider>; }',
  "src/app/trip/TripPrices.tsx":
    '"use client"; export function TripPrices() { const t = useTranslations("trip"); return <span>{t("price")}</span>; }',
};

describe("providedNamespaces", () => {
  it("reads an inline list, a module-scope list, and the error boundary's one", () => {
    expect([...providedNamespaces('<DiverIntlProvider namespaces={["party", "trip"]}>')]).toEqual([
      "words",
      "party",
      "trip",
    ]);
    expect([
      ...providedNamespaces('const PAGE = ["ready"];\n<DiverIntlProvider namespaces={PAGE}>'),
    ]).toEqual(["words", "ready"]);
    expect([...providedNamespaces("<ErrorBoundaryIntlProvider>")]).toEqual(["errorBoundary"]);
    expect(providedNamespaces("<div />")).toBeNull();
  });
});

describe("requiredNamespaces", () => {
  it("reads a named namespace, and a bare call's key heads", () => {
    expect([...requiredNamespaces('useTranslations("party")')]).toEqual(["party"]);
    expect([...requiredNamespaces('const t = useTranslations();\nt("trip.title")')]).toEqual([
      "trip",
    ]);
  });
});

describe("shared server provider composition", () => {
  it("follows a rendered server composition instead of requiring the provider in page.tsx", async () => {
    const root = await fixture(COMPOSED_TRIP);
    expect((await providerProblems(root)).problems).toEqual([]);
  });

  it("still requires every namespace on that composition", async () => {
    const root = await fixture({
      ...COMPOSED_TRIP,
      "src/app/trip/TripDetail.tsx": COMPOSED_TRIP["src/app/trip/TripDetail.tsx"].replace(
        '["trip"]',
        '["booking"]',
      ),
    });
    expect((await providerProblems(root)).problems).toContainEqual(
      expect.stringContaining("provider is missing namespace(s) trip"),
    );
  });

  it("does not borrow a provider from an unrelated component in the directory", async () => {
    const root = await fixture({
      ...COMPOSED_TRIP,
      "src/app/trip/TripDetail.tsx":
        'export function TripDetail() { return <DiverIntlProvider namespaces={["trip"]}><span /></DiverIntlProvider>; }',
      "src/app/trip/page.tsx":
        'import { TripPrices } from "./TripPrices"; export default function Page() { return <TripPrices />; }',
    });
    expect((await providerProblems(root)).problems).toContainEqual(
      expect.stringContaining("no diver copy provider"),
    );
  });

  it("checks a second route that renders the same consumer without the composition", async () => {
    const root = await fixture({
      ...COMPOSED_TRIP,
      "src/app/embed/page.tsx":
        'import { TripPrices } from "../trip/TripPrices"; export default function Page() { return <TripPrices />; }',
    });
    expect((await providerProblems(root)).problems).toContainEqual(
      expect.stringContaining("no diver copy provider"),
    );
  });

  it("does not count a provider when the imported consumer renders outside it", async () => {
    const root = await fixture({
      ...COMPOSED_TRIP,
      "src/app/trip/TripDetail.tsx":
        'import { TripPrices } from "./TripPrices"; export function TripDetail() { return <><DiverIntlProvider namespaces={["trip"]}><span /></DiverIntlProvider><TripPrices /></>; }',
    });
    expect((await providerProblems(root)).problems).toContainEqual(
      expect.stringContaining("no diver copy provider"),
    );
  });

  it("recognizes a rendered server shell whose provider wraps children", async () => {
    const root = await fixture({
      ...COMPOSED_TRIP,
      "src/app/trip/page.tsx":
        'import { TripPrices } from "./TripPrices"; import { TripShell } from "./TripShell"; export default function Page() { return <TripShell><TripPrices /></TripShell>; }',
      "src/app/trip/TripShell.tsx":
        'export function TripShell({ children }) { return <DiverIntlProvider namespaces={["trip"]}>{children}</DiverIntlProvider>; }',
      "src/app/trip/TripDetail.tsx": "export const unused = true;",
    });
    expect((await providerProblems(root)).problems).toEqual([]);
  });
});

describe("the app as it stands", () => {
  it("gives every client consumer of diver copy a provider carrying its namespaces", async () => {
    const { problems, consumers } = await providerProblems();
    expect(problems).toEqual([]);
    expect(consumers).toBeGreaterThan(5);
  });
});
