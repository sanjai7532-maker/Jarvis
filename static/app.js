// Configuration
const WAKE_WORD = "jarvis";
const WEBSOCKET_RETRY_INTERVAL = 5000;
const STATS_RINGS = {
    cpu: { ring: null, text: null },
    ram: { ring: null, text: null },
    disk: { ring: null, text: null }
};

// UI Elements
const wsStatus = document.getElementById("ws-status");
const aiStatus = document.getElementById("ai-status");
const clockEl = document.getElementById("hud-clock");
const sysStateEl = document.getElementById("sys-state");
const liveSpeechEl = document.getElementById("live-speech");
const chatLogEl = document.getElementById("chat-log");
const manualInputEl = document.getElementById("manual-input");
const sendBtn = document.getElementById("send-btn");
const micToggleBtn = document.getElementById("mic-toggle-btn");
const langSelect = document.getElementById("lang-select");
const voiceSelect = document.getElementById("voice-select");
const voicePitch = document.getElementById("voice-pitch");
const screenshotBox = document.getElementById("screenshot-box");
const screenshotPreview = document.getElementById("screenshot-preview");
const closeScreenshotBtn = document.getElementById("close-screenshot");
const installAppBtn = document.getElementById("install-app-btn");

// HUD Core Settings Elements
const openSettingsBtn = document.getElementById("open-settings-btn");
const closeSettingsBtn = document.getElementById("close-settings-btn");
const settingsModal = document.getElementById("settings-modal");
const backendUrlInput = document.getElementById("backend-url-input");
const testBackendBtn = document.getElementById("test-backend-btn");
const backendStatusMsg = document.getElementById("backend-status-msg");
const geminiKeyInput = document.getElementById("gemini-key-input");
const saveGeminiBtn = document.getElementById("save-gemini-btn");
const geminiStatusMsg = document.getElementById("gemini-status-msg");
const saveBackendSettingsBtn = document.getElementById("save-backend-settings-btn");

// Web Audio API Context for synthesizer
let audioCtx = null;

// Speech APIs
let recognition = null;
let synthesis = window.speechSynthesis;
let selectedVoice = null;
let isMicActive = true;

// App States: 'STANDBY' | 'LISTENING' | 'PROCESSING' | 'SPEAKING'
let appState = 'STANDBY';
let socket = null;
let deferredInstallPrompt = null;

// Audio visualizer properties
const canvas = document.getElementById("waveform-canvas");
const ctx = canvas.getContext("2d");
let animationFrameId = null;
let wavePhase = 0;

// Initialize
window.addEventListener("DOMContentLoaded", () => {
    initClock();
    initStatsRings();
    initWebSocket();
    initSpeechSynthesis();
    initSpeechRecognition();
    initEventListeners();
    startWaveVisualizer();
    
    // Add startup greeting
    addLog("System initialized. Awaiting commands, Sir.", "jarvis");
});

// Clock
function initClock() {
    updateClock();
    setInterval(updateClock, 1000);
}

function updateClock() {
    const now = new Date();
    let hours = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // the hour '0' should be '12'
    clockEl.textContent = `${String(hours).padStart(2, '0')}:${minutes}:${seconds} ${ampm}`;
}

// Stats Rings
function initStatsRings() {
    STATS_RINGS.cpu.ring = document.getElementById("cpu-ring");
    STATS_RINGS.cpu.text = document.getElementById("cpu-val");
    STATS_RINGS.ram.ring = document.getElementById("ram-ring");
    STATS_RINGS.ram.text = document.getElementById("ram-val");
    STATS_RINGS.disk.ring = document.getElementById("disk-ring");
    STATS_RINGS.disk.text = document.getElementById("disk-val");
    
    // Set default dashoffset
    Object.values(STATS_RINGS).forEach(item => {
        if (item.ring) {
            item.ring.style.strokeDashoffset = 251.2;
        }
    });
}

