import fs from "node:fs";
import path from "node:path";
import { DataSource } from "typeorm";
import { applyCardCatalog } from "../src/packages/application/applyCardCatalog";
import { dataSourceOptions } from "../src/modules/database/dataSource";
import { resolveSettings } from "../src/modules/settings";
import { normalizeCards } from "../src/tooling/card-import/normalize";

const dbFile = path.resolve(process.env.COUCH_E2E_DB_FILE ?? ".tmp/couch-e2e.sqlite");
fs.mkdirSync(path.dirname(dbFile), { recursive: true });
fs.rmSync(dbFile, { force: true });
const settings = resolveSettings({ DB_FILE: dbFile }, "/dev/null");
const source = new DataSource(dataSourceOptions(settings));

const common = {
    Origin: "E2E",
    OriginCategory: null,
    Intensity: 2,
    AlwaysEligible: false,
    RepeatableInSession: true,
    RepeatCooldown: 0,
    Weight: 1,
    Active: true,
    OperationalFlags: [],
};
const rawCards = [
    {
        ...common,
        ID: "q1",
        CardText: "Was bringt dich immer zum Lachen?",
        Type: "Fragen",
        YesNoAnswerPossible: false,
        Category: "Alltag",
        DareType: null,
    },
    {
        ...common,
        ID: "q2",
        CardText: "Hast du schon einmal die Nacht durchgemacht?",
        Type: "Fragen",
        YesNoAnswerPossible: true,
        Category: "Alltag",
        DareType: null,
    },
    {
        ...common,
        ID: "d1",
        CardText: "Erfinde einen kurzen Siegestanz.",
        Type: "Pflicht",
        YesNoAnswerPossible: false,
        Category: "Alltag",
        DareType: "Blödsinn",
    },
    {
        ...common,
        ID: "m1",
        CardText: "Alle dürfen eine Rückfrage stellen.",
        Type: "Gespräch",
        YesNoAnswerPossible: false,
        Category: null,
        DareType: null,
    },
];

async function main() {
    await source.initialize();
    await source.runMigrations({ transaction: "all" });
    await applyCardCatalog(
        source,
        normalizeCards(rawCards, "couch-e2e", "couch-e2e-v1", new Date("2026-08-21T00:00:00Z")),
    );
    await source.destroy();
    console.log(`Couch E2E database initialized at ${dbFile}`);
}
main().catch(async (error) => {
    if (source.isInitialized) await source.destroy();
    console.error(error);
    process.exit(1);
});
