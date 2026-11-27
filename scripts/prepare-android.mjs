import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const androidDir = path.join(rootDir, 'android');
const appMainDir = path.join(androidDir, 'app', 'src', 'main');
const manifestPath = path.join(appMainDir, 'AndroidManifest.xml');

if (!fs.existsSync(androidDir) || !fs.existsSync(manifestPath)) {
  console.log('[prepare-android] Pasta android/ ainda não foi inicializada.');
  console.log('Execute primeiro: npx cap add android');
  process.exit(0);
}

// 1. Patch AndroidManifest.xml with required permissions, hardware features, and enfapp:// deep links
let manifest = fs.readFileSync(manifestPath, 'utf8');

const requiredPermissions = [
  'android.permission.INTERNET',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.SCHEDULE_EXACT_ALARM',
  'android.permission.USE_EXACT_ALARM',
  'android.permission.VIBRATE',
  'android.permission.WAKE_LOCK',
  'android.permission.RECEIVE_BOOT_COMPLETED',
  'android.permission.RECORD_AUDIO',
  'android.permission.MODIFY_AUDIO_SETTINGS',
  'android.permission.CAMERA',
];

for (const perm of requiredPermissions) {
  if (!manifest.includes(perm)) {
    manifest = manifest.replace(
      '<application',
      `    <uses-permission android:name="${perm}" />\n    <application`
    );
  }
}

const optionalFeatures = [
  '<uses-feature android:name="android.hardware.camera" android:required="false" />',
  '<uses-feature android:name="android.hardware.microphone" android:required="false" />',
];
for (const feat of optionalFeatures) {
  if (!manifest.includes(feat)) {
    manifest = manifest.replace('<application', `    ${feat}\n    <application`);
  }
}

// Ensure HTTPS-only (no cleartext) & hardware acceleration
if (!manifest.includes('android:usesCleartextTraffic')) {
  manifest = manifest.replace('<application', '<application android:usesCleartextTraffic="false"');
}

// Add custom URL scheme deep link (enfapp://auth/callback & enfapp://checkout-return)
if (!manifest.includes('android:scheme="enfapp"')) {
  const deepLinkIntent = `
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="enfapp" />
            </intent-filter>`;
  manifest = manifest.replace('</activity>', `${deepLinkIntent}\n        </activity>`);
}

fs.writeFileSync(manifestPath, manifest, 'utf8');
console.log('[prepare-android] AndroidManifest.xml atualizado com permissões e deep link enfapp:// ✓');

// 2. Patch MainActivity.java to auto-grant WebView camera & microphone requests (after Android runtime permission)
const mainActivityPath = path.join(
  appMainDir,
  'java',
  'br',
  'com',
  'enfapp',
  'app',
  'MainActivity.java'
);

if (fs.existsSync(mainActivityPath)) {
  const mainActivityCode = `package br.com.enfapp.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {
    private static final int REQ_MEDIA_PERMS = 4021;
    private PermissionRequest pendingWebPermissionRequest = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        if (this.bridge != null && this.bridge.getWebView() != null) {
            this.bridge.getWebView().setWebChromeClient(new BridgeWebChromeClient(this.bridge) {
                @Override
                public void onPermissionRequest(final PermissionRequest request) {
                    runOnUiThread(() -> handleWebPermissionRequest(request));
                }
            });
        }
    }

    private void handleWebPermissionRequest(PermissionRequest request) {
        List<String> needed = new ArrayList<>();
        for (String res : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)) {
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                    needed.add(Manifest.permission.RECORD_AUDIO);
                }
            } else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)) {
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                    needed.add(Manifest.permission.CAMERA);
                }
            }
        }
        if (needed.isEmpty()) {
            request.grant(request.getResources());
        } else {
            pendingWebPermissionRequest = request;
            ActivityCompat.requestPermissions(this, needed.toArray(new String[0]), REQ_MEDIA_PERMS);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_MEDIA_PERMS && pendingWebPermissionRequest != null) {
            boolean allGranted = grantResults.length > 0;
            for (int r : grantResults) {
                if (r != PackageManager.PERMISSION_GRANTED) {
                    allGranted = false;
                    break;
                }
            }
            if (allGranted) {
                pendingWebPermissionRequest.grant(pendingWebPermissionRequest.getResources());
            } else {
                pendingWebPermissionRequest.deny();
            }
            pendingWebPermissionRequest = null;
        }
    }
}
`;
  fs.writeFileSync(mainActivityPath, mainActivityCode, 'utf8');
  console.log('[prepare-android] MainActivity.java configurado (edge-to-edge + câmera/microfone WebView) ✓');
}

// 3. Sync dark splash & theme colors
const valuesDir = path.join(appMainDir, 'res', 'values');
fs.mkdirSync(valuesDir, {recursive: true});
const colorsPath = path.join(valuesDir, 'colors.xml');
const colorsXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="colorPrimary">#0c0e0f</color>
    <color name="colorPrimaryDark">#0c0e0f</color>
    <color name="colorAccent">#4cc5b1</color>
    <color name="ic_launcher_background">#0c0e0f</color>
</resources>
`;
fs.writeFileSync(colorsPath, colorsXml, 'utf8');

// 4. Copy ENFapp icons into Android mipmap launcher folders
const iconAny = path.join(rootDir, 'public', 'icon-512.png');
const iconMaskable = path.join(rootDir, 'public', 'icon-maskable-512.png');
const mipmapDensities = ['mipmap-mdpi', 'mipmap-hdpi', 'mipmap-xhdpi', 'mipmap-xxhdpi', 'mipmap-xxxhdpi'];

if (fs.existsSync(iconAny)) {
  for (const density of mipmapDensities) {
    const dir = path.join(appMainDir, 'res', density);
    if (fs.existsSync(dir)) {
      fs.copyFileSync(iconAny, path.join(dir, 'ic_launcher.png'));
      fs.copyFileSync(iconAny, path.join(dir, 'ic_launcher_round.png'));
      if (fs.existsSync(iconMaskable)) {
        fs.copyFileSync(iconMaskable, path.join(dir, 'ic_launcher_foreground.png'));
      }
    }
  }
  console.log('[prepare-android] Ícones do launcher Android atualizados ✓');
}

// 5. Sync versionName in android/app/build.gradle from index.html APP_VERSION
const gradlePath = path.join(androidDir, 'app', 'build.gradle');
const htmlPath = path.join(rootDir, 'index.html');
if (fs.existsSync(gradlePath) && fs.existsSync(htmlPath)) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const verMatch = html.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
  if (verMatch) {
    const ver = verMatch[1];
    const parts = ver.split('.').map((n) => parseInt(n, 10) || 0);
    const code = (parts[0] || 1) * 10000 + (parts[1] || 0) * 100 + (parts[2] || 0);
    let gradle = fs.readFileSync(gradlePath, 'utf8');
    gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${code}`);
    gradle = gradle.replace(/versionName\s+"[^"]+"/, `versionName "${ver}"`);
    fs.writeFileSync(gradlePath, gradle, 'utf8');
    console.log(`[prepare-android] Versão sincronizada no Gradle: ${ver} (versionCode ${code}) ✓`);
  }
}

console.log('[prepare-android] Projeto Android pronto para gerar APK!');
