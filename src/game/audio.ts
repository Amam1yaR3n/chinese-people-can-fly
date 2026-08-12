import type { AudioEvent } from "./types";

export class AudioController {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;

  async unlock(): Promise<void> {
    if (!this.context) {
      const AudioContextClass = window.AudioContext;
      this.context = new AudioContextClass();
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : 0.72;
      this.master.connect(this.context.destination);
    }

    if (this.context.state === "suspended") {
      await this.context.resume();
    }
  }

  toggleMuted(): boolean {
    this.muted = !this.muted;
    if (this.context && this.master) {
      this.master.gain.setTargetAtTime(
        this.muted ? 0 : 0.72,
        this.context.currentTime,
        0.015,
      );
    }
    return this.muted;
  }

  play(event: AudioEvent): void {
    if (!this.context || !this.master || this.muted) return;

    switch (event) {
      case "swing":
        this.noise(0.17, 0.07, "bandpass", 1050);
        break;
      case "hit":
        this.tone(175, 72, 0.11, 0.15, "triangle");
        this.noise(0.055, 0.055, "lowpass", 920);
        break;
      case "land":
        this.tone(92, 48, 0.12, 0.09, "sine");
        break;
      case "skip":
        this.tone(320, 230, 0.045, 0.024, "sine");
        break;
      case "explosion":
        this.noise(0.38, 0.2, "lowpass", 1450);
        this.tone(78, 36, 0.32, 0.12, "sawtooth");
        break;
    }
  }

  private tone(
    startFrequency: number,
    endFrequency: number,
    duration: number,
    volume: number,
    type: OscillatorType,
  ): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master) return;

    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(startFrequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(1, endFrequency),
      now + duration,
    );
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  private noise(
    duration: number,
    volume: number,
    filterType: BiquadFilterType,
    frequency: number,
  ): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master) return;

    const frameCount = Math.ceil(context.sampleRate * duration);
    const buffer = context.createBuffer(1, frameCount, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < frameCount; index += 1) {
      data[index] = Math.random() * 2 - 1;
    }

    const now = context.currentTime;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = buffer;
    filter.type = filterType;
    filter.frequency.value = frequency;
    filter.Q.value = 0.7;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(now);
  }
}
