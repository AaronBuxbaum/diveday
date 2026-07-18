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

## Nitrox fills

- **Starting mix band:** whole-percent recreational EANx from 22% to 40% oxygen. Below 22% is
  treated as air; above 40% is a technical mix outside this slice. Non-integer and out-of-band
  values are rejected rather than logged.
- **Starting MOD basis:** maximum operating depth is derived as `10·(ppO₂/FO₂ − 1)` metres, floored,
  at a default working ppO₂ of **1.4 bar** with a **1.6 bar** contingency option. The value is
  computed from the analyzed mix, never entered by hand.
- **Starting gate + evidence:** a fill is only logged for a diver with a **verified** nitrox
  specialty card, and it records the diver's typed analysis signature, the mix, the ppO₂ ceiling,
  and the deriving staff member. It does not replace the diver's own pre-dive O₂ analysis.
- **Must verify:** agency/blending-facility fill-station procedure, whether a signed analysis
  sticker or fill log of record is required, the accepted ppO₂ ceilings for the shop's diving,
  gas-blender qualifications, O₂-clean tank tracking, and any per-agency EANx card acceptance rules.

Sources: [DAN — enriched air nitrox and ppO₂/MOD limits](https://dan.org/alert-diver/article/the-basics-of-nitrox/),
[NOAA Diving Manual oxygen exposure limits](https://www.noaa.gov/).

## Vercel hosting

Vercel is the selected web host. A managed Postgres provider, migration path, previews/production
environment ownership, backups, domain, and incident owner still need H-04 completion. Vercel
currently connects external Postgres providers through Marketplace integrations rather than a
native Vercel Postgres product. See [hosting ADR](../architecture/decisions/20260718-vercel-hosting.md)
and [Vercel's current Postgres guidance](https://vercel.com/docs/postgres).
