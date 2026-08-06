import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Check, Globe, Loader2, LogIn, Swords, X } from "lucide-react";

import type { Faction } from "../core/types";
import { OnlineClient, relayAvailable, type ConnectionStatus } from "../net/onlineClient";
import { isValidRoomCode, normaliseRoomCode, type SeatPreference } from "../net/protocol";
import { Crest } from "./Heraldry";

export interface OnlineSession {
  client: OnlineClient;
  code: string;
  color: Faction;
}

interface OnlineLobbyProps {
  /** Fires once a seat is confirmed by the relay. */
  onSeated: (session: OnlineSession) => void;
  onClose: () => void;
}

const CLOCKS: { label: string; value: number | null }[] = [
  { label: "None", value: null },
  { label: "5 min", value: 5 },
  { label: "10 min", value: 10 },
  { label: "15 min", value: 15 },
];

const STATUS_COPY: Record<ConnectionStatus, string> = {
  idle: "",
  connecting: "Sending a rider to the relay...",
  connected: "Connected",
  reconnecting: "The line went quiet - riding back...",
  closed: "Disconnected",
  error: "The relay refused the request",
};

function readStoredName(): string {
  try {
    return localStorage.getItem("kg.online.name") ?? "";
  } catch {
    return "";
  }
}

function readInviteCode(): string {
  try {
    const raw = new URLSearchParams(window.location.search).get("room");
    if (!raw) return "";
    const clean = normaliseRoomCode(raw);
    return isValidRoomCode(clean) ? clean : "";
  } catch {
    return "";
  }
}

