import { computed, reactive, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type {
  BusyState,
  ConnectionProfile,
  ObjectDetailTabDefinition,
  ObjectDetailTabId,
  OracleConnectRequest,
  OracleObjectEntry,
  OracleQueryResult,
  OracleSchemaSearchResult,
  OracleSessionSummary,
  SchemaExportResult,
  SchemaExportTarget,
  WorkspaceDdlTab,
  WorkspaceQueryResultPane,
  WorkspaceQueryTab,
} from "../types/clarity";

const QUERY_TAB_PREFIX = "query:";
const FIRST_QUERY_TAB_ID = `${QUERY_TAB_PREFIX}1`;
const SEARCH_TAB_ID = "search:code";
const OBJECT_DATA_PREVIEW_LIMIT = 500;
const OBJECT_DATA_ROW_ID_COLUMN = "__CLARITY_ROWID__";
const DEFAULT_QUERY_ROW_LIMIT = 1000;
const MAX_QUERY_ROW_LIMIT = 10000;
const SAFE_SQL_LEADING_KEYWORDS = new Set(["SELECT", "WITH", "EXPLAIN", "DESCRIBE", "DESC"]);
const NON_STANDALONE_SQL_KEYWORDS = new Set([
  "END",
  "EXCEPTION",
  "WHEN",
  "ELSE",
  "ELSIF",
  "LOOP",
  "THEN",
]);
const MUTATING_SQL_KEYWORD_PATTERN =
  /\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|DROP|ALTER|CREATE|RENAME|GRANT|REVOKE|COMMENT|BEGIN|DECLARE|CALL|EXECUTE)\b/g;

function readDebugConnectionString(value: string | undefined, fallback: string): string {
  if (!import.meta.env.DEV) {
    return fallback;
  }

  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : fallback;
}

function readDebugConnectionPort(value: string | undefined, fallback: number): number {
  if (!import.meta.env.DEV) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : fallback;
}

function readDebugPositiveInteger(value: string | undefined, fallback: number): number {
  if (!import.meta.env.DEV) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

function clampQueryRowLimit(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_QUERY_ROW_LIMIT;
  }

  return Math.min(Math.max(Math.trunc(value), 1), MAX_QUERY_ROW_LIMIT);
}

function toErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected error";
}

function buildDefaultSchemaQuery(schema: string): string {
  const normalized = schema.trim().toUpperCase() || "YOUR_SCHEMA";
  return `select object_name, object_type from all_objects where owner = '${normalized}' order by object_type, object_name fetch first 100 rows only`;
}

function isLikelyNumeric(value: string): boolean {
  const normalized = value.trim().replace(/,/g, "");
  return /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(normalized);
}

function extractMutatingSqlKeywords(sql: string): string[] {
  const normalized = sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ")
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/"(?:\"\"|[^"])*"/g, '""')
    .toUpperCase();

  const matches = normalized.match(MUTATING_SQL_KEYWORD_PATTERN) ?? [];
  return [...new Set(matches)];
}

function extractLeadingSqlKeyword(sql: string): string | null {
  const normalized = sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ")
    .trimStart()
    .toUpperCase();
  const match = normalized.match(/^[A-Z]+/);
  return match ? match[0] : null;
}

function shouldConfirmBeforeExecution(sql: string): { shouldConfirm: boolean; reasons: string[] } {
  const reasons = extractMutatingSqlKeywords(sql);
  if (reasons.length > 0) {
    return { shouldConfirm: true, reasons };
  }

  const leadingKeyword = extractLeadingSqlKeyword(sql);
  if (!leadingKeyword) {
    return { shouldConfirm: false, reasons: [] };
  }

  if (!SAFE_SQL_LEADING_KEYWORDS.has(leadingKeyword)) {
    return { shouldConfirm: true, reasons: [leadingKeyword] };
  }

  return { shouldConfirm: false, reasons: [] };
}

function buildMutatingQueryPrompt(reasons: string[]): string {
  const reasonList = reasons.slice(0, 4).join(", ");
  return `This statement appears to modify data/schema (${reasonList}). Continue execution?`;
}

function removeSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--.*$/gm, " ");
}

function isCommentOnlySqlFragment(sql: string): boolean {
  return removeSqlComments(sql).trim().length === 0;
}

function normalizeStatementForExecution(sql: string): string {
  const trimmed = sql.trim();
  if (!trimmed) {
    return "";
  }

  const leadingKeyword = extractLeadingSqlKeyword(trimmed);
  if (leadingKeyword === "BEGIN" || leadingKeyword === "DECLARE") {
    return trimmed;
  }

  return trimmed.replace(/;+\s*$/g, "").trimEnd();
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let buffer = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  const pushBuffer = () => {
    const statement = buffer.trim();
    buffer = "";
    if (!statement || isCommentOnlySqlFragment(statement)) {
      return;
    }
    statements.push(statement);
  };

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const nextChar = sql[index + 1] ?? "";

    if (inLineComment) {
      buffer += char;
      if (char === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      buffer += char;
      if (char === "*" && nextChar === "/") {
        buffer += "/";
        index += 1;
        inBlockComment = false;
      }
      continue;
    }

    if (inSingleQuote) {
      buffer += char;
      if (char === "'" && nextChar === "'") {
        buffer += "'";
        index += 1;
        continue;
      }
      if (char === "'") {
        inSingleQuote = false;
      }
      continue;
    }

    if (inDoubleQuote) {
      buffer += char;
      if (char === '"' && nextChar === '"') {
        buffer += '"';
        index += 1;
        continue;
      }
      if (char === '"') {
        inDoubleQuote = false;
      }
      continue;
    }

    if (char === "-" && nextChar === "-") {
      buffer += "--";
      index += 1;
      inLineComment = true;
      continue;
    }

    if (char === "/" && nextChar === "*") {
      buffer += "/*";
      index += 1;
      inBlockComment = true;
      continue;
    }

    if (char === "'") {
      buffer += char;
      inSingleQuote = true;
      continue;
    }

    if (char === '"') {
      buffer += char;
      inDoubleQuote = true;
      continue;
    }

    if (char === ";") {
      pushBuffer();
      continue;
    }

    buffer += char;
  }

  pushBuffer();
  return statements;
}

