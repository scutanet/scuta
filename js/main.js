import { Game } from "./game.js";

const canvas = document.getElementById("game");
const minimap = document.getElementById("minimap");
const menu = document.getElementById("menu");
const hud = document.getElementById("hud");
const death = document.getElementById("death");
const nickInput = document.getElementById("nick");
const playBtn = document.getElementById("play-btn");
const continueBtn = document.getElementById("continue-btn");
const lengthEl = document.getElementById("length");
const rankEl = document.getElementById("rank");
const lbList = document.getElementById("lb-list");
const finalLength = document.getElementById("final-length");

const savedNick = localStorage.getItem("scuta_nick") || "";
nickInput.value = savedNick;

const game = new Game({
  canvas,
  minimap,
  onDeath(len) {
    hud.classList.add("hidden");
    finalLength.textContent = String(len);
    death.classList.remove("hidden");
  },
  onHud({ length, rank, leaderboard }) {
    lengthEl.textContent = String(length);
    rankEl.textContent = rank;
    lbList.innerHTML = leaderboard
      .map(
        (e, i) =>
          `<li class="${e.you ? "you" : ""}"><span class="lb-name">${i + 1}. ${escapeHtml(
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
  menu.classList.add("hidden");
  death.classList.add("hidden");
  hud.classList.remove("hidden");
  game.start(nick);
}

playBtn.addEventListener("click", begin);
nickInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") begin();
});

continueBtn.addEventListener("click", () => {
  death.classList.add("hidden");
  menu.classList.remove("hidden");
  nickInput.focus();
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
  if (e.button === 0) game.setBoost(true);
});
window.addEventListener("mouseup", () => game.setBoost(false));
window.addEventListener("mouseleave", () => game.setBoost(false));

window.addEventListener(
  "touchstart",
  (e) => {
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
  if (e.code === "Space") {
    e.preventDefault();
    game.setBoost(true);
  }
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space") game.setBoost(false);
});

nickInput.focus();
