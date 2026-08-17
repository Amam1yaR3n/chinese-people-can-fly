import type { AudioEvent } from "./types";

const BGM_PATH = "./assets/audio/bgm.m4a";
const LAUNCH_HIT_PATH = "./assets/audio/launch-hit.mp3";
const SKY_LANTERN_PICKUP_PATH = "./assets/audio/sky-lantern-pickup.mp3";
const SIXTH_GEN_JET_PICKUP_PATH =
  "./assets/audio/sixth-gen-jet-pickup.mp3";
const MINE_TRIGGER_PATH = "./assets/audio/mine-trigger.mp3";
const WATER_SKIP_PATH = "./assets/audio/water-skip.mp3";
const RED_PACKET_PICKUP_PATH = "./assets/audio/red-packet-pickup.mp3";
const UFO_PICKUP_PATH = "./assets/audio/ufo-pickup.mp3";
const BATTER_HIT_PATH = "./assets/audio/batter-hit.mp3";
const SLINGSHOT_RELEASE_PATH = "./assets/audio/slingshot-release.mp3";
const CANNON_LAUNCH_PATH = "./assets/audio/cannon-launch.mp3";
const MISSILE_LAUNCH_PATH = "./assets/audio/missile-launch.mp3";
const LAUNCH_HIT_VOLUME_SCALE = 0.62;

export class AudioController {
  private context: AudioContext | null = null;
  private effectsGain: GainNode | null = null;
  private readonly bgm: HTMLAudioElement;
  private readonly launchHit: HTMLAudioElement;
  private readonly skyLanternPickup: HTMLAudioElement;
  private readonly sixthGenJetPickup: HTMLAudioElement;
  private readonly mineTrigger: HTMLAudioElement;
  private readonly waterSkip: HTMLAudioElement;
  private readonly redPacketPickup: HTMLAudioElement;
  private readonly ufoPickup: HTMLAudioElement;
  private readonly batterHit: HTMLAudioElement;
  private readonly slingshotRelease: HTMLAudioElement;
  private readonly cannonLaunch: HTMLAudioElement;
  private readonly missileLaunch: HTMLAudioElement;
  private musicVolume: number;
  private effectsVolume: number;
  private unlocked = false;
  private lifecyclePaused = false;

  constructor(musicVolume = 0.48, effectsVolume = 0.72) {
    this.musicVolume = this.clampVolume(musicVolume);
    this.effectsVolume = this.clampVolume(effectsVolume);
    this.bgm = this.createMedia(BGM_PATH, this.musicVolume, true);
    this.launchHit = this.createMedia(
      LAUNCH_HIT_PATH,
      this.effectsVolume * LAUNCH_HIT_VOLUME_SCALE,
    );
    this.skyLanternPickup = this.createMedia(
      SKY_LANTERN_PICKUP_PATH,
      this.effectsVolume,
    );
    this.sixthGenJetPickup = this.createMedia(
      SIXTH_GEN_JET_PICKUP_PATH,
      this.effectsVolume,
    );
    this.mineTrigger = this.createMedia(MINE_TRIGGER_PATH, this.effectsVolume);
    this.waterSkip = this.createMedia(WATER_SKIP_PATH, this.effectsVolume);
    this.redPacketPickup = this.createMedia(
      RED_PACKET_PICKUP_PATH,
      this.effectsVolume,
    );
    this.ufoPickup = this.createMedia(UFO_PICKUP_PATH, this.effectsVolume);
    this.batterHit = this.createMedia(BATTER_HIT_PATH, this.effectsVolume);
    this.slingshotRelease = this.createMedia(
      SLINGSHOT_RELEASE_PATH,
      this.effectsVolume,
    );
    this.cannonLaunch = this.createMedia(CANNON_LAUNCH_PATH, this.effectsVolume);
    this.missileLaunch = this.createMedia(
      MISSILE_LAUNCH_PATH,
      this.effectsVolume,
    );
  }

