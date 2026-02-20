<script setup lang="ts">
import AppIcon from "./AppIcon.vue";
import SqlCodeEditor from "./SqlCodeEditor.vue";
import type {
  BusyState,
  ObjectDetailTabDefinition,
  ObjectDetailTabId,
  OracleObjectEntry,
  OracleQueryResult,
  OracleSourceSearchResult,
  WorkspaceDdlTab,
  WorkspaceQueryTab,
} from "../types/clarity";

const queryText = defineModel<string>("queryText", { required: true });
const ddlText = defineModel<string>("ddlText", { required: true });
const queryRowLimit = defineModel<number>("queryRowLimit", { required: true });
const sourceSearchText = defineModel<string>("sourceSearchText", { required: true });

const props = defineProps<{
  statusMessage: string;
  queryTabs: WorkspaceQueryTab[];
  ddlTabs: WorkspaceDdlTab[];
  activeWorkspaceTabId: string;
  isSearchTabActive: boolean;
  isConnected: boolean;
  busy: BusyState;
  activeQueryTab: WorkspaceQueryTab | null;
  activeDdlTab: WorkspaceDdlTab | null;
  activeDdlObject: OracleObjectEntry | null;
  activeObjectDetailTabs: ObjectDetailTabDefinition[];
  activeObjectDetailTabId: ObjectDetailTabId | null;
  activeObjectDetailLoading: boolean;
  activeObjectDetailResult: OracleQueryResult | null;
  selectedProviderLabel: string;
  connectedSchema: string;
  isQueryTabActive: boolean;
  sourceSearchResults: OracleSourceSearchResult[];
  sourceSearchPerformed: boolean;
  onActivateWorkspaceTab: (tabId: string) => void;
  onCloseQueryTab: (tabId: string) => void;
  onAddQueryTab: () => void;
  onOpenSearchTab: () => void;
  onCloseDdlTab: (tabId: string) => void;
  onRunQuery: () => void;
  onSaveDdl: () => void;
  onRefreshActiveObjectDetail: () => void;
  onActivateObjectDetailTab: (tabId: ObjectDetailTabId) => void;
  onRunSourceSearch: () => void;
  onOpenSourceSearchResult: (result: OracleSourceSearchResult) => void;
  isLikelyNumeric: (value: string) => boolean;
}>();
</script>

