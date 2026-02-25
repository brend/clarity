<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import ExplorerSidebar from "./components/ExplorerSidebar.vue";
import QueryResultsPane from "./components/QueryResultsPane.vue";
import WorkspaceSheet from "./components/WorkspaceSheet.vue";
import { useClarityWorkspace } from "./composables/useClarityWorkspace";
import { usePaneLayout } from "./composables/usePaneLayout";
import { useUserSettings } from "./composables/useUserSettings";
import type {
  AiQuerySuggestionRequest,
  AiQuerySuggestionResponse,
  AiSchemaContextObject,
  SqlCompletionSchema,
} from "./types/clarity";
import type { ThemeSetting } from "./types/settings";

const EVENT_OPEN_EXPORT_DATABASE_DIALOG = "clarity://open-export-database-dialog";
const EVENT_OPEN_SETTINGS_DIALOG = "clarity://open-settings-dialog";
const EVENT_OPEN_SCHEMA_SEARCH = "clarity://open-schema-search";
const EVENT_SCHEMA_EXPORT_PROGRESS = "clarity://schema-export-progress";
const SQL_COMPLETION_OBJECT_TYPES = new Set(["TABLE", "VIEW", "MATERIALIZED VIEW", "SYNONYM", "SEQUENCE"]);
const SQL_COMPLETION_COLUMN_OBJECT_TYPES = new Set(["TABLE", "VIEW", "MATERIALIZED VIEW"]);
const AI_AUTO_SUGGEST_DEBOUNCE_MS = 700;
const AI_MIN_QUERY_LENGTH = 8;
const AI_MAX_SCHEMA_OBJECTS = 90;
const AI_MAX_OBJECT_COLUMNS = 24;

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
  objectColumns,
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
  activeQueryResultPanes,
  activeQueryResultPaneId,
  activeQueryText,
  activeDdlText,
  queryRowLimit,
  schemaSearchText,
  schemaSearchIncludeObjectNames,
  schemaSearchIncludeSource,
  schemaSearchIncludeDdl,
  schemaSearchFocusToken,
  schemaSearchResults,
  schemaSearchPerformed,
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
  activateQueryResultPane,
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
  runSchemaSearch,
  openSchemaSearchResult,
  isLikelyNumeric,
} = useClarityWorkspace();