  async unlock(): Promise<void> {
    if (!this.context) {
      const AudioContextClass = window.AudioContext;
      this.context = new AudioContextClass();
      this.effectsGain = this.context.createGain();
      this.effectsGain.gain.value = this.effectsVolume;
      this.effectsGain.connect(this.context.destination);
    }

    this.unlocked = true;
    this.playBgm();

    if (this.context.state === "suspended") {
      await this.context.resume();
    }
  }

  setPaused(paused: boolean): void {
    this.lifecyclePaused = paused;
    if (paused) {
      this.bgm.pause();
      return;
    }
    this.playBgm();
  }

  setMusicVolume(volume: number): void {
    this.musicVolume = this.clampVolume(volume);
    this.bgm.volume = this.musicVolume;
  }

  setEffectsVolume(volume: number): void {
    this.effectsVolume = this.clampVolume(volume);
    this.launchHit.volume = this.effectsVolume * LAUNCH_HIT_VOLUME_SCALE;
    this.skyLanternPickup.volume = this.effectsVolume;
    this.sixthGenJetPickup.volume = this.effectsVolume;
    this.mineTrigger.volume = this.effectsVolume;
    this.waterSkip.volume = this.effectsVolume;
    this.redPacketPickup.volume = this.effectsVolume;
    this.ufoPickup.volume = this.effectsVolume;
    this.batterHit.volume = this.effectsVolume;
    this.slingshotRelease.volume = this.effectsVolume;
    this.cannonLaunch.volume = this.effectsVolume;
    this.missileLaunch.volume = this.effectsVolume;
    if (this.context && this.effectsGain) {
      this.effectsGain.gain.setValueAtTime(
        this.effectsVolume,
        this.context.currentTime,
      );
    }
  }

  previewEffect(): void {
    this.tone(540, 760, 0.09, 0.1, "sine");
  }

  play(event: AudioEvent): void {
    if (!this.context || !this.effectsGain) return;

    switch (event) {
      case "swing":
        this.noise(0.17, 0.07, "bandpass", 1050);
        break;
      case "land":
        this.tone(92, 48, 0.12, 0.09, "sine");
        break;
      case "skip":
        this.replay(this.waterSkip);
        break;
      case "explosion":
        this.replay(this.mineTrigger);
        break;
      case "pickupRedPacket":
        this.replay(this.redPacketPickup);
        break;
      case "pickupLantern":
        this.replay(this.skyLanternPickup);
        break;
      case "pickupJet":
        this.replay(this.sixthGenJetPickup);
        break;
      case "pickupUfo":
        this.replay(this.ufoPickup);
        break;
      case "hitBlackEagle":
        this.replay(this.launchHit);
        this.replay(this.batterHit);
        break;
      case "launchSlingshot":
        this.replay(this.slingshotRelease);
        break;
      case "launchHumanCannon":
        this.replay(this.cannonLaunch);
        break;
      case "launchMissileTruck":
        this.replay(this.missileLaunch);
        break;
    }
  }

  private replay(audio: HTMLAudioElement): void {
    audio.currentTime = 0;
    void audio.play().catch(() => undefined);
  }

  private createMedia(path: string, volume: number, loop = false): HTMLAudioElement {
    const audio = new Audio(new URL(path, document.baseURI).href);
    audio.preload = "auto";
    audio.volume = volume;
    audio.loop = loop;
    return audio;
  }

  private clampVolume(volume: number): number {
    if (!Number.isFinite(volume)) return 0;
    return Math.min(1, Math.max(0, volume));
  }

  private playBgm(): void {
    if (!this.unlocked || this.lifecyclePaused || !this.bgm.paused) return;
    void this.bgm.play().catch(() => undefined);
  }

  private tone(
    startFrequency: number,
    endFrequency: number,
    duration: number,
    volume: number,
    type: OscillatorType,
  ): void {
    const context = this.context;
    const effectsGain = this.effectsGain;
    if (!context || !effectsGain) return;

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
    gain.connect(effectsGain);
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
    const effectsGain = this.effectsGain;
    if (!context || !effectsGain) return;

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
    gain.connect(effectsGain);
    source.start(now);
  }
}
