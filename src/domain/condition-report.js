'use strict';

const crypto = require('node:crypto');
const { DomainValidationError } = require('./money');

const CUSTOMER_SECTION_KEYS = Object.freeze([
  'generalCondition', 'bodyNotes', 'interiorCondition', 'tyres',
  'serviceHistory', 'technicalNotes', 'repairsAndKnownFaults',
]);

function normalizeConditionReport(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new DomainValidationError('Condition report must be an object', 'conditionReport');
  }
  const report = {
    id: requireString(input.id, 'id'),
    vehicleId: requireString(input.vehicleId, 'vehicleId'),
    version: requireString(input.version, 'version'),
    inspectedAt: requireIsoTimestamp(input.inspectedAt, 'inspectedAt'),
    sections: {},
    photographs: normalizePhotographs(input.photographs),
    sourceDocumentUrl: normalizeOptionalUrl(input.sourceDocumentUrl),
  };
  for (const key of CUSTOMER_SECTION_KEYS) {
    const value = input.sections?.[key];
    if (value != null) report.sections[key] = requireString(value, `sections.${key}`);
  }
  if (!Object.keys(report.sections).length) {
    throw new DomainValidationError('Condition report must contain at least one customer-facing section', 'sections');
  }
  const contentHash = crypto.createHash('sha256').update(canonicalize(report)).digest('hex');
  return Object.freeze({ ...report, contentHash });
}

function sameReportIdentity(expected, actual) {
  return !!expected && !!actual && expected.id === actual.id && expected.version === actual.version && expected.contentHash === actual.contentHash;
}

function normalizePhotographs(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 20) throw new DomainValidationError('photographs must be an array of at most 20 items', 'photographs');
  return value.map((photo, index) => ({
    url: requireSafeAssetUrl(photo?.url, `photographs.${index}.url`),
    alt: requireString(photo?.alt, `photographs.${index}.alt`),
    caption: photo?.caption == null ? null : requireString(photo.caption, `photographs.${index}.caption`),
  }));
}

function normalizeOptionalUrl(value) {
  if (value == null || value === '') return null;
  return requireSafeAssetUrl(value, 'sourceDocumentUrl');
}

function requireSafeAssetUrl(value, field) {
  const string = requireString(value, field);
  if (!/^(https:\/\/|\/)/.test(string)) throw new DomainValidationError(`${field} must use https or an absolute path`, field);
  return string;
}

function requireString(value, field) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) throw new DomainValidationError(`${field} is required`, field);
  return value.trim();
}

function requireIsoTimestamp(value, field) {
  const string = requireString(value, field);
  if (Number.isNaN(Date.parse(string))) throw new DomainValidationError(`${field} must be an ISO timestamp`, field);
  return new Date(string).toISOString();
}

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}

module.exports = { CUSTOMER_SECTION_KEYS, normalizeConditionReport, sameReportIdentity };
