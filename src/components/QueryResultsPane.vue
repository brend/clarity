<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { DbQueryResult, WorkspaceQueryResultPane } from "../types/clarity";

const props = defineProps<{
  resultPanes: WorkspaceQueryResultPane[];
  activeResultPaneId: string | null;
  emptyStateMessage: string;
  isLikelyNumeric: (value: string) => boolean;
}>();

const emit = defineEmits<{
  activatePane: [paneId: string];
}>();

const activePane = computed<WorkspaceQueryResultPane | null>(() => {
  if (!props.resultPanes.length) {
    return null;
  }

  const currentPane = props.resultPanes.find((pane) => pane.id === props.activeResultPaneId);
  return currentPane ?? props.resultPanes[0];
});

const MIN_COLUMN_WIDTH = 88;
const DEFAULT_COLUMN_WIDTH = 180;
const DEFAULT_ROW_HEIGHT = 28;
const VIRTUAL_OVERSCAN_ROWS = 20;

type ColumnResizeState = {
  index: number;
  startX: number;
  startWidth: number;
};

type SortDirection = "asc" | "desc";

type SortState = {
  columnIndex: number;
  direction: SortDirection;
};

type GridCellCoord = {
  rowIndex: number;
  colIndex: number;
};

interface DbFilteredQueryRequest {
  sessionId: number;
  sql: string;
  rowLimit?: number;
  globalSearch?: string;
  columnFilters?: string[];
}

const columnWidths = ref<number[]>([]);
const resizeState = ref<ColumnResizeState | null>(null);
const paneSearchTerms = ref<Record<string, string>>({});
const paneColumnFilters = ref<Record<string, string[]>>({});
const paneSortStates = ref<Record<string, SortState | null>>({});
const paneFilteredResults = ref<Record<string, DbQueryResult | null>>({});
const paneFilterLoading = ref<Record<string, boolean>>({});
const paneFilterError = ref<Record<string, string>>({});
const activePaneId = computed<string>(() => activePane.value?.id ?? "");
const activeBaseResult = computed<DbQueryResult | null>(
  () => activePane.value?.queryResult ?? null,
);
const baseColumns = computed<string[]>(() => activeBaseResult.value?.columns ?? []);
const baseRows = computed<string[][]>(() => activeBaseResult.value?.rows ?? []);
const activeRemoteFilteredResult = computed<DbQueryResult | null>(() => {
  if (!activePaneId.value) {
    return null;
  }

  return paneFilteredResults.value[activePaneId.value] ?? null;
});
const activeRemoteFilterLoading = computed<boolean>(() => {
  if (!activePaneId.value) {
    return false;
  }

  return paneFilterLoading.value[activePaneId.value] === true;
});
const activeRemoteFilterError = computed<string>(() => {
  if (!activePaneId.value) {
    return "";
  }

  return paneFilterError.value[activePaneId.value] ?? "";
});
const activeColumns = computed<string[]>(() => {
  const hasLocalFilterCriteria =
    currentSearchTerm.value.trim().length > 0 ||
    currentColumnFilters.value.some((value) => value.trim().length > 0);
  if (hasLocalFilterCriteria && activeRemoteFilteredResult.value) {
    return activeRemoteFilteredResult.value.columns;
  }

  return baseColumns.value;
});
const activeRows = computed<string[][]>(() => {
  const hasLocalFilterCriteria =
    currentSearchTerm.value.trim().length > 0 ||
    currentColumnFilters.value.some((value) => value.trim().length > 0);
  if (hasLocalFilterCriteria && activeRemoteFilteredResult.value) {
    return activeRemoteFilteredResult.value.rows;
  }

  return baseRows.value;
});
const visibleColumnCount = computed<number>(() => Math.max(1, activeColumns.value.length));
const resultsContentEl = ref<HTMLElement | null>(null);
const resultsGridShellEl = ref<HTMLElement | null>(null);
const resultsScrollTop = ref(0);
const resultsViewportHeight = ref(0);
const resultRowHeight = ref(DEFAULT_ROW_HEIGHT);
const selectionAnchor = ref<GridCellCoord | null>(null);
const selectionFocus = ref<GridCellCoord | null>(null);
const isSelectionDragging = ref(false);
let resizeRafId: number | null = null;
let pendingResizePointerX: number | null = null;
let resultsResizeObserver: ResizeObserver | null = null;
let filterRefreshDebounceHandle: ReturnType<typeof setTimeout> | null = null;
let filterRefreshRequestToken = 0;

function normalizeSearchText(value: string): string {
  return value.toLocaleLowerCase();
}

function ensurePaneGridState(paneId: string, columnCount: number): void {
  if (!(paneId in paneSearchTerms.value)) {
    paneSearchTerms.value[paneId] = "";
  }

  const existingFilters = paneColumnFilters.value[paneId];
  if (!existingFilters || existingFilters.length !== columnCount) {
    paneColumnFilters.value[paneId] = Array.from(
      { length: columnCount },
      (_, index) => existingFilters?.[index] ?? "",
    );
  }

  const existingSortState = paneSortStates.value[paneId];
  if (existingSortState && existingSortState.columnIndex >= columnCount) {
    paneSortStates.value[paneId] = null;
  }
}

function resetColumnWidths(): void {
  columnWidths.value = activeColumns.value.map(() => DEFAULT_COLUMN_WIDTH);
}

