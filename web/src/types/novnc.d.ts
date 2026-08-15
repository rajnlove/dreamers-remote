declare module "@novnc/novnc" {
  export interface RFBCredentials {
    username?: string;
    password?: string;
    target?: string;
  }

  export interface RFBOptions {
    credentials?: RFBCredentials;
    shared?: boolean;
    wsProtocols?: string[];
  }

  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string, options?: RFBOptions);
    scaleViewport: boolean;
    resizeSession: boolean;
    // clipViewport + dragViewport: show the remote framebuffer at native
    // resolution, clipped to the container, and let the user drag to pan.
    // Alternative to scaleViewport for multi-monitor desktops that get
    // squashed illegibly small when scaled to fit.
    clipViewport: boolean;
    dragViewport: boolean;
    // Tight-encoding tuning (see noVNC docs/API.md). Only takes effect if
    // the VNC server (UltraVNC) negotiates Tight encoding.
    qualityLevel: number; // 0-9, JPEG quality; higher = crisper, more CPU
    compressionLevel: number; // 0-9, zlib level; higher = smaller, more CPU
    disconnect(): void;
    sendCredentials(credentials: RFBCredentials): void;
    sendCtrlAltDel(): void;
  }
}
