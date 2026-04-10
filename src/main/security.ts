export function isAllowedAppNavigation(targetUrl: string, rendererUrl?: string): boolean {
  try {
    const parsed = new URL(targetUrl);

    if (parsed.protocol === "file:") {
      return true;
    }

    if (!rendererUrl) {
      return false;
    }

    const allowed = new URL(rendererUrl);
    const isLocalDevServer = /^(localhost|127\.0\.0\.1)$/i.test(parsed.hostname);
    return isLocalDevServer && parsed.origin === allowed.origin;
  } catch {
    return false;
  }
}

export function isAllowedExternalOpenTarget(targetUrl: string): boolean {
  try {
    return new URL(targetUrl).protocol === "file:";
  } catch {
    return false;
  }
}

export function isAbsoluteLocalPath(value: string): boolean {
  return value.startsWith("/");
}
