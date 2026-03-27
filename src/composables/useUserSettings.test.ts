// @vitest-environment jsdom
import { nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  initializeThemeFromSettings,
  previewTheme,
  useUserSettings,
} from "./useUserSettings";

const STORAGE_KEY = "clarity.user-settings.v1";

function createStorageMock(): Storage {
  const data = new Map<string, string>();

  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    key(index: number) {
      return Array.from(data.keys())[index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, String(value));
    },
  };
}

function readPersistedSettings(): Record<string, unknown> {
  const serialized = window.localStorage.getItem(STORAGE_KEY);
  return serialized ? (JSON.parse(serialized) as Record<string, unknown>) : {};
}

describe("useUserSettings", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createStorageMock(),
    });
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.cssText = "";
    vi.restoreAllMocks();
  });

  it("initializes defaults when storage is empty", async () => {
    const { settings, theme } = useUserSettings();
    await nextTick();

    expect(theme.value).toBe("light");
    expect(settings.value.theme).toBe("light");
    expect(settings.value.uiFontSize).toBe(16);
    expect(settings.value.queryEditorFontSize).toBe(15);
    expect(settings.value.dataFontSize).toBe(11);
    expect(settings.value.aiModel).toBe("gpt-4o-mini");
    expect(settings.value.aiEndpoint).toBe("https://api.openai.com/v1/chat/completions");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("falls back to defaults when stored JSON is invalid", async () => {
    window.localStorage.setItem(STORAGE_KEY, "{invalid");
    const { settings } = useUserSettings();
    await nextTick();

    expect(settings.value.theme).toBe("light");
    expect(settings.value.uiFontSize).toBe(16);
  });

  it("falls back to defaults when stored JSON is not an object", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(123));
    const { settings } = useUserSettings();
    await nextTick();

    expect(settings.value.theme).toBe("light");
    expect(settings.value.uiFontSize).toBe(16);
  });

  it("normalizes persisted values on load", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        theme: "unknown",
        uiFontFamily: " ",
        uiFontSize: "999",
        queryEditorFontFamily: " ",
        queryEditorFontSize: "2",
        dataFontFamily: " ",
        dataFontSize: "999",
        oracleClientLibDir: " /opt/oracle ",
        aiSuggestionsEnabled: "yes",
        aiModel: " ",
        aiEndpoint: " ",
        lastUsedConnectionProfileId: " ",
      }),
    );

    const { settings } = useUserSettings();
    await nextTick();

    expect(settings.value.theme).toBe("light");
    expect(settings.value.uiFontFamily).toContain("SF Pro Display");
    expect(settings.value.uiFontSize).toBe(24);
    expect(settings.value.queryEditorFontFamily).toContain("Consolas");
    expect(settings.value.queryEditorFontSize).toBe(10);
    expect(settings.value.dataFontFamily).toContain("Consolas");
    expect(settings.value.dataFontSize).toBe(24);
    expect(settings.value.oracleClientLibDir).toBe("/opt/oracle");
    expect(settings.value.aiSuggestionsEnabled).toBe(false);
    expect(settings.value.aiModel).toBe("gpt-4o-mini");
    expect(settings.value.aiEndpoint).toBe("https://api.openai.com/v1/chat/completions");
    expect(settings.value.lastUsedConnectionProfileId).toBe("");
  });

  it("uses font and size fallbacks for non-string and non-numeric values", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        uiFontFamily: 42,
        uiFontSize: "not-a-number",
      }),
    );

    const { settings } = useUserSettings();
    await nextTick();

    expect(settings.value.uiFontFamily).toContain("SF Pro Display");
    expect(settings.value.uiFontSize).toBe(16);
  });

  it("preserves valid persisted values without fallback", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        theme: "dark",
        uiFontFamily: "Inter",
        uiFontSize: 17,
        queryEditorFontFamily: "JetBrains Mono",
        queryEditorFontSize: 18,
        dataFontFamily: "Menlo",
        dataFontSize: 12,
        oracleClientLibDir: "/opt/oracle",
        aiSuggestionsEnabled: true,
        aiModel: "gpt-4.1-mini",
        aiEndpoint: "https://example.com/chat",
        lastUsedConnectionProfileId: "profile-123",
      }),
    );

    const { settings } = useUserSettings();
    await nextTick();

    expect(settings.value.theme).toBe("dark");
    expect(settings.value.uiFontFamily).toBe("Inter");
    expect(settings.value.uiFontSize).toBe(17);
    expect(settings.value.queryEditorFontFamily).toBe("JetBrains Mono");
    expect(settings.value.queryEditorFontSize).toBe(18);
    expect(settings.value.dataFontFamily).toBe("Menlo");
    expect(settings.value.dataFontSize).toBe(12);
    expect(settings.value.oracleClientLibDir).toBe("/opt/oracle");
    expect(settings.value.aiSuggestionsEnabled).toBe(true);
    expect(settings.value.aiModel).toBe("gpt-4.1-mini");
    expect(settings.value.aiEndpoint).toBe("https://example.com/chat");
    expect(settings.value.lastUsedConnectionProfileId).toBe("profile-123");
  });

  it("updates settings, persists changes, and applies visual CSS variables", async () => {
    const {
      settings,
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
    } = useUserSettings();

    updateTheme("dark");
    updateUiFontFamily("  Fira Sans ");
    updateUiFontSize(100);
    updateQueryEditorFontFamily("JetBrains Mono");
    updateQueryEditorFontSize(1);
    updateDataFontFamily(" Menlo ");
    updateDataFontSize(100);
    updateOracleClientLibDir(" /usr/local/oracle ");
    updateAiSuggestionsEnabled(true);
    updateAiModel("gpt-4.1-mini");
    updateAiEndpoint("https://example.com/chat");
    updateLastUsedConnectionProfileId(" profile-1 ");
    await nextTick();

    expect(settings.value.theme).toBe("dark");
    expect(settings.value.uiFontFamily).toBe("Fira Sans");
    expect(settings.value.uiFontSize).toBe(24);
    expect(settings.value.queryEditorFontFamily).toBe("JetBrains Mono");
    expect(settings.value.queryEditorFontSize).toBe(10);
    expect(settings.value.dataFontFamily).toBe("Menlo");
    expect(settings.value.dataFontSize).toBe(24);
    expect(settings.value.oracleClientLibDir).toBe("/usr/local/oracle");
    expect(settings.value.aiSuggestionsEnabled).toBe(true);
    expect(settings.value.aiModel).toBe("gpt-4.1-mini");
    expect(settings.value.aiEndpoint).toBe("https://example.com/chat");
    expect(settings.value.lastUsedConnectionProfileId).toBe("profile-1");

    const persisted = readPersistedSettings();
    expect(persisted.theme).toBe("dark");
    expect(persisted.uiFontFamily).toBe("Fira Sans");

    const style = document.documentElement.style;
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(style.getPropertyValue("--font-ui")).toBe("Fira Sans");
    expect(style.getPropertyValue("--font-ui-size")).toBe("24px");
    expect(style.getPropertyValue("--font-editor-size")).toBe("10px");
    expect(style.getPropertyValue("--font-data")).toBe("Menlo");
    expect(style.getPropertyValue("--font-data-size")).toBe("24px");
  });

  it("does not persist when update methods are no-ops", async () => {
    const setItemSpy = vi.spyOn(window.localStorage, "setItem");
    const {
      settings,
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
    } = useUserSettings();
    await nextTick();

    setItemSpy.mockClear();

    updateTheme(settings.value.theme);
    updateUiFontFamily(settings.value.uiFontFamily);
    updateUiFontSize(settings.value.uiFontSize);
    updateQueryEditorFontFamily(settings.value.queryEditorFontFamily);
    updateQueryEditorFontSize(settings.value.queryEditorFontSize);
    updateDataFontFamily(settings.value.dataFontFamily);
    updateDataFontSize(settings.value.dataFontSize);
    updateOracleClientLibDir(` ${settings.value.oracleClientLibDir} `);
    updateAiSuggestionsEnabled(settings.value.aiSuggestionsEnabled);
    updateAiModel(` ${settings.value.aiModel} `);
    updateAiEndpoint(` ${settings.value.aiEndpoint} `);
    updateLastUsedConnectionProfileId(` ${settings.value.lastUsedConnectionProfileId} `);
    await nextTick();

    expect(setItemSpy).not.toHaveBeenCalled();
  });

  it("applies stored theme and font variables during initialization helpers", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        theme: "dark",
        uiFontFamily: "IBM Plex Sans",
        uiFontSize: 18,
        queryEditorFontFamily: "JetBrains Mono",
        queryEditorFontSize: 14,
        dataFontFamily: "Monaco",
        dataFontSize: 12,
      }),
    );

    initializeThemeFromSettings();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.style.getPropertyValue("--font-ui")).toBe(
      "IBM Plex Sans",
    );
    expect(document.documentElement.style.getPropertyValue("--font-editor")).toBe(
      "JetBrains Mono",
    );
    expect(document.documentElement.style.getPropertyValue("--font-data")).toBe(
      "Monaco",
    );

    previewTheme("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("ignores document-only side effects when document is unavailable", () => {
    const originalDocument = globalThis.document;
    try {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: undefined,
      });

      expect(() => initializeThemeFromSettings()).not.toThrow();
      expect(() => previewTheme("dark")).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: originalDocument,
      });
    }
  });

  it("ignores persistence errors when local storage write fails", async () => {
    const setItemSpy = vi
      .spyOn(window.localStorage, "setItem")
      .mockImplementation(() => {
        throw new Error("quota exceeded");
      });

    const { updateTheme } = useUserSettings();
    updateTheme("dark");
    await nextTick();

    expect(setItemSpy).toHaveBeenCalled();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("works safely when window is unavailable", async () => {
    const originalWindow = globalThis.window;
    try {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: undefined,
      });

      const { settings, updateTheme } = useUserSettings();
      updateTheme("dark");
      await nextTick();
      expect(settings.value.theme).toBe("dark");
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    }
  });
});
