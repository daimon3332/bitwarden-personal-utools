const { execFile } = require("node:child_process");
const crypto = require("node:crypto");

const STORAGE_KEY = "bitwarden-utools-settings";
const CACHE_KEY = "bitwarden-utools-cache";
const CACHE_VERSION = 2;
const DEFAULT_SERVER_URL = "https://vault.bitwarden.com";
let sessionKey = "";
let itemCache = [];
let folderCache = new Map();
let cacheLoadedAt = 0;
let configuredServerUrl = "";

function getStorage() {
  if (typeof utools !== "undefined" && utools.dbCryptoStorage) return utools.dbCryptoStorage;
  if (typeof utools !== "undefined" && utools.dbStorage) return utools.dbStorage;
  return null;
}

function hasCryptoStorage() {
  return typeof utools !== "undefined" && Boolean(utools.dbCryptoStorage);
}

function stripAnsi(text) {
  return String(text || "")
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, "")
    .replace(/\[\d+[A-Z]/g, "");
}

function redact(text) {
  return stripAnsi(text)
    .replace(/BW_CLIENTSECRET=[^\s]+/gi, "BW_CLIENTSECRET=***")
    .replace(/BW_PASSWORD=[^\s]+/gi, "BW_PASSWORD=***")
    .replace(/client_secret[=:]\s*[^\s]+/gi, "client_secret=***")
    .replace(/masterPassword[=:]\s*[^\s]+/gi, "masterPassword=***")
    .replace(/"clientSecret"\s*:\s*"[^"]+"/gi, '"clientSecret":"***"')
    .replace(/"masterPassword"\s*:\s*"[^"]+"/gi, '"masterPassword":"***"');
}

function cleanError(err, stderr, stdout) {
  const detail = redact(stderr || stdout || err?.message || "Bitwarden CLI 执行失败");
  return new Error(detail.trim());
}

function readSettings() {
  const storage = getStorage();
  const value = storage?.getItem(STORAGE_KEY) || {};
  return {
    clientId: value.clientId || "",
    clientSecret: value.clientSecret || "",
    masterPassword: value.masterPassword || "",
    hasMasterPassword: Boolean(value.masterPassword),
    bwPath: value.bwPath || "",
    serverUrl: value.serverUrl || DEFAULT_SERVER_URL,
    customFolderName: value.customFolderName || "",
    saveCredentials: Boolean(value.saveCredentials),
    secureStorage: hasCryptoStorage(),
  };
}

function getSettings() {
  const settings = readSettings();
  return {
    clientId: settings.clientId,
    hasClientSecret: Boolean(settings.clientSecret),
    hasMasterPassword: settings.hasMasterPassword,
    bwPath: settings.bwPath,
    serverUrl: settings.serverUrl || DEFAULT_SERVER_URL,
    customFolderName: settings.customFolderName || "",
    saveCredentials: settings.saveCredentials,
    secureStorage: settings.secureStorage,
  };
}

function normalizeServerUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return DEFAULT_SERVER_URL;
  if (/^https?:\/\//i.test(raw)) return raw.replace(/\/+$/, "");
  return `https://${raw}`.replace(/\/+$/, "");
}

function saveSettings(input) {
  const storage = getStorage();
  if (!storage) return getSettings();
  const existing = readSettings();

  const next = {
    bwPath: String(input?.bwPath || "").trim(),
    serverUrl: normalizeServerUrl(input?.serverUrl || existing.serverUrl || DEFAULT_SERVER_URL),
    customFolderName:
      typeof input?.customFolderName === "string"
        ? input.customFolderName.trim()
        : existing.customFolderName || "",
    saveCredentials: Boolean(input?.saveCredentials),
  };
  if (next.saveCredentials) {
    next.clientId = String(input?.clientId || "").trim() || existing.clientId;
    next.clientSecret = String(input?.clientSecret || "").trim() || existing.clientSecret;
    const incomingPassword = typeof input?.masterPassword === "string" ? input.masterPassword : "";
    next.masterPassword = incomingPassword || existing.masterPassword || "";
  } else {
    next.clientId = "";
    next.clientSecret = "";
    next.masterPassword = "";
  }
  storage.setItem(STORAGE_KEY, next);
  return getSettings();
}

