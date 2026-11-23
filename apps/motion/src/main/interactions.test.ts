import { describe, expect, it, vi } from 'vitest';
import type { PanelContent } from '../shared/bridge';
import type { FetchLike } from './identity';
import { createInteractionClient, resolveBody } from './interactions';

const paragraph: PanelContent = {
  scope: 'point',
  app: 'Word',
  outcome: {
    ok: true,
    reading: {
      source: 'accessibility',
      kind: 'text',
      control: 'Paragraph',
      text: 'we need to circle back on the deck before eod',
    },
  },
};

const answer = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const plan = {
  fixPlan: {
    fixKey: 'rewrite',
    replacement: 'We need to review the deck before the end of the day.',
    expectPrefix: 'We need to review the deck before the end of the day.',
    engine: 'claude-haiku',
  },
};

function clientWith(fetcher: FetchLike, token: string | null = 'access.token.value') {
  return createInteractionClient({
    baseUrl: 'http://127.0.0.1:8080',
    fetch: fetcher,
    accessToken: async () => token,
    newKey: () => '0192f0c4-7b1e-7cc0-9d6a-3f2b8e1a4c55',
    timeout: 50,
  });
}

describe('resolveBody', () => {
  it('describes the drop in the contract shape', () => {
    expect(resolveBody(paragraph, 'make this more professional')).toEqual({
      schemaMajor: 1,
      dropContext: {
        reader: 'DROP_READER_ACCESSIBILITY',
        scope: 'DROP_SCOPE_POINT',
        appKey: 'word',
        elementRole: 'Paragraph',
        content: 'we need to circle back on the deck before eod',
      },
      instruction: { text: 'make this more professional' },
    });
  });

  it('has nothing to send for a failed reading', () => {
    expect(
      resolveBody({ scope: 'page', app: null, outcome: { ok: false, reason: 'nothing' } }, 'x'),
    ).toBeNull();
  });
});

describe('createInteractionClient', () => {
  it('posts the drop with the token and a retry key and returns the proposal', async () => {
    const fetcher = vi.fn<FetchLike>(async () => answer(200, plan));
    const outcome = await clientWith(fetcher).propose(paragraph, '  make this more professional ');
    expect(outcome).toEqual({
      ok: true,
      proposal: {
        replacement: 'We need to review the deck before the end of the day.',
        engine: 'claude-haiku',
        fallback: false,
      },
    });
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe('http://127.0.0.1:8080/v1/interactions');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer access.token.value',
      'Idempotency-Key': '0192f0c4-7b1e-7cc0-9d6a-3f2b8e1a4c55',
    });
    expect(JSON.parse(String(init?.body)).instruction).toEqual({
      text: 'make this more professional',
    });
  });

  it('reports the fallback engine', async () => {
    const fallback = { fixPlan: { ...plan.fixPlan, engine: 'claude-sonnet', fallback: true } };
    const outcome = await clientWith(async () => answer(200, fallback)).propose(paragraph, 'fix');
    expect(outcome).toMatchObject({
      ok: true,
      proposal: { engine: 'claude-sonnet', fallback: true },
    });
  });

  it('does not call the gateway when signed out or with nothing to send', async () => {
    const fetcher = vi.fn<FetchLike>(async () => answer(200, plan));
    expect(await clientWith(fetcher, null).propose(paragraph, 'fix')).toEqual({
      ok: false,
      reason: 'signed-out',
    });
    expect(await clientWith(fetcher).propose(paragraph, '   ')).toEqual({
      ok: false,
      reason: 'nothing',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('retries an unreachable gateway once with the same key', async () => {
    const fetcher = vi
      .fn<FetchLike>()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(answer(200, plan));
    const outcome = await clientWith(fetcher).propose(paragraph, 'fix');
    expect(outcome.ok).toBe(true);
    const keys = fetcher.mock.calls.map(
      ([, init]) => (init.headers as Record<string, string>)['Idempotency-Key'],
    );
    expect(keys).toEqual([
      '0192f0c4-7b1e-7cc0-9d6a-3f2b8e1a4c55',
      '0192f0c4-7b1e-7cc0-9d6a-3f2b8e1a4c55',
    ]);
  });

  it('gives up after the second unreachable attempt', async () => {
    const fetcher = vi.fn<FetchLike>(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await clientWith(fetcher).propose(paragraph, 'fix')).toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('times out instead of waiting forever', async () => {
    const fetcher: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    expect(await clientWith(fetcher).propose(paragraph, 'fix')).toEqual({
      ok: false,
      reason: 'timeout',
    });
  });

  it.each([
    [401, {}, 'signed-out'],
    [409, { error: 'schema_major_mismatch' }, 'outdated'],
    [409, { error: 'failed_precondition' }, 'unavailable'],
    [400, { error: 'invalid_argument' }, 'refused'],
    [422, { error: 'idempotency_key_reused' }, 'refused'],
    [503, { error: 'upstream_unavailable' }, 'unavailable'],
    [504, { error: 'upstream_timeout' }, 'timeout'],
    [200, { fixPlan: { replacement: '  ', engine: 'x' } }, 'unavailable'],
    [200, { nothing: true }, 'unavailable'],
  ] as const)('turns HTTP %i %j into %s', async (status, body, reason) => {
    const outcome = await clientWith(async () => answer(status, body)).propose(paragraph, 'fix');
    expect(outcome).toEqual({ ok: false, reason });
  });
});
