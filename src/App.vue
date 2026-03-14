<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import ExplorerSidebar from "./components/ExplorerSidebar.vue";
import QueryResultsPane from "./components/QueryResultsPane.vue";
import WorkspaceSheet from "./components/WorkspaceSheet.vue";
import {
  CREATE_OBJECT_TYPE_OPTIONS,
  createObjectDefaultName,
  normalizeCreateObjectType,
} from "./constants/createObjectTemplates";
import { useClarityWorkspace } from "./composables/useClarityWorkspace";
import { usePaneLayout } from "./composables/usePaneLayout";
import { useUserSettings } from "./composables/useUserSettings";
import type {
  AiQuerySuggestionRequest,
  AiQuerySuggestionResponse,
  AiSchemaContextObject,
  DbObjectColumnEntry,
  SqlCompletionSchema,
} from "./types/clarity";
import type { ThemeSetting } from "./types/settings";

const EVENT_OPEN_EXPORT_DATABASE_DIALOG =
  "clarity://open-export-database-dialog";
const EVENT_OPEN_SETTINGS_DIALOG = "clarity://open-settings-dialog";
const EVENT_OPEN_SCHEMA_SEARCH = "clarity://open-schema-search";
const EVENT_OPEN_CREATE_OBJECT_TEMPLATE = "clarity://open-create-object-template";
const EVENT_SAVE_ACTIVE_QUERY_SHEET = "clarity://save-active-query-sheet";
const EVENT_SAVE_ALL_QUERY_SHEETS = "clarity://save-all-query-sheets";
const EVENT_NAVIGATE_SCRIPT_LINE_BACK = "clarity://navigate-script-line-back";
const EVENT_NAVIGATE_SCRIPT_LINE_FORWARD =
  "clarity://navigate-script-line-forward";
const EVENT_SCHEMA_EXPORT_PROGRESS = "clarity://schema-export-progress";
const SQL_COMPLETION_OBJECT_TYPES = new Set([
  "TABLE",
  "VIEW",
  "MATERIALIZED VIEW",
  "SYNONYM",
  "SEQUENCE",
]);
const SQL_COMPLETION_COLUMN_OBJECT_TYPES = new Set([
  "TABLE",
  "VIEW",
  "MATERIALIZED VIEW",
]);
const AI_AUTO_SUGGEST_DEBOUNCE_MS = 700;
const AI_MIN_QUERY_LENGTH = 8;
const AI_MAX_SCHEMA_OBJECTS = 120;
const AI_MAX_REFERENCED_COLUMNS = 60;
const AI_MAX_OTHER_COLUMNS = 20;
const SQL_IDENTIFIER_STOP_WORDS = new Set([
  "SELECT",
  "FROM",
  "WHERE",
  "JOIN",
  "LEFT",
  "RIGHT",
  "FULL",
  "INNER",
  "OUTER",
  "ON",
  "GROUP",
  "ORDER",
  "BY",
  "HAVING",
  "AS",
  "DISTINCT",
  "UNION",
  "ALL",
  "WITH",
  "AND",
  "OR",
  "NOT",
  "NULL",
  "IS",
  "IN",
  "EXISTS",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "LIKE",
  "BETWEEN",
  "FETCH",
  "FIRST",
  "NEXT",
  "ROWS",
  "ROW",
  "ONLY",
  "OFFSET",
  "INSERT",
  "INTO",
  "VALUES",
  "UPDATE",
  "SET",
  "DELETE",
  "MERGE",
  "TRUNCATE",
  "ALTER",
  "DROP",
  "CREATE",
  "TABLE",
  "VIEW",
  "INDEX",
  "SEQUENCE",
  "GRANT",
  "REVOKE",
  "DESC",
  "DESCRIBE",
  "EXPLAIN",
]);

const desktopShellEl = ref<HTMLElement | null>(null);
const workspaceEl = ref<HTMLElement | null>(null);

