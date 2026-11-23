import type { ReadingKind, ReadOutcome } from '../../shared/bridge';
import type { Point } from '../drag';
import type { SelectResult } from './protocol';

export const maxReadingLength = 20_000;
export const maxAncestors = 10;
export const boundsTolerance = 4;
export const maxLineHeight = 160;
export const maxPageNodes = 400;
export const maxPageDepth = 12;

export const valueControls: ReadonlySet<number> = new Set([50003, 50004, 50016, 50030]);

export const focusValueControls: ReadonlySet<number> = new Set([50003, 50004, 50016]);

export interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface TextHit {
  readonly text: string;
  readonly bounds: readonly ScreenRect[];
}

export interface AutomationNode {
  controlType(): number;
  isPassword(): boolean;
  isOffscreen(): boolean;
  name(): string;
  textAt(point: Point): TextHit | null;
  textOf(child: AutomationNode): TextHit | null;
  value(): string | null;
  documentText(): string | null;
  parent(): AutomationNode | null;
  firstChild(): AutomationNode | null;
  nextSibling(): AutomationNode | null;
  release(): void;
}

export interface Automation {
  elementAt(point: Point): AutomationNode | null;
  windowAt(point: Point): AutomationNode | null;
}

const controlNames: Readonly<Record<number, string>> = {
  50000: 'Button',
  50002: 'Check box',
  50003: 'Combo box',
  50004: 'Edit',
  50005: 'Link',
  50007: 'List item',
  50008: 'List',
  50011: 'Menu item',
  50016: 'Spinner',
  50019: 'Tab item',
  50020: 'Text',
  50023: 'Tree',
  50024: 'Tree item',
  50025: 'Custom',
  50026: 'Group',
  50029: 'Data item',
  50030: 'Document',
  50032: 'Window',
  50033: 'Pane',
  50036: 'Table',
};

export function controlName(controlType: number): string {
  return controlNames[controlType] ?? 'Element';
}

const noBreakSpace = String.fromCharCode(160);
const objectReplacement = String.fromCharCode(0xfffc);

export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replaceAll(noBreakSpace, ' ')
    .replaceAll(objectReplacement, '')
    .trim()
    .slice(0, maxReadingLength);
}

export function covers(
  bounds: readonly ScreenRect[],
  point: Point,
  tolerance = boundsTolerance,
): boolean {
  return bounds.some(
    (rect) =>
      rect.height <= maxLineHeight &&
      point.x >= rect.x - tolerance &&
      point.x <= rect.x + rect.width + tolerance &&
      point.y >= rect.y - tolerance &&
      point.y <= rect.y + rect.height + tolerance,
  );
}

function found(
  kind: ReadingKind,
  node: { controlType(): number },
  raw: string | null,
): ReadOutcome | null {
  const text = raw === null ? '' : normalizeText(raw);
  if (text === '') {
    return null;
  }
  return {
    ok: true,
    reading: { source: 'accessibility', kind, control: controlName(node.controlType()), text },
  };
}

export function readAt(automation: Automation, point: Point): ReadOutcome {
  const target = automation.elementAt(point);
  if (!target) {
    return { ok: false, reason: 'nothing' };
  }
  const held: AutomationNode[] = [target];
  try {
    if (target.isPassword()) {
      return { ok: false, reason: 'protected' };
    }
    const own = valueControls.has(target.controlType())
      ? found('value', target, target.value())
      : null;
    let container = false;
    let node: AutomationNode | null = target;
    for (let depth = 0; node && depth <= maxAncestors; depth += 1) {
      if (node.isPassword()) {
        return { ok: false, reason: 'protected' };
      }
      if (!container) {
        const hit = depth === 0 ? node.textAt(point) : node.textOf(target);
        container = hit !== null;
        const text = hit && covers(hit.bounds, point) ? found('text', node, hit.text) : null;
        if (text) {
          return text;
        }
      }
      if (depth === 0 && own) {
        return own;
      }
      node = depth < maxAncestors ? node.parent() : null;
      if (node) {
        held.push(node);
      }
    }
    return found('name', target, target.name()) ?? { ok: false, reason: 'nothing' };
  } finally {
    for (const node of held) {
      node.release();
    }
  }
}

function documentOf(node: AutomationNode): ReadOutcome | null {
  try {
    if (node.isPassword() || node.isOffscreen()) {
      return null;
    }
    return found('text', node, node.documentText());
  } catch {
    return null;
  }
}

function offscreen(node: AutomationNode): boolean {
  try {
    return node.isOffscreen();
  } catch {
    return true;
  }
}

function searchWindow(root: AutomationNode, held: AutomationNode[]): ReadOutcome | null {
  const queue: { node: AutomationNode; depth: number }[] = [{ node: root, depth: 0 }];
  let seen = 1;
  for (let next = queue.shift(); next; next = queue.shift()) {
    const reading = documentOf(next.node);
    if (reading) {
      return reading;
    }
    if (next.depth >= maxPageDepth || offscreen(next.node)) {
      continue;
    }
    let child = seen < maxPageNodes ? next.node.firstChild() : null;
    while (child) {
      held.push(child);
      queue.push({ node: child, depth: next.depth + 1 });
      seen += 1;
      child = seen < maxPageNodes ? child.nextSibling() : null;
    }
  }
  return null;
}

