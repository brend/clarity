<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import ExplorerSidebar from "./components/ExplorerSidebar.vue";
import QueryResultsPane from "./components/QueryResultsPane.vue";
import WorkspaceSheet from "./components/WorkspaceSheet.vue";
import { useClarityWorkspace } from "./composables/useClarityWorkspace";
import { usePaneLayout } from "./composables/usePaneLayout";
import { useUserSettings } from "./composables/useUserSettings";
import type { ThemeSetting } from "./types/settings";

const EVENT_OPEN_EXPORT_DATABASE_DIALOG = "clarity://open-export-database-dialog";
const EVENT_OPEN_SETTINGS_DIALOG = "clarity://open-settings-dialog";
const EVENT_SCHEMA_EXPORT_PROGRESS = "clarity://schema-export-progress";

const desktopShellEl = ref<HTMLElement | null>(null);
const workspaceEl = ref<HTMLElement | null>(null);

const { desktopShellStyle, workspaceStyle, beginSidebarResize, beginResultsResize } = usePaneLayout({
  desktopShellEl,
  workspaceEl,
});

const {
  connection,
  profileName,
  selectedProfileId,
  saveProfilePassword,
  session,
  connectionProfiles,
  selectedProfile,
  schemaExportTargets,
  busy,
  isConnected,
  connectedSchema,
  selectedProviderLabel,
  objectTree,
  selectedObject,
  queryTabs,
  ddlTabs,
  activeWorkspaceTabId,
  isSearchTabActive,
  activeQueryTab,
  activeDdlTab,
  activeDdlObject,
  activeObjectDetailTabs,
  activeObjectDetailTabId,
  activeObjectDetailResult,
  isActiveObjectDataEditable,
  activeObjectDetailLoading,
  activeQueryText,
  activeDdlText,
  queryRowLimit,
  sourceSearchText,
  sourceSearchResults,
  sourceSearchPerformed,
  queryResult,
  exportDestinationDirectory,
  selectedExportSessionId,
  statusMessage,
  errorMessage,
  isQueryTabActive,
  isObjectTypeExpanded,
  toggleObjectType,
  addQueryTab,
  openSearchTab,
  activateWorkspaceTab,
  closeQueryTab,
  closeDdlTab,
  openObjectFromExplorer,
  activateObjectDetailTab,
  refreshActiveObjectDetail,
  updateActiveObjectDataRow,
  insertActiveObjectDataRow,
  startSchemaExport,
  chooseSchemaExportDirectory,
  exportDatabaseSchema,
  loadConnectionProfiles,
  syncSelectedProfileUi,
  applySelectedProfile,
  saveConnectionProfile,
  deleteSelectedProfile,
  connectOracle,
  disconnectOracle,
  refreshObjects,
  saveDdl,
  runQuery,
  runSourceSearch,
  openSourceSearchResult,
  isLikelyNumeric,
} = useClarityWorkspace();

const showExportDialog = ref(false);
const showSettingsDialog = ref(false);
const exportSummaryMessage = ref("");
const exportMenuUnlisten = ref<UnlistenFn | null>(null);
const settingsMenuUnlisten = ref<UnlistenFn | null>(null);
const exportProgressUnlisten = ref<UnlistenFn | null>(null);
const exportProgressProcessed = ref(0);
const exportProgressTotal = ref(0);
const exportProgressCurrentObject = ref("");
const { theme, updateTheme } = useUserSettings();
const settingsDialogTheme = ref<ThemeSetting>(theme.value);
const canRunSchemaExport = computed<boolean>(() => {
  return (
    Number.isFinite(selectedExportSessionId.value) &&
    exportDestinationDirectory.value.trim().length > 0 &&
    !busy.exportingSchema
  );
});
const hasDeterminateExportProgress = computed<boolean>(() => exportProgressTotal.value > 0);
const exportProgressPercent = computed<number>(() => {
  if (exportProgressTotal.value <= 0) {
    return 0;
  }

  return Math.min(
    100,
    Math.max(0, Math.round((exportProgressProcessed.value / exportProgressTotal.value) * 100)),
  );
});

interface SchemaExportProgressPayload {
  processedObjects: number;
  totalObjects: number;
  exportedFiles: number;
  skippedCount: number;
  currentObject: string;
}