const currentSearchTerm = computed<string>({
  get: () => {
    const paneId = activePaneId.value;
    if (!paneId) {
      return "";
    }

    return paneSearchTerms.value[paneId] ?? "";
  },
  set: (value) => {
    const paneId = activePaneId.value;
    if (!paneId) {
      return;
    }

    paneSearchTerms.value[paneId] = value;
  },
});

const currentColumnFilters = computed<string[]>(() => {
  const paneId = activePaneId.value;
  if (!paneId) {
    return [];
  }

  return paneColumnFilters.value[paneId] ?? [];
});

const currentSortState = computed<SortState | null>(() => {
  const paneId = activePaneId.value;
  if (!paneId) {
    return null;
  }

  return paneSortStates.value[paneId] ?? null;
});

const normalizedGlobalSearchTerm = computed<string>(() =>
  normalizeSearchText(currentSearchTerm.value.trim()),
);
const normalizedColumnFilters = computed<string[]>(() =>
  currentColumnFilters.value.map((value) => normalizeSearchText(value.trim())),
);
const hasActiveFilterCriteria = computed<boolean>(() => {
  if (normalizedGlobalSearchTerm.value.length > 0) {
    return true;
  }

  return normalizedColumnFilters.value.some((value) => value.length > 0);
});

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "Unexpected error";
  }
}

async function refreshServerFilteredRows(): Promise<void> {
  const pane = activePane.value;
  const paneId = activePaneId.value;
  if (!paneId) {
    return;
  }

  if (!hasActiveFilterCriteria.value) {
    paneFilterLoading.value[paneId] = false;
    paneFilterError.value[paneId] = "";
    paneFilteredResults.value[paneId] = null;
    return;
  }

  if (
    !pane?.queryResult ||
    !pane.sourceSql ||
    !Number.isFinite(pane.sourceSessionId) ||
    pane.sourceSessionId === null
  ) {
    paneFilterLoading.value[paneId] = false;
    paneFilterError.value[paneId] = "";
    paneFilteredResults.value[paneId] = null;
    return;
  }

  const requestToken = ++filterRefreshRequestToken;
  paneFilterLoading.value[paneId] = true;
  paneFilterError.value[paneId] = "";
  paneFilteredResults.value[paneId] = null;

  const request: DbFilteredQueryRequest = {
    sessionId: pane.sourceSessionId,
    sql: pane.sourceSql,
    rowLimit: pane.sourceRowLimit ?? undefined,
    globalSearch: currentSearchTerm.value.trim() || undefined,
    columnFilters: currentColumnFilters.value.map((value) => value.trim()),
  };

  try {
    const result = await invoke<DbQueryResult>("db_run_query_filtered", {
      request,
    });
    if (requestToken !== filterRefreshRequestToken) {
      return;
    }

    paneFilteredResults.value[paneId] = result;
  } catch (error) {
    if (requestToken !== filterRefreshRequestToken) {
      return;
    }

    paneFilterError.value[paneId] = toErrorMessage(error);
    paneFilteredResults.value[paneId] = null;
  } finally {
    if (requestToken === filterRefreshRequestToken) {
      paneFilterLoading.value[paneId] = false;
    }
  }
}

const filteredRows = computed<Array<{ row: string[]; sourceRowIndex: number }>>(() => {
  if (!activeRows.value.length) {
    return [];
  }

  const globalTerm = normalizedGlobalSearchTerm.value;
  const columnFilters = normalizedColumnFilters.value;

  return activeRows.value
    .map((row, sourceRowIndex) => ({ row, sourceRowIndex }))
    .filter(({ row }) => {
      if (globalTerm) {
        const matchesGlobalSearch = row.some((value) =>
          normalizeSearchText(value ?? "").includes(globalTerm),
        );
        if (!matchesGlobalSearch) {
          return false;
        }
      }

      for (let columnIndex = 0; columnIndex < columnFilters.length; columnIndex += 1) {
        const filterTerm = columnFilters[columnIndex];
        if (!filterTerm) {
          continue;
        }

        const cellValue = normalizeSearchText(row[columnIndex] ?? "");
        if (!cellValue.includes(filterTerm)) {
          return false;
        }
      }

      return true;
    });
});

