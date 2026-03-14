<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import AppIcon from "./AppIcon.vue";
import type {
  BusyState,
  ObjectDetailTabDefinition,
  ObjectDetailTabId,
  DbObjectEntry,
  DbQueryResult,
  DbSchemaSearchResult,
  SqlCompletionSchema,
  WorkspaceDdlTab,
  WorkspaceQueryTab,
} from "../types/clarity";
import type { ThemeSetting } from "../types/settings";

const queryText = defineModel<string>("queryText", { required: true });
const ddlText = defineModel<string>("ddlText", { required: true });
const queryRowLimit = defineModel<number>("queryRowLimit", { required: true });
const schemaSearchText = defineModel<string>("schemaSearchText", {
  required: true,
});
const schemaSearchIncludeObjectNames = defineModel<boolean>(
  "schemaSearchIncludeObjectNames",
  { required: true },
);
const schemaSearchIncludeSource = defineModel<boolean>(
  "schemaSearchIncludeSource",
  { required: true },
);
const schemaSearchIncludeDdl = defineModel<boolean>("schemaSearchIncludeDdl", {
  required: true,
});

const props = defineProps<{
  statusMessage: string;
  queryTabs: WorkspaceQueryTab[];
  ddlTabs: WorkspaceDdlTab[];
  activeWorkspaceTabId: string;
  isSearchTabActive: boolean;
  schemaSearchFocusToken: number;
  isConnected: boolean;
  transactionActive: boolean;
  busy: BusyState;
  activeQueryTab: WorkspaceQueryTab | null;
  activeDdlTab: WorkspaceDdlTab | null;
  activeDdlObject: DbObjectEntry | null;
  activeObjectDetailTabs: ObjectDetailTabDefinition[];
  activeObjectDetailTabId: ObjectDetailTabId | null;
  activeObjectDetailLoading: boolean;
  activeObjectDetailResult: DbQueryResult | null;
  isActiveObjectDataEditable: boolean;
  selectedProviderLabel: string;
  connectedSchema: string;
  sqlCompletionSchema: SqlCompletionSchema;
  sqlCompletionDefaultSchema: string;
  isQueryTabActive: boolean;
  schemaSearchResults: DbSchemaSearchResult[];
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
  onRunQuery: (selectedText?: string) => void;
  onBeginTransaction: () => void;
  onCommitTransaction: () => void;
  onRollbackTransaction: () => void;
  onSaveDdl: () => void;
  onRefreshActiveObjectDetail: () => void;
  onUpdateActiveObjectDataRow: (
    rowIndex: number,
    values: string[],
  ) => Promise<boolean>;
  onInsertActiveObjectDataRow: (values: string[]) => Promise<boolean>;
  onDeleteActiveObjectDataRow: (rowIndex: number) => Promise<boolean>;
  onActivateObjectDetailTab: (tabId: ObjectDetailTabId) => void;
  onRunSchemaSearch: () => void;
  onOpenSchemaSearchResult: (result: DbSchemaSearchResult) => void;
  onRequestAiSuggestion: () => void;
  onApplyAiSuggestion: () => void;
  onDismissAiSuggestion: () => void;
  isLikelyNumeric: (value: string) => boolean;
}>();

const SqlCodeEditor = defineAsyncComponent(() => import("./SqlCodeEditor.vue"));
const queryEditorRef = ref<{ getSelectedText?: () => string } | null>(null);
const dataDraftRows = ref<string[][]>([]);
const dataDraftSourceIndexes = ref<Array<number | null>>([]);
const committingDataChanges = ref(false);
const suppressDraftSync = ref(false);
const objectDetailGridWrapEl = ref<HTMLElement | null>(null);
const schemaSearchInputEl = ref<HTMLInputElement | null>(null);
const MIN_COLUMN_WIDTH = 88;
const DEFAULT_COLUMN_WIDTH = 180;
const DEFAULT_OBJECT_DETAIL_ROW_HEIGHT = 30;
const OBJECT_DETAIL_VIRTUAL_OVERSCAN_ROWS = 20;

const isDataDetailTab = computed<boolean>(
  () => props.activeObjectDetailTabId === "data",
);
const activeObjectIsInvalid = computed<boolean>(
  () => props.activeDdlObject?.status?.trim().toUpperCase() === "INVALID",
);
const activeObjectInvalidReason = computed<string>(
  () => props.activeDdlObject?.invalidReason?.trim() ?? "",
);
const showEditableRowActions = computed<boolean>(() => {
  if (
    !isDataDetailTab.value ||
    !props.isActiveObjectDataEditable ||
    !props.activeObjectDetailResult
  ) {
    return false;
  }

  return props.activeObjectDetailResult.columns.length > 0;
});
const sourceDataRows = computed<string[][]>(
  () => props.activeObjectDetailResult?.rows ?? [],
);
const sourceDataRowCount = computed<number>(() => sourceDataRows.value.length);
const displayedDataRows = computed<string[][]>(() => {
  if (showEditableRowActions.value) {
    return dataDraftRows.value;
  }

  return sourceDataRows.value;
});
const editableColumnCount = computed<number>(
  () => props.activeObjectDetailResult?.columns.length ?? 0,
);
const hasAiSuggestion = computed<boolean>(
  () => props.aiSuggestionText.trim().length > 0,
);
const showDdlLoadingState = computed<boolean>(() => {
  if (!props.activeDdlTab?.loadingDdl) {
    return false;
  }

  return props.activeDdlTab.ddlText.trim().length === 0;
});
const showObjectDetailSkeleton = computed<boolean>(
  () => props.activeObjectDetailLoading && !props.activeObjectDetailResult,
);
const objectDetailColumns = computed<string[]>(
  () => props.activeObjectDetailResult?.columns ?? [],
);
const objectDetailColumnWidths = ref<number[]>([]);
const objectDetailVisibleColumnCount = computed<number>(() =>
  Math.max(1, objectDetailColumns.value.length),
);
const objectDetailRenderedColumnCount = computed<number>(() =>
  objectDetailVisibleColumnCount.value + (showEditableRowActions.value ? 1 : 0),
);
const objectDetailScrollTop = ref(0);
const objectDetailViewportHeight = ref(0);
const objectDetailRowHeight = ref(DEFAULT_OBJECT_DETAIL_ROW_HEIGHT);