function openExportDialogFromMenu(): void {
  if (!startSchemaExport()) {
    return;
  }

  exportSummaryMessage.value = "";
  exportProgressProcessed.value = 0;
  exportProgressTotal.value = 0;
  exportProgressCurrentObject.value = "";
  showExportDialog.value = true;
}

function openSettingsDialog(): void {
  settingsDialogTheme.value = theme.value;
  showSettingsDialog.value = true;
}

function closeSettingsDialog(): void {
  showSettingsDialog.value = false;
}

function saveSettingsDialog(): void {
  updateTheme(settingsDialogTheme.value);
  showSettingsDialog.value = false;
}

function closeExportDialog(): void {
  if (busy.exportingSchema) {
    return;
  }

  showExportDialog.value = false;
}

async function browseSchemaExportDirectory(): Promise<void> {
  await chooseSchemaExportDirectory();
}

async function runSchemaExport(): Promise<void> {
  exportSummaryMessage.value = "";
  exportProgressProcessed.value = 0;
  exportProgressTotal.value = 0;
  exportProgressCurrentObject.value = "";
  const result = await exportDatabaseSchema();
  if (!result) {
    return;
  }

  exportProgressProcessed.value = result.objectCount;
  exportProgressTotal.value = result.objectCount;
  exportProgressCurrentObject.value = "";
  exportSummaryMessage.value = result.message;
}

onMounted(() => {
  void loadConnectionProfiles();
  void listen(EVENT_OPEN_EXPORT_DATABASE_DIALOG, () => {
    openExportDialogFromMenu();
  }).then((unlisten) => {
    exportMenuUnlisten.value = unlisten;
  });
  void listen(EVENT_OPEN_SETTINGS_DIALOG, () => {
    openSettingsDialog();
  }).then((unlisten) => {
    settingsMenuUnlisten.value = unlisten;
  });
  void listen<SchemaExportProgressPayload>(EVENT_SCHEMA_EXPORT_PROGRESS, (event) => {
    const payload = event.payload;
    exportProgressProcessed.value = payload.processedObjects ?? 0;
    exportProgressTotal.value = payload.totalObjects ?? 0;
    exportProgressCurrentObject.value = payload.currentObject ?? "";
  }).then((unlisten) => {
    exportProgressUnlisten.value = unlisten;
  });
});

onBeforeUnmount(() => {
  if (exportMenuUnlisten.value) {
    exportMenuUnlisten.value();
    exportMenuUnlisten.value = null;
  }
  if (exportProgressUnlisten.value) {
    exportProgressUnlisten.value();
    exportProgressUnlisten.value = null;
  }
  if (settingsMenuUnlisten.value) {
    settingsMenuUnlisten.value();
    settingsMenuUnlisten.value = null;
  }
});
</script>

