<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";

interface OracleConnectRequest {
  host: string;
  port?: number;
  serviceName: string;
  username: string;
  password: string;
  schema: string;
}

interface OracleSessionSummary {
  sessionId: number;
  displayName: string;
  schema: string;
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
  host: readDebugConnectionString(import.meta.env.VITE_ORACLE_HOST, "localhost"),
  port: readDebugConnectionPort(import.meta.env.VITE_ORACLE_PORT, 1521),
  serviceName: readDebugConnectionString(import.meta.env.VITE_ORACLE_SERVICE_NAME, "XEPDB1"),
  username: readDebugConnectionString(import.meta.env.VITE_ORACLE_USERNAME, "hr"),
  password: import.meta.env.DEV ? (import.meta.env.VITE_ORACLE_PASSWORD ?? "") : "",
  schema: readDebugConnectionString(import.meta.env.VITE_ORACLE_SCHEMA, "HR"),
});

const session = ref<OracleSessionSummary | null>(null);
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
  loadingObjects: false,
  loadingDdl: false,
  savingDdl: false,
  runningQuery: false,
});

const isConnected = computed(() => session.value !== null);
const connectedSchema = computed(() => session.value?.schema ?? connection.schema.toUpperCase());
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

async function connectOracle(): Promise<void> {
  errorMessage.value = "";
  busy.connecting = true;

  try {
    const summary = await invoke<OracleSessionSummary>("oracle_connect", {
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
    await invoke("oracle_disconnect", {
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
    const result = await invoke<OracleObjectEntry[]>("oracle_list_objects", {
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
    const ddl = await invoke<string>("oracle_get_object_ddl", {
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
    const message = await invoke<string>("oracle_update_object_ddl", {
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
    const result = await invoke<OracleQueryResult>("oracle_run_query", {
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
</script>

<template>
  <main class="desktop-shell">
    <aside class="explorer-sidebar">
      <header class="sidebar-header">Object Explorer</header>

      <section class="connect-box">
        <div class="connect-title">Oracle Connection</div>

        <div class="field-grid">
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
            {{ busy.connecting ? "Connecting..." : "Connect" }}
          </button>
          <button class="btn" :disabled="!isConnected" @click="disconnectOracle">Disconnect</button>
          <button class="btn" :disabled="!isConnected || busy.loadingObjects" @click="refreshObjects">
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
              <span class="tree-caret" aria-hidden="true">&gt;</span>
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
                  <span class="tree-leaf-bullet" aria-hidden="true">-</span>
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
              x
            </button>
          </div>
          <button class="sheet-tab-add" title="New query tab" @click="addQueryTab">+</button>
          <div
            v-for="tab in ddlTabs"
            :key="tab.id"
            class="sheet-tab-wrap"
            :class="{ active: activeWorkspaceTabId === tab.id }"
          >
            <button class="sheet-tab" @click="activateWorkspaceTab(tab.id)">
              {{ tab.object.objectName }}
            </button>
            <button class="sheet-tab-close" title="Close tab" @click.stop="closeDdlTab(tab.id)">x</button>
          </div>
          <div class="sheet-tab-fill"></div>
          <button
            class="btn primary"
            :disabled="!isConnected || !activeQueryTab || busy.runningQuery"
            @click="runQuery"
          >
            {{ busy.runningQuery ? "Running..." : "Execute" }}
          </button>
          <button class="btn" :disabled="!activeDdlTab || busy.savingDdl" @click="saveDdl">
            {{ busy.savingDdl ? "Saving..." : "Save DDL" }}
          </button>
          <span class="schema-chip">Schema: {{ connectedSchema }}</span>
        </div>

        <textarea
          v-if="isQueryTabActive"
          v-model="activeQueryText"
          class="sql-editor"
          spellcheck="false"
          placeholder="Write Oracle SQL here"
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

          <textarea
            v-model="activeDdlText"
            class="ddl-editor"
            spellcheck="false"
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
                <td v-for="(value, colIndex) in row" :key="`col-${rowIndex}-${colIndex}`">{{ value }}</td>
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
  font-family: "Segoe UI", Tahoma, sans-serif;
  color: #1c1c1c;
  background: #dfe3e8;
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
  background: #cfd6de;
  overflow: hidden;
}

.explorer-sidebar {
  border-right: 1px solid #8f99a5;
  background: #f3f5f8;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.sidebar-header {
  padding: 0.55rem 0.7rem;
  border-bottom: 1px solid #a9b3bf;
  font-size: 0.82rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  background: #d9e0e8;
}

.connect-box {
  padding: 0.55rem;
  border-bottom: 1px solid #b7bfc9;
}

.connect-title {
  font-size: 0.82rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.field-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem;
}

label {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.75rem;
  color: #414852;
}

input,
textarea,
button {
  font: inherit;
  color: inherit;
}

input,
textarea {
  border: 1px solid #a8b2be;
  border-radius: 2px;
  background: #fff;
  padding: 0.34rem 0.42rem;
}

.connect-actions {
  margin-top: 0.45rem;
  display: flex;
  gap: 0.34rem;
}

.btn {
  border: 1px solid #8e99a7;
  border-radius: 2px;
  background: #f4f6f9;
  padding: 0.32rem 0.55rem;
  font-size: 0.76rem;
  cursor: pointer;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn.primary {
  background: linear-gradient(#3d78b2, #2f5e8a);
  border-color: #2a5580;
  color: #f7f9fb;
}

.session-line {
  margin-top: 0.4rem;
  font-size: 0.72rem;
  color: #516070;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tree-area {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0.5rem;
}

.tree-caption {
  font-size: 0.76rem;
  color: #4b5664;
  margin-bottom: 0.35rem;
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
  padding: 0.18rem 0.25rem;
  border-radius: 2px;
  font-size: 0.74rem;
  cursor: pointer;
}

.tree-type {
  font-weight: 600;
  color: #2c3a4a;
}

.tree-type:hover {
  background: #e8eef7;
}

.tree-caret {
  width: 0.62rem;
  color: #5a697a;
  transform-origin: center;
  transition: transform 0.12s ease;
}

.tree-type.expanded .tree-caret {
  transform: rotate(90deg);
}

.tree-count {
  color: #5a6674;
  font-weight: 500;
}

.tree-type-label {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.tree-node {
  color: #354456;
}

.tree-node:hover {
  background: #f3f7fd;
}

.tree-node.selected {
  background: #d8e8fa;
  color: #163d67;
}

.tree-leaf-bullet {
  width: 0.62rem;
  color: #758396;
}

.tree-node span:last-child {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.workspace {
  display: grid;
  grid-template-rows: 34px 1fr 42%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.workspace-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 0.65rem;
  border-bottom: 1px solid #9ca6b2;
  background: #e5eaf0;
}

.toolbar-title {
  font-size: 0.82rem;
  font-weight: 600;
}

.toolbar-status {
  font-size: 0.74rem;
  color: #4f5f70;
  max-width: 65%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sheet-pane {
  display: grid;
  grid-template-rows: auto 1fr;
  border-bottom: 1px solid #9ca6b2;
  min-height: 0;
  background: #f5f7fa;
  overflow-y: auto;
  overflow-x: hidden;
}

.sheet-tabs {
  display: flex;
  align-items: center;
  border-bottom: 1px solid #c2c9d2;
  background: #e4e9ef;
  gap: 0;
  min-width: 0;
}

.sheet-tab-wrap {
  display: flex;
  align-items: center;
  border-right: 1px solid #b8c1cc;
  min-width: 0;
}

.sheet-tab {
  border: 0;
  border-radius: 0;
  background: transparent;
  padding: 0.42rem 0.7rem;
  font-size: 0.77rem;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 12rem;
}

.sheet-tab.active,
.sheet-tab-wrap.active {
  background: #fff;
}

.sheet-tab-wrap.active .sheet-tab {
  font-weight: 600;
}

.sheet-tab-add {
  border: 0;
  border-right: 1px solid #b8c1cc;
  border-radius: 0;
  background: transparent;
  padding: 0.42rem 0.6rem;
  font-size: 0.8rem;
  cursor: pointer;
  color: #35506d;
}

.sheet-tab-add:hover {
  background: #eef4fb;
}

.sheet-tab-close {
  border: 0;
  border-left: 1px solid #d2d8e0;
  background: transparent;
  padding: 0.42rem 0.42rem;
  font-size: 0.75rem;
  cursor: pointer;
  color: #5e6b7a;
}

.sheet-tab-close:hover {
  color: #27384d;
  background: #eef4fb;
}

.sheet-tab-fill {
  flex: 1;
}

.sheet-tabs > .btn {
  margin-left: 0.45rem;
}

.schema-chip {
  margin-left: 0.45rem;
  margin-right: 0.45rem;
  font-size: 0.74rem;
  color: #2d3f55;
  background: #dde9f6;
  border: 1px solid #b7cbe0;
  padding: 0.2rem 0.42rem;
  border-radius: 2px;
}

.sql-editor,
.ddl-editor {
  width: 100%;
  height: 100%;
  border: 0;
  border-radius: 0;
  resize: none;
  padding: 0.6rem;
  font-family: Consolas, "Courier New", monospace;
  font-size: 0.82rem;
  line-height: 1.42;
  background: #ffffff;
}

.results-pane {
  display: grid;
  grid-template-rows: 34px 1fr;
  min-height: 0;
  background: #fff;
  overflow: hidden;
}

.results-header {
  display: flex;
  align-items: center;
  padding: 0 0.55rem;
  border-bottom: 1px solid #aeb7c2;
  background: #e4e9ef;
}

.results-title {
  font-size: 0.78rem;
  font-weight: 600;
  color: #2f4053;
}

.error-inline {
  margin-left: auto;
  font-size: 0.74rem;
  color: #9b2030;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.results-content {
  min-height: 0;
  overflow: auto;
  padding: 0.55rem;
}

.results-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.78rem;
}

.results-table th,
.results-table td {
  border: 1px solid #c8d0da;
  text-align: left;
  padding: 0.28rem 0.36rem;
}

.results-table th {
  background: #edf2f8;
  position: sticky;
  top: 0;
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
  color: #5b6674;
  font-size: 0.76rem;
}

@media (max-width: 980px) {
  .desktop-shell {
    grid-template-columns: 1fr;
    grid-template-rows: 42% 58%;
  }

  .explorer-sidebar {
    border-right: 0;
    border-bottom: 1px solid #8f99a5;
  }

  .workspace {
    grid-template-rows: 34px 1fr 44%;
  }

  .field-grid {
    grid-template-columns: 1fr;
  }
}
</style>
