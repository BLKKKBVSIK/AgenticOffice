import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mesh, toon } from '../toon';
import type { WorkerRig } from './rig';

// S.T.E.L.L.A's own look (see STATION_LOOKS in core/stations.ts): long dark-brown curls parted in the
// middle and falling past the shoulders, thick dark brows, brown eyes, a charcoal long-sleeved top and
// a little silver star on a chain. Her skin is the agent's color (STATION_AGENT in shared/layout.ts).

const HAIR = '#3a2417';
const TOP = '#2b2b30';
const SILVER = '#d9dde3';

/** The bean's head: the middle of its top hemisphere, and its radius (see the Worker's body capsule). */
const HEAD = { y: 0.7, r: 0.28 };

/** A small repeatable wobble, so every copy of her has the same curls. */
function jitter(seed: number): number {
  const s = Math.sin(seed * 12.9898) * 43758.5453;
  return s - Math.floor(s) - 0.5;
}

/**
 * The curls: little balls over the crown, and down the back and the sides to below the shoulders,
 * leaving the face clear. Merged into one mesh.
 */
function curls(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  let n = 0;
  const ball = (x: number, y: number, z: number, r: number) => {
    n++;
    parts.push(new THREE.SphereGeometry(r * (1 + jitter(n) * 0.3), 8, 6).translate(x + jitter(n + 0.1) * 0.02, y + jitter(n + 0.2) * 0.02, z + jitter(n + 0.3) * 0.02));
  };
  // The crown: rings of the hemisphere from the top down to just over the eyebrows.
  for (let el = Math.PI / 2; el > 0.5; el -= 0.22) {
    const ring = Math.max(1, Math.round(16 * Math.cos(el)));
    for (let i = 0; i < ring; i++) {
      const a = (i / ring) * Math.PI * 2 + el;
      const r = HEAD.r + 0.03;
      ball(Math.sin(a) * Math.cos(el) * r, HEAD.y + Math.sin(el) * r, Math.cos(a) * Math.cos(el) * r, 0.075);
    }
  }
  // Falling down the back and the sides, all round but the face (within ~60° of the front).
  for (let y = HEAD.y + 0.12; y > 0.3; y -= 0.07) {
    const out = HEAD.r + 0.04 + (HEAD.y - y) * 0.12;
    for (let a = Math.PI / 3; a <= (Math.PI * 5) / 3 + 0.01; a += Math.PI / 11) ball(Math.sin(a) * out, y, Math.cos(a) * out, 0.07);
  }
  const geo = mergeGeometries(parts)!;
  for (const p of parts) p.dispose();
  return geo;
}

/** Her top: a sleeve of the bean's lower half, from under the neck to its bottom. */
function top(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let y = 0.11; y <= 0.4; y += 0.03) pts.push(new THREE.Vector2(Math.sqrt(Math.max(0, 0.28 ** 2 - (0.4 - y) ** 2)) + 0.012, y));
  pts.push(new THREE.Vector2(0.292, 0.5), new THREE.Vector2(0.29, 0.51));
  return new THREE.LatheGeometry(pts, 24);
}

/** A five-pointed star, flat, facing +z. */
function star(r: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const k = i % 2 ? r * 0.45 : r;
    if (i) s.lineTo(Math.sin(a) * k, Math.cos(a) * k);
    else s.moveTo(0, k);
  }
  return new THREE.ShapeGeometry(s);
}

/** Dresses a Worker as S.T.E.L.L.A. */
export function lookLikeStella(rig: WorkerRig) {
  const hair = toon(HAIR);
  rig.body.add(mesh(curls(), hair));
  rig.body.add(mesh(top(), toon(TOP)));
  // Long sleeves.
  for (const arm of [rig.armL, rig.armR]) {
    const sleeve = arm.children[0] as THREE.Mesh | undefined;
    if (sleeve) sleeve.material = toon(TOP);
  }
  // Brown eyes, and thick dark brows over them.
  for (const p of rig.pupils) p.material = toon('#5b3a21');
  for (const sx of [-1, 1]) {
    const brow = mesh(new THREE.BoxGeometry(0.11, 0.024, 0.03), hair, sx * 0.11, 0.815, 0.25, false);
    brow.rotation.z = sx * -0.12;
    rig.body.add(brow);
  }
  // A thin silver chain round the neckline, with a star on it.
  const chain = mesh(new THREE.TorusGeometry(0.16, 0.006, 4, 24, Math.PI * 0.8), toon(SILVER), 0, 0.5, 0.18, false);
  chain.rotation.set(Math.PI / 2 - 0.5, 0, Math.PI * 1.1);
  rig.body.add(chain);
  rig.body.add(mesh(star(0.03), toon(SILVER, { emissive: '#555b66' }), 0, 0.43, 0.3, false));
}
