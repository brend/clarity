<script setup lang="ts">
import { ref, watch } from "vue";
import AppIcon from "./AppIcon.vue";
import type {
  BusyState,
  ConnectionProfile,
  ObjectTreeNode,
  OracleConnectRequest,
  OracleObjectEntry,
  OracleSessionSummary,
} from "../types/clarity";

const selectedProfileId = defineModel<string>("selectedProfileId", { required: true });
const profileName = defineModel<string>("profileName", { required: true });
const saveProfilePassword = defineModel<boolean>("saveProfilePassword", { required: true });

const props = defineProps<{
  connection: OracleConnectRequest;
  connectionProfiles: ConnectionProfile[];
  selectedProfile: ConnectionProfile | null;
  busy: BusyState;
  isConnected: boolean;
  session: OracleSessionSummary | null;
  connectedSchema: string;
  objectTree: ObjectTreeNode[];
  selectedObject: OracleObjectEntry | null;
  isObjectTypeExpanded: (objectType: string) => boolean;
  onSyncSelectedProfileUi: () => void;
  onApplySelectedProfile: () => void;
  onDeleteSelectedProfile: () => void;
  onSaveConnectionProfile: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onRefreshObjects: () => void;
  onToggleObjectType: (objectType: string) => void;
  onOpenObjectFromExplorer: (object: OracleObjectEntry) => void;
}>();

const connectionPanelCollapsed = ref(props.isConnected);

watch(
  () => props.isConnected,
  (isConnected, wasConnected) => {
    if (isConnected && !wasConnected) {
      connectionPanelCollapsed.value = true;
      return;
    }

    if (!isConnected && wasConnected) {
      connectionPanelCollapsed.value = false;
    }
  },
);

function toggleConnectionPanel(): void {
  connectionPanelCollapsed.value = !connectionPanelCollapsed.value;
}
</script>

