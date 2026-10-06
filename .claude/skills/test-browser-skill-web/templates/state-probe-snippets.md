# state 读取 / 注入 JS 片段集（test-browser-skill-web）

> 所有片段在**宿主 window**（`bsk evaluate`）执行；游戏真实 state 在 iframe 的 `contentWindow.__FS_DEBUG__`。
> 注入前一律 `JSON.parse(JSON.stringify(obj))` 序列化，防 Vue Proxy 触发 postMessage DataCloneError。

## 1. 递归定位游戏 window / canvas

```js
(function scan(w, d, acc) {
  try {
    var ifr = d.querySelectorAll('iframe');
    ifr.forEach(function (f) { try { scan(f.contentWindow, f.contentDocument, acc); } catch (e) {} });
    var cv = d.querySelectorAll('canvas');
    if (cv.length) acc.push({ canvases: cv.length, hasDebug: !!(w.__FS_DEBUG__), url: (w.location && w.location.href || '').slice(0, 80) });
  } catch (e) {}
  return acc;
})(window, document, [])
```

## 2. 读游戏 state 快照

```js
(function () {
  var w = document.querySelector('iframe').contentWindow;
  if (!w.__FS_DEBUG__) return 'NO_DEBUG_HOOK';
  var s = w.__FS_DEBUG__.state;
  return JSON.stringify({
    level: s.levelName,
    mode: s.mode,
    player: { x: s.player.x, y: s.player.y, hp: s.player.hp, maxHp: s.player.maxHp },
    enemies: (s.enemies || []).slice(0, 12).map(function (e) { return { id: e.id, name: e.name, hp: e.hp, x: e.x, y: e.y }; })
  });
})()
```

## 3. 点击怪物 / 触发自动攻击（iframe 形态）

```js
(function () {
  var w = document.querySelector('iframe').contentWindow;
  var s = w.__FS_DEBUG__.state;
  var t = (s.enemies || [])[0];
  if (!t) return 'NO_ENEMY';
  w.postMessage(JSON.parse(JSON.stringify({ type: 'tf_plugin_tick', action: 'goto_enemy', params: { targetId: t.id } })), '*');
  return 'SENT target=' + t.id;
})()
```

## 4. 切图（teleportTarget 触发 Vue switchLevel）

```js
(function () {
  var w = document.querySelector('iframe').contentWindow;
  var s = w.__FS_DEBUG__.state;
  s.teleportTarget = JSON.parse(JSON.stringify({ mapName: 'Mulberry Forest', x: 8, y: 6, name: '森林入口', rev: Date.now() }));
  return 'TELEPORT_SET';
})()
```

> sys_travel 只改 `s.levelName` 时 Vue watch 不到，必须设 `teleportTarget`。

## 5. 监听 entry.js 回执（iframe → 宿主 postMessage）

```js
window.addEventListener('message', function (e) {
  var d = e.data;
  if (d && d.type === 'tf_plugin_tick') console.log('[tf_plugin_tick]', d.action, d.params);
});
```

## 6. 轮询对比（触发前后快照）

```js
(function () {
  var w = document.querySelector('iframe').contentWindow;
  var s = w.__FS_DEBUG__.state;
  var out = [];
  var i = 0;
  var timer = setInterval(function () {
    var t = (s.enemies || [])[0];
    out.push({ t: i * 500, px: +s.player.x.toFixed(2), py: +s.player.y.toFixed(2), tgtHp: t && t.hp });
    if (++i >= 10) { clearInterval(timer); window.__POLL_RESULT__ = out; }
  }, 500);
  return 'POLLING';
})()
// 稍后读取：window.__POLL_RESULT__
```
