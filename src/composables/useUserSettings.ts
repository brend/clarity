import { computed, ref, watch } from "vue";
import type { KeyBindings, ThemeSetting, UserSettings } from "../types/settings";
import { DEFAULT_KEY_BINDINGS, normalizeKeyBindings } from "./useKeyBindings";

const USER_SETTINGS_STORAGE_KEY = "clarity.user-settings.v1";
const THEME_ATTRIBUTE_NAME = "data-theme";
const UI_FONT_FAMILY_DEFAULT =
  '"SF Pro Display", "Avenir Next", "Segoe UI", system-ui, sans-serif';
const UI_FONT_SIZE_DEFAULT = 16;
const QUERY_EDITOR_FONT_FAMILY_DEFAULT = 'Consolas, "Courier New", monospace';
const QUERY_EDITOR_FONT_SIZE_DEFAULT = 15;
const DATA_FONT_FAMILY_DEFAULT = 'Consolas, "Courier New", monospace';
const DATA_FONT_SIZE_DEFAULT = 11;
const DEFAULT_USER_SETTINGS: UserSettings = {
  theme: "light",
  uiFontFamily: UI_FONT_FAMILY_DEFAULT,
  uiFontSize: UI_FONT_SIZE_DEFAULT,
  queryEditorFontFamily: QUERY_EDITOR_FONT_FAMILY_DEFAULT,
  queryEditorFontSize: QUERY_EDITOR_FONT_SIZE_DEFAULT,
  dataFontFamily: DATA_FONT_FAMILY_DEFAULT,
  dataFontSize: DATA_FONT_SIZE_DEFAULT,
  oracleClientLibDir: "",
  aiSuggestionsEnabled: false,
  aiModel: "gpt-4o-mini",
  aiEndpoint: "https://api.openai.com/v1/chat/completions",
  lastUsedConnectionProfileId: "",
  keyBindings: { ...DEFAULT_KEY_BINDINGS },
};

function isThemeSetting(value: unknown): value is ThemeSetting {
  return value === "light" || value === "dark";
}

function normalizeFontFamily(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : fallback;
}

function normalizeFontSize(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : NaN;
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  const rounded = Math.round(numericValue);
  return Math.min(max, Math.max(min, rounded));
}

