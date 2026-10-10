# 事件系统设计
地图集文件夹下（例如[workshops/toonflow-field-survival/map_design/通天传授-收徒系统]）
增加events 文件夹。用json 来写触发器。独立声明式事件 JSON + t_plugin_session_data flag】方案。
某种角度就是简化版魔兽争霸触发器。

方案 A：events 放 JSON（纯声明触发器，无代码）
events/dungeon5.json
json
[
  {
    "trigger": {"type":"interact_entity","uid":"ladder_01"},
    "conditions": [
      {"type":"save_flag_check","key":"dungeon5_clear","value":true}
    ],
    "actions": [
      {"type":"teleport_player","map":"Mulberry Town","x":10,"y":12},
      {"type":"play_sound","name":"stairs"}
    ]
  }
]

conditions读取玩家存档里面的 flag，不是读项目 story.json
全部是固定写死的类型：trigger 有哪些、condition 有哪些、action 有哪些，全部由游戏引擎预先写好，JSON 只能选，不能跑自定义代码。
优点
AI 生成简单，schema 固定，校验脚本可以检查写错；不会出现语法错误。
安全：没有任意代码执行，逻辑只能做引擎允许的事情。
适合大部分游戏事件：传送门、怪物刷新、对话、字幕。

缺点
复杂逻辑会写的非常啰嗦。比如：循环、数学计算、多步复杂分支，JSON 会爆炸。
每新增一种新行为，必须去游戏引擎新增代码，JSON 这边不能自己创造新逻辑。

方案 B：events 直接放 TS 脚本文件，替代 JSON 触发器
不再写一大坨 JSON，直接写 .ts，例如 events/dungeon5.ts
typescript
运行
// 给游戏引擎导出事件列表
export default [
  {
    trigger: "interact_entity",
    targetUid: "ladder_01",
    async onFire(ctx) {
      // ctx 可以读取/修改玩家存档
      if(ctx.save.flags.dungeon5_clear !== true){
        return; // 条件不满足直接返回
      }
      await ctx.teleportPlayer("Mulberry Town",10,12);
      ctx.playSound("stairs");
    }
  }
]
引擎会加载这些 ts 脚本，提供一个上下文对象ctx，里面工具函数：读存档、写存档、传送、生成怪物、播放音效。
用 TS 脚本替代 JSON 会发生什么？优缺点
✅好处
写复杂逻辑极其舒服：if、for 循环、变量、数学运算、函数复用，直接用编程语言。
不用维护巨大的 trigger/condition/action 枚举表。不需要每次新增行为就改引擎枚举。
AI 写 TS 非常擅长，Claude Code 写脚本比拼大段 JSON 自然很多。
可以抽公共函数，多个地图之间复用逻辑。
❌坏处（重点）
会有真正的代码 bug：空指针、死循环、逻辑写错。JSON 配置顶多参数写错；TS 脚本可以写出运行时崩溃。
校验变难：原来 JSON 可以脚本静态校验字段；TS 是动态代码，很难静态检查对错。
版本 / 兼容性坑：AI 写出调用不存在 ctx API 的代码，游戏直接报错。
资源和逻辑混代码；别人阅读要看 TS 源码，不像 JSON 一眼看懂触发关系。
注意：这里 TS 是游戏运行时加载执行，不是编辑器前端运行。编辑器这边依旧啥都不用干，只看地图，不去跑脚本。
现实折中：混合模式（我最推荐）
plaintext
地图集文件夹/
├─ maps/          # 纯地图数据
├─ events/
│  ├─ simple/     # 简单事件：用JSON触发器（传送门、简单刷怪）
│  └─ scripts/    # 复杂事件：.ts脚本（复杂BOSS战、多分支剧情）
80% 简单事件用 JSON，好校验、不容易崩；
20% 复杂难缠逻辑，丢给 TS 脚本。
不管 JSON 还是 TS：所有 flag 读取修改，全部访问游戏运行时存档，原始项目资源不存任何 flag 状态，符合你的否定 story 全局 flag 的想法。
和魔兽触发器的对比大白话
魔兽编辑器：GUI 鼠标点 → 生成内部的事件脚本，存在地图文件内。
你的方案：
没有 GUI 鼠标点；
事件抽离到独立 events 文件夹不和 maps 地图 json 混在一起；
由 AI 写 JSON/TS 文件；
flag 状态不在资源文件，在玩家存档。
本质就是：把魔兽触发器从编辑器 GUI 拖拽，变成磁盘上的文件，交给 AI 编辑。