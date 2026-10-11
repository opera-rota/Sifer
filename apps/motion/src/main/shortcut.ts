import type { Rectangle } from 'electron';
import type { Point } from './drag';

export const readShortcut = 'CommandOrControl+Alt+Space';
export const readShortcutLabel = 'Ctrl+Alt+Space';

export interface ShortcutRegistry {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

export interface ShortcutBinding {
  readonly active: boolean;
  release(): void;
}

export function bindReadShortcut(registry: ShortcutRegistry, onRead: () => void): ShortcutBinding {
  let active = false;
  try {
    active = registry.register(readShortcut, onRead);
  } catch {
    active = false;
  }
  return {
    get active(): boolean {
      return active;
    },
    release(): void {
      if (active) {
        registry.unregister(readShortcut);
        active = false;
      }
    },
  };
}

export function pointerAnchor(pointer: Point, size: number): Rectangle {
  const half = Math.floor(size / 2);
  return { x: pointer.x - half, y: pointer.y - half, width: size, height: size };
}
