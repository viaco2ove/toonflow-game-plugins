# 单次测试执行清单（test-browser-skill-web）

> 复制本清单，按序勾选。目标：沿固定路径进入 5175 宿主的 #野外生存，验证指定插件功能。

## 任务参数

- 宿主地址：`{{host|http://localhost:5175/}}`
- 故事：`{{story|赦夜人冥夜走廊-第二季}}`
- 待测功能：`{{feature|例如：点击怪物后玩家自动移动并攻击}}`
- 断言（可选）：`{{assert_js|无}}`
- 截图目录：`{{shot_dir|C:\Users\viaco\AppData\Local\Temp\}}`

## Step 0 前置

- [ ] `curl http://{{host}}` 返回 200
- [ ] `bsk status --json` daemon 存活、browsers 非空
- [ ] 多浏览器时 `bsk browsers` 记下 `--browser <id>`

## Step 1 进入

- [ ] `bsk session start --json --browser {{id}}` → session_id = `{{session_id}}`
- [ ] `bsk navigate {{host}} --session {{session_id}}`
- [ ] `bsk observe`：看到主页（随机推荐故事 / 我的 / 创建故事）
- [ ] 选路线：输入框填"继续" → 点「进入故事」；或「我的」→ 故事卡片

## Step 2 定位插件

- [ ] observe 出现 `field-survival`、`第 N 轮 · playing`
- [ ] 判定形态：
  - [ ] iframe 形态（`document.querySelectorAll('iframe').length > 0`）→ Step 3
  - [ ] 消息面板形态（只有 plugin_id 文本）→ Step 2a：点「展开」，若仍无 iframe，记录并给出结论
- [ ] `bsk console --since <n> --limit 30` 无阻塞级报错（语音 400 可忽略但记录）

## Step 3 读取游戏 state（iframe 形态）

- [ ] 递归扫描定位最深层 canvas / `__FS_DEBUG__`
- [ ] 快照：`player.pos`、`player.hp`、目标怪 `id/hp/pos`、`levelName`

## Step 4 功能验证

- [ ] 触发方式：{{click 坐标 | goto_enemy 注入 | teleportTarget 注入}}
- [ ] 轮询记录：触发前后 `player.pos` 位移、目标 HP 变化（贴具体数值）
- [ ] 结果判定：{{通过标准，如 dist 减小 + HP 下降}}

## Step 5 取证

- [ ] 截图 1：进入游戏全景 `{{shot_dir}}fs-{{host_port}}-enter.png`
- [ ] 截图 2：功能触发前 `...-before.png`
- [ ] 截图 3：功能触发后 `...-after.png`

## Step 6 收尾

- [ ] `bsk session stop {{session_id}}`
- [ ] 输出结论：通过/失败 + 数值证据 + console 摘录
