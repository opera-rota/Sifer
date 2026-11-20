import type { ContentAnswer, ReadOutcome } from './protocol';

export interface Delivery {
  readonly send: () => Promise<unknown>;
  readonly inject: () => Promise<unknown>;
}

export type Route = 'answered' | 'injected' | 'silent' | 'refused';

export interface Delivered {
  readonly outcome: ReadOutcome;
  readonly route: Route;
  readonly detail: string;
}

const nothing: ReadOutcome = { ok: false, reason: 'nothing' };
const unsupported: ReadOutcome = { ok: false, reason: 'unsupported' };

function deliveredAs(answer: unknown, route: 'answered' | 'injected'): Delivered {
  const content = answer as ContentAnswer | undefined;
  return content?.outcome
    ? { outcome: content.outcome, route, detail: content.detail }
    : { outcome: nothing, route: 'silent', detail: '' };
}

export async function deliver({ send, inject }: Delivery): Promise<Delivered> {
  try {
    return deliveredAs(await send(), 'answered');
  } catch {
    try {
      await inject();
      return deliveredAs(await send(), 'injected');
    } catch {
      return { outcome: unsupported, route: 'refused', detail: '' };
    }
  }
}
