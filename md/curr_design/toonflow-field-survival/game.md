# 区域与攻击半径
区域刷新机制。 主角出生地改为城镇，安全区 有屋子等建筑和中立角色。每个区域自己有自己的刷新时间。修复探测半径 且为10，米 ，脱战。敌人复活 按刷新机制来。
离开这个区域后 的45秒刷新一次 野怪。小地图显示各个区域名称。

Rotten-Soup 的 mulberryTown.json 这个是城镇的json文件，可以用于参考。
# android-h5 app 优化
Toonflow-game-android-h5
为什么插件 在android-h5 app 上运行会卡顿，pc web 安卓浏览器都不会卡顿

# 地图设计
地图数据可以进行独立安装
没有的情况下使用[maps](../../../plugins/toonflow-field-survival/vue/public/maps)

故事地图设计
[map_design](../../../workshops/toonflow-field-survival/map_design)

## 地图上传
``` vue
      <button class="map_upload">
        <span class="map_upload__loading" style="display: none">
          <span class="map_upload__spinner"></span>上传并绑定插件&故事&用户 中…
        </span>
        <span >上传地图（tbg格式）</span>
      </button>
```
上传并绑定插件&故事&用户. 到 t_plugin_session_data，sessionId=all.
代表 不限会话。
cli 上传地图（自动打包，根据story.json 和[.env](../../../.env) 文件 知道那个userid 和故事id）
`python -m toon_plugins plugin_session_data -i toonflow-field-survival -story 赦夜人冥夜走廊-第二季 -u "D:/Users/viaco/tools/Toonflow-game/toonflow-game-plugins/workshops/toonflow-field-survival/map_design/赦夜人冥夜走廊-第二季"
`
# 等级系统
满血HP计算标准
满血HP = 基础血量100 + 等级*10 + 道具血量加成点数 + 技能永久血量加成点数
## 2. 满蓝MP计算标准
满蓝MP = 基础蓝量100 + 等级*10 + 道具蓝量加成点数 + 技能永久蓝量加成点数
## 3. 基础攻击力计算标准
攻击 = 基础攻击10 + 等级*10 + 道具攻击加成点数 + 技能攻击加成点数
## 4. 基础防御力计算标准
防御 = 基础防御1 + 等级*10 + 道具防御加成点数 + 技能防御加成点数

## 5. HP/MP恢复判定逻辑
满足以下场景，直接将hp、mp字段修改为满血满蓝计算结果（纯数字），恢复描述文字存入other字段：
- 角色睡觉、住宿、休息过夜
- 使用回血回蓝药剂、疗伤食物、恢复类技能
- 剧情触发秘境泉水、神殿治愈等全体恢复机制
仅文字描述“状态好转、气息平稳”无明确休息/服药动作，不得修改hp、mp数值，仅记录至other

碰撞到床显示睡眠按钮，点击可以进行睡眠恢复
## 6. 经验值&升级完整流程
1. 角色卡字段说明：exp(当前累计经验)、next_level_exp(下级升级所需经验)，二者均为纯数字
2. 基础升级阈值：next_level_exp = 当前level * 100
3. 获得明确经验数值时，exp直接累加；模糊描述“实力小幅提升、修为精进”不改动exp，仅写入other
4. 升级判定：exp ≥ next_level_exp 触发升级，支持连续多级升级，单级升级执行步骤：
    ① level = level + 1
    ② exp = exp - 升级前next_level_exp（溢出经验保留）
    ③ next_level_exp = 新level * 100
    ④ 检索【全局原始背景】内等级-称号对照表，匹配新等级写入level_desc
    ⑤ 按满血满蓝公式重算hp、mp并更新数值
5. 等级称号level_desc仅从全局背景给定映射读取，无对应等级则填空字符串

经验，hp,mp 与用户的动态角色卡数据同步，确保数据一致性。

# 野怪和攻击机制
用户和其他角色和野怪的近战距离 0.5米
远程野怪和远程武器和远程技能 距离 4米
野怪发起攻击的距离：4米
超过4米 野怪自己回到出生点。
野怪出生点和等级和类型在 地图json文件 里。

刷新机制不离开地图不会刷新，离开当前地图30秒后重新生成野怪，


# 系统按钮
做一个跟debug__toggle 类似的可移动的 “系统”按钮。先做背包，纳戒，商城，技能，地图功能，角色卡
点击 "系统"按钮后，弹出一个可移动的系统面板，包含背包，纳戒，商城，技能，地图功能
## 背包
可以卖出物品，排列物品顺序
这个背包的物资与用户的动态参数卡的物品同步，且可用于技能上方的物品栏点击使用和切换
物品栏点击使用如果没有对应的特效就 角色小跳和飘字来作为通用特效

