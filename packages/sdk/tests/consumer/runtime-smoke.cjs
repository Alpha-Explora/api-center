const assert = require('node:assert/strict');

async function main() {
  const commonJs = require('@alpha-explora/apicenter-sdk');
  const esm = await import('@alpha-explora/apicenter-sdk');
  for (const entry of [commonJs, esm]) {
    assert.equal(typeof entry.ApiCenter, 'function');
    assert.equal(typeof entry.ApiCenterError, 'function');
    assert.equal(typeof entry.parsePaymentEvent, 'function');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