<template>
  <aside class="explorer-sidebar">
    <header class="sidebar-header">Object Explorer</header>

    <section class="connect-box">
      <div class="connect-heading">
        <div class="connect-title">Database Connection</div>
        <button
          class="btn connect-toggle"
          type="button"
          :title="connectionPanelCollapsed ? 'Show connection panel' : 'Hide connection panel'"
          :aria-expanded="!connectionPanelCollapsed"
          aria-controls="connection-panel-body"
          @click="toggleConnectionPanel"
        >
          <AppIcon
            name="chevron-right"
            class="connect-toggle-icon"
            :class="{ expanded: !connectionPanelCollapsed }"
            aria-hidden="true"
          />
        </button>
      </div>

      <div class="session-line">
        {{ props.session ? props.session.displayName : "No active connection" }}
      </div>

      <div v-show="!connectionPanelCollapsed" id="connection-panel-body" class="connect-body">
        <div class="profile-controls">
          <label>
            Profiles
            <select v-model="selectedProfileId" @change="props.onSyncSelectedProfileUi">
              <option value="">(Select profile)</option>
              <option v-for="profile in props.connectionProfiles" :key="profile.id" :value="profile.id">
                {{ profile.name }}
              </option>
            </select>
          </label>
          <div class="profile-actions">
            <button
              class="btn"
              :disabled="!props.selectedProfile || props.busy.loadingProfileSecret || props.busy.loadingProfiles"
              @click="props.onApplySelectedProfile"
            >
              {{ props.busy.loadingProfileSecret ? "Loading..." : "Load Profile" }}
            </button>
            <button
              class="btn"
              :disabled="!props.selectedProfile || props.busy.deletingProfile"
              @click="props.onDeleteSelectedProfile"
            >
              {{ props.busy.deletingProfile ? "Deleting..." : "Delete" }}
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
          <button class="btn" :disabled="props.busy.savingProfile" @click="props.onSaveConnectionProfile">
            {{ props.busy.savingProfile ? "Saving..." : "Save Profile" }}
          </button>
        </div>

        <div class="field-grid">
          <label>
            Provider
            <select v-model="props.connection.provider">
              <option value="oracle">Oracle</option>
              <option value="postgres" disabled>PostgreSQL (Soon)</option>
              <option value="mysql" disabled>MySQL (Soon)</option>
              <option value="sqlite" disabled>SQLite (Soon)</option>
            </select>
          </label>

          <label>
            Host
            <input v-model.trim="props.connection.host" placeholder="db.example.com" />
          </label>

          <label>
            Port
            <input v-model.number="props.connection.port" type="number" min="1" max="65535" />
          </label>

          <label>
            Service
            <input v-model.trim="props.connection.serviceName" placeholder="XEPDB1" />
          </label>

          <label>
            Username
            <input v-model.trim="props.connection.username" placeholder="hr" />
          </label>

          <label>
            Schema
            <input v-model.trim="props.connection.schema" placeholder="HR" />
          </label>

          <label>
            Password
            <input v-model="props.connection.password" type="password" placeholder="********" />
          </label>
        </div>

        <div class="connect-actions">
          <button class="btn primary" :disabled="props.busy.connecting || props.isConnected" @click="props.onConnect">
            <AppIcon name="plug" class="btn-icon" aria-hidden="true" />
            {{ props.busy.connecting ? "Connecting..." : "Connect" }}
          </button>
          <button class="btn" :disabled="!props.isConnected" @click="props.onDisconnect">
            <AppIcon name="plug-off" class="btn-icon" aria-hidden="true" />
            Disconnect
          </button>
          <button class="btn" :disabled="!props.isConnected || props.busy.loadingObjects" @click="props.onRefreshObjects">
            <AppIcon name="refresh" class="btn-icon" aria-hidden="true" />
            {{ props.busy.loadingObjects ? "Refreshing..." : "Refresh" }}
          </button>
        </div>
      </div>
    </section>

    <section class="tree-area">
      <div class="tree-caption">{{ props.connectedSchema }} Objects</div>
      <p v-if="!props.objectTree.length" class="muted">No objects loaded.</p>
      <ul v-else class="tree-root" role="tree" aria-label="Database object explorer">
        <li
          v-for="typeNode in props.objectTree"
          :key="typeNode.objectType"
          class="tree-branch"
          role="treeitem"
          :aria-expanded="props.isObjectTypeExpanded(typeNode.objectType)"
        >
          <button
            class="tree-row tree-type"
            :class="{ expanded: props.isObjectTypeExpanded(typeNode.objectType) }"
            @click="props.onToggleObjectType(typeNode.objectType)"
          >
            <AppIcon name="chevron-right" class="tree-caret-icon" aria-hidden="true" />
            <span class="tree-type-label">
              {{ typeNode.objectType }} <span class="tree-count">({{ typeNode.entries.length }})</span>
            </span>
          </button>

          <ul v-show="props.isObjectTypeExpanded(typeNode.objectType)" class="tree-children" role="group">
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
                    props.selectedObject?.schema === entry.schema &&
                    props.selectedObject?.objectName === entry.objectName &&
                    props.selectedObject?.objectType === entry.objectType,
                }"
                @click="props.onOpenObjectFromExplorer(entry)"
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
</template>

<style scoped>
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
}

.connect-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.45rem;
}

.connect-toggle {
  padding: 0.2rem;
  min-width: 1.55rem;
  min-height: 1.55rem;
  justify-content: center;
}

.connect-toggle-icon {
  width: 0.72rem;
  height: 0.72rem;
  color: var(--text-subtle);
  transition: transform 0.12s ease;
}

.connect-toggle-icon.expanded {
  transform: rotate(90deg);
}

.connect-body {
  margin-top: 0.45rem;
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
  margin-top: 0.24rem;
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

.muted {
  color: var(--text-secondary);
  font-size: 0.76rem;
}

@media (max-width: 980px) {
  .explorer-sidebar {
    border-right: 0;
    border-bottom: 1px solid var(--border-strong);
  }

  .field-grid {
    grid-template-columns: 1fr;
  }
}
</style>
