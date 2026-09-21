# cli 插件 示例
## 插件cli
### 列出已安装
python -m toon_plugins plugins

### 安装所有插件（不落盘，base64 直接上传）
python -m toon_plugins plugins --install-all --no-tpg

### 安装 + 同时在 plugins_tbg/ 保存 .tpg
python -m toon_plugins plugins --install-all

### 指定单个插件
python -m toon_plugins plugins -i toonflow-field-survival

### 从目录安装
python -m toon_plugins install plugins/toonflow-field-survival