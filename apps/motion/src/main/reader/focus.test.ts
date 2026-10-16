import { describe, expect, it, vi } from 'vitest';
import type { ReadOutcome } from '../../shared/bridge';
import { centreOf, createFocusRead } from './focus';
import type { FocusReading, WindowInfo } from './protocol';
import { enclosing, focusAt, type FocusedElement, type ScreenRect, type TextHit } from './strategy';

interface ElementSpec {
  controlType?: number;
  password?: boolean;
  name?: string;
  value?: string | null;
  selection?: TextHit | null | Error;
  caret?: TextHit | null | Error;
  bounds?: ScreenRect | null;
}

function automationFor(spec: ElementSpec | null) {
  const released: string[] = [];
  const element = (current: ElementSpec): FocusedElement => {
    const hit = (value: TextHit | null | Error | undefined): TextHit | null => {
      if (value instanceof Error) {
        throw value;
      }
      return value ?? null;
    };
    return {
      controlType: () => current.controlType ?? 50004,
      isPassword: () => current.password ?? false,
      name: () => current.name ?? '',
      value: () => current.value ?? null,
      selection: () => hit(current.selection),
      caret: () => hit(current.caret),
      bounds: () => current.bounds ?? null,
      release: () => released.push('focused'),
    };
  };
  return { automation: { focused: () => (spec ? element(spec) : null) }, released };
}

const field: ScreenRect = { x: 100, y: 200, width: 300, height: 28 };
const line: ScreenRect = { x: 110.4, y: 204.2, width: 120.3, height: 18.1 };

describe('focusAt', () => {
  it('prefers the selected text and places it by the selection', () => {
    const { automation, released } = automationFor({
      controlType: 50030,
      selection: { text: 'Quarterly revenue grew', bounds: [line] },
      caret: { text: 'Whole paragraph', bounds: [field] },
      bounds: field,
    });
    expect(focusAt(automation)).toEqual({
      outcome: {
        ok: true,
        reading: {
          source: 'accessibility',
          kind: 'text',
          control: 'Document',
          text: 'Quarterly revenue grew',
        },
      },
      bounds: { x: 110, y: 204, width: 121, height: 19 },
    });
    expect(released).toEqual(['focused']);
  });

  it('reads the paragraph around the caret when nothing is selected', () => {
    const { automation } = automationFor({
      controlType: 50030,
      selection: { text: '', bounds: [] },
      caret: { text: 'Sifer reads the paragraph at the caret.', bounds: [] },
      bounds: field,
    });
    expect(focusAt(automation)).toMatchObject({
      outcome: { reading: { kind: 'text', text: 'Sifer reads the paragraph at the caret.' } },
      bounds: field,
    });
  });

  it('falls back to the value, then the name, when text patterns fail', () => {
    const value = automationFor({
      selection: new Error('no text pattern'),
      caret: new Error('no text pattern 2'),
      value: 'Kigali',
      bounds: field,
    });
    expect(focusAt(value.automation)).toMatchObject({
      outcome: { reading: { kind: 'value', control: 'Edit', text: 'Kigali' } },
    });
    const name = automationFor({ controlType: 50000, name: 'Save' });
    expect(focusAt(name.automation)).toEqual({
      outcome: {
        ok: true,
        reading: { source: 'accessibility', kind: 'name', control: 'Button', text: 'Save' },
      },
      bounds: null,
    });
  });

  it('does not take the address of a focused web page as its value', () => {
    const { automation } = automationFor({
      controlType: 50030,
      value: 'https://irembo.gov.rw/home/citizen/all_services',
      selection: { text: '', bounds: [] },
      caret: null,
      bounds: field,
    });
    expect(focusAt(automation).outcome).toEqual({ ok: false, reason: 'nothing' });
  });

  it('never reads a password field and reports nothing without focus', () => {
    const { automation, released } = automationFor({
      password: true,
      value: 'hunter2',
      bounds: field,
    });
    expect(focusAt(automation)).toEqual({
      outcome: { ok: false, reason: 'protected' },
      bounds: field,
    });
    expect(released).toEqual(['focused']);
    expect(focusAt(automationFor(null).automation)).toEqual({
      outcome: { ok: false, reason: 'nothing' },
      bounds: null,
    });
    expect(focusAt(automationFor({}).automation).outcome).toEqual({
      ok: false,
      reason: 'nothing',
    });
  });
});

