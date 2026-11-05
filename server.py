import os
import re
import time
import subprocess
import webbrowser
import asyncio
from typing import Dict, Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import psutil
try:
    import pyautogui
except Exception as e:
    pyautogui = None
    print(f"J.A.R.V.I.S. automation warning: Desktop controls unavailable: {e}")
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Initialize AI Providers (Groq & Gemini)
from google import genai
try:
    from groq import Groq
except ImportError:
    Groq = None

gemini_client: genai.Client | None = None
groq_client: Any | None = None
is_ai_enabled: bool = False
active_ai_provider: str = "None"

def get_best_groq_model(client: Any) -> str:
    """
    Dynamically identifies the best active chat model available on the user's Groq key.
    """
    try:
        models_data = client.models.list().data
        active_ids = [m.id for m in models_data if getattr(m, 'active', True)]
        preferred = [
            "qwen/qwen3.8-27b",
            "openai/gpt-oss-120b",
            "openai/gpt-oss-20b",
            "llama-3.3-70b-versatile",
            "llama-3.1-8b-instant",
            "llama-3.1-70b-versatile",
            "llama3-8b-8192",
            "llama3-70b-8192",
            "mixtral-8x7b-32768",
            "gemma2-9b-it"
        ]
        for p in preferred:
            if p in active_ids:
                return p
        for m_id in active_ids:
            if not any(skip in m_id.lower() for skip in ["whisper", "tts", "guard", "vision", "embed"]):
                return m_id
    except Exception as e:
        print(f"Groq models.list() check: {e}")
    return "llama-3.1-8b-instant"

def ensure_ai_configured() -> bool:
    global is_ai_enabled, gemini_client, groq_client, active_ai_provider
    load_dotenv(override=True)
    
    # 1. Check Groq API Key (Preferred free provider)
    groq_key = os.getenv("GROQ_API_KEY", "").strip()
    if groq_key and groq_key != "YOUR_GROQ_API_KEY_HERE" and Groq is not None:
        try:
            groq_client = Groq(api_key=groq_key)
            best_model = get_best_groq_model(groq_client)
            is_ai_enabled = True
            active_ai_provider = f"Groq ({best_model})"
            return True
        except Exception as e:
            print(f"J.A.R.V.I.S. Brain Warning: Failed to configure Groq API. Error: {e}")
            groq_client = None

    # 2. Check Gemini API Key
    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
    if gemini_key and gemini_key != "YOUR_GEMINI_API_KEY_HERE" and not gemini_key.startswith("AQ."):
        try:
            gemini_client = genai.Client(api_key=gemini_key)
            is_ai_enabled = True
            active_ai_provider = "Google Gemini"
            return True
        except Exception as e:
            print(f"J.A.R.V.I.S. Brain Warning: Failed to configure Gemini API. Error: {e}")
            gemini_client = None

    is_ai_enabled = False
    active_ai_provider = "None"
    return False

def ensure_gemini_configured() -> bool:
    return ensure_ai_configured()

# Initial configuration check
if ensure_ai_configured():
    print(f"J.A.R.V.I.S. Brain: AI Provider configured successfully: {active_ai_provider}")
else:
    print("J.A.R.V.I.S. Brain Warning: No valid AI API Key found. Running in Automation-Only Mode.")

app = FastAPI(title="J.A.R.V.I.S. Automation Server")
ENABLE_LOCAL_AUTOMATION = os.getenv("ENABLE_LOCAL_AUTOMATION", "true").lower() == "true"

# Allow CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory conversation history for J.A.R.V.I.S.
chat_history = []

class CommandRequest(BaseModel):
    command: str
    user_name: str = "Sir"

