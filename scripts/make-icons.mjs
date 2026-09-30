// 生成扩展图标：蓝色圆角方块 + 三根由高到低的白色柱子（排行榜）。
// 不依赖第三方库：逐像素 4×4 超采样抗锯齿，用 node:zlib 编码 PNG。
// 用法：npm run icons

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const SIZES = [16, 32, 48, 128];
const BACKGROUND = [37, 99, 235]; // #2563eb
const FOREGROUND = [255, 255, 255];
const SAMPLES = 4;

// 在单位坐标（0..1）里描述图形。
function insideRoundedSquare(x, y) {
  const r = 0.22;
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

const BARS = [
  { x: 0.2, height: 0.58 },
  { x: 0.42, height: 0.42 },
  { x: 0.64, height: 0.26 },
];
const BAR_WIDTH = 0.16;
const BAR_BOTTOM = 0.8;

function insideBar(x, y) {
  return BARS.some((bar) => x >= bar.x && x < bar.x + BAR_WIDTH && y <= BAR_BOTTOM && y >= BAR_BOTTOM - bar.height);
}

function draw(size) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = (px + (sx + 0.5) / SAMPLES) / size;
          const y = (py + (sy + 0.5) / SAMPLES) / size;
          if (!insideRoundedSquare(x, y)) continue;
          if (insideBar(x, y)) fg++;
          else bg++;
        }
      }
      const covered = bg + fg;
      const i = (py * size + px) * 4;
      if (!covered) continue;
      for (let c = 0; c < 3; c++) {
        pixels[i + c] = Math.round((BACKGROUND[c] * bg + FOREGROUND[c] * fg) / covered);
      }
      pixels[i + 3] = Math.round((covered / (SAMPLES * SAMPLES)) * 255);
    }
  }
  return pixels;
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // 每行的 filter 类型：None
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 位深
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
mkdirSync(outDir, { recursive: true });

for (const size of SIZES) {
  const file = join(outDir, `icon${size}.png`);
  writeFileSync(file, encodePng(size, size, draw(size)));
  console.log(`wrote ${file}`);
}
