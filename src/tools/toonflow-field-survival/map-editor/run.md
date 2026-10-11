# WIN1
cd $toonflow-game-plugins
cd src/tools/toonflow-field-survival/map-editor/backend
python server.py

# WIN2
cd $toonflow-game-plugins
cd src/tools/toonflow-field-survival/map-editor/frontend
npm run dev

# WIN3
cd $toonflow-game-plugins
cd plugins/toonflow-field-survival/vue
npm run debug -- --story 通天传授-收徒系统 --conn