type ColumnResizeState = {
  index: number;
  startX: number;
  startWidth: number;
};

const objectDetailResizeState = ref<ColumnResizeState | null>(null);
let objectDetailResizeRafId: number | null = null;
let pendingObjectDetailResizePointerX: number | null = null;

const objectDetailColumnKey = computed<string>(() =>
  objectDetailColumns.value.join("\u001f"),
);
const visibleObjectDetailStartRow = computed<number>(() => {
  if (!displayedDataRows.value.length || objectDetailRowHeight.value <= 0) {
    return 0;
  }

  const rawStart = Math.floor(
    objectDetailScrollTop.value / objectDetailRowHeight.value,
  );
  return Math.max(0, rawStart - OBJECT_DETAIL_VIRTUAL_OVERSCAN_ROWS);
});
const visibleObjectDetailEndRow = computed<number>(() => {
  const rowCount = displayedDataRows.value.length;
  if (!rowCount || objectDetailRowHeight.value <= 0) {
    return 0;
  }

  const visibleRows = Math.ceil(
    Math.max(objectDetailViewportHeight.value, objectDetailRowHeight.value) /
      objectDetailRowHeight.value,
  );
  const bufferedEnd =
    visibleObjectDetailStartRow.value +
    visibleRows +
    OBJECT_DETAIL_VIRTUAL_OVERSCAN_ROWS * 2;
  return Math.min(rowCount, bufferedEnd);
});
const visibleObjectDetailRows = computed<
  Array<{ row: string[]; rowIndex: number }>
>(() =>
  displayedDataRows.value
    .slice(visibleObjectDetailStartRow.value, visibleObjectDetailEndRow.value)
    .map((row, localIndex) => ({
      row,
      rowIndex: visibleObjectDetailStartRow.value + localIndex,
    })),
);
const objectDetailTopSpacerHeight = computed<number>(
  () => visibleObjectDetailStartRow.value * objectDetailRowHeight.value,
);
const objectDetailBottomSpacerHeight = computed<number>(() => {
  const remainingRows = Math.max(
    0,
    displayedDataRows.value.length - visibleObjectDetailEndRow.value,
  );
  return remainingRows * objectDetailRowHeight.value;
});
const ddlLoadingSkeletonWidths = [92, 78, 88, 66, 84, 72];
const objectDetailSkeletonWidths = [100, 94, 97, 91, 95, 89];

function cloneRows(rows: string[][]): string[][] {
  return rows.map((row) => [...row]);
}

function getDraftSourceRowIndex(rowIndex: number): number | null {
  const sourceIndex = dataDraftSourceIndexes.value[rowIndex];
  return typeof sourceIndex === "number" && sourceIndex >= 0
    ? sourceIndex
    : null;
}

function syncDraftRowsFromResult(): void {
  if (!showEditableRowActions.value || !props.activeObjectDetailResult) {
    dataDraftRows.value = [];
    dataDraftSourceIndexes.value = [];
    return;
  }

  dataDraftRows.value = cloneRows(props.activeObjectDetailResult.rows);
  dataDraftSourceIndexes.value = props.activeObjectDetailResult.rows.map(
    (_, rowIndex) => rowIndex,
  );
}

