import { describe, expect, it } from 'vitest';
import { isReaderReply, isReadOutcome, isReadRequest } from './protocol';

describe('isReadRequest', () => {
  it('accepts a positive id, a known operation and integer coordinates', () => {
    expect(isReadRequest({ id: 1, op: 'read', x: -20, y: 400 })).toBe(true);
    expect(isReadRequest({ id: 2, op: 'app', x: 0, y: 0 })).toBe(true);
    expect(isReadRequest({ id: 3, op: 'page', x: 5, y: 5 })).toBe(true);
  });

  it('accepts an image only with a scope and matching pixels', () => {
    const image = { id: 4, op: 'ocr', x: 0, y: 0, width: 2, height: 1, pixels: new Uint8Array(8) };
    expect(isReadRequest({ ...image, scope: 'point' })).toBe(true);
    expect(isReadRequest({ ...image, scope: 'page' })).toBe(true);
    expect(isReadRequest(image)).toBe(false);
    expect(isReadRequest({ ...image, scope: 'page', pixels: new Uint8Array(4) })).toBe(false);
  });

  it('rejects anything else', () => {
    expect(isReadRequest({ id: 0, op: 'read', x: 1, y: 1 })).toBe(false);
    expect(isReadRequest({ id: 1, op: 'read', x: 1.5, y: 1 })).toBe(false);
    expect(isReadRequest({ id: 1, op: 'type', x: 1, y: 1 })).toBe(false);
    expect(isReadRequest({ id: 1, x: 1, y: 1 })).toBe(false);
    expect(isReadRequest(null)).toBe(false);
  });
});

describe('isReadOutcome', () => {
  it('accepts readings and known failures', () => {
    expect(
      isReadOutcome({
        ok: true,
        reading: { source: 'accessibility', kind: 'name', control: 'Button', text: 'Save' },
      }),
    ).toBe(true);
    expect(isReadOutcome({ ok: false, reason: 'protected' })).toBe(true);
    expect(
      isReadOutcome({
        ok: true,
        reading: { source: 'dom', kind: 'value', control: 'Field', text: 'Kigali' },
      }),
    ).toBe(true);
  });

  it('rejects unknown kinds, sources and reasons', () => {
    expect(isReadOutcome({ ok: false, reason: 'other' })).toBe(false);
    expect(
      isReadOutcome({
        ok: true,
        reading: { source: 'clipboard', kind: 'text', control: 'Text', text: 'x' },
      }),
    ).toBe(false);
    expect(
      isReadOutcome({
        ok: true,
        reading: { source: 'accessibility', kind: 'html', control: 'Text', text: 'x' },
      }),
    ).toBe(false);
  });
});

describe('isReaderReply', () => {
  it('accepts readings and process names', () => {
    expect(isReaderReply({ id: 3, outcome: { ok: false, reason: 'nothing' } })).toBe(true);
    expect(
      isReaderReply({
        id: 4,
        app: {
          process: 'chrome.exe',
          title: 'Inbox',
          frame: { x: -8, y: 0, width: 1600, height: 900 },
          shell: false,
          chromium: true,
        },
      }),
    ).toBe(true);
    expect(
      isReaderReply({
        id: 6,
        app: {
          process: 'explorer.exe',
          title: 'Program Manager',
          frame: null,
          shell: true,
          chromium: false,
        },
      }),
    ).toBe(true);
    expect(isReaderReply({ id: 5, app: null })).toBe(true);
  });

  it('rejects malformed replies', () => {
    expect(isReaderReply({ id: -3, outcome: { ok: false, reason: 'nothing' } })).toBe(false);
    expect(isReaderReply({ id: 3, outcome: { ok: true } })).toBe(false);
    expect(isReaderReply({ id: 3, app: 7 })).toBe(false);
    expect(isReaderReply({ id: 3, app: 'chrome.exe' })).toBe(false);
    expect(isReaderReply({ id: 3, app: { process: 'chrome.exe' } })).toBe(false);
    expect(
      isReaderReply({
        id: 3,
        app: { process: 'a', title: 'x'.repeat(513), frame: null, shell: false },
      }),
    ).toBe(false);
    expect(
      isReaderReply({
        id: 3,
        app: { process: 'a', title: 'b', frame: { x: 0, y: 0, width: 0, height: 9 }, shell: false },
      }),
    ).toBe(false);
    expect(isReaderReply({ id: 3, app: { process: 'a', title: 'b', frame: null } })).toBe(false);
    expect(
      isReaderReply({ id: 3, app: { process: 'a', title: 'b', frame: null, shell: false } }),
    ).toBe(false);
    expect(isReaderReply({ id: 3 })).toBe(false);
  });
});
