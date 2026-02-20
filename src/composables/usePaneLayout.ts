import { computed, onBeforeUnmount, onMounted, ref, type Ref } from "vue";

const PANEL_SPLITTER_SIZE = 6;
const MIN_SIDEBAR_WIDTH = 240;
const MIN_WORKSPACE_WIDTH = 560;
const MIN_SHEET_HEIGHT = 180;
const MIN_RESULTS_HEIGHT = 120;
const WORKSPACE_HEADER_HEIGHT = 58;

type ResizeState =
  | {
      axis: "sidebar";
      startPointer: number;
      startSize: number;
    }
  | {
      axis: "results";
      startPointer: number;
      startSize: number;
    };

interface PaneLayoutOptions {
  desktopShellEl: Ref<HTMLElement | null>;
  workspaceEl: Ref<HTMLElement | null>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function usePaneLayout(options: PaneLayoutOptions) {
  const sidebarWidth = ref(330);
  const resultsPaneHeight = ref(320);
  const activeResize = ref<ResizeState | null>(null);

  const desktopShellStyle = computed<Record<string, string>>(() => ({
    "--sidebar-width": `${sidebarWidth.value}px`,
  }));

  const workspaceStyle = computed<Record<string, string>>(() => ({
    "--results-height": `${resultsPaneHeight.value}px`,
  }));

  function maxSidebarWidth(): number {
    const shellWidth = options.desktopShellEl.value?.clientWidth ?? window.innerWidth;
    return Math.max(MIN_SIDEBAR_WIDTH, shellWidth - PANEL_SPLITTER_SIZE - MIN_WORKSPACE_WIDTH);
  }

  function maxResultsPaneHeight(): number {
    const workspaceHeight = options.workspaceEl.value?.clientHeight ?? 800;
    return Math.max(
      MIN_RESULTS_HEIGHT,
      workspaceHeight - WORKSPACE_HEADER_HEIGHT - PANEL_SPLITTER_SIZE - MIN_SHEET_HEIGHT,
    );
  }

  function applyLayoutBounds(): void {
    sidebarWidth.value = clamp(sidebarWidth.value, MIN_SIDEBAR_WIDTH, maxSidebarWidth());
    resultsPaneHeight.value = clamp(resultsPaneHeight.value, MIN_RESULTS_HEIGHT, maxResultsPaneHeight());
  }

  function beginSidebarResize(event: PointerEvent): void {
    if (window.matchMedia("(max-width: 980px)").matches) {
      return;
    }

    event.preventDefault();
    activeResize.value = {
      axis: "sidebar",
      startPointer: event.clientX,
      startSize: sidebarWidth.value,
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function beginResultsResize(event: PointerEvent): void {
    event.preventDefault();
    activeResize.value = {
      axis: "results",
      startPointer: event.clientY,
      startSize: resultsPaneHeight.value,
    };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }

  function clearResizeState(): void {
    activeResize.value = null;
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  }

  function handlePointerMove(event: PointerEvent): void {
    const resizing = activeResize.value;
    if (!resizing) {
      return;
    }

    if (resizing.axis === "sidebar") {
      const next = resizing.startSize + (event.clientX - resizing.startPointer);
      sidebarWidth.value = clamp(next, MIN_SIDEBAR_WIDTH, maxSidebarWidth());
      return;
    }

    const next = resizing.startSize - (event.clientY - resizing.startPointer);
    resultsPaneHeight.value = clamp(next, MIN_RESULTS_HEIGHT, maxResultsPaneHeight());
  }

  onMounted(() => {
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", clearResizeState);
    window.addEventListener("pointercancel", clearResizeState);
    window.addEventListener("blur", clearResizeState);
    window.addEventListener("resize", applyLayoutBounds);
    requestAnimationFrame(applyLayoutBounds);
  });

  onBeforeUnmount(() => {
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", clearResizeState);
    window.removeEventListener("pointercancel", clearResizeState);
    window.removeEventListener("blur", clearResizeState);
    window.removeEventListener("resize", applyLayoutBounds);
    clearResizeState();
  });

  return {
    desktopShellStyle,
    workspaceStyle,
    beginSidebarResize,
    beginResultsResize,
  };
}
