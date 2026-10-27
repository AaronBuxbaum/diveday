# Print review: inspect the sheets

Read when changing print CSS, a printable document, or PDF capture mechanics. Use the existing
**design-review** procedure for visual judgement; this reference adds the paper evidence it needs.

1. **Inventory the affected family.** Follow shared print selectors to their consumers. Include
   ordinary staff/public pages when changing global print rules, and packet compositions when
   changing a constituent sheet. Record route, role, fixture, paper size and expected contents.
2. **Exercise the failure.** Choose populated data and a dense state that spans sheets: long names,
   notes, warning labels, grouped rows or expanded answers as appropriate. Keep an ordinary short
   state too. Assert the intended content before capture; privacy checks exercise each allowed role.
3. **Capture real pagination first.** Run the relevant tests in `e2e/visual-print.spec.ts` against a
   fresh production build with `VISUAL_EXHAUSTIVE_AUDIT=1`. In that mode, `capturePrint` saves
   Letter and A4 PDFs through `e2e/print-pdf.ts` before applying its long-sheet screenshot rule.
   An explicit CSS page size wins over the requested
   format: inspect the PDF dimensions, especially for A6 passes/cards and landscape documents.
4. **Render every PDF page to images and inspect it.** Use an available PDF renderer, such as
   Poppler's `pdftoppm`. Review a contact sheet for pagination, then page images at readable scale
   for clipping, overlapping ink, tiny text, missing borders and blank/action-only trailing sheets.
   Check first, middle and final sheets; identify continuation context and table headers where a
   document needs them. Inspect actual ink as well as extractable text: a PDF can retain invisible
   words. `e2e/crew-pdf-pixels.ts` demonstrates both checks for the crew rota.
5. **Protect the observed failure.** Add a focused assertion to the existing print spec: content
   retained while controls disappear, repeated context on continuation sheets, a justified page
   count for a fixed fixture, or rendered ink in a known region. Keep fixture assumptions explicit.
   A print-media DOM check proves visibility; the long-sheet PNG proves continuous layout; the
   paginated PDF proves page breaks. Use the layer that can actually fail on the defect.
6. **Report the evidence.** Name the tested routes/states, roles, paper sizes, actual page counts,
   PDF/page-image paths and findings. Give the design critic paginated page images for significant
   paper changes. State missing PDF rendering or browser/physical-printer coverage explicitly.

Paper must carry the useful values after interactive controls disappear: an address rather than
a map frame, a code rather than its Copy button, an answer rather than its closed disclosure.
Retain safety and medical distinctions with readable text in monochrome. Preserve the permission
boundary of the source view when printing or composing packets.

Letter/A4 output from Chromium is browser evidence. A physical printer's unprintable area, duplex
settings and driver scaling require a separate physical check when those properties matter.