export function OnlineLobby({ onSeated, onClose }: OnlineLobbyProps) {
  const invite = useMemo(readInviteCode, []);
  const [tab, setTab] = useState<"host" | "join">(invite ? "join" : "host");
  const [name, setName] = useState(readStoredName);
  const [seat, setSeat] = useState<SeatPreference>("random");
  const [clock, setClock] = useState<number | null>(10);
  const [code, setCode] = useState(invite);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [detail, setDetail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hosted, setHosted] = useState<{ code: string; color: Faction } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const client = useMemo(() => new OnlineClient(), []);
  /** Static deployments (GitHub Pages) ship no relay - warn before a click. */
  const noRelay = useMemo(() => !relayAvailable(), []);
  const seatedRef = useRef(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The lobby owns the client only until a seat is confirmed; after that the
  // shell takes it over. Disposing here would kill a live game, so the guard
  // is a ref rather than state.
  useEffect(() => {
    const offStatus = client.on("status", (payload) => {
      setStatus(payload.status);
      setDetail(payload.detail);
      if (payload.status === "connected") setError(null);
    });

    const offSeated = client.on("seated", ({ code: roomCode, color }) => {
      setHosted({ code: roomCode, color });
      setBusy(false);
      setError(null);
      // A hosted room waits in the lobby so the code can be read and shared;
      // a joiner goes straight to the board.
      const state = client.getSeat();
      if (state && tabRef.current === "join") {
        seatedRef.current = true;
        onSeated({ client, code: roomCode, color });
      }
    });

    const offFailed = client.on("failed", ({ message }) => {
      setError(message);
      setBusy(false);
    });

    return () => {
      offStatus();
      offSeated();
      offFailed();
      if (copyTimer.current) clearTimeout(copyTimer.current);
      if (!seatedRef.current) client.dispose();
    };
  }, [client, onSeated]);

  // The seated handler needs the CURRENT tab without re-subscribing each render.
  const tabRef = useRef(tab);
  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);

  // Once a hosted room has a second player the relay sends state; the host
  // enters the board when it sees two players seated.
  useEffect(() => {
    if (!hosted) return;
    const off = client.on("state", (state) => {
      if (state.players.length < 2 || seatedRef.current) return;
      seatedRef.current = true;
      onSeated({ client, code: hosted.code, color: hosted.color });
    });
    return off;
  }, [client, hosted, onSeated]);

  const persistName = useCallback((value: string) => {
    setName(value);
    try {
      localStorage.setItem("kg.online.name", value);
    } catch {
      /* private mode */
    }
  }, []);

  const host = useCallback(() => {
    setError(null);
    setBusy(true);
    client.host(name.trim() || "Challenger", seat, clock);
  }, [client, name, seat, clock]);

  const join = useCallback(() => {
    const clean = normaliseRoomCode(code);
    if (!isValidRoomCode(clean)) {
      setError("A hall code is five letters and numbers.");
      return;
    }
    setError(null);
    setBusy(true);
    client.join(name.trim() || "Challenger", clean);
  }, [client, name, code]);

  const copyCode = useCallback(() => {
    if (!hosted) return;
    const share = `${window.location.origin}${window.location.pathname}?room=${hosted.code}`;
    void navigator.clipboard
      ?.writeText(share)
      .then(() => {
        setCopied(true);
        if (copyTimer.current) clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => setError("Could not reach the clipboard - copy the code by hand."));
  }, [hosted]);

  const connecting = status === "connecting" || status === "reconnecting";

  return (
    <div className="mc-menu pointer-events-auto absolute inset-0 z-30 flex flex-col items-center justify-center overflow-hidden px-5 py-6">
      <div className="mc-slate mc-goldleaf mc-rise flex max-h-full w-full min-h-0 max-w-md flex-col p-5 sm:p-6">
        <div className="mb-4 flex shrink-0 items-center justify-between">
          <h2 className="mc-display flex items-center gap-2 text-sm tracking-[0.28em] text-[#f0dfb6]">
            <Globe size={15} /> ONLINE DUEL
          </h2>
          <button type="button" className="mc-chip px-2 py-1.5" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>
        {noRelay ? (
          <p className="mb-3 shrink-0 rounded border border-[#8a6d3b]/40 bg-[#3a2d18]/40 px-3 py-2 text-xs leading-relaxed text-[#d9c489]">
            This hosted build has no relay server, so online duels cannot connect here.
            Computer and 2 Players work fully. For online play, run the game locally with
            its relay (see the repository README).
          </p>
        ) : null}

        {hosted ? (
          <div className="mc-fade space-y-5">
            <div className="text-center">
              <p className="mc-display mb-2 text-[0.62rem] tracking-[0.3em] text-[#a89268]">
                YOUR HALL CODE
              </p>
              <p className="mc-display mc-title-glow text-5xl tracking-[0.35em] text-[#f4e3bd]">
                {hosted.code}
              </p>
              <div className="mc-rule mx-auto mt-3 w-40" />
            </div>

            <button
              type="button"
              className="mc-btn flex w-full items-center justify-center gap-2 py-3"
              onClick={copyCode}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? "Link copied" : "Copy invite link"}
            </button>

            <div className="flex items-center justify-center gap-2 text-sm text-[#b7a88a]">
              <Crest faction={hosted.color} size={18} active />
              You command the {hosted.color === "w" ? "Ivory" : "Obsidian"} army
            </div>

            <div className="flex items-center justify-center gap-2 text-xs italic text-[#9c8b6c]">
              <Loader2 size={13} className="animate-spin" />
              Awaiting your opponent...
            </div>
          </div>
        ) : (
          <>
            <div className="mb-5 grid shrink-0 grid-cols-2 gap-2">
              <button
                type="button"
                className="mc-chip flex items-center justify-center gap-1.5 px-1 py-3"
                data-active={tab === "host"}
                onClick={() => setTab("host")}
              >
                <Swords size={14} /> Host
              </button>
              <button
                type="button"
                className="mc-chip flex items-center justify-center gap-1.5 px-1 py-3"
                data-active={tab === "join"}
                onClick={() => setTab("join")}
              >
                <LogIn size={14} /> Join
              </button>
            </div>

            <div className="mc-scroll -mr-2 min-h-0 flex-auto space-y-5 overflow-y-auto pr-2">
              <div>
                <p className="mc-display mb-2 text-[0.62rem] tracking-[0.3em] text-[#a89268]">
                  Your name
                </p>
                <input
                  className="mc-input w-full px-3 py-2.5 text-sm"
                  value={name}
                  maxLength={20}
                  placeholder="Challenger"
                  onChange={(event) => persistName(event.target.value)}
                />
              </div>

              {tab === "host" ? (
                <div className="mc-fade space-y-5">
                  <div>
                    <p className="mc-display mb-2 text-[0.62rem] tracking-[0.3em] text-[#a89268]">
                      Your banner
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      {(["w", "b", "random"] as SeatPreference[]).map((option) => (
                        <button
                          key={option}
                          type="button"
                          className="mc-chip flex items-center justify-center gap-1.5 py-2.5"
                          data-active={seat === option}
                          onClick={() => setSeat(option)}
                        >
                          {option !== "random" ? (
                            <Crest faction={option} size={16} active={seat === option} />
                          ) : null}
                          {option === "w" ? "Ivory" : option === "b" ? "Obsidian" : "Random"}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="mc-display mb-2 text-[0.62rem] tracking-[0.3em] text-[#a89268]">
                      Hourglass
                    </p>
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
                </div>
              ) : (
                <div className="mc-fade space-y-3">
                  <p className="mc-display mb-2 text-[0.62rem] tracking-[0.3em] text-[#a89268]">
                    Hall code
                  </p>
                  <input
                    className="mc-input mc-display w-full px-3 py-3 text-center text-2xl tracking-[0.4em]"
                    value={code}
                    maxLength={5}
                    placeholder="ABCDE"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    onChange={(event) => setCode(normaliseRoomCode(event.target.value))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") join();
                    }}
                  />
                  <p className="text-xs italic text-[#9c8b6c]">
                    Ask your opponent for the five-character code from their hall.
                  </p>
                </div>
              )}
            </div>

            <div className="mc-panel-foot shrink-0">
              {error ? (
                <p className="mt-4 text-center text-xs text-[#d98a6a]">{error}</p>
              ) : connecting ? (
                <p className="mt-4 text-center text-xs italic text-[#9c8b6c]">
                  {detail ?? STATUS_COPY[status]}
                </p>
              ) : null}

              <button
                type="button"
                className="mc-btn mc-btn-primary mt-4 flex w-full items-center justify-center gap-2 py-3.5 text-sm disabled:opacity-50"
                disabled={busy || (tab === "join" && !isValidRoomCode(code))}
                onClick={tab === "host" ? host : join}
              >
                {busy ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> Opening the hall...
                  </>
                ) : tab === "host" ? (
                  <>
                    <Swords size={16} /> Open a hall
                  </>
                ) : (
                  <>
                    <LogIn size={16} /> Ride to the hall
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
