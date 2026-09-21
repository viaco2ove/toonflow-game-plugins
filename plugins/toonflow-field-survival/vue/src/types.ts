/**
 * 与后端 entry.ts 共享的状态类型（结构对齐 FieldSurvivalState）
 */
export interface Enemy {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  attack: number;
  type: "beast" | "boss";
}

export interface GameState {
  hp: number;
  hunger: number;
  thirst: number;
  day: number;
  wave: number;
  enemies: Enemy[];
  inventory: string[];
  score: number;
  alive: boolean;
  events: string[];
}

export interface HandleResult {
  code: number;
  message: string;
  state: GameState;
  response?: string;
  actions?: string[];
}