<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import AppIcon from "./AppIcon.vue";
import SqlCodeEditor from "./SqlCodeEditor.vue";
import type {
  BusyState,
  ObjectDetailTabDefinition,
  ObjectDetailTabId,
  OracleObjectEntry,
  OracleQueryResult,
  OracleSchemaSearchResult,
  SqlCompletionSchema,
  WorkspaceDdlTab,
  WorkspaceQueryTab,
} from "../types/clarity";
import type { ThemeSetting } from "../types/settings";

const queryText = defineModel<string>("queryText", { required: true });
const ddlText = defineModel<string>("ddlText", { required: true });
const queryRowLimit = defineModel<number>("queryRowLimit", { required: true });
const schemaSearchText = defineModel<string>("schemaSearchText", { required: true });
const schemaSearchIncludeObjectNames = defineModel<boolean>("schemaSearchIncludeObjectNames", { required: true });
const schemaSearchIncludeSource = defineModel<boolean>("schemaSearchIncludeSource", { required: true });
const schemaSearchIncludeDdl = defineModel<boolean>("schemaSearchIncludeDdl", { required: true });

const props = defineProps<{
  statusMessage: string;
  queryTabs: WorkspaceQueryTab[];
  ddlTabs: WorkspaceDdlTab[];
  activeWorkspaceTabId: string;
  isSearchTabActive: boolean;
  schemaSearchFocusToken: number;
  isConnected: boolean;
  busy: BusyState;
  activeQueryTab: WorkspaceQueryTab | null;
  activeDdlTab: WorkspaceDdlTab | null;
  activeDdlObject: OracleObjectEntry | null;
  activeObjectDetailTabs: ObjectDetailTabDefinition[];
  activeObjectDetailTabId: ObjectDetailTabId | null;
  activeObjectDetailLoading: boolean;
  activeObjectDetailResult: OracleQueryResult | null;
  isActiveObjectDataEditable: boolean;
  selectedProviderLabel: string;
  connectedSchema: string;
  sqlCompletionSchema: SqlCompletionSchema;
  sqlCompletionDefaultSchema: string;
  isQueryTabActive: boolean;
  schemaSearchResults: OracleSchemaSearchResult[];
  schemaSearchPerformed: boolean;
  aiSuggestionText: string;
  aiSuggestionRationale: string;
  aiSuggestionError: string;
  aiSuggestionConfidence: number | null;
  aiSuggestionMutating: boolean;
  aiSuggestionLoading: boolean;
  canUseAiSuggestions: boolean;
  theme: ThemeSetting;
  onActivateWorkspaceTab: (tabId: string) => void;
  onCloseQueryTab: (tabId: string) => void;
  onAddQueryTab: () => void;
  onOpenSearchTab: () => void;
  onOpenSettings: () => void;
  onCloseDdlTab: (tabId: string) => void;
  onRunQuery: () => void;
  onSaveDdl: () => void;
  onRefreshActiveObjectDetail: () => void;
  onUpdateActiveObjectDataRow: (rowIndex: number, values: string[]) => Promise<boolean>;
  onInsertActiveObjectDataRow: (values: string[]) => Promise<boolean>;
  onActivateObjectDetailTab: (tabId: ObjectDetailTabId) => void;
  onRunSchemaSearch: () => void;
  onOpenSchemaSearchResult: (result: OracleSchemaSearchResult) => void;
  onRequestAiSuggestion: () => void;
  onApplyAiSuggestion: () => void;
  onDismissAiSuggestion: () => void;
  isLikelyNumeric: (value: string) => boolean;
}>();

const dataDraftRows = ref<string[][]>([]);
const committingDataChanges = ref(false);
const suppressDraftSync = ref(false);
const objectDetailGridWrapEl = ref<HTMLElement | null>(null);
const schemaSearchInputEl = ref<HTMLInputElement | null>(null);
const MIN_COLUMN_WIDTH = 88;
const DEFAULT_COLUMN_WIDTH = 180;