function setCustomFolderName(name) {
  const storage = getStorage();
  const existing = readSettings();
  const next = {
    clientId: existing.clientId,
    clientSecret: existing.clientSecret,
    masterPassword: existing.masterPassword,
    bwPath: existing.bwPath,
    serverUrl: existing.serverUrl || DEFAULT_SERVER_URL,
    saveCredentials: existing.saveCredentials,
    customFolderName: String(name || "").trim(),
  };
  storage?.setItem(STORAGE_KEY, next);
  return getSettings();
}

function readPersistedCache() {
  const storage = getStorage();
  const value = storage?.getItem(CACHE_KEY) || {};
  const items = Array.isArray(value.items) ? value.items : [];
  return {
    items,
    cacheVersion: Number(value.cacheVersion || 1),
    cacheLoadedAt: Number(value.cacheLoadedAt || 0),
  };
}

function writePersistedCache(items) {
  const storage = getStorage();
  cacheLoadedAt = Date.now();
  itemCache = Array.isArray(items) ? items : [];
  if (storage) {
    storage.setItem(CACHE_KEY, {
      cacheVersion: CACHE_VERSION,
      items: itemCache,
      cacheLoadedAt,
    });
  }
  return {
    items: itemCache,
    cacheLoadedAt,
  };
}

function clearPersistedCache() {
  itemCache = [];
  folderCache = new Map();
  cacheLoadedAt = 0;
  const storage = getStorage();
  storage?.setItem(CACHE_KEY, {
    cacheVersion: CACHE_VERSION,
    items: [],
    cacheLoadedAt: 0,
  });
}

function hydrateCache() {
  if (itemCache.length) {
    return { items: itemCache, cacheLoadedAt };
  }
  const cached = readPersistedCache();
  itemCache = cached.items;
  cacheLoadedAt = cached.cacheLoadedAt;
  return cached;
}

function bootstrap() {
  const settings = getSettings();
  const cached = hydrateCache();
  const configured = Boolean(
    settings.clientId && settings.hasClientSecret && settings.hasMasterPassword && settings.saveCredentials,
  );
  return {
    status: configured ? "ready" : "needs-setup",
    configured,
    cacheSize: cached.items.length,
    cacheLoadedAt: cached.cacheLoadedAt,
    secureStorage: settings.secureStorage,
  };
}

function bwPath() {
  return readSettings().bwPath || "bw";
}

function runBw(args, options = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, ...(options.env || {}) };
    if (!options.noSession && sessionKey) env.BW_SESSION = sessionKey;
    const child = execFile(
      bwPath(),
      args,
      {
        env,
        windowsHide: true,
        maxBuffer: 20 * 1024 * 1024,
        timeout: options.timeout || 45000,
      },
      (err, stdout, stderr) => {
        if (err) {
          reject(cleanError(err, stderr, stdout));
          return;
        }
        resolve(String(stdout || "").trim());
      },
    );
    child.stdin?.end();
  });
}

async function configureServer() {
  const serverUrl = normalizeServerUrl(readSettings().serverUrl || DEFAULT_SERVER_URL);
  if (configuredServerUrl === serverUrl) return { ok: true, serverUrl };

  const current = await parseJsonCommand(["status"], { timeout: 12000, noSession: true }).catch(() => null);
  const currentServerUrl = normalizeServerUrl(current?.serverUrl || "");
  if (currentServerUrl === serverUrl) {
    configuredServerUrl = serverUrl;
    return { ok: true, serverUrl };
  }

  async function logoutForServerSwitch() {
    sessionKey = "";
    await runBw(["logout"], { timeout: 30000, noSession: true }).catch(() => "");
  }

  if (current?.status && current.status !== "unauthenticated") {
    await logoutForServerSwitch();
  }

  try {
    await runBw(["config", "server", serverUrl], { timeout: 30000, noSession: true });
  } catch (err) {
    if (/logout required before server config update/i.test(err.message || "")) {
      await logoutForServerSwitch();
      await runBw(["config", "server", serverUrl], { timeout: 30000, noSession: true });
    } else {
      throw err;
    }
  }

  configuredServerUrl = serverUrl;
  sessionKey = "";
  clearPersistedCache();
  return { ok: true, serverUrl };
}