# System Prompt to define JARVIS persona
SYSTEM_INSTRUCTION = """
You are J.A.R.V.I.S. (Just A Rather Very Intelligent System), Tony Stark's legendary AI assistant operating under Version 5 Protocol. 
You are highly intelligent, sophisticated, slightly sarcastic but extremely polite, and speak with a subtle British gentlemanly tone. 
You address the user as "Sir" or "Ma'am" (default to Sir unless told otherwise). 
Language Handling:
- If the user speaks or writes in Tamil (native script like 'வணக்கம்' or Tanglish like 'vanakkam', 'epdi irukeenga', 'neram enna', 'solu jarvis', 'eppadi irukkiraai'):
  Always respond in authentic, clear spoken Tamil script (e.g. 'வணக்கம் ஸார், நான் உங்களுக்கு உதவ தயாராக உள்ளேன்.').
  Using native Tamil script allows the browser's Tamil Text-to-Speech voice to speak the audio accurately and beautifully.
- If the user speaks in English, respond in British gentlemanly English.
- If the user switches languages, seamlessly mirror their language.
Keep your responses concise, clear, and helpful (1-3 sentences), as they will be read aloud. 
Avoid markdown formatting like bullet points, asterisks, or bold text in your response, make it sound like spoken natural dialogue.
"""

