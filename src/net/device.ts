/**
 * Who is playing, as far as the household scores database is concerned.
 *
 * - `id`: a random id kept in this browser's storage. It is the real identity: a fingerprint
 *   alone can't tell two identical phones apart.
 * - `fingerprint`: a hash of browser, screen, GPU and locale traits, stored alongside so the
 *   same hardware can be spotted (e.g. an iPhone's Safari and its Home Screen app, which keep
 *   separate storage and so get separate ids).
 * - `label`: a readable name such as "iPhone · Safari".
 */
export interface DeviceInfo {
  id: string;
  fingerprint: string;
  label: string;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const ID_KEY = 'halloween-rush:device';
const ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

/** Random v4-style id. crypto.randomUUID needs HTTPS, which a LAN http:// address isn't. */
export function newId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** This browser's device id, created on first use. Without storage it lasts for this page only. */
export function deviceId(storage: StorageLike | null): string {
  try {
    const saved = storage?.getItem(ID_KEY);
    if (saved && ID_PATTERN.test(saved)) return saved;
  } catch {
    /* blocked storage: fall through to a session-only id */
  }
  const id = newId();
  try {
    storage?.setItem(ID_KEY, id);
  } catch {
    /* ignore */
  }
  return id;
}

/** 53-bit string hash (cyrb53) as base-36. crypto.subtle is also HTTPS-only. */
export function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function gpu(gl: WebGLRenderingContext | WebGL2RenderingContext | null): string {
  if (!gl) return '';
  try {
    const renderer = String(gl.getParameter(gl.RENDERER));
    // Chrome hides the real GPU behind "WebKit WebGL"; Firefox already reports it (and warns
    // if the old extension is used), so only ask the extension when needed.
    if (!/webkit webgl/i.test(renderer)) return `${gl.getParameter(gl.VENDOR)}/${renderer}`;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? `${gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)}/${gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)}` : renderer;
  } catch {
    return '';
  }
}

export function fingerprint(gl: WebGLRenderingContext | WebGL2RenderingContext | null): string {
  const n = navigator;
  const s = typeof screen === 'undefined' ? { width: 0, height: 0, colorDepth: 0 } : screen;
  let zone = '';
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    /* ignore */
  }
  return hash(
    [
      n.userAgent,
      n.language,
      (n.languages ?? []).join(','),
      n.hardwareConcurrency,
      n.maxTouchPoints,
      (n as Navigator & { deviceMemory?: number }).deviceMemory ?? '',
      // Sorted so turning the phone doesn't change it.
      Math.min(s.width, s.height),
      Math.max(s.width, s.height),
      s.colorDepth,
      typeof devicePixelRatio === 'number' ? devicePixelRatio : 1,
      zone,
      gpu(gl),
    ].join('|'),
  );
}

// First match wins, so the order matters (Android UAs also say Linux, Chrome's say Safari...).
const SYSTEMS: Array<[RegExp, string]> = [
  [/iPhone|iPod/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android/, 'Android'],
  [/CrOS/, 'Chromebook'],
  [/Windows/, 'Windows'],
  [/Macintosh/, 'Mac'],
  [/Linux/, 'Linux'],
];
const BROWSERS: Array<[RegExp, string]> = [
  [/EdgiOS|Edg\//, 'Edge'],
  [/SamsungBrowser/, 'Samsung Internet'],
  [/OPR\/|OPiOS/, 'Opera'],
  [/FxiOS|Firefox\//, 'Firefox'],
  [/CriOS|Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];
const pick = (ua: string, list: Array<[RegExp, string]>, fallback: string) => list.find(([re]) => re.test(ua))?.[1] ?? fallback;

/** "iPhone · Safari", "Windows · Chrome", "iPad · Home Screen"... */
export function deviceLabel(ua: string, touchPoints: number, homeScreen: boolean): string {
  // iPadOS Safari introduces itself as a Mac; touch support gives it away.
  const system = /Macintosh/.test(ua) && touchPoints > 1 ? 'iPad' : pick(ua, SYSTEMS, 'Device');
  return `${system} · ${homeScreen ? 'Home Screen' : pick(ua, BROWSERS, 'Browser')}`;
}

/** Opened from a Home Screen icon rather than a browser tab. */
export function launchedFromHomeScreen(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const media = typeof matchMedia === 'function' && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches);
  return iosStandalone || media;
}

export function describeDevice(storage: StorageLike | null, gl: WebGLRenderingContext | WebGL2RenderingContext | null): DeviceInfo {
  return {
    id: deviceId(storage),
    fingerprint: fingerprint(gl),
    label: deviceLabel(navigator.userAgent, navigator.maxTouchPoints ?? 0, launchedFromHomeScreen()),
  };
}
