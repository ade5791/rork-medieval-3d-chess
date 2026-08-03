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

/**
 * The material voice of one footfall. Drives the noise band, the body mode and
 * the ring, so the ear can tell a barefoot footsoldier from a plated guardian.
 */
export type FootstepTimbre = "scuff" | "leather" | "plate" | "regal";

/** One foot meeting the stone. */
export interface FootstepOptions {
  /** -1 hard left … 1 hard right — where the figure is on screen. */
  pan?: number;
  /** Relative loudness. */
  volume?: number;
  /** How the boot is built — see {@link FootstepTimbre}. */
  timbre?: FootstepTimbre;
  /** Seconds to wait before it sounds. */
  delay?: number;
  /** Slight per-step detune so a march never turns into a metronome. */
  jitter?: number;
}

/** Placement of one spell sound in the mix. */
export interface SpellOptions {
  /** -1 hard left … 1 hard right — where the caster or the blast is on screen. */
  pan?: number;
  /** Relative loudness. */
  volume?: number;
  /** Seconds to wait before it sounds. */
  delay?: number;
  /** How long the charge takes to reach full power (charge only). */
  duration?: number;
}

/** Placement of one melee-strike sound in the mix. */
export interface StrikeSoundOptions {
  /** -1 hard left … 1 hard right — where the blow is on screen. */
  pan?: number;
  /** Relative loudness. */
  volume?: number;
  /** Seconds to wait before it sounds. */
  delay?: number;
  /** 0 = a light blade cutting air, 1 = a siege hammer being hauled round. */
  weight?: number;
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

interface FootstepVoice {
  /** Overall loudness of this boot. */
  level: number;
  /** Low body mode — the weight going into the floor, in Hz. */
  body: number;
  /** Peak of the body thump. */
  weight: number;
  /** How long the thump takes to die away. */
  decay: number;
  /** Centre of the noise band — grit, cloth or steel. */
  noise: number;
  /** Sharpness of that band. */
  q: number;
  /** Level of the noise transient. */
  hiss: number;
  /** Length of the scuff in seconds. */
  scuff: number;
  /** Envelope exponent — higher is a shorter, snappier scrape. */
  grit: number;
  /** Level of the metallic afterring (0 for unarmoured feet). */
  ring: number;
  /** Pitch of that ring, in Hz. */
  ringHz: number;
}

/**
 * The four boots that walk this board. Footsoldiers scuff, the clergy creak in
 * leather, the tower guardians clank in full plate, and the crown puts a slow,
 * deep, deliberate weight through every step.
 */
const FOOTSTEP_VOICES: Record<FootstepTimbre, FootstepVoice> = {
  scuff: {
    level: 0.82,
    body: 108,
    weight: 0.2,
    decay: 0.09,
    noise: 1650,
    q: 0.8,
    hiss: 0.5,
    scuff: 0.055,
    grit: 3.2,
    ring: 0,
    ringHz: 0,
  },
  leather: {
    level: 0.9,
    body: 96,
    weight: 0.24,
    decay: 0.11,
    noise: 1180,
    q: 0.7,
    hiss: 0.42,
    scuff: 0.075,
    grit: 2.4,
    ring: 0.03,
    ringHz: 2350,
  },
  plate: {
    level: 1.12,
    body: 72,
    weight: 0.34,
    decay: 0.17,
    noise: 820,
    q: 0.55,
    hiss: 0.34,
    scuff: 0.09,
    grit: 2,
    ring: 0.09,
    ringHz: 3120,
  },
  regal: {
    level: 1.05,
    body: 62,
    weight: 0.32,
    decay: 0.2,
    noise: 940,
    q: 0.6,
    hiss: 0.3,
    scuff: 0.1,
    grit: 2.2,
    ring: 0.055,
    ringHz: 2680,
  },
};

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

