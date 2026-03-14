<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import ExplorerSidebar from "./components/ExplorerSidebar.vue";
import QueryResultsPane from "./components/QueryResultsPane.vue";
import WorkbenchHeader from "./components/WorkbenchHeader.vue";
import WorkbenchSidebarNav from "./components/WorkbenchSidebarNav.vue";
import WorkbenchSummaryCards from "./components/WorkbenchSummaryCards.vue";
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
  OracleObjectColumnEntry,
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

type SidebarSection =
  | "connections"
  | "explorer"
  | "query"
  | "object"
  | "settings";

type SummaryCardTone = "default" | "accent" | "muted";

interface WorkbenchSummaryCard {
  key: string;
  label: string;
  value: string;
  meta: string;
  tone?: SummaryCardTone;
}

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
    : "Select a query sheet to see results.",
);
const connectionLabel = computed<string>(() => {
  return (
    session.value?.displayName ||
    selectedProfile.value?.name ||
    profileName.value.trim() ||
    "No active connection"
  );
});
const activeWorkspaceLabel = computed<string>(() => {
  if (activeDdlObject.value) {
    return `${activeDdlObject.value.objectName} details`;
  }

  if (isSearchTabActive.value) {
    return "Schema search";
  }

  if (activeQueryTab.value) {
    return activeQueryTab.value.title;
  }

  return "Query workspace";
});
const selectedObjectLabel = computed<string>(() => {
  const object = activeDdlObject.value ?? selectedObject.value;
  if (!object) {
    return "";
  }

  return `${object.schema}.${object.objectName}`;
});
const executionSummary = computed<{ value: string; meta: string }>(() => {
  if (busy.runningQuery) {
    return {
      value: "Running query",
      meta: "Statement execution is in progress.",
    };
  }

  if (busy.savingDdl) {
    return {
      value: "Saving DDL",
      meta: "Persisting the active object definition.",
    };
  }

  if (busy.updatingData) {
    return {
      value: "Committing data",
      meta: "Applying pending row edits in the detail panel.",
    };
  }

  if (busy.searchingSchema) {
    return {
      value: "Searching schema",
      meta: "Scanning object names, source, and DDL.",
    };
  }

  if (errorMessage.value.trim()) {
    return {
      value: "Needs attention",
      meta: errorMessage.value,
    };
  }

  const activePane =
    activeQueryResultPanes.value.find(
      (pane) => pane.id === activeQueryResultPaneId.value,
    ) ?? activeQueryResultPanes.value[0];
  if (activePane?.errorMessage) {
    return {
      value: "Query error",
      meta: activePane.errorMessage,
    };
  }

  if (activePane?.queryResult) {
    if (activePane.queryResult.rowsAffected !== null) {
      return {
        value: `${activePane.queryResult.rowsAffected} rows affected`,
        meta: activePane.queryResult.message || activePane.title,
      };
    }

    return {
      value: `${activePane.queryResult.rows.length} rows returned`,
      meta: activePane.queryResult.message || activePane.title,
    };
  }

  return {
    value: statusMessage.value || "Ready",
    meta: isConnected.value
      ? "The workspace is ready for the next action."
      : "Connect to start exploring objects and running SQL.",
  };
});
const summaryCards = computed<WorkbenchSummaryCard[]>(() => [
  {
    key: "connection",
    label: "Active Connection",
    value: connectionLabel.value,
    meta: isConnected.value
      ? "Connected session and saved profile context."
      : "Choose a profile or enter credentials to connect.",
    tone: isConnected.value ? "accent" : "muted",
  },
  {
    key: "provider",
    label: "Provider",
    value: selectedProviderLabel.value || connection.provider.toUpperCase(),
    meta: selectedProfile.value
      ? `Profile: ${selectedProfile.value.name}`
      : "Provider-aware flow stays intact across the redesign.",
  },
  {
    key: "schema",
    label: "Schema",
    value: connectedSchema.value || connection.schema || "Not selected",
    meta: isConnected.value
      ? "Explorer, completions, and object tabs are scoped here."
      : "This schema will be used when the next session connects.",
  },
  {
    key: "object",
    label: "Selected Object",
    value: selectedObject.value?.objectName || "No object selected",
    meta: selectedObject.value
      ? `${selectedObject.value.schema} • ${selectedObject.value.objectType}`
      : "Open a table, view, or package from the explorer.",
    tone: selectedObject.value ? "default" : "muted",
  },
  {
    key: "execution",
    label: "Execution Status",
    value: executionSummary.value.value,
    meta: executionSummary.value.meta,
    tone: busy.runningQuery ? "accent" : "default",
  },
]);
const activeSidebarSection = computed<SidebarSection>(() => {
  if (showSettingsDialog.value) {
    return "settings";
  }

  if (activeDdlTab.value) {
    return "object";
  }

  if (isQueryTabActive.value || isSearchTabActive.value) {
    return "query";
  }

  return highlightedSidebarSection.value;
});
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
  columns: OracleObjectColumnEntry[],
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

