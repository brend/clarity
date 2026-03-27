import { expect, test } from "@playwright/test";

test.describe("Clarity smoke", () => {
  test("renders shell and basic offline state", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator(".desktop-shell")).toBeVisible();
    await expect(page.getByText("Database Explorer", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Connect and refresh to load objects for this schema.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText("Offline", { exact: true }).first()).toBeVisible();
    await expect(page.locator('button[title="Open settings"]')).toBeVisible();
  });

  test("opens and closes connection and settings dialogs", async ({ page }) => {
    await page.goto("/");

    await page.locator('button[title="New connection"]').click();
    await expect(
      page.getByRole("heading", { name: "New Connection" }),
    ).toBeVisible();

    const connectionDialog = page.getByRole("dialog", { name: "New Connection" });
    await connectionDialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Profile name is required.")).toBeVisible();

    await connectionDialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "New Connection" }),
    ).toBeHidden();

    await page.locator('button[title="Open settings"]').click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await page.locator('.settings-theme-option:has-text("Dark")').click();
    const settingsDialog = page.getByRole("dialog", { name: "Settings" });
    await settingsDialog.getByRole("button", { name: "Save", exact: true }).click();

    await expect(
      page.getByRole("heading", { name: "Settings" }),
    ).toBeHidden();
    await expect(page.locator(":root")).toHaveAttribute("data-theme", "dark");
  });
});
