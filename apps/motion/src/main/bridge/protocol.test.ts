import { describe, expect, it } from 'vitest';
import {
  extensionOrigin,
  maxNoteLength,
  isAllowedHost,
  parseExtensionMessage,
  parseProtocols,
  tokenProtocolPrefix,
} from './protocol';

const token = 'A'.repeat(43);

describe('extensionOrigin', () => {
  it('is pinned to the Sifer extension id', () => {
    expect(extensionOrigin).toBe('chrome-extension://pnfjfpdamacdolncmomebegoflehaejh');
  });
});

describe('parseProtocols', () => {
  it('reads a pairing request', () => {
    expect(parseProtocols('sifer.v1, sifer.pair')).toEqual({ kind: 'pair' });
  });

  it('reads a session token', () => {
    expect(parseProtocols(`sifer.v1, ${tokenProtocolPrefix}${token}`)).toEqual({
      kind: 'session',
      token,
    });
  });

  it('refuses anything else', () => {
    expect(parseProtocols(undefined)).toBeNull();
    expect(parseProtocols('sifer.pair')).toBeNull();
    expect(parseProtocols(`${tokenProtocolPrefix}${token}`)).toBeNull();
    expect(parseProtocols(`sifer.v1, ${tokenProtocolPrefix}short`)).toBeNull();
    expect(parseProtocols(`sifer.v1, sifer.pair, ${tokenProtocolPrefix}${token}`)).toBeNull();
    expect(
      parseProtocols(`sifer.v1, ${tokenProtocolPrefix}${token}, ${tokenProtocolPrefix}${token}`),
    ).toBeNull();
  });
});

describe('isAllowedHost', () => {
  it('accepts only loopback names on the bridge port', () => {
    expect(isAllowedHost('127.0.0.1:8770')).toBe(true);
    expect(isAllowedHost('localhost:8770')).toBe(true);
    expect(isAllowedHost('evil.example:8770')).toBe(false);
    expect(isAllowedHost('127.0.0.1:9000')).toBe(false);
    expect(isAllowedHost(undefined)).toBe(false);
  });
});

describe('parseExtensionMessage', () => {
  it('reads hello, keepalive and readings', () => {
    expect(parseExtensionMessage('{"type":"hello","browser":"Chrome","version":"141"}')).toEqual({
      type: 'hello',
      browser: 'Chrome',
      version: '141',
    });
    expect(parseExtensionMessage('{"type":"keepalive"}')).toEqual({ type: 'keepalive' });
    expect(
      parseExtensionMessage('{"type":"reading","id":4,"outcome":{"ok":false,"reason":"nothing"}}'),
    ).toEqual({ type: 'reading', id: 4, outcome: { ok: false, reason: 'nothing' }, note: null });
  });

  it('keeps a short extension note and drops an empty or oversized one', () => {
    const reading = (note: string): string =>
      JSON.stringify({ type: 'reading', id: 2, outcome: { ok: false, reason: 'nothing' }, note });
    expect(parseExtensionMessage(reading('no window matched 656,314'))).toMatchObject({
      note: 'no window matched 656,314',
    });
    expect(parseExtensionMessage(reading(''))).toMatchObject({ note: null });
    expect(parseExtensionMessage(reading('x'.repeat(maxNoteLength + 1)))).toMatchObject({
      note: null,
    });
  });

  it('drops malformed and unknown messages', () => {
    expect(parseExtensionMessage('not json')).toBeNull();
    expect(parseExtensionMessage('[]')).toBeNull();
    expect(parseExtensionMessage('{"type":"run","command":"calc"}')).toBeNull();
    expect(parseExtensionMessage('{"type":"reading","id":4,"outcome":{"ok":true}}')).toBeNull();
    expect(
      parseExtensionMessage(`{"type":"hello","browser":"${'x'.repeat(65)}","version":"1"}`),
    ).toBeNull();
  });
});