<template>
  <header class="workspace-toolbar">
    <div class="toolbar-title">SQL Worksheet</div>
    <div class="toolbar-status">{{ props.statusMessage }}</div>
  </header>

  <section class="sheet-pane">
    <div class="sheet-tabs">
      <div
        v-for="tab in props.queryTabs"
        :key="tab.id"
        class="sheet-tab-wrap"
        :class="{ active: props.activeWorkspaceTabId === tab.id }"
      >
        <button class="sheet-tab" @click="props.onActivateWorkspaceTab(tab.id)">
          {{ tab.title }}
        </button>
        <button
          v-if="props.queryTabs.length > 1"
          class="sheet-tab-close"
          title="Close tab"
          @click.stop="props.onCloseQueryTab(tab.id)"
        >
          <AppIcon name="close" class="sheet-tab-icon" aria-hidden="true" />
        </button>
      </div>
      <button class="sheet-tab-add" title="New query tab" @click="props.onAddQueryTab">
        <AppIcon name="plus" class="sheet-tab-icon" aria-hidden="true" />
      </button>
      <div class="sheet-tab-wrap" :class="{ active: props.isSearchTabActive }">
        <button class="sheet-tab sheet-tab-search" @click="props.onOpenSearchTab">
          <AppIcon name="search" class="sheet-tab-icon" aria-hidden="true" />
          Code Search
        </button>
      </div>
      <div
        v-for="tab in props.ddlTabs"
        :key="tab.id"
        class="sheet-tab-wrap"
        :class="{ active: props.activeWorkspaceTabId === tab.id }"
      >
        <button class="sheet-tab" @click="props.onActivateWorkspaceTab(tab.id)">
          {{ tab.object.objectName }}
        </button>
        <button class="sheet-tab-close" title="Close tab" @click.stop="props.onCloseDdlTab(tab.id)">
          <AppIcon name="close" class="sheet-tab-icon" aria-hidden="true" />
        </button>
      </div>
      <div class="sheet-tab-fill"></div>
      <label class="query-limit-control" title="Maximum rows returned for worksheet queries">
        Rows
        <input v-model.number="queryRowLimit" type="number" min="1" max="10000" step="1" />
      </label>
      <button
        class="btn primary"
        :disabled="!props.isConnected || !props.activeQueryTab || props.busy.runningQuery"
        @click="props.onRunQuery"
      >
        <AppIcon name="play" class="btn-icon" aria-hidden="true" />
        {{ props.busy.runningQuery ? "Running..." : "Execute" }}
      </button>
      <button
        class="btn"
        :disabled="!props.activeDdlTab || props.activeObjectDetailTabId !== 'ddl' || props.busy.savingDdl"
        @click="props.onSaveDdl"
      >
        <AppIcon name="save" class="btn-icon" aria-hidden="true" />
        {{ props.busy.savingDdl ? "Saving..." : "Save DDL" }}
      </button>
      <span class="schema-chip">Provider: {{ props.selectedProviderLabel }}</span>
      <span class="schema-chip">Schema: {{ props.connectedSchema }}</span>
    </div>

    <SqlCodeEditor
      v-if="props.isQueryTabActive"
      v-model="queryText"
      class="sql-editor"
      placeholder="Write SQL here"
    />

    <section v-else-if="props.activeDdlTab" class="ddl-pane">
      <div class="ddl-header">
        <div class="muted">
          {{
            props.activeDdlObject
              ? `${props.activeDdlObject.schema}.${props.activeDdlObject.objectName} (${props.activeDdlObject.objectType})`
              : "Select an object from Object Explorer."
          }}
        </div>
        <button
          class="btn"
          :disabled="
            !props.activeDdlTab ||
            props.activeObjectDetailTabId === 'ddl' ||
            !props.activeObjectDetailTabId ||
            props.activeObjectDetailLoading
          "
          @click="props.onRefreshActiveObjectDetail"
        >
          {{ props.activeObjectDetailLoading ? "Refreshing..." : "Refresh Detail" }}
        </button>
      </div>

      <div class="object-detail-tabs">
        <button
          v-for="detailTab in props.activeObjectDetailTabs"
          :key="detailTab.id"
          class="object-detail-tab"
          :class="{ active: props.activeObjectDetailTabId === detailTab.id }"
          @click="props.onActivateObjectDetailTab(detailTab.id)"
        >
          {{ detailTab.label }}
        </button>
      </div>

      <SqlCodeEditor
        v-if="props.activeObjectDetailTabId === 'ddl'"
        v-model="ddlText"
        class="ddl-editor"
        placeholder="Object DDL will appear here"
        :target-line="props.activeDdlTab.focusLine"
        :focus-token="props.activeDdlTab.focusToken"
      />

      <section v-else class="object-detail-grid-pane">
        <p v-if="props.activeObjectDetailLoading" class="muted">Loading object detail...</p>
        <p v-else-if="!props.activeObjectDetailResult" class="muted">
          Select a detail tab to load information for this object.
        </p>
        <template v-else>
          <p class="muted">{{ props.activeObjectDetailResult.message }}</p>
          <p v-if="props.activeObjectDetailResult.rowsAffected !== null" class="muted">
            Rows affected: {{ props.activeObjectDetailResult.rowsAffected }}
          </p>
          <p v-else-if="!props.activeObjectDetailResult.columns.length" class="muted">No rows returned.</p>
          <div v-else class="object-detail-grid-wrap">
            <table class="results-table">
              <thead>
                <tr>
                  <th v-for="column in props.activeObjectDetailResult.columns" :key="column">{{ column }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, rowIndex) in props.activeObjectDetailResult.rows" :key="`obj-row-${rowIndex}`">
                  <td
                    v-for="(value, colIndex) in row"
                    :key="`obj-col-${rowIndex}-${colIndex}`"
                    :class="{ 'results-cell-number': props.isLikelyNumeric(value) }"
                  >
                    {{ value }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </section>
    </section>

    <section v-else-if="props.isSearchTabActive" class="source-search-pane">
      <div class="source-search-toolbar">
        <input
          v-model="sourceSearchText"
          class="source-search-input"
          placeholder="Search procedures, packages, functions, triggers, and types"
          @keydown.enter.prevent="props.onRunSourceSearch"
        />
        <button
          class="btn primary"
          :disabled="!props.isConnected || props.busy.searchingSource || !sourceSearchText.trim()"
          @click="props.onRunSourceSearch"
        >
          <AppIcon name="search" class="btn-icon" aria-hidden="true" />
          {{ props.busy.searchingSource ? "Searching..." : "Search" }}
        </button>
      </div>

      <div class="source-search-content">
        <p v-if="!props.sourceSearchPerformed" class="muted">Run a search to find matching code lines.</p>
        <p v-else-if="!props.sourceSearchResults.length" class="muted">No matches found.</p>

        <table v-else class="source-search-table">
          <thead>
            <tr>
              <th>Object</th>
              <th>Type</th>
              <th>Line</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="match in props.sourceSearchResults"
              :key="`${match.schema}:${match.objectType}:${match.objectName}:${match.line}:${match.text}`"
            >
              <td>
                <button class="source-result-link" @click="props.onOpenSourceSearchResult(match)">
                  {{ match.schema }}.{{ match.objectName }}
                </button>
              </td>
              <td>{{ match.objectType }}</td>
              <td class="results-cell-number">{{ match.line }}</td>
              <td class="source-search-line">{{ match.text }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </section>
</template>

<style scoped>
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

.sheet-tab-search {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
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

.query-limit-control {
  margin-left: 0.5rem;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.72rem;
  color: var(--text-secondary);
}

.query-limit-control input {
  width: 5.25rem;
  padding: 0.28rem 0.38rem;
  font-size: 0.74rem;
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

.source-search-pane {
  display: grid;
  grid-template-rows: auto 1fr;
  min-height: 0;
  overflow: hidden;
}

.source-search-toolbar {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.55rem;
  border-bottom: 1px solid var(--border);
  background: var(--bg-surface-muted);
}

.source-search-input {
  width: min(34rem, 100%);
}

.source-search-content {
  overflow: auto;
  min-height: 0;
  font-family: Consolas, "Courier New", monospace;
}

.source-search-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.78rem;
}

.source-search-table th,
.source-search-table td {
  border: 1px solid var(--border);
  text-align: left;
  padding: 0.32rem 0.44rem;
}

.source-search-table th {
  position: sticky;
  top: 0;
  background: var(--bg-surface-muted);
  z-index: 1;
}

.source-result-link {
  border: 0;
  background: transparent;
  color: var(--accent-strong);
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.source-result-link:hover {
  color: #2b4a6f;
}

.source-search-line {
  white-space: pre;
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
  grid-template-rows: auto auto 1fr;
  min-height: 0;
  overflow: hidden;
}

.ddl-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.6rem;
  padding: 0.55rem;
  border-bottom: 1px solid var(--border);
  background: var(--bg-surface-muted);
}

.object-detail-tabs {
  display: flex;
  align-items: center;
  gap: 0;
  border-bottom: 1px solid var(--border);
  background: var(--bg-surface-muted);
}

.object-detail-tab {
  border: 0;
  border-right: 1px solid var(--border);
  background: transparent;
  padding: 0.42rem 0.68rem;
  font-size: 0.76rem;
  color: var(--text-secondary);
  cursor: pointer;
}

.object-detail-tab:hover {
  background: var(--bg-hover);
}

.object-detail-tab.active {
  background: var(--bg-surface);
  color: var(--text-primary);
  font-weight: 600;
}

.object-detail-grid-pane {
  min-height: 0;
  overflow: hidden;
  padding: 0.55rem;
  display: grid;
  grid-template-rows: auto auto 1fr;
  gap: 0.45rem;
}

.object-detail-grid-wrap {
  min-height: 0;
  overflow: auto;
}

.muted {
  color: var(--text-secondary);
  font-size: 0.76rem;
}
</style>
