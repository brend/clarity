import { computed, reactive, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import {
  buildCreateObjectTemplate,
  normalizeCreateObjectName,
  normalizeCreateObjectType,
} from "../constants/createObjectTemplates";
import type {
  BusyState,
  ConnectionProfile,
  DbTransactionState,
  ObjectDetailTabDefinition,
  ObjectDetailTabId,
  DbObjectColumnEntry,
  DbObjectEntry,
  DbQueryResult,
  DbSchemaSearchResult,
  DbSessionSummary,
  OracleConnectionProfile,
  OracleDbConnectRequest,
  SaveConnectionProfileRequest,
  SchemaExportResult,
  SchemaExportTarget,
  WorkspaceDdlTab,
  WorkspaceQueryResultPane,
  WorkspaceQueryTab,
} from "../types/clarity";

const QUERY_TAB_PREFIX = "query:";
const FIRST_QUERY_TAB_ID = `${QUERY_TAB_PREFIX}1`;
const SEARCH_TAB_ID = "search:code";
const QUERY_SHEETS_STORAGE_KEY = "clarity.query-sheets.v1";
const OBJECT_DATA_PREVIEW_LIMIT = 500;
const OBJECT_DATA_ROW_ID_COLUMN = "__CLARITY_ROWID__";
const DEFAULT_QUERY_ROW_LIMIT = 1000;
const MAX_QUERY_ROW_LIMIT = 10000;
const SCRIPT_LINE_HISTORY_LIMIT = 200;
const NON_STANDALONE_SQL_KEYWORDS = new Set([
  "END",
  "EXCEPTION",
  "WHEN",
  "ELSE",
  "ELSIF",
  "LOOP",
  "THEN",
]);

interface PersistedQuerySheet {
  id: string;
  title: string;
  queryText: string;
}

interface PersistedQuerySheetState {
  queryTabs: PersistedQuerySheet[];
  activeWorkspaceTabId: string;
  queryTabNumber: number;
}

interface ScriptLineLocation {
  object: DbObjectEntry;
  line: number | null;
}

function readDebugConnectionString(
  value: string | undefined,
  fallback: string,
): string {
  if (!import.meta.env.DEV) {
    return fallback;
  }

  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : fallback;
}

function readDebugConnectionPort(
  value: string | undefined,
  fallback: number,
): number {
  if (!import.meta.env.DEV) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535
    ? parsed
    : fallback;
}

function readDebugPositiveInteger(
  value: string | undefined,
  fallback: number,
): number {
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

function extractLeadingSqlKeyword(sql: string): string | null {
  const normalized = sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ")
    .trimStart()
    .toUpperCase();
  const match = normalized.match(/^[A-Z]+/);
  return match ? match[0] : null;
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

function createQueryResultPane(
  tabId: string,
  paneNumber: number,
): WorkspaceQueryResultPane {
  return {
    id: buildQueryResultPaneId(tabId, paneNumber),
    title: `Result ${paneNumber}`,
    queryResult: null,
    errorMessage: "",
    sourceSql: null,
    sourceSessionId: null,
    sourceRowLimit: null,
  };
}

function createDdlResultPane(tabId: string): WorkspaceQueryResultPane {
  return {
    id: `${tabId}:save-result`,
    title: "Save Result",
    queryResult: null,
    errorMessage: "",
    sourceSql: null,
    sourceSessionId: null,
    sourceRowLimit: null,
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

function createQueryTabFromPersisted(
  state: PersistedQuerySheet,
): WorkspaceQueryTab {
  const firstResultPane = createQueryResultPane(state.id, 1);
  return {
    id: state.id,
    title: state.title,
    queryText: state.queryText,
    resultPanes: [firstResultPane],
    activeResultPaneId: firstResultPane.id,
    nextResultPaneNumber: 2,
  };
}

function parseQueryTabNumber(tabId: string): number | null {
  const match = /^query:(\d+)$/.exec(tabId.trim());
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}

function createDefaultPersistedQuerySheetState(
  schema: string,
): PersistedQuerySheetState {
  const firstTab = createQueryTab(1, schema);
  return {
    queryTabs: [
      {
        id: firstTab.id,
        title: firstTab.title,
        queryText: firstTab.queryText,
      },
    ],
    activeWorkspaceTabId: firstTab.id,
    queryTabNumber: 2,
  };
}

function normalizePersistedQuerySheetState(
  value: unknown,
  schema: string,
): PersistedQuerySheetState {
  const fallback = createDefaultPersistedQuerySheetState(schema);
  if (typeof value !== "object" || value === null) {
    return fallback;
  }

  const raw = value as Partial<PersistedQuerySheetState> & {
    queryTabs?: unknown;
  };
  if (!Array.isArray(raw.queryTabs)) {
    return fallback;
  }

  const queryTabs: PersistedQuerySheet[] = [];
  const seenIds = new Set<string>();
  let maxTabNumber = 0;

  for (const entry of raw.queryTabs) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }

    const rawTab = entry as Partial<PersistedQuerySheet>;
    const id = typeof rawTab.id === "string" ? rawTab.id.trim() : "";
    const tabNumber = parseQueryTabNumber(id);
    if (!id || tabNumber === null || seenIds.has(id)) {
      continue;
    }

    seenIds.add(id);
    maxTabNumber = Math.max(maxTabNumber, tabNumber);
    queryTabs.push({
      id,
      title:
        typeof rawTab.title === "string" && rawTab.title.trim().length > 0
          ? rawTab.title.trim()
          : `Query ${tabNumber}`,
      queryText: typeof rawTab.queryText === "string" ? rawTab.queryText : "",
    });
  }

  if (!queryTabs.length) {
    return fallback;
  }

  const requestedActiveId =
    typeof raw.activeWorkspaceTabId === "string"
      ? raw.activeWorkspaceTabId.trim()
      : "";
  const activeWorkspaceTabId = queryTabs.some(
    (tab) => tab.id === requestedActiveId,
  )
    ? requestedActiveId
    : queryTabs[0].id;
  const requestedNextTabNumber =
    typeof raw.queryTabNumber === "number" ? Math.trunc(raw.queryTabNumber) : 0;
  const queryTabNumber =
    Number.isFinite(requestedNextTabNumber) &&
    requestedNextTabNumber > maxTabNumber
      ? requestedNextTabNumber
      : maxTabNumber + 1;

  return {
    queryTabs,
    activeWorkspaceTabId,
    queryTabNumber,
  };
}

function readStoredQuerySheetState(schema: string): PersistedQuerySheetState {
  if (typeof window === "undefined") {
    return createDefaultPersistedQuerySheetState(schema);
  }

  try {
    const serialized = window.localStorage.getItem(QUERY_SHEETS_STORAGE_KEY);
    if (!serialized) {
      return createDefaultPersistedQuerySheetState(schema);
    }

    return normalizePersistedQuerySheetState(JSON.parse(serialized), schema);
  } catch {
    return createDefaultPersistedQuerySheetState(schema);
  }
}

function writeStoredQuerySheetState(state: PersistedQuerySheetState): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      QUERY_SHEETS_STORAGE_KEY,
      JSON.stringify(state),
    );
  } catch {
    // Ignore persistence errors; query tabs remain active for this session.
  }
}

