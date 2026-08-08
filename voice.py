"""音色生成：在剧本编辑器里直接为每个实体做出音色，多个实体各绑各的。

为什么是「一次出多条候选并排试听」而不是一次一条：
VoiceDesign 是随机采样的，同一段描述换个 seed 音色差很远。之前的工作流一次
只生成一条，听到什么算什么——「什么大妈声音」就是这么来的。挑选是刚需。

两条路：
  design —— Qwen3TTSVoiceDesign，自由描述嗓音。需 VoiceDesign 模型。
  clone  —— Qwen3TTSVoiceClonePrompt + VoiceClone，从参考音频提音色向量复刻。
            需 Base 模型。这才是「指定音色」，不靠抽卡。

不碰 CustomVoice：那是 Vivian 那套固定预设，用户实测就是「大妈声」。
"""

from __future__ import annotations

import base64
import gc
import hashlib
import io
import json
import os
import sys
import threading
import time
import traceback

import folder_paths

def model_roots() -> list[str]:
    """
    所有可能放模型的根目录，按优先级。

    不能只信 `folder_paths.models_dir`：这台机器上它被解析到了
    C:\\Users\\...\\ComfyUI-Shared\\models（一个 1MB 的空骨架），而模型实际在
    --base-directory 指的 D:\\APP\\EDITOR\\ComfyUI\\models 下。之前的测试里我把
    models_dir 手动设成 D 盘，等于让测试自己通过，运行时才暴露。
    """
    roots = []
    for p in (getattr(folder_paths, "base_path", None) and
              os.path.join(folder_paths.base_path, "models"),
              getattr(folder_paths, "models_dir", None)):
        if p and p not in roots:
            roots.append(p)
    return roots


def find_model_dir(*parts: str) -> str:
    """在所有根目录里找这个子路径，找到哪个用哪个；都没有则返回首选路径。"""
    for root in model_roots():
        p = os.path.join(root, *parts)
        if os.path.isdir(p):
            return p
    return os.path.join(model_roots()[0], *parts)


TTS_ROOT = find_model_dir("TTS")


def _register_tts_path() -> None:
    """
    把真正装了模型的 TTS 目录插到 folder_paths 的最前面。

    ComfyUI-Qwen3-TTS 用 `get_folder_paths("TTS")[0]` 定位模型，而且只在
    "TTS" 尚未注册时才添加自己的路径。别的东西先注册了 C 盘那个空目录，
    它就永远找不到模型。is_default=True 会 insert(0, ...)。
    """
    try:
        if os.path.isdir(TTS_ROOT):
            folder_paths.add_model_folder_path("TTS", TTS_ROOT, is_default=True)
    except Exception:
        traceback.print_exc()


_register_tts_path()

REPO_DESIGN = "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"
REPO_BASE = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"

# 生成好的音色落在 input/ 根目录，这样 LoadAudio 的下拉框能直接选到，
# 前端也能自动建节点接进 media 口。
# 不能放子目录：LoadAudio 用 os.listdir(input_dir) 列文件，不递归。
VOICE_PREFIX = "h3voice_"

MAX_CANDIDATES = 8
_lock = threading.Lock()
_models: dict[str, object] = {}
_touched = 0.0
_reaper_started = False


def _pkg_dir() -> str | None:
    d = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                     "ComfyUI-Qwen3-TTS")
    return d if os.path.isdir(d) else None


_tts_mod = None


def _tts_nodes():
    """导入已安装的 ComfyUI-Qwen3-TTS 的节点类。只导一次，模型缓存在模块里。"""
    global _tts_mod
    if _tts_mod is not None:
        return _tts_mod
    d = _pkg_dir()
    if not d:
        raise RuntimeError("没有找到 ComfyUI-Qwen3-TTS，音色生成需要它")
    parent = os.path.dirname(d)
    if parent not in sys.path:
        sys.path.insert(0, parent)
    # 包名带连字符，import 语句用不了，只能走 importlib
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "h3_qwen3tts_nodes", os.path.join(d, "nodes.py"))
    m = importlib.util.module_from_spec(spec)
    sys.modules["h3_qwen3tts_nodes"] = m
    spec.loader.exec_module(m)
    _tts_mod = m
    return m


