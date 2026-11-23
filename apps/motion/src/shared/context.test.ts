import { describe, expect, it } from 'vitest';
import type { Reading } from './bridge';
import { appName, canWrite, confidenceOf } from './context';

function readingFrom(source: Reading['source'], kind: Reading['kind'] = 'text'): Reading {
  return { source, kind, control: 'Document', text: 'Hello' };
}

describe('appName', () => {
  it('gives well known apps their everyday name', () => {
    expect(appName('winword.exe')).toBe('Word');
    expect(appName('code.exe')).toBe('VS Code');
    expect(appName('MSEDGE.EXE')).toBe('Edge');
  });

  it('turns any other process into a readable name', () => {
    expect(appName('sumatrapdf.exe')).toBe('Sumatrapdf');
    expect(appName('figma')).toBe('Figma');
  });

  it('has no name for an empty process', () => {
    expect(appName('')).toBeNull();
    expect(appName('.exe')).toBeNull();
  });
});

describe('confidenceOf', () => {
  it('trusts the page and the accessibility text most', () => {
    expect(confidenceOf('point', readingFrom('dom'))).toBe('high');
    expect(confidenceOf('page', readingFrom('dom'))).toBe('high');
    expect(confidenceOf('point', readingFrom('accessibility', 'value'))).toBe('high');
  });

  it('trusts a bare control name less', () => {
    expect(confidenceOf('point', readingFrom('accessibility', 'name'))).toBe('medium');
  });

  it('trusts text recognition less, and a whole window least', () => {
    expect(confidenceOf('point', readingFrom('screenshot'))).toBe('medium');
    expect(confidenceOf('page', readingFrom('screenshot'))).toBe('low');
  });
});

describe('canWrite', () => {
  const content = (scope: 'point' | 'page' | 'focus', reading: Reading) => ({
    scope,
    app: 'Word',
    outcome: { ok: true as const, reading },
  });

  it('allows writing back only a paragraph read by accessibility under the orb', () => {
    expect(canWrite(content('point', readingFrom('accessibility')))).toBe(true);
    expect(canWrite(content('focus', readingFrom('accessibility')))).toBe(false);
    expect(canWrite(content('page', readingFrom('accessibility')))).toBe(false);
    expect(canWrite(content('point', readingFrom('accessibility', 'value')))).toBe(false);
    expect(canWrite(content('point', readingFrom('dom')))).toBe(false);
    expect(canWrite(content('point', readingFrom('screenshot')))).toBe(false);
    expect(canWrite({ scope: 'point', app: null, outcome: { ok: false, reason: 'nothing' } })).toBe(
      false,
    );
  });
});
