import { describe, expect, it, vi } from 'vitest';
import type { ReadOutcome } from '../../shared/bridge';
import { createReadChain } from './chain';
import type { WindowInfo } from './protocol';

const fromPage: ReadOutcome = {
  ok: true,
  reading: { source: 'dom', kind: 'text', control: 'Heading', text: 'Changelog' },
};
const fromAccessibility: ReadOutcome = {
  ok: true,
  reading: { source: 'accessibility', kind: 'text', control: 'Document', text: 'Changelog' },
};
const fromScreenshot: ReadOutcome = {
  ok: true,
  reading: { source: 'screenshot', kind: 'text', control: 'Screen', text: 'const total = 3;' },
};

const dip = { x: 100, y: 200 };
const physical = { x: 125, y: 250 };

const frame = { x: 0, y: 0, width: 1600, height: 900 };

const chromiumApps: ReadonlySet<string> = new Set(['chrome.exe', 'msedge.exe', 'code.exe']);

function windowOf(process: string, title: string, shell = false): WindowInfo {
  return { process, title, frame, shell, chromium: chromiumApps.has(process) };
}

const chromePage = windowOf('chrome.exe', 'Changelog - Google Chrome');
const edgePage = windowOf('msedge.exe', 'Changelog - Microsoft Edge');
const word = windowOf('winword.exe', 'Report.docx - Word');
const code = windowOf('code.exe', 'main.ts - Sifer - Visual Studio Code');
const nothing: ReadOutcome = { ok: false, reason: 'nothing' };

function chain(options: {
  app?: WindowInfo | null;
  browser?: string | null;
  dom?: ReadOutcome | null;
  pageDom?: ReadOutcome | null;
  accessibility?: ReadOutcome;
  page?: ReadOutcome;
  screenshot?: ReadOutcome;
  windowShot?: ReadOutcome;
}) {
  const calls = {
    app: vi.fn(async () => options.app ?? null),
    dom: vi.fn(async (_dip: unknown, _title: string, scope: 'point' | 'page') =>
      scope === 'page'
        ? options.pageDom === undefined
          ? nothing
          : options.pageDom
        : options.dom === undefined
          ? fromPage
          : options.dom,
    ),
    accessibility: vi.fn(async () => options.accessibility ?? fromAccessibility),
    page: vi.fn(async () => options.page ?? nothing),
    screenshot: vi.fn(async () => options.screenshot ?? fromScreenshot),
    windowShot: vi.fn(async () => options.windowShot ?? nothing),
  };
  const content = createReadChain({
    app: calls.app,
    extensionBrowser: () => (options.browser === undefined ? 'Chrome' : options.browser),
    dom: calls.dom,
    accessibility: calls.accessibility,
    page: calls.page,
    screenshot: calls.screenshot,
    windowShot: calls.windowShot,
  });
  const read = async (...args: Parameters<typeof content>): Promise<ReadOutcome> =>
    (await content(...args)).outcome;
  return { read, content, calls };
}