def execute_local_command(command: str) -> Dict[str, Any]:
    """
    Attempts to match and execute local PC command patterns.
    Returns a dictionary with result and response text if matched, or None.
    """
    cmd = command.lower().strip()
    
    # Time / Date (English & Tamil/Tanglish)
    if any(x in cmd for x in ["what time is it", "tell me the time", "current time", "neram enna", "time enna", "mani enna", "நேரம் என்ன", "மணி என்ன"]):
        current_time = time.strftime("%I:%M %p")
        if any(x in cmd for x in ["neram enna", "time enna", "mani enna", "நேரம் என்ன", "மணி என்ன"]):
            return {"executed": True, "response": f"இப்போது நேரம் {current_time}, ஸார்."}
        return {"executed": True, "response": f"It is currently {current_time}, Sir."}
        
    if any(x in cmd for x in ["what day is it", "today's date", "what is the date", "what is today", "iniku enna naal", "inniku enna date", "இன்று என்ன நாள்", "தேதி என்ன"]):
        current_date = time.strftime("%A, %B %d, %Y")
        if any(x in cmd for x in ["iniku enna naal", "inniku enna date", "இன்று என்ன நாள்", "தேதி என்ன"]):
            return {"executed": True, "response": f"இன்று {current_date}, ஸார்."}
        return {"executed": True, "response": f"Today is {current_date}, Sir."}

    # System Control
    if "screenshot" in cmd:
        try:
            os.makedirs("static/screenshots", exist_ok=True)
            screenshot_path = "static/screenshots/screenshot.png"
            pyautogui.screenshot(screenshot_path)
            # Add timestamp to avoid caching issues on frontend
            url_path = f"/screenshots/screenshot.png?t={int(time.time())}"
            return {
                "executed": True, 
                "response": "Screenshot captured, Sir. I have saved it to your dashboard.",
                "action": "screenshot",
                "image_url": url_path
            }
        except Exception as e:
            return {"executed": True, "response": f"I was unable to capture the screen, Sir. Error: {str(e)}"}

    if "lock" in cmd and "computer" in cmd:
        try:
            # Lock Windows workstation
            subprocess.run("rundll32.exe user32.dll,LockWorkStation", shell=True)
            return {"executed": True, "response": "Locking the workstation now, Sir."}
        except Exception as e:
            return {"executed": True, "response": f"Unable to lock computer, Sir. Error: {str(e)}"}

    if "show desktop" in cmd or "minimize all" in cmd:
        try:
            pyautogui.hotkey('win', 'd')
            return {"executed": True, "response": "Showing desktop, Sir."}
        except Exception as e:
            return {"executed": True, "response": "Could not minimize windows, Sir."}

    # Volume Controls
    if "mute" in cmd or "unmute" in cmd:
        try:
            pyautogui.press('volumemute')
            return {"executed": True, "response": "Toggling audio mute, Sir."}
        except Exception as e:
            return {"executed": True, "response": "Audio controls are only available when running locally on your laptop, Sir."}

    if "volume up" in cmd or "increase volume" in cmd:
        try:
            for _ in range(5):
                pyautogui.press('volumeup')
            return {"executed": True, "response": "Volume increased, Sir."}
        except Exception as e:
            return {"executed": True, "response": "Audio controls are only available when running locally on your laptop, Sir."}

    if "volume down" in cmd or "decrease volume" in cmd:
        try:
            for _ in range(5):
                pyautogui.press('volumedown')
            return {"executed": True, "response": "Volume decreased, Sir."}
        except Exception as e:
            return {"executed": True, "response": "Audio controls are only available when running locally on your laptop, Sir."}

    # Website navigation
    open_web_match = re.search(r'(?:open|go to)\s+([a-zA-Z0-9\.\s]+)', cmd)
    if open_web_match:
        target = open_web_match.group(1).strip()
        urls = {
            "youtube": "https://www.youtube.com",
            "google": "https://www.google.com",
            "github": "https://www.github.com",
            "stack overflow": "https://stackoverflow.com",
            "wikipedia": "https://www.wikipedia.org",
            "reddit": "https://www.reddit.com"
        }
        
        # Check direct match
        for key, url in urls.items():
            if key in target:
                webbrowser.open(url)
                return {"executed": True, "response": f"Opening {key.capitalize()} now, Sir."}
        
        # Generic domain resolution or search
        if "." in target:
            url = f"https://{target}" if not target.startswith("http") else target
            webbrowser.open(url)
            return {"executed": True, "response": f"Navigating to {target}, Sir."}

    # Google Search
    search_match = re.search(r'search\s+(?:google|the web)?\s*for\s+(.+)', cmd)
    if search_match:
        query = search_match.group(1).strip()
        webbrowser.open(f"https://www.google.com/search?q={query}")
        return {"executed": True, "response": f"Searching Google for '{query}', Sir."}

    # Wikipedia Search
    wiki_match = re.search(r'search\s+wikipedia\s+for\s+(.+)', cmd)
    if wiki_match:
        query = wiki_match.group(1).strip()
        webbrowser.open(f"https://en.wikipedia.org/wiki/Special:Search?search={query}")
        return {"executed": True, "response": f"Searching Wikipedia for '{query}', Sir."}

    # App launchers
    app_launch_patterns = [
        (r'open\s+notepad', 'notepad.exe', 'Notepad'),
        (r'open\s+calculator', 'calc.exe', 'Calculator'),
        (r'open\s+paint', 'mspaint.exe', 'Paint'),
        (r'open\s+command prompt', 'cmd.exe', 'Command Prompt'),
        (r'open\s+explorer', 'explorer.exe', 'File Explorer')
    ]
    for pattern, exe, name in app_launch_patterns:
        if re.search(pattern, cmd):
            try:
                subprocess.Popen(exe)
                return {"executed": True, "response": f"Launching {name}, Sir."}
            except Exception as e:
                return {"executed": True, "response": f"I was unable to launch {name}, Sir. Error: {str(e)}"}

    # System Diagnostics (CPU/RAM/Disk stats request)
    if any(x in cmd for x in ["cpu usage", "cpu status", "how is the cpu"]):
        cpu = psutil.cpu_percent(interval=0.5)
        return {"executed": True, "response": f"The CPU usage is currently at {cpu} percent, Sir."}

    if any(x in cmd for x in ["memory usage", "ram status", "how is the ram", "check ram"]):
        ram = psutil.virtual_memory().percent
        return {"executed": True, "response": f"System memory utilization is at {ram} percent, Sir."}

    if any(x in cmd for x in ["system status", "how is my computer", "system diagnostics", "computer status"]):
        cpu = psutil.cpu_percent(interval=0.1)
        ram = psutil.virtual_memory().percent
        return {"executed": True, "response": f"Diagnostics complete, Sir. CPU is at {cpu} percent, memory is at {ram} percent. All core systems are functioning within normal parameters."}

    return {"executed": False}