每个物品都可以在旁边修改特效，类型[atk, heal, buff,attribute],修改按钮【修改】，【使用】
点击后可以修改物品参数
例如：
 { name: "小刀", power: 20, cost: 0, cd: 0, cdLeft: 0, type: "atk", range: "melee"，lv:1,buff_type:"",durability:-1,attribute_type:"",attribute_value:0,
quantity:4,description:"一把锋利的小刀"}
物品修改后，物品参数会保存到"t_plugin_session_data"
用户动态参数卡中的“物品” 只保存物品名称列表：如“银鲤×3（钓鱼累积，暂未售出，单尾800金）、银鲤×4、力量+4”

### buff 类型：
防御/攻击/持续伤害/晕眩/无敌/加速
buff_type:Defense/Attack/Sustained_Damage/Stunning/Invincible/Accelerate

### durability 耐用度，使用多少次会被摧毁。
durability:-1
-1 代表永久


### attribute_type 属性类型
Defense/Attack/Life/Blue
物品为用户增加的 防御/攻击/生命量/蓝量 的加成。放在背包里面就能被动加成。
其中 type: "attribute"  代表是单纯的属性点。使用不消耗，但是依然有小跳效果也会产生普攻效果。

### quantity 数量
用户动态参数卡中的“物品”:银鲤×3（钓鱼累积，暂未售出，单尾800金）
name="银鲤"
quantity=3, 
description:"银鲤×3（钓鱼累积，暂未售出，单尾800金）"
存到"t_plugin_session_data"，
用户动态参数卡中的“物品” 只保存物品名称列表：如“银鲤×3（钓鱼累积，暂未售出，单尾800金）、银鲤×4、力量+4”


## 纳戒
为了防止背包内容太多，可用存放物资到的纳戒中。同时也支持储存技能。
这部分数据保存到"t_plugin_session_data". 

## 商城
商城功能，购买物品，消耗货币
通过“商城agent“ 读取当前故事的动态参数和常驻世界书条目 获得有哪些物资。
再加上插件自带物资来提供商城服务

参考 小游戏“#商城”。

商城面板增加 “商城agent” 按钮点击主动调用 生成物资类别。
数据保存到"t_plugin_session_data"    
## 技能
技能与用户的动态参数卡的技能同步，且可用于技能栏点击使用和切换
技能栏点击使用如果没有对应的特效就 角色小跳和飘字来作为通用特效
每个技能都可以在旁边修改特效，类型[atk, heal, buff],修改按钮【修改】，【使用】
点击后可以修改技能参数
例如：
 { name: "冲斩", power: 20, cost: 0, cd: 24, cdLeft: 0, type: "atk", range: "melee"，lv:1,buff_type:""}
技能修改后，技能参数会保存到"t_plugin_session_data"
用户动态参数卡中的“技能” 只保存技能名称列表：如“源之力（lv1，失控）（lv1）、暗核共鸣（lv1）、夜采直觉、暗核共鸣（lv2，共鸣通道拓宽但仍窄）、暗核共鸣（lv2）、源之力（lv1，失控）、基础功法（lv2）、源之力（lv1，失控）、暗核共鸣（lv2）、夜采直觉”

buff 类型：
防御/攻击/持续伤害/晕眩/无敌/加速
buff_type:Defense/Attack/Sustained_Damage/Stunning/Invincible/Accelerate

## 地图功能
点击查看地图。
默认显示 用户当前所在的地图。
点击缩小后按入口把各个地图连成大地图。
可以传送到各个地图

## 角色卡
无论有没有在开始游戏选择角色都要全部在这个面板显示。 ally 角色实体。
友方/中立/敌对角色
### 各个角色的动态角色卡信息进行显示（包括用户）
就如 Toonflow-game-web的
play-role-strip 和 play-inline-card

### 传送到角色身边（排除用户）
显示 角色在那个地图的那个位置（角色的位置信息保存到"t_plugin_session_data"），旁边有个“传送到” 按钮
点击后传送到改角色身边
#### 角色位置问题
如果没有角色位置信息，就默认生成到第一个图的可活动区域（不能在墙里、障碍物里）
[ally角色位置.md](ally%E8%A7%92%E8%89%B2%E4%BD%8D%E7%BD%AE.md)
##### 召唤按钮
在组队的checkbox 增加召唤按钮 把角色召唤到用户旁边并 储存一下角色的【位置信息和所在地图信息】到 "t_plugin_session_data"
取消组队时也要 储存一下角色的【位置信息和所在地图信息】到 "t_plugin_session_data"
[game_data.md](game_data.md)

