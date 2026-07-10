import { PlayerState } from "./types";

// ずかん (Pokédex) registration helpers. Idempotent; lazily create the arrays
// so older saves without the fields still work.

export function markSeen(ps: PlayerState | undefined | null, id: string): void {
  if (!ps || !id) return;
  if (!ps.seen) ps.seen = [];
  if (!ps.seen.includes(id)) ps.seen.push(id);
}

export function markCaught(ps: PlayerState | undefined | null, id: string): void {
  if (!ps || !id) return;
  markSeen(ps, id);
  if (!ps.caught) ps.caught = [];
  if (!ps.caught.includes(id)) ps.caught.push(id);
}
