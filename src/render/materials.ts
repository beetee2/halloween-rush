import * as THREE from 'three';
import { blobShadowTexture, ringTexture, softDotTexture } from './textures';

/**
 * Shared materials live for the whole session. Everything that can use vertex colors
 * does, so characters, candy and props share a handful of materials.
 */
export interface SharedMaterials {
  /** Lit, vertex-colored: characters, candy, props. */
  lit: THREE.MeshLambertMaterial;
  /** Lit, vertex-colored, faceted: environment props for a low-poly look. */
  litFlat: THREE.MeshLambertMaterial;
  /** Unlit vertex-colored "glow": windows, jack-o'-lantern faces, lights. */
  glow: THREE.MeshBasicMaterial;
  /** White flash for a target that was just hit. */
  hitFlash: THREE.MeshBasicMaterial;
  /** Red-orange glow pulse used while a spider prepares a throw. */
  spiderGlow: THREE.SpriteMaterial;
  web: THREE.LineBasicMaterial;
  shadow: THREE.MeshBasicMaterial;
  warnRing: THREE.SpriteMaterial;
  halo: THREE.SpriteMaterial;
  particle: THREE.MeshLambertMaterial;
}

let shared: SharedMaterials | null = null;

export function materials(): SharedMaterials {
  if (shared) return shared;
  shared = {
    lit: new THREE.MeshLambertMaterial({ vertexColors: true }),
    litFlat: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
    hitFlash: new THREE.MeshBasicMaterial({ color: 0xfff6d8 }),
    spiderGlow: new THREE.SpriteMaterial({ map: softDotTexture(), color: 0xff4a12, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    web: new THREE.LineBasicMaterial({ color: 0xf2f2ff, transparent: true, opacity: 0.75 }),
    shadow: new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, depthWrite: false }),
    warnRing: new THREE.SpriteMaterial({ map: ringTexture(), color: 0xff3b2f, transparent: true, depthTest: false, depthWrite: false }),
    halo: new THREE.SpriteMaterial({ map: softDotTexture(), color: 0xfff1b0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    particle: new THREE.MeshLambertMaterial({ color: 0xffffff }),
  };
  return shared;
}