function setRingProgress(item, percent) {
    const ring = STATS_RINGS[item].ring;
    const text = STATS_RINGS[item].text;
    if (!ring) return;
    
    const radius = ring.r.baseVal.value;
    const circumference = 2 * Math.PI * radius; // 251.2 for r=40
    
    ring.style.strokeDasharray = `${circumference} ${circumference}`;
    const offset = circumference - (percent / 100 * circumference);
    ring.style.strokeDashoffset = offset;
    
    text.textContent = `${Math.round(percent)}%`;
}

// Dynamic Backend URL resolution:
// Defaults to localStorage override, or http://localhost:8000 when opened via LiveServer/Vite/file:, or window.location.origin
function getBackendUrl() {
    const saved = localStorage.getItem("jarvis_backend_url");
    if (saved && saved.trim()) {
        return saved.trim().replace(/\/+$/, "");
    }
    // If running on a different port than 8000 (e.g. 5500 Live Server, 3000 Vite) or file://, target backend on 8000
    if (window.location.protocol === "file:" || (window.location.port && window.location.port !== "8000")) {
        return "http://localhost:8000";
    }
    return window.location.origin || "http://localhost:8000";
}

function getWsUrl() {
    try {
        const backend = getBackendUrl();
        const parsed = new URL(backend);
        const wsProto = parsed.protocol === "https:" ? "wss:" : "ws:";
        return `${wsProto}//${parsed.host}/ws/stats`;
    } catch (e) {
        return "ws://localhost:8000/ws/stats";
    }
}

let wsRetryTimeout = null;

// WebSocket connection for real-time stats
function initWebSocket() {
    if (wsRetryTimeout) {
        clearTimeout(wsRetryTimeout);
        wsRetryTimeout = null;
    }
    
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        try { socket.close(); } catch (e) {}
    }
    
    const wsUrl = getWsUrl();
    console.log("Connecting to J.A.R.V.I.S. WebSocket:", wsUrl);
    
    try {
        socket = new WebSocket(wsUrl);
    } catch (err) {
        console.warn("Failed to instantiate WebSocket:", err);
        handleWsOffline();
        return;
    }
    
    socket.onopen = () => {
        wsStatus.classList.add("online");
        wsStatus.querySelector(".status-text").textContent = "CORE ONLINE";
    };
    
    socket.onmessage = (event) => {
        try {
            const stats = JSON.parse(event.data);
            updateUIStats(stats);
        } catch (e) {
            console.error("Error parsing stats payload:", e);
        }
    };
    
    socket.onclose = () => {
        handleWsOffline();
    };
    
    socket.onerror = (err) => {
        console.warn("WebSocket link error:", err);
        handleWsOffline();
    };
}

function handleWsOffline() {
    wsStatus.classList.remove("online");
    wsStatus.querySelector(".status-text").textContent = "CORE OFFLINE (CLICK TO LINK)";
    if (!wsRetryTimeout) {
        wsRetryTimeout = setTimeout(initWebSocket, WEBSOCKET_RETRY_INTERVAL);
    }
}

function updateUIStats(stats) {
    setRingProgress("cpu", stats.cpu);
    setRingProgress("ram", stats.ram);
    setRingProgress("disk", stats.disk);
    
    // Update subtext
    document.getElementById("ram-sub").textContent = `${stats.ram_used} GB / ${stats.ram_total} GB`;
    document.getElementById("uptime-val").textContent = stats.uptime.toUpperCase();
    
    // Update AI state indicators
    if (stats.ai_active) {
        aiStatus.classList.add("ai-active");
        aiStatus.querySelector(".status-text").textContent = "AI BRAIN ONLINE";
    } else {
        aiStatus.classList.remove("ai-active");
        aiStatus.querySelector(".status-text").textContent = "AI CORE LOCAL";
    }
}

// Language & Voice Utilities
function isTamilText(text) {
    if (!text) return false;
    // Check for Tamil Unicode block U+0B80 - U+0BFF
    return /[\u0B80-\u0BFF]/.test(text);
}

function findTamilVoice() {
    if (!synthesis) return null;
    const voices = synthesis.getVoices();
    return voices.find(v => 
        (v.lang && (v.lang.toLowerCase().startsWith("ta") || v.lang.toLowerCase().includes("ta-in") || v.lang.toLowerCase().includes("ta_in"))) ||
        (v.name && (v.name.toLowerCase().includes("tamil") || v.name.toLowerCase().includes("valluvar") || v.name.toLowerCase().includes("pallavi")))
    ) || null;
}

