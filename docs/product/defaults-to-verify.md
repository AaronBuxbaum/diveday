# Provisional implementation defaults — verify before production

These are practical starting points used by the first course and gear slices. They are not legal,
agency, medical, or operations policy. The rows in [human-decisions.md](human-decisions.md) remain
the source of approval work.

## Waiver and signature

- **Starting form shape:** liability release / assumption of risk / non-agency acknowledgement plus
  a medical questionnaire. This follows the structure of PADI's commonly encountered digital form
  set, not copied PADI text. The shop must use approved, jurisdiction-appropriate language before
  it sends a real waiver.
- **Starting signature:** typed full name, explicit agreement, timestamp, immutable template
  snapshot, and an expiring private completion link. This is a convenient electronic-consent
  baseline, not a claim of cryptographic non-repudiation or a substitute for legal advice.
- **Must verify:** jurisdiction, approved template and medical questions, age/guardian rules,
  retention/deletion, privacy notice, and whether a specialist e-signature provider is required.

Sources: [PADI digital forms](https://pros-blog.padi.com/digital-forms-expand/),
[PADI general-training release](https://pro-cms.padi.com/sites/default/files/documents/training-hub/10072_Liability_Release_v403_FF_EN.pdf),
and [PADI diver medical questionnaire](https://www.padi.com/sites/default/files/documents/2020-08/10346E_Diver_Medical_Form.pdf).

## Course admission

- **Starting rules:** Discover Scuba Diving and Open Water have no pre-existing C-card gate;
  Advanced Open Water and a refresher require a verified Open Water card. Instructor-led sessions
  cannot accept a booking until an instructor is assigned.
- **Must verify:** agency, local regulatory, insurer, ratio, depth, age, medical, and exception
  rules for every course/environment. The current C-card gate is conservative but intentionally
  incomplete.

## Rental gear request

- **Starting rental set:** BCD, regulator, wetsuit, mask/fins, weights, and tank; dive computer
  is opt-in. The request asks for BCD/wetsuit size, boot/fin size, usual weighting, and notes.
- **Safety boundary:** a request is not a reservation or fit approval. Staff still assigns a real,
  available item and confirms fit/weight at check-in.
- **Must verify:** shop inventory packages, thickness/temperature guidance, measurement method,
  substitution authority, computer/tank policy, and the safe fallback when a requested size is not
  available.

Source: [example dive-rental reservation form with package and size fields](https://www.sailcaribbeandivers.com/wp-content/uploads/2024/10/SCD-RENTAL-FORM-2024-25.pdf).

## Vercel hosting

Vercel is the selected web host. A managed Postgres provider, migration path, previews/production
environment ownership, backups, domain, and incident owner still need H-04 completion. Vercel
currently connects external Postgres providers through Marketplace integrations rather than a
native Vercel Postgres product. See [hosting ADR](../architecture/decisions/20260718-vercel-hosting.md)
and [Vercel's current Postgres guidance](https://vercel.com/docs/postgres).