function onCellDraftInput(
  rowIndex: number,
  colIndex: number,
  event: Event,
): void {
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
  if (
    !showEditableRowActions.value ||
    committingDataChanges.value ||
    editableColumnCount.value < 1
  ) {
    return;
  }

  const newRow = Array.from({ length: editableColumnCount.value }, () => "");
  const newRowIndex = dataDraftRows.value.length;
  dataDraftRows.value = [...dataDraftRows.value, newRow];
  dataDraftSourceIndexes.value = [...dataDraftSourceIndexes.value, null];

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

  const sourceRowIndex = getDraftSourceRowIndex(rowIndex);
  const draftRow = dataDraftRows.value[rowIndex];
  if (!draftRow) {
    return false;
  }

  if (sourceRowIndex === null || sourceRowIndex === undefined) {
    return draftRow.some((value) => value !== "");
  }

  const sourceRow = sourceDataRows.value[sourceRowIndex];
  if (!sourceRow) {
    return true;
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

const deletedSourceRowIndexes = computed<number[]>(() => {
  if (!showEditableRowActions.value) {
    return [];
  }

  const remainingSourceIndexes = new Set<number>();
  for (const sourceIndex of dataDraftSourceIndexes.value) {
    if (sourceIndex !== null && sourceIndex >= 0) {
      remainingSourceIndexes.add(sourceIndex);
    }
  }

  const deletedIndexes: number[] = [];
  for (let rowIndex = 0; rowIndex < sourceDataRowCount.value; rowIndex += 1) {
    if (!remainingSourceIndexes.has(rowIndex)) {
      deletedIndexes.push(rowIndex);
    }
  }

  return deletedIndexes;
});

const pendingDataChangeCount = computed<number>(
  () => dirtyRowIndexes.value.length + deletedSourceRowIndexes.value.length,
);
const hasPendingDataChanges = computed<boolean>(
  () => pendingDataChangeCount.value > 0,
);
const hasDraftStructureChanges = computed<boolean>(() => {
  if (!showEditableRowActions.value) {
    return false;
  }

  if (dataDraftRows.value.length !== sourceDataRowCount.value) {
    return true;
  }

  for (let rowIndex = 0; rowIndex < dataDraftSourceIndexes.value.length; rowIndex += 1) {
    if (dataDraftSourceIndexes.value[rowIndex] !== rowIndex) {
      return true;
    }
  }

  return false;
});
const canRevertDataChanges = computed<boolean>(
  () => hasPendingDataChanges.value || hasDraftStructureChanges.value,
);

function isPersistedDataRow(rowIndex: number): boolean {
  return getDraftSourceRowIndex(rowIndex) !== null;
}

function canDeleteDraftRow(rowIndex: number): boolean {
  if (!showEditableRowActions.value) {
    return false;
  }

  return (
    rowIndex >= 0 &&
    rowIndex < dataDraftRows.value.length &&
    !committingDataChanges.value &&
    !props.busy.updatingData
  );
}

function deleteRowActionTitle(rowIndex: number): string {
  if (!isPersistedDataRow(rowIndex)) {
    return "Remove unsaved draft row";
  }

  if (!canDeleteDraftRow(rowIndex)) {
    return "Delete is unavailable while another data update is in progress";
  }

  return "Mark row for deletion (applied on Commit)";
}

async function deleteDraftRow(rowIndex: number): Promise<void> {
  if (!canDeleteDraftRow(rowIndex)) {
    return;
  }

  dataDraftRows.value.splice(rowIndex, 1);
  dataDraftRows.value = [...dataDraftRows.value];
  dataDraftSourceIndexes.value.splice(rowIndex, 1);
  dataDraftSourceIndexes.value = [...dataDraftSourceIndexes.value];
}

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
  const deletedIndexes = [...deletedSourceRowIndexes.value].sort(
    (left, right) => right - left,
  );
  let completedAllUpdates = true;
  let insertedRows = false;
  let appliedStructuralChange = false;

  committingDataChanges.value = true;
  suppressDraftSync.value = true;
  try {
    for (const rowIndex of dirtyIndexes) {
      const rowValues = dataDraftRows.value[rowIndex];
      if (!rowValues) {
        continue;
      }

      const sourceRowIndex = getDraftSourceRowIndex(rowIndex);
      const didSave =
        sourceRowIndex !== null
          ? await props.onUpdateActiveObjectDataRow(sourceRowIndex, [...rowValues])
          : await props.onInsertActiveObjectDataRow([...rowValues]);
      if (!didSave) {
        completedAllUpdates = false;
        break;
      }

      if (sourceRowIndex === null) {
        insertedRows = true;
      }
    }

    if (completedAllUpdates) {
      for (const deletedSourceIndex of deletedIndexes) {
        const didDelete =
          await props.onDeleteActiveObjectDataRow(deletedSourceIndex);
        if (!didDelete) {
          completedAllUpdates = false;
          break;
        }
        appliedStructuralChange = true;
      }
    }
  } finally {
    suppressDraftSync.value = false;
    committingDataChanges.value = false;
  }

  if (completedAllUpdates) {
    syncDraftRowsFromResult();
    if (insertedRows || appliedStructuralChange) {
      props.onRefreshActiveObjectDetail();
    }
    return;
  }

  if (appliedStructuralChange) {
    syncDraftRowsFromResult();
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
  () => [
    props.activeWorkspaceTabId,
    props.activeObjectDetailTabId,
    objectDetailColumnKey.value,
  ],
  () => {
    objectDetailColumnWidths.value = objectDetailColumns.value.map(
      () => DEFAULT_COLUMN_WIDTH,
    );
    objectDetailRowHeight.value = DEFAULT_OBJECT_DETAIL_ROW_HEIGHT;
    const gridWrap = objectDetailGridWrapEl.value;
    if (gridWrap) {
      gridWrap.scrollTop = 0;
    }
    objectDetailScrollTop.value = 0;
    void nextTick(() => {
      updateObjectDetailViewportMetrics();
      measureObjectDetailRowHeight();
    });
  },
  { immediate: true },
);

watch(
  () => displayedDataRows.value.length,
  () => {
    void nextTick(() => {
      updateObjectDetailViewportMetrics();
      measureObjectDetailRowHeight();
    });
  },
);

function getObjectDetailColumnWidth(index: number): number {
  return objectDetailColumnWidths.value[index] ?? DEFAULT_COLUMN_WIDTH;
}

function onObjectDetailColumnResizeMove(event: MouseEvent): void {
  if (!objectDetailResizeState.value) {
    return;
  }

  pendingObjectDetailResizePointerX = event.clientX;
  if (objectDetailResizeRafId !== null) {
    return;
  }

  objectDetailResizeRafId = window.requestAnimationFrame(() => {
    objectDetailResizeRafId = null;
    const state = objectDetailResizeState.value;
    const pointerX = pendingObjectDetailResizePointerX;
    if (!state || pointerX === null) {
      return;
    }

    const nextWidth = Math.max(
      MIN_COLUMN_WIDTH,
      state.startWidth + (pointerX - state.startX),
    );
    objectDetailColumnWidths.value[state.index] = nextWidth;
  });
}

function stopObjectDetailColumnResize(): void {
  if (!objectDetailResizeState.value) {
    return;
  }

  objectDetailResizeState.value = null;
  pendingObjectDetailResizePointerX = null;
  if (objectDetailResizeRafId !== null) {
    window.cancelAnimationFrame(objectDetailResizeRafId);
    objectDetailResizeRafId = null;
  }
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
  pendingObjectDetailResizePointerX = event.clientX;
  window.addEventListener("mousemove", onObjectDetailColumnResizeMove);
  window.addEventListener("mouseup", stopObjectDetailColumnResize);
}

function updateObjectDetailViewportMetrics(): void {
  const gridWrap = objectDetailGridWrapEl.value;
  if (!gridWrap) {
    objectDetailViewportHeight.value = 0;
    return;
  }

  objectDetailViewportHeight.value = gridWrap.clientHeight;
  objectDetailScrollTop.value = gridWrap.scrollTop;
}

function onObjectDetailGridScroll(event: Event): void {
  const target = event.target as HTMLElement | null;
  if (!target) {
    return;
  }

  objectDetailScrollTop.value = target.scrollTop;
}

function measureObjectDetailRowHeight(): void {
  const gridWrap = objectDetailGridWrapEl.value;
  if (!gridWrap) {
    return;
  }

  const firstRow = gridWrap.querySelector<HTMLTableRowElement>(
    "tr[data-object-row]",
  );
  if (!firstRow) {
    return;
  }

  const measuredHeight = firstRow.getBoundingClientRect().height;
  if (Number.isFinite(measuredHeight) && measuredHeight > 1) {
    objectDetailRowHeight.value = measuredHeight;
  }
}

onMounted(() => {
  window.addEventListener("resize", updateObjectDetailViewportMetrics);
  void nextTick(() => {
    updateObjectDetailViewportMetrics();
    measureObjectDetailRowHeight();
  });
});

onBeforeUnmount(() => {
  stopObjectDetailColumnResize();
  window.removeEventListener("resize", updateObjectDetailViewportMetrics);
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

function formatSearchScopeLabel(
  scope: DbSchemaSearchResult["matchScope"],
): string {
  if (scope === "object_name") {
    return "Object Name";
  }
  if (scope === "ddl") {
    return "DDL";
  }
  return "Source";
}

function isModifierEnter(event: KeyboardEvent): boolean {
  if (event.key !== "Enter") {
    return false;
  }

  if (event.altKey || event.shiftKey) {
    return false;
  }

  return event.metaKey || event.ctrlKey;
}

function isPlainEscape(event: KeyboardEvent): boolean {
  return (
    event.key === "Escape" &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey
  );
}

function executeWithSelection(): void {
  const selected = queryEditorRef.value?.getSelectedText?.() ?? "";
  props.onRunQuery(selected);
}

function handleSheetKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.isComposing || event.repeat) {
    return;
  }

  if (isModifierEnter(event)) {
    if (props.isQueryTabActive) {
      event.preventDefault();
      executeWithSelection();
      return;
    }

    if (showEditableRowActions.value) {
      event.preventDefault();
      void commitDataChanges();
    }
    return;
  }

  if (!showEditableRowActions.value || !isPlainEscape(event)) {
    return;
  }

  event.preventDefault();
  revertDataChanges();
}

watch(
  () => props.schemaSearchFocusToken,
  () => {
    focusSchemaSearchInput(true);
  },
);
</script>

<template>
  <section class="workspace-sheet" @keydown.capture="handleSheetKeydown">
    <header class="workspace-toolbar">
      <div>
        <div class="toolbar-eyebrow">Workbench</div>
        <div class="toolbar-title">SQL workspace</div>
      </div>
      <div class="toolbar-trailing">
        <div class="toolbar-status">{{ props.statusMessage }}</div>
        <button
          class="btn toolbar-settings-btn"
          title="Open settings"
          aria-label="Open settings"
          @click="props.onOpenSettings"
        >
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
      <button
        class="sheet-tab-add"
        title="New query tab"
        @click="props.onAddQueryTab"
      >
        <AppIcon name="plus" class="sheet-tab-icon" aria-hidden="true" />
      </button>
      <div class="sheet-tab-wrap" :class="{ active: props.isSearchTabActive }">
        <button
          class="sheet-tab sheet-tab-search"
          @click="props.onOpenSearchTab"
        >
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
          <span class="sheet-tab-label">{{ tab.object.objectName }}</span>
          <span
            v-if="tab.loadingDdl || tab.loadingData || tab.loadingMetadata"
            class="sheet-tab-loading-dot"
            aria-hidden="true"
          ></span>
        </button>
        <button
          class="sheet-tab-close"
          title="Close tab"
          @click.stop="props.onCloseDdlTab(tab.id)"
        >
          <AppIcon name="close" class="sheet-tab-icon" aria-hidden="true" />
        </button>
      </div>
      <div class="sheet-tab-fill"></div>
      <label
        class="query-limit-control"
        title="Maximum rows returned for worksheet queries"
      >
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
        title="Execute query"
        :disabled="
          !props.isConnected || !props.activeQueryTab || props.busy.runningQuery
        "
        @click="executeWithSelection"
      >
        <AppIcon name="play" class="btn-icon" aria-hidden="true" />
        {{ props.busy.runningQuery ? "Running..." : "Execute" }}
      </button>
      <button
        class="btn"
        :disabled="
          !props.isConnected ||
          props.transactionActive ||
          props.busy.runningQuery ||
          props.busy.updatingData ||
          props.busy.managingTransaction
        "
        @click="props.onBeginTransaction"
      >
        Begin
      </button>
      <button
        class="btn"
        :disabled="
          !props.isConnected ||
          !props.transactionActive ||
          props.busy.runningQuery ||
          props.busy.updatingData ||
          props.busy.managingTransaction
        "
        @click="props.onCommitTransaction"
      >
        Commit
      </button>
      <button
        class="btn"
        :disabled="
          !props.isConnected ||
          !props.transactionActive ||
          props.busy.runningQuery ||
          props.busy.updatingData ||
          props.busy.managingTransaction
        "
        @click="props.onRollbackTransaction"
      >
        Rollback
      </button>
      <button
        class="btn"
        :disabled="
          !props.canUseAiSuggestions ||
          !props.activeQueryTab ||
          props.aiSuggestionLoading
        "
        @click="props.onRequestAiSuggestion"
      >
        <AppIcon name="search" class="btn-icon" aria-hidden="true" />
        {{ props.aiSuggestionLoading ? "Suggesting..." : "AI Suggest" }}
      </button>
      <button
        class="btn"
        :disabled="
          !props.activeDdlTab ||
          props.activeObjectDetailTabId !== 'ddl' ||
          props.activeDdlTab.loadingDdl ||
          props.busy.savingDdl
        "
        @click="props.onSaveDdl"
      >
        <AppIcon name="save" class="btn-icon" aria-hidden="true" />
        {{ props.busy.savingDdl ? "Saving..." : "Save DDL" }}
      </button>
      <span class="schema-chip"
        >Provider: {{ props.selectedProviderLabel }}</span
      >
      <span class="schema-chip">Schema: {{ props.connectedSchema }}</span>
      <span
        class="schema-chip transaction-chip"
        :class="{ active: props.transactionActive }"
      >
        Txn: {{ props.transactionActive ? "Active (Uncommitted)" : "Auto-commit" }}
      </span>
    </div>

    <section v-if="props.isQueryTabActive" class="query-sheet-pane">
      <div
        v-if="
          props.aiSuggestionLoading ||
          hasAiSuggestion ||
          props.aiSuggestionError
        "
        class="ai-suggestion-banner"
        :class="{
          warning: hasAiSuggestion && props.aiSuggestionMutating,
          error: !!props.aiSuggestionError,
        }"
      >
        <div class="ai-suggestion-body">
          <p v-if="props.aiSuggestionLoading" class="ai-suggestion-text">
            Generating suggestion...
          </p>
          <p v-else-if="props.aiSuggestionError" class="ai-suggestion-text">
            {{ props.aiSuggestionError }}
          </p>
          <template v-else-if="hasAiSuggestion">
            <p class="ai-suggestion-text">
              {{ props.aiSuggestionText }}
            </p>
            <p v-if="props.aiSuggestionRationale" class="ai-suggestion-meta">
              {{ props.aiSuggestionRationale }}
            </p>
            <p
              v-if="props.aiSuggestionConfidence !== null"
              class="ai-suggestion-meta"
            >
              Confidence:
              {{ Math.round(props.aiSuggestionConfidence * 100) }}%
            </p>
            <p
              v-if="props.aiSuggestionMutating"
              class="ai-suggestion-meta ai-suggestion-warning"
            >
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
            :disabled="
              (!hasAiSuggestion && !props.aiSuggestionError) ||
              props.aiSuggestionLoading
            "
            @click="props.onDismissAiSuggestion"
          >
            Dismiss (Esc)
          </button>
        </div>
      </div>

      <SqlCodeEditor
        ref="queryEditorRef"
        v-model="queryText"
        class="sql-editor query-editor"
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
          <span
            v-if="activeObjectIsInvalid"
            class="object-status-pill invalid"
            :title="
              activeObjectInvalidReason ||
              'Oracle reports this object as invalid.'
            "
          >
            Invalid
          </span>
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
          {{
            props.activeObjectDetailLoading ? "Refreshing..." : "Refresh Detail"
          }}
        </button>
      </div>

      <div class="object-detail-tabs">
        <button
          v-for="detailTab in props.activeObjectDetailTabs"
          :key="detailTab.id"
          class="object-detail-tab"
          :class="{
            active: props.activeObjectDetailTabId === detailTab.id,
          }"
          @click="props.onActivateObjectDetailTab(detailTab.id)"
        >
          {{ detailTab.label }}
        </button>
      </div>

      <section
        v-if="props.activeObjectDetailTabId === 'ddl' && showDdlLoadingState"
        class="object-loading-panel"
        aria-live="polite"
      >
        <p class="muted object-loading-title">Loading object DDL...</p>
        <div class="object-loading-skeleton">
          <span
            v-for="(width, index) in ddlLoadingSkeletonWidths"
            :key="`ddl-skeleton-${index}`"
            class="object-loading-line"
            :style="{ width: `${width}%` }"
          ></span>
        </div>
      </section>

      <SqlCodeEditor
        v-else-if="props.activeObjectDetailTabId === 'ddl'"
        v-model="ddlText"
        class="ddl-editor"
        placeholder="Object DDL will appear here"
        :target-line="props.activeDdlTab.focusLine"
        :focus-token="props.activeDdlTab.focusToken"
        :completion-schema="props.sqlCompletionSchema"
        :completion-default-schema="props.sqlCompletionDefaultSchema"
        :theme="props.theme"
      />

      <section
        v-else
        class="object-detail-grid-pane"
        :class="{ 'is-data-view': isDataDetailTab }"
      >
        <div
          v-if="showObjectDetailSkeleton"
          class="object-loading-panel"
          aria-live="polite"
        >
          <p class="muted object-loading-title">Loading object detail...</p>
          <div class="object-loading-skeleton">
            <span
              v-for="(width, index) in objectDetailSkeletonWidths"
              :key="`detail-skeleton-${index}`"
              class="object-loading-line"
              :style="{ width: `${width}%` }"
            ></span>
          </div>
        </div>
        <p v-else-if="!props.activeObjectDetailResult" class="muted">
          Select a detail tab to load information for this object.
        </p>
        <template v-else>
          <div
            v-if="
              props.activeObjectDetailTabId === 'metadata' && activeObjectIsInvalid
            "
            class="object-invalid-banner"
            role="status"
          >
            <div class="object-invalid-banner-label">Invalid object</div>
            <div class="object-invalid-banner-copy">
              {{
                activeObjectInvalidReason ||
                "Oracle reports this object as invalid, but did not return a compiler message."
              }}
            </div>
          </div>
          <p v-if="props.activeObjectDetailLoading" class="muted">
            Refreshing object detail...
          </p>
          <p class="muted">
            {{ props.activeObjectDetailResult.message }}
          </p>
          <p
            v-if="props.activeObjectDetailResult.rowsAffected !== null"
            class="muted"
          >
            Rows affected:
            {{ props.activeObjectDetailResult.rowsAffected }}
          </p>
          <p
            v-else-if="!props.activeObjectDetailResult.columns.length"
            class="muted"
          >
            No rows returned.
          </p>
          <template v-else>
            <p v-if="showEditableRowActions" class="muted object-detail-hint">
              Cells are editable. Add/Delete adjusts draft rows. Use Commit to apply, or Revert to discard.
            </p>
            <p v-else-if="isDataDetailTab" class="muted object-detail-hint">
              Data preview is read-only for this object type.
            </p>
            <div
              ref="objectDetailGridWrapEl"
              class="object-detail-grid-wrap"
              @scroll="onObjectDetailGridScroll"
            >
              <table
                class="results-table"
                :class="{
                  'is-resizing': !!objectDetailResizeState,
                }"
              >
                <colgroup>
                  <col
                    v-for="(column, columnIndex) in props
                      .activeObjectDetailResult.columns"
                    :key="`detail-col-${column}-${columnIndex}`"
                    :style="{
                      width: `${getObjectDetailColumnWidth(columnIndex)}px`,
                    }"
                  />
                  <col v-if="showEditableRowActions" class="results-row-actions-col" />
                </colgroup>
                <thead>
                  <tr>
                    <th
                      v-for="(column, columnIndex) in props
                        .activeObjectDetailResult.columns"
                      :key="column"
                    >
                      <span class="results-cell-text" :title="column">{{
                        column
                      }}</span>
                      <button
                        class="results-col-resize-handle"
                        type="button"
                        tabindex="-1"
                        aria-hidden="true"
                        @mousedown="
                          startObjectDetailColumnResize(columnIndex, $event)
                        "
                      ></button>
                    </th>
                    <th v-if="showEditableRowActions" class="results-row-actions-header">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-if="objectDetailTopSpacerHeight > 0"
                    class="results-spacer-row"
                    aria-hidden="true"
                  >
                    <td
                      :colspan="objectDetailRenderedColumnCount"
                      :style="{
                        height: `${objectDetailTopSpacerHeight}px`,
                      }"
                    ></td>
                  </tr>
                  <tr
                    v-for="{ row, rowIndex } in visibleObjectDetailRows"
                    :key="`obj-row-${rowIndex}`"
                    :data-draft-row="rowIndex"
                    :data-object-row="rowIndex"
                    :class="{
                      'results-row-alt': rowIndex % 2 === 1,
                      'results-row-dirty':
                        showEditableRowActions && isRowDirty(rowIndex),
                      'results-row-new':
                        showEditableRowActions &&
                        !isPersistedDataRow(rowIndex),
                    }"
                  >
                    <td
                      v-for="(value, colIndex) in row"
                      :key="`obj-col-${rowIndex}-${colIndex}`"
                      :class="{
                        'results-cell-number': props.isLikelyNumeric(value),
                      }"
                    >
                      <input
                        v-if="showEditableRowActions"
                        class="cell-editor"
                        :value="value"
                        :disabled="committingDataChanges || props.busy.updatingData"
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
                        <span class="results-cell-text" :title="value">{{
                          value
                        }}</span>
                      </template>
                    </td>
                    <td
                      v-if="showEditableRowActions"
                      class="results-row-actions-cell"
                    >
                      <button
                        class="btn row-delete-btn"
                        :class="{ 'delete-existing': isPersistedDataRow(rowIndex) }"
                        :disabled="!canDeleteDraftRow(rowIndex)"
                        :title="deleteRowActionTitle(rowIndex)"
                        @click="deleteDraftRow(rowIndex)"
                      >
                        {{ isPersistedDataRow(rowIndex) ? "Delete" : "Remove" }}
                      </button>
                    </td>
                  </tr>
                  <tr
                    v-if="objectDetailBottomSpacerHeight > 0"
                    class="results-spacer-row"
                    aria-hidden="true"
                  >
                    <td
                      :colspan="objectDetailRenderedColumnCount"
                      :style="{
                        height: `${objectDetailBottomSpacerHeight}px`,
                      }"
                    ></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div
              v-if="showEditableRowActions"
              class="object-detail-edit-toolbar"
            >
              <div class="object-detail-edit-leading">
                <button
                  class="btn row-action-btn"
                  :disabled="committingDataChanges || props.busy.updatingData"
                  @click="addDraftRow"
                >
                  Add Row
                </button>
                <div class="muted">
                  Pending row changes:
                  {{ pendingDataChangeCount }}
                </div>
              </div>
              <div class="object-detail-edit-actions">
                <button
                  class="btn row-action-btn"
                  title="Revert pending changes (Esc)"
                  :disabled="
                    !canRevertDataChanges ||
                    committingDataChanges ||
                    props.busy.updatingData
                  "
                  @click="revertDataChanges"
                >
                  Revert (Esc)
                </button>
                <button
                  class="btn row-action-btn primary"
                  title="Commit pending changes (Cmd/Ctrl+Enter)"
                  :disabled="
                    !hasPendingDataChanges ||
                    committingDataChanges ||
                    props.busy.updatingData
                  "
                  @click="commitDataChanges"
                >
                  {{
                    committingDataChanges
                      ? "Committing..."
                      : "Commit (Cmd/Ctrl+Enter)"
                  }}
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
            (!schemaSearchIncludeObjectNames &&
              !schemaSearchIncludeSource &&
              !schemaSearchIncludeDdl)
          "
          @click="props.onRunSchemaSearch"
        >
          <AppIcon name="search" class="btn-icon" aria-hidden="true" />
          {{ props.busy.searchingSchema ? "Searching..." : "Search" }}
        </button>
      </div>

      <div class="source-search-content">
        <p v-if="!props.schemaSearchPerformed" class="muted">
          Run a schema search to find matching objects and text.
        </p>
        <p v-else-if="!props.schemaSearchResults.length" class="muted">
          No matches found.
        </p>

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
                <button
                  class="source-result-link"
                  @click="props.onOpenSchemaSearchResult(match)"
                >
                  {{ match.schema }}.{{ match.objectName }}
                </button>
              </td>
              <td>{{ match.objectType }}</td>
              <td>
                {{ formatSearchScopeLabel(match.matchScope) }}
              </td>
              <td class="results-cell-number">
                {{ match.line ?? "-" }}
              </td>
              <td class="source-search-line">
                {{ match.snippet }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
    </section>
  </section>
</template>

<style scoped>
input,
select,
textarea,
button {
  font: inherit;
}

input,
select,
textarea {
  border: 1px solid var(--control-border);
  border-radius: 0.95rem;
  background: var(--control-bg);
  color: var(--text-primary);
  padding: 0.72rem 0.85rem;
}

button {
  color: var(--text-primary);
}

input:focus-visible,
textarea:focus-visible,
button:focus-visible {
  outline: 1px solid var(--focus-ring);
  outline-offset: 1px;
}

.btn {
  border: 0;
  border-radius: 6px;
  background: color-mix(in srgb, var(--control-bg) 92%, transparent);
  padding: 0.3rem 0.64rem;
  font-size: 0.7rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    background-color 0.12s ease,
    border-color 0.12s ease;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
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

.workspace-sheet {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 0;
  border-radius: 20px;
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--bg-surface-muted) 56%, transparent) 0%,
      color-mix(in srgb, var(--bg-surface) 94%, transparent) 100%
    );
  box-shadow: var(--card-shadow);
  overflow: hidden;
}

