# 为何ai生成的实体形象不见了
1.ui 上看见 实体形象的ai生成的图不见了
2.技能的配置属性特效绑定等不见了

排查日期：2026-11-17　环境：远端部署机 10.10.2.195（后端 60002 / sqlite-web 8222）
插件：com.toonflow.minigame-field-survival　会话：gs_1789458006016_e0d4ebf114
修复提交：2567d4a（persistSys 读-改-写）　关联文档：[技能放不出来等.md](前后端数据卡顿问题_技能放不出来等.md)

---

## 现象与定性

| UI 现象 | 对应数据 | 定性 |
|---|---|---|
| 「实体形象 → 我的生成 (0)」，AI 生成图全部消失 | `sys_state.spriteGallery`（图库）+ `spriteBinds`（角色↔形象绑定） | 被覆盖写空 |
| 技能面板「属性特效」下拉变回默认、攻击形状/冷却等自定义值丢失 | `sys_state.skillMeta`（技能元数据）+ `itemMeta`（物品元数据） | 被覆盖写空 |

注意区分两类「形象」：
- **故事角色头像**（`avatarPath`，`/1/game/scene/xxx.webp`）：存在 `t_storyWorld`，实测文件仍可访问
  （GET 返回 200，8.3MB webp）→ **没丢**；
- **插件内实体形象**（canvas 立绘，`customSprite` 通道，图库存 base64 PNG）：存在插件
  `sys_state` → **丢了**。用户看到的「不见了」是后者。

## 排查过程（sqlite-web 直查远端 DB）

远端 sqlite-web：`http://10.10.2.195:8222/`，直接对 `/data/toonflow/db.sqlite` 跑 SQL。

**① 本会话 `sys_state`（t_plugin_session_data id=108188）各字段长度：**

```
spriteGallery  = 2 字节  → []    （空数组）
spriteBinds    = 2 字节  → {}    （空对象）
skillMeta      = 2 字节  → {}    （空对象）
itemMeta       = 2 字节  → {}    （空对象）
bagMeta/bagOrder/skillOrder = 2 字节（全空）
────────────────────────────────
npcCards       = 6651 字节（15 条，完好）
shop           = 2834 字节（22 条，完好）
card.money     = 101657   （完好）
```

**选择性清空**——只有「图库/绑定/元数据」这几个字段空了，同一条记录里的其它字段都在。
这不是删库，是**某次写入用残缺的内存态把整条记录盖掉了**。

**② 连带污染**：`player_card`（id=108199）里每个物品都是 `"effects_type":""`（itemMeta 空导致
mergeBag 合并不出特效）；`npcCards[*].customSprite = NULL`（绑定空导致）。

**③ 对照组**：另一会话 `gs_1788705303400_0b9d18681e`（id=120250，10-10 存档）的 sys_state：

```
spriteGallery = 292104 字节（2 张 AI 生成图，source=ai，
                prompt="人物形象参考图1，身体和面部朝左，2.5D 俯视像素风"）
spriteBinds   = 123148 字节（player 绑定，source=ai，createdAt=1793940127439）
```

→ 证明**存储与恢复链路本身是好的**，是本会话的数据被某次写入抹掉了。

## 根因

两层缺陷叠加：

**第一层：`persistSys` 是全量覆盖写**（entry.ts）：

```ts
// 修复前：内存态有什么就写什么，空也照写
await api.set(SYS_DATA_KEY, {
  ...
  skillMeta: s.skillMeta || {},        // 内存空 → DB 被写成 {}
  itemMeta:  s.itemMeta || {},         // 同上
  spriteGallery: Array.isArray(s.spriteGallery) ? s.spriteGallery : [],  // → []
  spriteBinds: (s as any).spriteBinds || {},                             // → {}
});
```

**第二层：帧 tick 每 20 拍无条件调它**（`SYS_PERSIST_EVERY_TICKS = 20`，`case "tick"` 内
`if (s.tick % SYS_PERSIST_EVERY_TICKS === 0) void persistSys(context, s)`）。

于是只要**某一拍内存态残缺**（开局重建、`restoreSys` 未跑到、状态被 `start`/`select` 重置、
跨会话重建等），之后每 20 拍就把 DB 里的真数据覆盖成空一次，直到抹干净。

