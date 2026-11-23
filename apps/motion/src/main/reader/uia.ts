import koffi from 'koffi';
import type { Point } from '../drag';
import {
  check,
  ComError,
  ComObject,
  comSignatures,
  guid,
  intOut,
  parseGuid,
  pointerOut,
  using,
  type Guid,
} from './com';
import {
  covers,
  maxReadingLength,
  type Automation,
  type AutomationNode,
  type FocusAutomation,
  type FocusedElement,
  type ScreenRect,
  type TextHit,
  type TextSpan,
  type WritableNode,
  type WriteAutomation,
} from './strategy';
import { rootWindowAt } from './window';

const point = koffi.struct('SiferUiaPoint', { x: 'int32', y: 'int32' });
const rect = koffi.struct('SiferUiaRect', {
  left: 'int32',
  top: 'int32',
  right: 'int32',
  bottom: 'int32',
});

const signatures = {
  getPointer: comSignatures.getPointer,
  atPoint: koffi.proto('__stdcall', 'SiferUiaAtPoint', 'int32', ['void *', point, pointerOut]),
  parentOf: koffi.proto('__stdcall', 'SiferUiaParentOf', 'int32', ['void *', 'void *', pointerOut]),
  patternAs: koffi.proto('__stdcall', 'SiferUiaPatternAs', 'int32', [
    'void *',
    'int32',
    koffi.pointer(guid),
    pointerOut,
  ]),
  expand: koffi.proto('__stdcall', 'SiferUiaExpand', 'int32', ['void *', 'int32']),
  getText: koffi.proto('__stdcall', 'SiferUiaGetText', 'int32', ['void *', 'int32', pointerOut]),
  getRect: koffi.proto('__stdcall', 'SiferUiaGetRect', 'int32', [
    'void *',
    koffi.out(koffi.pointer(rect)),
  ]),
  caretRange: koffi.proto('__stdcall', 'SiferUiaCaretRange', 'int32', [
    'void *',
    intOut,
    pointerOut,
  ]),
  elementAt: koffi.proto('__stdcall', 'SiferUiaElementAt', 'int32', [
    'void *',
    'int32',
    pointerOut,
  ]),
  moveEndpoint: koffi.proto('__stdcall', 'SiferUiaMoveEndpoint', 'int32', [
    'void *',
    'int32',
    'int32',
    'int32',
    intOut,
  ]),
};

const slots = {
  automation: {
    elementFromHandle: 6,
    elementFromPoint: 7,
    focusedElement: 8,
    controlViewWalker: 14,
  },
  walker: { parent: 3, firstChild: 4, nextSibling: 6 },
  element: {
    patternAs: 14,
    controlType: 21,
    name: 23,
    isPassword: 35,
    isOffscreen: 38,
    boundingRectangle: 43,
  },
  textPattern: { rangeFromPoint: 3, rangeFromChild: 4, selection: 5, documentRange: 7 },
  textPattern2: { caretRange: 10 },
  rangeArray: { length: 3, element: 4 },
  textRange: { expand: 6, boundingRectangles: 10, getText: 12, moveEndpointByUnit: 14, select: 16 },
  valuePattern: { value: 4 },
};

const patterns = { value: 10002, text: 10014, text2: 10024 };
const maxSelectionRanges = 16;
const textUnit = { character: 0, line: 3, paragraph: 4 };
const rangeEnd = 1;
const invalidArgument = 0x80070057 | 0;
const clsctxInprocServer = 1;
const coinitMultithreaded = 0;
const rpcChangedMode = 0x80010106 | 0;

const ids = {
  cuiAutomation: parseGuid('ff48dba4-60ef-4201-aa87-54103eef594e'),
  iuiAutomation: parseGuid('30cbe57d-d9d0-452a-ab13-7ac5ac4825ee'),
  textPattern: parseGuid('32eba289-3583-42c9-9c59-3b6d9a1e9b6a'),
  textPattern2: parseGuid('506a921a-fcc9-409f-b23b-37eb74106872'),
  valuePattern: parseGuid('a94cd8b1-0844-4cd6-9d2d-640537ab39e9'),
};