.workspace-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.55rem;
  min-height: var(--pane-header-height);
  padding: 0.56rem 0.9rem;
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--bg-surface-muted) 88%, transparent) 0%,
      color-mix(in srgb, var(--bg-surface) 40%, transparent) 100%
    );
}

.toolbar-eyebrow {
  font-size: 0.64rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-subtle);
  margin-bottom: 0.12rem;
}

.toolbar-title {
  font-size: 0.98rem;
  font-weight: 700;
}

.toolbar-trailing {
  min-width: 0;
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}

.toolbar-status {
  font-size: 0.72rem;
  color: var(--text-secondary);
  max-width: min(42vw, 28rem);
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.toolbar-settings-btn {
  flex: 0 0 auto;
  min-width: 1.85rem;
  min-height: 1.85rem;
  padding: 0;
  justify-content: center;
}

.sheet-pane {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 0;
  background: transparent;
  overflow: hidden;
}

.query-sheet-pane {
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  padding: 0 0.75rem 0.56rem;
  gap: 0.65rem;
}

.query-editor {
  grid-row: 2;
  min-height: 0;
}

.sheet-tabs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.45rem;
  padding: 0.48rem 0.75rem;
  min-width: 0;
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--bg-surface-muted) 72%, transparent) 0%,
      color-mix(in srgb, var(--bg-surface) 52%, transparent) 100%
    );
  overflow: auto;
}

