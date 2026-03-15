import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

type TauriUpdate = Awaited<ReturnType<typeof check>>;

export type UpdateCheckResult =
  | {
      kind: "up-to-date";
      currentVersion: string;
    }
  | {
      kind: "available";
      currentVersion: string;
      version: string;
      date: string | null;
      body: string | null;
    }
  | {
      kind: "error";
      currentVersion: string;
      message: string;
    };

let pendingUpdate: NonNullable<TauriUpdate> | null = null;

function toErrorMessage(error: unknown): string {
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Unable to check for updates right now.";
}

export async function getCurrentAppVersion(): Promise<string> {
  return getVersion();
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const currentVersion = await getCurrentAppVersion();

  try {
    const update = await check();
    pendingUpdate = update;

    if (!update) {
      return {
        kind: "up-to-date",
        currentVersion,
      };
    }

    return {
      kind: "available",
      currentVersion,
      version: update.version,
      date: update.date ?? null,
      body: update.body?.trim() || null,
    };
  } catch (error) {
    pendingUpdate = null;
    return {
      kind: "error",
      currentVersion,
      message: toErrorMessage(error),
    };
  }
}

export async function downloadAndInstallUpdate(): Promise<void> {
  if (!pendingUpdate) {
    throw new Error("Check for updates first.");
  }

  await pendingUpdate.downloadAndInstall();
  pendingUpdate = null;
}

export async function relaunchToApplyUpdate(): Promise<void> {
  await relaunch();
}
