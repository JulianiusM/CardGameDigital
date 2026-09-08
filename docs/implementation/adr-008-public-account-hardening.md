# ADR-008: Incremental public account hardening

## Status

Accepted for Phase 8.

## Decision

The user explicitly selected Argon2id for this fresh development. That supersedes
the TAD's lower-dependency scrypt preference for this implementation detail.

- New and reset passwords use OWASP's minimum Argon2id profile (19 MiB memory,
  two iterations, one lane). This is a fresh product schema, so unsupported hash
  formats are rejected instead of carrying a legacy password verifier.
- Node's asynchronous built-in Argon2id implementation replaces the native npm binding.
  PHC v19 encoding keeps the existing 19 MiB/two-pass/one-lane profile, 16-byte random salt,
  and 32-byte hash. Verification accepts both PHC parameter orders used for that profile,
  validates canonical Base64 before derivation, and compares hashes in constant time.
  Existing application passwords need no reset; unsupported profiles remain rejected.
- Activation and password-reset credentials are generated as high-entropy raw
  values, returned only for email delivery, and stored as SHA-256 hashes. Legacy
  raw token columns are removed from the schema entirely.
- OIDC retains state, PKCE, and nonce handling. Automatic email linking is
  allowed only when the provider's verified claims contain
  `email_verified=true`; unverified addresses receive a stable hash-derived synthetic
  local address. Claims are schema-validated, callbacks use the configured canonical
  URL rather than forwarded host input, issuer/subject is database-unique, and JIT
  provisioning creates its owned DataSpace in the same transaction. Provider access,
  refresh, and ID tokens are not retained after the local session is established.
- Email and verification retain their claim-source provenance: a UserInfo address
  change cannot inherit verification for the ID-token address. Verified-email linking
  conditionally claims an unlinked local account and never replaces another
  issuer/subject link. Conflicting identities receive separate synthetic-email accounts.
- Enforced public state-changing HTTP requests require the configured public Origin (or
  Referer fallback). Sensitive account routes are rate-limited. Logout is POST,
  not a state-changing GET.
- Enforced public WebSocket connections require the configured origin and each connection
  has a bounded command rate. Room participant credentials remain independent
  from account cookies.
- `PUBLIC_RUNTIME_SECURITY=enforced` is the default public policy. An administrator can
  explicitly choose `development` to start and test public behavior without TLS,
  MariaDB, SMTP, proxy, production-catalog, stable-secret, Origin, HSTS, or
  HTTP/WebSocket abuse gates. The server logs that state at startup. This does not bypass authentication when
  `AUTH_MODE=account`, account/DataSpace ownership, Room command authority, password
  hashing, input validation, or canonical OIDC callbacks, and it is not an internet-safe
  deployment profile.
- Authenticated accounts can list/revoke their own AccountSessions and export
  their account/DataSpace metadata plus privacy-safe durable gameplay history.
  Password reset revokes every AccountSession. Account session JSON retains only
  user/DataSpace identifiers, while an indexed owner column makes listing, revocation,
  reset, and deletion explicit rather than requiring JSON scans.
- Persistent Groups and gameplay defaults belong to the active account-owned
  DataSpace. Public Room creation resolves that DataSpace from the authenticated
  server session; a client cannot nominate another owner's ID. Selecting a Group
  loads its durable card history into the shared Session engine.
- Every authenticated account owns at least one DataSpace. Login, OIDC callback, and
  session validation repair pre-invariant accounts or deleted selections under an owner
  row lock. A still-existing DataSpace belonging to another account is rejected rather
  than repaired. An account may delete any owned DataSpace except its last; deletion
  cascades through its durable data and moves an affected session to an owned remainder.
- The Svelte SPA owns account status, registration, activation/resend, password login
  and reset, tabbed DataSpace selection/create/rename/default/deletion management,
  session revocation, export, logout, and account deletion. It explains DataSpace scope
  before presenting management controls. A safe local `returnTo` preserves game setup
  through login, while Account and Help links opened from in-game settings leave the
  running game in its original tab.
  Anonymous Quick Round remains available in Couch, Personal, and Party Screen modes.

## Compatibility

The new `PUBLIC_RUNTIME_SECURITY` setting defaults to `enforced`, so existing public
deployments retain their startup and runtime hardening. The discovery response now
advertises the selected policy. `LOG_ERROR_DETAILS` defaults to `standard`; both logging
policies include real error messages and call stacks, while `diagnostic` adds cause and
database-driver metadata.

The `1787334000000-HardenAccountSecrets` migration adds hashed-token columns and
removes raw-token columns. `1787335000000-AddAccountGroupsAndSettings` adds the
DataSpace-owned Group/settings schema and the Room-to-Group relationship.
`1787345000000-IndexAccountSessions` adds indexed AccountSession ownership,
`1787346000000-MakeCouchPersistenceExplicit` removes legacy unowned Couch rows, and
`1787347000000-OwnPersistentRooms` adds the Room-to-DataSpace ownership constraint.
The AccountSession migration deliberately clears pre-migration login sessions because
their old serialized shape has no trustworthy portable owner column; users sign in
again once after upgrade.

## Remaining release gates

Automated public SPA/account flows now run against MariaDB 10.11, including anonymous
quick play and authenticated persistence. Real SMTP delivery, provider-specific OIDC,
the deployed HTTPS reverse proxy, and legal/policy review for explicit content remain
deployment/staging gates.