**触发方式（时间线）**：2026-11-17 17:16 重装插件 1.0.32、17:22 与 19:33 **用后端 API 直接
`tick start` 开局**（绕过前端 UI 选人路径）。API 开局时内存态没有图库/绑定/元数据，
restore 时机不完整 → 19:33 起 persistSys 连续覆盖 → 数据被抹。宿主侧已排除：
`setPluginData` 是 `onConflict.merge({dataValue})` 整值覆盖、serialize 无截断、
tsApi 注入与 `restoreSys` 守卫（`_sysRestored`）均正常 —— 防线只能建在插件侧。

**为什么用户配过的绑定两个会话里都查不到**：skillMeta/itemMeta 只在用户于面板里
`sys_skill_edit`/`sys_item_edit` 修改时写入（整条覆盖语义），写入后即随 persistSys 落库；
被覆盖清空后就无迹可查了。机制本身是好的（修复后实测 `sys_skill_edit` 正常落库全字段）。

## 修复（entry.ts，提交 2567d4a）

`persistSys` 从「全量覆盖」改为**读-改-写（read-merge-write）**：

1. 写入前先 `api.get(SYS_DATA_KEY)` 读回 DB 旧值（读失败退化为原覆盖行为，不阻断玩法）；
2. 对 8 个字段做 `keepIfEmpty` 保护：`spriteGallery / spriteBinds / skillMeta / itemMeta /
   bagMeta / bagOrder / skillOrder / npcCards` —— 内存态为空 → **保留 DB 旧值**；
   内存态有值 → 用内存态（正常写路径不受影响）；
3. **显式删除例外**：用户主动删图库最后一张（`sys_sprite_gallery_del`）/ 解绑角色
   （`sys_sprite_unbind`）时内存态确实变空，但那是故意的 → 这两个 action 先置
   `(s as any)._sysForceEmpty = ["spriteGallery","spriteBinds"]`，persistSys 见到标记就照写空。
   没有这个例外，「删除/解绑」会被旧值顶回来变成无效操作。

## 验证

**单元级**：keepIfEmpty 四类场景 9/9 通过（内存空保旧值 / 内存有用内存 / force 写空 / DB 无旧值正常写空）。

**真机决定性测试**（10Hz 帧 tick 实测 3 秒 31 拍）：

1. 直接往 DB 种入哨兵：`skillMeta.源之力 = {power:77, effects_type:"SENTINEL_FIRE"}`、
   `spriteGallery[0] = {id:"sp_sentinel", ...}`；
2. 让帧 tick 跑 15 秒（多次触发 persistSys，其中 `spriteGallery` 内存态必空——它只能来自 DB）；
3. 结果：**两个哨兵均存活**；
4. 反证：同一场景按修复前代码（`写入 = 内存态`）必然写空 → 测试有效，非假阳性。

测完清理哨兵（skillMeta → {}、spriteGallery → []），并把我塞的 power:77 经正规
`sys_skill_edit` 路径改回 12（顺带验证了技能编辑落库全字段：power/cost/cd/type/range/lv/
buff_type/effects_type/attack_shape）。

## 数据恢复情况

- 本会话已被覆盖的数据**无法从库内恢复**：`plugin_state`、`t_sessionStateSnapshot` 全部快照
  （最大 87KB）里都没有 spriteGallery/skillMeta；唯一有图库的存档（id=120250）属于另一个故事
  「黑塔：从超忆症开始成神」（player 角色是「张晚意让我来找您」），图不能拿来当本故事
  陈彦的形象。
- 需要手工重做：插件「实体形象 → 我的生成」重新生成 + 绑定；技能/物品面板重新配置属性特效。
- **修复保证以后不会再丢**——即使内存态残缺的那一拍，也只会写回「内存有的部分 + DB 保留其余」。

## 备查（SQL 坑）

- `json_array_length()` 对 **object** 返回 0（只对数组有效）——查对象的键数要用
  `SELECT COUNT(*) FROM json_each(d.dataValue,'$.skillMeta')`。
- `json_extract(dataValue,'$.skillMeta.源之力.effects_type')` 对**中文键名**返回 NULL
  （路径解析问题）——同样改用 `json_each(d.dataValue,'$.skillMeta')` 再看整对象。
- sqlite-web 结果表没有 `id="results"`，解析要用
  `<table class="table table-striped small cell-content">` 定位。
- ⚠️ 教训：不要用后端 API 直接 `tick start` 代替点 UI 开局（修复前正是数据清空的触发方式；
  修复后有 keepIfEmpty 防线，但仍建议走正常 UI 路径）。
