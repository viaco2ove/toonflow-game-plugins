~~x: Math.round(e ? (e as any).x : num(old?.x, Math.random() * 10+5)),
y: Math.round(e ? (e as any).y : num(old?.y, Math.random() * 10+5)),~~
非常凌乱的默认位置。ai 自己都不知道他在几个地方写了影响位置的代码
a. 已排除
`    const rawAllyX = PLAYER_SPAWN.x + Math.cos(angle) * (ALLY_FOLLOW_GAP_M + 1.5 + Math.random() * 20);
    const rawAllyY = PLAYER_SPAWN.y + Math.sin(angle) * (ALLY_FOLLOW_GAP_M + 1.5 + Math.random() * 20);`
因改成 
`       const allyXBase =0;
        const allyYBase =0;
        const rawAllyX = allyXBase + Math.cos(angle) * (ALLY_FOLLOW_GAP_M + 1.5 + Math.random() * 20);
        const rawAllyY = allyYBase + Math.sin(angle) * (ALLY_FOLLOW_GAP_M + 1.5 + Math.random() * 20);`
沒有任何變化
b.
`const dist = 2 + Math.random() * 20;
      ents.push({
        id: r.id, name: r.name, side: "ally",
        x: Math.cos(ang) * dist, y: Math.sin(ang) * dist, vx: 0, vy: 0,
        hp: Math.floor(100 * s), maxHp: Math.floor(100 * s),
        mp: Math.floor(30 + lv * 5), maxMp: Math.floor(30 + lv * 5),
        exp: 0, expToNext: Math.floor(50 * Math.pow(1.5, lv - 1)),
        level: lv, atk: 25, def: 8, facing: 0, cooldown: 0, alive: true, avatarPath: r.avatarPath,
      });
    });`

改成
`
      // ★ 玩家中心 50 米半径随机（避开 5 米内）
      const ang = Math.random() * Math.PI * 2;
      const dist = -20 + Math.random() * 20;
      ents.push({
        id: r.id, name: r.name, side: "ally",
        x: Math.cos(ang) * dist, y: Math.sin(ang) * dist, vx: 0, vy: 0,
        hp: Math.floor(100 * s), maxHp: Math.floor(100 * s),
        mp: Math.floor(30 + lv * 5), maxMp: Math.floor(30 + lv * 5),
        exp: 0, expToNext: Math.floor(50 * Math.pow(1.5, lv - 1)),
        level: lv, atk: 25, def: 8, facing: 0, cooldown: 0, alive: true, avatarPath: r.avatarPath,
      });
    });`
    没有任何变化
c.
`e.side = "ally";
          if (!e.alive) { e.alive = true; e.hp = e.maxHp; }
          // TP 到玩家身边（角度均分分布，避免多个 ally 扎堆）
          const me = playerEntity(s);
          if (me) {
            // 统计已存在的 ally 数量，用于角度均分（0-index）
            const allyCount = s.entities.filter((ee) => ee.side === "ally" && ee.id !== e.id).length;
            const ang = (allyCount / Math.max(1, allyCount + 1)) * Math.PI * 2 + rnd(0, Math.PI * 0.5);
            const dist = 2 + Math.random() * 2;
            const p = clampToBound(s, me.x + Math.cos(ang) * dist, me.y + Math.sin(ang) * dist);
            e.x = p.x;
            e.y = p.y;
            (e as any).homeX = e.x;
            (e as any).homeY = e.y;
          }`

改成
`          e.side = "ally";
          if (!e.alive) { e.alive = true; e.hp = e.maxHp; }
          // TP 到玩家身边（角度均分分布，避免多个 ally 扎堆）
          const me = playerEntity(s);
          if (me) {
            // 统计已存在的 ally 数量，用于角度均分（0-index）
            const allyCount = s.entities.filter((ee) => ee.side === "ally" && ee.id !== e.id).length;
            const ang = (allyCount / Math.max(1, allyCount + 1)) * Math.PI * 2 + rnd(0, Math.PI * 0.5);
            const dist = 2 + Math.random() * 2;
            const allyXBase =0;
            const allyYBase =0;
            // const p = clampToBound(s, me.x + Math.cos(ang) * dist, me.y + Math.sin(ang) * dist);
            const p = clampToBound(s, allyXBase + Math.cos(ang) * dist, allyYBase + Math.sin(ang) * dist);
            e.x = p.x;
            e.y = p.y;
            (e as any).homeX = e.x;
            (e as any).homeY = e.y;
          }`
没有任何变化

