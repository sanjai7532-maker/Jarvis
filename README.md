# J.A.R.V.I.S. AI Assistant 🤖

> **Just A Rather Very Intelligent System** — A futuristic cyberpunk voice and automation AI assistant inspired by Iron Man's J.A.R.V.I.S., built with **FastAPI**, **Groq (Llama 3 / Qwen)**, **Google Gemini**, and a real-time Cyberpunk Web HUD.

---

## ✨ Features

- 🎙️ **Voice & Speech Recognition**: Continuous hands-free listening with `"Jarvis"` wake-word detection or manual input console.
- ⚡ **Ultra-Fast AI Brain**: Powered by **Groq** (`qwen/qwen3.8-27b`, `openai/gpt-oss-120b`, `llama-3.1`) with seamless fallback to **Google Gemini**.
- 🖥️ **Futuristic Cyberpunk HUD**: Real-time animated audio waveforms, system diagnostics dials, and sci-fi aesthetic interface.
- 💻 **PC Automation & Controls**:
  - Screenshot capture to dashboard
  - Workstation locking (`LockWorkStation`)
  - Volume control (Mute, Volume Up/Down)
  - Desktop minimization
  - App launchers (Notepad, Calculator, Command Prompt, Explorer)
  - Web navigation and Google / Wikipedia searches
- 📊 **Real-Time Diagnostics**: Live WebSocket streaming of CPU load, RAM usage, disk storage, and uptime.
- 🌐 **Deploy Ready**: Includes `Dockerfile`, `render.yaml`, and `Procfile` for one-click cloud hosting.

---

## 🚀 Quick Start (Local Setup)

### 1. Clone the repository
```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
cd YOUR_REPOSITORY
```

### 2. Install dependencies
```bash
pip install -r requirements.txt
```

### 3. Configure API Keys
Copy the example environment file:
```bash
cp .env.example .env
```
Open `.env` and add your free **[Groq API Key](https://console.groq.com/keys)** (or Gemini Key).

### 4. Start J.A.R.V.I.S.
- **Windows (Double-click):** Run `run_jarvis.bat`
- **Manual Command:**
  ```bash
  python server.py
  ```

Open your browser to: **[http://localhost:8000](http://localhost:8000)**

---

## 🛠️ Tech Stack

- **Backend**: Python 3.12, FastAPI, Uvicorn, WebSockets
- **AI Engine**: Groq SDK, Google GenAI SDK
- **Automation**: PyAutoGUI, Psutil
- **Frontend**: Vanilla JavaScript, HTML5 Web Audio API, Canvas Animations, CSS3 Cyberpunk Grid

---

## 🔒 Security
Sensitive credentials (`.env`) are strictly ignored via `.gitignore`. Always keep your API keys confidential.

