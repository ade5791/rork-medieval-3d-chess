import { AUDIO_URLS, DEATH_CRY_URLS } from "../assets/generated";
import type { Faction, PieceKind } from "../core/types";

type SfxName = "place" | "capture" | "check" | "fanfare";
type BedName = "ambience" | "score" | "tension";

/** How a figure's dying voice is placed in the mix. */
export interface DeathCryOptions {
  /** -1 hard left … 1 hard right — where the body is on screen. */
  pan?: number;
  /** Relative loudness (heavier figures die louder). */
  volume?: number;
  /** Playback-rate jitter so the same figure never dies twice identically. */
  rate?: number;
  /** Seconds to wait before the voice starts, so the blow lands first. */
  delay?: number;
}

/** A wooden piece being lifted from or set down on the board. */
export interface WoodTapOptions {
  /** -1 hard left … 1 hard right — where the square is on screen. */
  pan?: number;
  /** Relative loudness. */
  volume?: number;
  /** 0 = light footsoldier tick, 1 = heavy king set-down (lower, longer ring). */
  weight?: number;
  /** Softer, brighter tick used when a figure is picked up rather than placed. */
  lift?: boolean;
  /** Seconds to wait before it sounds. */
  delay?: number;
}

/** Head-room for the voices so a scream never clips over the score. */
const CRY_VOLUME = 0.85;
/** Simultaneous voices — beyond this the mix turns to mush. */
const MAX_VOICES = 3;
/**
 * The cries are generated as one-second takes, so nothing is time-stretched on
 * playback. This is only a safety net for a clip that comes back slightly long.
 */
const MAX_CRY_SECONDS = 1.15;
/** Ramp-out at the tail so a trimmed clip never clicks. */
const CRY_FADE = 0.1;

interface Bed {
  gain: GainNode;
  source: AudioBufferSourceNode | null;
  target: number;
}

const BED_VOLUME: Record<BedName, number> = {
  ambience: 0.32,
  score: 0.34,
  tension: 0.0,
};