def _safetensors_complete(path: str) -> bool:
    """
    safetensors 是否下完整。只看文件存在会把「正在下的半个文件」当成就绪，
    然后在用户点生成时才炸。头 8 字节是小端 u64 的头部长度，头部 JSON 里
    每个张量的 data_offsets 末位给出数据段总长，加起来就是应有的文件大小。
    """
    try:
        size = os.path.getsize(path)
        if size < 16:
            return False
        with open(path, "rb") as f:
            n = int.from_bytes(f.read(8), "little")
            if n <= 0 or n > 100 * 1024 * 1024 or 8 + n > size:
                return False
            header = json.loads(f.read(n).decode("utf-8"))
        end = 0
        for k, v in header.items():
            if k == "__metadata__" or not isinstance(v, dict):
                continue
            off = v.get("data_offsets")
            if isinstance(off, (list, tuple)) and len(off) == 2:
                end = max(end, int(off[1]))
        return size >= 8 + n + end
    except Exception:
        return False


def repo_ready(repo: str) -> bool:
    p = os.path.join(TTS_ROOT, *repo.split("/"))
    if not os.path.isdir(p):
        return False
    shards = [f for f in os.listdir(p) if f.endswith(".safetensors")]
    return bool(shards) and all(_safetensors_complete(os.path.join(p, f)) for f in shards)


def input_dir() -> str:
    """
    ComfyUI 实际读取 LoadAudio 的 input 目录。

    `get_input_directory()` 在这台机器上会跟着 C 盘的共享目录走，而 ComfyUI
    实际是用 --base-directory 起的（D 盘）。以 base_path 为准，生成的音色
    才既落在 D 盘、又能被 LoadAudio 的下拉框列出来。
    """
    base = getattr(folder_paths, "base_path", None)
    if base:
        d = os.path.join(base, "input")
        if os.path.isdir(d):
            return d
    return folder_paths.get_input_directory()


def voices_dir() -> str:
    d = input_dir()
    os.makedirs(d, exist_ok=True)
    return d


# ------------------------------------------------------------------ 模型

def _unload_locked():
    if _models:
        _models.clear()
        gc.collect()
        try:
            import torch
            torch.cuda.empty_cache()
        except Exception:
            pass


def unload_voice_models():
    """H3 采样前让出显存。"""
    with _lock:
        had = bool(_models)
        _unload_locked()
    return had


def _start_reaper():
    global _reaper_started
    if _reaper_started:
        return
    _reaper_started = True

    def loop():
        while True:
            time.sleep(30)
            with _lock:
                if _models and time.time() - _touched > 600:
                    print("[MiniMaxH3-Studio] 音色模型空闲，卸载让出显存")
                    _unload_locked()

    threading.Thread(target=loop, name="h3-voice-reaper", daemon=True).start()


def _load(repo: str):
    global _touched
    _start_reaper()
    with _lock:
        if repo not in _models:
            if not repo_ready(repo):
                raise RuntimeError(f"模型还没下载：{repo}")
            nodes = _tts_nodes()
            # auto_download 关掉：缺模型就直接报错，不要在请求里静默拉几个 GB
            (model,) = nodes.Qwen3TTSLoader().load_model(
                model_repo=repo, download_source="HuggingFace",
                precision="bf16", attn_mode="sdpa", auto_download=False,
            )
            _models[repo] = model
        _touched = time.time()
        return _models[repo], _tts_nodes()


# ------------------------------------------------------------------ 音频

