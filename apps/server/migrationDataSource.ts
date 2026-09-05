import { DataSource } from "typeorm";
import { dataSourceOptions } from "./src/modules/database/dataSource";
import { resolveSettings } from "./src/modules/settings";

// The migration CLI and runtime deliberately share the same validated options.
export const AppDataSource = new DataSource(dataSourceOptions(resolveSettings()));
