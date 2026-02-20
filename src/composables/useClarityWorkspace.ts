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
  OracleSessionSummary,
  OracleSourceSearchResult,
  WorkspaceDdlTab,
  WorkspaceQueryTab,
} from "../types/clarity";

const QUERY_TAB_PREFIX = "query:";
const FIRST_QUERY_TAB_ID = `${QUERY_TAB_PREFIX}1`;
const SEARCH_TAB_ID = "search:code";
const OBJECT_DATA_PREVIEW_LIMIT = 500;

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
  const queryTabs = ref<WorkspaceQueryTab[]>([
    {
      id: FIRST_QUERY_TAB_ID,
      title: "Query 1",
      queryText: buildDefaultSchemaQuery(connection.schema),
    },
  ]);
  const queryTabNumber = ref(2);
  const queryResult = ref<OracleQueryResult | null>(null);
  const sourceSearchText = ref("");
  const sourceSearchResults = ref<OracleSourceSearchResult[]>([]);
  const sourceSearchPerformed = ref(false);
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
    searchingSource: false,
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
  const activeQueryTab = computed(() =>
    queryTabs.value.find((tab) => tab.id === activeWorkspaceTabId.value) ?? null,
  );
  const activeDdlTab = computed(() =>
    ddlTabs.value.find((tab) => tab.id === activeWorkspaceTabId.value) ?? null,
  );
  const isSearchTabActive = computed(() => activeWorkspaceTabId.value === SEARCH_TAB_ID);
  const activeDdlObject = computed(() => activeDdlTab.value?.object ?? null);
  const isQueryTabActive = computed(() => activeQueryTab.value !== null);
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
  const activeObjectDetailResult = computed<OracleQueryResult | null>(() => {
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
    return expanded ?? true;
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

  function buildObjectDataPreviewSql(object: OracleObjectEntry): string {
    return `select * from ${toQuotedIdentifier(object.schema)}.${toQuotedIdentifier(object.objectName)} fetch first ${OBJECT_DATA_PREVIEW_LIMIT} rows only`;
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

  function addQueryTab(): void {
    const tabNumber = queryTabNumber.value;
    queryTabNumber.value += 1;

    const tabId = `${QUERY_TAB_PREFIX}${tabNumber}`;
    const tab: WorkspaceQueryTab = {
      id: tabId,
      title: `Query ${tabNumber}`,
      queryText: buildDefaultSchemaQuery(session.value?.schema ?? connection.schema),
    };

    queryTabs.value.push(tab);
    activateWorkspaceTab(tabId);
  }

  function openSearchTab(): void {
    activateWorkspaceTab(SEARCH_TAB_ID);
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

    if (!forceReload && tab.dataResult) {
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

  async function connectOracle(): Promise<void> {
    errorMessage.value = "";
    busy.connecting = true;

    try {
      const summary = await invoke<OracleSessionSummary>("db_connect", {
        request: connection,
      });

      session.value = summary;
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
        {
          id: FIRST_QUERY_TAB_ID,
          title: "Query 1",
          queryText: buildDefaultSchemaQuery(connection.schema),
        },
      ];
      queryTabNumber.value = 2;
      ddlTabs.value = [];
      activeWorkspaceTabId.value = FIRST_QUERY_TAB_ID;
      selectedObject.value = null;
      queryResult.value = null;
      sourceSearchText.value = "";
      sourceSearchResults.value = [];
      sourceSearchPerformed.value = false;
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

    errorMessage.value = "";
    busy.runningQuery = true;

    try {
      const result = await invoke<OracleQueryResult>("db_run_query", {
        request: {
          sessionId: session.value.sessionId,
          sql: activeQueryTab.value.queryText,
        },
      });

      queryResult.value = result;
      statusMessage.value = result.message;
    } catch (error) {
      errorMessage.value = toErrorMessage(error);
    } finally {
      busy.runningQuery = false;
    }
  }

  async function runSourceSearch(): Promise<void> {
    if (!session.value) {
      return;
    }

    const searchTerm = sourceSearchText.value.trim();
    if (!searchTerm) {
      errorMessage.value = "Search term is required.";
      return;
    }

    errorMessage.value = "";
    busy.searchingSource = true;
    sourceSearchPerformed.value = true;

    try {
      sourceSearchResults.value = await invoke<OracleSourceSearchResult[]>("db_search_source_code", {
        request: {
          sessionId: session.value.sessionId,
          searchTerm,
          limit: 500,
        },
      });
      statusMessage.value = `Search complete. ${sourceSearchResults.value.length} match(es).`;
    } catch (error) {
      errorMessage.value = toErrorMessage(error);
    } finally {
      busy.searchingSource = false;
    }
  }

  async function openSourceSearchResult(match: OracleSourceSearchResult): Promise<void> {
    await loadDdl(
      {
        schema: match.schema,
        objectType: match.objectType,
        objectName: match.objectName,
      },
      match.line,
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
    activeObjectDetailLoading,
    activeQueryText,
    activeDdlText,
    sourceSearchText,
    sourceSearchResults,
    sourceSearchPerformed,
    queryResult,
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
  };
}
