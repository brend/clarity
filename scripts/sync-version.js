import { readFileSync, writeFileSync } from "fs";

const version = JSON.parse(readFileSync("package.json", "utf-8")).version;

// Update tauri.conf.json
const tauriConfPath = "src-tauri/tauri.conf.json";
const tauriConf = JSON.parse(readFileSync(tauriConfPath, "utf-8"));
tauriConf.version = version;
writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + "\n");

// Update Cargo.toml
const cargoPath = "src-tauri/Cargo.toml";
const cargo = readFileSync(cargoPath, "utf-8");
writeFileSync(
  cargoPath,
  cargo.replace(/^version = ".*"/m, `version = "${version}"`)
);

console.log(`Synced version ${version} to tauri.conf.json and Cargo.toml`);
