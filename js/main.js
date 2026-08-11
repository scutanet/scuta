import { Game } from "./game.js";
import { SKINS, skinByName } from "./skins.js";
import { neonCoinUrl } from "./food-sprites.js";
import {
  SERVERS,
  canAffordServer,
  clearServerSession,
  DEMO_TOP_UP_AMOUNT,
  formatMoney,
  getDemoBalance,
  getPreferredServerId,
  getServerById,
  getServerIndex,
  getServerSession,
  getSimulatedOnline,
  getWinsProgress,
  poolIconSvg,
  resetDemoBalance,
  selectServer,
  serverDisplayName,
  serverShortLabel,
  setPreferredServerId,
  tierBadge,
  topUpDemoBalance,
  escapeHtml,
} from "./servers.js";

const canvas = document.getElementById("game");
const minimap = document.getElementById("minimap");
const menu = document.getElementById("menu");
const hud = document.getElementById("hud");
const nickInput = document.getElementById("nick");
const playBtn = document.getElementById("play-btn");
const lengthEl = document.getElementById("length");
const rankEl = document.getElementById("rank");
const lbList = document.getElementById("lb-list");
const settingsBtn = document.getElementById("settings-btn");
const customizeBtn = document.getElementById("customize-btn");
const serverBtn = document.getElementById("server-btn");
const lobbyModal = document.getElementById("lobby-modal");
const modalTitle = document.getElementById("modal-title");
const modalBody = document.getElementById("modal-body");
const modalClose = document.getElementById("modal-close");
const modalCard = lobbyModal.querySelector(".lobby-modal-card");
const serverLabel = document.getElementById("server-label");
const lobbyToast = document.getElementById("lobby-toast");

const poolsScreen = document.getElementById("pools-screen");
const poolsCarousel = document.getElementById("pools-carousel");
const poolsWalletBalance = document.getElementById("pools-wallet-balance");
const poolsPrev = document.getElementById("pools-prev");
const poolsNext = document.getElementById("pools-next");
const poolsClose = document.getElementById("pools-close");

const customizeScreen = document.getElementById("customize-screen");
const custCarousel = document.getElementById("cust-carousel");
const custSkinView = document.getElementById("cust-skin-view");
const custSkinName = document.getElementById("cust-skin-name");
const custPrevBtn = document.getElementById("cust-prev");
const custNextBtn = document.getElementById("cust-next");
const custOkBtn = document.getElementById("cust-ok-btn");
const custBgBtn = document.getElementById("cust-bg-btn");
const custCosmeticBtn = document.getElementById("cust-cosmetic-btn");
const custBuildBtn = document.getElementById("cust-build-btn");
const custToast = document.getElementById("cust-toast");

const savedNick = localStorage.getItem("scuta_nick") || "";
nickInput.value = savedNick;

// Ensure demo wallet exists on load.
getDemoBalance();

let selectedSkinName = skinByName(localStorage.getItem("scuta_skin")).name;
if (localStorage.getItem("scuta_skin") !== selectedSkinName) {
  localStorage.setItem("scuta_skin", selectedSkinName);
}
let customizeIndex = Math.max(0, SKINS.findIndex((s) => s.name === selectedSkinName));
let poolsIndex = getServerIndex(getPreferredServerId());
let toastTimer = 0;
let lobbyToastTimer = 0;
refreshServerLabel();

function getSelectedSkin() {
  return skinByName(selectedSkinName);
}

const game = new Game({
  canvas,
  minimap,
  onDeath() {
    clearServerSession();
    refreshServerLabel();
    hud.classList.add("hidden");
    menu.classList.remove("hidden");
    nickInput.focus();
  },
  onHud({ length, rank, leaderboard }) {
    lengthEl.textContent = String(length);
    rankEl.textContent = rank;
    lbList.innerHTML = leaderboard
      .map(
        (e, i) =>
          `<li class="${e.you ? "you" : ""}"><span class="lb-rank">#${i + 1}</span><span class="lb-name" style="color:${e.color}">${escapeHtml(
            e.name
          )}</span><span class="lb-score">${e.score}</span></li>`
      )
      .join("");
  },
});

function refreshServerLabel() {
  const session = getServerSession();
  const server = session ? getServerById(session.serverId) : getServerById(getPreferredServerId());
  if (server) {
    serverLabel.textContent = serverDisplayName(server);
  } else {
    serverLabel.textContent = "Choose Server";
  }
}

function showLobbyToast(msg) {
  lobbyToast.textContent = msg;
  lobbyToast.classList.remove("hidden");
  clearTimeout(lobbyToastTimer);
  lobbyToastTimer = setTimeout(() => lobbyToast.classList.add("hidden"), 2800);
}

