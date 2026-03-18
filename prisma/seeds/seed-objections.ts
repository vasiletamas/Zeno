import { PrismaClient } from '../../lib/generated/prisma/client'

export async function seedObjections(prisma: PrismaClient) {
  console.log('  Seeding objection strategies...')

  // ── 1. Look up the "protect" product ──────────────────────────────
  const product = await prisma.product.findUnique({ where: { code: 'protect' } })
  if (!product) throw new Error('Product "protect" must be seeded before objections')

  // ── 2. Objection strategy definitions ─────────────────────────────
  const strategies = [
    {
      type: 'price_base',
      title: 'Pretul de baza e prea mare',
      addonContext: null,
      orderIndex: 0,
      isActive: true,
      strategy: `PRINCIPIU: Prețul de bază (190-430 RON/an) este OBIECTIV mic. Problema nu e prețul — e că clientul nu a făcut calculul. Nu te apăra. Nu spune "nu e scump". Spune "hai să vedem cât înseamnă de fapt."

TEHNICA 1 — SPARGE ÎN ZILNIC:
Folosește aceste referințe exacte adaptate la tier-ul clientului:
  190 RON/an = 16 RON/lună = 0,52 RON/zi
  230 RON/an = 19 RON/lună = 0,63 RON/zi
  290 RON/an = 24 RON/lună = 0,79 RON/zi
  330 RON/an = 28 RON/lună = 0,90 RON/zi
  390 RON/an = 33 RON/lună = 1,07 RON/zi
  430 RON/an = 36 RON/lună = 1,18 RON/zi

Script: "[X] RON pe an înseamnă [Y] bani pe zi. Literalmente mai puțin decât o apă plată de la magazin. Pentru [Y] bani pe zi, familia ta e protejată financiar."

TEHNICA 2 — COMPARAȚII DIN VIAȚA REALĂ:
Alege comparația potrivită pentru profilul clientului:
  "16 lei pe lună — cât un abonament Netflix pe care-l uiți deschis. Doar că Netflix-ul nu-ți protejează familia."
  "Mai puțin decât o cafea de la automat pe săptămână. Cafeaua se termină în 5 minute. Protecția durează tot anul."
  "Mai puțin de 1 leu pe zi pentru varianta maximă. Un leu pe zi pentru protecție completă."

TEHNICA 3 — INVERSEAZĂ PERSPECTIVA:
"Întrebarea reală nu e «de ce costă [X] RON pe an». Întrebarea e «ce ar costa familia ta dacă NU ai avea această protecție și ți s-ar întâmpla ceva?»"

TEHNICA 4 — DACĂ BUGETUL CHIAR NU PERMITE:
Oferă Tier I (190 RON/an = 16 RON/lună). "Poți începe cu varianta de bază la 16 lei pe lună și să faci upgrade anul viitor." NICIODATĂ nu lăsa clientul să plece fără nimic.

CE SĂ NU FACI:
- Nu spune "nu e scump" — invalidezi percepția lor
- Nu te scuza pentru preț
- Nu compara cu alte produse negativ`,
    },
    {
      type: 'price_addon',
      title: 'Addon-ul BD e prea scump',
      addonContext: 'bd_treatment_abroad',
      orderIndex: 1,
      isActive: true,
      strategy: `PRINCIPIU: BD addon-ul (226-607 EUR/an) costă semnificativ mai mult decât baza. Clientul are dreptate că e o sumă. NU minimiza. În schimb, arată ce primește — și mai important, ce se întâmplă FĂRĂ BD.

TEHNICA 1 — COST vs. CONSECINȚĂ (cea mai puternică):
Nu compara cu alte cheltuieli. Compară cu ce se întâmplă fără BD.
"Înțeleg că [X EUR pe an] pare mult. Dar hai să punem lucrurile în perspectivă: O singură operație de cancer în Turcia costă în medie 15.000 EUR. Chimioterapia în Franța — 17.000 EUR. O zi de spitalizare oncologică la un institut de top: 1.700 EUR. Un transplant de măduvă osoasă: până la 100.000 USD. Cu clauza BD, ai acoperire de 2.000.000 EUR. Plătești [X] EUR pe an ca să ai acces la 2 MILIOANE EUR dacă ai nevoie."

TEHNICA 2 — RAPORTUL PREȚ / ACOPERIRE:
Calculează raportul pentru vârsta clientului:
  19-24: 226 EUR/an → 1 EUR = 8.850 EUR acoperire
  25-29: 247 EUR/an → 1 EUR = 8.097 EUR acoperire
  30-34: 274 EUR/an → 1 EUR = 7.299 EUR acoperire
  35-39: 308 EUR/an → 1 EUR = 6.494 EUR acoperire
  40-44: 354 EUR/an → 1 EUR = 5.650 EUR acoperire
  45-49: 402 EUR/an → 1 EUR = 4.975 EUR acoperire
  50-54: 461 EUR/an → 1 EUR = 4.338 EUR acoperire
  55-59: 527 EUR/an → 1 EUR = 3.795 EUR acoperire
  60-64: 607 EUR/an → 1 EUR = 3.295 EUR acoperire
Script: "Pentru fiecare euro investit, ai peste [X.000] EUR de protecție. Unde mai găsești un astfel de raport?"

TEHNICA 3 — SPARGE BD-UL ÎN COMPONENTE:
"Nu plătești [X] EUR pentru «o clauză». Plătești pentru un pachet medical complet:
  - Tratament în cele mai bune clinici din Europa: ACOPERIRE 2.000.000 EUR
  - 100 EUR/zi spitalizare în străinătate (max 60 zile) = până la 6.000 EUR extra
  - 50.000 EUR pentru medicație post-tratament
  - A doua opinie medicală GRATUITĂ (care singură poate costa 500-2.000 EUR)
Valoarea reală e peste 2.050.000 EUR."

TEHNICA 4 — COMPARAȚIA CU CAMPANIILE DE DONAȚII:
"Știi cât strâng oamenii pe Facebook când au nevoie de tratament în străinătate? O tânără de 27 de ani din Suceava a avut nevoie de 2.3 milioane de dolari. Zilnic sunt zeci de campanii active. Acești oameni nu au plătit [X] EUR pe an. Acum cerșesc bani de la necunoscuți în cel mai greu moment al vieții. Cu BD, nu ajungi niciodată acolo."

TEHNICA 5 — SPARGE ÎN ZILNIC:
  226 EUR/an = 0,62 EUR/zi = ~3 RON/zi
  247 EUR/an = 0,68 EUR/zi = ~3,4 RON/zi
  274 EUR/an = 0,75 EUR/zi = ~3,7 RON/zi
  308 EUR/an = 0,84 EUR/zi = ~4,2 RON/zi
  354 EUR/an = 0,97 EUR/zi = ~4,8 RON/zi
  402 EUR/an = 1,10 EUR/zi = ~5,5 RON/zi
  461 EUR/an = 1,26 EUR/zi = ~6,3 RON/zi
  527 EUR/an = 1,44 EUR/zi = ~7,2 RON/zi
  607 EUR/an = 1,66 EUR/zi = ~8,3 RON/zi
Script: "[X] EUR pe an sună mult. Dar sunt [Y] eurocenți pe zi. Sub [Z] lei pe zi. Cât o cafea la automat. Doar că acea cafea nu-ți oferă acces la 2 milioane EUR dacă mâine primești un diagnostic de cancer."`,
    },
    {
      type: 'price_total',
      title: 'Totalul e prea mare (baza + addon)',
      addonContext: null,
      orderIndex: 2,
      isActive: true,
      strategy: `PRINCIPIU: Când clientul vede totalul combinat (ex: 330 RON + 274 EUR ≈ 1.700 RON/an), suma pare mare. Nu contrazice. Separă, ancorează fiecare componentă, și oferă flexibilitate.

TEHNICA 1 — SEPARĂ ȘI ANCOREAZĂ:
"Hai să le luăm pe rând.
Asigurarea de viață + accidente: [X] RON pe an. [Y] lei pe lună. Protecție pentru familie, invaliditate, chirurgie, spitalizare.
Tratament medical în străinătate: [X] EUR pe an. ~[Y] RON pe lună. Acces la 2.000.000 EUR pentru tratament în cele mai bune clinici din Europa.
Total: ~[Z] RON pe lună pentru AMBELE.
Asta e mai puțin decât un abonament de telefon. Dar abonamentul de telefon nu plătește 2 milioane EUR dacă ai cancer."

TEHNICA 2 — OFERĂ FLEXIBILITATE:
Dacă totalul e peste buget, NU pierde vânzarea. Oferă opțiuni:

OPȚIUNEA A — Începe doar cu baza:
"Poți începe cu asigurarea de bază de la 190 RON pe an. Anul viitor, dacă situația financiară permite, adaugi și clauza BD."

OPȚIUNEA B — Coboară tier-ul, păstrează BD:
"Dacă vrei neapărat clauza de tratament, putem lua pachetul Standard Tier I la 190 RON + BD. Totalul scade, dar păstrezi acoperirea medicală de 2M EUR care e cea mai valoroasă parte."

OPȚIUNEA C — Plată fracționată:
"Poți plăti trimestrial sau semestrial. Împărțit în 4 rate, vine mai ușor de gestionat."

REGULA CRITICĂ: NICIODATĂ nu lăsa clientul să plece fără nimic. Mai bine vinde baza fără BD, decât să nu vândă deloc. Orice nivel de protecție e mai bun decât zero protecție.`,
    },
    {
      type: 'no_need',
      title: 'Nu am nevoie / Sunt sanatos',
      addonContext: null,
      orderIndex: 3,
      isActive: true,
      strategy: `PRINCIPIU: Aceasta NU e o obiecție reală — e o credință. Clientul nu spune "produsul e rău." Spune "eu sunt imun la risc." Nu-l contrazice frontal. Nu spune "te înșeli." Validează-i dorința de a fi sănătos, apoi introduce realitatea statistică FĂRĂ a crea panică.

TEHNICA 1 — VALIDARE + STATISTICI (începe ÎNTOTDEAUNA cu validare):
"Și eu sper din suflet să rămâi sănătos. Dar cifrele spun altceva decât ce simțim: în România se diagnostichează 260 de cazuri noi de cancer în fiecare zi. 95.000 pe an. Fiecare dintre acești oameni credea exact același lucru — «mie nu mi se poate întâmpla»."

TEHNICA 2 — STATISTICI PE GRUPE DE VÂRSTĂ:
Alege statistica relevantă pentru vârsta clientului:

  25-35 ani: "Cancerul testicular are cel mai mare risc la bărbați între 20-35 ani. Cancerul de sân e al doilea cancer ca frecvență la femei tinere. La această vârstă, nimeni nu se gândește la asta — exact de aceea e important."

  35-45 ani: "Într-un grup de 10 prieteni de vârsta ta, statistic 2-3 vor primi un diagnostic de cancer de-a lungul vieții. Gândește-te la 10 oameni pe care-i cunoști. Cifrele sunt reale."

  45-55 ani: "Cancerul pulmonar e la vârf la această vârstă — 10.500 de decese pe an doar în România. Bolile cardiovasculare sunt cauza #1 de deces. România are doar 13 centre de chirurgie cardiacă și 0,5 aparate de radioterapie la 100.000 de locuitori — cel mai puțin din UE."

  55-64 ani: "Rata de incidență a cancerului e de 14 ori mai mare după 50 de ani față de sub 30. Iar rata de supraviețuire la 5 ani în România e printre cele mai mici din Europa — pentru că nu avem acces la tratamentele moderne. Cu BD, ai acces la ele."

TEHNICA 3 — PARADOXUL ASIGURĂRII:
"Tocmai de asta e momentul perfect. Asigurarea se face când ești sănătos. Când ai deja o problemă, e prea târziu — nicio companie de asigurări nu te mai acceptă. Practic, sănătatea ta de azi e cel mai valoros lucru pe care îl ai — și poți «transforma» această sănătate în protecție pentru viitor. Mâine, poate nu mai poți."

TEHNICA 4 — BD ADDON ȘI WAITING PERIOD:
"Addon-ul de tratament în străinătate acoperă cancer, chirurgie cardiacă, neurochirurgie, transplant. Dar are o perioadă de așteptare de 180 de zile. Asta înseamnă că dacă începi AZI, ești acoperit din luna a 7-a. Dacă amâni 6 luni, ești acoperit abia peste un an. Timpul lucrează împotriva ta."

TEHNICA 5 — CAMPANII DE DONAȚII CA REALITATE:
"Zilnic pe Facebook vezi campanii de strângere de fonduri pentru oameni care au nevoie disperată de tratament medical. Proiectul SMS pentru Viață a primit peste 2.000 de cereri de ajutor. Fiecare dintre acești oameni credea că «nu mi se poate întâmpla mie». Cu Protect + BD, nu depinzi de donații, de milă, de noroc."

TEHNICA 6 — REFRAME DE LA "NEVOIE" LA "RESPONSABILITATE":
Dacă clientul are familie/copii: "Nu e vorba dacă ai tu nevoie. E vorba de ce se întâmplă cu [copiii/familia] dacă TU ai nevoie și NU ai protecție. Asigurarea nu e pentru tine — e pentru ei."
Dacă clientul nu are familie: "Asigurarea de viață e despre tine acum, nu doar despre un scenariu viitor. Dacă ai un accident și ai nevoie de chirurgie, primești până la [X] RON. Dacă ești spitalizat, primești [Y] RON pe zi. Iar dacă ai nevoie de tratament pentru cancer sau o operație pe cord — 2 milioane EUR, cele mai bune clinici din Europa."

CE SĂ NU FACI:
- Nu crea panică sau anxietate. Prezintă cifrele calm, ca informație, nu ca amenințare.
- Nu insista dacă clientul rămâne ferm — plantează sămânța și lasă-l să se gândească.
- Nu minimiza preocuparea lor ("a, dar statisticile...") — validează mai întâi.`,
    },
    {
      type: 'have_insurance',
      title: 'Am deja o asigurare',
      addonContext: null,
      orderIndex: 4,
      isActive: true,
      strategy: `PRINCIPIU: Clientul care spune "am deja asigurare" NU spune "nu vreau asigurare." Spune "sunt deja acoperit." Aceasta e o OPORTUNITATE, nu o respingere. Asigurarea lor aproape sigur NU include ce oferă Protect cu BD. Misiunea ta: descoperă ce au, identifică GAP-ul, și poziționează Protect ca COMPLEMENTAR, nu ca înlocuitor.

TEHNICA 1 — DESCOPERĂ CE AU (întreabă, nu presupune):
"Perfect! E bine că te-ai gândit deja la protecție. Pot să te întreb ce tip de asigurare ai? E o asigurare de viață, de sănătate, sau legată de un credit?"

Răspunsuri tipice și cum să reacționezi:

  A) "Asigurare de viață clasică / unit-linked":
  "Foarte bine. Include și tratament medical în străinătate pentru boli grave? De exemplu, dacă ai nevoie de operație de cancer în Germania sau transplant în Austria — asigurarea ta acoperă asta?"
  (Răspunsul e aproape întotdeauna NU.)
  "Exact. Cele mai multe polițe de viață acoperă deces și eventual invaliditate. Protect cu BD completează acea protecție cu ceva ce majoritatea asigurărilor NU au: acces la 2 milioane EUR pentru tratament medical de top în Europa."

  B) "Asigurare de sănătate privată":
  "Asigurările de sănătate private acoperă de obicei consultații, analize, spitalizare de rutină. Dar acoperă tratament oncologic în străinătate de 2 milioane EUR? Chimioterapie la Institut Curie? Chirurgie cardiacă în Austria?"
  (Aproape niciodată.)
  "Sunt produse diferite. Asigurarea ta de sănătate e pentru ziua de zi cu zi. Protect cu BD e pentru MARILE RISCURI — cele care pot costa zeci sau sute de mii de euro."

  C) "Asigurare la bancă / legată de credit":
  "Aceea acoperă soldul creditului — protejează banca, nu familia ta. Dacă ți se întâmplă ceva, creditul se stinge, dar familia ta nu primește nimic. Protect e protecție pentru ei."

  D) "Nu știu exact ce am":
  "E perfect normal — mulți oameni au asigurări și nu știu exact ce acoperă. Sugestia mea: verifică dacă include tratament medical în străinătate pentru boli grave. Dacă nu, Protect cu BD e exact complementul de care ai nevoie."

TEHNICA 2 — POZIȚIONARE CA COMPLEMENT, NU ÎNLOCUITOR:
"Nu-ți sugerez să renunți la ce ai. Dimpotrivă — păstrează-ți asigurarea actuală. Protect COMPLETEAZĂ acea protecție. E ca și cum ai avea RCA-ul obligatoriu + CASCO. Unul nu-l înlocuiește pe celălalt — se completează."

TEHNICA 3 — GAP-UL DE TRATAMENT ÎN STRĂINĂTATE:
"Hai să vedem lucrurile practic: dacă mâine primești un diagnostic de cancer, asigurarea ta acoperă tratamentul în cele mai bune clinici din Europa? Acoperă chimioterapia la 17.000 EUR în Franța? Operația de 15.000 EUR în Turcia? O zi de spitalizare de 1.700 EUR? Dacă răspunsul e nu — exact asta face BD-ul din Protect."

TEHNICA 4 — PREȚUL COMPLEMENTULUI:
"Protecția suplimentară costă sub 1 EUR pe zi. Sub 4 lei pe zi pentru acces la 2 milioane EUR — pe lângă ce ai deja. E cea mai ieftină «upgrade» pe care o poți face la protecția ta existentă."

CE SĂ NU FACI:
- Nu vorbi negativ despre asigurarea lor actuală ("aia nu e bună")
- Nu presupune ce au fără să întrebi
- Nu insista să înlocuiască — întotdeauna poziționează ca adaos
- Nu spune "aia nu acoperă nimic" — spune "Protect completează cu ce lipsește"`,
    },
    {
      type: 'need_to_think',
      title: 'Trebuie sa ma gandesc / Sa vorbesc cu sotul/sotia',
      addonContext: null,
      orderIndex: 5,
      isActive: true,
      strategy: `PRINCIPIU: "Trebuie să mă gândesc" e cel mai comun mod politicos de a spune "nu sunt convins." Poate fi sincer (chiar vrea să se gândească) sau poate fi o ieșire elegantă. NU FORȚA. Dar nici nu accepta pasiv. Obiectivul tău: 1) Plantează o ancoră emoțională puternică, 2) Elimină fricțiunea, 3) Menține ușa deschisă, 4) Creează urgență subtilă fără presiune.

TEHNICA 1 — VALIDARE SINCERĂ (obligatoriu ca prim răspuns):
"Absolut, e o decizie importantă și apreciez că vrei să te gândești bine. Nu vreau să iei o decizie cu care nu ești confortabil."

IMPORTANT: Oprește-te după validare. Nu adăuga imediat un "dar." Lasă un moment de tăcere. Apoi continuă cu UNA din tehnicile de mai jos.

TEHNICA 2 — ANCORA EMOȚIONALĂ (campaniile de donații):
"Între timp, gândește-te la asta: zilnic pe Facebook vezi campanii de strângere de fonduri pentru oameni care au nevoie disperată de tratament medical. O tânără de 27 de ani a avut nevoie de 2.3 milioane de dolari. Proiectul SMS pentru Viață a primit peste 2.000 de cereri de ajutor. Cu Protect + BD, nu ajungi niciodată în acea situație. Asta e tot ce face această asigurare."

TEHNICA 3 — ELIMINĂ FRICȚIUNEA:
Adresează temerile ascunse de angajament:
"Vreau să știi că: contractul e pe 1 an, se reînnoiește automat, și îl poți anula oricând. Nu te angajezi pe termen lung. Dacă peste un an simți că nu merită, pur și simplu nu reînnoiești. Zero obligații."

TEHNICA 4 — URGENȚĂ SUBTILĂ (NU presiune):
"Singurul lucru pe care vreau să-l menționez: clauza BD de tratament medical are o perioadă de așteptare de 180 de zile. Asta înseamnă că acoperirea începe de fapt în luna a 7-a. Cu cât amâni decizia, cu atât amâni și momentul din care ești protejat. Nu e presiune — e doar cum funcționează matematic produsul."

TEHNICA 5 — DACĂ MENȚIONEAZĂ SOȚUL/SOȚIA:
"Înțeleg perfect. De altfel, poți încheia și pentru soție/soț — fiecare are propria poliță. Dacă preferați, pot discuta cu amândoi. Când ar fi un moment potrivit?"

SAU dacă vrei să menții impulsul:
"O opțiune: poți începe cu asigurarea doar pentru tine acum — e de la 190 RON/an, 16 lei pe lună — și discuți cu soția/soțul despre a adăuga și o poliță pentru ea/el. Așa, tu ești protejat între timp."

TEHNICA 6 — CREEAZĂ ACȚIUNE MINIMĂ:
Dacă clientul pare aproape convins dar nu face pasul:
"Putem face un lucru: completăm datele de bază fără nicio obligație — durează 2 minute. Dacă te răzgândești, pur și simplu nu finalizăm. Dar dacă te decizi, totul e deja pregătit și nu mai pierzi timp."

TEHNICA 7 — LASĂ UȘA DESCHISĂ (dacă clientul e ferm):
"Perfect, gândește-te liniștit. Rămân la dispoziție dacă ai orice întrebare sau dacă vrei să revedem opțiunile. Informațiile pe care le-am discutat rămân valabile."

NU SPUNE: "Când pot să te sun înapoi?" sau "Te contactez eu săptămâna viitoare" — e agresiv. SPUNE: "Sunt aici oricând vrei să reluăm discuția."

CE SĂ NU FACI:
- Nu ignora obiecția și nu continua să prezinți ("dar stai, mai e ceva...")
- Nu pune presiune directă ("dar dacă amâni, riști...")
- Nu fi condescendent ("de ce să amâni o decizie atât de simplă?")
- Nu suna desperat ("dar e o ofertă foarte bună!")
- Dacă clientul spune clar NU — respectă. Un client respectat poate reveni. Un client forțat nu revine niciodată.`,
    },
    {
      type: 'no_trust',
      title: 'Nu am incredere in asigurari / Asigurarile sunt o teapa',
      addonContext: null,
      orderIndex: 6,
      isActive: true,
      strategy: `PRINCIPIU: Neîncrederea în asigurări e LEGITIMĂ în România. Mulți oameni au avut experiențe negative — despăgubiri refuzate, clauze ascunse, procese lungi. Nu minimiza. Nu spune "nu e cazul la noi." Acceptă că piața de asigurări a avut probleme reale. Apoi diferențiază cu FAPTE, nu cu promisiuni.

TEHNICA 1 — ACCEPTĂ COMPLET, FĂRĂ "DAR":
"Înțeleg perfect. Și sincer, ai motive să fii precaut. Piața de asigurări din România a avut momente în care nu a fost la înălțime. Mulți oameni au fost dezamăgiți."

(Oprește-te. Nu adăuga "dar." Lasă clientul să simtă că l-ai auzit. Apoi întreabă:)
"Pot să te întreb — ai avut o experiență personală neplăcută, sau e o neîncredere generală?"

Dacă experiență personală: ascultă complet, validează, nu sări la vânzare
Dacă generală: continuă cu tehnicile de mai jos

TEHNICA 2 — DIFERENȚIAZĂ PRIN BRAND:
"Allianz e cel mai mare asigurător din Europa și unul dintre cele mai mari din lume. În România, Allianz-Țiriac operează de peste 30 de ani. Plătesc despăgubiri zilnic. Nu e o firmă mică care poate dispărea mâine — e o instituție globală cu reputație de protejat."

TEHNICA 3 — SIMPLIFICĂ PRODUSUL:
"Știi de ce mulți oameni au probleme cu asigurările? Pentru că produsele sunt complicate — cu zeci de clauze, excepții, condiții. Protect e gândit exact invers: plătești prima, ești acoperit. Fără examen medical, fără clauze ascunse, fără surprize.

Concret:
  - Deces? Familia primește [X] RON. Punct.
  - Accident cu invaliditate? Primești până la [X] RON. Punct.
  - Chirurgie din accident? Până la [X] RON. Punct.
  - Cu BD: diagnostic de cancer/cardiac/neuro/transplant? Acces la 2M EUR tratament. Punct.

Nu e nevoie de avocați, de interpretări. Fiecare acoperire e clară și directă."

TEHNICA 4 — TRANSPARENȚĂ TOTALĂ:
"Vreau să fiu complet transparent cu tine:
  - Contractul e pe 1 an. Nu te blochezi.
  - Poți anula oricând. Zero penalități.
  - Condițiile generale sunt publice — le poți citi înainte de a semna.
  - Clauza BD are o perioadă de așteptare de 180 de zile și 6 întrebări medicale — dacă la oricare răspunzi DA, nu poți lua addon-ul. Asta e o limitare reală, și prefer să o știi de la început decât să o descoperi mai târziu."

TEHNICA 5 — SOCIAL PROOF (fără exagerare):
"Mii de familii din România au deja Protect activ. Nu-ți spun asta ca să te conving — ți-o spun ca să știi că nu ești primul care trebuie să decidă. Și dacă nu ar fi funcționat, nu ar mai fi reînnoit."

TEHNICA 6 — REFRAME DE LA "TRUST" LA "RISK MANAGEMENT":
"Înțeleg neîncrederea. Dar hai să privim altfel: nu e vorba de «încredere» — e vorba de management al riscului. Dacă mâine ai un accident sau un diagnostic de cancer, ai două opțiuni:
  Opțiunea A: Plătești totul din buzunar (dacă poți) sau cerși pe Facebook.
  Opțiunea B: O companie cu contract legal, reglementată de ASF, plătește conform contractului.
E pur matematică, nu e încredere."

TEHNICA 7 — DACĂ MENȚIONEAZĂ O EXPERIENȚĂ NEGATIVĂ SPECIFICĂ:
"Îmi pare rău să aud asta. Poți să-mi spui mai exact ce s-a întâmplat? (Ascultă.) Înțeleg de ce asta te-a marcat. Ceea ce pot face eu e să-ți explic exact ce acoperă Protect, exact ce NU acoperă, și să mă asigur că știi la ce te poți aștepta înainte de a lua orice decizie. Transparența e singurul mod în care pot câștiga încrederea ta."

CE SĂ NU FACI:
- Nu minimiza experiența lor ("a, dar aia nu e la noi")
- Nu promite lucruri pe care nu le poți garanta personal
- Nu ataca alte companii de asigurări pe nume
- Nu fi defensiv — nu ești personal atacat
- Nu spune "trebuie să ai încredere" — încrederea se câștigă, nu se cere`,
    },
    {
      type: 'low_benefit',
      title: 'Suma asigurata e prea mica',
      addonContext: null,
      orderIndex: 7,
      isActive: true,
      strategy: `PRINCIPIU: Aceasta e o obiecție legitimă, mai ales pentru clienți 45+. La 55 de ani pe Tier II, suma de deces e 7.500 RON vs. 64.000 RON la 18-25 ani — pentru același preț de 290 RON/an. Clientul are dreptate. NU nega, NU minimiza. Explică onest DE CE e așa, apoi REDIRECȚIONEAZĂ spre valoarea reală a pachetului.

TEHNICA 1 — EXPLICAȚIE ONESTĂ (nu te ascunde):
"E o întrebare foarte bună și vreau să fiu direct cu tine. Prețul e același pentru toată lumea — [X] RON pe an — dar suma de deces variază cu vârsta. De ce? Pentru că riscul statistic de deces crește odată cu vârsta. La 25 de ani, probabilitatea de a muri în anul următor e foarte mică — de aceea suma asigurată e mare. La [vârsta clientului] de ani, riscul statistic e mai ridicat — asigurătorul își asumă un risc mai mare.

Alternativa ar fi fost ca la [vârsta clientului] ani să plătești 2.000-3.000 RON pe an pentru aceeași sumă. Modelul Protect e gândit să fie ACCESIBIL pentru oricine, la orice vârstă."

TEHNICA 2 — REDIRECȚIONEAZĂ SPRE BD (cea mai importantă):
"Dar uite ce contează cu adevărat: la vârsta ta, riscul de boală gravă e cel mai ridicat. Exact acum, clauza BD de 2.000.000 EUR e cea mai valoroasă. Suma de deces de [X] RON e o parte a pachetului — dar accesul la tratament medical de top în Europa? Asta poate fi diferența dintre viață și moarte. Și BD-ul oferă aceleași 2.000.000 EUR indiferent dacă ai 25 sau 60 de ani. Aceeași acoperire, aceeași protecție."

TEHNICA 3 — ARATĂ PACHETUL COMPLET:
"Gândește-te la ce primești TOTAL, nu doar la suma de deces:
  - [X] RON suma de deces
  - Până la [10.000/20.000] RON invaliditate prin accident
  - Până la [4.000/6.000] RON chirurgie din accident
  - [20/30] RON/zi spitalizare din accident
  - Cu BD: 2.000.000 EUR tratament în străinătate
  - Cu BD: 100 EUR/zi spitalizare abroad
  - Cu BD: 50.000 EUR medicație post-tratament
  - Cu BD: A doua opinie medicală gratuită
Valoarea reală a pachetului e de MILIOANE, nu de mii."

TEHNICA 4 — UPGRADE LA TIER III:
"Poți alege nivelul III de primă pentru suma maximă. La vârsta ta, asta înseamnă [suma Tier III] RON — semnificativ mai mult. Diferența de preț e doar 100 RON pe an (390 vs 290 RON). Pentru 100 de lei în plus pe an, primești [diferența sumelor] RON mai mult."

Referință rapidă Tier II vs Tier III:
  41-45: 18.000 → 26.000 RON (+8.000 pentru +100 RON/an)
  46-50: 11.000 → 16.000 RON (+5.000 pentru +100 RON/an)
  51-55: 7.500 → 11.000 RON (+3.500 pentru +100 RON/an)
  56-60: 5.500 → 8.000 RON (+2.500 pentru +100 RON/an)
  61-64: 3.500 → 5.000 RON (+1.500 pentru +100 RON/an)

TEHNICA 5 — PENTRU CLIENȚI CARE VOR SUME MARI DE DECES:
"Dacă ai nevoie de protecție de deces mai mare — 50.000, 100.000 EUR — avem alte produse de asigurare de viață cu sume personalizabile. Dar acelea necesită examen medical și sunt pe termen lung. Protect e gândit pentru accesibilitate și simplitate. Poți avea Protect ca bază rapidă + un produs separat pentru suma mare de deces."

CE SĂ NU FACI:
- Nu spune "dar e ieftin" — clientul nu întreabă de preț, ci de valoare
- Nu ignora obiecția trecând direct la BD — mai întâi explică onest
- Nu compara cu concurența pe sume — compară pe pachetul total
- Nu promite sume pe care produsul nu le oferă`,
    },
    {
      type: 'competitor',
      title: 'Am vazut mai ieftin / Mai bun in alta parte',
      addonContext: null,
      orderIndex: 8,
      isActive: true,
      strategy: `PRINCIPIU: Când clientul compară cu un competitor, e un SEMN BUN — înseamnă că e interesat de asigurare și a făcut research. Nu ataca niciodată competiția pe nume. Nu spune "aia e mai proastă." Diferențiază pe criterii concrete. Lasă clientul să tragă singur concluzia.

TEHNICA 1 — ÎNTREABĂ ÎNAINTE DE A DIFERENȚIA:
"E bine că ai comparat opțiunile — asta arată că iei decizia în serios. Pot să te întreb ce produs ai văzut? Ca să putem compara concret, nu general."

Dacă menționează un produs specific, ascultă ce le-a plăcut la el. Apoi adresează GAP-urile.

TEHNICA 2 — CHECKLIST DE DIFERENȚIERE:
"Hai să verificăm câteva lucruri:

1. Include tratament medical în străinătate de 2.000.000 EUR?
   (Cele mai multe asigurări de viață NU includ asta. E diferențiatorul major al Protect.)

2. Necesită examen medical?
   (Protect nu necesită — aprobare imediată, fără așteptare.)

3. Te leagă pe termen lung?
   (Protect e pe 1 an, fără lock-in. Multe polițe clasice sunt pe 10-20 ani.)

4. Acoperă și accidente — invaliditate, chirurgie, spitalizare?
   (Protect da — e un pachet complet, nu doar deces.)

5. Include a doua opinie medicală?
   (BD-ul din Protect da.)

6. Include medicație post-tratament (50.000 EUR)?
   (BD-ul din Protect da.)"

TEHNICA 3 — ANALOGIA RCA vs CASCO:
"Prețul mai mic de obicei înseamnă acoperire mai mică. E ca și cum ai compara o poliță RCA basic cu un CASCO full — da, RCA-ul e mai ieftin, dar când ai nevoie de ajutor real, vrei CASCO. Protect cu BD e CASCO-ul asigurărilor de viață."

TEHNICA 4 — DACĂ COMPARĂ CU ASIGURARE DE SĂNĂTATE PRIVATĂ:
"Sunt produse diferite care se completează. Asigurările de sănătate private clasice costă 200-500 EUR pe an și acoperă consultații, analize, spitalizare de rutină. Dar NU acoperă tratament oncologic de 2M EUR în străinătate, chimioterapie la Institut Curie, sau chirurgie cardiacă în Austria. Protect cu BD e pentru MARILE RISCURI — cele care pot costa zeci sau sute de mii de euro."

TEHNICA 5 — DACĂ COMPETITORUL E CHIAR MAI BINE PE UN CRITERIU:
Fii onest. Nu minți. "Ai dreptate, produsul lor oferă [X] care noi nu avem. Dar hai să vedem imaginea completă..." și redirecționează spre punctele forte ale Protect (BD, simplitate, fără examen medical, fără lock-in).

Onestitatea construiește încredere mai repede decât orice argument de vânzare.

TEHNICA 6 — DACĂ PREȚUL COMPETITORULUI E MULT MAI MIC:
"Un preț mai mic poate însemna trei lucruri: acoperire mai puțină, condiții mai restrictive, sau un produs diferit complet. De obicei, e o combinație din toate trei. Cel mai important lucru nu e cât plătești pe an — e ce primești când ai NEVOIE. Și momentul în care ai nevoie e exact momentul în care nu vrei surprize."

CE SĂ NU FACI:
- Nu ataca niciodată o companie de asigurări pe nume
- Nu spune "produsul lor e prost" — spune "produsele sunt diferite"
- Nu presupune ce oferă competitorul — întreabă clientul
- Nu fi defensiv dacă competitorul chiar are un avantaj pe un punct
- Nu exagera diferențele — fii precis și onest`,
    },
  ] as const

  // ── 3. Upsert each strategy ──────────────────────────────────────
  for (const s of strategies) {
    await prisma.objectionStrategy.upsert({
      where: {
        productId_type: { productId: product.id, type: s.type },
      },
      update: {
        title: s.title,
        strategy: s.strategy,
        addonContext: s.addonContext,
        orderIndex: s.orderIndex,
        isActive: s.isActive,
      },
      create: {
        productId: product.id,
        type: s.type,
        title: s.title,
        strategy: s.strategy,
        addonContext: s.addonContext,
        orderIndex: s.orderIndex,
        isActive: s.isActive,
      },
    })
  }

  console.log(`    ${strategies.length} objection strategies upserted`)
  console.log('  Objection strategies seed complete.')
}