function compareCellValues(leftValue: string | undefined, rightValue: string | undefined): number {
  const left = (leftValue ?? "").trim();
  const right = (rightValue ?? "").trim();
  const leftNumber = Number(left);
  const rightNumber = Number(right);

  if (
    left.length > 0 &&
    right.length > 0 &&
    Number.isFinite(leftNumber) &&
    Number.isFinite(rightNumber)
  ) {
    return leftNumber - rightNumber;
  }

  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

const filteredAndSortedRows = computed<Array<{ row: string[]; sourceRowIndex: number }>>(() => {
  const rows = [...filteredRows.value];
  const sortState = currentSortState.value;
  if (!sortState) {
    return rows;
  }

  const directionMultiplier = sortState.direction === "asc" ? 1 : -1;
  return rows.sort((left, right) => {
    const comparison = compareCellValues(
      left.row[sortState.columnIndex],
      right.row[sortState.columnIndex],
    );
    if (comparison !== 0) {
      return comparison * directionMultiplier;
    }

    return left.sourceRowIndex - right.sourceRowIndex;
  });
});

const visibleRowCount = computed<number>(() => filteredAndSortedRows.value.length);
const hasFilteredRows = computed<boolean>(() => visibleRowCount.value > 0);
const hasActiveColumnFilters = computed<boolean>(() =>
  currentColumnFilters.value.some((value) => value.trim().length > 0),
);
const canClearGridTools = computed<boolean>(
  () =>
    currentSearchTerm.value.trim().length > 0 ||
    hasActiveColumnFilters.value ||
    currentSortState.value !== null,
);
const canExportCsv = computed<boolean>(() => activeColumns.value.length > 0);
const rowSummaryLabel = computed<string>(() => {
  if (hasActiveFilterCriteria.value && activeRemoteFilterLoading.value) {
    return "Filtering...";
  }

  const totalRows = activeRows.value.length;
  const shownRows = visibleRowCount.value;
  const rowLabel = shownRows === 1 ? "row" : "rows";

  if (hasActiveFilterCriteria.value) {
    return `${shownRows} filtered ${rowLabel}`;
  }

  if (shownRows === totalRows) {
    return `${shownRows} ${rowLabel}`;
  }

  return `${shownRows} of ${totalRows} rows`;
});

const selectedCellRange = computed<{
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
} | null>(() => {
  if (
    !selectionAnchor.value ||
    !selectionFocus.value ||
    filteredAndSortedRows.value.length < 1 ||
    activeColumns.value.length < 1
  ) {
    return null;
  }

  const anchor = clampCellCoord(selectionAnchor.value);
  const focus = clampCellCoord(selectionFocus.value);
  return {
    startRow: Math.min(anchor.rowIndex, focus.rowIndex),
    endRow: Math.max(anchor.rowIndex, focus.rowIndex),
    startCol: Math.min(anchor.colIndex, focus.colIndex),
    endCol: Math.max(anchor.colIndex, focus.colIndex),
  };
});

const hasSelection = computed<boolean>(() => !!selectedCellRange.value);

function clampCellCoord(cell: GridCellCoord): GridCellCoord {
  const maxRowIndex = Math.max(0, filteredAndSortedRows.value.length - 1);
  const maxColIndex = Math.max(0, activeColumns.value.length - 1);
  return {
    rowIndex: Math.min(Math.max(cell.rowIndex, 0), maxRowIndex),
    colIndex: Math.min(Math.max(cell.colIndex, 0), maxColIndex),
  };
}

function stopSelectionDrag(): void {
  if (!isSelectionDragging.value) {
    return;
  }

  isSelectionDragging.value = false;
  window.removeEventListener("mouseup", stopSelectionDrag);
}

function clearSelection(): void {
  stopSelectionDrag();
  selectionAnchor.value = null;
  selectionFocus.value = null;
}

function ensureSelectionWithinBounds(): void {
  if (filteredAndSortedRows.value.length < 1 || activeColumns.value.length < 1) {
    clearSelection();
    return;
  }

  if (selectionAnchor.value) {
    selectionAnchor.value = clampCellCoord(selectionAnchor.value);
  }

  if (selectionFocus.value) {
    selectionFocus.value = clampCellCoord(selectionFocus.value);
  }

  if (selectionAnchor.value && !selectionFocus.value) {
    selectionFocus.value = clampCellCoord(selectionAnchor.value);
  } else if (!selectionAnchor.value && selectionFocus.value) {
    selectionAnchor.value = clampCellCoord(selectionFocus.value);
  }
}

function setCellSelection(
  rowIndex: number,
  colIndex: number,
  options: { extendFromAnchor?: boolean } = {},
): void {
  if (filteredAndSortedRows.value.length < 1 || activeColumns.value.length < 1) {
    return;
  }

  const nextCell = clampCellCoord({ rowIndex, colIndex });
  if (options.extendFromAnchor && selectionAnchor.value) {
    selectionFocus.value = nextCell;
    return;
  }

  selectionAnchor.value = nextCell;
  selectionFocus.value = nextCell;
}

function getActiveCell(): GridCellCoord | null {
  if (!selectedCellRange.value || !selectionFocus.value) {
    return null;
  }

  return clampCellCoord(selectionFocus.value);
}

function isCellInSelection(rowIndex: number, colIndex: number): boolean {
  const range = selectedCellRange.value;
  if (!range) {
    return false;
  }

  return (
    rowIndex >= range.startRow &&
    rowIndex <= range.endRow &&
    colIndex >= range.startCol &&
    colIndex <= range.endCol
  );
}

function isActiveCell(rowIndex: number, colIndex: number): boolean {
  const activeCell = getActiveCell();
  return (
    !!activeCell &&
    activeCell.rowIndex === rowIndex &&
    activeCell.colIndex === colIndex
  );
}

function scrollCellIntoView(cell: GridCellCoord): void {
  const gridShell = resultsGridShellEl.value;
  if (!gridShell) {
    return;
  }

  const cellEl = gridShell.querySelector<HTMLTableCellElement>(
    `td[data-cell-row="${cell.rowIndex}"][data-cell-col="${cell.colIndex}"]`,
  );
  cellEl?.scrollIntoView({
    block: "nearest",
    inline: "nearest",
  });
}

function focusGridShell(): void {
  resultsGridShellEl.value?.focus();
}

function isGridShellFocused(): boolean {
  const gridShell = resultsGridShellEl.value;
  const activeEl = document.activeElement;
  if (!gridShell || !(activeEl instanceof HTMLElement)) {
    return false;
  }

  return activeEl === gridShell || gridShell.contains(activeEl);
}

function isTextInputFocused(): boolean {
  const activeEl = document.activeElement;
  if (!(activeEl instanceof HTMLElement)) {
    return false;
  }

  return (
    activeEl instanceof HTMLInputElement ||
    activeEl instanceof HTMLTextAreaElement ||
    activeEl.isContentEditable
  );
}

function onDataCellMouseDown(
  rowIndex: number,
  colIndex: number,
  event: MouseEvent,
): void {
  if (event.button !== 0) {
    return;
  }

  event.preventDefault();
  focusGridShell();
  setCellSelection(rowIndex, colIndex, { extendFromAnchor: event.shiftKey });
  isSelectionDragging.value = true;
  window.addEventListener("mouseup", stopSelectionDrag);
}

function onDataCellMouseEnter(rowIndex: number, colIndex: number): void {
  if (!isSelectionDragging.value) {
    return;
  }

  setCellSelection(rowIndex, colIndex, { extendFromAnchor: true });
}

function isNavigationKey(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return false;
  }

  return (
    event.key === "ArrowUp" ||
    event.key === "ArrowDown" ||
    event.key === "ArrowLeft" ||
    event.key === "ArrowRight"
  );
}

