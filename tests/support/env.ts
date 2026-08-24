// Keep automated test output focused on assertions. Logger behavior has a dedicated
// unit suite, while integration tests can override this explicitly when needed.
process.env.LOG_LEVEL ??= "silent";
