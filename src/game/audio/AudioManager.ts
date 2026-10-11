/**
 * Audio 100 % sintetizado con WebAudio (sin archivos externos). El AudioContext se crea/reanuda con un gesto
 * del usuario (clic en «Jugar»). Incluye una reverberación de calle (convolución con ruido decreciente)
 * para dar eco urbano a los disparos.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private noiseBuf!: AudioBuffer;
  volume = 0.7;

  /** Debe llamarse desde un manejador de evento de usuario. */
  resume(): void {
    try {
      if (!this.ctx) this.init();
      void this.ctx?.resume();
    } catch (e) {
      console.warn("[Audio] No disponible:", e);
    }
  }

  private init(): void {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    // Buffer de ruido blanco reutilizable
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // Reverberación de calle: ruido con caída exponencial (1,6 s)
    const len = Math.floor(ctx.sampleRate * 1.6);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.5;
    this.reverbSend.connect(this.reverb).connect(this.master);
  }

  private get ok(): boolean {
    return !!this.ctx && this.ctx.state === "running";
  }

  private noise(dur: number, freqFrom: number, freqTo: number, gain: number, when = 0, type: BiquadFilterType = "lowpass", send = 0.4, dest?: AudioNode): void {
    if (!this.ok || !this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freqFrom, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, freqTo), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g);
    g.connect(dest ?? this.master);
    if (send > 0) {
      const s = ctx.createGain();
      s.gain.value = send;
      g.connect(s).connect(this.reverbSend);
    }
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private tone(freq: number, freqEnd: number, dur: number, gain: number, when = 0, type: OscillatorType = "sine", dest?: AudioNode): void {
    if (!this.ok || !this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest ?? this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Disparo del francotirador del jugador. */
  shot(): void {
    this.noise(0.5, 6000, 200, 0.9, 0, "lowpass", 0.7);
    this.noise(0.08, 9000, 2000, 0.8, 0, "highpass", 0.2);
    this.tone(95, 38, 0.28, 0.9);
    this.tone(180, 60, 0.12, 0.35, 0, "triangle");
  }

  /** Disparo lejano (bots): más grave, con retardo según la distancia. */
  distantShot(distance: number): void {
    if (!this.ok || !this.ctx) return;
    const gain = Math.max(0.04, 0.8 / (1 + distance * 0.06));
    const delay = Math.min(0.35, distance / 343);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = Math.max(600, 5000 - distance * 35);
    lp.connect(this.master);
    this.noise(0.45, 4000, 180, gain, delay, "lowpass", 0.8, lp);
    this.tone(110, 45, 0.22, gain * 0.7, delay, "sine", lp);
  }

  bolt(): void {
    this.noise(0.05, 5000, 1500, 0.45, 0.35, "bandpass", 0.1);
    this.tone(1400, 700, 0.04, 0.12, 0.35, "square");
    this.noise(0.06, 4000, 1200, 0.5, 0.62, "bandpass", 0.1);
    this.tone(900, 450, 0.05, 0.12, 0.62, "square");
  }

  reload(duration: number): void {
    const t = [0.25, 0.8, duration - 0.7, duration - 0.25];
    t.forEach((w, i) => {
      this.noise(0.06, 3500 + i * 300, 1200, 0.5, w, "bandpass", 0.1);
      this.tone(600 + i * 120, 300, 0.05, 0.1, w, "square");
    });
  }

  empty(): void {
    this.noise(0.04, 3000, 1500, 0.4, 0, "bandpass", 0.05);
  }

  hitMarker(kind: "body" | "head" | "kill"): void {
    if (kind === "kill") {
      this.tone(1500, 1500, 0.07, 0.25, 0, "sine");
      this.tone(2000, 2000, 0.12, 0.25, 0.07, "sine");
    } else if (kind === "head") {
      this.tone(1800, 1800, 0.06, 0.25, 0, "sine");
      this.tone(2400, 2400, 0.08, 0.2, 0.05, "sine");
    } else {
      this.tone(1100, 1100, 0.05, 0.22, 0, "sine");
    }
  }

  impact(distance: number): void {
    const g = Math.max(0.05, 0.35 / (1 + distance * 0.03));
    this.noise(0.12, 3000, 400, g, Math.min(0.4, distance / 343), "lowpass", 0.3);
  }

  hurt(): void {
    this.tone(120, 50, 0.25, 0.7);
    this.noise(0.12, 800, 200, 0.5, 0, "lowpass", 0.1);
  }

  death(): void {
    this.tone(70, 25, 1.2, 0.8);
    this.noise(0.8, 600, 80, 0.4, 0, "lowpass", 0.5);
  }

  respawn(): void {
    this.tone(440, 880, 0.25, 0.2, 0, "sine");
  }
}