const showExportDialog = ref(false);
const showSettingsDialog = ref(false);
const exportSummaryMessage = ref("");
const exportMenuUnlisten = ref<UnlistenFn | null>(null);
const settingsMenuUnlisten = ref<UnlistenFn | null>(null);
const searchMenuUnlisten = ref<UnlistenFn | null>(null);
const exportProgressUnlisten = ref<UnlistenFn | null>(null);
const exportProgressProcessed = ref(0);
const exportProgressTotal = ref(0);
const exportProgressCurrentObject = ref("");
const {
  settings,
  theme,
  updateTheme,
  updateOracleClientLibDir,
  updateAiSuggestionsEnabled,
  updateAiModel,
  updateAiEndpoint,
} = useUserSettings();
const settingsDialogTheme = ref<ThemeSetting>(theme.value);
const settingsDialogOracleClientLibDir = ref(settings.value.oracleClientLibDir);
const settingsDialogAiSuggestionsEnabled = ref(settings.value.aiSuggestionsEnabled);
const settingsDialogAiModel = ref(settings.value.aiModel);
const settingsDialogAiEndpoint = ref(settings.value.aiEndpoint);
const settingsDialogAiApiKey = ref("");
const settingsDialogAiApiKeyDirty = ref(false);
const hasAiApiKey = ref(false);
const aiSuggestion = ref<AiQuerySuggestionResponse | null>(null);
const aiSuggestionError = ref("");
const aiSuggestionLoading = ref(false);
let aiSuggestionDebounceHandle: ReturnType<typeof setTimeout> | null = null;
let aiSuggestionRequestToken = 0;
const canRunSchemaExport = computed<boolean>(() => {
  return (
    Number.isFinite(selectedExportSessionId.value) &&
    exportDestinationDirectory.value.trim().length > 0 &&
    !busy.exportingSchema
  );
});
const hasDeterminateExportProgress = computed<boolean>(() => exportProgressTotal.value > 0);
const queryResultsEmptyStateMessage = computed<string>(() =>
  isQueryTabActive.value ? "Run a query to see results." : "Select a query sheet to see results.",
);
const exportProgressPercent = computed<number>(() => {
  if (exportProgressTotal.value <= 0) {
    return 0;
  }

  return Math.min(
    100,
    Math.max(0, Math.round((exportProgressProcessed.value / exportProgressTotal.value) * 100)),
  );
});
const sqlCompletionSchema = computed<SqlCompletionSchema>(() => {
  const schema: SqlCompletionSchema = {};
  const columnsBySchemaAndObject = new Map<string, Map<string, string[]>>();
  for (const entry of objectColumns.value) {
    const schemaName = entry.schema.trim().toUpperCase();
    const objectName = entry.objectName.trim();
    const columnName = entry.columnName.trim();
    if (!schemaName || !objectName || !columnName) {
      continue;
    }

    let objectColumnsByName = columnsBySchemaAndObject.get(schemaName);
    if (!objectColumnsByName) {
      objectColumnsByName = new Map<string, string[]>();
      columnsBySchemaAndObject.set(schemaName, objectColumnsByName);
    }

    const columnList = objectColumnsByName.get(objectName);
    if (!columnList) {
      objectColumnsByName.set(objectName, [columnName]);
      continue;
    }
    if (!columnList.includes(columnName)) {
      columnList.push(columnName);
    }
  }

  for (const typeNode of objectTree.value) {
    const objectType = typeNode.objectType.trim().toUpperCase();
    if (!SQL_COMPLETION_OBJECT_TYPES.has(objectType)) {
      continue;
    }

    for (const entry of typeNode.entries) {
      const schemaName = entry.schema.trim().toUpperCase();
      const objectName = entry.objectName.trim();
      if (!schemaName || !objectName) {
        continue;
      }

      schema[schemaName] ??= {};
      if (schema[schemaName][objectName]) {
        continue;
      }

      const columnList = SQL_COMPLETION_COLUMN_OBJECT_TYPES.has(objectType)
        ? columnsBySchemaAndObject.get(schemaName)?.get(objectName)
        : undefined;
      schema[schemaName][objectName] = columnList ? [...columnList] : [];
    }
  }

  return schema;
});
const sqlCompletionDefaultSchema = computed<string>(() => connectedSchema.value.trim().toUpperCase());
const canUseAiSuggestions = computed<boolean>(
  () => settings.value.aiSuggestionsEnabled && isConnected.value && hasAiApiKey.value,
);

interface AiApiKeyPresence {
  configured: boolean;
}

interface SchemaExportProgressPayload {
  processedObjects: number;
  totalObjects: number;
  exportedFiles: number;
  skippedCount: number;
  currentObject: string;
}

function buildAiSchemaContext(schema: SqlCompletionSchema): AiSchemaContextObject[] {
  const entries: AiSchemaContextObject[] = [];
  const schemaNames = Object.keys(schema).sort((left, right) => left.localeCompare(right));

  for (const schemaName of schemaNames) {
    const objects = schema[schemaName];
    const objectNames = Object.keys(objects).sort((left, right) => left.localeCompare(right));
    for (const objectName of objectNames) {
      entries.push({
        schema: schemaName,
        objectName,
        columns: objects[objectName].slice(0, AI_MAX_OBJECT_COLUMNS),
      });

      if (entries.length >= AI_MAX_SCHEMA_OBJECTS) {
        return entries;
      }
    }
  }

  return entries;
}

function clearAiSuggestionState(clearError = true): void {
  aiSuggestion.value = null;
  if (clearError) {
    aiSuggestionError.value = "";
  }
}

