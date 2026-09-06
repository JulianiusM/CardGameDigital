// ⚠️ AUTO-GENERATED FILE — do not edit manually.
import { CardCatalogVersionEntity } from "../../../../../packages/persistence/entities/card/CardCatalogVersionEntity";
import { CardEntity } from "../../../../../packages/persistence/entities/card/CardEntity";
import { CardLocalizationEntity } from "../../../../../packages/persistence/entities/card/CardLocalizationEntity";
import { CardOperationalFlagEntity } from "../../../../../packages/persistence/entities/card/CardOperationalFlagEntity";
import { DareTypeEntity } from "../../../../../packages/persistence/entities/card/DareTypeEntity";
import { DareTypeTranslationEntity } from "../../../../../packages/persistence/entities/card/DareTypeTranslationEntity";
import { LocaleEntity } from "../../../../../packages/persistence/entities/card/LocaleEntity";
import { QuestionCategoryEntity } from "../../../../../packages/persistence/entities/card/QuestionCategoryEntity";
import { QuestionCategoryTranslationEntity } from "../../../../../packages/persistence/entities/card/QuestionCategoryTranslationEntity";
import { CardAppearanceEntity } from "../../../../../packages/persistence/entities/game/CardAppearanceEntity";
import { CardPolicyConditionalRuleEntity } from "../../../../../packages/persistence/entities/game/CardPolicyConditionalRuleEntity";
import { CardPolicyExactCardEntity } from "../../../../../packages/persistence/entities/game/CardPolicyExactCardEntity";
import { CardPolicyScopeDefaultEntity } from "../../../../../packages/persistence/entities/game/CardPolicyScopeDefaultEntity";
import { CouchCardAppearanceEntity } from "../../../../../packages/persistence/entities/game/CouchCardAppearanceEntity";
import { CouchGameSessionEntity } from "../../../../../packages/persistence/entities/game/CouchGameSessionEntity";
import { DataSpaceGameSettingsEntity } from "../../../../../packages/persistence/entities/game/DataSpaceGameSettingsEntity";
import { GameCapacityEntity } from "../../../../../packages/persistence/entities/game/GameCapacityEntity";
import { GameSessionEntity } from "../../../../../packages/persistence/entities/game/GameSessionEntity";
import { GroupEntity } from "../../../../../packages/persistence/entities/game/GroupEntity";
import { RoomCreateIdempotencyEntity } from "../../../../../packages/persistence/entities/game/RoomCreateIdempotencyEntity";
import { RoomEntity } from "../../../../../packages/persistence/entities/game/RoomEntity";
import { RoomParticipantBoundaryEntity } from "../../../../../packages/persistence/entities/game/RoomParticipantBoundaryEntity";
import { RoomParticipantEntity } from "../../../../../packages/persistence/entities/game/RoomParticipantEntity";
import { SessionImmutablePayloadChunkEntity } from "../../../../../packages/persistence/entities/game/SessionImmutablePayloadChunkEntity";
import { SessionImmutablePayloadEntity } from "../../../../../packages/persistence/entities/game/SessionImmutablePayloadEntity";
import { InstallationMetadataEntity } from "../../../../../packages/persistence/entities/server/InstallationMetadataEntity";
import { AccountSession } from "../../../../../packages/persistence/entities/session/AccountSession";
import { DataSpace } from "../../../../../packages/persistence/entities/user/DataSpace";
import { User } from "../../../../../packages/persistence/entities/user/User";
import { IntroduceDataSpaces1787330000000 } from "../../../migrations/1787330000000-IntroduceDataSpaces";
import { NormalizeCardCatalog1787331000000 } from "../../../migrations/1787331000000-NormalizeCardCatalog";
import { AddRealtimeRooms1787332000000 } from "../../../migrations/1787332000000-AddRealtimeRooms";
import { AddParticipantBoundaries1787333000000 } from "../../../migrations/1787333000000-AddParticipantBoundaries";
import { HardenAccountSecrets1787334000000 } from "../../../migrations/1787334000000-HardenAccountSecrets";
import { AddAccountGroupsAndSettings1787335000000 } from "../../../migrations/1787335000000-AddAccountGroupsAndSettings";
import { AddDevicePlayers1787336000000 } from "../../../migrations/1787336000000-AddDevicePlayers";
import { AddParticipantLifecycleAndGroupHistoryReset1787337000000 } from "../../../migrations/1787337000000-AddParticipantLifecycleAndGroupHistoryReset";
import { AddAuthoritativeRoomSettings1787338000000 } from "../../../migrations/1787338000000-AddAuthoritativeRoomSettings";
import { BundledCardCatalog1787339000000 } from "../../../migrations/1787339000000-BundledCardCatalog";
import { AllowMultipleRoomSessions1787340000000 } from "../../../migrations/1787340000000-AllowMultipleRoomSessions";
import { AddRoomClosure1787341000000 } from "../../../migrations/1787341000000-AddRoomClosure";
import { AddIntensityProgressionSettings1787342000000 } from "../../../migrations/1787342000000-AddIntensityProgressionSettings";
import { TrackCardAppearanceOutcomes1787343000000 } from "../../../migrations/1787343000000-TrackCardAppearanceOutcomes";
import { HardenOidcIdentity1787344000000 } from "../../../migrations/1787344000000-HardenOidcIdentity";
import { IndexAccountSessions1787345000000 } from "../../../migrations/1787345000000-IndexAccountSessions";
import { MakeCouchPersistenceExplicit1787346000000 } from "../../../migrations/1787346000000-MakeCouchPersistenceExplicit";
import { OwnPersistentRooms1787347000000 } from "../../../migrations/1787347000000-OwnPersistentRooms";
import { SaveCustomGameSettings1787348000000 } from "../../../migrations/1787348000000-SaveCustomGameSettings";
import { AddAccountLanguagePreferences1787349000000 } from "../../../migrations/1787349000000-AddAccountLanguagePreferences";
import { AddGroupSetupDefaults1787350000000 } from "../../../migrations/1787350000000-AddGroupSetupDefaults";
import { AddScopedCardManagement1787351000000 } from "../../../migrations/1787351000000-AddScopedCardManagement";
import { AddMaximumSocialSensitivity1787352000000 } from "../../../migrations/1787352000000-AddMaximumSocialSensitivity";
import { NormalizeProfileIdentifiers1787353000000 } from "../../../migrations/1787353000000-NormalizeProfileIdentifiers";
import { ExpandSessionRuntimeStorage1787354000000 } from "../../../migrations/1787354000000-ExpandSessionRuntimeStorage";
import { RebaseGroupHistoryOnCatalog1787355000000 } from "../../../migrations/1787355000000-RebaseGroupHistoryOnCatalog";
import { CompactSessionCardPolicy1787356000000 } from "../../../migrations/1787356000000-CompactSessionCardPolicy";
import { ExternalizeSessionImmutableState1787357000000 } from "../../../migrations/1787357000000-ExternalizeSessionImmutableState";
import { AddLocalDiscoveryAndDisplayBootstrap1787358000000 } from "../../../migrations/1787358000000-AddLocalDiscoveryAndDisplayBootstrap";
import { ScrubExpiredPrivateBoundaries1787359000000 } from "../../../migrations/1787359000000-ScrubExpiredPrivateBoundaries";
import { AddCardPolicyScopeRevisions1787360000000 } from "../../../migrations/1787360000000-AddCardPolicyScopeRevisions";
import { FreezeSessionCatalogs1787361000000 } from "../../../migrations/1787361000000-FreezeSessionCatalogs";
import { UseLiveSessionCatalog1787362000000 } from "../../../migrations/1787362000000-UseLiveSessionCatalog";
import { BoundGameRetention1787363000000 } from "../../../migrations/1787363000000-BoundGameRetention";

