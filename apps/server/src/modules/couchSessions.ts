import { CouchSessionService } from "../../../../packages/application/couchSessionService";
import { CardPolicyService } from "../../../../packages/application/cardPolicyService";
import { CryptoRandomSource } from "../../../../packages/application/cryptoRandomSource";
import {
    TypeOrmCardPolicyRepository,
    TypeOrmCardRepository,
    TypeOrmCouchSessionRepository,
} from "../../../../packages/persistence";
import { CardEntity } from "../../../../packages/persistence/entities/card/CardEntity";
import { getAppDataSource } from "./database/dataSource";
import settings from "./settings";
import { gameResourceLimits } from "./operationalSettings";

let instance: CouchSessionService | undefined;
export function getCouchService(): CouchSessionService {
    instance ??= new CouchSessionService(
        new TypeOrmCardRepository(getAppDataSource().getRepository(CardEntity)),
        new CryptoRandomSource(),
        {
            missingTranslation: settings.value.cardMissingTranslation,
            fallbackLocales: [settings.value.cardFallbackLocale],
        },
        new TypeOrmCouchSessionRepository(getAppDataSource(), gameResourceLimits(settings.value)),
        new CardPolicyService(new TypeOrmCardPolicyRepository(getAppDataSource())),
        gameResourceLimits(settings.value),
    );
    return instance;
}
