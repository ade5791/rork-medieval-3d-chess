import { useSyncExternalStore } from "react";

import type { GameController } from "../core/gameController";
import type { GameSnapshot } from "../core/types";

/** Subscribes React to the chess core without duplicating any state. */
export function useGameSnapshot(controller: GameController): GameSnapshot {
  return useSyncExternalStore(
    (listener) => controller.on("state", listener),
    () => controller.getSnapshot(),
    () => controller.getSnapshot(),
  );
}
