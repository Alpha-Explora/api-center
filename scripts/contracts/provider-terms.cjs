// Provider-neutral boundary checks (ADR-0010), shared by the contract validator and the docs check.
// Forbidden vendor terms may not appear in a public contract or public docs page except where
// contracts/public/provider-terms.json allows them; raw provider fields and deprecations must be declared.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

function loadProviderTerms(root) {
  return JSON.parse(readFileSync(join(root, 'contracts/public/provider-terms.json'), 'utf8'));
}

function allowedAt(terms, document, term, location) {
  return terms.allowed.some((rule) => rule.document === document && (rule.term === term || rule.term === '*')
    && ((rule.paths ?? []).some((pattern) => new RegExp(pattern).test(location))
      || (rule.files ?? []).includes(location)));
}

function termsIn(text, terms) {
  const lower = String(text).toLowerCase();
  // A longer forbidden term (pubsub.googleapis) reports once, not again as its shorter part (pubsub).
  const found = terms.forbidden.filter((term) => lower.includes(term));
  return found.filter((term) => {
    const longer = found.filter((other) => other !== term && other.includes(term));
    const rest = longer.reduce((text, other) => text.split(other).join(' '), lower);
    return rest.includes(term);
  });
}

/** Every forbidden term in a parsed contract: keys, string values, enum values and examples. */
function scanDocument(document, kind, terms) {
  const violations = [];
  const visit = (value, location) => {
    if (typeof value === 'string') {
      for (const term of termsIn(value, terms)) {
        if (!allowedAt(terms, kind, term, location)) violations.push({ location, term });
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${location}[${index}]`));
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        const childLocation = location ? `${location}.${key}` : key;
        for (const term of termsIn(key, terms)) {
          if (!allowedAt(terms, kind, term, childLocation)) violations.push({ location: childLocation, term });
        }
        visit(child, childLocation);
      }
    }
  };
  visit(document, '');
  return violations;
}

/** Every forbidden term in a docs page, by line. */
function scanText(file, text, terms) {
  const violations = [];
  String(text).split(/\r?\n/).forEach((line, index) => {
    for (const term of termsIn(line, terms)) {
      if (!allowedAt(terms, 'docs', term, file)) violations.push({ location: `${file}:${index + 1}`, term });
    }
  });
  return violations;
}

/**
 * Raw provider fields must be deprecated or temporarily excepted; every deprecated property needs a
 * sunset entry, and every entry must name a property that exists and is marked deprecated.
 */
function checkDeprecations(openApi, terms) {
  const problems = [];
  const schemas = openApi?.components?.schemas ?? {};
  const listed = (list, schema, field) => (list ?? []).some((entry) => entry.schema === schema && entry.field === field);
  for (const [schemaName, schema] of Object.entries(schemas)) {
    for (const [field, property] of Object.entries(schema?.properties ?? {})) {
      const declared = listed(terms.deprecatedFields, schemaName, field);
      if (property?.deprecated === true && !declared) {
        problems.push(`${schemaName}.${field} is deprecated without a sunset in provider-terms.json`);
      }
      if (terms.rawFieldNames.includes(field) && !(property?.deprecated === true && declared)
        && !listed(terms.temporaryExceptions, schemaName, field)) {
        problems.push(`${schemaName}.${field} exposes raw provider data`);
      }
    }
  }
  for (const entry of terms.deprecatedFields ?? []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.sunset ?? '')) problems.push(`${entry.schema}.${entry.field} needs a sunset date`);
    if (schemas[entry.schema]?.properties?.[entry.field]?.deprecated !== true) {
      problems.push(`${entry.schema}.${entry.field} is listed as deprecated but is not marked deprecated`);
    }
  }
  return problems;
}

module.exports = { loadProviderTerms, scanDocument, scanText, checkDeprecations };
