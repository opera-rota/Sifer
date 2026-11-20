import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'Icon', 'icon.png');

const design = { size: 1254, left: 30, top: 11, right: 1227, bottom: 1201, radius: 298 };

const targets = {
  motionIco: join(root, 'apps', 'motion', 'resources', 'icon.ico'),
  motionPng: join(root, 'apps', 'motion', 'resources', 'icon.png'),
  trayModule: join(root, 'apps', 'motion', 'src', 'main', 'icon.ts'),
  extension: join(root, 'apps', 'extension', 'public', 'icon'),
};

const icoSizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
const extensionSizes = [16, 32, 48, 96, 128];
const traySizes = { small: 16, large: 32 };

const loadMaster = async () => {
  const { width, height } = await sharp(source).metadata();
  if (width !== height) {
    throw new Error(`Icon/icon.png must be square, found ${width} x ${height}`);
  }
  const scale = width / design.size;
  const at = (value) => Math.round(value * scale);
  const box = {
    x: at(design.left),
    y: at(design.top),
    width: at(design.right - design.left),
    height: at(design.bottom - design.top),
    radius: at(design.radius),
  };
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" ` +
      `rx="${box.radius}" ry="${box.radius}" fill="#fff"/></svg>`,
  );
  const side = Math.max(box.width, box.height);
  const masked = await sharp(source)
    .ensureAlpha()
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
  return sharp(masked)
    .extract({
      left: box.x + Math.floor((box.width - side) / 2),
      top: box.y + Math.floor((box.height - side) / 2),
      width: side,
      height: side,
    })
    .png()
    .toBuffer();
};

const render = (master, size) =>
  sharp(master)
    .resize(size, size, { kernel: 'lanczos3' })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();

const icoFile = (images) => {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map(({ data }) => data)]);
};

const base64Lines = (data) =>
  (data.toString('base64').match(/.{1,96}/g) ?? []).map((line) => `  '${line}',`).join('\n');

const trayModule = async (small, large) => {
  const text = [
    'const small = [',
    base64Lines(small),
    "].join('');",
    '',
    'const large = [',
    base64Lines(large),
    "].join('');",
    '',
    'export const trayIcon = {',
    '  small: `data:image/png;base64,${small}`,',
    '  large: `data:image/png;base64,${large}`,',
    '};',
    '',
  ].join('\n');
  const options = await resolveConfig(targets.trayModule);
  return format(text, { ...options, filepath: targets.trayModule });
};

const write = async (path, data) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
  console.log(`wrote ${path.slice(root.length + 1).replaceAll('\\', '/')}`);
};

const master = await loadMaster();

const icoImages = await Promise.all(
  icoSizes.map(async (size) => ({ size, data: await render(master, size) })),
);
await write(targets.motionIco, icoFile(icoImages));
await write(targets.motionPng, await render(master, 512));

for (const size of extensionSizes) {
  await write(join(targets.extension, `${size}.png`), await render(master, size));
}

const [small, large] = await Promise.all([
  render(master, traySizes.small),
  render(master, traySizes.large),
]);
await write(targets.trayModule, await trayModule(small, large));
