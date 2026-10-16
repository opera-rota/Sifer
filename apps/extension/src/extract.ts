import type { ClientPoint } from './locate';
import type { ReadingKind, ReadOutcome } from './protocol';

export const maxReadingLength = 20_000;
export const textTolerance = 4;
export const maxPageNodes = 20_000;

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface Caret {
  readonly node: Node;
  readonly offset: number;
}

export interface Geometry {
  elementAt(point: ClientPoint): Element | null;
  caretAt(point: ClientPoint): Caret | null;
  boxesOf(node: Text): readonly Box[];
  displayOf(element: Element): string;
  hidden(element: Element): boolean;
  viewport(): Box;
}

const inlineDisplays = new Set([
  'inline',
  'inline-block',
  'inline-flex',
  'inline-grid',
  'contents',
]);

const buttonInputs = new Set(['button', 'submit', 'reset', 'image']);

const skippedContainers = 'script, style, noscript, template, textarea, select';

const fieldSelector =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';

const controlNames: Readonly<Record<string, string>> = {
  P: 'Paragraph',
  H1: 'Heading',
  H2: 'Heading',
  H3: 'Heading',
  H4: 'Heading',
  H5: 'Heading',
  H6: 'Heading',
  LI: 'List item',
  DT: 'Term',
  DD: 'Definition',
  BLOCKQUOTE: 'Quote',
  PRE: 'Code',
  FIGCAPTION: 'Caption',
  LABEL: 'Label',
  BUTTON: 'Button',
  A: 'Link',
  SUMMARY: 'Summary',
  LEGEND: 'Legend',
  CAPTION: 'Caption',
};

const noBreakSpace = String.fromCharCode(160);
const objectReplacement = String.fromCharCode(0xfffc);

export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replaceAll(noBreakSpace, ' ')
    .replaceAll(objectReplacement, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxReadingLength);
}

function reading(kind: ReadingKind, control: string, raw: string): ReadOutcome | null {
  const text = normalizeText(raw);
  return text === '' ? null : { ok: true, reading: { source: 'dom', kind, control, text } };
}

function textOf(element: Element): string {
  return element instanceof HTMLElement ? element.innerText || element.textContent || '' : '';
}

function deepElementAt(geometry: Geometry, point: ClientPoint): Element | null {
  let hit = geometry.elementAt(point);
  while (hit?.shadowRoot) {
    const inner = hit.shadowRoot.elementFromPoint(point.x, point.y);
    if (!inner || inner === hit) {
      break;
    }
    hit = inner;
  }
  return hit;
}

function labelOf(field: HTMLElement): string {
  const labelled = field.getAttribute('aria-labelledby');
  if (labelled) {
    const text = labelled
      .split(/\s+/)
      .map((id) => field.ownerDocument.getElementById(id))
      .filter((element): element is HTMLElement => element !== null)
      .map(textOf)
      .join(' ');
    if (text.trim() !== '') {
      return text;
    }
  }
  const aria = field.getAttribute('aria-label');
  if (aria?.trim()) {
    return aria;
  }
  const labels =
    field instanceof HTMLInputElement ||
    field instanceof HTMLTextAreaElement ||
    field instanceof HTMLSelectElement
      ? field.labels
      : null;
  const first = labels?.[0];
  if (first) {
    return textOf(first);
  }
  return field.getAttribute('placeholder') ?? field.getAttribute('title') ?? '';
}

function readField(field: HTMLElement): ReadOutcome | null {
  if (field instanceof HTMLInputElement) {
    const type = field.type.toLowerCase();
    if (type === 'password') {
      return { ok: false, reason: 'protected' };
    }
    if (type === 'hidden') {
      return null;
    }
    if (buttonInputs.has(type)) {
      return reading('name', 'Button', field.value || labelOf(field));
    }
    if (type === 'checkbox' || type === 'radio') {
      const label = normalizeText(labelOf(field));
      return reading('value', 'Choice', `${label}: ${field.checked ? 'selected' : 'not selected'}`);
    }
  }
  const value =
    field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement
      ? field.value
      : field instanceof HTMLSelectElement
        ? Array.from(field.selectedOptions, (option) => option.text).join(', ')
        : textOf(field);
  const label = normalizeText(labelOf(field));
  const shown = normalizeText(value);
  if (shown === '') {
    return reading('name', 'Field', label);
  }
  return reading('value', 'Field', label === '' ? shown : `${label}: ${shown}`);
}

