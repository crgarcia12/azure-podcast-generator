#!/usr/bin/env node
// Liliput single-container launcher.
//
// Inside the container we run three processes:
//   1. Express API on 127.0.0.1:5001 (internal)
//   2. Next.js standalone server on 127.0.0.1:3000 (internal)
//   3. A tiny HTTP proxy on 0.0.0.0:$PORT (default 8080) — the public face.
//
// Why a proxy? Liliput's gateway nginx strips the dev prefix
// (e.g. /dev/<owner>/<repo>/<task>) from the incoming URL before the request
// reaches us, but Next.js is built with `basePath` set to that prefix, so
// it expects to *see* the prefix on every request. The proxy reads the
// X-Forwarded-Prefix header that nginx sets, re-prepends it to req.url,
// and forwards to the Next.js server. Result: Next.js routing works as
// designed, asset URLs already include the prefix in the HTML, and the
// browser is happy.

import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// In the container the layout is:
//   /app/launcher.mjs   ← this file
//   /app/api/dist/index.js
//   /app/web/server.js
const APP_ROOT = __dirname;

const PUBLIC_PORT = parseInt(process.env.PORT || '8080', 10);
const API_PORT = parseInt(process.env.INTERNAL_API_PORT || '5001', 10);
const WEB_PORT = parseInt(process.env.INTERNAL_WEB_PORT || '3000', 10);
const FALLBACK_PREFIX = (process.env.BASE_PATH || '').replace(/\/$/, '');

let shuttingDown = false;

function log(msg, extra = '') {
  process.stdout.write(`[liliput-launcher] ${msg}${extra ? ' ' + extra : ''}\n`);
}

function err(msg, extra = '') {
  process.stderr.write(`[liliput-launcher] ${msg}${extra ? ' ' + extra : ''}\n`);
}

function spawnChild(name, command, args, opts) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: false,
    ...opts,
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }
    err(`${name} exited`, `code=${code} signal=${signal}`);
    shutdown(code ?? 1);
  });

  child.on('error', (e) => {
    err(`${name} failed to spawn`, String(e));
    shutdown(1);
  });

  return child;
}

const NODE_BIN = process.execPath;

const api = spawnChild('api', NODE_BIN, ['dist/index.js'], {
  cwd: resolve(APP_ROOT, 'api'),
  env: {
    ...process.env,
    PORT: String(API_PORT),
    HOSTNAME: '127.0.0.1',
  },
});

const web = spawnChild('web', NODE_BIN, ['server.js'], {
  cwd: resolve(APP_ROOT, 'web'),
  env: {
    ...process.env,
    PORT: String(WEB_PORT),
    HOSTNAME: '127.0.0.1',
  },
});

// Strip the dev-prefix from req.url (whether it arrived prefixed or not — Liliput's
// nginx normally strips it, but keep the path stable for both cases).
function stripPrefix(rawUrl, prefix) {
  if (!prefix) return rawUrl;
  if (rawUrl === prefix) return '/';
  if (rawUrl === prefix + '/') return '/';
  if (rawUrl.startsWith(prefix + '/')) return rawUrl.slice(prefix.length);
  if (rawUrl.startsWith(prefix + '?')) return '/' + rawUrl.slice(prefix.length + 1).replace(/^\?/, '?');
  return rawUrl;
}

// Decide whether a request goes to the API (Express on 5001) or the Web (Next.js on 3000).
// API routes: /api/* and /health (matches Express + the existing Next.js dev rewrites).
function pickUpstream(unprefixedPath) {
  if (
    unprefixedPath === '/api' ||
    unprefixedPath.startsWith('/api/') ||
    unprefixedPath.startsWith('/api?') ||
    unprefixedPath === '/health' ||
    unprefixedPath.startsWith('/health?')
  ) {
    return { name: 'api', port: API_PORT, path: unprefixedPath };
  }
  // Web requests must keep the prefix because Next.js is built with basePath.
  return { name: 'web', port: WEB_PORT, path: null /* filled below */ };
}

function resolveTarget(req) {
  const rawPrefix = (req.headers['x-forwarded-prefix'] || FALLBACK_PREFIX || '').toString();
  const prefix = rawPrefix.replace(/\/+$/, '');
  const original = req.url || '/';
  const unprefixed = stripPrefix(original, prefix);
  const upstream = pickUpstream(unprefixed);

  if (upstream.name === 'api') {
    return upstream;
  }

  // Web upstream: Next.js was built with basePath = prefix, so requests must be
  // prefixed. Avoid trailing-slash on the bare prefix to dodge Next.js's
  // `trailingSlash: false` 308 redirect on the root page.
  if (!prefix) {
    upstream.path = original;
  } else if (unprefixed === '/') {
    upstream.path = prefix;
  } else {
    upstream.path = prefix + unprefixed;
  }
  return upstream;
}

const proxy = http.createServer((req, res) => {
  const target = resolveTarget(req);
  const proxyReq = http.request(
    {
      host: '127.0.0.1',
      port: target.port,
      path: target.path,
      method: req.method,
      headers: req.headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on('error', (e) => {
    err('upstream error', `${target.name} ${req.method} ${target.path} ${e.code || e.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    }
    res.end(`Bad gateway (${target.name} upstream unavailable)`);
  });

  req.on('aborted', () => proxyReq.destroy());
  req.pipe(proxyReq);
});

proxy.on('upgrade', (req, socket, head) => {
  const target = resolveTarget(req);
  const proxyReq = http.request({
    host: '127.0.0.1',
    port: target.port,
    path: target.path,
    method: req.method,
    headers: req.headers,
  });

  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    socket.write(
      `HTTP/${proxyRes.httpVersion} ${proxyRes.statusCode} ${proxyRes.statusMessage}\r\n` +
        Object.entries(proxyRes.headers)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
          .join('\r\n') +
        '\r\n\r\n',
    );
    if (proxyHead && proxyHead.length) socket.write(proxyHead);
    proxySocket.pipe(socket).pipe(proxySocket);
  });

  proxyReq.on('error', () => socket.destroy());
  proxyReq.end();
});

proxy.listen(PUBLIC_PORT, '0.0.0.0', () => {
  log(
    `proxy listening`,
    `0.0.0.0:${PUBLIC_PORT} -> next:${WEB_PORT} (api:${API_PORT}) base="${FALLBACK_PREFIX}"`,
  );
});

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('shutting down');
  for (const child of [api, web]) {
    if (child && !child.killed) {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
    }
  }
  proxy.close(() => process.exit(code));
  setTimeout(() => process.exit(code), 5000).unref();
}

process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));