.sheet-tab-wrap {
  display: flex;
  align-items: center;
  min-width: 0;
  border-radius: 6px 6px 3px 3px;
  border: 0;
  background: transparent;
}

.sheet-tab {
  border: 0;
  border-radius: 6px 6px 3px 3px;
  background: transparent;
  padding: 0.2rem 0.5rem;
  font-size: 0.69rem;
  cursor: pointer;
  max-width: 14rem;
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  gap: 0.36rem;
  min-width: 0;
}

.sheet-tab:hover {
  background: var(--control-hover);
  color: var(--text-primary);
}

.sheet-tab:focus-visible,
.sheet-tab-add:focus-visible,
.sheet-tab-close:focus-visible,
.object-detail-tab:focus-visible,
.source-result-link:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

.sheet-tab-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sheet-tab-loading-dot {
  width: 0.42rem;
  height: 0.42rem;
  border-radius: 999px;
  background: var(--accent);
  flex: 0 0 auto;
  animation: sheet-tab-loading-pulse 1s ease-in-out infinite;
}

.sheet-tab-search {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}

.sheet-tab.active,
.sheet-tab-wrap.active {
  background: color-mix(in srgb, var(--accent-soft) 75%, var(--tab-active-bg));
  box-shadow: inset 0 -2px 0 var(--accent);
}

