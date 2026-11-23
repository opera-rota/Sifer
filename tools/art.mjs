import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mockup = join(root, 'Icon', 'signin.png');
const icon = join(root, 'apps', 'motion', 'resources', 'icon.png');
const assets = join(root, 'apps', 'motion', 'src', 'renderer', 'src', 'assets');

const mantisBox = { left: 470 / 1024, top: 66 / 1536, right: 1, bottom: 518 / 1536 };

const cropMantis = async () => {
  const { width, height } = await sharp(mockup).metadata();
  if (Math.abs(width / height - 2 / 3) > 0.01) {
    throw new Error(`Icon/signin.png must be 2:3 like the mockup, found ${width} x ${height}`);
  }
  const left = Math.round(mantisBox.left * width);
  const top = Math.round(mantisBox.top * height);
  return sharp(mockup)
    .extract({
      left,
      top,
      width: Math.round(mantisBox.right * width) - left,
      height: Math.round(mantisBox.bottom * height) - top,
    })
    .resize({ width: 560 })
    .webp({ quality: 90 })
    .toFile(join(assets, 'mantis.webp'));
};

const brandTile = () =>
  sharp(icon)
    .resize(192, 192, { kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toFile(join(assets, 'brand.png'));

await mkdir(assets, { recursive: true });
await cropMantis();
await brandTile();
console.log('art written to apps/motion/src/renderer/src/assets');
