(function () {
  const api = window.bitwardenUtools;

  const state = {
    status: null,
    settings: {},
    query: "",
    mode: "folder",
    results: [],
    selected: 0,
    busy: false,
    copyBusy: false,
    timer: null,
  };

  const $ = (id) => document.getElementById(id);

  const els = {
    statusText: $("statusText"),
    setupPanel: $("setupPanel"),
    unlockPanel: $("unlockPanel"),
    searchPanel: $("searchPanel"),
    clientId: $("clientIdInput"),
    clientSecret: $("clientSecretInput"),
    setupMasterPassword: $("setupMasterPasswordInput"),
    bwPath: $("bwPathInput"),
    serverUrl: $("serverUrlInput"),
    saveCredential: $("saveCredentialInput"),
    loginBtn: $("loginBtn"),
    checkBtn: $("checkBtn"),
    masterPassword: $("masterPasswordInput"),
    unlockBtn: $("unlockBtn"),
    syncBtn: $("syncBtn"),
    customFolderBtn: $("customFolderBtn"),
    settingsBtn: $("settingsBtn"),
    mode: $("modeSelect"),
    query: $("queryInput"),
    message: $("message"),
    results: $("results"),
  };

  function setBusy(busy) {
    state.busy = busy;
    for (const btn of [els.loginBtn, els.checkBtn, els.unlockBtn, els.syncBtn, els.customFolderBtn]) {
      btn.disabled = busy;
    }
  }

  function updateCustomFolderUi() {
    const name = state.settings?.customFolderName || "";
    const label = name ? `文件夹：${name}` : "自定义文件夹";
    els.customFolderBtn.textContent = label;
    const option = els.mode.querySelector('option[value="customFolder"]');
    if (option) option.textContent = name ? name : "自定义文件夹";
  }

  function setActionButtonsDisabled(disabled) {
    els.results.querySelectorAll("button").forEach((button) => {
      button.disabled = disabled;
    });
  }

  function showMessage(text, type) {
    if (!text) {
      els.message.classList.add("hidden");
      els.message.textContent = "";
      els.message.classList.remove("error");
      els.message.classList.remove("success");
      return;
    }
    els.message.textContent = text;
    els.message.classList.remove("hidden");
    els.message.classList.remove("error", "success");
    els.message.classList.toggle("error", type === "error");
    els.message.classList.toggle("success", type === "success");
  }

  function setStatusText(text) {
    els.statusText.textContent = text;
  }

  function revealByStatus(status) {
    els.setupPanel.classList.toggle("hidden", status !== "needs-setup");
    els.unlockPanel.classList.add("hidden");
    els.searchPanel.classList.toggle("hidden", status === "needs-setup");
    if (status !== "needs-setup") {
      setTimeout(() => els.query.focus(), 30);
    }
  }

  function formatStatus(status) {
    if (!status) return "状态未知";
    if (status.status === "ready") {
      const parts = [`本地缓存 ${status.cacheSize || 0} 项`];
      if (status.cacheLoadedAt) parts.push(`缓存时间：${new Date(status.cacheLoadedAt).toLocaleString()}`);
      return parts.join(" · ");
    }
    if (status.status === "needs-setup") return "未配置连接信息";
    const parts = [];
    parts.push(status.status || "unknown");
    if (status.userEmail) parts.push(status.userEmail);
    if (status.serverUrl) parts.push(status.serverUrl);
    if (status.lastSync) parts.push(`同步：${new Date(status.lastSync).toLocaleString()}`);
    return parts.join(" · ");
  }

  function escapeText(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[ch];
    });
  }

  function itemMeta(item) {
    const pieces = [];
    if (item.username) pieces.push(item.username);
    if (item.folderName) pieces.push(`📁 ${item.folderName}`);
    if (item.uriText) pieces.push(item.uriText);
    return pieces.join("  ·  ") || "无用户名/网址";
  }

  function renderResults() {
    els.results.innerHTML = "";
    if (!state.results.length) {
      if ((state.status?.cacheSize || 0) === 0) {
        showMessage("本地缓存为空。首次使用请点击“同步”，之后进入插件会直接读取缓存。");
        return;
      }
      showMessage(state.query ? "没有匹配项。可尝试切换到“综合”或缩短关键词。" : "输入关键词开始按文件夹搜索。");
      return;
    }
    showMessage("");
    state.results.forEach((item, index) => {
      const li = document.createElement("li");
      li.className = `result${index === state.selected ? " active" : ""}`;
      li.dataset.index = String(index);
      const totpBadge = item.hasTotp ? '<span class="badge">TOTP</span>' : "";
      li.innerHTML = `
        <div class="info">
          <div class="title">
            <span>${escapeText(item.name || "(无名称)")}</span>
            ${totpBadge}
          </div>
          <div class="meta">${escapeText(itemMeta(item))}</div>
        </div>
        <div class="actions">
          <button data-action="username" class="ghost" title="复制用户名 Ctrl+U">用户</button>
          <button data-action="password" class="ghost" title="复制密码 Ctrl+T">密码</button>
          <button data-action="totp" title="复制 TOTP Enter">TOTP</button>
        </div>
      `;
      els.results.appendChild(li);
    });
  }

  function selectedItem() {
    return state.results[state.selected];
  }

  async function refreshStatus() {
    if (!api) {
      setStatusText("未检测到 preload API，请在 uTools 中运行插件");
      showMessage("window.bitwardenUtools 不存在。请确认 plugin.json 已配置 preload.js。", "error");
      return;
    }
    setBusy(true);
    try {
      state.settings = await api.getSettings();
      els.clientId.value = state.settings.clientId || "";
      els.clientSecret.value = "";
      els.clientSecret.placeholder = state.settings.hasClientSecret
        ? "已保存，留空则不变"
        : "client_secret";
      els.setupMasterPassword.value = "";
      els.setupMasterPassword.placeholder = state.settings.hasMasterPassword
        ? "已保存，留空则不变"
        : "用于自动解锁，已保存可留空";
      els.bwPath.value = state.settings.bwPath || "";
      els.serverUrl.value = state.settings.serverUrl || "https://vault.bitwarden.com";
      els.saveCredential.checked = Boolean(state.settings.saveCredentials);
      updateCustomFolderUi();

      state.status = await api.bootstrap();
      setStatusText(formatStatus(state.status));
      revealByStatus(state.status.status);
      var shouldSearch = state.status.status === "ready";
    } catch (err) {
      setStatusText("检查失败");
      showMessage(err.message || String(err), "error");
      revealByStatus("needs-setup");
    } finally {
      setBusy(false);
    }
    if (shouldSearch) await doSearch(false);
  }

  async function login() {
    setBusy(true);
    showMessage("正在保存配置并首次同步缓存...");
    try {
      await api.saveSettings({
        clientId: els.clientId.value.trim(),
        clientSecret: els.clientSecret.value.trim(),
        masterPassword: els.setupMasterPassword.value,
        bwPath: els.bwPath.value.trim(),
        serverUrl: els.serverUrl.value.trim(),
        customFolderName: state.settings?.customFolderName || "",
        saveCredentials: els.saveCredential.checked,
      });
      els.setupMasterPassword.value = "";
      const res = await api.sync();
      showMessage(`配置已保存，缓存 ${res.cacheSize || 0} 项。`);
      await refreshStatus();
    } catch (err) {
      showMessage(err.message || String(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function unlock() {
    const password = els.masterPassword.value;
    if (!password) {
      showMessage("请输入主密码。", "error");
      return;
    }
    setBusy(true);
    showMessage("正在解锁 vault...");
    try {
      await api.saveSettings({
        clientId: els.clientId.value.trim(),
        clientSecret: els.clientSecret.value.trim(),
        masterPassword: password,
        bwPath: els.bwPath.value.trim(),
        serverUrl: els.serverUrl.value.trim(),
        customFolderName: state.settings?.customFolderName || "",
        saveCredentials: true,
      });
      await api.unlock(password);
      els.masterPassword.value = "";
      showMessage("已解锁。");
      await refreshStatus();
      await doSearch(false);
    } catch (err) {
      showMessage(err.message || String(err), "error");
    } finally {
      setBusy(false);
    }
  }

  function parseQuery() {
    let mode = els.mode.value;
    let query = els.query.value.trim();
    const matched = query.match(/^(n|name|u|url|f|folder)(?:\s*[:：]\s*|\s+)(.*)$/i);
    if (matched) {
      const prefix = matched[1].toLowerCase();
      query = matched[2].trim();
      if (prefix === "n" || prefix === "name") mode = "name";
      if (prefix === "u" || prefix === "url") mode = "url";
      if (prefix === "f" || prefix === "folder") mode = "folder";
    }
    return { mode, query };
  }

  async function doSearch(force) {
    if (!api || state.busy) return;
    const parsed = parseQuery();
    state.mode = parsed.mode;
    state.query = parsed.query;
    setBusy(true);
    try {
      const res = await api.search({
        query: state.query,
        mode: state.mode,
        customFolderName: state.settings?.customFolderName || "",
        limit: 60,
        force: Boolean(force),
      });
      state.results = res.items || [];
      state.selected = 0;
      state.status = {
        ...(state.status || {}),
        status: "ready",
        cacheSize: res.cacheSize || 0,
        cacheLoadedAt: res.cacheLoadedAt || state.status?.cacheLoadedAt || 0,
      };
      setStatusText(formatStatus(state.status));
      renderResults();
    } catch (err) {
      showMessage(err.message || String(err), "error");
    } finally {
      setBusy(false);
    }
  }

  function scheduleSearch() {
    clearTimeout(state.timer);
    state.timer = setTimeout(() => doSearch(false), 160);
  }

  async function copy(action) {
    if (state.copyBusy) {
      showMessage("正在处理上一次复制，请稍等...");
      return;
    }
    const item = selectedItem();
    if (!item) return;
    state.copyBusy = true;
    setActionButtonsDisabled(true);
    const label = action === "totp" ? "totp" : action === "password" ? "密码" : "用户名";
    showMessage(`正在复制${label}...`);
    try {
      let res;
      if (action === "password") res = await api.copyPassword(item.id);
      if (action === "totp") res = await api.copyTotp(item.id);
      if (action === "username") res = await api.copyUsername(item.id);
      showMessage(res?.message || "已复制。", "success");
    } catch (err) {
      showMessage(err.message || String(err), "error");
    } finally {
      state.copyBusy = false;
      setActionButtonsDisabled(false);
    }
  }

  async function syncAndRefresh() {
    if (!api) return;
    setBusy(true);
    showMessage("正在同步 Bitwarden...");
    try {
      await api.sync();
      showMessage("同步完成。");
      await refreshStatus();
      await doSearch(false);
    } catch (err) {
      showMessage(err.message || String(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function setCustomFolder() {
    if (!api) return;
    const current = state.settings?.customFolderName || "";
    const value = window.prompt("请输入自定义文件夹名称（例如：totp）", current);
    if (value === null) return;
    try {
      state.settings = await api.setCustomFolderName(value.trim());
      updateCustomFolderUi();
      if (state.settings.customFolderName) {
        els.mode.value = "customFolder";
      }
      showMessage(
        state.settings.customFolderName
          ? `自定义文件夹已设置为：${state.settings.customFolderName}`
          : "已清空自定义文件夹",
        "success",
      );
      await doSearch(false);
    } catch (err) {
      showMessage(err.message || String(err), "error");
    }
  }

  function moveSelection(delta) {
    if (!state.results.length) return;
    state.selected = (state.selected + delta + state.results.length) % state.results.length;
    renderResults();
    const active = els.results.querySelector(".result.active");
    active?.scrollIntoView({ block: "nearest" });
  }

  function bindEvents() {
    els.loginBtn.addEventListener("click", login);
    els.checkBtn.addEventListener("click", refreshStatus);
    els.unlockBtn.addEventListener("click", unlock);
    els.masterPassword.addEventListener("keydown", (event) => {
      if (event.key === "Enter") unlock();
    });
    els.syncBtn.addEventListener("click", syncAndRefresh);
    els.customFolderBtn.addEventListener("click", setCustomFolder);
    els.settingsBtn.addEventListener("click", () => {
      els.setupPanel.classList.toggle("hidden");
    });
    els.query.addEventListener("input", scheduleSearch);
    els.mode.addEventListener("change", () => doSearch(false));
    els.results.addEventListener("click", (event) => {
      const li = event.target.closest(".result");
      if (!li) return;
      state.selected = Number(li.dataset.index || 0);
      const button = event.target.closest("button");
      if (button) copy(button.dataset.action);
      else renderResults();
    });
    els.results.addEventListener("dblclick", (event) => {
      const li = event.target.closest(".result");
      if (!li || event.target.closest("button")) return;
      state.selected = Number(li.dataset.index || 0);
      renderResults();
      copy("totp");
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveSelection(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        moveSelection(-1);
      } else if (
        event.key === "Enter" &&
        (document.activeElement === els.query || !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName))
      ) {
        event.preventDefault();
        copy("totp");
      } else if (event.ctrlKey && event.key.toLowerCase() === "t") {
        event.preventDefault();
        copy("password");
      } else if (event.ctrlKey && event.key.toLowerCase() === "u") {
        event.preventDefault();
        copy("username");
      } else if (event.ctrlKey && event.key.toLowerCase() === "r") {
        event.preventDefault();
        syncAndRefresh();
      } else if (event.ctrlKey && event.key.toLowerCase() === "l") {
        event.preventDefault();
        els.query.focus();
        els.query.select();
      }
    });
  }

  function setupUtools() {
    if (!window.utools) return;
    window.utools.setExpendHeight?.(620);
    window.utools.onPluginEnter?.((action) => {
      window.utools.setExpendHeight?.(620);
      if (action?.code === "bitwarden-url" && typeof action.payload === "string") {
        els.mode.value = "url";
        els.query.value = action.payload;
      }
      window.utools.setSubInput?.(({ text }) => {
        els.query.value = text;
        scheduleSearch();
      }, "搜索 Bitwarden 密码", true);
      refreshStatus();
    });
    window.utools.onPluginOut?.(() => {
      window.utools.removeSubInput?.();
    });
  }

  bindEvents();
  setupUtools();
  refreshStatus();
})();
