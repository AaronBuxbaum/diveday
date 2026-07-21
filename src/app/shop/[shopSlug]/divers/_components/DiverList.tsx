"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { controlClass } from "@/components/ui/form";
import type { listDiverSummaries } from "@/db/divers";

type DiverSummary = Awaited<ReturnType<typeof listDiverSummaries>>[number];

function initials(fullName: string): string {
  return fullName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/**
 * The divers list filters live: the page already holds every row client-side,
 * so a submit button and a round trip were pure friction. Search by name,
 * email, or phone as you type.
 */
export function DiverList({ divers, shopSlug }: { divers: DiverSummary[]; shopSlug: string }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      q
        ? divers.filter((diver) =>
            [diver.person.fullName, diver.person.email, diver.person.phone]
              .filter(Boolean)
              .some((value) => value?.toLowerCase().includes(q)),
          )
        : divers,
    [divers, q],
  );

  return (
    <section className="mt-10" aria-labelledby="diver-list-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="diver-list-heading" className="text-lg font-semibold">
            People
          </h2>
          <p className="mt-1 text-sm text-muted">
            {q ? `${visible.length} of ${divers.length} shown` : "Search by name, email, or phone."}
          </p>
        </div>
        <div className="w-full sm:w-80">
          <label className="sr-only" htmlFor="diver-search">
            Search divers
          </label>
          <input
            id="diver-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search people"
            className={`${controlClass} min-w-0`}
          />
        </div>
      </div>
      {visible.length === 0 ? (
        <EmptyState className="mt-4">
          <p className="font-medium">{q ? "No matching divers." : "No divers on file yet."}</p>
          <p className="mt-1 text-sm text-muted">
            {q
              ? "Try a different search or add a new diver above."
              : "Add one here or accept a booking to create their person record."}
          </p>
        </EmptyState>
      ) : (
        <>
          {/* Phone: stacked cards, so nothing hides behind a sideways scroll. */}
          <ul className="mt-4 space-y-3 sm:hidden">
            {visible.map((diver) => {
              const cards =
                diver.certificationCount + diver.specialtyCount + diver.nitroxCertificationCount;
              const pending = diver.pendingCertificationCount + diver.pendingSpecialtyOrNitroxCount;
              return (
                <li key={diver.person.id}>
                  <Link
                    href={`/shop/${shopSlug}/divers/${diver.person.id}`}
                    className="block rounded-2xl border border-border bg-surface p-4 shadow-sm transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:bg-surface-sunken"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span
                        className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 font-semibold text-primary"
                        aria-hidden="true"
                      >
                        {initials(diver.person.fullName)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">
                          {diver.person.fullName}
                        </span>
                        <span className="block truncate text-sm text-muted">
                          {diver.person.email ?? diver.person.phone ?? "No contact details yet"}
                        </span>
                      </span>
                    </span>
                    <span className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                      <span className="inline-flex whitespace-nowrap rounded-full bg-primary/10 px-3 py-1 text-primary">
                        {cards} card{cards === 1 ? "" : "s"}
                      </span>
                      <span className="text-muted">
                        {diver.rentalFit ? "Fit saved" : "No fit on file"}
                      </span>
                      {pending > 0 ? (
                        <span className="rounded-full bg-warning/10 px-3 py-1 text-warning">
                          {pending} pending review
                        </span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="relative mt-4 hidden overflow-x-auto rounded-2xl border border-border bg-surface shadow-sm sm:block">
            <table className="w-full min-w-180 border-collapse text-left">
              <thead className="bg-surface-sunken text-xs tracking-wider text-muted uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Person
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Cards
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Rental fit
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Attention
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((diver) => {
                  const cards =
                    diver.certificationCount +
                    diver.specialtyCount +
                    diver.nitroxCertificationCount;
                  const pending =
                    diver.pendingCertificationCount + diver.pendingSpecialtyOrNitroxCount;
                  return (
                    <tr
                      key={diver.person.id}
                      className="group relative transition-colors duration-200 hover:bg-surface-sunken"
                    >
                      <td className="relative px-4 py-3">
                        <Link
                          href={`/shop/${shopSlug}/divers/${diver.person.id}`}
                          className="flex min-w-0 items-center gap-3 after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-[-2px] focus-visible:after:outline-primary"
                        >
                          <span
                            className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 font-semibold text-primary"
                            aria-hidden="true"
                          >
                            {initials(diver.person.fullName)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-semibold group-hover:text-primary">
                              {diver.person.fullName}
                              <span
                                aria-hidden="true"
                                className="ml-1 opacity-0 transition-opacity group-hover:opacity-100"
                              >
                                →
                              </span>
                            </p>
                            <p className="truncate text-sm font-normal text-muted">
                              {diver.person.email ?? diver.person.phone ?? "No contact details yet"}
                            </p>
                          </div>
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className="inline-flex whitespace-nowrap rounded-full bg-primary/10 px-3 py-1 text-primary">
                          {cards} card{cards === 1 ? "" : "s"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted">
                        {diver.rentalFit ? "Fit saved" : "No fit on file"}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <div className="flex flex-wrap gap-2">
                          {pending > 0 ? (
                            <span className="rounded-full bg-warning/10 px-3 py-1 text-warning">
                              {pending} pending review
                            </span>
                          ) : (
                            <span className="text-muted">None</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
