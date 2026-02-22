<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, placeholder as cmPlaceholder, type ViewUpdate } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { sql } from "@codemirror/lang-sql";
import type { ThemeSetting } from "../types/settings";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    placeholder?: string;
    readOnly?: boolean;
    targetLine?: number | null;
    focusToken?: number;
    theme?: ThemeSetting;
  }>(),
  {
    placeholder: "",
    readOnly: false,
    targetLine: null,
    focusToken: 0,
    theme: "light",
  },
);

const emit = defineEmits<{
  (event: "update:modelValue", value: string): void;
}>();

const hostEl = ref<HTMLElement | null>(null);
let editorView: EditorView | null = null;

const readOnlyCompartment = new Compartment();
const placeholderCompartment = new Compartment();
const languageCompartment = new Compartment();
const themeCompartment = new Compartment();

function buildEditorTheme(theme: ThemeSetting): Extension {
  const isDark = theme === "dark";
  return EditorView.theme({
    "&": {
      height: "100%",
      border: "0",
      background: "var(--editor-surface)",
    },
    ".cm-scroller": {
      fontFamily: 'Consolas, "Courier New", monospace',
      fontSize: "0.82rem",
      lineHeight: "1.42",
      color: "var(--text-primary)",
    },
    ".cm-content": {
      padding: "0.6rem 0",
      caretColor: isDark ? "#9ec8ff" : "#4f6f96",
    },
    ".cm-line": {
      padding: "0 0.6rem",
    },
    ".cm-gutters": {
      borderRight: "1px solid var(--editor-gutter-border)",
      background: "var(--editor-gutter-bg)",
      color: "var(--editor-gutter-text)",
    },
    ".cm-activeLine": {
      backgroundColor: isDark ? "rgba(76, 96, 124, 0.28)" : "rgba(248, 250, 253, 0.55)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: isDark ? "rgba(62, 81, 106, 0.42)" : "#eff3f8",
    },
    ".cm-selectionBackground": {
      backgroundColor: isDark ? "rgba(88, 125, 168, 0.45)" : "#dbe7f5",
    },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
      backgroundColor: isDark ? "rgba(99, 145, 197, 0.56)" : "#c7dbf2",
    },
    ".cm-cursor": {
      borderLeftColor: isDark ? "#9ec8ff" : "#5f7fa7",
    },
    ".cm-placeholder": {
      color: isDark ? "#7e90a7" : "#8a97a6",
    },
  });
}

function buildPlaceholderExtension(value: string): Extension {
  return value ? cmPlaceholder(value) : [];
}

function updateCompartment(compartment: Compartment, extension: Extension): void {
  if (!editorView) {
    return;
  }

  editorView.dispatch({
    effects: compartment.reconfigure(extension),
  });
}

function revealLine(lineNumber: number): void {
  if (!editorView || !Number.isFinite(lineNumber)) {
    return;
  }

  const maxLine = editorView.state.doc.lines;
  const normalized = Math.max(1, Math.min(maxLine, Math.trunc(lineNumber)));
  const line = editorView.state.doc.line(normalized);

  editorView.dispatch({
    selection: { anchor: line.from },
    effects: EditorView.scrollIntoView(line.from, { y: "center" }),
    scrollIntoView: true,
  });
  editorView.focus();
}

onMounted(() => {
  if (!hostEl.value) {
    return;
  }

  editorView = new EditorView({
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        basicSetup,
        themeCompartment.of(buildEditorTheme(props.theme)),
        languageCompartment.of(sql()),
        readOnlyCompartment.of(EditorState.readOnly.of(props.readOnly)),
        placeholderCompartment.of(buildPlaceholderExtension(props.placeholder)),
        EditorView.updateListener.of((update: ViewUpdate) => {
          if (!update.docChanged) {
            return;
          }

          emit("update:modelValue", update.state.doc.toString());
        }),
      ],
    }),
    parent: hostEl.value,
  });

  if (props.targetLine !== null && props.targetLine !== undefined) {
    revealLine(props.targetLine);
  }
});

watch(
  () => props.modelValue,
  (nextValue) => {
    if (!editorView) {
      return;
    }

    const current = editorView.state.doc.toString();
    if (nextValue === current) {
      return;
    }

    editorView.dispatch({
      changes: {
        from: 0,
        to: editorView.state.doc.length,
        insert: nextValue,
      },
    });
  },
);

watch(
  () => props.readOnly,
  (isReadOnly) => {
    updateCompartment(readOnlyCompartment, EditorState.readOnly.of(isReadOnly));
  },
);

watch(
  () => props.placeholder,
  (placeholderValue) => {
    updateCompartment(placeholderCompartment, buildPlaceholderExtension(placeholderValue));
  },
);

watch(
  () => props.theme,
  (nextTheme) => {
    updateCompartment(themeCompartment, buildEditorTheme(nextTheme));
  },
);

watch(
  () => `${props.focusToken}:${props.targetLine ?? ""}`,
  () => {
    if (props.targetLine === null || props.targetLine === undefined) {
      return;
    }

    revealLine(props.targetLine);
  },
);

onBeforeUnmount(() => {
  editorView?.destroy();
  editorView = null;
});
</script>

<template>
  <div ref="hostEl" class="sql-code-editor"></div>
</template>

<style scoped>
.sql-code-editor {
  width: 100%;
  height: 100%;
  min-height: 0;
}

.sql-code-editor :deep(.cm-editor.cm-focused) {
  outline: 1px solid var(--editor-focus-outline);
  outline-offset: -1px;
}
</style>
