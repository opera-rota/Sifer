import { describe, expect, it } from 'vitest';
import { readConfig } from './config';

const defaults = { identityUrl: 'http://127.0.0.1:8081', gatewayUrl: 'http://127.0.0.1:8080' };

describe('readConfig', () => {
  it('talks to identity and the gateway on loopback by default', () => {
    expect(readConfig({})).toEqual(defaults);
    expect(readConfig({ SIFER_IDENTITY_URL: '  ', SIFER_GATEWAY_URL: '' })).toEqual(defaults);
  });

  it('accepts overrides and keeps only the origin', () => {
    expect(
      readConfig({
        SIFER_IDENTITY_URL: 'https://identity.sifer.test/v1/ignored',
        SIFER_GATEWAY_URL: 'https://api.sifer.test/v1',
      }),
    ).toEqual({ identityUrl: 'https://identity.sifer.test', gatewayUrl: 'https://api.sifer.test' });
  });

  it('refuses anything that is not http or https', () => {
    for (const name of ['SIFER_IDENTITY_URL', 'SIFER_GATEWAY_URL']) {
      for (const value of ['file:///etc/passwd', 'identity:8081', 'ftp://x.test']) {
        expect(() => readConfig({ [name]: value })).toThrow(name);
      }
    }
  });
});
