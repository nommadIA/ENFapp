import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const enfPublicDir = path.join(rootDir, 'enfapp', 'public');

if (!fs.existsSync(enfPublicDir)) {
  console.log('[sync-deploy] enfapp/public not found — skipping static mirror.');
  process.exit(0);
}

// 1. Sync root index.html
fs.copyFileSync(path.join(rootDir, 'index.html'), path.join(enfPublicDir, 'index.html'));

// 2. Sync PWA & deploy files from public/ into enfapp/public/
const filesToMirror = [
  'manifest.webmanifest',
  'sw.js',
  '_redirects',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-192.png',
  'icon-maskable-512.png',
  'apple-touch-icon.png',
  'apple-touch-icon-167x167.png',
  'apple-touch-icon-152x152.png',
];

for (const file of filesToMirror) {
  const src = path.join(publicDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(enfPublicDir, file));
  }
}

// 3. Mirror auth/callback and .well-known directories
for (const dirName of ['auth', '.well-known']) {
  const srcDir = path.join(publicDir, dirName);
  const dstDir = path.join(enfPublicDir, dirName);
  if (fs.existsSync(srcDir)) {
    fs.cpSync(srcDir, dstDir, {recursive: true, force: true});
  }
}

console.log('[sync-deploy] Synced index.html and PWA assets to enfapp/public ✓');