function splitQueryTextForExecution(sql: string): string[] {
  const trimmed = sql.trim();
  if (!trimmed) {
    return [];
  }

  const candidates = splitSqlStatements(trimmed)
    .map((statement) => normalizeStatementForExecution(statement))
    .filter((statement) => statement.length > 0);

  if (candidates.length <= 1) {
    const fallback = normalizeStatementForExecution(candidates[0] ?? trimmed);
    return fallback ? [fallback] : [];
  }

  for (const statement of candidates) {
    const keyword = extractLeadingSqlKeyword(statement);
    if (!keyword || NON_STANDALONE_SQL_KEYWORDS.has(keyword)) {
      const fallback = normalizeStatementForExecution(trimmed);
      return fallback ? [fallback] : [];
    }
  }

  return candidates;
}

function collectExecutionPreflight(statements: string[]): { shouldConfirm: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const seen = new Set<string>();

  for (const statement of statements) {
    const preflight = shouldConfirmBeforeExecution(statement);
    if (!preflight.shouldConfirm) {
      continue;
    }

    for (const reason of preflight.reasons) {
      if (seen.has(reason)) {
        continue;
      }
      seen.add(reason);
      reasons.push(reason);
    }
  }

  return {
    shouldConfirm: reasons.length > 0,
    reasons,
  };
}

async function yieldUiFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function buildQueryTabId(tabNumber: number): string {
  return `${QUERY_TAB_PREFIX}${tabNumber}`;
}

function buildQueryResultPaneId(tabId: string, paneNumber: number): string {
  return `${tabId}:result:${paneNumber}`;
}

function createQueryResultPane(tabId: string, paneNumber: number): WorkspaceQueryResultPane {
  return {
    id: buildQueryResultPaneId(tabId, paneNumber),
    title: `Result ${paneNumber}`,
    queryResult: null,
    errorMessage: "",
  };
}

function createQueryTab(tabNumber: number, schema: string): WorkspaceQueryTab {
  const tabId = buildQueryTabId(tabNumber);
  const firstResultPane = createQueryResultPane(tabId, 1);
  return {
    id: tabId,
    title: `Query ${tabNumber}`,
    queryText: buildDefaultSchemaQuery(schema),
    resultPanes: [firstResultPane],
    activeResultPaneId: firstResultPane.id,
    nextResultPaneNumber: 2,
  };
}