const {
  desktopShellStyle,
  workspaceStyle,
  beginSidebarResize,
  beginResultsResize,
} = usePaneLayout({
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
  transactionActive,
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
  openCreateObjectTemplate,
  activateObjectDetailTab,
  refreshActiveObjectDetail,
  updateActiveObjectDataRow,
  insertActiveObjectDataRow,
  deleteActiveObjectDataRow,
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
  saveActiveQuerySheetToDisk,
  saveAllQuerySheetsToDisk,
  saveDdl,
  runQuery,
  beginTransaction,
  commitTransaction,
  rollbackTransaction,
  runSchemaSearch,
  openSchemaSearchResult,
  navigateScriptLineBack,
  navigateScriptLineForward,
  isLikelyNumeric,
} = useClarityWorkspace();

const showExportDialog = ref(false);
const showSettingsDialog = ref(false);
const showCreateObjectDialog = ref(false);
const highlightedSidebarSection = ref<"connections" | "explorer">(
  "connections",
);
const exportSummaryMessage = ref("");
const exportMenuUnlisten = ref<UnlistenFn | null>(null);
const settingsMenuUnlisten = ref<UnlistenFn | null>(null);
const searchMenuUnlisten = ref<UnlistenFn | null>(null);
const createObjectMenuUnlisten = ref<UnlistenFn | null>(null);
const saveActiveSheetMenuUnlisten = ref<UnlistenFn | null>(null);
const saveAllSheetsMenuUnlisten = ref<UnlistenFn | null>(null);
const navigateScriptLineBackMenuUnlisten = ref<UnlistenFn | null>(null);
const navigateScriptLineForwardMenuUnlisten = ref<UnlistenFn | null>(null);
const exportProgressUnlisten = ref<UnlistenFn | null>(null);
const exportProgressProcessed = ref(0);
const exportProgressTotal = ref(0);
const exportProgressCurrentObject = ref("");
const createObjectDialogType = ref(CREATE_OBJECT_TYPE_OPTIONS[0].value);
const createObjectDialogName = ref(
  createObjectDefaultName(CREATE_OBJECT_TYPE_OPTIONS[0].value),
);
const createObjectDialogPreviousDefaultName = ref(
  createObjectDefaultName(CREATE_OBJECT_TYPE_OPTIONS[0].value),
);
const createObjectDialogError = ref("");
const {
  settings,
  theme,
  updateTheme,
  updateOracleClientLibDir,
  updateAiSuggestionsEnabled,
  updateAiModel,
  updateAiEndpoint,
  updateLastUsedConnectionProfileId,
} = useUserSettings();
const settingsDialogTheme = ref<ThemeSetting>(theme.value);
const settingsDialogOracleClientLibDir = ref(settings.value.oracleClientLibDir);
const settingsDialogAiSuggestionsEnabled = ref(
  settings.value.aiSuggestionsEnabled,
);
const settingsDialogAiModel = ref(settings.value.aiModel);
const settingsDialogAiEndpoint = ref(settings.value.aiEndpoint);
const settingsDialogAiApiKey = ref("");
const settingsDialogAiApiKeyDirty = ref(false);
const settingsDialogError = ref("");
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
const hasDeterminateExportProgress = computed<boolean>(
  () => exportProgressTotal.value > 0,
);
const queryResultsEmptyStateMessage = computed<string>(() =>
  isQueryTabActive.value
    ? "Run a query to see results."
    : activeDdlTab.value
      ? "Save DDL to see compilation results."
      : "Select a query sheet to see results.",
);
const exportProgressPercent = computed<number>(() => {
  if (exportProgressTotal.value <= 0) {
    return 0;
  }

  return Math.min(
    100,
    Math.max(
      0,
      Math.round(
        (exportProgressProcessed.value / exportProgressTotal.value) * 100,
      ),
    ),
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
const sqlCompletionDefaultSchema = computed<string>(() =>
  connectedSchema.value.trim().toUpperCase(),
);
const canUseAiSuggestions = computed<boolean>(
  () =>
    settings.value.aiSuggestionsEnabled &&
    isConnected.value &&
    hasAiApiKey.value,
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

interface CreateObjectTemplatePayload {
  objectType: string;
}

function extractReferencedTables(sql: string): Set<string> {
  const tables = new Set<string>();
  const pattern =
    /\b(?:FROM|JOIN|INTO|UPDATE|MERGE\s+INTO)\s+([A-Za-z_][\w$#]*(?:\.[A-Za-z_][\w$#]*)?)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sql)) !== null) {
    tables.add(match[1].toUpperCase());
  }
  return tables;
}

function detectClauseContext(sql: string): string | undefined {
  const trimmed = sql.trimEnd();
  if (!trimmed) return undefined;

  const upper = trimmed.toUpperCase();
  if (/\bWHERE\s+[\w.\s,()=<>!]*$/i.test(upper)) return "WHERE";
  if (/\bSELECT\s+[\w.\s,*()'|]+$/i.test(upper)) return "SELECT";
  if (/\bORDER\s+BY\s+[\w.\s,]*$/i.test(upper)) return "ORDER BY";
  if (/\bGROUP\s+BY\s+[\w.\s,]*$/i.test(upper)) return "GROUP BY";
  if (/\bHAVING\s+[\w.\s,()=<>!]*$/i.test(upper)) return "HAVING";
  if (/\b(?:INNER|LEFT|RIGHT|FULL|CROSS)?\s*JOIN\s+[\w.\s]*$/i.test(upper))
    return "JOIN";
  if (/\bON\s+[\w.\s=]*$/i.test(upper)) return "JOIN ON";
  if (/\bFROM\s+[\w.\s,]*$/i.test(upper)) return "FROM";
  if (/\bSET\s+[\w.\s,=]*$/i.test(upper)) return "SET";
  if (/\bINSERT\s+INTO\s+[\w.\s,()*]*$/i.test(upper)) return "INSERT";
  if (/\bVALUES\s*\([\w.\s,']*$/i.test(upper)) return "VALUES";

  return undefined;
}

function normalizeSqlForAnalysis(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ")
    .replace(/'(?:''|[^'])*'/g, " ")
    .replace(/"(?:\"\"|[^"])*"/g, " ");
}

function extractSqlIdentifierHints(sql: string): Set<string> {
  const normalized = normalizeSqlForAnalysis(sql).toUpperCase();
  const matches = normalized.match(/[A-Z_][A-Z0-9_$#]*/g) ?? [];
  const tokens = new Set<string>();

  for (const token of matches) {
    if (token.length < 2 || SQL_IDENTIFIER_STOP_WORDS.has(token)) {
      continue;
    }
    tokens.add(token);
  }

  return tokens;
}

function buildAiSchemaContext(
  completionSchema: SqlCompletionSchema,
  columns: DbObjectColumnEntry[],
  currentSql: string,
): AiSchemaContextObject[] {
  const referencedNames = extractReferencedTables(currentSql);
  const identifierHints = extractSqlIdentifierHints(currentSql);

  // Build a lookup: schema.objectName -> { colName: "COL_NAME DATA_TYPE [NOT NULL]" }
  const columnDetailMap = new Map<string, Map<string, string>>();
  for (const entry of columns) {
    const schemaName = entry.schema.trim().toUpperCase();
    const objectName = entry.objectName.trim().toUpperCase();
    const key = `${schemaName}.${objectName}`;
    let colMap = columnDetailMap.get(key);
    if (!colMap) {
      colMap = new Map<string, string>();
      columnDetailMap.set(key, colMap);
    }
    const colName = entry.columnName.trim();
    const colNameUpper = colName.toUpperCase();
    const dataType = entry.dataType?.trim() || "";
    const nullable = entry.nullable?.trim() === "N" ? " NOT NULL" : "";
    const detail = dataType ? `${colName} ${dataType}${nullable}` : colName;
    colMap.set(colNameUpper, detail);
  }

  const scoredEntries: Array<{ entry: AiSchemaContextObject; score: number }> =
    [];

  const schemaNames = Object.keys(completionSchema).sort((a, b) =>
    a.localeCompare(b),
  );

  for (const schemaName of schemaNames) {
    const objects = completionSchema[schemaName];
    const objectNames = Object.keys(objects).sort((a, b) => a.localeCompare(b));

    for (const objectName of objectNames) {
      const qualifiedName = `${schemaName}.${objectName}`.toUpperCase();
      const bareNameUpper = objectName.toUpperCase();
      const isReferenced =
        referencedNames.has(qualifiedName) ||
        referencedNames.has(bareNameUpper);
      let score = isReferenced ? 1000 : 0;
      if (identifierHints.has(bareNameUpper)) {
        score += 200;
      }
      for (const hint of identifierHints) {
        if (hint.length >= 3 && bareNameUpper.includes(hint)) {
          score += 25;
        }
      }

      // Get column details with types
      const colDetailMap = columnDetailMap.get(qualifiedName);
      const rawColumns = objects[objectName];
      const maxCols = isReferenced
        ? AI_MAX_REFERENCED_COLUMNS
        : AI_MAX_OTHER_COLUMNS;
      let columnHintMatches = 0;
      const columnsWithTypes = rawColumns.slice(0, maxCols).map((colName) => {
        const normalized = colName.trim();
        if (identifierHints.has(normalized.toUpperCase())) {
          columnHintMatches += 1;
        }
        const detail = colDetailMap?.get(normalized.toUpperCase());
        return detail || colName;
      });
      score += Math.min(8, columnHintMatches) * 20;
      if (rawColumns.length > 0) {
        score += 5;
      }

      const entry: AiSchemaContextObject = {
        schema: schemaName,
        objectName,
        columns: columnsWithTypes,
        isReferencedInQuery: isReferenced,
      };

      scoredEntries.push({ entry, score });
    }
  }

  scoredEntries.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    const schemaCompare = left.entry.schema.localeCompare(right.entry.schema);
    if (schemaCompare !== 0) {
      return schemaCompare;
    }
    return left.entry.objectName.localeCompare(right.entry.objectName);
  });

  return scoredEntries
    .slice(0, AI_MAX_SCHEMA_OBJECTS)
    .map((candidate) => candidate.entry);
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
      aiSuggestionError.value =
        "Write more SQL context before requesting a suggestion.";
    }
    return;
  }

  if (!hasAiApiKey.value) {
    aiSuggestionError.value =
      "AI API key is not configured. Add it in Settings -> AI.";
    return;
  }

  const model = settings.value.aiModel.trim();
  const endpoint = settings.value.aiEndpoint.trim();
  if (!model || !endpoint) {
    aiSuggestionError.value =
      "Configure AI model and endpoint in Settings -> AI.";
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
      schemaContext: buildAiSchemaContext(
        sqlCompletionSchema.value,
        objectColumns.value,
        activeQueryText.value,
      ),
      cursorClause: detectClauseContext(activeQueryText.value),
    };

    const result = await invoke<AiQuerySuggestionResponse>(
      "db_ai_suggest_query",
      {
        request: payload,
      },
    );

    if (requestToken !== aiSuggestionRequestToken) {
      return;
    }

    aiSuggestion.value = result;
    aiSuggestionError.value = "";
  } catch (error) {
    if (requestToken !== aiSuggestionRequestToken) {
      return;
    }

    const message =
      typeof error === "string"
        ? error
        : error instanceof Error
          ? error.message
          : "AI request failed.";
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
  if (
    !canUseAiSuggestions.value ||
    !isQueryTabActive.value ||
    aiSuggestionLoading.value
  ) {
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

function openCreateObjectDialog(
  preferredObjectType: string | null = null,
): void {
  const normalizedType =
    normalizeCreateObjectType(preferredObjectType ?? "") ??
    CREATE_OBJECT_TYPE_OPTIONS[0].value;
  const defaultName = createObjectDefaultName(normalizedType);
  createObjectDialogType.value = normalizedType;
  createObjectDialogName.value = defaultName;
  createObjectDialogPreviousDefaultName.value = defaultName;
  createObjectDialogError.value = "";
  showCreateObjectDialog.value = true;
}

function closeCreateObjectDialog(): void {
  showCreateObjectDialog.value = false;
  createObjectDialogError.value = "";
}

function onCreateObjectTypeChange(): void {
  const nextDefault = createObjectDefaultName(createObjectDialogType.value);
  const currentName = createObjectDialogName.value.trim().toUpperCase();
  if (
    !currentName ||
    currentName === createObjectDialogPreviousDefaultName.value
  ) {
    createObjectDialogName.value = nextDefault;
  }
  createObjectDialogPreviousDefaultName.value = nextDefault;
  createObjectDialogError.value = "";
}

function submitCreateObjectDialog(): void {
  const normalizedType = normalizeCreateObjectType(createObjectDialogType.value);
  if (!normalizedType) {
    createObjectDialogError.value = "Choose a supported object type.";
    return;
  }

  const objectName = createObjectDialogName.value.trim();
  if (!objectName) {
    createObjectDialogError.value = "Object name is required.";
    return;
  }

  const opened = openCreateObjectTemplate(normalizedType, objectName);
  if (!opened) {
    createObjectDialogError.value =
      errorMessage.value || "Unable to prepare object template.";
    return;
  }

  closeCreateObjectDialog();
}

async function openSettingsDialog(): Promise<void> {
  settingsDialogTheme.value = theme.value;
  settingsDialogOracleClientLibDir.value = settings.value.oracleClientLibDir;
  settingsDialogAiSuggestionsEnabled.value =
    settings.value.aiSuggestionsEnabled;
  settingsDialogAiModel.value = settings.value.aiModel;
  settingsDialogAiEndpoint.value = settings.value.aiEndpoint;
  settingsDialogAiApiKey.value = "";
  settingsDialogAiApiKeyDirty.value = false;
  settingsDialogError.value = "";
  await refreshAiKeyPresence();
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
    settingsDialogError.value =
      typeof error === "string" ? error : "Failed to save AI settings.";
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

async function restoreLastUsedConnectionProfile(): Promise<void> {
  selectedProfileId.value = settings.value.lastUsedConnectionProfileId;
  await loadConnectionProfiles();

  if (!selectedProfileId.value || !selectedProfile.value) {
    if (settings.value.lastUsedConnectionProfileId) {
      updateLastUsedConnectionProfileId("");
    }
    return;
  }

  await applySelectedProfile();
}

async function handleConnect(): Promise<void> {
  await connectOracle(settings.value.oracleClientLibDir);
  if (!session.value) {
    return;
  }

  updateLastUsedConnectionProfileId(selectedProfileId.value);
}

watch(
  () => [
    activeWorkspaceTabId.value,
    settings.value.aiSuggestionsEnabled,
    settings.value.aiModel,
    settings.value.aiEndpoint,
  ],
  () => {
    onDismissAiSuggestion();
  },
);

watch(
  () => [
    activeQueryText.value,
    isQueryTabActive.value,
    canUseAiSuggestions.value,
  ],
  () => {
    clearAiSuggestionState();
    queueAutoAiSuggestion();
  },
);

onMounted(() => {
  void restoreLastUsedConnectionProfile();
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
  void listen<CreateObjectTemplatePayload>(
    EVENT_OPEN_CREATE_OBJECT_TEMPLATE,
    (event) => {
      openCreateObjectDialog(event.payload?.objectType ?? null);
    },
  ).then((unlisten) => {
    createObjectMenuUnlisten.value = unlisten;
  });
  void listen(EVENT_SAVE_ACTIVE_QUERY_SHEET, () => {
    void saveActiveQuerySheetToDisk();
  }).then((unlisten) => {
    saveActiveSheetMenuUnlisten.value = unlisten;
  });
  void listen(EVENT_SAVE_ALL_QUERY_SHEETS, () => {
    void saveAllQuerySheetsToDisk();
  }).then((unlisten) => {
    saveAllSheetsMenuUnlisten.value = unlisten;
  });
  void listen(EVENT_NAVIGATE_SCRIPT_LINE_BACK, () => {
    void navigateScriptLineBack();
  }).then((unlisten) => {
    navigateScriptLineBackMenuUnlisten.value = unlisten;
  });
  void listen(EVENT_NAVIGATE_SCRIPT_LINE_FORWARD, () => {
    void navigateScriptLineForward();
  }).then((unlisten) => {
    navigateScriptLineForwardMenuUnlisten.value = unlisten;
  });
  void listen<SchemaExportProgressPayload>(
    EVENT_SCHEMA_EXPORT_PROGRESS,
    (event) => {
      const payload = event.payload;
      exportProgressProcessed.value = payload.processedObjects ?? 0;
      exportProgressTotal.value = payload.totalObjects ?? 0;
      exportProgressCurrentObject.value = payload.currentObject ?? "";
    },
  ).then((unlisten) => {
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
  if (createObjectMenuUnlisten.value) {
    createObjectMenuUnlisten.value();
    createObjectMenuUnlisten.value = null;
  }
  if (saveActiveSheetMenuUnlisten.value) {
    saveActiveSheetMenuUnlisten.value();
    saveActiveSheetMenuUnlisten.value = null;
  }
  if (saveAllSheetsMenuUnlisten.value) {
    saveAllSheetsMenuUnlisten.value();
    saveAllSheetsMenuUnlisten.value = null;
  }
  if (navigateScriptLineBackMenuUnlisten.value) {
    navigateScriptLineBackMenuUnlisten.value();
    navigateScriptLineBackMenuUnlisten.value = null;
  }
  if (navigateScriptLineForwardMenuUnlisten.value) {
    navigateScriptLineForwardMenuUnlisten.value();
    navigateScriptLineForwardMenuUnlisten.value = null;
  }
});
</script>

<template>
  <main ref="desktopShellEl" class="desktop-shell" :style="desktopShellStyle">
    <aside class="sidebar-shell">
      <ExplorerSidebar
        v-model:selected-profile-id="selectedProfileId"
        v-model:profile-name="profileName"
        v-model:save-profile-password="saveProfilePassword"
        :connection="connection"
        :connection-error="errorMessage"
        :connection-profiles="connectionProfiles"
        :selected-profile="selectedProfile"
        :busy="busy"
        :is-connected="isConnected"
        :session="session"
        :connected-schema="connectedSchema"
        :selected-provider-label="selectedProviderLabel"
        :highlighted-section="highlightedSidebarSection"
        :object-tree="objectTree"
        :selected-object="selectedObject"
        :is-object-type-expanded="isObjectTypeExpanded"
        :on-sync-selected-profile-ui="syncSelectedProfileUi"
        :on-apply-selected-profile="applySelectedProfile"
        :on-delete-selected-profile="deleteSelectedProfile"
        :on-save-connection-profile="saveConnectionProfile"
        :on-connect="handleConnect"
        :on-disconnect="disconnectOracle"
        :on-refresh-objects="refreshObjects"
        :on-toggle-object-type="toggleObjectType"
        :on-open-object-from-explorer="openObjectFromExplorer"
        :create-object-types="CREATE_OBJECT_TYPE_OPTIONS"
        :on-request-create-object="openCreateObjectDialog"
      />
    </aside>

    <div
      class="panel-resizer vertical"
      role="separator"
      aria-orientation="vertical"
      title="Resize explorer and workspace"
      @pointerdown="beginSidebarResize"
    ></div>

    <section class="app-main">
      <section ref="workspaceEl" class="workspace" :style="workspaceStyle">
      <WorkspaceSheet
        class="workspace-card"
        v-model:query-text="activeQueryText"
        v-model:ddl-text="activeDdlText"
        v-model:query-row-limit="queryRowLimit"
        v-model:schema-search-text="schemaSearchText"
        v-model:schema-search-include-object-names="
          schemaSearchIncludeObjectNames
        "
        v-model:schema-search-include-source="schemaSearchIncludeSource"
        v-model:schema-search-include-ddl="schemaSearchIncludeDdl"
        :status-message="statusMessage"
        :query-tabs="queryTabs"
        :ddl-tabs="ddlTabs"
        :active-workspace-tab-id="activeWorkspaceTabId"
        :is-search-tab-active="isSearchTabActive"
        :schema-search-focus-token="schemaSearchFocusToken"
        :is-connected="isConnected"
        :transaction-active="transactionActive"
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
        :ai-suggestion-confidence="
          aiSuggestion ? aiSuggestion.confidence : null
        "
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
        :on-begin-transaction="beginTransaction"
        :on-commit-transaction="commitTransaction"
        :on-rollback-transaction="rollbackTransaction"
        :on-save-ddl="saveDdl"
        :on-refresh-active-object-detail="refreshActiveObjectDetail"
        :on-update-active-object-data-row="updateActiveObjectDataRow"
        :on-insert-active-object-data-row="insertActiveObjectDataRow"
        :on-delete-active-object-data-row="deleteActiveObjectDataRow"
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
          class="results-card"
          :result-panes="activeQueryResultPanes"
          :active-result-pane-id="activeQueryResultPaneId"
          :empty-state-message="queryResultsEmptyStateMessage"
          @activate-pane="activateQueryResultPane"
          :is-likely-numeric="isLikelyNumeric"
        />
      </section>
    </section>
  </main>

  <div
    v-if="showCreateObjectDialog"
    class="dialog-backdrop"
    @click.self="closeCreateObjectDialog"
  >
    <section
      class="dialog create-object-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-object-dialog-title"
    >
      <header class="dialog-header">
        <h2 id="create-object-dialog-title" class="dialog-title">
          Create Object
        </h2>
      </header>

      <div class="dialog-body">
        <label>
          Object Type
          <select
            v-model="createObjectDialogType"
            @change="onCreateObjectTypeChange"
          >
            <option
              v-for="option in CREATE_OBJECT_TYPE_OPTIONS"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </label>
        <label>
          Object Name
          <input
            v-model.trim="createObjectDialogName"
            placeholder="NEW_OBJECT"
            spellcheck="false"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            data-gramm="false"
            @input="createObjectDialogError = ''"
          />
        </label>
        <p class="muted">
          A SQL template will open in a new query sheet for schema
          <code>{{ connectedSchema }}</code>.
        </p>
      </div>

      <p v-if="createObjectDialogError" class="settings-error">
        {{ createObjectDialogError }}
      </p>

      <footer class="dialog-footer">
        <button class="btn" @click="closeCreateObjectDialog">Cancel</button>
        <button class="btn primary" @click="submitCreateObjectDialog">
          Open Template
        </button>
      </footer>
    </section>
  </div>

  <div
    v-if="showSettingsDialog"
    class="dialog-backdrop"
    @click.self="closeSettingsDialog"
  >
    <section
      class="dialog settings-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-dialog-title"
    >
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
            Overrides <code>ORACLE_CLIENT_LIB_DIR</code> for new Oracle
            connections in this app.
          </p>
        </fieldset>
        <fieldset class="settings-group">
          <legend>AI</legend>
          <label class="settings-option">
            <input
              v-model="settingsDialogAiSuggestionsEnabled"
              type="checkbox"
            />
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
              :placeholder="
                hasAiApiKey && !settingsDialogAiApiKeyDirty
                  ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (stored in keychain)'
                  : 'sk-...'
              "
              spellcheck="false"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              data-gramm="false"
              @input="settingsDialogAiApiKeyDirty = true"
            />
          </label>
          <p class="muted settings-hint">
            Stored in the OS keychain.
            <template v-if="hasAiApiKey && !settingsDialogAiApiKeyDirty">
              A key is already configured. Leave this field blank to keep the
              existing key, or enter a new value to replace it.
            </template>
            <template
              v-else-if="
                hasAiApiKey &&
                settingsDialogAiApiKeyDirty &&
                settingsDialogAiApiKey.trim().length === 0
              "
            >
              Saving will remove the stored key.
            </template>
            <template v-else-if="!hasAiApiKey">
              No key configured. Enter your API key above.
            </template>
          </p>
        </fieldset>
      </div>

      <p v-if="settingsDialogError" class="settings-error">
        {{ settingsDialogError }}
      </p>

      <footer class="dialog-footer">
        <button class="btn" @click="closeSettingsDialog">Cancel</button>
        <button class="btn primary" @click="saveSettingsDialog">Save</button>
      </footer>
    </section>
  </div>

  <div
    v-if="showExportDialog"
    class="dialog-backdrop"
    @click.self="closeExportDialog"
  >
    <section
      class="dialog export-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-dialog-title"
    >
      <header class="dialog-header">
        <h2 id="export-dialog-title" class="dialog-title">
          Export Database Schema
        </h2>
      </header>

      <div class="dialog-body">
        <label>
          Database
          <select
            v-model.number="selectedExportSessionId"
            :disabled="busy.exportingSchema || !schemaExportTargets.length"
          >
            <option
              v-for="target in schemaExportTargets"
              :key="target.sessionId"
              :value="target.sessionId"
            >
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
            <button
              class="btn"
              :disabled="busy.exportingSchema"
              @click="browseSchemaExportDirectory"
            >
              Browse...
            </button>
          </div>
        </label>

        <p class="muted">
          Exports object DDL into `.sql` files grouped by object type
          directories. Data rows are not exported.
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
            {{ exportProgressProcessed }} / {{ exportProgressTotal }} objects
            ({{ exportProgressPercent }}%)
          </p>
          <p v-else class="muted">Export in progress...</p>
          <p
            v-if="exportProgressCurrentObject"
            class="muted export-progress-object"
          >
            Current: {{ exportProgressCurrentObject }}
          </p>
        </div>
        <p v-if="errorMessage" class="export-error">{{ errorMessage }}</p>
        <p v-if="exportSummaryMessage" class="export-summary">
          {{ exportSummaryMessage }}
        </p>
      </div>

      <footer class="dialog-footer">
        <button
          class="btn"
          :disabled="busy.exportingSchema"
          @click="closeExportDialog"
        >
          Close
        </button>
        <button
          class="btn primary"
          :disabled="!canRunSchemaExport"
          @click="runSchemaExport"
        >
          {{ busy.exportingSchema ? "Exporting..." : "Export Schema" }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style>
:root,
:root[data-theme="light"] {
  --font-ui:
    "SF Pro Display", "Avenir Next", "Segoe UI", system-ui, sans-serif;
  --bg-canvas: #f1edf8;
  --bg-shell: rgba(255, 255, 255, 0.88);
  --bg-sidebar: rgba(248, 244, 253, 0.92);
  --bg-surface: rgba(255, 255, 255, 0.92);
  --bg-surface-muted: #f3edf9;
  --bg-hover: #ece5f6;
  --bg-active: #e4daf4;
  --bg-selected: #e9e0fb;
  --border: rgba(118, 92, 171, 0.1);
  --border-strong: rgba(118, 92, 171, 0.22);
  --panel-separator: rgba(118, 92, 171, 0.1);
  --text-primary: #21182f;
  --text-secondary: #64567d;
  --text-subtle: #8b7fa2;
  --accent: #7d5bd6;
  --accent-soft: rgba(125, 91, 214, 0.14);
  --accent-strong: #6b47c6;
  --accent-contrast: #ffffff;
  --success: #2c9b63;
  --danger: #c45073;
  --warning: #c18932;
  --focus-ring: rgba(125, 91, 214, 0.22);
  --dialog-backdrop: rgba(31, 24, 47, 0.32);
  --dialog-shadow: 0 22px 60px rgba(58, 39, 101, 0.16);
  --card-shadow: 0 18px 45px rgba(109, 84, 160, 0.08);
  --shell-shadow: 0 30px 70px rgba(74, 52, 121, 0.12);
  --splitter-hover: rgba(125, 91, 214, 0.28);
  --control-bg: #ffffff;
  --control-border: rgba(118, 92, 171, 0.14);
  --control-hover: #f5f0fb;
  --tab-active-bg: rgba(255, 255, 255, 0.96);
  --tab-active-border: rgba(125, 91, 214, 0.38);
  --table-divider: rgba(118, 92, 171, 0.12);
  --table-header-bg: #f4eefb;
  --table-row-alt: rgba(125, 91, 214, 0.035);
  --schema-chip-bg: rgba(125, 91, 214, 0.12);
  --schema-chip-border: rgba(125, 91, 214, 0.28);
  --schema-chip-text: #6b47c6;
  --link-hover: #5933b8;
  --row-new-bg: rgba(44, 155, 99, 0.1);
  --row-dirty-bg: rgba(193, 137, 50, 0.14);
  --tree-selected-text: #2c1a4d;
  --editor-surface: #ffffff;
  --editor-gutter-bg: #f6f1fb;
  --editor-gutter-border: rgba(118, 92, 171, 0.12);
  --editor-gutter-text: #998cb0;
  --editor-focus-outline: rgba(125, 91, 214, 0.45);
  --editor-text: #241930;
  --editor-caret: #7d5bd6;
  --editor-active-line: rgba(125, 91, 214, 0.05);
  --editor-active-gutter: rgba(125, 91, 214, 0.08);
  --editor-selection: rgba(125, 91, 214, 0.12);
  --editor-selection-focused: rgba(125, 91, 214, 0.18);
  --editor-placeholder: #8d80a5;
  --editor-token-keyword: #7d5bd6;
  --editor-token-operator: #6c5b88;
  --editor-token-string: #c0875f;
  --editor-token-number: #2e8d93;
  --editor-token-comment: #9689ad;
  --editor-token-type: #5363d3;
  --editor-token-variable: #241930;
  --editor-token-property: #241930;
  --editor-token-function: #6b47c6;
  --resizer-line: rgba(118, 92, 171, 0.18);
  --resizer-line-hover: rgba(125, 91, 214, 0.5);
  --scrollbar-thumb: rgba(128, 104, 173, 0.34);
  --scrollbar-thumb-hover: rgba(113, 86, 162, 0.5);
  --pane-header-height: 46px;
  --shell-border: rgba(118, 92, 171, 0.1);
  --shell-inner-border: rgba(255, 255, 255, 0.28);
  --grid-line: rgba(118, 92, 171, 0.08);
  font-family: var(--font-ui);
  color: var(--text-primary);
  background: var(--bg-canvas);
  color-scheme: light;
}

:root[data-theme="dark"] {
  --bg-canvas: #0e0c13;
  --bg-shell: rgba(25, 31, 41, 0.92);
  --bg-sidebar: rgba(30, 37, 49, 0.94);
  --bg-surface: rgba(27, 34, 46, 0.9);
  --bg-surface-muted: #242c3a;
  --bg-hover: #303b4d;
  --bg-active: #384658;
  --bg-selected: #2d435b;
  --border: rgba(148, 163, 184, 0.1);
  --border-strong: rgba(148, 163, 184, 0.22);
  --panel-separator: rgba(148, 163, 184, 0.09);
  --text-primary: #e8eef7;
  --text-secondary: #aeb9c8;
  --text-subtle: #8190a4;
  --accent: #5f8fcb;
  --accent-soft: rgba(95, 143, 203, 0.16);
  --accent-strong: #8db3e2;
  --accent-contrast: #0f1722;
  --success: #7fcea4;
  --danger: #e78da2;
  --warning: #e2b266;
  --focus-ring: rgba(95, 143, 203, 0.35);
  --dialog-backdrop: rgba(6, 4, 11, 0.74);
  --dialog-shadow: 0 28px 80px rgba(3, 2, 8, 0.55);
  --card-shadow: 0 24px 60px rgba(8, 5, 15, 0.28);
  --shell-shadow: 0 40px 100px rgba(5, 3, 10, 0.4);
  --splitter-hover: rgba(95, 143, 203, 0.34);
  --control-bg: rgba(38, 47, 62, 0.92);
  --control-border: rgba(148, 163, 184, 0.12);
  --control-hover: #334156;
  --tab-active-bg: rgba(37, 47, 64, 0.92);
  --tab-active-border: rgba(95, 143, 203, 0.42);
  --table-divider: rgba(148, 163, 184, 0.12);
  --table-header-bg: #202835;
  --table-row-alt: rgba(255, 255, 255, 0.02);
  --schema-chip-bg: rgba(95, 143, 203, 0.15);
  --schema-chip-border: rgba(141, 179, 226, 0.26);
  --schema-chip-text: #bfd7f2;
  --link-hover: #d0e3fa;
  --row-new-bg: rgba(130, 212, 156, 0.12);
  --row-dirty-bg: rgba(240, 189, 102, 0.12);
  --tree-selected-text: #ffffff;
  --editor-surface: #1b2230;
  --editor-gutter-bg: #1d2532;
  --editor-gutter-border: rgba(148, 163, 184, 0.1);
  --editor-gutter-text: #708095;
  --editor-focus-outline: rgba(141, 179, 226, 0.42);
  --editor-text: #edf2f9;
  --editor-caret: #8db3e2;
  --editor-active-line: rgba(95, 143, 203, 0.07);
  --editor-active-gutter: rgba(95, 143, 203, 0.11);
  --editor-selection: rgba(95, 143, 203, 0.18);
  --editor-selection-focused: rgba(95, 143, 203, 0.24);
  --editor-placeholder: #708095;
  --editor-token-keyword: #f0c28a;
  --editor-token-operator: #d5deea;
  --editor-token-string: #f0cf9e;
  --editor-token-number: #88d0d0;
  --editor-token-comment: #708095;
  --editor-token-type: #9dc3ef;
  --editor-token-variable: #edf2f9;
  --editor-token-property: #9dc3ef;
  --editor-token-function: #8db3e2;
  --resizer-line: rgba(148, 163, 184, 0.12);
  --resizer-line-hover: rgba(141, 179, 226, 0.5);
  --scrollbar-thumb: rgba(121, 140, 165, 0.34);
  --scrollbar-thumb-hover: rgba(148, 163, 184, 0.5);
  --shell-border: rgba(148, 163, 184, 0.08);
  --shell-inner-border: rgba(255, 255, 255, 0.03);
  --grid-line: rgba(148, 163, 184, 0.08);
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

body {
  font-family: var(--font-ui);
  background:
    linear-gradient(var(--grid-line) 1px, transparent 1px),
    linear-gradient(90deg, var(--grid-line) 1px, transparent 1px),
    radial-gradient(circle at top, rgba(155, 107, 255, 0.08), transparent 34%),
    var(--bg-canvas);
  background-size:
    12rem 12rem,
    12rem 12rem,
    auto,
    auto;
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
  grid-template-columns:
    var(--sidebar-width, 22rem) var(--splitter-size)
    minmax(0, 1fr);
  background: var(--bg-shell);
  box-shadow: var(--shell-shadow);
  backdrop-filter: blur(18px);
  border-radius: 28px;
  padding: 0.35rem;
  overflow: hidden;
}

.sidebar-shell {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  background: var(--bg-sidebar);
  overflow: hidden;
}

.app-main {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  gap: 0.35rem;
  padding: 0 0 0 0.35rem;
  overflow: hidden;
}

.workspace {
  display: grid;
  grid-template-rows:
    minmax(20rem, 1fr) var(--splitter-size) minmax(11rem, var(--results-height, 30%));
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.workspace-card,
.results-card {
  min-height: 0;
}

.dialog-backdrop {
  position: fixed;
  inset: 0;
  background: var(--dialog-backdrop);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  padding: 1rem;
}

.dialog {
  width: min(40rem, 100%);
  background: var(--bg-surface);
  border-radius: 18px;
  box-shadow: var(--dialog-shadow);
  display: grid;
  grid-template-rows: auto 1fr auto;
  max-height: min(85vh, 40rem);
  backdrop-filter: blur(16px);
}

.create-object-dialog {
  width: min(30rem, 100%);
}

.dialog-header {
  padding: 0.75rem 0.9rem;
  background: var(--bg-surface-muted);
}

.dialog-title {
  margin: 0;
  font-size: 0.92rem;
  font-weight: 600;
}

.dialog-body {
  padding: 0.9rem;
  display: grid;
  gap: 0.75rem;
  overflow: auto;
}

.dialog-body label {
  display: grid;
  gap: 0.3rem;
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
  border: 0;
  border-radius: 6px;
  background: var(--control-bg);
  padding: 0.5rem 0.6rem;
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
  padding: 0.7rem;
  border-radius: 6px;
  display: grid;
  gap: 0.55rem;
  background: color-mix(in srgb, var(--bg-surface-muted) 72%, transparent);
}

.settings-group legend {
  padding: 0 0.25rem;
  color: var(--text-secondary);
  font-size: 0.74rem;
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
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono",
    "Courier New", monospace;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding: 0.75rem 0.9rem;
  background: var(--bg-surface-muted);
}

.dialog .btn {
  border: 0;
  border-radius: 6px;
  background: var(--control-bg);
  padding: 0.45rem 0.7rem;
  font-size: 0.76rem;
  font-weight: 500;
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
  line-height: 1.5;
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

.settings-error {
  margin: 0.75rem 0.9rem 0;
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
  border-radius: 999px;
}

.panel-resizer:hover::after {
  background: var(--resizer-line-hover);
}

.panel-resizer.vertical {
  cursor: col-resize;
}

.panel-resizer.horizontal {
  cursor: row-resize;
}

.panel-resizer.horizontal::after {
  left: 0;
  right: 0;
  top: 50%;
  width: auto;
  height: 1px;
  transform: translateY(-50%);
}

@media (max-width: 1180px) {
  .desktop-shell {
    grid-template-columns:
      var(--sidebar-width, 20rem) var(--splitter-size)
      minmax(0, 1fr);
  }
}

@media (max-width: 980px) {
  .desktop-shell {
    grid-template-columns: 1fr;
    grid-template-rows: auto var(--splitter-size) minmax(0, 1fr);
  }

  .sidebar-shell {
    min-height: 20rem;
  }

  .panel-resizer.vertical {
    cursor: row-resize;
  }

  .panel-resizer.vertical::after {
    left: 0;
    right: 0;
    top: 50%;
    width: auto;
    height: 1px;
    transform: translateY(-50%);
  }

  .app-main {
    padding: 0.4rem 0 0;
  }

  .workspace {
    grid-template-rows:
      minmax(15rem, 1fr) var(--splitter-size) minmax(11rem, var(--results-height, 38%));
  }
}
</style>