function normalizeUserSettings(value: unknown): UserSettings {
  if (typeof value !== "object" || value === null) {
    return { ...DEFAULT_USER_SETTINGS };
  }

  const raw = value as Partial<UserSettings>;
  const normalizedOracleClientLibDir =
    typeof raw.oracleClientLibDir === "string" ? raw.oracleClientLibDir.trim() : "";
  const normalizedAiModel = typeof raw.aiModel === "string" ? raw.aiModel.trim() : "";
  const normalizedAiEndpoint = typeof raw.aiEndpoint === "string" ? raw.aiEndpoint.trim() : "";
  const normalizedLastUsedConnectionProfileId =
    typeof raw.lastUsedConnectionProfileId === "string"
      ? raw.lastUsedConnectionProfileId.trim()
      : "";
  return {
    theme: isThemeSetting(raw.theme) ? raw.theme : DEFAULT_USER_SETTINGS.theme,
    uiFontFamily: normalizeFontFamily(
      raw.uiFontFamily,
      DEFAULT_USER_SETTINGS.uiFontFamily,
    ),
    uiFontSize: normalizeFontSize(
      raw.uiFontSize,
      DEFAULT_USER_SETTINGS.uiFontSize,
      12,
      24,
    ),
    queryEditorFontFamily: normalizeFontFamily(
      raw.queryEditorFontFamily,
      DEFAULT_USER_SETTINGS.queryEditorFontFamily,
    ),
    queryEditorFontSize: normalizeFontSize(
      raw.queryEditorFontSize,
      DEFAULT_USER_SETTINGS.queryEditorFontSize,
      10,
      28,
    ),
    dataFontFamily: normalizeFontFamily(
      raw.dataFontFamily,
      DEFAULT_USER_SETTINGS.dataFontFamily,
    ),
    dataFontSize: normalizeFontSize(
      raw.dataFontSize,
      DEFAULT_USER_SETTINGS.dataFontSize,
      9,
      24,
    ),
    oracleClientLibDir: normalizedOracleClientLibDir,
    aiSuggestionsEnabled:
      typeof raw.aiSuggestionsEnabled === "boolean"
        ? raw.aiSuggestionsEnabled
        : DEFAULT_USER_SETTINGS.aiSuggestionsEnabled,
    aiModel: normalizedAiModel.length > 0 ? normalizedAiModel : DEFAULT_USER_SETTINGS.aiModel,
    aiEndpoint: normalizedAiEndpoint.length > 0 ? normalizedAiEndpoint : DEFAULT_USER_SETTINGS.aiEndpoint,
    lastUsedConnectionProfileId:
      normalizedLastUsedConnectionProfileId.length > 0
        ? normalizedLastUsedConnectionProfileId
        : DEFAULT_USER_SETTINGS.lastUsedConnectionProfileId,
    keyBindings: normalizeKeyBindings(
      raw.keyBindings as Partial<KeyBindings> | undefined,
    ),
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

function applyFontSettings(settings: UserSettings): void {
  if (typeof document === "undefined") {
    return;
  }

  const rootStyle = document.documentElement.style;
  rootStyle.setProperty("--font-ui", settings.uiFontFamily);
  rootStyle.setProperty("--font-ui-size", `${settings.uiFontSize}px`);
  rootStyle.setProperty("--font-editor", settings.queryEditorFontFamily);
  rootStyle.setProperty(
    "--font-editor-size",
    `${settings.queryEditorFontSize}px`,
  );
  rootStyle.setProperty("--font-data", settings.dataFontFamily);
  rootStyle.setProperty("--font-data-size", `${settings.dataFontSize}px`);
}

function applyVisualSettings(settings: UserSettings): void {
  applyTheme(settings.theme);
  applyFontSettings(settings);
}

export function initializeThemeFromSettings(): void {
  const stored = readStoredUserSettings();
  applyVisualSettings(stored);
}

export function previewTheme(theme: ThemeSetting): void {
  applyTheme(theme);
}

export function useUserSettings() {
  const settings = ref<UserSettings>(readStoredUserSettings());

  watch(
    settings,
    (nextSettings) => {
      writeStoredUserSettings(nextSettings);
      applyVisualSettings(nextSettings);
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

  function updateUiFontFamily(value: string): void {
    const normalized = normalizeFontFamily(value, DEFAULT_USER_SETTINGS.uiFontFamily);
    if (settings.value.uiFontFamily === normalized) {
      return;
    }

    settings.value = {
      ...settings.value,
      uiFontFamily: normalized,
    };
  }

  function updateUiFontSize(value: number): void {
    const normalized = normalizeFontSize(
      value,
      DEFAULT_USER_SETTINGS.uiFontSize,
      12,
      24,
    );
    if (settings.value.uiFontSize === normalized) {
      return;
    }

    settings.value = {
      ...settings.value,
      uiFontSize: normalized,
    };
  }

  function updateQueryEditorFontFamily(value: string): void {
    const normalized = normalizeFontFamily(
      value,
      DEFAULT_USER_SETTINGS.queryEditorFontFamily,
    );
    if (settings.value.queryEditorFontFamily === normalized) {
      return;
    }

    settings.value = {
      ...settings.value,
      queryEditorFontFamily: normalized,
    };
  }

  function updateQueryEditorFontSize(value: number): void {
    const normalized = normalizeFontSize(
      value,
      DEFAULT_USER_SETTINGS.queryEditorFontSize,
      10,
      28,
    );
    if (settings.value.queryEditorFontSize === normalized) {
      return;
    }

    settings.value = {
      ...settings.value,
      queryEditorFontSize: normalized,
    };
  }

  function updateDataFontFamily(value: string): void {
    const normalized = normalizeFontFamily(
      value,
      DEFAULT_USER_SETTINGS.dataFontFamily,
    );
    if (settings.value.dataFontFamily === normalized) {
      return;
    }

    settings.value = {
      ...settings.value,
      dataFontFamily: normalized,
    };
  }

  function updateDataFontSize(value: number): void {
    const normalized = normalizeFontSize(
      value,
      DEFAULT_USER_SETTINGS.dataFontSize,
      9,
      24,
    );
    if (settings.value.dataFontSize === normalized) {
      return;
    }

    settings.value = {
      ...settings.value,
      dataFontSize: normalized,
    };
  }

  function updateAiSuggestionsEnabled(value: boolean): void {
    if (settings.value.aiSuggestionsEnabled === value) {
      return;
    }

    settings.value = {
      ...settings.value,
      aiSuggestionsEnabled: value,
    };
  }

  function updateAiModel(value: string): void {
    const normalized = value.trim();
    const nextValue = normalized.length > 0 ? normalized : DEFAULT_USER_SETTINGS.aiModel;
    if (settings.value.aiModel === nextValue) {
      return;
    }

    settings.value = {
      ...settings.value,
      aiModel: nextValue,
    };
  }

  function updateAiEndpoint(value: string): void {
    const normalized = value.trim();
    const nextValue = normalized.length > 0 ? normalized : DEFAULT_USER_SETTINGS.aiEndpoint;
    if (settings.value.aiEndpoint === nextValue) {
      return;
    }

    settings.value = {
      ...settings.value,
      aiEndpoint: nextValue,
    };
  }

  function updateLastUsedConnectionProfileId(value: string): void {
    const normalized = value.trim();
    if (settings.value.lastUsedConnectionProfileId === normalized) {
      return;
    }

    settings.value = {
      ...settings.value,
      lastUsedConnectionProfileId: normalized,
    };
  }

  function updateKeyBindings(value: KeyBindings): void {
    const normalized = normalizeKeyBindings(value);
    settings.value = {
      ...settings.value,
      keyBindings: normalized,
    };
  }

  return {
    settings,
    theme,
    updateTheme,
    updateUiFontFamily,
    updateUiFontSize,
    updateQueryEditorFontFamily,
    updateQueryEditorFontSize,
    updateDataFontFamily,
    updateDataFontSize,
    updateOracleClientLibDir,
    updateAiSuggestionsEnabled,
    updateAiModel,
    updateAiEndpoint,
    updateLastUsedConnectionProfileId,
    updateKeyBindings,
  };
}
