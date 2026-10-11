import { describe, expect, it } from 'vitest';
import { captureRegion, windowRegion, type DisplayGeometry } from './capture';

const display: DisplayGeometry = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1536, height: 864 },
  scaleFactor: 1.25,
};
const image = { width: 1920, height: 1080 };

describe('captureRegion', () => {
  it('takes a full width band around the point in physical pixels', () => {
    expect(captureRegion({ x: 768, y: 432 }, display, 100, image)).toEqual({
      x: 0,
      y: 415,
      width: 1920,
      height: 250,
      point: { x: 960, y: 125 },
    });
  });

  it('refuses a point outside the display', () => {
    expect(captureRegion({ x: -5, y: 10 }, display, 100, image)).toBeNull();
  });
});

describe('windowRegion', () => {
  it('converts the window to image pixels', () => {
    expect(windowRegion({ x: 100, y: 80, width: 400, height: 240 }, display, image)).toEqual({
      x: 125,
      y: 100,
      width: 500,
      height: 300,
      point: { x: 0, y: 0 },
    });
  });

  it('clips a maximised window that hangs over the edges', () => {
    expect(windowRegion({ x: -6, y: -6, width: 1548, height: 830 }, display, image)).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1030,
      point: { x: 0, y: 0 },
    });
  });

  it('refuses a window on another display', () => {
    expect(windowRegion({ x: 2000, y: 0, width: 300, height: 300 }, display, image)).toBeNull();
  });
});
