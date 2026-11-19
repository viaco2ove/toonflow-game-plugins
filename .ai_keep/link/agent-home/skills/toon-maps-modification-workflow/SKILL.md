---
name: toon-maps-modification-workflow
description: 把一张概念原型图（或故事设定）落地成 toonflow 地图集的编排层工作流。先认知现状与素材，再把原型要素逐条做缺口分级（现成图块 / 可换色 / 需程序化补 tile / 需补实体），按 A 纯数据重排、B 关键贴图替换、C 整体重绘三档执行，改完必须渲染截图自查并同步。当用户要求「按原型图改造地图」「把概念图落到地图集」「这张图该怎么改进游戏」「营地/废墟/现代场景地图换皮落地」时使用。上游复用 cognitive-tiles-maps、tiles-maps-editor、tile-style-change、toon-maps-renderings。
agent_created: true
---

# toonflow-game-plugins
以管理员身份打开 PowerShell（开始菜单搜索 PowerShell → 右键“以管理员身份运行”），执行，不要重复操作：
powershell
```
[Environment]::SetEnvironmentVariable('toonflow-game-plugins', 'D:\Users\xxx\tools\Toonflow-game\toonflow-game-plugins', 'Machine')
```
验证是否写入成功：

powershell
```
[Environment]::GetEnvironmentVariable('toonflow-game-plugins', 'Machine')
```

# toon-maps-modification-workflow — 原型图落地地图集工作流
[toon-maps-modification-workflow]({toonflow-game-plugins}/.workbuddy-ai/skills/toon-maps-modification-workflow)
使用例子 
- /toon-maps-modification-workflow  \workshops\toonflow-field-survival\map_design\末世选择，从解析神明开始成神\maps\mulberryTown.json
和\workshops\toonflow-field-survival\map_design\末世选择，从解析神明开始成神\maps\mulberryForest.json
的改造原型图生成出来 要符合当前故事的

- /toon-maps-modification-workflow  实现你的原型图
- /toon-maps-modification-workflow  进度如何