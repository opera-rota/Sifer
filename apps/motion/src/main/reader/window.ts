import koffi from 'koffi';
import type { Point } from '../drag';
import { processName } from './process';
import type { WindowFrame, WindowInfo } from './protocol';

const point = koffi.struct('SiferWindowPoint', { x: 'int32', y: 'int32' });
const rect = koffi.struct('SiferWindowRect', {
  left: 'int32',
  top: 'int32',
  right: 'int32',
  bottom: 'int32',
});

const user32 = koffi.load('user32.dll');
const dwmapi = koffi.load('dwmapi.dll');
const windowFromPoint = user32.func('__stdcall', 'WindowFromPoint', 'void *', [point]);
const getForegroundWindow = user32.func('void * __stdcall GetForegroundWindow()');
const getAncestor = user32.func('void * __stdcall GetAncestor(void *window, uint32 flags)');
const getWindowThreadProcessId = user32.func('__stdcall', 'GetWindowThreadProcessId', 'uint32', [
  'void *',
  koffi.out(koffi.pointer('uint32')),
]);
const getWindowTextLength = user32.func('int32 __stdcall GetWindowTextLengthW(void *window)');
const getWindowText = user32.func('__stdcall', 'GetWindowTextW', 'int32', [
  'void *',
  'void *',
  'int32',
]);
const getClassName = user32.func('__stdcall', 'GetClassNameW', 'int32', [
  'void *',
  'void *',
  'int32',
]);
const getWindowRect = user32.func('__stdcall', 'GetWindowRect', 'int32', [
  'void *',
  koffi.out(koffi.pointer(rect)),
]);
const dwmGetWindowAttribute = dwmapi.func('__stdcall', 'DwmGetWindowAttribute', 'int32', [
  'void *',
  'uint32',
  koffi.out(koffi.pointer(rect)),
  'uint32',
]);

const rootAncestor = 2;
const extendedFrameBounds = 9;
const maxClassLength = 256;
export const maxTitleLength = 512;

export const shellClasses: ReadonlySet<string> = new Set([
  'Progman',
  'WorkerW',
  'Shell_TrayWnd',
  'Shell_SecondaryTrayWnd',
]);

export const chromiumClassPrefix = 'Chrome_WidgetWin_';

type Rect = { left: number; top: number; right: number; bottom: number };

function textOf(read: (buffer: Buffer, size: number) => number, length: number): string {
  if (length <= 0) {
    return '';
  }
  const buffer = Buffer.alloc((length + 1) * 2);
  const copied = read(buffer, length + 1);
  return buffer.toString('utf16le', 0, Math.max(copied, 0) * 2);
}

function titleOf(window: unknown): string {
  const length = Math.min(getWindowTextLength(window) as number, maxTitleLength);
  return textOf((buffer, size) => getWindowText(window, buffer, size) as number, length);
}

function classOf(window: unknown): string {
  return textOf((buffer, size) => getClassName(window, buffer, size) as number, maxClassLength);
}

export function frameOf(bounds: Rect): WindowFrame | null {
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  return width > 0 && height > 0 ? { x: bounds.left, y: bounds.top, width, height } : null;
}

function boundsOf(window: unknown): WindowFrame | null {
  const extended: Rect = { left: 0, top: 0, right: 0, bottom: 0 };
  if ((dwmGetWindowAttribute(window, extendedFrameBounds, extended, 16) as number) >= 0) {
    const frame = frameOf(extended);
    if (frame) {
      return frame;
    }
  }
  const plain: Rect = { left: 0, top: 0, right: 0, bottom: 0 };
  return (getWindowRect(window, plain) as number) !== 0 ? frameOf(plain) : null;
}

function rootOf(window: unknown): unknown {
  return window ? ((getAncestor(window, rootAncestor) as unknown) ?? window) : null;
}

export function rootWindowAt(at: Point): unknown {
  return rootOf(windowFromPoint({ x: at.x, y: at.y }) as unknown);
}

function infoOf(root: unknown): WindowInfo | null {
  if (!root) {
    return null;
  }
  const processId = [0];
  getWindowThreadProcessId(root, processId);
  const process = processName(processId[0] ?? 0);
  if (process === null) {
    return null;
  }
  const className = classOf(root);
  return {
    process,
    title: titleOf(root),
    frame: boundsOf(root),
    shell: shellClasses.has(className),
    chromium: className.startsWith(chromiumClassPrefix),
  };
}

export function windowAt(at: Point): WindowInfo | null {
  return infoOf(rootWindowAt(at));
}

export function foregroundWindow(): WindowInfo | null {
  return infoOf(rootOf(getForegroundWindow() as unknown));
}