function openQueryWorkspace(): void {
  if (activeQueryTab.value) {
    activateWorkspaceTab(activeQueryTab.value.id);
    return;
  }

  addQueryTab();
}

function openObjectWorkspace(): void {
  if (activeDdlTab.value) {
    activateWorkspaceTab(activeDdlTab.value.id);
    return;
  }

  if (!selectedObject.value) {
    highlightedSidebarSection.value = "explorer";
    return;
  }

  openObjectFromExplorer(selectedObject.value);
}

async function handleSidebarNavigate(section: SidebarSection): Promise<void> {
  if (section === "connections" || section === "explorer") {
    highlightedSidebarSection.value = section;
    return;
  }

  if (section === "query") {
    highlightedSidebarSection.value = "explorer";
    openQueryWorkspace();
    return;
  }

  if (section === "object") {
    highlightedSidebarSection.value = "explorer";
    openObjectWorkspace();
    return;
  }

  await openSettingsDialog();
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
      <WorkbenchSidebarNav
        :active-section="activeSidebarSection"
        :is-connected="isConnected"
        :provider-label="selectedProviderLabel"
        :connected-schema="connectedSchema"
        :selected-object-label="selectedObjectLabel"
        @navigate="(section) => void handleSidebarNavigate(section)"
      />

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
      <WorkbenchHeader
        :workspace-label="activeWorkspaceLabel"
        :status-message="statusMessage"
        :is-connected="isConnected"
        :connection-label="connectionLabel"
        :provider-label="selectedProviderLabel"
        :connected-schema="connectedSchema"
        :transaction-active="transactionActive"
        @open-settings="openSettingsDialog"
        @open-export="openExportDialogFromMenu"
      />

      <WorkbenchSummaryCards :cards="summaryCards" />

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
  --font-ui: "IBM Plex Sans", "Avenir Next", "Segoe UI", sans-serif;
  --bg-canvas: #f4efef;
  --bg-shell: #f7f2f3;
  --bg-sidebar: #f2ecee;
  --bg-surface: rgba(255, 255, 255, 0.92);
  --bg-surface-muted: #fbf7f7;
  --bg-hover: #f6eef1;
  --bg-active: #f2e4e9;
  --bg-selected: #eed9e1;
  --border: #e3d7dc;
  --border-strong: #d7c6ce;
  --panel-separator: #e7dde1;
  --text-primary: #2b2530;
  --text-secondary: #675a66;
  --text-subtle: #8a7f88;
  --accent: #c97d92;
  --accent-soft: #f0dce3;
  --accent-strong: #b85e78;
  --accent-contrast: #fff9fb;
  --success: #4f8c74;
  --danger: #b35b67;
  --warning: #a97a3e;
  --focus-ring: rgba(201, 125, 146, 0.24);
  --dialog-backdrop: rgba(78, 61, 68, 0.22);
  --dialog-shadow: 0 32px 80px rgba(88, 68, 77, 0.18);
  --card-shadow: 0 18px 36px rgba(89, 70, 80, 0.08);
  --shell-shadow: 0 28px 60px rgba(89, 70, 80, 0.1);
  --splitter-hover: rgba(201, 125, 146, 0.28);
  --control-bg: #ffffff;
  --control-border: #dccfd5;
  --control-hover: #f7eef1;
  --tab-active-bg: #ffffff;
  --tab-active-border: #e6d7de;
  --table-divider: #ece3e7;
  --table-header-bg: #fbf7f8;
  --table-row-alt: rgba(248, 242, 244, 0.58);
  --schema-chip-bg: #f5e7ec;
  --schema-chip-border: #ead2da;
  --schema-chip-text: #8a5f6e;
  --link-hover: #8f4259;
  --row-new-bg: rgba(138, 188, 170, 0.16);
  --row-dirty-bg: rgba(201, 125, 146, 0.16);
  --tree-selected-text: #6f3448;
  --editor-surface: #ffffff;
  --editor-gutter-bg: #fbf6f7;
  --editor-gutter-border: #eee4e8;
  --editor-gutter-text: #9c8f98;
  --editor-focus-outline: #e8c8d3;
  --editor-text: #302834;
  --editor-caret: #c97d92;
  --editor-active-line: rgba(201, 125, 146, 0.08);
  --editor-active-gutter: rgba(201, 125, 146, 0.14);
  --editor-selection: rgba(201, 125, 146, 0.18);
  --editor-selection-focused: rgba(201, 125, 146, 0.24);
  --editor-placeholder: #a09099;
  --editor-token-keyword: #b55373;
  --editor-token-operator: #866878;
  --editor-token-string: #aa6a30;
  --editor-token-number: #2d7d8f;
  --editor-token-comment: #8c7f89;
  --editor-token-type: #855f8b;
  --editor-token-variable: #302834;
  --editor-token-property: #302834;
  --editor-token-function: #8f4259;
  --resizer-line: #eadde3;
  --resizer-line-hover: #c97d92;
  --scrollbar-thumb: rgba(139, 117, 128, 0.32);
  --scrollbar-thumb-hover: rgba(139, 117, 128, 0.46);
  --pane-header-height: 58px;
  font-family: var(--font-ui);
  color: var(--text-primary);
  background: var(--bg-canvas);
  color-scheme: light;
}

