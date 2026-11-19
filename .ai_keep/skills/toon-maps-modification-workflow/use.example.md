# use.example.md — 用例档

## 用例 1：按原型图改造末世营地地图（B 档为主）

**输入**

- 地图集：`workshops/toonflow-field-survival/map_design/末世选择，从解析神明开始成神`
- 原型图：`previews/幸存者营地_原型图.png`、`previews/外围废墟带_原型图.png`
- 要素清单：`.cache/post_apoc_elements.json`（见本技能 `references/gap-analysis.md` 第 3 节格式）

**步骤**

1. 认知现状：
   ```sh
   "$PY" "$SK/cognitive-tiles-maps/scripts/inspect_map.py" "$MAPSET/maps/mulberryTown.json"
   "$PY" "$SK/cognitive-tiles-maps/scripts/inspect_map.py" "$MAPSET/maps/mulberryForest.json"
   "$PY" "$SK/cognitive-tiles-maps/scripts/inspect_tileset.py" "$MAPSET/images/compiled_tileset_32x32.png"
   ```
2. 出缺口分级报告：
   ```sh
   "$PY" "$SK/toon-maps-modification-workflow/scripts/gap_report.py" \
     --mapset "$MAPSET" --elements .cache/post_apoc_elements.json \
     --out "$MAPSET/../末世选择.gap.md"
   ```
3. 读报告 + 候选拼图，人工确认 R/C/M/E；向用户报三档方案。
4. B 档执行：
   - 现有路面/墙体走 `skin_recolor.py --palette dark` 压暗换色；
   - 帐篷/沙袋/瞭望塔/翻修车/黑雾等 M 项，复制 `assets/post_apoc_plan.json` 改色，先 `--dry-run` 再 `--preview` 看图，最后写入；
   - 缺的 NPC/怪物先补 `entity_types.json`，再用 `actors.py` 落位。
5. 验证：`inspect_map.py` 重新渲染，Read 整图 + 局部放大核对；跑 `references/modification-tiers.md` 第 5 节清单。
6. 同步：图集改动同步 `vue/public/images/` 副本；纯 json 改动 dev 刷新即可。

## 用例 2：只做数据层重排（A 档）

原型与现有素材基本一致，只是道路走向、围栏样式、NPC 位置不对。

1. `elements.py` + `mark_edges.py` 盘清现状与墙边。
2. `find_tiles.py` 筛候选，开拼图目视确认 gid。
3. 按 `material.txt` 坐标落子；Actors 用 `actors.py` 增删移动。
4. 渲染看图验证；备份在 `maps/bak/`。

## 用例 3：题材差异过大，进入 C 档

现有骨架是中世纪村落，目标是现代都市/废墟，A/B 都覆盖不了。

1. 先调 `toon-maps-renderings` 出分区概念稿，逐区与用户确认。
2. 概念稿冻结后再批量补素材、重排布局，每完成一区渲染验证一次。
3. 不要在概念稿未确认前批量生成 tile 或重排布局。
