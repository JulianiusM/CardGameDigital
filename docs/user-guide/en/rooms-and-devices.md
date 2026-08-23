# Rooms, devices, and hosting

## Joining

The host shares the six-character Room code or QR code. The code is public; a secret
device credential is issued only after joining and stays on that device. Do not share
stored credentials or browser storage.

Several groups can play on one network at the same time. Every Room has an independent
code, state, and command queue. Confirm the code when siblings or nearby groups are
playing simultaneously.

## Multiple people on one device

Any player device—not only the host—can add local players in the lobby. The device later
receives controls for those people. Save the list before starting; it is locked during
the session so voting and turn order remain unambiguous.

## Host authority

There is exactly one host. Only that device can start the session, change global
settings, transfer hosting, or end the game. Players receive only actions they are
currently allowed to perform. Displays remain read-only.

## Transfer and recovery

The host can explicitly select a player device and transfer authority. After an
unexpected disconnect, the server gives the host a short reconnect grace period, then
promotes an eligible connected player. If nobody is connected, promotion happens when
an eligible player returns. A display never becomes host.

After reconnecting, wait for the new snapshot. Only controls offered by that snapshot
reflect the current authority and revision.

## Never Have I Ever on shared displays

While Never Have I Ever voting is open, the shared display may show every current
player's **Voted** or **Waiting** status. It never shows the submitted answer before the
result reveal.

In **Anonymous** mode the result contains totals only. In **Reveal answers** mode the
result is intentionally public and shows each player's answer after everyone has voted.

On a small Party Screen, long voting and result rosters advance automatically in pages
and wrap back to the beginning. The Card, heading, and totals stay visible, so nobody
needs to scroll on the TV.