<template>
  <main ref="desktopShellEl" class="desktop-shell" :style="desktopShellStyle">
    <ExplorerSidebar
      v-model:selected-profile-id="selectedProfileId"
      v-model:profile-name="profileName"
      v-model:save-profile-password="saveProfilePassword"
      :connection="connection"
      :connection-profiles="connectionProfiles"
      :selected-profile="selectedProfile"
      :busy="busy"
      :is-connected="isConnected"
      :session="session"
      :connected-schema="connectedSchema"
      :object-tree="objectTree"
      :selected-object="selectedObject"
      :is-object-type-expanded="isObjectTypeExpanded"
      :on-sync-selected-profile-ui="syncSelectedProfileUi"
      :on-apply-selected-profile="applySelectedProfile"
      :on-delete-selected-profile="deleteSelectedProfile"
      :on-save-connection-profile="saveConnectionProfile"
      :on-connect="connectOracle"
      :on-disconnect="disconnectOracle"
      :on-refresh-objects="refreshObjects"
      :on-toggle-object-type="toggleObjectType"
      :on-open-object-from-explorer="openObjectFromExplorer"
    />

    <div
      class="panel-resizer vertical"
      role="separator"
      aria-orientation="vertical"
      title="Resize explorer and workspace"
      @pointerdown="beginSidebarResize"
    ></div>

    <section ref="workspaceEl" class="workspace" :style="workspaceStyle">
      <WorkspaceSheet
        v-model:query-text="activeQueryText"
        v-model:ddl-text="activeDdlText"
        v-model:query-row-limit="queryRowLimit"
        v-model:source-search-text="sourceSearchText"
        :status-message="statusMessage"
        :query-tabs="queryTabs"
        :ddl-tabs="ddlTabs"
        :active-workspace-tab-id="activeWorkspaceTabId"
        :is-search-tab-active="isSearchTabActive"
        :is-connected="isConnected"
        :busy="busy"
        :active-query-tab="activeQueryTab"
        :active-ddl-tab="activeDdlTab"
        :active-ddl-object="activeDdlObject"
        :active-object-detail-tabs="activeObjectDetailTabs"
        :active-object-detail-tab-id="activeObjectDetailTabId"
        :active-object-detail-loading="activeObjectDetailLoading"
        :active-object-detail-result="activeObjectDetailResult"
        :is-active-object-data-editable="isActiveObjectDataEditable"
        :selected-provider-label="selectedProviderLabel"
        :connected-schema="connectedSchema"
        :is-query-tab-active="isQueryTabActive"
        :source-search-results="sourceSearchResults"
        :source-search-performed="sourceSearchPerformed"
        :theme="theme"
        :on-activate-workspace-tab="activateWorkspaceTab"
        :on-close-query-tab="closeQueryTab"
        :on-add-query-tab="addQueryTab"
        :on-open-search-tab="openSearchTab"
        :on-open-settings="openSettingsDialog"
        :on-close-ddl-tab="closeDdlTab"
        :on-run-query="runQuery"
        :on-save-ddl="saveDdl"
        :on-refresh-active-object-detail="refreshActiveObjectDetail"
        :on-update-active-object-data-row="updateActiveObjectDataRow"
        :on-insert-active-object-data-row="insertActiveObjectDataRow"
        :on-activate-object-detail-tab="activateObjectDetailTab"
        :on-run-source-search="runSourceSearch"
        :on-open-source-search-result="openSourceSearchResult"
        :is-likely-numeric="isLikelyNumeric"
      />

      <div
        class="panel-resizer horizontal"
        role="separator"
        aria-orientation="horizontal"
        title="Resize worksheet and results"
        @pointerdown="beginResultsResize"
      ></div>

      <QueryResultsPane
        :query-result="queryResult"
        :error-message="errorMessage"
        :is-likely-numeric="isLikelyNumeric"
      />
    </section>
  </main>

  <div v-if="showSettingsDialog" class="dialog-backdrop" @click.self="closeSettingsDialog">
    <section class="dialog settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-dialog-title">
      <header class="dialog-header">
        <h2 id="settings-dialog-title" class="dialog-title">Settings</h2>
      </header>

      <div class="dialog-body">
        <fieldset class="settings-group">
          <legend>Appearance</legend>
          <label class="settings-option">
            <input v-model="settingsDialogTheme" type="radio" value="light" />
            <span>Light</span>
          </label>
          <label class="settings-option">
            <input v-model="settingsDialogTheme" type="radio" value="dark" />
            <span>Dark</span>
          </label>
        </fieldset>
      </div>

      <footer class="dialog-footer">
        <button class="btn" @click="closeSettingsDialog">Cancel</button>
        <button class="btn primary" @click="saveSettingsDialog">Save</button>
      </footer>
    </section>
  </div>

  <div v-if="showExportDialog" class="dialog-backdrop" @click.self="closeExportDialog">
    <section class="dialog export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-dialog-title">
      <header class="dialog-header">
        <h2 id="export-dialog-title" class="dialog-title">Export Database Schema</h2>
      </header>

      <div class="dialog-body">
        <label>
          Database
          <select v-model.number="selectedExportSessionId" :disabled="busy.exportingSchema || !schemaExportTargets.length">
            <option v-for="target in schemaExportTargets" :key="target.sessionId" :value="target.sessionId">
              {{ target.label }}
            </option>
          </select>
        </label>

        <label>
          Destination Directory
          <div class="dialog-inline">
            <input
              v-model="exportDestinationDirectory"
              readonly
              spellcheck="false"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              data-gramm="false"
            />
            <button class="btn" :disabled="busy.exportingSchema" @click="browseSchemaExportDirectory">
              Browse...
            </button>
          </div>
        </label>

        <p class="muted">
          Exports object DDL into `.sql` files grouped by object type directories. Data rows are not exported.
        </p>
        <div v-if="busy.exportingSchema" class="export-progress-wrap">
          <progress
            v-if="hasDeterminateExportProgress"
            class="export-progress"
            :max="exportProgressTotal"
            :value="exportProgressProcessed"
          ></progress>
          <progress v-else class="export-progress"></progress>
          <p v-if="hasDeterminateExportProgress" class="muted">
            {{ exportProgressProcessed }} / {{ exportProgressTotal }} objects ({{ exportProgressPercent }}%)
          </p>
          <p v-else class="muted">Export in progress...</p>
          <p v-if="exportProgressCurrentObject" class="muted export-progress-object">
            Current: {{ exportProgressCurrentObject }}
          </p>
        </div>
        <p v-if="errorMessage" class="export-error">{{ errorMessage }}</p>
        <p v-if="exportSummaryMessage" class="export-summary">{{ exportSummaryMessage }}</p>
      </div>

      <footer class="dialog-footer">
        <button class="btn" :disabled="busy.exportingSchema" @click="closeExportDialog">Close</button>
        <button class="btn primary" :disabled="!canRunSchemaExport" @click="runSchemaExport">
          {{ busy.exportingSchema ? "Exporting..." : "Export Schema" }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style>
:root,
:root[data-theme="light"] {
  --font-ui: "IBM Plex Sans", "Segoe UI", Tahoma, sans-serif;
  --bg-canvas: #e7ebf0;
  --bg-shell: #dfe5ec;
  --bg-sidebar: #f6f8fa;
  --bg-surface: #ffffff;
  --bg-surface-muted: #f2f5f8;
  --bg-hover: #edf2f8;
  --bg-active: #e4ecf8;
  --bg-selected: #d4e1f3;
  --border: #d7dee7;
  --border-strong: #c5cfdb;
  --text-primary: #2f3a46;
  --text-secondary: #657487;
  --text-subtle: #778599;
  --accent: #4f6f96;
  --accent-strong: #446488;
  --accent-contrast: #f8fbff;
  --danger: #a04545;
  --focus-ring: rgba(79, 111, 150, 0.35);
  --dialog-backdrop: rgba(23, 31, 41, 0.42);
  --dialog-shadow: 0 16px 36px rgba(0, 0, 0, 0.18);
  --splitter-hover: rgba(79, 111, 150, 0.2);
  --table-row-alt: #fafbfd;
  --schema-chip-bg: #e8eff8;
  --schema-chip-border: #c6d5e8;
  --schema-chip-text: #5f748f;
  --link-hover: #2b4a6f;
  --row-new-bg: #eef6ff;
  --row-dirty-bg: #fef7eb;
  --tree-selected-text: #1f3654;
  --editor-surface: #ffffff;
  --editor-gutter-bg: #f5f7fa;
  --editor-gutter-border: #dfe6ee;
  --editor-gutter-text: #7a8798;
  --editor-focus-outline: #c7d7ea;
  --pane-header-height: 58px;
  font-family: var(--font-ui);
  color: var(--text-primary);
  background: var(--bg-canvas);
  color-scheme: light;
}

:root[data-theme="dark"] {
  --bg-canvas: #0f151d;
  --bg-shell: #131b25;
  --bg-sidebar: #18212d;
  --bg-surface: #1e2835;
  --bg-surface-muted: #253142;
  --bg-hover: #2f3d50;
  --bg-active: #32465e;
  --bg-selected: #3a5270;
  --border: #394a5f;
  --border-strong: #4a5d75;
  --text-primary: #d7e2ef;
  --text-secondary: #9fb1c6;
  --text-subtle: #889db5;
  --accent: #6e96c8;
  --accent-strong: #87addb;
  --accent-contrast: #0f1a27;
  --danger: #e38d8d;
  --focus-ring: rgba(110, 149, 197, 0.45);
  --dialog-backdrop: rgba(6, 10, 14, 0.65);
  --dialog-shadow: 0 18px 38px rgba(0, 0, 0, 0.42);
  --splitter-hover: rgba(110, 149, 197, 0.3);
  --table-row-alt: #263241;
  --schema-chip-bg: #2a3c53;
  --schema-chip-border: #3f5979;
  --schema-chip-text: #b3c8e0;
  --link-hover: #a8c5e9;
  --row-new-bg: #27445f;
  --row-dirty-bg: #52422b;
  --tree-selected-text: #e1ecf9;
  --editor-surface: #1a2330;
  --editor-gutter-bg: #1b2431;
  --editor-gutter-border: #334659;
  --editor-gutter-text: #8ba1bb;
  --editor-focus-outline: #5878a0;
  color-scheme: dark;
}

* {
  box-sizing: border-box;
}

html,
body {
  height: 100vh;
  margin: 0;
  overflow: hidden;
}

#app {
  height: 100vh;
  overflow: hidden;
}

