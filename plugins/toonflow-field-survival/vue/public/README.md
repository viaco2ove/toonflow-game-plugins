# 地图初始信息加载
[first.map.json](maps/first.map.json)
例如
```json
{
  "start_map": {
    "name": "portalID",
    "type": "string",
    "value": "Mulberry Town"
  }
}

```
代表初始地图是：
[mulberryTown.json](maps/mulberryTown.json)


# 野怪信息
例如
[mulberryForest.json](maps/mulberryForest.json)
## ✅ 有野怪信息，全部整理如下
地图是Tiled地图，对象层`Actors`里面存放怪物出生信息，**瓦片32×32**，坐标`x/y`是像素坐标。

> 怪物统一类型：GOBLIN（哥布林），ORC（兽人）

## 1. 哥布林 Goblin，等级 level = 1
| id | 名称 | 类型 | 等级 | 像素X | 像素Y |
|----|------|------|------|-------|-------|
|5|Goblin|GOBLIN|1|672|1248|
|6|Goblin|GOBLIN|1|704|1152|
|7|Goblin|GOBLIN|1|736|1216|
|9|Goblin|GOBLIN|1|1568|672|
|10|Goblin|GOBLIN|1|1600|576|
|11|Goblin|GOBLIN|1|1664|672|
|16|Goblin|GOBLIN|1|1632|608|
|17|Goblin|GOBLIN|1|1248|800|
|18|Goblin|GOBLIN|1|1248|864|

## 2. 兽人 Orc，等级 level = 3
| id | 名称 | 类型 | 等级 | 像素X | 像素Y |
|----|------|------|------|-------|-------|
|22|Orc|ORC|3|1568|1024|
|32|Orc|ORC|3|1600|960|

---
### 补充
- 坐标换算成**瓦片格子坐标**（tile坐标，除以32）
例：x=672，672/32 = 21；y=1248/32 = 39 → 瓦片(21,39)
```
哥布林(21,39)
哥布林(22,36)
哥布林(23,38)
哥布林(49,21)
哥布林(50,18)
哥布林(52,21)
哥布林(51,19)
哥布林(39,25)
哥布林(39,27)

兽人(49,32)
兽人(50,30)
```

如果你需要，我可以帮你直接导出成游戏代码格式（json / 数组）。

# 无野怪的地图
[mulberryTown.json](maps/mulberryTown.json)
没有任何野怪 / 怪物（Enemy）对象
```json
{
  "height":56,        // 地图总瓦片高度 56格
  "infinite":false,   // 不是无限地图，固定尺寸
  "layers":[...],     // 图层数组（瓦片层+对象层）
  "nextlayerid":5,
  "nextobjectid":227, // 下一个对象ID是227，现有对象最大id=226
  "orientation":"orthogonal", // 正交瓦片地图（2D俯视/斜向正交）
  "renderorder":"right-down",
  "tiledversion":"1.2.1",
  "tileheight":32,    // 单瓦片像素高32px
  "tilesets":[...],
  "tilewidth":32,     // 单瓦片像素宽32px
  "type":"map",
  "version":1.2,
  "width":43          // 地图总瓦片宽度43格
}
```
这份 Tiled 地图 JSON本身没有单独一层专门标记敌人，判断「没有敌方」是从 Actors 对象层（id=4）遍历所有 object，筛选 entity_type：
敌人（Monster/Enemy）在你的这套地图规范里，不会出现在这个地图的 Actor 列表里；这个 Actor 层里所有实体类型只有：
DOOR、CHEST、NPC、LADDER、LEVEL_TRANSITION、PLAYER，没有任何 ENEMY/MONSTER 类型对象。
一、拆解 Actors 对象层（"name":"Actors"）
所有 objects 的entity_type枚举：
DOOR：门（Vertical Door / Horizontal Door）
CHEST：宝箱
NPC：NPC（村民、酒馆老板、镇长、矮人等，wanders=true 是闲逛 NPC）
LADDER：梯子（地牢传送）
LEVEL_TRANSITION：场景切换传送门（森林 / 墓地）
PLAYER：玩家出生点
👉 全程没有任何对象的 entity_type = "ENEMY" / "MONSTER"，这就是判定「这张图没有敌方」的根本依据。
注意：
Tile Layer 1/2/3 瓦片层只是地形、墙壁、装饰瓦片，瓦片 ID 只是图片索引，瓦片本身不是敌人；瓦片层的obstacles:true只是代表碰撞障碍物（墙、家具），不是怪物。
敌人是对象层实体（objectgroup），不是瓦片。你这套项目的约定：怪物、NPC、玩家、门、宝箱全部放在Actors对象层，而不是瓦片层。

# 问题点
依靠了entity_type 来判断 阵营。具有不可靠性
优化：
1.依然采取原来的“entity_type”来初步判断阵营，这样可以无需修改原来的地图依然可用。
2.增加“camp” 代表阵营
3.增加"full_name" 代表姓名
例如没有full_name 的哥布林头上只是显示"哥布林”， 有full_name的就是“哥布林(full_name)”