import { describe, expect, it } from 'vitest';
import { signInWindowOptions } from './signin';

describe('signInWindowOptions', () => {
  const options = signInWindowOptions('/app/preload.cjs');

  it('is a centred window the user can close', () => {
    expect(options).toMatchObject({
      width: 480,
      height: 720,
      resizable: false,
      center: true,
      show: false,
      title: 'Sifer Motion',
    });
    expect(options.frame).toBeUndefined();
    expect(options.alwaysOnTop).toBeUndefined();
  });

  it('keeps the hardened web preferences', () => {
    expect(options.webPreferences).toMatchObject({
      preload: '/app/preload.cjs',
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    });
  });
});
