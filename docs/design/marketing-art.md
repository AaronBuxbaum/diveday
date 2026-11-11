# Marketing illustration art direction

Aaron approved the harbor and classroom style on 2026-11-11. Use the actual images as visual
references, not just the word “watercolor.” This direction is for editorial scenes, not product
screenshots, UI icons, customer photographs or safety instruction.

## Reference set

| Asset | Role | What to preserve |
| --- | --- | --- |
| [Harbor](../../public/marketing/harbor.webp) | Homepage, booking and website: a warm arrival | Environmental depth, sea-blue shadows, natural group conversation, sunlight on wood |
| [Classroom](../../public/marketing/classroom.webp) | Courses: personal attention | Close human interaction, visible brushwork on faces and surfaces, one recognizable equipment prop |
| [Gear handover](../../public/marketing/gear-handover.webp) | Rental gear: a prepared, welcoming counter | A single clear action, ordinary adults of different ages, orderly useful equipment rather than decoration |

These are generated illustrations of fictional scenes. Never label a depicted person as a customer,
quote them, imply they use DiveDay, or present the scene as documentary evidence. Keep localized
alt text identifying and describing the illustration; no visible caption is needed (Aaron,
2026-11-11). Genuine operator photos, when available with permission, remain photos and must not
be painted over to manufacture consistency.

## The look

- **Medium:** sun-washed editorial gouache on textured paper. Opaque, layered brush marks, fine
  grain, softly broken edges. Faces stay painterly too; avoid photoreal faces on painted scenery.
- **Palette:** warm cream plaster, honey-colored wood and terracotta balanced with sea teal and
  faded indigo. Coral flowers and mustard equipment are small accents, not a competing rainbow.
  This describes the artwork, not new CSS colors or a change to semantic interface tokens.
- **Light:** warm daylight with cool blue-green shadows; readable faces and equipment. No dramatic
  spotlights, cinematic danger or gloomy underwater advertising.
- **People:** believable adult proportions, different ages and backgrounds, relaxed working
  clothes. People look at one another or the task, not at the camera. Warmth comes from attention,
  not identical broad grins, mannequin poses or exaggerated “corporate illustration” limbs.
- **Place:** a specific lived-in coastal shop or dock, with worn wood and practical equipment.
  Enough context to feel inhabited, enough quiet space to read the human action at phone size.
  Plants and flowers can frame a scene but are not a required border on every image.
- **Composition:** one clear action, eye-level view, 3:2 landscape. Keep meaningful hands, faces
  and equipment inside the middle 80%; do not crop the interaction. Vary distance and arrangement
  between scenes instead of cloning the classroom's table or the harbor's four-person group.
- **Exclude:** text, signs, invented logos, prices, UI, fake badges, fake testimonials, glossy stock
  photography, flat vector people, 3D renders and extreme-sports spectacle. Don't depict technical
  procedures or gear configurations whose accuracy has not been reviewed.

## Reusable generation brief

Attach harbor and classroom as **style references**, then replace the bracketed scene. The prompt
is intentionally unwrapped for copying. Do not ask for an imitation of a named living artist.

```text
Create one original DiveDay editorial illustration. Use the attached harbor and classroom images as style references, not as subjects to copy. Scene: [one concrete shop activity, the people involved and one readable action]. Landscape 3:2, 1536 by 1024 pixels, medium-wide eye-level composition. Warm hand-painted gouache on textured paper, opaque layered brushwork, softly broken edges, believable natural proportions and painterly faces. Sun-washed cream plaster and honey-colored wood, sea teal and faded indigo, restrained terracotta, coral and mustard accents. Warm daylight and cool blue-green shadows. Ordinary diverse adults focused on each other or their task, natural expressions rather than posed stock-photo grins. A specific lived-in coastal setting, practical recognizable equipment, visual breathing room; keep important faces, hands and the action inside the middle 80%. No text, labels, logos, prices, signage, screens, UI, watermark, customer endorsements, photoreal finish, vector blob people, 3D or dramatic adventure imagery. Do not invent equipment connections or demonstrate safety procedures.
```

### Gear handover scene brief

The new rental scene uses the reusable direction with this subject (built-in image generation,
2026-11-11; harbor and classroom supplied as references):

```text
A capable older woman staff member in a faded indigo shirt hands a neatly paired set of teal open-heel fins to an adult guest in a terracotta shirt at a dive-shop rental counter. Both focus naturally on the handover. Show organized shelves, a few paired fins, wetsuits hanging on broad hangers and a glimpse of blue water through an open doorway. No tanks, cylinders, regulator hoses or active diving. The handover, not a lesson, is the focal point.
```

## Placement and delivery

Add an illustration only when it makes the page's job more tangible. The rental page now shows a
gear handover instead of repeating a classroom lesson. Existing harbor and classroom scenes stay
where they fit. Pricing, About, legal/safety pages and the product directory do not need filler.
An attractive picture alone is not a reason for another section or more scrolling.

Keep the product demonstration and first demo door ahead of editorial art. Use the existing
`MarketingIllustration` figure and localized alt text describing the visible scene. No text overlay,
background-image conversion or carousel. Show the complete
scene with intrinsic 1536 × 1024 dimensions, responsive `sizes` and lazy loading; do not mark it
priority. Preserve the product mockups as proof of capability.

Commit the reviewed delivery WebP under `public/marketing/`, not multi-megabyte generation output.
Target below 450 KB and keep the existing 500 KB test ceiling; reduce quality or simplify the image
rather than raising that ceiling. The gear image is 432,932 bytes at WebP quality 80. Retain generation
masters outside the repository; keep useful prompts here so future work does not depend on a chat.

## Acceptance check

1. Inspect the new image beside both reference assets at full size and phone scale. Check hands,
   faces, paired gear, perspective and accidentally generated text; regenerate visible defects.
2. Verify its activity supports that specific page, without implying a new capability, integration,
   testimonial or safety guarantee. Don't use an illustration to paper over missing product proof.
3. Inspect the real page at desktop and phone widths, with the adjacent copy. Check
   cropping, horizontal overflow, load layout stability, and whether the CTA still leads.
4. Run the component's locale/dimensions/lazy-loading/size tests and the affected marketing browser
   tests; retain visual captures. Explain the expected pixel change in the PR and review CI's diff.
