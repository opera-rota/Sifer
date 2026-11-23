import type { ReadOutcome } from '../../shared/bridge';
import { pageReading, screenshotReading } from './layout';
import {
  createTextRecognizer,
  OcrUnavailable,
  pageRecognizeDeadline,
  recognizeDeadline,
  type TextRecognizer,
} from './ocr';
import { chordInputs, inputSize } from './keys';
import {
  isReadRequest,
  type Chord,
  type FocusReading,
  type OcrRequest,
  type PointRequest,
  type ReaderReply,
  type ReadRequest,
  type SelectRequest,
  type SelectResult,
  type TargetResult,
  type WindowInfo,
} from './protocol';
import { focusAt, pageAt, readAt, selectAt, type Automation } from './strategy';
import { createUiAutomation, type UiAutomation } from './uia';
import { bringToFront, foregroundWindow, rootWindowAt, sendKeys, windowAt } from './window';

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

let target: unknown = null;

function select(request: SelectRequest): SelectResult {
  const connected = automation.get();
  if (!connected) {
    return 'unsupported';
  }
  try {
    const point = { x: request.x, y: request.y };
    const window = rootWindowAt(point);
    if (!window) {
      return 'nothing';
    }
    target = window;
    if (!bringToFront(window)) {
      return 'blocked';
    }
    return selectAt(connected, point, request.text);
  } catch (error) {
    console.error('ui automation select failed', error);
    return 'failed';
  }
}

function front(): TargetResult {
  try {
    return target && bringToFront(target) ? 'ready' : 'blocked';
  } catch (error) {
    console.error('bringing the target window forward failed', error);
    return 'failed';
  }
}

function press(chord: Chord): TargetResult {
  const ready = front();
  if (ready !== 'ready') {
    return ready;
  }
  try {
    return sendKeys(chordInputs(chord), inputSize) ? 'ready' : 'failed';
  } catch (error) {
    console.error(`sending ${chord} failed`, error);
    return 'failed';
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
    return page
      ? pageReading(lines)
      : screenshotReading(lines, { x: request.x, y: request.y }, request.reach);
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
    case 'select':
      return { id: request.id, select: select(request) };
    case 'front':
      return { id: request.id, target: front() };
    case 'keys':
      return { id: request.id, target: press(request.chord) };
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
