/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

declare const __STORY__: string;
declare const __CONN__: string;

interface ImportMetaEnv {
  readonly VITE_STORY?: string;
  readonly VITE_CONN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
