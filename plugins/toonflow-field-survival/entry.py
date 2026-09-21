# entry.py - 野外生存插件后端入口
# 职责：游戏初始化、奖励发放、与角色参数卡联动
"""
野外生存 - 后端插件
提供以下能力：
1. 游戏初始化：生成敌人波次、计算难度系数
2. 奖励发放：将经验/金钱/物品写入角色参数卡
3. 事件记录：记录游戏过程到会话日志
"""

import json
import random
import math
from typing import Dict, Any, Optional, List

# ============================================================
# 难度配置
# ============================================================
DIFFICULTY_CONFIG = {
    '简单': {'enemy_hp_mult': 0.7, 'enemy_atk_mult': 0.6, 'reward_mult': 1.3, 'wave_count': 3},
    '普通': {'enemy_hp_mult': 1.0, 'enemy_atk_mult': 1.0, 'reward_mult': 1.0, 'wave_count': 5},
    '困难': {'enemy_hp_mult': 1.5, 'enemy_atk_mult': 1.4, 'reward_mult': 0.8, 'wave_count': 7}
}


# ============================================================
# 角色战斗属性计算
# ============================================================
def calc_character_stats(character_data: Dict, difficulty: str = '普通') -> Dict:
    """
    根据角色参数卡计算战斗属性
    character_data: 角色参数卡 JSON
    """
    diff = DIFFICULTY_CONFIG.get(difficulty, DIFFICULTY_CONFIG['普通'])

    # 基础属性（从参数卡读取或默认值）
    base_hp = character_data.get('属性', {}).get('生命值', 100)
    base_atk = character_data.get('属性', {}).get('攻击力', 20)
    base_def = character_data.get('属性', {}).get('防御力', 10)
    level = character_data.get('等级', 1)

    # 等级加成
    level_bonus_hp = (level - 1) * 10
    level_bonus_atk = (level - 1) * 3
    level_bonus_def = (level - 1) * 2

    max_hp = base_hp + level_bonus_hp
    atk = math.floor((base_atk + level_bonus_atk) * diff.get('enemy_hp_mult', 1.0))
    defense = base_def + level_bonus_def

    return {
        'hp': max_hp,
        'maxHp': max_hp,
        'atk': atk,
        'def': defense,
        'level': level,
        'exp': character_data.get('经验', 0),
        'expToNext': character_data.get('升级经验', 100),
        'gold': character_data.get('金钱', 0)
    }


# ============================================================
# 敌人生成
# ============================================================
def generate_enemies(party: List[str], difficulty: str, wave: int = 1) -> List[Dict]:
    """
    生成一波敌人
    party: 参战角色列表（用于计算数量）
    difficulty: 难度
    wave: 当前波次
    """
    diff_cfg = DIFFICULTY_CONFIG.get(difficulty, DIFFICULTY_CONFIG['普通'])
    party_size = max(1, len(party))
    enemy_count = min(2 + wave, 6)  # 每波敌人数

    enemies = []
    for i in range(enemy_count):
        level = wave + i
        hp = math.floor(60 * diff_cfg['enemy_hp_mult'] * (1 + wave * 0.3))
        enemies.append({
            'id': f'enemy_{wave}_{i}',
            'name': f'野外怪物 {wave}-{i + 1}',
            'level': level,
            'hp': hp,
            'maxHp': hp,
            'atk': math.floor(12 * diff_cfg['enemy_atk_mult'] * (1 + wave * 0.2)),
            'def': math.floor(6 * diff_cfg['enemy_hp_mult']),
            'gold': math.floor(10 * level * diff_cfg.get('reward_mult', 1.0)),
            'exp': math.floor(15 * level * diff_cfg.get('reward_mult', 1.0)),
            'skills': [
                {'name': '撕咬', 'damage': math.floor(10 * diff_cfg['enemy_atk_mult']), 'cd': 2},
                {'name': '怒吼', 'damage': math.floor(20 * diff_cfg['enemy_atk_mult']), 'cd': 5}
            ]
        })
    return enemies


