declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV: string;
    VUE_ROUTER_MODE: 'hash' | 'history' | 'abstract' | undefined;
    VUE_ROUTER_BASE: string | undefined;
  }
}

  interface Window {
    umami?: {
      track: {
        (): void;
        (eventName: string): void;
        (eventName: string, data: Record<string, unknown>): void;
        (payload: Record<string, unknown>): void;
        (fn: (payload: Record<string, unknown>) => Record<string, unknown>): void;
      };
      identify?: (
        idOrData: string | Record<string, unknown>,
        data?: Record<string, unknown>
      ) => void;
    };
  }