export const entities = [
    CardCatalogVersionEntity,
    CardEntity,
    CardLocalizationEntity,
    CardOperationalFlagEntity,
    DareTypeEntity,
    DareTypeTranslationEntity,
    LocaleEntity,
    QuestionCategoryEntity,
    QuestionCategoryTranslationEntity,
    CardAppearanceEntity,
    CardPolicyConditionalRuleEntity,
    CardPolicyExactCardEntity,
    CardPolicyScopeDefaultEntity,
    CouchCardAppearanceEntity,
    CouchGameSessionEntity,
    DataSpaceGameSettingsEntity,
    GameCapacityEntity,
    GameSessionEntity,
    GroupEntity,
    RoomCreateIdempotencyEntity,
    RoomEntity,
    RoomParticipantBoundaryEntity,
    RoomParticipantEntity,
    SessionImmutablePayloadChunkEntity,
    SessionImmutablePayloadEntity,
    InstallationMetadataEntity,
    AccountSession,
    DataSpace,
    User,
];

export const migrations = [
    IntroduceDataSpaces1787330000000,
    NormalizeCardCatalog1787331000000,
    AddRealtimeRooms1787332000000,
    AddParticipantBoundaries1787333000000,
    HardenAccountSecrets1787334000000,
    AddAccountGroupsAndSettings1787335000000,
    AddDevicePlayers1787336000000,
    AddParticipantLifecycleAndGroupHistoryReset1787337000000,
    AddAuthoritativeRoomSettings1787338000000,
    BundledCardCatalog1787339000000,
    AllowMultipleRoomSessions1787340000000,
    AddRoomClosure1787341000000,
    AddIntensityProgressionSettings1787342000000,
    TrackCardAppearanceOutcomes1787343000000,
    HardenOidcIdentity1787344000000,
    IndexAccountSessions1787345000000,
    MakeCouchPersistenceExplicit1787346000000,
    OwnPersistentRooms1787347000000,
    SaveCustomGameSettings1787348000000,
    AddAccountLanguagePreferences1787349000000,
    AddGroupSetupDefaults1787350000000,
    AddScopedCardManagement1787351000000,
    AddMaximumSocialSensitivity1787352000000,
    NormalizeProfileIdentifiers1787353000000,
    ExpandSessionRuntimeStorage1787354000000,
    RebaseGroupHistoryOnCatalog1787355000000,
    CompactSessionCardPolicy1787356000000,
    ExternalizeSessionImmutableState1787357000000,
    AddLocalDiscoveryAndDisplayBootstrap1787358000000,
    ScrubExpiredPrivateBoundaries1787359000000,
    AddCardPolicyScopeRevisions1787360000000,
    FreezeSessionCatalogs1787361000000,
    UseLiveSessionCatalog1787362000000,
    BoundGameRetention1787363000000,
];

export const subscribers = [];
