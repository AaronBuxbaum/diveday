/**
 * The shop's staff, shared by both seeders — the canonical `blue-mantis` demo
 * and every freshly-minted per-visitor demo shop — so the two can never drift
 * into different casts. They differ only in how an email is built: the
 * canonical shop uses `<local>@demo.invalid` (the addresses in
 * `dev-credentials.ts`), a minted shop namespaces the same local part under its
 * own slug.
 *
 * The names are the stable key. `seedDemoSchedule` runs against both shops and
 * so cannot look staff up by a hard-coded email — but it also cannot look the
 * instructor up by role any more, because as of DOM-M7 there are two, and a
 * bare `where role = 'instructor' limit 1` would pick whichever row Postgres
 * happened to return first and silently reshuffle the demo between runs.
 *
 * **Order is load-bearing** and matches the insert order both seeders use.
 */
export const staffDefs = [
  {
    fullName: "Dana Reyes",
    local: "dana",
    roles: ["owner", "manager"],
    emergencyContact: ["Marisol Reyes (wife)", "+1-305-555-0101"],
    languages: undefined,
    namedToDivers: false,
  },
  {
    fullName: "Marcus Webb",
    local: "marcus",
    roles: ["instructor"],
    emergencyContact: ["Yvonne Webb (mother)", "+1-305-555-0102"],
    languages: ["en", "es"],
    // **Two of four, on purpose** (issue #1181, D21). The public "who you're
    // diving with" line renders only the crew who switched it on for
    // themselves, so a demo where everybody had would show a feature with no
    // shape: what a shop actually sees is some of its people named and some
    // not, and the ones who declined must be indistinguishable from the ones
    // who were never rostered.
    namedToDivers: true,
  },
  {
    fullName: "Keiko Tanaka",
    local: "keiko",
    roles: ["divemaster"],
    emergencyContact: ["Haru Tanaka (brother)", "+81-3-555-0103"],
    languages: ["en", "ja"],
    namedToDivers: true,
  },
  // No contact on file: the crew-side twin of the divers' deliberate gaps
  // below. The captain is the person a coastguard most needs to reach, and
  // the printed manifest saying "Not on file" under his name is the whole
  // argument for the field existing (dive-domain review 20260810).
  //
  // Spelled `undefined` rather than omitted, because `as const` keeps each
  // entry's own literal type — an omitted key is absent from the union and
  // `s.emergencyContact` stops compiling for every member, not just this one.
  {
    fullName: "Sal Moretti",
    local: "sal",
    roles: ["captain"],
    emergencyContact: undefined,
    // Spelled out for the same `as const` reason the contact above is: an
    // omitted key leaves the union without it and every read stops compiling.
    languages: undefined,
    namedToDivers: false,
  },
  /**
   * The shop's second instructor (DOM-M7, review 20260802). A real shop of this
   * size has one lead and one more who teaches some of the week — and without
   * her the demo could not show the one (shop role × trip role) combination the
   * seed never covered: **an instructor rostered as a session's divemaster**.
   * That case needs two, because rostering the only instructor as somebody
   * else's assistant leaves the course with nobody on the ratio.
   *
   * She is not one of the sign-in accounts in `dev-credentials.ts` — she is crew
   * on the boat, not a demo persona to log in as. (A *minted* demo shop mints an
   * account for every entry in this list, so she has one there; that is the
   * minting path being uniform, not a second persona.)
   */
  {
    fullName: "Talia Okonkwo",
    local: "talia",
    roles: ["instructor"],
    emergencyContact: ["Chidi Okonkwo (husband)", "+234-1-555-0105"],
    languages: ["en", "fr"],
    // Speaks two languages and has *not* agreed to be named, which is the
    // pairing worth seeding: it proves the two facts are independent, so a
    // shop reading the demo cannot conclude that filling in languages is what
    // publishes a name.
    namedToDivers: false,
  },
] as const satisfies ReadonlyArray<{
  fullName: string;
  local: string;
  roles: readonly string[];
  /** BCP-47 primary tags, as `people.spoken_languages` holds them (issue #708). */
  languages: readonly string[] | undefined;
  /**
   * Whether this person has agreed to be named to divers on the departures
   * they crew (issue #1181, D21) — their own switch, on the staffing page.
   * Seeded rather than left off for every member, because a feature no seed
   * exercises is a feature no e2e or capture can see.
   */
  namedToDivers: boolean;
  /**
   * Same shape and same intent as `customerDefs` below: real-looking people a
   * crew could actually ring, with one deliberate gap. Staff used to share a
   * single literal `"On file"` name and one phone number between them, which
   * was invisible while nothing rendered it — and became "On file ·
   * +1-305-555-0100" under every crew name the moment the boat manifest
   * started printing crew contacts. A placeholder that reads as data is worse
   * on that sheet than an honest blank.
   */
  emergencyContact?: readonly [string, string];
}>;

