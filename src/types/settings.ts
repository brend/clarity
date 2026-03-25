export type ThemeSetting = "light" | "dark";

export interface UserSettings {
  theme: ThemeSetting;
  uiFontFamily: string;
  uiFontSize: number;
  queryEditorFontFamily: string;
  queryEditorFontSize: number;
  dataFontFamily: string;
  dataFontSize: number;
  oracleClientLibDir: string;
  aiSuggestionsEnabled: boolean;
  aiModel: string;
  aiEndpoint: string;
  lastUsedConnectionProfileId: string;
}
