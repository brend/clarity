<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import AppIcon from "./components/AppIcon.vue";
import SqlCodeEditor from "./components/SqlCodeEditor.vue";

interface OracleConnectRequest {
  provider: DatabaseProvider;
  host: string;
  port?: number;
  serviceName: string;
  username: string;
  password: string;
  schema: string;
}

type DatabaseProvider = "oracle" | "postgres" | "mysql" | "sqlite";

interface OracleSessionSummary {
  sessionId: number;
  displayName: string;
  schema: string;
  provider: DatabaseProvider;
}

interface ConnectionProfile {
  id: string;
  name: string;
  provider: DatabaseProvider;
  host: string;
  port?: number;
  serviceName: string;
  username: string;
  schema: string;
  hasPassword: boolean;
}

interface OracleObjectEntry {
  schema: string;
  objectType: string;
  objectName: string;
}

interface OracleQueryResult {
  columns: string[];
  rows: string[][];
  rowsAffected: number | null;
  message: string;
}

interface WorkspaceDdlTab {
  id: string;
  object: OracleObjectEntry;
  ddlText: string;
}

interface WorkspaceQueryTab {
  id: string;
  title: string;
  queryText: string;
}

const QUERY_TAB_PREFIX = "query:";
const FIRST_QUERY_TAB_ID = `${QUERY_TAB_PREFIX}1`;

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
const statusMessage = ref("Ready. Connect to an Oracle session to begin.");
const errorMessage = ref("");
const activeWorkspaceTabId = ref(FIRST_QUERY_TAB_ID);

