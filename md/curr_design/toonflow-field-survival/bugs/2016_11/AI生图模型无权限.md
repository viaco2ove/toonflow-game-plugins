# AI 生图失败：team not allowed to access model（图生图 i2i 无权限）

日期：2026-11-14（同日二修，初版结论有误已订正）
现象：实体形象面板「AI 生成」报错：
`生图失败：team not allowed to access model. This team can only access models=[...]. Tried to access agnes-image-2.5-flash`
但 Postman / `/other/testImage` 用**同一把 key + 同一个模型**测都是 200。

## 真正的根因（订正）

**不是「key 没有该模型权限」，而是「文生图有权限、图生图没权限」——两条端点分开鉴权：**

| 调用 | 端点 | 结果 |
|---|---|---|
| Postman / testImage（不带参考图） | `POST /v1/images/generations`（JSON） | ✅ 200 |
| 插件 AI 生成（传了参考图） | `POST /v1/images/edits`（multipart，AI SDK 自动切换） | ❌ 403 team not allowed |

链路：插件面板传参考图 → `PluginAgentRunner` sprite 分支 → `u.ai.image({imageBase64:[...]})`
→ `other.ts`（openai-compatible，非 gemini 模型）→ AI SDK `generateImage` 带 images
→ `node_modules/@ai-sdk/openai-compatible` **改走 `/images/edits`**（postFormDataToApi）
→ agnes 平台对 i2i 端点按另一组模型权限校验 → 403。

**排查失误记录**：初版只看报错文本就断言「key 没权限」，没复现区分两条端点。
用户拿 Postman 200 反驳后，才逐层比对请求差异（参考图 → SDK edits 端点）复现实锤。
教训：**同一个 key 同一个模型一通一不通，必须逐字段 diff 两条请求**，不能只看错误文案。

## 修复（2026-11-14 已部署）

宿主 `PluginAgentRunner.ts` sprite 分支加**降级重试**：
带参考图生图失败 → 自动去图按文生图重试一次 → 成功后在 output.note 注明
「参考图已忽略：当前生图模型不支持图生图（参考图端点无权限）」。
entry.ts 透传 note → spriteGen.message → 面板完成态显示提示。

端到端验证：`POST /plugin/agentRun`（field-survival-sprite-gener，带 1×1 png 参考图）
→ ok=true，出图 335KB PNG，matting=aliyun_imageseg，note 正确。

## 如果要真正用参考图（图生图）——已实施 ② + agnes 专属厂商

三选一：
1. 给 agnes key 开通 i2i（edits）模型权限（平台侧操作）；
2. ✅ **已实施**：`other.ts` openai-compatible 分支——edits 失败后自动改走
   **`/images/generations` + `image` 数组**（参考图直接随文生图请求透传）；
3. ✅ **已实施（2026-11-14 二次升级）：agnes 一等厂商**——
   - 后端新增 `src/utils/ai/image/owned/agnes.ts`：t2i/i2i 都走
     `POST {base}/images/generations`，参考图放 `body.extra_body.image`（平台原生姿势），
     **从不触碰 /images/edits**；baseURL 填 `…/v1` 或完整端点都行（自动归一）；
   - `index.ts` 注册 + 透传厂商（免模型白名单校验）；
   - 前端 `modelConfigCatalog.ts` 加 agnes 条目（设置页厂商下拉可选，默认
     baseURL = `https://api.agnes-ai.cn/v1/images/generations`）；
   - `t_config`#93 manufacturer 已切 `openai → agnes`；
   - 兜底链最后一层仍保留：PluginAgentRunner 去图纯文生图（仅当 agnes 也失败时）。

**端到端验证（manufacturer=agnes）**：
- 插件 sprite 链路带参考图：ok，8.4s，日志 `[ai.image][agnes] t2i+refs via generations extra_body.image（1 张参考图）`，出图 406KB，无 refDropped note
- `/other/testImage`（manufacturer=agnes，纯文生图）：200 + dataURL

## 排查锚点

- 插件 sprite 生成：`PluginAgentRunner.ts` `runPluginAgent` → `getPromptAi("storyImageModel")`
  → `t_config`（用户设置 `t_setting.languageModel` JSON 的 `storyImageModel: 93` → config#93）
- AI SDK 切 edits 的代码：`@ai-sdk/openai-compatible/dist/index.js` `if (files != null && files.length > 0)` → `/images/edits`
- 复现命令：multipart POST `/v1/images/edits`（image=任意png, model, prompt）→ 403 即权限缺失
