# Kopilotti — Digital Car Salesperson

Kopilotti on digitaalinen automyyjä, joka vie asiakkaan ajoneuvon valinnasta hinnan keskusteluun, maksutavan valintaan ja luovutuksen valmisteluun. Palvelu automatisoi autokaupassa syntyvän odotuksen, mutta ei korvaa automyyjää tai autoliikkeen vastuuta.

**LLM keskustelee. Backend päättää.**

→ [Live demo](https://mikko-lab.github.io/kopilotti-demo/)

## Asiakaspolku

```text
Ajoneuvo
  → keskustele hinnasta
  → hinnasta sovittu
  → tutustu kuntoraporttiin
  → valitse maksutapa
  → maksu odottaa vahvistusta
  → auto valmistellaan
  → valmis noudettavaksi
```

Asiakkaalle näytetään autokaupan käsitteitä, ei teknisiä tilakoneen nimiä. Kun hinnasta sovitaan, keskustelunäkymä päättyy ja käyttöliittymä vaihtuu ostoprosessiksi. Keskustelukanava voi tämän jälkeen välittää tietoa, mutta se ei enää voi muuttaa sovittua hintaa, ajoneuvoa tai kaupan ehtoja.

Suora **Osta / Varaa** -polku säilyy listahintaisena vaihtoehtona. **Digitaalinen automyyjä** on sen rinnalla palvelu autosta ja hinnasta keskustelemiseen. Laura- ja Mika-palvelutyylit vaikuttavat vain sanamuotoihin, eivät hintaan tai kaupallisiin päätöksiin.

## Arkkitehtuuri

```text
Customer UI
  ↓
LLM conversation layer
  ↓  untrusted structured input
Deterministic Policy Engine
  ↓
Transaction State Machine
  ↓
Trusted Payment / Financing Adapters
  ↓
Audit Trail + Transactional Outbox
  ↓
Handover Policy
```

### LLM

LLM hoitaa luonnollisen keskustelun ja muuntaa asiakkaan ilmaiseman hinnan rajattuun työkalukutsuun. Se ei näe minimihintaa, tavoitehintaa, hyväksyntärajoja, handover-policyä tai ostajan henkilötietoja. LLM ei hyväksy hintaa eikä muuta transaktion tilaa itsenäisesti.

### Deterministic Policy Engine

Puhdas deterministinen moottori tekee kaupallisen `ACCEPT`, `COUNTER`, `REJECT` tai `ESCALATE`-päätöksen palvelimen omistamasta inventaariosta ja versioidusta policystä. Sama syöte ja sama policy tuottavat saman tuloksen.

### Transaction State Machine

Backend lukitsee sovitun hinnan, ostajan ja ajoneuvon atomisesti. Maksutavan valinta johtaa samaan odotustilaan riippumatta siitä, valitseeko asiakas tilisiirron vai rahoituksen. Maksu- ja rahoituscallbackit ovat varmennettuja ja idempotentteja.

### Trusted Provider Adapters

Vain varmennetut maksun ja rahoituksen provider-adapterit voivat vahvistaa suorituksen. Selaimen tai LLM:n ilmoitus ei riitä. Toistetut callbackit ja Kafka-tapahtumat deduplikoidaan pysyvästi.

### Audit Trail ja CDC

Jokainen tilasiirtymä auditoidaan lähteineen ja turvallisine payload-tietoineen. Transactional Outbox kirjoitetaan samassa PostgreSQL-transaktiossa muutoksen kanssa. Debezium välittää tapahtumat Kafkaan at-least-once-periaatteella, ja idempotentti kuluttajakerros estää saman tapahtuman business-logiikan tuplasuorituksen.

### Handover Policy

Luovutus perustuu versioituun autoliikekohtaiseen policyyn. Policy ja sen sisäiset säännöt pysyvät backendissä. Ajoneuvon voi merkitä luovutetuksi vain valtuutettu backend-toiminto, kun maksu ja kaikki vaaditut luovutusedellytykset on vahvistettu.

## Turvallisuusperiaatteet

- Hinnoittelusäännöt ja hyväksyntärajat eivät poistu backendistä.
- LLM:n ja selaimen data käsitellään epäluotettavana syötteenä.
- Sitova hinnan lukitus edellyttää vahvasti tunnistettua ostajaa.
- Ajoneuvo lukitaan PostgreSQL:n rivi- ja revisiolukituksilla.
- Callbackit ja Kafka-kulutus ovat idempotentteja.
- Audit- ja outbox-kirjoitukset ovat atomisia transaktion kanssa.
- Asiakasrajapinta ei palauta sisäisiä reason codeja tai policy-tietoja.
- Demo ei muodosta sitovaa kauppaa, maksua, rahoitussopimusta tai varausta.

## Sprint 4 -demo

Ajoneuvosivulla on automaattinen **Run Demo** -läpikävely:

```text
Alfa Romeo Giulia Quadrifoglio · XYZ-123 · 95 000 €
  → keskustelu hinnasta
  → hinnasta sovittu 92 500 €
  → maksutapa valittu
  → maksu odottaa vahvistusta
  → maksu vahvistettu
  → valmis noudettavaksi
```

Run Demo esittää vain asiakaspolun käyttöliittymässä. Se ei toteuta hinnoittelua selaimessa, kutsu provider-callbackia tai ohita backendin tilakonetta.

Ajoneuvon asiakasnäkymä: `vehicle.html?id=veh-0001`.

## Paikallinen kehitys

Vaatimus: Node.js 22.18 tai uudempi.

```bash
npm install
npm test
npm start
```

CDC- ja monitorointipino:

```bash
cp .env.example .env
docker compose up -d --build
```

Palvelut:

- sovellus: `http://localhost:3001`
- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3000`
- Debezium Connect: `http://localhost:8083`
- Debezium JMX metrics: `http://localhost:9404/metrics`

Anonyymi Digital Salesperson -demo-BFF on oletuksena pois käytöstä. Sen paikallinen käyttö vaatii `ENABLE_CUSTOMER_NEGOTIATION_DEMO=true`. Simuloidut maksupalvelut vaativat lisäksi `ENABLE_SIMULATED_PURCHASE_PROVIDERS=true`. Tuotantokäyttö edellyttää oikeaa asiakasistuntoa, CSRF-suojausta, rate limitingiä ja provider-kohtaisia salaisuuksia.

## Testaus

```bash
npm test
```

Testit kattavat deterministisen neuvottelun, vahvan tunnistamisen, kuntoraportin kuittauksen, maksun ja rahoituksen callbackit, idempotenssin, PostgreSQL-lukitukset, auditoinnin, outboxin, SSE:n, monitoroinnin ja asiakaspolun saavutettavuuden.

> Projekti on tuotantoarkkitehtuuria havainnollistava konsepti. Asiakasdemo ei tee oikeaa autokauppaa tai varausta.

© 2026 Mikko Tarkiainen. MIT-lisenssi. Katso [LICENSE](LICENSE).
