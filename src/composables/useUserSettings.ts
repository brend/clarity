import { computed, ref, watch } from "vue";
import type { ThemeSetting, UserSettings } from "../types/settings";

const USER_SETTINGS_STORAGE_KEY = "clarity.user-settings.v1";
const THEME_ATTRIBUTE_NAME = "data-theme";
const DEFAULT_USER_SETTINGS: UserSettings = {
  theme: "light",
  oracleClientLibDir: "",
};

function isThemeSetting(value: unknown): value is ThemeSetting {
  return value === "light" || value === "dark";
}

function normalizeUserSettings(value: unknown): UserSettings {
  if (typeof value !== "object" || value === null) {
    return { ...DEFAULT_USER_SETTINGS };
  }

  const raw = value as Partial<UserSettings>;
  const normalizedOracleClientLibDir =
    typeof raw.oracleClientLibDir === "string" ? raw.oracleClientLibDir.trim() : "";
  return {
    theme: isThemeSetting(raw.theme) ? raw.theme : DEFAULT_USER_SETTINGS.theme,
    oracleClientLibDir: normalizedOracleClientLibDir,
  };
}

function readStoredUserSettings(): UserSettings {
  if (typeof window === "undefined") {
    return { ...DEFAULT_USER_SETTINGS };
  }

  try {
    const serialized = window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY);
    if (!serialized) {
      return { ...DEFAULT_USER_SETTINGS };
    }

    return normalizeUserSettings(JSON.parse(serialized));
  } catch {
    return { ...DEFAULT_USER_SETTINGS };
  }
}

function writeStoredUserSettings(settings: UserSettings): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(USER_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore persistence errors; settings still apply for the current session.
  }
}

function applyTheme(theme: ThemeSetting): void {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.setAttribute(THEME_ATTRIBUTE_NAME, theme);
}

export function initializeThemeFromSettings(): void {
  const stored = readStoredUserSettings();
  applyTheme(stored.theme);
}

export function useUserSettings() {
  const settings = ref<UserSettings>(readStoredUserSettings());

  watch(
    settings,
    (nextSettings) => {
      writeStoredUserSettings(nextSettings);
      applyTheme(nextSettings.theme);
    },
    { deep: true, immediate: true },
  );

  const theme = computed<ThemeSetting>(() => settings.value.theme);

  function updateTheme(themeValue: ThemeSetting): void {
    if (settings.value.theme === themeValue) {
      return;
    }

    settings.value = {
      ...settings.value,
      theme: themeValue,
    };
  }

  function updateOracleClientLibDir(value: string): void {
    const normalized = value.trim();
    if (settings.value.oracleClientLibDir === normalized) {
      return;
    }

    settings.value = {
      ...settings.value,
      oracleClientLibDir: normalized,
    };
  }

  return {
    settings,
    theme,
    updateTheme,
    updateOracleClientLibDir,
  };
}
