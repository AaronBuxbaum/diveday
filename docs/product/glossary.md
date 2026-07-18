# Dive-domain glossary

Domain terms agents must use correctly — in code, UI copy, and data models. When you introduce a
new domain concept, define it here in the same PR.

## Certification

- **Agency** — organization that trains and certifies divers. Major ones: **PADI**, **SSI**,
  **NAUI**, **SDI/TDI**, **RAID**, **CMAS**, **GUE**. A diver's card is agency-specific but
  levels are broadly equivalent across agencies.
- **C-card** — the certification card (physical or digital) a diver presents as proof. Has an
  agency, a level, a cert/diver number, and an issue date. Cards **do not expire**, but shops
  may require a refresher after long inactivity.
- **Verified certification** — a card is evidence, not clearance. Scuba records it as pending
  until staff verify it; only a verified, unexpired card at or above a trip’s required level can
  satisfy readiness.
- **Readiness** — the fail-closed answer to “can this diver board?” It lists human-readable
  blockers from the trip’s requirements and the diver’s waiver/cert evidence. Unknown,
  unconfigured, pending, expired, or insufficient evidence is never “ready.”
- **Levels** (recreational ladder, roughly): **Open Water (OW)** → **Advanced Open Water
  (AOW)** → **Rescue** → **Divemaster (DM)** → **Instructor**. Names vary slightly by agency.
- **Specialties** — standalone certs gating specific activities: **Nitrox/EANx** (enriched
  air), **Deep** (beyond 18 m/60 ft for OW divers), Night, Wreck, Drysuit.
- **DSD (Discover Scuba Diving)** — a supervised *experience* for uncertified people. Not a
  cert. DSD participants have stricter ratios and depth limits and always dive with an
  instructor.
- **Refresher / ReActivate** — short course for certified divers returning after inactivity.

## Operations

- **Trip / charter** — a scheduled boat outing to one or more **dive sites**; commonly a
  "two-tank" (two dives with a **surface interval** between). Has capacity, staff, gear needs,
  and minimum cert requirements per site (e.g. AOW for a deep wreck).
- **Course session** — a scheduled class (pool or open water) tied to a course, an instructor,
  and enrolled students. Instructor-to-student **ratios** are agency-mandated and vary by
  course and environment.
- **Manifest** — the authoritative list of every person on a boat (divers, students, staff,
  crew), with emergency contacts. A legal/safety document — in US waters, coast guard
  regulations apply. **Roll call** happens before departure and *after every dive*; a diver
  left behind is the industry's nightmare scenario. Manifests must work offline and print
  cleanly.
- **Check-in** — the front-desk step where waiver, cert, and gear are confirmed before a diver
  boards. The app's job is making "ready to board" a single glance.
- **Waiver / release** — liability release signed per shop (sometimes per activity), typically
  with a **medical statement** (RSTC form). Scuba snapshots the exact template version into each
  issued record; a signed record is immutable and a replacement link creates a new record. Some
  answers on the medical form require a physician sign-off — that's a blocking state, not a
  checkbox.
- **DAN** — Divers Alert Network; dive accident insurance divers may carry. Worth a field, not
  a feature.

## Gear

- **Rental set** — typically: **BCD** (jacket, sized), **regulator** ("reg", with octopus and
  SPG), **wetsuit** (sized, thickness in mm), mask/fins/boots, **weights**, **tank/cylinder**
  (e.g. AL80 aluminum 80 cu ft), optionally a **dive computer**.
- **Sizing** — BCDs and wetsuits are sized (XS–XXL and height/weight dependent); assignment
  must respect size, not just availability.
- **Service history** — regulators and BCDs require periodic service (annual or by dive
  count); tanks require periodic **visual inspection (VIP)** and **hydrostatic testing**.
  Out-of-service gear must be un-assignable.
- **Nitrox fills** — enriched-air tanks must be **O2-analyzed** by the diver before use and
  logged (mix %, analysis, signature). Only nitrox-certified divers may take nitrox tanks.

## Modeling notes

- A **person** may be simultaneously a customer, a student, and staff — model roles, not
  separate person types.
- Cert requirements attach to **sites/activities** ("this wreck requires AOW + Deep"), and are
  checked against a diver's **verified** cards at booking *and* at check-in.
- Bookings, waivers, certs, gear, and manifests all hang off the same trip/session spine —
  the manifest is a *view* of checked-in bookings plus staff, not a separate data entry task.
