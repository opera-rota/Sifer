import type { Chord } from './protocol';

export const inputSize = 40;
export const siferInputTag = 0x5349_4645n;

const keyboardInput = 1;
const keyUp = 0x0002;
const control = 0x11;

const chordKeys: Record<Chord, number> = {
  paste: 0x56,
  undo: 0x5a,
};

export function chordStrokes(chord: Chord): readonly { key: number; up: boolean }[] {
  const key = chordKeys[chord];
  return [
    { key: control, up: false },
    { key, up: false },
    { key, up: true },
    { key: control, up: true },
  ];
}

export function chordInputs(chord: Chord): Buffer {
  const strokes = chordStrokes(chord);
  const inputs = Buffer.alloc(inputSize * strokes.length);
  strokes.forEach((stroke, index) => {
    const offset = index * inputSize;
    inputs.writeUInt32LE(keyboardInput, offset);
    inputs.writeUInt16LE(stroke.key, offset + 8);
    inputs.writeUInt16LE(0, offset + 10);
    inputs.writeUInt32LE(stroke.up ? keyUp : 0, offset + 12);
    inputs.writeUInt32LE(0, offset + 16);
    inputs.writeBigUInt64LE(siferInputTag, offset + 24);
  });
  return inputs;
}
