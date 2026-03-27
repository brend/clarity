import { expect, test } from "@playwright/test";

test.describe("Workspace flows", () => {
  test("persists settings changes across reload", async ({ page }) => {
    await page.goto("/");

    await page.locator('button[title="Open settings"]').click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    await page.locator('.settings-theme-option:has-text("Dark")').click();
    await page
      .locator('.settings-field:has-text("UI Font Size (px)") input')
      .fill("18");

    const settingsDialog = page.getByRole("dialog", { name: "Settings" });
    await settingsDialog.getByRole("button", { name: "Save", exact: true }).click();

    await expect(page.locator(":root")).toHaveAttribute("data-theme", "dark");

    await page.reload();
    await expect(page.locator(":root")).toHaveAttribute("data-theme", "dark");

    await page.locator('button[title="Open settings"]').click();
    await expect(
      page.locator('.settings-field:has-text("UI Font Size (px)") input'),
    ).toHaveValue("18");
  });

  test("persists added query tabs and allows closing them", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("button", { name: "Query 1" })).toBeVisible();

    await page.locator('button[title="New query tab"]').click();
    await expect(page.getByRole("button", { name: "Query 2" })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("button", { name: "Query 2" })).toBeVisible();

    await page
      .locator('.sheet-tab-wrap:has(button:has-text("Query 2")) button[title="Close tab"]')
      .click();
    await expect(page.getByRole("button", { name: "Query 2" })).toBeHidden();

    await page.reload();
    await expect(page.getByRole("button", { name: "Query 1" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Query 2" })).toHaveCount(0);
  });

  test("opens search tab and shows offline disabled search action", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(
      page.getByPlaceholder("Search object names, source, and DDL in this schema"),
    ).toBeVisible();
    await expect(
      page.getByText("Run a schema search to find matching objects and text."),
    ).toBeVisible();

    await page
      .getByPlaceholder("Search object names, source, and DDL in this schema")
      .fill("users");
    await expect(
      page.locator(".source-search-toolbar button.btn.primary"),
    ).toBeDisabled();
  });
});
