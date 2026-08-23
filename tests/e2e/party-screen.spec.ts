import { expect, test, type Page } from "@playwright/test";

async function hostRoom(
    page: Page,
    screen: "personal" | "party" = "party",
    profile: RegExp = /^Freunde /,
    mode?: RegExp,
) {
    await page.goto("/play/");
    await page.getByRole("button", { name: /Spiel hosten/ }).click();
    await page.getByRole("button", { name: /Keine Gruppe/ }).click();
    await page.getByRole("button", { name: /^Weiter/ }).click();
    if (mode) await page.getByRole("button", { name: mode }).click();
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
    await expect(newHost.getByRole("status")).toHaveCount(0, { timeout: 7_000 });

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

test("players can inspect complete public settings without private boundaries", async ({
    browser,
}) => {
    const hostContext = await browser.newContext();
    const playerContext = await browser.newContext();
    const host = await hostContext.newPage();
    const player = await playerContext.newPage();
    const code = await hostRoom(host, "personal", /^Freunde /, /Zufällige Wahl/);
    await joinRoom(player, code, "Ben");

    await player.getByRole("button", { name: "Spieleinstellungen ansehen" }).click();
    const modal = player.locator(".current-settings-modal");
    await expect(modal.getByRole("heading", { name: "Aktuelle Spieleinstellungen" })).toBeVisible();
    await expect(modal).toContainText("Fragenanteil");
    await expect(modal).toContainText("Maximale Kartenfolge desselben Typs");
    await expect(modal).toContainText("Zusätzliche Inhaltsregeln");
    await expect(modal).not.toContainText("Private Grenzen gespeichert");
    await modal.getByLabel("Einstellungen schließen").click();

    await host.getByRole("button", { name: "Spiel starten" }).click();
    await expect(player.getByRole("button", { name: "Spieleinstellungen ansehen" })).toHaveCount(0);
    await host.getByRole("button", { name: "Einstellungen", exact: true }).click();
    await expect(host.getByRole("tab", { name: /Erweiterte Einstellungen/ })).toBeVisible();
    await host.getByRole("tab", { name: /Erweiterte Einstellungen/ }).click();
    await expect(host.getByLabel("Host-Aufgabe übertragen")).toBeVisible();
    await host.getByLabel("Einstellungen schließen").click();
    await player.getByRole("button", { name: "Einstellungen", exact: true }).click();
    await player.getByRole("tab", { name: "Aktuelle Spieleinstellungen" }).click();
    const inGameSettings = player.locator(".settings-modal");
    await expect(inGameSettings).toContainText("Fragenanteil");
    await expect(inGameSettings).toContainText("Maximale Kartenfolge desselben Typs");
    await expect(inGameSettings).not.toContainText("Private Grenzen gespeichert");
    await hostContext.close();
    await playerContext.close();
});

test("a player joining during active play enters the authoritative Session roster", async ({
    browser,
}) => {
    const hostContext = await browser.newContext();
    const firstContext = await browser.newContext();
    const lateContext = await browser.newContext();
    const host = await hostContext.newPage();
    const first = await firstContext.newPage();
    const late = await lateContext.newPage();
    const code = await hostRoom(host, "personal");
    await joinRoom(first, code, "Ben");
    await host.getByRole("button", { name: "Spiel starten" }).click();
    await expect(first.getByText("Runde 1")).toBeVisible();

    await late.goto("/play/");
    await late.getByRole("button", { name: /Spiel beitreten/ }).click();
    await late.getByLabel("Dein Name").fill("Carla");
    await late.getByLabel("Raumcode").fill(code);
    await late.getByRole("button", { name: "Raum beitreten" }).click();

    await expect(late.getByText("Runde 1")).toBeVisible();
    for (const page of [host, first, late]) {
        await expect(page.locator(".live-players summary")).toContainText("3");
        await page.locator(".live-players summary").click();
        await expect(
            page.locator(".live-players").getByText("Carla", { exact: true }),
        ).toBeVisible();
    }

    await hostContext.close();
    await firstContext.close();
    await lateContext.close();
});

test("New Game reuses the Room for Host, Player, and Display", async ({ browser }) => {
    test.setTimeout(60_000);
    const hostContext = await browser.newContext();
    const playerContext = await browser.newContext();
    const displayContext = await browser.newContext();
    const host = await hostContext.newPage();
    const player = await playerContext.newPage();
    const display = await displayContext.newPage();
    const code = await hostRoom(host, "party");
    await joinRoom(player, code, "Ben");
    await joinRoom(display, code, "", true);

    await host.getByRole("button", { name: "Spiel starten" }).click();
    await expect(player.getByText("Runde 1")).toBeVisible();
    await expect(display.getByText("Runde 1")).toBeVisible();
    await host.getByRole("button", { name: "Einstellungen", exact: true }).click();
    await host.getByRole("tab", { name: "Session" }).click();
    await host.getByRole("button", { name: "Spiel beenden" }).click();
    await expect(host.getByRole("heading", { name: /Gute Nacht/ })).toBeVisible();
    await expect(player.getByRole("heading", { name: /Gute Nacht/ })).toBeVisible();
    await expect(display.getByRole("heading", { name: /Gute Nacht/ })).toBeVisible();
    await expect(host.getByRole("button", { name: "Raum schließen" })).toBeVisible();
    await expect(player.getByRole("button", { name: "Raum verlassen" })).toBeVisible();
    await expect(display.getByRole("button", { name: "Raum verlassen" })).toBeVisible();
    await host.getByRole("button", { name: "Einstellungen", exact: true }).click();
    await expect(host.getByRole("tab", { name: "Audio" })).toHaveAttribute("aria-selected", "true");
    await host.getByLabel("Einstellungen schließen").click();

    await host.getByRole("button", { name: "Neues Spiel" }).click();
    await expect(host.getByRole("heading", { name: "Einstellungen", exact: true })).toBeVisible();
    await host.getByLabel("Einstellungen schließen").click();
    for (const page of [host, player, display]) {
        await expect(page.getByRole("heading", { name: "Lobby" })).toBeVisible();
        await expect(page).toHaveURL(/\/play\/room$/);
    }
    await expect(host.locator(".participant:not(.device-player)")).toHaveCount(3);
    await host.getByRole("button", { name: "Spiel starten" }).click();
    await expect(player.getByText("Runde 1")).toBeVisible();
    await expect(display.getByText("Runde 1")).toBeVisible();

    await hostContext.close();
    await playerContext.close();
    await displayContext.close();
});

test("Host closes an active Room and every device returns cleanly to the main menu", async ({
    browser,
}) => {
    test.setTimeout(60_000);
    const hostContext = await browser.newContext();
    const playerContext = await browser.newContext();
    const displayContext = await browser.newContext();
    const host = await hostContext.newPage();
    const player = await playerContext.newPage();
    const display = await displayContext.newPage();
    const code = await hostRoom(host, "party");
    await joinRoom(player, code, "Ben");
    await joinRoom(display, code, "", true);
    await host.getByRole("button", { name: "Spiel starten" }).click();
    await expect(player.getByText("Runde 1")).toBeVisible();

    await host.getByRole("button", { name: "Einstellungen", exact: true }).click();
    await host.getByRole("tab", { name: "Session" }).click();
    host.once("dialog", (dialog) => dialog.accept());
    await host.getByRole("button", { name: "Raum schließen" }).click();

    for (const page of [host, player, display]) {
        await expect(page).toHaveURL(/\/play\/?$/);
        await expect(page.getByRole("button", { name: /Spiel hosten/ })).toBeVisible();
        await expect(page.getByRole("status")).toContainText(
            "Der Host hat den Raum geschlossen. Du bist zurück im Hauptmenü.",
        );
    }
    await expect(player.getByRole("status")).toHaveCount(0, { timeout: 7_000 });
    await player.reload();
    await expect(player).toHaveURL(/\/play\/?$/);
    await expect(player.getByRole("heading", { name: "Lobby" })).toHaveCount(0);

    await hostContext.close();
    await playerContext.close();
    await displayContext.close();
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
    await expect(host.locator(".notification-toast")).toHaveCSS("position", "fixed");
    await expect(host.locator(".room-error, .error, .notice")).toHaveCount(0);
    await expect(host.getByRole("heading", { name: "Lobby" })).toBeVisible();
    await expect(player.getByRole("heading", { name: "Lobby" })).toBeVisible();
    await expect(host.getByRole("alert")).toHaveCount(0, { timeout: 7_000 });
    await hostContext.close();
    await playerContext.close();
});
