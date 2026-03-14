<script setup lang="ts">
import { computed } from "vue";
import AppIcon from "./AppIcon.vue";

type SidebarSection =
  | "connections"
  | "explorer"
  | "query"
  | "object"
  | "settings";

const props = defineProps<{
  activeSection: SidebarSection;
  isConnected: boolean;
  providerLabel: string;
  connectedSchema: string;
  selectedObjectLabel: string;
}>();

const emit = defineEmits<{
  navigate: [section: SidebarSection];
}>();

const navItems = [
  {
    id: "connections" as const,
    label: "Connections",
    caption: "Profiles and auth",
    icon: "plug" as const,
  },
  {
    id: "explorer" as const,
    label: "Explorer",
    caption: "Schema objects",
    icon: "object" as const,
  },
  {
    id: "query" as const,
    label: "Workspace",
    caption: "SQL and search",
    icon: "play" as const,
  },
  {
    id: "object" as const,
    label: "Object",
    caption: "DDL and data",
    icon: "save" as const,
  },
  {
    id: "settings" as const,
    label: "Settings",
    caption: "App preferences",
    icon: "settings" as const,
  },
];

const sessionSummary = computed<string>(() => {
  if (!props.isConnected) {
    return "Offline";
  }

  return props.connectedSchema || "Connected";
});
</script>

<template>
  <aside class="sidebar-nav">
    <div class="sidebar-brand">
      <div class="brand-mark">
        <AppIcon name="database" :size="20" :stroke-width="1.7" />
      </div>
      <div class="brand-copy">
        <div class="brand-name">Clarity</div>
        <div class="brand-subtitle">Workbench</div>
      </div>
    </div>

    <nav class="nav-list" aria-label="Primary navigation">
      <button
        v-for="item in navItems"
        :key="item.id"
        class="nav-item"
        :class="{ active: props.activeSection === item.id }"
        type="button"
        :aria-current="props.activeSection === item.id ? 'page' : undefined"
        @click="emit('navigate', item.id)"
      >
        <span class="nav-icon">
          <AppIcon :name="item.icon" :size="16" />
        </span>
        <span class="nav-label">{{ item.label }}</span>
        <span class="nav-caption">{{ item.caption }}</span>
      </button>
    </nav>

    <section class="nav-context">
      <div class="nav-context-label">Session</div>
      <div class="nav-context-value">{{ sessionSummary }}</div>
      <div class="nav-context-meta">
        {{ props.isConnected ? props.providerLabel : "Connect to explore" }}
      </div>
      <div
        v-if="props.selectedObjectLabel"
        class="nav-context-meta nav-context-object"
      >
        {{ props.selectedObjectLabel }}
      </div>
    </section>
  </aside>
</template>

<style scoped>
.sidebar-nav {
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: 1rem;
  min-height: 0;
  padding: 1.4rem 0 1.4rem 1.4rem;
}

.sidebar-brand {
  display: grid;
  gap: 0.75rem;
  justify-items: start;
}

.brand-mark {
  width: 3rem;
  height: 3rem;
  border-radius: 1.1rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-strong);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--accent-soft) 70%, white) 0%,
    color-mix(in srgb, var(--accent-soft) 35%, white) 100%
  );
  border: 1px solid color-mix(in srgb, var(--accent) 20%, white);
  box-shadow: 0 12px 24px rgba(189, 120, 141, 0.14);
}

.brand-copy {
  display: grid;
  gap: 0.18rem;
}

.brand-name {
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text-primary);
}

.brand-subtitle {
  font-size: 0.74rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-subtle);
}

.nav-list {
  display: grid;
  align-content: start;
  gap: 0.5rem;
}

.nav-item {
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  border-radius: 1.1rem;
  padding: 0.9rem 0.8rem;
  display: grid;
  justify-items: start;
  gap: 0.18rem;
  cursor: pointer;
  text-align: left;
  transition:
    background-color 0.18s ease,
    color 0.18s ease,
    transform 0.18s ease,
    box-shadow 0.18s ease;
}

.nav-item:hover {
  background: color-mix(in srgb, var(--bg-surface) 82%, transparent);
  color: var(--text-primary);
  transform: translateY(-1px);
}

.nav-item.active {
  background: var(--bg-surface);
  color: var(--text-primary);
  box-shadow: var(--card-shadow);
}

.nav-item:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

.nav-icon {
  width: 2rem;
  height: 2rem;
  border-radius: 0.8rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--accent-soft) 22%, white);
  color: var(--accent-strong);
}

.nav-item.active .nav-icon {
  background: color-mix(in srgb, var(--accent-soft) 60%, white);
}

.nav-item.active .nav-caption {
  color: var(--text-secondary);
}

.nav-label {
  font-size: 0.78rem;
  font-weight: 600;
}

.nav-caption {
  font-size: 0.68rem;
  color: var(--text-subtle);
}

.nav-context {
  border-radius: 1.25rem;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-surface) 90%, transparent);
  padding: 0.9rem 0.85rem;
  display: grid;
  gap: 0.22rem;
}

.nav-context-label {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-subtle);
}

.nav-context-value {
  font-size: 0.84rem;
  font-weight: 600;
  color: var(--text-primary);
}

.nav-context-meta {
  font-size: 0.71rem;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}

.nav-context-object {
  margin-top: 0.3rem;
  padding-top: 0.45rem;
  border-top: 1px solid color-mix(in srgb, var(--border) 65%, transparent);
}

@media (max-width: 1100px) {
  .sidebar-nav {
    grid-template-rows: auto;
    padding: 1rem 0 0 1rem;
  }

  .nav-context {
    display: none;
  }
}

@media (max-width: 980px) {
  .sidebar-nav {
    padding: 1rem 1rem 0 1rem;
  }

  .nav-list {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }

  .nav-item {
    padding: 0.8rem 0.55rem;
    justify-items: center;
    text-align: center;
  }

  .nav-caption {
    display: none;
  }
}
</style>