const isDataDetailTab = computed<boolean>(() => props.activeObjectDetailTabId === "data");
const showEditableRowActions = computed<boolean>(() => {
  if (!isDataDetailTab.value || !props.isActiveObjectDataEditable || !props.activeObjectDetailResult) {
    return false;
  }

  return props.activeObjectDetailResult.columns.length > 0;
});
const sourceDataRows = computed<string[][]>(() => props.activeObjectDetailResult?.rows ?? []);
const sourceDataRowCount = computed<number>(() => sourceDataRows.value.length);
const displayedDataRows = computed<string[][]>(() => {
  if (showEditableRowActions.value) {
    return dataDraftRows.value;
  }

  return sourceDataRows.value;
});
const editableColumnCount = computed<number>(() => props.activeObjectDetailResult?.columns.length ?? 0);
const hasAiSuggestion = computed<boolean>(() => props.aiSuggestionText.trim().length > 0);
const objectDetailColumns = computed<string[]>(() => props.activeObjectDetailResult?.columns ?? []);
const objectDetailColumnWidths = ref<number[]>([]);

type ColumnResizeState = {
  index: number;
  startX: number;
  startWidth: number;
};

const objectDetailResizeState = ref<ColumnResizeState | null>(null);

const objectDetailColumnKey = computed<string>(() => objectDetailColumns.value.join("\u001f"));

function cloneRows(rows: string[][]): string[][] {
  return rows.map((row) => [...row]);
}

function syncDraftRowsFromResult(): void {
  if (!showEditableRowActions.value || !props.activeObjectDetailResult) {
    dataDraftRows.value = [];
    return;
  }

  dataDraftRows.value = cloneRows(props.activeObjectDetailResult.rows);
}

function onCellDraftInput(rowIndex: number, colIndex: number, event: Event): void {
  const target = event.target as HTMLInputElement | null;
  if (!target) {
    return;
  }

  if (!dataDraftRows.value[rowIndex]) {
    dataDraftRows.value[rowIndex] = [];
  }

  dataDraftRows.value[rowIndex][colIndex] = target.value;
}

function addDraftRow(): void {
  if (!showEditableRowActions.value || committingDataChanges.value || editableColumnCount.value < 1) {
    return;
  }

  const newRow = Array.from({ length: editableColumnCount.value }, () => "");
  const newRowIndex = dataDraftRows.value.length;
  dataDraftRows.value = [...dataDraftRows.value, newRow];

  void nextTick(() => {
    const gridWrap = objectDetailGridWrapEl.value;
    if (!gridWrap) {
      return;
    }

    gridWrap.scrollTop = gridWrap.scrollHeight;
    const firstCellInput = gridWrap.querySelector<HTMLInputElement>(
      `tr[data-draft-row="${newRowIndex}"] input.cell-editor`,
    );
    firstCellInput?.focus();
  });
}

function isRowDirty(rowIndex: number): boolean {
  if (!showEditableRowActions.value || !props.activeObjectDetailResult) {
    return false;
  }

  const sourceRow = sourceDataRows.value[rowIndex];
  const draftRow = dataDraftRows.value[rowIndex];
  if (!draftRow) {
    return false;
  }

  if (!sourceRow) {
    return draftRow.some((value) => value !== "");
  }

  if (sourceRow.length !== draftRow.length) {
    return true;
  }

  return sourceRow.some((value, colIndex) => value !== draftRow[colIndex]);
}

const dirtyRowIndexes = computed<number[]>(() => {
  if (!showEditableRowActions.value) {
    return [];
  }

  const dirtyIndexes: number[] = [];
  for (let rowIndex = 0; rowIndex < dataDraftRows.value.length; rowIndex += 1) {
    if (isRowDirty(rowIndex)) {
      dirtyIndexes.push(rowIndex);
    }
  }

  return dirtyIndexes;
});

const hasPendingDataChanges = computed<boolean>(() => dirtyRowIndexes.value.length > 0);
const hasDraftStructureChanges = computed<boolean>(() => {
  if (!showEditableRowActions.value) {
    return false;
  }

  return dataDraftRows.value.length !== sourceDataRowCount.value;
});
const canRevertDataChanges = computed<boolean>(() => hasPendingDataChanges.value || hasDraftStructureChanges.value);

