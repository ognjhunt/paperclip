declare module "hermes-paperclip-adapter/ui" {
  export function parseHermesStdoutLine(...args: any[]): any[];
  export function buildHermesConfig(...args: any[]): Record<string, unknown>;
}
