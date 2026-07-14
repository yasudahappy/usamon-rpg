import { MonsterInstance, MoveData } from "./types";

/** わざの最大PP（データから）。未知なら 20。 */
export function moveMaxPP(moveId: string, allMoves: MoveData[]): number {
  return allMoves.find((m) => m.id === moveId)?.pp ?? 20;
}

/** インスタンスのPP配列を moves と同じ長さにそろえる（既存値は保持し、
 *  足りない分は最大PPで補完）。冪等。 */
export function ensureInstancePP(inst: MonsterInstance, allMoves: MoveData[]): void {
  const cur = inst.pp || [];
  inst.pp = inst.moves.map((id, i) =>
    typeof cur[i] === "number" ? cur[i] : moveMaxPP(id, allMoves)
  );
}

/** 全わざのPPを最大まで回復。 */
export function restorePP(inst: MonsterInstance, allMoves: MoveData[]): void {
  inst.pp = inst.moves.map((id) => moveMaxPP(id, allMoves));
}