function revertDataChanges(): void {
  if (!canRevertDataChanges.value || committingDataChanges.value) {
    return;
  }

  syncDraftRowsFromResult();
}

async function commitDataChanges(): Promise<void> {
  if (!hasPendingDataChanges.value || committingDataChanges.value) {
    return;
  }

  const dirtyIndexes = [...dirtyRowIndexes.value];
  let completedAllUpdates = true;
  let insertedRows = false;
  const originalRowCount = sourceDataRowCount.value;

  committingDataChanges.value = true;
  suppressDraftSync.value = true;
  try {
    for (const rowIndex of dirtyIndexes) {
      const rowValues = dataDraftRows.value[rowIndex];
      if (!rowValues) {
        continue;
      }

      const didSave =
        rowIndex < originalRowCount
          ? await props.onUpdateActiveObjectDataRow(rowIndex, [...rowValues])
          : await props.onInsertActiveObjectDataRow([...rowValues]);
      if (!didSave) {
        completedAllUpdates = false;
        break;
      }

      if (rowIndex >= originalRowCount) {
        insertedRows = true;
        dataDraftRows.value[rowIndex] = Array.from({ length: rowValues.length }, () => "");
      }
    }
  } finally {
    suppressDraftSync.value = false;
    committingDataChanges.value = false;
  }

  if (completedAllUpdates) {
    syncDraftRowsFromResult();
    if (insertedRows) {
      props.onRefreshActiveObjectDetail();
    }
  }
}

watch(
  () => [
    props.activeWorkspaceTabId,
    props.activeObjectDetailTabId,
    props.activeObjectDetailResult,
    props.isActiveObjectDataEditable,
  ],
  () => {
    if (suppressDraftSync.value) {
      return;
    }

    syncDraftRowsFromResult();
  },
  { immediate: true },
);

watch(
  () => [props.activeWorkspaceTabId, props.activeObjectDetailTabId, objectDetailColumnKey.value],
  () => {
    objectDetailColumnWidths.value = objectDetailColumns.value.map(() => DEFAULT_COLUMN_WIDTH);
  },
  { immediate: true },
);

function getObjectDetailColumnWidth(index: number): number {
  return objectDetailColumnWidths.value[index] ?? DEFAULT_COLUMN_WIDTH;
}

function onObjectDetailColumnResizeMove(event: MouseEvent): void {
  const state = objectDetailResizeState.value;
  if (!state) {
    return;
  }

  const nextWidth = Math.max(MIN_COLUMN_WIDTH, state.startWidth + (event.clientX - state.startX));
  const nextWidths = [...objectDetailColumnWidths.value];
  nextWidths[state.index] = nextWidth;
  objectDetailColumnWidths.value = nextWidths;
}

function stopObjectDetailColumnResize(): void {
  if (!objectDetailResizeState.value) {
    return;
  }

  objectDetailResizeState.value = null;
  window.removeEventListener("mousemove", onObjectDetailColumnResizeMove);
  window.removeEventListener("mouseup", stopObjectDetailColumnResize);
}

function startObjectDetailColumnResize(index: number, event: MouseEvent): void {
  if (event.button !== 0) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  objectDetailResizeState.value = {
    index,
    startX: event.clientX,
    startWidth: getObjectDetailColumnWidth(index),
  };
  window.addEventListener("mousemove", onObjectDetailColumnResizeMove);
  window.addEventListener("mouseup", stopObjectDetailColumnResize);
}

onBeforeUnmount(() => {
  stopObjectDetailColumnResize();
});

function focusSchemaSearchInput(selectText: boolean): void {
  void nextTick(() => {
    const input = schemaSearchInputEl.value;
    if (!input) {
      return;
    }

    input.focus();
    if (selectText) {
      input.select();
    }
  });
}