.sheet-tab-wrap.active .sheet-tab {
  font-weight: 600;
  color: var(--text-primary);
}

.sheet-tab-add {
  border: 0;
  border-radius: 5px;
  background: transparent;
  padding: 0.24rem 0.34rem;
  font-size: 0.68rem;
  cursor: pointer;
  color: var(--text-primary);
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
  padding: 0.3rem 0.3rem;
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
  gap: 0.25rem;
  font-size: 0.64rem;
  color: var(--text-secondary);
  letter-spacing: 0.01em;
  padding: 0.04rem 0.2rem;
  border-radius: 6px;
  background: color-mix(in srgb, var(--bg-surface-muted) 76%, transparent);
}

.query-limit-control input {
  width: 3.25rem;
  padding: 0.08rem 0.16rem;
  font-size: 0.64rem;
}

.sheet-tab-icon {
  width: 0.72rem;
  height: 0.72rem;
}

.sheet-tabs > .btn {
  margin-left: 0.05rem;
}

.schema-chip {
  display: inline-flex;
  align-items: center;
  min-height: 1.3rem;
  padding: 0.08rem 0.3rem;
  border-radius: 999px;
  background: var(--schema-chip-bg);
  color: var(--schema-chip-text);
  font-size: 0.6rem;
  font-weight: 600;
}

