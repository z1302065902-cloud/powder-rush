import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createSeededRandom, randInt, randRange } from '../core/rng';

/** Slope: groundY(z) = z * SLOPE_K (descent toward -Z). */
export const SLOPE_K = 0.08;
export const SLOPE_ANGLE = Math.atan(SLOPE_K);
export const TRACK_LIMIT = 13.5;

const CHUNK_Z = 26;          // meters per generation chunk
const VIEW_CHUNKS = 26;      // chunks generated ahead
const LANES = [-5.5, 0, 5.5];
const GATE_EVERY = 3;        // every N chunks a gate row (3*26 = 78 m apart)
                             // 5 previously meant one gate per 130 m; at 30 m/s that is
                             // 4.3 s between gates, which exceeded the combo window —
                             // so combos could never trigger.

/** Metres of guaranteed-clear snow in front of the spawn (z = 0). */
const RUNWAY_Z = 40;

/** Difficulty ramps with distance: 0=easy, 1=hard. */
export function difficultyForDistance(distM: number): number {
  if (distM < 200) return distM / 200;          // 0→1 across 0-200m (easy phase)
  if (distM < 800) return 1 + (distM - 200) / 600; // 1→2 across 200-800m (normal→hard)
  return 2 + Math.min(1, (distM - 800) / 1000); // 2→3 for >800m (extreme)
}

/** Returns probability of 0 occupied lanes given difficulty d ∈ [0,3]. */
function zeroLaneChance(d: number): number {
  // d=0: 40% of chunks empty (new-player protection)
  // d=3: 5% empty
  // The old curve started at 12%, so ~88% of the very first chunks already had
  // trees — the "easy" phase was not actually forgiving for a new player.
  return Math.max(0.05, 0.4 - d * 0.125);
}
/** Returns threshold where nLanes==1 (below = 1 lane, above = 2 lanes). */
function oneLaneThreshold(d: number): number {
  // Two-lane chunks are the expensive ones to dodge, so they ramp later and slower:
  // d=0 → 14% of chunks, d=1 → 27%, d=2 → 40%, d=3 → 53%.
  return Math.max(0.47, 0.86 - d * 0.13);
}

export type ObstacleKind = 'tree' | 'rock';

interface Chunk {
  obstacles: { group: THREE.Group; body: RAPIER.RigidBody; collider: RAPIER.Collider }[];
  scenery: THREE.Group[];
  gates: { group: THREE.Group; x: number; y: number; z: number; collected: boolean }[];
}

interface Burst {
  points: THREE.Points;
  vel: Float32Array;
  t: number;
  life: number;
  basePos: THREE.Vector3;
}

export class World {
  /** Map colliderHandle -> 'obstacle' for collision events. */
  readonly collisionKind = new Map<number, string>();
  /** Live gates across active chunks (for pass-through scoring). */
  readonly gates: { group: THREE.Group; x: number; y: number; z: number; collected: boolean }[] = [];
  /** Number of gate flashes triggered this run, for QA. */
  gateFlashCount = 0;

  /** Number of landing snow-dust bursts spawned this run, for QA. */
  landBurstCount = 0;

  /** Live particle bursts, for QA (Task 7). */
  get liveBursts(): { count: number; particles: number } {
    let particles = 0;
    for (const b of this.bursts) particles += b.points.geometry.getAttribute('position').count;
    return { count: this.bursts.length, particles };
  }

  /** Live chunk indices, for QA density telemetry. */
  get liveChunkIndices(): number[] {
    return [...this.chunks.keys()];
  }

  /** Live (non-disposed) obstacles, for QA autopilot + telemetry. Derived from the
   *  chunks that currently exist, so it can never go stale. */
  get liveObstacles(): { x: number; z: number }[] {
    const out: { x: number; z: number }[] = [];
    for (const c of this.chunks.values()) {
      for (const o of c.obstacles) {
        const t = o.body.translation();
        out.push({ x: t.x, z: t.z });
      }
    }
    return out;
  }
  readonly ground: THREE.Mesh;

  private chunks = new Map<number, Chunk>();
  private firstIndex = 0;
  private furthestIndex = -1;
  private seed = 12345;
  private snowTex: THREE.Texture;
  private bursts: Burst[] = [];

