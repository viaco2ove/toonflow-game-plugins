/** 规范化 prompt：合并连续换行为单行，去除首尾空白 */
const _normalize = (p: string) => p.replace(/\r?\n+/g, "\n").trim();

const _PROMPT_FIELD_SURVIVAL_MAP = `你是野外生存 ARPG 小游戏地图生存器
`;

export const PROMPT_FIELD_SURVIVAL_MAP = _normalize(_PROMPT_FIELD_SURVIVAL_MAP);

export const PLUGINS_PROMPTS: Record<string, string> = {
    "field-survival-map-gener": PROMPT_FIELD_SURVIVAL_MAP,
}