async def generate_ai_response(prompt: str) -> str:
    """
    Sends the prompt to Groq (Llama 3.3) or Gemini and gets a response in the JARVIS persona.
    """
    if not ensure_ai_configured():
        return "I am currently running in automation mode, Sir. To enable conversational intelligence, please enter your free Groq API Key (from console.groq.com) or Gemini Key in HUD Settings."

    # Priority 1: Groq AI (Ultra-fast, reliable, free tier)
    if groq_client is not None:
        messages = [{"role": "system", "content": SYSTEM_INSTRUCTION}]
        for role, text in chat_history[-8:]:
            messages.append({
                "role": "user" if role.lower() == "user" else "assistant",
                "content": text
            })
        messages.append({"role": "user", "content": prompt})

        best_model = get_best_groq_model(groq_client)
        candidate_groq_models = list(dict.fromkeys([
            best_model,
            "qwen/qwen3.8-27b",
            "openai/gpt-oss-120b",
            "openai/gpt-oss-20b",
            "allam-2-7b",
            "llama-3.1-8b-instant",
            "llama-3.1-70b-versatile",
            "llama3-8b-8192",
            "llama3-70b-8192",
            "mixtral-8x7b-32768",
            "gemma2-9b-it"
        ]))

        for groq_model in candidate_groq_models:
            try:
                completion = await asyncio.to_thread(
                    groq_client.chat.completions.create,
                    model=groq_model,
                    messages=messages,
                    max_tokens=300,
                    temperature=0.7
                )
                if completion and completion.choices and completion.choices[0].message.content:
                    reply = completion.choices[0].message.content.strip()
                    reply = re.sub(r'[*_`#\-\[\]]', '', reply)
                    return reply
            except Exception as e:
                print(f"Groq {groq_model} warning: {e}")
                continue

    # Priority 2: Gemini AI
    if gemini_client is not None:
        candidate_models = [
            "gemini-3.8-flash",
            "gemini-3.5-flash",
            "gemini-3.5-flash-lite",
            "gemini-3.1-flash-lite",
            "gemini-flash-latest"
        ]
        
        context = SYSTEM_INSTRUCTION + "\n\n"
        for role, text in chat_history[-10:]:
            context += f"{role}: {text}\n"
        context += f"User: {prompt}\nJARVIS:"

        last_error = None
        priority_error = None
        for model_name in candidate_models:
            try:
                response = await asyncio.to_thread(
                    gemini_client.models.generate_content,
                    model=model_name,
                    contents=context
                )
                if response and hasattr(response, "text") and response.text:
                    reply = response.text.strip()
                    reply = re.sub(r'[*_`#\-\[\]]', '', reply)
                    return reply
                last_error = RuntimeError(f"Gemini model {model_name} returned an empty response")
            except Exception as e:
                last_error = e
                err_text = str(e)
                if "free tier is not available" in err_text or "PERMISSION_DENIED" in err_text:
                    priority_error = e
                continue
                
        err_str = str(priority_error or last_error) if (priority_error or last_error) else "Unknown error"
        if "PERMISSION_DENIED" in err_str or "denied access" in err_str:
            if "free tier is not available" in err_str or "billing" in err_str:
                return "My apologies, Sir. The current Google Cloud project requires billing. Please switch to a free Groq API key (console.groq.com) or standard Gemini account in HUD Settings."
            return "My apologies, Sir. Access to the Gemini neural network was denied with the current key. Please check or update your key in HUD Settings."
        return f"My apologies, Sir. The conversational network reported: {err_str}"

    return "I am operating in offline automation mode, Sir. Your local commands are active. To enable conversational intelligence, configure a Groq or Gemini API key in HUD Settings."

@app.post("/api/command")
async def process_command(req: CommandRequest):
    command = req.command
    print(f"Received voice command: '{command}'")
    
    # 1. Try local automation/system controls
    result = execute_local_command(command) if ENABLE_LOCAL_AUTOMATION else {"executed": False}
    
    if result["executed"]:
        # Log to chat history as automation response
        chat_history.append(("User", command))
        chat_history.append(("JARVIS", result["response"]))
        return result
        
    # 2. Fall back to Gemini conversational AI
    ai_response = await generate_ai_response(command)
    chat_history.append(("User", command))
    chat_history.append(("JARVIS", ai_response))
    
    return {
        "executed": False,
        "response": ai_response,
        "action": "ai_chat"
    }

