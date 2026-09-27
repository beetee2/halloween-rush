import * as THREE from 'three';
import { CONFIG } from '../config';

export interface StageOptions {
  touchDevice: boolean;
}

/**
 * Renderer, scene and first-person camera. The camera never moves; only yaw/pitch
 * change. Objects parented to `hud3d` (launcher, candy bag) stay fixed in view.
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /** Camera-space group for the launcher and candy bag. */
  readonly hud3d = new THREE.Group();
  yaw = 0;
  pitch = 0;
  private readonly maxPixelRatio: number;
  private width = 1;
  private height = 1;
  /** Called after every resize with the visible half-extents at 1 m in front of the camera. */
  onResize: ((halfW: number, halfH: number, aspect: number) => void) | null = null;

  constructor(
    readonly canvas: HTMLCanvasElement,
    opts: StageOptions,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !opts.touchDevice,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.maxPixelRatio = opts.touchDevice ? CONFIG.render.maxPixelRatioTouch : CONFIG.render.maxPixelRatioDesktop;

    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fovDeg, 16 / 9, 0.05, 260);
    this.camera.position.set(...CONFIG.camera.position);
    this.camera.rotation.order = 'YXZ';
    this.camera.add(this.hud3d);
    this.scene.add(this.camera);
    this.resize();
  }

  /** Match the canvas to its CSS size. `force` re-runs layout callbacks even if unchanged. */
  resize(force = false): void {
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    const pr = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio);
    if (!force && w === this.width && h === this.height && this.renderer.getPixelRatio() === pr) return;
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    // Keep a usable horizontal field of view on narrow windows.
    const minH = THREE.MathUtils.degToRad(CONFIG.camera.minHorizontalFovDeg);
    const vFromH = 2 * Math.atan(Math.tan(minH / 2) / aspect);
    this.camera.fov = Math.max(CONFIG.camera.fovDeg, THREE.MathUtils.radToDeg(vFromH));
    this.camera.updateProjectionMatrix();
    const halfH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.onResize?.(halfH * aspect, halfH, aspect);
  }

  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  applyAim(): void {
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.updateMatrixWorld(true);
  }

  /** World position → CSS pixel position (null when behind the camera). */
  project(world: THREE.Vector3, out: { x: number; y: number }): boolean {
    tmp.copy(world).project(this.camera);
    if (tmp.z > 1) return false;
    out.x = (tmp.x * 0.5 + 0.5) * this.width;
    out.y = (-tmp.y * 0.5 + 0.5) * this.height;
    return true;
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}

const tmp = new THREE.Vector3();
