export type ThemeSetting = "light" | "dark";

export interface UserSettings {
  theme: ThemeSetting;
  oracleClientLibDir: string;
}