async function parseJsonCommand(args, options) {
  const out = await runBw(args, options);
  try {
    return JSON.parse(out || "null");
  } catch (err) {
    throw new Error(`Bitwarden CLI 返回了非 JSON 内容：${redact(out).slice(0, 300)}`);
  }
}

async function status() {
  return parseJsonCommand(["status"], { timeout: 12000 });
}

async function ensureReady() {
  const settings = readSettings();
  let current = await status().catch(() => ({ status: "unauthenticated" }));

  if (current.status === "unauthenticated" && settings.clientId && settings.clientSecret) {
    await loginWithApiKey({
      clientId: settings.clientId,
      clientSecret: settings.clientSecret,
    });
    current = await status();
  }

  if (current.status === "locked" && settings.masterPassword) {
    await unlock(settings.masterPassword);
    current = await status();
  }

  return current;
}

async function ensureSession() {
  if (sessionKey) return { ok: true };

  const settings = readSettings();
  if (!settings.masterPassword) {
    throw new Error("未保存主密码，无法后台解锁。请打开“设置”填写主密码并保存配置。");
  }

  try {
    await unlock(settings.masterPassword);
    return { ok: true };
  } catch (firstError) {
    if (settings.clientId && settings.clientSecret) {
      await loginWithApiKey({
        clientId: settings.clientId,
        clientSecret: settings.clientSecret,
      });
      await unlock(settings.masterPassword);
      return { ok: true };
    }
    throw firstError;
  }
}

async function loginWithApiKey(input) {
  await configureServer();
  const settings = readSettings();
  const clientId = String(input?.clientId || settings.clientId || "").trim();
  const clientSecret = String(input?.clientSecret || settings.clientSecret || "").trim();
  if (!clientId || !clientSecret) {
    throw new Error("请填写 Client ID 和 Client Secret。");
  }

  const current = await status().catch(() => null);
  if (current?.status && current.status !== "unauthenticated") {
    return { ok: true, message: `CLI 已登录：${current.userEmail || current.status}` };
  }

  const out = await runBw(["login", "--apikey"], {
    env: {
      BW_CLIENTID: clientId,
      BW_CLIENTSECRET: clientSecret,
    },
    timeout: 60000,
  });
  return { ok: true, message: out || "API Key 登录完成。" };
}

async function unlock(masterPassword) {
  await configureServer();
  const password = String(masterPassword || "");
  if (!password) throw new Error("主密码不能为空。");
  const out = await runBw(["unlock", "--passwordenv", "BW_PASSWORD", "--raw"], {
    env: { BW_PASSWORD: password },
    timeout: 60000,
  });
  if (!out || out.includes(" ")) throw new Error("未能获取 BW_SESSION，请确认主密码是否正确。");
  sessionKey = out.trim();
  itemCache = [];
  folderCache = new Map();
  cacheLoadedAt = 0;
  return { ok: true };
}

async function sync() {
  await configureServer();
  await ensureSession();
  const out = await runBw(["sync"], { timeout: 90000 });
  itemCache = [];
  folderCache = new Map();
  cacheLoadedAt = 0;
  const items = await loadItems(true);
  return {
    ok: true,
    message: out || "同步完成。",
    cacheSize: items.length,
    cacheLoadedAt,
  };
}

function normalizeUri(uri) {
  if (!uri) return "";
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(uri) ? uri : `https://${uri}`;
    const url = new URL(withScheme);
    return url.hostname || uri;
  } catch {
    return uri;
  }
}

function safeItem(item) {
  const uris = Array.isArray(item?.login?.uris)
    ? item.login.uris.map((u) => u?.uri).filter(Boolean)
    : [];
  const uriHosts = uris.map(normalizeUri).filter(Boolean);
  const folderName = item?.folderId ? folderCache.get(item.folderId) || "" : "";
  return {
    id: item?.id || "",
    name: item?.name || "",
    username: item?.login?.username || "",
    uris,
    uriHosts,
    uriText: uriHosts.slice(0, 3).join(", "),
    folderId: item?.folderId || null,
    folderName,
    type: item?.type,
    revisionDate: item?.revisionDate || "",
    password: item?.login?.password || "",
    totpSecret: item?.login?.totp || "",
    hasPassword: Boolean(item?.login?.password),
    hasTotp: Boolean(item?.login?.totp),
  };
}

