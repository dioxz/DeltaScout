let isEnabled = true;

const toggleBtn = document.getElementById("toggleBtn");
const resetBtn = document.getElementById("resetBtn");
const statusDot = document.getElementById("statusDot");

// Load saved state
chrome.storage.local.get("enabled", (data) => {
  isEnabled = data.enabled !== false;
  updateUI();
});

function updateUI() {
  if (isEnabled) {
    toggleBtn.textContent = "⏸ PAUSE";
    toggleBtn.className = "";
    statusDot.textContent = "● ACTIVE";
    statusDot.className = "status-dot on";
  } else {
    toggleBtn.textContent = "▶ RESUME";
    toggleBtn.className = "off";
    statusDot.textContent = "○ PAUSED";
    statusDot.className = "status-dot off";
  }
}

function sendToActiveTab(msg) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, msg);
  });
}

toggleBtn.addEventListener("click", () => {
  isEnabled = !isEnabled;
  chrome.storage.local.set({ enabled: isEnabled });
  sendToActiveTab({ type: "SET_ENABLED", value: isEnabled });
  updateUI();
});

resetBtn.addEventListener("click", () => {
  sendToActiveTab({ type: "RESET" });
});
