import 'reflect-metadata';
import { ConfigModule } from './config.module';
import { ConfigService } from './config.service';

describe('ConfigModule', () => {
  it('only provides ConfigService because GCP secrets preload before Nest bootstrap', () => {
    const providers = Reflect.getMetadata('providers', ConfigModule);
    const exports = Reflect.getMetadata('exports', ConfigModule);

    expect(providers).toEqual([ConfigService]);
    expect(exports).toEqual([ConfigService]);
  });
});

