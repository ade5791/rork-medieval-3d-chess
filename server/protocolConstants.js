// Runtime mirror of the constants in web/src/net/protocol.ts.
//
// The client half is TypeScript compiled by Vite; the server is plain Node ESM
// and cannot import a .ts file without a build step. Rather than add one, the
// handful of VALUES both sides need live here, and a unit test asserts the two
// files agree - so drift fails the test run instead of silently shipping.

export const PROTOCOL_VERSION = 1;
export const ROOM_CODE_ALPHABET = "BCDFGHJKMNPQRSTVWXYZ23456789";
export const ROOM_CODE_LENGTH = 5;
export const RECONNECT_GRACE_MS = 60_000;
export const HEARTBEAT_MS = 15_000;
export const ROOM_IDLE_TTL_MS = 30 * 60_000;