.desktop-shell {
  --splitter-size: 6px;
  height: 100%;
  display: grid;
  grid-template-columns: var(--sidebar-width, 330px) var(--splitter-size) minmax(0, 1fr);
  background: var(--bg-shell);
  overflow: hidden;
}

.workspace {
  display: grid;
  grid-template-rows: var(--pane-header-height) minmax(180px, 1fr) var(--splitter-size) var(--results-height, 42%);
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.dialog-backdrop {
  position: fixed;
  inset: 0;
  background: var(--dialog-backdrop);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  padding: 1.2rem;
}

.dialog {
  width: min(36rem, 100%);
  background: var(--bg-surface);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  box-shadow: var(--dialog-shadow);
  display: grid;
  grid-template-rows: auto 1fr auto;
  max-height: min(85vh, 40rem);
}

.dialog-header {
  padding: 0.75rem 0.85rem;
  border-bottom: 1px solid var(--border);
  background: var(--bg-surface-muted);
}

.dialog-title {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 600;
}

.dialog-body {
  padding: 0.8rem;
  display: grid;
  gap: 0.6rem;
  overflow: auto;
}

.dialog-body label {
  display: grid;
  gap: 0.28rem;
  font-size: 0.76rem;
  color: var(--text-secondary);
}

.dialog-inline {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.45rem;
  align-items: center;
}

.dialog-body input,
.dialog-body select {
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--bg-surface);
  padding: 0.38rem 0.45rem;
  font: inherit;
  color: var(--text-primary);
}