function moveSelection(
  rowDelta: number,
  colDelta: number,
  extendFromAnchor: boolean,
): void {
  if (filteredAndSortedRows.value.length < 1 || activeColumns.value.length < 1) {
    return;
  }

  const current = getActiveCell();
  if (!current) {
    const firstCell = { rowIndex: 0, colIndex: 0 };
    setCellSelection(firstCell.rowIndex, firstCell.colIndex);
    scrollCellIntoView(firstCell);
    return;
  }

  const nextCell = clampCellCoord({
    rowIndex: current.rowIndex + rowDelta,
    colIndex: current.colIndex + colDelta,
  });
  setCellSelection(nextCell.rowIndex, nextCell.colIndex, { extendFromAnchor });
  scrollCellIntoView(nextCell);
}

function toTsvCell(value: string): string {
  if (/["\t\r\n]/.test(value)) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }

  return value;
}

function getSelectionClipboardText(): string {
  const range = selectedCellRange.value;
  if (!range) {
    return "";
  }

  const lines: string[] = [];
  for (let rowIndex = range.startRow; rowIndex <= range.endRow; rowIndex += 1) {
    const sourceRow = filteredAndSortedRows.value[rowIndex]?.row ?? [];
    const cells: string[] = [];
    for (let colIndex = range.startCol; colIndex <= range.endCol; colIndex += 1) {
      cells.push(toTsvCell(sourceRow[colIndex] ?? ""));
    }
    lines.push(cells.join("\t"));
  }

  return lines.join("\n");
}

async function writeTextToClipboard(text: string): Promise<boolean> {
  if (!text) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.select();

    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }

    document.body.removeChild(textarea);
    return copied;
  }
}

function shouldHandleCopy(requireGridFocus: boolean): boolean {
  if (!hasSelection.value || isTextInputFocused()) {
    return false;
  }

  return !requireGridFocus || isGridShellFocused();
}

async function copySelectionToClipboard(requireGridFocus: boolean): Promise<void> {
  if (!shouldHandleCopy(requireGridFocus)) {
    return;
  }

  const text = getSelectionClipboardText();
  if (!text) {
    return;
  }

  await writeTextToClipboard(text);
}

function setCurrentSortState(nextSortState: SortState | null): void {
  const paneId = activePaneId.value;
  if (!paneId) {
    return;
  }

  paneSortStates.value[paneId] = nextSortState;
}

function toggleColumnSort(columnIndex: number): void {
  const sortState = currentSortState.value;
  if (!sortState || sortState.columnIndex !== columnIndex) {
    setCurrentSortState({
      columnIndex,
      direction: "asc",
    });
    return;
  }

  if (sortState.direction === "asc") {
    setCurrentSortState({
      columnIndex,
      direction: "desc",
    });
    return;
  }

  setCurrentSortState(null);
}

function getColumnSortIndicator(columnIndex: number): string {
  const sortState = currentSortState.value;
  if (!sortState || sortState.columnIndex !== columnIndex) {
    return "";
  }

  return sortState.direction === "asc" ? "^" : "v";
}

function getColumnSortLabel(column: string, columnIndex: number): string {
  const sortState = currentSortState.value;
  if (!sortState || sortState.columnIndex !== columnIndex) {
    return `Sort ${column} ascending`;
  }

  if (sortState.direction === "asc") {
    return `Sort ${column} descending`;
  }

  return `Clear sort for ${column}`;
}

function onColumnFilterInput(columnIndex: number, event: Event): void {
  const paneId = activePaneId.value;
  if (!paneId) {
    return;
  }

  const target = event.target as HTMLInputElement | null;
  if (!target) {
    return;
  }

  ensurePaneGridState(paneId, baseColumns.value.length);
  const nextFilters = [...(paneColumnFilters.value[paneId] ?? [])];
  nextFilters[columnIndex] = target.value;
  paneColumnFilters.value[paneId] = nextFilters;
}

function clearGridTools(): void {
  const paneId = activePaneId.value;
  if (!paneId) {
    return;
  }

  paneSearchTerms.value[paneId] = "";
  paneSortStates.value[paneId] = null;
  paneColumnFilters.value[paneId] = baseColumns.value.map(() => "");
}

