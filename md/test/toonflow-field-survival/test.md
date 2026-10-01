# 直接测试插件安装效果
http://127.0.0.1:60002/plugin/getAsset?pluginId=com.toonflow.minigame-field-survival&path=ui%2Fgame.html&token=xxx

# 调试
## debug 模式，默认不连接服务器
npm run debug
## 指定故事id 和连接服务器：拟真调试
将会连接服务器获取数据，加载插件最新后端和插件最新前端 和故事的地图数据 
npm run debug -- --story 赦夜人冥夜走廊-第二季 --conn
--conn 代表连接服务器进行拟真接口调用
免安装（能免安装就免安装）或者安装插件进行拟真测试
--story 代表当前故事是那个
例如 “赦夜人冥夜走廊-第二季” 使用这个地图[赦夜人冥夜走廊-第二季](../../../workshops/toonflow-field-survival/map_design/%E8%B5%A6%E5%A4%9C%E4%BA%BA%E5%86%A5%E5%A4%9C%E8%B5%B0%E5%BB%8A-%E7%AC%AC%E4%BA%8C%E5%AD%A3)
特别是[story.json](../../../workshops/toonflow-field-survival/map_design/%E8%B5%A6%E5%A4%9C%E4%BA%BA%E5%86%A5%E5%A4%9C%E8%B5%B0%E5%BB%8A-%E7%AC%AC%E4%BA%8C%E5%AD%A3/story.json)
story.json 包含了sessionId 和 worldId

没有--story 就用
[public](../../../plugins/toonflow-field-survival/vue/public)

简洁版：npm run debug:conn


# 数据互通
与服务器进行拟真测试。动态修改服务器的当前用户正在游玩的这个故事的这个会话的角色卡信息。经验，级别，血量，蓝量，物品，技能等。 保存到会话的动态数据里。也就是关闭这个小游戏
  继续ai 聊天 看见的是变化后的。
  上传地图到服务器 [@md/curr_design/toonflow-field-survival/game.md:10-29]