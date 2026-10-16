import type { PanelContent, ReadOutcome, ReadScope } from '../../shared/bridge';
import { appName } from '../../shared/context';
import type { Point } from '../drag';
import type { WindowFrame, WindowInfo } from './protocol';

export const browserProcesses: Readonly<Record<string, ReadonlySet<string>>> = {
  Chrome: new Set(['chrome.exe', 'brave.exe']),
  Edge: new Set(['msedge.exe']),
};

export const containerControls: ReadonlySet<string> = new Set([
  'Custom',
  'Document',
  'Edit',
  'Element',
  'Group',
  'List',
  'Pane',
  'Table',
  'Window',
]);

export interface ChainDependencies {
  app(physical: Point): Promise<WindowInfo | null>;
  extensionBrowser(): string | null;
  dom(dip: Point, title: string, scope: ReadScope): Promise<ReadOutcome | null>;
  accessibility(physical: Point): Promise<ReadOutcome>;
  page(physical: Point): Promise<ReadOutcome>;
  screenshot(dip: Point): Promise<ReadOutcome>;
  windowShot(dip: Point, frame: WindowFrame): Promise<ReadOutcome>;
}

const nothing: ReadOutcome = { ok: false, reason: 'nothing' };

export function settled(outcome: ReadOutcome): boolean {
  if (!outcome.ok) {
    return outcome.reason === 'protected';
  }
  return outcome.reading.kind !== 'name' || !containerControls.has(outcome.reading.control);
}

function isNothing(outcome: ReadOutcome): boolean {
  return !outcome.ok && outcome.reason === 'nothing';
}

export function ownedByExtension(
  window: WindowInfo | null,
  browser: string | null,
): window is WindowInfo {
  const processes = browser === null ? undefined : browserProcesses[browser];
  return window !== null && window.title !== '' && processes?.has(window.process) === true;
}

function titled(outcome: ReadOutcome, title: string): ReadOutcome {
  if (!outcome.ok || title === '') {
    return outcome;
  }
  return { ok: true, reading: { ...outcome.reading, control: title } };
}

export function createReadChain(dependencies: ChainDependencies) {
  const extensionOwns = (window: WindowInfo | null): window is WindowInfo =>
    ownedByExtension(window, dependencies.extensionBrowser());

  const readPoint = async (
    window: WindowInfo | null,
    dip: Point,
    physical: Point,
  ): Promise<ReadOutcome> => {
    if (extensionOwns(window)) {
      const outcome = await dependencies.dom(dip, window.title, 'point');
      if (outcome && (outcome.ok || outcome.reason === 'protected')) {
        return outcome;
      }
    }
    const accessibility = await dependencies.accessibility(physical);
    if (!accessibility.ok && accessibility.reason === 'protected') {
      return accessibility;
    }
    const chromium = window?.chromium === true;
    if (!chromium && settled(accessibility)) {
      return accessibility;
    }
    const screenshot = await dependencies.screenshot(dip);
    if (screenshot.ok) {
      return screenshot;
    }
    if (settled(accessibility)) {
      return accessibility;
    }
    return accessibility.ok ? nothing : accessibility;
  };

  const readPage = async (
    window: WindowInfo,
    dip: Point,
    physical: Point,
  ): Promise<ReadOutcome | null> => {
    if (extensionOwns(window)) {
      const outcome = await dependencies.dom(dip, window.title, 'page');
      if (outcome?.ok) {
        return outcome;
      }
    }
    if (!window.chromium) {
      const accessibility = await dependencies.page(physical);
      if (accessibility.ok) {
        return accessibility;
      }
    }
    if (window.frame) {
      const screenshot = await dependencies.windowShot(dip, window.frame);
      if (screenshot.ok) {
        return screenshot;
      }
    }
    if (window.chromium) {
      const accessibility = await dependencies.page(physical);
      if (accessibility.ok) {
        return accessibility;
      }
    }
    return null;
  };

  return async (dip: Point, physical: Point): Promise<PanelContent> => {
    const window = await dependencies.app(physical);
    const app = window ? appName(window.process) : null;
    const point = await readPoint(window, dip, physical);
    if (!isNothing(point) || window === null || window.shell) {
      return { scope: 'point', app, outcome: point };
    }
    const page = await readPage(window, dip, physical);
    return page
      ? { scope: 'page', app, outcome: titled(page, window.title) }
      : { scope: 'point', app, outcome: point };
  };
}