function begin() {
  let session = getServerSession();

  if (!session) {
    const preferred = getPreferredServerId();
    const join = selectServer(preferred);
    if (!join.ok) {
      openPoolsScreen(getServerIndex(preferred));
      showLobbyToast(
        join.reason === "insufficient_funds"
          ? `Insufficient funds for ${serverDisplayName(join.server)}. Top up your demo wallet.`
          : "Choose a liquidity pool and pay the buy-in to play."
      );
      return;
    }
    session = join.session;
    refreshServerLabel();
  }

  const nick = nickInput.value.trim().slice(0, 16) || "scuta";
  localStorage.setItem("scuta_nick", nick);
  closeModal();
  closeCustomize();
  closePoolsScreen();
  menu.classList.add("hidden");
  hud.classList.remove("hidden");
  refreshServerLabel();
  game.start(nick, {
    skin: getSelectedSkin(),
    serverSession: { ...session },
  });
}

playBtn.addEventListener("click", begin);
nickInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") begin();
});

function openModal(title, html, { wide = false } = {}) {
  modalTitle.textContent = title;
  modalBody.innerHTML = html;
  modalCard.classList.toggle("is-wide", wide);
  lobbyModal.classList.remove("hidden");
}

function closeModal() {
  lobbyModal.classList.add("hidden");
  modalBody.innerHTML = "";
  modalCard.classList.remove("is-wide");
}

modalClose.addEventListener("click", closeModal);
lobbyModal.addEventListener("click", (e) => {
  if (e.target === lobbyModal) closeModal();
});

/* ─── Liquidity Pools screen ─── */

function poolSideCardHtml(server, side) {
  return `<button type="button" class="pool-card pool-card-side pool-card-${side}" data-server="${server.id}" style="--pool-accent:${server.accent}">
    <div class="pool-side-icon">${poolIconSvg(server, 48)}</div>
    <div class="pool-side-title" style="color:${server.accent}">${escapeHtml(serverShortLabel(server))}</div>
    <div class="pool-side-liq">${formatMoney(server.netLiquidity)}</div>
    <div class="pool-side-fee">Entry ${formatMoney(server.buyIn)}</div>
  </button>`;
}

function poolFocusCardHtml(server, { denied = false } = {}) {
  const online = getSimulatedOnline(server);
  const onlinePct = Math.round((online / server.maxCapacity) * 100);
  const { wins, goal } = getWinsProgress(server);
  const winsPct = Math.round((wins / goal) * 100);
  const affordable = canAffordServer(server.id);
  const joined = getServerSession()?.serverId === server.id;
  const enterLabel = joined ? "ENTER ARENA" : "ENTER POOL";

  return `<div class="pool-card pool-card-focus ${denied ? "is-denied" : ""} ${!affordable ? "is-unaffordable" : ""}" data-server="${server.id}" style="--pool-accent:${server.accent}">
    <div class="pool-focus-icon">${poolIconSvg(server, 72)}</div>
    <h2 class="pool-focus-title">${escapeHtml(server.arena)}</h2>
    <p class="pool-focus-sub">${escapeHtml(tierBadge(server))}</p>

    <div class="pool-wins">
      <div class="pool-wins-label">${wins} / ${goal} WINS FOR BONUS</div>
      <div class="pool-wins-bar"><span style="width:${winsPct}%"></span></div>
    </div>

    <div class="pool-liq-box">
      <span class="pool-liq-label">NET LIQUIDITY POOL</span>
      <span class="pool-liq-value">${formatMoney(server.netLiquidity)}</span>
    </div>

    <div class="pool-stats">
      <div class="pool-stat">
        <div class="pool-stat-row">
          <span>Players Online</span>
          <strong>${online} / ${server.maxCapacity}</strong>
        </div>
        <div class="pool-online-bar"><span style="width:${onlinePct}%"></span></div>
      </div>
      <div class="pool-stat pool-stat-fee">
        <span>Buy-in Fee</span>
        <strong>${formatMoney(server.buyIn)}</strong>
      </div>
    </div>

    <button type="button" class="pool-enter-btn" data-action="enter" ${affordable ? "" : "disabled"}>
      ${enterLabel}
    </button>
  </div>`;
}

function renderPoolsCarousel({ deniedId = null } = {}) {
  const n = SERVERS.length;
  const focus = SERVERS[poolsIndex];
  const prev = SERVERS[(poolsIndex - 1 + n) % n];
  const next = SERVERS[(poolsIndex + 1) % n];

  poolsCarousel.innerHTML = `
    ${poolSideCardHtml(prev, "left")}
    ${poolFocusCardHtml(focus, { denied: deniedId === focus.id })}
    ${poolSideCardHtml(next, "right")}
  `;

  poolsCarousel.querySelectorAll(".pool-card-side").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = getServerIndex(btn.dataset.server);
      setPoolsIndex(idx);
    });
  });

  const enterBtn = poolsCarousel.querySelector('[data-action="enter"]');
  if (enterBtn) {
    enterBtn.addEventListener("click", () => enterFocusedPool());
  }
}

function setPoolsIndex(idx) {
  const n = SERVERS.length;
  poolsIndex = ((idx % n) + n) % n;
  setPreferredServerId(SERVERS[poolsIndex].id);
  refreshPoolsWallet();
  renderPoolsCarousel();
}