function formatSearchScopeLabel(scope: OracleSchemaSearchResult["matchScope"]): string {
  if (scope === "object_name") {
    return "Object Name";
  }
  if (scope === "ddl") {
    return "DDL";
  }
  return "Source";
}

watch(
  () => props.schemaSearchFocusToken,
  () => {
    focusSchemaSearchInput(true);
  },
);
</script>

<template>
  <header class="workspace-toolbar">
    <div class="toolbar-title">SQL Worksheet</div>
    <div class="toolbar-trailing">
      <div class="toolbar-status">{{ props.statusMessage }}</div>
      <button class="btn toolbar-settings-btn" title="Open settings" aria-label="Open settings" @click="props.onOpenSettings">
        <AppIcon name="settings" class="btn-icon" aria-hidden="true" />
      </button>
    </div>
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
          Search
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
        <input
          v-model.number="queryRowLimit"
          type="number"
          min="1"
          max="10000"
          step="1"
          spellcheck="false"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          data-gramm="false"
        />
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
        :disabled="!props.canUseAiSuggestions || !props.activeQueryTab || props.aiSuggestionLoading"
        @click="props.onRequestAiSuggestion"
      >
        <AppIcon name="search" class="btn-icon" aria-hidden="true" />
        {{ props.aiSuggestionLoading ? "Suggesting..." : "AI Suggest" }}
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

    <section v-if="props.isQueryTabActive" class="query-sheet-pane">
      <div
        v-if="props.aiSuggestionLoading || hasAiSuggestion || props.aiSuggestionError"
        class="ai-suggestion-banner"
        :class="{ warning: hasAiSuggestion && props.aiSuggestionMutating, error: !!props.aiSuggestionError }"
      >
        <div class="ai-suggestion-body">
          <p v-if="props.aiSuggestionLoading" class="ai-suggestion-text">Generating suggestion...</p>
          <p v-else-if="props.aiSuggestionError" class="ai-suggestion-text">{{ props.aiSuggestionError }}</p>
          <template v-else-if="hasAiSuggestion">
            <p class="ai-suggestion-text">{{ props.aiSuggestionText }}</p>
            <p v-if="props.aiSuggestionRationale" class="ai-suggestion-meta">
              {{ props.aiSuggestionRationale }}
            </p>
            <p v-if="props.aiSuggestionConfidence !== null" class="ai-suggestion-meta">
              Confidence: {{ Math.round(props.aiSuggestionConfidence * 100) }}%
            </p>
            <p v-if="props.aiSuggestionMutating" class="ai-suggestion-meta ai-suggestion-warning">
              Potentially mutating SQL detected.
            </p>
          </template>
        </div>
        <div class="ai-suggestion-actions">
          <button
            class="btn"
            :disabled="!hasAiSuggestion || props.aiSuggestionLoading"
            @click="props.onApplyAiSuggestion"
          >
            Apply (Tab)
          </button>
          <button
            class="btn"
            :disabled="(!hasAiSuggestion && !props.aiSuggestionError) || props.aiSuggestionLoading"
            @click="props.onDismissAiSuggestion"
          >
            Dismiss (Esc)
          </button>
        </div>
      </div>

      <SqlCodeEditor
        v-model="queryText"
        class="sql-editor"
        placeholder="Write SQL here"
        :completion-schema="props.sqlCompletionSchema"
        :completion-default-schema="props.sqlCompletionDefaultSchema"
        :theme="props.theme"
        :ai-suggestion-active="hasAiSuggestion"
        @request-ai-suggestion="props.onRequestAiSuggestion"
        @accept-ai-suggestion="props.onApplyAiSuggestion"
        @dismiss-ai-suggestion="props.onDismissAiSuggestion"
      />
    </section>

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
        :completion-schema="props.sqlCompletionSchema"
        :completion-default-schema="props.sqlCompletionDefaultSchema"
        :theme="props.theme"
      />

      <section v-else class="object-detail-grid-pane" :class="{ 'is-data-view': isDataDetailTab }">
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
          <template v-else>
            <p v-if="showEditableRowActions" class="muted object-detail-hint">
              Cells are editable. Use Add Row, Revert, or Commit below.
            </p>
            <p v-else-if="isDataDetailTab" class="muted object-detail-hint">
              Data preview is read-only for this object type.
            </p>
            <div ref="objectDetailGridWrapEl" class="object-detail-grid-wrap">
              <table class="results-table" :class="{ 'is-resizing': !!objectDetailResizeState }">
                <thead>
                  <tr>
                    <th
                      v-for="(column, columnIndex) in props.activeObjectDetailResult.columns"
                      :key="column"
                      :style="{
                        width: `${getObjectDetailColumnWidth(columnIndex)}px`,
                        minWidth: `${getObjectDetailColumnWidth(columnIndex)}px`,
                        maxWidth: `${getObjectDetailColumnWidth(columnIndex)}px`,
                      }"
                    >
                      <span class="results-cell-text" :title="column">{{ column }}</span>
                      <button
                        class="results-col-resize-handle"
                        type="button"
                        tabindex="-1"
                        aria-hidden="true"
                        @mousedown="startObjectDetailColumnResize(columnIndex, $event)"
                      ></button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(row, rowIndex) in displayedDataRows"
                    :key="`obj-row-${rowIndex}`"
                    :data-draft-row="rowIndex"
                    :class="{
                      'results-row-dirty': showEditableRowActions && isRowDirty(rowIndex),
                      'results-row-new': showEditableRowActions && rowIndex >= sourceDataRowCount,
                    }"
                  >
                    <td
                      v-for="(value, colIndex) in row"
                      :key="`obj-col-${rowIndex}-${colIndex}`"
                      :class="{ 'results-cell-number': props.isLikelyNumeric(value) }"
                      :style="{
                        width: `${getObjectDetailColumnWidth(colIndex)}px`,
                        minWidth: `${getObjectDetailColumnWidth(colIndex)}px`,
                        maxWidth: `${getObjectDetailColumnWidth(colIndex)}px`,
                      }"
                    >
                      <input
                        v-if="showEditableRowActions"
                        class="cell-editor"
                        :value="value"
                        :disabled="committingDataChanges"
                        spellcheck="false"
                        autocomplete="off"
                        autocorrect="off"
                        autocapitalize="off"
                        data-gramm="false"
                        @input="onCellDraftInput(rowIndex, colIndex, $event)"
                        @keydown.meta.enter.prevent="commitDataChanges"
                        @keydown.ctrl.enter.prevent="commitDataChanges"
                        @keydown.esc.prevent="revertDataChanges"
                      />
                      <template v-else>
                        <span class="results-cell-text" :title="value">{{ value }}</span>
                      </template>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="showEditableRowActions" class="object-detail-edit-toolbar">
              <div class="object-detail-edit-leading">
                <button class="btn row-action-btn" :disabled="committingDataChanges" @click="addDraftRow">Add Row</button>
                <div class="muted">Pending row changes: {{ dirtyRowIndexes.length }}</div>
              </div>
              <div class="object-detail-edit-actions">
                <button class="btn row-action-btn" :disabled="!canRevertDataChanges || committingDataChanges" @click="revertDataChanges">
                  Revert
                </button>
                <button
                  class="btn row-action-btn primary"
                  :disabled="!hasPendingDataChanges || committingDataChanges"
                  @click="commitDataChanges"
                >
                  {{ committingDataChanges ? "Committing..." : "Commit" }}
                </button>
              </div>
            </div>
          </template>
        </template>
      </section>
    </section>

    <section v-else-if="props.isSearchTabActive" class="source-search-pane">
      <div class="source-search-toolbar">
        <input
          ref="schemaSearchInputEl"
          v-model="schemaSearchText"
          class="source-search-input"
          placeholder="Search object names, source, and DDL in this schema"
          spellcheck="false"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          data-gramm="false"
          @keydown.enter.prevent="props.onRunSchemaSearch"
        />
        <label class="search-scope-toggle">
          <input v-model="schemaSearchIncludeObjectNames" type="checkbox" />
          Object names
        </label>
        <label class="search-scope-toggle">
          <input v-model="schemaSearchIncludeSource" type="checkbox" />
          Source
        </label>
        <label class="search-scope-toggle">
          <input v-model="schemaSearchIncludeDdl" type="checkbox" />
          DDL
        </label>
        <button
          class="btn primary"
          :disabled="
            !props.isConnected ||
            props.busy.searchingSchema ||
            !schemaSearchText.trim() ||
            (!schemaSearchIncludeObjectNames && !schemaSearchIncludeSource && !schemaSearchIncludeDdl)
          "
          @click="props.onRunSchemaSearch"
        >
          <AppIcon name="search" class="btn-icon" aria-hidden="true" />
          {{ props.busy.searchingSchema ? "Searching..." : "Search" }}
        </button>
      </div>

      <div class="source-search-content">
        <p v-if="!props.schemaSearchPerformed" class="muted">Run a schema search to find matching objects and text.</p>
        <p v-else-if="!props.schemaSearchResults.length" class="muted">No matches found.</p>

        <table v-else class="source-search-table">
          <thead>
            <tr>
              <th>Object</th>
              <th>Type</th>
              <th>Scope</th>
              <th>Line</th>
              <th>Snippet</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="match in props.schemaSearchResults"
              :key="`${match.schema}:${match.objectType}:${match.objectName}:${match.matchScope}:${match.line}:${match.snippet}`"
            >
              <td>
                <button class="source-result-link" @click="props.onOpenSchemaSearchResult(match)">
                  {{ match.schema }}.{{ match.objectName }}
                </button>
              </td>
              <td>{{ match.objectType }}</td>
              <td>{{ formatSearchScopeLabel(match.matchScope) }}</td>
              <td class="results-cell-number">{{ match.line ?? "-" }}</td>
              <td class="source-search-line">{{ match.snippet }}</td>
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
  border: 1px solid var(--control-border);
  border-radius: 6px;
  background: var(--control-bg);
  padding: 0.38rem 0.45rem;
}