# 这套环境里 torchaudio.save 会走 torchcodec，而 torchcodec 没装，直接抛
# ImportError。soundfile 是现成的，wave 是标准库，两级兜底不引入新依赖。
def audio_to_wav_bytes(audio: dict) -> tuple[bytes, int]:
    import numpy as np
    import torch
    wav = audio["waveform"]
    sr = int(audio["sample_rate"])
    if wav.dim() == 3:
        wav = wav[0]
    if wav.dim() == 1:
        wav = wav.unsqueeze(0)
    arr = np.clip(wav.to(torch.float32).cpu().numpy(), -1.0, 1.0).T   # (帧, 声道)
    buf = io.BytesIO()
    try:
        import soundfile as sf
        sf.write(buf, arr, sr, format="WAV", subtype="PCM_16")
    except Exception:
        import wave
        pcm = (arr * 32767.0).astype(np.int16)
        with wave.open(buf, "wb") as w:
            w.setnchannels(pcm.shape[1])
            w.setsampwidth(2)
            w.setframerate(sr)
            w.writeframes(pcm.tobytes())
    return buf.getvalue(), sr


def decode_audio_upload(data_url: str) -> dict:
    """浏览器传上来的参考音频 -> ComfyUI 的 AUDIO dict。"""
    import numpy as np
    import torch
    if "," not in data_url:
        raise ValueError("参考音频要用 data: URI")
    raw = base64.b64decode(data_url.split(",", 1)[1])
    try:
        import soundfile as sf
        data, sr = sf.read(io.BytesIO(raw), dtype="float32", always_2d=True)  # (帧, 声道)
    except Exception as exc:
        raise ValueError(f"读不出这段音频（支持 wav/flac/ogg）：{exc}") from exc
    wav = torch.from_numpy(np.ascontiguousarray(data.T))                      # (声道, 帧)
    return {"waveform": wav.unsqueeze(0), "sample_rate": int(sr)}


# ------------------------------------------------------------------ 生成

def _seeds(base_seed: int, n: int) -> list[int]:
    if base_seed:
        return [base_seed + i * 7919 for i in range(n)]
    import random
    return [random.randrange(1, 2**31) for _ in range(n)]


def generate_candidates(payload: dict) -> dict:
    """一次出 n 条候选，各带自己的 seed，供并排试听。"""
    mode = payload.get("mode") or "design"
    text = (payload.get("text") or "").strip()
    if not text:
        raise ValueError("试听文本不能为空")
    language = payload.get("language") or "Chinese"
    n = max(1, min(MAX_CANDIDATES, int(payload.get("count") or 4)))
    seeds = _seeds(int(payload.get("seed") or 0), n)

    t0 = time.time()
    out = []
    if mode == "design":
        instruction = (payload.get("instruction") or "").strip()
        if not instruction:
            raise ValueError("音色描述不能为空")
        model, nodes = _load(REPO_DESIGN)
        node = nodes.Qwen3TTSVoiceDesign()
        for s in seeds:
            (audio,) = node.generate(
                model_obj=model, text=text, voice_instruction=instruction,
                language=language, output_mode="Concatenate (Merge)", seed=s,
            )
            wav, sr = audio_to_wav_bytes(audio)
            out.append({"seed": s, "sample_rate": sr,
                        "audio": "data:audio/wav;base64," + base64.b64encode(wav).decode()})
    elif mode == "clone":
        ref = payload.get("ref_audio")
        if not ref:
            raise ValueError("克隆需要一段参考音频")
        model, nodes = _load(REPO_BASE)
        ref_audio = decode_audio_upload(ref)
        ref_text = (payload.get("ref_text") or "").strip()
        x_only = not ref_text
        (prompt,) = nodes.Qwen3TTSVoiceClonePrompt().create_prompt(
            model_obj=model, ref_audio=ref_audio,
            x_vector_only=x_only, ref_text=ref_text,
        )
        node = nodes.Qwen3TTSVoiceClone()
        for s in seeds:
            (audio,) = node.generate(
                model_obj=model, target_text=text, target_language=language,
                output_mode="Concatenate (Merge)", seed=s,
                voice_clone_prompt=prompt,
                instruct=(payload.get("instruction") or "").strip(),
            )
            wav, sr = audio_to_wav_bytes(audio)
            out.append({"seed": s, "sample_rate": sr,
                        "audio": "data:audio/wav;base64," + base64.b64encode(wav).decode()})
    else:
        raise ValueError(f"未知模式：{mode}")

    return {"ok": True, "mode": mode, "candidates": out,
            "seconds": round(time.time() - t0, 1)}