class ChatMessage(BaseModel):
    role: str = "user"
    text: str = ""

class ChatRequest(BaseModel):
    message: str
    language: str = "Auto"
    conversation: list = []

@app.post("/api/chat")
async def chat_endpoint(req: ChatRequest):
    """
    Direct conversational endpoint for JARVIS Version 5 mobile & web app.
    Supports multi-turn context and English/Tamil bilingual queries.
    """
    message = req.message.strip()
    if not message:
        return {"success": False, "error": "Message cannot be empty."}

    # First check if this is an automated command
    cmd_res = execute_local_command(message) if ENABLE_LOCAL_AUTOMATION else {"executed": False}
    if cmd_res.get("executed"):
        chat_history.append(("User", message))
        chat_history.append(("JARVIS", cmd_res["response"]))
        return {
            "success": True,
            "reply": cmd_res["response"],
            "action": cmd_res.get("action", "command")
        }

    # If conversation history was sent from client, incorporate into context
    if req.conversation:
        for item in req.conversation[-6:]:
            if isinstance(item, dict) and "text" in item:
                role = "User" if item.get("role") == "user" else "JARVIS"
                chat_history.append((role, item["text"]))

    ai_reply = await generate_ai_response(message)
    chat_history.append(("User", message))
    chat_history.append(("JARVIS", ai_reply))

    return {
        "success": True,
        "reply": ai_reply,
        "version": "5.0"
    }

