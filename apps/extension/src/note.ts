import type { Delivered, Route } from './deliver';
import type { ClientPoint } from './locate';
import { maxNoteLength, type ReadScope, type ScreenPoint } from './protocol';
import type { WindowBox } from './target';

const routeText: Record<Route, string> = {
  answered: 'content script answered',
  injected: 'content script injected, then answered',
  silent: 'content script gave no answer',
  refused: 'content script unreachable and injection refused',
};

const shownWindows = 4;

function clip(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

function limited(note: string): string {
  return clip(note, maxNoteLength);
}

function windowText(window: WindowBox): string {
  const flags = [window.focused && 'focused', window.minimized && 'minimized'].filter(Boolean);
  const box = `${window.left},${window.top} ${window.width}x${window.height}`;
  return [`#${window.id} ${box} "${clip(window.tabTitle, 40)}"`, ...flags].join(' ');
}

export function unmatchedNote(
  windows: readonly WindowBox[],
  point: ScreenPoint,
  title: string,
): string {
  const seen =
    windows.length === 0
      ? 'no windows visible to this browser profile'
      : `windows: ${windows.slice(0, shownWindows).map(windowText).join('; ')}`;
  return limited(`no window matched ${point.x},${point.y} "${clip(title, 60)}"; ${seen}`);
}

export function zoomNote(window: WindowBox): string {
  return limited(`tab "${clip(window.tabTitle, 60)}": zoom unavailable`);
}

export function deliveredNote(window: WindowBox, zoom: number, delivered: Delivered): string {
  const result = delivered.outcome.ok ? 'text' : delivered.outcome.reason;
  const detail = delivered.detail ? `, ${delivered.detail}` : '';
  return limited(
    `tab "${clip(window.tabTitle, 60)}" zoom ${zoom}: ${routeText[delivered.route]}${detail} -> ${result}`,
  );
}

export interface ContentView {
  readonly scope: ReadScope;
  readonly width: number;
  readonly height: number;
  readonly ratio: number;
  readonly point: ClientPoint | null;
  readonly sampled: boolean;
}

export function contentDetail(view: ContentView): string {
  const viewport = `viewport ${view.width}x${view.height} dpr ${view.ratio}`;
  if (view.scope !== 'point') {
    return viewport;
  }
  const calibration = view.sampled ? 'pointer sample' : 'estimated origin';
  const mapped = view.point
    ? `point ${Math.round(view.point.x)},${Math.round(view.point.y)}`
    : 'point outside the viewport';
  return `${viewport}, ${mapped} by ${calibration}`;
}
