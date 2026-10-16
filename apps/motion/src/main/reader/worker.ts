import type { ReadOutcome } from '../../shared/bridge';
import { pageReading, screenshotReading } from './layout';
import {
  createTextRecognizer,
  OcrUnavailable,
  pageRecognizeDeadline,
  recognizeDeadline,
  type TextRecognizer,
} from './ocr';
import {
  isReadRequest,
  type FocusReading,
  type OcrRequest,
  type PointRequest,
  type ReaderReply,
  type ReadRequest,
  type WindowInfo,
} from './protocol';
import { focusAt, pageAt, readAt, type Automation } from './strategy';
import { createUiAutomation, type UiAutomation } from './uia';
import { foregroundWindow, windowAt } from './window';

const port = process.parentPort;
if (!port) {
  throw new Error('the reader runs only as a utility process');
}

function lazy<T extends { dispose(): void }>(label: string, create: () => T) {
  let instance: T | null = null;
  let unavailable = false;
  return {
    get(): T | null {
      if (!instance && !unavailable) {
        try {
          instance = create();
        } catch (error) {
          unavailable = true;
          console.error(`${label} unavailable`, error);
        }
      }
      return instance;
    },
    dispose(): void {
      instance?.dispose();
    },
  };
}

const automation = lazy<UiAutomation>('ui automation', createUiAutomation);
const recognizer = lazy<TextRecognizer>('text recognition', createTextRecognizer);

function read(
  request: PointRequest,
  strategy: (automation: Automation, point: { x: number; y: number }) => ReadOutcome,
): ReadOutcome {
  const connected = automation.get();
  if (!connected) {
    return { ok: false, reason: 'unsupported' };
  }
  try {
    return strategy(connected, { x: request.x, y: request.y });
  } catch (error) {
    console.error(`ui automation ${request.op} failed`, error);
    return { ok: false, reason: 'failed' };
  }
}

function focus(): FocusReading {
  const connected = automation.get();
  if (!connected) {
    return { outcome: { ok: false, reason: 'unsupported' }, bounds: null };
  }
  try {
    return focusAt(connected);
  } catch (error) {
    console.error('ui automation focus failed', error);
    return { outcome: { ok: false, reason: 'failed' }, bounds: null };
  }
}

function lookup(find: () => WindowInfo | null): WindowInfo | null {
  try {
    return find();
  } catch (error) {
    console.error('window lookup failed', error);
    return null;
  }
}

function recognize(request: OcrRequest): ReadOutcome {
  const engine = recognizer.get();
  if (!engine) {
    return { ok: false, reason: 'unsupported' };
  }
  const page = request.scope === 'page';
  try {
    const lines = engine.recognize(request, page ? pageRecognizeDeadline : recognizeDeadline);
    console.log(`text recognition found ${lines.length} lines (${request.scope})`);
    return page ? pageReading(lines) : screenshotReading(lines, { x: request.x, y: request.y });
  } catch (error) {
    if (error instanceof OcrUnavailable) {
      return { ok: false, reason: 'unsupported' };
    }
    console.error('text recognition failed', error);
    return { ok: false, reason: 'failed' };
  }
}

function answer(request: ReadRequest): ReaderReply {
  switch (request.op) {
    case 'app':
      return { id: request.id, app: lookup(() => windowAt({ x: request.x, y: request.y })) };
    case 'foreground':
      return { id: request.id, app: lookup(foregroundWindow) };
    case 'focus':
      return { id: request.id, focus: focus() };
    case 'ocr':
      return { id: request.id, outcome: recognize(request) };
    case 'page':
      return { id: request.id, outcome: read(request, pageAt) };
    default:
      return { id: request.id, outcome: read(request, readAt) };
  }
}

port.on('message', (event) => {
  const request: unknown = event.data;
  if (isReadRequest(request)) {
    port.postMessage(answer(request));
  }
});

process.once('exit', () => {
  recognizer.dispose();
  automation.dispose();
});
