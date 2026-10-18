import { describe, expect, it, vi } from 'vitest';
import { deliver } from './deliver';
import type { ReadOutcome } from './protocol';

const reading: ReadOutcome = {
  ok: true,
  reading: { source: 'dom', kind: 'text', control: 'Paragraph', text: 'Hello' },
};

describe('deliver', () => {
  it('returns the answer of a live content script without injecting', async () => {
    const inject = vi.fn(() => Promise.resolve());
    const outcome = await deliver({ send: () => Promise.resolve(reading), inject });
    expect(outcome).toEqual(reading);
    expect(inject).not.toHaveBeenCalled();
  });

  it('injects the content script once and asks again when no script answers', async () => {
    const send = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('Receiving end does not exist.'))
      .mockResolvedValueOnce(reading);
    const inject = vi.fn(() => Promise.resolve());
    expect(await deliver({ send, inject })).toEqual(reading);
    expect(inject).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('answers unsupported when the page refuses injection', async () => {
    const send = vi.fn(() => Promise.reject(new Error('Receiving end does not exist.')));
    const inject = vi.fn(() => Promise.reject(new Error('Cannot access a chrome:// URL')));
    expect(await deliver({ send, inject })).toEqual({ ok: false, reason: 'unsupported' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('answers unsupported when the injected script still does not answer', async () => {
    const send = vi.fn(() => Promise.reject(new Error('Receiving end does not exist.')));
    const inject = vi.fn(() => Promise.resolve());
    expect(await deliver({ send, inject })).toEqual({ ok: false, reason: 'unsupported' });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('treats an empty answer as nothing readable', async () => {
    const outcome = await deliver({
      send: () => Promise.resolve(undefined),
      inject: () => Promise.resolve(),
    });
    expect(outcome).toEqual({ ok: false, reason: 'nothing' });
  });
});
