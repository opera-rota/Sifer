import type { ImageScope, ReadOutcome } from '../../shared/bridge';
import type { Point } from '../drag';
import {
  isReaderReply,
  type Chord,
  type FocusReading,
  type FrontRequest,
  type KeysRequest,
  type OcrRequest,
  type PointRequest,
  type ReaderOperation,
  type ReaderReply,
  type ReadRequest,
  type SelectRequest,
  type SelectResult,
  type TargetResult,
  type WindowInfo,
} from './protocol';

export const readTimeout = 1500;
export const pageTimeout = 2500;
export const appTimeout = 300;
export const focusTimeout = 1500;
export const ocrTimeout = 3000;
export const pageOcrTimeout = 6000;
export const selectTimeout = 2000;
export const targetTimeout = 1000;

export interface ReaderWorker {
  postMessage(request: ReadRequest): void;
  on(event: 'message' | 'exit', listener: (value: unknown) => void): unknown;
  terminate(): unknown;
}

export interface ReaderClientDependencies {
  spawn(): ReaderWorker;
  timeout?: number;
  pageTimeout?: number;
  appTimeout?: number;
  focusTimeout?: number;
  ocrTimeout?: number;
  pageOcrTimeout?: number;
  selectTimeout?: number;
  targetTimeout?: number;
}

export interface CapturedImage {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
  readonly point: Point;
  readonly reach: number;
}

type Settle = (reply: ReaderReply | null, reason: 'timeout' | 'failed') => void;

type Outgoing =
  | Omit<PointRequest, 'id'>
  | Omit<OcrRequest, 'id'>
  | Omit<SelectRequest, 'id'>
  | Omit<FrontRequest, 'id'>
  | Omit<KeysRequest, 'id'>;

const lookups: ReadonlySet<ReaderOperation> = new Set<ReaderOperation>([
  'app',
  'foreground',
  'front',
  'keys',
]);

export function createReaderClient(dependencies: ReaderClientDependencies) {
  const timeouts: Record<ReaderOperation, number> = {
    read: dependencies.timeout ?? readTimeout,
    page: dependencies.pageTimeout ?? pageTimeout,
    app: dependencies.appTimeout ?? appTimeout,
    foreground: dependencies.appTimeout ?? appTimeout,
    focus: dependencies.focusTimeout ?? focusTimeout,
    ocr: dependencies.ocrTimeout ?? ocrTimeout,
    select: dependencies.selectTimeout ?? selectTimeout,
    front: dependencies.targetTimeout ?? targetTimeout,
    keys: dependencies.targetTimeout ?? targetTimeout,
  };
  const timeoutOf = (outgoing: Outgoing): number =>
    outgoing.op === 'ocr' && outgoing.scope === 'page'
      ? (dependencies.pageOcrTimeout ?? pageOcrTimeout)
      : timeouts[outgoing.op];
  const pending = new Map<number, Settle>();
  let worker: ReaderWorker | null = null;
  let nextId = 1;

  const discard = (gone: ReaderWorker, reason: 'timeout' | 'failed'): void => {
    if (worker !== gone) {
      return;
    }
    worker = null;
    void gone.terminate();
    for (const settle of [...pending.values()]) {
      settle(null, reason);
    }
  };

  const ensure = (): ReaderWorker => {
    if (worker) {
      return worker;
    }
    const created = dependencies.spawn();
    created.on('message', (reply) => {
      if (isReaderReply(reply)) {
        pending.get(reply.id)?.(reply, 'failed');
      }
    });
    created.on('exit', () => discard(created, 'failed'));
    worker = created;
    return created;
  };

  const request = (
    outgoing: Outgoing,
  ): Promise<{ reply: ReaderReply | null; reason: 'timeout' | 'failed' }> => {
    const target = ensure();
    const id = nextId++;
    return new Promise((resolve) => {
      const settle: Settle = (reply, reason) => {
        clearTimeout(timer);
        pending.delete(id);
        resolve({ reply, reason });
      };
      const timer = setTimeout(
        () => (lookups.has(outgoing.op) ? settle(null, 'timeout') : discard(target, 'timeout')),
        timeoutOf(outgoing),
      );
      pending.set(id, settle);
      target.postMessage({ ...outgoing, id } as ReadRequest);
    });
  };

  const outcomeOf = async (outgoing: Outgoing): Promise<ReadOutcome> => {
    const { reply, reason } = await request(outgoing);
    return reply && 'outcome' in reply ? reply.outcome : { ok: false, reason };
  };

  const windowOf = async (outgoing: Outgoing): Promise<WindowInfo | null> => {
    const { reply } = await request(outgoing);
    return reply && 'app' in reply ? reply.app : null;
  };

  const targetOf = async (outgoing: Outgoing): Promise<TargetResult> => {
    const { reply } = await request(outgoing);
    return reply && 'target' in reply ? reply.target : 'failed';
  };

  return {
    read(point: Point): Promise<ReadOutcome> {
      return outcomeOf({ op: 'read', x: Math.round(point.x), y: Math.round(point.y) });
    },
    page(point: Point): Promise<ReadOutcome> {
      return outcomeOf({ op: 'page', x: Math.round(point.x), y: Math.round(point.y) });
    },
    app(point: Point): Promise<WindowInfo | null> {
      return windowOf({ op: 'app', x: Math.round(point.x), y: Math.round(point.y) });
    },
    foreground(): Promise<WindowInfo | null> {
      return windowOf({ op: 'foreground', x: 0, y: 0 });
    },
    async focus(): Promise<FocusReading> {
      const { reply, reason } = await request({ op: 'focus', x: 0, y: 0 });
      return reply && 'focus' in reply
        ? reply.focus
        : { outcome: { ok: false, reason }, bounds: null };
    },
    recognize(image: CapturedImage, scope: ImageScope): Promise<ReadOutcome> {
      return outcomeOf({
        op: 'ocr',
        scope,
        x: Math.round(image.point.x),
        y: Math.round(image.point.y),
        reach: Math.max(Math.round(image.reach), 0),
        width: image.width,
        height: image.height,
        pixels: image.pixels,
      });
    },
    async select(point: Point, text: string): Promise<SelectResult> {
      const { reply } = await request({
        op: 'select',
        x: Math.round(point.x),
        y: Math.round(point.y),
        text,
      });
      return reply && 'select' in reply ? reply.select : 'failed';
    },
    front(): Promise<TargetResult> {
      return targetOf({ op: 'front' });
    },
    keys(chord: Chord): Promise<TargetResult> {
      return targetOf({ op: 'keys', chord });
    },
    close(): void {
      if (worker) {
        discard(worker, 'failed');
      }
    },
  };
}

export type ReaderClient = ReturnType<typeof createReaderClient>;
