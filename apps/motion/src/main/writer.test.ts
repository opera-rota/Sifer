import { describe, expect, it } from 'vitest';
import { undoWindow } from '../shared/bridge';
import type { Chord, SelectResult, TargetResult } from './reader/protocol';
import { collapse, createWriter, headOf, shows, tailOf, type WriteTarget } from './writer';

const original = 'We need to revisit the deck before end of day.';
const replacement = 'I propose we review the presentation deck before the end of the day.';
const target: WriteTarget = { point: { x: 400, y: 300 }, original };

interface Script {
  select?: SelectResult;
  front?: TargetResult;
  keys?: Partial<Record<Chord, TargetResult>>;
  carets?: (string | null)[];
}

function setup(script: Script = {}) {
  const log: string[] = [];
  let clock = 1_000;
  let clipboard = 'saved';
  const carets = [...(script.carets ?? [replacement, replacement, original])];
  const writer = createWriter<string>({
    select: async (point, text) => {
      log.push(`select ${point.x},${point.y} ${text === original ? 'original' : text}`);
      return script.select ?? 'selected';
    },
    front: async () => {
      log.push('front');
      return script.front ?? 'ready';
    },
    keys: async (chord) => {
      log.push(`keys ${chord} with ${clipboard}`);
      return script.keys?.[chord] ?? 'ready';
    },
    caret: async () => {
      log.push('caret');
      return carets.shift() ?? null;
    },
    hidden: async (run) => {
      log.push('hide');
      try {
        return await run();
      } finally {
        log.push('show');
      }
    },
    clipboard: {
      save: async () => clipboard,
      write: async (text) => {
        clipboard = text === replacement ? 'replacement' : text;
      },
      restore: async (saved) => {
        clipboard = saved;
        log.push(`restore ${saved}`);
      },
    },
    settle: async (milliseconds) => {
      log.push(`settle ${milliseconds}`);
    },
    now: () => clock,
  });
  return {
    writer,
    log,
    advance: (milliseconds: number) => {
      clock += milliseconds;
    },
    clipboard: () => clipboard,
  };
}

describe('text helpers', () => {
  it('collapses whitespace and takes the start and the last paragraph', () => {
    expect(collapse('  a \n\t b  ')).toBe('a b');
    expect(headOf(`${'x'.repeat(70)}`)).toHaveLength(64);
    expect(tailOf('First paragraph.\r\n\r\nSecond   one.')).toBe('Second one.');
    expect(shows('Hello\nSecond  one. More', 'Second one.')).toBe(true);
    expect(shows(null, 'a')).toBe(false);
    expect(shows('anything', '')).toBe(false);
  });
});

describe('createWriter apply', () => {
  it('selects while the orb is hidden, pastes, verifies and restores the clipboard', async () => {
    const { writer, log, clipboard } = setup();
    const outcome = await writer.apply(target, replacement);
    expect(outcome).toEqual({ ok: true, verified: true, undoUntil: 1_000 + undoWindow });
    expect(log).toEqual([
      'hide',
      'select 400,300 original',
      'show',
      'keys paste with replacement',
      'settle 300',
      'caret',
      'restore saved',
    ]);
    expect(clipboard()).toBe('saved');
  });

  it('reports a write it cannot read back as not confirmed', async () => {
    const { writer } = setup({ carets: ['something else'] });
    const outcome = await writer.apply(target, replacement);
    expect(outcome).toMatchObject({ ok: true, verified: false });
  });

  it('maps selection failures without touching the clipboard', async () => {
    const cases: [SelectResult, string][] = [
      ['moved', 'moved'],
      ['nothing', 'moved'],
      ['unsupported', 'unsupported'],
      ['blocked', 'blocked'],
      ['failed', 'failed'],
    ];
    for (const [select, reason] of cases) {
      const { writer, log } = setup({ select });
      expect(await writer.apply(target, replacement)).toEqual({ ok: false, reason });
      expect(log.some((line) => line.startsWith('keys'))).toBe(false);
    }
  });

  it('restores the clipboard when the paste cannot be sent', async () => {
    const { writer, log, clipboard } = setup({ keys: { paste: 'blocked' } });
    expect(await writer.apply(target, replacement)).toEqual({ ok: false, reason: 'blocked' });
    expect(log.at(-1)).toBe('restore saved');
    expect(clipboard()).toBe('saved');
  });

  it('refuses an empty replacement', async () => {
    const { writer, log } = setup();
    expect(await writer.apply(target, '  \n ')).toEqual({ ok: false, reason: 'nothing' });
    expect(log).toEqual([]);
  });

  it('runs one write at a time', async () => {
    const { writer } = setup();
    const first = writer.apply(target, replacement);
    expect(writer.busy).toBe(true);
    expect(await writer.apply(target, replacement)).toEqual({ ok: false, reason: 'failed' });
    expect(await first).toMatchObject({ ok: true });
    expect(writer.busy).toBe(false);
  });
});

describe('createWriter undo', () => {
  it('brings the app forward, checks the text is untouched and presses undo', async () => {
    const { writer, log } = setup();
    await writer.apply(target, replacement);
    log.length = 0;
    expect(await writer.undo()).toEqual({ ok: true });
    expect(log).toEqual(['front', 'caret', 'keys undo with saved', 'settle 300', 'caret']);
    expect(await writer.undo()).toEqual({ ok: false, reason: 'expired' });
  });

  it('refuses after the undo window closes', async () => {
    const { writer, advance, log } = setup();
    await writer.apply(target, replacement);
    advance(undoWindow + 1);
    log.length = 0;
    expect(await writer.undo()).toEqual({ ok: false, reason: 'expired' });
    expect(log).toEqual([]);
  });

  it('leaves text alone when it was edited after the write', async () => {
    const { writer, log } = setup({ carets: [replacement, 'The user typed here.'] });
    await writer.apply(target, replacement);
    expect(await writer.undo()).toEqual({ ok: false, reason: 'changed' });
    expect(log.includes('keys undo with saved')).toBe(false);
  });

  it('reports a blocked app and an undo it cannot confirm', async () => {
    const blocked = setup({ front: 'blocked' });
    await blocked.writer.apply(target, replacement);
    expect(await blocked.writer.undo()).toEqual({ ok: false, reason: 'blocked' });

    const unconfirmed = setup({ carets: [replacement, replacement, 'still the new text'] });
    await unconfirmed.writer.apply(target, replacement);
    expect(await unconfirmed.writer.undo()).toEqual({ ok: false, reason: 'failed' });
  });

  it('forgets the last write', async () => {
    const { writer } = setup();
    await writer.apply(target, replacement);
    writer.forget();
    expect(await writer.undo()).toEqual({ ok: false, reason: 'expired' });
  });
});
