import { describe, expect, it } from 'vitest';
import {
  selectAt,
  trailingBreaks,
  type ScreenRect,
  type TextSpan,
  type WritableNode,
  type WriteAutomation,
} from './strategy';

interface Spec {
  id: string;
  password?: boolean;
  span?: string;
  childSpan?: string;
  bounds?: ScreenRect[];
  parent?: Spec;
}

const point = { x: 50, y: 50 };
const around: ScreenRect[] = [{ x: 0, y: 40, width: 100, height: 20 }];
const elsewhere: ScreenRect[] = [{ x: 300, y: 300, width: 100, height: 20 }];

function automationFor(spec: Spec | null) {
  const log: string[] = [];
  const spanOf = (owner: string, raw: string, bounds: ScreenRect[]): TextSpan => ({
    bounds,
    text: () => raw,
    shrinkEnd: (characters) => log.push(`${owner} shrink ${characters}`),
    select: () => log.push(`${owner} select`),
    release: () => log.push(`${owner} span released`),
  });
  const node = (current: Spec): WritableNode => ({
    controlType: () => 50030,
    isPassword: () => current.password ?? false,
    isOffscreen: () => false,
    name: () => '',
    textAt: () => null,
    textOf: () => null,
    value: () => null,
    documentText: () => null,
    firstChild: () => null,
    nextSibling: () => null,
    spanAt: () =>
      current.span === undefined
        ? null
        : spanOf(current.id, current.span, current.bounds ?? around),
    spanOf: () =>
      current.childSpan === undefined
        ? null
        : spanOf(current.id, current.childSpan, current.bounds ?? around),
    parent: () => (current.parent ? node(current.parent) : null),
    release: () => log.push(`${current.id} released`),
  });
  const automation: WriteAutomation = { elementAt: () => (spec ? node(spec) : null) };
  return { automation, log };
}

describe('trailingBreaks', () => {
  it('counts the paragraph mark at the end only', () => {
    expect(trailingBreaks('Text\r')).toBe(1);
    expect(trailingBreaks('Text\r\n')).toBe(2);
    expect(trailingBreaks('Line\rnext')).toBe(0);
    expect(trailingBreaks('')).toBe(0);
  });
});

describe('selectAt', () => {
  it('selects the paragraph under the point without its paragraph mark', () => {
    const { automation, log } = automationFor({ id: 'doc', span: 'Hello  world.\r' });
    expect(selectAt(automation, point, 'Hello  world.')).toBe('selected');
    expect(log).toEqual(['doc shrink 1', 'doc select', 'doc released', 'doc span released']);
  });

  it('asks the ancestors for the range of the element under the point', () => {
    const { automation, log } = automationFor({
      id: 'link',
      parent: { id: 'page', childSpan: 'Read more' },
    });
    expect(selectAt(automation, point, 'Read more')).toBe('selected');
    expect(log).toContain('page select');
  });

  it('reports text that changed since it was read', () => {
    const { automation, log } = automationFor({ id: 'doc', span: 'Edited since.\r' });
    expect(selectAt(automation, point, 'Hello world.')).toBe('moved');
    expect(log).not.toContain('doc select');
  });

  it('does not write where the point is not on the text', () => {
    const { automation } = automationFor({ id: 'doc', span: 'Hello', bounds: elsewhere });
    expect(selectAt(automation, point, 'Hello')).toBe('nothing');
  });

  it('never writes into a password field', () => {
    const { automation } = automationFor({ id: 'secret', password: true, span: 'x' });
    expect(selectAt(automation, point, 'x')).toBe('unsupported');
  });

  it('answers nothing without an element or any text range', () => {
    expect(selectAt(automationFor(null).automation, point, 'x')).toBe('nothing');
    const { automation, log } = automationFor({ id: 'pane', parent: { id: 'window' } });
    expect(selectAt(automation, point, 'x')).toBe('nothing');
    expect(log).toEqual(['pane released', 'window released']);
  });
});