.transaction-chip {
  font-weight: 500;
}

.transaction-chip.active {
  color: var(--accent-strong);
}

.ai-suggestion-banner {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.55rem;
  padding: 0.72rem 0.8rem;
  border-radius: 14px;
  background: color-mix(in srgb, var(--bg-surface-muted) 84%, transparent);
}

.ai-suggestion-banner.warning {
  border-color: color-mix(in srgb, var(--warning) 35%, var(--border));
}

.ai-suggestion-banner.error {
  border-color: color-mix(in srgb, var(--danger) 35%, var(--border));
}

.ai-suggestion-body {
  min-width: 0;
}

.ai-suggestion-text {
  margin: 0;
  font-size: 0.73rem;
  white-space: pre-wrap;
}

.ai-suggestion-meta {
  margin: 0.16rem 0 0;
  font-size: 0.64rem;
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
  border-radius: 16px;
  overflow: hidden;
}

.source-search-pane {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 0;
  overflow: hidden;
  padding: 0 0.75rem 0.75rem;
  gap: 0.65rem;
}

.source-search-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 0.72rem 0.8rem;
  border-radius: 14px;
  background: color-mix(in srgb, var(--bg-surface-muted) 84%, transparent);
}

.source-search-input {
  flex: 1 1 18rem;
  min-width: 14rem;
}

