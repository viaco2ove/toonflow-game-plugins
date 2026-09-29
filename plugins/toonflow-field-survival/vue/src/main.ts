import { createApp } from "vue";
import App from "./App.vue";
import { startMockHostIfStandalone } from "./mockHost";
import { notifyLoaded } from "./bridge";

/** ★ --conn 模式：cross-env CONN=1 注入。
 *  true  → 等真实宿主推送 state；连不上直接报错。
 *  false → 启动 mockHost（默认/本地调试）。 */
const connMode = (() => {
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