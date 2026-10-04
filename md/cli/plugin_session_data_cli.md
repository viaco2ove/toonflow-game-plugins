命令全集
上传故事的命令
python -m toon_plugins plugin_session_data -i toonflow-field-survival -story 赦夜人冥夜走廊-第二季 -u "D:/Users/viaco/tools/Toonflow-game/toonflow-game-plugins/workshops/toonflow-field-survival/map_design/赦夜人冥夜走廊-第二季"

# 1. list
python -m toon_plugins plugin_session_data -i toonflow-field-survival -story 赦夜人冥夜走廊-第二季

# 2. 读 player_card
python -m toon_plugins plugin_session_data -i toonflow-field-survival -story 赦夜人冥夜走廊-第二季 -k player_card --get

# 3. 写地图（从文件）
python -m toon_plugins plugin_session_data -i toonflow-field-survival -story 赦夜人冥夜走廊-第二季 -k map_data --set --value-file map.json

# 4. 写地图（内联）
python -m toon_plugins plugin_session_data -i toonflow-field-survival -story 赦夜人冥夜走廊-第二季 -k map_data --set --value '{"theme":"龙巢"}'

# 5. 删 key
python -m toon_plugins plugin_session_data -i toonflow-field-survival -story 赦夜人冥夜走廊-第二季 -k map_data --remove

# 6. 切真实 sessionId（默认是 all 跨会话）
python -m toon_plugins plugin_session_data -i com.toonflow.minigame-field-survival --session gs_1789458006016_e0d4ebf114 --list

# 7. build tbg 文件到同级目录下
python -m toon_plugins plugin_session_data -i toonflow-field-survival -story 赦夜人冥夜走廊-第二季 -build "D:/Users/viaco/tools/Toonflow-game/toonflow-game-plugins/workshops/toonflow-field-survival/map_design/赦夜人冥夜走廊-第二季"

# 获取（t_plugin_session_data 表）角色位置和地图信息
python -m toon_plugins plugin_session_data -i toonflow-field-survival -story 赦夜人冥夜走廊-第二季 -role -position
