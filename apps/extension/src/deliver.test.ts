import { describe, expect, it, vi } from 'vitest';
import { deliver } from './deliver';
import type { ContentAnswer, ReadOutcome } from './protocol';

const reading: ReadOutcome = {
  ok: true,
  reading: { source: 'dom', kind: 'text', control: 'Paragraph', text: 'Hello' },
};

const answer: ContentAnswer = { outcome: reading, detail: 'viewport 1229x650, point 512,233' };

describe('deliver', () => {
  it('returns the answer of a live content script without injecting', async () => {
    const inject = vi.fn(() => Promise.resolve());
    const delivered = await deliver({ send: () => Promise.resolve(answer), inject });
    expect(delivered).toEqual({ outcome: reading, route: 'answered', detail: answer.detail });
    expect(inject).not.toHaveBeenCalled();
  });

  it('injects the content script once and asks again when no script answers', async () => {
    const send = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('Receiving end does not exist.'))
      .mockResolvedValueOnce(answer);
    const inject = vi.fn(() => Promise.resolve());
    expect(await deliver({ send, inject })).toMatchObject({ outcome: reading, route: 'injected' });
    expect(inject).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('answers unsupported when the page refuses injection', async () => {
    const send = vi.fn(() => Promise.reject(new Error('Receiving end does not exist.')));
    const inject = vi.fn(() => Promise.reject(new Error('Cannot access a chrome:// URL')));
    expect(await deliver({ send, inject })).toEqual({
      outcome: { ok: false, reason: 'unsupported' },
      route: 'refused',
      detail: '',
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('answers unsupported when the injected script still does not answer', async () => {
    const send = vi.fn(() => Promise.reject(new Error('Receiving end does not exist.')));
    const inject = vi.fn(() => Promise.resolve());
    expect(await deliver({ send, inject })).toMatchObject({
      outcome: { ok: false, reason: 'unsupported' },
      route: 'refused',
    });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('reports an empty answer as a silent content script', async () => {
    const delivered = await deliver({
      send: () => Promise.resolve(undefined),
      inject: () => Promise.resolve(),
    });
    expect(delivered).toEqual({
      outcome: { ok: false, reason: 'nothing' },
      route: 'silent',
      detail: '',
    });
  });
});
