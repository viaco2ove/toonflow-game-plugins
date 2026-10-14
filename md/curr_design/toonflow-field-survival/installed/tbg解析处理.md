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

# sessionStorage 和 IndexedDB？（评估中）
1. **sessionStorage**
   - 特点：同 tab 生命周期，关闭标签页直接清空；iframe 同源下可以共享；存储上限很小（~5MB）
   - AI 心里的优势：简单，API 轻量，不用复杂异步逻辑；刚好匹配你的场景 —— 只需要当前 tab 会话复用，关掉 tab 不需要保留
   - 短板：容量上限紧张，你的 tbg base64 接近 5MB，很容易溢出；**不能跨标签页共享**
2. **IndexedDB**
   - 特点：浏览器持久化数据库，容量大（几十 MB 起步），关闭 tab、重启浏览器数据都保留
   - AI 心里的优势：容量充足，可跨会话缓存，适合大二进制文件
   - 短板：API 繁琐、异步回调复杂；还有你这个 iframe 嵌套场景，跨域 / 父子窗口访问会踩坑
# 地图tbg 解压文件数据处理的磁盘解法1？（评估中）
每次加载插件（iframe）都解压到{UPLOAD_DIR}的
{UPLOAD_DIR}/../plugins/data/.tmp/{userId}/{pluginid}/{storyname}

原来方案：解压到内存 `StoryMapBundle` JS 对象，没有任何文件落地。

- 优点：最快，无文件 IO，没有垃圾文件问题；
- 缺点：不能用文件路径方式访问资源，调试时不能直接浏览解压后的文件清单。

你这个新方案：解压落地成文件树

- 优点：可以按文件路径读取，调试时能直接看解压出来的文件，方便核对 maps 目录、json、图片清单；
- 缺点：增加文件 IO 开销，要处理并发、锁、垃圾回收。

## 一个关键小改进建议（目录原子性，防止半解压损坏）

不要直接解压写入目标目录：

1. 先解压到临时同名目录：`/plugins/data/.tmp/{userId}/{pluginid}/.{storyname}.inprogress`
2. 全部文件解压、校验 hash 完成
3. 原子 rename 重命名为 `/plugins/data/.tmp/{userId}/{pluginid}/{storyname}`
4. 旧目录如果存在，先删除，再 rename
这样，外部永远只能看到**完整解压成功的包**，不会读到解压一半残缺的文件。

# 地图tbg 解压文件数据处理的磁盘解法2？（评估中）
跟磁盘解法1的差别是 地图集tbg 文件上传时就进行解压处理到
{UPLOAD_DIR}/../plugins/data/.tmp/{userId}/{pluginid}/{storyname}