input:focus-visible,
textarea:focus-visible,
button:focus-visible {
  outline: 1px solid var(--focus-ring);
  outline-offset: 1px;
}

.btn {
  border: 1px solid var(--control-border);
  border-radius: 6px;
  background: var(--control-bg);
  padding: 0.26rem 0.52rem;
  font-size: 0.73rem;
  cursor: pointer;
  transition: background-color 0.12s ease, border-color 0.12s ease;
  display: inline-flex;
  align-items: center;
  gap: 0.34rem;
}

.btn:hover:not(:disabled) {
  background: var(--control-hover);
  border-color: var(--control-border);
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
  gap: 0.6rem;
  height: var(--pane-header-height);
  padding: 0 0.68rem;
  border-bottom: 1px solid var(--panel-separator);
  background: var(--bg-surface-muted);
}

.toolbar-title {
  font-size: 0.77rem;
  font-weight: 500;
  letter-spacing: 0.01em;
}

.toolbar-trailing {
  min-width: 0;
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
}

.toolbar-status {
  font-size: 0.71rem;
  color: var(--text-secondary);
  max-width: min(56vw, 42rem);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.toolbar-settings-btn {
  flex: 0 0 auto;
  min-width: 1.7rem;
  min-height: 1.7rem;
  padding: 0;
  justify-content: center;
}

.sheet-pane {
  display: grid;
  grid-template-rows: auto 1fr;
  min-height: 0;
  background: var(--bg-surface);
  overflow-y: auto;
  overflow-x: hidden;
}

.query-sheet-pane {
  min-height: 0;
  display: grid;
  grid-template-rows: auto 1fr;
  overflow: hidden;
}

.sheet-tabs {
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--panel-separator);
  background: var(--bg-surface-muted);
  gap: 0.22rem;
  padding: 0.18rem 0.32rem;
  min-width: 0;
}

