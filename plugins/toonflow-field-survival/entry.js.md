entry.js 不上传git. ai 你个弱智不要把这个文件当作业务文件进行修改。
enmtry.ts 才是真源。
entry.js 是编译后带代码！
 cd plugins/toonflow-field-survival && npx esbuild entry.ts --outfile=entry.js

python -m toon_plugins plugins --install-all
python -m toon_plugins plugins -i toonflow-field-survival
这两个cli 命令内部保证entry.ts和entry.js的一致性，entryModuleCache 清理。