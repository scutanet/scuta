import { Game } from "./game.js";
import { SKINS, defaultPlayerSkin } from "./skins.js";

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
const serverLabel = document.getElementById("server-label");

const savedNick = localStorage.getItem("scuta_nick") || "";
nickInput.value = savedNick;

let selectedSkinName = localStorage.getItem("scuta_skin") || defaultPlayerSkin().name;
let selectedServer = localStorage.getItem("scuta_server") || "8080";
serverLabel.textContent = `server ${selectedServer}`;

function getSelectedSkin() {
  return SKINS.find((s) => s.name === selectedSkinName) || defaultPlayerSkin();
}

const game = new Game({
  canvas,
  minimap,
  onDeath() {
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

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function begin() {
  const nick = nickInput.value.trim().slice(0, 16) || "scuta";
  localStorage.setItem("scuta_nick", nick);
  closeModal();
  menu.classList.add("hidden");
  hud.classList.remove("hidden");
  game.start(nick, { skin: getSelectedSkin() });
}

playBtn.addEventListener("click", begin);
nickInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") begin();
});

function openModal(title, html) {
  modalTitle.textContent = title;
  modalBody.innerHTML = html;
  lobbyModal.classList.remove("hidden");
}

function closeModal() {
  lobbyModal.classList.add("hidden");
  modalBody.innerHTML = "";
}

modalClose.addEventListener("click", closeModal);
lobbyModal.addEventListener("click", (e) => {
  if (e.target === lobbyModal) closeModal();
});

settingsBtn.addEventListener("click", () => {
  openModal(
    "Settings",
    `<p>Mouse to steer. Hold click or Space to boost.</p>
     <p style="margin-top:10px">Touch devices: use the on-screen Boost button.</p>
     <p style="margin-top:10px;opacity:0.7">More settings coming soon.</p>`
  );
});

customizeBtn.addEventListener("click", () => {
  const grid = SKINS.map((s) => {
    const active = s.name === selectedSkinName ? " active" : "";
    const dots = s.colors
      .slice(0, 4)
      .map((c) => `<span style="background:${c}"></span>`)
      .join("");
    return `<button type="button" class="skin-swatch${active}" data-skin="${escapeHtml(s.name)}">
      <span class="skin-dots">${dots}</span>
      ${escapeHtml(s.name)}
    </button>`;
  }).join("");

  openModal("Customize Snake", `<p>Pick a skin for your next run.</p><div class="skin-grid">${grid}</div>`);

  modalBody.querySelectorAll(".skin-swatch").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedSkinName = btn.dataset.skin;
      localStorage.setItem("scuta_skin", selectedSkinName);
      modalBody.querySelectorAll(".skin-swatch").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });
});

serverBtn.addEventListener("click", () => {
  openModal(
    "Choose Server",
    `<p>Select a server region.</p>
     <button type="button" class="server-option active" data-server="8080">
       <span>Local Offline</span><span>8080</span>
     </button>
     <button type="button" class="server-option" data-server="eu" disabled style="opacity:0.45;cursor:not-allowed">
       <span>Europe</span><span>Soon</span>
     </button>
     <button type="button" class="server-option" data-server="na" disabled style="opacity:0.45;cursor:not-allowed">
       <span>North America</span><span>Soon</span>
     </button>`
  );

  modalBody.querySelectorAll(".server-option:not([disabled])").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedServer = btn.dataset.server;
      localStorage.setItem("scuta_server", selectedServer);
      serverLabel.textContent = `server ${selectedServer}`;
      modalBody.querySelectorAll(".server-option").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });
});

function pointerPos(e) {
  if (e.touches && e.touches[0]) {
    return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  return { x: e.clientX, y: e.clientY };
}

window.addEventListener("mousemove", (e) => {
  const p = pointerPos(e);
  game.setMouse(p.x, p.y);
});

window.addEventListener(
  "touchmove",
  (e) => {
    e.preventDefault();
    const p = pointerPos(e);
    game.setMouse(p.x, p.y);
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