.dialog-body input:focus-visible,
.dialog-body select:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 1px;
}

.settings-group {
  margin: 0;
  padding: 0.5rem 0.55rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  display: grid;
  gap: 0.5rem;
}

.settings-group legend {
  padding: 0 0.25rem;
  color: var(--text-secondary);
  font-size: 0.76rem;
}

.settings-option {
  display: inline-flex;
  align-items: center;
  gap: 0.44rem;
  color: var(--text-primary);
}

.settings-option input {
  margin: 0;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.45rem;
  padding: 0.65rem 0.8rem;
  border-top: 1px solid var(--border);
  background: var(--bg-surface-muted);
}

.dialog .btn {
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--bg-surface);
  padding: 0.34rem 0.62rem;
  font-size: 0.76rem;
  cursor: pointer;
  color: var(--text-primary);
}

.dialog .btn:hover:not(:disabled) {
  background: var(--bg-hover);
}

.dialog .btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.dialog .btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-contrast);
}

.dialog .btn.primary:hover:not(:disabled) {
  background: var(--accent-strong);
  border-color: var(--accent-strong);
}

.dialog-body .muted {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.76rem;
}

.export-progress-wrap {
  display: grid;
  gap: 0.28rem;
}

.export-progress {
  width: 100%;
  height: 0.72rem;
}

.export-progress-object {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.export-error {
  margin: 0;
  font-size: 0.76rem;
  color: var(--danger);
}

.export-summary {
  margin: 0;
  font-size: 0.76rem;
  color: var(--accent-strong);
}

.panel-resizer {
  background: var(--bg-surface-muted);
  position: relative;
  z-index: 2;
  touch-action: none;
}

.panel-resizer::after {
  content: "";
  position: absolute;
  inset: 0;
  transition: background-color 0.12s ease;
}

.panel-resizer:hover::after {
  background: var(--splitter-hover);
}

.panel-resizer.vertical {
  cursor: col-resize;
  border-left: 1px solid var(--border);
  border-right: 1px solid var(--border);
}

.panel-resizer.horizontal {
  cursor: row-resize;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}

@media (max-width: 980px) {
  .desktop-shell {
    grid-template-columns: 1fr;
    grid-template-rows: 42% var(--splitter-size) 58%;
  }

  .panel-resizer.vertical {
    cursor: row-resize;
    border-left: 0;
    border-right: 0;
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }

  .workspace {
    grid-template-rows: var(--pane-header-height) minmax(150px, 1fr) var(--splitter-size) var(--results-height, 44%);
  }
}
</style>
