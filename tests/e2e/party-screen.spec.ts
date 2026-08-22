import { expect, test, type Page } from "@playwright/test";

async function hostRoom(
    page: Page,
    screen: "personal" | "party" = "party",
    profile: RegExp = /^Freunde /,
) {
    await page.goto("/play/");
    await page.getByRole("button", { name: /Spiel hosten/ }).click();
    await page.getByRole("button", { name: /Keine Gruppe/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: profile }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    await page
        .getByRole("button", {
            name: screen === "party" ? /TV \+ Smartphones/ : /Alle mit eigenem Gerät/,
        })
        .click();
    await page.getByLabel("Name des Hosts").fill("Host Anna");
    await page.getByRole("button", { name: /Weiter zur Lobby/ }).click();
    await expect(page.getByRole("heading", { name: "Lobby" })).toBeVisible();
    return (await page.locator("main > header h1").textContent())!.trim();
}

async function joinRoom(page: Page, code: string, name: string, display = false) {
    await page.goto("/play/");
    await page.getByRole("button", { name: display ? /Nur anzeigen/ : /Spiel beitreten/ }).click();
    if (!display) await page.getByLabel("Dein Name").fill(name);
    await page.getByLabel("Raumcode").fill(code);
    await page.getByRole("button", { name: "Raum beitreten" }).click();
    await expect(page.getByRole("heading", { name: "Lobby" })).toBeVisible();
}

test("host creates a Party Screen Room and exposes safe QR join information", async ({
    browser,
}) => {
    const hostContext = await browser.newContext();
    const displayContext = await browser.newContext();
    const host = await hostContext.newPage();
    const code = await hostRoom(host);
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    const display = await displayContext.newPage();
    await joinRoom(display, code, "", true);
    await expect(display.getByAltText(`QR-Code für Raum ${code}`)).toBeVisible();
    await expect(host.getByText("Party Screen", { exact: true })).toBeVisible();
    await expect(display.getByRole("button", { name: "Lobby verlassen" })).toBeVisible();
    await hostContext.close();
    await displayContext.close();
});

test("settings, device players and transferred Host authority synchronize across reload", async ({
    browser,
}) => {
    test.setTimeout(60_000);
    const oldContext = await browser.newContext();
    const newContext = await browser.newContext();
    const thirdContext = await browser.newContext();
    const oldHost = await oldContext.newPage();
    const newHost = await newContext.newPage();
    const thirdPlayer = await thirdContext.newPage();
    const code = await hostRoom(oldHost, "personal");
    await joinRoom(newHost, code, "Ben");
    await joinRoom(thirdPlayer, code, "Carla");
    await expect(oldHost.getByText("Ben", { exact: true })).toBeVisible();
    await expect(oldHost.getByText("Carla", { exact: true })).toBeVisible();
    await expect(newHost.getByText("Carla", { exact: true })).toBeVisible();
    await expect(thirdPlayer.getByText("Ben", { exact: true })).toBeVisible();
    await expect(newHost.getByText("Host Anna", { exact: true })).toBeVisible();
    await expect(newHost.getByText("Maximale Intensität: 3")).toBeVisible();

    await oldHost.getByRole("button", { name: "Spieleinstellungen bearbeiten" }).click();
    await oldHost.getByRole("slider", { name: /Maximale Intensität/ }).fill("2");
    await oldHost.getByRole("button", { name: "Speichern", exact: true }).click();
    await expect(newHost.getByRole("status")).toContainText(
        "Der Host hat die Spieleinstellungen geändert.",
    );
    await expect(thirdPlayer.getByRole("status")).toContainText(
        "Der Host hat die Spieleinstellungen geändert.",
    );
    await expect(newHost.getByText("Maximale Intensität: 2")).toBeVisible();

    await oldHost.getByRole("button", { name: "Einstellungen", exact: true }).click();
    await oldHost.getByRole("tab", { name: /Erweiterte Einstellungen/ }).click();
    await oldHost.getByLabel("Host-Aufgabe übertragen").selectOption({ label: "Ben" });
    await oldHost.getByRole("button", { name: "Übertragen" }).click();
    await expect(
        newHost.getByRole("button", { name: "Spieleinstellungen bearbeiten" }),
    ).toBeVisible();
    await expect(
        oldHost.getByRole("button", { name: "Spieleinstellungen bearbeiten" }),
    ).toHaveCount(0);
    await expect(oldHost.getByRole("button", { name: "Spiel starten" })).toHaveCount(0);

    newHost.once("dialog", (dialog) => dialog.accept());
    await newHost.reload();
    await expect(newHost.locator("main > header .eyebrow")).toHaveText("HOST");
    await expect(newHost.locator(".participant:not(.device-player)")).toHaveCount(3);
    await expect(newHost.getByRole("button", { name: "Spiel starten" })).toBeVisible();

    await newHost.setViewportSize({ width: 360, height: 740 });
    await newHost.getByRole("button", { name: /Person auf diesem Gerät/ }).click();
    const editor = newHost.locator(".device-player-editor");
    await editor.getByRole("textbox").fill("Bea");
    const playersPanel = newHost.locator(".players");
    expect((await editor.boundingBox())!.width).toBeLessThanOrEqual(
        (await playersPanel.boundingBox())!.width,
    );
    await newHost.getByRole("button", { name: "Personen für dieses Gerät speichern" }).click();
    await expect(oldHost.locator(".participant.device-player").getByText("Bea")).toBeVisible();
    await expect(newHost.getByRole("button", { name: "Lobby verlassen" })).toBeVisible();

    await oldContext.close();
    await newContext.close();
    await thirdContext.close();
});

test("hosted zero-card settings are rejected without leaving the lobby", async ({ browser }) => {
    const hostContext = await browser.newContext();
    const playerContext = await browser.newContext();
    const host = await hostContext.newPage();
    const player = await playerContext.newPage();
    const code = await hostRoom(host, "personal", /^Custom /);
    await joinRoom(player, code, "Ben");
    await host.getByRole("button", { name: "Spiel starten" }).click();
    await expect(host.getByRole("alert")).toContainText("Keine Karte erfüllt alle aktiven Regeln.");
    await expect(host.getByRole("heading", { name: "Lobby" })).toBeVisible();
    await expect(player.getByRole("heading", { name: "Lobby" })).toBeVisible();
    await hostContext.close();
    await playerContext.close();
});
