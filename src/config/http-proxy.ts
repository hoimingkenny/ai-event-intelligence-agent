import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { logInfo } from '../utils/logger.js';

export interface ProxyConfig {
  /** Mirrors HTTP_PROXY_ENABLED. Default off. */
  enabled: boolean;
  /** Mirrors HTTP_PROXY. Required when enabled. */
  httpProxy: string;
  /** Mirrors HTTPS_PROXY. Required when enabled. */
  httpsProxy: string;
  /**
   * Mirrors NO_PROXY. When null/undefined/empty and enabled, defaults to
   * localhost so local HTTP services (e.g. Ollama) stay direct.
   */
  noProxy: string | null | undefined;
}

export interface ProxyInstallHooks {
  /** Test seam: replace undici's setGlobalDispatcher. */
  setGlobalDispatcher?: (agent: EnvHttpProxyAgent) => void;
  /** Test seam: env source for `installHttpProxyFromEnv`. */
  env?: NodeJS.ProcessEnv;
  /** Test seam: logger. */
  logInfo?: typeof logInfo;
}

const DEFAULT_NO_PROXY = 'localhost,127.0.0.1,::1';
const ENABLED_TRUTHY = new Set(['true', '1', 'yes']);

function sanitizeProxyUrl(value: string): string {
  // Strip userinfo (http://user:pass@host:port) so logs/leaks can't expose creds.
  return value.replace(/(^[a-z]+:\/\/)[^@/]+@/i, '$1');
}

export function readProxyConfigFromEnv(env: NodeJS.ProcessEnv): ProxyConfig {
  const rawEnabled = (env.HTTP_PROXY_ENABLED ?? '').trim().toLowerCase();
  return {
    enabled: ENABLED_TRUTHY.has(rawEnabled),
    httpProxy: (env.HTTP_PROXY ?? '').trim(),
    httpsProxy: (env.HTTPS_PROXY ?? '').trim(),
    noProxy: env.NO_PROXY ?? '',
  };
}

export function resolveProxyConfig(config: ProxyConfig):
  | { dispatcherEnv: Record<string, string> }
  | null {
  if (!config.enabled) return null;
  if (!config.httpProxy) {
    throw new Error(
      'HTTP_PROXY_ENABLED=true but HTTP_PROXY is empty; refusing to start.'
    );
  }
  if (!config.httpsProxy) {
    throw new Error(
      'HTTP_PROXY_ENABLED=true but HTTPS_PROXY is empty; refusing to start.'
    );
  }
  const noProxy =
    config.noProxy && config.noProxy.trim().length > 0
      ? config.noProxy
      : DEFAULT_NO_PROXY;
  return {
    dispatcherEnv: {
      HTTP_PROXY: config.httpProxy,
      HTTPS_PROXY: config.httpsProxy,
      NO_PROXY: noProxy,
    },
  };
}

export function applyProxyConfig(
  config: ProxyConfig,
  hooks: ProxyInstallHooks = {}
): { installed: boolean; dispatcherEnv: Record<string, string> } {
  const log = hooks.logInfo ?? logInfo;

  const resolved = resolveProxyConfig(config);
  if (!resolved) {
    return { installed: false, dispatcherEnv: {} };
  }

  const env = resolved.dispatcherEnv;
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }

  const dispatcher = hooks.setGlobalDispatcher ?? setGlobalDispatcher;
  // EnvHttpProxyAgent reads HTTP_PROXY / HTTPS_PROXY / NO_PROXY from
  // process.env, hence the writes above.
  dispatcher(new EnvHttpProxyAgent());

  log(
    {
      httpProxy: sanitizeProxyUrl(env.HTTP_PROXY),
      httpsProxy: sanitizeProxyUrl(env.HTTPS_PROXY),
      noProxy: env.NO_PROXY,
    },
    'Enterprise HTTP proxy enabled via undici global dispatcher.'
  );

  return { installed: true, dispatcherEnv: { ...env } };
}

export function installHttpProxyFromEnv(hooks: ProxyInstallHooks = {}): {
  installed: boolean;
} {
  const env = hooks.env ?? process.env;
  const cfg = readProxyConfigFromEnv(env);
  return applyProxyConfig(cfg, hooks);
}
