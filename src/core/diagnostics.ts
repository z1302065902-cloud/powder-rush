import * as RAPIER from '@dimforge/rapier3d-compat';
import type { Game } from '../game/Game';

/** Global diagnostics + test hooks so automated QA can drive the game. */
export function installDiagnostics(game: Game): void {
  const g = globalThis as unknown as Record<string, unknown>;

  g.__THREE_GAME_DIAGNOSTICS__ = {
    getState: () => game.state,
    getSpeed: () => Math.round(game.stats.speedKmh),
    getDistance: () => Math.round(game.stats.distance),
    getGates: () => game.stats.gates,
    getFps: () => game.loop.fps,
    getPlayerPos: () => game.player.pos.toArray(),
    getInfo: () => ({
      state: game.state,
      speed: Math.round(game.stats.speedKmh),
      distance: Math.round(game.stats.distance),
      gates: game.stats.gates,
      combo: game.getComboCount(),
      bgm: game.getBgmState(),
      particleBursts: game.getParticleState().count,
      gateFlashes: game.getParticleState().gateFlashes,
      landBursts: game.getParticleState().landBursts,
      trickScore: Math.round(game.getTrickScore()),
      grounded: game.player.grounded,
      fps: game.loop.fps,
      playerPos: game.player.pos.toArray(),
      cameraPos: game.camera.pos.toArray(),
    }),
  };

  // Raw physics probe: lets QA ray-cast variants to diagnose ground probing.
  g.__THREE_GAME_PROBE__ = (toi: number, excludeSelf: boolean) => {
    const pl = game.player;
    const t = pl.body.translation();
    const ray = new RAPIER.Ray({ x: t.x, y: t.y + 0.05, z: t.z }, { x: 0, y: -1, z: 0 });
    const hit = game.physics.castRay(ray, toi, true, undefined, undefined, excludeSelf ? pl.collider : undefined);
    return {
      bodyY: +t.y.toFixed(3),
      groundYAtZ: +(t.z * 0.08).toFixed(3),
      z: +t.z.toFixed(2),
      grounded: pl.grounded,
      rayToi: hit ? +hit.timeOfImpact.toFixed(4) : null,
    };
  };

  g.__THREE_GAME_TEST_HOOKS__ = {
    seed: (value: number) => game.world.reseed(value),
    setState: (name: string) => game.forceState(name),
    setPausedForScreenshot: (paused: boolean) => {
      game.loop.paused = paused;
    },
    setReducedMotion: (enabled: boolean) => {
      game.reducedMotion = enabled;
    },
    hideDebugUi: (hidden: boolean) => game.hideFps(hidden),
    setInvincible: (on: boolean) => game.setInvincible(on),
    getDayNightT: () => game.getDayNightT(),
    // --- skin / progression hooks ---
    getSkins: () => game.getSkinState(),
    getBgmState: () => game.getBgmState(),
    getParticleState: () => game.getParticleState(),
    pickSkin: (id: string) => game.pickSkin(id),
    resetProgress: () => game.resetProgress(),
    grantProgress: (dist: number, gates: number, speed: number) => game.grantProgress(dist, gates, speed),
  };
}
