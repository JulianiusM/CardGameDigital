import {DataSource} from "typeorm";
import {entities, migrations, subscribers} from "./src/modules/database/__index__";

export const AppDataSource = new DataSource({
    type: (process.env.DB_TYPE as "mariadb" | "mysql") || 'mysql',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    username: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'test',
    entities: entities,
    migrations: migrations,
    subscribers: subscribers,
    synchronize: false,
});