import type {
  ReadFailure,
  ReadingKind,
  ReadingSource,
  ReadOutcome,
  ReadScope,
} from '../../shared/bridge';

export type ReaderOperation = 'read' | 'page' | 'app' | 'ocr';

export const maxImagePixels = 16_000_000;

export interface PointRequest {
  readonly id: number;
  readonly op: 'read' | 'page' | 'app';
  readonly x: number;
  readonly y: number;
}

export interface OcrRequest {
  readonly id: number;
  readonly op: 'ocr';
  readonly scope: ReadScope;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

export type ReadRequest = PointRequest | OcrRequest;

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

export type ReaderReply =
  | { readonly id: number; readonly outcome: ReadOutcome }
  | { readonly id: number; readonly app: WindowInfo | null };

const failures: ReadonlySet<string> = new Set<ReadFailure>([
  'nothing',
  'protected',
  'unsupported',
  'timeout',
  'failed',
]);

const kinds: ReadonlySet<string> = new Set<ReadingKind>(['text', 'value', 'name']);

const sources: ReadonlySet<string> = new Set<ReadingSource>(['dom', 'accessibility', 'screenshot']);

const pointOperations: ReadonlySet<unknown> = new Set(['read', 'page', 'app']);

const scopes: ReadonlySet<unknown> = new Set<ReadScope>(['point', 'page']);

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
  return (
    scopes.has(value['scope']) &&
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

export function isReadRequest(value: unknown): value is ReadRequest {
  if (
    !isRecord(value) ||
    !isId(value['id']) ||
    !Number.isInteger(value['x']) ||
    !Number.isInteger(value['y'])
  ) {
    return false;
  }
  const op = value['op'];
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
  return value['app'] === null || isWindowInfo(value['app']);
}