function toCsvCell(value: string): string {
  if (/["\r\n,]/.test(value)) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }

  return value;
}

function sanitizeFileNameSegment(value: string): string {
  return (
    value
      .trim()
      .toLocaleLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "results"
  );
}

function exportCsv(): void {
  if (!canExportCsv.value || !activePane.value) {
    return;
  }

  const columns = activeColumns.value;
  const csvRows = filteredAndSortedRows.value.map(({ row }) =>
    columns.map((_, columnIndex) => row[columnIndex] ?? ""),
  );
  const csvLines = [
    columns.map((value) => toCsvCell(value)).join(","),
    ...csvRows.map((row) => row.map((value) => toCsvCell(value)).join(",")),
  ];
  const csvText = `${csvLines.join("\r\n")}\r\n`;
  const blob = new Blob([csvText], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const timestamp = new Date()
    .toISOString()
    .replace(/:/g, "-")
    .replace(/\.\d{3}Z$/, "Z");
  const fileName = `${sanitizeFileNameSegment(activePane.value.title)}-${timestamp}.csv`;
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
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

function handleResultsCopy(event: ClipboardEvent): void {
  if (!shouldHandleCopy(true)) {
    return;
  }

  const text = getSelectionClipboardText();
  if (!text) {
    return;
  }

  if (event.clipboardData) {
    event.preventDefault();
    event.clipboardData.setData("text/plain", text);
    return;
  }

  event.preventDefault();
  void copySelectionToClipboard(true);
}

function handleResultsKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.isComposing) {
    return;
  }

  if (event.repeat && !isNavigationKey(event)) {
    return;
  }

  if (!isGridShellFocused()) {
    return;
  }

  if (isTextInputFocused()) {
    return;
  }

  if (isNavigationKey(event)) {
    event.preventDefault();
    if (event.key === "ArrowUp") {
      moveSelection(-1, 0, event.shiftKey);
      return;
    }
    if (event.key === "ArrowDown") {
      moveSelection(1, 0, event.shiftKey);
      return;
    }
    if (event.key === "ArrowLeft") {
      moveSelection(0, -1, event.shiftKey);
      return;
    }
    moveSelection(0, 1, event.shiftKey);
    return;
  }

  if (isPlainEscape(event)) {
    event.preventDefault();
    clearSelection();
  }
}

watch(
  () => [activePaneId.value, baseColumns.value.length],
  () => {
    if (activePaneId.value) {
      ensurePaneGridState(activePaneId.value, baseColumns.value.length);
    }

    clearSelection();
    resetColumnWidths();
    resultRowHeight.value = DEFAULT_ROW_HEIGHT;
    const contentEl = resultsContentEl.value;
    if (contentEl) {
      contentEl.scrollTop = 0;
    }
    resultsScrollTop.value = 0;
    void nextTick(() => {
      updateResultsViewportMetrics();
      measureResultRowHeight();
    });
  },
  { immediate: true },
);

watch(
  () => [
    activeRows.value.length,
    filteredAndSortedRows.value.length,
    activeColumns.value.length,
  ],
  () => {
    ensureSelectionWithinBounds();
    void nextTick(() => {
      updateResultsViewportMetrics();
      measureResultRowHeight();
    });
  },
);

const gridViewStateToken = computed<string>(() => {
  const sortState = currentSortState.value;
  return [
    activePaneId.value,
    currentSearchTerm.value,
    normalizedColumnFilters.value.join("\u001f"),
    sortState ? `${sortState.columnIndex}:${sortState.direction}` : "",
  ].join("\u001e");
});

watch(gridViewStateToken, () => {
  ensureSelectionWithinBounds();
  const contentEl = resultsContentEl.value;
  if (contentEl) {
    contentEl.scrollTop = 0;
  }

  resultsScrollTop.value = 0;
  void nextTick(() => {
    updateResultsViewportMetrics();
    measureResultRowHeight();
  });
});

const filterRefreshToken = computed<string>(() => {
  const pane = activePane.value;
  return [
    activePaneId.value,
    pane?.sourceSql ?? "",
    pane?.sourceSessionId ?? "",
    pane?.sourceRowLimit ?? "",
    normalizedGlobalSearchTerm.value,
    normalizedColumnFilters.value.join("\u001f"),
  ].join("\u001e");
});

watch(
  filterRefreshToken,
  () => {
    if (filterRefreshDebounceHandle) {
      window.clearTimeout(filterRefreshDebounceHandle);
      filterRefreshDebounceHandle = null;
    }

    if (!hasActiveFilterCriteria.value) {
      void refreshServerFilteredRows();
      return;
    }

    filterRefreshDebounceHandle = window.setTimeout(() => {
      filterRefreshDebounceHandle = null;
      void refreshServerFilteredRows();
    }, 220);
  },
  { immediate: true },
);

function getColumnWidth(index: number): number {
  return columnWidths.value[index] ?? DEFAULT_COLUMN_WIDTH;
}

function onColumnResizeMove(event: MouseEvent): void {
  if (!resizeState.value) {
    return;
  }

  pendingResizePointerX = event.clientX;
  if (resizeRafId !== null) {
    return;
  }

  resizeRafId = window.requestAnimationFrame(() => {
    resizeRafId = null;
    const state = resizeState.value;
    const pointerX = pendingResizePointerX;
    if (!state || pointerX === null) {
      return;
    }

    const nextWidth = Math.max(
      MIN_COLUMN_WIDTH,
      state.startWidth + (pointerX - state.startX),
    );
    columnWidths.value[state.index] = nextWidth;
  });
}

function stopColumnResize(): void {
  if (!resizeState.value) {
    return;
  }

  resizeState.value = null;
  pendingResizePointerX = null;
  if (resizeRafId !== null) {
    window.cancelAnimationFrame(resizeRafId);
    resizeRafId = null;
  }
  window.removeEventListener("mousemove", onColumnResizeMove);
  window.removeEventListener("mouseup", stopColumnResize);
}

function startColumnResize(index: number, event: MouseEvent): void {
  if (event.button !== 0) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  resizeState.value = {
    index,
    startX: event.clientX,
    startWidth: getColumnWidth(index),
  };
  pendingResizePointerX = event.clientX;
  window.addEventListener("mousemove", onColumnResizeMove);
  window.addEventListener("mouseup", stopColumnResize);
}

function updateResultsViewportMetrics(): void {
  const contentEl = resultsContentEl.value;
  if (!contentEl) {
    resultsViewportHeight.value = 0;
    return;
  }

  resultsViewportHeight.value = contentEl.clientHeight;
  resultsScrollTop.value = contentEl.scrollTop;
}

function onResultsScroll(event: Event): void {
  const target = event.target as HTMLElement | null;
  if (!target) {
    return;
  }

  resultsScrollTop.value = target.scrollTop;
}

function measureResultRowHeight(): void {
  const contentEl = resultsContentEl.value;
  if (!contentEl) {
    return;
  }

  const firstRow = contentEl.querySelector<HTMLTableRowElement>(
    "tr[data-result-row]",
  );
  if (!firstRow) {
    return;
  }

  const measuredHeight = firstRow.getBoundingClientRect().height;
  if (Number.isFinite(measuredHeight) && measuredHeight > 1) {
    resultRowHeight.value = measuredHeight;
  }
}

const visibleStartRow = computed<number>(() => {
  if (!filteredAndSortedRows.value.length || resultRowHeight.value <= 0) {
    return 0;
  }

  const rawStart = Math.floor(resultsScrollTop.value / resultRowHeight.value);
  return Math.max(0, rawStart - VIRTUAL_OVERSCAN_ROWS);
});

const visibleEndRow = computed<number>(() => {
  const rowCount = filteredAndSortedRows.value.length;
  if (!rowCount || resultRowHeight.value <= 0) {
    return 0;
  }

  const visibleRows = Math.ceil(
    Math.max(resultsViewportHeight.value, resultRowHeight.value) /
      resultRowHeight.value,
  );
  const bufferedEnd = visibleStartRow.value + visibleRows + VIRTUAL_OVERSCAN_ROWS * 2;
  return Math.min(rowCount, bufferedEnd);
});

const visibleRows = computed<
  Array<{ row: string[]; rowIndex: number; sourceRowIndex: number }>
>(() => {
  if (!filteredAndSortedRows.value.length) {
    return [];
  }

  return filteredAndSortedRows.value
    .slice(visibleStartRow.value, visibleEndRow.value)
    .map(({ row, sourceRowIndex }, localIndex) => ({
      row,
      rowIndex: visibleStartRow.value + localIndex,
      sourceRowIndex,
    }));
});

const topSpacerHeight = computed<number>(() => {
  return visibleStartRow.value * resultRowHeight.value;
});

const bottomSpacerHeight = computed<number>(() => {
  const remainingRows = Math.max(
    0,
    filteredAndSortedRows.value.length - visibleEndRow.value,
  );
  return remainingRows * resultRowHeight.value;
});

onMounted(() => {
  window.addEventListener("resize", updateResultsViewportMetrics);
  if (typeof ResizeObserver !== "undefined" && resultsContentEl.value) {
    resultsResizeObserver = new ResizeObserver(() => {
      updateResultsViewportMetrics();
    });
    resultsResizeObserver.observe(resultsContentEl.value);
  }
  void nextTick(() => {
    updateResultsViewportMetrics();
    measureResultRowHeight();
  });
});

onBeforeUnmount(() => {
  stopColumnResize();
  stopSelectionDrag();
  if (filterRefreshDebounceHandle) {
    window.clearTimeout(filterRefreshDebounceHandle);
    filterRefreshDebounceHandle = null;
  }
  filterRefreshRequestToken += 1;
  if (resultsResizeObserver) {
    resultsResizeObserver.disconnect();
    resultsResizeObserver = null;
  }
  window.removeEventListener("resize", updateResultsViewportMetrics);
});
</script>

<template>
  <section
    class="results-pane"
    @keydown.capture="handleResultsKeydown"
    @copy.capture="handleResultsCopy"
  >
    <div class="results-header">
      <div
        v-if="props.resultPanes.length"
        class="results-tabs"
        role="tablist"
        aria-label="Result tabs"
      >
        <button
          v-for="pane in props.resultPanes"
          :key="pane.id"
          type="button"
          role="tab"
          class="results-tab"
          :class="{ active: pane.id === activePane?.id }"
          :aria-selected="pane.id === activePane?.id"
          @click="emit('activatePane', pane.id)"
        >
          {{ pane.title }}
        </button>
      </div>
      <div v-else class="results-title">Results</div>
      <div v-if="activePane?.errorMessage" class="error-inline">{{ activePane.errorMessage }}</div>
    </div>

    <div ref="resultsContentEl" class="results-content" @scroll="onResultsScroll">
      <div v-if="!activePane || !activePane.queryResult" class="results-empty-state">
        <div class="results-empty-label">No results yet</div>
        <p class="muted">{{ props.emptyStateMessage }}</p>
      </div>

      <template v-else>
        <div v-if="activePane.queryResult.columns.length" class="results-toolbar">
          <input
            v-model="currentSearchTerm"
            class="results-search-input"
            type="search"
            placeholder="Search visible result rows"
            spellcheck="false"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            data-gramm="false"
          />
          <span class="muted results-row-summary">{{ rowSummaryLabel }}</span>
          <button
            class="results-toolbar-btn"
            type="button"
            :disabled="!canClearGridTools"
            @click="clearGridTools"
          >
            Clear
          </button>
          <button
            class="results-toolbar-btn"
            type="button"
            :disabled="!canExportCsv"
            @click="exportCsv"
          >
            Export CSV
          </button>
          <button
            class="results-toolbar-btn"
            type="button"
            :disabled="!hasSelection"
            @click="copySelectionToClipboard(false)"
          >
            Copy Selection
          </button>
        </div>

        <p v-if="activePane.errorMessage" class="results-error">
          {{ activePane.errorMessage }}
        </p>

        <p v-if="activePane.queryResult.rowsAffected !== null" class="muted">
          Rows affected: {{ activePane.queryResult.rowsAffected }}
        </p>
        <p
          v-else-if="baseRows.length > 0 && !hasFilteredRows"
          class="muted results-empty-filtered"
        >
          No rows match current search or column filters.
        </p>
        <p
          v-if="hasActiveFilterCriteria && activeRemoteFilterError"
          class="muted results-filter-fallback"
          :title="activeRemoteFilterError"
        >
          Showing matches from loaded rows only.
        </p>

        <div
          v-if="activePane.queryResult.columns.length"
          ref="resultsGridShellEl"
          class="results-grid-shell"
          tabindex="0"
        >
          <table
            class="results-table"
            :class="{ 'is-resizing': !!resizeState }"
          >
            <colgroup>
              <col
                v-for="(column, columnIndex) in activePane.queryResult.columns"
                :key="`col-${column}-${columnIndex}`"
                :style="{ width: `${getColumnWidth(columnIndex)}px` }"
              />
            </colgroup>
            <thead>
              <tr>
                <th
                  v-for="(column, columnIndex) in activePane.queryResult.columns"
                  :key="`${column}-${columnIndex}`"
                  :class="{
                    'results-sort-active':
                      currentSortState?.columnIndex === columnIndex,
                  }"
                >
                  <button
                    class="results-col-sort-button"
                    type="button"
                    :aria-label="getColumnSortLabel(column, columnIndex)"
                    @click="toggleColumnSort(columnIndex)"
                  >
                    <span class="results-cell-text" :title="column">{{ column }}</span>
                    <span class="results-sort-indicator" aria-hidden="true">
                      {{ getColumnSortIndicator(columnIndex) }}
                    </span>
                  </button>
                  <button
                    class="results-col-resize-handle"
                    type="button"
                    tabindex="-1"
                    aria-hidden="true"
                    @mousedown="startColumnResize(columnIndex, $event)"
                  ></button>
                </th>
              </tr>
              <tr class="results-filter-row">
                <th
                  v-for="(column, columnIndex) in activePane.queryResult.columns"
                  :key="`filter-${column}-${columnIndex}`"
                >
                  <input
                    class="results-filter-input"
                    :value="currentColumnFilters[columnIndex] ?? ''"
                    :placeholder="`Filter ${column}`"
                    type="search"
                    spellcheck="false"
                    autocomplete="off"
                    autocorrect="off"
                    autocapitalize="off"
                    data-gramm="false"
                    @input="onColumnFilterInput(columnIndex, $event)"
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="topSpacerHeight > 0" class="results-spacer-row" aria-hidden="true">
                <td :colspan="visibleColumnCount" :style="{ height: `${topSpacerHeight}px` }"></td>
              </tr>
              <tr
                v-for="{ row, rowIndex, sourceRowIndex } in visibleRows"
                :key="`row-${sourceRowIndex}-${rowIndex}`"
                :data-result-row="rowIndex"
                :class="{ 'results-row-alt': rowIndex % 2 === 1 }"
              >
                <td
                  v-for="(value, colIndex) in row"
                  :key="`col-${rowIndex}-${colIndex}`"
                  :data-cell-row="rowIndex"
                  :data-cell-col="colIndex"
                  :class="{
                    'results-cell-number': props.isLikelyNumeric(value),
                    'results-cell-selected': isCellInSelection(rowIndex, colIndex),
                    'results-cell-active': isActiveCell(rowIndex, colIndex),
                  }"
                  @mousedown="onDataCellMouseDown(rowIndex, colIndex, $event)"
                  @mouseenter="onDataCellMouseEnter(rowIndex, colIndex)"
                >
                  <span class="results-cell-text" :title="value">{{ value }}</span>
                </td>
              </tr>
              <tr v-if="bottomSpacerHeight > 0" class="results-spacer-row" aria-hidden="true">
                <td :colspan="visibleColumnCount" :style="{ height: `${bottomSpacerHeight}px` }"></td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </div>
    <div v-if="activePane?.queryResult?.message" class="results-footer">
      <span class="muted">{{ activePane.queryResult.message }}</span>
    </div>
  </section>
