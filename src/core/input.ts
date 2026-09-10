export type InputState = {
  left: boolean;
  right: boolean;
  accelerate: boolean;
  brake: boolean;
  jump: boolean;
  restart: boolean;
};

const KEYMAP: Record<string, keyof InputState> = {
  KeyW: 'accelerate',
  ArrowUp: 'accelerate',
  KeyS: 'brake',
  ArrowDown: 'brake',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'jump',
  ShiftLeft: 'brake',
  Enter: 'accelerate',
  KeyR: 'restart',
};

/** Touch zones: left half = steer, right half = jump (tap) / brake (hold lower) */
const TOUCH_ZONE_LEFT  = 'left-stick';
const TOUCH_ZONE_RIGHT = 'right-actions';

export class Input {
  private down = new Set<string>();
  /** Edge-triggered queue consumed by the game each frame (e.g. jump press). */
  private pressed = new Set<string>();
  private _hasTouch = false;

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Space') e.preventDefault();
    if (e.repeat) return;
    const action = KEYMAP[e.code];
    if (action) {
      this.down.add(action);
      this.pressed.add(action);
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const action = KEYMAP[e.code];
    if (action) this.down.delete(action);
  };

  private onBlur = () => {
    this.down.clear();
  };

  /** Activate touch controls. Call once on mobile devices. */
  enableTouch(): void {
    if (this._hasTouch) return;
    this._hasTouch = true;
    const handleTouch = (action: keyof InputState, pressed: boolean) => {
      if (pressed) { this.down.add(action); this.pressed.add(action); }
      else this.down.delete(action);
    };
    // Left half — horizontal drag to steer
    let touchStartX = 0;
    document.addEventListener('touchstart', (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      if (t.clientX < window.innerWidth / 2) {
        touchStartX = t.clientX;
        handleTouch('left', true);
      } else {
        // Right half: tap top = jump, hold bottom = brake
        if (t.clientY < window.innerHeight * 0.6) handleTouch('jump', true);
        else handleTouch('brake', true);
      }
    }, { passive: true });
    document.addEventListener('touchend', (e: TouchEvent) => {
      const t = e.changedTouches[0];
      if (!t) return;
      if (t.clientX < window.innerWidth / 2) {
        handleTouch('left', false);
        handleTouch('right', false);
      } else {
        if (t.clientY < window.innerHeight * 0.6) handleTouch('jump', false);
        else handleTouch('brake', false);
      }
    }, { passive: true });
    document.addEventListener('touchmove', (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t || t.clientX >= window.innerWidth / 2) return;
      const dx = t.clientX - touchStartX;
      handleTouch('left', dx < -15);
      handleTouch('right', dx > 15);
    }, { passive: true });
    // Also support right-half swipe up for jump
    let rTouchStartY = 0;
    document.addEventListener('touchstart', (e: TouchEvent) => {
      const t = e.touches[0];
      if (t && t.clientX >= window.innerWidth / 2) rTouchStartY = t.clientY;
    }, { passive: true });
    document.addEventListener('touchend', (e: TouchEvent) => {
      const t = e.changedTouches[0];
      if (!t || t.clientX < window.innerWidth / 2) return;
      if (rTouchStartY - t.clientY > 30) {
        // Swipe up on right half = jump
        handleTouch('jump', true);
        setTimeout(() => handleTouch('jump', false), 100);
      }
    }, { passive: true });
  }

  get hasTouch(): boolean { return this._hasTouch; }

  attach(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  /** Snapshot of held actions. */
  snapshot(): InputState {
    // Touch has no accelerate button: auto-accelerate unless braking,
    // otherwise mobile players are stuck at the ~22 m/s coast cap.
    const accelerate = this._hasTouch
      ? !this.down.has('brake')
      : this.down.has('accelerate');
    return {
      left: this.down.has('left'),
      right: this.down.has('right'),
      accelerate,
      brake: this.down.has('brake'),
      jump: this.down.has('jump'),
      restart: this.down.has('restart'),
    };
  }

  /** True once for the frame an action was first pressed (then consumed). */
  consumePressed(action: keyof InputState): boolean {
    if (this.pressed.has(action)) {
      this.pressed.delete(action);
      return true;
    }
    return false;
  }

  clearPressed(): void {
    this.pressed.clear();
  }
}