/**
 * Web Audio mixer: three looping beds (ambience / score / tension stem) that
 * crossfade with game intensity, plus one-shot SFX. UI blips are synthesised so
 * every hover does not cost a network asset.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** Music/ambience sub-bus, ducked underneath death cries. */
  private bedBus: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  /** Per-figure death cries keyed `${faction}${kind}`, streamed on demand. */
  private voices = new Map<string, AudioBuffer>();
  private voiceLoads = new Map<string, Promise<void>>();
  private activeVoices = 0;
  private beds = new Map<BedName, Bed>();
  private muted = false;
  private started = false;
  private loading: Promise<void> | null = null;

  get isMuted(): boolean {
    return this.muted;
  }

  /** Must be called from a user gesture (browser autoplay policy). */
  async unlock(): Promise<void> {
    if (!this.ctx) {
      const Ctor: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
      this.bedBus = this.ctx.createGain();
      this.bedBus.gain.value = 1;
      this.bedBus.connect(this.master);
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
    if (!this.loading) this.loading = this.preload();
    await this.loading;
    this.startBeds();
    // Voices only matter on a capture, so they stream in behind the music
    // rather than holding up the first frame of the game.
    void this.primeDeathCries();
  }

  private async preload(): Promise<void> {
    const entries = Object.entries(AUDIO_URLS).filter(([, url]) => url.length > 0);
    await Promise.all(
      entries.map(async ([key, url]) => {
        try {
          const response = await fetch(url);
          const raw = await response.arrayBuffer();
          const ctx = this.ctx;
          if (!ctx) return;
          const buffer = await ctx.decodeAudioData(raw);
          this.buffers.set(key, buffer);
        } catch (error) {
          console.warn(`[audio] could not load "${key}"`, error);
        }
      }),
    );
  }

  private startBeds(): void {
    if (this.started || !this.ctx || !this.master) return;
    this.started = true;
    const layers: { name: BedName; key: keyof typeof AUDIO_URLS }[] = [
      { name: "ambience", key: "ambience" },
      { name: "score", key: "score" },
      { name: "tension", key: "tension" },
    ];
    for (const layer of layers) {
      const buffer = this.buffers.get(layer.key);
      const gain = this.ctx.createGain();
      gain.gain.value = BED_VOLUME[layer.name];
      gain.connect(this.bedBus ?? this.master);
      let source: AudioBufferSourceNode | null = null;
      if (buffer) {
        source = this.ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(gain);
        source.start(0);
      }
      this.beds.set(layer.name, { gain, source, target: BED_VOLUME[layer.name] });
    }
  }

  /** 0 = calm, 1 = check / endgame. Crossfades the tension stem. */
  setIntensity(intensity: number): void {
    if (!this.ctx) return;
    const clamped = Math.max(0, Math.min(1, intensity));
    this.fadeBed("tension", clamped * 0.5, 1.8);
    this.fadeBed("score", 0.34 - clamped * 0.12, 1.8);
  }

  private fadeBed(name: BedName, value: number, seconds: number): void {
    const bed = this.beds.get(name);
    if (!bed || !this.ctx) return;
    bed.target = value;
    const now = this.ctx.currentTime;
    bed.gain.gain.cancelScheduledValues(now);
    bed.gain.gain.setValueAtTime(bed.gain.gain.value, now);
    bed.gain.gain.linearRampToValueAtTime(value, now + seconds);
  }

  play(name: SfxName, volume = 1): void {
    if (!this.ctx || !this.master || this.muted) return;
    const buffer = this.buffers.get(name);
    if (!buffer) return;
    const source = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(this.master);
    source.start(0);
  }

  /** Pulls score and ambience down for a beat so a voice cuts through. */
  private duckBeds(amount: number, seconds: number): void {
    if (!this.bedBus || !this.ctx) return;
    const now = this.ctx.currentTime;
    const gain = this.bedBus.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(amount, now + 0.08);
    gain.linearRampToValueAtTime(1, now + 0.08 + Math.max(0.2, seconds));
  }

  /** Warms every cry in the background once the mixer is alive. */
  private async primeDeathCries(): Promise<void> {
    const factions: Faction[] = ["w", "b"];
    const kinds: PieceKind[] = ["k", "q", "b", "n", "r", "p"];
    for (const faction of factions) {
      await Promise.all(kinds.map((kind) => this.loadDeathCry(faction, kind)));
    }
  }

  private loadDeathCry(faction: Faction, kind: PieceKind): Promise<void> {
    const key = `${faction}${kind}`;
    const pending = this.voiceLoads.get(key);
    if (pending) return pending;
    const url = DEATH_CRY_URLS[faction]?.[kind];
    if (!url) return Promise.resolve();
    const job = (async () => {
      try {
        const response = await fetch(url);
        const raw = await response.arrayBuffer();
        const ctx = this.ctx;
        if (!ctx) {
          // Mixer went away mid-flight — let a later capture try again.
          this.voiceLoads.delete(key);
          return;
        }
        this.voices.set(key, await ctx.decodeAudioData(raw));
      } catch (error) {
        console.warn(`[audio] death cry "${key}" failed to load`, error);
      }
    })();
    this.voiceLoads.set(key, job);
    return job;
  }

  /**
   * The dying voice of one figure: its own recorded cry, panned to where the
   * body is on screen, pitch-jittered, with a short stone-hall tail behind it
   * and the music ducked underneath. Stays silent (and warms the clip for next
   * time) if the sample has not finished streaming in yet.
   */
  deathCry(faction: Faction, kind: PieceKind, options: DeathCryOptions = {}): void {
    if (!this.ctx || !this.master || this.muted) return;
    const buffer = this.voices.get(`${faction}${kind}`);
    if (!buffer) {
      void this.loadDeathCry(faction, kind);
      return;
    }
    if (this.activeVoices >= MAX_VOICES) return;

    const ctx = this.ctx;
    const master = this.master;
    // Played at its natural speed — the sample itself is a one-second take, so
    // the only rate change is the per-rank pitch jitter.
    const rate = options.rate ?? 1;
    const played = Math.min(MAX_CRY_SECONDS, buffer.duration / rate);
    const when = ctx.currentTime + Math.max(0, options.delay ?? 0);
    const level = CRY_VOLUME * (options.volume ?? 1);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;

    // Trim the rumble so the voice sits above the body-fall thump.
    const body = ctx.createBiquadFilter();
    body.type = "highpass";
    body.frequency.value = 165;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, when);
    const fade = Math.min(CRY_FADE, played * 0.4);
    gain.gain.setValueAtTime(level, when + played - fade);
    gain.gain.linearRampToValueAtTime(0.0001, when + played);

    let tail: AudioNode = gain;
    if (typeof ctx.createStereoPanner === "function") {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, options.pan ?? 0)) * 0.7;
      gain.connect(panner);
      tail = panner;
    }
    source.connect(body);
    body.connect(gain);
    tail.connect(master);

    // Cheap slap-back so the scream reads as happening in a big space.
    const echoTone = ctx.createBiquadFilter();
    echoTone.type = "lowpass";
    echoTone.frequency.value = 1900;
    const echo = ctx.createDelay(0.5);
    echo.delayTime.value = 0.13;
    const echoGain = ctx.createGain();
    echoGain.gain.value = level * 0.26;
    gain.connect(echoTone);
    echoTone.connect(echo);
    echo.connect(echoGain);
    echoGain.connect(master);

    this.activeVoices += 1;
    source.onended = () => {
      this.activeVoices = Math.max(0, this.activeVoices - 1);
    };
    source.start(when);
    source.stop(when + played + 0.02);

    this.duckBeds(0.55, played + 0.25);
  }

  /**
   * Synthesised body-fall: a low thump under a short burst of filtered noise,
   * played when a struck figure hits the stone.
   */
  bodyFall(volume = 1): void {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const thump = ctx.createOscillator();
    const thumpGain = ctx.createGain();
    thump.type = "sine";
    thump.frequency.setValueAtTime(120, now);
    thump.frequency.exponentialRampToValueAtTime(42, now + 0.22);
    thumpGain.gain.setValueAtTime(0.34 * volume, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
    thump.connect(thumpGain);
    thumpGain.connect(this.master);
    thump.start(now);
    thump.stop(now + 0.4);

    const length = Math.floor(ctx.sampleRate * 0.25);
    const noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.5);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "lowpass";
    noiseFilter.frequency.value = 900;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.16 * volume;
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.master);
    noise.start(now);
  }

  /**
   * A chess piece meeting the board: the dry click of the base on the surface
   * plus three damped wooden body modes underneath it. Heavier ranks sit lower
   * and ring a touch longer; every tap is pitch-jittered so a game never turns
   * metronomic. Fully synthesised — no asset, no latency.
   */
  woodTap(options: WoodTapOptions = {}): void {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const lift = options.lift === true;
    const weight = Math.max(0, Math.min(1, options.weight ?? 0.5));
    const level = 0.5 * (options.volume ?? 1) * (lift ? 0.55 : 1);
    const when = ctx.currentTime + Math.max(0, options.delay ?? 0);

    // Bus for the whole knock so panning and level happen in one place.
    const bus = ctx.createGain();
    bus.gain.value = level;
    // Wood is warm, not clicky-bright — roll the very top off the whole thing.
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = lift ? 5200 : 4200;
    bus.connect(tone);
    if (typeof ctx.createStereoPanner === "function") {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, options.pan ?? 0)) * 0.55;
      tone.connect(panner);
      panner.connect(this.master);
    } else {
      tone.connect(this.master);
    }

    // Body modes: a fundamental with two inharmonic partials, as a struck block.
    const jitter = 0.94 + Math.random() * 0.12;
    const root = (lift ? 620 : 430 - weight * 165) * jitter;
    const ring = (lift ? 0.085 : 0.13 + weight * 0.075);
    const modes: { ratio: number; gain: number; decay: number }[] = [
      { ratio: 1, gain: 1, decay: 1 },
      { ratio: 2.06, gain: 0.42, decay: 0.62 },
      { ratio: 3.41, gain: 0.19, decay: 0.38 },
    ];
    for (const mode of modes) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      const frequency = root * mode.ratio;
      osc.frequency.setValueAtTime(frequency, when);
      // Tiny downward glide — the pitch of a knock drops as the strike settles.
      osc.frequency.exponentialRampToValueAtTime(frequency * 0.94, when + ring * mode.decay);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(mode.gain, when + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + ring * mode.decay);
      osc.connect(gain);
      gain.connect(bus);
      osc.start(when);
      osc.stop(when + ring + 0.05);
    }

    // The contact itself: a few milliseconds of filtered noise for the "tock".
    const clickLength = Math.max(1, Math.floor(ctx.sampleRate * 0.02));
    const noiseBuffer = ctx.createBuffer(1, clickLength, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < clickLength; i += 1) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / clickLength, 6);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    const click = ctx.createBiquadFilter();
    click.type = "bandpass";
    click.frequency.value = lift ? 2600 : 1750 - weight * 350;
    click.Q.value = 0.9;
    const clickGain = ctx.createGain();
    clickGain.gain.value = lift ? 0.5 : 0.72;
    noise.connect(click);
    click.connect(clickGain);
    clickGain.connect(bus);
    noise.start(when);

    // Only a real set-down puts weight into the table.
    if (!lift) {
      const body = ctx.createOscillator();
      const bodyGain = ctx.createGain();
      body.type = "sine";
      body.frequency.setValueAtTime(150 - weight * 45, when);
      body.frequency.exponentialRampToValueAtTime(78 - weight * 20, when + 0.1);
      bodyGain.gain.setValueAtTime(0.0001, when);
      bodyGain.gain.exponentialRampToValueAtTime(0.22 + weight * 0.2, when + 0.006);
      bodyGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.13 + weight * 0.05);
      body.connect(bodyGain);
      bodyGain.connect(bus);
      body.start(when);
      body.stop(when + 0.25);
    }
  }

  /** Synthesised UI feedback — cheap, instant, no assets. */
  blip(kind: "hover" | "press" | "deny" = "press"): void {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = kind === "deny" ? 700 : 2400;

    if (kind === "hover") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, now);
      gain.gain.setValueAtTime(0.035, now);
    } else if (kind === "press") {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(180, now + 0.09);
      gain.gain.setValueAtTime(0.09, now);
    } else {
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.exponentialRampToValueAtTime(80, now + 0.16);
      gain.gain.setValueAtTime(0.1, now);
    }
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (kind === "hover" ? 0.09 : 0.22));
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!this.master || !this.ctx) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(muted ? 0 : 1, now + 0.35);
  }

  dispose(): void {
    for (const bed of this.beds.values()) bed.source?.stop();
    this.beds.clear();
    this.voices.clear();
    this.voiceLoads.clear();
    this.activeVoices = 0;
    this.bedBus = null;
    void this.ctx?.close();
    this.ctx = null;
  }
}

export const audio = new AudioManager();
