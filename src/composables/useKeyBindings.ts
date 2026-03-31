import type { KeyBindings } from "../types/settings";

export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  executeQuery: "Ctrl+Enter",
  saveDdl: "Ctrl+Shift+Enter",
  findInEditor: "Ctrl+F",
  commitDataChanges: "Ctrl+Enter",
};

export const KEY_BINDING_LABELS: Record<keyof KeyBindings, string> = {
  executeQuery: "Execute Query",
  saveDdl: "Save DDL",
  findInEditor: "Find in Editor",
  commitDataChanges: "Commit Data Changes",
};

interface ParsedBinding {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

function parseBinding(binding: string): ParsedBinding | null {
  const trimmed = binding.trim();
  if (!trimmed) {
    return null;
  }

  const parts = trimmed.split("+").map((p) => p.trim());
  let ctrl = false;
  let shift = false;
  let alt = false;
  let key = "";

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "ctrl" || lower === "cmd" || lower === "mod") {
      ctrl = true;
    } else if (lower === "shift") {
      shift = true;
    } else if (lower === "alt") {
      alt = true;
    } else {
      key = part;
    }
  }

  if (!key) {
    return null;
  }

  return { key, ctrl, shift, alt };
}

function normalizeKeyName(eventKey: string): string {
  if (eventKey === " ") return "Space";
  if (eventKey.length === 1) return eventKey.toUpperCase();
  return eventKey;
}

export function matchesBinding(
  event: KeyboardEvent,
  binding: string,
): boolean {
  const parsed = parseBinding(binding);
  if (!parsed) {
    return false;
  }

  const eventKeyNormalized = normalizeKeyName(event.key);
  const bindingKeyNormalized = normalizeKeyName(parsed.key);

  if (eventKeyNormalized !== bindingKeyNormalized) {
    return false;
  }

  const hasCtrlOrMeta = event.ctrlKey || event.metaKey;
  if (parsed.ctrl !== hasCtrlOrMeta) {
    return false;
  }
  if (parsed.shift !== event.shiftKey) {
    return false;
  }
  if (parsed.alt !== event.altKey) {
    return false;
  }

  return true;
}

export function formatBindingForDisplay(binding: string): string {
  const parsed = parseBinding(binding);
  if (!parsed) {
    return binding;
  }

  const isMac =
    typeof navigator !== "undefined" &&
    /mac/i.test(navigator.platform);

  const parts: string[] = [];
  if (parsed.ctrl) parts.push(isMac ? "\u2318" : "Ctrl");
  if (parsed.shift) parts.push(isMac ? "\u21E7" : "Shift");
  if (parsed.alt) parts.push(isMac ? "\u2325" : "Alt");
  parts.push(parsed.key);

  return parts.join(isMac ? "" : "+");
}

export function recordKeyBinding(event: KeyboardEvent): string | null {
  if (
    event.key === "Control" ||
    event.key === "Meta" ||
    event.key === "Shift" ||
    event.key === "Alt"
  ) {
    return null;
  }

  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push("Ctrl");
  if (event.shiftKey) parts.push("Shift");
  if (event.altKey) parts.push("Alt");

  const key = normalizeKeyName(event.key);
  parts.push(key);

  return parts.join("+");
}

export function normalizeKeyBindings(
  raw: Partial<KeyBindings> | undefined | null,
): KeyBindings {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_KEY_BINDINGS };
  }

  return {
    executeQuery: normalizeBindingValue(raw.executeQuery, DEFAULT_KEY_BINDINGS.executeQuery),
    saveDdl: normalizeBindingValue(raw.saveDdl, DEFAULT_KEY_BINDINGS.saveDdl),
    findInEditor: normalizeBindingValue(raw.findInEditor, DEFAULT_KEY_BINDINGS.findInEditor),
    commitDataChanges: normalizeBindingValue(raw.commitDataChanges, DEFAULT_KEY_BINDINGS.commitDataChanges),
  };
}

function normalizeBindingValue(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}