const ole32 = koffi.load('ole32.dll');
const oleaut32 = koffi.load('oleaut32.dll');
const coInitializeEx = ole32.func('int32 __stdcall CoInitializeEx(void *reserved, uint32 mode)');
const coUninitialize = ole32.func('void __stdcall CoUninitialize()');
const coCreateInstance = ole32.func('__stdcall', 'CoCreateInstance', 'int32', [
  koffi.pointer(guid),
  'void *',
  'uint32',
  koffi.pointer(guid),
  pointerOut,
]);
const safeArrayGetLBound = oleaut32.func('__stdcall', 'SafeArrayGetLBound', 'int32', [
  'void *',
  'uint32',
  intOut,
]);
const safeArrayGetUBound = oleaut32.func('__stdcall', 'SafeArrayGetUBound', 'int32', [
  'void *',
  'uint32',
  intOut,
]);
const safeArrayAccessData = oleaut32.func('__stdcall', 'SafeArrayAccessData', 'int32', [
  'void *',
  pointerOut,
]);
const safeArrayUnaccessData = oleaut32.func('int32 __stdcall SafeArrayUnaccessData(void *array)');
const safeArrayDestroy = oleaut32.func('int32 __stdcall SafeArrayDestroy(void *array)');

function takeRects(array: unknown): ScreenRect[] {
  try {
    const lower = [0];
    const upper = [0];
    check('SafeArrayGetLBound', safeArrayGetLBound(array, 1, lower) as number);
    check('SafeArrayGetUBound', safeArrayGetUBound(array, 1, upper) as number);
    const count = (upper[0] ?? -1) - (lower[0] ?? 0) + 1;
    if (count < 4) {
      return [];
    }
    const data: unknown[] = [null];
    check('SafeArrayAccessData', safeArrayAccessData(array, data) as number);
    try {
      const values = koffi.decode(data[0], 'double', count) as Float64Array;
      const rects: ScreenRect[] = [];
      for (let index = 0; index + 3 < values.length; index += 4) {
        rects.push({
          x: values[index] ?? 0,
          y: values[index + 1] ?? 0,
          width: values[index + 2] ?? 0,
          height: values[index + 3] ?? 0,
        });
      }
      return rects;
    } finally {
      safeArrayUnaccessData(array);
    }
  } finally {
    safeArrayDestroy(array);
  }
}

function expand(range: ComObject, unit: number): void {
  check('ExpandToEnclosingUnit', range.call(slots.textRange.expand, signatures.expand, unit));
}

function rectsOf(range: ComObject): ScreenRect[] {
  const out: unknown[] = [null];
  check(
    'GetBoundingRectangles',
    range.call(slots.textRange.boundingRectangles, signatures.getPointer, out),
  );
  return out[0] ? takeRects(out[0]) : [];
}

function paragraphOf(range: ComObject): TextHit {
  expand(range, textUnit.paragraph);
  return { text: textOf(range), bounds: rectsOf(range) };
}

function textOf(range: ComObject): string {
  return (
    range.string('GetText', slots.textRange.getText, signatures.getText, maxReadingLength) ?? ''
  );
}

class UiaSpan implements TextSpan {
  readonly bounds: readonly ScreenRect[];
  readonly #range: ComObject;

  constructor(range: ComObject, bounds: readonly ScreenRect[]) {
    this.#range = range;
    this.bounds = bounds;
  }

  text(): string {
    return textOf(this.#range);
  }

  shrinkEnd(characters: number): void {
    check(
      'MoveEndpointByUnit',
      this.#range.call(
        slots.textRange.moveEndpointByUnit,
        signatures.moveEndpoint,
        rangeEnd,
        textUnit.character,
        -characters,
        [0],
      ),
    );
  }

  select(): void {
    this.#range.invoke('Select', slots.textRange.select, comSignatures.call);
  }

  release(): void {
    this.#range.release();
  }
}

function spanFrom(range: ComObject | null, shape: (range: ComObject) => readonly ScreenRect[]) {
  if (!range) {
    return null;
  }
  try {
    return new UiaSpan(range, shape(range));
  } catch (error) {
    range.release();
    throw error;
  }
}

class UiaNode implements AutomationNode, FocusedElement, WritableNode {
  readonly #element: ComObject;
  readonly #walker: ComObject;

  constructor(element: ComObject, walker: ComObject) {
    this.#element = element;
    this.#walker = walker;
  }

  controlType(): number {
    return this.#element.int('get_CurrentControlType', slots.element.controlType);
  }