// Text Speech Synthesis (TTS)
function initSpeechSynthesis() {
    if (!synthesis) return;
    
    // Load voices
    const populateVoices = () => {
        const voices = synthesis.getVoices();
        voiceSelect.innerHTML = '';
        
        // Filter English, Tamil, and local system voices
        const filteredVoices = voices.filter(v => 
            v.lang.toLowerCase().includes("en") || 
            v.lang.toLowerCase().includes("ta") || 
            v.name.toLowerCase().includes("tamil")
        );
        const list = filteredVoices.length > 0 ? filteredVoices : voices;
        
        list.forEach((voice) => {
            const option = document.createElement("option");
            option.value = voice.name;
            const isTamil = voice.lang.toLowerCase().includes("ta") || voice.name.toLowerCase().includes("tamil");
            option.textContent = `${isTamil ? "🇮🇳 [Tamil] " : ""}${voice.name} (${voice.lang})`;
            
            // Auto-select a nice British voice if available (like Google UK English or Microsoft Hazel)
            if (!selectedVoice && (voice.name.toLowerCase().includes("uk") || voice.name.toLowerCase().includes("great britain") || voice.name.toLowerCase().includes("hazel") || voice.name.toLowerCase().includes("google uk"))) {
                option.selected = true;
                selectedVoice = voice;
            }
            voiceSelect.appendChild(option);
        });
        
        if (!selectedVoice && list.length > 0) {
            selectedVoice = list[0];
        }
    };
    
    populateVoices();
    if (synthesis.onvoiceschanged !== undefined) {
        synthesis.onvoiceschanged = populateVoices;
    }
    
    voiceSelect.addEventListener("change", () => {
        const voices = synthesis.getVoices();
        selectedVoice = voices.find(v => v.name === voiceSelect.value);
    });
}

function speakText(text) {
    if (!synthesis || !text) return;
    
    // Stop recognition while speaking to avoid J.A.R.V.I.S hearing himself
    if (recognition && isMicActive) {
        try { recognition.stop(); } catch (e) {}
    }
    
    // Cancel ongoing speech
    synthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    const hasTamil = isTamilText(text);
    const isTamilSelected = langSelect && langSelect.value === "ta-IN";
    const tamilVoice = findTamilVoice();
    
    // If text contains Tamil characters or Tamil is selected, route to Tamil voice
    if (hasTamil || isTamilSelected) {
        utterance.lang = "ta-IN";
        if (tamilVoice) {
            utterance.voice = tamilVoice;
            console.log("J.A.R.V.I.S. speaking via Tamil Voice:", tamilVoice.name);
        } else {
            console.warn("J.A.R.V.I.S.: No native Tamil voice found. Requesting ta-IN engine.");
        }
    } else {
        if (selectedVoice) {
            utterance.voice = selectedVoice;
            utterance.lang = selectedVoice.lang || "en-GB";
        } else {
            utterance.lang = "en-GB";
        }
    }
    
    utterance.rate = parseFloat(voicePitch.value) || 1.0;
    
    utterance.onstart = () => {
        setAppState('SPEAKING');
    };
    
    utterance.onend = () => {
        setAppState('STANDBY');
        // Restart speech recognition if mic is active
        if (isMicActive && recognition) {
            try {
                recognition.start();
            } catch (e) {
                // Ignore error if already running
            }
        }
    };
    
    utterance.onerror = (e) => {
        console.error("Speech Synthesis Error:", e);
        // Fallback: If voice error occurred due to language incompatibility, try default system voice
        if (e.error === "language-unavailable" || e.error === "voice-unavailable") {
            try {
                const fallbackUtterance = new SpeechSynthesisUtterance(text);
                fallbackUtterance.rate = parseFloat(voicePitch.value) || 1.0;
                synthesis.speak(fallbackUtterance);
                return;
            } catch (err) {}
        }
        setAppState('STANDBY');
        if (isMicActive && recognition) {
            try { recognition.start(); } catch (err) {}
        }
    };
    
    synthesis.speak(utterance);
}

