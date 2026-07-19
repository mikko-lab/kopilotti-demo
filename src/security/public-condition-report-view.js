'use strict';

const SECTION_LABELS = Object.freeze({
  generalCondition: 'Yleiskunto',
  bodyNotes: 'Korin huomiot',
  interiorCondition: 'Sisustan kunto',
  tyres: 'Renkaat',
  serviceHistory: 'Huoltohistoria',
  technicalNotes: 'Tekniset huomiot',
  repairsAndKnownFaults: 'Korjaukset tai tiedossa olevat viat',
});

function publicConditionReport(report) {
  return {
    id: report.id,
    vehicleId: report.vehicleId,
    version: report.version,
    contentHash: report.contentHash,
    inspectedAt: report.inspectedAt,
    sections: Object.entries(SECTION_LABELS)
      .filter(([key]) => typeof report.sections[key] === 'string')
      .map(([key, title]) => ({ key, title, content: report.sections[key] })),
    photographs: report.photographs.map((photo) => ({ url: photo.url, alt: photo.alt, caption: photo.caption })),
    sourceDocumentUrl: report.sourceDocumentUrl,
  };
}

function publicPurchaseSession(session) {
  return {
    id: session.id,
    vehicleId: session.vehicleId,
    purchasePath: session.purchasePath,
    status: session.status,
    version: session.version,
    report: session.report ? {
      id: session.report.id,
      version: session.report.version,
      contentHash: session.report.contentHash,
      displayed: !!session.report.displayedAt,
      acknowledged: session.report.acknowledgement === true,
    } : null,
  };
}

module.exports = { publicConditionReport, publicPurchaseSession };
