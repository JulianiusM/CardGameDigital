import { MESSAGE_KEYS } from "../../packages/localization/keys";
import type { Request } from "express";
import { AppDataSource } from "../../modules/database/dataSource";
import { DataSpace } from "../../modules/database/entities/user/DataSpace";
import settings from "../../modules/settings";

/** Resolve the server-side ownership boundary; never trust a client-supplied DataSpace ID. */
export async function requireCurrentDataSpace(request: Request): Promise<DataSpace> {
    const repository = AppDataSource.getRepository(DataSpace);
    if (settings.value.deploymentMode === "local") {
        const spaces = await repository.find({ take: 2 });
        if (spaces.length !== 1)
            throw Object.assign(new Error(MESSAGE_KEYS.ACCOUNT_LOCAL_DATA_SPACE_UNAVAILABLE), {
                status: 503,
            });
        return spaces[0];
    }
    const accountId = request.session.auth?.user?.id;
    const dataSpaceId = request.session.dataSpace?.id;
    if (!accountId || !dataSpaceId) {
        throw Object.assign(new Error(MESSAGE_KEYS.ACCOUNT_AUTHENTICATION_REQUIRED), {
            status: 401,
        });
    }
    const dataSpace = await repository.findOne({
        where: { id: dataSpaceId, user: { id: accountId } },
    });
    if (!dataSpace)
        throw Object.assign(new Error(MESSAGE_KEYS.ACCOUNT_DATA_SPACE_FORBIDDEN), { status: 403 });
    return dataSpace;
}
