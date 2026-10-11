import { createApp } from "vue";
import App from "./App.vue";
import { startMockHostIfStandalone } from "./mockHost";
import { notifyLoaded } from "./bridge";

/** ★ --conn 模式：cross-env CONN=1 注入。
 *  true  → 等真实宿主推送 state；连不上直接报错。
 *  false → 启动 mockHost（默认/本地调试）。 */
const connMode = (() => {
  // ★ 独立预览（地图编辑器 window.open ?__standalone=1）：强制 standalone 模式，
  //   即便 dev-host 启动注入了 CONN=1 也忽略，走 mock 宿主、读本地 workshops 地图，无需 storyInfo/鉴权。
  try {
    if (typeof location !== "undefined" && /[?&]__standalone(=1)?(&|$)/.test(location.search)) return false;
  } catch { /* ignore */ }
  try {
    const v = (import.meta as any).env?.VITE_CONN;
    if (v && v !== "0" && v !== "false" && v !== "") return true;
  } catch { /* ignore */ }
  try {
    if (typeof __CONN__ !== "undefined" && __CONN__ && __CONN__ !== "0" && __CONN__ !== "false") return true;
  } catch { /* ignore */ }
  return false;
})();

(async () => {
  if (!connMode) {
    // 默认 / 本地调试：直接启 mockHost
    await startMockHostIfStandalone();
  } else {
    // 拟真模式：通知宿主（让宿主推 state）；连不上直接报错，不做任何兜底
    console.info("[field-survival] --conn 模式：等待真实宿主推送 state");
    notifyLoaded();
  }
  createApp(App).mount("#app");
})();