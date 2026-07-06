const REMOTE_FILESYSTEM_ROOTS = new Set([
  "home",
  "var",
  "opt",
  "tmp",
  "root",
  "etc",
  "usr",
  "srv",
  "data",
  "mnt",
  "media",
  "run",
  "log",
  "logs",
  "app",
  "apps",
  "www"
]);

export type JumpServerSftpPath = {
  assetKey: string;
  realPath: string;
};

export function parseJumpServerSftpPath(virtualPath: string): JumpServerSftpPath | null {
  const parts = virtualPath.split("/").filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    if (REMOTE_FILESYSTEM_ROOTS.has(parts[i].toLowerCase())) {
      if (i === 0) return null;
      return {
        assetKey: parts[i - 1],
        realPath: "/" + parts.slice(i).join("/")
      };
    }
  }
  return null;
}

export function parseJumpServerAssetRootPath(virtualPath: string): JumpServerSftpPath | null {
  const parts = virtualPath.split("/").filter(Boolean);
  const assetKey = parts[parts.length - 1] || "";
  if (parts.length < 2 || !looksLikeJumpServerAssetKey(assetKey)) {
    return null;
  }
  return {
    assetKey,
    realPath: "/"
  };
}

export function looksLikeJumpServerAssetKey(value: string): boolean {
  return /\d{1,3}(?:\.\d{1,3}){1,3}/.test(value) || /^[^/\s]+_[^/]+$/.test(value);
}

export function buildJumpServerAssetKeyword(assetKey: string) {
  return assetKey.replace(/[_\s].*/g, "");
}
