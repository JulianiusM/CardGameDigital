import { expect, test } from "@playwright/test";

async function createGame(page: import("@playwright/test").Page, modeLabel: string) {
    await page.goto("/play/");
    await page.getByRole("button", { name: /Neues Spiel/ }).click();
    await page.getByRole("button", { name: /Spiel hosten/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
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
    await page
        .getByText("Ben", { exact: true })
        .locator("..")
        .getByRole("button", { name: "Trifft nicht zu" })
        .click();
    await expect(page.getByText(/1 von 2/)).toBeVisible();

    await createGame(page, "Let's Talk");
    await page.getByRole("button", { name: "Karte aufdecken" }).click();
    await expect(page.locator(".game-card")).toContainText("FRAGE");
});

test("main setup offers Join and Continue Group remains in the wizard", async ({ page }) => {
    await page.goto("/play/");
    await page.getByRole("button", { name: /Neues Spiel/ }).click();
    await expect(page.getByRole("button", { name: /Raum beitreten/ })).toBeVisible();
    await page.getByRole("button", { name: /Zurück/ }).click();
    await page.getByRole("button", { name: /Gruppe fortsetzen/ }).click();
    await expect(page.getByRole("heading", { name: "Mit wem spielt ihr?" })).toBeVisible();
    await expect(page).toHaveURL(/\/play\/?$/);
});

test("AUTH_MODE=none keeps Account out of Settings", async ({ page }) => {
    await page.goto("/play/");
    await page.getByRole("button", { name: "Einstellungen" }).click();
    await page.getByRole("button", { name: /Hilfe & Konto/ }).click();
    await expect(page.getByRole("link", { name: "Hilfe öffnen" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Konto öffnen" })).toHaveCount(0);
});