function readTableRow(cell: HTMLTableCellElement): ReadOutcome | null {
  const row = cell.parentElement;
  const table = cell.closest('table');
  if (!(row instanceof HTMLTableRowElement) || !table) {
    return null;
  }
  const headerRow =
    table.tHead?.rows[0] ??
    Array.from(table.rows).find(
      (candidate) => candidate !== row && candidate.querySelector('th') !== null,
    );
  const headers = headerRow
    ? Array.from(headerRow.cells, (header) => normalizeText(textOf(header)))
    : [];
  const lines = Array.from(row.cells, (entry, index) => {
    const value = normalizeText(textOf(entry));
    const header = headerRow === row ? '' : (headers[index] ?? '');
    return header === '' || header === value ? value : `${header}: ${value}`;
  }).filter((line) => line !== '');
  return reading('text', 'Table row', lines.join('\n'));
}

function isOverText(geometry: Geometry, node: Text, point: ClientPoint): boolean {
  return geometry
    .boxesOf(node)
    .some(
      (box) =>
        point.x >= box.left - textTolerance &&
        point.x <= box.right + textTolerance &&
        point.y >= box.top - textTolerance &&
        point.y <= box.bottom + textTolerance,
    );
}

function blockOf(geometry: Geometry, start: Element): Element {
  let current: Element = start;
  while (
    current.parentElement &&
    current.parentElement !== current.ownerDocument.body &&
    inlineDisplays.has(geometry.displayOf(current)) &&
    controlNames[current.tagName] === undefined
  ) {
    current = current.parentElement;
  }
  return current;
}

function controlOf(element: Element): string {
  return controlNames[element.tagName] ?? 'Text';
}

function readName(hit: Element): ReadOutcome | null {
  const named = hit.closest('[aria-label], img[alt], [title], button, [role="button"], a');
  if (!named) {
    return null;
  }
  const raw =
    named.getAttribute('aria-label') ??
    (named instanceof HTMLImageElement ? named.alt : null) ??
    (textOf(named).trim() || named.getAttribute('title') || '');
  return reading('name', controlOf(named) === 'Text' ? 'Element' : controlOf(named), raw);
}

export function extractAt(geometry: Geometry, point: ClientPoint): ReadOutcome {
  const hit = deepElementAt(geometry, point);
  if (!hit) {
    return { ok: false, reason: 'nothing' };
  }
  if (hit.closest('input[type="password" i]')) {
    return { ok: false, reason: 'protected' };
  }
  const field = hit.closest<HTMLElement>(fieldSelector);
  if (field) {
    return readField(field) ?? { ok: false, reason: 'nothing' };
  }
  const caret = geometry.caretAt(point);
  if (caret && caret.node.nodeType === Node.TEXT_NODE) {
    const node = caret.node as Text;
    const parent = node.parentElement;
    if (parent && isOverText(geometry, node, point)) {
      const cell = parent.closest<HTMLTableCellElement>('td, th');
      if (cell) {
        const row = readTableRow(cell);
        if (row) {
          return row;
        }
      }
      const block = blockOf(geometry, parent);
      const found = reading('text', controlOf(block), textOf(block));
      if (found) {
        return found;
      }
    }
  }
  return readName(hit) ?? { ok: false, reason: 'nothing' };
}

function activeElementOf(root: Document): Element | null {
  let active = root.activeElement;
  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return active === root.body || active === root.documentElement ? null : active;
}

function isTextControl(element: Element): boolean {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
}

