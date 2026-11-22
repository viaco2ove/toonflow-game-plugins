# debug-conn.ai实体形象
debug-conn 模型运行后，ai 生成的实体形象 在刷新页面后成了坏图
根因
AI 生成图写盘有两个通道，我之前只修了一个：

通道	谁在用	之前	状态
iframe 侧 tf_plugin_data	前端 App.vue（sms 读写等）	✅ 已修（本地+后端双读双写）	已生效
entry 侧 tsApi.pluginData	entry.ts —— 图生成/图库/绑定全走这条	❌ 只写桩 localStorage	这才是图丢失的真凶
证据链：生成后库里查不到 sprite_asset:sp_15 / sp_259（后端只有昨天的 sp_464/sp_220），但桩 localStorage 里有 sp_15 —— 说明图只进了本地存储，而刷新后 entry 的 restoreSys 又只从 localStorage 读，两端都缺就成了「内存里有、刷新没了」。

刚完成的修复（vite 已自动重载）

vite.config.ts
 的 entryCtx.tsApi.pluginData：

set：本地写 + 后端异步双写（图生成后立刻进库，刷新/换端都在）
get：本地 miss → 回源后端（新会话 restoreSys 能读回后端那份权威数据）
需要你做的验证
刷新 3000 → 重新 AI 生成一张形象图 → 刷新页面，这次图应该还在。

注意：之前那两张已经丢的图（sp_15/sp_259）仍然找不回——它们当时只写进了 localStorage，而 localStorage 里只剩 sp_15（sp_259 彻底没了）。重新生成一张是最快的验证方式。

bsk跑一遍「生成→刷新→还在」的完整闭环

测试证据链
步骤	证据
走真实 UI：形象面板 → AI 生成 → 提交提示词	页面日志：[dev-host] entry 数据双写后端 sprite_asset:sp_0_1evpe3 → HTTP 200
图进了后端库	sprite_asset:sp_0_1evpe3 293,604 字节，updatedAt 19:20:46（库里最新的一条，之前只有昨天那两条）
刷新页面（重开会话 + 重新进游戏）	「我的生成」列表显示两张图，缩略图都正常渲染
绑定不断	林羽立绘仍显示 AI 生成的图，引用 asset:sp_464（后端那份）正常
真正的根因（我前几轮修错了地方）
AI 生成图的落盘走的是 entry 侧的 ctx.tsApi.pluginData（entry.ts 的 putSpriteAsset → api.set），而 dev-host 桩的这个 set 只写浏览器 localStorage：

图只在本地 → 刷新后 entry 的 restoreSys 从后端读不到 → 恢复成旧图/默认形象
我前几轮修的是 iframe 侧 tf_plugin_data 通道（sms 那些），对图生成无效——所以你一直说"依然不行"
现在 
vite.config.ts
 的 entryCtx.tsApi.pluginData：

set：本地写 + 后端异步双写（带 HTTP 状态日志）
get：本地 miss → 回源后端（新会话能读回权威数据）