from __future__ import annotations

import copy
import json
import unittest

from support import RESOURCES_ROOT
from lib.protocol.validation import (
    ProtocolViolation,
    load_generated_json,
    validate_card_search,
    validate_couch_snapshot,
    validate_eligibility_preview,
    validate_game_settings,
    validate_groups,
    validate_locales,
    validate_profiles,
    validate_room_join,
    validate_server_envelope,
    validate_server_info,
    validate_taxonomy,
)


class ProtocolValidationTests(unittest.TestCase):
    def test_every_shared_room_fixture_is_accepted(self) -> None:
        manifest = load_generated_json("fixtures/manifest.json")
        for name in manifest["roomSnapshotFixtures"]:
            with self.subTest(name=name):
                fixture = load_generated_json(f"fixtures/{name}")
                self.assertEqual(validate_server_envelope(fixture)["type"], "room.snapshot")

    def test_server_info_fixture_and_additive_fields_are_accepted(self) -> None:
        fixture = load_generated_json("fixtures/server-info.json")
        fixture["futureField"] = {"ignored": True}
        self.assertEqual(validate_server_info(fixture)["serverId"], fixture["serverId"])

    def test_server_info_rejects_unsafe_access_origins_and_disabled_auth_metadata(self) -> None:
        fixture = load_generated_json("fixtures/server-info.json")
        fixture["roomAccess"]["configuredBaseUrl"] = "https://example.com/path?token=x"
        with self.assertRaisesRegex(ProtocolViolation, r"HTTP\(S\) origin"):
            validate_server_info(fixture)

        fixture = load_generated_json("fixtures/server-info.json")
        fixture["nativeDeviceAuthorization"] = {
            "clientId": "unexpected",
            "scopes": ["groups:read"],
        }
        with self.assertRaisesRegex(ProtocolViolation, "must have no descriptor"):
            validate_server_info(fixture)

    def test_display_snapshot_rejects_private_actions(self) -> None:
        fixture = load_generated_json("fixtures/awaiting-first-host.json")
        snapshot = fixture["payload"]
        snapshot["session"] = {
            "id": "00000000-0000-4000-8000-000000000020",
            "revision": 0,
            "state": "WAITING_FOR_PLAYER",
            "viewer": {
                "participantId": "00000000-0000-4000-8000-000000000001",
                "role": "DISPLAY",
                "displayName": "TV",
            },
            "availableActions": ["END_SESSION"],
            "currentCard": None,
        }
        with self.assertRaisesRegex(ProtocolViolation, "private action"):
            validate_server_envelope(fixture)

    def test_couch_snapshot_validates_roster_and_vote_privacy_shape(self) -> None:
        first = "00000000-0000-4000-8000-000000000001"
        second = "00000000-0000-4000-8000-000000000002"
        snapshot = {
            "id": "00000000-0000-4000-8000-000000000010",
            "startedAt": 1,
            "mode": "NEVER_HAVE_I_EVER",
            "revision": 0,
            "state": "COLLECTING_ANSWERS",
            "roundNumber": 1,
            "activePlayer": {"id": first, "name": "Alex"},
            "players": [{"id": first, "name": "Alex"}, {"id": second, "name": "Sam"}],
            "currentCard": None,
            "cardsShown": 0,
            "remainingCardCount": 3,
            "voteResult": {"yes": 0, "no": 0, "total": 0},
            "votedPlayerIds": [],
            "neverHaveIEverVoting": {
                "revealMode": "ANONYMOUS_AGGREGATE",
                "progress": [
                    {"playerId": first, "displayName": "Alex", "status": "PENDING"},
                    {"playerId": second, "displayName": "Sam", "status": "PENDING"},
                ],
                "result": None,
            },
            "persistence": "EPHEMERAL",
            "settings": {
                "mode": "NEVER_HAVE_I_EVER",
                "profileId": "PROFILE_FRIENDS",
                "cardLocale": "en-GB",
                "cardFallbackEnabled": False,
                "cardFallbackLocales": [],
                "neverHaveIEverRevealMode": "ANONYMOUS_AGGREGATE",
                "configuration": {
                    "enabledQuestionCategoryIds": ["CAT_EVERYDAY"],
                    "enabledDareTypeIds": ["DARE_SILLY"],
                    "blockedOperationalFlags": [],
                    "maximumSocialSensitivity": "PERSONAL",
                    "startingIntensity": 1,
                    "maximumIntensity": 3,
                    "intensityProgressionUnit": "CARDS",
                    "intensityProgressionInterval": 2,
                    "intensityProgressionIncrement": 1,
                    "randomQuestionRatio": 0.5,
                    "maximumTypeStreak": 3,
                    "letsTalkMetaInterval": 5,
                },
                "cardPolicy": {},
            },
        }
        self.assertEqual(validate_couch_snapshot(snapshot)["id"], snapshot["id"])
        snapshot["currentCard"] = {
            "id": "00000000-0000-4000-8000-000000000030",
            "cardText": "A question",
            "cardType": "QUESTION",
            "cardIntensity": 2,
            "intensity": 3,
            "questionCategoryId": "CAT_EVERYDAY",
            "dareTypeId": None,
        }
        self.assertEqual(
            validate_couch_snapshot(snapshot)["currentCard"]["questionCategoryId"],
            "CAT_EVERYDAY",
        )
        snapshot["neverHaveIEverVoting"]["result"] = {
            "yes": 1,
            "no": 1,
            "total": 2,
            "namedAnswers": [],
        }
        with self.assertRaisesRegex(ProtocolViolation, "named answers"):
            validate_couch_snapshot(snapshot)

    def test_active_display_snapshot_validates_public_session_and_card_taxonomy(self) -> None:
        fixture = load_generated_json("fixtures/promoted-host.json")
        display_id = "00000000-0000-4000-8000-000000000001"
        first = "00000000-0000-4000-8000-000000000011"
        second = "00000000-0000-4000-8000-000000000012"
        fixture["revision"] = 4
        fixture["payload"]["settings"]["mode"] = "LETS_TALK"
        fixture["payload"]["session"] = {
            "id": "00000000-0000-4000-8000-000000000020",
            "startedAt": 1,
            "mode": "LETS_TALK",
            "revision": 4,
            "state": "SHOWING_CARD",
            "roundNumber": 2,
            "activePlayer": {"id": first, "name": "Alex"},
            "players": [
                {"id": first, "name": "Alex"},
                {"id": second, "name": "Sam"},
            ],
            "currentCard": {
                "id": "00000000-0000-4000-8000-000000000030",
                "cardText": "What did this conversation teach you?",
                "cardType": "CONVERSATION_META",
                "cardIntensity": 3,
                "intensity": 3,
                "questionCategoryId": "CAT_PERSONALITY",
                "dareTypeId": None,
            },
            "cardsShown": 4,
            "remainingCardCount": 10,
            "voteResult": {"yes": 0, "no": 0, "total": 0},
            "neverHaveIEverVoting": None,
            "hasVoted": False,
            "controllablePlayers": [],
            "viewer": {
                "participantId": display_id,
                "role": "DISPLAY",
                "displayName": "Living room TV",
            },
            "availableActions": ["DISPLAY_SESSION", "LEAVE_ROOM"],
        }
        self.assertEqual(validate_server_envelope(fixture)["revision"], 4)

    def test_every_server_event_shape_is_strict_and_bounded(self) -> None:
        display_id = "00000000-0000-4000-8000-000000000001"
        base = {"protocol": 2, "requestId": None, "revision": None}
        events = (
            {
                **base,
                "type": "server.pong",
                "requestId": "heartbeat",
                "payload": {"serverTime": 1},
            },
            {
                **base,
                "type": "room.presence",
                "payload": {
                    "connected": [
                        {
                            "participantId": display_id,
                            "displayName": "TV",
                            "role": "DISPLAY",
                        }
                    ]
                },
            },
            {
                **base,
                "type": "room.participantLeft",
                "payload": {
                    "participantId": display_id,
                    "displayName": "TV",
                    "reason": "LEFT",
                },
            },
            {
                **base,
                "type": "session.cardReplaced",
                "payload": {"reason": "SKIPPED"},
            },
        )
        for event in events:
            with self.subTest(event=event["type"]):
                self.assertEqual(validate_server_envelope(event)["type"], event["type"])
        with self.assertRaisesRegex(ProtocolViolation, "unsupported"):
            validate_server_envelope({**base, "type": "room.future", "payload": {}})

    def test_tv_never_accepts_host_role_from_join_or_hello(self) -> None:
        join = {
            "roomId": "00000000-0000-4000-8000-000000000010",
            "roomCode": "ABC234",
            "participantId": "00000000-0000-4000-8000-000000000001",
            "participantCredential": "x" * 43,
            "role": "HOST",
        }
        with self.assertRaisesRegex(ProtocolViolation, "expected role DISPLAY"):
            validate_room_join(join)
        hello = {
            "protocol": 2,
            "type": "server.hello",
            "requestId": "one",
            "revision": None,
            "payload": {
                "protocolVersion": 2,
                "participantId": join["participantId"],
                "role": "HOST",
            },
        }
        with self.assertRaisesRegex(ProtocolViolation, "must remain DISPLAY"):
            validate_server_envelope(hello)

    def test_http_metadata_and_search_responses_are_bounded_and_validated(self) -> None:
        configuration = {
            "enabledQuestionCategoryIds": ["CAT_EVERYDAY"],
            "enabledDareTypeIds": ["DARE_SILLY"],
            "blockedOperationalFlags": [],
            "maximumSocialSensitivity": "PERSONAL",
            "startingIntensity": 1,
            "maximumIntensity": 3,
            "intensityProgressionUnit": "CARDS",
            "intensityProgressionInterval": 2,
            "intensityProgressionIncrement": 1,
            "randomQuestionRatio": 0.6,
            "maximumTypeStreak": 3,
            "letsTalkMetaInterval": 5,
        }
        profiles = {
            "profiles": [
                {
                    "id": "PROFILE_FRIENDS",
                    "name": "Friends",
                    "description": "A balanced game",
                    "requiresAdultConfirmation": False,
                    "immutable": True,
                    **configuration,
                }
            ]
        }
        locales = {
            "defaultLocale": "en-GB",
            "locales": [{"id": "en-GB", "nativeName": "English", "coverage": 1}],
        }
        taxonomy = {
            "locale": "en-GB",
            "questionCategories": [
                {"id": "CAT_EVERYDAY", "label": "Everyday", "description": None}
            ],
            "dareTypes": [{"id": "DARE_SILLY", "label": "Silly", "description": None}],
        }
        group = {
            "id": "00000000-0000-4000-8000-000000000010",
            "name": "Friends",
            "members": ["Alex", "Sam"],
            "updatedAt": "2026-08-28T12:00:00.000Z",
            "historyResetAt": None,
            "preferredProfileId": "PROFILE_FRIENDS",
            "customConfiguration": configuration,
            "cardLanguageSettings": None,
        }
        game_settings = {
            "settings": {
                "preferredProfileId": "PROFILE_FRIENDS",
                "startingIntensity": 1,
                "maximumIntensity": 3,
                "maximumSocialSensitivity": "PERSONAL",
                "intensityProgressionUnit": "CARDS",
                "intensityProgressionInterval": 2,
                "intensityProgressionIncrement": 1,
                "randomQuestionRatio": 0.6,
                "letsTalkMetaInterval": 5,
                "defaultGroupId": None,
                "customConfiguration": configuration,
                "cardLanguageSettings": None,
            },
            "dataSpace": {
                "id": "00000000-0000-4000-8000-000000000020",
                "name": "Local games",
            },
        }
        eligibility = {
            "total": 10,
            "availableAtStart": 4,
            "byType": {"QUESTION": 5, "DARE": 5, "CONVERSATION_META": 0},
            "atStartByType": {"QUESTION": 2, "DARE": 2, "CONVERSATION_META": 0},
            "playerCount": 4,
        }
        search = {
            "total": 1,
            "nextCursor": None,
            "cards": [
                {
                    "id": "00000000-0000-4000-8000-000000000030",
                    "text": "A localized Card",
                    "locale": "en-GB",
                    "lifecycle": "ACTIVE",
                    "cardType": "QUESTION",
                    "effective": {"availability": "INCLUDE"},
                    "localDirectives": {},
                }
            ],
        }

        self.assertEqual(validate_profiles(profiles)[0]["name"], "Friends")
        self.assertEqual(validate_locales(locales)["defaultLocale"], "en-GB")
        self.assertEqual(validate_taxonomy(taxonomy)["locale"], "en-GB")
        self.assertEqual(validate_groups({"groups": [group]})[0]["id"], group["id"])
        self.assertEqual(validate_game_settings(game_settings)["dataSpace"]["name"], "Local games")
        self.assertEqual(validate_eligibility_preview(eligibility)["total"], 10)
        self.assertEqual(validate_card_search(search, 24)["cards"][0]["text"], "A localized Card")

        invalid_search = copy.deepcopy(search)
        invalid_search["cards"][0]["cardText"] = invalid_search["cards"][0].pop("text")
        with self.assertRaisesRegex(ProtocolViolation, "Card search.*text"):
            validate_card_search(invalid_search, 24)

        with self.assertRaisesRegex(ProtocolViolation, "bounded list"):
            validate_groups({"groups": [group] * 2_001})

    def test_generated_manifest_contains_source_owned_contracts(self) -> None:
        manifest = load_generated_json("protocol/manifest.json")
        self.assertEqual(manifest["protocolVersion"], 2)
        self.assertIn("server-info.schema.json", manifest["schemas"])
        self.assertIn("room-snapshot.schema.json", manifest["schemas"])
        for name in manifest["schemas"]:
            self.assertTrue((RESOURCES_ROOT / "data" / "protocol" / name).is_file())


if __name__ == "__main__":
    unittest.main()