/browserskill 去到  mulberryForest 召唤一个 角色应该存储它的位置信息。
用户回到城镇， 那个刚刚召唤的角色（取消组队的也是）应该依然在mulberryForest ，进入mulberryForest  应该看见他还在原地。其他角色默认在start_map，不应该出现在别的地图。 
ally 实体出生默认不应该在原地扎堆。也就是位置不能（-2到2） 而是（-10到10 零散分布 不是画个圆）
### 组队跟随（排除用户和敌对角色）
每个角色下面都有给 组队跟随【checkbox】,打勾后将跟随用户帮用户打怪。取消打勾就脱离队伍。
与用户组队的角色也会长经验和升级。
取消组队后，角色不再跟随而是留在原地。位置信息和所在地图信息也会被保存。下次进入这个地图时，角色会留在原地。
这个时候储存一下角色的【位置信息和所在地图信息】到 "t_plugin_session_data"

### 敌对角色
不能组队，但是对应的增加"呼唤“按钮，把敌对角色呼唤过来到当前地图，作为敌人

# 对话功能
触碰角色后，角色头上会显示“聊天”按钮
点击后 将会调用 角色发言器agent 进行发言。台词将会同步到Toonflow-game-web 的聊天框
角色发言后，提供 选项：发言/继续/离开
## 发言点击后
提供三个ai 发言选项推荐给用户和自定义发言选项。点击自定义后用户可输入文字或语音识别出文字后点击发送。
发送后，角色继续发言

## 继续
改角色继续发言

## 离开
借宿与该角色的对话

## 中立npc
如果有通用角色用通用角色扮演这个中立npc 进行发言。
如果没有用旁白扮演这个中立npc 进行发言。

## 野怪
野怪碰撞是进行战斗而不是对话

## 判断是否为角色列表里的角色
如果是角色列表里的角色，使用该角色进行发言
ally：["ai 故事的角色列表"],有对应角色就使用该角色进行发言
neutral ：["地图数据里的npc"]，没有对应角色就使用万能角色进行发言


# 打击特效
## 普攻特效
角色和敌人和用户收到攻击都会有打击特效

## 通用特效
物品栏点击使用如果没有对应的特效就 角色小跳和飘字来作为通用特效
技能栏点击使用如果没有对应的特效就 角色小跳和飘字来作为通用特效

## 默认 4 个技能 特效已经沿用
// 默认 4 个技能（和插件 mockHost 默认对齐：近战/远程/治疗/护盾）
const DEFAULT_SKILLS = [
  { name: "冲斩", power: 20, cost: 0, cd: 24, cdLeft: 0, type: "atk", range: "melee" },
  { name: "火球", power: 25, cost: 0, cd: 30, cdLeft: 0, type: "atk", range: "ranged" },
  { name: "治疗", power: 30, cost: 0, cd: 40, cdLeft: 0, type: "heal", range: "melee" },
  { name: "护盾", power: 0, cost: 0, cd: 60, cdLeft: 0, type: "buff", range: "melee" },
];

远程技能或者工具的特效都沿用"火球"的特效 type: "atk", range: "ranged" 
治疗类的特效都沿用"治疗"的特效 "heal"
加强类的特效都沿用"护盾"的特效"buff"
近战类的特效都沿用"冲斩"的特效 type: "atk", range: "melee"


# 野怪
依靠了entity_type 来判断 阵营。具有不可靠性
优化：
1.依然采取原来的“entity_type”来初步判断阵营，这样可以无需修改原来的地图依然可用。
5 个 playable_now 怪物：
RAT / BAT / SNAKE / GOBLIN /ORC
RAT / BAT / SNAKE/WILD_GOAT / GOBLIN / ZOMBIE/IMP/ORC etc
老鼠/暗夜生物/爬虫/山羊/绿皮地精（哥布林）/人形亡者/小恶魔 等
 [entity_types.json](../../../plugins/toonflow-field-survival/vue/public/entity_types.json)
2.增加“camp” 代表阵营
neutral/hostile/friendly
没有camp时依靠entity_type来判断
3.增加"full_name" 代表姓名
野怪头上要显示等级和entity_type和full_name
例如没有full_name 的哥布林头上只是显示"哥布林”， 有full_name的就是“哥布林(full_name)”
如“哥布林(低阶湮物)”
4.野怪等级
野怪的头上要显示野怪的等级