describe('createReadChain', () => {
  it('asks the extension first when the orb is on its own browser', async () => {
    const { read, calls } = chain({ app: chromePage });
    await expect(read(dip, physical)).resolves.toBe(fromPage);
    expect(calls.app).toHaveBeenCalledWith(physical);
    expect(calls.dom).toHaveBeenCalledWith(dip, 'Changelog - Google Chrome', 'point');
    expect(calls.accessibility).not.toHaveBeenCalled();
    expect(calls.screenshot).not.toHaveBeenCalled();
  });

  it('keeps a protected answer from the page', async () => {
    const { read, calls } = chain({
      app: edgePage,
      browser: 'Edge',
      dom: { ok: false, reason: 'protected' },
    });
    await expect(read(dip, physical)).resolves.toEqual({ ok: false, reason: 'protected' });
    expect(calls.accessibility).not.toHaveBeenCalled();
  });

  it('looks at the screen first for a browser window the page did not answer for', async () => {
    for (const dom of [{ ok: false, reason: 'nothing' } as const, null]) {
      const { read, calls } = chain({ app: chromePage, dom });
      await expect(read(dip, physical)).resolves.toBe(fromScreenshot);
      expect(calls.accessibility).toHaveBeenCalledWith(physical);
    }
  });

  it('uses the text from a browser window when the screen shows nothing readable', async () => {
    const { read } = chain({
      app: windowOf('msedge.exe', 'Netflix'),
      screenshot: { ok: false, reason: 'nothing' },
    });
    await expect(read(dip, physical)).resolves.toBe(fromAccessibility);
  });

  it('never photographs a protected field in a browser window', async () => {
    const { read, calls } = chain({
      app: windowOf('msedge.exe', 'Bank'),
      dom: null,
      accessibility: { ok: false, reason: 'protected' },
    });
    await expect(read(dip, physical)).resolves.toEqual({ ok: false, reason: 'protected' });
    expect(calls.screenshot).not.toHaveBeenCalled();
  });

  it('uses accessibility directly for other apps or without the extension', async () => {
    const other = chain({ app: word });
    await expect(other.read(dip, physical)).resolves.toBe(fromAccessibility);
    expect(other.calls.dom).not.toHaveBeenCalled();
    const offline = chain({ app: chromePage, browser: null });
    await offline.read(dip, physical);
    expect(offline.calls.dom).not.toHaveBeenCalled();
  });

  it('never asks the extension about a window of another browser', async () => {
    const edgeApp = chain({ app: windowOf('msedge.exe', 'Netflix') });
    await edgeApp.read(dip, physical);
    expect(edgeApp.calls.dom).not.toHaveBeenCalled();
    const chromeFromEdge = chain({ app: chromePage, browser: 'Edge' });
    await chromeFromEdge.read(dip, physical);
    expect(chromeFromEdge.calls.dom).not.toHaveBeenCalled();
  });

  it('skips the extension for a browser window without a title', async () => {
    const { read, calls } = chain({ app: windowOf('chrome.exe', '') });
    await read(dip, physical);
    expect(calls.dom).not.toHaveBeenCalled();
  });

  it('takes a screenshot when accessibility finds nothing or fails', async () => {
    for (const reason of ['nothing', 'timeout', 'failed', 'unsupported'] as const) {
      const { read, calls } = chain({ app: code, accessibility: { ok: false, reason } });
      await expect(read(dip, physical)).resolves.toBe(fromScreenshot);
      expect(calls.screenshot).toHaveBeenCalledWith(dip);
    }
  });

  it('never takes a screenshot of a protected field', async () => {
    const { read, calls } = chain({
      app: word,
      accessibility: { ok: false, reason: 'protected' },
    });
    await expect(read(dip, physical)).resolves.toEqual({ ok: false, reason: 'protected' });
    expect(calls.screenshot).not.toHaveBeenCalled();
  });

  it('never shows the bare name of a container, which can hold a whole page', async () => {
    const name: ReadOutcome = {
      ok: true,
      reading: { source: 'accessibility', kind: 'name', control: 'Edit', text: 'Editor content' },
    };
    const { read } = chain({ app: code, accessibility: name });
    await expect(read(dip, physical)).resolves.toBe(fromScreenshot);
    const fallback = chain({
      app: code,
      accessibility: name,
      screenshot: { ok: false, reason: 'nothing' },
    });
    await expect(fallback.read(dip, physical)).resolves.toEqual({ ok: false, reason: 'nothing' });
  });

  it('keeps the name of a button or link', async () => {
    const button: ReadOutcome = {
      ok: true,
      reading: { source: 'accessibility', kind: 'name', control: 'Button', text: 'Save' },
    };
    const { read, calls } = chain({ app: word, accessibility: button });
    await expect(read(dip, physical)).resolves.toBe(button);
    expect(calls.screenshot).not.toHaveBeenCalled();
  });

  it('reports the accessibility failure when the screenshot also finds nothing', async () => {
    const { read } = chain({
      app: windowOf('notepad.exe', 'notes.txt - Notepad'),
      accessibility: { ok: false, reason: 'nothing' },
      screenshot: { ok: false, reason: 'unsupported' },
    });
    await expect(read(dip, physical)).resolves.toEqual({ ok: false, reason: 'nothing' });
  });
});

