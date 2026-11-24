// eslint-disable-next-line @typescript-eslint/no-require-imports
const { scanDocument, scanText, checkDeprecations } = require('../../../scripts/contracts/provider-terms.cjs');

const terms = {
  forbidden: ['paymongo', 'pubsub.googleapis', 'pubsub', 'resend'],
  allowed: [
    { term: 'pubsub.googleapis', document: 'asyncapi', paths: ['^servers\\.'] },
    { term: '*', document: 'docs', files: ['apps/docs/content/docs/providers-and-data.mdx'] },
  ],
  rawFieldNames: ['raw', 'placeId'],
  deprecatedFields: [{ schema: 'Geo', field: 'raw', sunset: '2027-03-01' }],
  temporaryExceptions: [{ schema: 'Geo', field: 'placeId' }],
};

describe('provider-neutral contract checks', () => {
  it('reports a forbidden term in a description, key or enum value', () => {
    const violations = scanDocument({
      components: { schemas: { A: { description: 'Confirmed by PayMongo.', properties: { resendId: {}, kind: { enum: ['x', 'paymongo'] } } } } },
    }, 'openapi', terms);
    expect(violations.map((v: { location: string }) => v.location)).toEqual([
      'components.schemas.A.description',
      'components.schemas.A.properties.resendId',
      'components.schemas.A.properties.kind.enum[1]',
    ]);
  });

  it('lets payment methods through', () => {
    expect(scanDocument({ enum: ['card', 'gcash', 'paymaya', 'qrph', 'instapay'] }, 'openapi', terms)).toEqual([]);
  });

  it('allows a term only where provider-terms.json allows it', () => {
    expect(scanDocument({ servers: { test: { host: 'pubsub.googleapis.com' } } }, 'asyncapi', terms)).toEqual([]);
    expect(scanDocument({ info: { description: 'pubsub.googleapis.com' } }, 'asyncapi', terms))
      .toEqual([{ location: 'info.description', term: 'pubsub.googleapis' }]);
  });

  it('reports a longer term once, not again as its shorter part', () => {
    expect(scanDocument({ x: 'pubsub.googleapis.com' }, 'openapi', terms)).toEqual([{ location: 'x', term: 'pubsub.googleapis' }]);
    expect(scanDocument({ x: 'pubsub.googleapis.com and pubsub' }, 'openapi', terms)).toHaveLength(2);
  });

  it('scans docs pages by line and exempts the sub-processor page', () => {
    expect(scanText('apps/docs/content/docs/a.mdx', 'one\nSent by Resend.', terms))
      .toEqual([{ location: 'apps/docs/content/docs/a.mdx:2', term: 'resend' }]);
    expect(scanText('apps/docs/content/docs/providers-and-data.mdx', 'PayMongo', terms)).toEqual([]);
  });

  it('requires raw provider fields to be deprecated with a sunset, or temporarily excepted', () => {
    const openApi = (raw: object) => ({ components: { schemas: { Geo: { properties: { raw, placeId: {}, other: {} } } } } });
    expect(checkDeprecations(openApi({ deprecated: true }), terms)).toEqual([]);
    expect(checkDeprecations(openApi({}), terms)).toEqual([
      'Geo.raw exposes raw provider data',
      'Geo.raw is listed as deprecated but is not marked deprecated',
    ]);
  });

  it('deprecated fields must declare a sunset', () => {
    const openApi = { components: { schemas: { Otp: { properties: { target: { deprecated: true } } } } } };
    expect(checkDeprecations(openApi, { ...terms, deprecatedFields: [] }))
      .toEqual(['Otp.target is deprecated without a sunset in provider-terms.json']);
    expect(checkDeprecations(openApi, { ...terms, deprecatedFields: [{ schema: 'Otp', field: 'target', sunset: 'soon' }] }))
      .toEqual(['Otp.target needs a sunset date']);
  });
});