// Speech Recognition (STT)
function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        liveSpeechEl.textContent = "Voice speech recognition not supported by browser. Manual console input active.";
        micToggleBtn.classList.remove("active");
        micToggleBtn.disabled = true;
        isMicActive = false;
        return;
    }
    
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    
    function setRecognitionLanguage() {
        const val = langSelect ? langSelect.value : "auto";
        if (val === "ta-IN") {
            recognition.lang = "ta-IN";
        } else if (val === "en-IN") {
            recognition.lang = "en-IN";
        } else if (val === "en-US") {
            recognition.lang = "en-US";
        } else {
            // Auto mode: default to en-IN / bilingual accent which recognizes Tamil & English smoothly
            recognition.lang = "en-IN";
        }
    }
    setRecognitionLanguage();
    
    if (langSelect) {
        langSelect.addEventListener("change", () => {
            setRecognitionLanguage();
            if (isMicActive && appState !== 'SPEAKING') {
                try {
                    recognition.stop();
                } catch (e) {}
            }
        });
    }
    
    let silenceTimeout = null;
    let finalTranscript = "";
    const wakeWords = [WAKE_WORD, "jarvis", "ஜார்விஸ்", "சார்விஸ்", "ஜாவிஸ்"];
    
    recognition.onstart = () => {
        console.log("Speech recognition active with language:", recognition.lang);
        if (appState === 'STANDBY') {
            const isTa = recognition.lang === "ta-IN";
            liveSpeechEl.textContent = isTa 
                ? 'காத்திருக்கிறது: "ஜார்விஸ்" என்று அழைக்கவும்...' 
                : 'Listening for wake word: "Jarvis"...';
        }
    };
    
    recognition.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        if (event.error === 'not-allowed') {
            liveSpeechEl.textContent = "Microphone access denied. Enable mic permissions.";
            setMicActive(false);
        }
    };
    
    recognition.onend = () => {
        console.log("Speech recognition stopped.");
        // Auto restart if mic toggled active and not in speaking state
        if (isMicActive && appState !== 'SPEAKING') {
            try {
                recognition.start();
            } catch (e) {
                console.error("Error restarting recognition:", e);
            }
        }
    };
    
    recognition.onresult = (event) => {
        let interimTranscript = "";
        
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }
        
        const fullTranscript = (finalTranscript + interimTranscript).trim().toLowerCase();
        
        if (appState === 'STANDBY') {
            liveSpeechEl.textContent = `Hearing: "${fullTranscript}"`;
            
            // Check for Wake Word in English and Tamil
            const isWake = wakeWords.some(w => fullTranscript.includes(w));
            if (isWake) {
                playBeepSound(1400, 0.08);
                setTimeout(() => playBeepSound(1800, 0.1), 100);
                
                setAppState('LISTENING');
                liveSpeechEl.textContent = "Listening for command, Sir...";
                finalTranscript = "";
                interimTranscript = "";
                
                // Clear any previous silence timeout
                if (silenceTimeout) clearTimeout(silenceTimeout);
                
                // Set a timeout to return to STANDBY if user does not speak a command within 6 seconds
                silenceTimeout = setTimeout(() => {
                    if (appState === 'LISTENING') {
                        setAppState('STANDBY');
                        liveSpeechEl.textContent = 'Standby timeout. Say "Jarvis" to wake.';
                        finalTranscript = "";
                    }
                }, 6000);
            }
        } else if (appState === 'LISTENING') {
            // Display command in progress
            let commandCandidate = fullTranscript;
            for (const w of wakeWords) {
                if (commandCandidate.includes(w)) {
                    commandCandidate = commandCandidate.split(w).pop().trim();
                    break;
                }
            }
            if (commandCandidate) {
                liveSpeechEl.textContent = `Command: "${commandCandidate}"`;
                
                // Debounce silence to submit command
                if (silenceTimeout) clearTimeout(silenceTimeout);
                
                silenceTimeout = setTimeout(() => {
                    if (commandCandidate.length > 1) {
                        submitCommand(commandCandidate);
                        finalTranscript = "";
                    }
                }, 1500); // 1.5 seconds of silence submits the command
            }
        }
    };
    
    // Start initial recognition
    if (isMicActive) {
        try {
            recognition.start();
        } catch (e) {
            console.error("Speech Recognition startup fail:", e);
        }
    }
}

