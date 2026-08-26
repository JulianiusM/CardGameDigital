import path from "node:path";
import { setBundledCardCatalogPathForTests } from "../../src/modules/database/bundledCardCatalog";

// Keep automated test output focused on assertions. Logger behavior has a dedicated
// unit suite, while integration tests can override this explicitly when needed.
process.env.LOG_LEVEL ??= "silent";
setBundledCardCatalogPathForTests(path.resolve("tests/fixtures/card-catalog-v2.example.json"));