</template>

<style scoped>
.results-pane {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  min-height: 0;
  border-radius: 4px;
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--bg-surface-muted) 44%, transparent) 0%,
      color-mix(in srgb, var(--bg-surface) 94%, transparent) 100%
    );
  box-shadow: var(--card-shadow);
  overflow: hidden;
}

.results-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 2.6rem;
  padding: 0.5rem 0.75rem;
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--bg-surface-muted) 88%, transparent) 0%,
      color-mix(in srgb, var(--bg-surface) 42%, transparent) 100%
    );
}

.results-title {
  font-size: 0.76rem;
  font-weight: 700;
  color: var(--text-primary);
}

.results-tabs {
  display: flex;
  align-items: stretch;
  min-width: 0;
  height: 100%;
  gap: 0.35rem;
}

.results-tab {
  min-height: 1.5rem;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--text-subtle);
  font-size: 0.68rem;
  font-weight: 600;
  padding: 0 0.5rem;
  cursor: pointer;
  transition: color 0.12s ease;
}

.results-tab:hover {
  color: var(--text-primary);
}

.results-tab.active {
  background: transparent;
  color: var(--text-primary);
  box-shadow: inset 0 -2px 0 var(--accent);
}

.error-inline {
  margin-left: auto;
  font-size: 0.72rem;
  color: var(--danger);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.results-content {
  min-height: 0;
  overflow: auto;
  padding: 0.5rem;
  margin: 0;
  font-family: Consolas, "Courier New", monospace;
}

.results-empty-state {
  display: grid;
  gap: 0.35rem;
  min-height: 100%;
  align-content: center;
  padding: 1rem 1.1rem;
  border-radius: 4px;
  background: color-mix(in srgb, var(--bg-surface-muted) 82%, transparent);
}

.results-empty-label {
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-subtle);
}

