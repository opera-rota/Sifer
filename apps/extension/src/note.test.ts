import { describe, expect, it } from 'vitest';
import { contentDetail, deliveredNote, unmatchedNote, zoomNote } from './note';
import { maxNoteLength } from './protocol';
import type { WindowBox } from './target';

const irembo: WindowBox = {
  id: 3,
  left: -8,
  top: -8,
  width: 1552,
  height: 832,
  focused: true,
  minimized: false,
  tabId: 30,
  tabTitle: 'IremboGov',
};

describe('unmatchedNote', () => {
  it('lists the windows the extension can see next to the point and title', () => {
    const note = unmatchedNote([irembo], { x: 656, y: 314 }, 'IremboGov - Google Chrome');
    expect(note).toBe(
      'no window matched 656,314 "IremboGov - Google Chrome"; ' +
        'windows: #3 -8,-8 1552x832 "IremboGov" focused',
    );
  });

  it('says when this browser profile has no windows at all', () => {
    expect(unmatchedNote([], { x: 1, y: 2 }, 'Irembo')).toContain(
      'no windows visible to this browser profile',
    );
  });

  it('stays within the note limit for many long titles', () => {
    const windows = Array.from({ length: 9 }, (_, index) => ({
      ...irembo,
      id: index,
      tabTitle: 'x'.repeat(300),
    }));
    expect(unmatchedNote(windows, { x: 1, y: 2 }, 'y'.repeat(600)).length).toBeLessThanOrEqual(
      maxNoteLength,
    );
  });
});

describe('deliveredNote', () => {
  it('names the route, the content detail and the result', () => {
    const note = deliveredNote(irembo, 1, {
      outcome: { ok: false, reason: 'nothing' },
      route: 'injected',
      detail: 'viewport 1229x650 dpr 1.25',
    });
    expect(note).toBe(
      'tab "IremboGov" zoom 1: content script injected, then answered, ' +
        'viewport 1229x650 dpr 1.25 -> nothing',
    );
  });

  it('reports a silent content script', () => {
    expect(
      deliveredNote(irembo, 1.1, {
        outcome: { ok: false, reason: 'nothing' },
        route: 'silent',
        detail: '',
      }),
    ).toBe('tab "IremboGov" zoom 1.1: content script gave no answer -> nothing');
  });

  it('reports a tab without zoom', () => {
    expect(zoomNote(irembo)).toBe('tab "IremboGov": zoom unavailable');
  });
});

describe('contentDetail', () => {
  const view = { width: 1229, height: 650, ratio: 1.25, sampled: true };

  it('gives the mapped point and how it was calibrated', () => {
    expect(contentDetail({ ...view, scope: 'point', point: { x: 524.4, y: 251.6 } })).toBe(
      'viewport 1229x650 dpr 1.25, point 524,252 by pointer sample',
    );
  });

  it('says when the point falls outside the viewport', () => {
    expect(contentDetail({ ...view, scope: 'point', point: null, sampled: false })).toBe(
      'viewport 1229x650 dpr 1.25, point outside the viewport by estimated origin',
    );
  });

  it('gives only the viewport for page and focus reads', () => {
    expect(contentDetail({ ...view, scope: 'page', point: null })).toBe(
      'viewport 1229x650 dpr 1.25',
    );
  });
});