  constructor(
    private scene: THREE.Scene,
    private physics: RAPIER.World,
  ) {
    this.snowTex = this.makeSnowTexture();

    // Ground visual: one large mesh exactly on the slope (y = z*k).
    const gw = 140;
    const gz = 12000;
    const segZ = 200;
    const cols = 2;
    const rows = gz / segZ;
    const geo = new THREE.BufferGeometry();
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let r = 0; r <= rows; r++) {
      const z = -r * segZ;
      for (let c = 0; c <= cols; c++) {
        const x = -gw / 2 + c * gw;
        pos.push(x, z * SLOPE_K, z);
        uv.push(x / 6, -z / 6);
      }
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const a = r * (cols + 1) + c;
        const b = a + 1;
        const d = a + (cols + 1);
        const e = d + 1;
        idx.push(a, b, d, b, e, d); // front faces must point UP (+y) toward the camera
      }
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      map: this.snowTex,
      roughness: 0.95,
      metalness: 0,
      color: 0xffffff,
    });
    this.ground = new THREE.Mesh(geo, mat);
    this.ground.receiveShadow = true;
    // The ground is one huge mesh (140 x 12000 m): its bounding sphere radius
    // (~6 km) exceeds the camera far plane (1500), so THREE's per-mesh frustum
    // culling removes the WHOLE mesh and the snow becomes invisible (a classic
    // bug — the skier appeared to float over a blue void). Draw it unconditionally.
    this.ground.frustumCulled = false;
    scene.add(this.ground);

    // Ground physics: static triangle mesh from the same vertices (exact slope match).
    const v = new Float32Array(pos);
    const i = new Uint32Array(idx);
    physics.createCollider(
      RAPIER.ColliderDesc.trimesh(v, i).setFriction(0.2),
    );
  }

  private makeSnowTexture(): THREE.Texture {
    const s = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = s;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#f4faff';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 900; i++) {
      const v = 210 + Math.floor(Math.random() * 40);
      ctx.fillStyle = `rgb(${v},${v + 4},255)`;
      const x = Math.random() * s;
      const y = Math.random() * s;
      ctx.fillRect(x, y, 1.2, 1.2);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(48, 48);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  reseed(seed: number): void {
    this.seed = seed >>> 0;
    this.clearChunks();
    this.ensureAhead(0);
  }

  private clearChunks(): void {
    for (const chunk of this.chunks.values()) this.disposeChunk(chunk);
    this.chunks.clear();
    this.gates.length = 0;
    this.firstIndex = 0;
    this.furthestIndex = -1;
  }

  private chunkStartZ(i: number): number {
    return -i * CHUNK_Z;
  }

  /** Spawn chunks ahead of player; recycle chunks far behind. */
  ensureAhead(playerZ: number): void {
    const viewDist = VIEW_CHUNKS * CHUNK_Z;
    // Keep spawning while the farthest chunk's far edge hasn't reached viewDist ahead.
    let guard = 0;
    while (guard++ < 400) {
      const i = this.furthestIndex;
      const farEdge = -(i + 1) * CHUNK_Z; // most -Z extent of chunk i
      if (farEdge - playerZ > -viewDist) {
        this.furthestIndex++;
        this.spawnChunk(this.furthestIndex);
      } else {
        break;
      }
    }
    // Recycle chunks fully behind the player (near edge more than one chunk back).
    while (this.chunks.has(this.firstIndex) && -this.firstIndex * CHUNK_Z - playerZ > CHUNK_Z + 8) {
      this.disposeChunk(this.chunks.get(this.firstIndex)!);
      this.chunks.delete(this.firstIndex);
      this.firstIndex++;
    }
  }

  private spawnChunk(i: number): void {
    const rng = createSeededRandom((this.seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0);
    const zCenter = this.chunkStartZ(i) - CHUNK_Z / 2;
    const gy = zCenter * SLOPE_K;
    const chunk: Chunk = { obstacles: [], scenery: [], gates: [] };

    // Gate row?
    if (i % GATE_EVERY === 0 && i > 0) {
      const lane = LANES[randInt(rng, 0, 2)];
      const gx = lane + randRange(rng, -0.8, 0.8);
      const gz = zCenter;
      const gyG = gy + 2.6;
      const group = this.makeGate();
      group.position.set(gx, gyG, gz);
      this.scene.add(group);
      const gate = { group, x: gx, y: gyG, z: gz, collected: false };
      chunk.gates.push(gate);
      this.gates.push(gate);
    }

    // Obstacles: pick 0-2 occupied lanes, always leave one lane free.
    const d = difficultyForDistance(-(zCenter + CHUNK_Z / 2));
    const roll = rng();
    // Chunk 0 is centred at z = -13 with obstacles anywhere in [-24, -2], so a tree
    // could spawn 2 m in front of the player's start position — an unavoidable death
    // with no reaction time. Keep the opening stretch of every run empty.
    const inRunway = zCenter > -RUNWAY_Z;
    const nLanes = inRunway ? 0 : roll < zeroLaneChance(d) ? 0 : roll < oneLaneThreshold(d) ? 1 : 2;
    const lanes = [0, 1, 2].sort(() => rng() - 0.5).slice(0, nLanes);
    const hasGate = i % GATE_EVERY === 0 && i > 0;
    for (const laneIdx of lanes) {
      const kind: ObstacleKind = rng() < 0.7 ? 'tree' : 'rock';
      const lane = LANES[laneIdx] + randRange(rng, -1.2, 1.2);
      const z = zCenter + randRange(rng, hasGate ? -9 : -11, hasGate ? 9 : 11);
      const group = new THREE.Group();
      const y = z * SLOPE_K;
      let colliderDesc: RAPIER.ColliderDesc;
      if (kind === 'tree') {
        this.buildTree(group);
        group.position.set(lane, y, z);
        colliderDesc = RAPIER.ColliderDesc.cylinder(1.7, 0.5).setTranslation(0, 1.5, 0);
      } else {
        const r = randRange(rng, 0.9, 1.5);
        this.buildRock(group, r);
        group.position.set(lane, y + r * 0.35, z);
        colliderDesc = RAPIER.ColliderDesc.ball(r * 0.85).setTranslation(0, r * 0.35, 0);
      }
      this.scene.add(group);
      const body = this.physics.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(lane, y, z));
      const collider = this.physics.createCollider(
        colliderDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        body,
      );
      this.collisionKind.set(collider.handle, 'obstacle');
      chunk.obstacles.push({ group, body, collider });
    }

    // Side scenery (no colliders): snow pines far off the track.
    for (let s = 0; s < 2; s++) {
      const side = rng() < 0.5 ? -1 : 1;
      const sx = side * randRange(rng, 15, 45);
      const sz = zCenter + randRange(rng, -12, 12);
      const tree = new THREE.Group();
      this.buildTree(tree, 0.7 + rng() * 1.1);
      tree.position.set(sx, sz * SLOPE_K, sz);
      tree.scale.setScalar(0.8 + rng() * 0.8);
      this.scene.add(tree);
      chunk.scenery.push(tree);
    }

    this.chunks.set(i, chunk);
  }

  private buildTree(group: THREE.Group, scale = 1): void {
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16 * scale, 0.24 * scale, 0.9 * scale, 7),
      new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 }),
    );
    trunk.position.y = 0.45 * scale;
    trunk.castShadow = true;
    group.add(trunk);
    const green = new THREE.MeshStandardMaterial({ color: 0xeaf6fb, roughness: 0.9 });
    const green2 = new THREE.MeshStandardMaterial({ color: 0xd2eef7, roughness: 0.9 });
    const heights = [1.7, 1.3, 1.0];
    for (let i = 0; i < 3; i++) {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry((1.15 - i * 0.25) * scale, heights[i] * scale, 8),
        i % 2 ? green2 : green,
      );
      cone.position.y = (0.9 + i * 0.75) * scale;
      cone.castShadow = true;
      group.add(cone);
    }
  }

  private buildRock(group: THREE.Group, r: number): void {
    const rock = new THREE.Mesh(
      new THREE.IcosahedronGeometry(r, 0),
      new THREE.MeshStandardMaterial({ color: 0x9aa5b5, roughness: 0.9, flatShading: true }),
    );
    rock.position.y = 0;
    rock.rotation.y = Math.random() * Math.PI;
    rock.castShadow = true;
    group.add(rock);
  }

  private makeGate(): THREE.Group {
    const group = new THREE.Group();
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0xffd76a,
      emissive: 0xffaa22,
      emissiveIntensity: 0.7,
      roughness: 0.3,
      metalness: 0.4,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.12, 10, 28), ringMat);
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
    const postMat = new THREE.MeshStandardMaterial({ color: 0xd84040, roughness: 0.6 });
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.8, 6), postMat);
      post.position.set(side * 1.35, -1.2, 0);
      group.add(post);
    }
    return group;
  }

  /** Small sparkle burst when passing a gate. */
  spawnBurst(at: THREE.Vector3): void {
    const n = 26;
    const geo = new THREE.BufferGeometry();
    const posArr = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      posArr[i * 3] = at.x;
      posArr[i * 3 + 1] = at.y;
      posArr[i * 3 + 2] = at.z;
      const a = Math.random() * Math.PI * 2;
      const b = Math.random() * 1.4 - 0.7;
      vel[i * 3] = Math.cos(a) * 4;
      vel[i * 3 + 1] = 2 + Math.abs(b) * 3;
      vel[i * 3 + 2] = Math.sin(a) * 4;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffe08a,
      size: 0.35,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    this.bursts.push({ points, vel, t: 0, life: 0.7, basePos: at.clone() });
  }

  /** Snow dust burst when the player lands after a jump. */
  spawnLandBurst(at: THREE.Vector3): void {
    this.landBurstCount++;
    const n = 18;
    const geo = new THREE.BufferGeometry();
    const posArr = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      posArr[i * 3] = at.x + (Math.random() - 0.5) * 0.5;
      posArr[i * 3 + 1] = at.y;
      posArr[i * 3 + 2] = at.z + (Math.random() - 0.5) * 0.5;
      const a = Math.random() * Math.PI * 2;
      const spd = 1.5 + Math.random() * 2;
      vel[i * 3] = Math.cos(a) * spd;
      vel[i * 3 + 1] = Math.random() * 2.5;
      vel[i * 3 + 2] = Math.sin(a) * spd;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xddeeff,
      size: 0.25,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    this.bursts.push({ points, vel, t: 0, life: 0.5, basePos: at.clone() });
  }

  /** Flash a gate ring bright for a short time after collection. */
  flashGate(gate: { group: THREE.Group; x: number; y: number; z: number; collected: boolean }, duration = 0.3): void {
    this.gateFlashCount++;
    gate.group.traverse((child: THREE.Object3D) => {
      if (child instanceof THREE.Mesh && child.material) {
        const mat = child.material as THREE.MeshStandardMaterial;
        const origEmissive = mat.emissive ? mat.emissive.getHex() : 0;
        const origIntensity = mat.emissiveIntensity ?? 0.7;
        mat.emissive?.setHex(0xffffff);
        mat.emissiveIntensity = 2.0;
        setTimeout(() => {
          mat.emissive?.setHex(origEmissive);
          mat.emissiveIntensity = origIntensity;
        }, duration * 1000);
      }
    });
  }

  private disposeChunk(chunk: Chunk): void {
    for (const o of chunk.obstacles) {
      this.scene.remove(o.group);
      o.group.traverse((child: THREE.Object3D) => {
        if (child instanceof THREE.Mesh) child.geometry.dispose();
      });
      this.collisionKind.delete(o.collider.handle);
      this.physics.removeRigidBody(o.body);
    }
    for (const s of chunk.scenery) this.scene.remove(s);
    for (const g of chunk.gates) {
      this.scene.remove(g.group);
      // Also drop it from the live list — this used to leak every despawned gate,
      // so `gates` kept stale entries for the whole run.
      const i = this.gates.indexOf(g);
      if (i !== -1) this.gates.splice(i, 1);
    }
  }

  /** Animate bursts (called every frame). */
  updateBursts(dt: number): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.t += dt;
      const attr = b.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let j = 0; j < arr.length / 3; j++) {
        arr[j * 3] += b.vel[j * 3] * dt;
        arr[j * 3 + 1] += b.vel[j * 3 + 1] * dt;
        arr[j * 3 + 2] += b.vel[j * 3 + 2] * dt;
        b.vel[j * 3 + 1] -= 9.8 * dt;
      }
      attr.needsUpdate = true;
      const mat = b.points.material as THREE.PointsMaterial;
      mat.opacity = 1 - b.t / b.life;
      if (b.t >= b.life) {
        this.scene.remove(b.points);
        b.points.geometry.dispose();
        (b.points.material as THREE.Material).dispose();
        this.bursts.splice(i, 1);
      }
    }
  }
}
