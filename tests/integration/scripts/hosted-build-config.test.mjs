import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import YAML from 'yaml';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const builds = [
  'apicenter-docs-image.json', 'apicenter-hosted-web-images.json',
  'apicenter-onboarding-gateway-image.json', 'apicenter-registration-fix-images.json',
  'apicenter-workspace-images.json',
];

test('hosted build dependencies use arrays and refer to existing steps', () => {
  for (const file of builds) {
    const build = JSON.parse(fs.readFileSync(path.join(root, 'infra/gcp/cloud-build', file), 'utf8'));
    const ids = new Set(build.steps.map(step => step.id).filter(Boolean));
    assert.equal(ids.size, build.steps.filter(step => step.id).length, file);
    for (const step of build.steps) {
      if (step.waitFor !== undefined) {
        assert.ok(Array.isArray(step.waitFor), `${file}: waitFor must be an array`);
        for (const dependency of step.waitFor) assert.ok(dependency === '-' || ids.has(dependency), `${file}: unknown dependency ${dependency}`);
      }
      assert.ok(Array.isArray(step.args), `${file}: args must be an array`);
    }
  }
});

test('build commands reference checked-in Dockerfiles and declared targets', () => {
  for (const file of builds) {
    const build = JSON.parse(fs.readFileSync(path.join(root, 'infra/gcp/cloud-build', file), 'utf8'));
    for (const step of build.steps) {
      if (step.args?.[0] !== 'build') continue;
      const filename = step.args[step.args.indexOf('-f') + 1];
      assert.ok(filename, file);
      const dockerfile = fs.readFileSync(path.join(root, filename), 'utf8');
      const targetIndex = step.args.indexOf('--target');
      if (targetIndex >= 0) assert.match(dockerfile, new RegExp(`^FROM .* AS ${step.args[targetIndex + 1]}\\s*$`, 'mi'));
    }
  }
});

for (const [environment, cap] of [['live', '2'], ['test', '1']]) {
  test(`payment ${environment} manifest preserves cost limits without exported revision metadata`, () => {
    const file = path.join(root, `infra/gcp/cloud-run/apicenter-payments.${environment}.yaml`);
    const data = YAML.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(data.metadata.annotations['run.googleapis.com/ingress'], 'internal');
    assert.equal(data.metadata.annotations['run.googleapis.com/maxScale'], cap);
    assert.equal(data.spec.template.metadata.annotations['autoscaling.knative.dev/maxScale'], cap);
    assert.equal(data.spec.template.metadata.annotations['autoscaling.knative.dev/minScale'], '0');
    assert.equal(data.spec.template.metadata.annotations['run.googleapis.com/cpu-throttling'], 'true');
    assert.equal(data.metadata.namespace, undefined);
    assert.equal(data.metadata.annotations['run.googleapis.com/urls'], undefined);
    assert.equal(data.spec.template.metadata.name, undefined);
    assert.equal(data.status, undefined);
    assert.doesNotMatch(data.spec.template.spec.containers[0].image, /:build-/);
  });
}

test('test payment database secret does not reference a destroyed historical version', () => {
  const data = YAML.parse(fs.readFileSync(path.join(root, 'infra/gcp/cloud-run/apicenter-payments.test.yaml'), 'utf8'));
  const reference = data.spec.template.spec.containers[0].env.find(item => item.name === 'SHARED_SERVICES_DATABASE_URL').valueFrom.secretKeyRef;
  assert.deepEqual(reference, { key: '4', name: 'apicenter-payments-test-database-url' });
});
