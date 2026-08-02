import type { Difficulty, PieceKind, SquareId } from "../core/types";

interface EngineReply {
  id: number;
  from: SquareId;
  to: SquareId;
  promotion: string | null;
  score: number;
  depth: number;
}

export interface EngineMove {
  from: SquareId;
  to: SquareId;
  promotion: PieceKind | null;
  score: number;
  depth: number;
}

/**
 * Main-thread handle for the search worker. Only one search runs at a time;
 * `cancel()` invalidates any in-flight result (new game, undo, resign).
 */
export class AiClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending: { id: number; resolve: (move: EngineMove | null) => void } | null = null;

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<EngineReply | null>) => {
      const pending = this.pending;
      if (!pending) return;
      const data = event.data;
      if (data && data.id !== pending.id) return;
      this.pending = null;
      pending.resolve(
        data
          ? {
              from: data.from,
              to: data.to,
              promotion: (data.promotion as PieceKind | null) ?? null,
              score: data.score,
              depth: data.depth,
            }
          : null,
      );
    };
    worker.onerror = (event) => {
      console.error("[ai] worker error", event.message);
      const pending = this.pending;
      this.pending = null;
      pending?.resolve(null);
    };
    this.worker = worker;
    return worker;
  }

  bestMove(fen: string, difficulty: Difficulty): Promise<EngineMove | null> {
    this.cancel();
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise<EngineMove | null>((resolve) => {
      this.pending = { id, resolve };
      worker.postMessage({ id, fen, difficulty });
    });
  }

  /** Drops the current request; a late reply is ignored. */
  cancel(): void {
    const pending = this.pending;
    this.pending = null;
    pending?.resolve(null);
  }

  dispose(): void {
    this.cancel();
    this.worker?.terminate();
    this.worker = null;
  }
}