// Process State Transformations
function setAppState(state) {
    appState = state;
    sysStateEl.textContent = state;
    
    // Modify body class for styling animations
    document.body.className = "";
    document.body.classList.add(state.toLowerCase());
    
    if (state === 'STANDBY') {
        liveSpeechEl.textContent = 'Listening for wake word: "Jarvis"...';
    } else if (state === 'PROCESSING') {
        liveSpeechEl.textContent = 'Decrypting parameters...';
    }
}

// Command submission
async function submitCommand(commandText) {
    if (!commandText || commandText.trim() === "") return;
    
    addLog(commandText, "user");
    setAppState('PROCESSING');
    
    const backend = getBackendUrl();
    try {
        const response = await fetch(`${backend}/api/command`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                command: commandText,
                user_name: "Sir"
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}`);
        }
        
        const data = await response.json();
        
        // Execute frontend-specific actions
        if (data.action === "screenshot" && data.image_url) {
            showScreenshot(data.image_url);
        }
        
        // Log & speak result
        addLog(data.response, "jarvis");
        speakText(data.response);
        
    } catch (err) {
        console.error("Command execution error:", err);
        setAppState('STANDBY');
        let errMsg = "Apologies, Sir. I encountered a pipeline failure executing that instruction.";
        if (err.name === "TypeError" || (err.message && err.message.toLowerCase().includes("fetch"))) {
            errMsg = `Apologies, Sir. The Core Server appears unreachable at ${backend}. Please ensure the server is running on that port.`;
        } else if (err.message && err.message.includes("HTTP error")) {
            errMsg = `Apologies, Sir. The neural pipeline encountered a server response error (${err.message}).`;
        }
        addLog(errMsg, "jarvis");
        speakText(errMsg);
    }
}

// Visual Screen Controls
function showScreenshot(url) {
    const backend = getBackendUrl();
    const fullUrl = url.startsWith("http") ? url : `${backend}${url.startsWith("/") ? "" : "/"}${url}`;
    screenshotPreview.src = fullUrl;
    screenshotBox.classList.remove("hidden");
}

// Chat log updater
function addLog(text, sender) {
    const msg = document.createElement("div");
    msg.classList.add("chat-msg", sender.toLowerCase());
    
    const senderTag = document.createElement("span");
    senderTag.classList.add("msg-sender");
    senderTag.textContent = sender === "user" ? "[USER]" : "[J.A.R.V.I.S]";
    
    const contentTag = document.createElement("span");
    contentTag.classList.add("msg-content");
    contentTag.textContent = text;
    
    msg.appendChild(senderTag);
    msg.appendChild(contentTag);
    
    chatLogEl.appendChild(msg);
    chatLogEl.scrollTop = chatLogEl.scrollHeight;
}

// Event Listeners
function initEventListeners() {
    // Send manual input
    sendBtn.addEventListener("click", () => {
        handleManualSubmit();
    });
    
    manualInputEl.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            handleManualSubmit();
        }
    });
    
    // Toggle Microphone
    micToggleBtn.addEventListener("click", () => {
        setMicActive(!isMicActive);
    });
    
    // Close Screenshot Display
    closeScreenshotBtn.addEventListener("click", () => {
        screenshotBox.classList.add("hidden");
    });

    // Core Settings Modal Controls
    if (openSettingsBtn) {
        openSettingsBtn.addEventListener("click", openSettings);
    }
    if (wsStatus) {
        wsStatus.addEventListener("click", openSettings);
    }
    if (aiStatus) {
        aiStatus.addEventListener("click", openSettings);
    }
    if (closeSettingsBtn) {
        closeSettingsBtn.addEventListener("click", closeSettings);
    }
    if (settingsModal) {
        settingsModal.addEventListener("click", (e) => {
            if (e.target === settingsModal) closeSettings();
        });
    }

    if (testBackendBtn) {
        testBackendBtn.addEventListener("click", () => {
            const candidateUrl = (backendUrlInput.value || "").trim() || getBackendUrl();
            testBackendHealth(candidateUrl);
        });
    }

    if (saveBackendSettingsBtn) {
        saveBackendSettingsBtn.addEventListener("click", () => {
            const raw = (backendUrlInput.value || "").trim();
            if (raw) {
                localStorage.setItem("jarvis_backend_url", raw.replace(/\/+$/, ""));
            } else {
                localStorage.removeItem("jarvis_backend_url");
            }
            initWebSocket();
            testBackendHealth(getBackendUrl());
            closeSettings();
            addLog("Core link updated to: " + getBackendUrl(), "system");
        });
    }

    if (saveGeminiBtn) {
        saveGeminiBtn.addEventListener("click", handleSaveGeminiKey);
    }
}

function openSettings() {
    if (!settingsModal) return;
    backendUrlInput.value = getBackendUrl();
    settingsModal.classList.remove("hidden");
    testBackendHealth(getBackendUrl());
    fetchGeminiStatus();
}

function closeSettings() {
    if (settingsModal) settingsModal.classList.add("hidden");
}

async function testBackendHealth(targetUrl) {
    if (!backendStatusMsg) return;
    const cleanUrl = targetUrl.replace(/\/+$/, "");
    backendStatusMsg.className = "status-indicator-bar";
    backendStatusMsg.querySelector(".text").textContent = "Pinging server link...";
    
    const startTime = performance.now();
    try {
        const res = await fetch(`${cleanUrl}/api/health`, { method: "GET" });
        const latency = Math.round(performance.now() - startTime);
        if (res.ok) {
            const data = await res.json();
            backendStatusMsg.className = "status-indicator-bar online";
            backendStatusMsg.querySelector(".text").textContent = `ONLINE (${latency}ms) — ${data.server || "FastAPI"} ${data.version || "5.0"}`;
        } else {
            backendStatusMsg.className = "status-indicator-bar offline";
            backendStatusMsg.querySelector(".text").textContent = `Server responded with HTTP ${res.status}`;
        }
    } catch (e) {
        backendStatusMsg.className = "status-indicator-bar offline";
        backendStatusMsg.querySelector(".text").textContent = `UNREACHABLE — Please verify server.py is running on port 8000`;
    }
}

async function fetchGeminiStatus() {
    if (!geminiStatusMsg) return;
    const backend = getBackendUrl();
    try {
        const res = await fetch(`${backend}/api/config/gemini`);
        if (res.ok) {
            const data = await res.json();
            if (data.is_ai_enabled) {
                geminiStatusMsg.className = "status-indicator-bar online";
                geminiStatusMsg.querySelector(".text").textContent = (data.provider ? `${data.provider} Neural Active` : "AI Neural Active (Configured)");
            } else {
                geminiStatusMsg.className = "status-indicator-bar";
                geminiStatusMsg.querySelector(".text").textContent = "Local Automation Mode (Ready for voice & desktop automation)";
            }
        }
    } catch (e) {
        // Core offline
    }
}

async function handleSaveGeminiKey() {
    const key = geminiKeyInput.value.trim();
    if (!key) {
        alert("Please enter a valid Gemini API key, Sir.");
        return;
    }
    const backend = getBackendUrl();
    geminiStatusMsg.className = "status-indicator-bar";
    geminiStatusMsg.querySelector(".text").textContent = "Validating and linking Gemini API key...";
    
    try {
        const res = await fetch(`${backend}/api/config/gemini`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ api_key: key })
        });
        const data = await res.json();
        if (data.success) {
            geminiStatusMsg.className = "status-indicator-bar online";
            geminiStatusMsg.querySelector(".text").textContent = "Key linked successfully! Conversational AI active.";
            geminiKeyInput.value = "";
            addLog("Gemini AI configuration verified and online, Sir.", "jarvis");
        } else {
            geminiStatusMsg.className = "status-indicator-bar offline";
            geminiStatusMsg.querySelector(".text").textContent = data.message || "Key validation failed.";
        }
    } catch (e) {
        geminiStatusMsg.className = "status-indicator-bar offline";
        geminiStatusMsg.querySelector(".text").textContent = "Failed to communicate with Core server.";
    }
}

function handleManualSubmit() {
    const val = manualInputEl.value.trim();
    if (val !== "") {
        submitCommand(val);
        manualInputEl.value = "";
    }
}

function setMicActive(active) {
    isMicActive = active;
    if (active) {
        micToggleBtn.classList.add("active");
        if (recognition) {
            try {
                recognition.start();
            } catch (e) {}
        }
        liveSpeechEl.textContent = 'Microphone enabled. Listening for "Jarvis"...';
    } else {
        micToggleBtn.classList.remove("active");
        if (recognition) {
            recognition.stop();
        }
        liveSpeechEl.textContent = 'Microphone muted. Send commands via manual console.';
    }
}

// Cyber Tech Beep Generator (Web Audio API)
function playBeepSound(frequency, duration) {
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        
        gainNode.gain.setValueAtTime(0.04, audioCtx.currentTime); // Low volume beep
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
        
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + duration);
    } catch (e) {
        console.warn("Audio beeper context initialization blocked or failed:", e);
    }
}

// Waveform visualizer Canvas (Math simulation)
function startWaveVisualizer() {
    function drawWave() {
        animationFrameId = requestAnimationFrame(drawWave);
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.lineWidth = 1.5;
        
        let waveCount = 3;
        let baseAmplitude = 0;
        let speed = 0;
        let strokeColor = "#00f3ff";
        
        // Define wave parameters depending on system state
        if (appState === 'STANDBY') {
            baseAmplitude = 3;
            speed = 0.02;
            waveCount = 2;
            ctx.strokeStyle = "rgba(0, 243, 255, 0.3)";
        } else if (appState === 'LISTENING') {
            baseAmplitude = 12;
            speed = 0.15;
            waveCount = 4;
            ctx.strokeStyle = "rgba(57, 255, 20, 0.7)";
        } else if (appState === 'PROCESSING') {
            baseAmplitude = 6;
            speed = 0.3;
            waveCount = 5;
            ctx.strokeStyle = "rgba(0, 243, 255, 0.8)";
        } else if (appState === 'SPEAKING') {
            baseAmplitude = 24;
            speed = 0.08;
            waveCount = 3;
            ctx.strokeStyle = "rgba(0, 243, 255, 0.9)";
        }
        
        wavePhase += speed;
        
        // Draw multiple overlapping sine waves
        for (let w = 0; w < waveCount; w++) {
            ctx.beginPath();
            
            // Each wave layer has different offset, frequency, and scale
            const amplitude = baseAmplitude * (1 - w * 0.25);
            const frequency = 0.015 + (w * 0.005);
            
            // Opacity decreases for outer waves
            ctx.strokeStyle = appState === 'LISTENING' 
                ? `rgba(57, 255, 20, ${0.8 - w * 0.2})` 
                : `rgba(0, 243, 255, ${0.8 - w * 0.2})`;
            
            for (let x = 0; x < canvas.width; x++) {
                // Apply a bell curve window so waves taper to zero at boundaries
                const windowScale = Math.sin((x / canvas.width) * Math.PI);
                const y = (canvas.height / 2) + Math.sin(x * frequency + wavePhase + w) * amplitude * windowScale;
                
                if (x === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
            ctx.stroke();
        }
    }
    
    drawWave();
}

// PWA Service Worker (Background)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch((error) => {
            console.error("Service worker registration failed:", error);
        });
    });
}

window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    installAppBtn.classList.remove("hidden");
});

installAppBtn.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    await deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installAppBtn.classList.add("hidden");
    if (choice.outcome === "accepted") {
        console.info("J.A.R.V.I.S. app installed.");
    }
});

window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    installAppBtn.classList.add("hidden");
});
