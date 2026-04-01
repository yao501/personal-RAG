import type { DesktopApi } from "../lib/shared/types";

declare global {
  interface Window {
    desktopApi: DesktopApi;
  }
}

export {};