export function pageAt(automation: Automation, point: Point): ReadOutcome {
  const held: AutomationNode[] = [];
  try {
    const target = automation.elementAt(point);
    if (target) {
      held.push(target);
      if (target.isPassword()) {
        return { ok: false, reason: 'protected' };
      }
      let node: AutomationNode | null = target;
      for (let depth = 0; node && depth <= maxAncestors; depth += 1) {
        const reading = documentOf(node);
        if (reading) {
          return reading;
        }
        node = depth < maxAncestors ? node.parent() : null;
        if (node) {
          held.push(node);
        }
      }
    }
    const root = automation.windowAt(point);
    if (!root) {
      return { ok: false, reason: 'nothing' };
    }
    held.push(root);
    return searchWindow(root, held) ?? { ok: false, reason: 'nothing' };
  } finally {
    for (const node of held) {
      node.release();
    }
  }
}

export interface FocusedElement {
  controlType(): number;
  isPassword(): boolean;
  name(): string;
  value(): string | null;
  selection(): TextHit | null;
  caret(): TextHit | null;
  bounds(): ScreenRect | null;
  release(): void;
}

export interface FocusAutomation {
  focused(): FocusedElement | null;
}

export interface FocusedReading {
  readonly outcome: ReadOutcome;
  readonly bounds: ScreenRect | null;
}

export function enclosing(rects: readonly ScreenRect[]): ScreenRect | null {
  const usable = rects.filter((rect) => rect.width > 0 && rect.height > 0);
  if (usable.length === 0) {
    return null;
  }
  const left = Math.floor(Math.min(...usable.map((rect) => rect.x)));
  const top = Math.floor(Math.min(...usable.map((rect) => rect.y)));
  const right = Math.ceil(Math.max(...usable.map((rect) => rect.x + rect.width)));
  const bottom = Math.ceil(Math.max(...usable.map((rect) => rect.y + rect.height)));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function attempt<T>(read: () => T): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}

export function focusAt(automation: FocusAutomation): FocusedReading {
  const target = automation.focused();
  if (!target) {
    return { outcome: { ok: false, reason: 'nothing' }, bounds: null };
  }
  try {
    const own = attempt(() => target.bounds());
    const box = own ? enclosing([own]) : null;
    if (target.isPassword()) {
      return { outcome: { ok: false, reason: 'protected' }, bounds: box };
    }
    for (const read of [() => target.selection(), () => target.caret()]) {
      const hit = attempt(read);
      const outcome = hit ? found('text', target, hit.text) : null;
      if (hit && outcome) {
        return { outcome, bounds: enclosing(hit.bounds) ?? box };
      }
    }
    const value = focusValueControls.has(target.controlType())
      ? attempt(() => target.value())
      : null;
    const name = attempt(() => target.name());
    const outcome = found('value', target, value) ?? found('name', target, name);
    return { outcome: outcome ?? { ok: false, reason: 'nothing' }, bounds: box };
  } finally {
    target.release();
  }
}

export interface TextSpan {
  readonly bounds: readonly ScreenRect[];
  text(): string;
  shrinkEnd(characters: number): void;
  select(): void;
  release(): void;
}

export interface WritableNode extends AutomationNode {
  spanAt(point: Point): TextSpan | null;
  spanOf(child: WritableNode): TextSpan | null;
  parent(): WritableNode | null;
}

export interface WriteAutomation {
  elementAt(point: Point): WritableNode | null;
}

const paragraphEnd = /[\r\n\v\u2029]+$/;

export function trailingBreaks(raw: string): number {
  return paragraphEnd.exec(raw)?.[0].length ?? 0;
}

export function selectAt(
  automation: WriteAutomation,
  point: Point,
  expected: string,
): SelectResult {
  const target = automation.elementAt(point);
  if (!target) {
    return 'nothing';
  }
  const held: { release(): void }[] = [target];
  try {
    let node: WritableNode | null = target;
    for (let depth = 0; node && depth <= maxAncestors; depth += 1) {
      if (node.isPassword()) {
        return 'unsupported';
      }
      const span = depth === 0 ? node.spanAt(point) : node.spanOf(target);
      if (span) {
        held.push(span);
        if (!covers(span.bounds, point)) {
          return 'nothing';
        }
        const raw = span.text();
        if (normalizeText(raw) !== expected) {
          return 'moved';
        }
        const breaks = trailingBreaks(raw);
        if (breaks > 0) {
          span.shrinkEnd(breaks);
        }
        span.select();
        return 'selected';
      }
      node = depth < maxAncestors ? node.parent() : null;
      if (node) {
        held.push(node);
      }
    }
    return 'nothing';
  } finally {
    for (const item of held) {
      item.release();
    }
  }
}