# ============================================================
# 奖励计算
# ============================================================
def calc_rewards(enemies_killed: List[Dict], difficulty: str) -> Dict:
    """
    计算击杀奖励
    enemies_killed: 被击杀的敌人列表
    """
    diff_cfg = DIFFICULTY_CONFIG.get(difficulty, DIFFICULTY_CONFIG['普通'])
    total_exp = sum(e.get('exp', 0) for e in enemies_killed)
    total_gold = sum(e.get('gold', 0) for e in enemies_killed)

    # 掉落物品
    items = []
    for e in enemies_killed:
        if random.random() < 0.3:
            items.append({
                'name': '随机宝石',
                'icon': '💎',
                'type': 'treasure',
                'value': random.randint(20, 50)
            })
        if random.random() < 0.5:
            items.append({
                'name': '恢复药水',
                'icon': '🧪',
                'type': 'consumable',
                'heal': 30
            })

    return {
        'exp': math.floor(total_exp * diff_cfg.get('reward_mult', 1.0)),
        'gold': math.floor(total_gold * diff_cfg.get('reward_mult', 1.0)),
        'items': items,
        'victory': True,
        'wave_cleared': len(enemies_killed)
    }


# ============================================================
# 奖励发放（写入角色参数卡）
# ============================================================
def apply_rewards_to_character(character_data: Dict, rewards: Dict) -> Dict:
    """
    将奖励写入角色参数卡
    返回更新后的角色数据
    """
    updated = dict(character_data)

    # 更新金钱
    current_gold = updated.get('金钱', 0)
    updated['金钱'] = current_gold + rewards.get('gold', 0)

    # 更新经验
    current_exp = updated.get('经验', 0)
    new_exp = current_exp + rewards.get('exp', 0)
    updated['经验'] = new_exp

    # 检查升级
    exp_to_next = updated.get('升级经验', 100)
    level = updated.get('等级', 1)
    leveled_up = False

    while new_exp >= exp_to_next:
        new_exp -= exp_to_next
        level += 1
        exp_to_next = math.floor(exp_to_next * 1.5)
        leveled_up = True

    updated['经验'] = new_exp
    updated['等级'] = level
    updated['升级经验'] = exp_to_next

    # 更新属性（升级加成）
    if leveled_up:
        attrs = updated.get('属性', {})
        attrs['生命值'] = attrs.get('生命值', 100) + 10
        attrs['攻击力'] = attrs.get('攻击力', 20) + 3
        attrs['防御力'] = attrs.get('防御力', 10) + 2
        updated['属性'] = attrs

    # 记录获得物品
    if rewards.get('items'):
        inventory = updated.get('背包', [])
        inventory.extend(rewards['items'])
        updated['背包'] = inventory

    return updated


# ============================================================
# 主处理函数（由 MiniGameAgent 调用）
# ============================================================
async def handle_action(action: str, params: Dict, state: Dict, context: Dict) -> Dict:
    """
    统一入口：处理来自前端插件的所有请求

    action: 操作类型
    params: 请求参数
    state: 游戏状态（session 级别）
    context: 执行上下文（session_id, user_id 等）
    """
    handlers = {
        'init': handle_init,
        'spawn_wave': handle_spawn_wave,
        'apply_rewards': handle_apply_rewards,
        'end_game': handle_end_game,
        'get_character_stats': handle_get_character_stats
    }

    handler = handlers.get(action)
    if not handler:
        return {'error': f'Unknown action: {action}', 'code': 400}

    try:
        return await handler(action, params, state, context)
    except Exception as e:
        return {'error': str(e), 'code': 500}


async def handle_init(action: str, params: Dict, state: Dict, context: Dict) -> Dict:
    """游戏初始化"""
    party = params.get('party', [])
    difficulty = params.get('difficulty', '普通')

    # 获取角色战斗属性
    party_stats = {}
    for char_id in party:
        # 实际应从数据库读取角色参数卡
        char_data = state.get(f'char_{char_id}', {
            '等级': 1, '经验': 0, '金钱': 0,
            '属性': {'生命值': 100, '攻击力': 20, '防御力': 10}
        })
        party_stats[char_id] = calc_character_stats(char_data, difficulty)

    # 初始波次
    enemies = generate_enemies(party, difficulty, wave=1)
    diff_cfg = DIFFICULTY_CONFIG.get(difficulty, DIFFICULTY_CONFIG['普通'])

    return {
        'code': 0,
        'data': {
            'partyStats': party_stats,
            'enemies': enemies,
            'waveCount': diff_cfg['wave_count'],
            'difficultyConfig': diff_cfg
        }
    }


