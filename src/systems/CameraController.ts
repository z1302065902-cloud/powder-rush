import * as THREE from 'three';
import { SLOPE_K } from '../game/World';

export class CameraController {
  readonly cam: THREE.PerspectiveCamera;
  pos = new THREE.Vector3(0, 5.4, 10.5);
  trauma = 0;
  private punch = 0;       // FOV punch decay
  private readonly baseFov = 66;
  private readonly shakeOff = new THREE.Vector3();

  constructor(aspect: number) {
    this.cam = new THREE.PerspectiveCamera(this.baseFov, aspect, 0.1, 1500);
    this.cam.position.copy(this.pos);
  }

  setAspect(aspect: number): void {
    this.cam.aspect = aspect;
    this.cam.updateProjectionMatrix();
  }

  /** Camera shake: magnitude in 0..1. */
  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** FOV kick (gate passes). */
  addPunch(amount: number): void {
    this.punch = Math.min(10, this.punch + amount);
  }

  update(dt: number, playerPos: THREE.Vector3, vx: number, speed: number, reducedMotion: boolean): void {
    // Desired camera: behind and above the player, following the slope.
    const desired = new THREE.Vector3(
      playerPos.x + vx * 0.35,
      playerPos.y + 4.6 + 9.2 * SLOPE_K * 0.5,
      playerPos.z + 9.6,
    );
    const k = 1 - Math.exp(-dt * 5.5);
    this.pos.lerp(desired, k);

    // Trauma shake: offset grows with trauma^2.
    this.trauma = Math.max(0, this.trauma - dt * 1.1);
    const t2 = this.trauma * this.trauma;
    const mag = reducedMotion ? 0 : t2 * 0.55;
    this.shakeOff.set(
      (Math.random() * 2 - 1) * mag,
      (Math.random() * 2 - 1) * mag,
      (Math.random() * 2 - 1) * mag * 0.5,
    );
    this.cam.position.set(this.pos.x + this.shakeOff.x, this.pos.y + this.shakeOff.y, this.pos.z + this.shakeOff.z);

    // Look ahead in travel direction.
    const look = new THREE.Vector3(playerPos.x + vx * 0.55, playerPos.y + 1.6, playerPos.z - 6.5);
    this.cam.lookAt(look);

    // FOV: base + speed boost + punch (decays).
    this.punch = Math.max(0, this.punch - dt * 5);
    const targetFov = this.baseFov + Math.min(14, speed * 0.28) + this.punch;
    if (Math.abs(this.cam.fov - targetFov) > 0.05) {
      this.cam.fov = targetFov;
      this.cam.updateProjectionMatrix();
    }
  }

  /** Menu idle camera. */
  updateIdle(dt: number, time: number): void {
    this.pos.set(0 + Math.sin(time * 0.25) * 1.2, 5.4, 10.5 + Math.sin(time * 0.4) * 0.8);
    this.cam.position.copy(this.pos);
    this.cam.lookAt(0, 1.6, -8);
  }

  /** Game-over: slow sway around the fallen player. */
  updateGameOver(dt: number, playerPos: THREE.Vector3, time: number): void {
    const desired = new THREE.Vector3(
      playerPos.x + Math.sin(time * 0.3) * 3.2,
      playerPos.y + 3.4,
      playerPos.z + 7.5,
    );
    const k = 1 - Math.exp(-dt * 2);
    this.pos.lerp(desired, k);
    this.cam.position.copy(this.pos);
    this.cam.lookAt(playerPos.x, playerPos.y + 1, playerPos.z - 2);
  }
}
