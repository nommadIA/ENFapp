import {execSync} from 'child_process';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const mode = (process.argv[2] || 'debug').toLowerCase() === 'release' ? 'release' : 'debug';

function run(cmd, cwd = rootDir) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, {cwd, stdio: 'inherit'});
}

// 1. Build web + sync PWA static mirror
run('npm run build:pwa');

// 2. Ensure Capacitor android/ platform exists
const androidDir = path.join(rootDir, 'android');
if (!fs.existsSync(androidDir)) {
  run('npx cap add android');
}

// 3. Sync web dist/ and plugins into android/
run('npx cap sync android');

// 4. Patch AndroidManifest, MainActivity, icons & Gradle version
run('node scripts/prepare-android.mjs');

// 5. Compile APK via Gradle wrapper (Windows & Linux/macOS compatible)
const isWin = process.platform === 'win32';
const gradlew = isWin ? 'gradlew.bat' : './gradlew';
const task = mode === 'release' ? 'assembleRelease' : 'assembleDebug';
run(`${gradlew} ${task}`, androidDir);

// 6. Copy generated APK to release/ folder for easy access
const apkSourceDir = path.join(androidDir, 'app', 'build', 'outputs', 'apk', mode);
const releaseDir = path.join(rootDir, 'release');
fs.mkdirSync(releaseDir, {recursive: true});

if (fs.existsSync(apkSourceDir)) {
  const apkFile = fs.readdirSync(apkSourceDir).find((f) => f.endsWith('.apk'));
  if (apkFile) {
    const destName = mode === 'release' ? 'ENFapp-release.apk' : 'ENFapp-debug.apk';
    const destPath = path.join(releaseDir, destName);
    fs.copyFileSync(path.join(apkSourceDir, apkFile), destPath);
    console.log(`\n✓ APK gerado com sucesso em: release/${destName}`);
  }
}
