import type { ReadOutcome } from '../../shared/bridge';
import type { Point } from '../drag';
import { normalizeText, type ScreenRect } from './strategy';

export interface OcrWord {
  readonly text: string;
  readonly bounds: ScreenRect;
}

export interface OcrLine {
  readonly words: readonly OcrWord[];
}

export interface Segment {
  readonly text: string;
  readonly bounds: ScreenRect;
}

export const columnGap = 1.8;
export const lineGap = 0.9;
export const heightRatio = 1.7;
export const minimumOverlap = 0.3;
export const paragraphBreak = 0.8;

function union(rects: readonly ScreenRect[]): ScreenRect {
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function segmentOf(words: readonly OcrWord[]): Segment {
  return {
    text: words.map((word) => word.text).join(' '),
    bounds: union(words.map((word) => word.bounds)),
  };
}

export function segments(lines: readonly OcrLine[]): Segment[] {
  const result: Segment[] = [];
  for (const line of lines) {
    const words = line.words
      .filter((word) => word.text.trim() !== '' && word.bounds.height > 0)
      .toSorted((a, b) => a.bounds.x - b.bounds.x);
    if (words.length === 0) {
      continue;
    }
    const gap = columnGap * median(words.map((word) => word.bounds.height));
    let current: OcrWord[] = [];
    for (const word of words) {
      const previous = current.at(-1);
      if (previous && word.bounds.x - (previous.bounds.x + previous.bounds.width) > gap) {
        result.push(segmentOf(current));
        current = [];
      }
      current.push(word);
    }
    result.push(segmentOf(current));
  }
  return result;
}

function distance(rect: ScreenRect, point: Point): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

export function segmentAt(all: readonly Segment[], point: Point): Segment | null {
  let best: Segment | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const segment of all) {
    const away = distance(segment.bounds, point);
    if (away <= segment.bounds.height / 2 && away < bestDistance) {
      best = segment;
      bestDistance = away;
    }
  }
  return best;
}

function overlaps(a: ScreenRect, b: ScreenRect): boolean {
  const shared = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  return shared >= minimumOverlap * Math.min(a.width, b.width);
}

function similarHeight(a: ScreenRect, b: ScreenRect): boolean {
  const ratio = Math.max(a.height, b.height) / Math.max(Math.min(a.height, b.height), 1);
  return ratio <= heightRatio;
}

function neighbour(
  all: readonly Segment[],
  taken: ReadonlySet<Segment>,
  edge: Segment,
  direction: 'up' | 'down',
): Segment | null {
  let best: Segment | null = null;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const candidate of all) {
    if (taken.has(candidate)) {
      continue;
    }
    const gap =
      direction === 'down'
        ? candidate.bounds.y - (edge.bounds.y + edge.bounds.height)
        : edge.bounds.y - (candidate.bounds.y + candidate.bounds.height);
    const limit = lineGap * Math.max(edge.bounds.height, candidate.bounds.height);
    if (
      gap >= -edge.bounds.height / 2 &&
      gap <= limit &&
      gap < bestGap &&
      overlaps(edge.bounds, candidate.bounds) &&
      similarHeight(edge.bounds, candidate.bounds)
    ) {
      best = candidate;
      bestGap = gap;
    }
  }
  return best;
}

export function paragraphAt(lines: readonly OcrLine[], point: Point): string {
  const all = segments(lines);
  const hit = segmentAt(all, point);
  if (!hit) {
    return '';
  }
  const taken = new Set<Segment>([hit]);
  const block: Segment[] = [hit];
  for (const direction of ['up', 'down'] as const) {
    let edge = hit;
    for (;;) {
      const next = neighbour(all, taken, edge, direction);
      if (!next) {
        break;
      }
      taken.add(next);
      if (direction === 'up') {
        block.unshift(next);
      } else {
        block.push(next);
      }
      edge = next;
    }
  }
  return block.map((segment) => segment.text).join('\n');
}

function sameRow(a: ScreenRect, b: ScreenRect): boolean {
  const shared = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return shared >= 0.5 * Math.min(a.height, b.height);
}

function columnsOf(all: readonly Segment[]): Segment[][] {
  const columns: Segment[][] = [];
  for (const segment of all.toSorted((a, b) => a.bounds.y - b.bounds.y)) {
    const column = columns.find((candidate) => {
      const last = candidate.at(-1);
      return last !== undefined && overlaps(last.bounds, segment.bounds);
    });
    if (column) {
      column.push(segment);
    } else {
      columns.push([segment]);
    }
  }
  return columns.toSorted((a, b) => {
    const first = a[0]?.bounds;
    const second = b[0]?.bounds;
    if (!first || !second) {
      return 0;
    }
    return sameRow(first, second) ? first.x - second.x : first.y - second.y;
  });
}

function columnText(column: readonly Segment[]): string {
  return column
    .map((segment, index) => {
      const previous = column[index - 1];
      if (!previous) {
        return segment.text;
      }
      const gap = segment.bounds.y - (previous.bounds.y + previous.bounds.height);
      const height = Math.max(segment.bounds.height, previous.bounds.height);
      return `${gap > paragraphBreak * height ? '\n' : ''}\n${segment.text}`;
    })
    .join('');
}

export function pageText(lines: readonly OcrLine[]): string {
  return columnsOf(segments(lines)).map(columnText).join('\n\n');
}

function reading(text: string, control: string): ReadOutcome {
  const normalized = normalizeText(text);
  if (normalized === '') {
    return { ok: false, reason: 'nothing' };
  }
  return {
    ok: true,
    reading: { source: 'screenshot', kind: 'text', control, text: normalized },
  };
}

export function screenshotReading(lines: readonly OcrLine[], point: Point): ReadOutcome {
  return reading(paragraphAt(lines, point), 'Screen');
}

export function pageReading(lines: readonly OcrLine[]): ReadOutcome {
  return reading(pageText(lines), 'Window');
}
