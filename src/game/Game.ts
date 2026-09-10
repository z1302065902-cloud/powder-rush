import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Loop } from '../core/loop';
import { Input } from '../core/input';
import { installDiagnostics } from '../core/diagnostics';
import { World, SLOPE_ANGLE, difficultyForDistance } from './World';
import { Player } from '../entities/Player';
import { CameraController } from '../systems/CameraController';
import { UI } from './UI';
import { AudioController } from '../audio/AudioController';
import { Score } from '../core/Score';
import { Skins, progressOf } from '../core/Skins';

export type GameState = 'menu' | 'playing' | 'crashing' | 'gameover';

const FIXED_DT = 1 / 60;

export class Game {
  state: GameState = 'menu';
  loop!: Loop;
  readonly stats = { speedKmh: 0, distance: 0, gates: 0, topSpeed: 0, time: 0 };
  player!: Player;
  world!: World;
  camera!: CameraController;
  reducedMotion = false;

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera3!: THREE.PerspectiveCamera;
  private sun!: THREE.DirectionalLight;
  private hemi!: THREE.HemisphereLight;
  private sunTarget!: THREE.Object3D;
  private snow!: THREE.Points;
  private snowPos!: Float32Array;
  private snowGeo!: THREE.BufferGeometry;
  /** Physics world. Public so diagnostics/QA can ray-cast. */
  physics!: RAPIER.World;
  private eventQueue!: RAPIER.EventQueue;
  private input = new Input();
  private audio = new AudioController();
  private ui!: UI;
  private hookSeed: number | null = null;
  private crashTimer = 0;
  private time = 0;
  private disposed = false;
  private comboCount = 0;          // consecutive gates
  private comboTimer = 0;          // seconds until combo resets (3s)
  private trickScore = 0;          // total trick points this run
  private lastGateTime = 0;        // when last gate was collected (for combo reset)
  private airStartTime = 0;        // when current jump started (for trick scoring)
  private prevGrounded = true;     // track landing transition for snow burst
  private dayNightT = 0;           // 0..1 cycle position (day→night→day)
  // 0.00015 gave one full day→night→day cycle every 6667 m, which normal runs never
  // reach (the cycle looked permanently stuck at "day"). 0.0008 ≈ one cycle per 1250 m.
  private dayNightSpeed = 0.0008;  // cycle speed per meter
  /** QA/debug only: skip fatal collisions so long-distance runs can be tested. */
  debugInvincible = false;

  async init(): Promise<void> {
    await RAPIER.init();
    const mount = document.getElementById('game-canvas-wrap')!;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xbcdcf2);
    this.scene.fog = new THREE.Fog(0xbcdcf2, 140, 620);

