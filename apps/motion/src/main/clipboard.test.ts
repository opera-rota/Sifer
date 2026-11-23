import { describe, expect, it } from 'vitest';
import { createClipboardKeeper, snapshot, type ClipboardEntry } from './clipboard';

const entry = (payload: Record<string, unknown>): ClipboardEntry => ({
  types: Object.keys(payload),
  getType: async (type) => {
    if (payload[type] instanceof Error) {
      throw payload[type];
    }
    return payload[type];
  },
});

function fakeClipboard(entries: ClipboardEntry[]) {
  const events: string[] = [];
  const written: Record<string, Blob>[][] = [];
  return {
    events,
    written,
    access: {
      read: async () => entries,
      write: async (items: Record<string, Blob>[]) => {
        written.push(items);
        events.push('write');
      },
      writeText: async (text: string) => {
        events.push(`text ${text}`);
      },
      clear: () => events.push('clear'),
    },
  };
}

describe('snapshot', () => {
  it('keeps every readable blob and drops the rest', async () => {
    const text = new Blob(['hello'], { type: 'text/plain' });
    const saved = await snapshot([
      entry({ 'text/plain': text, 'text/html': new Error('gone'), bookmark: { url: 'x' } }),
      entry({ 'text/html': new Error('gone') }),
    ]);
    expect(saved).toEqual([{ 'text/plain': text }]);
  });
});

describe('createClipboardKeeper', () => {
  it('saves, writes plain text and restores the saved items', async () => {
    const html = new Blob(['<b>hi</b>'], { type: 'text/html' });
    const fake = fakeClipboard([entry({ 'text/html': html })]);
    const keeper = createClipboardKeeper(fake.access, (payload) => ({ ...payload }));
    const saved = await keeper.save();
    await keeper.write('new text');
    await keeper.restore(saved);
    expect(fake.events).toEqual(['text new text', 'write']);
    expect(fake.written).toEqual([[{ 'text/html': html }]]);
  });

  it('clears the clipboard when it was empty before', async () => {
    const fake = fakeClipboard([]);
    const keeper = createClipboardKeeper(fake.access, (payload) => ({ ...payload }));
    await keeper.restore(await keeper.save());
    expect(fake.events).toEqual(['clear']);
  });
});
