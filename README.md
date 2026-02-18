# Clarity

Clarity is a Tauri + Vue desktop app targeting Oracle as the initial database platform.

## Current MVP Slice

This implementation provides:

- Oracle connection/disconnection flow in the UI
- Schema-aware connection input (host, service, user, schema)
- Schema/object explorer scoped to the connected schema
- Query editor + run action
- Results grid
- Object DDL view/edit and save action

## Oracle Runtime Prerequisite

The app now uses a live Oracle provider via the Rust `oracle` crate.

- Oracle Client libraries are required at runtime (Oracle Instant Client is the common setup).
- If they are not available, connection attempts typically fail with `DPI-1047`.
- On macOS dev runs, set `ORACLE_CLIENT_LIB_DIR` to the directory containing `libclntsh.dylib`.

Example:

```bash
export ORACLE_CLIENT_LIB_DIR=/opt/homebrew/lib/instantclient_23_3
npm run tauri dev
```

If you are unsure where Instant Client is installed:

```bash
find /opt /usr/local "$HOME" -maxdepth 4 -name 'libclntsh.dylib' 2>/dev/null
```

- Rust command API lives in `/Users/waldrumpus/code/clarity/src-tauri/src/lib.rs`
- UI lives in `/Users/waldrumpus/code/clarity/src/App.vue`

## Run

```bash
npm install
npm run tauri dev
```

## Debug Connection Defaults via `.env`

During development (`npm run tauri dev`), the UI will prefill Oracle connection fields from Vite env vars in a project-root `.env` file:

```bash
VITE_ORACLE_HOST=localhost
VITE_ORACLE_PORT=1521
VITE_ORACLE_SERVICE_NAME=XEPDB1
VITE_ORACLE_USERNAME=hr
VITE_ORACLE_PASSWORD=your_password
VITE_ORACLE_SCHEMA=HR
```

Notes:

- These values are used only in dev mode.
- Missing/invalid values fall back to the built-in defaults.

## Build / Verify

```bash
npm run build
cd src-tauri && cargo check
```

## Next Step

Add secure connection profile persistence (without storing plaintext passwords in app state) and query safety guards (default row limits, destructive statement confirmation).