async def handle_spawn_wave(action: str, params: Dict, state: Dict, context: Dict) -> Dict:
    """生成指定波次敌人"""
    party = params.get('party', [])
    difficulty = params.get('difficulty', '普通')
    wave = params.get('wave', 1)

    enemies = generate_enemies(party, difficulty, wave)

    return {'code': 0, 'data': {'enemies': enemies, 'wave': wave}}


async def handle_apply_rewards(action: str, params: Dict, state: Dict, context: Dict) -> Dict:
    """发放奖励到角色"""
    rewards = params.get('rewards', {})
    character_ids = params.get('characterIds', [])

    results = {}
    for char_id in character_ids:
        char_key = f'char_{char_id}'
        char_data = state.get(char_key, {})
        updated = apply_rewards_to_character(char_data, rewards)
        state[char_key] = updated
        results[char_id] = updated

    return {'code': 0, 'data': {'updated': results}}


async def handle_end_game(action: str, params: Dict, state: Dict, context: Dict) -> Dict:
    """结束游戏，汇总奖励"""
    enemies_killed = params.get('enemiesKilled', [])
    difficulty = params.get('difficulty', '普通')
    victory = params.get('victory', False)

    rewards = calc_rewards(enemies_killed, difficulty)
    rewards['victory'] = victory

    return {'code': 0, 'data': {'rewards': rewards}}


async def handle_get_character_stats(action: str, params: Dict, state: Dict, context: Dict) -> Dict:
    """获取角色战斗属性"""
    char_id = params.get('characterId')
    difficulty = params.get('difficulty', '普通')

    if not char_id:
        return {'error': 'characterId required', 'code': 400}

    char_key = f'char_{char_id}'
    char_data = state.get(char_key, {})
    stats = calc_character_stats(char_data, difficulty)

    return {'code': 0, 'data': stats}


# ============================================================
# 工具函数
# ============================================================
def get_state_key(session_id: str, key: str) -> str:
    """生成状态存储键"""
    return f'survival_{session_id}_{key}'


def serialize_game_log(rewards: Dict) -> str:
    """生成游戏日志文本"""
    lines = ['=== 野外生存 战斗报告 ===']
    lines.append(f"结果: {'胜利 ✓' if rewards.get('victory') else '失败 ✗'}")
    lines.append(f"获得经验: +{rewards.get('exp', 0)}")
    lines.append(f"获得金币: +{rewards.get('gold', 0)}")
    items = rewards.get('items', [])
    if items:
        lines.append('获得物品:')
        for item in items:
            lines.append(f"  {item.get('icon', '')} {item.get('name', '')}")
    return '\n'.join(lines)


# ============================================================
# 测试入口
# ============================================================
if __name__ == '__main__':
    # 简单测试
    print("=== 野外生存后端测试 ===")
    print(f"难度配置: {list(DIFFICULTY_CONFIG.keys())}")

    # 测试敌人生成
    enemies = generate_enemies(['角色1'], '普通', wave=2)
    print(f"\n生成波次2敌人: {len(enemies)}个")
    for e in enemies:
        print(f"  - {e['name']}: HP={e['hp']}, ATK={e['atk']}")

    # 测试奖励计算
    rewards = calc_rewards(enemies, '普通')
    print(f"\n奖励: EXP={rewards['exp']}, GOLD={rewards['gold']}")
    print(f"掉落物品: {[i['name'] for i in rewards['items']]}")

    # 测试奖励发放
    char = {'等级': 1, '经验': 50, '金钱': 100, '属性': {'生命值': 100, '攻击力': 20, '防御力': 10}}
    updated = apply_rewards_to_character(char, rewards)
    print(f"\n角色更新: 等级={updated['等级']}, 经验={updated['经验']}, 金钱={updated['金钱']}")
