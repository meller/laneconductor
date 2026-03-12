// conductor/collector-client.mjs
import os from 'os';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export function getUserToken() {
  const authFile = join(os.homedir(), '.laneconductor-auth.json');
  if (existsSync(authFile)) {
    try {
      const authData = JSON.parse(readFileSync(authFile, 'utf8'));
      return authData.token || null;
    } catch (e) {
      console.warn('[Warning] Failed to read ~/.laneconductor-auth.json', e.message);
    }
  }
  return null;
}

export async function get(collectorUrl, token, path, timeoutMs = 10000) {
  if (!collectorUrl) return {};
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const url = `${collectorUrl}${path}`;

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const r = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(id);
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return r.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Fetch timeout after ${timeoutMs}ms: ${url}`);
    throw err;
  }
}

export async function post(collectorUrl, token, path, body, timeoutMs = 15000) {
  if (!collectorUrl) return {};
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const url = `${collectorUrl}${path}`;

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(id);
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return r.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`POST timeout after ${timeoutMs}ms: ${url}`);
    throw err;
  }
}

export async function patch(collectorUrl, token, path, body, timeoutMs = 15000) {
  if (!collectorUrl) return {};
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const url = `${collectorUrl}${path}`;

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const r = await fetch(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(id);
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return r.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`PATCH timeout after ${timeoutMs}ms: ${url}`);
    throw err;
  }
}

export async function del(collectorUrl, token, path, body = {}, timeoutMs = 10000) {
  if (!collectorUrl) return {};
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const url = `${collectorUrl}${path}`;

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const r = await fetch(url, {
      method: 'DELETE',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(id);
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return r.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`DELETE timeout after ${timeoutMs}ms: ${url}`);
    throw err;
  }
}

export function resolveToken(collector, envKey) {
  return process.env[envKey] ?? collector.machine_token ?? collector.token ?? null;
}