@app.get("/api/stats")
def get_system_stats():
    """
    Returns system performance metrics.
    """
    try:
        ensure_gemini_configured()
        cpu = psutil.cpu_percent()
        ram = psutil.virtual_memory()
        disk = psutil.disk_usage('/')
        
        # Calculate uptime
        boot_time = psutil.boot_time()
        uptime_seconds = time.time() - boot_time
        hours, remainder = divmod(uptime_seconds, 3600)
        minutes, _ = divmod(remainder, 60)
        uptime_str = f"{int(hours)}h {int(minutes)}m"
        
        return {
            "cpu": cpu,
            "ram": ram.percent,
            "ram_used": round(ram.used / (1024 ** 3), 2),
            "ram_total": round(ram.total / (1024 ** 3), 2),
            "disk": disk.percent,
            "uptime": uptime_str,
            "ai_active": is_ai_enabled
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.websocket("/ws/stats")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket to stream system metrics to the UI in real-time.
    """
    await websocket.accept()
    print("WebSocket connected for real-time diagnostics.")
    try:
        while True:
            stats = get_system_stats()
            await websocket.send_json(stats)
            await asyncio.sleep(2)  # Stream stats every 2 seconds
    except WebSocketDisconnect:
        print("WebSocket disconnected.")
    except Exception as e:
        print(f"WebSocket stats error: {e}")

@app.get("/api/health")
def health_check():
    """
    Health check endpoint for frontend connection status verification.
    """
    return {
        "status": "online",
        "server": "J.A.R.V.I.S. Core",
        "version": "5.0",
        "ai_active": is_ai_enabled,
        "local_automation": ENABLE_LOCAL_AUTOMATION
    }

class GeminiKeyRequest(BaseModel):
    api_key: str

def save_env_variable(key_name: str, value: str):
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    lines = []
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            lines = f.readlines()
    
    found = False
    new_lines = []
    for line in lines:
        if line.startswith(f"{key_name}="):
            new_lines.append(f"{key_name}={value}\n")
            found = True
        else:
            new_lines.append(line)
    if not found:
        new_lines.append(f"\n{key_name}={value}\n")
    
    with open(env_path, "w", encoding="utf-8") as f:
        f.writelines(new_lines)
    os.environ[key_name] = value

@app.get("/api/config/gemini")
@app.get("/api/config/ai")
def get_ai_status():
    configured = ensure_ai_configured()
    return {
        "configured": configured,
        "is_ai_enabled": is_ai_enabled,
        "provider": active_ai_provider
    }

@app.post("/api/config/gemini")
@app.post("/api/config/ai")
def set_ai_key(req: GeminiKeyRequest):
    global is_ai_enabled, gemini_client, groq_client, active_ai_provider
    new_key = req.api_key.strip()
    if not new_key:
        raise HTTPException(status_code=400, detail="API Key cannot be empty.")

    # Detection 1: Groq API Key (starts with gsk_)
    if new_key.startswith("gsk_") or "gsk" in new_key.lower():
        try:
            if Groq is None:
                raise RuntimeError("Groq SDK is not installed.")
            test_client = Groq(api_key=new_key)
            best_model = get_best_groq_model(test_client)
            test_res = None
            last_err = None
            candidate_models = list(dict.fromkeys([
                best_model,
                "llama-3.1-8b-instant",
                "llama-3.1-70b-versatile",
                "llama3-8b-8192",
                "llama3-70b-8192",
                "mixtral-8x7b-32768",
                "gemma2-9b-it"
            ]))
            for m in candidate_models:
                try:
                    test_res = test_client.chat.completions.create(
                        model=m,
                        messages=[{"role": "user", "content": "hi"}],
                        max_tokens=10
                    )
                    if test_res and test_res.choices:
                        best_model = m
                        break
                except Exception as err:
                    last_err = err
                    continue

            if not test_res or not test_res.choices:
                raise last_err or RuntimeError("No Groq model responded to verification probe.")

            save_env_variable("GROQ_API_KEY", new_key)
            groq_client = test_client
            is_ai_enabled = True
            active_ai_provider = f"Groq ({best_model})"
            return {"success": True, "message": f"Groq AI key validated successfully using {best_model}, Sir! Conversational AI active."}
        except Exception as e:
            return {"success": False, "message": f"Groq key verification error: {str(e)}"}

    # Detection 2: Gemini API Key
    try:
        new_client = genai.Client(api_key=new_key)
        verified = False
        last_err = None
        for test_model in ["gemini-3.8-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]:
            try:
                test_response = new_client.models.generate_content(
                    model=test_model,
                    contents="hello"
                )
                if test_response and test_response.text:
                    verified = True
                    break
            except Exception as e:
                last_err = e
                continue
                
        if not verified and last_err:
            raise last_err
        
        save_env_variable("GEMINI_API_KEY", new_key)
        gemini_client = new_client
        is_ai_enabled = True
        active_ai_provider = "Google Gemini"
        return {"success": True, "message": "Gemini API Key validated and configured successfully, Sir."}
    except Exception as e:
        # If Gemini failed, try Groq as fallback in case key doesn't start with gsk_
        try:
            if Groq is not None:
                test_client = Groq(api_key=new_key)
                best_model = get_best_groq_model(test_client)
                test_res = None
                for m in [best_model, "llama-3.1-8b-instant", "llama3-8b-8192"]:
                    try:
                        test_res = test_client.chat.completions.create(
                            model=m,
                            messages=[{"role": "user", "content": "hi"}],
                            max_tokens=10
                        )
                        if test_res and test_res.choices:
                            best_model = m
                            break
                    except Exception:
                        continue
                if test_res and test_res.choices:
                    save_env_variable("GROQ_API_KEY", new_key)
                    groq_client = test_client
                    is_ai_enabled = True
                    active_ai_provider = f"Groq ({best_model})"
                    return {"success": True, "message": f"Groq AI key validated using {best_model}, Sir!"}
        except Exception:
            pass
        return {"success": False, "message": f"Key verification error: {str(e)}"}

# Mount static files (ensure this is done after other routes to avoid conflicts)
os.makedirs("static", exist_ok=True)
app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    print(f"Starting J.A.R.V.I.S. Core on http://localhost:{port} and local network (0.0.0.0:{port})")
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=True)
