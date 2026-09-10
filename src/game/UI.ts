import { Score } from '../core/Score';
import { Skins, progressOf, type Skin } from '../core/Skins';

export class UI {
  private startEl: HTMLElement;
  private hudEl: HTMLElement;
  private gameOverEl: HTMLElement;
  private fpsEl: HTMLElement;
  private speedEl: HTMLElement;
  private distEl: HTMLElement;
  private gatesEl: HTMLElement;
  private msgEl: HTMLElement;
  private goDistEl: HTMLElement;
  private goGatesEl: HTMLElement;
  private goSpeedEl: HTMLElement;
  private goTrickEl: HTMLElement;
  private goBestDistEl: HTMLElement;
  private goBestGatesEl: HTMLElement;
  private goBestSpeedEl: HTMLElement;
  private newBestEl: HTMLElement;
  private shareBtnEl: HTMLElement;
  private shareStatusEl: HTMLElement;
  private comboEl: HTMLElement;
  private shareTimer = 0;
  private lastDist = 0;
  private skinPickerEl: HTMLElement;
  private skinChips = new Map<string, HTMLButtonElement>();
  private skinMsgEl: HTMLElement;
  private msgTimer = 0;

  constructor() {
    this.startEl = document.getElementById('ui-start')!;
    this.hudEl = document.getElementById('ui-hud')!;
    this.gameOverEl = document.getElementById('ui-gameover')!;
    this.fpsEl = document.getElementById('ui-fps')!;
    this.speedEl = document.getElementById('hud-speed')!;
    this.distEl = document.getElementById('hud-dist')!;
    this.gatesEl = document.getElementById('hud-gates')!;
    this.msgEl = document.getElementById('hud-msg')!;
    this.goDistEl = document.getElementById('go-dist')!;
    this.goGatesEl = document.getElementById('go-gates')!;
    this.goSpeedEl = document.getElementById('go-speed')!;
    this.goTrickEl = document.getElementById('go-trick')!;
    this.goBestDistEl = document.getElementById('go-best-dist')!;
    this.goBestGatesEl = document.getElementById('go-best-gates')!;
    this.goBestSpeedEl = document.getElementById('go-best-speed')!;
    this.newBestEl = document.getElementById('new-best')!;
    this.shareBtnEl = document.getElementById('btn-screenshot')!;
    this.shareStatusEl = document.getElementById('share-status')!;
    this.comboEl = document.getElementById('hud-combo')!;
    this.skinPickerEl = document.getElementById('skin-picker')!;
    this.skinMsgEl = document.getElementById('skin-msg')!;
    this.shareBtnEl.addEventListener('click', () => this.takeScreenshot());
    this.buildSkinPicker();
  }

  // ------------------------------------------------------------ skins

  private hex(c: number): string {
    return '#' + c.toString(16).padStart(6, '0');
  }

