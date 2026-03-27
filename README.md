# Clarity

Clarity is a Tauri + Vue desktop app targeting Oracle as the initial database platform.

## Current MVP Slice

This implementation provides:

- Provider-aware connection flow (Oracle implemented, more providers scaffolded)
- Schema-aware connection input (host, service, user, schema)
- Schema/object explorer scoped to the connected schema
- Query editor + run action
- Results grid
- Object DDL view/edit and save action

## Oracle Runtime Prerequisite

The app now uses a live Oracle provider via the Rust `oracle` crate.

- Oracle Client libraries are required at runtime (Oracle Instant Client is the common setup).
- If they are not available, connection attempts typically fail with `DPI-1047`.
- You can configure the Oracle client library directory in the app via `Tools -> Settings -> Oracle`.
- You can also set `ORACLE_CLIENT_LIB_DIR` to the directory containing `libclntsh.dylib`.

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
- Provider registry lives in `/Users/waldrumpus/code/clarity/src-tauri/src/providers/mod.rs`
- Oracle provider implementation lives in `/Users/waldrumpus/code/clarity/src-tauri/src/providers/oracle.rs`
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

## Connection Profiles and Secrets

- Connection profiles are saved to the app data directory as non-secret metadata.
- Passwords are stored separately in the OS keychain via the Rust `keyring` crate.
- Profile file never stores plaintext passwords.
- `.env` remains a dev-only fallback for initial field defaults.

## Build / Verify

```bash
npm run build
cd src-tauri && cargo check
```

## App Updates

Clarity uses Tauri's updater plugin against GitHub Releases. The app checks:

- `https://github.com/brend/clarity/releases/latest/download/latest.json`

Users can trigger a manual update check from `Help -> Check for Updates...` or from `Settings -> Updates`.

- The updater only sees the latest published GitHub Release.
- Releases left in draft mode are not visible to installed apps.
- After an update downloads and installs, Clarity relaunches itself to apply it.

## CI/CD (GitHub Actions)

Clarity now includes two workflows:

- CI: `.github/workflows/ci.yml`
  - Runs on pull requests and pushes to `main`
  - Runs Vue unit tests with coverage thresholds (`npm run test:coverage`)
  - Runs frontend E2E smoke tests in Chromium (`npm run test:e2e`)
  - Builds the Vue frontend (`npm run build`)
  - Runs Rust checks/tests for `src-tauri` (`cargo check`, `cargo test`)
- Release: `.github/workflows/release.yml`
  - Runs when a Git tag matching `v*` is pushed (example: `v0.1.0`)
  - Builds Tauri bundles on Linux, macOS, and Windows
  - Creates/updates a GitHub Release and uploads platform artifacts

### Required GitHub secrets

In `Settings -> Secrets and variables -> Actions`, add:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

These are used by `tauri-action` for signed updater artifacts. `GITHUB_TOKEN` is provided automatically by GitHub Actions.

### Recommended branch protection

For `main`, enable:

- Require a pull request before merging
- Require status checks to pass before merging
- Select checks from the `CI` workflow (`Frontend Build`, `Rust Check`)
- Require branches to be up to date before merging

### Release command

From a clean `main` branch:

```bash
git tag v0.1.1
git push origin v0.1.1
```

Release checklist:

- Bump the app version consistently in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
- Push the matching `v...` Git tag.
- GitHub Actions builds the installers and updater artifacts, including `latest.json`.
- The workflow currently creates a draft release. Publish that draft in GitHub before users can receive the update through Clarity.

## Next Step

Add profile import/export tooling and provider implementations beyond Oracle.
