# Kopilotti — AI-powered sales co-pilot for automotive retail

Reaaliaikainen tekoälyassistentti, joka analysoi myyjän ja asiakkaan keskustelua, tunnistaa ostoaikeet ja integroi havainnot suoraan liiketoimintajärjestelmiin (CRM / ERP) tehostaakseen myyntiprosessia.

**→ [Live demo](https://mikko-lab.github.io/kopilotti-demo/)**

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

**Stack:** Vanilla JS · Web Speech API · LLM intent analysis · JSON output

---

## Kehityssuunnitelma

### Arkkitehtuuri
LLM-analyysi siirretään selaimesta backendiin — Node.js-mikropalvelu ottaa transkription vastaan, ajaa analyysin ja palauttaa strukturoidun JSONin. API-avain pysyy palvelimella ja logiikka on testattavissa.

### Oikeat integraatiot
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
3. Valitse demo-skenaario (esim. Hintaepäily tai Ostovalmis)
4. Seuraa vihjeitä ja ostohalukkuusmittaria reaaliajassa
5. Paina **"📋 CRM"** → näet automaattisen yhteenvedon ja integraatiotriggerit

---

> ⚠️ Rakennettu konseptiksi — fokus idean, käyttötapauksen ja arkkitehtuurin demonstroinnissa, ei tuotantovalmiudessa.

---

*Tekijä: [Mikko Tarkiainen](https://www.linkedin.com/in/mikko-tarkiainen-accessibility/)*