async function loadFolders(force = false) {
  if (!force && folderCache.size) return folderCache;
  const folders = await parseJsonCommand(["list", "folders"]);
  folderCache = new Map();
  for (const folder of Array.isArray(folders) ? folders : []) {
    if (folder?.id) folderCache.set(folder.id, folder.name || "");
  }
  return folderCache;
}

async function loadItems(force = false) {
  if (!force) {
    return hydrateCache().items;
  }
  await ensureSession();
  await loadFolders(force);
  const items = await parseJsonCommand(["list", "items"]);
  const safeItems = (Array.isArray(items) ? items : []).map(safeItem).filter((item) => item.id);
  return writePersistedCache(safeItems).items;
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[\s,，/\\|]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function levenshtein(a, b, max = 3) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      rowMin = Math.min(rowMin, curr[j]);
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

function isSubsequence(needle, haystack) {
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) i++;
    if (i >= needle.length) return true;
  }
  return false;
}

function fieldScore(term, field, weight) {
  const value = String(field || "").toLowerCase();
  if (!term || !value) return 0;
  if (value === term) return 100 * weight;
  if (value.startsWith(term)) return 80 * weight;
  if (value.includes(term)) return 60 * weight;
  const words = tokenize(value);
  if (words.some((word) => word.startsWith(term))) return 54 * weight;
  if (term.length >= 3 && isSubsequence(term, value)) return 25 * weight;
  const maxDistance = term.length <= 4 ? 1 : 2;
  if (words.some((word) => levenshtein(term, word, maxDistance) <= maxDistance)) return 18 * weight;
  return 0;
}

function scoreItem(item, query, mode) {
  const terms = tokenize(query);
  if (!terms.length) return 1;

  let total = 0;
  for (const term of terms) {
    let best = 0;
    if (mode === "all" || mode === "name") {
      best = Math.max(best, fieldScore(term, item.name, 1.4));
    }
    if (mode === "all") {
      best = Math.max(best, fieldScore(term, item.username, 1.0));
      best = Math.max(best, fieldScore(term, item.folderName, 0.75));
      for (const uri of [...(item.uriHosts || []), ...(item.uris || [])]) {
        best = Math.max(best, fieldScore(term, uri, 1.15));
      }
    }
    if (mode === "url") {
      for (const uri of [...(item.uriHosts || []), ...(item.uris || [])]) {
        best = Math.max(best, fieldScore(term, uri, 1.4));
      }
    }
    if (mode === "folder") {
      best = Math.max(best, fieldScore(term, item.folderName, 1.7));
      best = Math.max(best, fieldScore(term, item.name, 0.9));
    }
    if (mode === "customFolder") {
      best = Math.max(best, fieldScore(term, item.name, 1.4));
      best = Math.max(best, fieldScore(term, item.username, 1.0));
      for (const uri of [...(item.uriHosts || []), ...(item.uris || [])]) {
        best = Math.max(best, fieldScore(term, uri, 1.15));
      }
    }
    if (best <= 0) return 0;
    total += best;
  }
  return total;
}

