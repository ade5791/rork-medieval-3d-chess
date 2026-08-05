import { useState } from "react";
import { Clapperboard, Crown, Globe, Swords, Settings as SettingsIcon, Users } from "lucide-react";

import type { DemoOptions, Difficulty, Faction } from "../core/types";
import { Crest } from "./Heraldry";

export interface MatchConfig {
  mode: "ai" | "hotseat" | "demo";
  difficulty: Difficulty;
  playerColor: Faction;
  clockMinutes: number | null;
  demo?: DemoOptions;
}

interface MainMenuProps {
  onStart: (config: MatchConfig) => void;
  /** Opens the online lobby (host / join a hall by code). */
  onPlayOnline: () => void;
  onOpenSettings: () => void;
  attract: boolean;
  onInteract: () => void;
}

const DIFFICULTY_COPY: Record<Difficulty, string> = {
  easy: "Squire — plays fast and loose",
  medium: "Knight — thinks three moves deep",
  hard: "Warlord — full search, no mercy",
};

const DEMO_SPEEDS: { label: string; value: number }[] = [
  { label: "0.5×", value: 0.5 },
  { label: "1×", value: 1 },
  { label: "2×", value: 2 },
  { label: "4×", value: 4 },
];

const CLOCKS: { label: string; value: number | null }[] = [
  { label: "None", value: null },
  { label: "5 min", value: 5 },
  { label: "10 min", value: 10 },
  { label: "15 min", value: 15 },
];

