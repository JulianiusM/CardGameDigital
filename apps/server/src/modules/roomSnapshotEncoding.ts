import { PROTOCOL_VERSION } from "../../../../packages/protocol";
import type { RoomSnapshot } from "../../../../packages/application/roomService";

/** Encode large public roster/settings/voting fields once per broadcast. The input
 * is the service's anonymous projection; only explicitly private fields vary. */
export function roomSnapshotEncoder(common: RoomSnapshot, requestId: string | null) {
    const { session, boundaryConfigured: _boundary, ...room } = common;
    const roomJson = JSON.stringify(room).slice(0, -1);
    let sessionJson: string | null = null;
    if (session) {
        const {
            hasVoted: _voted,
            controllablePlayers: _players,
            viewer: _viewer,
            availableActions: _actions,
            ...publicSession
        } = session;
        sessionJson = JSON.stringify(publicSession).slice(0, -1);
    }
    const envelope = JSON.stringify({
        protocol: PROTOCOL_VERSION,
        type: "room.snapshot",
        requestId,
        revision: common.session?.revision ?? null,
    }).slice(0, -1);
    const head = Buffer.from(
        `${envelope},"payload":${roomJson},"session":${sessionJson ?? "null"},`,
        "utf8",
    );
    return (snapshot: RoomSnapshot): readonly Buffer[] => {
        let privateSession = "";
        if (snapshot.session && sessionJson !== null) {
            const { hasVoted, controllablePlayers, viewer, availableActions } = snapshot.session;
            const privateFields = JSON.stringify({
                hasVoted,
                controllablePlayers,
                viewer,
                availableActions,
            }).slice(1);
            privateSession = `${privateFields},`;
        }
        // Two ordinary text fragments form one complete v4 JSON message. The large
        // UTF-8 prefix is shared; only this small viewer-specific tail is allocated.
        const tail = Buffer.from(
            `${privateSession}"boundaryConfigured":${snapshot.boundaryConfigured}}}`,
            "utf8",
        );
        return [head, tail];
    };
}