  private buildSkinPicker(): void {
    this.skinPickerEl.textContent = '';
    this.skinChips.clear();
    for (const skin of Skins.all) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'skin-chip';
      chip.dataset.id = skin.id;
      chip.setAttribute('aria-pressed', 'false');

      const swatch = document.createElement('span');
      swatch.className = 'skin-swatch';
      for (const c of [skin.palette.jacket, skin.palette.accent, skin.palette.ski]) {
        const dot = document.createElement('i');
        dot.style.background = this.hex(c);
        swatch.appendChild(dot);
      }

      const name = document.createElement('span');
      name.className = 'skin-name';
      name.textContent = skin.cn;
      const status = document.createElement('span');
      status.className = 'skin-status';
      chip.title = skin.hint;

      const bar = document.createElement('span');
      bar.className = 'skin-bar';
      bar.appendChild(document.createElement('i'));

      chip.append(swatch, name, status, bar);
      chip.addEventListener('click', () => this.skinClick?.(skin.id));
      this.skinPickerEl.appendChild(chip);
      this.skinChips.set(skin.id, chip);
    }
    this.refreshSkinPicker();
  }

  /** Called by the game when a chip is clicked (locked chips included). */
  skinClick: ((id: string) => void) | null = null;

  refreshSkinPicker(): void {
    for (const skin of Skins.all) {
      const chip = this.skinChips.get(skin.id);
      if (!chip) continue;
      const pr = progressOf(skin);
      const selected = Skins.selectedId === skin.id;
      chip.classList.toggle('locked', !pr.unlocked);
      chip.classList.toggle('selected', selected);
      chip.setAttribute('aria-pressed', String(selected));
      const status = chip.querySelector('.skin-status') as HTMLElement | null;
      const fill = chip.querySelector('.skin-bar > i') as HTMLElement | null;
      if (status) {
        status.textContent = pr.unlocked
          ? (selected ? '✓ 已装备' : skin.name)
          : `${Math.floor(pr.cur)}/${pr.goal}`;
      }
      if (fill) fill.style.width = pr.unlocked ? '100%' : `${Math.round(pr.ratio * 100)}%`;
      chip.title = pr.unlocked ? `${skin.emoji} ${skin.name} · ${skin.cn}` : `🔒 ${skin.hint}`;
    }
    this.updateUnlockCounter();
  }

  private updateUnlockCounter(): void {
    const total = Skins.all.length;
    const got = Skins.unlocked().length;
    const counter = document.getElementById('skin-count');
    if (counter) counter.textContent = `${got}/${total}`;
  }

  /** Brief note under the picker (e.g. "locked — reach 400 m"). */
  setSkinMsg(text: string): void {
    this.skinMsgEl.textContent = text;
    this.skinMsgEl.classList.toggle('hidden', text === '');
    if (text) {
      window.clearTimeout(this.skinMsgTimer);
      this.skinMsgTimer = window.setTimeout(() => {
        this.skinMsgEl.classList.add('hidden');
      }, 2200);
    }
  }

  private skinMsgTimer = 0;

  /** Notice on the game-over panel when a run unlocked a new rider. */
  showUnlock(text: string): void {
    const el = document.getElementById('go-unlock');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('hidden', text === '');
  }

  /** Read-only view of the picker for QA hooks. */
  skinState(): { id: string; unlocked: boolean; selected: boolean }[] {
    return Skins.all.map((skin: Skin) => ({
      id: skin.id,
      unlocked: progressOf(skin).unlocked,
      selected: Skins.selectedId === skin.id,
    }));
  }

  onStartClick(cb: () => void): void {
    document.getElementById('btn-start')!.addEventListener('click', cb);
  }

  onRestartClick(cb: () => void): void {
    document.getElementById('btn-restart')!.addEventListener('click', cb);
  }

  showScreen(screen: 'menu' | 'hud' | 'gameover'): void {
    this.startEl.classList.toggle('hidden', screen !== 'menu');
    this.hudEl.classList.toggle('hidden', screen !== 'hud');
    this.gameOverEl.classList.toggle('hidden', screen !== 'gameover');
  }

  updateHud(speedKmh: number, distance: number, gates: number, combo = 0): void {
    this.speedEl.textContent = String(Math.round(speedKmh));
    this.distEl.textContent = String(Math.floor(distance));
    this.gatesEl.textContent = String(gates);
    // Combo gets its own readout — it used to overwrite the GATES number, hiding
    // the gate count for as long as a combo was alive.
    if (combo >= 3) {
      const label = `x${combo} COMBO`;
      if (this.comboEl.textContent !== label) this.comboEl.textContent = label;
      this.comboEl.classList.remove('hidden');
    } else {
      this.comboEl.classList.add('hidden');
    }
  }

  /**
   * Show game-over panel. If isNew is true, highlight the NEW BEST banner.
   */
  showGameOver(dist: number, gates: number, topSpeed: number, isNew: boolean, trickScore = 0): void {
    this.lastDist = dist;
    this.setShareStatus('');
    this.goDistEl.textContent = `${Math.floor(dist)} m`;
    this.goGatesEl.textContent = String(gates);
    this.goSpeedEl.textContent = `${Math.round(topSpeed)} km/h`;
    this.goTrickEl.textContent = trickScore > 0 ? `${Math.round(trickScore)} pts` : '—';
    this.goBestDistEl.textContent = `${Math.floor(Score.dist)} m`;
    this.goBestGatesEl.textContent = String(Score.gates);
    this.goBestSpeedEl.textContent = `${Math.round(Score.speed)} km/h`;
    this.newBestEl.classList.toggle('hidden', !isNew);
  }

  private setShareStatus(text: string, autoClearMs = 3200): void {
    window.clearTimeout(this.shareTimer);
    this.shareStatusEl.textContent = text;
    if (text) this.shareTimer = window.setTimeout(() => { this.shareStatusEl.textContent = ''; }, autoClearMs);
  }

  /**
   * Capture the canvas and get it to the user.
   *
   * Three tiers, in order: Web Share → clipboard → file download. Every tier has a
   * bounded wait: `navigator.share` resolves only after the user picks a target (or
   * the OS sheet closes) and some environments never settle at all, which used to
   * leave the button looking dead with no feedback.
   */
  async takeScreenshot(): Promise<void> {
    const canvas = document.querySelector('canvas');
    if (!canvas) return;
    this.setShareStatus('⏳ 处理中…', 60000);
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) { this.setShareStatus('截图失败'); return; }

      const fileName = 'powder-rush.png';
      const file = new File([blob], fileName, { type: 'image/png' });
      const data = {
        title: 'Powder Rush',
        text: `我在 Powder Rush 滑了 ${Math.floor(this.lastDist)} 米！`,
        files: [file],
      };

      // --- tier 1: Web Share (mobile + supported desktops) ---
      if (typeof navigator.share === 'function' && navigator.canShare?.(data)) {
        const outcome = await Promise.race([
          navigator.share(data).then(
            () => 'shared' as const,
            (e: unknown) => (e instanceof DOMException && e.name === 'AbortError' ? 'aborted' as const : 'failed' as const),
          ),
          new Promise<'timeout'>((res) => window.setTimeout(() => res('timeout'), 12000)),
        ]);
        if (outcome === 'shared') { this.setShareStatus('✓ 已分享'); return; }
        if (outcome === 'aborted') { this.setShareStatus('已取消分享'); return; }
        // 'timeout' / 'failed' → the share sheet never completed; use a local fallback
      }

      // --- tier 2: clipboard ---
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        this.setShareStatus('✓ 已复制到剪贴板');
        return;
      } catch { /* fall through */ }

      // --- tier 3: plain download ---
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
      this.setShareStatus('✓ 已下载图片');
    } catch {
      this.setShareStatus('分享失败');
    }
  }

  flashMsg(text: string): void {
    this.msgEl.textContent = text;
    this.msgEl.classList.remove('hidden');
    this.msgTimer = 1.0;
  }

  update(dt: number): void {
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) this.msgEl.classList.add('hidden');
    }
  }

  setFps(fps: number): void {
    this.fpsEl.textContent = `${fps} fps`;
  }

  setFpsVisible(visible: boolean): void {
    this.fpsEl.classList.toggle('hidden', !visible);
  }
}
