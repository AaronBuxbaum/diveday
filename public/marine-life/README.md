# Marine-life catalog image sources

Photographs behind `src/db/marine-life-catalog.ts` — the species a shop picks from when it writes
a dive site's field guide. They are bundled here rather than hot-linked for the reason every other
image in this app is: a briefing page must never make a live request to a host someone else
controls. Each source page below carries the photographer credit and the licence terms.

**These are downscaled derivatives, not the originals** — bounded to **640px on the long edge**,
re-encoded as mozjpeg quality 78, EXIF orientation baked in and metadata stripped (noted here
because the CC licences ask that changes be indicated). The 135 files that were wider than that
were downscaled a second time on 2026-09-04, from the 800px bound they carried until then.

Keep any photo added here inside the same bound. 640 is where `next/image` stops asking: the four
surfaces that render a species declare `48px`, `48px`, `80px` and — for the published-catalog
preview, the largest — a slot measuring 171px, and the widest candidate any of them fetches across
every viewport at DPR 3 is 640. A wider source is bytes the optimizer throws away, and the
originals run to several megabytes apiece.

**640 is where it stays.** Asked again on 2026-09-10 (issue #1337), the answer was to leave the
sources alone: the surface that once justified a wider bound — the published-catalog preview — was
corrected by PR #1347 from `25vw` to the slot's real 171px, so nothing renders these large any
more, and the folder is 6.81 MB rather than the 9.9 MB the question was asked about. Do not
"restore" 800; that number belongs to a page that no longer exists.

## `tiles/` — capture-only variants, never rendered to a person

`tiles/48/`, `tiles/96/`, `tiles/171/` and `tiles/224/` hold one downscale of each source per
rendered box size: 331 species at four widths, 1324 files, 5.58 MB in total against 16.56 MB of
sources. They exist for a test defect, not for a diver: the e2e build turns the image
optimizer off, so a capture is handed the 640px source with no srcset and Chromium chooses its own
decode scale — and whenever the source is two or more times the rendered box, more than one scaled
decode is legal and the choice depends on what else has run in the browser process. That flip
arrived on five separate pull requests as one marine-life photograph reporting "changed" on pages
nothing had touched (#1585, #1567, #1432, #1405, #1623).

Nothing in a real deployment ever requests one: `src/lib/marine-life-tiles.ts` rewrites a photo URL
only under `DIVEDAY_E2E`, and it is what defines the widths and the band they have to sit in.
`pnpm content:photos` owns the files — a species gets its variants in the same `accept` as its
source, and `pnpm content:photos tiles` re-derives the whole set from the sources on disk without
touching Commons. `src/db/marine-life-catalog.test.ts` fails if
a species is missing one. They carry no separate credit line: each is a downscale of the exact file
credited below it, under that file's licence and the same "changes indicated" note.

## Credits

Every file here was found, measured and looked at by `pnpm content:photos`, which refuses a
licence the repository may not bundle, an original smaller than this folder's bound, a frame
described as a map, specimen, catch or aquarium, and one too dark or soft to read
(`src/content/photo-rules.ts`). The list below is rendered from the ledger
(`src/content/photo-records.json`); edit the ledger through the tool, never this list.

<!-- credits:start (rendered by pnpm content:photos readme) -->

- `almaco-jack.jpg` — [iNaturalist photo 419705591](https://www.inaturalist.org/photos/419705591) · CC BY 4.0 · Michael Bommerer
- `arrow-blenny.jpg` — [iNaturalist photo 402874361](https://www.inaturalist.org/photos/402874361) · CC BY 4.0 · Pauline Walsh Jacobson · cropped to 0.1,0.15,0.8,0.75 (left, top, width, height as fractions of the original)
- `arrow-crab.jpg` — [Cangrejo araña (Stenorhynchus seticornis), franja marina Teno-Rasca, Tenerife, España, 2022-01-05, DD 94.jpg](https://commons.wikimedia.org/wiki/File:Cangrejo_ara%C3%B1a_(Stenorhynchus_seticornis),_franja_marina_Teno-Rasca,_Tenerife,_Espa%C3%B1a,_2022-01-05,_DD_94.jpg) · CC BY-SA 4.0 · Diego Delso
- `atlantic-common-octopus.jpg` — [iNaturalist photo 177061652](https://www.inaturalist.org/photos/177061652) · CC BY 4.0 · Pauline Walsh Jacobson · cropped to 0,0,1,0.9 (left, top, width, height as fractions of the original)
- `atlantic-longarm-octopus.jpg` — [iNaturalist photo 160890378](https://www.inaturalist.org/photos/160890378) · CC BY 4.0 · Pauline Walsh Jacobson · cropped to 0,0,1,0.9 (left, top, width, height as fractions of the original)
- `atlantic-spadefish.jpg` — [Atlantic Spadefish PLW edit.jpg](https://commons.wikimedia.org/wiki/File:Atlantic_Spadefish_PLW_edit.jpg) · CC BY-SA 2.0 · Matthew Hoelscher (original photograph), Kaldari (crop), Papa Lima Whiskey (white balance adjustments)
- `atlantic-spotted-dolphin.jpg` — [iNaturalist photo 368451031](https://www.inaturalist.org/photos/368451031) · CC0 · no rights reserved
- `azure-vase-sponge.jpg` — [Callyspongia plicifera - azure vase sponge - Bay of Pigs - Cuba.jpg](https://commons.wikimedia.org/wiki/File:Callyspongia_plicifera_-_azure_vase_sponge_-_Bay_of_Pigs_-_Cuba.jpg) · CC BY 4.0 · Tisquesusa
- `balloonfish.jpg` — [Pez erizo de espinas largas (Diodon holocanthus), islas Ad Dimaniyat, Omán, 2024-08-13, DD 45.jpg](https://commons.wikimedia.org/wiki/File:Pez_erizo_de_espinas_largas_(Diodon_holocanthus),_islas_Ad_Dimaniyat,_Om%C3%A1n,_2024-08-13,_DD_45.jpg) · CC BY-SA 4.0 · Diego Delso
- `banded-butterflyfish.jpg` — [Chaetodon striatus Brasil.jpg](https://commons.wikimedia.org/wiki/File:Chaetodon_striatus_Brasil.jpg) · CC BY 2.5 · Bernard E. Picton
- `banded-coral-shrimp.jpg` — [Stenopus hispidus (MNHN-IU-2013-2654) (cropped).jpeg](https://commons.wikimedia.org/wiki/File:Stenopus_hispidus_(MNHN-IU-2013-2654)_(cropped).jpeg) · CC BY 4.0 · Corbari L.
- `bandtail-puffer.jpg` — [Bandtail puffer.jpg](https://commons.wikimedia.org/wiki/File:Bandtail_puffer.jpg) · CC BY-SA 3.0 · Rex shock Richard A. Ingebrigtsen
- `bar-jack.jpg` — [Caranx ruber 243924968.jpg](https://commons.wikimedia.org/wiki/File:Caranx_ruber_243924968.jpg) · CC BY 4.0 · Jay Brasher
- `barred-cardinalfish.jpg` — [iNaturalist photo 534417899](https://www.inaturalist.org/photos/534417899) · CC BY 4.0 · Uma Mezzanotte · cropped to 0.2,0.12,0.65,0.75 (left, top, width, height as fractions of the original)
- `barred-hamlet.jpg` — [Hypoplectrus puella.jpg](https://commons.wikimedia.org/wiki/File:Hypoplectrus_puella.jpg) · CC BY 2.0 · laszlo-photo
- `batwing-coral-crab.jpg` — [iNaturalist photo 58959386](https://www.inaturalist.org/photos/58959386) · CC BY-SA 4.0 · Matteo Cassella
- `beaded-sea-cucumber.jpg` — [iNaturalist photo 615453846](https://www.inaturalist.org/photos/615453846) · CC BY 4.0 · Dan Schofield
- `bearded-fireworm.jpg` — [iNaturalist photo 38059074](https://www.inaturalist.org/photos/38059074) · CC BY 4.0 · Rodrigo Canalli
- `beaugregory.jpg` — [iNaturalist photo 177914020](https://www.inaturalist.org/photos/177914020) · CC BY 4.0 · Tom Kennedy
- `belted-cardinalfish.jpg` — [iNaturalist photo 525221374](https://www.inaturalist.org/photos/525221374) · CC BY 4.0 · Pauline Walsh Jacobson
- `belted-sandfish.jpg` — [iNaturalist photo 155985779](https://www.inaturalist.org/photos/155985779) · CC BY 4.0 · Dan Schofield
- `bermuda-chub.jpg` — [iNaturalist photo 345577107](https://www.inaturalist.org/photos/345577107) · CC BY 4.0 · Dan Schofield
- `bicolor-damselfish.jpg` — [iNaturalist photo 360685555](https://www.inaturalist.org/photos/360685555) · CC BY 4.0 · desertnaturalist
- `black-coral.jpg` — [Antipathes dichotoma1.jpg](https://commons.wikimedia.org/wiki/File:Antipathes_dichotoma1.jpg) · CC BY-SA 3.0 · Anders Poulsen, Deep Blue (http://www.colours.dk/)
- `black-durgon.jpg` — [Melichthys niger (black durgon) (San Salvador Island, Bahamas) 2 (15983428930).jpg](https://commons.wikimedia.org/wiki/File:Melichthys_niger_(black_durgon)_(San_Salvador_Island,_Bahamas)_2_(15983428930).jpg) · CC BY 2.0 · James St. John · cropped to 0.08,0.12,0.84,0.76 (left, top, width, height as fractions of the original)
- `black-grouper.jpg` — [Mycteroperca bonaci.jpg](https://commons.wikimedia.org/wiki/File:Mycteroperca_bonaci.jpg) · CC BY 3.0 · Brian.gratwicke
- `black-hamlet.jpg` — [iNaturalist photo 343094947](https://www.inaturalist.org/photos/343094947) · CC BY 4.0 · Pauline Walsh Jacobson
- `black-margate.jpg` — [iNaturalist photo 571452363](https://www.inaturalist.org/photos/571452363) · CC BY 4.0 · Jay Brasher
- `black-sea-rod.jpg` — [iNaturalist photo 359192030](https://www.inaturalist.org/photos/359192030) · CC BY 4.0 · Jay Brasher
- `black-tunicate.jpg` — [iNaturalist photo 256268133](https://www.inaturalist.org/photos/256268133) · CC0 · no rights reserved
- `blackbar-soldierfish.jpg` — [Myripristis jacobus 8zz.jpg](https://commons.wikimedia.org/wiki/File:Myripristis_jacobus_8zz.jpg) · CC BY-SA 4.0 · Photo by David J. Stang
- `blackcap-basslet.jpg` — [iNaturalist photo 249499332](https://www.inaturalist.org/photos/249499332) · CC BY 4.0 · Pauline Walsh Jacobson · cropped to 0,0.08,1,0.92 (left, top, width, height as fractions of the original)
- `blade-fire-coral.jpg` — [iNaturalist photo 128232273](https://www.inaturalist.org/photos/128232273) · CC0 · no rights reserved
- `blue-angelfish.jpg` — [iNaturalist photo 161522638](https://www.inaturalist.org/photos/161522638) · CC BY 4.0 · Pauline Walsh Jacobson
- `blue-chromis.jpg` — [Chromis cyanea (46585332415).jpg](https://commons.wikimedia.org/wiki/File:Chromis_cyanea_(46585332415).jpg) · CC BY 2.0 · LASZLO ILYES from Cleveland, Ohio, USA · cropped to 0.05,0.10,0.80,0.80 (left, top, width, height as fractions of the original)
- `blue-dartfish.jpg` — [iNaturalist photo 211322893](https://www.inaturalist.org/photos/211322893) · CC BY-SA 4.0 · Cos
- `blue-parrotfish.jpg` — [iNaturalist photo 597019943](https://www.inaturalist.org/photos/597019943) · CC BY 4.0 · Dan Schofield
- `blue-runner.jpg` — [iNaturalist photo 39931914](https://www.inaturalist.org/photos/39931914) · CC BY 4.0 · Christine Loew
- `blue-tang.jpg` — [A. coeruleus.jpg](https://commons.wikimedia.org/wiki/File:A._coeruleus.jpg) · Public domain · Dr. Dwayne Meadows, NOAA · cropped to 0.10,0.05,0.75,0.80 (left, top, width, height as fractions of the original)
- `bluebell-tunicate.jpg` — [iNaturalist photo 261663014](https://www.inaturalist.org/photos/261663014) · CC BY 4.0 · Pauline Walsh Jacobson · cropped to 0,0,1,0.9 (left, top, width, height as fractions of the original)
- `bluehead-wrasse.jpg` — [Blue-Headed Wrasse (4387352722).jpg](https://commons.wikimedia.org/wiki/File:Blue-Headed_Wrasse_(4387352722).jpg) · CC BY 2.0 · Tony Hisgett from Birmingham, UK · cropped to 0.05,0.10,0.90,0.75 (left, top, width, height as fractions of the original)
- `bluelip-parrotfish.jpg` — [iNaturalist photo 325258503](https://www.inaturalist.org/photos/325258503) · CC BY 4.0 · Pauline Walsh Jacobson · cropped to 0,0.08,1,0.92 (left, top, width, height as fractions of the original)
- `bluestriped-grunt.jpg` — [Haemulon sciurus.jpg](https://commons.wikimedia.org/wiki/File:Haemulon_sciurus.jpg) · CC BY 2.0 · LASZLO ILYES (laszlo-photo) from Cleveland, Ohio, USA
- `boga.jpg` — [Boga (Haemulon vittatum) at cleaning station.jpg](https://commons.wikimedia.org/wiki/File:Boga_(Haemulon_vittatum)_at_cleaning_station.jpg) · CC BY-SA 4.0 · Mrh507
- `bottlenose-dolphin.jpg` — [Tursiops truncatus 01.jpg](https://commons.wikimedia.org/wiki/File:Tursiops_truncatus_01.jpg) · Public domain · NASA
- `boulder-brain-coral.jpg` — [iNaturalist photo 369396222](https://www.inaturalist.org/photos/369396222) · CC BY 4.0 · Alex Doyle
- `boulder-star-coral.jpg` — [Orbicella annularis (Montastraea annularis) 1.jpg](https://commons.wikimedia.org/wiki/File:Orbicella_annularis_(Montastraea_annularis)_1.jpg) · Public domain · NOAA
- `branching-anemone.jpg` — [iNaturalist photo 349894741](https://www.inaturalist.org/photos/349894741) · CC BY 4.0 · Robin White
- `branching-tube-sponge.jpg` — [iNaturalist photo 255671268](https://www.inaturalist.org/photos/255671268) · CC BY 4.0 · Robin White
- `branching-vase-sponge.jpg` — [Callyspongia vaginalis (Branching Vase Sponge - pink variation).jpg](https://commons.wikimedia.org/wiki/File:Callyspongia_vaginalis_(Branching_Vase_Sponge_-_pink_variation).jpg) · CC BY-SA 3.0 · Nhobgood (talk) Nick Hobgood
- `brazilian-reef-octopus.jpg` — [iNaturalist photo 59737507](https://www.inaturalist.org/photos/59737507) · CC BY 4.0 · Don Loarie
- `bridled-goby.jpg` — [iNaturalist photo 205591090](https://www.inaturalist.org/photos/205591090) · CC BY 4.0 · Pauline Walsh Jacobson
- `broadstripe-goby.jpg` — [iNaturalist photo 228053340](https://www.inaturalist.org/photos/228053340) · CC BY-SA 4.0 · Cos
- `brown-chromis.jpg` — [Azurina multilineata 345286514.jpg](https://commons.wikimedia.org/wiki/File:Azurina_multilineata_345286514.jpg) · CC BY 4.0 · Dan Schofield · cropped to 0.15,0.15,0.75,0.7 (left, top, width, height as fractions of the original)
- `brown-encrusting-octopus-sponge.jpg` — [iNaturalist photo 423624827](https://www.inaturalist.org/photos/423624827) · CC BY 4.0 · Alberto Alcalá
- `brown-tube-sponge.jpg` — [iNaturalist photo 255180481](https://www.inaturalist.org/photos/255180481) · CC BY 4.0 · Robin White
- `butter-hamlet.jpg` — [iNaturalist photo 233278091](https://www.inaturalist.org/photos/233278091) · CC BY 4.0 · Dan Schofield
- `caesar-grunt.jpg` — [iNaturalist photo 413658909](https://www.inaturalist.org/photos/413658909) · CC BY 4.0 · Jay Brasher
- `cannonball-jelly.jpg` — [iNaturalist photo 453167442](https://www.inaturalist.org/photos/453167442) · CC BY 4.0 · Karen Szafrajda · cropped to 0.3,0,0.65,0.85 (left, top, width, height as fractions of the original)
- `caribbean-neon-goby.jpg` — [iNaturalist photo 401223746](https://www.inaturalist.org/photos/401223746) · CC BY 4.0 · Pauline Walsh Jacobson
- `caribbean-reef-octopus.jpg` — [Night Moves (48885233693).jpg](https://commons.wikimedia.org/wiki/File:Night_Moves_(48885233693).jpg) · CC BY 2.0 · LASZLO ILYES from Cleveland, Ohio, USA
- `caribbean-reef-shark.jpg` — [Caribbean reef shark.jpg](https://commons.wikimedia.org/wiki/File:Caribbean_reef_shark.jpg) · CC BY-SA 3.0 · Albert kok
- `caribbean-reef-squid.jpg` — [Caribbean reef squid.jpg](https://commons.wikimedia.org/wiki/File:Caribbean_reef_squid.jpg) · Public domain
- `cayman-cleaning-goby.jpg` — [iNaturalist photo 610146576](https://www.inaturalist.org/photos/610146576) · CC BY 4.0 · Dan Schofield
- `cayman-sponge-goby.jpg` — [iNaturalist photo 251352968](https://www.inaturalist.org/photos/251352968) · CC BY 4.0 · Dan Schofield · cropped to 0.1,0.25,0.8,0.55 (left, top, width, height as fractions of the original)
- `cero.jpg` — [iNaturalist photo 738954386](https://www.inaturalist.org/photos/738954386) · CC BY 4.0 · Dan Schofield
- `chain-moray.jpg` — [Chain moray eel.jpg](https://commons.wikimedia.org/wiki/File:Chain_moray_eel.jpg) · CC BY-SA 4.0 · Atsme (Betty Wills)
- `chalk-bass.jpg` — [iNaturalist photo 233240099](https://www.inaturalist.org/photos/233240099) · CC BY 4.0 · Dan Schofield
- `channel-clinging-crab.jpg` — [Mithrax spinosissimus (Channel Clinging Crab - female).jpg](https://commons.wikimedia.org/wiki/File:Mithrax_spinosissimus_(Channel_Clinging_Crab_-_female).jpg) · CC BY-SA 3.0 · Nhobgood (talk) Nick Hobgood
- `cherubfish.jpg` — [iNaturalist photo 587623396](https://www.inaturalist.org/photos/587623396) · CC0 · no rights reserved · cropped to 0.22,0.1,0.56,0.62 (left, top, width, height as fractions of the original)
- `christmas-tree-hydroid.jpg` — [iNaturalist photo 4455689](https://www.inaturalist.org/photos/4455689) · CC0 · no rights reserved
- `christmas-tree-worm.jpg` — [Christmas tree worm (Spirobranchus giganteus).jpg](https://commons.wikimedia.org/wiki/File:Christmas_tree_worm_(Spirobranchus_giganteus).jpg) · Public domain · James Guttuso.
- `cleaning-goby.jpg` — [iNaturalist photo 289310722](https://www.inaturalist.org/photos/289310722) · CC BY 4.0 · Robin White
- `clown-wrasse.jpg` — [iNaturalist photo 151005430](https://www.inaturalist.org/photos/151005430) · CC BY 4.0 · Jay Brasher
- `cobia.jpg` — [iNaturalist photo 59256179](https://www.inaturalist.org/photos/59256179) · CC BY-SA 4.0 · Matteo Cassella
- `cocoa-damselfish.jpg` — [iNaturalist photo 176932354](https://www.inaturalist.org/photos/176932354) · CC BY 4.0 · Pauline Walsh Jacobson
- `colon-goby.jpg` — [iNaturalist photo 615005018](https://www.inaturalist.org/photos/615005018) · CC BY 4.0 · Dan Schofield
- `common-sea-fan.jpg` — [Seafanpurp.jpg](https://commons.wikimedia.org/wiki/File:Seafanpurp.jpg) · CC BY-SA 4.0 · Betty Wills
- `common-snook.jpg` — [iNaturalist photo 620844629](https://www.inaturalist.org/photos/620844629) · CC BY 4.0 · Matteo Bellucci · cropped to 0.12,0.25,0.7,0.6 (left, top, width, height as fractions of the original)
- `coney.jpg` — [Cephalopholis fulva.jpg](https://commons.wikimedia.org/wiki/File:Cephalopholis_fulva.jpg) · Public domain · NOAA
- `corkscrew-anemone.jpg` — [iNaturalist photo 709687103](https://www.inaturalist.org/photos/709687103) · CC BY 4.0 · Matteo Bellucci
- `corky-sea-finger.jpg` — [iNaturalist photo 349600138](https://www.inaturalist.org/photos/349600138) · CC BY 4.0 · Jay Brasher
- `cottonwick.jpg` — [iNaturalist photo 162096984](https://www.inaturalist.org/photos/162096984) · CC BY 4.0 · Pauline Walsh Jacobson
- `creole-wrasse.jpg` — [Reef1614 - Flickr - NOAA Photo Library.jpg](https://commons.wikimedia.org/wiki/File:Reef1614_-_Flickr_-_NOAA_Photo_Library.jpg) · Public domain · Dr. Dwayne Meadows, NOAA/NMFS/OPR.
- `creolefish.jpg` — [iNaturalist photo 152224549](https://www.inaturalist.org/photos/152224549) · CC BY 4.0 · Jay Brasher
- `crevalle-jack.jpg` — [iNaturalist photo 475712483](https://www.inaturalist.org/photos/475712483) · CC0 · no rights reserved
- `cubera-snapper.jpg` — [Lutjanus cyanopterus.jpg](https://commons.wikimedia.org/wiki/File:Lutjanus_cyanopterus.jpg) · CC0 · Henrya · cropped to 0.00,0.25,0.75,0.65 (left, top, width, height as fractions of the original)
- `cushion-sea-star.jpg` — [Oreaster reticulatus (Cushion Sea Star).jpg](https://commons.wikimedia.org/wiki/File:Oreaster_reticulatus_(Cushion_Sea_Star).jpg) · CC BY-SA 3.0 · Nhobgood Nick Hobgood
- `doctorfish.jpg` — [iNaturalist photo 271292361](https://www.inaturalist.org/photos/271292361) · CC BY 4.0 · Dan Schofield
- `dog-snapper.jpg` — [Lutjanus jocu Belize.jpg](https://commons.wikimedia.org/wiki/File:Lutjanus_jocu_Belize.jpg) · CC BY 4.0 · erichabisch · cropped to 0.12,0.02,0.78,0.78 (left, top, width, height as fractions of the original)
- `donkey-dung-sea-cucumber.jpg` — [Reef1075 - Flickr - NOAA Photo Library.jpg](https://commons.wikimedia.org/wiki/File:Reef1075_-_Flickr_-_NOAA_Photo_Library.jpg) · Public domain · Becky A. Dayhuff, Environmental Educator.
- `dushia-flabellina.jpg` — [Flabellina dushia 289358174.jpg](https://commons.wikimedia.org/wiki/File:Flabellina_dushia_289358174.jpg) · CC BY 4.0 · Pauline Walsh Jacobson · cropped to 0,0.08,1,0.92 (left, top, width, height as fractions of the original)
- `dusky-damselfish.jpg` — [iNaturalist photo 660112572](https://www.inaturalist.org/photos/660112572) · CC BY 4.0 · Pauline Walsh Jacobson
- `dusky-squirrelfish.jpg` — [iNaturalist photo 608997837](https://www.inaturalist.org/photos/608997837) · CC BY 4.0 · Jan Ebr & Ivana Ebrová
- `elkhorn-coral.jpg` — [Elkhorn coral.jpg](https://commons.wikimedia.org/wiki/File:Elkhorn_coral.jpg) · Public domain
- `encrusting-gorgonian.jpg` — [iNaturalist photo 384010807](https://www.inaturalist.org/photos/384010807) · CC BY 4.0 · Robin White
- `feather-duster-worm.jpg` — [Sabellastarte magnifica (Magnificent feather duster worm).jpg](https://commons.wikimedia.org/wiki/File:Sabellastarte_magnifica_(Magnificent_feather_duster_worm).jpg) · CC BY-SA 3.0 · Nhobgood Nick Hobgood
- `finger-coral.jpg` — [Porites porites porites (clubbed finger coral) (San Salvador Island, Bahamas) 5 (16066417536).jpg](https://commons.wikimedia.org/wiki/File:Porites_porites_porites_(clubbed_finger_coral)_(San_Salvador_Island,_Bahamas)_5_(16066417536).jpg) · CC BY 2.0 · James St. John
- `fire-coral.jpg` — [Millepora alcicornis 338801632.jpg](https://commons.wikimedia.org/wiki/File:Millepora_alcicornis_338801632.jpg) · CC BY 4.0 · Pauline Walsh Jacobson
- `flagfin-mojarra.jpg` — [Eucinostomus melanopterus 325784184.jpg](https://commons.wikimedia.org/wiki/File:Eucinostomus_melanopterus_325784184.jpg) · CC0 · Adrian Torres B.
- `flame-box-crab.jpg` — [iNaturalist photo 327890453](https://www.inaturalist.org/photos/327890453) · CC BY 4.0 · Pauline Walsh Jacobson · cropped to 0,0.08,1,0.92 (left, top, width, height as fractions of the original)
- `flamefish.jpg` — [iNaturalist photo 244066201](https://www.inaturalist.org/photos/244066201) · CC BY 4.0 · Pauline Walsh Jacobson
- `flamingo-tongue.jpg` — [Cyphoma gibbosum (living) 2.jpg](https://commons.wikimedia.org/wiki/File:Cyphoma_gibbosum_(living)_2.jpg) · CC BY 2.0 · LASZLO ILYES (laszlo-photo) from Cleveland, Ohio, USA
- `florida-horse-conch.jpg` — [Pleuroploca gigantea.jpg](https://commons.wikimedia.org/wiki/File:Pleuroploca_gigantea.jpg) · Public domain · Heather Dine - Florida Keys NMS
- `foureye-butterflyfish.jpg` — [Chaetodon capistratus1.jpg](https://commons.wikimedia.org/wiki/File:Chaetodon_capistratus1.jpg) · Public domain · Photographer: Chris Huss Credit: Florida Keys National Marine Sanctuary
- `french-angelfish.jpg` — [Pomacanthus paru.jpg](https://commons.wikimedia.org/wiki/File:Pomacanthus_paru.jpg) · CC BY 2.0 · LASZLO ILYES (laszlo-photo) from Cleveland, Ohio, USA
- `french-grunt.jpg` — [Haemulon flavolineatum French grunt.jpg](https://commons.wikimedia.org/wiki/File:Haemulon_flavolineatum_French_grunt.jpg) · CC BY 2.0 · Brian Gratwicke
- `gag.jpg` — [MycteropercaMicrolepis.jpg](https://commons.wikimedia.org/wiki/File:MycteropercaMicrolepis.jpg) · Public domain · T. Potts
- `garden-eel.jpg` — [Brown Garden Eel - Heteroconger longissimus.jpg](https://commons.wikimedia.org/wiki/File:Brown_Garden_Eel_-_Heteroconger_longissimus.jpg) · CC BY-SA 2.0 · Francois Libert
- `giant-anemone.jpg` — [Condylactis gigantea (Giant Anemone) red base.jpg](https://commons.wikimedia.org/wiki/File:Condylactis_gigantea_(Giant_Anemone)_red_base.jpg) · CC BY-SA 3.0 · Nhobgood Nick Hobgood
- `giant-barrel-sponge.jpg` — [Shooting Fish in a Barrel (48885969722).jpg](https://commons.wikimedia.org/wiki/File:Shooting_Fish_in_a_Barrel_(48885969722).jpg) · CC BY 2.0 · LASZLO ILYES from Cleveland, Ohio, USA
- `giant-basket-star.jpg` — [Astrophyton muricatum FLMNH.jpg](https://commons.wikimedia.org/wiki/File:Astrophyton_muricatum_FLMNH.jpg) · CC BY-SA 4.0 · François Michonneau
- `giant-hermit-crab.jpg` — [iNaturalist photo 218067986](https://www.inaturalist.org/photos/218067986) · CC BY 4.0 · Susan Aide
- `glasseye-snapper.jpg` — [Priacanthus cruentatus.jpg](https://commons.wikimedia.org/wiki/File:Priacanthus_cruentatus.jpg) · CC BY 2.0 · LASZLO ILYES (laszlo-photo) from Cleveland, Ohio, USA
- `glassy-sweeper.jpg` — [Glassy sweepers.jpg](https://commons.wikimedia.org/wiki/File:Glassy_sweepers.jpg) · Public domain · NOAA
- `golden-coral-shrimp.jpg` — [iNaturalist photo 168246356](https://www.inaturalist.org/photos/168246356) · CC BY 4.0 · Pauline Walsh Jacobson · cropped to 0,0,1,0.9 (left, top, width, height as fractions of the original)
- `golden-crinoid.jpg` — [iNaturalist photo 205998198](https://www.inaturalist.org/photos/205998198) · CC BY 4.0 · Donald Davesne
- `goldentail-moray.jpg` — [Gymnothorax miliaris (goldentail moray eel) (San Salvador Island, Bahamas) 1 (15983831850).jpg](https://commons.wikimedia.org/wiki/File:Gymnothorax_miliaris_(goldentail_moray_eel)_(San_Salvador_Island,_Bahamas)_1_(15983831850).jpg) · CC BY 2.0 · James St. John
- `goldspot-goby.jpg` — [iNaturalist photo 455313586](https://www.inaturalist.org/photos/455313586) · CC BY 4.0 · Donald Davesne · cropped to 0.1,0.2,0.75,0.65 (left, top, width, height as fractions of the original)
- `goliath-grouper.jpg` — [Itajara.JPG](https://commons.wikimedia.org/wiki/File:Itajara.JPG) · CC BY-SA 3.0 · Albert kok
- `gray-angelfish.jpg` — [Pomacanthus arcuatus 109580400.jpg](https://commons.wikimedia.org/wiki/File:Pomacanthus_arcuatus_109580400.jpg) · CC0 · Zygy
- `gray-snapper.jpg` — [Grey snapper - Lutjanus griseus.jpg](https://commons.wikimedia.org/wiki/File:Grey_snapper_-_Lutjanus_griseus.jpg) · CC BY 2.0 · Clinton & Charles Robertson from Del Rio, Texas & San Marcos, TX, USA
- `gray-triggerfish.jpg` — [iNaturalist photo 423368130](https://www.inaturalist.org/photos/423368130) · CC BY 4.0 · Ben Jobson
- `graysby.jpg` — [Cephalopholis cruentata (33623928198).jpg](https://commons.wikimedia.org/wiki/File:Cephalopholis_cruentata_(33623928198).jpg) · CC BY 2.0 · LASZLO ILYES from Cleveland, Ohio, USA
- `great-barracuda.jpg` — [Barracuda laban.jpg](https://commons.wikimedia.org/wiki/File:Barracuda_laban.jpg) · Public domain
- `great-star-coral.jpg` — [Montastraea cavernosa.jpg](https://commons.wikimedia.org/wiki/File:Montastraea_cavernosa.jpg) · Public domain
- `greater-amberjack.jpg` — [iNaturalist photo 56596097](https://www.inaturalist.org/photos/56596097) · CC BY-SA 4.0 · Robert Webster
- `greater-soapfish.jpg` — [iNaturalist photo 695770340](https://www.inaturalist.org/photos/695770340) · CC BY 4.0 · Jay Brasher
- `green-clinging-crab.jpg` — [iNaturalist photo 581380502](https://www.inaturalist.org/photos/581380502) · CC BY 4.0 · Jan Ebr & Ivana Ebrová
- `green-finger-sponge.jpg` — [iNaturalist photo 256673483](https://www.inaturalist.org/photos/256673483) · CC BY 4.0 · Jay Brasher
- `green-moray.jpg` — [Green Moray (Gymnothorax funebris) - Sponge Forest Reef, Curaçao N.A.jpg](https://commons.wikimedia.org/wiki/File:Green_Moray_(Gymnothorax_funebris)_-_Sponge_Forest_Reef,_Cura%C3%A7ao_N.A.jpg) · CC BY 2.0 · LASZLO ILYES from Cleveland, Ohio, USA
- `green-razorfish.jpg` — [iNaturalist photo 168246973](https://www.inaturalist.org/photos/168246973) · CC BY 4.0 · Pauline Walsh Jacobson
- `green-sea-turtle.jpg` — [Swimming with Turtles.JPG](https://commons.wikimedia.org/wiki/File:Swimming_with_Turtles.JPG) · CC BY-SA 4.0 · Cbrookes81
- `grooved-brain-coral.jpg` — [Brain coral.jpg](https://commons.wikimedia.org/wiki/File:Brain_coral.jpg) · Public domain
- `hairy-blenny.jpg` — [iNaturalist photo 76249175](https://www.inaturalist.org/photos/76249175) · CC BY 4.0 · Eridan Xharahi
- `harlequin-bass.jpg` — [iNaturalist photo 288167779](https://www.inaturalist.org/photos/288167779) · CC BY 4.0 · Pauline Walsh Jacobson
- `hawksbill-turtle.jpg` — [Tortuga carey (Eretmochelys imbricata), parque nacional Ras Muhammad, Egipto, 2022-03-28, DD 56.jpg](https://commons.wikimedia.org/wiki/File:Tortuga_carey_(Eretmochelys_imbricata),_parque_nacional_Ras_Muhammad,_Egipto,_2022-03-28,_DD_56.jpg) · CC BY-SA 4.0 · Diego Delso
- `highhat.jpg` — [iNaturalist photo 323849964](https://www.inaturalist.org/photos/323849964) · CC BY 4.0 · Pauline Walsh Jacobson
- `hogfish.jpg` — [Lachnolaimus maximus juvenile.jpg](https://commons.wikimedia.org/wiki/File:Lachnolaimus_maximus_juvenile.jpg) · CC BY 2.0 · LASZLO ILYES (laszlo-photo) from Cleveland, Ohio, USA
- `honeycomb-cowfish.jpg` — [Lactophrys polygonia.jpg](https://commons.wikimedia.org/wiki/File:Lactophrys_polygonia.jpg) · Public domain · Jan Derk
- `horse-eye-jack.jpg` — [Paardmakreel.jpg](https://commons.wikimedia.org/wiki/File:Paardmakreel.jpg) · CC BY-SA 3.0 · Albert kok
- `hovering-dartfish.jpg` — [iNaturalist photo 346694375](https://www.inaturalist.org/photos/346694375) · CC BY 4.0 · Pauline Walsh Jacobson · cropped to 0,0,1,0.88 (left, top, width, height as fractions of the original)
- `humpback-whale.jpg` — [iNaturalist photo 344677883](https://www.inaturalist.org/photos/344677883) · CC BY 4.0 · Juan Cruzado Cortés
- `indigo-hamlet.jpg` — [Indigo Hamlet.JPG](https://commons.wikimedia.org/wiki/File:Indigo_Hamlet.JPG) · CC BY-SA 3.0 · Tomh009
- `knobby-brain-coral.jpg` — [iNaturalist photo 710420947](https://www.inaturalist.org/photos/710420947) · CC BY 4.0 · Michael Cantillo
- `lamarcks-sheet-coral.jpg` — [iNaturalist photo 262206822](https://www.inaturalist.org/photos/262206822) · CC BY 4.0 · Roger Rittmaster
- `lane-snapper.jpg` — [iNaturalist photo 308148027](https://www.inaturalist.org/photos/308148027) · CC BY 4.0 · Pauline Walsh Jacobson
- `lantern-bass.jpg` — [iNaturalist photo 110845871](https://www.inaturalist.org/photos/110845871) · CC BY 4.0 · Bernard Picton
- `lavender-rope-sponge.jpg` — [iNaturalist photo 241788274](https://www.inaturalist.org/photos/241788274) · CC BY 4.0 · Robin White
- `leatherback-sea-turtle.jpg` — [iNaturalist photo 60970251](https://www.inaturalist.org/photos/60970251) · CC BY 4.0 · RJ Baltierra
- `lemon-shark.jpg` — [Lemonshark.jpg](https://commons.wikimedia.org/wiki/File:Lemonshark.jpg) · CC BY-SA 3.0 · Albert kok
- `lesser-starlet-coral.jpg` — [iNaturalist photo 186948029](https://www.inaturalist.org/photos/186948029) · CC BY 4.0 · Alexis Tinker-Tsavalas
- `lettuce-coral.jpg` — [Agarica agaricites (Scaled Lettuce Coral) closeup.jpg](https://commons.wikimedia.org/wiki/File:Agarica_agaricites_(Scaled_Lettuce_Coral)_closeup.jpg) · CC BY-SA 3.0 · Nhobgood Nick Hobgood
- `lettuce-sea-slug.jpg` — [Elysia crispata (Lettuce Sea Slug).jpg](https://commons.wikimedia.org/wiki/File:Elysia_crispata_(Lettuce_Sea_Slug).jpg) · CC BY-SA 3.0 · Nhobgood (talk) Nick Hobgood · cropped to 0.17,0.24,0.6,0.6 (left, top, width, height as fractions of the original)
- `lionfish.jpg` — [Pterois volitans (Lionfish - Caribbean invasive).jpg](https://commons.wikimedia.org/wiki/File:Pterois_volitans_(Lionfish_-_Caribbean_invasive).jpg) · CC BY-SA 3.0 · Nhobgood (talk) Nick Hobgood
- `loggerhead-turtle.jpg` — [Loggerhead turtle off the coast of San Pedro Belize.jpg](https://commons.wikimedia.org/wiki/File:Loggerhead_turtle_off_the_coast_of_San_Pedro_Belize.jpg) · CC BY-SA 4.0 · MarAlliance2018
- `long-spined-urchin.jpg` — [Diadema antillarum in Bahamas.jpg](https://commons.wikimedia.org/wiki/File:Diadema_antillarum_in_Bahamas.jpg) · CC BY-SA 2.0 · Greg Grimes
- `longfin-damselfish.jpg` — [iNaturalist photo 123691422](https://www.inaturalist.org/photos/123691422) · CC0 · no rights reserved
- `longjaw-squirrelfish.jpg` — [iNaturalist photo 334195096](https://www.inaturalist.org/photos/334195096) · CC BY 4.0 · Dan Schofield
- `longlure-frogfish.jpg` — [Longlure frogfish (Antennarius multiocellatus) twitching lure.jpg](https://commons.wikimedia.org/wiki/File:Longlure_frogfish_(Antennarius_multiocellatus)_twitching_lure.jpg) · CC BY-SA 4.0 · Betty Wills
- `longsnout-butterflyfish.jpg` — [Prognathodes aculeatus 179115082.jpg](https://commons.wikimedia.org/wiki/File:Prognathodes_aculeatus_179115082.jpg) · CC BY 4.0 · Dan Schofield
- `longsnout-seahorse.jpg` — [Hippocampus reidi 239712002.jpg](https://commons.wikimedia.org/wiki/File:Hippocampus_reidi_239712002.jpg) · CC BY 4.0 · Pauline Walsh Jacobson · cropped to 0,0,1,0.92 (left, top, width, height as fractions of the original)
- `longspine-squirrelfish.jpg` — [iNaturalist photo 487226222](https://www.inaturalist.org/photos/487226222) · CC BY 4.0 · Dan Schofield
- `lumpy-overgrowing-sponge.jpg` — [iNaturalist photo 325836400](https://www.inaturalist.org/photos/325836400) · CC BY 4.0 · Jay Brasher
- `mahogany-snapper.jpg` — [Mahogany snapper Lutjanus mahogoni (3458475349).jpg](https://commons.wikimedia.org/wiki/File:Mahogany_snapper_Lutjanus_mahogoni_(3458475349).jpg) · CC BY 2.0 · Paul Asman and Jill Lenoble
- `manatee.jpg` — [Manatee photo.jpg](https://commons.wikimedia.org/wiki/File:Manatee_photo.jpg) · Public domain · NASA
- `masked-goby.jpg` — [iNaturalist photo 312867985](https://www.inaturalist.org/photos/312867985) · CC BY 4.0 · Dan Schofield
- `masked-hamlet.jpg` — [iNaturalist photo 153408068](https://www.inaturalist.org/photos/153408068) · CC BY 4.0 · marique
- `massive-starlet-coral.jpg` — [iNaturalist photo 373538082](https://www.inaturalist.org/photos/373538082) · CC BY 4.0 · Alex Doyle
- `maze-coral.jpg` — [Meandrina meandrites (Maze Coral).jpg](https://commons.wikimedia.org/wiki/File:Meandrina_meandrites_(Maze_Coral).jpg) · CC BY-SA 3.0 · Nhobgood Nick Hobgood
- `midnight-parrotfish.jpg` — [Midnight parrotfish.jpg](https://commons.wikimedia.org/wiki/File:Midnight_parrotfish.jpg) · Public domain
- `moon-jelly.jpg` — [160514-N-WX059-102 (28603110823).jpg](https://commons.wikimedia.org/wiki/File:160514-N-WX059-102_(28603110823).jpg) · Public domain · National Museum of the U.S. Navy · cropped to 0.38,0,0.62,0.62 (left, top, width, height as fractions of the original)
- `mountainous-star-coral.jpg` — [Orbicella faveolata (Montastraea faveolata), pólipos abiertos.jpg](https://commons.wikimedia.org/wiki/File:Orbicella_faveolata_(Montastraea_faveolata),_p%C3%B3lipos_abiertos.jpg) · Public domain · NOAA
- `mustard-hill-coral.jpg` — [Porites astreoides (mustard hill coral) (San Salvador Island, Bahamas) 11 (15478473983).jpg](https://commons.wikimedia.org/wiki/File:Porites_astreoides_(mustard_hill_coral)_(San_Salvador_Island,_Bahamas)_11_(15478473983).jpg) · CC BY 2.0 · James St. John
- `mutton-snapper.jpg` — [Pargo criollo (Lutjanus analis), Cozumel, México, 2025-12-20, DD 139.jpg](https://commons.wikimedia.org/wiki/File:Pargo_criollo_(Lutjanus_analis),_Cozumel,_M%C3%A9xico,_2025-12-20,_DD_139.jpg) · CC BY-SA 4.0 · Diego Delso
- `nassau-grouper.jpg` — [Nassaubaars.jpg](https://commons.wikimedia.org/wiki/File:Nassaubaars.jpg) · CC BY-SA 3.0 · Albert Kok at Dutch Wikipedia (Original text: albert kok)
- `neon-goby.jpg` — [iNaturalist photo 238158253](https://www.inaturalist.org/photos/238158253) · CC BY 4.0 · Pauline Walsh Jacobson
- `netted-barrel-sponge.jpg` — [iNaturalist photo 333892809](https://www.inaturalist.org/photos/333892809) · CC BY 4.0 · Robin White
- `night-sergeant.jpg` — [iNaturalist photo 585421923](https://www.inaturalist.org/photos/585421923) · CC BY 4.0 · Jan Ebr & Ivana Ebrová
- `nimble-spray-crab.jpg` — [iNaturalist photo 462022705](https://www.inaturalist.org/photos/462022705) · CC BY 4.0 · Alberto Alcalá · cropped to 0.05,0.3,0.95,0.65 (left, top, width, height as fractions of the original)
- `nurse-shark.jpg` — [Nurse shark.jpg](https://commons.wikimedia.org/wiki/File:Nurse_shark.jpg) · Public domain
- `ocean-surgeonfish.jpg` — [iNaturalist photo 415505249](https://www.inaturalist.org/photos/415505249) · CC BY 4.0 · Pauline Walsh Jacobson
- `ocean-triggerfish.jpg` — [Canthidermis sufflamen (ocean triggerfish) (San Salvador Island, Bahamas) 1 (15965263309).jpg](https://commons.wikimedia.org/wiki/File:Canthidermis_sufflamen_(ocean_triggerfish)_(San_Salvador_Island,_Bahamas)_1_(15965263309).jpg) · CC BY 2.0 · James St. John
- `orange-cup-coral.jpg` — [iNaturalist photo 701831099](https://www.inaturalist.org/photos/701831099) · CC BY 4.0 · Slunky
- `orange-elephant-ear-sponge.jpg` — [Agelas clathrodes 256774245.jpg](https://commons.wikimedia.org/wiki/File:Agelas_clathrodes_256774245.jpg) · CC BY 4.0 · Jay Brasher
- `orangeclaw-hermit-crab.jpg` — [iNaturalist photo 624254299](https://www.inaturalist.org/photos/624254299) · CC BY 4.0 · Dan Schofield
- `orangespotted-filefish.jpg` — [iNaturalist photo 706538609](https://www.inaturalist.org/photos/706538609) · CC BY 4.0 · Donald Davesne · cropped to 0.3,0.25,0.5,0.5 (left, top, width, height as fractions of the original)
- `pallid-goby.jpg` — [iNaturalist photo 356852003](https://www.inaturalist.org/photos/356852003) · CC BY 4.0 · desertnaturalist
- `peacock-flounder.jpg` — [Bothus lunatus.jpg](https://commons.wikimedia.org/wiki/File:Bothus_lunatus.jpg) · Public domain · Becky A. Dayhuff, Environmental Educator
- `pederson-cleaner-shrimp.jpg` — [Ancylomenes pedersoni 402186205.jpg](https://commons.wikimedia.org/wiki/File:Ancylomenes_pedersoni_402186205.jpg) · CC BY 4.0 · Pauline Walsh Jacobson
- `peppermint-goby.jpg` — [iNaturalist photo 594713412](https://www.inaturalist.org/photos/594713412) · CC BY 4.0 · Pauline Walsh Jacobson
- `permit-fish.jpg` — [Trachinotus falcatus.jpg](https://commons.wikimedia.org/wiki/File:Trachinotus_falcatus.jpg) · CC BY 3.0 · Brian.gratwicke
- `pillar-coral.jpg` — [Dendrogyra cylindrus, Culebra.jpg](https://commons.wikimedia.org/wiki/File:Dendrogyra_cylindrus,_Culebra.jpg) · CC BY 2.0 · Thomas Shahan
- `pink-meanie.jpg` — [iNaturalist photo 427887198](https://www.inaturalist.org/photos/427887198) · CC BY 4.0 · Rachel Crane
- `pink-vase-sponge.jpg` — [iNaturalist photo 182177306](https://www.inaturalist.org/photos/182177306) · CC0 · no rights reserved
- `pitted-sponge.jpg` — [iNaturalist photo 300454752](https://www.inaturalist.org/photos/300454752) · CC BY 4.0 · Matt Muir
- `porcupinefish.jpg` — [Der Gepunktete oder Gewöhnliche Igelfisch (Diodon hystrix) DSCF3721BE.jpg](https://commons.wikimedia.org/wiki/File:Der_Gepunktete_oder_Gew%C3%B6hnliche_Igelfisch_(Diodon_hystrix)_DSCF3721BE.jpg) · CC BY-SA 4.0 · Kora27
- `porkfish.jpg` — [Anisotremus virginicus photo.jpg](https://commons.wikimedia.org/wiki/File:Anisotremus_virginicus_photo.jpg) · CC BY-SA 3.0 · cralize
- `portuguese-man-o-war.jpg` — [iNaturalist photo 544306293](https://www.inaturalist.org/photos/544306293) · CC BY 4.0 · Jan Ebr & Ivana Ebrová
- `princess-parrotfish.jpg` — [Scarus taeniopterus.jpg](https://commons.wikimedia.org/wiki/File:Scarus_taeniopterus.jpg) · CC BY 2.0 · LASZLO ILYES (laszlo-photo) from Cleveland, Ohio, USA
- `puddingwife.jpg` — [iNaturalist photo 595261902](https://www.inaturalist.org/photos/595261902) · CC BY 4.0 · Pauline Walsh Jacobson
- `purple-reeffish.jpg` — [iNaturalist photo 239707466](https://www.inaturalist.org/photos/239707466) · CC BY 4.0 · Pauline Walsh Jacobson
- `queen-angelfish.jpg` — [Holacanthus cilliaris.jpg](https://commons.wikimedia.org/wiki/File:Holacanthus_cilliaris.jpg) · Public domain · Haplochromis at German Wikipedia
- `queen-conch.jpg` — [Lobatus gigas 2.jpg](https://commons.wikimedia.org/wiki/File:Lobatus_gigas_2.jpg) · Public domain · NOAA
- `queen-parrotfish.jpg` — [Queen parrotfish Scarus vetula (4658271432).jpg](https://commons.wikimedia.org/wiki/File:Queen_parrotfish_Scarus_vetula_(4658271432).jpg) · CC BY 2.0 · Paul Asman and Jill Lenoble
- `queen-triggerfish.jpg` — [Balistes vetula (queen triggerfish) (San Salvador Island, Bahamas) 4 (16151145845).jpg](https://commons.wikimedia.org/wiki/File:Balistes_vetula_(queen_triggerfish)_(San_Salvador_Island,_Bahamas)_4_(16151145845).jpg) · CC BY 2.0 · James St. John
- `ragged-sea-hare.jpg` — [iNaturalist photo 354913755](https://www.inaturalist.org/photos/354913755) · CC BY 4.0 · libby hepburn
- `rainbow-parrotfish.jpg` — [Rainbow parrotfish.jpg](https://commons.wikimedia.org/wiki/File:Rainbow_parrotfish.jpg) · CC BY 2.0 · Paul Asman and Jill Lenoble
- `red-boring-sponge.jpg` — [iNaturalist photo 59198794](https://www.inaturalist.org/photos/59198794) · CC BY-SA 4.0 · Matteo Cassella
- `red-grouper.jpg` — [Epinephelus morio in Madagascar Reef.jpg](https://commons.wikimedia.org/wiki/File:Epinephelus_morio_in_Madagascar_Reef.jpg) · CC BY 4.0 · Simões, N.; Zarco Perello, S.; Moreno Mendoza, R.
- `red-hind.jpg` — [iNaturalist photo 684967475](https://www.inaturalist.org/photos/684967475) · CC0 · no rights reserved
- `red-reef-hermit.jpg` — [iNaturalist photo 253492468](https://www.inaturalist.org/photos/253492468) · CC BY 4.0 · Dan Schofield
- `red-rope-sponge.jpg` — [Haliclona rubens.jpg](https://commons.wikimedia.org/wiki/File:Haliclona_rubens.jpg) · CC BY 2.0 · James St. John
- `redband-parrotfish.jpg` — [Sparisoma aurofrenatum.jpg](https://commons.wikimedia.org/wiki/File:Sparisoma_aurofrenatum.jpg) · CC BY 2.0 · LASZLO ILYES (laszlo-photo) from Cleveland, Ohio, USA
- `redlip-blenny.jpg` — [Ophioblennius macclurei (Redlip Blenny).jpg](https://commons.wikimedia.org/wiki/File:Ophioblennius_macclurei_(Redlip_Blenny).jpg) · CC BY-SA 3.0 · Nhobgood Nick Hobgood
- `redspotted-hawkfish.jpg` — [iNaturalist photo 59085679](https://www.inaturalist.org/photos/59085679) · CC BY-SA 4.0 · Matteo Cassella
- `redtail-parrotfish.jpg` — [iNaturalist photo 697922145](https://www.inaturalist.org/photos/697922145) · CC BY 4.0 · Pauline Walsh Jacobson
- `reef-butterflyfish.jpg` — [Chaetodon sedentarius Brasil.jpg](https://commons.wikimedia.org/wiki/File:Chaetodon_sedentarius_Brasil.jpg) · CC BY 2.5 · Bernard E. Picton
- `reef-urchin.jpg` — [iNaturalist photo 615456784](https://www.inaturalist.org/photos/615456784) · CC BY 4.0 · Dan Schofield
- `remora.jpg` — [Echeneis naucrates - Reef1980.jpg](https://commons.wikimedia.org/wiki/File:Echeneis_naucrates_-_Reef1980.jpg) · CC BY 2.0 · NOAA Photo Library
- `rock-beauty.jpg` — [Holacanthus tricolor 1.jpg](https://commons.wikimedia.org/wiki/File:Holacanthus_tricolor_1.jpg) · CC BY 2.0 · Laszlo Ilyes (laszlo-photo) from Cleveland, Ohio, USA
- `rock-boring-urchin.jpg` — [iNaturalist photo 546984642](https://www.inaturalist.org/photos/546984642) · CC BY 4.0 · Thomas Irvine
- `rock-hind.jpg` — [Rock hind Epinephelus adscensionis (2413645734).jpg](https://commons.wikimedia.org/wiki/File:Rock_hind_Epinephelus_adscensionis_(2413645734).jpg) · CC BY 2.0 · Paul Asman and Jill Lenoble · cropped to 0.1,0.35,0.7,0.6 (left, top, width, height as fractions of the original)
- `rose-coral.jpg` — [iNaturalist photo 382114898](https://www.inaturalist.org/photos/382114898) · CC BY 4.0 · Robin White
- `rosy-razorfish.jpg` — [iNaturalist photo 253547859](https://www.inaturalist.org/photos/253547859) · CC BY 4.0 · Dan Schofield
- `roughhead-blenny.jpg` — [iNaturalist photo 228615436](https://www.inaturalist.org/photos/228615436) · CC BY 4.0 · Dan Schofield · cropped to 0.15,0,0.85,0.85 (left, top, width, height as fractions of the original)
- `round-scad.jpg` — [iNaturalist photo 260443228](https://www.inaturalist.org/photos/260443228) · CC0 · no rights reserved
- `row-pore-rope-sponge.jpg` — [iNaturalist photo 457034472](https://www.inaturalist.org/photos/457034472) · CC BY 4.0 · Jay Brasher
- `royal-gramma.jpg` — [Gramma loreto 257593008.jpg](https://commons.wikimedia.org/wiki/File:Gramma_loreto_257593008.jpg) · CC BY 4.0 · Dan Schofield
- `saddled-blenny.jpg` — [iNaturalist photo 243381340](https://www.inaturalist.org/photos/243381340) · CC BY 4.0 · Pauline Walsh Jacobson
- `sailfin-blenny.jpg` — [iNaturalist photo 300103059](https://www.inaturalist.org/photos/300103059) · CC BY 4.0 · Dan Schofield
- `sailors-choice.jpg` — [iNaturalist photo 137466725](https://www.inaturalist.org/photos/137466725) · CC BY 4.0 · jeyre
- `sand-diver.jpg` — [Synodus intermedius.jpg](https://commons.wikimedia.org/wiki/File:Synodus_intermedius.jpg) · CC BY 2.0 · LASZLO ILYES (laszlo-photo) from Cleveland, Ohio, USA
- `sand-perch.jpg` — [iNaturalist photo 390037829](https://www.inaturalist.org/photos/390037829) · CC BY 4.0 · Pauline Walsh Jacobson
- `sand-tilefish.jpg` — [iNaturalist photo 170356304](https://www.inaturalist.org/photos/170356304) · CC BY 4.0 · Pauline Walsh Jacobson
- `sargassum-triggerfish.jpg` — [iNaturalist photo 40023392](https://www.inaturalist.org/photos/40023392) · CC BY 4.0 · Christine Loew
- `saucereye-porgy.jpg` — [Saucereye porgy.jpg](https://commons.wikimedia.org/wiki/File:Saucereye_porgy.jpg) · CC BY-SA 3.0 · Daphnis De Pooter
- `scamp.jpg` — [iNaturalist photo 354799718](https://www.inaturalist.org/photos/354799718) · CC BY 4.0 · Pauline Walsh Jacobson
- `scattered-pore-rope-sponge.jpg` — [iNaturalist photo 475686065](https://www.inaturalist.org/photos/475686065) · CC BY 4.0 · Josiah Londerée
- `schoolmaster-snapper.jpg` — [Lutjanus.JPG](https://commons.wikimedia.org/wiki/File:Lutjanus.JPG) · CC BY-SA 3.0 · albert kok
- `scrawled-cowfish.jpg` — [iNaturalist photo 158450017](https://www.inaturalist.org/photos/158450017) · CC BY 4.0 · Pauline Walsh Jacobson
- `scrawled-filefish.jpg` — [Pez lija pintado (Aluterus scriptus), mar Rojo, Egipto, 2023-04-19, DD 47.jpg](https://commons.wikimedia.org/wiki/File:Pez_lija_pintado_(Aluterus_scriptus),_mar_Rojo,_Egipto,_2023-04-19,_DD_47.jpg) · CC BY-SA 4.0 · Diego Delso
- `sea-plume.jpg` — [Pseudopterogorgia sp.jpg](https://commons.wikimedia.org/wiki/File:Pseudopterogorgia_sp.jpg) · CC BY 2.0 · James St. John
- `sea-walnut.jpg` — [iNaturalist photo 198193589](https://www.inaturalist.org/photos/198193589) · CC BY 4.0 · Julien Renoult · cropped to 0.25,0.1,0.55,0.8 (left, top, width, height as fractions of the original)
- `seaweed-blenny.jpg` — [iNaturalist photo 289601030](https://www.inaturalist.org/photos/289601030) · CC BY 4.0 · Pauline Walsh Jacobson
- `sergeant-major.jpg` — [Abudefduf saxatilis.jpg](https://commons.wikimedia.org/wiki/File:Abudefduf_saxatilis.jpg) · CC BY-SA 3.0 · cralize
- `sharknose-goby.jpg` — [Elacatinus evelynae.jpg](https://commons.wikimedia.org/wiki/File:Elacatinus_evelynae.jpg) · CC BY 2.0 · LASZLO ILYES (laszlo-photo) from Cleveland, Ohio, USA
- `sharpnose-puffer.jpg` — [Canthigaster rostrata (47475835002).jpg](https://commons.wikimedia.org/wiki/File:Canthigaster_rostrata_(47475835002).jpg) · CC BY 2.0 · LASZLO ILYES from Cleveland, Ohio, USA
- `sharptail-eel.jpg` — [Myrichthys breviceps 2.jpg](https://commons.wikimedia.org/wiki/File:Myrichthys_breviceps_2.jpg) · CC BY 2.0 · Barry Peters
- `sheepshead.jpg` — [iNaturalist photo 386017792](https://www.inaturalist.org/photos/386017792) · CC BY 4.0 · Jacob Weston
- `shortstripe-goby.jpg` — [iNaturalist photo 466154277](https://www.inaturalist.org/photos/466154277) · CC BY 4.0 · Pauline Walsh Jacobson · cropped to 0,0.08,1,0.92 (left, top, width, height as fractions of the original)
- `shy-hamlet.jpg` — [iNaturalist photo 619596807](https://www.inaturalist.org/photos/619596807) · CC BY 4.0 · Dan Schofield
- `silver-porgy.jpg` — [iNaturalist photo 340119719](https://www.inaturalist.org/photos/340119719) · CC BY 4.0 · Pauline Walsh Jacobson
- `slate-pencil-urchin.jpg` — [iNaturalist photo 452304665](https://www.inaturalist.org/photos/452304665) · CC BY 4.0 · Dan Schofield
- `slipper-lobster.jpg` — [Slipper lobster.jpg](https://commons.wikimedia.org/wiki/File:Slipper_lobster.jpg) · CC BY-SA 4.0 · Betty Wills
- `slippery-dick.jpg` — [Slippery dick Halichoeres bivittatus (4657125724).jpg](https://commons.wikimedia.org/wiki/File:Slippery_dick_Halichoeres_bivittatus_(4657125724).jpg) · CC BY 2.0 · Paul Asman and Jill Lenoble · cropped to 0.2,0.3,0.65,0.6 (left, top, width, height as fractions of the original)
- `smallmouth-grunt.jpg` — [iNaturalist photo 580645072](https://www.inaturalist.org/photos/580645072) · CC BY 4.0 · Jan Ebr & Ivana Ebrová
- `smooth-flower-coral.jpg` — [iNaturalist photo 143041917](https://www.inaturalist.org/photos/143041917) · CC BY 4.0 · Robin White
- `smooth-trunkfish.jpg` — [Lactophrys triqueter 1.jpg](https://commons.wikimedia.org/wiki/File:Lactophrys_triqueter_1.jpg) · Public domain · Becky A. Dayhuff, Environmental Educator
- `social-feather-duster.jpg` — [iNaturalist photo 246182027](https://www.inaturalist.org/photos/246182027) · CC BY 4.0 · Dan Schofield
- `southern-stingray.jpg` — [Dasyatis americana.jpg](https://commons.wikimedia.org/wiki/File:Dasyatis_americana.jpg) · Public domain · Becky A. Dayhuff, Environmental Educator
- `spanish-grunt.jpg` — [iNaturalist photo 82784834](https://www.inaturalist.org/photos/82784834) · CC BY-SA 4.0 · Cos
- `spanish-hogfish.jpg` — [Bodianus rufus.jpg](https://commons.wikimedia.org/wiki/File:Bodianus_rufus.jpg) · CC BY 2.0 · Ventura from Brasil · cropped to 0.03,0.25,0.85,0.65 (left, top, width, height as fractions of the original)
- `spanish-lobster.jpg` — [iNaturalist photo 252022524](https://www.inaturalist.org/photos/252022524) · CC BY 4.0 · Dan Schofield
- `spiny-lobster.jpg` — [Caribbean Spiny Lobster 1 - Blackbird Caye - Belize 2016 (24239777714).jpg](https://commons.wikimedia.org/wiki/File:Caribbean_Spiny_Lobster_1_-_Blackbird_Caye_-_Belize_2016_(24239777714).jpg) · CC BY 2.0 · Adam
- `spinyhead-blenny.jpg` — [iNaturalist photo 468851419](https://www.inaturalist.org/photos/468851419) · CC BY 4.0 · Pauline Walsh Jacobson
- `splendid-toadfish.jpg` — [Splendid toadfish.jpg](https://commons.wikimedia.org/wiki/File:Splendid_toadfish.jpg) · Public domain · Randall McNeely
- `split-crown-feather-duster.jpg` — [iNaturalist photo 205998650](https://www.inaturalist.org/photos/205998650) · CC BY 4.0 · Donald Davesne
- `sponge-brittle-star.jpg` — [iNaturalist photo 182176755](https://www.inaturalist.org/photos/182176755) · CC0 · no rights reserved
- `spot-winged-comb-jelly.jpg` — [iNaturalist photo 250756701](https://www.inaturalist.org/photos/250756701) · CC BY 4.0 · Dan Schofield
- `spotfin-butterflyfish.jpg` — [Chaetodon ocellatus.jpg](https://commons.wikimedia.org/wiki/File:Chaetodon_ocellatus.jpg) · Public domain
- `spottail-pinfish.jpg` — [iNaturalist photo 595164679](https://www.inaturalist.org/photos/595164679) · CC BY 4.0 · Tom Field
- `spotted-cleaner-shrimp.jpg` — [Spotted cleaner shrimp (Periclimenes yucatanicus) - Harry's Hole Reef, Soto, Curaçao Netherland Antilles.jpg](https://commons.wikimedia.org/wiki/File:Spotted_cleaner_shrimp_(Periclimenes_yucatanicus)_-_Harry's_Hole_Reef,_Soto,_Cura%C3%A7ao_Netherland_Antilles.jpg) · CC BY 2.0 · LASZLO ILYES from Cleveland, Ohio, USA
- `spotted-drum.jpg` — [Equetus punctatus juvenile.jpg](https://commons.wikimedia.org/wiki/File:Equetus_punctatus_juvenile.jpg) · CC BY 2.0 · LASZLO ILYES (laszlo-photo) from Cleveland, Ohio, USA
- `spotted-eagle-ray.jpg` — [Spotted Eagle Ray (Aetobatus narinari)2.jpg](https://commons.wikimedia.org/wiki/File:Spotted_Eagle_Ray_(Aetobatus_narinari)2.jpg) · CC BY 2.0 · john norton
- `spotted-goatfish.jpg` — [iNaturalist photo 257783221](https://www.inaturalist.org/photos/257783221) · CC BY 4.0 · Pauline Walsh Jacobson
- `spotted-moray.jpg` — [Murène (Gymnothorax moringa).jpg](https://commons.wikimedia.org/wiki/File:Mur%C3%A8ne_(Gymnothorax_moringa).jpg) · CC BY 3.0 · Stéphanie De Nadaï
- `spotted-scorpionfish.jpg` — [Scorpaena plumieri 8zz.jpg](https://commons.wikimedia.org/wiki/File:Scorpaena_plumieri_8zz.jpg) · CC BY-SA 4.0 · Photo by David J. Stang
- `spotted-sea-hare.jpg` — [iNaturalist photo 462955227](https://www.inaturalist.org/photos/462955227) · CC BY 4.0 · Donald Davesne
- `spotted-spiny-lobster.jpg` — [iNaturalist photo 250743011](https://www.inaturalist.org/photos/250743011) · CC BY 4.0 · Dan Schofield
- `spotted-trunkfish.jpg` — [Lactophrys bicaudalis.jpg](https://commons.wikimedia.org/wiki/File:Lactophrys_bicaudalis.jpg) · CC BY 2.0 · LASZLO ILYES from Cleveland, Ohio, USA
- `squirrelfish.jpg` — [Squirrelfish Holocentrus ascensionis.jpg](https://commons.wikimedia.org/wiki/File:Squirrelfish_Holocentrus_ascensionis.jpg) · CC BY 2.0 · Brian Gratwicke
- `staghorn-coral.jpg` — [Healthy Staghorn.jpg](https://commons.wikimedia.org/wiki/File:Healthy_Staghorn.jpg) · CC BY 2.5 · Joeschmitty at English Wikipedia
- `star-horseshoe-worm.jpg` — [iNaturalist photo 98549991](https://www.inaturalist.org/photos/98549991) · CC BY 4.0 · A H
- `stinker-sponge.jpg` — [iNaturalist photo 231952657](https://www.inaturalist.org/photos/231952657) · CC BY 4.0 · Robin White
- `stoplight-parrotfish.jpg` — [Sparisoma viride 1.jpg](https://commons.wikimedia.org/wiki/File:Sparisoma_viride_1.jpg) · Public domain · Florida Keys National Marine Sanctuary Staff
- `stovepipe-sponge.jpg` — [Aplysina archeri (Stove-pipe Sponge-pink variation).jpg](https://commons.wikimedia.org/wiki/File:Aplysina_archeri_(Stove-pipe_Sponge-pink_variation).jpg) · CC BY-SA 3.0 · Nhobgood (talk) Nick Hobgood
- `striped-parrotfish.jpg` — [iNaturalist photo 539885657](https://www.inaturalist.org/photos/539885657) · CC BY 4.0 · Rorey · cropped to 0.1,0.1,0.9,0.9 (left, top, width, height as fractions of the original)
- `sun-anemone-shrimp.jpg` — [iNaturalist photo 332753239](https://www.inaturalist.org/photos/332753239) · CC BY 4.0 · Dan Schofield · cropped to 0.2,0.15,0.6,0.7 (left, top, width, height as fractions of the original)
- `sun-anemone.jpg` — [iNaturalist photo 472037449](https://www.inaturalist.org/photos/472037449) · CC BY 4.0 · Dan Schofield
- `sunshinefish.jpg` — [iNaturalist photo 364951258](https://www.inaturalist.org/photos/364951258) · CC BY 4.0 · cello caruso-turiello · cropped to 0.2,0.25,0.6,0.6 (left, top, width, height as fractions of the original)
- `symmetrical-brain-coral.jpg` — [Diploria strigosa y Colpophyllia natans.jpg](https://commons.wikimedia.org/wiki/File:Diploria_strigosa_y_Colpophyllia_natans.jpg) · Public domain · NOAA - Frank and Joyce Burek
- `tarpon.jpg` — [Atlantic tarpon.jpg](https://commons.wikimedia.org/wiki/File:Atlantic_tarpon.jpg) · Public domain
- `three-rowed-sea-cucumber.jpg` — [iNaturalist photo 686220546](https://www.inaturalist.org/photos/686220546) · CC BY 4.0 · Tom Kennedy · cropped to 0.1,0.15,0.75,0.75 (left, top, width, height as fractions of the original)
- `threespot-damselfish.jpg` — [Threespot Damselfish (Stegastes planifrons) Juvenile.jpg](https://commons.wikimedia.org/wiki/File:Threespot_Damselfish_(Stegastes_planifrons)_Juvenile.jpg) · CC BY 2.0 · Andy Blackledge
- `tiger-grouper.jpg` — [Tiger grouper.JPG](https://commons.wikimedia.org/wiki/File:Tiger_grouper.JPG) · CC BY-SA 3.0 · Albert kok
- `tobaccofish.jpg` — [iNaturalist photo 454872163](https://www.inaturalist.org/photos/454872163) · CC BY 4.0 · Andrew McKinlay
- `tomtate.jpg` — [iNaturalist photo 321676079](https://www.inaturalist.org/photos/321676079) · CC BY 4.0 · Robin White
- `true-tulip.jpg` — [iNaturalist photo 701042045](https://www.inaturalist.org/photos/701042045) · CC BY 4.0 · Cricket Raspet
- `trumpetfish.jpg` — [Aulostomus maculatus b.jpg](https://commons.wikimedia.org/wiki/File:Aulostomus_maculatus_b.jpg) · CC BY-SA 3.0 · Colling-architektur
- `turtle-grass.jpg` — [Seagrass Grahams Harbour.jpg](https://commons.wikimedia.org/wiki/File:Seagrass_Grahams_Harbour.jpg) · Public domain · Jstuby at English Wikipedia
- `twospot-cardinalfish.jpg` — [iNaturalist photo 177067707](https://www.inaturalist.org/photos/177067707) · CC BY 4.0 · Pauline Walsh Jacobson · cropped to 0,0,1,0.88 (left, top, width, height as fractions of the original)
- `upside-down-jellyfish.jpg` — [Cassiopea xamachana (xndr).JPG](https://commons.wikimedia.org/wiki/File:Cassiopea_xamachana_(xndr).JPG) · CC BY-SA 3.0 · No machine-readable author provided. Svdmolen assumed (based on copyright claims).
- `variegated-sea-urchin.jpg` — [iNaturalist photo 699250549](https://www.inaturalist.org/photos/699250549) · CC BY 4.0 · Donald Davesne
- `vase-sponge.jpg` — [iNaturalist photo 247000303](https://www.inaturalist.org/photos/247000303) · CC BY 4.0 · Jay Brasher
- `vermilion-snapper.jpg` — [Rhomboplites aurorubens - Sanc2430.jpg](https://commons.wikimedia.org/wiki/File:Rhomboplites_aurorubens_-_Sanc2430.jpg) · CC BY 2.0 · NOAA Photo Library
- `west-indian-sea-egg.jpg` — [iNaturalist photo 363217534](https://www.inaturalist.org/photos/363217534) · CC BY 4.0 · Charlotte Kirchner
- `whale-shark.jpg` — [Snorkeling whale shark 1.JPG](https://commons.wikimedia.org/wiki/File:Snorkeling_whale_shark_1.JPG) · CC BY-SA 4.0 · Jaontiveros
- `white-encrusting-zoanthid.jpg` — [iNaturalist photo 358075979](https://www.inaturalist.org/photos/358075979) · CC BY 4.0 · Robin White
- `white-grunt.jpg` — [White Grunt (5658507044).jpg](https://commons.wikimedia.org/wiki/File:White_Grunt_(5658507044).jpg) · CC BY 2.0 · Andy Blackledge
- `white-margate.jpg` — [iNaturalist photo 738953564](https://www.inaturalist.org/photos/738953564) · CC BY 4.0 · Dan Schofield
- `whitespotted-filefish.jpg` — [iNaturalist photo 129263909](https://www.inaturalist.org/photos/129263909) · CC0 · no rights reserved
- `yellow-goatfish.jpg` — [iNaturalist photo 260739020](https://www.inaturalist.org/photos/260739020) · CC BY 4.0 · Pauline Walsh Jacobson · cropped to 0,0,1,0.78 (left, top, width, height as fractions of the original)
- `yellow-jack.jpg` — [iNaturalist photo 167403376](https://www.inaturalist.org/photos/167403376) · CC BY 4.0 · João D'Andretta
- `yellow-pencil-coral.jpg` — [iNaturalist photo 328168487](https://www.inaturalist.org/photos/328168487) · CC BY 4.0 · Jay Brasher
- `yellow-stingray.jpg` — [Urobatis jamaicensis - panoramio.jpg](https://commons.wikimedia.org/wiki/File:Urobatis_jamaicensis_-_panoramio.jpg) · CC BY 3.0 · Juan Ortega
- `yellow-tube-sponge.jpg` — [Aplysina fistularis 261077713.jpg](https://commons.wikimedia.org/wiki/File:Aplysina_fistularis_261077713.jpg) · CC BY 4.0 · Darren Obbard
- `yellowbelly-hamlet.jpg` — [iNaturalist photo 421127172](https://www.inaturalist.org/photos/421127172) · CC BY 4.0 · Dan Schofield
- `yellowcheek-wrasse.jpg` — [iNaturalist photo 12313673](https://www.inaturalist.org/photos/12313673) · CC BY-SA 4.0 · Thibaud Aronson · cropped to 0.15,0.22,0.65,0.6 (left, top, width, height as fractions of the original)
- `yellowfin-grouper.jpg` — [Mycteroperca venenosa Puerto Morelos.jpg](https://commons.wikimedia.org/wiki/File:Mycteroperca_venenosa_Puerto_Morelos.jpg) · CC BY-SA 2.0 · Kimon Berlin
- `yellowfin-mojarra.jpg` — [iNaturalist photo 334176478](https://www.inaturalist.org/photos/334176478) · CC BY 4.0 · Jay Brasher · cropped to 0.25,0.3,0.75,0.7 (left, top, width, height as fractions of the original)
- `yellowhead-jawfish.jpg` — [2017, cuba, jardines aggressor, fraile I, yellowhead jawfish (23700547318).jpg](https://commons.wikimedia.org/wiki/File:2017,_cuba,_jardines_aggressor,_fraile_I,_yellowhead_jawfish_(23700547318).jpg) · CC BY 2.0 · q phia · cropped to 0.15,0.2,0.65,0.7 (left, top, width, height as fractions of the original)
- `yellowhead-wrasse.jpg` — [Yellowhead wrasse Halichoeres garnoti (4676202122).jpg](https://commons.wikimedia.org/wiki/File:Yellowhead_wrasse_Halichoeres_garnoti_(4676202122).jpg) · CC BY 2.0 · Paul Asman and Jill Lenoble
- `yellowline-goby.jpg` — [iNaturalist photo 596515025](https://www.inaturalist.org/photos/596515025) · CC BY 4.0 · Pauline Walsh Jacobson
- `yellowmouth-grouper.jpg` — [iNaturalist photo 519610917](https://www.inaturalist.org/photos/519610917) · CC BY 4.0 · Jay Brasher
- `yellownose-goby.jpg` — [iNaturalist photo 361347552](https://www.inaturalist.org/photos/361347552) · CC BY 4.0 · Pauline Walsh Jacobson
- `yellowtail-damselfish.jpg` — [Microspathodon chrysurus.jpg](https://commons.wikimedia.org/wiki/File:Microspathodon_chrysurus.jpg) · CC BY 2.0 · Chika Watanabe
- `yellowtail-hamlet.jpg` — [iNaturalist photo 520460276](https://www.inaturalist.org/photos/520460276) · CC BY 4.0 · Jay Brasher
- `yellowtail-parrotfish.jpg` — [iNaturalist photo 129257389](https://www.inaturalist.org/photos/129257389) · CC0 · no rights reserved
- `yellowtail-snapper.jpg` — [2006-10-06 18 - Yellowtail Snapper.JPG](https://commons.wikimedia.org/wiki/File:2006-10-06_18_-_Yellowtail_Snapper.JPG) · CC BY-SA 3.0 · Transity

<!-- credits:end -->
