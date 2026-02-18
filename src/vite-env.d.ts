/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ORACLE_HOST?: string;
  readonly VITE_ORACLE_PORT?: string;
  readonly VITE_ORACLE_SERVICE_NAME?: string;
  readonly VITE_ORACLE_USERNAME?: string;
  readonly VITE_ORACLE_PASSWORD?: string;
  readonly VITE_ORACLE_SCHEMA?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