export function useClarityWorkspace() {
  const connection = reactive<OracleDbConnectRequest>({
    provider: "oracle",
    connection: {
      host: readDebugConnectionString(
        import.meta.env.VITE_ORACLE_HOST,
        "localhost",
      ),
      port: readDebugConnectionPort(import.meta.env.VITE_ORACLE_PORT, 1521),
      serviceName: readDebugConnectionString(
        import.meta.env.VITE_ORACLE_SERVICE_NAME,
        "XEPDB1",
      ),
      username: readDebugConnectionString(
        import.meta.env.VITE_ORACLE_USERNAME,
        "hr",
      ),
      password: import.meta.env.DEV
        ? (import.meta.env.VITE_ORACLE_PASSWORD ?? "")
        : "",
      schema: readDebugConnectionString(import.meta.env.VITE_ORACLE_SCHEMA, "HR"),
      oracleAuthMode: "normal",
    },
  });
  const profileName = ref("");
  const selectedProfileId = ref("");
  const saveProfilePassword = ref(true);
  const initialQuerySheetState = readStoredQuerySheetState(
    connection.connection.schema,
  );

  const session = ref<DbSessionSummary | null>(null);
  const connectionProfiles = ref<ConnectionProfile[]>([]);
  const objects = ref<DbObjectEntry[]>([]);
  const objectColumns = ref<DbObjectColumnEntry[]>([]);
  const selectedObject = ref<DbObjectEntry | null>(null);
  const ddlTabs = ref<WorkspaceDdlTab[]>([]);
  const queryTabs = ref<WorkspaceQueryTab[]>(
    initialQuerySheetState.queryTabs.map((tab) =>
      createQueryTabFromPersisted(tab),
    ),
  );
  const queryTabNumber = ref(initialQuerySheetState.queryTabNumber);
  const schemaSearchText = ref("");
  const schemaSearchIncludeObjectNames = ref(true);
  const schemaSearchIncludeSource = ref(true);
  const schemaSearchIncludeDdl = ref(true);
  const schemaSearchFocusToken = ref(0);
  const exportDestinationDirectory = ref("");
  const selectedExportSessionId = ref<number | null>(null);
  const queryRowLimit = ref(
    clampQueryRowLimit(
      readDebugPositiveInteger(
        import.meta.env.VITE_QUERY_ROW_LIMIT,
        DEFAULT_QUERY_ROW_LIMIT,
      ),
    ),
  );
  const schemaSearchResults = ref<DbSchemaSearchResult[]>([]);
  const schemaSearchPerformed = ref(false);
  const transactionActive = ref(false);
  const statusMessage = ref("Ready. Connect to an Oracle session to begin.");
  const errorMessage = ref("");
  const activeWorkspaceTabId = ref(initialQuerySheetState.activeWorkspaceTabId);
  const expandedObjectTypes = ref<Record<string, boolean>>({});
  const scriptLineBackHistory = ref<ScriptLineLocation[]>([]);
  const scriptLineForwardHistory = ref<ScriptLineLocation[]>([]);
  const currentScriptLineLocation = ref<ScriptLineLocation | null>(null);

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
    managingTransaction: false,
    updatingData: false,
    exportingSchema: false,
    searchingSchema: false,
  });

  function syncBusyDdlState(): void {
    busy.loadingDdl = ddlTabs.value.some((tab) => tab.loadingDdl);
  }

  const isConnected = computed(() => session.value !== null);
  const connectedSchema = computed(
    () => session.value?.schema ?? connection.connection.schema.toUpperCase(),
  );
  const selectedProviderLabel = computed(() => {
    const provider = session.value?.provider ?? connection.provider;
    return provider.toUpperCase();
  });
  const selectedProfile = computed<OracleConnectionProfile | null>(() => {
    const profile = connectionProfiles.value.find(
      (candidate) => candidate.id === selectedProfileId.value,
    );
    if (!profile || profile.provider !== "oracle") {
      return null;
    }

    return profile;
  });
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
  const activeQueryTab = computed(
    () =>
      queryTabs.value.find((tab) => tab.id === activeWorkspaceTabId.value) ??
      null,
  );
  const activeDdlTab = computed(
    () =>
      ddlTabs.value.find((tab) => tab.id === activeWorkspaceTabId.value) ??
      null,
  );
  const isSearchTabActive = computed(
    () => activeWorkspaceTabId.value === SEARCH_TAB_ID,
  );
  const activeDdlObject = computed(() => activeDdlTab.value?.object ?? null);
  const isQueryTabActive = computed(() => activeQueryTab.value !== null);
  const activeQueryResultPanes = computed<WorkspaceQueryResultPane[]>(
    () => {
      if (activeQueryTab.value) {
        return activeQueryTab.value.resultPanes;
      }

      if (activeDdlTab.value?.saveResultPane) {
        return [activeDdlTab.value.saveResultPane];
      }

      return [];
    },
  );
  const activeQueryResultPaneId = computed<string | null>(() => {
    if (activeQueryTab.value) {
      return (
        activeQueryTab.value.activeResultPaneId ||
        activeQueryTab.value.resultPanes[0]?.id ||
        null
      );
    }

    return activeDdlTab.value?.saveResultPane?.id ?? null;
  });
  const activeQueryResultPane = computed<WorkspaceQueryResultPane | null>(
    () => {
      if (activeQueryTab.value) {
        const activePane = activeQueryTab.value.resultPanes.find(
          (pane) => pane.id === activeQueryResultPaneId.value,
        );
        return activePane ?? activeQueryTab.value.resultPanes[0] ?? null;
      }

      return activeDdlTab.value?.saveResultPane ?? null;
    },
  );
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
  const activeObjectDetailRawResult = computed<DbQueryResult | null>(() => {
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
  const activeObjectDetailResult = computed<DbQueryResult | null>(() => {
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
    if (
      !activeDdlTab.value ||
      activeDdlTab.value.activeDetailTabId !== "data"
    ) {
      return false;
    }

    if (
      !isTableObject(activeDdlTab.value.object.objectType) ||
      !activeDdlTab.value.dataResult
    ) {
      return false;
    }

    return hasObjectDataRowIdColumn(activeDdlTab.value.dataResult);
  });
  const activeObjectDetailLoading = computed<boolean>(() => {
    if (!activeDdlTab.value) {
      return false;
    }

    if (activeDdlTab.value.activeDetailTabId === "ddl") {
      return activeDdlTab.value.loadingDdl;
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
    const byType = new Map<string, DbObjectEntry[]>();

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
        entries: [...entries].sort((left, right) =>
          left.objectName.localeCompare(right.objectName),
        ),
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

  function getObjectDetailTabs(
    object: DbObjectEntry,
  ): ObjectDetailTabDefinition[] {
    const tabs: ObjectDetailTabDefinition[] = [];
    if (canPreviewObjectData(object.objectType)) {
      tabs.push({ id: "data", label: "Data" });
    }
    tabs.push({ id: "ddl", label: "DDL" });
    tabs.push({ id: "metadata", label: "Metadata" });
    return tabs;
  }

  function getDefaultObjectDetailTabId(
    object: DbObjectEntry,
  ): ObjectDetailTabId {
    return canPreviewObjectData(object.objectType) ? "data" : "ddl";
  }

  function isObjectDetailTabSupported(
    object: DbObjectEntry,
    tabId: ObjectDetailTabId,
  ): boolean {
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

  function hasObjectDataRowIdColumn(result: DbQueryResult): boolean {
    const firstColumn = (result.columns[0] ?? "")
      .replace(/"/g, "")
      .trim()
      .toUpperCase();
    const expected = OBJECT_DATA_ROW_ID_COLUMN.toUpperCase();
    return firstColumn === expected || firstColumn === "ROWID";
  }

  function buildObjectDataPreviewSql(object: DbObjectEntry): string {
    const owner = `${toQuotedIdentifier(object.schema)}.${toQuotedIdentifier(object.objectName)}`;
    if (!isTableObject(object.objectType)) {
      return `select * from ${owner} fetch first ${OBJECT_DATA_PREVIEW_LIMIT} rows only`;
    }

    return `select rowidtochar(t.rowid) as ${toQuotedIdentifier(OBJECT_DATA_ROW_ID_COLUMN)}, t.* from ${owner} t fetch first ${OBJECT_DATA_PREVIEW_LIMIT} rows only`;
  }

  function buildObjectMetadataSql(object: DbObjectEntry): string {
    const owner = toSqlStringLiteral(object.schema.trim());
    const objectName = toSqlStringLiteral(object.objectName.trim());
    const objectType = toSqlStringLiteral(object.objectType.trim());
    if (canPreviewObjectData(object.objectType)) {
      return `select column_id, column_name, data_type, data_length, data_precision, data_scale, nullable, data_default from all_tab_columns where owner = ${owner} and table_name = ${objectName} order by column_id`;
    }

    return `select owner, object_name, object_type, status, created, last_ddl_time from all_objects where owner = ${owner} and object_name = ${objectName} and object_type = ${objectType}`;
  }

  function buildDdlTabId(object: DbObjectEntry): string {
    return `ddl:${object.schema}:${object.objectType}:${object.objectName}`;
  }

  function createWorkspaceDdlTab(
    object: DbObjectEntry,
    {
      focusLine = null,
      activeDetailTabId = null,
      loadingDdl = false,
    }: {
      focusLine?: number | null;
      activeDetailTabId?: ObjectDetailTabId | null;
      loadingDdl?: boolean;
    } = {},
  ): WorkspaceDdlTab {
    const normalizedFocusLine = normalizeLineReference(focusLine);
    const resolvedDetailTabId =
      activeDetailTabId ?? getDefaultObjectDetailTabId(object);

    return {
      id: buildDdlTabId(object),
      object,
      ddlText: "",
      focusLine: normalizedFocusLine,
      focusToken: 0,
      activeDetailTabId: resolvedDetailTabId,
      dataResult: null,
      metadataResult: null,
      saveResultPane: null,
      loadingDdl,
      loadingData: false,
      loadingMetadata: false,
    };
  }

  function normalizeLineReference(value: number | null): number | null {
    if (value === null || !Number.isFinite(value)) {
      return null;
    }

    return Math.max(1, Math.trunc(value));
  }

  function cloneObjectRef(object: DbObjectEntry): DbObjectEntry {
    return {
      schema: object.schema,
      objectType: object.objectType,
      objectName: object.objectName,
      status: object.status ?? null,
      invalidReason: object.invalidReason ?? null,
    };
  }

  function buildObjectIdentityKey(object: DbObjectEntry): string {
    return `${object.schema}\u0000${object.objectType}\u0000${object.objectName}`;
  }

  function syncObjectReferences(nextObjects: DbObjectEntry[]): void {
    const objectsByKey = new Map(
      nextObjects.map((object) => [buildObjectIdentityKey(object), object]),
    );

    if (selectedObject.value) {
      const refreshedSelectedObject = objectsByKey.get(
        buildObjectIdentityKey(selectedObject.value),
      );
      if (refreshedSelectedObject) {
        selectedObject.value = refreshedSelectedObject;
      }
    }

    ddlTabs.value = ddlTabs.value.map((tab) => {
      const refreshedObject = objectsByKey.get(buildObjectIdentityKey(tab.object));
      if (!refreshedObject) {
        return tab;
      }

      return {
        ...tab,
        object: refreshedObject,
      };
    });
  }

  function createScriptLineLocation(
    object: DbObjectEntry,
    line: number | null,
  ): ScriptLineLocation {
    return {
      object: cloneObjectRef(object),
      line: normalizeLineReference(line),
    };
  }

  function isSameScriptLineLocation(
    left: ScriptLineLocation,
    right: ScriptLineLocation,
  ): boolean {
    return (
      left.object.schema === right.object.schema &&
      left.object.objectType === right.object.objectType &&
      left.object.objectName === right.object.objectName &&
      left.line === right.line
    );
  }

  function pushScriptLineHistoryEntry(
    history: { value: ScriptLineLocation[] },
    location: ScriptLineLocation,
  ): void {
    const previous = history.value[history.value.length - 1];
    if (previous && isSameScriptLineLocation(previous, location)) {
      return;
    }

    history.value = [...history.value, location].slice(
      -SCRIPT_LINE_HISTORY_LIMIT,
    );
  }

  function getActiveScriptLineLocation(): ScriptLineLocation | null {
    if (!activeDdlTab.value) {
      const current = currentScriptLineLocation.value;
      if (!current) {
        return null;
      }
      return createScriptLineLocation(current.object, current.line);
    }
    const activeLocation = createScriptLineLocation(
      activeDdlTab.value.object,
      activeDdlTab.value.focusLine,
    );
    currentScriptLineLocation.value = activeLocation;
    return activeLocation;
  }

  async function runQueryForSession(
    sessionId: number,
    sql: string,
    rowLimit?: number,
  ): Promise<DbQueryResult> {
    const result = await invoke<DbQueryResult>("db_run_query", {
      request: {
        sessionId,
        sql,
        rowLimit,
      },
    });
    await syncTransactionState(sessionId);
    return result;
  }

  async function syncTransactionState(sessionId: number): Promise<void> {
    try {
      const result = await invoke<DbTransactionState>("db_get_transaction_state", {
        request: { sessionId },
      });
      transactionActive.value = result.active;
    } catch {
      // Ignore follow-up state sync errors.
    }
  }

  function prepareQueryResultPanes(
    tab: WorkspaceQueryTab,
    statements: string[],
    sessionId: number,
    rowLimit: number,
  ): void {
    const paneCount = Math.max(1, statements.length);
    const panes = Array.from({ length: paneCount }, (_, index) => {
      const pane = createQueryResultPane(tab.id, index + 1);
      pane.sourceSql = statements[index] ?? null;
      pane.sourceSessionId = sessionId;
      pane.sourceRowLimit = rowLimit;
      return pane;
    });
    tab.resultPanes = panes;
    tab.activeResultPaneId = panes[0].id;
    tab.nextResultPaneNumber = paneCount + 1;
  }

  function addQueryTab(): void {
    const tabNumber = queryTabNumber.value;
    queryTabNumber.value += 1;

    const tab = createQueryTab(
      tabNumber,
      session.value?.schema ?? connection.connection.schema,
    );

    queryTabs.value.push(tab);
    activateWorkspaceTab(tab.id);
  }

  function openCreateObjectTemplate(
    objectType: string,
    objectName: string,
  ): boolean {
    const normalizedType = normalizeCreateObjectType(objectType);
    if (!normalizedType) {
      errorMessage.value = `Unsupported object type: ${objectType}`;
      return false;
    }

    const normalizedName = normalizeCreateObjectName(normalizedType, objectName);
    const schemaName =
      connectedSchema.value.trim().toUpperCase() ||
      connection.connection.schema.trim().toUpperCase() ||
      "APP";
    const template = buildCreateObjectTemplate({
      schema: schemaName,
      objectType: normalizedType,
      objectName: normalizedName,
    });

    addQueryTab();
    const tab = activeQueryTab.value;
    if (!tab) {
      errorMessage.value = "Unable to open query tab for object template.";
      return false;
    }

    tab.title = `Create ${normalizedType}: ${normalizedName}`;
    tab.queryText = template;
    errorMessage.value = "";
    statusMessage.value = `Prepared ${normalizedType} template for ${schemaName}.${normalizedName}`;
    return true;
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
      currentScriptLineLocation.value = createScriptLineLocation(
        tab.object,
        tab.focusLine,
      );
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
      const fallbackQueryTab =
        queryTabs.value[Math.max(0, index - 1)] ?? queryTabs.value[0];
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
      activateWorkspaceTab(
        fallbackTab?.id ?? queryTabs.value[0]?.id ?? FIRST_QUERY_TAB_ID,
      );
    }
  }

  function openObjectFromExplorer(object: DbObjectEntry): void {
    selectedObject.value = object;
    const tabId = buildDdlTabId(object);
    const existingTab = ddlTabs.value.find((tab) => tab.id === tabId);
    if (existingTab) {
      existingTab.object = object;
      if (
        !isObjectDetailTabSupported(
          existingTab.object,
          existingTab.activeDetailTabId,
        )
      ) {
        existingTab.activeDetailTabId = getDefaultObjectDetailTabId(
          existingTab.object,
        );
      }
      activateWorkspaceTab(existingTab.id);
      return;
    }

    const detailTabId = getDefaultObjectDetailTabId(object);
    const nextTab = createWorkspaceDdlTab(object, {
      activeDetailTabId: detailTabId,
      loadingDdl: true,
    });
    ddlTabs.value.push(nextTab);
    syncBusyDdlState();
    statusMessage.value = `Opening ${object.schema}.${object.objectName}...`;
    activateWorkspaceTab(nextTab.id);
    void loadDdl(object);
  }

  function activateObjectDetailTab(tabId: ObjectDetailTabId): void {
    const tab = activeDdlTab.value;
    if (
      !tab ||
      tab.activeDetailTabId === tabId ||
      !isObjectDetailTabSupported(tab.object, tabId)
    ) {
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

  async function ensureObjectDetailLoaded(
    tab: WorkspaceDdlTab,
    detailTabId: ObjectDetailTabId,
  ): Promise<void> {
    if (detailTabId === "data") {
      await loadObjectData(tab);
      return;
    }

    if (detailTabId === "metadata") {
      await loadObjectMetadata(tab);
    }
  }

  async function loadObjectData(
    tab: WorkspaceDdlTab,
    forceReload = false,
  ): Promise<void> {
    if (
      !session.value ||
      !canPreviewObjectData(tab.object.objectType) ||
      tab.loadingData
    ) {
      return;
    }

    const cachedDataNeedsRowIdUpgrade =
      isTableObject(tab.object.objectType) &&
      !!tab.dataResult &&
      !hasObjectDataRowIdColumn(tab.dataResult);
    if (!forceReload && tab.dataResult && !cachedDataNeedsRowIdUpgrade) {
      return;
    }

    errorMessage.value = "";
    tab.loadingData = true;

    try {
      tab.dataResult = await invoke<DbQueryResult>("db_run_query", {
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

  async function loadObjectMetadata(
    tab: WorkspaceDdlTab,
    forceReload = false,
  ): Promise<void> {
    if (!session.value || tab.loadingMetadata) {
      return;
    }

    if (!forceReload && tab.metadataResult) {
      return;
    }

    errorMessage.value = "";
    tab.loadingMetadata = true;

    try {
      tab.metadataResult = await invoke<DbQueryResult>("db_run_query", {
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

  async function updateActiveObjectDataRow(
    rowIndex: number,
    values: string[],
  ): Promise<boolean> {
    const tab = activeDdlTab.value;
    if (
      !session.value ||
      !tab ||
      tab.activeDetailTabId !== "data" ||
      !isTableObject(tab.object.objectType)
    ) {
      return false;
    }
    const sessionId = session.value.sessionId;

    if (busy.updatingData) {
      return false;
    }

    if (!tab.dataResult) {
      errorMessage.value =
        "No table data is loaded. Refresh the Data tab and try again.";
      return false;
    }

    if (!hasObjectDataRowIdColumn(tab.dataResult)) {
      errorMessage.value =
        "Row editing is not ready yet. Refresh the Data tab and try again.";
      return false;
    }

    const row = tab.dataResult.rows[rowIndex];
    if (!row) {
      errorMessage.value =
        "Unable to save row: row no longer exists in the current result set.";
      return false;
    }

    const rowId = row[0];
    const editableColumns = tab.dataResult.columns.slice(1);
    if (!rowId || editableColumns.length !== values.length) {
      errorMessage.value =
        "Unable to save row: data preview shape changed. Refresh and try again.";
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
      .map(
        (index) =>
          `${toQuotedIdentifier(editableColumns[index])} = ${toSqlDataLiteral(values[index])}`,
      )
      .join(", ");
    const sql = `update ${toQuotedIdentifier(tab.object.schema)}.${toQuotedIdentifier(tab.object.objectName)} set ${setClauses} where rowidtochar(rowid) = ${toSqlStringLiteral(rowId)}`;

    errorMessage.value = "";
    busy.updatingData = true;

    try {
      const result = await runQueryForSession(sessionId, sql);

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
    if (
      !session.value ||
      !tab ||
      tab.activeDetailTabId !== "data" ||
      !isTableObject(tab.object.objectType)
    ) {
      return false;
    }
    const sessionId = session.value.sessionId;

    if (busy.updatingData) {
      return false;
    }

    if (!tab.dataResult) {
      errorMessage.value =
        "No table data is loaded. Refresh the Data tab and try again.";
      return false;
    }

    if (!hasObjectDataRowIdColumn(tab.dataResult)) {
      errorMessage.value =
        "Row editing is not ready yet. Refresh the Data tab and try again.";
      return false;
    }

    const editableColumns = tab.dataResult.columns.slice(1);
    if (editableColumns.length !== values.length) {
      errorMessage.value =
        "Unable to insert row: data preview shape changed. Refresh and try again.";
      return false;
    }

    const providedIndexes = values.reduce<number[]>((acc, value, index) => {
      if (value !== "") {
        acc.push(index);
      }
      return acc;
    }, []);

    if (!providedIndexes.length) {
      errorMessage.value =
        "Enter at least one column value before committing a new row.";
      return false;
    }

    const columnsSql = providedIndexes
      .map((index) => toQuotedIdentifier(editableColumns[index]))
      .join(", ");
    const valuesSql = providedIndexes
      .map((index) => toSqlDataLiteral(values[index]))
      .join(", ");
    const sql = `insert into ${toQuotedIdentifier(tab.object.schema)}.${toQuotedIdentifier(tab.object.objectName)} (${columnsSql}) values (${valuesSql})`;

    errorMessage.value = "";
    busy.updatingData = true;

    try {
      const result = await runQueryForSession(sessionId, sql);

      statusMessage.value = `${tab.object.schema}.${tab.object.objectName}: ${result.message}`;
      return true;
    } catch (error) {
      errorMessage.value = toErrorMessage(error);
      return false;
    } finally {
      busy.updatingData = false;
    }
  }

  async function deleteActiveObjectDataRow(rowIndex: number): Promise<boolean> {
    const tab = activeDdlTab.value;
    if (
      !session.value ||
      !tab ||
      tab.activeDetailTabId !== "data" ||
      !isTableObject(tab.object.objectType)
    ) {
      return false;
    }
    const sessionId = session.value.sessionId;

    if (busy.updatingData) {
      return false;
    }

    if (!tab.dataResult) {
      errorMessage.value =
        "No table data is loaded. Refresh the Data tab and try again.";
      return false;
    }

    if (!hasObjectDataRowIdColumn(tab.dataResult)) {
      errorMessage.value =
        "Row editing is not ready yet. Refresh the Data tab and try again.";
      return false;
    }

    const row = tab.dataResult.rows[rowIndex];
    if (!row) {
      errorMessage.value =
        "Unable to delete row: row no longer exists in the current result set.";
      return false;
    }

    const rowId = row[0];
    if (!rowId) {
      errorMessage.value =
        "Unable to delete row: data preview shape changed. Refresh and try again.";
      return false;
    }

    const sql = `delete from ${toQuotedIdentifier(tab.object.schema)}.${toQuotedIdentifier(tab.object.objectName)} where rowidtochar(rowid) = ${toSqlStringLiteral(rowId)}`;

    errorMessage.value = "";
    busy.updatingData = true;

    try {
      const result = await runQueryForSession(sessionId, sql);
      tab.dataResult.rows.splice(rowIndex, 1);
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
      const selectedDirectory = await invoke<string | null>(
        "db_pick_directory",
      );
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

    const targetSessionId =
      selectedExportSessionId.value ?? session.value.sessionId;
    if (
      !schemaExportTargets.value.some(
        (target) => target.sessionId === targetSessionId,
      )
    ) {
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
      connectionProfiles.value = await invoke<ConnectionProfile[]>(
        "db_list_connection_profiles",
      );
      if (
        selectedProfileId.value &&
        !connectionProfiles.value.some(
          (profile) => profile.id === selectedProfileId.value,
        )
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
    connection.connection.host = profile.connection.host;
    connection.connection.port = profile.connection.port;
    connection.connection.serviceName = profile.connection.serviceName;
    connection.connection.username = profile.connection.username;
    connection.connection.schema = profile.connection.schema;
    connection.connection.oracleAuthMode = profile.connection.oracleAuthMode;
    connection.connection.password = "";
    syncSelectedProfileUi();

    if (!profile.hasPassword) {
      statusMessage.value = `Loaded profile: ${profile.name}`;
      return;
    }

    busy.loadingProfileSecret = true;
    try {
      const password = await invoke<string | null>(
        "db_get_connection_profile_secret",
        {
          request: { profileId: profile.id },
        },
      );
      connection.connection.password = password ?? "";
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
      const request: SaveConnectionProfileRequest = {
        id: selectedProfileId.value || null,
        name: normalizedName,
        provider: connection.provider,
        connection: {
          host: connection.connection.host,
          port: connection.connection.port,
          serviceName: connection.connection.serviceName,
          username: connection.connection.username,
          schema: connection.connection.schema,
          oracleAuthMode: connection.connection.oracleAuthMode,
        },
        savePassword: saveProfilePassword.value,
        password: saveProfilePassword.value
          ? connection.connection.password
          : null,
      };
      const savedProfile = await invoke<ConnectionProfile>(
        "db_save_connection_profile",
        {
          request,
        },
      );

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
      const [nextObjects, nextObjectColumns] = await Promise.all([
        invoke<DbObjectEntry[]>("db_list_objects", {
          request: { sessionId: session.value.sessionId },
        }),
        invoke<DbObjectColumnEntry[]>("db_list_object_columns", {
          request: { sessionId: session.value.sessionId },
        }),
      ]);
      objects.value = nextObjects;
      objectColumns.value = nextObjectColumns;
      syncObjectReferences(nextObjects);
    } catch (error) {
      errorMessage.value = toErrorMessage(error);
    } finally {
      busy.loadingObjects = false;
    }
  }

  async function connectOracle(
    oracleClientLibDirOverride?: string,
  ): Promise<void> {
    errorMessage.value = "";
    busy.connecting = true;

    try {
      const oracleClientLibDir = oracleClientLibDirOverride?.trim();
      const connectRequest: OracleDbConnectRequest = {
        provider: connection.provider,
        connection: {
          ...connection.connection,
          ...(oracleClientLibDir ? { oracleClientLibDir } : {}),
        },
      };
      const summary = await invoke<DbSessionSummary>("db_connect", {
        request: connectRequest,
      });

      session.value = summary;
      transactionActive.value = false;
      selectedExportSessionId.value = summary.sessionId;
      const firstQueryTab = queryTabs.value[0];
      if (
        firstQueryTab &&
        queryTabs.value.length === 1 &&
        firstQueryTab.id === FIRST_QUERY_TAB_ID &&
        firstQueryTab.queryText.trim() ===
          buildDefaultSchemaQuery(connection.connection.schema).trim()
      ) {
        firstQueryTab.queryText = buildDefaultSchemaQuery(summary.schema);
      }
      statusMessage.value = `Connected: ${summary.displayName}`;
      await syncTransactionState(summary.sessionId);
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
      transactionActive.value = false;
      objects.value = [];
      objectColumns.value = [];
      expandedObjectTypes.value = {};
      ddlTabs.value = [];
      activeWorkspaceTabId.value = queryTabs.value[0]?.id ?? FIRST_QUERY_TAB_ID;
      selectedObject.value = null;
      schemaSearchText.value = "";
      exportDestinationDirectory.value = "";
      selectedExportSessionId.value = null;
      schemaSearchResults.value = [];
      schemaSearchPerformed.value = false;
      schemaSearchFocusToken.value = 0;
      scriptLineBackHistory.value = [];
      scriptLineForwardHistory.value = [];
      currentScriptLineLocation.value = null;
      statusMessage.value = "Disconnected.";
    }
  }

  async function saveActiveQuerySheetToDisk(): Promise<void> {
    const queryTab = activeQueryTab.value;
    if (!queryTab) {
      errorMessage.value = "Select a query sheet to save.";
      return;
    }

    errorMessage.value = "";

    try {
      const savedPath = await invoke<string | null>("db_save_query_sheet", {
        request: {
          suggestedFileName: `${queryTab.title || "query"}.sql`,
          sql: queryTab.queryText,
        },
      });

      if (!savedPath) {
        statusMessage.value = "Save cancelled.";
        return;
      }

      statusMessage.value = `Saved query sheet: ${savedPath}`;
    } catch (error) {
      errorMessage.value = toErrorMessage(error);
    }
  }

  async function saveAllQuerySheetsToDisk(): Promise<void> {
    if (!queryTabs.value.length) {
      errorMessage.value = "No query sheets are open.";
      return;
    }

    errorMessage.value = "";

    try {
      const result = await invoke<{
        directory: string;
        fileCount: number;
      } | null>("db_save_query_sheets", {
        request: {
          sheets: queryTabs.value.map((tab) => ({
            title: tab.title,
            sql: tab.queryText,
          })),
        },
      });

      if (!result) {
        statusMessage.value = "Save cancelled.";
        return;
      }

      statusMessage.value = `Saved ${result.fileCount} query sheet(s) to ${result.directory}`;
    } catch (error) {
      errorMessage.value = toErrorMessage(error);
    }
  }

  async function loadDdl(
    object: DbObjectEntry,
    targetLine: number | null = null,
  ): Promise<boolean> {
    if (!session.value) {
      return false;
    }
    const normalizedTargetLine = normalizeLineReference(targetLine);

    errorMessage.value = "";
    selectedObject.value = object;
    statusMessage.value = `Opening ${object.schema}.${object.objectName}...`;

    const tabId = buildDdlTabId(object);
    const detailTabId =
      normalizedTargetLine === null
        ? getDefaultObjectDetailTabId(object)
        : "ddl";
    let tab = ddlTabs.value.find((entry) => entry.id === tabId);
    if (!tab) {
      tab = createWorkspaceDdlTab(object, {
        focusLine: normalizedTargetLine,
        activeDetailTabId: detailTabId,
        loadingDdl: true,
      });
      ddlTabs.value.push(tab);
    } else {
      tab.object = object;
      tab.loadingDdl = true;
      tab.focusLine = normalizedTargetLine;
      tab.activeDetailTabId =
        normalizedTargetLine !== null
          ? "ddl"
          : isObjectDetailTabSupported(tab.object, tab.activeDetailTabId)
            ? tab.activeDetailTabId
            : detailTabId;
    }
    syncBusyDdlState();
    activateWorkspaceTab(tabId);

    try {
      const ddl = await invoke<string>("db_get_object_ddl", {
        request: {
          sessionId: session.value.sessionId,
          schema: object.schema,
          objectType: object.objectType,
          objectName: object.objectName,
        },
      });

      const existingTab = ddlTabs.value.find((entry) => entry.id === tabId);
      if (existingTab) {
        existingTab.ddlText = ddl;
        existingTab.object = object;
        existingTab.focusLine = normalizedTargetLine;
        existingTab.focusToken += normalizedTargetLine === null ? 0 : 1;
        existingTab.activeDetailTabId = isObjectDetailTabSupported(
          existingTab.object,
          existingTab.activeDetailTabId,
        )
          ? existingTab.activeDetailTabId
          : detailTabId;
        if (normalizedTargetLine !== null) {
          existingTab.activeDetailTabId = "ddl";
        }
      }

      const objectTab = ddlTabs.value.find((tab) => tab.id === tabId);
      if (objectTab) {
        currentScriptLineLocation.value = createScriptLineLocation(
          objectTab.object,
          objectTab.focusLine,
        );
        void ensureObjectDetailLoaded(objectTab, objectTab.activeDetailTabId);
      }
      statusMessage.value = `Loaded DDL: ${object.schema}.${object.objectName}`;
      return true;
    } catch (error) {
      errorMessage.value = toErrorMessage(error);
      return false;
    } finally {
      const objectTab = ddlTabs.value.find((tab) => tab.id === tabId);
      if (objectTab) {
        objectTab.loadingDdl = false;
      }
      syncBusyDdlState();
    }
  }

  async function saveDdl(): Promise<void> {
    if (!session.value || !activeDdlTab.value) {
      return;
    }
    const sessionId = session.value.sessionId;
    const tabId = activeDdlTab.value.id;

    errorMessage.value = "";
    busy.savingDdl = true;

    try {
      const object = activeDdlTab.value.object;
      const result = await invoke<DbQueryResult>("db_update_object_ddl", {
        request: {
          sessionId,
          schema: object.schema,
          objectType: object.objectType,
          objectName: object.objectName,
          ddl: activeDdlTab.value.ddlText,
        },
      });

      const savedTab = ddlTabs.value.find((tab) => tab.id === tabId);
      if (savedTab) {
        const resultPane = savedTab.saveResultPane ?? createDdlResultPane(savedTab.id);
        resultPane.queryResult = result;
        resultPane.errorMessage = "";
        savedTab.saveResultPane = resultPane;
      }

      await syncTransactionState(sessionId);
      await refreshObjects();
      statusMessage.value = `${object.objectName}: ${result.message}`;
    } catch (error) {
      const message = toErrorMessage(error);
      const savedTab = ddlTabs.value.find((tab) => tab.id === tabId);
      if (savedTab) {
        const resultPane = savedTab.saveResultPane ?? createDdlResultPane(savedTab.id);
        resultPane.queryResult = null;
        resultPane.errorMessage = message;
        savedTab.saveResultPane = resultPane;
      }
      errorMessage.value = message;
    } finally {
      busy.savingDdl = false;
    }
  }

  async function runQuery(selectedText?: string): Promise<void> {
    if (!session.value || !activeQueryTab.value) {
      return;
    }

    const queryTab = activeQueryTab.value;
    const sessionId = session.value.sessionId;
    const effectiveRowLimit = clampQueryRowLimit(queryRowLimit.value);
    if (effectiveRowLimit !== queryRowLimit.value) {
      queryRowLimit.value = effectiveRowLimit;
    }

    const querySource = selectedText?.trim()
      ? selectedText
      : queryTab.queryText;
    const statements = splitQueryTextForExecution(querySource);
    if (!statements.length) {
      errorMessage.value = "Query cannot be empty.";
      return;
    }

    prepareQueryResultPanes(
      queryTab,
      statements,
      sessionId,
      effectiveRowLimit,
    );
    errorMessage.value = "";
    busy.runningQuery = true;
    let completedStatements = 0;

    try {
      for (let index = 0; index < statements.length; index += 1) {
        const result = await runQueryForSession(
          sessionId,
          statements[index],
          effectiveRowLimit,
        );

        const pane = queryTab.resultPanes[index];
        if (pane) {
          pane.queryResult = result;
          pane.errorMessage = "";
          pane.sourceSql = statements[index] ?? pane.sourceSql;
          pane.sourceSessionId = sessionId;
          pane.sourceRowLimit = effectiveRowLimit;
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
        failedPane.sourceSql = statements[completedStatements] ?? failedPane.sourceSql;
        failedPane.sourceSessionId = sessionId;
        failedPane.sourceRowLimit = effectiveRowLimit;
        failedPane.queryResult = {
          columns: [],
          rows: [],
          rowsAffected: null,
          message: `Execution failed: ${message}`,
        };
        queryTab.activeResultPaneId = failedPane.id;
      }
      errorMessage.value = message;
      if (statements.length > 1) {
        statusMessage.value = `Execution stopped at statement ${completedStatements + 1} of ${statements.length}.`;
      } else {
        statusMessage.value = "Execution failed. See the error in Results.";
      }
    } finally {
      busy.runningQuery = false;
    }
  }

  async function beginTransaction(): Promise<void> {
    if (!session.value || busy.managingTransaction) {
      return;
    }

    errorMessage.value = "";
    busy.managingTransaction = true;

    try {
      const result = await invoke<DbTransactionState>("db_begin_transaction", {
        request: { sessionId: session.value.sessionId },
      });
      transactionActive.value = result.active;
      statusMessage.value = result.active
        ? "Transaction started. Changes are pending until commit or rollback."
        : "Unable to start transaction.";
    } catch (error) {
      errorMessage.value = toErrorMessage(error);
    } finally {
      busy.managingTransaction = false;
    }
  }

  async function commitTransaction(): Promise<void> {
    if (!session.value || busy.managingTransaction) {
      return;
    }

    errorMessage.value = "";
    busy.managingTransaction = true;

    try {
      const result = await invoke<DbTransactionState>("db_commit_transaction", {
        request: { sessionId: session.value.sessionId },
      });
      transactionActive.value = result.active;
      statusMessage.value = result.active
        ? "Transaction is still active."
        : "Transaction committed.";
    } catch (error) {
      errorMessage.value = toErrorMessage(error);
    } finally {
      busy.managingTransaction = false;
    }
  }

  async function rollbackTransaction(): Promise<void> {
    if (!session.value || busy.managingTransaction) {
      return;
    }

    errorMessage.value = "";
    busy.managingTransaction = true;

    try {
      const result = await invoke<DbTransactionState>(
        "db_rollback_transaction",
        {
          request: { sessionId: session.value.sessionId },
        },
      );
      transactionActive.value = result.active;
      statusMessage.value = result.active
        ? "Transaction is still active."
        : "Transaction rolled back.";
    } catch (error) {
      errorMessage.value = toErrorMessage(error);
    } finally {
      busy.managingTransaction = false;
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
    if (
      !schemaSearchIncludeObjectNames.value &&
      !schemaSearchIncludeSource.value &&
      !schemaSearchIncludeDdl.value
    ) {
      errorMessage.value = "Select at least one search scope.";
      return;
    }

    errorMessage.value = "";
    busy.searchingSchema = true;
    schemaSearchPerformed.value = true;

    try {
      schemaSearchResults.value = await invoke<DbSchemaSearchResult[]>(
        "db_search_schema_text",
        {
          request: {
            sessionId: session.value.sessionId,
            searchTerm,
            limit: 500,
            includeObjectNames: schemaSearchIncludeObjectNames.value,
            includeSource: schemaSearchIncludeSource.value,
            includeDdl: schemaSearchIncludeDdl.value,
          },
        },
      );
      statusMessage.value = `Search complete. ${schemaSearchResults.value.length} match(es).`;
    } catch (error) {
      errorMessage.value = toErrorMessage(error);
    } finally {
      busy.searchingSchema = false;
    }
  }

  async function openSchemaSearchResult(
    match: DbSchemaSearchResult,
  ): Promise<void> {
    const currentLocation = getActiveScriptLineLocation();
    const targetLocation = createScriptLineLocation(
      {
        schema: match.schema,
        objectType: match.objectType,
        objectName: match.objectName,
      },
      match.line,
    );
    const loaded = await loadDdl(targetLocation.object, targetLocation.line);
    if (!loaded) {
      return;
    }

    if (
      currentLocation &&
      !isSameScriptLineLocation(currentLocation, targetLocation)
    ) {
      pushScriptLineHistoryEntry(scriptLineBackHistory, currentLocation);
    }
    scriptLineForwardHistory.value = [];
  }

  async function navigateScriptLineBack(): Promise<void> {
    const targetLocation =
      scriptLineBackHistory.value[scriptLineBackHistory.value.length - 1];
    if (!targetLocation) {
      statusMessage.value = "No previous script line in navigation history.";
      return;
    }

    const currentLocation = getActiveScriptLineLocation();
    const loaded = await loadDdl(targetLocation.object, targetLocation.line);
    if (!loaded) {
      return;
    }

    scriptLineBackHistory.value = scriptLineBackHistory.value.slice(0, -1);
    if (
      currentLocation &&
      !isSameScriptLineLocation(currentLocation, targetLocation)
    ) {
      pushScriptLineHistoryEntry(scriptLineForwardHistory, currentLocation);
    }
  }

  async function navigateScriptLineForward(): Promise<void> {
    const targetLocation =
      scriptLineForwardHistory.value[scriptLineForwardHistory.value.length - 1];
    if (!targetLocation) {
      statusMessage.value = "No next script line in navigation history.";
      return;
    }

    const currentLocation = getActiveScriptLineLocation();
    const loaded = await loadDdl(targetLocation.object, targetLocation.line);
    if (!loaded) {
      return;
    }

    scriptLineForwardHistory.value = scriptLineForwardHistory.value.slice(0, -1);
    if (
      currentLocation &&
      !isSameScriptLineLocation(currentLocation, targetLocation)
    ) {
      pushScriptLineHistoryEntry(scriptLineBackHistory, currentLocation);
    }
  }

  watch(
    () => ({
      queryTabs: queryTabs.value.map((tab) => ({
        id: tab.id,
        title: tab.title,
        queryText: tab.queryText,
      })),
      activeWorkspaceTabId: activeWorkspaceTabId.value,
      queryTabNumber: queryTabNumber.value,
    }),
    (nextState) => {
      const firstTabId = nextState.queryTabs[0]?.id ?? FIRST_QUERY_TAB_ID;
      const normalizedState: PersistedQuerySheetState = {
        queryTabs: nextState.queryTabs,
        activeWorkspaceTabId: nextState.queryTabs.some(
          (tab) => tab.id === nextState.activeWorkspaceTabId,
        )
          ? nextState.activeWorkspaceTabId
          : firstTabId,
        queryTabNumber: Math.max(
          nextState.queryTabNumber,
          nextState.queryTabs.reduce(
            (maxNumber, tab) =>
              Math.max(maxNumber, parseQueryTabNumber(tab.id) ?? 0),
            0,
          ) + 1,
        ),
      };
      writeStoredQuerySheetState(normalizedState);
    },
    { deep: true, immediate: true },
  );

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
  };
}