export function MainMenu({ onStart, onPlayOnline, onOpenSettings, attract, onInteract }: MainMenuProps) {
  const [tab, setTab] = useState<"ai" | "hotseat" | "online" | "demo">("ai");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [playerColor, setPlayerColor] = useState<Faction>("w");
  const [clock, setClock] = useState<number | null>(null);
  const [demoWhite, setDemoWhite] = useState<Difficulty>("medium");
  const [demoBlack, setDemoBlack] = useState<Difficulty>("hard");
  const [demoSpeed, setDemoSpeed] = useState(1);
  const [demoLoop, setDemoLoop] = useState(true);

  const start = (): void => {
    if (tab === "online") {
      onPlayOnline();
      return;
    }
    onStart({
      mode: tab,
      difficulty,
      playerColor,
      clockMinutes: tab === "demo" ? null : clock,
      demo: tab === "demo" ? { white: demoWhite, black: demoBlack, speed: demoSpeed, autoRematch: demoLoop } : undefined,
    });
  };

  return (
    <div
      className="mc-menu pointer-events-auto absolute inset-0 flex flex-col items-center justify-center overflow-hidden px-5 py-6"
      onPointerDown={onInteract}
      onPointerMove={onInteract}
    >
      <div className="mc-unfurl mc-menu-hero mb-6 min-h-0 shrink text-center">
        <p className="mc-display text-[0.68rem] tracking-[0.55em] text-[#c8ab74]">Anno Domini MCDXCII</p>
        <h1 className="mc-display mc-title-glow mt-2 text-5xl font-bold text-[#f4e3bd] sm:text-6xl">
          KING&apos;S GAMBIT
        </h1>
        <div className="mc-rule mx-auto mt-3 w-64" />
        <p className="mt-3 text-sm italic text-[#c5b28d]">
          {attract ? "A showcase duel is under way — move to take the hall" : "Chess in the great hall of Aldermoor"}
        </p>
      </div>

      <div className="mc-slate mc-goldleaf mc-rise flex max-h-full w-full min-h-0 max-w-md flex-col p-5 sm:p-6">
        <div className="mb-5 grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4">
          <button
            type="button"
            className="mc-chip flex items-center justify-center gap-1.5 px-1 py-3"
            data-active={tab === "ai"}
            onClick={() => setTab("ai")}
          >
            <Swords size={14} /> Computer
          </button>
          <button
            type="button"
            className="mc-chip flex items-center justify-center gap-1.5 px-1 py-3"
            data-active={tab === "hotseat"}
            onClick={() => setTab("hotseat")}
          >
            <Users size={14} /> 2 Players
          </button>
          <button
            type="button"
            className="mc-chip flex items-center justify-center gap-1.5 px-1 py-3"
            data-active={tab === "online"}
            onClick={() => setTab("online")}
          >
            <Globe size={14} /> Online
          </button>
          <button
            type="button"
            className="mc-chip flex items-center justify-center gap-1.5 px-1 py-3"
            data-active={tab === "demo"}
            onClick={() => setTab("demo")}
          >
            <Clapperboard size={14} /> Showcase
          </button>
        </div>

        <div className="mc-scroll -mr-2 min-h-0 flex-auto overflow-y-auto pr-2">
        {tab === "ai" ? (
          <div className="mc-fade space-y-5">
            <div>
              <p className="mc-display mb-2 text-[0.62rem] tracking-[0.3em] text-[#a89268]">Opponent</p>
              <div className="grid grid-cols-3 gap-2">
                {(["easy", "medium", "hard"] as Difficulty[]).map((level) => (
                  <button
                    key={level}
                    type="button"
                    className="mc-chip py-2.5"
                    data-active={difficulty === level}
                    onClick={() => setDifficulty(level)}
                  >
                    {level}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs italic text-[#9c8b6c]">{DIFFICULTY_COPY[difficulty]}</p>
            </div>

            <div>
              <p className="mc-display mb-2 text-[0.62rem] tracking-[0.3em] text-[#a89268]">Your banner</p>
              <div className="grid grid-cols-2 gap-2">
                {(["w", "b"] as Faction[]).map((color) => (
                  <button
                    key={color}
                    type="button"
                    className="mc-chip flex items-center justify-center gap-2 py-2.5"
                    data-active={playerColor === color}
                    onClick={() => setPlayerColor(color)}
                  >
                    <Crest faction={color} size={18} active={playerColor === color} />
                    {color === "w" ? "Ivory" : "Obsidian"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : tab === "hotseat" ? (
          <p className="mc-fade text-sm italic leading-relaxed text-[#b7a88a]">
            Two commanders, one board. The camera swings to the player on move — you can disable that in settings.
          </p>
        ) : tab === "online" ? (
          <div className="mc-fade space-y-3">
            <p className="text-sm italic leading-relaxed text-[#b7a88a]">
              Duel a friend across the world. Open a hall and send them the five-character code, or ride to theirs.
            </p>
            <p className="text-xs italic leading-relaxed text-[#9c8b6c]">
              The relay keeps the board honest — every move is checked before it reaches your opponent. Lose your
              connection and your seat is held for a minute while you ride back.
            </p>
          </div>
        ) : (
          <div className="mc-fade space-y-5">
            <p className="text-sm italic leading-relaxed text-[#b7a88a]">
              Two engines duel on their own while the camera drifts around the hall — made for capturing footage. Press{" "}
              <span className="mc-display text-[#e2c98f]">C</span> in the match to hide the whole interface.
            </p>

            <div>
              <p className="mc-display mb-2 text-[0.62rem] tracking-[0.3em] text-[#a89268]">Ivory engine</p>
              <div className="grid grid-cols-3 gap-2">
                {(["easy", "medium", "hard"] as Difficulty[]).map((level) => (
                  <button
                    key={level}
                    type="button"
                    className="mc-chip py-2.5"
                    data-active={demoWhite === level}
                    onClick={() => setDemoWhite(level)}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mc-display mb-2 text-[0.62rem] tracking-[0.3em] text-[#a89268]">Obsidian engine</p>
              <div className="grid grid-cols-3 gap-2">
                {(["easy", "medium", "hard"] as Difficulty[]).map((level) => (
                  <button
                    key={level}
                    type="button"
                    className="mc-chip py-2.5"
                    data-active={demoBlack === level}
                    onClick={() => setDemoBlack(level)}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mc-display mb-2 text-[0.62rem] tracking-[0.3em] text-[#a89268]">Pace</p>
              <div className="grid grid-cols-4 gap-2">
                {DEMO_SPEEDS.map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    className="mc-chip py-2.5"
                    data-active={demoSpeed === option.value}
                    onClick={() => setDemoSpeed(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              className="mc-chip flex w-full items-center justify-between px-3 py-2.5"
              data-active={demoLoop}
              onClick={() => setDemoLoop((loop) => !loop)}
              aria-pressed={demoLoop}
            >
              <span>Loop new duels</span>
              <span className="mc-display text-[0.62rem] tracking-[0.24em]">{demoLoop ? "ON" : "OFF"}</span>
            </button>
          </div>
        )}

        {tab === "demo" || tab === "online" ? null : (
          <div className="mt-5">
            <p className="mc-display mb-2 text-[0.62rem] tracking-[0.3em] text-[#a89268]">Hourglass</p>
            <div className="grid grid-cols-4 gap-2">
              {CLOCKS.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  className="mc-chip py-2.5"
                  data-active={clock === option.value}
                  onClick={() => setClock(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}
        </div>

        <div className="mc-panel-foot shrink-0">
        <button
          type="button"
          className="mc-btn mc-btn-primary mt-5 flex w-full items-center justify-center gap-2 py-3.5 text-sm"
          onClick={start}
        >
          {tab === "demo" ? (
            <>
              <Clapperboard size={16} /> Roll the showcase
            </>
          ) : tab === "online" ? (
            <>
              <Globe size={16} /> Enter the lobby
            </>
          ) : (
            <>
              <Crown size={16} /> Take the field
            </>
          )}
        </button>

        <button
          type="button"
          className="mc-btn mt-2 flex w-full items-center justify-center gap-2"
          onClick={onOpenSettings}
        >
          <SettingsIcon size={15} /> Settings
        </button>
        </div>
      </div>

      <p className="mc-menu-hint mt-5 shrink-0 text-[0.68rem] tracking-[0.2em] text-[#7d6f57]">
        DRAG TO ORBIT · SCROLL TO ZOOM · CLICK A FIGURE TO COMMAND IT
      </p>
    </div>
  );
}
