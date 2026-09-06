import { DataSource } from "typeorm";
import { dataSourceOptions } from "./src/modules/database/dataSource";
import { resolveSettings } from "./src/modules/settings";
import { configurePersistenceWorkLimits } from "../../packages/persistence/persistenceWorkLimits";

// The migration CLI and runtime deliberately share the same validated options.
const config = resolveSettings();
configurePersistenceWorkLimits(config);
export const AppDataSource = new DataSource(dataSourceOptions(config));