export function useClarityWorkspace() {
  const connection = reactive<OracleConnectRequest>({
    provider: "oracle",
    host: readDebugConnectionString(import.meta.env.VITE_ORACLE_HOST, "localhost"),
    port: readDebugConnectionPort(import.meta.env.VITE_ORACLE_PORT, 1521),
    serviceName: readDebugConnectionString(import.meta.env.VITE_ORACLE_SERVICE_NAME, "XEPDB1"),
    username: readDebugConnectionString(import.meta.env.VITE_ORACLE_USERNAME, "hr"),
    password: import.meta.env.DEV ? (import.meta.env.VITE_ORACLE_PASSWORD ?? "") : "",
    schema: readDebugConnectionString(import.meta.env.VITE_ORACLE_SCHEMA, "HR"),
  });
  const profileName = ref("");
  const selectedProfileId = ref("");
  const saveProfilePassword = ref(true);

  const session = ref<OracleSessionSummary | null>(null);
  const connectionProfiles = ref<ConnectionProfile[]>([]);
  const objects = ref<OracleObjectEntry[]>([]);
  const selectedObject = ref<OracleObjectEntry | null>(null);
  const ddlTabs = ref<WorkspaceDdlTab[]>([]);
  const queryTabs = ref<WorkspaceQueryTab[]>([createQueryTab(1, connection.schema)]);
  const queryTabNumber = ref(2);
  const schemaSearchText = ref("");
  const schemaSearchIncludeObjectNames = ref(true);
  const schemaSearchIncludeSource = ref(true);
  const schemaSearchIncludeDdl = ref(true);
  const schemaSearchFocusToken = ref(0);
  const exportDestinationDirectory = ref("");
  const selectedExportSessionId = ref<number | null>(null);
  const queryRowLimit = ref(
    clampQueryRowLimit(readDebugPositiveInteger(import.meta.env.VITE_QUERY_ROW_LIMIT, DEFAULT_QUERY_ROW_LIMIT)),
  );
  const schemaSearchResults = ref<OracleSchemaSearchResult[]>([]);
  const schemaSearchPerformed = ref(false);
  const statusMessage = ref("Ready. Connect to an Oracle session to begin.");
  const errorMessage = ref("");
  const activeWorkspaceTabId = ref(FIRST_QUERY_TAB_ID);
  const expandedObjectTypes = ref<Record<string, boolean>>({});

  const busy = reactive<BusyState>({
    connecting: false,
    loadingProfiles: false,
    savingProfile: false,
    deletingProfile: false,
    loadingProfileSecret: false,
    loadingObjects: false,
    loadingDdl: false,
    savingDdl: false,
    runningQuery: false,
    updatingData: false,
    exportingSchema: false,
    searchingSchema: false,
  });

  const isConnected = computed(() => session.value !== null);
  const connectedSchema = computed(() => session.value?.schema ?? connection.schema.toUpperCase());
  const selectedProviderLabel = computed(() => {
    const provider = session.value?.provider ?? connection.provider;
    return provider.toUpperCase();
  });
  const selectedProfile = computed(
    () => connectionProfiles.value.find((profile) => profile.id === selectedProfileId.value) ?? null,
  );
  const schemaExportTargets = computed<SchemaExportTarget[]>(() => {
    if (!session.value) {
      return [];
    }

    return [
      {
        sessionId: session.value.sessionId,
        label: session.value.displayName,
        schema: session.value.schema,
        provider: session.value.provider,
      },
    ];
  });
  const activeQueryTab = computed(() =>
    queryTabs.value.find((tab) => tab.id === activeWorkspaceTabId.value) ?? null,
  );
  const activeDdlTab = computed(() =>
    ddlTabs.value.find((tab) => tab.id === activeWorkspaceTabId.value) ?? null,
  );
  const isSearchTabActive = computed(() => activeWorkspaceTabId.value === SEARCH_TAB_ID);
  const activeDdlObject = computed(() => activeDdlTab.value?.object ?? null);
  const isQueryTabActive = computed(() => activeQueryTab.value !== null);
  const activeQueryResultPanes = computed<WorkspaceQueryResultPane[]>(() => activeQueryTab.value?.resultPanes ?? []);
  const activeQueryResultPaneId = computed<string | null>(() => {
    if (!activeQueryTab.value) {
      return null;
    }

    return activeQueryTab.value.activeResultPaneId || activeQueryTab.value.resultPanes[0]?.id || null;
  });
  const activeQueryResultPane = computed<WorkspaceQueryResultPane | null>(() => {
    if (!activeQueryTab.value) {
      return null;
    }

    const activePane = activeQueryTab.value.resultPanes.find((pane) => pane.id === activeQueryResultPaneId.value);
    return activePane ?? activeQueryTab.value.resultPanes[0] ?? null;
  });
  const activeQueryText = computed({
    get: () => activeQueryTab.value?.queryText ?? "",
    set: (value: string) => {
      if (!activeQueryTab.value) {
        return;
      }

      activeQueryTab.value.queryText = value;
    },
  });
  const activeDdlText = computed({
    get: () => activeDdlTab.value?.ddlText ?? "",
    set: (value: string) => {
      if (!activeDdlTab.value) {
        return;
      }

      activeDdlTab.value.ddlText = value;
    },
  });
  const activeObjectDetailTabs = computed<ObjectDetailTabDefinition[]>(() =>
    activeDdlTab.value ? getObjectDetailTabs(activeDdlTab.value.object) : [],
  );
  const activeObjectDetailTabId = computed<ObjectDetailTabId | null>(
    () => activeDdlTab.value?.activeDetailTabId ?? null,
  );
  const activeObjectDetailRawResult = computed<OracleQueryResult | null>(() => {
    if (!activeDdlTab.value) {
      return null;
    }

    if (activeDdlTab.value.activeDetailTabId === "data") {
      return activeDdlTab.value.dataResult;
    }

    if (activeDdlTab.value.activeDetailTabId === "metadata") {
      return activeDdlTab.value.metadataResult;
    }

    return null;
  });
  const activeObjectDetailResult = computed<OracleQueryResult | null>(() => {
    const result = activeObjectDetailRawResult.value;
    if (
      !activeDdlTab.value ||
      activeDdlTab.value.activeDetailTabId !== "data" ||
      !isTableObject(activeDdlTab.value.object.objectType) ||
      !result ||
      !hasObjectDataRowIdColumn(result)
    ) {
      return result;
    }

    return {
      ...result,
      columns: result.columns.slice(1),
      rows: result.rows.map((row) => row.slice(1)),
    };
  });
  const isActiveObjectDataEditable = computed<boolean>(() => {
    if (!activeDdlTab.value || activeDdlTab.value.activeDetailTabId !== "data") {
      return false;
    }

    if (!isTableObject(activeDdlTab.value.object.objectType) || !activeDdlTab.value.dataResult) {
      return false;
    }

    return hasObjectDataRowIdColumn(activeDdlTab.value.dataResult);
  });
  const activeObjectDetailLoading = computed<boolean>(() => {
    if (!activeDdlTab.value) {
      return false;
    }

    if (activeDdlTab.value.activeDetailTabId === "data") {
      return activeDdlTab.value.loadingData;
    }

    if (activeDdlTab.value.activeDetailTabId === "metadata") {
      return activeDdlTab.value.loadingMetadata;
    }

    return false;
  });

  const objectTree = computed(() => {
    const byType = new Map<string, OracleObjectEntry[]>();

    for (const entry of objects.value) {
      let entries = byType.get(entry.objectType);
      if (!entries) {
        entries = [];
        byType.set(entry.objectType, entries);
      }
      entries.push(entry);
    }

    return Array.from(byType.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([objectType, entries]) => ({
        objectType,
        entries: [...entries].sort((left, right) => left.objectName.localeCompare(right.objectName)),
      }));
  });

  function isObjectTypeExpanded(objectType: string): boolean {
    const expanded = expandedObjectTypes.value[objectType];
    return expanded ?? false;
  }

  function toggleObjectType(objectType: string): void {
    const nextState = !isObjectTypeExpanded(objectType);
    expandedObjectTypes.value = {
      ...expandedObjectTypes.value,
      [objectType]: nextState,
    };
  }

  function normalizeObjectType(objectType: string): string {
    return objectType.trim().toUpperCase();
  }

  function canPreviewObjectData(objectType: string): boolean {
    const normalized = normalizeObjectType(objectType);
    return normalized === "TABLE" || normalized === "VIEW";
  }

  function isTableObject(objectType: string): boolean {
    return normalizeObjectType(objectType) === "TABLE";
  }

  function getObjectDetailTabs(object: OracleObjectEntry): ObjectDetailTabDefinition[] {
    const tabs: ObjectDetailTabDefinition[] = [];
    if (canPreviewObjectData(object.objectType)) {
      tabs.push({ id: "data", label: "Data" });
    }
    tabs.push({ id: "ddl", label: "DDL" });
    tabs.push({ id: "metadata", label: "Metadata" });
    return tabs;
  }

  function getDefaultObjectDetailTabId(object: OracleObjectEntry): ObjectDetailTabId {
    return canPreviewObjectData(object.objectType) ? "data" : "ddl";
  }

  function isObjectDetailTabSupported(object: OracleObjectEntry, tabId: ObjectDetailTabId): boolean {
    return getObjectDetailTabs(object).some((tab) => tab.id === tabId);
  }

  function toQuotedIdentifier(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
  }

  function toSqlStringLiteral(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
  }

  function toSqlDataLiteral(value: string): string {
    if (value === "") {
      return "NULL";
    }

    return toSqlStringLiteral(value);
  }

  function hasObjectDataRowIdColumn(result: OracleQueryResult): boolean {
    const firstColumn = (result.columns[0] ?? "").replace(/"/g, "").trim().toUpperCase();
    const expected = OBJECT_DATA_ROW_ID_COLUMN.toUpperCase();
    return firstColumn === expected || firstColumn === "ROWID";
  }

  function buildObjectDataPreviewSql(object: OracleObjectEntry): string {
    const owner = `${toQuotedIdentifier(object.schema)}.${toQuotedIdentifier(object.objectName)}`;
    if (!isTableObject(object.objectType)) {
      return `select * from ${owner} fetch first ${OBJECT_DATA_PREVIEW_LIMIT} rows only`;
    }

    return `select rowidtochar(t.rowid) as ${toQuotedIdentifier(OBJECT_DATA_ROW_ID_COLUMN)}, t.* from ${owner} t fetch first ${OBJECT_DATA_PREVIEW_LIMIT} rows only`;
  }

  function buildObjectMetadataSql(object: OracleObjectEntry): string {
    const owner = toSqlStringLiteral(object.schema.trim());
    const objectName = toSqlStringLiteral(object.objectName.trim());
    const objectType = toSqlStringLiteral(object.objectType.trim());
    if (canPreviewObjectData(object.objectType)) {
      return `select column_id, column_name, data_type, data_length, data_precision, data_scale, nullable, data_default from all_tab_columns where owner = ${owner} and table_name = ${objectName} order by column_id`;
    }

    return `select owner, object_name, object_type, status, created, last_ddl_time from all_objects where owner = ${owner} and object_name = ${objectName} and object_type = ${objectType}`;
  }

  function buildDdlTabId(object: OracleObjectEntry): string {
    return `ddl:${object.schema}:${object.objectType}:${object.objectName}`;
  }

  function prepareQueryResultPanes(tab: WorkspaceQueryTab, statementCount: number): void {
    const paneCount = Math.max(1, statementCount);
    const panes = Array.from({ length: paneCount }, (_, index) => createQueryResultPane(tab.id, index + 1));
    tab.resultPanes = panes;
    tab.activeResultPaneId = panes[0].id;
    tab.nextResultPaneNumber = paneCount + 1;
  }

  function addQueryTab(): void {
    const tabNumber = queryTabNumber.value;
    queryTabNumber.value += 1;

    const tab = createQueryTab(tabNumber, session.value?.schema ?? connection.schema);

    queryTabs.value.push(tab);
    activateWorkspaceTab(tab.id);
  }

  function openSearchTab(focusInput = false): void {
    activateWorkspaceTab(SEARCH_TAB_ID);
    if (focusInput) {
      schemaSearchFocusToken.value += 1;
    }
  }

  function activateWorkspaceTab(tabId: string): void {
    activeWorkspaceTabId.value = tabId;

    if (tabId === SEARCH_TAB_ID) {
      return;
    }

    if (queryTabs.value.some((tab) => tab.id === tabId)) {
      return;
    }

    const tab = ddlTabs.value.find((entry) => entry.id === tabId);
    if (tab) {
      selectedObject.value = tab.object;
      void ensureObjectDetailLoaded(tab, tab.activeDetailTabId);
    }
  }

  function activateQueryResultPane(paneId: string): void {
    if (!activeQueryTab.value) {
      return;
    }

    if (!activeQueryTab.value.resultPanes.some((pane) => pane.id === paneId)) {
      return;
    }

    activeQueryTab.value.activeResultPaneId = paneId;
  }

  function closeQueryTab(tabId: string): void {
    if (queryTabs.value.length <= 1) {
      return;
    }

    const index = queryTabs.value.findIndex((tab) => tab.id === tabId);
    if (index < 0) {
      return;
    }

    const wasActive = activeWorkspaceTabId.value === tabId;
    queryTabs.value.splice(index, 1);

    if (wasActive) {
      const fallbackQueryTab = queryTabs.value[Math.max(0, index - 1)] ?? queryTabs.value[0];
      if (fallbackQueryTab) {
        activateWorkspaceTab(fallbackQueryTab.id);
      }
    }
  }

  function closeDdlTab(tabId: string): void {
    const index = ddlTabs.value.findIndex((tab) => tab.id === tabId);
    if (index < 0) {
      return;
    }

    const wasActive = activeWorkspaceTabId.value === tabId;
    ddlTabs.value.splice(index, 1);

    if (wasActive) {
      const fallbackTab = ddlTabs.value[Math.max(0, index - 1)];
      activateWorkspaceTab(fallbackTab?.id ?? queryTabs.value[0]?.id ?? FIRST_QUERY_TAB_ID);
    }
  }

  function openObjectFromExplorer(object: OracleObjectEntry): void {
    selectedObject.value = object;
    const tabId = buildDdlTabId(object);
    const existingTab = ddlTabs.value.find((tab) => tab.id === tabId);
    if (existingTab) {
      existingTab.object = object;
      if (!isObjectDetailTabSupported(existingTab.object, existingTab.activeDetailTabId)) {
        existingTab.activeDetailTabId = getDefaultObjectDetailTabId(existingTab.object);
      }
      activateWorkspaceTab(existingTab.id);
      return;
    }

    void loadDdl(object);
  }

  function activateObjectDetailTab(tabId: ObjectDetailTabId): void {
    const tab = activeDdlTab.value;
    if (!tab || tab.activeDetailTabId === tabId || !isObjectDetailTabSupported(tab.object, tabId)) {
      return;
    }

    tab.activeDetailTabId = tabId;
    void ensureObjectDetailLoaded(tab, tabId);
  }

  function refreshActiveObjectDetail(): void {
    const tab = activeDdlTab.value;
    if (!tab) {
      return;
    }

    if (tab.activeDetailTabId === "data") {
      void loadObjectData(tab, true);
      return;
    }

    if (tab.activeDetailTabId === "metadata") {
      void loadObjectMetadata(tab, true);
    }
  }

  async function ensureObjectDetailLoaded(tab: WorkspaceDdlTab, detailTabId: ObjectDetailTabId): Promise<void> {
    if (detailTabId === "data") {
      await loadObjectData(tab);
      return;
    }

    if (detailTabId === "metadata") {
      await loadObjectMetadata(tab);
    }
  }

  async function loadObjectData(tab: WorkspaceDdlTab, forceReload = false): Promise<void> {
    if (!session.value || !canPreviewObjectData(tab.object.objectType) || tab.loadingData) {
      return;
    }

    const cachedDataNeedsRowIdUpgrade =
      isTableObject(tab.object.objectType) && !!tab.dataResult && !hasObjectDataRowIdColumn(tab.dataResult);
    if (!forceReload && tab.dataResult && !cachedDataNeedsRowIdUpgrade) {
      return;
    }

    errorMessage.value = "";
    tab.loadingData = true;

    try {
      tab.dataResult = await invoke<OracleQueryResult>("db_run_query", {
        request: {
          sessionId: session.value.sessionId,
          sql: buildObjectDataPreviewSql(tab.object),
        },
      });
      statusMessage.value = `Loaded data preview: ${tab.object.schema}.${tab.object.objectName}`;
    } catch (error) {
      errorMessage.value = toErrorMessage(error);
    } finally {
      tab.loadingData = false;
    }
  }

  async function loadObjectMetadata(tab: WorkspaceDdlTab, forceReload = false): Promise<void> {
    if (!session.value || tab.loadingMetadata) {
      return;
    }

    if (!forceReload && tab.metadataResult) {
      return;
    }

    errorMessage.value = "";
    tab.loadingMetadata = true;

    try {
      tab.metadataResult = await invoke<OracleQueryResult>("db_run_query", {
        request: {
          sessionId: session.value.sessionId,
          sql: buildObjectMetadataSql(tab.object),
        },
      });
      statusMessage.value = `Loaded metadata: ${tab.object.schema}.${tab.object.objectName}`;
    } catch (error) {
      errorMessage.value = toErrorMessage(error);
    } finally {
      tab.loadingMetadata = false;
    }
  }

  async function updateActiveObjectDataRow(rowIndex: number, values: string[]): Promise<boolean> {
    const tab = activeDdlTab.value;
    if (!session.value || !tab || tab.activeDetailTabId !== "data" || !isTableObject(tab.object.objectType)) {
      return false;
    }

    if (busy.updatingData) {
      return false;
    }

    if (!tab.dataResult) {
      errorMessage.value = "No table data is loaded. Refresh the Data tab and try again.";
      return false;
    }

    if (!hasObjectDataRowIdColumn(tab.dataResult)) {
      errorMessage.value = "Row editing is not ready yet. Refresh the Data tab and try again.";
      return false;
    }

    const row = tab.dataResult.rows[rowIndex];
    if (!row) {
      errorMessage.value = "Unable to save row: row no longer exists in the current result set.";
      return false;
    }

    const rowId = row[0];
    const editableColumns = tab.dataResult.columns.slice(1);
    if (!rowId || editableColumns.length !== values.length) {
      errorMessage.value = "Unable to save row: data preview shape changed. Refresh and try again.";
      return false;
    }

    const changedIndexes = values.reduce<number[]>((acc, value, index) => {
      if (row[index + 1] !== value) {
        acc.push(index);
      }
      return acc;
    }, []);

    if (!changedIndexes.length) {
      statusMessage.value = "No data changes to save.";
      return true;
    }

    const setClauses = changedIndexes
      .map((index) => `${toQuotedIdentifier(editableColumns[index])} = ${toSqlDataLiteral(values[index])}`)
      .join(", ");
    const sql = `update ${toQuotedIdentifier(tab.object.schema)}.${toQuotedIdentifier(tab.object.objectName)} set ${setClauses} where rowid = chartorowid(${toSqlStringLiteral(rowId)})`;

    errorMessage.value = "";
    busy.updatingData = true;

    try {
      const result = await invoke<OracleQueryResult>("db_run_query", {
        request: {
          sessionId: session.value.sessionId,
          sql,
          allowDestructive: true,
        },
      });

      for (const index of changedIndexes) {
        row[index + 1] = values[index];
      }

      statusMessage.value = `${tab.object.schema}.${tab.object.objectName}: ${result.message}`;
      return true;
    } catch (error) {
      errorMessage.value = toErrorMessage(error);
      return false;
    } finally {
      busy.updatingData = false;
    }
  }

  async function insertActiveObjectDataRow(values: string[]): Promise<boolean> {
    const tab = activeDdlTab.value;
    if (!session.value || !tab || tab.activeDetailTabId !== "data" || !isTableObject(tab.object.objectType)) {
      return false;
    }

    if (busy.updatingData) {
      return false;
    }

    if (!tab.dataResult) {
      errorMessage.value = "No table data is loaded. Refresh the Data tab and try again.";
      return false;
    }

    if (!hasObjectDataRowIdColumn(tab.dataResult)) {
      errorMessage.value = "Row editing is not ready yet. Refresh the Data tab and try again.";
      return false;
    }

    const editableColumns = tab.dataResult.columns.slice(1);
    if (editableColumns.length !== values.length) {
      errorMessage.value = "Unable to insert row: data preview shape changed. Refresh and try again.";
      return false;
    }

    const providedIndexes = values.reduce<number[]>((acc, value, index) => {
      if (value !== "") {
        acc.push(index);
      }
      return acc;
    }, []);

    if (!providedIndexes.length) {
      errorMessage.value = "Enter at least one column value before committing a new row.";
      return false;
    }

    const columnsSql = providedIndexes.map((index) => toQuotedIdentifier(editableColumns[index])).join(", ");
    const valuesSql = providedIndexes.map((index) => toSqlDataLiteral(values[index])).join(", ");
    const sql = `insert into ${toQuotedIdentifier(tab.object.schema)}.${toQuotedIdentifier(tab.object.objectName)} (${columnsSql}) values (${valuesSql})`;

    errorMessage.value = "";
    busy.updatingData = true;

    try {
      const result = await invoke<OracleQueryResult>("db_run_query", {
        request: {
          sessionId: session.value.sessionId,
          sql,
          allowDestructive: true,
        },
      });

      statusMessage.value = `${tab.object.schema}.${tab.object.objectName}: ${result.message}`;
      return true;
    } catch (error) {
      errorMessage.value = toErrorMessage(error);
      return false;
    } finally {
      busy.updatingData = false;
    }
  }

  function startSchemaExport(): boolean {
    if (!session.value) {
      errorMessage.value = "Connect to a database before exporting schema.";
      return false;
    }

    selectedExportSessionId.value = session.value.sessionId;
    exportDestinationDirectory.value = "";
    errorMessage.value = "";
    return true;
  }

  async function chooseSchemaExportDirectory(): Promise<string | null> {
    try {
      const selectedDirectory = await invoke<string | null>("db_pick_directory");
      if (selectedDirectory) {
        exportDestinationDirectory.value = selectedDirectory;
      }
      return selectedDirectory;
    } catch (error) {
      errorMessage.value = toErrorMessage(error);
      return null;
    }
  }

  async function exportDatabaseSchema(): Promise<SchemaExportResult | null> {
    if (!session.value) {
      errorMessage.value = "Connect to a database before exporting schema.";
      return null;
    }

    const destinationDirectory = exportDestinationDirectory.value.trim();
    if (!destinationDirectory) {
      errorMessage.value = "Choose a destination directory for schema export.";
      return null;
    }

    const targetSessionId = selectedExportSessionId.value ?? session.value.sessionId;
    if (!schemaExportTargets.value.some((target) => target.sessionId === targetSessionId)) {
      errorMessage.value = "Selected export target is no longer available.";
      return null;
    }

    errorMessage.value = "";
    busy.exportingSchema = true;

    try {
      await yieldUiFrame();
      const result = await invoke<SchemaExportResult>("db_export_schema", {
        request: {
          sessionId: targetSessionId,
          destinationDirectory,
        },
      });
      statusMessage.value = result.message;
      return result;
    } catch (error) {
      errorMessage.value = toErrorMessage(error);
      return null;
    } finally {
      busy.exportingSchema = false;
    }
  }

  async function loadConnectionProfiles(): Promise<void> {
    busy.loadingProfiles = true;
    try {
      connectionProfiles.value = await invoke<ConnectionProfile[]>("db_list_connection_profiles");
      if (
        selectedProfileId.value &&
        !connectionProfiles.value.some((profile) => profile.id === selectedProfileId.value)
      ) {
        selectedProfileId.value = "";
      }
      syncSelectedProfileUi();
    } catch (error) {
      errorMessage.value = toErrorMessage(error);
    } finally {
      busy.loadingProfiles = false;
    }
  }

  function syncSelectedProfileUi(): void {
    if (!selectedProfile.value) {
      return;
    }

    profileName.value = selectedProfile.value.name;
    saveProfilePassword.value = selectedProfile.value.hasPassword;
  }

  async function applySelectedProfile(): Promise<void> {
    if (!selectedProfile.value) {
      return;
    }

    const profile = selectedProfile.value;
    errorMessage.value = "";
    connection.provider = profile.provider;
    connection.host = profile.host;
    connection.port = profile.port;
    connection.serviceName = profile.serviceName;
    connection.username = profile.username;
    connection.schema = profile.schema;
    connection.password = "";
    syncSelectedProfileUi();

    if (!profile.hasPassword) {
      statusMessage.value = `Loaded profile: ${profile.name}`;
      return;
    }

    busy.loadingProfileSecret = true;
    try {
      const password = await invoke<string | null>("db_get_connection_profile_secret", {
        request: { profileId: profile.id },
      });
      connection.password = password ?? "";
      statusMessage.value = `Loaded profile: ${profile.name}`;
    } catch (error) {
      errorMessage.value = toErrorMessage(error);
    } finally {
      busy.loadingProfileSecret = false;
    }
  }

  async function saveConnectionProfile(): Promise<void> {
    const normalizedName = profileName.value.trim();
    if (!normalizedName) {
      errorMessage.value = "Profile name is required.";
      return;
    }

    errorMessage.value = "";
    busy.savingProfile = true;

    try {
      const savedProfile = await invoke<ConnectionProfile>("db_save_connection_profile", {
        request: {
          id: selectedProfileId.value || null,
          name: normalizedName,
          provider: connection.provider,
          host: connection.host,
          port: connection.port,
          serviceName: connection.serviceName,
          username: connection.username,
          schema: connection.schema,
          savePassword: saveProfilePassword.value,
          password: saveProfilePassword.value ? connection.password : null,
        },
      });

      await loadConnectionProfiles();
      selectedProfileId.value = savedProfile.id;
      profileName.value = savedProfile.name;
      statusMessage.value = `Saved profile: ${savedProfile.name}`;
    } catch (error) {
      errorMessage.value = toErrorMessage(error);
    } finally {
      busy.savingProfile = false;
    }
  }

  async function deleteSelectedProfile(): Promise<void> {
    if (!selectedProfile.value) {
      return;
    }

    const profile = selectedProfile.value;
    const shouldDelete = window.confirm(`Delete profile "${profile.name}"?`);
    if (!shouldDelete) {
      return;
    }

    errorMessage.value = "";
    busy.deletingProfile = true;

    try {
      await invoke("db_delete_connection_profile", {
        request: { profileId: profile.id },
      });
      selectedProfileId.value = "";
      profileName.value = "";
      await loadConnectionProfiles();
      statusMessage.value = `Deleted profile: ${profile.name}`;
    } catch (error) {
      errorMessage.value = toErrorMessage(error);
    } finally {
      busy.deletingProfile = false;
    }
  }

  async function refreshObjects(): Promise<void> {
    if (!session.value) {
      return;
    }

    errorMessage.value = "";
    busy.loadingObjects = true;

    try {
      const result = await invoke<OracleObjectEntry[]>("db_list_objects", {
        request: { sessionId: session.value.sessionId },
      });
      objects.value = result;
    } catch (error) {
      errorMessage.value = toErrorMessage(error);
    } finally {
      busy.loadingObjects = false;
    }
  }

  async function connectOracle(oracleClientLibDirOverride?: string): Promise<void> {
    errorMessage.value = "";
    busy.connecting = true;

    try {
      const oracleClientLibDir = oracleClientLibDirOverride?.trim();
      const connectRequest: OracleConnectRequest = {
        ...connection,
        ...(oracleClientLibDir ? { oracleClientLibDir } : {}),
      };
      const summary = await invoke<OracleSessionSummary>("db_connect", {
        request: connectRequest,
      });

      session.value = summary;
      selectedExportSessionId.value = summary.sessionId;
      const targetQueryTab = activeQueryTab.value ?? queryTabs.value[0];
      if (targetQueryTab) {
        targetQueryTab.queryText = buildDefaultSchemaQuery(summary.schema);
      }
      statusMessage.value = `Connected: ${summary.displayName}`;
      await refreshObjects();
    } catch (error) {
      errorMessage.value = toErrorMessage(error);
      statusMessage.value = "Connection failed.";
    } finally {
      busy.connecting = false;
    }
  }

  async function disconnectOracle(): Promise<void> {
    if (!session.value) {
      return;
    }

    errorMessage.value = "";

    try {
      await invoke("db_disconnect", {
        request: { sessionId: session.value.sessionId },
      });
    } catch (error) {
      errorMessage.value = toErrorMessage(error);
    } finally {
      session.value = null;
      objects.value = [];
      expandedObjectTypes.value = {};
      queryTabs.value = [
        createQueryTab(1, connection.schema),
      ];
      queryTabNumber.value = 2;
      ddlTabs.value = [];
      activeWorkspaceTabId.value = FIRST_QUERY_TAB_ID;
      selectedObject.value = null;
      schemaSearchText.value = "";
      exportDestinationDirectory.value = "";
      selectedExportSessionId.value = null;
      schemaSearchResults.value = [];
      schemaSearchPerformed.value = false;
      schemaSearchFocusToken.value = 0;
      statusMessage.value = "Disconnected.";
    }
  }

  async function loadDdl(object: OracleObjectEntry, targetLine: number | null = null): Promise<void> {
    if (!session.value) {
      return;
    }

    errorMessage.value = "";
    busy.loadingDdl = true;
    selectedObject.value = object;

    try {
      const ddl = await invoke<string>("db_get_object_ddl", {
        request: {
          sessionId: session.value.sessionId,
          schema: object.schema,
          objectType: object.objectType,
          objectName: object.objectName,
        },
      });

      const tabId = buildDdlTabId(object);
      const detailTabId = targetLine === null ? getDefaultObjectDetailTabId(object) : "ddl";
      const existingTab = ddlTabs.value.find((tab) => tab.id === tabId);
      if (existingTab) {
        existingTab.ddlText = ddl;
        existingTab.object = object;
        existingTab.focusLine = targetLine;
        existingTab.focusToken += targetLine === null ? 0 : 1;
        existingTab.activeDetailTabId = isObjectDetailTabSupported(existingTab.object, existingTab.activeDetailTabId)
          ? existingTab.activeDetailTabId
          : detailTabId;
        if (targetLine !== null) {
          existingTab.activeDetailTabId = "ddl";
        }
      } else {
        ddlTabs.value.push({
          id: tabId,
          object,
          ddlText: ddl,
          focusLine: targetLine,
          focusToken: targetLine === null ? 0 : 1,
          activeDetailTabId: detailTabId,
          dataResult: null,
          metadataResult: null,
          loadingData: false,
          loadingMetadata: false,
        });
      }

      activateWorkspaceTab(tabId);
      const objectTab = ddlTabs.value.find((tab) => tab.id === tabId);
      if (objectTab) {
        void ensureObjectDetailLoaded(objectTab, objectTab.activeDetailTabId);
      }
      statusMessage.value = `Loaded DDL: ${object.schema}.${object.objectName}`;
    } catch (error) {
      errorMessage.value = toErrorMessage(error);
    } finally {
      busy.loadingDdl = false;
    }
  }

  async function saveDdl(): Promise<void> {
    if (!session.value || !activeDdlTab.value) {
      return;
    }

    errorMessage.value = "";
    busy.savingDdl = true;

    try {
      const object = activeDdlTab.value.object;
      const message = await invoke<string>("db_update_object_ddl", {
        request: {
          sessionId: session.value.sessionId,
          schema: object.schema,
          objectType: object.objectType,
          objectName: object.objectName,
          ddl: activeDdlTab.value.ddlText,
        },
      });

      statusMessage.value = `${object.objectName}: ${message}`;
    } catch (error) {
      errorMessage.value = toErrorMessage(error);
    } finally {
      busy.savingDdl = false;
    }
  }

  async function runQuery(): Promise<void> {
    if (!session.value || !activeQueryTab.value) {
      return;
    }

    const queryTab = activeQueryTab.value;
    const effectiveRowLimit = clampQueryRowLimit(queryRowLimit.value);
    if (effectiveRowLimit !== queryRowLimit.value) {
      queryRowLimit.value = effectiveRowLimit;
    }

    const statements = splitQueryTextForExecution(queryTab.queryText);
    if (!statements.length) {
      errorMessage.value = "Query cannot be empty.";
      return;
    }

    const preflight = collectExecutionPreflight(statements);
    let allowDestructive = false;
    if (preflight.shouldConfirm) {
      const shouldContinue = window.confirm(buildMutatingQueryPrompt(preflight.reasons));
      if (!shouldContinue) {
        statusMessage.value = "Execution cancelled.";
        return;
      }

      allowDestructive = true;
    }

    prepareQueryResultPanes(queryTab, statements.length);
    errorMessage.value = "";
    busy.runningQuery = true;
    let completedStatements = 0;

    try {
      for (let index = 0; index < statements.length; index += 1) {
        const result = await invoke<OracleQueryResult>("db_run_query", {
          request: {
            sessionId: session.value.sessionId,
            sql: statements[index],
            rowLimit: effectiveRowLimit,
            allowDestructive,
          },
        });

        const pane = queryTab.resultPanes[index];
        if (pane) {
          pane.queryResult = result;
          pane.errorMessage = "";
        }
        completedStatements += 1;

        if (statements.length === 1) {
          statusMessage.value = result.message;
        }
      }

      if (statements.length > 1) {
        statusMessage.value = `Executed ${statements.length} statements.`;
      }
    } catch (error) {
      const message = toErrorMessage(error);
      const failedPane = queryTab.resultPanes[completedStatements];
      if (failedPane) {
        failedPane.errorMessage = message;
        queryTab.activeResultPaneId = failedPane.id;
      }
      errorMessage.value = message;
      if (statements.length > 1) {
        statusMessage.value = `Execution stopped at statement ${completedStatements + 1} of ${statements.length}.`;
      }
    } finally {
      busy.runningQuery = false;
    }
  }

  async function runSchemaSearch(): Promise<void> {
    if (!session.value) {
      return;
    }

    const searchTerm = schemaSearchText.value.trim();
    if (!searchTerm) {
      errorMessage.value = "Search term is required.";
      return;
    }
    if (!schemaSearchIncludeObjectNames.value && !schemaSearchIncludeSource.value && !schemaSearchIncludeDdl.value) {
      errorMessage.value = "Select at least one search scope.";
      return;
    }

    errorMessage.value = "";
    busy.searchingSchema = true;
    schemaSearchPerformed.value = true;

    try {
      schemaSearchResults.value = await invoke<OracleSchemaSearchResult[]>("db_search_schema_text", {
        request: {
          sessionId: session.value.sessionId,
          searchTerm,
          limit: 500,
          includeObjectNames: schemaSearchIncludeObjectNames.value,
          includeSource: schemaSearchIncludeSource.value,
          includeDdl: schemaSearchIncludeDdl.value,
        },
      });
      statusMessage.value = `Search complete. ${schemaSearchResults.value.length} match(es).`;
    } catch (error) {
      errorMessage.value = toErrorMessage(error);
    } finally {
      busy.searchingSchema = false;
    }
  }

  async function openSchemaSearchResult(match: OracleSchemaSearchResult): Promise<void> {
    await loadDdl(
      {
        schema: match.schema,
        objectType: match.objectType,
        objectName: match.objectName,
      },
      match.line ?? null,
    );
  }

  return {
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
    activeQueryResultPanes,
    activeQueryResultPaneId,
    activeQueryResultPane,
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
  };
}
