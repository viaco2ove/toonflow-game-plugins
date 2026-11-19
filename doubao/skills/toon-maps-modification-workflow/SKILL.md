---
name: toon-maps-modification-workflow
description: 把一张概念原型图（或故事设定）落地成 toonflow 地图集的编排层工作流。先认知现状与素材，再把原型要素逐条做缺口分级（现成图块 / 可换色 / 需程序化补 tile / 需补实体），按 A 纯数据重排、B 关键贴图替换、C 整体重绘三档执行，改完必须渲染截图自查并同步。当用户要求「按原型图改造地图」「把概念图落到地图集」「这张图该怎么改进游戏」「营地/废墟/现代场景地图换皮落地」时使用。上游复用 cognitive-tiles-maps、tiles-maps-editor、tile-style-change、toon-maps-renderings。
agent_created: true
---

# toon-maps-modification-workflow — 原型图落地地图集工作流
[toon-maps-modification-workflow](../../../.workbuddy-ai/skills/toon-maps-modification-workflow)
使用例子 
- /toon-maps-modification-workflow  \workshops\toonflow-field-survival\map_design\末世选择，从解析神明开始成神\maps\mulberryTown.json
和\workshops\toonflow-field-survival\map_design\末世选择，从解析神明开始成神\maps\mulberryForest.json
的改造原型图生成出来 要符合当前故事的

- /toon-maps-modification-workflow  实现你的原型图
- /toon-maps-modification-workflow  进度如何
- /toon-maps-modification-workflow 不要问我了。直接落实你的原型图。可以改插件和地图编辑器但是要往通用的角度改。然后直接给我结果，过程不要再问我。
- /toon-maps-modification-workflow prototype-map-pipeline 分析地图原型图，规划切图，替换素材还是增加素材，如何落实到地图。然后直接出图。我要在地图编辑器 直接看见做好的图。
- /toon-maps-modification-workflow 我要100% 落实。中途不要问我。给我做出来
我更建议把你的原型图或者切图后 复制进去 workshops\toonflow-field-survival\map_design\末世选择，从解析神明开始成神\images
workshops\toonflow-field-survival\map_design\末世选择，从解析神明开始成神\maps\mulberryTown.json
某些地方指明用那个素材图。我说了100%还原你的原型图。