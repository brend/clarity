<script setup lang="ts">
import AppIcon from "./AppIcon.vue";
import { ref } from "vue";
import type {
  BusyState,
  OracleConnectionProfile,
  OracleDbConnectRequest,
} from "../types/clarity";

const profileName = defineModel<string>("profileName", { required: true });
const saveProfilePassword = defineModel<boolean>("saveProfilePassword", {
  required: true,
});

const props = defineProps<{
  connection: OracleDbConnectRequest;
  connectionError: string;
  selectedProfile: OracleConnectionProfile | null;
  busy: BusyState;
  onSave: () => void;
  onDelete: () => void;
  onCancel: () => void;
}>();

const showAdvancedOptions = ref(false);
</script>

<template>
  <div class="dialog-backdrop" @click.self="props.onCancel">
    <section
      class="dialog connection-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="connection-dialog-title"
    >
      <header class="dialog-header">
        <h2 id="connection-dialog-title" class="dialog-title">
          {{ props.selectedProfile ? "Edit Connection" : "New Connection" }}
        </h2>
      </header>

      <div class="dialog-body">
        <div class="conn-field-grid">
          <label class="conn-field">
            <span>Host</span>
            <input
              v-model.trim="props.connection.connection.host"
              placeholder="db.example.com"
              spellcheck="false"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              data-gramm="false"
            />
          </label>

          <label class="conn-field">
            <span>Service</span>
            <input
              v-model.trim="props.connection.connection.serviceName"
              placeholder="XEPDB1"
              spellcheck="false"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              data-gramm="false"
            />
          </label>

          <label class="conn-field">
            <span>Username</span>
            <input
              v-model.trim="props.connection.connection.username"
              placeholder="hr"
              spellcheck="false"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              data-gramm="false"
            />
          </label>

          <label class="conn-field">
            <span>Schema</span>
            <input
              v-model.trim="props.connection.connection.schema"
              placeholder="HR"
              spellcheck="false"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              data-gramm="false"
            />
          </label>

          <label class="conn-field conn-field-span">
            <span>Password</span>
            <input
              v-model="props.connection.connection.password"
              type="password"
              placeholder="********"
              spellcheck="false"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              data-gramm="false"
            />
          </label>
        </div>

        <button
          class="btn conn-advanced-toggle"
          type="button"
          :aria-expanded="showAdvancedOptions"
          @click="showAdvancedOptions = !showAdvancedOptions"
        >
          <AppIcon
            name="chevron-right"
            class="conn-toggle-icon"
            :class="{ expanded: showAdvancedOptions }"
            aria-hidden="true"
          />
          {{ showAdvancedOptions ? "Hide advanced options" : "Advanced options" }}
        </button>

        <div v-show="showAdvancedOptions" class="conn-field-grid">
          <label class="conn-field">
            <span>Port</span>
            <input
              v-model.number="props.connection.connection.port"
              type="number"
              min="1"
              max="65535"
              spellcheck="false"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              data-gramm="false"
            />
          </label>

          <label
            v-if="props.connection.provider === 'oracle'"
            class="conn-field"
          >
            <span>Auth Mode</span>
            <select v-model="props.connection.connection.oracleAuthMode">
              <option value="normal">Normal</option>
              <option value="sysdba">SYSDBA</option>
            </select>
          </label>
        </div>

        <div class="conn-separator"></div>

        <div class="conn-profile-section">
          <label class="conn-field">
            <span>Profile Name</span>
            <input
              v-model.trim="profileName"
              placeholder="My Database"
              spellcheck="false"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              data-gramm="false"
            />
          </label>
          <label class="conn-password-toggle">
            <input v-model="saveProfilePassword" type="checkbox" />
            Save password in OS keychain
          </label>
        </div>

        <p v-if="props.connectionError" class="conn-error">
          {{ props.connectionError }}
        </p>
      </div>

      <footer class="dialog-footer">
        <button
          v-if="props.selectedProfile"
          class="btn conn-delete-btn"
          :disabled="props.busy.deletingProfile"
          @click="props.onDelete"
        >
          {{ props.busy.deletingProfile ? "Deleting..." : "Delete" }}
        </button>
        <div class="conn-footer-spacer"></div>
        <button class="btn" @click="props.onCancel">Cancel</button>
        <button
          class="btn primary"
          :disabled="props.busy.savingProfile"
          @click="props.onSave"
        >
          {{ props.busy.savingProfile ? "Saving..." : "Save" }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.connection-dialog {
  width: min(34rem, 100%);
}

.conn-field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.55rem;
}

.conn-field {
  display: grid;
  gap: 0.24rem;
}

.conn-field > span {
  font-size: 0.72rem;
  color: var(--text-subtle);
}

.conn-field-span {
  grid-column: 1 / -1;
}

.conn-advanced-toggle {
  justify-content: flex-start;
  padding: 0.35rem 0;
  background: transparent;
  font-size: 0.72rem;
  color: var(--text-secondary);
  font-weight: 500;
}

.conn-advanced-toggle:hover {
  background: transparent !important;
  color: var(--text-primary);
}

.conn-toggle-icon {
  width: 0.68rem;
  height: 0.68rem;
  color: var(--text-subtle);
  transition: transform 0.12s ease;
}

.conn-toggle-icon.expanded {
  transform: rotate(90deg);
}

.conn-separator {
  height: 1px;
  background: var(--border);
}

.conn-profile-section {
  display: grid;
  gap: 0.5rem;
}

.conn-password-toggle {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.74rem;
  color: var(--text-secondary);
}

.conn-password-toggle input {
  margin: 0;
}

.conn-error {
  margin: 0;
  color: var(--danger);
  font-size: 0.74rem;
  line-height: 1.3;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.conn-delete-btn {
  color: var(--danger);
}

.conn-footer-spacer {
  flex: 1;
}
</style>