function refreshPoolsWallet() {
  poolsWalletBalance.textContent = formatMoney(getDemoBalance());
}

function openPoolsScreen(forceIndex = null) {
  closeModal();
  closeCustomize();
  if (forceIndex != null) poolsIndex = forceIndex;
  else poolsIndex = getServerIndex(getPreferredServerId());
  refreshPoolsWallet();
  renderPoolsCarousel();
  poolsScreen.classList.remove("hidden");
  poolsCarousel.focus({ preventScroll: true });
}

function closePoolsScreen() {
  poolsScreen.classList.add("hidden");
}

function enterFocusedPool() {
  const server = SERVERS[poolsIndex];
  const result = selectServer(server.id);

  if (!result.ok) {
    if (result.reason === "insufficient_funds") {
      renderPoolsCarousel({ deniedId: server.id });
      showLobbyToast(
        `Insufficient funds for ${serverDisplayName(result.server)}. Top up your demo wallet.`
      );
      return;
    }
    showLobbyToast("Could not enter that pool.");
    return;
  }

  refreshServerLabel();
  refreshPoolsWallet();
  closePoolsScreen();
  begin();
}

poolsPrev.addEventListener("click", () => setPoolsIndex(poolsIndex - 1));
poolsNext.addEventListener("click", () => setPoolsIndex(poolsIndex + 1));
poolsClose.addEventListener("click", closePoolsScreen);

poolsScreen.querySelector('[data-action="topup"]').addEventListener("click", () => {
  topUpDemoBalance(DEMO_TOP_UP_AMOUNT);
  refreshPoolsWallet();
  renderPoolsCarousel();
  showLobbyToast(`Demo wallet topped up by ${formatMoney(DEMO_TOP_UP_AMOUNT)}.`);
});

poolsCarousel.addEventListener(
  "wheel",
  (e) => {
    if (poolsScreen.classList.contains("hidden")) return;
    e.preventDefault();
    if (Math.abs(e.deltaY) < 2 && Math.abs(e.deltaX) < 2) return;
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    setPoolsIndex(poolsIndex + (delta > 0 ? 1 : -1));
  },
  { passive: false }
);

let poolsTouchX = null;
poolsCarousel.addEventListener(
  "touchstart",
  (e) => {
    poolsTouchX = e.touches[0]?.clientX ?? null;
  },
  { passive: true }
);
poolsCarousel.addEventListener(
  "touchend",
  (e) => {
    if (poolsTouchX == null) return;
    const x = e.changedTouches[0]?.clientX ?? poolsTouchX;
    const dx = x - poolsTouchX;
    poolsTouchX = null;
    if (Math.abs(dx) < 36) return;
    setPoolsIndex(poolsIndex + (dx < 0 ? 1 : -1));
  },
  { passive: true }
);

serverBtn.addEventListener("click", () => openPoolsScreen());

settingsBtn.addEventListener("click", () => {
  openModal(
    "Settings",
    `<p>Mouse to steer. Hold click or Space to boost.</p>
     <p style="margin-top:10px">Touch devices: use the on-screen Boost button.</p>
     <p style="margin-top:10px">Demo wallet: <strong>${formatMoney(getDemoBalance())}</strong>
       <button type="button" id="settings-reset-wallet" class="server-reset-btn" style="margin-left:10px">Reset</button>
     </p>`
  );
  const resetBtn = modalBody.querySelector("#settings-reset-wallet");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      clearServerSession();
      resetDemoBalance();
      refreshServerLabel();
      showLobbyToast(`Demo wallet reset to ${formatMoney(getDemoBalance())}.`);
      closeModal();
    });
  }
});

/* ─── Customize Snake (Slither-style horizontal switcher) ─── */

const CIRCUIT_PREVIEW_ACCENT = "#5dffc8";

function previewPathPoints(w, h, r) {
  const spacing = r * 0.52;
  const startX = 44;
  const endX = w - 70;
  const midY = h / 2 + 2;
  const amp = 30;
  const points = [];
  for (let x = startX; x <= endX + 0.1; x += spacing) {
    const t = (x - startX) / (endX - startX);
    const y = midY + Math.sin(t * Math.PI * 2.05) * amp;
    points.push({ x, y, t });
  }
  return points;
}

function previewDefs() {
  return `
    <defs>
      <filter id="cust-shadow" x="-20%" y="-20%" width="140%" height="160%">
        <feDropShadow dx="0" dy="7" stdDeviation="4.5" flood-color="#000" flood-opacity="0.5"/>
      </filter>
      <radialGradient id="cust-head-face" cx="36%" cy="32%" r="68%">
        <stop offset="0%" stop-color="#2a2a32"/>
        <stop offset="55%" stop-color="#121218"/>
        <stop offset="100%" stop-color="#050508"/>
      </radialGradient>
      <linearGradient id="cust-head-rim" x1="15%" y1="10%" x2="90%" y2="95%">
        <stop offset="0%" stop-color="#ffffff"/>
        <stop offset="40%" stop-color="#b8c4d8"/>
        <stop offset="100%" stop-color="#6a7388"/>
      </linearGradient>
      <linearGradient id="cust-circuit-core" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#2a2a32"/>
        <stop offset="45%" stop-color="#101014"/>
        <stop offset="100%" stop-color="#050508"/>
      </linearGradient>
    </defs>
  `;
}

