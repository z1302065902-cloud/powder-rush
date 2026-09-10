/** Fixed-timestep game loop with render interpolation-friendly structure.
 *  update(dt) is called with a fixed dt; render() every rAF. */
export class Loop {
  private rafId = 0;
  private lastTime = 0;
  private accumulator = 0;
  private _fps = 0;
  private frameCount = 0;
  private fpsTimer = 0;

  paused = false;

  constructor(
    private readonly fixedDt: number,
    private readonly update: (dt: number) => void,
    private readonly render: () => void,
  ) {}

  get fps(): number {
    return this._fps;
  }

  start(): void {
    this.lastTime = performance.now();
    const tick = (now: number) => {
      this.rafId = requestAnimationFrame(tick);
      let elapsed = (now - this.lastTime) / 1000;
      this.lastTime = now;
      if (elapsed > 0.25) elapsed = 0.25; // tab was hidden
      if (!this.paused) {
        this.accumulator += elapsed;
        let steps = 0;
        while (this.accumulator >= this.fixedDt && steps < 5) {
          this.update(this.fixedDt);
          this.accumulator -= this.fixedDt;
          steps++;
        }
        if (steps === 5) this.accumulator = 0; // avoid spiral of death
      }
      this.trackFps(elapsed);
      this.render();
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private trackFps(elapsed: number): void {
    this.frameCount++;
    this.fpsTimer += elapsed;
    if (this.fpsTimer >= 0.5) {
      this._fps = Math.round(this.frameCount / this.fpsTimer);
      this.frameCount = 0;
      this.fpsTimer = 0;
    }
  }

  stop(): void {
    cancelAnimationFrame(this.rafId);
  }
}
