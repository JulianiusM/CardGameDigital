// Version 4 guarantees the shared 4 MiB receive budget; early v3 native builds
// accepted only 64 KiB and cannot safely join rooms at the supported capacity.
export const PROTOCOL_VERSION = 4 as const;
