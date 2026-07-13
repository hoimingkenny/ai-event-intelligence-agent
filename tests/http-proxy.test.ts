import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyProxyConfig,
  installHttpProxyFromEnv,
  readProxyConfigFromEnv,
  type ProxyConfig,
  type ProxyInstallHooks,
} from '../src/config/http-proxy.js';

function makeLogger() {
  return vi.fn();
}

function captureDispatcher() {
  const calls: { agent: unknown; env: NodeJS.ProcessEnv }[] = [];
  const setGlobalDispatcher = vi.fn((agent: unknown) => {
    calls.push({
      agent,
      // Snapshot what EnvHttpProxyAgent will read. It pulls from process.env,
      // which applyProxyConfig populates just before this call.
      env: {
        HTTP_PROXY: process.env.HTTP_PROXY,
        HTTPS_PROXY: process.env.HTTPS_PROXY,
        NO_PROXY: process.env.NO_PROXY,
      },
    });
  }) as unknown as ProxyInstallHooks['setGlobalDispatcher'];
  return { setGlobalDispatcher, calls };
}

const ENV_KEYS = ['HTTP_PROXY_ENABLED', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY'] as const;

describe('readProxyConfigFromEnv', () => {
  it('treats default env as disabled', () => {
    const cfg = readProxyConfigFromEnv({});
    expect(cfg.enabled).toBe(false);
    expect(cfg.httpProxy).toBe('');
    expect(cfg.httpsProxy).toBe('');
    expect(cfg.noProxy).toBe('');
  });

  it('treats truthy strings as enabled', () => {
    for (const value of ['true', 'TRUE', '1', 'yes', 'YES']) {
      const cfg = readProxyConfigFromEnv({ HTTP_PROXY_ENABLED: value });
      expect(cfg.enabled, value).toBe(true);
    }
    for (const value of ['false', 'no', '', '0']) {
      const cfg = readProxyConfigFromEnv({ HTTP_PROXY_ENABLED: value });
      expect(cfg.enabled, value).toBe(false);
    }
  });

  it('trims whitespace from URL fields', () => {
    const cfg = readProxyConfigFromEnv({
      HTTP_PROXY_ENABLED: 'true',
      HTTP_PROXY: '  http://p.test:8080  ',
      HTTPS_PROXY: '  http://p.test:8443  ',
      NO_PROXY: '  localhost,127.0.0.1  ',
    });
    expect(cfg.httpProxy).toBe('http://p.test:8080');
    expect(cfg.httpsProxy).toBe('http://p.test:8443');
    expect(cfg.noProxy).toBe('  localhost,127.0.0.1  ');
  });
});

describe('applyProxyConfig', () => {
  beforeEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
  });

  it('does nothing when disabled', () => {
    const set = captureDispatcher();
    const logger = makeLogger();
    const cfg: ProxyConfig = {
      enabled: false,
      httpProxy: 'http://p.test:8080',
      httpsProxy: 'http://p.test:8443',
      noProxy: '',
    };
    const result = applyProxyConfig(cfg, { setGlobalDispatcher: set.setGlobalDispatcher, logInfo: logger as never });
    expect(result.installed).toBe(false);
    expect(set.setGlobalDispatcher).not.toHaveBeenCalled();
    expect(logger).not.toHaveBeenCalled();
    expect(process.env.HTTP_PROXY).toBeUndefined();
  });

  it('refuses to start when enabled but HTTP_PROXY is empty', () => {
    const set = captureDispatcher();
    const logger = makeLogger();
    expect(() =>
      applyProxyConfig(
        { enabled: true, httpProxy: '', httpsProxy: 'http://p.test:8443', noProxy: '' },
        { setGlobalDispatcher: set.setGlobalDispatcher, logInfo: logger as never }
      )
    ).toThrow(/HTTP_PROXY is empty/);
    expect(set.setGlobalDispatcher).not.toHaveBeenCalled();
  });

  it('refuses to start when enabled but HTTPS_PROXY is empty', () => {
    const set = captureDispatcher();
    expect(() =>
      applyProxyConfig(
        { enabled: true, httpProxy: 'http://p.test:8080', httpsProxy: '', noProxy: '' },
        { setGlobalDispatcher: set.setGlobalDispatcher, logInfo: makeLogger() as never }
      )
    ).toThrow(/HTTPS_PROXY is empty/);
  });

  it('installs the dispatcher and applies NO_PROXY default when omitted', () => {
    const set = captureDispatcher();
    const logger = makeLogger();
    const result = applyProxyConfig(
      {
        enabled: true,
        httpProxy: 'http://p.test:8080',
        httpsProxy: 'http://p.test:8443',
        noProxy: '',
      },
      { setGlobalDispatcher: set.setGlobalDispatcher, logInfo: logger as never }
    );
    expect(result.installed).toBe(true);
    expect(set.setGlobalDispatcher).toHaveBeenCalledTimes(1);
    expect(set.calls[0].env).toEqual({
      HTTP_PROXY: 'http://p.test:8080',
      HTTPS_PROXY: 'http://p.test:8443',
      NO_PROXY: 'localhost,127.0.0.1,::1',
    });
    expect(process.env.HTTP_PROXY).toBe('http://p.test:8080');
    expect(process.env.NO_PROXY).toBe('localhost,127.0.0.1,::1');
    expect(logger).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({
        httpProxy: 'http://p.test:8080',
        httpsProxy: 'http://p.test:8443',
        noProxy: 'localhost,127.0.0.1,::1',
      }),
      expect.stringContaining('Enterprise HTTP proxy enabled')
    );
  });

  it('honors an explicit NO_PROXY value', () => {
    const set = captureDispatcher();
    applyProxyConfig(
      {
        enabled: true,
        httpProxy: 'http://p.test:8080',
        httpsProxy: 'http://p.test:8443',
        noProxy: 'internal.corp',
      },
      { setGlobalDispatcher: set.setGlobalDispatcher, logInfo: makeLogger() as never }
    );
    expect(set.calls[0].env).toEqual({
      HTTP_PROXY: 'http://p.test:8080',
      HTTPS_PROXY: 'http://p.test:8443',
      NO_PROXY: 'internal.corp',
    });
    expect(process.env.NO_PROXY).toBe('internal.corp');
  });

  it('redacts userinfo from logged URLs', () => {
    const set = captureDispatcher();
    const logger = makeLogger();
    applyProxyConfig(
      {
        enabled: true,
        httpProxy: 'http://alice:secret@p.test:8080',
        httpsProxy: 'http://alice:secret@p.test:8443',
        noProxy: '',
      },
      { setGlobalDispatcher: set.setGlobalDispatcher, logInfo: logger as never }
    );
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({
        httpProxy: 'http://p.test:8080',
        httpsProxy: 'http://p.test:8443',
      }),
      expect.any(String)
    );
  });
});

describe('installHttpProxyFromEnv', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('honors the env source passed via the hook', () => {
    const set = captureDispatcher();
    const result = installHttpProxyFromEnv({
      env: {
        HTTP_PROXY_ENABLED: 'true',
        HTTP_PROXY: 'http://p.test:8080',
        HTTPS_PROXY: 'http://p.test:8443',
      },
      setGlobalDispatcher: set.setGlobalDispatcher,
      logInfo: makeLogger() as never,
    });
    expect(result.installed).toBe(true);
    expect(set.setGlobalDispatcher).toHaveBeenCalledTimes(1);
    // process.env was updated to the resolved dispatcher env.
    expect(process.env.HTTP_PROXY).toBe('http://p.test:8080');
    expect(process.env.HTTPS_PROXY).toBe('http://p.test:8443');
    expect(process.env.NO_PROXY).toBe('localhost,127.0.0.1,::1');
  });
});
