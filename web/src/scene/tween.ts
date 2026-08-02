/** Tiny promise-based tween engine — no GSAP dependency. */

export type Easing = (t: number) => number;

export const Ease = {
  linear: (t: number): number => t,
  outCubic: (t: number): number => 1 - Math.pow(1 - t, 3),
  inCubic: (t: number): number => t * t * t,
  inOutCubic: (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outQuint: (t: number): number => 1 - Math.pow(1 - t, 5),
  inOutQuart: (t: number): number => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2),
  outBack: (t: number): number => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  outElastic: (t: number): number => {
    if (t === 0 || t === 1) return t;
    const c4 = (2 * Math.PI) / 3;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
  outBounce: (t: number): number => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};

interface ActiveTween {
  elapsed: number;
  duration: number;
  delay: number;
  easing: Easing;
  onUpdate: (value: number) => void;
  onComplete: () => void;
  cancelled: boolean;
}

export class TweenManager {
  private tweens: ActiveTween[] = [];

  to(options: {
    duration: number;
    delay?: number;
    easing?: Easing;
    onUpdate: (value: number) => void;
  }): Promise<void> {
    return new Promise<void>((resolve) => {
      this.tweens.push({
        elapsed: 0,
        duration: Math.max(0.0001, options.duration),
        delay: options.delay ?? 0,
        easing: options.easing ?? Ease.inOutCubic,
        onUpdate: options.onUpdate,
        onComplete: resolve,
        cancelled: false,
      });
    });
  }

  update(delta: number): void {
    if (this.tweens.length === 0) return;
    const finished: ActiveTween[] = [];
    for (const tween of this.tweens) {
      if (tween.cancelled) {
        finished.push(tween);
        continue;
      }
      if (tween.delay > 0) {
        tween.delay -= delta;
        continue;
      }
      tween.elapsed += delta;
      const t = Math.min(1, tween.elapsed / tween.duration);
      tween.onUpdate(tween.easing(t));
      if (t >= 1) finished.push(tween);
    }
    if (finished.length > 0) {
      this.tweens = this.tweens.filter((tween) => !finished.includes(tween));
      for (const tween of finished) tween.onComplete();
    }
  }

  /** Cancels everything in flight (new game, dispose). Pending promises resolve. */
  cancelAll(): void {
    const tweens = this.tweens;
    this.tweens = [];
    for (const tween of tweens) tween.onComplete();
  }
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
