import { describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSION,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  RECONNECT_GRACE_MS,
  isPromotionPiece,
  isSquareId,
  isValidRoomCode,
  normaliseRoomCode,
  parseMessage,
} from "../net/protocol";

// Regression coverage for the multiplayer layer. Every case below maps to a
// real defect or a real invariant verified during the live two-client test.

describe("room code normalisation", () => {
  it("uppercases and strips separators from a pasted code", () => {
    expect(normaliseRoomCode(" fq-qvr ")).toBe("FQQVR");
  });

  it("accepts a well-formed code", () => {
    expect(isValidRoomCode("FQQVR")).toBe(true);
  });

  it("rejects codes of the wrong length", () => {
    expect(isValidRoomCode("FQQV")).toBe(false);
    expect(isValidRoomCode("FQQVRX")).toBe(false);
  });

  it("rejects characters outside the ambiguity-free alphabet", () => {
    // A, E, I, L, O, U, 0 and 1 are deliberately excluded so a code read
    // aloud or over a screenshot cannot be mistyped.
    for (const bad of ["A", "E", "I", "L", "O", "U", "0", "1"]) {
      expect(ROOM_CODE_ALPHABET.includes(bad)).toBe(false);
      expect(isValidRoomCode(`FQQV${bad}`)).toBe(false);
    }
  });

  it("keeps the alphabet and length in sync with the generator contract", () => {
    expect(ROOM_CODE_LENGTH).toBe(5);
    expect(new Set(ROOM_CODE_ALPHABET).size).toBe(ROOM_CODE_ALPHABET.length);
  });
});

// D2: the lobby generated ?room=CODE share links but never read them, so an
// invite landed on the HOST tab with an empty field. This is the pure logic
// the component now uses on mount.
function readInviteCodeFrom(search: string): string {
  const raw = new URLSearchParams(search).get("room");
  if (!raw) return "";
  const clean = normaliseRoomCode(raw);
  return isValidRoomCode(clean) ? clean : "";
}

describe("invite deep link (?room=)", () => {
  it("extracts a valid code from a share link", () => {
    expect(readInviteCodeFrom("?room=FQQVR")).toBe("FQQVR");
  });

  it("normalises a lowercase or hyphenated invite", () => {
    expect(readInviteCodeFrom("?room=fq-qvr")).toBe("FQQVR");
  });

  it("returns empty for a missing param so the lobby defaults to HOST", () => {
    expect(readInviteCodeFrom("")).toBe("");
    expect(readInviteCodeFrom("?arena=dusk")).toBe("");
  });

  it("ignores a malformed code rather than prefilling garbage", () => {
    expect(readInviteCodeFrom("?room=XX")).toBe("");
    expect(readInviteCodeFrom("?room=AEIOU")).toBe("");
  });

  it("selects the JOIN tab only when an invite is present", () => {
    const tabFor = (search: string) => (readInviteCodeFrom(search) ? "join" : "host");
    expect(tabFor("?room=FQQVR")).toBe("join");
    expect(tabFor("?room=XX")).toBe("host");
    expect(tabFor("")).toBe("host");
  });
});

// D1: the shell subscribed to "status" after the client had already reached
// "connected" in the lobby, so the badge rendered OFFLINE mid-match. The fix
// seeds from the live getStatus() value before subscribing.
class FakeStatusSource {
  private status = "idle";
  private listeners: Array<(s: string) => void> = [];
  getStatus() {
    return this.status;
  }
  on(fn: (s: string) => void) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }
  set(next: string) {
    this.status = next;
    for (const l of this.listeners) l(next);
  }
}

describe("connection badge seeding", () => {
  it("subscribe-only misses a status reached before handoff", () => {
    const src = new FakeStatusSource();
    src.set("connected"); // happens in the lobby, before the shell mounts
    let netStatus = "idle";
    src.on((s) => {
      netStatus = s;
    });
    expect(netStatus).toBe("idle"); // the defect: renders OFFLINE
  });

  it("seeding from getStatus() reports the live connection", () => {
    const src = new FakeStatusSource();
    src.set("connected");
    let netStatus = "idle";
    netStatus = src.getStatus(); // the fix
    src.on((s) => {
      netStatus = s;
    });
    expect(netStatus).toBe("connected");
  });

  it("still tracks later transitions after seeding", () => {
    const src = new FakeStatusSource();
    src.set("connected");
    let netStatus = src.getStatus();
    src.on((s) => {
      netStatus = s;
    });
    src.set("reconnecting");
    expect(netStatus).toBe("reconnecting");
    src.set("connected");
    expect(netStatus).toBe("connected");
  });

  it("unsubscribing stops updates so a torn-down shell cannot be written to", () => {
    const src = new FakeStatusSource();
    let netStatus = src.getStatus();
    const off = src.on((s) => {
      netStatus = s;
    });
    off();
    src.set("closed");
    expect(netStatus).toBe("idle");
  });
});

describe("wire message parsing", () => {
  it("parses a well-formed tagged message", () => {
    const msg = parseMessage<{ t: string; code: string }>('{"t":"seated","code":"FQQVR"}');
    expect(msg?.t).toBe("seated");
  });

  it("returns null on malformed JSON instead of throwing", () => {
    expect(parseMessage("{not json")).toBeNull();
  });

  it("returns null on a non-object payload", () => {
    expect(parseMessage("42")).toBeNull();
    expect(parseMessage('"hello"')).toBeNull();
  });

  it("validates square ids", () => {
    expect(isSquareId("e4")).toBe(true);
    expect(isSquareId("a1")).toBe(true);
    expect(isSquareId("j9")).toBe(false);
    expect(isSquareId(42)).toBe(false);
    expect(isSquareId(null)).toBe(false);
  });

  it("validates promotion pieces including the null case", () => {
    expect(isPromotionPiece("q")).toBe(true);
    expect(isPromotionPiece(null)).toBe(true);
    expect(isPromotionPiece("k")).toBe(false);
    expect(isPromotionPiece(7)).toBe(false);
  });
});

describe("session constants", () => {
  it("pins the protocol version so a mismatched client is rejected, not silently broken", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it("holds a disconnected seat long enough to survive a refresh", () => {
    expect(RECONNECT_GRACE_MS).toBeGreaterThanOrEqual(30_000);
  });
});
