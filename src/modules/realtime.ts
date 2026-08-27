import { AppDataSource } from "./database/dataSource";
import { RoomService } from "../packages/application/roomService";
import { CryptoRandomSource } from "../packages/application/cryptoRandomSource";
import {
    TypeOrmCardPolicyRepository,
    TypeOrmCardRepository,
    TypeOrmRealtimeRoomRepository,
} from "../packages/persistence";
import { CardEntity } from "./database/entities/card/CardEntity";
import settings from "./settings";
import { CardPolicyService } from "../packages/application/cardPolicyService";
import {
    initializeRoomCreateProtection,
    roomDisplayBootstrapCapability,
} from "./roomCreateProtection";
import { roomLifecycleObservability } from "./roomObservability";

let instance: RoomService | undefined;
export function getRoomService(): RoomService {
    if (!AppDataSource?.isInitialized)
        throw new Error("Database must be initialized before realtime services");
    return (instance ??= new RoomService(
        new TypeOrmRealtimeRoomRepository(
            AppDataSource,
            settings.value.roomCreateIdempotencyTombstoneSeconds,
        ),
        new TypeOrmCardRepository(AppDataSource.getRepository(CardEntity)),
        new CryptoRandomSource(),
        {
            missingTranslation: settings.value.cardMissingTranslation,
            fallbackLocales: [settings.value.cardFallbackLocale],
        },
        {
            maximumParticipants: settings.value.roomMaximumParticipants,
            maximumPlayers: settings.value.roomMaximumPlayers,
        },
        new CardPolicyService(new TypeOrmCardPolicyRepository(AppDataSource)),
        {
            displayBootstrapEnabled: roomDisplayBootstrapCapability(),
            initialActivationMs: settings.value.roomInitialActivationSeconds * 1_000,
            unactivatedParticipantTtlMs: settings.value.unactivatedParticipantTtlSeconds * 1_000,
            reconnectGraceMs: settings.value.roomReconnectGraceSeconds * 1_000,
            idempotencyProtection: initializeRoomCreateProtection().protection,
            observability: roomLifecycleObservability,
        },
    ));
}
