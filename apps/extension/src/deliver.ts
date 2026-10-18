import type { ReadOutcome } from './protocol';

export interface Delivery {
  readonly send: () => Promise<unknown>;
  readonly inject: () => Promise<unknown>;
}

const nothing: ReadOutcome = { ok: false, reason: 'nothing' };
const unsupported: ReadOutcome = { ok: false, reason: 'unsupported' };

function outcomeOf(answer: unknown): ReadOutcome {
  return (answer as ReadOutcome | undefined) ?? nothing;
}

export async function deliver({ send, inject }: Delivery): Promise<ReadOutcome> {
  try {
    return outcomeOf(await send());
  } catch {
    try {
      await inject();
      return outcomeOf(await send());
    } catch {
      return unsupported;
    }
  }
}