  isPassword(): boolean {
    return this.#element.int('get_CurrentIsPassword', slots.element.isPassword) !== 0;
  }

  isOffscreen(): boolean {
    return this.#element.int('get_CurrentIsOffscreen', slots.element.isOffscreen) !== 0;
  }

  name(): string {
    return this.#element.string('get_CurrentName', slots.element.name, signatures.getPointer) ?? '';
  }

  textAt(at: Point): TextHit | null {
    return using(this.#pattern(patterns.text, ids.textPattern), (pattern) =>
      using(
        pattern.pointerOut(
          'RangeFromPoint',
          slots.textPattern.rangeFromPoint,
          signatures.atPoint,
          at,
        ),
        (range) => {
          expand(range, textUnit.line);
          const bounds = rectsOf(range);
          if (!covers(bounds, at)) {
            return { text: '', bounds };
          }
          expand(range, textUnit.paragraph);
          return { text: textOf(range), bounds };
        },
      ),
    );
  }

  textOf(child: AutomationNode): TextHit | null {
    if (!(child instanceof UiaNode)) {
      return null;
    }
    return using(this.#pattern(patterns.text, ids.textPattern), (pattern) => {
      let range: ComObject | null;
      try {
        range = pattern.pointerOut(
          'RangeFromChild',
          slots.textPattern.rangeFromChild,
          signatures.parentOf,
          child.#element.pointer,
        );
      } catch (error) {
        if (error instanceof ComError && error.hresult === invalidArgument) {
          return { text: '', bounds: [] };
        }
        throw error;
      }
      return (
        using(range, (found) => ({ text: textOf(found), bounds: rectsOf(found) })) ?? {
          text: '',
          bounds: [],
        }
      );
    });
  }

  spanAt(at: Point): TextSpan | null {
    return using(this.#pattern(patterns.text, ids.textPattern), (pattern) =>
      spanFrom(
        pattern.pointerOut(
          'RangeFromPoint',
          slots.textPattern.rangeFromPoint,
          signatures.atPoint,
          at,
        ),
        (range) => {
          expand(range, textUnit.line);
          const bounds = rectsOf(range);
          if (covers(bounds, at)) {
            expand(range, textUnit.paragraph);
          }
          return bounds;
        },
      ),
    );
  }

  spanOf(child: WritableNode): TextSpan | null {
    if (!(child instanceof UiaNode)) {
      return null;
    }
    return using(this.#pattern(patterns.text, ids.textPattern), (pattern) => {
      try {
        return spanFrom(
          pattern.pointerOut(
            'RangeFromChild',
            slots.textPattern.rangeFromChild,
            signatures.parentOf,
            child.#element.pointer,
          ),
          rectsOf,
        );
      } catch (error) {
        if (error instanceof ComError && error.hresult === invalidArgument) {
          return null;
        }
        throw error;
      }
    });
  }

  bounds(): ScreenRect | null {
    const box = { left: 0, top: 0, right: 0, bottom: 0 };
    check(
      'get_CurrentBoundingRectangle',
      this.#element.call(slots.element.boundingRectangle, signatures.getRect, box),
    );
    const width = box.right - box.left;
    const height = box.bottom - box.top;
    return width > 0 && height > 0 ? { x: box.left, y: box.top, width, height } : null;
  }

  selection(): TextHit | null {
    const texts: string[] = [];
    const bounds: ScreenRect[] = [];
    const selected = this.#eachSelected((range) => {
      texts.push(textOf(range));
      bounds.push(...rectsOf(range));
      return true;
    });
    return selected ? { text: texts.join('\n'), bounds } : null;
  }

  caret(): TextHit | null {
    const fromCaret = this.#caretParagraph();
    if (fromCaret) {
      return fromCaret;
    }
    const fromSelection: TextHit[] = [];
    this.#eachSelected((range) => {
      fromSelection.push(paragraphOf(range));
      return false;
    });
    return fromSelection[0] ?? null;
  }

  value(): string | null {
    return using(this.#pattern(patterns.value, ids.valuePattern), (pattern) =>
      pattern.string('get_CurrentValue', slots.valuePattern.value, signatures.getPointer),
    );
  }

  documentText(): string | null {
    return using(this.#pattern(patterns.text, ids.textPattern), (pattern) =>
      using(
        pattern.pointerOut(
          'get_DocumentRange',
          slots.textPattern.documentRange,
          signatures.getPointer,
        ),
        textOf,
      ),
    );
  }

  parent(): UiaNode | null {
    return this.#walk('GetParentElement', slots.walker.parent);
  }

  firstChild(): UiaNode | null {
    return this.#walk('GetFirstChildElement', slots.walker.firstChild);
  }

  nextSibling(): UiaNode | null {
    return this.#walk('GetNextSiblingElement', slots.walker.nextSibling);
  }

  release(): void {
    this.#element.release();
  }

  #walk(operation: string, slot: number): UiaNode | null {
    const found = this.#walker.pointerOut(
      operation,
      slot,
      signatures.parentOf,
      this.#element.pointer,
    );
    return found ? new UiaNode(found, this.#walker) : null;
  }

  #caretParagraph(): TextHit | null {
    try {
      return using(this.#pattern(patterns.text2, ids.textPattern2), (pattern) => {
        const active = [0];
        const out: unknown[] = [null];
        check(
          'GetCaretRange',
          pattern.call(slots.textPattern2.caretRange, signatures.caretRange, active, out),
        );
        return using(out[0] ? new ComObject(out[0]) : null, paragraphOf);
      });
    } catch {
      return null;
    }
  }

  #eachSelected(visit: (range: ComObject) => boolean): boolean {
    return (
      using(this.#pattern(patterns.text, ids.textPattern), (pattern) =>
        using(
          pattern.pointerOut('GetSelection', slots.textPattern.selection, signatures.getPointer),
          (ranges) => {
            const count = Math.min(
              ranges.int('get_Length', slots.rangeArray.length),
              maxSelectionRanges,
            );
            for (let index = 0; index < count; index += 1) {
              const range = ranges.pointerOut(
                'GetElement',
                slots.rangeArray.element,
                signatures.elementAt,
                index,
              );
              if (using(range, visit) === false) {
                break;
              }
            }
            return true;
          },
        ),
      ) ?? false
    );
  }

  #pattern(id: number, iid: Guid): ComObject | null {
    return this.#element.pointerOut(
      'GetCurrentPatternAs',
      slots.element.patternAs,
      signatures.patternAs,
      id,
      iid,
    );
  }
}

