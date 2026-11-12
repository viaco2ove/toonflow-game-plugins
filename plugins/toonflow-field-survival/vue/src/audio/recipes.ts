/**
 * recipes.ts —— 音效配方表（纯数据，无素材文件）
 * ==================================================
 * 设计要点：
 *   1. 采用 WebAudio **实时程序化合成**，不引入任何 .mp3/.wav 素材。
 *      理由：零素材成本、零产物体积膨胀（产物是单文件 ui/game.html）、
 *      天然可随机化变体（重复触发不腻）、不受宿主 getAsset 查询串敏感问题影响。
 *   2. 配方表只放**跨地图通用**的功能性音效。
 *      任何带剧情/地图语义的专属音效由地图集通过 ctx.audio.register() 注入
 *      （遵守「插件只提供通用能力，地图集自行管理业务数据」的边界约定）。
 */

/** 音效分组（对应设置面板的分组音量） */
export type SoundGroup = "ui" | "move" | "combat" | "item" | "skill" | "system";

export const SOUND_GROUPS: { id: SoundGroup; label: string }[] = [
  { id: "ui", label: "界面音" },
  { id: "move", label: "移动/脚步" },
  { id: "combat", label: "战斗" },
  { id: "item", label: "物品/拾取" },
  { id: "skill", label: "技能" },
  { id: "system", label: "环境/系统" },
];

/** 波形 */
export type SoundWave = "sine" | "square" | "sawtooth" | "triangle" | "noise";

export interface SoundRecipe {
  /** 分组 */
  group: SoundGroup;
  /** 合成波形（noise = 白噪声） */
  wave?: SoundWave;
  /** 起始频率 Hz */
  freq?: number;
  /** 结束频率 Hz（做滑音，>freq 为上行） */
  toFreq?: number;
  /** 时长 ms */
  dur?: number;
  /** 峰值增益 0~1（还要乘主音量 × 分组音量） */
  gain?: number;
  /** 噪声占比 0~1（与 wave 混合，wave 缺省时纯噪声） */
  noise?: number;
  /** 延迟 ms（用于「先后两声」的复合音） */
  delay?: number;
  /** 音高随机化 ±比例（0.05 = ±5%），避免重复触发听觉疲劳 */
  detune?: number;
  /** 播放次数（>1 时按 dur 间隔重复，用于颤音） */
  repeat?: number;
}

/**
 * 配方表。
 * key 命名规范：<域>_<动作>，纯小写下划线。
 */
