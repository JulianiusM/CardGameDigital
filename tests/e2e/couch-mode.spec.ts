import { expect, test } from "@playwright/test";

async function createGame(page: import("@playwright/test").Page, modeLabel: string) {
    await page.goto("/play/");
    await page.getByRole("button", { name: /Neues Spiel/ }).click();
    await page.getByRole("button", { name: new RegExp(modeLabel) }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /Weiter zur Lobby/ }).click();
    await page.getByRole("button", { name: /Spiel starten/ }).click();
    await expect(page.getByText("Runde 1")).toBeVisible();
}

test("Couch Mode runs all four modes through the server-authoritative engine", async ({ page }) => {
    await createGame(page, "Wahrheit oder Pflicht");
    await page.getByRole("button", { name: "Wahrheit", exact: true }).click();
    await expect(page.locator(".game-card")).toBeVisible();

    await createGame(page, "Zufällige Wahl");
    await page.getByRole("button", { name: "Karte aufdecken" }).click();
    await expect(page.locator(".game-card")).toBeVisible();

    await createGame(page, "Ich hab noch nie");
    await page.getByRole("button", { name: "Karte aufdecken" }).click();
    await expect(page.getByText("Hast du schon einmal die Nacht durchgemacht?")).toBeVisible();
    await page.getByRole("button", { name: "Trifft zu" }).first().click();
    await page.getByRole("button", { name: "Trifft nicht zu" }).click();
    await expect(page.getByText(/1 von 2/)).toBeVisible();

    await createGame(page, "Let's Talk");
    await page.getByRole("button", { name: "Karte aufdecken" }).click();
    await expect(page.locator(".game-card")).toContainText("FRAGE");
});