function previewPlatinumHead(parts, headX, headY, hr) {
  parts.push(`<circle cx="${headX.toFixed(1)}" cy="${headY.toFixed(1)}" r="${hr.toFixed(1)}" fill="url(#cust-head-face)"/>`);
  parts.push(
    `<circle cx="${headX.toFixed(1)}" cy="${headY.toFixed(1)}" r="${(hr * 0.74).toFixed(1)}" fill="none" stroke="#c5d0e2" stroke-opacity="0.35" stroke-width="1.2"/>`
  );
  parts.push(
    `<circle cx="${headX.toFixed(1)}" cy="${headY.toFixed(1)}" r="${(hr * 0.96).toFixed(1)}" fill="none" stroke="url(#cust-head-rim)" stroke-width="2.6"/>`
  );
  const eyeY = headY - 4.5;
  const eyeR = 10;
  parts.push(`<circle cx="${(headX - 10).toFixed(1)}" cy="${eyeY.toFixed(1)}" r="${eyeR}" fill="#fff"/>`);
  parts.push(`<circle cx="${(headX + 10).toFixed(1)}" cy="${eyeY.toFixed(1)}" r="${eyeR}" fill="#fff"/>`);
  parts.push(
    `<circle cx="${(headX - 10).toFixed(1)}" cy="${eyeY.toFixed(1)}" r="${eyeR}" fill="none" stroke="#c5d0e2" stroke-opacity="0.4" stroke-width="1"/>`
  );
  parts.push(
    `<circle cx="${(headX + 10).toFixed(1)}" cy="${eyeY.toFixed(1)}" r="${eyeR}" fill="none" stroke="#c5d0e2" stroke-opacity="0.4" stroke-width="1"/>`
  );
  parts.push(`<circle cx="${(headX - 7.4).toFixed(1)}" cy="${(eyeY + 1).toFixed(1)}" r="4.4" fill="#111"/>`);
  parts.push(`<circle cx="${(headX + 12.6).toFixed(1)}" cy="${(eyeY + 1).toFixed(1)}" r="4.4" fill="#111"/>`);
  parts.push(`<circle cx="${(headX - 6).toFixed(1)}" cy="${(eyeY - 0.5).toFixed(1)}" r="1.4" fill="#fff" opacity="0.95"/>`);
  parts.push(`<circle cx="${(headX + 14).toFixed(1)}" cy="${(eyeY - 0.5).toFixed(1)}" r="1.4" fill="#fff" opacity="0.95"/>`);
}

function previewEyesOnHead(parts, headX, headY) {
  const eyeY = headY - 4.5;
  const eyeR = 10;
  parts.push(`<circle cx="${(headX - 10).toFixed(1)}" cy="${eyeY.toFixed(1)}" r="${eyeR}" fill="#fff"/>`);
  parts.push(`<circle cx="${(headX + 10).toFixed(1)}" cy="${eyeY.toFixed(1)}" r="${eyeR}" fill="#fff"/>`);
  parts.push(`<circle cx="${(headX - 7.4).toFixed(1)}" cy="${(eyeY + 1).toFixed(1)}" r="4.4" fill="#111"/>`);
  parts.push(`<circle cx="${(headX + 12.6).toFixed(1)}" cy="${(eyeY + 1).toFixed(1)}" r="4.4" fill="#111"/>`);
  parts.push(`<circle cx="${(headX - 6).toFixed(1)}" cy="${(eyeY - 0.5).toFixed(1)}" r="1.4" fill="#fff" opacity="0.95"/>`);
  parts.push(`<circle cx="${(headX + 14).toFixed(1)}" cy="${(eyeY - 0.5).toFixed(1)}" r="1.4" fill="#fff" opacity="0.95"/>`);
}

function hexPoints(cx, cy, r, rot = Math.PI / 6) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = rot + (i * Math.PI) / 3;
    pts.push(`${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`);
  }
  return pts.join(" ");
}