def save_voice(payload: dict) -> dict:
    """把选中的那条落盘到 input/h3_voices，返回 LoadAudio 能用的相对路径。"""
    data_url = payload.get("audio") or ""
    if "," not in data_url:
        raise ValueError("没有音频数据")
    raw = base64.b64decode(data_url.split(",", 1)[1])
    label = "".join(c for c in str(payload.get("name") or "voice")
                    if c.isalnum() or c in "-_（）()·")[:24] or "voice"
    digest = hashlib.sha1(raw).hexdigest()[:8]
    fname = f"{VOICE_PREFIX}{label}_{digest}.wav"
    path = os.path.join(voices_dir(), fname)
    if not os.path.exists(path):
        with open(path, "wb") as f:
            f.write(raw)
    rel = fname                            # LoadAudio 的下拉框直接认这个名字

    bank = load_bank()
    entry = {
        "file": rel, "name": payload.get("name") or label,
        "mode": payload.get("mode") or "design",
        "instruction": payload.get("instruction") or "",
        "language": payload.get("language") or "",
        "seed": payload.get("seed"),
        "bytes": len(raw),
    }
    bank = [b for b in bank if b.get("file") != rel] + [entry]
    save_bank(bank)
    return {"ok": True, "file": rel, "entry": entry}


# --------------------------------------------------------------- 音色库

BANK_PATH_NAME = "minimax_h3_voicebank.json"


def _bank_path() -> str:
    return os.path.join(folder_paths.get_user_directory(), BANK_PATH_NAME)


def load_bank() -> list:
    try:
        with open(_bank_path(), "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def save_bank(bank: list) -> None:
    os.makedirs(os.path.dirname(_bank_path()), exist_ok=True)
    with open(_bank_path(), "w", encoding="utf-8") as f:
        json.dump(bank, f, ensure_ascii=False, indent=2)


def bank_status() -> dict:
    d = voices_dir()
    bank = [b for b in load_bank()
            if os.path.exists(os.path.join(input_dir(), b["file"]))]
    return {
        "backends": [
            {"id": "design", "label": "描述生成（VoiceDesign）", "ready": repo_ready(REPO_DESIGN),
             "repo": REPO_DESIGN, "note": "自由描述嗓音，随机采样，所以要多出几条挑"},
            {"id": "clone", "label": "克隆参考音频（Base）", "ready": repo_ready(REPO_BASE),
             "repo": REPO_BASE, "note": "从一段参考音频提音色向量复刻，不靠抽卡"},
        ],
        "bank": bank,
        "dir": d,
    }


# ----------------------------------------------------------------- 路由

def add_routes(routes):
    from aiohttp import web

    @routes.get("/minimax_h3_studio/voice/status")
    async def _status(_r):
        return web.json_response(bank_status())

    @routes.post("/minimax_h3_studio/voice/generate")
    async def _gen(request):
        import asyncio
        try:
            payload = await request.json()
        except Exception:
            return web.json_response({"ok": False, "error": "请求体不是 JSON"}, status=400)
        loop = asyncio.get_running_loop()
        try:
            return web.json_response(
                await loop.run_in_executor(None, generate_candidates, payload))
        except Exception as exc:
            traceback.print_exc()
            return web.json_response({"ok": False, "error": f"{type(exc).__name__}: {exc}"},
                                     status=500)

    @routes.post("/minimax_h3_studio/voice/save")
    async def _save(request):
        try:
            payload = await request.json()
        except Exception:
            return web.json_response({"ok": False, "error": "请求体不是 JSON"}, status=400)
        try:
            return web.json_response(save_voice(payload))
        except Exception as exc:
            traceback.print_exc()
            return web.json_response({"ok": False, "error": str(exc)}, status=500)

    @routes.post("/minimax_h3_studio/voice/unload")
    async def _unload(_r):
        return web.json_response({"ok": True, "unloaded": unload_voice_models()})


def register_routes():
    try:
        from server import PromptServer
    except Exception:
        return
    routes = getattr(PromptServer.instance, "routes", None)
    if routes is None:
        return
    add_routes(routes)
