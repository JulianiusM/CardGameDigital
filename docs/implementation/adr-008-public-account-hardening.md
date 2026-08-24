# ADR-008: Incremental public account hardening

## Status

Accepted for Phase 8.

## Decision

The user explicitly selected Argon2id for this fresh development. That supersedes
the TAD's lower-dependency scrypt preference for this implementation detail.

- New and reset passwords use OWASP's minimum Argon2id profile (19 MiB memory,
  two iterations, one lane). This is a fresh product schema, so unsupported hash
  formats are rejected instead of carrying a legacy password verifier.
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
- Public state-changing HTTP requests require the configured public Origin (or
  Referer fallback). Sensitive account routes are rate-limited. Logout is POST,
  not a state-changing GET.
- Public WebSocket connections require the configured origin and each connection
  has a bounded command rate. Room participant credentials remain independent
  from account cookies.
- Authenticated accounts can list/revoke their own AccountSessions and export
  their account/DataSpace metadata. Existing account deletion remains retained.
- Persistent Groups and gameplay defaults belong to the active account-owned
  DataSpace. Public Room creation resolves that DataSpace from the authenticated
  server session; a client cannot nominate another owner's ID. Selecting a Group
  loads its durable card history into the shared Session engine.

## Compatibility

The `1787334000000-HardenAccountSecrets` migration adds hashed-token columns and
removes raw-token columns. `1787335000000-AddAccountGroupsAndSettings` adds the
DataSpace-owned Group/settings schema and the Room-to-Group relationship.

## Remaining release gates

Public reverse-proxy/account browser E2E, SMTP delivery, provider-specific OIDC
integration, and legal/policy review for explicit content must run
in the deployment CI/staging environment before Phase 8 is marked VERIFIED.
