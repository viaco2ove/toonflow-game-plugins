<script setup lang="ts">
/**
 * sms/SmsNewGroupModal.vue — 新建群聊弹窗
 * =================================================
 * 职责：选成员（≥2）+ 填群名 → emit("create", { name, memberIds })
 *
 * 成员来源（设计文档 §7.2）：
 *   AIState.enabled === true 的角色 ∪ 场上存活的 ally 类型实体
 *
 * 设计文档：通信(短信).design.md §7.3
 */
import { computed, ref, watch } from "vue";

export interface SmsContact {
  id: string;
  name: string;
  /** 是否 AI 托管中（用于分组展示） */
  managed: boolean;
}

const props = defineProps<{
  open: boolean;
  contacts: SmsContact[];
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "create", payload: { name: string; memberIds: string[] }): void;
}>();

const groupName = ref("");
const picked = ref<Set<string>>(new Set());
const error = ref("");

// 每次打开时重置
watch(
  () => props.open,
  (on) => {
    if (on) {
      groupName.value = "";
      picked.value = new Set();
      error.value = "";
    }
  },
);

/** 托管角色 / 非托管角色 分两组 */
const managedList = computed(() => props.contacts.filter((c) => c.managed));
const otherList = computed(() => props.contacts.filter((c) => !c.managed));

function toggle(id: string): void {
  const s = new Set(picked.value);
  if (s.has(id)) s.delete(id);
  else s.add(id);
  picked.value = s;
  error.value = "";
}

function onCreate(): void {
  if (picked.value.size < 2) {
    error.value = "至少选择 2 位角色";
    return;
  }
  const name = groupName.value.trim() || "新群聊";
  emit("create", { name, memberIds: [...picked.value] });
}
</script>

<template>
  <div v-if="open" class="modal-mask" @click.self="emit('close')">
    <div class="modal">
      <div class="modal-head">
        <span class="modal-title">新建群聊</span>
        <button class="modal-close" @click="emit('close')" title="关闭">×</button>
      </div>

      <div class="modal-body">
        <label class="field">
          <span class="field-label">群名称</span>
          <input
            v-model="groupName"
            type="text"
            maxlength="20"
            placeholder="例如：林家护卫团"
            @keyup.enter="onCreate"
          />
        </label>

        <div class="field">
          <span class="field-label">
            选择成员
            <span class="field-hint">已选 {{ picked.size }} 人（至少 2 人）</span>
          </span>

          <div class="pick-scroll">
            <template v-if="managedList.length">
              <div class="pick-group">AI 托管中</div>
              <label
                v-for="c in managedList"
                :key="c.id"
                class="pick-item"
                :class="{ on: picked.has(c.id) }"
                @click="toggle(c.id)"
              >
                <input type="checkbox" :checked="picked.has(c.id)" @click.stop="toggle(c.id)" />
                <span class="pick-name">{{ c.name }}</span>
                <span class="pick-badge">托管</span>
              </label>
            </template>

            <template v-if="otherList.length">
              <div class="pick-group">其他角色</div>
              <label
                v-for="c in otherList"
                :key="c.id"
                class="pick-item"
                :class="{ on: picked.has(c.id) }"
                @click="toggle(c.id)"
              >
                <input type="checkbox" :checked="picked.has(c.id)" @click.stop="toggle(c.id)" />
                <span class="pick-name">{{ c.name }}</span>
              </label>
            </template>

            <div v-if="!contacts.length" class="pick-empty">
              暂无通讯录 —— 勾选「AI 托管」后角色才会出现在这里
            </div>
          </div>
        </div>

        <div v-if="error" class="modal-error">{{ error }}</div>
      </div>

      <div class="modal-foot">
        <button class="btn-ghost" @click="emit('close')">取消</button>
        <button class="btn-primary" @click="onCreate">创建</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.modal {
  width: 320px;
  max-width: 90%;
  max-height: 82%;
  display: flex;
  flex-direction: column;
  background: #1e1f1f;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.6);
  color: #e8eef5;
  font-size: 12px;
}
.modal-head {
  position: relative;
  padding: 10px 34px 10px 12px;
  background: rgba(255, 255, 255, 0.05);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}
.modal-title { font-weight: 700; font-size: 13px; }
.modal-close {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 4px;
  color: #cfd8e3;
  font-size: 14px;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
}
/* ★ overflow-x 必须显式设 hidden：
     只写 overflow-y:auto 时，overflow-x 会被算成 auto → 出现横向滚动条 */
.modal-body { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 12px; min-height: 0; }
.field { display: block; margin-bottom: 12px; }
.field-label {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 5px;
  color: #cfd8e3;
  font-size: 11px;
}
.field-hint { color: #5b6672; font-size: 10px; }
.field input[type="text"] {
  width: 100%;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  padding: 6px 8px;
  color: #e8eef5;
  font-size: 12px;
  outline: none;
  font-family: inherit;
}
.field input[type="text"]:focus { border-color: #2f6fd0; }
.field input::placeholder { color: #5b6672; }

.pick-scroll {
  max-height: 190px;
  overflow-y: auto;
  overflow-x: hidden;      /* ★ 不出横向滚动条 */
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  padding: 4px;
  background: rgba(255, 255, 255, 0.02);
}
.pick-group {
  font-size: 10px;
  color: #5b6672;
  padding: 5px 6px 3px;
}
.pick-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 6px;
  border-radius: 3px;
  cursor: pointer;
  min-width: 0;
}
.pick-item:hover { background: rgba(255, 255, 255, 0.05); }
.pick-item.on { background: rgba(47, 111, 208, 0.18); }
.pick-item input { accent-color: #2f6fd0; margin: 0; }
.pick-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pick-badge {
  font-size: 9px;
  background: rgba(47, 111, 208, 0.25);
  color: #7fb0ff;
  padding: 1px 4px;
  border-radius: 2px;
  flex-shrink: 0;
}
.pick-empty { padding: 14px 8px; text-align: center; color: #5b6672; font-size: 11px; }
.modal-error { color: #e04a4a; font-size: 11px; margin-top: 6px; }
.modal-foot {
  padding: 9px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-shrink: 0;
}
.btn-ghost {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.16);
  color: #cfd8e3;
  padding: 6px 14px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}
.btn-primary {
  background: #2f6fd0;
  border: 1px solid #5a9bff;
  color: #fff;
  padding: 6px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}
.btn-primary:hover { background: #3d80e8; }
</style>