.sheet-tab-wrap {
  display: flex;
  align-items: center;
  min-width: 0;
  border-radius: 6px;
  border: 1px solid transparent;
}

.sheet-tab {
  border: 0;
  border-radius: 5px;
  background: transparent;
  padding: 0.24rem 0.48rem;
  font-size: 0.73rem;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 12rem;
  color: var(--text-secondary);
}

.sheet-tab:hover {
  background: var(--control-hover);
  color: var(--text-primary);
}

.sheet-tab-search {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}

.sheet-tab.active,
.sheet-tab-wrap.active {
  border-color: transparent;
  background: var(--tab-active-bg);
  box-shadow: inset 0 -1px 0 var(--accent);
}

.sheet-tab-wrap.active .sheet-tab {
  font-weight: 600;
  color: var(--text-primary);
}

.sheet-tab-add {
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  padding: 0.23rem 0.45rem;
  font-size: 0.74rem;
  cursor: pointer;
  color: var(--accent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.sheet-tab-add:hover {
  background: var(--control-hover);
}

.sheet-tab-close {
  border: 0;
  background: transparent;
  padding: 0.24rem 0.25rem;
  font-size: 0.72rem;
  cursor: pointer;
  color: var(--text-subtle);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.sheet-tab-close:hover {
  color: var(--text-primary);
  background: var(--control-hover);
  border-radius: 4px;
}

.sheet-tab-fill {
  flex: 1;
}

.query-limit-control {
  margin-left: 0.25rem;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.68rem;
  color: var(--text-secondary);
  letter-spacing: 0.01em;
}

.query-limit-control input {
  width: 4.3rem;
  padding: 0.2rem 0.3rem;
  font-size: 0.7rem;
}

.sheet-tab-icon {
  width: 0.72rem;
  height: 0.72rem;
}

.sheet-tabs > .btn {
  margin-left: 0.2rem;
}

.schema-chip {
  margin-left: 0.34rem;
  margin-right: 0;
  font-size: 0.68rem;
  color: var(--schema-chip-text);
  background: transparent;
  border: 0;
  padding: 0;
  border-radius: 0;
  letter-spacing: 0.01em;
}

.ai-suggestion-banner {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.45rem 0.55rem;
  border-bottom: 1px solid var(--panel-separator);
  background: var(--bg-surface-muted);
}

.ai-suggestion-banner.warning {
  border-left: 3px solid #c28e31;
}

.ai-suggestion-banner.error {
  border-left: 3px solid var(--danger);
}

.ai-suggestion-body {
  min-width: 0;
}

.ai-suggestion-text {
  margin: 0;
  font-size: 0.75rem;
  white-space: pre-wrap;
}

.ai-suggestion-meta {
  margin: 0.16rem 0 0;
  font-size: 0.68rem;
  color: var(--text-secondary);
}

.ai-suggestion-warning {
  color: var(--danger);
}

.ai-suggestion-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  flex-shrink: 0;
}

.sql-editor,
.ddl-editor {
  width: 100%;
  height: 100%;
  min-height: 0;
  background: var(--editor-surface);
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
  flex-wrap: wrap;
  gap: 0.4rem;
  padding: 0.45rem 0.55rem;
  border-bottom: 1px solid var(--panel-separator);
  background: var(--bg-surface-muted);
}

.source-search-input {
  flex: 1 1 18rem;
  min-width: 14rem;
}

.search-scope-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.22rem;
  font-size: 0.69rem;
  color: var(--text-secondary);
}

.search-scope-toggle input {
  width: auto;
  margin: 0;
}

.source-search-content {
  overflow: auto;
  min-height: 0;
  font-family: Consolas, "Courier New", monospace;
}

.source-search-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.74rem;
}

