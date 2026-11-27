import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {GoogleGenAI, ThinkingLevel, Type} from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isProd = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT || 3000);

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Chave do serviço de reconhecimento não configurada no servidor.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({limit: '12mb'}));

  // CORS para chamadas /api/* vindas do APK Android (Capacitor https://localhost) ou PWA
  app.use('/api', (req, res, next) => {
    const origin = String(req.headers.origin || '');
    const allowedOrigin =
      /^https?:\/\/localhost(?::\d+)?$/i.test(origin) ||
      /^capacitor:\/\/localhost$/i.test(origin) ||
      /^ionic:\/\/localhost$/i.test(origin);
    if (allowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // Headers obrigatórios de PWA e Android App Links (Windows, Android, iOS)
  app.use((req, res, next) => {
    if (req.path === '/manifest.webmanifest') {
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    } else if (req.path === '/sw.js') {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Service-Worker-Allowed', '/');
    } else if (req.path === '/.well-known/assetlinks.json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    next();
  });

  const brandFile = path.resolve(__dirname, 'brand-logos.json');
  app.get('/api/brand-logos', (_req, res) => {
    try {
      if (fs.existsSync(brandFile)) {
        const d = JSON.parse(fs.readFileSync(brandFile, 'utf-8'));
        res.json({
          appDark: typeof d.appDark === 'string' ? d.appDark : (typeof d.appSvg === 'string' ? d.appSvg : ''),
          appDarkWide: d.appDark ? !!d.appDarkWide : !!d.appWide,
          appLight: typeof d.appLight === 'string' ? d.appLight : '',
          appLightWide: !!d.appLightWide,
          devDark: typeof d.devDark === 'string' ? d.devDark : (typeof d.devSvg === 'string' ? d.devSvg : ''),
          devLight: typeof d.devLight === 'string' ? d.devLight : '',
        });
        return;
      }
    } catch {}
    res.json({appDark: '', appDarkWide: false, appLight: '', appLightWide: false, devDark: '', devLight: ''});
  });

  app.post('/api/brand-logos', (req, res) => {
    try {
      const b = req.body || {};
      const clip = (v: unknown) => (typeof v === 'string' ? v.slice(0, 800_000) : '');
      const payload = {
        appDark: clip(b.appDark || b.appSvg),
        appDarkWide: !!(b.appDark ? b.appDarkWide : b.appWide),
        appLight: clip(b.appLight),
        appLightWide: !!b.appLightWide,
        devDark: clip(b.devDark || b.devSvg),
        devLight: clip(b.devLight),
      };
      fs.writeFileSync(brandFile, JSON.stringify(payload), 'utf-8');
      res.json({ok: true});
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao salvar logos.';
      res.status(500).json({error: msg});
    }
  });

  // API: Câmera Inteligente do Mercado — analisa foto do produto / etiqueta de preço
  app.post('/api/scan-product', async (req, res) => {
    try {
      const {imageBase64, mimeType} = req.body || {};
      if (!imageBase64 || typeof imageBase64 !== 'string') {
        res.status(400).json({error: 'Imagem do produto não recebida.'});
        return;
      }

      const cleanBase64 = imageBase64.replace(/^data:[^,]+,/i, '').replace(/\s+/g, '').trim();
      const safeMime =
        typeof mimeType === 'string' && mimeType.startsWith('image/')
          ? mimeType.split(';')[0].trim().toLowerCase()
          : 'image/jpeg';

      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: safeMime,
                data: cleanBase64,
              },
            },
            {
              text:
                'Analise esta imagem de um produto de supermercado, farmácia ou etiqueta de preço de gôndola no Brasil. ' +
                'Extraia: 1) nome completo e conciso do produto em português (incluindo marca e peso/volume se visíveis, ex.: "Arroz Branco Tio João 5kg" ou "Leite Integral Italac 1L"); ' +
                '2) preço unitário em reais (número decimal, ex.: 24.90) SOMENTE se houver um preço claramente legível na embalagem, etiqueta ou nota; caso contrário retorne null; ' +
                '3) quantidade (inteiro >= 1, padrão 1, ou número de unidades se houver vários itens idênticos ou pack explícito); ' +
                '4) resumo curto (detalhes como marca, peso ou observação útil em até 80 caracteres).',
            },
          ],
        },
        config: {
          thinkingConfig: {thinkingLevel: ThinkingLevel.LOW},
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              nome: {
                type: Type.STRING,
                description: 'Nome do produto em português com marca e peso/volume se visíveis.',
              },
              preco: {
                type: Type.NUMBER,
                nullable: true,
                description: 'Preço unitário em BRL se legível na foto, ou null.',
              },
              quantidade: {
                type: Type.INTEGER,
                description: 'Quantidade detectada, padrão 1.',
              },
              detalhes: {
                type: Type.STRING,
                description: 'Breve detalhe ou marca/peso identificado.',
              },
            },
            required: ['nome', 'quantidade'],
          },
        },
      });

      const rawText = (response.text || '{}').trim();
      let parsed: {
        nome?: string;
        preco?: number | null;
        quantidade?: number;
        detalhes?: string;
      } = {};
      try {
        parsed = JSON.parse(rawText);
      } catch {
        const match = rawText.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]);
      }

      const nome = String(parsed.nome || '').trim();
      const preco =
        typeof parsed.preco === 'number' && Number.isFinite(parsed.preco) && parsed.preco >= 0
          ? Number(parsed.preco.toFixed(2))
          : null;
      const quantidade =
        typeof parsed.quantidade === 'number' && parsed.quantidade >= 1
          ? Math.round(parsed.quantidade)
          : 1;
      const detalhes = String(parsed.detalhes || '').trim();

      if (!nome) {
        res.status(422).json({
          error: 'Não foi possível identificar o produto nesta foto. Tente aproximar a embalagem ou etiqueta com boa luz.',
        });
        return;
      }

      res.json({nome, preco, quantidade, detalhes});
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Erro ao analisar a imagem do produto.';
      console.error('[scan-product]', msg);
      res.status(500).json({error: 'Não foi possível analisar a imagem do produto agora. Tente novamente.'});
    }
  });

  // API: Transcrição Inteligente de Áudio para Evolução/Anotação de Enfermagem (PT-BR)
  app.post('/api/transcribe-audio', async (req, res) => {
    try {
      const {audioBase64, mimeType, context} = req.body || {};
      if (!audioBase64 || typeof audioBase64 !== 'string') {
        res.status(400).json({error: 'Áudio não recebido para transcrição.'});
        return;
      }

      // Remove qualquer prefixo data URL (inclusive com parâmetros como ";codecs=opus;base64,")
      const cleanBase64 = audioBase64
        .replace(/^data:[^,]+,/i, '')
        .replace(/\s+/g, '')
        .trim();

      if (!cleanBase64 || cleanBase64.length < 64) {
        res.status(400).json({error: 'Áudio muito curto. Fale um pouco mais perto do microfone.'});
        return;
      }

      if (!/^[A-Za-z0-9+/=_-]+$/.test(cleanBase64)) {
        res.status(400).json({error: 'Formato de áudio inválido. Tente gravar novamente.'});
        return;
      }

      const dataMimeMatch = /^data:([^;,]+)/i.exec(audioBase64);
      const rawMime = (
        typeof mimeType === 'string' && mimeType.trim()
          ? mimeType
          : dataMimeMatch?.[1] || ''
      )
        .split(';')[0]
        .trim()
        .toLowerCase();

      const allowedMimes = new Set([
        'audio/webm',
        'audio/mp4',
        'audio/m4a',
        'audio/x-m4a',
        'audio/mpeg',
        'audio/mp3',
        'audio/ogg',
        'audio/wav',
        'audio/aac',
        'audio/flac',
      ]);
      const safeMime = allowedMimes.has(rawMime)
        ? rawMime === 'audio/x-m4a' || rawMime === 'audio/m4a'
          ? 'audio/mp4'
          : rawMime === 'audio/mp3'
            ? 'audio/mpeg'
            : rawMime
        : 'audio/webm';

      const ctxHint =
        typeof context === 'string' && context.trim()
          ? ` Contexto: ${context.trim().slice(0, 120)}.`
          : '';

      const promptText =
        'Transcreva integralmente este áudio falado em português do Brasil (pt-BR) por um profissional de enfermagem.' +
        ctxHint +
        ' Aplique rigorosamente a norma ortográfica brasileira vigente, com todos os acentos gráficos, cedilha, crase, pontuação natural (vírgulas, pontos finais, dois-pontos e parágrafos quando apropriado) e grafia correta de termos clínicos e de enfermagem (ex.: PA, FC, FR, SpO2, Tax, HGT, glicemia, decúbito, curativo, administração, medicação, diurese, evacuação, paciente orientado, eupneico, afebril).' +
        ' Não invente informações que não foram ditas. Se não houver fala audível, retorne uma string vazia.' +
        ' Retorne APENAS o texto final transcrito, sem títulos, sem aspas, sem prefixos e sem comentários.';

      const ai = getAiClient();
      const parts = [
        {
          inlineData: {
            mimeType: safeMime,
            data: cleanBase64,
          },
        },
        {text: promptText},
      ];

      let response;
      try {
        response = await ai.models.generateContent({
          model: 'gemini-3.5-transcribe',
          contents: {parts},
        });
      } catch (primaryErr) {
        console.warn('[transcribe-audio] fallback to gemini-4-hydrogen:', primaryErr instanceof Error ? primaryErr.message : primaryErr);
        response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: {parts},
        });
      }

      const text = String(response.text || '')
        .replace(/^["“”'\s]+|["“”'\s]+$/g, '')
        .trim();

      if (!text) {
        res.status(422).json({
          error: 'Não foi possível identificar fala no áudio. Tente falar um pouco mais próximo do microfone.',
        });
        return;
      }

      res.json({text});
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Erro ao transcrever o áudio.';
      console.error('[transcribe-audio]', msg);
      res.status(500).json({
        error: 'Não foi possível transcrever o áudio agora. Verifique sua conexão e tente gravar novamente.',
      });
    }
  });

  // OAuth callback route (works in both dev and production)
  app.get(['/auth/callback', '/auth/callback/'], (_req, res) => {
    const candidates = [
      path.resolve(__dirname, 'dist/auth/callback/index.html'),
      path.resolve(__dirname, 'public/auth/callback/index.html'),
    ];
    for (const file of candidates) {
      if (fs.existsSync(file)) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.send(fs.readFileSync(file, 'utf-8'));
        return;
      }
    }
    res.status(404).send('Callback não encontrado.');
  });

  // Disable HMR client script to prevent WebSocket errors behind proxy
  app.get('/@vite/client', (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.send('/* HMR disabled */\n');
  });

  if (!isProd) {
    const {createServer: createViteServer} = await import('vite');
    const vite = await createViteServer({
      server: {middlewareMode: true, hmr: false},
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ENFapp server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
