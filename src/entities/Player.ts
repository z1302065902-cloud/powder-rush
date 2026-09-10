import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { SLOPE_K, SLOPE_ANGLE, TRACK_LIMIT } from '../game/World';
import { SKINS, type Palette } from '../core/Skins';

/**
 * Max travel of the ground probe. The ray starts 5 cm above the ski line, so a
 * hit within 30 cm means the skis are ~25 cm or less off the surface.
 */
const GROUND_PROBE_TOI = 0.3;

export class Player {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly group: THREE.Group;

  speed = 0;        // forward speed magnitude (m/s), -Z direction
  grounded = false;
  /** Last ground-probe time-of-impact (-1 = nothing under the skis). QA only. */
  groundProbeToi = -1;
  private squash = 0;   // 0..1 squash timer
  private lastX = 0;
  private bobT = 0;
  private scarfSegs: THREE.Mesh[] = []; // trailing scarf (Alto-style)
  /** Materials that a skin can recolor, keyed by palette field. */
  private mats: Partial<Record<keyof Palette, THREE.MeshStandardMaterial>> = {};

  constructor(
    private physics: RAPIER.World,
    private scene: THREE.Scene,
    private palette: Palette = SKINS[0].palette,
  ) {
    this.body = physics.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0, 0.5, 0)
        .setCanSleep(false)
        .lockRotations()
        .setLinearDamping(0.05)
        .setCcdEnabled(true),
    );
    this.collider = physics.createCollider(
      // Collider sits low so its bottom edge is at the feet (skis) and the
      // visual model rests ON the snow instead of floating ~1 m above it.
      RAPIER.ColliderDesc.cuboid(0.55, 0.75, 0.45)
        .setTranslation(0, 0.75, 0)
        .setFriction(0.05)
        .setRestitution(0)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );
    this.group = this.buildMesh();
    this.scene.add(this.group);
  }

  private buildMesh(): THREE.Group {
    const g = new THREE.Group();

    // Flat-shaded low-poly ski wear (inspired by Grand Mountain Adventure's
    // untextured flat-shaded assets) + Alto's high-contrast silhouette recipe:
    // dark navy body for contrast on snow, one neon identifier color, orange accents.
    const pal = this.palette;
    const jacket = this.mat('jacket', new THREE.MeshPhysicalMaterial({ color: pal.jacket, roughness: 0.4, metalness: 0.1, clearcoat: 0.5, flatShading: true }));
    const accent = this.mat('accent', new THREE.MeshPhysicalMaterial({ color: pal.accent, roughness: 0.45, clearcoat: 0.3, flatShading: true }));
    const white = new THREE.MeshStandardMaterial({ color: 0xeef3fa, roughness: 0.55, flatShading: true });
    const pants = this.mat('pants', new THREE.MeshStandardMaterial({ color: pal.pants, roughness: 0.8, flatShading: true }));
    const boot = this.mat('boot', new THREE.MeshStandardMaterial({ color: pal.boot, roughness: 0.4, flatShading: true }));
    const skin = this.mat('skin', new THREE.MeshStandardMaterial({ color: pal.skin, roughness: 0.7, flatShading: true }));
    const helmet = this.mat('helmet', new THREE.MeshPhysicalMaterial({ color: pal.helmet, roughness: 0.25, metalness: 0.3, clearcoat: 1, flatShading: true }));
    const lens = this.mat('lens', new THREE.MeshStandardMaterial({ color: pal.lens, roughness: 0.06, metalness: 0.95, flatShading: true }));
    const glove = this.mat('glove', new THREE.MeshStandardMaterial({ color: pal.glove, roughness: 0.6, flatShading: true }));
    const pole = this.mat('pole', new THREE.MeshStandardMaterial({ color: pal.pole, roughness: 0.45, metalness: 0.4, flatShading: true }));
    const skiMat = this.mat('ski', new THREE.MeshPhysicalMaterial({ color: pal.ski, roughness: 0.3, clearcoat: 0.6, flatShading: true }));
    const skiTip = this.mat('skiTip', new THREE.MeshStandardMaterial({ color: pal.skiTip, roughness: 0.35, emissive: pal.skiTip, emissiveIntensity: 0.15, flatShading: true }));
    const scarf = this.mat('scarf', new THREE.MeshStandardMaterial({ color: pal.scarf, roughness: 0.8, flatShading: true }));

    const S = 0.17; // half track width

    // --- Skis (teal deck, curled fluorescent tip, binding) ---
    for (const s of [-1, 1]) {
      const ski = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.04, 1.55), skiMat);
      ski.position.set(s * S, 0.035, 0.06);
      ski.castShadow = true;
      g.add(ski);
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.04, 0.18), skiMat);
      tip.position.set(s * S, 0.068, -0.76);
      tip.rotation.x = -0.6;
      tip.castShadow = true;
      g.add(tip);
      const tipStripe = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.11), skiTip);
      tipStripe.position.set(s * S, 0.064, -0.7);
      tipStripe.castShadow = true;
      g.add(tipStripe);
      const bootMesh = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.15, 0.3), boot);
      bootMesh.position.set(s * S, 0.13, 0.06);
      bootMesh.castShadow = true;
      g.add(bootMesh);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.1, 7), boot);
      cuff.position.set(s * S, 0.245, 0.04);
      g.add(cuff);
    }

    // --- Legs in a bent carving stance (thigh fwd, shin back, slight outward
    // knee splay so the bend reads even from directly behind) ---
    for (const s of [-1, 1]) {
      const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.115, 0.36, 7), pants);
      thigh.position.set(s * S, 0.52, -0.02);
      thigh.rotation.x = 0.38;
      thigh.rotation.z = -s * 0.18; // outward splay — visible in back view
      thigh.castShadow = true;
      g.add(thigh);
      const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.098, 0.3, 7), pants);
      shin.position.set(s * S, 0.36, 0.06);
      shin.rotation.x = -0.26;
      shin.rotation.z = -s * 0.18;
      shin.castShadow = true;
      g.add(shin);
    }

    // --- Hips ---
    const hips = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.2, 9), pants);
    hips.position.set(0, 0.64, 0.0);
    hips.castShadow = true;
    g.add(hips);

    // --- Torso leaning into the slope + accent bands ---
    const torsoGrp = new THREE.Group();
    torsoGrp.rotation.x = -0.28;
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.42, 5, 10), jacket);
    torso.position.set(0, 0.94, 0.0);
    torso.castShadow = true;
    torsoGrp.add(torso);
    const zip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.7, 0.02), accent);
    zip.position.set(0, 0.94, -0.25);
    torsoGrp.add(zip);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.276, 0.276, 0.09, 10), accent);
    band.position.set(0, 1.18, 0.0);
    torsoGrp.add(band);
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.04), white);
    chest.position.set(0, 0.9, -0.23);
    chest.rotation.z = 0.1;
    torsoGrp.add(chest);
    // Small ski backpack: orange shell + navy lid + lime stripe (reads as gear, not a placeholder plate)
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.24, 0.1), glove);
    pack.position.set(0, 1.02, 0.33);
    pack.castShadow = true;
    torsoGrp.add(pack);
    const packLid = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.06, 0.11), jacket);
    packLid.position.set(0, 1.16, 0.33);
    torsoGrp.add(packLid);
    const packStripe = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.24, 0.11), accent);
    packStripe.position.set(0, 1.02, 0.34);
    torsoGrp.add(packStripe);
    const backStripe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.05), accent);
    backStripe.position.set(0.12, 0.94, 0.26);
    torsoGrp.add(backStripe);
    g.add(torsoGrp);

    // --- Scarf: slim neck ring + 3 trailing segments animated in step() (Alto-style) ---
    const scarfBand = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.04, 6, 12), scarf);
    scarfBand.position.set(0, 1.24, 0.02);
    scarfBand.rotation.x = Math.PI / 2;
    scarfBand.castShadow = true;
    g.add(scarfBand);
    for (let i = 0; i < 3; i++) {
      const seg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.11), scarf);
      seg.position.set(0, 1.22, 0.2 + i * 0.12);
      seg.castShadow = true;
      this.scarfSegs.push(seg);
      g.add(seg);
    }

    // --- Arms reaching forward holding poles, gloves ---
    for (const s of [-1, 1]) {
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.24, 6), jacket);
      upper.position.set(s * 0.28, 1.2, -0.14);
      upper.rotation.x = s === 1 ? 0.34 : 0.62; // asymmetric: one arm reaches more
      upper.castShadow = true;
      g.add(upper);
      const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.05, 0.24, 6), jacket);
      fore.position.set(s * 0.31, s === 1 ? 1.03 : 1.1, -0.3);
      fore.rotation.x = s === 1 ? 1.0 : 1.25;
      fore.castShadow = true;
      g.add(fore);
      const gloveMesh = new THREE.Mesh(new THREE.SphereGeometry(0.058, 7, 6), glove);
      gloveMesh.position.set(s * 0.32, 0.99, -0.44);
      gloveMesh.scale.set(1, 1.3, 1.3);
      gloveMesh.castShadow = true;
      g.add(gloveMesh);
      // Ski pole: anchored at the glove, trailing down-back, with basket near snow
      const poleGrp = new THREE.Group();
      poleGrp.position.set(s * 0.32, 0.99, -0.44);
      poleGrp.rotation.x = -0.64;
      poleGrp.rotation.z = s * 0.42; // splay OUTWARD (away from torso) so poles clear the body silhouette
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.032, 1.05, 6), pole);
      shaft.position.y = -0.45;
      shaft.castShadow = true;
      poleGrp.add(shaft);
      const basket = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.022, 6, 10), pole);
      basket.position.y = -0.92;
      basket.rotation.x = Math.PI / 2;
      poleGrp.add(basket);
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.18, 6), glove);
      grip.position.y = 0.0;
      poleGrp.add(grip);
      g.add(poleGrp);
    }

    // --- Head: face, helmet, goggles ---
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.14, 9, 7), skin);
    face.position.set(0, 1.47, -0.02);
    face.castShadow = true;
    g.add(face);
    const helmetMesh = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), helmet);
    helmetMesh.position.set(0, 1.5, 0.02);
    helmetMesh.castShadow = true;
    g.add(helmetMesh);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.178, 0.178, 0.035, 10), helmet);
    brim.position.set(0, 1.42, 0.0);
    g.add(brim);
    // Convex mirrored goggles
    const goggle = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 7), lens);
    goggle.position.set(0, 1.44, -0.1);
    goggle.scale.set(1.7, 0.6, 0.5);
    goggle.castShadow = true;
    g.add(goggle);
    const goggleBand = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.045, 0.02), accent);
    goggleBand.position.set(0, 1.44, -0.01);
    g.add(goggleBand);

    // --- Fake blob contact shadow under the skis (Alto / Grand Mountain Adventure
    // style) — grounds the character on the snow visually, independent of light
    // shadow sampling at this size / camera distance. ---
    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(0.52, 20),
      new THREE.MeshBasicMaterial({ color: 0x0a1a2a, transparent: true, opacity: 0.3, depthWrite: false }),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.scale.set(1, 2.4, 1); // elongate along the ski/run direction
    blob.position.set(0, 0.012, 0.08);
    g.add(blob);

    return g;
  }

  private mat(key: keyof Palette, m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
    this.mats[key] = m;
    return m;
  }

  /** Recolor the rider in place (skins can change between runs, no rebuild). */
  setPalette(p: Palette): void {
    this.palette = p;
    for (const key of Object.keys(this.mats) as (keyof Palette)[]) {
      const m = this.mats[key];
      if (!m) continue;
      m.color.setHex(p[key]);
      if (key === 'skiTip') m.emissive.setHex(p.skiTip);
    }
  }

  get pos(): THREE.Vector3 {
    const t = this.body.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  get vx(): number {
    return this.body.linvel().x;
  }

  reset(): void {
    this.body.setTranslation({ x: 0, y: 0.5, z: 0 }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.speed = 0;
    this.squash = 0;
  }

  tryJump(): void {
    if (!this.grounded) return;
    const v = this.body.linvel();
    this.body.setLinvel({ x: v.x, y: 8.6, z: v.z }, true);
    this.squash = 1;
  }

  crash(): void {
    this.speed = Math.min(this.speed, 12);
  }

  /** Physics-timestep update. Returns lateral velocity for camera look-ahead. */
  step(dt: number, input: { left: boolean; right: boolean; accelerate: boolean; brake: boolean }, maxSpeed: number): void {
    const t = this.body.translation();
    const vel = this.body.linvel();

    // Grounded check: probe straight down from just above the skis.
    //
    // BUG FIX: this probe used to be cast with `solid = true` and NO collider
    // exclusion. Its origin sits inside the player's own cuboid, and with
    // `solid = true` Rapier reports toi = 0 for a ray starting inside a shape —
    // so `grounded` was true on every frame of every run. `tryJump()` therefore
    // allowed mid-air double jumps, and two features could never fire at all:
    // the airborne trick score (`!grounded` was never true) and the landing
    // snow-dust burst (`prevGrounded` was never false).
    // The collider is offset +0.75 with half-height 0.75, so the ski line is
    // exactly at the body origin; a hit within GROUND_PROBE_TOI means contact.
    const ray = new RAPIER.Ray({ x: t.x, y: t.y + 0.05, z: t.z }, { x: 0, y: -1, z: 0 });
    const hit = this.physics.castRay(ray, GROUND_PROBE_TOI, true, undefined, undefined, this.collider);
    this.grounded = hit !== null;
    this.groundProbeToi = hit ? hit.timeOfImpact : -1;

    // Steering (lateral).
    //
    // Lateral agility must scale with forward speed. With a fixed 6.8 m/s, one lane
    // change (5.5 m) took 0.81 s — at 38 m/s that is 30.7 m of forward travel, more
    // than a whole 26 m chunk, so multi-lane dodging became physically impossible as
    // soon as the speed cap rose. Tying it to a fraction of the forward speed makes
    // the *relative* difficulty constant: a full lane change always costs a fixed
    // 5.5/0.55 = 10 m of travel, and crossing the entire track costs 11/0.55 = 20 m
    // (77% of a chunk) at any speed.
    const steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    let vx = vel.x;
    const vxTarget = steer * Math.max(6, this.speed * 0.55);
    vx += (vxTarget - vx) * Math.min(1, dt * 10);

    // Speed model.
    if (input.accelerate) {
      this.speed = Math.min(this.speed + 27 * dt, maxSpeed);
    } else if (input.brake) {
      this.speed = Math.max(this.speed - 42 * dt, 5);
    } else {
      this.speed += (22 - this.speed) * Math.min(1, dt * 0.6);
    }
    // Gravity component pushes downhill; cap.
    this.speed += 9.81 * SLOPE_K * 0.55 * dt;
    this.speed = Math.min(this.speed, maxSpeed);

    this.body.setLinvel({ x: vx, y: vel.y, z: -this.speed }, true);

    // Soft track walls.
    if (t.x > TRACK_LIMIT) {
      this.body.setTranslation({ x: TRACK_LIMIT, y: t.y, z: t.z }, true);
      this.body.setLinvel({ x: -Math.abs(vx) * 0.4, y: vel.y, z: vel.z }, true);
    } else if (t.x < -TRACK_LIMIT) {
      this.body.setTranslation({ x: -TRACK_LIMIT, y: t.y, z: t.z }, true);
      this.body.setLinvel({ x: Math.abs(vx) * 0.4, y: vel.y, z: vel.z }, true);
    }

    // Visual: follow body, tilt into slope, bank into turns, squash.
    const pos = this.body.translation();
    this.group.position.set(pos.x, pos.y, pos.z);
    this.bobT += dt * (10 + this.speed);
    const bob = this.grounded ? Math.sin(this.bobT) * 0.02 * Math.min(1, this.speed / 12) : 0;
    const roll = -steer * 0.5;
    const yaw = Math.atan2(vx * 0.6, Math.max(this.speed, 8)) * 0.6;
    const pitch = this.grounded ? SLOPE_ANGLE * (0.7 + Math.min(0.4, this.speed * 0.008)) : 0;
    this.group.rotation.set(pitch, yaw, roll, 'YXZ');
    this.group.position.y += bob;

    // Trailing scarf (Alto-style): flaps upward/backward, more with speed + turning.
    const sway = this.speed > 3 ? 1 : this.speed / 3;
    for (let i = 0; i < this.scarfSegs.length; i++) {
      const seg = this.scarfSegs[i];
      const w = this.bobT * 2.2 + i * 0.9;
      seg.rotation.x = 0.4 + i * 0.5 + Math.sin(w) * 0.35 * sway;
      seg.position.z = 0.2 + i * 0.12 + Math.sin(w) * 0.03 * sway;
      seg.position.y = 1.22 + i * 0.02 + Math.abs(Math.sin(w)) * 0.03 * sway;
    }

    // Squash & stretch (jump + landing).
    if (this.squash > 0) {
      this.squash = Math.max(0, this.squash - dt * 3.2);
      const k = 1 - this.squash * 0.25;
      this.group.scale.set(k, 1 + this.squash * 0.3, k);
    } else {
      const sy = this.grounded ? 1 : 1.12;
      this.group.scale.set(0.97, sy, 0.97);
    }
  }
}
