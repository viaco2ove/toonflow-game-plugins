/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

declare const __STORY__: string;
declare const __CONN__: string;
/** dev 模式下使用本地最新图集（workshops/<故事>/images/compiled_tileset_32x32.png） */
declare const __DEV_TILESET__: boolean;

interface ImportMetaEnv {
  readonly VITE_STORY?: string;
  readonly VITE_CONN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
