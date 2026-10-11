import { describe, expect, it } from 'vitest';
import { pageReading, pageText, screenshotReading, type OcrLine } from './layout';

function line(y: number, ...words: [string, number][]): OcrLine {
  return {
    words: words.map(([text, x]) => ({
      text,
      bounds: { x, y, width: text.length * 8, height: 16 },
    })),
  };
}

describe('pageText', () => {
  it('keeps paragraphs apart and lines together', () => {
    const lines = [
      line(10, ['Quarterly', 10], ['report', 90]),
      line(30, ['Revenue', 10], ['grew', 80]),
      line(80, ['Costs', 10], ['fell', 60]),
    ];
    expect(pageText(lines)).toBe('Quarterly report\nRevenue grew\n\nCosts fell');
  });

  it('reads columns one after the other, left to right', () => {
    const lines = [
      line(10, ['Left', 10], ['Right', 600]),
      line(30, ['column', 10], ['column', 600]),
    ];
    expect(pageText(lines)).toBe('Left\ncolumn\n\nRight\ncolumn');
  });
});

describe('readings', () => {
  it('labels a whole window and a point differently', () => {
    const lines = [line(10, ['Hello', 10])];
    expect(pageReading(lines)).toEqual({
      ok: true,
      reading: { source: 'screenshot', kind: 'text', control: 'Window', text: 'Hello' },
    });
    expect(screenshotReading(lines, { x: 12, y: 15 })).toMatchObject({
      reading: { control: 'Screen', text: 'Hello' },
    });
    expect(pageReading([])).toEqual({ ok: false, reason: 'nothing' });
  });
});
