# t_plugin_session_data
## sys_state 和 ai_story_roles
存了两个 key，两个都有用，但职责不同——不是重复造轮子，是粒度不同。

两个 key 的分工

添加到对话
key	存什么	谁读
sys_state	纳戒 ring、队伍 party、角色卡 npcCards、背包 bagMeta/bagOrder、商城 shop、skillMeta/itemMeta、level、parked	restoreSys（存档主体，必读）
ai_story_roles	roles[]：每个角色的 id/name/x/y/mapName/side/roleType/alive + level + updatedAt	原本只写不读（设计给 AI 对话用）；这次修复后才被 restoreSys 读 → _savedRolePos
简单说：sys_state 是"存档"，ai_story_roles 是"角色位置索引"​。前者存整块游戏状态，后者是"谁在哪张图哪个坐标"的扁平清单，AI 对话要读「陈彦现在在 mulberry_forest (12.3,-5.6)」时不用遍历 entities。

重叠的部分只有两个字段

添加到对话
字段	以谁为准
level	sys_state.level 优先，ai_story_roles.level 仅兜底
角色驻留位置	ai_story_roles.roles[].mapName 优先（ally 生成时覆盖默认落点），sys_state.parked 作兜底
因为重叠，两份同时记录同一角色时会有双份风险——你刚加的 dedupeRoles / parkRole（全图去重）正好兜住这个。