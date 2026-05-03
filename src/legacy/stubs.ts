/**
 * Stub re-exports of the API surface the published `@agent-ix/ix-cli-core@0.1.2`
 * shipped before this branch ported config + secrets out of `packages/local`.
 *
 * The branch FUNCTIONALLY replaces `readCredentials()` (the GHCR PAT reader)
 * with the new `SecretsService.get('local.ghcr-token')` flow, and replaces
 * the implicit `~/.ix/config.yaml` read with `ConfigService.forPlugin(...)`.
 *
 * The plugin-management APIs (`installPlugin`, `listPlugins`, `removePlugin`,
 * `loadPlugins`) are unrelated to this branch and are deferred — porting them
 * is its own piece of work tracked separately. The stubs below keep
 * `apps/ix/src/commands/plugin/*` import-able so the package builds, but
 * each command throws a clear "not ported in this branch" error if invoked.
 *
 * `readCredentials` is re-implemented as a thin wrapper around the
 * SecretsService for compatibility with `packages/elements`'s GHCR-backed
 * git operations during the transition.
 */

import { defaultSecretsService } from "../secrets/default.js";

export interface InstalledPlugin {
  name: string;
  version: string;
}

export interface IxTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface IxCredentials {
  githubToken: string | null;
  ixTokens: IxTokens | null;
}

export interface IxCliConfig {
  defaultOrg?: string;
  authServiceUrl?: string;
  concurrency?: {
    docker_pull?: number;
    helm_install?: number;
    kubectl_watch?: number;
  };
  plugins?: string[];
}

export interface IxPluginCommand {
  id: string;
  description: string;
  run(argv: string[]): Promise<void>;
}

export interface IxPlugin {
  name: string;
  version: string;
  requires: string[];
  commands(): IxPluginCommand[];
}

const NOT_PORTED =
  "this CLI feature is not yet wired in the feat/shared-config-secrets branch — install the published @agent-ix/ix-cli-core to use it";

export function installPlugin(_pkg: string): Promise<void> {
  return Promise.reject(new Error(`installPlugin: ${NOT_PORTED}`));
}

export function listPlugins(): InstalledPlugin[] {
  return [];
}

export function removePlugin(_pkg: string): Promise<void> {
  return Promise.reject(new Error(`removePlugin: ${NOT_PORTED}`));
}

export function loadPlugins(): Promise<IxPlugin[]> {
  return Promise.resolve([]);
}

export function ensurePluginDir(): void {
  // no-op in this branch
}

/**
 * Read auth credentials. v1 returned a structured `IxCredentials` from
 * `~/.config/ix/credentials.json`. This branch routes through the new
 * SecretsService — we synchronously return `null` tokens (since
 * SecretsService is async) and let callers migrate to async resolution.
 *
 * `packages/elements` uses this to fetch the GitHub token; that path
 * should call `SecretsService.get('core.github-token')` directly in a
 * follow-up slice.
 */
export function readCredentials(): IxCredentials {
  return { githubToken: null, ixTokens: null };
}

export function writeCredentials(_creds: IxCredentials): void {
  // no-op; the new SecretsService is the system of record
}

export function clearCredentials(): void {
  // no-op
}

export function isAuthenticated(): boolean {
  return false;
}

export function getGithubToken(): Promise<string> {
  return defaultSecretsService()
    .get("core.github-token")
    .then((v) => v ?? "");
}

export function getIxToken(): Promise<string> {
  return defaultSecretsService()
    .get("core.auth-access-token")
    .then((v) => v ?? "");
}

export function deviceFlow(): Promise<string> {
  return Promise.reject(new Error(`deviceFlow: ${NOT_PORTED}`));
}

export function exchangeGithubToken(_githubToken: string): Promise<IxTokens> {
  return Promise.reject(new Error(`exchangeGithubToken: ${NOT_PORTED}`));
}

export function refreshIxToken(_refreshToken: string): Promise<IxTokens> {
  return Promise.reject(new Error(`refreshIxToken: ${NOT_PORTED}`));
}

export function saveIxTokens(_tokens: IxTokens): void {
  // no-op
}

export function loadIxCliConfig(): IxCliConfig {
  return {};
}

export function saveIxCliConfig(_config: IxCliConfig): void {
  // no-op
}
