<script setup lang="ts">
import { onMounted, ref } from "vue";
import ExplorerSidebar from "./components/ExplorerSidebar.vue";
import QueryResultsPane from "./components/QueryResultsPane.vue";
import WorkspaceSheet from "./components/WorkspaceSheet.vue";
import { useClarityWorkspace } from "./composables/useClarityWorkspace";
import { usePaneLayout } from "./composables/usePaneLayout";

const desktopShellEl = ref<HTMLElement | null>(null);
const workspaceEl = ref<HTMLElement | null>(null);

const { desktopShellStyle, workspaceStyle, beginSidebarResize, beginResultsResize } = usePaneLayout({
  desktopShellEl,
  workspaceEl,
});

const {
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
  queryRowLimit,
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
} = useClarityWorkspace();

onMounted(() => {
  void loadConnectionProfiles();
});
</script>

<template>
  <main ref="desktopShellEl" class="desktop-shell" :style="desktopShellStyle">
    <ExplorerSidebar
      v-model:selected-profile-id="selectedProfileId"
      v-model:profile-name="profileName"
      v-model:save-profile-password="saveProfilePassword"
      :connection="connection"
      :connection-profiles="connectionProfiles"
      :selected-profile="selectedProfile"
      :busy="busy"
      :is-connected="isConnected"
      :session="session"
      :connected-schema="connectedSchema"
      :object-tree="objectTree"
      :selected-object="selectedObject"
      :is-object-type-expanded="isObjectTypeExpanded"
      :on-sync-selected-profile-ui="syncSelectedProfileUi"
      :on-apply-selected-profile="applySelectedProfile"
      :on-delete-selected-profile="deleteSelectedProfile"
      :on-save-connection-profile="saveConnectionProfile"
      :on-connect="connectOracle"
      :on-disconnect="disconnectOracle"
      :on-refresh-objects="refreshObjects"
      :on-toggle-object-type="toggleObjectType"
      :on-open-object-from-explorer="openObjectFromExplorer"
    />

    <div
      class="panel-resizer vertical"
      role="separator"
      aria-orientation="vertical"
      title="Resize explorer and workspace"
      @pointerdown="beginSidebarResize"
    ></div>

    <section ref="workspaceEl" class="workspace" :style="workspaceStyle">
      <WorkspaceSheet
        v-model:query-text="activeQueryText"
        v-model:ddl-text="activeDdlText"
        v-model:query-row-limit="queryRowLimit"
        v-model:source-search-text="sourceSearchText"
        :status-message="statusMessage"
        :query-tabs="queryTabs"
        :ddl-tabs="ddlTabs"
        :active-workspace-tab-id="activeWorkspaceTabId"
        :is-search-tab-active="isSearchTabActive"
        :is-connected="isConnected"
        :busy="busy"
        :active-query-tab="activeQueryTab"
        :active-ddl-tab="activeDdlTab"
        :active-ddl-object="activeDdlObject"
        :active-object-detail-tabs="activeObjectDetailTabs"
        :active-object-detail-tab-id="activeObjectDetailTabId"
        :active-object-detail-loading="activeObjectDetailLoading"
        :active-object-detail-result="activeObjectDetailResult"
        :selected-provider-label="selectedProviderLabel"
        :connected-schema="connectedSchema"
        :is-query-tab-active="isQueryTabActive"
        :source-search-results="sourceSearchResults"
        :source-search-performed="sourceSearchPerformed"
        :on-activate-workspace-tab="activateWorkspaceTab"
        :on-close-query-tab="closeQueryTab"
        :on-add-query-tab="addQueryTab"
        :on-open-search-tab="openSearchTab"
        :on-close-ddl-tab="closeDdlTab"
        :on-run-query="runQuery"
        :on-save-ddl="saveDdl"
        :on-refresh-active-object-detail="refreshActiveObjectDetail"
        :on-activate-object-detail-tab="activateObjectDetailTab"
        :on-run-source-search="runSourceSearch"
        :on-open-source-search-result="openSourceSearchResult"
        :is-likely-numeric="isLikelyNumeric"
      />

      <div
        class="panel-resizer horizontal"
        role="separator"
        aria-orientation="horizontal"
        title="Resize worksheet and results"
        @pointerdown="beginResultsResize"
      ></div>

      <QueryResultsPane
        :query-result="queryResult"
        :error-message="errorMessage"
        :is-likely-numeric="isLikelyNumeric"
      />
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
  --splitter-size: 6px;
  height: 100%;
  display: grid;
  grid-template-columns: var(--sidebar-width, 330px) var(--splitter-size) minmax(0, 1fr);
  background: var(--bg-shell);
  overflow: hidden;
}

.workspace {
  display: grid;
  grid-template-rows: var(--pane-header-height) minmax(180px, 1fr) var(--splitter-size) var(--results-height, 42%);
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.panel-resizer {
  background: var(--bg-surface-muted);
  position: relative;
  z-index: 2;
  touch-action: none;
}

.panel-resizer::after {
  content: "";
  position: absolute;
  inset: 0;
  transition: background-color 0.12s ease;
}

.panel-resizer:hover::after {
  background: rgba(79, 111, 150, 0.2);
}

.panel-resizer.vertical {
  cursor: col-resize;
  border-left: 1px solid var(--border);
  border-right: 1px solid var(--border);
}

.panel-resizer.horizontal {
  cursor: row-resize;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}

@media (max-width: 980px) {
  .desktop-shell {
    grid-template-columns: 1fr;
    grid-template-rows: 42% var(--splitter-size) 58%;
  }

  .panel-resizer.vertical {
    cursor: row-resize;
    border-left: 0;
    border-right: 0;
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }

  .workspace {
    grid-template-rows: var(--pane-header-height) minmax(150px, 1fr) var(--splitter-size) var(--results-height, 44%);
  }
}
</style>