function cancelAiSuggestionDebounce(): void {
  if (!aiSuggestionDebounceHandle) {
    return;
  }

  window.clearTimeout(aiSuggestionDebounceHandle);
  aiSuggestionDebounceHandle = null;
}

async function refreshAiKeyPresence(): Promise<void> {
  try {
    const result = await invoke<AiApiKeyPresence>("db_has_ai_api_key");
    hasAiApiKey.value = result.configured;
  } catch {
    hasAiApiKey.value = false;
  }
}

async function requestAiSuggestion(isManual = false): Promise<void> {
  if (!isQueryTabActive.value || !activeQueryTab.value) {
    return;
  }

  const currentSql = activeQueryText.value.trim();
  if (currentSql.length < AI_MIN_QUERY_LENGTH) {
    if (isManual) {
      aiSuggestionError.value = "Write more SQL context before requesting a suggestion.";
    }
    return;
  }

  if (!hasAiApiKey.value) {
    aiSuggestionError.value = "AI API key is not configured. Add it in Settings -> AI.";
    return;
  }

  const model = settings.value.aiModel.trim();
  const endpoint = settings.value.aiEndpoint.trim();
  if (!model || !endpoint) {
    aiSuggestionError.value = "Configure AI model and endpoint in Settings -> AI.";
    return;
  }

  aiSuggestionError.value = "";
  aiSuggestionLoading.value = true;
  const requestToken = aiSuggestionRequestToken + 1;
  aiSuggestionRequestToken = requestToken;

  try {
    const payload: AiQuerySuggestionRequest = {
      currentSql: activeQueryText.value,
      connectedSchema: connectedSchema.value,
      endpoint,
      model,
      schemaContext: buildAiSchemaContext(sqlCompletionSchema.value),
    };

    const result = await invoke<AiQuerySuggestionResponse>("db_ai_suggest_query", {
      request: payload,
    });

    if (requestToken !== aiSuggestionRequestToken) {
      return;
    }

    aiSuggestion.value = result;
    aiSuggestionError.value = "";
  } catch (error) {
    if (requestToken !== aiSuggestionRequestToken) {
      return;
    }

    const message = typeof error === "string" ? error : error instanceof Error ? error.message : "AI request failed.";
    aiSuggestion.value = null;
    aiSuggestionError.value = message;
  } finally {
    if (requestToken === aiSuggestionRequestToken) {
      aiSuggestionLoading.value = false;
    }
  }
}

function queueAutoAiSuggestion(): void {
  cancelAiSuggestionDebounce();
  if (!canUseAiSuggestions.value || !isQueryTabActive.value || aiSuggestionLoading.value) {
    return;
  }

  if (activeQueryText.value.trim().length < AI_MIN_QUERY_LENGTH) {
    return;
  }

  aiSuggestionDebounceHandle = window.setTimeout(() => {
    aiSuggestionDebounceHandle = null;
    void requestAiSuggestion(false);
  }, AI_AUTO_SUGGEST_DEBOUNCE_MS);
}

function onRequestAiSuggestion(): void {
  cancelAiSuggestionDebounce();
  void requestAiSuggestion(true);
}

function onApplyAiSuggestion(): void {
  const suggestionText = aiSuggestion.value?.suggestionText?.trim();
  if (!suggestionText || !isQueryTabActive.value) {
    return;
  }

  const existing = activeQueryText.value;
  const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  activeQueryText.value = `${existing}${separator}${suggestionText}`;
  clearAiSuggestionState();
}

function onDismissAiSuggestion(): void {
  cancelAiSuggestionDebounce();
  clearAiSuggestionState();
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
  settingsDialogOracleClientLibDir.value = settings.value.oracleClientLibDir;
  settingsDialogAiSuggestionsEnabled.value = settings.value.aiSuggestionsEnabled;
  settingsDialogAiModel.value = settings.value.aiModel;
  settingsDialogAiEndpoint.value = settings.value.aiEndpoint;
  settingsDialogAiApiKey.value = "";
  settingsDialogAiApiKeyDirty.value = false;
  showSettingsDialog.value = true;
}

