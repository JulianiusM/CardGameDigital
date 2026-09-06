# Troubleshooting

If the server is busy, keep your current game open and retry shortly. A rejected draw
is not replayed automatically; reconnect reads the authoritative state. Quick Round
Couch games expire by default after 24 hours without use or when the server restarts. Their end
summaries remain available for up to 15 minutes while the server has capacity. Saved
Couch games end by default after 24 hours without a game action; saved Group
history remains available. The server administrator can configure different retention periods.

## Room not found

Check every character; codes omit `0`, `1`, `I`, and `O`. Make sure all devices use the
same server address and, when several groups share a network, compare the code with the
host. The Room may also have expired or the server may have restarted.

## Connection dropped

Keep the page open and allow automatic reconnection. After returning, trust the fresh
server snapshot and do not repeatedly submit an old action. If the host remains away,
an eligible player device takes over after the grace period.

In Couch mode, a temporary failure keeps the game reference on this device and checks
the latest state before showing game controls again. If automatic recovery stops,
choose **Reconnect**. When asked to check your account, open **Account**, sign in to
the same account and select the same DataSpace, then return and reconnect. Account
opens separately so the game page stays available. A game that has expired or become
unavailable cannot be recovered; the page will let you start a new game.

## Start is disabled

At least two players are required; saved local players count. Verify names and required
boundary setup. Only the current host can start.

## No compatible card

Language, profile, intensity, boundaries, and history may leave no published card.
Missing translations are excluded by default rather than unexpectedly switching
language. End the round or deliberately adjust profile/intensity before a new session;
never pressure someone to remove a boundary.

## No sound

Browsers often block audio until the first deliberate interaction. Tap the page, then
check presentation controls, device volume, and mute state. Gameplay remains complete
without sound.

## Reporting a persistent problem

Record server version, time, Room code (never the participant credential), role,
browser/device, and visible error code. This helps the operator find relevant logs
without exposing a bearer secret.
