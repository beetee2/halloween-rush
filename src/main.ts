import { AudioEngine } from './audio/audio';
import { CONFIG } from './config';
import { SaveStore, browserStorage } from './core/persistence';
import { Game } from './game';
import { describeDevice } from './net/device';
import { ScoreSync } from './net/scoreSync';
import { UI } from './ui/ui';

/** A throwaway WebGL context: proves 3D works and tells the device fingerprint which GPU this is. */
function probeWebGL(): WebGLRenderingContext | WebGL2RenderingContext | null {
  try {
    const c = document.createElement('canvas');
    return c.getContext('webgl2') ?? c.getContext('webgl');
  } catch {
    return null;
  }
}

function safeStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return browserStorage();
  } catch {
    return null;
  }
}

function isTouchDevice(): boolean {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return coarse || (navigator.maxTouchPoints > 0 && !(typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches));
}

async function main(): Promise<void> {
  const ui = new UI();
  const tips = [
    'Make sure hardware acceleration / graphics acceleration is turned on in your browser settings.',
    'Update your browser, or try a current Chrome, Edge, Firefox or Safari.',
    'On older phones, close other apps and reload.',
  ];
  const probe = probeWebGL();
  if (!probe) {
    ui.showError('Halloween Rush needs 3D graphics (WebGL), which this browser could not start.', tips);
    return;
  }
  const storage = safeStorage();
  const device = describeDevice(storage, probe);
  probe.getExtension('WEBGL_lose_context')?.loseContext();
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const e2e = import.meta.env.MODE === 'e2e';
  const seedParam = e2e ? Number(new URLSearchParams(location.search).get('seed')) : NaN;
  let game: Game;
  try {
    game = new Game({
      canvas,
      ui,
      audio: new AudioEngine(),
      store: new SaveStore(() => storage, CONFIG.storageKey),
      scores: new ScoreSync(device, storage),
      touchDevice: isTouchDevice(),
      seed: Number.isFinite(seedParam) && seedParam > 0 ? seedParam : undefined,
    });
  } catch (err) {
    console.error(err);
    ui.showError('Halloween Rush could not start its 3D view.', tips);
    return;
  }
  game.start();
  if (e2e) {
    const { installTestHooks } = await import('./testHooks');
    installTestHooks(game);
  }
}

void main();