function closeSettingsDialog(): void {
  showSettingsDialog.value = false;
}

async function saveSettingsDialog(): Promise<void> {
  updateTheme(settingsDialogTheme.value);
  updateOracleClientLibDir(settingsDialogOracleClientLibDir.value);
  updateAiSuggestionsEnabled(settingsDialogAiSuggestionsEnabled.value);
  updateAiModel(settingsDialogAiModel.value);
  updateAiEndpoint(settingsDialogAiEndpoint.value);
  try {
    if (settingsDialogAiApiKeyDirty.value) {
      const normalizedKey = settingsDialogAiApiKey.value.trim();
      if (normalizedKey.length > 0) {
        await invoke("db_set_ai_api_key", { apiKey: normalizedKey });
      } else {
        await invoke("db_clear_ai_api_key");
      }
      await refreshAiKeyPresence();
    }
    showSettingsDialog.value = false;
  } catch (error) {
    errorMessage.value = typeof error === "string" ? error : "Failed to save AI settings.";
  }
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

watch(
  () => [activeWorkspaceTabId.value, settings.value.aiSuggestionsEnabled, settings.value.aiModel, settings.value.aiEndpoint],
  () => {
    onDismissAiSuggestion();
  },
);

watch(
  () => [activeQueryText.value, isQueryTabActive.value, canUseAiSuggestions.value],
  () => {
    clearAiSuggestionState();
    queueAutoAiSuggestion();
  },
);

onMounted(() => {
  void loadConnectionProfiles();
  void refreshAiKeyPresence();
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
  void listen(EVENT_OPEN_SCHEMA_SEARCH, () => {
    openSearchTab(true);
  }).then((unlisten) => {
    searchMenuUnlisten.value = unlisten;
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
  cancelAiSuggestionDebounce();
  aiSuggestionRequestToken += 1;
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
  if (searchMenuUnlisten.value) {
    searchMenuUnlisten.value();
    searchMenuUnlisten.value = null;
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
      :on-connect="() => connectOracle(settings.oracleClientLibDir)"
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
        v-model:schema-search-text="schemaSearchText"
        v-model:schema-search-include-object-names="schemaSearchIncludeObjectNames"
        v-model:schema-search-include-source="schemaSearchIncludeSource"
        v-model:schema-search-include-ddl="schemaSearchIncludeDdl"
        :status-message="statusMessage"
        :query-tabs="queryTabs"
        :ddl-tabs="ddlTabs"
        :active-workspace-tab-id="activeWorkspaceTabId"
        :is-search-tab-active="isSearchTabActive"
        :schema-search-focus-token="schemaSearchFocusToken"
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
        :schema-search-results="schemaSearchResults"
        :schema-search-performed="schemaSearchPerformed"
        :ai-suggestion-text="aiSuggestion?.suggestionText ?? ''"
        :ai-suggestion-rationale="aiSuggestion?.reasoningShort ?? ''"
        :ai-suggestion-error="aiSuggestionError"
        :ai-suggestion-confidence="aiSuggestion ? aiSuggestion.confidence : null"
        :ai-suggestion-mutating="aiSuggestion?.isPotentiallyMutating ?? false"
        :ai-suggestion-loading="aiSuggestionLoading"
        :can-use-ai-suggestions="canUseAiSuggestions"
        :sql-completion-schema="sqlCompletionSchema"
        :sql-completion-default-schema="sqlCompletionDefaultSchema"
        :theme="theme"
        :on-activate-workspace-tab="activateWorkspaceTab"
        :on-close-query-tab="closeQueryTab"
        :on-add-query-tab="addQueryTab"
        :on-open-search-tab="() => openSearchTab(true)"
        :on-open-settings="openSettingsDialog"
        :on-close-ddl-tab="closeDdlTab"
        :on-run-query="runQuery"
        :on-save-ddl="saveDdl"
        :on-refresh-active-object-detail="refreshActiveObjectDetail"
        :on-update-active-object-data-row="updateActiveObjectDataRow"
        :on-insert-active-object-data-row="insertActiveObjectDataRow"
        :on-activate-object-detail-tab="activateObjectDetailTab"
        :on-run-schema-search="runSchemaSearch"
        :on-open-schema-search-result="openSchemaSearchResult"
        :on-request-ai-suggestion="onRequestAiSuggestion"
        :on-apply-ai-suggestion="onApplyAiSuggestion"
        :on-dismiss-ai-suggestion="onDismissAiSuggestion"
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
        :result-panes="activeQueryResultPanes"
        :active-result-pane-id="activeQueryResultPaneId"
        :empty-state-message="queryResultsEmptyStateMessage"
        @activate-pane="activateQueryResultPane"
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
        <fieldset class="settings-group">
          <legend>Oracle</legend>
          <label class="settings-field">
            <span>Instant Client Library Directory (optional)</span>
            <input
              v-model.trim="settingsDialogOracleClientLibDir"
              placeholder="/opt/homebrew/lib/instantclient_23_3"
              spellcheck="false"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              data-gramm="false"
            />
          </label>
          <p class="muted settings-hint">
            Overrides <code>ORACLE_CLIENT_LIB_DIR</code> for new Oracle connections in this app.
          </p>
        </fieldset>
        <fieldset class="settings-group">
          <legend>AI</legend>
          <label class="settings-option">
            <input v-model="settingsDialogAiSuggestionsEnabled" type="checkbox" />
            <span>Enable AI query suggestions while typing</span>
          </label>
          <label class="settings-field">
            <span>Model</span>
            <input
              v-model.trim="settingsDialogAiModel"
              placeholder="gpt-4o-mini"
              spellcheck="false"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              data-gramm="false"
            />
          </label>
          <label class="settings-field">
            <span>Endpoint</span>
            <input
              v-model.trim="settingsDialogAiEndpoint"
              placeholder="https://api.openai.com/v1/chat/completions"
              spellcheck="false"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              data-gramm="false"
            />
          </label>
          <label class="settings-field">
            <span>API Key</span>
            <input
              v-model.trim="settingsDialogAiApiKey"
              type="password"
              placeholder="sk-..."
              spellcheck="false"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              data-gramm="false"
              @input="settingsDialogAiApiKeyDirty = true"
            />
          </label>
          <p class="muted settings-hint">
            Stored in the OS keychain. Current key status: {{ hasAiApiKey ? "Configured" : "Missing" }}.
            Leave API key blank and save to clear the stored key.
          </p>
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
  --font-ui: "IBM Plex Sans", "Avenir Next", "Segoe UI", sans-serif;
  --bg-canvas: #edf1f6;
  --bg-shell: #e7ecf3;
  --bg-sidebar: #f4f7fb;
  --bg-surface: #ffffff;
  --bg-surface-muted: #f6f8fc;
  --bg-hover: #eef3fb;
  --bg-active: #e4ecf9;
  --bg-selected: #dbe7fb;
  --border: #dce3ee;
  --border-strong: #c9d4e3;
  --panel-separator: #dbe3ef;
  --text-primary: #1f2938;
  --text-secondary: #61728a;
  --text-subtle: #8392a6;
  --accent: #2f74d8;
  --accent-strong: #4686e5;
  --accent-contrast: #f3f8ff;
  --danger: #b04f4f;
  --focus-ring: rgba(47, 116, 216, 0.26);
  --dialog-backdrop: rgba(26, 34, 46, 0.34);
  --dialog-shadow: 0 16px 36px rgba(0, 0, 0, 0.18);
  --splitter-hover: rgba(47, 116, 216, 0.24);
  --control-bg: #f4f8fe;
  --control-border: #d7e1ee;
  --control-hover: #edf4fd;
  --tab-active-bg: #ffffff;
  --tab-active-border: #d7e3f2;
  --table-divider: #e0e8f3;
  --table-header-bg: #f5f8fd;
  --table-row-alt: transparent;
  --schema-chip-bg: #e9f0fb;
  --schema-chip-border: #ccdaee;
  --schema-chip-text: #56708f;
  --link-hover: #1f4f8c;
  --row-new-bg: rgba(84, 157, 242, 0.12);
  --row-dirty-bg: rgba(221, 171, 89, 0.18);
  --tree-selected-text: #193a67;
  --editor-surface: #ffffff;
  --editor-gutter-bg: #f5f8fd;
  --editor-gutter-border: #d9e2ef;
  --editor-gutter-text: #8291a5;
  --editor-focus-outline: #bbcee7;
  --editor-text: #1f2e43;
  --editor-caret: #2f74d8;
  --editor-active-line: rgba(47, 116, 216, 0.08);
  --editor-active-gutter: rgba(47, 116, 216, 0.15);
  --editor-selection: rgba(47, 116, 216, 0.2);
  --editor-selection-focused: rgba(47, 116, 216, 0.28);
  --editor-placeholder: #8f9db0;
  --editor-token-keyword: #9b2fd2;
  --editor-token-operator: #4d6e95;
  --editor-token-string: #b35a1d;
  --editor-token-number: #0c74bc;
  --editor-token-comment: #7388a5;
  --editor-token-type: #1c6da9;
  --editor-token-variable: #1f2e43;
  --editor-token-property: #1f2e43;
  --editor-token-function: #0b5f9f;
  --resizer-line: #dbe4f1;
  --resizer-line-hover: #6da0e4;
  --scrollbar-thumb: rgba(103, 125, 152, 0.42);
  --scrollbar-thumb-hover: rgba(90, 114, 146, 0.62);
  --pane-header-height: 42px;
  font-family: var(--font-ui);
  color: var(--text-primary);
  background: var(--bg-canvas);
  color-scheme: light;
}

:root[data-theme="dark"] {
  --bg-canvas: #090d13;
  --bg-shell: #0f151e;
  --bg-sidebar: #161d29;
  --bg-surface: #111826;
  --bg-surface-muted: #151d2b;
  --bg-hover: #202b3b;
  --bg-active: #28384f;
  --bg-selected: #2e4360;
  --border: #243246;
  --border-strong: #334760;
  --panel-separator: #253348;
  --text-primary: #d7e1ed;
  --text-secondary: #96a8be;
  --text-subtle: #7e91a8;
  --accent: #57a2ff;
  --accent-strong: #7bb6ff;
  --accent-contrast: #041325;
  --danger: #e39393;
  --focus-ring: rgba(87, 162, 255, 0.36);
  --dialog-backdrop: rgba(4, 8, 12, 0.7);
  --dialog-shadow: 0 18px 38px rgba(0, 0, 0, 0.42);
  --splitter-hover: rgba(87, 162, 255, 0.36);
  --control-bg: #1a2433;
  --control-border: #2d4058;
  --control-hover: #222f43;
  --tab-active-bg: #121a27;
  --tab-active-border: #405773;
  --table-divider: #223245;
  --table-header-bg: #131d2d;
  --table-row-alt: transparent;
  --schema-chip-bg: #20324a;
  --schema-chip-border: #3a5578;
  --schema-chip-text: #adc3de;
  --link-hover: #c1d7ef;
  --row-new-bg: rgba(68, 134, 207, 0.22);
  --row-dirty-bg: rgba(124, 94, 49, 0.28);
  --tree-selected-text: #e6eefb;
  --editor-surface: #0d1522;
  --editor-gutter-bg: #141c2a;
  --editor-gutter-border: #29384d;
  --editor-gutter-text: #8196b2;
  --editor-focus-outline: #4b6e99;
  --editor-text: #dbe7f6;
  --editor-caret: #7ab6ff;
  --editor-active-line: rgba(82, 120, 166, 0.22);
  --editor-active-gutter: rgba(82, 120, 166, 0.3);
  --editor-selection: rgba(93, 145, 207, 0.3);
  --editor-selection-focused: rgba(105, 163, 231, 0.42);
  --editor-placeholder: #7489a3;
  --editor-token-keyword: #cf78ff;
  --editor-token-operator: #9bb2cd;
  --editor-token-string: #ffb569;
  --editor-token-number: #7bd8ff;
  --editor-token-comment: #7e95b3;
  --editor-token-type: #76c7ff;
  --editor-token-variable: #dbe7f6;
  --editor-token-property: #e4edf9;
  --editor-token-function: #9bc4ff;
  --resizer-line: #2a3c53;
  --resizer-line-hover: #69adff;
  --scrollbar-thumb: rgba(123, 147, 175, 0.34);
  --scrollbar-thumb-hover: rgba(123, 157, 196, 0.54);
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
  background: var(--bg-canvas);
  color: var(--text-primary);
}

#app {
  height: 100vh;
  overflow: hidden;
}

*::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

*::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
  border-radius: 999px;
  border: 2px solid transparent;
  background-clip: content-box;
}

*::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-thumb-hover);
  background-clip: content-box;
}

.desktop-shell {
  --splitter-size: 5px;
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
  border: 1px solid var(--panel-separator);
  border-radius: 10px;
  box-shadow: var(--dialog-shadow);
  display: grid;
  grid-template-rows: auto 1fr auto;
  max-height: min(85vh, 40rem);
}

.dialog-header {
  padding: 0.6rem 0.75rem;
  border-bottom: 1px solid var(--border);
  background: var(--bg-surface-muted);
}

.dialog-title {
  margin: 0;
  font-size: 0.86rem;
  font-weight: 600;
}

.dialog-body {
  padding: 0.7rem;
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
  border: 1px solid var(--control-border);
  border-radius: 6px;
  background: var(--control-bg);
  padding: 0.38rem 0.45rem;
  font: inherit;
  color: var(--text-primary);
}

.dialog-body input:focus-visible,
.dialog-body select:focus-visible {
  outline: 1px solid var(--focus-ring);
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

.settings-field {
  display: grid;
  gap: 0.32rem;
}

.settings-hint code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New",
    monospace;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.45rem;
  padding: 0.55rem 0.75rem;
  border-top: 1px solid var(--border);
  background: var(--bg-surface-muted);
}

.dialog .btn {
  border: 1px solid var(--control-border);
  border-radius: 6px;
  background: var(--control-bg);
  padding: 0.28rem 0.54rem;
  font-size: 0.74rem;
  cursor: pointer;
  color: var(--text-primary);
}

.dialog .btn:hover:not(:disabled) {
  background: var(--control-hover);
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
  background: transparent;
  position: relative;
  z-index: 2;
  touch-action: none;
}

.panel-resizer::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
  transform: translateX(-50%);
  background: var(--resizer-line);
  transition: background-color 0.12s ease;
  opacity: 0.9;
}

.panel-resizer:hover::after {
  background: var(--resizer-line-hover);
}

.panel-resizer.vertical {
  cursor: col-resize;
  border: 0;
}

.panel-resizer.horizontal {
  cursor: row-resize;
  border: 0;
}

.panel-resizer.horizontal::after {
  left: 0;
  right: 0;
  top: 50%;
  width: auto;
  height: 1px;
  transform: translateY(-50%);
}

@media (max-width: 980px) {
  .desktop-shell {
    grid-template-columns: 1fr;
    grid-template-rows: 42% var(--splitter-size) 58%;
  }

  .panel-resizer.vertical {
    cursor: row-resize;
    border: 0;
  }

  .panel-resizer.vertical::after {
    left: 0;
    right: 0;
    top: 50%;
    width: auto;
    height: 1px;
    transform: translateY(-50%);
  }

  .workspace {
    grid-template-rows: var(--pane-header-height) minmax(150px, 1fr) var(--splitter-size) var(--results-height, 44%);
  }
}
</style>
