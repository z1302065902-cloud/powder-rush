/**
 * Procedural audio for Powder Rush.
 * SFX via Web Audio API. BGM via Tone.js (loaded as ESM).
 */

import * as Tone from 'tone';

export class AudioController {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private ambientSrc: AudioBufferSourceNode | null = null;
  private enabled = false;
  private lastGate = 0;

  // Tone.js BGM
  private bgmStarted = false;
  private bgmSynth: Tone.PolySynth | null = null;
  private bgmLoop: Tone.Loop | null = null;
  private bgmBass: Tone.MonoSynth | null = null;
  private bgmInterval = 0.35; // seconds per beat

  resume(): void {
    if (!this.ctx) this.initCtx();
    if (this.ctx?.state === 'suspended') this.ctx.resume();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) {
      this.ambientStop();
      this.bgmStop();
      return;
    }
    this.initCtx();
    this.ambientStart();
  }

  /** Start/stop BGM loop during gameplay. */
  setBGMPlaying(on: boolean): void {
    if (on && !this.bgmStarted) this.bgmStart();
    else if (!on) this.bgmStop();
  }

  /** Update BGM tempo to match current speed. */
  setBGMBpm(bpm: number): void {
    if (this.bgmLoop) this.bgmLoop.interval = 60 / bpm;
  }

  /** QA: current BGM state. */
  getBgmState(): { playing: boolean; bpm: number | null } {
    return {
      playing: this.bgmStarted,
      bpm: this.bgmLoop ? Math.round(60 / (this.bgmLoop.interval as number)) : null,
    };
  }

  toggle(): boolean {
    const next = !this.enabled;
    this.setEnabled(next);
    return next;
  }

  // ------------------------------------------------------------------- events

  jump(): void {
    const ctx = this.ctx;
    if (!this.enabled || !ctx) return;
    const t = ctx.currentTime;
    // Upward sweep
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.exponentialRampToValueAtTime(960, t + 0.12);
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.18);
    // Noise puff
    const buf = this.makeNoise(0.06);
    const nsrc = ctx.createBufferSource();
    nsrc.buffer = buf;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 3200;
    nf.Q.value = 1.2;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.12, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    nsrc.connect(nf).connect(ng).connect(this.master!);
    nsrc.start(t);
  }

  gate(): void {
    const ctx = this.ctx;
    if (!this.enabled || !ctx) return;
    const t = ctx.currentTime;
    // Only fire once per ~180 ms to avoid spam when riding through gate zone
    if (t - this.lastGate < 0.18) return;
    this.lastGate = t;
    const notes = [880, 1320];
    notes.forEach((freq, i) => {
      const dt = i * 0.07;
      const o = ctx.createOscillator();
      const gn = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = freq;
      gn.gain.setValueAtTime(0, t + dt);
      gn.gain.linearRampToValueAtTime(0.22, t + dt + 0.015);
      gn.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.28);
      o.connect(gn).connect(this.master!);
      o.start(t + dt);
      o.stop(t + dt + 0.28);
    });
  }

  crash(): void {
    const ctx = this.ctx;
    if (!this.enabled || !ctx) return;
    const t = ctx.currentTime;
    // Low rumble
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(80, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.35);
    g.gain.setValueAtTime(0.28, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + 0.35);
    // Noise burst
    const buf = this.makeNoise(0.25);
    const nsrc = ctx.createBufferSource();
    nsrc.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(800, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 0.25);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.45, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    nsrc.connect(lp).connect(ng).connect(this.master!);
    nsrc.start(t);
  }

  click(): void {
    const ctx = this.ctx;
    if (!this.enabled || !ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = 1200;
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + 0.04);
  }

  // ------------------------------------------------------------------- ambience

  private ambientStart(): void {
    this.ambientStop();
    const ctx = this.ctx;
    if (!ctx) return;
    const buf = this.makeNoise(4.0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 380;
    bp.Q.value = 0.6;
    // Slow volume LFO for wind gusts
    const lfo = ctx.createOscillator();
    const lfoG = ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.value = 0.18;
    lfoG.gain.value = 0.18;
    lfo.connect(lfoG);
    lfoG.connect(bp.gain);
    this.ambientGain = ctx.createGain();
    this.ambientGain.gain.value = 0.18;
    src.connect(bp).connect(this.ambientGain).connect(this.master!);
    src.start();
    lfo.start();
    this.ambientSrc = src;
    // Stop LFO after buffer loops (4 s buffer) to avoid hanging node issues
    const stopLfo = () => { try { lfo.stop(); lfo.disconnect(); } catch {} };
    src.addEventListener('ended', stopLfo, { once: true });
  }

  private ambientStop(): void {
    if (this.ambientSrc) { try { this.ambientSrc.stop(); } catch {} this.ambientSrc.disconnect(); this.ambientSrc = null; }
    if (this.ambientGain) { this.ambientGain.disconnect(); this.ambientGain = null; }
  }

  // ---------- BGM (Tone.js) ----------

  private bgmStart(): void {
    if (this.bgmStarted) return;
    this.bgmStarted = true;
    Tone.start();
    const drum = new Tone.MembraneSynth({ pitchDecay: 0.05, octaves: 4, volume: -18 }).toDestination();
    const bass = new Tone.MonoSynth({ oscillator: { type: 'sawtooth' }, envelope: { attack: 0.02, decay: 0.2, sustain: 0.3, release: 0.4 }, filterEnvelope: { attack: 0.01, decay: 0.15, sustain: 0.2, release: 0.3, baseFrequency: 200, octaves: 4 }, filter: { Q: 2, type: 'lowpass', rolloff: -24 }, volume: -14 }).toDestination();
    const lead = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'triangle' }, envelope: { attack: 0.02, decay: 0.15, sustain: 0.2, release: 0.5 }, volume: -16 }).toDestination();
    this.bgmBass = bass;

    // Pentatonic pattern in A minor
    const noteSeq = ['A3','C4','D4','E4','G4','E4','D4','C4'];
    const bassSeq = ['A1','A1','A1','A1','C2','C2','C2','C2'];
    let idx = 0;
    this.bgmLoop = new Tone.Loop((time: number) => {
      drum.triggerAttackRelease('C2', '16n', time);
      bass.triggerAttackRelease(bassSeq[idx % bassSeq.length], '8n', time);
      lead.triggerAttackRelease(noteSeq[idx % noteSeq.length], '8n', time);
      idx++;
    }, '8n');
    Tone.Transport.start();
    this.bgmLoop.start(0);
  }

  private bgmStop(): void {
    if (!this.bgmStarted) return;
    this.bgmStarted = false;
    if (this.bgmLoop) { this.bgmLoop.dispose(); this.bgmLoop = null; }
    if (this.bgmBass) { this.bgmBass.dispose(); this.bgmBass = null; }
    Tone.Transport.stop();
  }

  // ------------------------------------------------------------------- helpers

  private initCtx(): void {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.75;
    this.master.connect(this.ctx.destination);
  }

  /** Create a circular Float32Buffer of the given duration at the context sample rate. */
  private makeNoise(durationSec: number): AudioBuffer {
    const sr = this.ctx!.sampleRate;
    const len = Math.max(1, Math.floor(sr * durationSec));
    const buf = this.ctx!.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
}
