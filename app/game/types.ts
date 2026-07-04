export interface Warp {
  x: number;
  y: number;
  targetMap: string;
  targetX: number;
  targetY: number;
}

export interface MapData {
  name: string;
  description: string;
  tileSize: number;
  width: number;
  height: number;
  layers: {
    floor: number[][];
    collision: number[][];
  };
  tileTypes: Record<
    string,
    { name: string; color: string; walkable: boolean }
  >;
  playerStart: { x: number; y: number };
  warps?: Warp[];
}

export interface TypeChart {
  types: string[];
  cycles: Record<string, string[]>;
  effectiveness: Record<string, Record<string, number>>;
  description: Record<string, string>;
}
