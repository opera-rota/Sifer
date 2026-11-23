import type {
  FixFailure,
  PanelContent,
  ProposalOutcome,
  ReadingSource,
  ReadScope,
} from '../shared/bridge';
import type { FetchLike } from './identity';

export const schemaMajor = 1;
export const maxInstructionLength = 1_000;

const requestTimeout = 30_000;

const readerName: Record<ReadingSource, string> = {
  dom: 'DROP_READER_DOM',
  accessibility: 'DROP_READER_ACCESSIBILITY',
  screenshot: 'DROP_READER_SCREENSHOT',
};

const scopeName: Record<ReadScope, string> = {
  point: 'DROP_SCOPE_POINT',
  page: 'DROP_SCOPE_PAGE',
  focus: 'DROP_SCOPE_FOCUS',
};

export interface InteractionOptions {
  baseUrl: string;
  fetch: FetchLike;
  accessToken: () => Promise<string | null>;
  newKey?: () => string;
  timeout?: number;
}

interface FixPayload {
  fixPlan?: { replacement?: unknown; engine?: unknown; fallback?: unknown };
}

interface ErrorPayload {
  error?: unknown;
}

const failed = (reason: FixFailure): ProposalOutcome => ({ ok: false, reason });

export function resolveBody(content: PanelContent, instruction: string): object | null {
  if (!content.outcome.ok) {
    return null;
  }
  const { reading } = content.outcome;
  return {
    schemaMajor,
    dropContext: {
      reader: readerName[reading.source],
      scope: scopeName[content.scope],
      appKey: (content.app ?? '').toLowerCase(),
      elementRole: reading.control,
      content: reading.text,
    },
    instruction: { text: instruction },
  };
}

async function json<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function outcomeOf(response: Response): Promise<ProposalOutcome> {
  if (response.status === 401) {
    return failed('signed-out');
  }
  if (response.status === 409) {
    const payload = await json<ErrorPayload>(response);
    return failed(payload?.error === 'schema_major_mismatch' ? 'outdated' : 'unavailable');
  }
  if (response.status === 504) {
    return failed('timeout');
  }
  if (response.status >= 400 && response.status < 500) {
    return failed('refused');
  }
  if (!response.ok) {
    return failed('unavailable');
  }
  const plan = (await json<FixPayload>(response))?.fixPlan;
  const replacement = plan?.replacement;
  const engine = plan?.engine;
  if (typeof replacement !== 'string' || replacement.trim() === '' || typeof engine !== 'string') {
    return failed('unavailable');
  }
  return { ok: true, proposal: { replacement, engine, fallback: plan?.fallback === true } };
}

export function createInteractionClient(options: InteractionOptions) {
  const newKey = options.newKey ?? (() => crypto.randomUUID());
  const timeout = options.timeout ?? requestTimeout;
  const url = new URL('/v1/interactions', options.baseUrl).toString();

  async function send(
    body: string,
    key: string,
    token: string,
  ): Promise<Response | 'timeout' | 'unreachable'> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      return await options.fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
        },
        body,
        signal: controller.signal,
      });
    } catch {
      return controller.signal.aborted ? 'timeout' : 'unreachable';
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async propose(content: PanelContent, instruction: string): Promise<ProposalOutcome> {
      const text = instruction.trim().slice(0, maxInstructionLength);
      const body = text === '' ? null : resolveBody(content, text);
      if (body === null) {
        return failed('nothing');
      }
      const token = await options.accessToken();
      if (!token) {
        return failed('signed-out');
      }
      const payload = JSON.stringify(body);
      const key = newKey();
      let answer = await send(payload, key, token);
      if (answer === 'unreachable') {
        answer = await send(payload, key, token);
      }
      if (answer === 'timeout') {
        return failed('timeout');
      }
      if (answer === 'unreachable') {
        return failed('unavailable');
      }
      return outcomeOf(answer);
    },
  };
}

export type InteractionClient = ReturnType<typeof createInteractionClient>;