d.
`  // ★ 默认落点：以玩家为中心、2~6 米内随机分布（玩家视野 13m，保证可见）
  const player0 = s.entities.find((e) => e.side === "player");
  const pcx = player0?.x ?? PLAYER_SPAWN.x;
  const pcy = player0?.y ?? PLAYER_SPAWN.y;
  const ang = rnd(0, Math.PI * 2);
  const dist = 2 + Math.random() * 4;
  let target: { x: number; y: number } = {
    x: pcx + Math.cos(ang) * dist,
    y: pcy + Math.sin(ang) * dist
  };`
改成
`  // ★ 默认落点：以玩家为中心、2~6 米内随机分布（玩家视野 13m，保证可见）
  const player0 = s.entities.find((e) => e.side === "player");
  const pcx = player0?.x ?? PLAYER_SPAWN.x;
  const pcy = player0?.y ?? PLAYER_SPAWN.y;
  const ang = rnd(0, Math.PI * 2);
  const dist = 2 + Math.random() * 20;
  const allyXBase =0;
  const allyYBase =0;
  let target: { x: number; y: number } = {
    x: allyXBase + Math.cos(ang) * dist,
    y: allyYBase + Math.sin(ang) * dist
  };`
没有任何变化


f. 有没有可能是位置数据保存下来了？
key:sys_state 删除后数据依然扎堆
key：ai_story_roles 删除后默认位置依然扎堆

h. 测试成功
entry.js
`// ★ 默认落点：第一张图可活动区域按索引均分分散（不再围着玩家出生点扎堆）
    const allyCount0 = s.entities.filter((x) => x.side === "ally").length;
    const dp = defaultSpawnPoint(s, allyCount0, Math.max(6, allyCount0 + 1));
    let target = { x: dp.x, y: dp.y };
    // 优先 enemyNav 避障；搜不到时加大半径重试（maxRing=8 对 50 米外随机落点太容易漏）
    if (enemyNav) {
        const free = navNearestFree(enemyNav, target.x, target.y, 0.4, 8)
            || navNearestFree(enemyNav, target.x, target.y, 0.4, 20);
        if (free)
            target = free;
    }
    const e = makeEntity(role, side, target.x, target.y, s.entities.length);
    e.homeX = e.x;
    e.homeY = e.y;
    e.mapName = s.levelName || "";
    e.roleType = roleType;
    // ★ 中立/通用角色保持非攻击状态（不会主动追玩家）
    if (side === "enemy") {
        e.aiState = "idle";
        e.regionId = (nearestWildRegion(e.x, e.y) || {}).id;
    }
    else {
        e.aiState = "idle";
    }
    s.entities.push(e);
    return e;`

改为：
```
...
else if (roleType === "npc" || roleType === "system" || roleType === "general")
        side = "ally";
    else
        side = "spectator";
    // ★ 默认落点：第一张图可活动区域按索引均分分散（不再围着玩家出生点扎堆）
    const allyCount0 = s.entities.filter((x) => x.side === "ally").length;
    const dp = defaultSpawnPoint(s, allyCount0, Math.max(6, allyCount0 + 1));
    let target = { x: dp.x, y: dp.y };
    // 优先 enemyNav 避障；搜不到时加大半径重试（maxRing=8 对 50 米外随机落点太容易漏）
    if (enemyNav) {
        const free = navNearestFree(enemyNav, target.x, target.y, 0.4, 8)
            || navNearestFree(enemyNav, target.x, target.y, 0.4, 20);
        if (free)
            target = free;
    }
    
 ....   
/**
 * ★ 默认落点（库里没有该角色位置信息时才用）：在第一张图的可活动区域按索引均分分散，
 *   不再围着玩家出生点扎堆。只保证落在地图边界内；
 *   「不在墙里 / 障碍物里」由拿到前端 walkGrid 后的 fixSpawnWithNav 兜底校正。
 *   s: 当前关卡数据
 *   i: 当前角色索引（同关卡同种野怪的索引，从 0 开始）
 *   n: 该种野怪数量（同关卡同种野怪数量）
 */
function defaultSpawnPoint(s, i, n) {
    // 原点 (0,0) 为中心，20 米半径内按索引均分角度 + 随机半径 → 零散分布
    const cnt = Math.max(1, n | 0);
    const ang = ((i % cnt) / cnt) * Math.PI * 2 + rnd(0, Math.PI * 0.35);
    const rad = 6 + Math.random() * 14; // 6~20 米
    return clampToBound(s, Math.cos(ang) * rad, Math.sin(ang) * rad);
}
```