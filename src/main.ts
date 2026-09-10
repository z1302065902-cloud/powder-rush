import './style.css';
import { Game } from './game/Game';

async function bootstrap(): Promise<void> {
  try {
    const game = new Game();
    await game.init();
    (window as unknown as { __SKI_GAME__?: Game }).__SKI_GAME__ = game;
    console.info('[PowderRush] ready');
  } catch (err) {
    console.error('[PowderRush] failed to start', err);
    const el = document.getElementById('app');
    if (el) {
      const div = document.createElement('div');
      div.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;background:#102;padding:30px;text-align:center;font-family:monospace;z-index:99';
      div.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
      el.appendChild(div);
    }
  }
}

bootstrap();

// Register service worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(() => console.info('[PowderRush] SW registered'))
      .catch((e) => console.warn('[PowderRush] SW registration failed', e));
  });
}
