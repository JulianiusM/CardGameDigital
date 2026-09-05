import { MESSAGE_KEYS } from "../../../../../packages/localization/keys";
import type { Request } from "express";
import { AppDataSource } from "../../modules/database/dataSource";
import { DataSpace } from "../../../../../packages/persistence/entities/user/DataSpace";
import settings from "../../modules/settings";
import { ExpectedError } from "../../modules/lib/errors";
import { ensureCurrentDataSpace } from "../../application/accountService";

/** Resolve the server-side ownership boundary; never trust a client-supplied DataSpace ID. */
export async function requireCurrentDataSpace(request: Request): Promise<DataSpace> {
    const repository = AppDataSource.getRepository(DataSpace);
    if (settings.value.deploymentMode === "local") {
        const spaces = await repository.find({ take: 2 });
        if (spaces.length !== 1)
            throw new ExpectedError(
                MESSAGE_KEYS.ACCOUNT_LOCAL_DATA_SPACE_UNAVAILABLE,
                "error",
                503,
            );
        return spaces[0];
    }
    return ensureCurrentDataSpace(request.session);
}