function snakePreviewSvg(skin) {
  const w = 920;
  const h = 168;
  const r = 28;
  const style = skin.style || "coin";
  const points = previewPathPoints(w, h, r);
  const parts = [];
  const coins = skin.coins?.length ? skin.coins : ["btc"];
  const accents = skin.colors?.length ? skin.colors : ["#1a1a22"];
  const accent = accents[0];

  parts.push(previewDefs());
  parts.push(`<g filter="url(#cust-shadow)">`);

  if (style === "circuit") {
    const body = points.slice(0, -1);
    const d = body
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(" ");
    const strokeCommon = `fill="none" stroke-linecap="round" stroke-linejoin="round" d="${d}"`;
    parts.push(`<path ${strokeCommon} stroke="${CIRCUIT_PREVIEW_ACCENT}" stroke-opacity="0.14" stroke-width="${(r * 2.35).toFixed(1)}"/>`);
    parts.push(`<path ${strokeCommon} stroke="#c5d0e2" stroke-opacity="0.22" stroke-width="${(r * 2.12).toFixed(1)}"/>`);
    parts.push(`<path ${strokeCommon} stroke="#6a7388" stroke-opacity="0.55" stroke-width="${(r * 2.02).toFixed(1)}"/>`);
    parts.push(`<path ${strokeCommon} stroke="url(#cust-circuit-core)" stroke-width="${(r * 1.92).toFixed(1)}"/>`);
    parts.push(`<path ${strokeCommon} stroke="#16161c" stroke-width="${(r * 1.45).toFixed(1)}"/>`);

    const tickStep = 5;
    for (let i = 2; i < body.length - 2; i += tickStep) {
      const p = body[i];
      const n = body[i + 1];
      const dx = n.x - p.x;
      const dy = n.y - p.y;
      const len = Math.hypot(dx, dy) || 1;
      const tx = dx / len;
      const ty = dy / len;
      const px = -ty;
      const py = tx;
      const half = r * 0.28;
      const run = r * 0.55;
      const x1 = p.x - tx * run * 0.15;
      const y1 = p.y - ty * run * 0.15;
      const x2 = p.x + tx * run;
      const y2 = p.y + ty * run;
      parts.push(
        `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${CIRCUIT_PREVIEW_ACCENT}" stroke-opacity="0.7" stroke-width="1.4" stroke-linecap="round"/>`
      );
      parts.push(
        `<circle cx="${x2.toFixed(1)}" cy="${y2.toFixed(1)}" r="1.6" fill="${CIRCUIT_PREVIEW_ACCENT}" fill-opacity="0.85"/>`
      );
      if (i % (tickStep * 2) === 2) {
        const bx = p.x + px * half;
        const by = p.y + py * half;
        parts.push(
          `<line x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="${CIRCUIT_PREVIEW_ACCENT}" stroke-opacity="0.45" stroke-width="1.1" stroke-linecap="round"/>`
        );
        parts.push(
          `<circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="1.2" fill="#e8fff8" fill-opacity="0.8"/>`
        );
      }
    }
    const head = points[points.length - 1];
    previewPlatinumHead(parts, head.x, head.y, r * 1.08);
  } else if (style === "blockweave") {
    for (let i = points.length - 2; i >= 0; i--) {
      const p = points[i];
      const n = points[Math.min(points.length - 1, i + 1)];
      const ang = Math.atan2(n.y - p.y, n.x - p.x);
      const taper = i < 7 ? 0.86 + (i / 7) * 0.14 : 1;
      const sr = r * taper;
      parts.push(
        `<polygon points="${hexPoints(p.x, p.y, sr, ang + Math.PI / 6)}" fill="#0e0f14" stroke="${accent}" stroke-width="2.2"/>`
      );
      parts.push(
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(sr * 0.12).toFixed(1)}" fill="${accent}"/>`
      );
    }
    const head = points[points.length - 1];
    const hr = r * 1.08;
    parts.push(
      `<polygon points="${hexPoints(head.x, head.y, hr, Math.PI / 6)}" fill="#121018" stroke="${accent}" stroke-width="2.8"/>`
    );
    parts.push(
      `<circle cx="${head.x.toFixed(1)}" cy="${head.y.toFixed(1)}" r="${(hr * 0.55).toFixed(1)}" fill="none" stroke="${accent}" stroke-opacity="0.4" stroke-width="1.2"/>`
    );
    previewEyesOnHead(parts, head.x, head.y);
  } else if (style === "pulse") {
    const body = points.slice(0, -1);
    const d = body
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(" ");
    parts.push(`<path d="${d}" fill="none" stroke="#081218" stroke-width="${(r * 0.55).toFixed(1)}" stroke-linecap="round"/>`);
    parts.push(`<path d="${d}" fill="none" stroke="${accent}" stroke-opacity="0.25" stroke-width="${(r * 0.22).toFixed(1)}" stroke-linecap="round"/>`);
    for (let i = 0; i < body.length; i += 2) {
      const p = body[i];
      const taper = i < 7 ? 0.84 + (i / 7) * 0.16 : 1;
      const sr = r * taper;
      parts.push(
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(sr * 0.92).toFixed(1)}" fill="none" stroke="${accent}" stroke-width="2.4"/>`
      );
      parts.push(
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(sr * 0.14).toFixed(1)}" fill="${accent}"/>`
      );
    }
    const head = points[points.length - 1];
    const hr = r * 1.06;
    parts.push(`<circle cx="${head.x.toFixed(1)}" cy="${head.y.toFixed(1)}" r="${hr.toFixed(1)}" fill="#071016"/>`);
    parts.push(`<circle cx="${head.x.toFixed(1)}" cy="${head.y.toFixed(1)}" r="${(hr * 0.96).toFixed(1)}" fill="none" stroke="${accent}" stroke-width="2.6"/>`);
    parts.push(`<circle cx="${head.x.toFixed(1)}" cy="${head.y.toFixed(1)}" r="${(hr * 0.68).toFixed(1)}" fill="none" stroke="${accent}" stroke-opacity="0.55" stroke-width="1.4"/>`);
    parts.push(`<circle cx="${head.x.toFixed(1)}" cy="${head.y.toFixed(1)}" r="${(hr * 0.16).toFixed(1)}" fill="${accent}"/>`);
    previewEyesOnHead(parts, head.x, head.y);
  } else if (style === "prism") {
    for (let i = points.length - 2; i >= 0; i--) {
      const p = points[i];
      const n = points[Math.min(points.length - 1, i + 1)];
      const ang = Math.atan2(n.y - p.y, n.x - p.x);
      const taper = i < 7 ? 0.86 + (i / 7) * 0.14 : 1;
      const sr = r * taper;
      const hx = sr * 1.05;
      const hy = sr * 0.72;
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      const corners = [
        [hx, 0],
        [0, hy],
        [-hx, 0],
        [0, -hy],
      ].map(([lx, ly]) => {
        const wx = p.x + lx * cos - ly * sin;
        const wy = p.y + lx * sin + ly * cos;
        return `${wx.toFixed(1)},${wy.toFixed(1)}`;
      });
      parts.push(
        `<polygon points="${corners.join(" ")}" fill="#140a1c" stroke="${accent}" stroke-width="2.1"/>`
      );
    }
    const head = points[points.length - 1];
    const hr = r * 1.08;
    const tipX = head.x + hr * 1.05;
    parts.push(
      `<polygon points="${tipX.toFixed(1)},${head.y.toFixed(1)} ${(head.x).toFixed(1)},${(head.y + hr * 0.88).toFixed(1)} ${(head.x - hr * 0.75).toFixed(1)},${head.y.toFixed(1)} ${head.x.toFixed(1)},${(head.y - hr * 0.88).toFixed(1)}" fill="#120818" stroke="${accent}" stroke-width="2.8"/>`
    );
    previewEyesOnHead(parts, head.x, head.y);
  } else if (style === "ember") {
    const body = points.slice(0, -1);
    const d = body
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(" ");
    const strokeCommon = `fill="none" stroke-linecap="round" stroke-linejoin="round" d="${d}"`;
    parts.push(`<path ${strokeCommon} stroke="${accent}" stroke-opacity="0.18" stroke-width="${(r * 2.45).toFixed(1)}"/>`);
    parts.push(`<path ${strokeCommon} stroke="#1a0c08" stroke-width="${(r * 2.05).toFixed(1)}"/>`);
    parts.push(`<path ${strokeCommon} stroke="#2a1410" stroke-width="${(r * 1.55).toFixed(1)}"/>`);
    parts.push(`<path ${strokeCommon} stroke="${accent}" stroke-opacity="0.55" stroke-width="${(r * 0.72).toFixed(1)}"/>`);
    parts.push(`<path ${strokeCommon} stroke="#ffd0a0" stroke-opacity="0.9" stroke-width="${(r * 0.28).toFixed(1)}"/>`);
    const head = points[points.length - 1];
    const hr = r * 1.08;
    parts.push(`<circle cx="${head.x.toFixed(1)}" cy="${head.y.toFixed(1)}" r="${(hr * 1.15).toFixed(1)}" fill="${accent}" fill-opacity="0.18"/>`);
    parts.push(`<circle cx="${head.x.toFixed(1)}" cy="${head.y.toFixed(1)}" r="${hr.toFixed(1)}" fill="#140808"/>`);
    parts.push(`<circle cx="${head.x.toFixed(1)}" cy="${head.y.toFixed(1)}" r="${(hr * 0.96).toFixed(1)}" fill="none" stroke="${accent}" stroke-width="2.8"/>`);
    parts.push(`<circle cx="${head.x.toFixed(1)}" cy="${head.y.toFixed(1)}" r="${(hr * 0.16).toFixed(1)}" fill="${accent}"/>`);
    previewEyesOnHead(parts, head.x, head.y);
  } else if (style === "strike") {
    for (let i = points.length - 2; i >= 0; i--) {
      const p = points[i];
      const n = points[Math.min(points.length - 1, i + 1)];
      const ang = Math.atan2(n.y - p.y, n.x - p.x);
      const taper = i < 7 ? 0.85 + (i / 7) * 0.15 : 1;
      const sr = r * taper;
      const tip = sr * 1.15;
      const back = sr * 0.55;
      const wing = sr * 0.95;
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      const corners = [
        [tip, 0],
        [-back, wing],
        [-back * 0.35, 0],
        [-back, -wing],
      ].map(([lx, ly]) => {
        const wx = p.x + lx * cos - ly * sin;
        const wy = p.y + lx * sin + ly * cos;
        return `${wx.toFixed(1)},${wy.toFixed(1)}`;
      });
      parts.push(
        `<polygon points="${corners.join(" ")}" fill="#160810" stroke="${accent}" stroke-width="2.1"/>`
      );
    }
    const head = points[points.length - 1];
    const hr = r * 1.1;
    const tipX = head.x + hr * 1.2;
    parts.push(
      `<polygon points="${tipX.toFixed(1)},${head.y.toFixed(1)} ${(head.x - hr * 0.55).toFixed(1)},${(head.y + hr).toFixed(1)} ${(head.x - hr * 0.1).toFixed(1)},${head.y.toFixed(1)} ${(head.x - hr * 0.55).toFixed(1)},${(head.y - hr).toFixed(1)}" fill="#140810" stroke="${accent}" stroke-width="2.8"/>`
    );
    previewEyesOnHead(parts, head.x, head.y);
  } else {
    for (let i = points.length - 2; i >= 0; i--) {
      const { x, y } = points[i];
      const fromTail = i;
      const taper = fromTail < 7 ? 0.88 + (fromTail / 7) * 0.12 : 1;
      const sr = r * taper;
      const coinId = coins[i % coins.length];
      const coinAccent = accents[i % accents.length];
      parts.push(
        `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${sr.toFixed(1)}" fill="${coinAccent}"/>`
      );
      const size = (sr * 3.05).toFixed(1);
      const hx = (x - sr * 1.525).toFixed(1);
      const hy = (y - sr * 1.525).toFixed(1);
      parts.push(
        `<image href="${neonCoinUrl(coinId)}" x="${hx}" y="${hy}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/>`
      );
    }
    const head = points[points.length - 1];
    previewPlatinumHead(parts, head.x, head.y, r * 1.08);
  }

  parts.push(`</g>`);

  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`;
}

function renderCarousel(animate = true) {
  const skin = SKINS[customizeIndex];
  if (!skin || !custSkinView) return;

  custSkinView.classList.remove("is-swap");
  if (animate) {
    // retrigger CSS animation
    void custSkinView.offsetWidth;
    custSkinView.classList.add("is-swap");
  }

  custSkinView.innerHTML = snakePreviewSvg(skin);
  if (custSkinName) custSkinName.textContent = skin.name;
  custCarousel?.setAttribute("aria-label", `Skin: ${skin.name}`);
}

function setCustomizeIndex(idx, animate = true) {
  const n = SKINS.length;
  customizeIndex = ((idx % n) + n) % n;
  selectedSkinName = SKINS[customizeIndex].name;
  localStorage.setItem("scuta_skin", selectedSkinName);
  renderCarousel(animate);
}

function showToast(msg) {
  custToast.textContent = msg;
  custToast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => custToast.classList.add("hidden"), 1600);
}

function openCustomize() {
  closeModal();
  closePoolsScreen();
  customizeIndex = Math.max(0, SKINS.findIndex((s) => s.name === selectedSkinName));
  renderCarousel(false);
  customizeScreen.classList.remove("hidden");
  custCarousel.focus({ preventScroll: true });
}

function closeCustomize() {
  customizeScreen.classList.add("hidden");
  custToast.classList.add("hidden");
}

customizeBtn.addEventListener("click", openCustomize);
custOkBtn.addEventListener("click", closeCustomize);
custPrevBtn?.addEventListener("click", () => setCustomizeIndex(customizeIndex - 1));
custNextBtn?.addEventListener("click", () => setCustomizeIndex(customizeIndex + 1));

custBgBtn.addEventListener("click", () => {
  showToast("Background: Black");
});

custCosmeticBtn.addEventListener("click", () => {
  showToast("Cosmetics coming soon");
});

custBuildBtn.addEventListener("click", () => {
  showToast("Custom builder coming soon");
});

custCarousel.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(delta) < 2) return;
    setCustomizeIndex(customizeIndex + (delta > 0 ? 1 : -1));
  },
  { passive: false }
);

let touchStartX = null;
let touchStartY = null;
custCarousel.addEventListener(
  "touchstart",
  (e) => {
    touchStartX = e.touches[0]?.clientX ?? null;
    touchStartY = e.touches[0]?.clientY ?? null;
  },
  { passive: true }
);
custCarousel.addEventListener(
  "touchend",
  (e) => {
    if (touchStartX == null) return;
    const x = e.changedTouches[0]?.clientX ?? touchStartX;
    const y = e.changedTouches[0]?.clientY ?? touchStartY;
    const dx = x - touchStartX;
    const dy = y - (touchStartY ?? y);
    touchStartX = null;
    touchStartY = null;
    if (Math.abs(dx) < 28 && Math.abs(dy) < 28) return;
    if (Math.abs(dx) >= Math.abs(dy)) {
      setCustomizeIndex(customizeIndex + (dx < 0 ? 1 : -1));
    } else {
      setCustomizeIndex(customizeIndex + (dy < 0 ? 1 : -1));
    }
  },
  { passive: true }
);

function pointerPos(e) {
  if (e.touches && e.touches[0]) {
    return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  return { x: e.clientX, y: e.clientY };
}

const logoSvg = document.getElementById("logo-svg");
const logoEyes = logoSvg ? [...logoSvg.querySelectorAll(".logo-eye")] : [];
let logoLookX = 244;
let logoLookY = 58.5;
let logoTargetX = 244;
let logoTargetY = 58.5;
let logoEyesRaf = 0;

function setLogoEyeTarget(clientX, clientY) {
  if (!logoSvg || !logoEyes.length || menu.classList.contains("hidden")) return;
  const ctm = logoSvg.getScreenCTM();
  if (!ctm) return;
  const inv = ctm.inverse();
  const pt = logoSvg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const local = pt.matrixTransform(inv);
  logoTargetX = local.x;
  logoTargetY = local.y;
  if (!logoEyesRaf) logoEyesRaf = requestAnimationFrame(tickLogoEyes);
}

function tickLogoEyes() {
  logoEyesRaf = 0;
  if (!logoSvg || menu.classList.contains("hidden")) return;

  logoLookX += (logoTargetX - logoLookX) * 0.28;
  logoLookY += (logoTargetY - logoLookY) * 0.28;

  for (const eye of logoEyes) {
    const cx = Number(eye.dataset.cx);
    const cy = Number(eye.dataset.cy);
    const max = Number(eye.dataset.max) || 4;
    let dx = logoLookX - cx;
    let dy = logoLookY - cy;
    const dist = Math.hypot(dx, dy) || 1;
    const scale = Math.min(1, max / dist);
    const pupil = eye.querySelector(".logo-pupil");
    if (pupil) {
      pupil.setAttribute("transform", `translate(${cx + dx * scale} ${cy + dy * scale})`);
    }
  }

  if (Math.hypot(logoTargetX - logoLookX, logoTargetY - logoLookY) > 0.15) {
    logoEyesRaf = requestAnimationFrame(tickLogoEyes);
  }
}

window.addEventListener("mousemove", (e) => {
  const p = pointerPos(e);
  game.setMouse(p.x, p.y);
  setLogoEyeTarget(p.x, p.y);
});

window.addEventListener(
  "touchmove",
  (e) => {
    e.preventDefault();
    const p = pointerPos(e);
    game.setMouse(p.x, p.y);
    setLogoEyeTarget(p.x, p.y);
  },
  { passive: false }
);

window.addEventListener("mousedown", (e) => {
  if (!menu.classList.contains("hidden")) return;
  if (e.button === 0) game.setBoost(true);
});
window.addEventListener("mouseup", () => game.setBoost(false));
window.addEventListener("mouseleave", () => game.setBoost(false));

window.addEventListener(
  "touchstart",
  (e) => {
    if (!menu.classList.contains("hidden")) return;
    const p = pointerPos(e);
    game.setMouse(p.x, p.y);
  },
  { passive: true }
);

const boostBtn = document.getElementById("boost-btn");
const setBoostUI = (on) => {
  game.setBoost(on);
  boostBtn.classList.toggle("active", on);
};
boostBtn.addEventListener("touchstart", (e) => {
  e.preventDefault();
  e.stopPropagation();
  setBoostUI(true);
}, { passive: false });
boostBtn.addEventListener("touchend", (e) => {
  e.preventDefault();
  setBoostUI(false);
});
boostBtn.addEventListener("mousedown", (e) => {
  e.preventDefault();
  setBoostUI(true);
});
boostBtn.addEventListener("mouseup", () => setBoostUI(false));
boostBtn.addEventListener("mouseleave", () => setBoostUI(false));

window.addEventListener("keydown", (e) => {
  if (!poolsScreen.classList.contains("hidden")) {
    if (e.code === "Escape") {
      e.preventDefault();
      closePoolsScreen();
      return;
    }
    if (e.code === "ArrowLeft" || e.code === "KeyA" || e.code === "KeyW" || e.code === "ArrowUp") {
      e.preventDefault();
      setPoolsIndex(poolsIndex - 1);
      return;
    }
    if (e.code === "ArrowRight" || e.code === "KeyD" || e.code === "KeyS" || e.code === "ArrowDown") {
      e.preventDefault();
      setPoolsIndex(poolsIndex + 1);
      return;
    }
    if (e.code === "Enter") {
      e.preventDefault();
      enterFocusedPool();
      return;
    }
  }
  if (!customizeScreen.classList.contains("hidden")) {
    if (e.code === "Escape" || e.code === "Enter") {
      e.preventDefault();
      closeCustomize();
      return;
    }
    if (e.code === "ArrowDown" || e.code === "ArrowRight" || e.code === "KeyS") {
      e.preventDefault();
      setCustomizeIndex(customizeIndex + 1);
      return;
    }
    if (e.code === "ArrowUp" || e.code === "ArrowLeft" || e.code === "KeyW") {
      e.preventDefault();
      setCustomizeIndex(customizeIndex - 1);
      return;
    }
  }
  if (e.code === "Escape" && !lobbyModal.classList.contains("hidden")) {
    closeModal();
    return;
  }
  if (!menu.classList.contains("hidden")) return;
  if (e.code === "Space") {
    e.preventDefault();
    game.setBoost(true);
  }
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space") game.setBoost(false);
});

nickInput.focus();
