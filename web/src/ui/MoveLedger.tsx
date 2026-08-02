import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, ScrollText, Type } from "lucide-react";

import { audio } from "../audio/audioManager";
import type { Faction, GameResult, LedgerMove } from "../core/types";
import { pieceGlyph } from "./Heraldry";

interface MoveLedgerProps {
  moves: LedgerMove[];
  pgn: string;
  result: GameResult | null;
  turn: Faction;
  thinking: boolean;
  playing: boolean;
  /** Fires on hover/tap of a recorded move so the board can light those squares. */
  onPreview: (move: LedgerMove | null) => void;
}

interface LedgerRow {
  number: number;
  white: LedgerMove | null;
  black: LedgerMove | null;
}

const FIGURINES: Record<string, string> = {
  K: pieceGlyph("k"),
  Q: pieceGlyph("q"),
  R: pieceGlyph("r"),
  B: pieceGlyph("b"),
  N: pieceGlyph("n"),
};

/** Splits SAN into a leading piece figurine, the body, and the check/mate suffix. */
function splitSan(san: string): { figurine: string | null; body: string; suffix: string } {
  const match = /([+#])$/.exec(san);
  const suffix = match ? match[1] : "";
  const core = suffix ? san.slice(0, -1) : san;
  const head = core[0];
  if (head && FIGURINES[head] && !core.startsWith("O-O")) {
    return { figurine: FIGURINES[head], body: core.slice(1), suffix };
  }
  return { figurine: null, body: core, suffix };
}

function resultToken(result: GameResult | null): string | null {
  if (!result) return null;
  if (result.winner === "w") return "1 – 0";
  if (result.winner === "b") return "0 – 1";
  return "½ – ½";
}

export const MoveLedger = memo(function MoveLedger({
  moves,
  pgn,
  result,
  turn,
  thinking,
  playing,
  onPreview,
}: MoveLedgerProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  const [figurine, setFigurine] = useState(true);
  const [copied, setCopied] = useState(false);
  const [activePly, setActivePly] = useState<number | null>(null);

  const rows = useMemo<LedgerRow[]>(() => {
    const out: LedgerRow[] = [];
    for (const move of moves) {
      const last = out[out.length - 1];
      if (move.color === "w" || !last || last.black !== null) {
        out.push({ number: move.number, white: move.color === "w" ? move : null, black: move.color === "b" ? move : null });
      } else {
        last.black = move;
      }
    }
    return out;
  }, [moves]);

  // Stay glued to the newest move unless the player has scrolled back through
  // the record themselves.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || !pinnedRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, [rows.length, turn]);

  const handleScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    pinnedRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 28;
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  // Drop any board preview when the ledger unmounts or a new move lands.
  useEffect(() => {
    setActivePly(null);
    onPreview(null);
  }, [moves.length, onPreview]);

  useEffect(() => () => onPreview(null), [onPreview]);

  const copyPgn = useCallback(() => {
    if (!pgn) return;
    audio.blip("press");
    void navigator.clipboard
      .writeText(pgn)
      .then(() => setCopied(true))
      .catch((error: unknown) => console.warn("[ui] clipboard refused the record", error));
  }, [pgn]);

  const hover = useCallback(
    (move: LedgerMove | null) => {
      onPreview(move);
    },
    [onPreview],
  );

  const pick = useCallback(
    (move: LedgerMove) => {
      const next = activePly === move.ply ? null : move.ply;
      setActivePly(next);
      audio.blip(next === null ? "hover" : "press");
      onPreview(next === null ? null : move);
    },
    [activePly, onPreview],
  );

  const lastPly = moves.length - 1;
  const token = resultToken(result);

  return (
    <div className="mc-slate mc-goldleaf flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-[#8a652233] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <ScrollText size={13} className="text-[#a89268]" />
          <p className="mc-display text-[0.58rem] tracking-[0.3em] text-[#a89268]">Ledger</p>
        </div>
        <div className="flex items-center gap-1">
          <span className="mc-display mr-1 text-[0.56rem] tracking-[0.18em] text-[#6f6450]">{moves.length} ply</span>
          <button
            type="button"
            className="mc-ledger-tool"
            title={figurine ? "Show letter notation (Nf3)" : "Show figurine notation (♞f3)"}
            aria-label="Toggle notation style"
            data-active={!figurine}
            onClick={() => {
              audio.blip("hover");
              setFigurine((value) => !value);
            }}
          >
            {figurine ? <Type size={12} /> : <span className="text-[0.78rem] leading-none">♞</span>}
          </button>
          <button
            type="button"
            className="mc-ledger-tool"
            title="Copy the game record (PGN)"
            aria-label="Copy PGN"
            disabled={!pgn}
            onClick={copyPgn}
          >
            {copied ? <Check size={12} className="text-[#8fe0a8]" /> : <Copy size={12} />}
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="mc-history mc-ledger flex-1 overflow-y-auto px-2 py-1.5"
        onPointerLeave={() => hover(activePly === null ? null : (moves[activePly] ?? null))}
      >
        {rows.length === 0 ? (
          <p className="px-2 py-8 text-center text-xs italic leading-relaxed text-[#7d6f57]">
            The scribe waits.
            <br />
            No moves recorded yet.
          </p>
        ) : (
          <>
            {rows.map((row, index) => (
              <div key={row.number} className="mc-ledger-row" style={{ animationDelay: `${Math.min(index, 6) * 18}ms` }}>
                <span className="mc-ledger-no">{row.number}</span>
                <MoveCell
                  move={row.white}
                  figurine={figurine}
                  isLast={row.white?.ply === lastPly}
                  isActive={row.white?.ply === activePly}
                  onHover={hover}
                  onPick={pick}
                  pending={playing && row.white === null && turn === "w"}
                  thinking={thinking}
                />
                <MoveCell
                  move={row.black}
                  figurine={figurine}
                  isLast={row.black?.ply === lastPly}
                  isActive={row.black?.ply === activePly}
                  onHover={hover}
                  onPick={pick}
                  pending={playing && row.black === null && turn === "b"}
                  thinking={thinking}
                />
              </div>
            ))}
            {playing && turn === "w" ? (
              <div className="mc-ledger-row">
                <span className="mc-ledger-no">{rows.length + 1}</span>
                <MoveCell
                  move={null}
                  figurine={figurine}
                  isLast={false}
                  isActive={false}
                  onHover={hover}
                  onPick={pick}
                  pending
                  thinking={thinking}
                />
                <span />
              </div>
            ) : null}
          </>
        )}
      </div>

      {token ? (
        <div className="border-t border-[#8a652233] px-3 py-2 text-center">
          <p className="mc-display mc-ledger-result text-[0.92rem] tracking-[0.22em] text-[#f2dcaa]">{token}</p>
          <p className="text-[0.62rem] italic tracking-wide text-[#8d7d61]">by {result?.reason}</p>
        </div>
      ) : null}
    </div>
  );
});

interface MoveCellProps {
  move: LedgerMove | null;
  figurine: boolean;
  isLast: boolean;
  isActive: boolean;
  pending: boolean;
  thinking: boolean;
  onHover: (move: LedgerMove | null) => void;
  onPick: (move: LedgerMove) => void;
}

function MoveCell({ move, figurine, isLast, isActive, pending, thinking, onHover, onPick }: MoveCellProps) {
  if (!move) {
    return pending ? (
      <span className="mc-ledger-pending" aria-label={thinking ? "Opponent is thinking" : "Awaiting move"}>
        <i />
        <i />
        <i />
      </span>
    ) : (
      <span />
    );
  }

  const { figurine: glyph, body, suffix } = splitSan(move.san);

  return (
    <button
      type="button"
      className="mc-ledger-move"
      data-last={isLast || undefined}
      data-active={isActive || undefined}
      data-side={move.color}
      title={`${move.san} — ${move.from} → ${move.to}`}
      onPointerEnter={() => onHover(move)}
      onFocus={() => onHover(move)}
      onClick={() => onPick(move)}
    >
      {glyph && figurine ? <span className="mc-ledger-glyph">{glyph}</span> : null}
      <span>{glyph && !figurine ? `${sanLetter(move.san)}${body}` : body}</span>
      {suffix ? <span className={suffix === "#" ? "mc-ledger-mate" : "mc-ledger-check"}>{suffix}</span> : null}
      {move.promotion ? <span className="mc-ledger-promo">{pieceGlyph(move.promotion)}</span> : null}
    </button>
  );
}

function sanLetter(san: string): string {
  return san[0];
}
