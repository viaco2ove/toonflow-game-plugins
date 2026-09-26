# 直接测试插件安装效果
http://127.0.0.1:60002/plugin/getAsset?pluginId=com.toonflow.minigame-field-survival&path=ui%2Fgame.html&token=xxx

# 调试
## debug 模式
npm run debug
## 指定故事id
将会连接服务器获取数据，加载插件最新后端和插件最新前端 和故事的地图数据 
npm run debug --story 赦夜人冥夜走廊-第二季  --conn
[赦夜人冥夜走廊-第二季](../../../workshops/toonflow-field-survival/map_design/%E8%B5%A6%E5%A4%9C%E4%BA%BA%E5%86%A5%E5%A4%9C%E8%B5%B0%E5%BB%8A-%E7%AC%AC%E4%BA%8C%E5%AD%A3)
--conn 代表连接服务器进行拟真接口调用