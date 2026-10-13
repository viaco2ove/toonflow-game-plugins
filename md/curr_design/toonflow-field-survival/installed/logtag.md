# 插件安装后的运行日志
## log_tag:[map-diag]
如： console.log("[map-diag] " + msg, JSON.stringify(extra ?? {}));
输出到 网页命令行

## log_tag:[field-survival]
[field-survival] map_visual 读取结果: tbg 包 (keys: format,encoding,data,...)
[field-survival] map_visual 形态②（未解包 tbg）: data length = XXXXX bytes (base64)
[field-survival] map_visual tbg 解包成功: files keys = mulberryTown, first, forestDungeon1, forestDungeon2, forestDungeon3
[field-survival] 已加载会话视觉地图包 map_visual（5 张图）: mulberryTown, first, forestDungeon1, forestDungeon2, forestDungeon3


console.info(`[field-survival] 故事名: ${}`);
console.info(`[field-survival] 故事id: ${}`);
console.info(`[field-survival] 故事集获取方式: ${}`);
console.info(`[field-survival] 故事集 datakey: ${}`);
console.info(`[field-survival] 故事集是否从数据库获取成功: ${}`);
console.info(`[field-survival] 故事集获取失败。退路回默认地图数据: ${}`);