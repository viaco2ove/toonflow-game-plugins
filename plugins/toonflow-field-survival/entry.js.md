entry.js 不上传git. ai 你个弱智不要把这个文件当作业务文件进行修改。
enmtry.ts 才是真源。
entry.js 是编译后带代码！
必须 bundle 成自包含单文件（无 import / import.meta），否则后端影子模块加载时
相对 import 解析失败 → "entry 模块加载失败" → 小游戏永远开局超时：
 cd plugins/toonflow-field-survival && npx esbuild entry.ts --bundle --format=esm --platform=node --target=node18 --outfile=entry.js
（★ 不要漏 --bundle！2026-10-21 踩坑：漏了它 esbuild 只做单文件转译，
  entry.js 会残留 `import ... from "./src/agents/plugins.prompts"`，
  后端 PluginExecutor 直接 import 时 ERR_MODULE_NOT_FOUND。）

python -m toon_plugins plugins --install-all
python -m toon_plugins plugins -i toonflow-field-survival
这两个cli 命令内部保证entry.ts和entry.js的一致性，entryModuleCache 清理。