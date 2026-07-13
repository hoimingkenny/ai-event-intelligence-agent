# Code Review: Enterprise HTTP Proxy (off-by-default)

- **Branch:** `feat/enterprise-http-proxy` → `main`
- **Commits:** pre-merge; single feature branch
- **Date:** 2026-07-13
- **Reviewer:** <name / Claude>

## Summary of change

Adds an optional, off-by-default enterprise HTTP proxy: when `HTTP_PROXY_ENABLED=true`, all undici/`fetch` egress in the process (article HTTP extraction, embeddings, MiniMax LLM since the OpenAI SDK uses fetch, RSS-parser and Playwright remain out of scope) routes through an undici `EnvHttpProxyAgent` installed globally at startup. Behavior is gated by an explicit flag (defaults to `false`), reads `HTTP_PROXY` / `HTTPS_PROXY` (both required when enabled) and `NO_PROXY` (honored; defaults to `localhost,127.0.0.1,::1` so local services like Ollama stay direct), and fails loud at process start if the flag is on but a required URL is missing.

Surfacing file (the helper's public config shape):

```1:17:src/config/http-proxy.ts
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
```

Wired in once, at module load, after `dotenv/config`:

```1:5:src/config/env.ts
import 'dotenv/config';
import { installHttpProxyFromEnv } from './http-proxy.js';

installHttpProxyFromEnv();
```

Net diff: `package.json` (+1 dep), `src/config/http-proxy.ts` (new, ~120 lines), `src/config/env.ts` (3 lines), `.env.example` (10 lines + comments), `tests/http-proxy.test.ts` (new).

## Behaviour changes

- New env vars (all defaulted off / empty): `HTTP_PROXY_ENABLED`, `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`.
- New dependency: `undici ^6.27.0`. Was already in `node_modules` transitively; this promotes it to a direct dep so the API surface we depend on (`EnvHttpProxyAgent`, `setGlobalDispatcher`) is stable.
- New side-effect in `src/config/env.ts`: imports `http-proxy.js` and runs `installHttpProxyFromEnv()` at module load. With `HTTP_PROXY_ENABLED` unset/`false` (existing behaviour for every contributor's `.env`), this is a no-op — `setGlobalDispatcher` is not called.
- When enabled: writes `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` into `process.env` and installs a global undici dispatcher. Subsequent `fetch(...)` calls in the same process inherit the proxy. Also emits an info log (credentials redacted — `http://user:pass@host` → `http://host`).

## Risks and concerns

1. **Side effect in `env.ts` import.** Any script or test that imports `src/config/env.js` will now also run `installHttpProxyFromEnv()`. Mitigations: (a) the default path is a no-op; (b) tests that do want to trigger the proxy pass `HTTP_PROXY_ENABLED=true` themselves; (c) helper takes hooks (`setGlobalDispatcher`, `logInfo`, `env`) so callers can swap behavior. Not considered high-risk for the existing test suite — every `env`-importing test still passes.

2. **`EnvHttpProxyAgent` is marked experimental by undici.** Node emits `[UNDICI-EHPA] Warning: EnvHttpProxyAgent is experimental, expect them to change at any time.` Construction site only; harmless. Follow-up: if undici stabilises, the warning goes away on its own. If it changes shape, the helper is small and easy to swap.

3. **Missing proxy URL is a hard process-start error.** An enterprise operator who flips the flag but forgets to set `HTTPS_PROXY` (or has it in shell but not `.env`) will see startup fail. This is the desired behavior for "default false / loud on misconfig" — but worth noting in release notes so it's not mistaken for a regression.

4. **Out-of-scope egress.** RSS fetches (`rss-parser` uses Node's `http`/`https`, not undici) and Playwright do not go through the proxy in this branch. If enterprise requires those proxied too, add separate follow-ups (e.g. Playwright `proxy` launch option, custom `rss-parser` HTTP agent). Tracked in Follow-ups.

5. **Global dispatcher is process-wide.** Matches `EnvHttpProxyAgent`'s design and the requested "use undici specifically" — there's no way to scope this per-request without per-call `dispatcher` plumbing, which is the larger surface I deliberately avoided. Acceptable given the off-by-default flag and explicit one-line install.

6. **Credential logging.** Mitigated by `sanitizeProxyUrl` in the helper (strips userinfo before logging). Covered by a unit test (`redacts userinfo from logged URLs`).

## Test evidence

- `npm install` — clean.
- `npm run check` — passes (`tsc --noEmit`, no errors).
- `npm test` — 230 pass / 4 skip / **2 fail** (`tests/llmHelpers.test.ts`) that are pre-existing on `main` (network-dependent; sandbox cannot resolve `api.minimax.io`). Confirmed by checking out `main`, stashing, and re-running — same 2 failures, same `getaddrinfo ENOTFOUND api.minimax.io` cause. Not caused by this branch.
- `npm test -- tests/http-proxy.test.ts` — 10 / 10 pass, covering:
  - truthy/falsy parsing of `HTTP_PROXY_ENABLED` (whitespace-insensitive)
  - default disabled path (no dispatcher call, no env write, no log)
  - `HTTP_PROXY` empty → throws (fail-loud)
  - `HTTPS_PROXY` empty → throws
  - full enable path: dispatcher called once, `process.env` populated, NO_PROXY default applied, info log emitted
  - explicit `NO_PROXY` honored over the default
  - userinfo redaction in logged URLs
  - `installHttpProxyFromEnv` reads from the `env` hook without touching real `process.env`

## Follow-ups

- RSS-parser and Playwright proxy support (out of scope here; will need a separate config or browser launch option).
- A short **Operator note** in `docs/engineering-notes/` once we ship the first enterprise install (proxy URL conventions, NO_PROXY gotchas).
- If undici promotes `EnvHttpProxyAgent` out of experimental, drop the warning capture from CI logs if it becomes noisy.

## Verdict

**Approve.** Small, isolated, off-by-default, fail-loud, fully unit-tested, and surgically avoids dragging RSS/Playwright into a follow-on scope. The two pre-existing failing tests in `llmHelpers.test.ts` are unrelated (network sandbox) and reproduce on `main`.