    // Lights
    const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x9fb8cc, 1.05);
    this.hemi = hemi;
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xfff4e0, 2.8);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 5;
    this.sun.shadow.camera.far = 160;
    this.sun.shadow.camera.left = -45;
    this.sun.shadow.camera.right = 45;
    this.sun.shadow.camera.top = 45;
    this.sun.shadow.camera.bottom = -45;
    this.sunTarget = new THREE.Object3D();
    this.scene.add(this.sunTarget);
    this.sun.target = this.sunTarget;
    this.scene.add(this.sun);

    // Physics
    this.physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.physics.timestep = FIXED_DT;
    this.eventQueue = new RAPIER.EventQueue(true);

    // World + entities
    this.world = new World(this.scene, this.physics);
    this.player = new Player(this.physics, this.scene, Skins.active().palette);
    this.camera = new CameraController(window.innerWidth / window.innerHeight);
    this.camera3 = this.camera.cam;
    this.scene.add(this.camera3);

    this.makeSnow();
    this.ui = new UI();
    this.ui.showScreen('menu');
    this.ui.setFpsVisible(false);

    this.input.attach();
    // Only bind touch controls on devices that actually have touch,
    // otherwise desktop players lose the W/Enter accelerate semantics
    // (snapshot() auto-accelerates whenever _hasTouch is true).
    if (navigator.maxTouchPoints > 0 || 'ontouchstart' in window) {
      this.input.enableTouch();
    }
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM') {
        const on = this.audio.toggle();
        this.ui.flashMsg(on ? '🔊 SOUND ON' : '🔇 MUTED');
        return;
      }
      // 1..6 pick a rider while on the menu
      if (this.state === 'menu') {
        const m = /^Digit([1-6])$/.exec(e.code);
        if (m) {
          const skin = Skins.all[Number(m[1]) - 1];
          if (skin) this.pickSkin(skin.id);
        }
      }
    });
    this.ui.onStartClick(() => { this.audio.resume(); this.audio.click(); this.startRun(); });
    this.ui.onRestartClick(() => { this.audio.resume(); this.audio.click(); this.startRun(); });
    this.ui.skinClick = (id: string) => this.pickSkin(id);

    window.addEventListener('resize', this.onResize);
    installDiagnostics(this);

    this.loop = new Loop(FIXED_DT, (dt) => this.update(dt), () => this.render());
    this.loop.start();
  }

  get fps(): number {
    return this.loop.fps;
  }

  // ---------------------------------------------------------------- setup

  private makeSnow(): void {
    const n = 750;
    this.snowPos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      this.snowPos[i * 3] = (Math.random() * 2 - 1) * 110;
      this.snowPos[i * 3 + 1] = Math.random() * 50;
      this.snowPos[i * 3 + 2] = (Math.random() * 2 - 1) * 110;
    }
    this.snowGeo = new THREE.BufferGeometry();
    this.snowGeo.setAttribute('position', new THREE.BufferAttribute(this.snowPos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.16,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    this.snow = new THREE.Points(this.snowGeo, mat);
    this.scene.add(this.snow);
  }

  private updateSnow(dt: number): void {
    const cp = this.camera.pos;
    const fall = dt * 6;
    for (let i = 0; i < this.snowPos.length / 3; i++) {
      this.snowPos[i * 3 + 1] -= fall;
      this.snowPos[i * 3] += Math.sin(this.time * 1.3 + i) * dt * 0.4;
      if (this.snowPos[i * 3 + 1] < cp.y - 12) {
        this.snowPos[i * 3 + 1] = cp.y + 40;
        this.snowPos[i * 3] = cp.x + (Math.random() * 2 - 1) * 110;
        this.snowPos[i * 3 + 2] = cp.z + (Math.random() * 2 - 1) * 110;
      }
      if (Math.abs(this.snowPos[i * 3] - cp.x) > 120) this.snowPos[i * 3] = cp.x + (Math.random() * 2 - 1) * 110;
      if (Math.abs(this.snowPos[i * 3 + 2] - cp.z) > 120) this.snowPos[i * 3 + 2] = cp.z + (Math.random() * 2 - 1) * 110;
    }
    this.snowGeo.attributes.position.needsUpdate = true;
  }

  private onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.setAspect(w / h);
  };

  // ------------------------------------------------------------- skins

  /** Select a rider skin. Locked skins explain how to unlock them. */
  pickSkin(id: string): void {
    const skin = Skins.byId(id);
    if (Skins.select(id)) {
      this.player.setPalette(skin.palette);
      this.audio.resume();
      this.audio.click();
      this.ui.refreshSkinPicker();
      this.ui.setSkinMsg(`${skin.emoji} ${skin.name} · ${skin.cn}`);
    } else {
      const pr = progressOf(skin);
      this.ui.setSkinMsg(`🔒 ${skin.cn} — ${skin.hint}（${Math.floor(pr.cur)}/${pr.goal}）`);
    }
  }

  /** QA/diagnostics view of rider unlock + selection state. */
  getSkinState() {
    return Skins.all.map((s) => {
      const pr = progressOf(s);
      return {
        id: s.id,
        name: s.name,
        cn: s.cn,
        unlocked: pr.unlocked,
        selected: Skins.selectedId === s.id,
        cur: pr.cur,
        goal: pr.goal,
      };
    });
  }

  /** QA: wipe persisted progress, reselect the default rider. */
  resetProgress(): void {
    Score.reset();
    Skins.select(Skins.all[0].id);
    this.player.setPalette(Skins.active().palette);
    this.ui.refreshSkinPicker();
  }

  /** QA: inject progress without playing a run. */
  grantProgress(dist: number, gates: number, speed: number): void {
    Score.submit(dist, gates, speed);
    this.ui.refreshSkinPicker();
  }

  // ---------------------------------------------------------------- state

  private startRun(): void {
    this.audio.resume();
    this.audio.setEnabled(true);
    this.audio.setBGMPlaying(true);
    // Re-apply the active skin in case it changed since the last run.
    this.player.setPalette(Skins.active().palette);
    const seed = this.hookSeed !== null ? this.hookSeed : ((Math.random() * 0xffffffff) >>> 0);
    this.world.reseed(seed);
    this.player.reset();
    this.stats.distance = 0;
    this.stats.gates = 0;
    this.stats.topSpeed = 0;
    this.stats.time = 0;
    this.crashTimer = 0;
    this.comboCount = 0;
    this.trickScore = 0;
    this.lastGateTime = 0;
    this.airStartTime = 0;
    this.dayNightT = 0;
    this.state = 'playing';
    this.ui.showScreen('hud');
  }

  forceState(name: string): void {
    if (name === 'menu') {
      this.state = 'menu';
      this.ui.showScreen('menu');
    } else if (name === 'playing') {
      if (this.state !== 'playing') this.startRun();
    } else if (name === 'gameover') {
      this.crash();
    }
  }

  hideFps(hidden: boolean): void {
    this.ui.setFpsVisible(!hidden);
  }

  /** QA/debug: toggle fatal collisions off for long-run testing. */
  setInvincible(on: boolean): void {
    this.debugInvincible = on;
  }

  /** QA/debug: current day/night cycle position (0..1). */
  getDayNightT(): number {
    return this.dayNightT;
  }

  /** QA/debug: consecutive gates collected so far this run. */
  getComboCount(): number {
    return this.comboCount;
  }

  /** QA/debug: trick points earned this run. */
  getBgmState(): { playing: boolean; bpm: number | null } {
    return this.audio.getBgmState();
  }

  getParticleState(): { count: number; particles: number; gateFlashes: number; landBursts: number } {
    const b = this.world.liveBursts;
    return { ...b, gateFlashes: this.world.gateFlashCount, landBursts: this.world.landBurstCount };
  }

  getTrickScore(): number {
    return this.trickScore;
  }

  private crash(): void {
    if (this.state === 'crashing' || this.state === 'gameover') return;
    this.state = 'crashing';
    this.crashTimer = 0;
    this.camera.addTrauma(0.85);
    this.player.crash();
    this.ui.flashMsg('CRASH!');
    this.audio.crash();
    this.audio.setBGMPlaying(false);
  }

  // ---------------------------------------------------------------- update

  private update(dt: number): void {
    this.time += dt;
    this.ui.update(dt);
    this.world.updateBursts(dt);
    this.updateSnow(dt);

    const inp = this.input.snapshot();

    if (this.state === 'menu') {
      this.camera.updateIdle(dt, this.time);
      if (this.input.consumePressed('jump') || this.input.consumePressed('accelerate')) {
        this.audio.resume();
        this.startRun();
      }
      this.input.clearPressed();
      return;
    }
    if (this.state === 'playing') {
      // Speed cap escalates with distance, tied to the same difficulty curve that
      // drives obstacle density — so the run keeps getting faster *and* denser.
      const diff = difficultyForDistance(this.stats.distance);
      const maxSpeed = Math.min(62, 30 + this.stats.distance * 0.006 * (1 + diff * 0.25));
      this.player.step(dt, inp, maxSpeed);

      const pos = this.player.pos;
      this.stats.speedKmh = this.player.speed * 3.6;
      // Task 9: BGM tempo tracks speed (90 bpm at rest → ~172 bpm at the 62 m/s cap).
      this.audio.setBGMBpm(90 + this.player.speed * 1.32);
      this.stats.topSpeed = Math.max(this.stats.topSpeed, this.stats.speedKmh);
      this.stats.distance = Math.max(0, -pos.z);
      this.stats.time += dt;
      // Day/night cycle based on distance
      this.dayNightT = (this.stats.distance * this.dayNightSpeed) % 1;
      this.applyDayNight();

      this.world.ensureAhead(pos.z);
      this.updateGates(pos, dt);

      if (this.input.consumePressed('jump')) {
        this.audio.jump();
        this.player.tryJump();
        this.airStartTime = this.stats.time;
      }

      // Trick scoring: hold steer while airborne for >0.4s
      if (!this.player.grounded && this.stats.time - this.airStartTime > 0.4) {
        const inp = this.input.snapshot();
        if (inp.left || inp.right) {
          this.trickScore += dt * 8; // 8 pts/s while steering in air
        }
      } else if (this.player.grounded) {
        this.airStartTime = 0; // reset when landed
        if (!this.prevGrounded) {
          // Just landed — spawn snow dust
          const pos = this.player.pos;
          this.world.spawnLandBurst(new THREE.Vector3(pos.x, pos.y, pos.z));
        }
        this.prevGrounded = true;
      } else {
        this.prevGrounded = false;
      }
      this.physics.step(this.eventQueue);
      this.eventQueue.drainCollisionEvents((h1, h2, started) => {
        if (!started) return;
        if (this.debugInvincible) return;
        const p = this.player.collider.handle;
        if (this.world.collisionKind.has(h1) && h2 === p) this.crash();
        else if (this.world.collisionKind.has(h2) && h1 === p) this.crash();
      });

      // Camera follows (before player's next-frame pos changes).
      const p = this.player.pos;
      this.camera.update(dt, p, this.player.vx, this.player.speed, this.reducedMotion);

      // Sun follows player for shadows.
      this.sunTarget.position.set(p.x, p.y, p.z - 4);
      this.sun.position.set(p.x + 34, p.y + 58, p.z + 24);
      this.ui.updateHud(this.stats.speedKmh, this.stats.distance, this.stats.gates, this.comboCount);
      this.input.clearPressed();
      return;
    }

    if (this.state === 'crashing') {
      this.crashTimer += dt;
      // Slow down + tumble.
      const pos = this.player.pos;
      this.player.speed = Math.max(0, this.player.speed - dt * 26);
      this.player.body.setLinvel({ x: 0, y: this.player.body.linvel().y, z: -this.player.speed }, true);
      this.player.group.rotation.z += dt * 7;
      this.player.group.rotation.x = SLOPE_ANGLE;
      this.camera.addTrauma(dt * 0.4);
      this.camera.update(dt, pos, 0, this.player.speed, this.reducedMotion);
      this.ui.updateHud(this.stats.speedKmh, this.stats.distance, this.stats.gates, this.comboCount);
      if (this.crashTimer >= 1.15) {
        this.state = 'gameover';
        const unlockedBefore = new Set(Skins.unlocked().map((s) => s.id));
        const isNew = Score.submit(this.stats.distance, this.stats.gates, this.stats.topSpeed);
        const newly = Skins.unlocked().filter((s) => !unlockedBefore.has(s.id));
        this.ui.refreshSkinPicker();
        this.ui.showScreen('gameover');
        this.ui.showGameOver(this.stats.distance, this.stats.gates, this.stats.topSpeed, isNew, Math.round(this.trickScore));
        this.ui.showUnlock(
          newly.length
            ? `🎉 解锁新角色：${newly.map((s) => `${s.emoji} ${s.cn}`).join('、')}`
            : '',
        );
      }
      this.physics.step(this.eventQueue);
      this.input.clearPressed();
      return;
    }

    if (this.state === 'gameover') {
      this.camera.updateGameOver(dt, this.player.pos, this.time);
      this.physics.step(this.eventQueue);
      if (this.input.consumePressed('jump') || this.input.consumePressed('accelerate') || this.input.consumePressed('restart')) this.startRun();
      this.input.clearPressed();
      return;
    }
  }

  private updateGates(pos: THREE.Vector3, dt: number): void {
    const py = pos.y;
    for (const gate of this.world.gates) {
      if (gate.collected) continue;
      if (Math.abs(pos.z - gate.z) > 1.4) continue;
      if (Math.abs(pos.x - gate.x) > 1.6) continue;
      if (Math.abs(py - gate.y) > 3.0) continue;
      gate.collected = true;
      // Combo window must exceed the gate spacing (GATE_EVERY * CHUNK_Z / speed).
      // At 3*26=78 m apart that is ~2.6 s at 30 m/s and ~6 s at the 13 m/s start speed.
      if (this.stats.time - this.lastGateTime > 6.0) {
        this.comboCount = 0;
      }
      this.lastGateTime = this.stats.time;
      this.comboCount++;
      const comboMultiplier = 1 + Math.floor(this.comboCount / 3) * 0.5;
      const gatePoints = Math.round(10 * comboMultiplier);
      this.stats.gates += 1;
      this.audio.gate();
      const comboMsg = this.comboCount >= 3 ? ` x${this.comboCount} COMBO!` : '';
      this.ui.flashMsg(`+${gatePoints}  GATE${comboMsg}`);
      this.camera.addPunch(5);
      this.camera.addTrauma(0.12);
      this.world.spawnBurst(new THREE.Vector3(gate.x, gate.y, gate.z));
      this.world.flashGate(gate);
    }
  }

  /** Update scene colors/lighting based on day/night cycle t∈[0,1]. */
  private applyDayNight(): void {
    const t = this.dayNightT;
    // 0=day, 0.25=dusk, 0.5=night, 0.75=dawn
    const dayColor = new THREE.Color(0xbcdcf2);
    const duskColor = new THREE.Color(0x4a2d5e);
    const nightColor = new THREE.Color(0x0a0e1a);
    let skyColor: THREE.Color;
    let fogColor: THREE.Color;
    let sunIntensity: number;
    let hemiSky: THREE.Color;
    let hemiGround: THREE.Color;
    if (t < 0.25) {
      // day → dusk
      const p = t / 0.25;
      skyColor = dayColor.clone().lerp(duskColor, p);
      fogColor = skyColor;
      sunIntensity = 2.8 * (1 - p * 0.6);
      hemiSky = new THREE.Color(0xcfe4ff).lerp(new THREE.Color(0x6a3070), p);
      hemiGround = new THREE.Color(0x9fb8cc).lerp(new THREE.Color(0x1a1030), p);
    } else if (t < 0.5) {
      // dusk → night
      const p = (t - 0.25) / 0.25;
      skyColor = duskColor.clone().lerp(nightColor, p);
      fogColor = skyColor;
      sunIntensity = 1.0 * (1 - p * 0.5);
      hemiSky = new THREE.Color(0x6a3070).lerp(new THREE.Color(0x0a0e1a), p);
      hemiGround = new THREE.Color(0x1a1030).lerp(new THREE.Color(0x050810), p);
    } else if (t < 0.75) {
      // night → dawn
      const p = (t - 0.5) / 0.25;
      skyColor = nightColor.clone().lerp(duskColor, p);
      fogColor = skyColor;
      sunIntensity = 0.5 + p * 0.5;
      hemiSky = new THREE.Color(0x0a0e1a).lerp(new THREE.Color(0x6a3070), p);
      hemiGround = new THREE.Color(0x050810).lerp(new THREE.Color(0x1a1030), p);
    } else {
      // dawn → day
      const p = (t - 0.75) / 0.25;
      skyColor = duskColor.clone().lerp(dayColor, p);
      fogColor = skyColor;
      sunIntensity = 1.5 + p * 1.3;
      hemiSky = new THREE.Color(0x6a3070).lerp(new THREE.Color(0xcfe4ff), p);
      hemiGround = new THREE.Color(0x1a1030).lerp(new THREE.Color(0x9fb8cc), p);
    }
    (this.scene.background as any).copy(skyColor);
    (this.scene.fog!.color as any).copy(fogColor);
    this.sun.intensity = sunIntensity;
    this.hemi.color.copy(hemiSky);
    this.hemi.groundColor.copy(hemiGround);
  }

  // ---------------------------------------------------------------- render

  private render(): void {
    if (this.disposed) return;
    this.renderer.render(this.scene, this.camera3);
  }

  dispose(): void {
    this.disposed = true;
    this.loop.stop();
    this.input.detach();
    window.removeEventListener('resize', this.onResize);
  }
}