function caretBlockOf(geometry: Geometry, editor: HTMLElement, root: Document): ReadOutcome | null {
  const anchor = root.getSelection()?.anchorNode ?? null;
  const start = anchor instanceof Element ? anchor : (anchor?.parentElement ?? null);
  if (!start || start === editor || !editor.contains(start)) {
    return null;
  }
  const block = blockOf(geometry, start);
  return editor.contains(block) && block !== editor
    ? reading('text', controlOf(block), textOf(block))
    : null;
}

export function extractFocus(geometry: Geometry, root: Document): ReadOutcome {
  const active = activeElementOf(root);
  if (active?.closest('input[type="password" i]')) {
    return { ok: false, reason: 'protected' };
  }
  const selection = root.getSelection();
  if (selection && !selection.isCollapsed && !(active && isTextControl(active))) {
    const selected = reading('text', 'Selection', selection.toString());
    if (selected) {
      return selected;
    }
  }
  if (!active) {
    return { ok: false, reason: 'nothing' };
  }
  const field = active.closest<HTMLElement>(fieldSelector);
  if (field) {
    const block =
      isTextControl(field) || field instanceof HTMLSelectElement
        ? null
        : caretBlockOf(geometry, field, root);
    return block ?? readField(field) ?? { ok: false, reason: 'nothing' };
  }
  return readName(active) ?? { ok: false, reason: 'nothing' };
}

function intersects(box: Box, viewport: Box): boolean {
  return (
    box.right > box.left &&
    box.bottom > box.top &&
    box.right > viewport.left &&
    box.left < viewport.right &&
    box.bottom > viewport.top &&
    box.top < viewport.bottom
  );
}

export function extractPage(geometry: Geometry, root: Document): ReadOutcome {
  const body = root.body;
  if (!body) {
    return { ok: false, reason: 'nothing' };
  }
  const viewport = geometry.viewport();
  const hiddenBlocks = new Map<Element, boolean>();
  const walker = root.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  let length = 0;
  let lastBlock: Element | null = null;
  let scanned = 0;
  for (
    let node = walker.nextNode();
    node && scanned < maxPageNodes && length < maxReadingLength;
    node = walker.nextNode()
  ) {
    scanned += 1;
    const text = node as Text;
    const parent = text.parentElement;
    if (!parent || text.data.trim() === '' || parent.closest(skippedContainers)) {
      continue;
    }
    if (!geometry.boxesOf(text).some((box) => intersects(box, viewport))) {
      continue;
    }
    const block = blockOf(geometry, parent);
    let hidden = hiddenBlocks.get(block);
    if (hidden === undefined) {
      hidden = geometry.hidden(parent) || geometry.hidden(block);
      hiddenBlocks.set(block, hidden);
    }
    if (hidden) {
      continue;
    }
    const piece = text.data.replace(/\s+/g, ' ');
    if (lastBlock !== null && block !== lastBlock) {
      parts.push('\n');
    }
    parts.push(piece);
    length += piece.length;
    lastBlock = block;
  }
  const joined = parts
    .join('')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join('\n');
  return reading('text', 'Page', joined) ?? { ok: false, reason: 'nothing' };
}

export function documentGeometry(document: Document): Geometry {
  return {
    elementAt: (point) => document.elementFromPoint(point.x, point.y),
    caretAt: (point) => {
      const position = document.caretPositionFromPoint?.(point.x, point.y);
      if (position) {
        return { node: position.offsetNode, offset: position.offset };
      }
      const range = document.caretRangeFromPoint?.(point.x, point.y);
      return range ? { node: range.startContainer, offset: range.startOffset } : null;
    },
    boxesOf: (node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return Array.from(range.getClientRects());
    },
    displayOf: (element) => getComputedStyle(element).display,
    hidden: (element) => {
      const style = getComputedStyle(element);
      return style.visibility === 'hidden' || style.opacity === '0';
    },
    viewport: () => ({
      left: 0,
      top: 0,
      right: document.documentElement.clientWidth || window.innerWidth,
      bottom: document.documentElement.clientHeight || window.innerHeight,
    }),
  };
}
