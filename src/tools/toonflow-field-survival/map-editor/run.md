# WIN1 —— 后端（FastAPI）
cd $toonflow-game-plugins
cd src/tools/toonflow-field-survival/map-editor/backend
pip install -r requirements.txt
python server.py local

# local 可换成 dev / prod；不带参数则按 NODE_ENV 兜底为 dev
# 配置来自 backend/env/.env.<环境名>，详见 backend/env/README.md
# 健康检查: http://127.0.0.1:8000/api/health

# WIN2 —— 地图编辑器前端
cd $toonflow-game-plugins
cd src/tools/toonflow-field-survival/map-editor/frontend
npm run dev

# WIN3 —— 游戏内预览（拟真宿主）
cd $toonflow-game-plugins
cd plugins/toonflow-field-survival/vue
npm run debug -- --story 通天传授-收徒系统 --conn

# 背景分离模型（本地抠图）
# 设置面板右上角 ⚙️ →「背景分离」页
#   - 厂商 local_birefnet(BiRefNet) / local_modnet(MODNet)
#   - 首次使用点「立即安装」，会在 MODEL_path 目录建独立 venv 并下载模型权重
#   - 安装完成后可选图「试跑抠图」；TEMP_OSS 已配置时会顺带上传并返回公网地址
#   - 要让其它功能复用它，在「功能绑定」页把背景分离模型绑定到对应槽位