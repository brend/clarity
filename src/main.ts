import { createApp } from "vue";
import App from "./App.vue";
import { initializeThemeFromSettings } from "./composables/useUserSettings";

initializeThemeFromSettings();
createApp(App).mount("#app");
