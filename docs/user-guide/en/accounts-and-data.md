# Accounts and saved data

## Quick or saved game?

A **quick game** is ephemeral, can be anonymous, and is not attached to a DataSpace.
Choose it even while signed in when you do not want history or settings persisted.
It remains available on public servers in Couch, Personal, and Party Screen modes.

A **saved game** uses the current DataSpace, allowing groups, preferred profile,
intensity, and history to remain together over time. No Group and every saved Group keep
their own last Custom configuration and complete Card-language setup (primary language,
fallback switch, and ordered fallback languages). Selecting another Group or playing
another profile does not overwrite those values.

## DataSpaces and groups

A DataSpace is a separate ownership area inside an account, such as “Friends” or
“Couple night”. It matters when the same account is used for groups that should not
share names, preferred settings, or game history. Groups store names for recurring
sessions. Select the correct DataSpace and group before creating a persisted Room; IDs
from another DataSpace do not bypass ownership checks. New accounts receive a default
DataSpace automatically.

The DataSpace list has name search and bounded pages, so switching remains manageable
even when an account owns many areas. Selecting a DataSpace changes the ownership scope
for Groups and Card management; it does not merge or copy policy from another area.
The main menu names the active DataSpace above its play actions, so this scope remains
visible before you continue a Group or open Card management.

The Account screen has a dedicated **Groups** tab. Its search checks both Group and
person names, while bounded pages keep the list manageable even with hundreds of Groups.
Select one Group to rename it, edit its people, reset its Card history, or fully delete
it. Deletion requires entering its exact name. Saved Sessions remain in the export but
are detached from the deleted Group. Game setup stays focused on selecting an existing
Group or quickly creating one. **Host Game** always starts without a preselected Group;
only **Continue Group** selects one immediately.
Until a Group exists, **Select Group** is disabled. Deleting the final Group switches
setup directly back to **No Group**.

Configured **Imprint** and **Privacy policy** links appear below the main menu and under
Settings → Help & account. They open separately, so an active setup or game stays open.

## Sessions and security

The Account screen separates DataSpaces, Groups, signed-in devices, and account data into tabs.
It lists active account sessions and can revoke another device. It also selects, creates,
renames, marks as default, and permanently deletes a DataSpace. Deleting a DataSpace
also deletes its groups, settings, and saved game history; enter its name to confirm.
The final DataSpace cannot be deleted. Use a unique password. Activation and
reset links are one-time secrets and should never be forwarded. Request another
activation email from the sign-in screen if the first message expired. Changing a
forgotten password signs every existing device out.

## Export and deletion

Export downloads account-owned settings and privacy-safe saved game history as JSON;
handle it as private information. Live runtime state and individual private answers are
not included.
**Delete account** permanently removes the account and saved game data after username
confirmation. Ephemeral Rooms are not included in later exports.
