import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..', '..');
const indexHtml = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(repoRoot, 'js', 'app.js'), 'utf8');
const stylesSource = fs.readFileSync(path.join(repoRoot, 'styles.css'), 'utf8');
const logoSource = fs.readFileSync(path.join(repoRoot, 'assets', 'kopilotti-mark-on-dark.svg'), 'utf8');

describe('suomenkielinen käyttöliittymä', () => {
  test('automaatiotilan kortti ja sen käyttämätön toteutus on poistettu', () => {
    expect(indexHtml).not.toContain('id="automationSteps"');
    expect(indexHtml).not.toContain('Automation Status');
    expect(appSource).not.toContain('animateAutomationSteps');
    expect(stylesSource).not.toContain('.automation-step');
  });

  test('näkyvät pääotsikot ja tilat ovat suomeksi', () => {
    const document = new JSDOM(indexHtml).window.document;
    const visibleText = document.body.textContent.replace(/\s+/g, ' ').trim();

    for (const text of [
      'Tekoälyavusteinen myyntiapuri',
      'Esimerkkitilanteet',
      'Tapahtumat',
      'Tekoälyn havainnot',
      'CRM-integraatio',
      'Rekisterihaku',
      'Odottaa',
    ]) {
      expect(visibleText).toContain(text);
    }

    for (const text of [
      'AI Sales Copilot',
      'Live Events',
      'AI Insights',
      'CRM Integration',
      'Vehicle Lookup',
      'Pending',
      'Speech',
      'Demo-skenaariot',
      'Integraatiotriggerit',
    ]) {
      expect(visibleText).not.toContain(text);
    }
  });

  test('header käyttää Salesin kanonista K-symbolia ilman vanhaa kompassimerkkiä', () => {
    const document = new JSDOM(indexHtml).window.document;
    const logo = document.querySelector('img.logo-mark');

    expect(logo?.getAttribute('src')).toBe('assets/kopilotti-mark-on-dark.svg');
    expect(logo?.getAttribute('alt')).toBe('');
    expect(document.querySelector('.logo-mark svg')).toBeNull();
    expect(logoSource).toContain('Kopilotti K-symboli (tumma tausta)');
    expect(logoSource).toContain('fill="#FFFFFF"');
    expect(logoSource).toContain('stroke="#1677FF"');
  });

  test('dynaamiset CRM-tilat, tapahtumat ja varmuusmittari ovat suomeksi', () => {
    for (const text of ["label: 'Pending'", "label: 'Queued'", "label: 'Synced'", "label: 'Failed'", "label: 'Confidence'"]) {
      expect(appSource).not.toContain(text);
    }

    for (const text of ["label: 'Odottaa'", "label: 'Jonossa'", "label: 'Synkronoitu'", "label: 'Epäonnistui'", "label: 'Varmuus'"]) {
      expect(appSource).toContain(text);
    }

    expect(appSource).not.toContain("'⚠️ Backend ei tavoitettavissa");
    expect(appSource).toContain("'⚠️ Taustapalvelu ei tavoitettavissa");
  });
});
