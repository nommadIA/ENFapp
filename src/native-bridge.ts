import {Capacitor} from '@capacitor/core';
import {App as CapApp} from '@capacitor/app';
import {StatusBar, Style} from '@capacitor/status-bar';
import {LocalNotifications} from '@capacitor/local-notifications';

export interface EnfNativeBridge {
  isNative: boolean;
  platform: string;
  apiBase: string;
  apiUrl: (endpoint: string) => string;
  syncStatusBar: (isDark: boolean) => Promise<void>;
  ensureNotificationChannel: () => Promise<void>;
  scheduleNativeAlarm: (opts: {
    id: number;
    title: string;
    body: string;
    atMs: number;
    extra?: Record<string, string>;
  }) => Promise<boolean>;
  cancelNativeAlarms: (ids?: number[]) => Promise<void>;
}

declare global {
  interface Window {
    ENF_NATIVE?: EnfNativeBridge;
    ENF_HANDLE_ANDROID_BACK?: () => boolean;
    ENF_HANDLE_DEEP_LINK?: (url: string) => void;
  }
}

const isNative = Capacitor.isNativePlatform();
const platform = Capacitor.getPlatform();

function resolveApiBase(): string {
  try {
    const stored = (localStorage.getItem('enf_api_base') || '').trim();
    if (stored && /^https?:\/\//i.test(stored)) {
      return stored.replace(/\/+$/, '');
    }
  } catch {}
  const envBase = (import.meta.env?.VITE_API_BASE_URL || '').trim();
  if (envBase && /^https?:\/\//i.test(envBase)) {
    return envBase.replace(/\/+$/, '');
  }
  return '';
}

function apiUrl(endpoint: string): string {
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  const cleanPath = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  if (!isNative) return cleanPath;
  const base = resolveApiBase();
  return base ? `${base}${cleanPath}` : cleanPath;
}

async function syncStatusBar(isDark: boolean): Promise<void> {
  if (!isNative) return;
  try {
    await StatusBar.setOverlaysWebView({overlay: true});
    await StatusBar.setStyle({style: isDark ? Style.Dark : Style.Light});
    if (platform === 'android') {
      await StatusBar.setBackgroundColor({color: isDark ? '#0c0e0f' : '#f4f7f8'});
    }
  } catch {}
}

let channelReady = false;
async function ensureNotificationChannel(): Promise<void> {
  if (!isNative || channelReady) return;
  try {
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') {
      await LocalNotifications.requestPermissions();
    }
    if (platform === 'android') {
      await LocalNotifications.createChannel({
        id: 'enfapp_alarms',
        name: 'Alarmes e Plantões ENFapp',
        description: 'Alarmes de medicamentos, plantões e vencimentos em alta prioridade.',
        importance: 5,
        visibility: 1,
        vibration: true,
        lights: true,
        lightColor: '#4cc5b1',
      });
    }
    channelReady = true;
  } catch {}
}

async function scheduleNativeAlarm(opts: {
  id: number;
  title: string;
  body: string;
  atMs: number;
  extra?: Record<string, string>;
}): Promise<boolean> {
  if (!isNative) return false;
  try {
    await ensureNotificationChannel();
    const fireAt = Math.max(Date.now() + 1500, opts.atMs);
    await LocalNotifications.schedule({
      notifications: [
        {
          id: Math.abs(opts.id | 0) || Math.floor(Math.random() * 1000000),
          title: opts.title,
          body: opts.body,
          schedule: {at: new Date(fireAt), allowWhileIdle: true},
          channelId: 'enfapp_alarms',
          extra: opts.extra || {},
        },
      ],
    });
    return true;
  } catch {
    return false;
  }
}

async function cancelNativeAlarms(ids?: number[]): Promise<void> {
  if (!isNative) return;
  try {
    if (Array.isArray(ids) && ids.length) {
      await LocalNotifications.cancel({notifications: ids.map((id) => ({id}))});
      return;
    }
    const pending = await LocalNotifications.getPending();
    if (pending.notifications?.length) {
      await LocalNotifications.cancel({
        notifications: pending.notifications.map((n) => ({id: n.id})),
      });
    }
  } catch {}
}

const bridge: EnfNativeBridge = {
  isNative,
  platform,
  get apiBase() {
    return resolveApiBase();
  },
  apiUrl,
  syncStatusBar,
  ensureNotificationChannel,
  scheduleNativeAlarm,
  cancelNativeAlarms,
};

window.ENF_NATIVE = bridge;

if (isNative) {
  document.documentElement.classList.add('is-app-fs', 'is-native-apk');
  if (platform === 'android') {
    document.documentElement.classList.add('is-android-apk');
  }

  // Initial status bar & high-priority alarm channel setup
  const prefersDark =
    document.documentElement.getAttribute('data-theme') !== 'light' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  void syncStatusBar(prefersDark);
  void ensureNotificationChannel();

  // Hardware Android Back Button handling
  CapApp.addListener('backButton', ({canGoBack}) => {
    try {
      if (typeof window.ENF_HANDLE_ANDROID_BACK === 'function') {
        const handled = window.ENF_HANDLE_ANDROID_BACK();
        if (handled) return;
      }
    } catch {}
    if (canGoBack && window.history.length > 1) {
      window.history.back();
    } else {
      CapApp.exitApp();
    }
  }).catch(() => {});

  // Deep link handler (enfapp://auth/callback, enfapp://checkout-return)
  CapApp.addListener('appUrlOpen', ({url}) => {
    if (!url) return;
    try {
      if (typeof window.ENF_HANDLE_DEEP_LINK === 'function') {
        window.ENF_HANDLE_DEEP_LINK(url);
      }
    } catch {}
  }).catch(() => {});
}
