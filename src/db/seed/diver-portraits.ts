import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DbExecutor } from "../client";
import { people, shops } from "../schema";

/** The freshly inserted fictional cast only; never match existing people by name. */
export const DEMO_DIVER_PORTRAITS: Readonly<Record<string, string>> = {
  "Priya Sharma": "/demo-divers/priya-sharma.webp",
  "Tom Okafor": "/demo-divers/tom-okafor.webp",
  "June Park": "/demo-divers/june-park.webp",
  "Nadia Petrov": "/demo-divers/nadia-petrov.webp",
  "Isabel Moreno": "/demo-divers/isabel-moreno.webp",
  "Diego Alvarez": "/demo-divers/diego-alvarez.webp",
  "Siobhan Doyle": "/demo-divers/siobhan-doyle.webp",
  "Niklas Berg": "/demo-divers/niklas-berg.webp",
  "Omar Haddad": "/demo-divers/omar-haddad.webp",
  "Ines Costa": "/demo-divers/ines-costa.webp",
  "Yusuf Demir": "/demo-divers/yusuf-demir.webp",
  "Carmen Ruiz": "/demo-divers/carmen-ruiz.webp",
  "Miriam Cohen": "/demo-divers/miriam-cohen.webp",
  "Finn O'Sullivan": "/demo-divers/finn-o-sullivan.webp",
  "Rania Youssef": "/demo-divers/rania-youssef.webp",
  "Theo Lindqvist": "/demo-divers/theo-lindqvist.webp",
  "Efrain Torres": "/demo-divers/efrain-torres.webp",
  "Zoe Bennett": "/demo-divers/zoe-bennett.webp",
  "Mateo Duarte": "/demo-divers/mateo-duarte.webp",
  "Chiara Bianchi": "/demo-divers/chiara-bianchi.webp",
  "Amara Osei": "/demo-divers/amara-osei.webp",
  "Wan Chen": "/demo-divers/wan-chen.webp",
  "Meera Iyer": "/demo-divers/meera-iyer.webp",
  "Kwame Asante": "/demo-divers/kwame-asante.webp",
  "Hana Kobayashi": "/demo-divers/hana-kobayashi.webp",
  "Ravi Menon": "/demo-divers/ravi-menon.webp",
  "Grace Mensah": "/demo-divers/grace-mensah.webp",
  "Jonas Kallio": "/demo-divers/jonas-kallio.webp",
  "Zara Ahmed": "/demo-divers/zara-ahmed.webp",
  "Malik Johnson": "/demo-divers/malik-johnson.webp",
  "Ling Zhao": "/demo-divers/ling-zhao.webp",
  "Henrique Silva": "/demo-divers/henrique-silva.webp",
  "Dario Conti": "/demo-divers/dario-conti.webp",
  "Adaeze Nwosu": "/demo-divers/adaeze-nwosu.webp",
  "Pablo Iglesias": "/demo-divers/pablo-iglesias.webp",
  "Clara Nguyen": "/demo-divers/clara-nguyen.webp",
  "Harriet Voss": "/demo-divers/harriet-voss.webp",
  "Callum Fraser": "/demo-divers/callum-fraser.webp",
  "Yuki Tanaka": "/demo-divers/yuki-tanaka.webp",
  "Georg Fischer": "/demo-divers/georg-fischer.webp",
  "Josip Horvat": "/demo-divers/josip-horvat.webp",
  "Petra Novak": "/demo-divers/petra-novak.webp",
  "Tyler Brooks": "/demo-divers/tyler-brooks.webp",
  "Aroha Ngata": "/demo-divers/aroha-ngata.webp",
  "Connor Blake": "/demo-divers/connor-blake.webp",
  "Renata Souza": "/demo-divers/renata-souza.webp",
  "Julian Marsh": "/demo-divers/julian-marsh.webp",
  "Kiona Blackfeather": "/demo-divers/kiona-blackfeather.webp",
  "Bram de Vries": "/demo-divers/bram-de-vries.webp",
  "Charlotte Reid": "/demo-divers/charlotte-reid.webp",
  "Reggie Palmer": "/demo-divers/reggie-palmer.webp",
  "Valeria Gomez": "/demo-divers/valeria-gomez.webp",
  "Naledi Khumalo": "/demo-divers/naledi-khumalo.webp",
  "Felix Grant": "/demo-divers/felix-grant.webp",
  "Fatima Al-Rashid": "/demo-divers/fatima-al-rashid.webp",
  "Declan Murphy": "/demo-divers/declan-murphy.webp",
  "Owen Fitzgerald": "/demo-divers/owen-fitzgerald.webp",
  "Adaora Chukwu": "/demo-divers/adaora-chukwu.webp",
  "Mikael Andersson": "/demo-divers/mikael-andersson.webp",
  "Sana Malik": "/demo-divers/sana-malik.webp",
  "Rosalind Okoye": "/demo-divers/rosalind-okoye.webp",
  "Bjorn Haugen": "/demo-divers/bjorn-haugen.webp",
  "Nour Khalil": "/demo-divers/nour-khalil.webp",
  "Tomasz Wojcik": "/demo-divers/tomasz-wojcik.webp",
  "Blake Sutton": "/demo-divers/blake-sutton.webp",
  "Chinwe Obi": "/demo-divers/chinwe-obi.webp",
  "Lukas Steiner": "/demo-divers/lukas-steiner.webp",
  "Amina Diallo": "/demo-divers/amina-diallo.webp",
  "Beatriz Almeida": "/demo-divers/beatriz-almeida.webp",
  "Piotr Kowalski": "/demo-divers/piotr-kowalski.webp",
};

export async function seedDiverPortraits(
  db: DbExecutor,
  shopId: string,
  cast: readonly { id: string; fullName: string }[],
): Promise<void> {
  const [shop] = await db.select({ isDemo: shops.isDemo }).from(shops).where(eq(shops.id, shopId));
  if (!shop?.isDemo) return;
  const assignments = cast.flatMap((person) => {
    const path = DEMO_DIVER_PORTRAITS[person.fullName];
    return path ? [{ id: person.id, path }] : [];
  });
  if (!assignments.length) return;
  const cases = assignments.map(({ id, path }) => sql`when ${people.id} = ${id} then ${path}`);
  await db
    .update(people)
    .set({ staffPhotoPath: sql`case ${sql.join(cases, sql` `)} else ${people.staffPhotoPath} end` })
    .where(
      and(
        eq(people.shopId, shopId),
        inArray(
          people.id,
          assignments.map(({ id }) => id),
        ),
        isNull(people.deletedAt),
        isNull(people.staffPhotoPath),
      ),
    );
}
