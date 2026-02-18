<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, placeholder as cmPlaceholder, type ViewUpdate } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { sql } from "@codemirror/lang-sql";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    placeholder?: string;
    readOnly?: boolean;
  }>(),
  {
    placeholder: "",
    readOnly: false,
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

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    border: "0",
  },
  ".cm-scroller": {
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: "0.82rem",
    lineHeight: "1.42",
  },
  ".cm-content": {
    padding: "0.6rem 0",
  },
  ".cm-line": {
    padding: "0 0.6rem",
  },
  ".cm-gutters": {
    borderRight: "1px solid #dfe6ee",
    background: "#f5f7fa",
    color: "#7a8798",
  },
  ".cm-activeLine": {
    backgroundColor: "#f8fafd",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "#eff3f8",
  },
  ".cm-selectionBackground": {
    backgroundColor: "#dbe7f5 !important",
  },
  ".cm-cursor": {
    borderLeftColor: "#5f7fa7",
  },
  ".cm-placeholder": {
    color: "#8a97a6",
  },
});

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

onMounted(() => {
  if (!hostEl.value) {
    return;
  }

  editorView = new EditorView({
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        basicSetup,
        editorTheme,
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
  outline: 1px solid #c7d7ea;
  outline-offset: -1px;
}
</style>