:root[data-theme="dark"] {
  --bg-canvas: #171316;
  --bg-shell: #1d171b;
  --bg-sidebar: #241d22;
  --bg-surface: rgba(39, 31, 37, 0.94);
  --bg-surface-muted: #2b2328;
  --bg-hover: #342a31;
  --bg-active: #41313a;
  --bg-selected: #4a3641;
  --border: #453640;
  --border-strong: #5b4752;
  --panel-separator: #3b2f37;
  --text-primary: #f1e6eb;
  --text-secondary: #ccbfc7;
  --text-subtle: #a994a0;
  --accent: #d8879e;
  --accent-soft: #4d3340;
  --accent-strong: #e9a3b7;
  --accent-contrast: #26161d;
  --success: #75b79b;
  --danger: #e39aa7;
  --warning: #d6a26a;
  --focus-ring: rgba(216, 135, 158, 0.34);
  --dialog-backdrop: rgba(8, 5, 7, 0.7);
  --dialog-shadow: 0 32px 80px rgba(0, 0, 0, 0.42);
  --card-shadow: 0 20px 42px rgba(0, 0, 0, 0.24);
  --shell-shadow: 0 30px 70px rgba(0, 0, 0, 0.32);
  --splitter-hover: rgba(216, 135, 158, 0.36);
  --control-bg: #2b2328;
  --control-border: #58434f;
  --control-hover: #382d34;
  --tab-active-bg: #2a2126;
  --tab-active-border: #604852;
  --table-divider: #43343d;
  --table-header-bg: #261d22;
  --table-row-alt: rgba(255, 255, 255, 0.02);
  --schema-chip-bg: #402b35;
  --schema-chip-border: #6b4d59;
  --schema-chip-text: #f0d6de;
  --link-hover: #ffdce6;
  --row-new-bg: rgba(117, 183, 155, 0.16);
  --row-dirty-bg: rgba(216, 135, 158, 0.18);
  --tree-selected-text: #ffe3ec;
  --editor-surface: #231b20;
  --editor-gutter-bg: #2a2227;
  --editor-gutter-border: #43343d;
  --editor-gutter-text: #a88f9b;
  --editor-focus-outline: #7a5564;
  --editor-text: #f2e7ec;
  --editor-caret: #e9a3b7;
  --editor-active-line: rgba(216, 135, 158, 0.18);
  --editor-active-gutter: rgba(216, 135, 158, 0.24);
  --editor-selection: rgba(216, 135, 158, 0.26);
  --editor-selection-focused: rgba(216, 135, 158, 0.34);
  --editor-placeholder: #a7909b;
  --editor-token-keyword: #f0a8bc;
  --editor-token-operator: #d3b6c0;
  --editor-token-string: #efc48f;
  --editor-token-number: #8bd7ea;
  --editor-token-comment: #ad95a0;
  --editor-token-type: #d7b0ea;
  --editor-token-variable: #f2e7ec;
  --editor-token-property: #f2e7ec;
  --editor-token-function: #f4c1d0;
  --resizer-line: #4a3943;
  --resizer-line-hover: #d8879e;
  --scrollbar-thumb: rgba(177, 153, 163, 0.28);
  --scrollbar-thumb-hover: rgba(177, 153, 163, 0.4);
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
    radial-gradient(circle at top left, rgba(221, 187, 197, 0.55), transparent 26%),
    radial-gradient(circle at bottom right, rgba(231, 214, 219, 0.72), transparent 24%),
    var(--bg-canvas);
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
  --splitter-size: 8px;
  height: 100%;
  display: grid;
  grid-template-columns:
    var(--sidebar-width, 28rem) var(--splitter-size)
    minmax(0, 1fr);
  background: var(--bg-shell);
  padding: 1rem;
  overflow: hidden;
}

