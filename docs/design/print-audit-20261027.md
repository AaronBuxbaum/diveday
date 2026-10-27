# Print audit: 27 October 2026

The audit inventoried staff, public, capability, and marketing page routes and reviewed real PDF output using seeded or disposable fixtures. The table records route coverage, not every combination of roles, data, browsers, or interaction states. Several route captures were made before fixes. Changed surfaces received focused production regression; hosted CI visual comparison remains separate.

Staff review covered 73 route templates and inspected 125 pages from 67 unique PDFs, plus the separately reviewed detail PDFs. Some routes redirect or use a feature-disabled state; those are identified below. Public review covered 40 route templates, including valid disposable capability links and canonical embed aliases. No capability URLs or personal data are recorded in this ledger.

## Staff routes

| Route template | Evidence |
| --- | --- |
| `/shop/[shopSlug]` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/boats` | Prior PDF reviewed |
| `/shop/[shopSlug]/bookings/new` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/bookings/new/[tripId]` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/courses` | Prior PDF reviewed |
| `/shop/[shopSlug]/courses/[slug]/edit` | Prior PDF reviewed |
| `/shop/[shopSlug]/dive-sites` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/dive-sites/[id]` | Seeded detail PDF reviewed before final changes |
| `/shop/[shopSlug]/dive-sites/new` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/divers` | Prior PDF reviewed |
| `/shop/[shopSlug]/divers/[personId]` | Seeded detail PDF reviewed before final changes |
| `/shop/[shopSlug]/divers/[personId]/merge/[survivorId]` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/divers/[personId]/waivers/[recordId]` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/divers/new` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/gear` | Prior PDF reviewed |
| `/shop/[shopSlug]/gear/[id]` | Seeded detail PDF reviewed before final changes |
| `/shop/[shopSlug]/gear/rentals/[ticketId]` | Seeded detail PDF reviewed before final changes |
| `/shop/[shopSlug]/gear/rentals/new` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/gear/work-orders` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/gear/work-orders/[workOrderId]` | Seeded detail PDF reviewed before final changes |
| `/shop/[shopSlug]/gear/work-orders/[workOrderId]/tag` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/gear/work-orders/new` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/inbox` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/lost-found` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/orders` | Prior PDF reviewed |
| `/shop/[shopSlug]/orders/[id]` | Seeded detail PDF reviewed before final changes |
| `/shop/[shopSlug]/orders/[id]/print/dispute` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/orders/new` | Redirect or disabled state captured; active integration state not established |
| `/shop/[shopSlug]/print` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/print/counter-card` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/print/pass/[bookingId]` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/promos` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/promos/packages` | Redirect alias captured |
| `/shop/[shopSlug]/reports` | Prior PDF reviewed |
| `/shop/[shopSlug]/requests` | Prior PDF reviewed |
| `/shop/[shopSlug]/reviews` | Prior PDF reviewed |
| `/shop/[shopSlug]/safety` | Prior PDF reviewed |
| `/shop/[shopSlug]/safety-checklist` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/schedule/blowout/[tripId]` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/schedule/blowout/day/[date]` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/schedule/board` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/schedule/board/new` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/schedule/day/[date]` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/settings` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/settings/activity` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/settings/billing` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/settings/bookkeeper` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/settings/calendar` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/settings/dock-day` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/settings/email` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/settings/embed` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/settings/emergency-reference` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/settings/export` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/settings/export/backups` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/settings/features` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/settings/import` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/settings/integrations` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/settings/profile` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/settings/rentals` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/settings/security` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/settings/team` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/settings/whatsapp` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/staffing` | Prior PDF reviewed |
| `/shop/[shopSlug]/trip-tags` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/trips/[id]` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/trips/[id]/incidents/[reportId]` | Disposable draft captured; filed and amended states not established |
| `/shop/[shopSlug]/trips/[id]/log` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/trips/[id]/manifest` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/trips/[id]/prep` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/trips/[id]/prep/ticket/[bookingId]` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/trips/[id]/print` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/trips/[id]/print/medical-alerts` | Seeded or disposable PDF reviewed before final changes |
| `/shop/[shopSlug]/waivers` | Prior PDF reviewed |

## Public and capability routes

| Route template | Evidence |
| --- | --- |
| `/` | PDF captured on production build |
| `/about` | PDF captured on production build |
| `/claim/[token]` | valid+invalid claim PDF captured |
| `/confirm-contact/[token]` | invalid and valid fixture PDF captured |
| `/find-your-booking` | PDF captured on production build |
| `/forgot-password` | PDF captured on production build |
| `/get-set-up` | PDF captured on production build |
| `/get-set-up/sent` | PDF captured on production build |
| `/invite/[token]` | invalid and valid fixture PDF captured |
| `/offline-manifest` | PDF captured on production build |
| `/onboard` | valid setup-link form PDF captured and all pages raster-inspected; bare URL redirects |
| `/pricing` | PDF captured on production build |
| `/privacy` | PDF captured on production build |
| `/product` | PDF captured on production build |
| `/product/[feature]` | all 12 feature instances captured |
| `/ready/[token]` | invalid and valid fixture PDF captured |
| `/ready/[token]/forms` | valid Open Water required-form PDF and raster inspected |
| `/recap/[token]` | invalid and valid fixture PDF captured |
| `/reset-password/[token]` | invalid and valid fixture PDF captured |
| `/s/[shopSlug]` | prior PDF captured |
| `/s/[shopSlug]/courses` | prior PDF captured |
| `/s/[shopSlug]/courses/[slug]` | prior PDF captured |
| `/s/[shopSlug]/embed/[widget]` | grid/courses/reviews and valid departure show-id PDFs captured |
| `/s/[shopSlug]/embed/schedule` | canonical ?embed=1 alias PDF captured; direct internal route correctly rejects |
| `/s/[shopSlug]/packages` | prior PDF captured |
| `/s/[shopSlug]/register` | prior PDF captured |
| `/s/[shopSlug]/reviews` | prior PDF captured |
| `/s/[shopSlug]/sites/[siteSlug]` | French Reef fixture PDF captured |
| `/s/[shopSlug]/trips/[id]` | prior PDF captured |
| `/s/[shopSlug]/trips/[id]/embed` | canonical trip ?embed=1 alias PDF captured |
| `/sign-in` | PDF captured on production build |
| `/status` | PDF captured on production build |
| `/switching` | PDF captured on production build |
| `/switching/[competitor]` | all 5 linked competitor instances captured |
| `/switching/spreadsheet` | PDF captured on production build |
| `/terms` | PDF captured on production build |
| `/unsubscribe/[token]` | courtesy+interest active and saved PDFs and rasters inspected |
| `/verify/[token]` | invalid and valid fixture PDF captured |
| `/waivers/[token]` | unsigned+medical-held fixture and invalid-token PDF captured |
| `/waivers/[token]/doctor` | valid physician-referral PDF and raster inspected |

## Limits

- A route entry covers the named fixture, not every state: guardian signing, expired or superseded waivers, completed claims, some post-trip states, filed or amended incidents, alternate staff roles, and connected-payment order entry still require separate evidence.
- The audit included real paginated PDFs; it did not establish identical results in every browser, PDF viewer, printer, paper size, or extreme roster. The Crew regression checks a multi-sheet Letter PDF in CI with Poppler, with additional local PDFium and A4 checks.
- External map tiles were unavailable in the controlled browser environment. Print outputs omit interactive maps where the accompanying address or site ledger is the useful paper record.
- The CI visual comparison and current-head verification are reported on the pull request rather than inferred from these route inventories.

## Paper-design follow-up

The follow-up inspected paginated Letter PDFs for paper-specific design, including unnecessary actions, dark fills, excessive spacing, clipped ink, continuation context, and blank sheets. This is a separate visual pass from the route inventory above.

- Public review raster-inspected 100 physical sheets from 36 PDFs, then another 61 sheets across the product directory, all 12 feature pages and a hydrated reviews embed. Fresh disposable Ready, unsigned-waiver, claim and required-course-form fixtures added eight sheets. Other capability lifecycle states still have historical rather than current captures.
- Staff review inspected 11 current sheets across Gear, Divers, Inbox, Schedule and Crew. A separate safety review inspected 25 sheets across the Dawn trip packet, manifest, prep, log, Crew rota, and an eight-sheet Wreck packet. The denser packet retained its passenger and crew names, warnings, emergency reference and repeated packing headers in the reviewed fixture. Oversized emergency plans, other dive/rider mixes, and after-dive reprints were not exercised.
- Settings review inspected 25 sheets from 18 PDFs; the backups capture timed out. The corrected profile and embed views were recaptured as single Letter sheets, and Team was checked both collapsed and with credentials open. The review does not establish every role or every state.
- A further staff pass inspected 63 Letter sheets from 41 route fixtures against the pushed build and subsequent in-progress changes. Course and site saved-detail PDFs were checked against unsaved drafts; the final forecast, fit and open-editor corrections have focused tests but still need their production PDF checks. Rental detail and incident lifecycle states were not recaptured; a disabled payments integration cannot establish connected order entry. Those route and state gaps remain separate from the historical inventory.
- Trip packet, manifest and departure-log continuation sheets now carry departure context and page numbers. Production PDF tests check the visible header ink and trip identity on every sheet, including a day packet with multiple departures and long names. The identity guard retries when the departure, boat or shop changes during packet assembly; it does not make the rest of the roster, rental or medical data a single database snapshot.
