# 什么时候解析？
插件加载，也就是打开iframe 时。

# 解析的文件数据储存
以前是加载到内存

# 先看看插件的文件在哪里？
{UPLOAD_DIR}/../plugins/{userId}/{pluginid}
例如：D:\Users\xxx\tools\Toonflow-game\toonflow-app-run-db\plugins\1\com.toonflow.minigame-field-survival

# plugins/.tmp
这是个啥文件夹？
{UPLOAD_DIR}/../plugins/.tmp
pluginRegistry.ts:290 + install-raw.ts:67-69。
plugins/.tmp 是后端 toonflow-game-app 在安装插件时的中间暂存区：

1. raw-*.zip —— install-raw.ts:67-69，接收 CLI 走 /plugin/install-raw 流式上传的 zip 包。raw-<ts>-<uuid8>.zip 落到 <plugins>/.tmp/。上传完成后调用 installPluginPackageFromFile 解压到 .tmp/<ts>-<uuid8>/（lib/pluginRegistry.ts:186），用 extract-zip 解开。
2. <ts>-<uuid8>/ 解压后的目录 —— 里面是解压后的插件源（entry.ts / vue/ / manifest.json 等），解析 manifest、走 esbuild 编译、把编译产物（entry.js / vue/dist）移到 plugins/<id>/<pluginId>/。最后 install.ts 末尾有 cleanupTmp 删掉这个目录。

正常流程：解压成功 + 编译完就清掉 .tmp 整个目录。但你这里 .tmp 还在——1791168781063-f9dd25a5/ 和 1791908360376-619fbf0f/ 两个解压目录没清掉，说明那两次安装要么中途崩了要么 cleanup 失败了。

两个 raw-*.zip 也都还在——同样的原因：流式上传完成后应该立刻删（install-raw.ts:116 finally cleanupTmp）。它们留着没清，说明 install-raw.ts 那次 finally 没跑完（进程被杀？磁盘满？）。

结论：
- plugins/.tmp/raw-*.zip + plugins/.tmp/<ts>-<uuid8>/ = 后端安装插件的中间工作目录
- 作用：先收流式 zip → 解压 → 编译 → 移到 plugins/<id>/<pluginId>/ → 清掉 .tmp

# 新的地图tbg 解压文件数据处理
每次加载插件（iframe）都解压到{UPLOAD_DIR}的
{UPLOAD_DIR}/../plugins/data/.tmp/{userId}/{pluginid}/{storyname}