.results-toolbar {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.38rem 0.5rem;
  border-radius: 3px;
  background: color-mix(in srgb, var(--bg-surface-muted) 84%, transparent);
  margin-bottom: 0.5rem;
}

.results-search-input,
.results-filter-input {
  border: 0;
  border-radius: 3px;
  background: var(--control-bg);
  color: var(--text-primary);
  font-family: inherit;
}

.results-search-input {
  flex: 1 1 14rem;
  min-width: 11rem;
  padding: 0.26rem 0.4rem;
  font-size: 0.66rem;
}

.results-filter-input {
  width: 100%;
  padding: 0.2rem 0.32rem;
  font-size: 0.65rem;
}

.results-toolbar-btn {
  border: 0;
  border-radius: 3px;
  background: color-mix(in srgb, var(--control-bg) 92%, transparent);
  color: var(--text-primary);
  font-size: 0.64rem;
  font-weight: 600;
  padding: 0.24rem 0.38rem;
  cursor: pointer;
}

.results-toolbar-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.results-toolbar-btn:not(:disabled):hover {
  background: var(--control-hover);
}

.results-row-summary {
  white-space: nowrap;
  margin-left: auto;
}

.results-table {
  width: auto;
  min-width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;
  font-size: 0.7rem;
  margin: 0;
  border-radius: 3px;
  overflow: hidden;
  background: var(--bg-surface);
}

