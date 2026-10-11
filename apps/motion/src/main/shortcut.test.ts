import { describe, expect, it, vi } from 'vitest';
import { dropPoint } from './drop';
import { bindReadShortcut, pointerAnchor, readShortcut, type ShortcutRegistry } from './shortcut';

function registry(result: boolean | Error) {
  const register = vi.fn<ShortcutRegistry['register']>(() => {
    if (result instanceof Error) {
      throw result;
    }
    return result;
  });
  const unregister = vi.fn<ShortcutRegistry['unregister']>();
  const shortcuts: ShortcutRegistry = { register, unregister };
  return { shortcuts, register, unregister };
}

describe('bindReadShortcut', () => {
  it('registers the read shortcut and releases it once', () => {
    const { shortcuts, register, unregister } = registry(true);
    const onRead = vi.fn();
    const binding = bindReadShortcut(shortcuts, onRead);
    expect(binding.active).toBe(true);
    expect(register).toHaveBeenCalledWith(readShortcut, onRead);
    binding.release();
    binding.release();
    expect(unregister).toHaveBeenCalledOnce();
    expect(binding.active).toBe(false);
  });

  it('stays inactive when another app owns the shortcut', () => {
    for (const result of [false, new Error('taken')]) {
      const { shortcuts, unregister } = registry(result);
      const binding = bindReadShortcut(shortcuts, vi.fn());
      expect(binding.active).toBe(false);
      binding.release();
      expect(unregister).not.toHaveBeenCalled();
    }
  });

  it('does not steal Save As from other apps', () => {
    expect(readShortcut).not.toMatch(/Shift\+S$/);
  });
});

describe('pointerAnchor', () => {
  it('centres an orb sized box on the pointer, so the read lands on the pointer', () => {
    const anchor = pointerAnchor({ x: 500, y: 300 }, 72);
    expect(anchor).toEqual({ x: 464, y: 264, width: 72, height: 72 });
    expect(dropPoint(anchor)).toEqual({ x: 500, y: 300 });
  });
});
