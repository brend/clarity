export type ThemeSetting = "light" | "dark";

export interface UserSettings {
  theme: ThemeSetting;
  oracleClientLibDir: string;
  aiSuggestionsEnabled: boolean;
  aiModel: string;
  aiEndpoint: string;
}
