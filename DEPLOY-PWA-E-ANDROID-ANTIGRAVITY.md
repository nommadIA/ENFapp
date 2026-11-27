# ENFapp — Guia de Deploy PWA (Smartphone + Windows) e APK Android (Antigravity)

O projeto está configurado simultaneamente para **PWA instalável** (Android, iPhone/iPad e Windows Chrome/Edge) e para **geração de APK nativo Android** usando **Capacitor** no **Google Antigravity**.

---

## 1. Deploy PWA (Smartphone Android, iPhone e Windows)

### Opção A — Deploy completo (com servidor Express + IA de áudio/câmera)
1. Configure a variável de ambiente `GEMINI_API_KEY` no provedor (Cloud Run, Render, Railway ou VPS).
2. Comandos:
   ```bash
   npm install
   npm run build:pwa
   npm start
   ```
3. Acesse via **HTTPS** no Chrome/Edge (Windows ou Android) ou Safari (iPhone) e toque em **Instalar** no topo do app.

### Opção B — Deploy estático (Netlify / Vercel)
- **Raiz do repositório**: `netlify.toml` já está configurado com `command = "npm run build:pwa"` e `publish = "dist"`.
- **Pasta `enfapp/`**: `enfapp/netlify.toml` publica `enfapp/public/` já sincronizada automaticamente pelo `npm run build:pwa`.

---

## 2. Gerar APK Android pelo Antigravity

### Pré-requisitos na máquina onde roda o Antigravity
- **Node.js 20+**
- **Java JDK 17 ou 21** (`JAVA_HOME` configurado)
- **Android SDK** (`ANDROID_HOME` configurado, instalado via Android Studio ou `sdkmanager`)

### Passo a passo rápido no terminal do Antigravity

1. Instale as dependências:
   ```bash
   npm install
   ```
2. (Opcional, recomendado para transcrição de áudio e câmera inteligente funcionarem dentro do APK) Crie um arquivo `.env` com a URL pública do seu PWA/servidor:
   ```env
   VITE_API_BASE_URL="https://seu-dominio-enfapp.com"
   ```
3. Gere o APK Android com um único comando:
   - **APK de teste/instalação direta (Debug):**
     ```bash
     npm run android:apk
     ```
     O arquivo pronto será salvo em: `release/ENFapp-debug.apk`
   - **APK de produção (Release):**
     ```bash
     npm run android:apk:release
     ```
     O arquivo pronto será salvo em: `release/ENFapp-release.apk`

### O que o script automático (`android:apk`) faz por você
- Executa `npm run build:pwa` (gera `dist/` e sincroniza `enfapp/public/`).
- Cria a pasta nativa `android/` com Capacitor (`br.com.enfapp.app`) se ainda não existir.
- Configura automaticamente no `AndroidManifest.xml`:
  - Notificações e alarmes exatos (`POST_NOTIFICATIONS`, `SCHEDULE_EXACT_ALARM`, `USE_EXACT_ALARM`, `VIBRATE`, `WAKE_LOCK`, `RECEIVE_BOOT_COMPLETED`)
  - Microfone e câmera (`RECORD_AUDIO`, `CAMERA`, `MODIFY_AUDIO_SETTINGS`)
  - Deep link `enfapp://` para retorno de login Google e checkout Mercado Pago
- Configura o `MainActivity.java` com modo **edge-to-edge** (tela cheia limpa sem sobrepor relógio/bateria) e concessão de permissão de microfone/câmera na WebView.
- Aplica os ícones oficiais do ENFapp (`icon-512.png` e `icon-maskable-512.png`) e sincroniza a versão com o `APP_VERSION` do app.
- Compila o `.apk` via Gradle e copia para `release/`.

### Comandos úteis adicionais
- `npm run android:init` — apenas inicializa e configura a pasta `android/` sem compilar ainda.
- `npm run android:sync` — após editar o app web, atualiza o bundle dentro do projeto Android.
- `npm run pwa:icons` — regenera `apple-touch-icon.png` (180×180) e os ícones maskable (192×192 e 512×512) a partir de `public/icon-512.png`.

### Prompt pronto para colar no Antigravity
> "Abra este projeto ENFapp, instale as dependências com `npm install`, verifique se Java 17+ e Android SDK estão configurados e execute `npm run android:apk` para gerar o arquivo `release/ENFapp-debug.apk`."
