import { describe, expect, it } from 'vitest';
import { chordInputs, chordStrokes, inputSize, siferInputTag } from './keys';

describe('chordStrokes', () => {
  it('holds Control around the key and releases in reverse order', () => {
    expect(chordStrokes('paste')).toEqual([
      { key: 0x11, up: false },
      { key: 0x56, up: false },
      { key: 0x56, up: true },
      { key: 0x11, up: true },
    ]);
    expect(chordStrokes('undo')[1]).toEqual({ key: 0x5a, up: false });
  });
});

describe('chordInputs', () => {
  it('lays out four 64-bit INPUT records for SendInput', () => {
    const inputs = chordInputs('undo');
    expect(inputs.length).toBe(4 * inputSize);
    const keys = [0, 1, 2, 3].map((index) => inputs.readUInt16LE(index * inputSize + 8));
    const flags = [0, 1, 2, 3].map((index) => inputs.readUInt32LE(index * inputSize + 12));
    expect(keys).toEqual([0x11, 0x5a, 0x5a, 0x11]);
    expect(flags).toEqual([0, 0, 2, 2]);
    for (let index = 0; index < 4; index += 1) {
      expect(inputs.readUInt32LE(index * inputSize)).toBe(1);
      expect(inputs.readBigUInt64LE(index * inputSize + 24)).toBe(siferInputTag);
    }
  });
});