async function search(input = {}) {
  const mode = input.mode || "folder";
  const query = String(input.query || "").trim();
  const limit = Math.max(1, Math.min(Number(input.limit) || 60, 100));

  let items = await loadItems(Boolean(input.force));
  if (mode === "customFolder") {
    const customFolderName = String(input.customFolderName || readSettings().customFolderName || "").trim().toLowerCase();
    if (customFolderName) {
      items = items.filter((item) => String(item.folderName || "").trim().toLowerCase() === customFolderName);
    } else {
      items = [];
    }
  }

  const ranked = items
    .map((item) => ({ item, score: scoreItem(item, query, mode) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || String(a.item.name).localeCompare(String(b.item.name), "zh-CN"))
    .slice(0, limit)
    .map((entry) => publicItem(entry.item));

  return {
    items: ranked,
    cacheSize: itemCache.length,
    cacheLoadedAt,
  };
}

function publicItem(item) {
  return {
    id: item.id,
    name: item.name,
    username: item.username,
    uris: item.uris,
    uriHosts: item.uriHosts,
    uriText: item.uriText,
    folderId: item.folderId,
    folderName: item.folderName,
    type: item.type,
    revisionDate: item.revisionDate,
    hasPassword: item.hasPassword,
    hasTotp: item.hasTotp,
  };
}

function cachedItemById(id) {
  return hydrateCache().items.find((item) => item.id === id);
}

async function getRawValue(kind, id) {
  if (!id) throw new Error("缺少条目 id。");
  await ensureSession();
  try {
    return await runBw(["get", kind, id], { timeout: 30000 });
  } catch (err) {
    sessionKey = "";
    await ensureSession();
    return runBw(["get", kind, id], { timeout: 30000 });
  }
}

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = String(input || "")
    .toUpperCase()
    .replace(/=+$/g, "")
    .replace(/[\s-]/g, "");
  let bits = "";
  for (const ch of clean) {
    const value = alphabet.indexOf(ch);
    if (value < 0) continue;
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function parseTotpSecret(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  if (/^steam:\/\//i.test(raw)) {
    return {
      secret: raw.replace(/^steam:\/\//i, ""),
      algorithm: "sha1",
      digits: 5,
      period: 30,
      steam: true,
    };
  }

  if (/^otpauth:\/\//i.test(raw)) {
    const url = new URL(raw);
    const algorithm = (url.searchParams.get("algorithm") || "sha1").toLowerCase().replace("sha", "sha");
    return {
      secret: url.searchParams.get("secret") || "",
      algorithm: ["sha1", "sha256", "sha512"].includes(algorithm) ? algorithm : "sha1",
      digits: Number(url.searchParams.get("digits") || 6),
      period: Number(url.searchParams.get("period") || 30),
      steam: false,
    };
  }

  return {
    secret: raw,
    algorithm: "sha1",
    digits: 6,
    period: 30,
    steam: false,
  };
}

function generateTotp(value, now = Date.now()) {
  const config = parseTotpSecret(value);
  if (!config?.secret) return "";
  const key = base32Decode(config.secret);
  if (!key.length) return "";
  const period = Number.isFinite(config.period) && config.period > 0 ? config.period : 30;
  const counter = Math.floor(now / 1000 / period);
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buffer.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac(config.algorithm, key).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const codeInt =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  if (config.steam) {
    const chars = "23456789BCDFGHJKMNPQRTVWXY";
    let valueInt = codeInt;
    let code = "";
    for (let i = 0; i < 5; i++) {
      code += chars[valueInt % chars.length];
      valueInt = Math.floor(valueInt / chars.length);
    }
    return code;
  }

  const digits = Number.isFinite(config.digits) && config.digits > 0 ? Math.min(config.digits, 10) : 6;
  return String(codeInt % 10 ** digits).padStart(digits, "0");
}

function copyText(text, emptyMessage = "没有可复制的内容。") {
  if (!String(text || "").trim()) throw new Error(emptyMessage);
  if (typeof utools !== "undefined" && utools.copyText) {
    const ok = utools.copyText(text);
    if (!ok) throw new Error("复制到剪贴板失败。");
  } else {
    const { clipboard } = require("electron");
    clipboard.writeText(text);
  }
}

async function copyPassword(id) {
  const cached = cachedItemById(id);
  const password = cached && Object.prototype.hasOwnProperty.call(cached, "password")
    ? cached.password
    : await getRawValue("password", id);
  copyText(password, "密码为空");
  return { ok: true, message: "密码复制成功" };
}

async function copyTotp(id) {
  const cached = cachedItemById(id);
  const totp = cached && Object.prototype.hasOwnProperty.call(cached, "totpSecret")
    ? generateTotp(cached.totpSecret)
    : await getRawValue("totp", id);
  copyText(totp, "totp为空");
  return { ok: true, message: "totp复制成功" };
}

async function copyUsername(id) {
  const cached = cachedItemById(id);
  const username = cached && Object.prototype.hasOwnProperty.call(cached, "username")
    ? cached.username
    : await getRawValue("username", id);
  copyText(username, "用户名为空");
  return { ok: true, message: "用户名复制成功" };
}

window.bitwardenUtools = {
  getSettings,
  saveSettings,
  setCustomFolderName,
  bootstrap,
  status,
  ensureReady,
  ensureSession,
  loginWithApiKey,
  unlock,
  sync,
  search,
  copyPassword,
  copyTotp,
  copyUsername,
};