.source-search-table th,
.source-search-table td {
  border: 0;
  border-bottom: 1px solid var(--table-divider);
  text-align: left;
  padding: 0.28rem 0.4rem;
}

.source-search-table th {
  position: sticky;
  top: 0;
  background: var(--table-header-bg);
  z-index: 1;
  font-weight: 600;
}

.source-result-link {
  border: 0;
  background: transparent;
  color: var(--accent-strong);
  cursor: pointer;
  padding: 0;
  text-decoration: none;
}

.source-result-link:hover {
  color: var(--link-hover);
}

.source-search-line {
  white-space: pre;
}

.results-table {
  width: auto;
  min-width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  table-layout: auto;
  font-size: 0.74rem;
  margin: 0;
}

.results-table th,
.results-table td {
  border: 0;
  border-right: 1px solid color-mix(in srgb, var(--table-divider) 65%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--table-divider) 70%, transparent);
  color: var(--text-primary);
  text-align: left;
  padding: 0.28rem 0.4rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.results-table th {
  background: var(--table-header-bg);
  position: sticky;
  top: 0;
  z-index: 2;
  font-weight: 600;
  padding-right: 0.5rem;
  overflow: visible;
}

.results-table th:last-child,
.results-table td:last-child {
  border-right: 0;
}

.results-table tbody tr:nth-child(even) {
  background: var(--table-row-alt);
}