.results-grid-shell {
  border-radius: 3px;
  overflow: hidden;
}

.results-grid-shell:focus-visible {
  outline: 1px solid var(--focus-ring);
  outline-offset: 1px;
}

.results-table th,
.results-table td {
  border: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--table-divider) 70%, transparent);
  color: var(--text-primary);
  text-align: left;
  padding: 0.3rem 0.5rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.results-table th {
  background: var(--table-header-bg);
  position: sticky;
  top: 0;
  font-weight: 600;
  z-index: 2;
  padding-right: 0.5rem;
  overflow: visible;
}

.results-table tbody tr.results-row-alt {
  background: var(--table-row-alt);
}

.results-table tbody tr:not(.results-spacer-row):hover {
  background: var(--bg-hover);
}

.results-table tbody tr:not(.results-spacer-row) td {
  user-select: none;
}

.results-cell-selected {
  background: color-mix(in srgb, var(--accent) 18%, var(--bg-surface)) !important;
}

.results-cell-active {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 82%, #ffffff 18%);
}

.results-sort-active {
  background: color-mix(in srgb, var(--table-header-bg) 85%, var(--accent-soft));
}

.results-col-sort-button {
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  display: flex;
  align-items: center;
  gap: 0.25rem;
  width: calc(100% - 10px);
  min-width: 0;
  text-align: left;
  padding: 0;
  cursor: pointer;
}

.results-sort-indicator {
  width: 0.68rem;
  min-width: 0.68rem;
  text-align: center;
  color: var(--text-secondary);
  font-size: 0.63rem;
}

.results-filter-row th {
  position: static;
  top: auto;
  z-index: 1;
  background: color-mix(in srgb, var(--bg-surface-muted) 80%, transparent);
  padding: 0.22rem 0.36rem;
}

.results-spacer-row td {
  padding: 0;
  border: 0;
  background: transparent;
  pointer-events: none;
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

.muted {
  color: var(--text-secondary);
  font-size: 0.73rem;
}

.results-message {
  margin: 0 0 0.45rem;
}

.results-footer {
  padding: 0.3rem 0.75rem;
  font-size: 0.7rem;
  border-top: 1px solid color-mix(in srgb, var(--table-divider) 70%, transparent);
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--bg-surface-muted) 88%, transparent) 0%,
      color-mix(in srgb, var(--bg-surface) 42%, transparent) 100%
    );
}

.results-empty-filtered {
  margin-bottom: 0.45rem;
}

.results-filter-fallback {
  margin-bottom: 0.45rem;
}

.results-error {
  color: var(--danger);
  font-size: 0.73rem;
  margin: 0 0 0.45rem;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

@media (max-width: 980px) {
  .results-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .results-content {
    padding: 0.75rem;
  }

  .results-toolbar {
    flex-wrap: wrap;
  }
}
</style>