export interface UiAutomation extends Automation, FocusAutomation, WriteAutomation {
  elementAt(point: Point): WritableNode | null;
  dispose(): void;
}

export function createUiAutomation(): UiAutomation {
  const initialized = coInitializeEx(null, coinitMultithreaded) as number;
  if (initialized < 0 && initialized !== rpcChangedMode) {
    throw new ComError('CoInitializeEx', initialized);
  }
  const owns = initialized >= 0;
  try {
    const out: unknown[] = [null];
    check(
      'CoCreateInstance',
      coCreateInstance(
        ids.cuiAutomation,
        null,
        clsctxInprocServer,
        ids.iuiAutomation,
        out,
      ) as number,
    );
    const automation = new ComObject(out[0]);
    const walker = automation.pointerOut(
      'get_ControlViewWalker',
      slots.automation.controlViewWalker,
      signatures.getPointer,
    );
    if (!walker) {
      automation.release();
      throw new Error('ui automation returned no tree walker');
    }
    return {
      elementAt(at: Point): UiaNode | null {
        const element = automation.pointerOut(
          'ElementFromPoint',
          slots.automation.elementFromPoint,
          signatures.atPoint,
          at,
        );
        return element ? new UiaNode(element, walker) : null;
      },
      focused(): FocusedElement | null {
        const element = automation.pointerOut(
          'GetFocusedElement',
          slots.automation.focusedElement,
          signatures.getPointer,
        );
        return element ? new UiaNode(element, walker) : null;
      },
      windowAt(at: Point): AutomationNode | null {
        const handle = rootWindowAt(at);
        if (!handle) {
          return null;
        }
        const element = automation.pointerOut(
          'ElementFromHandle',
          slots.automation.elementFromHandle,
          signatures.parentOf,
          handle,
        );
        return element ? new UiaNode(element, walker) : null;
      },
      dispose(): void {
        walker.release();
        automation.release();
        if (owns) {
          coUninitialize();
        }
      },
    };
  } catch (error) {
    if (owns) {
      coUninitialize();
    }
    throw error;
  }
}