/** Whose course sessions these are — the instructor of record on every one. */
export const LEAD_INSTRUCTOR_NAME = "Marcus Webb";
/** The second instructor, rostered as a session's *divemaster* (DOM-M7). */
export const RELIEF_INSTRUCTOR_NAME = "Talia Okonkwo";

/**
 * The shop's divers. **Order is load-bearing**: the rosters below index into
 * this list, and tests assert on the exact names that land on today's boat.
 * Append to the end; never reorder or insert.
 *
 * Emergency contacts are deliberately incomplete. A manifest whose every field
 * is filled cannot show a crew what a manifest is *for*, so two divers arrive
 * without one and the roll-call sheet says so out loud.
 */
export const customerDefs: Array<{ fullName: string; emergencyContact?: [string, string] }> = [
  { fullName: "Priya Sharma", emergencyContact: ["Asha Sharma (sister)", "+1-305-555-0231"] },
  { fullName: "Tom Okafor", emergencyContact: ["Ngozi Okafor (wife)", "+1-305-555-0232"] },
  { fullName: "Lena Fischer", emergencyContact: ["Jonas Fischer (father)", "+49-30-555-0233"] },
  { fullName: "Diego Alvarez", emergencyContact: ["Rosa Alvarez (mother)", "+1-786-555-0234"] },
  { fullName: "June Park", emergencyContact: ["Min-ho Park (father)", "+1-305-555-0235"] },
  { fullName: "Omar Haddad", emergencyContact: ["Layla Haddad (sister)", "+1-305-555-0236"] },
  // No contact on file: the manifest gap the crew chases at the dock.
  { fullName: "Nadia Petrov" },
  { fullName: "Sam Whitfield", emergencyContact: ["Ruth Whitfield (mother)", "+1-954-555-0238"] },
  { fullName: "Ines Costa", emergencyContact: ["Paulo Costa (brother)", "+351-21-555-0239"] },
  { fullName: "Ravi Menon", emergencyContact: ["Divya Menon (wife)", "+1-305-555-0240"] },
  { fullName: "Amara Osei", emergencyContact: ["Kwame Osei (father)", "+1-305-555-0241"] },
  { fullName: "Felix Grant" },
  { fullName: "Hana Kobayashi", emergencyContact: ["Ren Kobayashi (brother)", "+81-3-555-0243"] },
  { fullName: "Mateo Duarte", emergencyContact: ["Sofia Duarte (wife)", "+1-305-555-0244"] },
  { fullName: "Zoe Bennett", emergencyContact: ["Harriet Bennett (mother)", "+44-20-555-0245"] },
  { fullName: "Yusuf Demir", emergencyContact: ["Elif Demir (sister)", "+90-212-555-0246"] },
  { fullName: "Clara Nguyen", emergencyContact: ["Binh Nguyen (father)", "+1-305-555-0247"] },
  { fullName: "Theo Lindqvist", emergencyContact: ["Ida Lindqvist (wife)", "+46-8-555-0248"] },
  // The extended roster: repeat locals, snowbirds, and traveling divers who
  // fill out the trips beyond today's three headline boats. Most carry an
  // emergency contact — that's the norm at a real front desk — with a handful
  // of gaps left deliberately (see customers above) so the manifest gap never
  // reads as fixed to two specific people.
  { fullName: "Carmen Ruiz", emergencyContact: ["Alejandro Ruiz (husband)", "+1-786-555-0249"] },
  { fullName: "Jonas Kallio", emergencyContact: ["Sanna Kallio (wife)", "+358-9-555-0250"] },
  { fullName: "Beatriz Almeida", emergencyContact: ["Tiago Almeida (brother)", "+55-21-555-0251"] },
  { fullName: "Malik Johnson", emergencyContact: ["Renee Johnson (mother)", "+1-954-555-0252"] },
  { fullName: "Siobhan Doyle", emergencyContact: ["Patrick Doyle (father)", "+353-1-555-0253"] },
  { fullName: "Yuki Tanaka", emergencyContact: ["Sora Tanaka (husband)", "+81-3-555-0254"] },
  { fullName: "Adaeze Nwosu", emergencyContact: ["Chidi Nwosu (brother)", "+234-1-555-0255"] },
  { fullName: "Piotr Kowalski", emergencyContact: ["Ewa Kowalski (wife)", "+48-22-555-0256"] },
  { fullName: "Grace Mensah", emergencyContact: ["Kofi Mensah (father)", "+233-30-555-0257"] },
  // No contact on file: a second manifest gap, this time a first-time diver
  // who booked online in a hurry.
  { fullName: "Connor Blake" },
  { fullName: "Isabel Moreno", emergencyContact: ["Fernando Moreno (father)", "+34-91-555-0259"] },
  { fullName: "Niklas Berg", emergencyContact: ["Astrid Berg (wife)", "+47-22-555-0260"] },
  { fullName: "Rania Youssef", emergencyContact: ["Hassan Youssef (husband)", "+20-2-555-0261"] },
  { fullName: "Declan Murphy", emergencyContact: ["Maeve Murphy (mother)", "+353-1-555-0262"] },
  { fullName: "Wan Chen", emergencyContact: ["Li Chen (wife)", "+86-21-555-0263"] },
  {
    fullName: "Fatima Al-Rashid",
    emergencyContact: ["Omar Al-Rashid (brother)", "+971-4-555-0264"],
  },
  { fullName: "Tyler Brooks", emergencyContact: ["Karen Brooks (mother)", "+1-305-555-0265"] },
  { fullName: "Miriam Cohen", emergencyContact: ["David Cohen (husband)", "+972-3-555-0266"] },
  { fullName: "Josip Horvat", emergencyContact: ["Ana Horvat (wife)", "+385-1-555-0267"] },
  { fullName: "Aroha Ngata", emergencyContact: ["Manaia Ngata (partner)", "+64-9-555-0268"] },
  // No contact on file.
  { fullName: "Julian Marsh" },
  { fullName: "Chiara Bianchi", emergencyContact: ["Luca Bianchi (husband)", "+39-06-555-0270"] },
  { fullName: "Efrain Torres", emergencyContact: ["Marisela Torres (wife)", "+52-55-555-0271"] },
  {
    fullName: "Anong Suwannee",
    emergencyContact: ["Somchai Suwannee (husband)", "+66-2-555-0272"],
  },
  { fullName: "Bram de Vries", emergencyContact: ["Anna de Vries (wife)", "+31-20-555-0273"] },
  { fullName: "Naledi Khumalo", emergencyContact: ["Thabo Khumalo (brother)", "+27-11-555-0274"] },
  { fullName: "Callum Fraser", emergencyContact: ["Morag Fraser (mother)", "+44-131-555-0275"] },
  { fullName: "Esperanza Cruz", emergencyContact: ["Ramon Cruz (father)", "+1-787-555-0276"] },
  { fullName: "Henrique Silva", emergencyContact: ["Beatriz Silva (wife)", "+55-11-555-0277"] },
  { fullName: "Petra Novak", emergencyContact: ["Milan Novak (husband)", "+420-2-555-0278"] },
  {
    fullName: "Odalys Fernandez",
    emergencyContact: ["Julio Fernandez (father)", "+1-305-555-0279"],
  },
  { fullName: "Kwame Asante", emergencyContact: ["Abena Asante (wife)", "+233-30-555-0280"] },
  { fullName: "Ingrid Solberg", emergencyContact: ["Erik Solberg (husband)", "+47-22-555-0281"] },
  // No contact on file — a walk-up who booked from the dock.
  { fullName: "Reggie Palmer" },
  // A second wave: the shop's snowbird regulars, a dive club that books as a
  // block, and the steady trickle of one-off tourists who fill out the rest
  // of the month's boats.
  { fullName: "Harriet Voss", emergencyContact: ["Edwin Voss (husband)", "+1-239-555-0282"] },
  { fullName: "Rosalind Okoye", emergencyContact: ["Emeka Okoye (husband)", "+234-1-555-0283"] },
  { fullName: "Lukas Steiner", emergencyContact: ["Nina Steiner (wife)", "+41-22-555-0284"] },
  {
    fullName: "Renata Souza",
    emergencyContact: ["Rafael Souza (brother)", "+55-21-555-0285"],
  },
  { fullName: "Dmitri Volkov", emergencyContact: ["Elena Volkov (wife)", "+7-495-555-0286"] },
  { fullName: "Amina Diallo", emergencyContact: ["Ousmane Diallo (father)", "+221-33-555-0287"] },
  // No contact on file.
  { fullName: "Trevor Lang" },
  { fullName: "Soraya Karimi", emergencyContact: ["Reza Karimi (husband)", "+98-21-555-0289"] },
  {
    fullName: "Finn O'Sullivan",
    emergencyContact: ["Grainne O'Sullivan (mother)", "+353-1-555-0290"],
  },
  { fullName: "Ling Zhao", emergencyContact: ["Wei Zhao (husband)", "+86-10-555-0291"] },
  { fullName: "Pablo Iglesias", emergencyContact: ["Lucia Iglesias (wife)", "+34-91-555-0292"] },
  { fullName: "Charlotte Reid", emergencyContact: ["William Reid (father)", "+1-770-555-0293"] },
  { fullName: "Mikael Andersson", emergencyContact: ["Elin Andersson (wife)", "+46-31-555-0294"] },
  { fullName: "Zara Ahmed", emergencyContact: ["Bilal Ahmed (brother)", "+92-21-555-0295"] },
  {
    fullName: "Owen Fitzgerald",
    emergencyContact: ["Maureen Fitzgerald (mother)", "+1-617-555-0296"],
  },
  { fullName: "Valeria Gomez", emergencyContact: ["Hector Gomez (husband)", "+52-33-555-0297"] },
  // No contact on file.
  { fullName: "Casey Winters" },
  { fullName: "Nour Khalil", emergencyContact: ["Samir Khalil (father)", "+961-1-555-0299"] },
  { fullName: "Bjorn Haugen", emergencyContact: ["Kari Haugen (wife)", "+47-55-555-0300"] },
  { fullName: "Adaora Chukwu", emergencyContact: ["Emeka Chukwu (husband)", "+234-1-555-0301"] },
  { fullName: "Tomasz Wojcik", emergencyContact: ["Agnieszka Wojcik (wife)", "+48-12-555-0302"] },
  { fullName: "Meilin Tan", emergencyContact: ["Wei Tan (father)", "+65-6-555-0303"] },
  { fullName: "Dario Conti", emergencyContact: ["Giulia Conti (wife)", "+39-02-555-0304"] },
  { fullName: "Simone Laurent", emergencyContact: ["Pierre Laurent (husband)", "+33-1-555-0305"] },
  {
    fullName: "Kiona Blackfeather",
    emergencyContact: ["Dawn Blackfeather (mother)", "+1-505-555-0306"],
  },
  { fullName: "Anders Lindgren", emergencyContact: ["Freja Lindgren (wife)", "+46-8-555-0307"] },
  // No contact on file — booked same-day, straight from the marina.
  { fullName: "Blake Sutton" },
  { fullName: "Meera Iyer", emergencyContact: ["Arjun Iyer (husband)", "+91-22-555-0309"] },
  { fullName: "Georg Fischer", emergencyContact: ["Hilde Fischer (wife)", "+43-1-555-0310"] },
  { fullName: "Chinwe Obi", emergencyContact: ["Emeka Obi (brother)", "+234-1-555-0311"] },
  { fullName: "Sana Malik", emergencyContact: ["Imran Malik (father)", "+92-42-555-0312"] },
];