.results-table tbody tr:hover {
  background: var(--bg-hover);
}

.results-row-new {
  background: var(--row-new-bg) !important;
}

.results-row-dirty {
  background: var(--row-dirty-bg) !important;
}

.results-cell-number {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.results-cell-text {
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.results-col-resize-handle {
  position: absolute;
  top: 0;
  right: 0;
  width: 9px;
  height: 100%;
  border: 0;
  background: transparent;
  padding: 0;
  cursor: col-resize;
  z-index: 3;
}

.results-col-resize-handle::after {
  content: "";
  position: absolute;
  top: 22%;
  bottom: 22%;
  left: 50%;
  width: 1px;
  transform: translateX(-50%);
  background: transparent;
}

.results-table th:hover .results-col-resize-handle::after {
  background: color-mix(in srgb, var(--table-divider) 80%, transparent);
}

.results-table.is-resizing {
  user-select: none;
  cursor: col-resize;
}

.object-detail-hint {
  margin-top: -0.18rem;
}

.cell-editor {
  width: 100%;
  min-width: 0;
  padding: 0.2rem 0.28rem;
  font-size: 0.72rem;
  font-family: inherit;
  color: var(--text-primary);
  border: 0;
  background: transparent;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-action-btn {
  margin-right: 0.28rem;
  padding: 0.19rem 0.4rem;
  font-size: 0.69rem;
}

.row-action-btn:last-child {
  margin-right: 0;
}

.object-detail-edit-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  background: var(--bg-surface);
  border-top: 1px solid var(--panel-separator);
  margin-top: 0.35rem;
  padding: 0.45rem 0 0.2rem;
}

.object-detail-edit-leading {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.object-detail-edit-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.34rem;
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
  padding: 0.44rem 0.55rem;
  border-bottom: 1px solid var(--panel-separator);
  background: var(--bg-surface-muted);
}

.object-detail-tabs {
  display: flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0.2rem 0.42rem;
  border-bottom: 1px solid var(--panel-separator);
  background: var(--bg-surface-muted);
}

.object-detail-tab {
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  padding: 0.24rem 0.5rem;
  font-size: 0.72rem;
  color: var(--text-secondary);
  cursor: pointer;
}

.object-detail-tab:hover {
  background: var(--control-hover);
  color: var(--text-primary);
}

.object-detail-tab.active {
  border-color: transparent;
  background: var(--tab-active-bg);
  color: var(--text-primary);
  font-weight: 600;
  box-shadow: inset 0 -1px 0 var(--accent);
}

.object-detail-grid-pane {
  min-height: 0;
  overflow: hidden;
  padding: 0.55rem;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.object-detail-grid-wrap {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

.object-detail-grid-pane.is-data-view .results-table td {
  font-family: Consolas, "Courier New", monospace;
}

.object-detail-grid-pane.is-data-view .cell-editor {
  font-family: Consolas, "Courier New", monospace;
}

.muted {
  color: var(--text-secondary);
  font-size: 0.76rem;
}
</style>
