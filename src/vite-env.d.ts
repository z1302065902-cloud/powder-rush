/// <reference types="vite/client" />
declare module '*.css';

interface GameDiagnostics {
  getState: () => string;
  getSpeed: () => number;
  getDistance: () => number;
  getGates: () => number;
  getFps: () => number;
  getPlayerPos: () => number[];
  getInfo: () => {
    state: string;
    speed: number;
    distance: number;
    gates: number;
    fps: number;
    playerPos: number[];
    cameraPos: number[];
  };
}

interface GameTestHooks {
  seed: (value: number) => void;
  setState: (name: string) => void;
  setPausedForScreenshot: (paused: boolean) => void;
  setReducedMotion: (enabled: boolean) => void;
  hideDebugUi: (hidden: boolean) => void;
}

interface Window {
  __THREE_GAME_DIAGNOSTICS__?: GameDiagnostics;
  __THREE_GAME_TEST_HOOKS__?: GameTestHooks;
}
