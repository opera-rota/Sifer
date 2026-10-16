import { describe, expect, it } from 'vitest';
import {
  joinLines,
  pageReading,
  pageText,
  screenshotReading,
  type OcrLine,
  type Segment,
} from './layout';

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

function segment(text: string, width: number, y: number): Segment {
  return { text, bounds: { x: 10, y, width, height: 16 } };
}

describe('joinLines', () => {
  it('turns lines wrapped by the window back into one flowing paragraph', () => {
    expect(
      joinLines([
        segment('The old lighthouse stood at the edge of the cliff, its', 400, 10),
        segment('paint peeling after decades of salt wind and well-', 390, 30),
        segment('known storms.', 100, 50),
      ]),
    ).toBe(
      'The old lighthouse stood at the edge of the cliff, its paint peeling after decades of salt wind and well-known storms.',
    );
  });

  it('keeps short lines, headings and code on their own lines', () => {
    expect(joinLines([segment('Kigali', 60, 10), segment('Rwanda', 62, 30)])).toBe(
      'Kigali\nRwanda',
    );
    expect(
      joinLines([
        segment('const total = items.reduce((sum, item) => sum + item.price, 0);', 400, 10),
        segment('return total;', 100, 30),
      ]),
    ).toBe('const total = items.reduce((sum, item) => sum + item.price, 0);\nreturn total;');
    expect(
      joinLines([
        segment('Short opening line here', 200, 10),
        segment('a much longer second line that sets the width of the block', 400, 30),
      ]),
    ).toBe('Short opening line here\na much longer second line that sets the width of the block');
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
