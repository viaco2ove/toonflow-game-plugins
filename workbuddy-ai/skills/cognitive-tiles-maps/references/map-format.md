# 地图 JSON 格式详解（Tiled 格式，toonflow 项目实例）

实例：`workshops/toonflow-field-survival/map_design/黑塔：从超忆症开始成神/maps/mulberryTown.json`

## 顶层结构

```jsonc
{
  "width": 43, "height": 56,          // 格数
  "tilewidth": 32, "tileheight": 32,  // 每格像素
  "orientation": "orthogonal",
  "renderorder": "right-down",
  "infinite": false,
  "layers": [ ... ],                  // 见下
  "tilesets": [ { "firstgid": 1, ... } ],
  "nextlayerid": 5, "nextobjectid": 312,

  // —— 故事侧自定义字段（引擎读取）——
  "name": "延城一中",                   // 显示名（getLevelDisplayName 优先读它）
  "theme": "校园·课间",                // 查表 key 用 slug，见 THEME_BY_MAPNAME
  "narration": "教学楼之间全是人……",    // 进图旁白
  "notes": "六区: ①晨读教室(西北) …",   // 设计备注
  "eventZones": [ ... ]                // 事件区域
}
```

**关键**：`name`（中文显示名）写在地图 JSON 里，**不要**往前端 slug 表加映射
（slug 是跨故事共享 key，会打坏别的故事，见 MEMORY「地图集是数据」条）。

## layers[]

顺序即渲染顺序（自下而上）。本项目典型 3 个瓦片层 + 1 个对象层：

| 层 | type | 语义 | 延城一中非空格数 |
|---|---|---|---|
| Tile Layer 1 | tilelayer | 地面（草地/土路/地板） | 2404 / 2408（几乎满铺） |
| Tile Layer 2 | tilelayer | 墙 / 屋顶 / 树 / 户外构件 | 1434 |
| Tile Layer 3 | tilelayer | 家具 / 装饰 | 344 |
| Actors | objectgroup | NPC / 门 / 触发器 | 59 个对象 |

### tilelayer

```jsonc
{ "id": 1, "name": "Tile Layer 1", "type": "tilelayer",
  "width": 43, "height": 56,
  "data": [7865, 7865, 9298, 0, ...] }   // 扁平数组，长度 = width*height
```

- `data` 是**行优先**扁平列表：`index = y * width + x`
- `0` = 空（该层此格透明，下层会透出来）
- 其余是 gid，`tile_index = gid - firstgid`
- **L2 在建筑区是"实心屋顶"**（如 5610/5730/5850），不是可进入房间；
  要改室内必须先清掉屋顶格

### objectgroup（Actors）

```jsonc
{ "id": 4, "name": "Actors", "type": "objectgroup", "draworder": "topdown",
  "objects": [
    { "id": 129, "name": "Vertical Door", "gid": 570,
      "x": 192, "y": 800, "width": 32, "height": 32,
      "type": "", "rotation": 0, "visible": true,
      "properties": [ { "name": "entity_type", "type": "string", "value": "DOOR" } ] }
  ] }
```

- 坐标是**像素**（非格子）：`cell_x = x // 32`, `cell_y = y // 32`
- 带 `gid` 的是图块对象（门/NPC 精灵），`entity_type` 属性决定行为
- 顶点对象（point）用 `width=0,height=0`
- `properties[]` 是 Tiled 属性数组，读时转成 dict：
  `{p["name"]: p.get("value") for p in obj.get("properties", [])}`

## eventZones[]

```jsonc
[ { "name": "晨读教室", "x": 6, "y": 15, "rx": 4, "ry": 4 } ]
```

- **格子坐标**（不是像素），`x,y` 是左上角，`rx,ry` 是尺寸
- 对应引擎的 `trigger` 事件作用范围

## 相关：事件脚本与任务

- 地图专属事件：`<地图集>/events/maps/<mapfile>.events.json`
- 通用事件脚本：`<地图集>/events/scripts/*.ts`
- 任务定义：`<地图集>/quests.json`（objective 只支持 kind: kill/gather/arrive/talk/explore）

## 改造后必做校验

1. JSON 仍可 `json.load`（语法合法）
2. `len(data) == width * height`（每层）
3. 所有 gid > 0 且 `gid - firstgid < tilecount`
4. 对象层对象数不变（除非有意增删）
5. 渲染整图目视比对，确认改动落在预期位置
6. 地图 JSON 与图集版本配套（改了图集就要确认地图引用的 gid 仍指向正确素材）