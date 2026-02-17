<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";

interface OracleConnectRequest {
  host: string;
  port?: number;
  serviceName: string;
  username: string;
  password: string;
}

interface OracleSessionSummary {
  sessionId: number;
  displayName: string;
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

const connection = reactive<OracleConnectRequest>({
  host: "localhost",
  port: 1521,
  serviceName: "XEPDB1",
  username: "hr",
  password: "",
});

const queryText = ref(
  "select owner, object_name, object_type from all_objects fetch first 25 rows only",
);
const session = ref<OracleSessionSummary | null>(null);
const objects = ref<OracleObjectEntry[]>([]);
const selectedObject = ref<OracleObjectEntry | null>(null);
const ddlText = ref("");
const queryResult = ref<OracleQueryResult | null>(null);
const statusMessage = ref("Ready. Connect to an Oracle session to begin.");
const errorMessage = ref("");

const busy = reactive({
  connecting: false,
  loadingObjects: false,
  loadingDdl: false,
  savingDdl: false,
  runningQuery: false,
});

const isConnected = computed(() => session.value !== null);

const groupedObjects = computed(() => {
  const grouped = new Map<string, Map<string, OracleObjectEntry[]>>();

  for (const entry of objects.value) {
    let byType = grouped.get(entry.schema);
    if (!byType) {
      byType = new Map<string, OracleObjectEntry[]>();
      grouped.set(entry.schema, byType);
    }

    let entries = byType.get(entry.objectType);
    if (!entries) {
      entries = [];
      byType.set(entry.objectType, entries);
    }

    entries.push(entry);
  }

  return Array.from(grouped.entries()).map(([schema, byType]) => ({
    schema,
    byType: Array.from(byType.entries()).map(([objectType, entries]) => ({
      objectType,
      entries,
    })),
  }));
});

async function connectOracle(): Promise<void> {
  errorMessage.value = "";
  busy.connecting = true;

  try {
    const summary = await invoke<OracleSessionSummary>("oracle_connect", {
      request: connection,
    });

    session.value = summary;
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
    selectedObject.value = null;
    ddlText.value = "";
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
    ddlText.value = await invoke<string>("oracle_get_object_ddl", {
      request: {
        sessionId: session.value.sessionId,
        schema: object.schema,
        objectType: object.objectType,
        objectName: object.objectName,
      },
    });

    statusMessage.value = `Loaded DDL: ${object.schema}.${object.objectName}`;
  } catch (error) {
    errorMessage.value = toErrorMessage(error);
    ddlText.value = "";
  } finally {
    busy.loadingDdl = false;
  }
}

async function saveDdl(): Promise<void> {
  if (!session.value || !selectedObject.value) {
    return;
  }

  errorMessage.value = "";
  busy.savingDdl = true;

  try {
    const message = await invoke<string>("oracle_update_object_ddl", {
      request: {
        sessionId: session.value.sessionId,
        schema: selectedObject.value.schema,
        objectType: selectedObject.value.objectType,
        objectName: selectedObject.value.objectName,
        ddl: ddlText.value,
      },
    });

    statusMessage.value = `${selectedObject.value.objectName}: ${message}`;
  } catch (error) {
    errorMessage.value = toErrorMessage(error);
  } finally {
    busy.savingDdl = false;
  }
}

async function runQuery(): Promise<void> {
  if (!session.value) {
    return;
  }

  errorMessage.value = "";
  busy.runningQuery = true;

  try {
    const result = await invoke<OracleQueryResult>("oracle_run_query", {
      request: {
        sessionId: session.value.sessionId,
        sql: queryText.value,
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
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <div>
        <h1>Clarity</h1>
        <p class="subtitle">Oracle Workspace (MVP)</p>
      </div>
      <div class="session-pill" :class="{ on: isConnected }">
        {{ session ? session.displayName : "Not Connected" }}
      </div>
    </header>

    <section class="status-area">
      <p class="status">{{ statusMessage }}</p>
      <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
    </section>

    <section class="layout-grid">
      <aside class="panel connection-panel">
        <h2>Connection</h2>

        <label>
          Host
          <input v-model.trim="connection.host" placeholder="db.example.com" />
        </label>

        <label>
          Port
          <input v-model.number="connection.port" type="number" min="1" max="65535" />
        </label>

        <label>
          Service Name
          <input v-model.trim="connection.serviceName" placeholder="XEPDB1" />
        </label>

        <label>
          Username
          <input v-model.trim="connection.username" placeholder="hr" />
        </label>

        <label>
          Password
          <input v-model="connection.password" type="password" placeholder="********" />
        </label>

        <div class="row-actions">
          <button
            class="primary"
            :disabled="busy.connecting || isConnected"
            @click="connectOracle"
          >
            {{ busy.connecting ? "Connecting..." : "Connect" }}
          </button>
          <button :disabled="!isConnected" @click="disconnectOracle">Disconnect</button>
        </div>
      </aside>

      <section class="panel explorer-panel">
        <div class="panel-head">
          <h2>Schema Explorer</h2>
          <button :disabled="!isConnected || busy.loadingObjects" @click="refreshObjects">
            {{ busy.loadingObjects ? "Refreshing..." : "Refresh" }}
          </button>
        </div>

        <div class="explorer-scroll">
          <p v-if="!objects.length" class="muted">No objects loaded.</p>
          <div v-for="schemaBlock in groupedObjects" :key="schemaBlock.schema" class="schema-block">
            <h3>{{ schemaBlock.schema }}</h3>
            <div v-for="typeBlock in schemaBlock.byType" :key="`${schemaBlock.schema}-${typeBlock.objectType}`">
              <h4>{{ typeBlock.objectType }}</h4>
              <button
                v-for="entry in typeBlock.entries"
                :key="`${entry.schema}-${entry.objectType}-${entry.objectName}`"
                class="object-link"
                :class="{ selected: selectedObject?.schema === entry.schema && selectedObject?.objectName === entry.objectName && selectedObject?.objectType === entry.objectType }"
                @click="loadDdl(entry)"
              >
                {{ entry.objectName }}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section class="panel editor-panel">
        <div class="panel-head">
          <h2>Query Editor</h2>
          <button class="primary" :disabled="!isConnected || busy.runningQuery" @click="runQuery">
            {{ busy.runningQuery ? "Running..." : "Run" }}
          </button>
        </div>

        <textarea
          v-model="queryText"
          class="sql-input"
          spellcheck="false"
          placeholder="Write Oracle SQL here"
        />

        <h3>Results</h3>
        <div class="results-scroll">
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

      <section class="panel ddl-panel">
        <div class="panel-head">
          <h2>Object DDL</h2>
          <button
            class="primary"
            :disabled="!selectedObject || busy.savingDdl"
            @click="saveDdl"
          >
            {{ busy.savingDdl ? "Saving..." : "Save" }}
          </button>
        </div>

        <p class="muted">
          {{
            selectedObject
              ? `${selectedObject.schema}.${selectedObject.objectName} (${selectedObject.objectType})`
              : "Select an object from the explorer."
          }}
        </p>

        <textarea
          v-model="ddlText"
          class="ddl-input"
          spellcheck="false"
          placeholder="DDL source will appear here"
          :disabled="!selectedObject"
        />
      </section>
    </section>
  </main>
</template>

<style>
:root {
  font-family: "Avenir Next", "Segoe UI", sans-serif;
  color: #10181f;
  background: radial-gradient(circle at top left, #f8fbff 0%, #eef4f8 45%, #e8edf2 100%);
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
}

#app {
  min-height: 100vh;
}

.app-shell {
  width: min(1440px, 96vw);
  margin: 0 auto;
  padding: 1.2rem 0 1.6rem;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.8rem;
}

h1 {
  margin: 0;
  font-size: 1.8rem;
}

.subtitle {
  margin: 0.2rem 0 0;
  color: #4c5d6d;
}

.session-pill {
  padding: 0.35rem 0.7rem;
  border-radius: 999px;
  background: #ccd7e3;
  color: #2f3f4f;
  font-size: 0.85rem;
  white-space: nowrap;
}

.session-pill.on {
  background: #b6e2cf;
  color: #12563a;
}

.status-area {
  margin-bottom: 0.8rem;
}

.status,
.error {
  margin: 0.2rem 0;
}

.error {
  color: #8f1c2b;
}

.layout-grid {
  display: grid;
  grid-template-columns: 280px 320px 1fr;
  grid-template-areas:
    "connection explorer editor"
    "connection ddl ddl";
  gap: 0.8rem;
}

.panel {
  background: #ffffffcc;
  border: 1px solid #d7e1ea;
  border-radius: 14px;
  padding: 0.8rem;
  backdrop-filter: blur(3px);
}

.connection-panel {
  grid-area: connection;
}

.explorer-panel {
  grid-area: explorer;
}

.editor-panel {
  grid-area: editor;
}

.ddl-panel {
  grid-area: ddl;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
}

h2,
h3,
h4 {
  margin: 0;
}

h2 {
  font-size: 1rem;
}

h3 {
  font-size: 0.92rem;
  margin: 0.6rem 0 0.4rem;
}

h4 {
  font-size: 0.8rem;
  margin: 0.45rem 0 0.2rem;
  color: #5b6d7f;
}

label {
  display: block;
  font-size: 0.84rem;
  margin-top: 0.55rem;
  color: #304254;
}

input,
button,
textarea {
  font: inherit;
  color: inherit;
}

input,
textarea {
  width: 100%;
  margin-top: 0.25rem;
  border: 1px solid #c0cedb;
  border-radius: 10px;
  padding: 0.48rem 0.58rem;
  background: #fbfdff;
}

button {
  border: 1px solid #9fb0c1;
  border-radius: 9px;
  background: #f7fafc;
  padding: 0.45rem 0.72rem;
  cursor: pointer;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

button.primary {
  background: #173b56;
  border-color: #173b56;
  color: #f7fbff;
}

.row-actions {
  display: flex;
  gap: 0.4rem;
  margin-top: 0.7rem;
}

.explorer-scroll,
.results-scroll {
  margin-top: 0.55rem;
  max-height: 300px;
  overflow: auto;
  padding-right: 0.2rem;
}

.schema-block {
  border-top: 1px solid #e4ebf2;
  margin-top: 0.4rem;
  padding-top: 0.4rem;
}

.object-link {
  display: block;
  width: 100%;
  text-align: left;
  margin: 0.16rem 0;
  background: #f4f8fb;
}

.object-link.selected {
  background: #d3e7f8;
  border-color: #90bbdf;
}

.sql-input,
.ddl-input {
  min-height: 170px;
  resize: vertical;
  font-family: "SF Mono", "Menlo", monospace;
  font-size: 0.84rem;
  line-height: 1.35;
}

.results-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.84rem;
}

.results-table th,
.results-table td {
  border-bottom: 1px solid #e3ebf3;
  text-align: left;
  padding: 0.33rem;
}

.results-table th {
  background: #f2f8ff;
  position: sticky;
  top: 0;
}

.muted {
  color: #5b6d7f;
  font-size: 0.86rem;
}

@media (max-width: 1200px) {
  .layout-grid {
    grid-template-columns: 280px 1fr;
    grid-template-areas:
      "connection explorer"
      "editor editor"
      "ddl ddl";
  }
}

@media (max-width: 820px) {
  .app-shell {
    width: min(96vw, 720px);
    padding-top: 0.8rem;
  }

  .topbar {
    flex-direction: column;
    align-items: flex-start;
  }

  .layout-grid {
    grid-template-columns: 1fr;
    grid-template-areas:
      "connection"
      "explorer"
      "editor"
      "ddl";
  }
}
</style>
