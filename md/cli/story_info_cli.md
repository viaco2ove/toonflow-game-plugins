# 故事会话 cli
获取[.env](../../.env) 当前 user_name 对应 的 用户聊过的对话的 动态数据，主要是/game/storyInfo 接口的数据。
## 只看角色列表
python -m toon_plugins story_info -s "赦夜人冥夜走廊-第二季" --worldid 47 --roles

## 完整摘要
python -m toon_plugins story_info -s "赦夜人冥夜走廊-第二季" --worldid 47 --state