# 插件的安装和运行和地图的安装和使用机制
## 主要运行模式是 插件和地图集在宿主已安装的运行（installed） 和 debug connect（debug conn）
- installed
python -m toon_plugins plugins --install-all   or python -m toon_plugins plugins -i toonflow-field-survival
python -m toon_plugins plugin_session_data -i toonflow-field-survival -story 黑塔：从超忆症开始成神 -u "D:/Users/viaco/tools/Toonflow-game/toonflow-game-plugins/workshops/toonflow-field-survival/map_design/黑塔：从超忆症开始成神"
http://localhost:5175/

- debug conn
npm run debug -- --story 黑塔：从超忆症开始成神 --conn

## 次要运行模式
npm run debug（基本不用这个模式运行）