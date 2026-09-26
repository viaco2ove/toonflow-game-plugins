import { createApp } from "vue";
import App from "./App.vue";
import { startMockHostIfStandalone } from "./mockHost";

// 当 game.html 直接打开（无宿主 iframe 包装）时，启动本地模拟
startMockHostIfStandalone();

createApp(App).mount("#app");
