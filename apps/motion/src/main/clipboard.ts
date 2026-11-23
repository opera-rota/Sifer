import type { ClipboardKeeper } from './writer';

export interface ClipboardEntry {
  readonly types: readonly string[];
  getType(type: string): Promise<unknown>;
}

export interface ClipboardAccess<Item> {
  read(): Promise<ClipboardEntry[]>;
  write(items: Item[]): Promise<void>;
  writeText(text: string): Promise<void>;
  clear(): void;
}

export type SavedClipboard = readonly Readonly<Record<string, Blob>>[];

async function payloadOf(entry: ClipboardEntry): Promise<Record<string, Blob>> {
  const payload: Record<string, Blob> = {};
  for (const type of entry.types) {
    try {
      const value = await entry.getType(type);
      if (value instanceof Blob) {
        payload[type] = value;
      }
    } catch {
      continue;
    }
  }
  return payload;
}

export async function snapshot(entries: readonly ClipboardEntry[]): Promise<SavedClipboard> {
  const payloads = await Promise.all(entries.map(payloadOf));
  return payloads.filter((payload) => Object.keys(payload).length > 0);
}

export function createClipboardKeeper<Item>(
  clipboard: ClipboardAccess<Item>,
  itemOf: (payload: Readonly<Record<string, Blob>>) => Item,
): ClipboardKeeper<SavedClipboard> {
  return {
    save: async () => {
      try {
        return await snapshot(await clipboard.read());
      } catch {
        return [];
      }
    },
    write: (text) => clipboard.writeText(text),
    restore: async (saved) => {
      if (saved.length === 0) {
        clipboard.clear();
        return;
      }
      try {
        await clipboard.write(saved.map(itemOf));
      } catch {
        clipboard.clear();
      }
    },
  };
}