.search-scope-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.32rem;
  font-size: 0.71rem;
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
  border-radius: 16px;
  background: var(--bg-surface);
}

.source-search-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.74rem;
}

.source-search-table th,
.source-search-table td {
  border: 0;
  text-align: left;
  padding: 0.55rem 0.7rem;
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
  table-layout: fixed;
  font-size: 0.74rem;
  margin: 0;
}

.results-table th,
.results-table td {
  border: 0;
  border-bottom: 1px solid
    color-mix(in srgb, var(--table-divider) 70%, transparent);
  color: var(--text-primary);
  text-align: left;
  padding: 0.48rem 0.62rem;
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

.results-row-actions-col {
  width: 8rem;
}

.results-row-actions-header {
  text-align: center;
  min-width: 8rem;
}

.results-table tbody tr.results-row-alt {
  background: var(--table-row-alt);
}

.results-table tbody tr:not(.results-spacer-row):hover {
  background: var(--bg-hover);
}

.results-spacer-row td {
  padding: 0;
  border: 0;
  background: transparent;
  pointer-events: none;
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
  margin-top: -0.1rem;
}

.cell-editor {
  width: 100%;
  min-width: 0;
  padding: 0.3rem 0.36rem;
  font-size: 0.72rem;
  font-family: inherit;
  color: var(--text-primary);
  border: 0;
  background: transparent;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.results-row-actions-cell {
  text-align: center;
  padding: 0.22rem 0.28rem;
}

.row-delete-btn {
  min-width: 5.2rem;
  justify-content: center;
  padding: 0.45rem 0.7rem;
  font-size: 0.68rem;
}

.row-delete-btn.delete-existing {
  border-color: color-mix(in srgb, var(--danger) 45%, var(--control-border));
}

.row-action-btn {
  margin-right: 0.28rem;
  padding: 0.55rem 0.85rem;
  font-size: 0.71rem;
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
  margin-top: 0.35rem;
  padding: 0.85rem 0 0.2rem;
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
  grid-template-rows: auto auto minmax(0, 1fr);
  min-height: 0;
  overflow: hidden;
  padding: 0 0.75rem 0.75rem;
  gap: 0.65rem;
}

.ddl-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.6rem;
  padding: 0.72rem 0.8rem;
  border-radius: 14px;
  background: color-mix(in srgb, var(--bg-surface-muted) 84%, transparent);
}

.ddl-header .muted {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.object-status-pill {
  display: inline-flex;
  align-items: center;
  padding: 0.14rem 0.48rem;
  border-radius: 999px;
  font-size: 0.64rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
}

.object-status-pill.invalid {
  color: color-mix(in srgb, var(--danger) 88%, #ffffff 12%);
  background: color-mix(in srgb, var(--danger) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--danger) 28%, transparent);
}

.object-detail-tabs {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.2rem 0;
}

.object-detail-tab {
  border: 0;
  border-radius: 10px;
  background: transparent;
  padding: 0.48rem 0.76rem;
  font-size: 0.7rem;
  color: var(--text-secondary);
  cursor: pointer;
}

.object-detail-tab:hover {
  background: var(--control-hover);
  color: var(--text-primary);
}

.object-detail-tab.active {
  background: var(--tab-active-bg);
  color: var(--text-primary);
  font-weight: 600;
}

.object-detail-grid-pane {
  min-height: 0;
  overflow: hidden;
  padding: 0.8rem;
  border-radius: 16px;
  background: var(--bg-surface);
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.object-invalid-banner {
  display: grid;
  gap: 0.32rem;
  padding: 0.8rem 0.9rem;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--danger) 38%, var(--border));
  background: color-mix(in srgb, var(--danger) 10%, var(--bg-surface));
}

.object-invalid-banner-label {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--danger) 88%, #ffffff 12%);
}

.object-invalid-banner-copy {
  font-size: 0.75rem;
  color: var(--text-primary);
  line-height: 1.45;
}

.object-loading-panel {
  min-height: 0;
  padding: 0.85rem 0.9rem;
  background: color-mix(in srgb, var(--bg-surface-muted) 70%, transparent);
  border-radius: 6px;
}

.object-loading-title {
  margin: 0 0 0.65rem;
}

.object-loading-skeleton {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.object-loading-line {
  display: block;
  height: 0.72rem;
  border-radius: 999px;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--table-divider) 45%, transparent) 0%,
    color-mix(in srgb, var(--table-header-bg) 80%, var(--bg-surface)) 50%,
    color-mix(in srgb, var(--table-divider) 45%, transparent) 100%
  );
  background-size: 200% 100%;
  animation: object-loading-shimmer 1.2s linear infinite;
}

.object-detail-grid-wrap {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

.object-detail-grid-pane.is-data-view .results-table td:not(.results-row-actions-cell) {
  font-family: Consolas, "Courier New", monospace;
}

.object-detail-grid-pane.is-data-view .cell-editor {
  font-family: Consolas, "Courier New", monospace;
}

.muted {
  color: var(--text-secondary);
  font-size: 0.72rem;
}

@media (max-width: 980px) {
  .workspace-toolbar {
    flex-direction: column;
    align-items: flex-start;
  }

  .toolbar-trailing {
    width: 100%;
  }

  .sheet-tabs,
  .source-search-toolbar,
  .ddl-header {
    padding: 0.65rem;
  }

  .query-sheet-pane,
  .source-search-pane,
  .ddl-pane {
    padding: 0 0.65rem 0.65rem;
  }
}

@keyframes sheet-tab-loading-pulse {
  0%,
  100% {
    opacity: 0.4;
  }

  50% {
    opacity: 1;
  }
}

@keyframes object-loading-shimmer {
  0% {
    background-position: 200% 0;
  }

  100% {
    background-position: -200% 0;
  }
}
</style>
