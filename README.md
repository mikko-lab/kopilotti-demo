# Kopilotti — AI-powered sales co-pilot for automotive retail

Reaaliaikainen tekoälyassistentti, joka analysoi myyjän ja asiakkaan keskustelua, tunnistaa ostoaikeet ja integroi havainnot suoraan liiketoimintajärjestelmiin (CRM / ERP) tehostaakseen myyntiprosessia.

**→ [Live demo](https://mikko-lab.github.io/kopilotti-demo/)**

![Kopilotti-käyttöliittymä: AI Insights -mittarit (ostohalukkuus 72 %, confidence 7 %), Suggested Next Action -kortti jossa merkintä tarkistamattomasta tekoälyehdotuksesta, ja Suositellut autot -kortti jossa jokainen tulos selittää täsmäävät kriteerit yksitellen](assets/screenshot.png)

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

**Stack:** Vanilla JS · Web Speech API · Node.js · Express · Server-Sent Events · Claude API · Railway

---

## Kehityssuunnitelma

### ✅ Toteutettu
- **SSE-striimaus** — LLM-analyysi pyörii Node.js-backendissä (Railway), tulokset striimautuvat Server-Sent Events -yhteydellä suoraan myyjän näytölle. API-avain palvelimella, ei selaimessa.
- **Graceful fallback** — jos backend ei ole tavoitettavissa (tai LLM-kutsu epäonnistuu palvelimella), UI siirtyy automaattisesti paikalliseen analyysiin ilman virheilmoituksia.
- **Enterprise-käyttöliittymän uudistus** — Stripe/Linear-tason visuaalinen ilme: tumma header, uusi väripaletti, SVG-pohjaiset ostohalukkuus-/confidence-mittarit, kaksipalstainen responsiivinen layout. WCAG 2.2 AA -tasoinen saavutettavuus (kontrasti tarkistettu myös axe:n omien sokeiden pisteiden — aria-hidden-sisältö, ::after-pseudoelementit — ohi käsinlasketulla auditoinnilla; näppäimistökäyttö ja `prefers-reduced-motion` testattu).
- **Deterministinen tekoälypohjainen varastonhaku** — 375 ajoneuvon siemenpohjainen, uusittavissa oleva demovarasto (`npm run generate:inventory`, 357 henkilöautoa + 18 pakettiautoa), joka poimii keskustelusta korityypin, polttoaineen, hinnan, vaihteiston, kilometri- ja ikärajan sekä signaalit (rahoitus, perhetarve, hintaherkkyys) — nämä ovat kovia suodattimia, ei pehmeitä tageja, joten tulos vastaa oikeasti sitä mitä asiakas sanoi. Pakettiautohaku ("etsin pakettiautoa", "onko alv-vähennyskelpoinen") näyttää vain pakettiautoja, merkittynä ALV-vähennyskelpoisuudella ehtoineen. Tasapelit ratkeavat eksplisiittisellä säännöllä (halvin ensin, sitten auton ID) — ei riipu satunnaisuudesta tai toteutuksen yksityiskohdista.

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
