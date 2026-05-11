import fs from 'node:fs';
import path from 'node:path';

type SharedServiceContract = {
  sharedServices: Array<{
    serviceId: string;
    manifest: string;
    endpoints?: string[];
  }>;
};

describe('shared-service contract snapshot', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const contractPath = path.join(repoRoot, 'docs', 'contracts', 'shared-service-contract.json');

  it('lists every route exposed by each shared-service manifest', () => {
    const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8')) as SharedServiceContract;

    for (const service of contract.sharedServices) {
      const manifestPath = path.resolve(repoRoot, service.manifest);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
        serviceId: string;
        exposes: string[];
      };

      expect(service.endpoints).toEqual(manifest.exposes);
    }
  });
});

