# Kopilotti — AI-powered sales co-pilot for automotive retail

Reaaliaikainen tekoälyassistentti, joka analysoi myyjän ja asiakkaan keskustelua, tunnistaa ostoaikeet ja integroi havainnot suoraan liiketoimintajärjestelmiin (CRM / ERP) tehostaakseen myyntiprosessia.

**→ [Live demo](https://mikko-lab.github.io/kopilotti-demo/)**

![Kopilotti-käyttöliittymä: AI Insights -mittarit (ostohalukkuus 71 %, confidence 9 %), Suggested Next Action -kortti jossa merkintä tarkistamattomasta tekoälyehdotuksesta, ja Suositellut autot -kortti jossa jokainen tulos näyttää oikean autokuvan ja selittää täsmäävät kriteerit yksitellen](assets/screenshot.png)

---

## Miksi Kopilotti on tehty

Olen työskennellyt vaihtoautokaupassa yli 20 vuotta ja ollut mukana ostamassa ja myymässä arviolta noin 15 000 autoa. Sinä aikana ala on muuttunut perusteellisesti.

Kun aloitin urani, myyjä tunsi oman liikkeensä varaston ulkoa ja asiakas kävi lähes aina paikan päällä. Nykyään suuret autotalot myyvät vaihtoautoja etänä ympäri Suomea, ja yhden toimijan varastossa voi olla samanaikaisesti tuhansia autoja useissa toimipisteissä. Yksikään myyjä ei enää pysty muistamaan koko valikoimaa tai yhdistämään sitä reaaliajassa asiakkaan tarpeisiin kesken puhelun tai chat-keskustelun.

Samaan aikaan vaihtoautokaupan kannattavuus perustuu yhä enemmän lisäpalveluihin. Pelkkä auton myyntikate ei enää ratkaise, vaan merkittävä osa liiketoiminnasta muodostuu rahoituksesta, vakuutuksista, huolenpitosopimuksista ja muista lisäpalveluista. Myyjän pitäisi tunnistaa oikealla hetkellä asiakkaan ostosignaalit ja ehdottaa juuri hänelle sopivia ratkaisuja – samalla kun keskustelu etenee luonnollisesti.

Kopilotti syntyi ratkaisemaan tätä ongelmaa.

Se toimii tekoälypohjaisena myyntiavustajana, joka kuuntelee keskustelua reaaliajassa, tunnistaa asiakkaan tarpeet ja ostoaikeet sekä yhdistää ne ajoneuvovarastoon ja liiketoimintajärjestelmiin. Sen sijaan, että myyjä etsisi tietoa useista eri järjestelmistä tai yrittäisi muistaa tuhansien autojen valikoiman ulkoa, Kopilotti nostaa keskustelun perusteella esiin sopivimmat autot, seuraavat myyntitoimenpiteet ja CRM:ään vietävät tiedot juuri silloin, kun niitä tarvitaan.

Projektin tarkoitus ei ole korvata myyjää, vaan antaa hänelle reaaliaikainen päätöksenteon tuki. Samalla se demonstroi, miten tekoäly voi toimia integraatiokerroksena keskusteluanalytiikan, ajoneuvovaraston ja CRM-/ERP-järjestelmien välillä yritysympäristössä.

---

## Mitä se tekee

- Tunnistaa puheesta keskeiset ostosignaalit (hintaepäily, rahoitus, vaihtoauto, perhetilanne)
- Arvioi ostohalukkuuden reaaliajassa (0–100 %)
- Antaa myyjälle tilannekohtaisia next-step -vihjeitä kesken keskustelun
- Generoi automaattisen CRM-yhteenvedon ja laukaisee jatkotoimet

---

## Integraatiokonsepti

Kopilotti on suunniteltu toimimaan **integraatiokerroksena** keskusteluanalytiikan ja liiketoimintajärjestelmien välillä.

```
Keskustelu → speech-to-text
     ↓
LLM analysoi intentin ja ostosignaalit
     ↓
Tulos strukturoituu (JSON)
     ↓
API → CRM / ERP
     ↓
Triggerit:
  korkea ostohalukkuus   → follow-up task
  rahoituskiinnostus     → tarjouspohjan esitäyttö
  vaihtoauto             → arviointiprosessin käynnistys
```

Soveltuu laajennettavaksi integraatioalustoihin kuten **Workato**, **Dell Boomi** tai **Frends**.

---

## Liiketoimintahyödyt

- Vähentää manuaalista kirjaamista CRM:ään
- Nopeuttaa reagointia kuumiin liideihin
- Parantaa myyjien suoriutumista reaaliaikaisella tuella
- Mahdollistaa datavetoisen myyntiprosessin kehittämisen

---

## Tekninen näkökulma

Rakennettu API-pohjaisena arkkitehtuurina, jossa LLM-analyysi toimii erillisenä palveluna ja integroituu backendiin. Käyttöliittymä on tarkoituksella kevyt — logiikka on integraatiokerroksessa, ei UI:ssa.

**Stack:** Vanilla JS · Web Speech API · Node.js · Express · Server-Sent Events · Claude API (tool use / structured output) · Railway

---

## Kehityssuunnitelma

### ✅ Toteutettu
- **SSE-striimaus** — LLM-analyysi pyörii Node.js-backendissä (Railway), tulokset striimautuvat Server-Sent Events -yhteydellä suoraan myyjän näytölle. API-avain palvelimella, ei selaimessa. **Huom:** Railway-backend ei ole tällä hetkellä käynnissä (kokeilujakso päättynyt) — [live-demo](https://mikko-lab.github.io/kopilotti-demo/) toimii tästä huolimatta täysin normaalisti alla kuvatun graceful fallbackin varassa, sillä demo-skenaariot eivät ylipäätään tarvitse backendiä (ks. seuraava kohta).
- **Graceful fallback** — jos backend ei ole tavoitettavissa (tai LLM-kutsu epäonnistuu palvelimella), UI siirtyy automaattisesti paikalliseen analyysiin ilman virheilmoituksia.
- **Enterprise-käyttöliittymän uudistus** — Stripe/Linear-tason visuaalinen ilme: tumma header, uusi väripaletti, SVG-pohjaiset ostohalukkuus-/confidence-mittarit, kaksipalstainen responsiivinen layout. WCAG 2.2 AA -tasoinen saavutettavuus (kontrasti tarkistettu myös axe:n omien sokeiden pisteiden — aria-hidden-sisältö, ::after-pseudoelementit — ohi käsinlasketulla auditoinnilla; näppäimistökäyttö ja `prefers-reduced-motion` testattu).
- **Deterministinen tekoälypohjainen varastonhaku** — 375 ajoneuvon siemenpohjainen, uusittavissa oleva demovarasto (`npm run generate:inventory`, 357 henkilöautoa + 18 pakettiautoa), joka poimii keskustelusta korityypin, polttoaineen, hinnan, vaihteiston, kilometri- ja ikärajan sekä signaalit (rahoitus, perhetarve, hintaherkkyys) — nämä ovat kovia suodattimia, ei pehmeitä tageja, joten tulos vastaa oikeasti sitä mitä asiakas sanoi. Pakettiautohaku ("etsin pakettiautoa", "onko alv-vähennyskelpoinen") näyttää vain pakettiautoja, merkittynä ALV-vähennyskelpoisuudella ehtoineen. Tasapelit ratkeavat eksplisiittisellä säännöllä (halvin ensin, sitten auton ID) — ei riipu satunnaisuudesta tai toteutuksen yksityiskohdista. Jokaisella merkillä/mallilla on oikea, vapaasti lisensoitu esimerkkivalokuva (Wikimedia Commons, ks. `assets/cars/CREDITS.md`) — sama kuva jaetaan kaikkien vuosimalli-/varustelu-/värivariaatioiden kesken, ei siis kuva juuri kyseisestä yksittäisestä autosta.
- **Strukturoitu tekoälyvastaus (tool use)** — backend ei enää pyydä Claudelta vapaata tekstiä omalla rivietuliite-protokollalla, vaan pakottaa vastauksen JSON-skeeman mukaiseksi Anthropicin tool use -ominaisuudella (`emit_analysis`). Poistaa kokonaisen luokan hiljaisia parse-virheitä, joissa yksittäinen poikkeava rivi (selitysteksti, markdown-koodilohko) tiputti vihjeen jäljettömiin ilman virheilmoitusta.
- **Automieltymysten tunnistuksen korjaus** — jos asiakas vaihtaa mieltä kesken keskustelun (esim. "farmari" → myöhemmin "maasturi"), järjestelmä poimii nyt viimeisimmän maininnan eikä jää kiinni ensimmäiseen sääntötaulukon mukaiseen osumaan. Live-mikrofonisession tila (transkriptio, tunnistetut signaalit) nollautuu myös oikein sessioiden välillä, ja saman analyysivastauksen sisällä toistuvat signaalityypit eivät enää vääristä ostohalukkuuden confidence-laskentaa keinotekoisesti.
- **Todennettava asiakassuostumus (hash-ketjutettu audit-loki)** — asiakkaan suostumus puheen analysointiin kirjataan nyt hash-ketjutettuun lokiin (`js/audit-log.js`), jossa jokainen merkintä sitoutuu edellisen SHA-256-hashiin; jälkikäteinen muokkaus tai poisto rikkoo ketjun ja on havaittavissa. Suostumusnäkymän näkyvyys tarkistetaan `getComputedStyle`:llä ennen hyväksynnän kirjaamista — jos näkymä on esim. piilotettu CSS:llä, suostumusta ei hiljaa hyväksytä. Kieltäytyminen lukitsee session käynnistyksen oikeasti, ei vain näytä ilmoitusta.

### Seuraavaksi: Oikeat integraatiot
Mock-triggerit korvataan oikeilla API-kutsuilla integraatioalustan (Workato / Frends) kautta:
- **CRM webhook** → follow-up task syntyy automaattisesti
- **ERP-kutsu** → tarjouspohja esitäytetään rahoitusnumerolla
- **Varastonhallinta** → reaaliaikainen saatavuus ehdotetuille autoille

### Data ja oppiminen
Jokaisesta kohtaamisesta kertyy dataa — ostohalukkuus, signaaliyhdistelmät, konversio. Ajan myötä tunnistettavissa esim. että "vaihtoauto + rahoituskiinnostus" konvertoi 40% paremmin kuin muut. Datan avulla mallia voidaan finetunata.

### Tietosuoja
- GDPR-dokumentaatio ja datan retentio-policy
- Suostumuskirjaus lokiin — ei pelkkä UI-nappi
- Ääntä ei tallenneta missään vaiheessa (speech-to-text tapahtuu selaimessa)

---

## Kokeile demoa

1. Avaa [https://mikko-lab.github.io/kopilotti-demo/](https://mikko-lab.github.io/kopilotti-demo/)
2. Paina **"✓ Asiakas hyväksyi"**
3. Valitse demo-skenaario **Rahoitus** tai **Perhe** — nämä tuottavat myös osuvat automieltymyssignaalit, joten "Suositellut autot" -kortti näyttää tekoälypohjaisen varastonhaun oikeasti toiminnassa. (Skenaariot Ostovalmis ja Vaihto koskevat tarkoituksella vain ostoprosessin vaihetta, eivät automieltymystä — niissä ei siksi näy autosuosituksia, mikä on tarkoituksellista, ei virhe.)
4. Seuraa vihjeitä sekä ostohalukkuus- ja confidence-mittareita reaaliajassa
5. Paina **"📋 Synkronoi CRM:ään"** → näet automaattisen tilapäivityksen, Automation Status -putken ja integraatiotriggerit

---

> ⚠️ Rakennettu konseptiksi — fokus idean, käyttötapauksen ja arkkitehtuurin demonstroinnissa, ei tuotantovalmiudessa.

---

*Tekijä: [Mikko Tarkiainen](https://www.linkedin.com/in/mikko-tarkiainen-accessibility/)*

© 2026 Mikko Tarkiainen. MIT-lisenssi. Ks. [LICENSE](LICENSE).
