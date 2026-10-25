# 地图认知报告：延城一中

- 文件：`workshops\toonflow-field-survival\map_design\黑塔：从超忆症开始成神\maps\mulberryTown.json`
- 尺寸：43 x 56 格（32px/格）
- 显示名：延城一中  主题：校园·课间
- 进图旁白：教学楼之间全是人。走廊上有人喊你名字，你回头，只看见一张陌生的脸。只有你还记得，第三节课该有个同桌等你。
- notes：六区: ①晨读教室(西北) ②空着的座位(中·林凡的桌位) ③走廊(东) ④教师办公室(北) ⑤器材室(南) ⑥操场方向(东南)

## 图层
- L1 `Tile Layer 1`: 2402/2408 格非空
- L2 `Tile Layer 2`: 1387/2408 格非空
- L3 `Tile Layer 3`: 344/2408 格非空

## 事件区 eventZones（格子坐标 x,y 起 rx×ry 格）
- 晨读教室: (6,15) 4x4
- 空着的座位: (16,24) 4x3
- 教师办公室: (8,11) 3x2
- 器材室: (16,52) 4x2
- 操场方向: (40,44) 3x4

## 对象层（共 59 个）
类型分布: NPC×32, DOOR×20, CHEST×3, LEVEL_TRANSITION×2, LADDER×1, PLAYER×1

具名对象（NPC/门等）:
- id=129 `Vertical Door` @(6,25) entity=DOOR
- id=131 `Vertical Door` @(20,13) entity=DOOR
- id=132 `Vertical Door` @(6,33) entity=DOOR
- id=134 `Vertical Door` @(20,41) entity=DOOR
- id=135 `Vertical Door` @(20,33) entity=DOOR
- id=148 `Horizontal Door` @(7,18) entity=DOOR
- id=150 `Horizontal Door` @(16,18) entity=DOOR
- id=151 `Horizontal Door` @(33,25) entity=DOOR
- id=152 `Horizontal Door` @(35,19) entity=DOOR
- id=157 `Chest` @(17,9) entity=CHEST
- id=158 `Chest` @(36,15) entity=CHEST
- id=163 `NPC` @(4,25) entity=NPC
- id=164 `NPC` @(3,26) entity=NPC
- id=165 `苏晓` @(7,10) entity=NPC
- id=168 `NPC` @(8,10) entity=NPC
- id=169 `小满` @(8,13) entity=NPC
- id=170 `NPC` @(14,16) entity=NPC
- id=171 `NPC` @(16,16) entity=NPC
- id=173 `NPC` @(23,33) entity=NPC
- id=174 `NPC` @(23,41) entity=NPC
- id=177 `NPC` @(3,51) entity=NPC
- id=178 `NPC` @(7,49) entity=NPC
- id=181 `NPC` @(36,16) entity=NPC
- id=182 `NPC` @(36,20) entity=NPC
- id=183 `Ladder Down` @(35,30) entity=LADDER
- id=184 `NPC` @(22,33) entity=NPC
- id=190 `NPC` @(15,50) entity=NPC
- id=191 `NPC` @(18,49) entity=NPC
- id=192 `NPC` @(16,52) entity=NPC
- id=193 `Vertical Door` @(20,51) entity=DOOR
- id=195 `Horizontal Door` @(26,47) entity=DOOR
- id=196 `Vertical Door` @(33,52) entity=DOOR
- id=198 `Vertical Door` @(29,50) entity=DOOR
- id=199 `Vertical Door` @(11,42) entity=DOOR
- id=200 `NPC` @(9,42) entity=NPC
- id=201 `NPC` @(8,42) entity=NPC
- id=202 `NPC` @(10,43) entity=NPC
- id=203 `Vertical Door` @(30,39) entity=DOOR
- id=204 `Chest` @(34,37) entity=CHEST
- id=205 `NPC` @(39,40) entity=NPC
- id=206 `NPC` @(33,37) entity=NPC
- id=207 `Horizontal Door` @(35,42) entity=DOOR
- id=208 `Horizontal Door` @(39,36) entity=DOOR
- id=210 `Horizontal Door` @(16,27) entity=DOOR
- id=211 `Horizontal Door` @(23,21) entity=DOOR
- id=212 `NPC` @(17,24) entity=NPC
- id=214 `NPC` @(25,24) entity=NPC
- id=216 `班主任` @(6,11) entity=NPC
- id=217 `班主任` @(7,11) entity=NPC
- id=218 `班主任` @(8,11) entity=NPC
- id=219 `Level Transition` @(42,46) entity=LEVEL_TRANSITION
- id=220 `Level Transition` @(28,1) entity=LEVEL_TRANSITION
- id=222 `Player` @(34,33) entity=PLAYER
- id=225 `魏叔` @(3,32) entity=NPC
- id=226 `Horizontal Door` @(34,32) entity=DOOR
- id=300 `张晚意` @(6,18) entity=NPC
- id=900 `任务板` @(27,53) entity=NPC
- id=310 `老周（转学来的旁听生）` @(14,38) entity=NPC
- id=311 `白子轩` @(38,38) entity=NPC

## 瓦片用量（按图集分类聚合）
- prop_large: 56 格
- building_part: 29 格
- special_structure: 25 格
- prop_small: 24 格
- building_wall: 21 格
- unknown: 9 格
- structure_edge: 5 格
- tree_plant: 2 格
- terrain_other: 1 格

（另有 9 个 gid 指向图集空白格，属正常占位）

## 产物（D:\Users\viaco\tools\Toonflow-game\toonflow-game-plugins\.workbuddy-ai\cognition\延城一中）
- `mulberryTown.png` 整图渲染（红框=事件区，蓝框=对象）
- `layer-L1.png` 单层渲染
- `layer-L2.png` 单层渲染
- `layer-L3.png` 单层渲染
- `material.txt` 逐格材质图