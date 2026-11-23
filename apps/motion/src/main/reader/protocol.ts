import type {
  ImageScope,
  ReadFailure,
  ReadingKind,
  ReadingSource,
  ReadOutcome,
} from '../../shared/bridge';

export type PointOperation = 'read' | 'page' | 'app' | 'focus' | 'foreground';

export type TargetOperation = 'front' | 'keys';

export type ReaderOperation = PointOperation | TargetOperation | 'ocr' | 'select';

export type SelectResult = 'selected' | 'moved' | 'nothing' | 'unsupported' | 'blocked' | 'failed';

export type TargetResult = 'ready' | 'blocked' | 'failed';

export type Chord = 'paste' | 'undo';

export const maxSelectText = 20_000;

export const maxImagePixels = 16_000_000;

export interface PointRequest {
  readonly id: number;
  readonly op: PointOperation;
  readonly x: number;
  readonly y: number;
}

export interface OcrRequest {
  readonly id: number;
  readonly op: 'ocr';
  readonly scope: ImageScope;
  readonly x: number;
  readonly y: number;
  readonly reach: number;
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

export interface SelectRequest {
  readonly id: number;
  readonly op: 'select';
  readonly x: number;
  readonly y: number;
  readonly text: string;
}

export interface FrontRequest {
  readonly id: number;
  readonly op: 'front';
}

export interface KeysRequest {
  readonly id: number;
  readonly op: 'keys';
  readonly chord: Chord;
}

export type ReadRequest = PointRequest | OcrRequest | SelectRequest | FrontRequest | KeysRequest;

export interface WindowFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface WindowInfo {
  readonly process: string;
  readonly title: string;
  readonly frame: WindowFrame | null;
  readonly shell: boolean;
  readonly chromium: boolean;
}

export interface FocusReading {
  readonly outcome: ReadOutcome;
  readonly bounds: WindowFrame | null;
}

export type ReaderReply =
  | { readonly id: number; readonly outcome: ReadOutcome }
  | { readonly id: number; readonly focus: FocusReading }
  | { readonly id: number; readonly app: WindowInfo | null }
  | { readonly id: number; readonly select: SelectResult }
  | { readonly id: number; readonly target: TargetResult };

const failures: ReadonlySet<string> = new Set<ReadFailure>([
  'nothing',
  'protected',
  'unsupported',
  'timeout',
  'failed',
]);

const kinds: ReadonlySet<string> = new Set<ReadingKind>(['text', 'value', 'name']);

const sources: ReadonlySet<string> = new Set<ReadingSource>(['dom', 'accessibility', 'screenshot']);

const pointOperations: ReadonlySet<unknown> = new Set<PointOperation>([
  'read',
  'page',
  'app',
  'focus',
  'foreground',
]);

const selectResults: ReadonlySet<unknown> = new Set<SelectResult>([
  'selected',
  'moved',
  'nothing',
  'unsupported',
  'blocked',
  'failed',
]);

const targetResults: ReadonlySet<unknown> = new Set<TargetResult>(['ready', 'blocked', 'failed']);

const chords: ReadonlySet<unknown> = new Set<Chord>(['paste', 'undo']);

const scopes: ReadonlySet<unknown> = new Set<ImageScope>(['point', 'page']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isImage(value: Record<string, unknown>): boolean {
  const width = value['width'];
  const height = value['height'];
  const pixels = value['pixels'];
  const reach = value['reach'];
  return (
    scopes.has(value['scope']) &&
    Number.isInteger(reach) &&
    (reach as number) >= 0 &&
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    (width as number) > 0 &&
    (height as number) > 0 &&
    (width as number) * (height as number) <= maxImagePixels &&
    pixels instanceof Uint8Array &&
    pixels.length === (width as number) * (height as number) * 4
  );
}

function isFrame(value: unknown): value is WindowFrame {
  return (
    isRecord(value) &&
    Number.isInteger(value['x']) &&
    Number.isInteger(value['y']) &&
    Number.isInteger(value['width']) &&
    Number.isInteger(value['height']) &&
    (value['width'] as number) > 0 &&
    (value['height'] as number) > 0
  );
}

function isFocusReading(value: unknown): value is FocusReading {
  return (
    isRecord(value) &&
    isReadOutcome(value['outcome']) &&
    (value['bounds'] === null || isFrame(value['bounds']))
  );
}

function isWindowInfo(value: unknown): value is WindowInfo {
  return (
    isRecord(value) &&
    typeof value['process'] === 'string' &&
    value['process'].length <= 260 &&
    typeof value['title'] === 'string' &&
    value['title'].length <= 512 &&
    (value['frame'] === null || isFrame(value['frame'])) &&
    typeof value['shell'] === 'boolean' &&
    typeof value['chromium'] === 'boolean'
  );
}

function hasPoint(value: Record<string, unknown>): boolean {
  return Number.isInteger(value['x']) && Number.isInteger(value['y']);
}

function isSelectText(value: unknown): boolean {
  return typeof value === 'string' && value !== '' && value.length <= maxSelectText;
}

export function isReadRequest(value: unknown): value is ReadRequest {
  if (!isRecord(value) || !isId(value['id'])) {
    return false;
  }
  const op = value['op'];
  if (op === 'front') {
    return true;
  }
  if (op === 'keys') {
    return chords.has(value['chord']);
  }
  if (!hasPoint(value)) {
    return false;
  }
  if (op === 'select') {
    return isSelectText(value['text']);
  }
  return pointOperations.has(op) || (op === 'ocr' && isImage(value));
}

export function isReadOutcome(value: unknown): value is ReadOutcome {
  if (!isRecord(value)) {
    return false;
  }
  if (value['ok'] === false) {
    return typeof value['reason'] === 'string' && failures.has(value['reason']);
  }
  const reading = value['reading'];
  return (
    value['ok'] === true &&
    isRecord(reading) &&
    typeof reading['source'] === 'string' &&
    sources.has(reading['source']) &&
    typeof reading['kind'] === 'string' &&
    kinds.has(reading['kind']) &&
    typeof reading['control'] === 'string' &&
    typeof reading['text'] === 'string'
  );
}

export function isReaderReply(value: unknown): value is ReaderReply {
  if (!isRecord(value) || !isId(value['id'])) {
    return false;
  }
  if ('outcome' in value) {
    return isReadOutcome(value['outcome']);
  }
  if ('focus' in value) {
    return isFocusReading(value['focus']);
  }
  if ('select' in value) {
    return selectResults.has(value['select']);
  }
  if ('target' in value) {
    return targetResults.has(value['target']);
  }
  return value['app'] === null || isWindowInfo(value['app']);
}