.sidebar-shell {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: 108px minmax(0, 1fr);
  border: 1px solid var(--border);
  border-radius: 2rem;
  background: color-mix(in srgb, var(--bg-surface) 88%, white);
  box-shadow: var(--shell-shadow);
  overflow: hidden;
}

.app-main {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 1rem;
  padding: 0.1rem 0 0.1rem 1.2rem;
  overflow: hidden;
}

.workspace {
  display: grid;
  grid-template-rows:
    minmax(16rem, 1fr) var(--splitter-size) minmax(12rem, var(--results-height, 38%));
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
  padding: 1.2rem;
  backdrop-filter: blur(8px);
}

.dialog {
  width: min(40rem, 100%);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 1.6rem;
  box-shadow: var(--dialog-shadow);
  display: grid;
  grid-template-rows: auto 1fr auto;
  max-height: min(85vh, 40rem);
  backdrop-filter: blur(18px);
}

.create-object-dialog {
  width: min(30rem, 100%);
}

.dialog-header {
  padding: 1rem 1.15rem;
  border-bottom: 1px solid var(--border);
  background: var(--bg-surface-muted);
}

.dialog-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
}

.dialog-body {
  padding: 1rem 1.15rem;
  display: grid;
  gap: 0.85rem;
  overflow: auto;
}

.dialog-body label {
  display: grid;
  gap: 0.35rem;
  font-size: 0.78rem;
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
  border-radius: 0.9rem;
  background: var(--control-bg);
  padding: 0.72rem 0.85rem;
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
  padding: 0.8rem 0.9rem;
  border: 1px solid var(--border);
  border-radius: 1rem;
  display: grid;
  gap: 0.7rem;
}

.settings-group legend {
  padding: 0 0.35rem;
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
  gap: 0.6rem;
  padding: 1rem 1.15rem;
  border-top: 1px solid var(--border);
  background: var(--bg-surface-muted);
}

.dialog .btn {
  border: 1px solid var(--control-border);
  border-radius: 999px;
  background: var(--control-bg);
  padding: 0.72rem 1rem;
  font-size: 0.76rem;
  font-weight: 600;
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
  margin: 0.75rem 1.15rem 0;
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
  width: 2px;
  transform: translateX(-50%);
  background: var(--resizer-line);
  border-radius: 999px;
  transition:
    background-color 0.16s ease,
    transform 0.16s ease;
  opacity: 0.9;
}

.panel-resizer:hover::after {
  background: var(--resizer-line-hover);
  transform: translateX(-50%) scaleY(0.86);
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
  height: 2px;
  transform: translateY(-50%);
}

@media (max-width: 1180px) {
  .sidebar-shell {
    grid-template-columns: 100px minmax(0, 1fr);
  }
}

@media (max-width: 980px) {
  .desktop-shell {
    grid-template-columns: 1fr;
    grid-template-rows: auto var(--splitter-size) minmax(0, 1fr);
    padding: 0.85rem;
  }

  .sidebar-shell {
    grid-template-columns: 1fr;
    border-radius: 1.6rem;
  }

  .panel-resizer.vertical {
    cursor: row-resize;
  }

  .panel-resizer.vertical::after {
    left: 0;
    right: 0;
    top: 50%;
    width: auto;
    height: 2px;
    transform: translateY(-50%);
  }

  .app-main {
    padding: 0.8rem 0 0;
  }

  .workspace {
    grid-template-rows:
      minmax(14rem, 1fr) var(--splitter-size) minmax(12rem, var(--results-height, 44%));
  }
}
</style>