describe('whole page', () => {
  const blank = { accessibility: nothing, screenshot: nothing };
  const document: ReadOutcome = {
    ok: true,
    reading: { source: 'accessibility', kind: 'text', control: 'Document', text: 'All of it' },
  };
  const visible: ReadOutcome = {
    ok: true,
    reading: { source: 'dom', kind: 'text', control: 'Page', text: 'Visible text' },
  };
  const photographed: ReadOutcome = {
    ok: true,
    reading: { source: 'screenshot', kind: 'text', control: 'Window', text: 'On screen' },
  };

  it('stays on the point when something is under the orb', async () => {
    const { content, calls } = chain({ app: word });
    await expect(content(dip, physical)).resolves.toEqual({
      scope: 'point',
      app: 'Word',
      outcome: fromAccessibility,
    });
    expect(calls.page).not.toHaveBeenCalled();
    expect(calls.windowShot).not.toHaveBeenCalled();
  });

  it('reads the visible page through the extension, titled by the window', async () => {
    const { content, calls } = chain({
      app: chromePage,
      dom: nothing,
      pageDom: visible,
      ...blank,
    });
    await expect(content(dip, physical)).resolves.toEqual({
      scope: 'page',
      app: 'Chrome',
      outcome: { ok: true, reading: { ...visible.reading, control: chromePage.title } },
    });
    expect(calls.dom).toHaveBeenLastCalledWith(dip, chromePage.title, 'page');
    expect(calls.page).not.toHaveBeenCalled();
  });

  it('reads the document of a desktop app before taking a picture of it', async () => {
    const { content, calls } = chain({ app: word, ...blank, page: document });
    await expect(content(dip, physical)).resolves.toMatchObject({
      scope: 'page',
      outcome: { reading: { text: 'All of it', control: word.title } },
    });
    expect(calls.page).toHaveBeenCalledWith(physical);
    expect(calls.windowShot).not.toHaveBeenCalled();
  });

  it('photographs the window when the app has no document text', async () => {
    const notepad = windowOf('notepad.exe', 'notes.txt - Notepad');
    const { content, calls } = chain({ app: notepad, ...blank, windowShot: photographed });
    await expect(content(dip, physical)).resolves.toMatchObject({
      scope: 'page',
      outcome: { reading: { source: 'screenshot', text: 'On screen' } },
    });
    expect(calls.windowShot).toHaveBeenCalledWith(dip, frame);
  });

  it('photographs an Electron app such as VS Code instead of reading a hidden editor', async () => {
    const { content, calls } = chain({
      app: code,
      ...blank,
      windowShot: photographed,
      page: document,
    });
    await expect(content(dip, physical)).resolves.toMatchObject({
      scope: 'page',
      outcome: { reading: { source: 'screenshot', text: 'On screen', control: code.title } },
    });
    expect(calls.page).not.toHaveBeenCalled();
  });

  it('photographs a browser window before trusting its accessibility tree', async () => {
    const edgeApp = windowOf('msedge.exe', 'Netflix');
    const shot = chain({ app: edgeApp, ...blank, windowShot: photographed, page: document });
    await expect(shot.content(dip, physical)).resolves.toMatchObject({
      outcome: { reading: { source: 'screenshot' } },
    });
    expect(shot.calls.page).not.toHaveBeenCalled();
    const tree = chain({ app: edgeApp, ...blank, page: document });
    await expect(tree.content(dip, physical)).resolves.toMatchObject({
      scope: 'page',
      outcome: { reading: { text: 'All of it' } },
    });
  });

  it('keeps the point answer when the whole page has nothing either', async () => {
    const { content } = chain({ app: word, ...blank });
    await expect(content(dip, physical)).resolves.toEqual({
      scope: 'point',
      app: 'Word',
      outcome: nothing,
    });
  });

  it('never widens on the desktop, the taskbar or without a window', async () => {
    for (const [app, name] of [
      [windowOf('explorer.exe', 'Program Manager', true), 'File Explorer'],
      [null, null],
    ] as const) {
      const { content, calls } = chain({ app, ...blank, page: document });
      await expect(content(dip, physical)).resolves.toEqual({
        scope: 'point',
        app: name,
        outcome: nothing,
      });
      expect(calls.page).not.toHaveBeenCalled();
    }
  });

  it('never widens a protected answer or a failure', async () => {
    for (const reason of ['protected', 'timeout'] as const) {
      const { content, calls } = chain({
        app: word,
        accessibility: { ok: false, reason },
        screenshot: { ok: false, reason: 'failed' },
        page: document,
      });
      await expect(content(dip, physical)).resolves.toEqual({
        scope: 'point',
        app: 'Word',
        outcome: { ok: false, reason },
      });
      expect(calls.page).not.toHaveBeenCalled();
    }
  });
});