describe('enclosing', () => {
  it('wraps every usable rectangle in whole pixels', () => {
    expect(
      enclosing([
        { x: 10.5, y: 20, width: 30, height: 10 },
        { x: 5, y: 32.2, width: 10, height: 9.5 },
        { x: 0, y: 0, width: 0, height: 0 },
      ]),
    ).toEqual({ x: 5, y: 20, width: 36, height: 22 });
    expect(enclosing([])).toBeNull();
  });
});

const fromPage: ReadOutcome = {
  ok: true,
  reading: { source: 'dom', kind: 'value', control: 'Field', text: 'District: Gasabo' },
};
const fromAccessibility: ReadOutcome = {
  ok: true,
  reading: { source: 'accessibility', kind: 'text', control: 'Document', text: 'Dear team,' },
};
const frame = { x: 0, y: 0, width: 1600, height: 900 };

function windowOf(process: string, title: string, shell = false): WindowInfo {
  return { process, title, frame, shell, chromium: process !== 'winword.exe' };
}

function focusRead(options: {
  window?: WindowInfo | null;
  browser?: string | null;
  dom?: ReadOutcome | null;
  focused?: FocusReading;
}) {
  const calls = {
    dom: vi.fn(async () => (options.dom === undefined ? fromPage : options.dom)),
    focused: vi.fn(async () => options.focused ?? { outcome: fromAccessibility, bounds: field }),
  };
  const read = createFocusRead({
    foreground: async () => (options.window === undefined ? null : options.window),
    extensionBrowser: () => options.browser ?? null,
    dom: calls.dom,
    focused: calls.focused,
    toDip: (rect) => ({
      x: rect.x / 1.25,
      y: rect.y / 1.25,
      width: rect.width / 1.25,
      height: rect.height / 1.25,
    }),
  });
  return { read, calls };
}

describe('createFocusRead', () => {
  const chrome = windowOf('chrome.exe', 'Irembo - Google Chrome');
  const word = windowOf('winword.exe', 'Letter.docx - Word');

  it('asks the page reader first when the extension owns the focused browser', async () => {
    const { read, calls } = focusRead({ window: chrome, browser: 'Chrome' });
    await expect(read()).resolves.toEqual({
      content: { scope: 'focus', app: 'Chrome', outcome: fromPage },
      anchor: null,
    });
    expect(calls.dom).toHaveBeenCalledWith({ x: 640, y: 360 }, chrome.title, 'focus');
    expect(calls.focused).not.toHaveBeenCalled();
  });

  it('uses the focused accessibility element otherwise and anchors the panel to it', async () => {
    const { read, calls } = focusRead({ window: word, browser: 'Chrome' });
    await expect(read()).resolves.toEqual({
      content: { scope: 'focus', app: 'Word', outcome: fromAccessibility },
      anchor: { x: 80, y: 160, width: 240, height: 22.4 },
    });
    expect(calls.dom).not.toHaveBeenCalled();
  });

  it('falls through to accessibility when the page has nothing focused', async () => {
    const { read, calls } = focusRead({
      window: chrome,
      browser: 'Chrome',
      dom: { ok: false, reason: 'nothing' },
    });
    await expect(read()).resolves.toMatchObject({ content: { outcome: fromAccessibility } });
    expect(calls.focused).toHaveBeenCalledOnce();
  });

  it('keeps a protected answer and gives up on bare containers and the desktop', async () => {
    const guarded = focusRead({
      window: word,
      focused: { outcome: { ok: false, reason: 'protected' }, bounds: null },
    });
    await expect(guarded.read()).resolves.toEqual({
      content: { scope: 'focus', app: 'Word', outcome: { ok: false, reason: 'protected' } },
      anchor: null,
    });
    const container = focusRead({
      window: word,
      focused: {
        outcome: {
          ok: true,
          reading: { source: 'accessibility', kind: 'name', control: 'Pane', text: 'Ribbon' },
        },
        bounds: null,
      },
    });
    await expect(container.read()).resolves.toBeNull();
    await expect(
      focusRead({ window: windowOf('explorer.exe', 'Program Manager', true) }).read(),
    ).resolves.toBeNull();
    await expect(focusRead({ window: null }).read()).resolves.toBeNull();
  });

  it('centres a point inside a window frame', () => {
    expect(centreOf({ x: 10, y: 20, width: 101, height: 50 })).toEqual({ x: 61, y: 45 });
  });
});