  /**
   * One footfall on stone: a short low body thump for the weight, a burst of
   * band-passed noise for the grit under the sole, and — for armour — a thin
   * metallic ring of harness and plate riding on top. Fully synthesised, so a
   * whole march costs nothing to stream and lands exactly on the frame the
   * stride clock asks for.
   */
  footstep(options: FootstepOptions = {}): void {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const timbre = options.timbre ?? "scuff";
    const voice = FOOTSTEP_VOICES[timbre];
    const when = ctx.currentTime + Math.max(0, options.delay ?? 0);
    const jitter = 1 + (options.jitter ?? (Math.random() - 0.5) * 0.16);
    const level = 0.42 * voice.level * (options.volume ?? 1);

    const bus = ctx.createGain();
    bus.gain.value = level;
    if (typeof ctx.createStereoPanner === "function") {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, options.pan ?? 0)) * 0.6;
      bus.connect(panner);
      panner.connect(this.master);
    } else {
      bus.connect(this.master);
    }

    // Weight going through the sole into the floor.
    const thump = ctx.createOscillator();
    const thumpGain = ctx.createGain();
    thump.type = "sine";
    thump.frequency.setValueAtTime(voice.body * jitter, when);
    thump.frequency.exponentialRampToValueAtTime(voice.body * 0.55 * jitter, when + voice.decay);
    thumpGain.gain.setValueAtTime(0.0001, when);
    thumpGain.gain.exponentialRampToValueAtTime(voice.weight, when + 0.006);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, when + voice.decay);
    thump.connect(thumpGain);
    thumpGain.connect(bus);
    thump.start(when);
    thump.stop(when + voice.decay + 0.05);

    // Grit and leather: a fast noise transient shaped by the sole material.
    const length = Math.max(1, Math.floor(ctx.sampleRate * voice.scuff));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, voice.grit);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = voice.noise * jitter;
    band.Q.value = voice.q;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = voice.hiss;
    noise.connect(band);
    band.connect(noiseGain);
    noiseGain.connect(bus);
    noise.start(when);

    // Harness, mail and greaves answering the step.
    if (voice.ring > 0) {
      const ring = ctx.createOscillator();
      const ringGain = ctx.createGain();
      ring.type = "triangle";
      ring.frequency.setValueAtTime(voice.ringHz * jitter, when);
      ringGain.gain.setValueAtTime(0.0001, when + 0.008);
      ringGain.gain.exponentialRampToValueAtTime(voice.ring, when + 0.016);
      ringGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.16);
      ring.connect(ringGain);
      ringGain.connect(bus);
      ring.start(when);
      ring.stop(when + 0.2);
    }
  }

  /**
   * Fire gathering at the head of a staff: two detuned saw voices climbing an
   * octave under a band of noise that opens as the charge builds, so the ear
   * hears the power being pulled in before the bolt leaves.
   */
  spellCharge(options: SpellOptions = {}): void {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const when = ctx.currentTime + Math.max(0, options.delay ?? 0);
    const span = Math.max(0.18, options.duration ?? 0.5);
    const level = 0.2 * (options.volume ?? 1);
    const bus = this.spellBus(options.pan ?? 0, 0.6);

    for (const detune of [1, 1.008, 0.5]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = detune === 0.5 ? "triangle" : "sawtooth";
      osc.frequency.setValueAtTime(96 * detune, when);
      osc.frequency.exponentialRampToValueAtTime(340 * detune, when + span);
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(level * (detune === 0.5 ? 0.7 : 1), when + span * 0.92);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + span + 0.06);
      osc.connect(gain);
      gain.connect(bus);
      osc.start(when);
      osc.stop(when + span + 0.12);
    }

    // Air being dragged into the crystal.
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer(span + 0.1, 0.35);
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 1.4;
    band.frequency.setValueAtTime(420, when);
    band.frequency.exponentialRampToValueAtTime(2600, when + span);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.0001, when);
    noiseGain.gain.exponentialRampToValueAtTime(level * 1.5, when + span * 0.95);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, when + span + 0.08);
    noise.connect(band);
    band.connect(noiseGain);
    noiseGain.connect(bus);
    noise.start(when);
  }

  /** The bolt leaving the staff: a bright snap into a falling whoosh. */
  spellCast(options: SpellOptions = {}): void {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const when = ctx.currentTime + Math.max(0, options.delay ?? 0);
    const level = 0.42 * (options.volume ?? 1);
    const bus = this.spellBus(options.pan ?? 0, 0.7);

    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer(0.42, 1.6);
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 0.9;
    band.frequency.setValueAtTime(3200, when);
    band.frequency.exponentialRampToValueAtTime(380, when + 0.36);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(level, when);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.4);
    noise.connect(band);
    band.connect(noiseGain);
    noiseGain.connect(bus);
    noise.start(when);

    // The kick of it leaving the hand.
    const thump = ctx.createOscillator();
    const thumpGain = ctx.createGain();
    thump.type = "sine";
    thump.frequency.setValueAtTime(220, when);
    thump.frequency.exponentialRampToValueAtTime(58, when + 0.24);
    thumpGain.gain.setValueAtTime(0.0001, when);
    thumpGain.gain.exponentialRampToValueAtTime(level * 0.7, when + 0.01);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.3);
    thump.connect(thumpGain);
    thumpGain.connect(bus);
    thump.start(when);
    thump.stop(when + 0.36);
  }

  /**
   * The bolt landing on a body: a hard crack, a low boom that drops away under
   * it, and a long crackle of fire eating what is left.
   */
  spellImpact(options: SpellOptions = {}): void {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const when = ctx.currentTime + Math.max(0, options.delay ?? 0);
    const level = 0.5 * (options.volume ?? 1);
    const bus = this.spellBus(options.pan ?? 0, 0.45);

    const boom = ctx.createOscillator();
    const boomGain = ctx.createGain();
    boom.type = "sine";
    boom.frequency.setValueAtTime(140, when);
    boom.frequency.exponentialRampToValueAtTime(32, when + 0.5);
    boomGain.gain.setValueAtTime(0.0001, when);
    boomGain.gain.exponentialRampToValueAtTime(level, when + 0.008);
    boomGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.6);
    boom.connect(boomGain);
    boomGain.connect(bus);
    boom.start(when);
    boom.stop(when + 0.7);

    // The crack of the shell breaking open.
    const crack = ctx.createBufferSource();
    crack.buffer = this.noiseBuffer(0.12, 5);
    const snap = ctx.createBiquadFilter();
    snap.type = "highpass";
    snap.frequency.value = 1400;
    const crackGain = ctx.createGain();
    crackGain.gain.value = level * 0.55;
    crack.connect(snap);
    snap.connect(crackGain);
    crackGain.connect(bus);
    crack.start(when);

    // Fire left burning on the stone.
    const fire = ctx.createBufferSource();
    fire.buffer = this.noiseBuffer(0.85, 1.1);
    const body = ctx.createBiquadFilter();
    body.type = "lowpass";
    body.frequency.setValueAtTime(2600, when);
    body.frequency.exponentialRampToValueAtTime(520, when + 0.8);
    const fireGain = ctx.createGain();
    fireGain.gain.setValueAtTime(level * 0.5, when + 0.02);
    fireGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.9);
    fire.connect(body);
    body.connect(fireGain);
    fireGain.connect(bus);
    fire.start(when);
  }

  /**
   * Steel moving through air: a band of noise sweeping down as the swing comes
   * round, with a low gust under it for anything heavy enough to shift weight.
   * `weight` runs from a light blade to a two-handed siege hammer.
   */
  bladeWhoosh(options: StrikeSoundOptions = {}): void {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const when = ctx.currentTime + Math.max(0, options.delay ?? 0);
    const weight = Math.max(0, Math.min(1, options.weight ?? 0.5));
    const level = 0.3 * (options.volume ?? 1);
    const span = 0.22 + weight * 0.16;
    const bus = this.spellBus(options.pan ?? 0, 0.55);

    // The air being cut. A heavier weapon sweeps a lower, longer band.
    const air = ctx.createBufferSource();
    air.buffer = this.noiseBuffer(span + 0.08, 1.4);
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 1.1 + weight * 0.6;
    band.frequency.setValueAtTime(2600 - weight * 900, when);
    band.frequency.exponentialRampToValueAtTime(380 - weight * 180, when + span);
    const airGain = ctx.createGain();
    airGain.gain.setValueAtTime(0.0001, when);
    airGain.gain.exponentialRampToValueAtTime(level, when + span * 0.62);
    airGain.gain.exponentialRampToValueAtTime(0.0001, when + span + 0.06);
    air.connect(band);
    band.connect(airGain);
    airGain.connect(bus);
    air.start(when);

    if (weight <= 0.2) return;
    // Mass being hauled round: a short low gust trailing the swing.
    const gust = ctx.createOscillator();
    const gustGain = ctx.createGain();
    gust.type = "sine";
    gust.frequency.setValueAtTime(150 - weight * 60, when + span * 0.3);
    gust.frequency.exponentialRampToValueAtTime(62 - weight * 18, when + span);
    gustGain.gain.setValueAtTime(0.0001, when + span * 0.3);
    gustGain.gain.exponentialRampToValueAtTime(level * 0.55 * weight, when + span * 0.55);
    gustGain.gain.exponentialRampToValueAtTime(0.0001, when + span + 0.1);
    gust.connect(gustGain);
    gustGain.connect(bus);
    gust.start(when + span * 0.28);
    gust.stop(when + span + 0.16);
  }

  /**
   * A blow that goes through the body and into the floor: a sub-bass drop, the
   * crack of stone giving, and a tail of rubble settling. What the tower
   * guardians and the crown leave behind — never a footsoldier.
   */
  groundSlam(options: StrikeSoundOptions = {}): void {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const when = ctx.currentTime + Math.max(0, options.delay ?? 0);
    const level = 0.46 * (options.volume ?? 1);
    const bus = this.spellBus(options.pan ?? 0, 0.4);

    // The floor taking it.
    for (const [start, end, gain, span] of [
      [96, 26, 1, 0.62],
      [58, 19, 0.55, 0.9],
    ] as const) {
      const sub = ctx.createOscillator();
      const subGain = ctx.createGain();
      sub.type = "sine";
      sub.frequency.setValueAtTime(start, when);
      sub.frequency.exponentialRampToValueAtTime(end, when + span);
      subGain.gain.setValueAtTime(0.0001, when);
      subGain.gain.exponentialRampToValueAtTime(level * gain, when + 0.012);
      subGain.gain.exponentialRampToValueAtTime(0.0001, when + span);
      sub.connect(subGain);
      subGain.connect(bus);
      sub.start(when);
      sub.stop(when + span + 0.08);
    }

    // Stone splitting under the head of the weapon.
    const crack = ctx.createBufferSource();
    crack.buffer = this.noiseBuffer(0.16, 4.5);
    const shape = ctx.createBiquadFilter();
    shape.type = "bandpass";
    shape.Q.value = 0.7;
    shape.frequency.setValueAtTime(900, when);
    shape.frequency.exponentialRampToValueAtTime(240, when + 0.15);
    const crackGain = ctx.createGain();
    crackGain.gain.value = level * 0.7;
    crack.connect(shape);
    shape.connect(crackGain);
    crackGain.connect(bus);
    crack.start(when);

    // Grit and chips coming back down.
    const rubble = ctx.createBufferSource();
    rubble.buffer = this.noiseBuffer(0.55, 2.2);
    const grit = ctx.createBiquadFilter();
    grit.type = "highpass";
    grit.frequency.value = 1800;
    const rubbleGain = ctx.createGain();
    rubbleGain.gain.setValueAtTime(0.0001, when + 0.05);
    rubbleGain.gain.exponentialRampToValueAtTime(level * 0.3, when + 0.1);
    rubbleGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.6);
    rubble.connect(grit);
    grit.connect(rubbleGain);
    rubbleGain.connect(bus);
    rubble.start(when + 0.04);

    this.duckBeds(0.7, 0.7);
  }

  /**
   * The sentence being passed: a struck bell built from inharmonic partials with
   * a slow bloom of air under it. Only the crown gets to ring this.
   */
  judgementToll(options: StrikeSoundOptions = {}): void {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const when = ctx.currentTime + Math.max(0, options.delay ?? 0);
    const level = 0.26 * (options.volume ?? 1);
    const bus = this.spellBus(options.pan ?? 0, 0.35);
    const root = 196;

    // A real bell is not a harmonic series — these ratios are what make it metal.
    const partials: { ratio: number; gain: number; decay: number }[] = [
      { ratio: 0.5, gain: 0.7, decay: 2.6 },
      { ratio: 1, gain: 1, decay: 2.2 },
      { ratio: 2.02, gain: 0.5, decay: 1.6 },
      { ratio: 2.98, gain: 0.28, decay: 1.1 },
      { ratio: 4.07, gain: 0.15, decay: 0.7 },
    ];
    for (const partial of partials) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = root * partial.ratio;
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(level * partial.gain, when + 0.014);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + partial.decay);
      osc.connect(gain);
      gain.connect(bus);
      osc.start(when);
      osc.stop(when + partial.decay + 0.1);
    }

    // Air pulled up around the light.
    const swell = ctx.createBufferSource();
    swell.buffer = this.noiseBuffer(0.9, 0.6);
    const body = ctx.createBiquadFilter();
    body.type = "bandpass";
    body.Q.value = 0.8;
    body.frequency.setValueAtTime(520, when);
    body.frequency.exponentialRampToValueAtTime(2200, when + 0.7);
    const swellGain = ctx.createGain();
    swellGain.gain.setValueAtTime(0.0001, when);
    swellGain.gain.exponentialRampToValueAtTime(level * 0.55, when + 0.5);
    swellGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.95);
    swell.connect(body);
    body.connect(swellGain);
    swellGain.connect(bus);
    swell.start(when);

    this.duckBeds(0.6, 1.1);
  }

  /** Panned input bus shared by the spell voices. */
  private spellBus(pan: number, width: number): GainNode {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) throw new Error("mixer not started");
    const bus = ctx.createGain();
    bus.gain.value = 1;
    if (typeof ctx.createStereoPanner === "function") {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan)) * width;
      bus.connect(panner);
      panner.connect(master);
    } else {
      bus.connect(master);
    }
    return bus;
  }

  /**
   * Decaying white noise of a given length.
   *
   * @param falloff envelope exponent — 1 fades evenly, higher is a sharper burst
   */
  private noiseBuffer(seconds: number, falloff: number): AudioBuffer {
    const ctx = this.ctx;
    if (!ctx) throw new Error("mixer not started");
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, falloff);
    }
    return buffer;
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