export const SOUND_RECIPES: Record<string, SoundRecipe> = {
  /* ---------------- UI ---------------- */
  /** 面板按钮点击（全局最通用，挂在所有按钮上） */
  ui_click: { group: "ui", wave: "square", freq: 1200, toFreq: 900, dur: 45, gain: 0.22 },
  /** 打开面板 */
  ui_open: { group: "ui", wave: "triangle", freq: 400, toFreq: 900, dur: 130, gain: 0.24 },
  /** 关闭面板 */
  ui_close: { group: "ui", wave: "triangle", freq: 900, toFreq: 400, dur: 130, gain: 0.24 },
  /** 切换页签（比 ui_click 更轻） */
  ui_tab: { group: "ui", wave: "square", freq: 1700, dur: 30, gain: 0.14 },
  /** 非法操作 / 冷却中 / 资源不足 */
  ui_error: { group: "ui", wave: "square", freq: 220, toFreq: 160, dur: 90, gain: 0.2, repeat: 2 },
  /** 提示/确认（轻） */
  ui_notify: { group: "ui", wave: "sine", freq: 880, dur: 70, gain: 0.16 },

  /* ---------------- 拾取 / 物品 ---------------- */
  /** 拾取可拾取物（onPickupConfirm） */
  pickup: { group: "item", wave: "triangle", freq: 700, toFreq: 1100, dur: 170, gain: 0.26 },
  /** 使用消耗品 */
  item_use: { group: "item", wave: "sine", freq: 520, toFreq: 780, dur: 150, gain: 0.22 },
  /** 放入背包 */
  item_add: { group: "item", wave: "sine", freq: 780, toFreq: 520, dur: 130, gain: 0.18 },
  /** 购买成功（硬币声：两段高频噪声） */
  shop_buy: { group: "item", wave: "noise", noise: 1, freq: 2400, dur: 45, gain: 0.14, repeat: 2 },
  /** 锻造/炼丹成功 */
  craft_success: { group: "item", wave: "triangle", freq: 660, toFreq: 1320, dur: 320, gain: 0.24, repeat: 3 },
  /** 锻造/炼丹失败 */
  craft_fail: { group: "item", wave: "sawtooth", freq: 260, toFreq: 130, dur: 280, gain: 0.22 },

  /* ---------------- 战斗 ---------------- */
  /** 普攻挥击（出手瞬间的破风声，与命中音分开：挥→命中） */
  swing: { group: "combat", wave: "noise", noise: 1, freq: 2200, toFreq: 700, dur: 90, gain: 0.12 },
  /** 普通命中（噪声爆 + 低频砰） */
  hit: { group: "combat", wave: "noise", noise: 1, freq: 900, dur: 110, gain: 0.3 },
  /** 暴击（叠加在 hit 之上） */
  crit: { group: "combat", wave: "square", freq: 1800, toFreq: 2600, dur: 130, gain: 0.16 },
  /** 玩家受伤（更低沉） */
  player_hurt: { group: "combat", wave: "sawtooth", freq: 380, toFreq: 140, dur: 220, gain: 0.3 },
  /** 敌人死亡 */
  enemy_die: { group: "combat", wave: "noise", noise: 1, freq: 500, toFreq: 120, dur: 320, gain: 0.24 },
  /** 玩家死亡 */
  player_die: { group: "combat", wave: "sawtooth", freq: 300, toFreq: 70, dur: 700, gain: 0.32 },
  /** 治疗 */
  heal: { group: "combat", wave: "sine", freq: 520, toFreq: 1040, dur: 320, gain: 0.22 },

  /* ---------------- 技能 ---------------- */
  /** 技能释放 */
  skill_cast: { group: "skill", wave: "triangle", freq: 300, toFreq: 1400, dur: 300, gain: 0.26 },
  /** 技能冷却中（等同 ui_error，但走技能组） */
  skill_cooldown: { group: "skill", wave: "square", freq: 300, toFreq: 240, dur: 80, gain: 0.16 },
  /** 技能冷却结束 */
  skill_ready: { group: "skill", wave: "sine", freq: 990, toFreq: 1320, dur: 140, gain: 0.14 },

  /* ---------------- 移动 ---------------- */
  /**
   * 脚步（草地默认）
   * ★ 重做成「低频砰 + 高频沙沙」双层（原版纯噪声太闷、听不出来）：
   *   - 振荡器层：square 180Hz → 90Hz 的下滑，给出「踏地」的实感
   *   - 噪声层：bandpass 1200Hz 的沙沙声，给出「摩擦」的质感
   *   两者叠加 + 略微 detune（±4%）→ 每次落脚略有差异，不腻。
   */
  footstep: {
    group: "move", wave: "square", freq: 180, toFreq: 90,
    dur: 90, gain: 0.34, noise: 0.7, detune: 0.04,
  },
  /** 石地脚步（更清脆的高频） */
  footstep_stone: {
    group: "move", wave: "square", freq: 260, toFreq: 140,
    dur: 70, gain: 0.3, noise: 0.85, detune: 0.05,
  },
  /** 木地脚步（带一点空腔共鸣） */
  footstep_wood: {
    group: "move", wave: "triangle", freq: 220, toFreq: 110,
    dur: 130, gain: 0.32, noise: 0.55, detune: 0.03,
  },
  /** 水边脚步（更长的沙沙声） */
  footstep_water: {
    group: "move", wave: "sine", freq: 150, toFreq: 80,
    dur: 200, gain: 0.3, noise: 1, detune: 0.06,
  },

  /* ---------------- 任务 / 系统 ---------------- */
  /** 任务接取 */
  quest_accept: { group: "system", wave: "triangle", freq: 520, dur: 110, gain: 0.2, repeat: 2 },
  /** 任务完成 */
  quest_done: { group: "system", wave: "triangle", freq: 660, toFreq: 1320, dur: 260, gain: 0.22, repeat: 3 },
  /** 升级 */
  level_up: { group: "system", wave: "sine", freq: 523, toFreq: 1046, dur: 420, gain: 0.24, repeat: 3 },
  /** 消息/短信提示 */
  message: { group: "system", wave: "sine", freq: 1320, dur: 90, gain: 0.18, repeat: 2 },
  /** 传送 / 切图 */
  teleport: { group: "system", wave: "sawtooth", freq: 200, toFreq: 1400, dur: 380, gain: 0.2 },
};

/** 试听面板用：按分组给一条代表性样例 */
export const GROUP_SAMPLE: Record<SoundGroup, string> = {
  ui: "ui_click",
  move: "footstep",
  combat: "hit",
  item: "pickup",
  skill: "skill_cast",
  system: "quest_done",
};
