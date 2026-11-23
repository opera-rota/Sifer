import {
  undoWindow,
  type ApplyFailure,
  type ApplyOutcome,
  type UndoFailure,
  type UndoOutcome,
} from '../shared/bridge';
import type { Point } from './drag';
import type { Chord, SelectResult, TargetResult } from './reader/protocol';

export const pasteSettle = 300;
export const undoSettle = 300;
export const expectLength = 64;

export interface WriteTarget {
  readonly point: Point;
  readonly original: string;
}

export interface ClipboardKeeper<Saved> {
  save(): Promise<Saved>;
  write(text: string): Promise<void>;
  restore(saved: Saved): Promise<void>;
}

export interface WriterDependencies<Saved> {
  select(point: Point, text: string): Promise<SelectResult>;
  front(): Promise<TargetResult>;
  keys(chord: Chord): Promise<TargetResult>;
  caret(): Promise<string | null>;
  hidden<Result>(run: () => Promise<Result>): Promise<Result>;
  clipboard: ClipboardKeeper<Saved>;
  settle(milliseconds: number): Promise<void>;
  now(): number;
}

interface Written {
  readonly replacement: string;
  readonly original: string;
  readonly until: number;
}

const selectFailure: Record<Exclude<SelectResult, 'selected'>, ApplyFailure> = {
  moved: 'moved',
  nothing: 'moved',
  unsupported: 'unsupported',
  blocked: 'blocked',
  failed: 'failed',
};

const blockedOr = <Reason extends string>(result: TargetResult, other: Reason) =>
  result === 'blocked' ? ('blocked' as const) : other;

export function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function headOf(text: string): string {
  return collapse(text).slice(0, expectLength);
}

export function tailOf(text: string): string {
  const paragraphs = text
    .split(/[\r\n]+/)
    .map(collapse)
    .filter((paragraph) => paragraph !== '');
  return (paragraphs.at(-1) ?? '').slice(0, expectLength);
}

export function shows(found: string | null, expected: string): boolean {
  return found !== null && expected !== '' && collapse(found).includes(expected);
}

export function createWriter<Saved>(dependencies: WriterDependencies<Saved>) {
  let written: Written | null = null;
  let busy = false;

  const exclusive = async <Result>(
    refused: Result,
    run: () => Promise<Result>,
  ): Promise<Result> => {
    if (busy) {
      return refused;
    }
    busy = true;
    try {
      return await run();
    } finally {
      busy = false;
    }
  };

  const failedApply = (reason: ApplyFailure): ApplyOutcome => ({ ok: false, reason });
  const failedUndo = (reason: UndoFailure): UndoOutcome => ({ ok: false, reason });

  const paste = async (target: WriteTarget, replacement: string): Promise<ApplyOutcome> => {
    const saved = await dependencies.clipboard.save();
    try {
      await dependencies.clipboard.write(replacement);
      const pasted = await dependencies.keys('paste');
      if (pasted !== 'ready') {
        return failedApply(blockedOr(pasted, 'failed'));
      }
      await dependencies.settle(pasteSettle);
      const verified = shows(await dependencies.caret(), tailOf(replacement));
      const until = dependencies.now() + undoWindow;
      written = { replacement, original: target.original, until };
      return { ok: true, verified, undoUntil: until };
    } finally {
      await dependencies.clipboard.restore(saved);
    }
  };

  return {
    get busy(): boolean {
      return busy;
    },
    apply(target: WriteTarget, replacement: string): Promise<ApplyOutcome> {
      return exclusive(failedApply('failed'), async () => {
        if (collapse(replacement) === '') {
          return failedApply('nothing');
        }
        written = null;
        const selected = await dependencies.hidden(() =>
          dependencies.select(target.point, target.original),
        );
        if (selected !== 'selected') {
          return failedApply(selectFailure[selected]);
        }
        return paste(target, replacement);
      });
    },
    undo(): Promise<UndoOutcome> {
      return exclusive(failedUndo('failed'), async () => {
        const last = written;
        if (!last || dependencies.now() > last.until) {
          written = null;
          return failedUndo('expired');
        }
        const front = await dependencies.front();
        if (front !== 'ready') {
          return failedUndo(blockedOr(front, 'failed'));
        }
        if (!shows(await dependencies.caret(), tailOf(last.replacement))) {
          return failedUndo('changed');
        }
        const undone = await dependencies.keys('undo');
        if (undone !== 'ready') {
          return failedUndo(blockedOr(undone, 'failed'));
        }
        written = null;
        await dependencies.settle(undoSettle);
        return shows(await dependencies.caret(), headOf(last.original))
          ? { ok: true }
          : failedUndo('failed');
      });
    },
    forget(): void {
      written = null;
    },
  };
}

export type Writer = ReturnType<typeof createWriter>;
