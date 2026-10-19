/**
 * ★ 实体形象：内置预选形象（player_sprites 目录）
 *
 * 目录来源：
 *   - dev：vue/public/images/player_sprites/<id>.png（Vite 静态服务）
 *   - 安装包：ui/images/player_sprites/<id>.png（宿主 getAsset 托管）
 * 两者内容一致（构建时 public → ui 拷贝），所以这里统一用插件内相对路径，
 * 由 assets.resolveAssetPath / assetUrl 在两种环境下解析。
 *
 * 新增形象：把 png 同时放进上面两个目录，再把 id 加进下面的数组即可。
 * （不要用 import.meta.glob 读 public —— public 不参与模块图，glob 拿不到。）
 */
export interface SpritePreset {
  id: string;
  /** 插件内相对路径（./ 开头，assetUrl 会去掉前缀再拼 getAsset） */
  path: string;
  /** 面板展示名（DawnLike 图集里多为「角色/怪物」小图，统一按编号显示） */
  label: string;
}

const PRESET_IDS: string[] = [
  "3853", "3858", "3859", "4213", "4214", "4218", "4219", "4226",
  "4334", "4336", "4337", "4342", "4344", "4345", "4453", "4693",
  "4695", "4812", "4813", "4814", "8161", "8521", "8522", "8523",
];

export const SPRITE_PRESETS: SpritePreset[] = PRESET_IDS.map((id) => ({
  id,
  path: `./images/player_sprites/${id}.png`,
  label: `像素形象 ${id}`,
}));

/** id → 相对路径（找不到返回空串） */
export function presetPathOf(id: string): string {
  const hit = SPRITE_PRESETS.find((p) => p.id === String(id));
  return hit ? hit.path : "";
}
