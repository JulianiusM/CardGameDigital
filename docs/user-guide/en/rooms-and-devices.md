# Rooms, devices, and hosting

## Joining

The host shares the six-character Room code or QR code. The code is public; a secret
device credential is issued only after joining and stays on that device. Do not share
stored credentials or browser storage.

Every QR display also lists the addresses that can open this Room. A local server may
show several LAN addresses when it is connected through several network interfaces;
use one reachable from the joining device. The list skips virtual adapters and unusable
link-local IPv6 routes and shows at most one IPv6 address per physical interface. IPv6
addresses appear in brackets, which is the normal URL format. A Party Screen shows as
many addresses per page as its available height allows before advancing.

Several groups can play on one network at the same time. Every Room has an independent
code, state, and command queue. Confirm the code when siblings or nearby groups are
playing simultaneously.
Every connected device keeps the current represented-player count and configured
maximum visible.

## Opening a Party Screen first

In **Host Game**, choose **TV + phones** on the final setup step. That browser becomes
the read-only Party Screen immediately and shows the code/QR while it waits. No hidden
Host is created. Join from a phone as a player; the first phone that connects becomes
Host and receives the start/settings controls. The screen shows who currently controls
the game and whether that Host is reconnecting.

The main-menu **Display only** action is different: use it to attach another read-only
screen to a Room code that already exists.

## Multiple people on one device

Any player device—not only the host—can add local players in the lobby. The device later
receives controls for those people. Changes autosave after editing and are flushed before
the Host starts; the visible status confirms the saved state. The list is locked during
the session so voting and turn order remain unambiguous.

## Host authority

There is exactly one host. Only that device can start the session, change global
settings, transfer hosting, or end the game. Players receive only actions they are
currently allowed to perform. Displays remain read-only.

## Transfer and recovery

The host can explicitly select a player device and transfer authority. After an
unexpected disconnect, the server gives every device three minutes by default to
reconnect, then
promotes an eligible connected player. If nobody is connected, promotion happens when
an eligible player returns. A display never becomes host.
If every Host/player leaves or fails to return before their grace period ends, a
currently connected display keeps the code available for new players. It never becomes
Host; the next player does. The Room closes after the display also disconnects and its
grace expires.

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