const busy = reactive({
  connecting: false,
  loadingProfiles: false,
  savingProfile: false,
  deletingProfile: false,
  loadingProfileSecret: false,
  loadingObjects: false,
  loadingDdl: false,
  savingDdl: false,
  runningQuery: false,
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
const expandedObjectTypes = ref<Record<string, boolean>>({});
const activeQueryTab = computed(() =>
  queryTabs.value.find((tab) => tab.id === activeWorkspaceTabId.value) ?? null,
);
const activeDdlTab = computed(() =>
  ddlTabs.value.find((tab) => tab.id === activeWorkspaceTabId.value) ?? null,
);
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

function activateWorkspaceTab(tabId: string): void {
  activeWorkspaceTabId.value = tabId;

  if (queryTabs.value.some((tab) => tab.id === tabId)) {
    return;
  }

  const tab = ddlTabs.value.find((entry) => entry.id === tabId);
  if (tab) {
    selectedObject.value = tab.object;
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

async function loadConnectionProfiles(): Promise<void> {
  busy.loadingProfiles = true;
  try {
    connectionProfiles.value = await invoke<ConnectionProfile[]>("db_list_connection_profiles");
    if (selectedProfileId.value && !connectionProfiles.value.some((profile) => profile.id === selectedProfileId.value)) {
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
    statusMessage.value = "Disconnected.";
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

async function loadDdl(object: OracleObjectEntry): Promise<void> {
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
    const existingTab = ddlTabs.value.find((tab) => tab.id === tabId);
    if (existingTab) {
      existingTab.ddlText = ddl;
      existingTab.object = object;
    } else {
      ddlTabs.value.push({
        id: tabId,
        object,
        ddlText: ddl,
      });
    }

    activateWorkspaceTab(tabId);
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

onMounted(() => {
  void loadConnectionProfiles();
});
</script>

<template>
  <main class="desktop-shell">
    <aside class="explorer-sidebar">
      <header class="sidebar-header">Object Explorer</header>

      <section class="connect-box">
        <div class="connect-title">Database Connection</div>
        <div class="profile-controls">
          <label>
            Profiles
            <select v-model="selectedProfileId" @change="syncSelectedProfileUi">
              <option value="">(Select profile)</option>
              <option v-for="profile in connectionProfiles" :key="profile.id" :value="profile.id">
                {{ profile.name }}
              </option>
            </select>
          </label>
          <div class="profile-actions">
            <button
              class="btn"
              :disabled="!selectedProfile || busy.loadingProfileSecret || busy.loadingProfiles"
              @click="applySelectedProfile"
            >
              {{ busy.loadingProfileSecret ? "Loading..." : "Load Profile" }}
            </button>
            <button class="btn" :disabled="!selectedProfile || busy.deletingProfile" @click="deleteSelectedProfile">
              {{ busy.deletingProfile ? "Deleting..." : "Delete" }}
            </button>
          </div>
          <label>
            Profile Name
            <input v-model.trim="profileName" placeholder="Local Oracle Dev" />
          </label>
          <label class="profile-password-toggle">
            <input v-model="saveProfilePassword" type="checkbox" />
            Save password in OS keychain
          </label>
          <button class="btn" :disabled="busy.savingProfile" @click="saveConnectionProfile">
            {{ busy.savingProfile ? "Saving..." : "Save Profile" }}
          </button>
        </div>

        <div class="field-grid">
          <label>
            Provider
            <select v-model="connection.provider">
              <option value="oracle">Oracle</option>
              <option value="postgres" disabled>PostgreSQL (Soon)</option>
              <option value="mysql" disabled>MySQL (Soon)</option>
              <option value="sqlite" disabled>SQLite (Soon)</option>
            </select>
          </label>

          <label>
            Host
            <input v-model.trim="connection.host" placeholder="db.example.com" />
          </label>

          <label>
            Port
            <input v-model.number="connection.port" type="number" min="1" max="65535" />
          </label>

          <label>
            Service
            <input v-model.trim="connection.serviceName" placeholder="XEPDB1" />
          </label>

          <label>
            Username
            <input v-model.trim="connection.username" placeholder="hr" />
          </label>

          <label>
            Schema
            <input v-model.trim="connection.schema" placeholder="HR" />
          </label>

          <label>
            Password
            <input v-model="connection.password" type="password" placeholder="********" />
          </label>
        </div>

        <div class="connect-actions">
          <button class="btn primary" :disabled="busy.connecting || isConnected" @click="connectOracle">
            <AppIcon name="plug" class="btn-icon" aria-hidden="true" />
            {{ busy.connecting ? "Connecting..." : "Connect" }}
          </button>
          <button class="btn" :disabled="!isConnected" @click="disconnectOracle">
            <AppIcon name="plug-off" class="btn-icon" aria-hidden="true" />
            Disconnect
          </button>
          <button class="btn" :disabled="!isConnected || busy.loadingObjects" @click="refreshObjects">
            <AppIcon name="refresh" class="btn-icon" aria-hidden="true" />
            {{ busy.loadingObjects ? "Refreshing..." : "Refresh" }}
          </button>
        </div>

        <div class="session-line">
          {{ session ? session.displayName : "No active connection" }}
        </div>
      </section>

      <section class="tree-area">
        <div class="tree-caption">{{ connectedSchema }} Objects</div>
        <p v-if="!objects.length" class="muted">No objects loaded.</p>
        <ul v-else class="tree-root" role="tree" aria-label="Database object explorer">
          <li
            v-for="typeNode in objectTree"
            :key="typeNode.objectType"
            class="tree-branch"
            role="treeitem"
            :aria-expanded="isObjectTypeExpanded(typeNode.objectType)"
          >
            <button
              class="tree-row tree-type"
              :class="{ expanded: isObjectTypeExpanded(typeNode.objectType) }"
              @click="toggleObjectType(typeNode.objectType)"
            >
              <AppIcon name="chevron-right" class="tree-caret-icon" aria-hidden="true" />
              <span class="tree-type-label">
                {{ typeNode.objectType }} <span class="tree-count">({{ typeNode.entries.length }})</span>
              </span>
            </button>

            <ul v-show="isObjectTypeExpanded(typeNode.objectType)" class="tree-children" role="group">
              <li
                v-for="entry in typeNode.entries"
                :key="`${entry.schema}-${entry.objectType}-${entry.objectName}`"
                class="tree-leaf"
                role="treeitem"
              >
                <button
                  class="tree-row tree-node"
                  :class="{
                    selected:
                      selectedObject?.schema === entry.schema &&
                      selectedObject?.objectName === entry.objectName &&
                      selectedObject?.objectType === entry.objectType,
                  }"
                  @click="loadDdl(entry)"
                >
                  <AppIcon name="object" class="tree-leaf-icon" aria-hidden="true" />
                  <span>{{ entry.objectName }}</span>
                </button>
              </li>
            </ul>
          </li>
        </ul>
      </section>
    </aside>

    <section class="workspace">
      <header class="workspace-toolbar">
        <div class="toolbar-title">SQL Worksheet</div>
        <div class="toolbar-status">{{ statusMessage }}</div>
      </header>

      <section class="sheet-pane">
        <div class="sheet-tabs">
          <div
            v-for="tab in queryTabs"
            :key="tab.id"
            class="sheet-tab-wrap"
            :class="{ active: activeWorkspaceTabId === tab.id }"
          >
            <button class="sheet-tab" @click="activateWorkspaceTab(tab.id)">
              {{ tab.title }}
            </button>
            <button
              v-if="queryTabs.length > 1"
              class="sheet-tab-close"
              title="Close tab"
              @click.stop="closeQueryTab(tab.id)"
            >
              <AppIcon name="close" class="sheet-tab-icon" aria-hidden="true" />
            </button>
          </div>
          <button class="sheet-tab-add" title="New query tab" @click="addQueryTab">
            <AppIcon name="plus" class="sheet-tab-icon" aria-hidden="true" />
          </button>
          <div
            v-for="tab in ddlTabs"
            :key="tab.id"
            class="sheet-tab-wrap"
            :class="{ active: activeWorkspaceTabId === tab.id }"
          >
            <button class="sheet-tab" @click="activateWorkspaceTab(tab.id)">
              {{ tab.object.objectName }}
            </button>
            <button class="sheet-tab-close" title="Close tab" @click.stop="closeDdlTab(tab.id)">
              <AppIcon name="close" class="sheet-tab-icon" aria-hidden="true" />
            </button>
          </div>
          <div class="sheet-tab-fill"></div>
          <button
            class="btn primary"
            :disabled="!isConnected || !activeQueryTab || busy.runningQuery"
            @click="runQuery"
          >
            <AppIcon name="play" class="btn-icon" aria-hidden="true" />
            {{ busy.runningQuery ? "Running..." : "Execute" }}
          </button>
          <button class="btn" :disabled="!activeDdlTab || busy.savingDdl" @click="saveDdl">
            <AppIcon name="save" class="btn-icon" aria-hidden="true" />
            {{ busy.savingDdl ? "Saving..." : "Save DDL" }}
          </button>
          <span class="schema-chip">Provider: {{ selectedProviderLabel }}</span>
          <span class="schema-chip">Schema: {{ connectedSchema }}</span>
        </div>

        <SqlCodeEditor
          v-if="isQueryTabActive"
          v-model="activeQueryText"
          class="sql-editor"
          placeholder="Write SQL here"
        />

        <section v-else-if="activeDdlTab" class="ddl-pane">
          <div class="ddl-header">
            <div class="muted">
              {{
                activeDdlObject
                  ? `${activeDdlObject.schema}.${activeDdlObject.objectName} (${activeDdlObject.objectType})`
                  : "Select an object from Object Explorer."
              }}
            </div>
          </div>

          <SqlCodeEditor
            v-model="activeDdlText"
            class="ddl-editor"
            placeholder="Object DDL will appear here"
          />
        </section>
      </section>

      <section class="results-pane">
        <div class="results-header">
          <div class="results-title">Results</div>
          <div v-if="errorMessage" class="error-inline">{{ errorMessage }}</div>
        </div>

        <div class="results-content">
          <p v-if="!queryResult" class="muted">Run a query to see results.</p>

          <p v-else-if="queryResult.rowsAffected !== null" class="muted">
            Rows affected: {{ queryResult.rowsAffected }}
          </p>

          <table v-else-if="queryResult.columns.length" class="results-table">
            <thead>
              <tr>
                <th v-for="column in queryResult.columns" :key="column">{{ column }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, rowIndex) in queryResult.rows" :key="`row-${rowIndex}`">
                <td
                  v-for="(value, colIndex) in row"
                  :key="`col-${rowIndex}-${colIndex}`"
                  :class="{ 'results-cell-number': isLikelyNumeric(value) }"
                >
                  {{ value }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </section>
  </main>
</template>

<style>
:root {
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
  --pane-header-height: 58px;
  font-family: var(--font-ui);
  color: var(--text-primary);
  background: var(--bg-canvas);
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
  height: 100%;
  display: grid;
  grid-template-columns: 330px 1fr;
  background: var(--bg-shell);
  overflow: hidden;
}

.explorer-sidebar {
  border-right: 1px solid var(--border-strong);
  background: var(--bg-sidebar);
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.sidebar-header {
  height: var(--pane-header-height);
  padding: 0 0.8rem;
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--border);
  font-size: 0.82rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  background: var(--bg-surface-muted);
}

.connect-box {
  padding: 0.65rem;
  border-bottom: 1px solid var(--border);
}

.connect-title {
  font-size: 0.82rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.profile-controls {
  display: grid;
  gap: 0.45rem;
  margin-bottom: 0.65rem;
  padding-bottom: 0.65rem;
  border-bottom: 1px solid var(--border);
}

.profile-actions {
  display: flex;
  gap: 0.34rem;
}

.profile-password-toggle {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.74rem;
  color: var(--text-secondary);
}

.profile-password-toggle input {
  margin: 0;
}

.field-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem;
}

label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.75rem;
  color: var(--text-secondary);
}

input,
select,
textarea,
button {
  font: inherit;
  color: inherit;
}

input,
select,
textarea {
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--bg-surface);
  padding: 0.38rem 0.45rem;
}

input:focus-visible,
textarea:focus-visible,
button:focus-visible {
  outline: 2px solid rgba(79, 111, 150, 0.35);
  outline-offset: 1px;
}

.connect-actions {
  margin-top: 0.45rem;
  display: flex;
  gap: 0.34rem;
}

.btn {
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--bg-surface);
  padding: 0.34rem 0.6rem;
  font-size: 0.76rem;
  cursor: pointer;
  transition: background-color 0.12s ease, border-color 0.12s ease;
  display: inline-flex;
  align-items: center;
  gap: 0.34rem;
}

.btn:hover:not(:disabled) {
  background: var(--bg-hover);
  border-color: var(--border-strong);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-contrast);
}

.btn.primary:hover:not(:disabled) {
  background: var(--accent-strong);
  border-color: var(--accent-strong);
}

.btn-icon {
  width: 0.85rem;
  height: 0.85rem;
  flex: 0 0 auto;
}

.session-line {
  margin-top: 0.4rem;
  font-size: 0.72rem;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tree-area {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0.65rem;
}

.tree-caption {
  font-size: 0.76rem;
  color: var(--text-secondary);
  margin-bottom: 0.45rem;
}

.tree-root,
.tree-children {
  list-style: none;
  margin: 0;
  padding: 0;
}

.tree-children {
  padding-left: 0.8rem;
}

.tree-row {
  width: 100%;
  border: 0;
  background: transparent;
  text-align: left;
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.24rem 0.34rem;
  border-radius: 4px;
  font-size: 0.74rem;
  cursor: pointer;
}

.tree-type {
  font-weight: 600;
  color: var(--text-primary);
}

.tree-type:hover {
  background: var(--bg-hover);
}

.tree-caret-icon {
  width: 0.62rem;
  height: 0.62rem;
  color: var(--text-subtle);
  transform-origin: center;
  transition: transform 0.12s ease;
  flex: 0 0 auto;
}

.tree-type.expanded .tree-caret-icon {
  transform: rotate(90deg);
}

.tree-count {
  color: var(--text-secondary);
  font-weight: 500;
}

.tree-type-label {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.tree-node {
  color: var(--text-primary);
}

.tree-node:hover {
  background: var(--bg-hover);
}

.tree-node.selected {
  background: var(--bg-selected);
  color: #1f3654;
}

.tree-leaf-icon {
  width: 0.62rem;
  height: 0.62rem;
  color: var(--text-subtle);
  flex: 0 0 auto;
}

.tree-node span:last-child {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.workspace {
  display: grid;
  grid-template-rows: var(--pane-header-height) 1fr 42%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.workspace-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--pane-header-height);
  padding: 0 0.8rem;
  border-bottom: 1px solid var(--border-strong);
  background: var(--bg-surface-muted);
}

.toolbar-title {
  font-size: 0.82rem;
  font-weight: 600;
}

.toolbar-status {
  font-size: 0.74rem;
  color: var(--text-secondary);
  max-width: 65%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sheet-pane {
  display: grid;
  grid-template-rows: auto 1fr;
  border-bottom: 1px solid var(--border-strong);
  min-height: 0;
  background: var(--bg-surface);
  overflow-y: auto;
  overflow-x: hidden;
}

.sheet-tabs {
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--border);
  background: var(--bg-surface-muted);
  gap: 0;
  min-width: 0;
}

.sheet-tab-wrap {
  display: flex;
  align-items: center;
  border-right: 1px solid var(--border);
  min-width: 0;
}

.sheet-tab {
  border: 0;
  border-radius: 0;
  background: transparent;
  padding: 0.46rem 0.72rem;
  font-size: 0.77rem;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 12rem;
}

.sheet-tab.active,
.sheet-tab-wrap.active {
  background: var(--bg-surface);
}

.sheet-tab-wrap.active .sheet-tab {
  font-weight: 600;
}

.sheet-tab-add {
  border: 0;
  border-right: 1px solid var(--border);
  border-radius: 0;
  background: transparent;
  padding: 0.46rem 0.62rem;
  font-size: 0.8rem;
  cursor: pointer;
  color: var(--accent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.sheet-tab-add:hover {
  background: var(--bg-hover);
}

.sheet-tab-close {
  border: 0;
  border-left: 1px solid var(--border);
  background: transparent;
  padding: 0.46rem 0.42rem;
  font-size: 0.75rem;
  cursor: pointer;
  color: var(--text-subtle);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.sheet-tab-close:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.sheet-tab-fill {
  flex: 1;
}

.sheet-tab-icon {
  width: 0.76rem;
  height: 0.76rem;
}

.sheet-tabs > .btn {
  margin-left: 0.45rem;
}

.schema-chip {
  margin-left: 0.45rem;
  margin-right: 0.45rem;
  font-size: 0.74rem;
  color: var(--text-secondary);
  background: #e8eff8;
  border: 1px solid #c6d5e8;
  padding: 0.2rem 0.42rem;
  border-radius: 4px;
}

.sql-editor,
.ddl-editor {
  width: 100%;
  height: 100%;
  min-height: 0;
  background: #ffffff;
}

.results-pane {
  display: grid;
  grid-template-rows: 34px 1fr;
  min-height: 0;
  background: var(--bg-surface);
  overflow: hidden;
}

.results-header {
  display: flex;
  align-items: center;
  padding: 0 0.55rem;
  border-bottom: 1px solid var(--border);
  background: var(--bg-surface-muted);
}

.results-title {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-primary);
}

.error-inline {
  margin-left: auto;
  font-size: 0.74rem;
  color: var(--danger);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.results-content {
  min-height: 0;
  overflow: auto;
  padding: 0;
  margin: 0;
  font-family: Consolas, "Courier New", monospace;
}

.results-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.78rem;
  margin: 0;
}

.results-table th,
.results-table td {
  border: 1px solid var(--border);
  text-align: left;
  padding: 0.32rem 0.44rem;
}

.results-table th {
  background: var(--bg-surface-muted);
  position: sticky;
  top: 0;
}

.results-table tbody tr:nth-child(even) {
  background: #fafbfd;
}

.results-table tbody tr:hover {
  background: var(--bg-hover);
}

.results-cell-number {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.ddl-pane {
  display: grid;
  grid-template-rows: auto 1fr;
  gap: 0.4rem;
  min-height: 0;
}

.ddl-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.6rem;
}

.muted {
  color: var(--text-secondary);
  font-size: 0.76rem;
}

@media (max-width: 980px) {
  .desktop-shell {
    grid-template-columns: 1fr;
    grid-template-rows: 42% 58%;
  }

  .explorer-sidebar {
    border-right: 0;
    border-bottom: 1px solid var(--border-strong);
  }

  .workspace {
    grid-template-rows: var(--pane-header-height) 1fr 44%;
  }

  .field-grid {
    grid-template-columns: 1fr;
  }
}
</style>
