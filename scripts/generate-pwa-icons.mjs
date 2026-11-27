import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');

// Minimal pure-Node PNG decoder/encoder for RGBA8 / RGB8 / indexed-free PNGs
const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // Filter type 0 (None)
    rgba.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = zlib.deflateSync(raw, {level: 9});
  return Buffer.concat([
    PNG_SIG,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) {
    throw new Error('Invalid PNG signature');
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buf.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`Unsupported PNG format: bitDepth=${bitDepth}, colorType=${colorType}`);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const stride = width * bpp;
  const recon = Buffer.alloc(height * stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const srcRow = y * (stride + 1) + 1;
    const dstRow = y * stride;
    for (let x = 0; x < stride; x++) {
      const val = raw[srcRow + x];
      const a = x >= bpp ? recon[dstRow + x - bpp] : 0;
      const b = y > 0 ? recon[dstRow - stride + x] : 0;
      const c = x >= bpp && y > 0 ? recon[dstRow - stride + x - bpp] : 0;
      let out = val;
      if (filter === 1) out = (val + a) & 0xff;
      else if (filter === 2) out = (val + b) & 0xff;
      else if (filter === 3) out = (val + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) out = (val + paethPredictor(a, b, c)) & 0xff;
      recon[dstRow + x] = out;
    }
  }

  const rgba = Buffer.alloc(width * height * 4);
  if (bpp === 4) {
    recon.copy(rgba);
  } else {
    for (let i = 0, j = 0; i < recon.length; i += 3, j += 4) {
      rgba[j] = recon[i];
      rgba[j + 1] = recon[i + 1];
      rgba[j + 2] = recon[i + 2];
      rgba[j + 3] = 255;
    }
  }
  return {width, height, rgba};
}

function resizeBilinear(src, dstW, dstH) {
  const out = Buffer.alloc(dstW * dstH * 4);
  const scaleX = src.width / dstW;
  const scaleY = src.height / dstH;
  for (let y = 0; y < dstH; y++) {
    const fy = (y + 0.5) * scaleY - 0.5;
    const y0 = Math.max(0, Math.min(src.height - 1, Math.floor(fy)));
    const y1 = Math.max(0, Math.min(src.height - 1, y0 + 1));
    const wy = Math.max(0, Math.min(1, fy - y0));
    for (let x = 0; x < dstW; x++) {
      const fx = (x + 0.5) * scaleX - 0.5;
      const x0 = Math.max(0, Math.min(src.width - 1, Math.floor(fx)));
      const x1 = Math.max(0, Math.min(src.width - 1, x0 + 1));
      const wx = Math.max(0, Math.min(1, fx - x0));
      const i00 = (y0 * src.width + x0) * 4;
      const i10 = (y0 * src.width + x1) * 4;
      const i01 = (y1 * src.width + x0) * 4;
      const i11 = (y1 * src.width + x1) * 4;
      const dstIdx = (y * dstW + x) * 4;
      for (let c = 0; c < 4; c++) {
        const top = src.rgba[i00 + c] * (1 - wx) + src.rgba[i10 + c] * wx;
        const bot = src.rgba[i01 + c] * (1 - wx) + src.rgba[i11 + c] * wx;
        out[dstIdx + c] = Math.round(top * (1 - wy) + bot * wy);
      }
    }
  }
  return {width: dstW, height: dstH, rgba: out};
}

function createMaskable(src, size, safeRatio = 0.72, bgRgb = [12, 14, 15]) {
  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = bgRgb[0];
    out[i + 1] = bgRgb[1];
    out[i + 2] = bgRgb[2];
    out[i + 3] = 255;
  }
  const innerSize = Math.round(size * safeRatio);
  const scaled = resizeBilinear(src, innerSize, innerSize);
  const pad = Math.floor((size - innerSize) / 2);
  for (let y = 0; y < innerSize; y++) {
    for (let x = 0; x < innerSize; x++) {
      const si = (y * innerSize + x) * 4;
      const di = ((y + pad) * size + (x + pad)) * 4;
      const a = scaled.rgba[si + 3] / 255;
      out[di] = Math.round(scaled.rgba[si] * a + bgRgb[0] * (1 - a));
      out[di + 1] = Math.round(scaled.rgba[si + 1] * a + bgRgb[1] * (1 - a));
      out[di + 2] = Math.round(scaled.rgba[si + 2] * a + bgRgb[2] * (1 - a));
      out[di + 3] = 255;
    }
  }
  return {width: size, height: size, rgba: out};
}

const srcPath = path.join(publicDir, 'icon-512.png');
if (!fs.existsSync(srcPath)) {
  console.error('Source icon not found:', srcPath);
  process.exit(1);
}

const src = decodePng(fs.readFileSync(srcPath));
// Sample background color from corner pixel of icon-512.png so maskable padding blends invisibly
const cornerBg = [src.rgba[0], src.rgba[1], src.rgba[2]];

const outputs = [
  {name: 'apple-touch-icon.png', img: resizeBilinear(src, 180, 180)},
  {name: 'apple-touch-icon-167x167.png', img: resizeBilinear(src, 167, 167)},
  {name: 'apple-touch-icon-152x152.png', img: resizeBilinear(src, 152, 152)},
  {name: 'icon-maskable-192.png', img: createMaskable(src, 192, 0.72, cornerBg)},
  {name: 'icon-maskable-512.png', img: createMaskable(src, 512, 0.72, cornerBg)},
];

for (const item of outputs) {
  const pngBuf = encodePng(item.img.width, item.img.height, item.img.rgba);
  fs.writeFileSync(path.join(publicDir, item.name), pngBuf);
  const enfPub = path.join(rootDir, 'enfapp', 'public');
  if (fs.existsSync(enfPub)) {
    fs.writeFileSync(path.join(enfPub, item.name), pngBuf);
  }
  console.log(`Generated ${item.name} (${item.img.width}x${item.img.height}, ${pngBuf.length} bytes)`);
}
