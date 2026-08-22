import { expect, test } from "@playwright/test";

test("host creates a Party Screen Room and exposes a local QR join", async ({ browser }) => {
    const hostContext = await browser.newContext();
    const displayContext = await browser.newContext();
    const host = await hostContext.newPage();
    await host.goto("/play/host");
    await host.getByLabel("Dein Name").fill("Host Anna");
    await host.getByRole("button", { name: "Raum erstellen" }).click();
    const code = (await host.locator("h1").textContent())!.trim();
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    const display = await displayContext.newPage();
    await display.goto(`/play/display?room=${code}`);
    await display.getByRole("button", { name: "Beitreten" }).click();
    await expect(display.getByAltText(`QR-Code für Raum ${code}`)).toBeVisible();
    await expect(host.getByText("Party Screen")).toBeVisible();
    await hostContext.close();
    await displayContext.close();
});
