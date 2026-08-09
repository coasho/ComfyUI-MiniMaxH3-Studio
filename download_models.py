"""一键下载这个节点包用到的全部模型。

为什么不直接用 huggingface_hub：
  1. `snapshot_download(local_dir=...)` 在 Xet 存储上会忽略 `HF_HUB_DOWNLOAD_TIMEOUT`，
     卡住就是永远卡住；而且中途杀掉进程，已经下的几个 GB 全丢——没有断点。
  2. 它要求装 huggingface_hub，还会往 `~/.cache/huggingface` 写一份缓存副本，
     20GB 的权重直接把 C 盘吃掉一半。
这里用 requests + Range 头自己做断点续传，落盘就是最终位置（`.part` 尾缀），
读超时由我们自己设，卡住会超时重试并从断点接着下。

镜像：设了 `HF_ENDPOINT`（例如 https://hf-mirror.com）就走镜像，和官方工具一致。

命令行：
    python download_models.py --list
    python download_models.py --required
    python download_models.py h3_ref2va h3_text_encoder
    python download_models.py --all
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import threading
import time
import traceback
from urllib.parse import quote

_HERE = os.path.dirname(os.path.abspath(__file__))
_CUSTOM_NODES = os.path.dirname(_HERE)


# --------------------------------------------------------------------- 路径

def _folder_paths():
    try:
        import folder_paths
        return folder_paths
    except Exception:
        return None


def model_roots() -> list[str]:
    """
    所有可能放模型的根目录，按优先级。与 caption.py / voice.py 保持完全一致：
    下载器写进去的位置必须就是它们读取的位置。

    不能只信 `folder_paths.models_dir`——它可能被解析到 ComfyUI Desktop 的共享
    目录（C 盘的空骨架），而模型实际在 `--base-directory` 指的盘上。
    """
    fp = _folder_paths()
    roots: list[str] = []
    if fp is not None:
        for p in (getattr(fp, "base_path", None) and os.path.join(fp.base_path, "models"),
                  getattr(fp, "models_dir", None)):
            if p and p not in roots:
                roots.append(p)
    if not roots:
        # 脱离 ComfyUI 单独跑（CLI）时，往上找一个像 ComfyUI 根的目录
        guess = os.path.dirname(_CUSTOM_NODES)
        roots.append(os.path.join(guess, "models"))
    return roots


_FORCED_ROOT: str | None = None      # --root：直接指定 models 目录
_FORCED_BASE: str | None = None      # --comfy：指定 ComfyUI 根，models/custom_nodes 都从它推


def models_root() -> str:
    """下载目标根目录：优先已经存在的那个。"""
    if _FORCED_ROOT:
        return _FORCED_ROOT
    if _FORCED_BASE:
        return os.path.join(_FORCED_BASE, "models")
    for r in model_roots():
        if os.path.isdir(r):
            return r
    return model_roots()[0]


def custom_nodes_root() -> str:
    if _FORCED_BASE:
        return os.path.join(_FORCED_BASE, "custom_nodes")
    fp = _folder_paths()
    base = getattr(fp, "base_path", None) if fp else None
    p = base and os.path.join(base, "custom_nodes")
    return p if p and os.path.isdir(p) else _CUSTOM_NODES


def wd14_dir() -> str:
    """
    WD14 放哪。已经装了 comfyui-wd14-tagger 就复用它的 models 目录，免得同一份
    1.2GB 存两遍；没装就落在 `models/wd14_tagger/`，caption.py 也认这个位置。
    """
    for base in dict.fromkeys([custom_nodes_root(), _CUSTOM_NODES]):
        d = os.path.join(base, "comfyui-wd14-tagger", "models")
        if os.path.isdir(d):
            return d
    return os.path.join(models_root(), "wd14_tagger")


# ----------------------------------------------------------------- 模型清单
#
# dest 是相对于 models 根的路径；wd14 那条用 dest_dir 回调，因为它可能落在
# custom_nodes 下面。size 写死是为了让「没联网 / 没下载」时状态页也能显示体积，
# 并且能拿来判断 .part 下完没有——HF 的 Content-Length 在重定向后不总是可靠。

HF = "Comfy-Org/MiniMax-H3"
LORA_REPO = "drbaph/MiniMax-H3-Turbo-Lora-ComfyUI"

MANIFEST: list[dict] = [
    {
        "id": "h3_ref2va",
        "label": "H3 主模型 · 参考图模式 ref2va（int8 pruned）",
        "label_en": "H3 diffusion model — reference mode (int8 pruned)",
        "group": "核心",
        "required": True,
        "note": "剧本编辑器的参考图工作流用它。16GB 显存跑得动。",
        "files": [{"repo": HF, "path": "diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors",
                   "dest": "diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors",
                   "size": 20970379616}],
    },
    {
        "id": "h3_fl2va",
        "label": "H3 主模型 · 文生/图生视频 fl2va（int8 pruned）",
        "label_en": "H3 diffusion model — t2v / i2v (int8 pruned)",
        "group": "核心",
        "required": True,
        "note": "不用参考图、只做文生视频或首尾帧时用它。",
        "files": [{"repo": HF, "path": "diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors",
                   "dest": "diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors",
                   "size": 20970379616}],
    },
    {
        "id": "h3_text_encoder",
        "label": "H3 文本编码器 Qwen3-VL-32B（nvfp4 awq）",
        "label_en": "H3 text encoder — Qwen3-VL-32B (nvfp4 awq)",
        "group": "核心",
        "required": True,
        "note": "nvfp4 需要 50 系（sm_120）；老卡请改用 int8_convrot 版本。",
        "files": [{"repo": HF, "path": "text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
                   "dest": "text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
                   "size": 15687142551}],
    },
    {
        "id": "h3_text_encoder_int8",
        "label": "H3 文本编码器 · int8 备选（非 50 系显卡）",
        "label_en": "H3 text encoder — int8 alternative (pre-Blackwell GPUs)",
        "group": "核心",
        "required": False,
        "note": "和上面那条二选一，体积大一倍但不依赖 nvfp4。",
        "files": [{"repo": HF, "path": "text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors",
                   "dest": "text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors",
                   "size": 27141342152}],
    },
    {
        "id": "h3_vae",
        "label": "H3 视频 VAE + 音频 VAE",
        "label_en": "H3 video VAE + audio VAE",
        "group": "核心",
        "required": True,
        "note": "两个都要，缺音频 VAE 就只有画面没有声音。",
        "files": [
            {"repo": HF, "path": "vae/minimax_h3_video_vae_fp16.safetensors",
             "dest": "vae/minimax_h3_video_vae_fp16.safetensors", "size": 5207808496},
            {"repo": HF, "path": "vae/minimax_h3_audio_vae_fp32.safetensors",
             "dest": "vae/minimax_h3_audio_vae_fp32.safetensors", "size": 605254808},
        ],
    },
    {
        "id": "h3_turbo_lora",
        "label": "Turbo 加速 LoRA（v4-600 EMA，作者推荐）",
        "label_en": "Turbo LoRA — v4 step600 EMA (author's pick)",
        "group": "核心",
        "required": True,
        "note": "4–8 步出片，6–8 步明显好于 4 步。静态与小幅运动、脸手细节都比旧版强。"
                "需要 ComfyUI ≥ bdcb886，否则声音会破。",
        "files": [{"repo": LORA_REPO, "path": "minimax_h3_turbo_v4_step600_ema_pruned_comfyui.safetensors",
                   "dest": "loras/minimax_h3_turbo_v4_step600_ema_pruned_comfyui.safetensors",
                   "size": 620285592}],
    },
    {
        "id": "h3_turbo_lora_ckpt850",
        "label": "Turbo 加速 LoRA · 旧版 ckpt850（大幅运动 + 只跑 4 步时用）",
        "label_en": "Turbo LoRA — legacy ckpt850 (4 steps + heavy motion)",
        "group": "核心",
        "required": False,
        "note": "v4-600 在「只有 4 步且画面大幅运动」时会拖影，这是它唯一还占优的场景。"
                "能跑到 6–8 步就不需要这个。",
        "files": [{"repo": LORA_REPO, "path": "minimax_h3_turbo_4step_ckpt850_pruned_comfyui.safetensors",
                   "dest": "loras/minimax_h3_turbo_4step_ckpt850_pruned_comfyui.safetensors",
                   "size": 620285592}],
    },
    {
        "id": "qwen3vl_caption",
        "label": "图生文反推 · Qwen3-VL-4B-Instruct",
        "label_en": "Image captioning — Qwen3-VL-4B-Instruct",
        "group": "编辑器功能",
        "required": False,
        "note": "反推参考图特征，以及保存时把中文剧本翻成英文。不下就只能手写。",
        "repo": "Qwen/Qwen3-VL-4B-Instruct",
        "dest": "LLM/Qwen3-VL-4B-Instruct",
        "exclude": ["README.md", ".gitattributes"],
    },
    {
        "id": "wd14_tagger",
        "label": "二次元标签 · wd-eva02-large-tagger-v3",
        "label_en": "Anime tagger — wd-eva02-large-tagger-v3",
        "group": "编辑器功能",
        "required": False,
        "note": "ONNX，CPU 就能跑。二次元参考图的发色瞳色服饰靠它，比 VLM 准。",
        "files": [
            {"repo": "SmilingWolf/wd-eva02-large-tagger-v3", "path": "model.onnx",
             "dest_dir": "wd14", "rename": "wd-eva02-large-tagger-v3.onnx", "size": 1260435999},
            {"repo": "SmilingWolf/wd-eva02-large-tagger-v3", "path": "selected_tags.csv",
             "dest_dir": "wd14", "rename": "wd-eva02-large-tagger-v3.csv", "size": 308468},
        ],
    },
    {
        "id": "tts_voicedesign",
        "label": "音色生成 · Qwen3-TTS VoiceDesign",
        "label_en": "Voice design — Qwen3-TTS VoiceDesign",
        "group": "编辑器功能",
        "required": False,
        "note": "用一段文字描述嗓音，一次出多条候选试听。需要 ComfyUI-Qwen3-TTS 节点包。",
        "repo": "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign",
        "dest": "TTS/Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign",
        "exclude": ["README.md", ".gitattributes"],
    },
    {
        "id": "tts_base",
        "label": "音色克隆 · Qwen3-TTS Base",
        "label_en": "Voice cloning — Qwen3-TTS Base",
        "group": "编辑器功能",
        "required": False,
        "note": "从一段参考音频复刻音色，比描述生成稳定得多。",
        "repo": "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
        "dest": "TTS/Qwen/Qwen3-TTS-12Hz-1.7B-Base",
        "exclude": ["README.md", ".gitattributes"],
    },
]

BY_ID = {m["id"]: m for m in MANIFEST}


# ------------------------------------------------------------------ 网络层

USER_AGENT = "ComfyUI-MiniMaxH3-Studio/1.0 (+https://github.com/)"
CHUNK = 4 * 1024 * 1024
CONNECT_TIMEOUT = 30
READ_TIMEOUT = 60          # 卡住 60 秒就当断了，重试从断点接着下
MAX_RETRIES = 8


class Cancelled(Exception):
    pass


def endpoint() -> str:
    return (os.environ.get("HF_ENDPOINT") or "https://huggingface.co").rstrip("/")


def file_url(repo: str, path: str, revision: str = "main") -> str:
    quoted = "/".join(quote(part) for part in path.split("/"))
    return f"{endpoint()}/{repo}/resolve/{revision}/{quoted}?download=true"


def _requests():
    import requests
    return requests


def repo_tree(repo: str, revision: str = "main") -> list[dict]:
    """列出仓库里所有文件（含子目录）。失败就抛，让上层报出来。"""
    requests = _requests()
    url = f"{endpoint()}/api/models/{repo}/tree/{revision}?recursive=1"
    r = requests.get(url, timeout=(CONNECT_TIMEOUT, READ_TIMEOUT),
                     headers={"User-Agent": USER_AGENT})
    r.raise_for_status()
    return [x for x in r.json() if x.get("type") == "file"]


def _matches(path: str, patterns: list[str]) -> bool:
    import fnmatch
    return any(fnmatch.fnmatch(path, p) or path == p for p in patterns)


def resolve_files(entry: dict) -> list[dict]:
    """
    把清单条目摊平成 [{url, dest, size}]。

    显式 files 的条目不需要联网；repo 形式的要问一次 HF 的目录树，结果缓存在
    条目上——状态页会反复调用，别每次都打一趟网。
    """
    root = models_root()
    out: list[dict] = []
    if entry.get("files"):
        for f in entry["files"]:
            if f.get("dest_dir") == "wd14":
                dest = os.path.join(wd14_dir(), f.get("rename") or os.path.basename(f["path"]))
            else:
                dest = os.path.join(root, *f["dest"].split("/"))
            out.append({"url": file_url(f["repo"], f["path"]), "dest": dest,
                        "size": f.get("size", 0), "name": os.path.basename(dest)})
        return out

    cached = entry.get("_resolved")
    if cached is None:
        files = repo_tree(entry["repo"])
        exclude = entry.get("exclude") or []
        include = entry.get("include")
        cached = [x for x in files
                  if not _matches(x["path"], exclude)
                  and (include is None or _matches(x["path"], include))]
        entry["_resolved"] = cached
    base = os.path.join(root, *entry["dest"].split("/"))
    for x in cached:
        out.append({"url": file_url(entry["repo"], x["path"]),
                    "dest": os.path.join(base, *x["path"].split("/")),
                    "size": x.get("size", 0), "name": x["path"]})
    return out


# ------------------------------------------------------------------ 完整性

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


def file_ok(dest: str, expect: int) -> bool:
    """
    本地这份能不能直接用（用来决定「跳过、不重下」）。

    不要求字节数和清单一致：同一个权重的不同 repack 大小会差几十字节
    （用户机上 ref2va 就比 Comfy-Org 那份多 73 字节，来自另一个仓库，能正常跑）。
    按大小判定会让它白下 19.5GB。safetensors 能自校验就以自校验为准；
    onnx/csv 没有自校验手段，才退回大小比对。

    刚下完的 .part 是另一回事——那份必须严格等于我们请求的长度，见 _download_one。
    """
    if not os.path.isfile(dest):
        return False
    if dest.endswith(".safetensors"):
        return _safetensors_complete(dest)
    if expect:
        return os.path.getsize(dest) == expect
    return os.path.getsize(dest) > 0


def entry_status(entry: dict, offline_ok: bool = True) -> dict:
    """
    一个清单条目的就绪状态。offline_ok=True 时，repo 形式的条目在拿不到目录树
    的情况下退回「按本地目录判断」，不至于让整个状态页因为断网而报错。
    """
    try:
        files = resolve_files(entry)
    except Exception as e:
        if not offline_ok:
            raise
        root = models_root()
        base = entry.get("dest") and os.path.join(root, *entry["dest"].split("/"))
        return {"id": entry["id"], "ready": False, "unknown": True,
                "error": str(e), "total": 0, "have": 0, "path": base or root, "files": []}

    have = sum(min(os.path.getsize(f["dest"]), f["size"] or 1 << 62)
               for f in files if os.path.isfile(f["dest"]))
    have += sum(os.path.getsize(f["dest"] + ".part")
                for f in files if os.path.isfile(f["dest"] + ".part"))
    total = sum(f["size"] for f in files)
    oks = [file_ok(f["dest"], f["size"]) for f in files]
    paths = [f["dest"] for f in files]
    return {
        "id": entry["id"], "ready": bool(oks) and all(oks),
        "total": total, "have": min(have, total) if total else have,
        "path": os.path.dirname(paths[0]) if paths else models_root(),
        "files": [{"name": f["name"], "size": f["size"], "ok": ok}
                  for f, ok in zip(files, oks)],
    }


def status_all() -> dict:
    items = []
    for m in MANIFEST:
        st = entry_status(m)
        st.update({k: m.get(k) for k in
                   ("label", "label_en", "group", "required", "note")})
        items.append(st)
    root = models_root()
    free = 0
    try:
        free = shutil.disk_usage(root).free
    except Exception:
        pass
    return {"root": root, "wd14_dir": wd14_dir(), "endpoint": endpoint(),
            "free": free, "items": items}


# ------------------------------------------------------------------ 下载器

_state_lock = threading.Lock()
_state: dict = {
    "running": False, "cancel": False, "queue": [], "done": [], "failed": [],
    "current": None, "log": [], "started": 0.0, "finished": 0.0,
    "total": 0, "have": 0,
}
_worker: threading.Thread | None = None


def _log(msg: str) -> None:
    line = time.strftime("%H:%M:%S ") + msg
    with _state_lock:
        _state["log"].append(line)
        del _state["log"][:-400]
    print("[MiniMaxH3-Studio] " + msg, flush=True)


def _download_one(url: str, dest: str, expect: int, on_bytes) -> None:
    requests = _requests()
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    part = dest + ".part"
    done = os.path.getsize(part) if os.path.isfile(part) else 0
    if expect and done > expect:      # 上次下歪了，重来
        os.remove(part)
        done = 0

    attempts = 0
    while True:
        if expect and done >= expect:
            break
        headers = {"User-Agent": USER_AGENT}
        if done:
            headers["Range"] = f"bytes={done}-"
        progressed = False
        try:
            with requests.get(url, headers=headers, stream=True, allow_redirects=True,
                              timeout=(CONNECT_TIMEOUT, READ_TIMEOUT)) as r:
                if r.status_code == 416:      # 服务器说没得续了，就是下完了
                    break
                if done and r.status_code != 206:
                    # 对端不支持 Range，只能从头下，别把新数据接在旧数据后面
                    _log(f"{os.path.basename(dest)}: 对端不支持断点，从头开始")
                    done = 0
                r.raise_for_status()
                total = expect or (int(r.headers.get("Content-Length") or 0) + done)
                mode = "ab" if done else "wb"
                with open(part, mode) as f:
                    for chunk in r.iter_content(CHUNK):
                        with _state_lock:
                            if _state["cancel"]:
                                raise Cancelled()
                        if not chunk:
                            continue
                        f.write(chunk)
                        done += len(chunk)
                        progressed = True
                        on_bytes(len(chunk), done, total)
        except Cancelled:
            raise
        except Exception as e:
            if progressed:
                attempts = 0          # 有进展就不算一次失败，别把重试额度耗在长下载上
            attempts += 1
            if attempts > MAX_RETRIES:
                raise
            wait = min(2 ** attempts, 30)
            _log(f"{os.path.basename(dest)}: {type(e).__name__} {e}；{wait}s 后从 "
                 f"{done / 2**20:.0f}MB 续传（第 {attempts}/{MAX_RETRIES} 次）")
            time.sleep(wait)
            done = os.path.getsize(part) if os.path.isfile(part) else 0
            continue
        break

    if expect and os.path.getsize(part) != expect:
        raise RuntimeError(f"大小不对：期望 {expect}，实际 {os.path.getsize(part)}")
    if dest.endswith(".safetensors") and not _safetensors_complete(part):
        raise RuntimeError("safetensors 头部校验没过，文件不完整")
    os.replace(part, dest)


def _run(ids: list[str]) -> None:
    try:
        plan: list[tuple[dict, dict]] = []
        for i in ids:
            entry = BY_ID.get(i)
            if not entry:
                _log(f"未知的模型 id：{i}")
                continue
            for f in resolve_files(entry):
                if file_ok(f["dest"], f["size"]):
                    continue
                plan.append((entry, f))

        total = sum(f["size"] for _, f in plan)
        with _state_lock:
            _state.update({"total": total, "have": 0,
                           "queue": [f["name"] for _, f in plan]})
        if not plan:
            _log("要下的都已经在本地了，没事可做")
            return

        _log(f"共 {len(plan)} 个文件，{total / 2**30:.1f} GB，目标 {models_root()}")
        try:
            free = shutil.disk_usage(models_root()).free
            if free < total * 1.05:
                _log(f"⚠ 磁盘剩余 {free / 2**30:.1f} GB，可能不够")
        except Exception:
            pass

        base_have = 0
        for entry, f in plan:
            with _state_lock:
                if _state["cancel"]:
                    raise Cancelled()
                _state["current"] = {"id": entry["id"], "name": f["name"],
                                     "size": f["size"], "done": 0,
                                     "speed": 0.0, "eta": 0}
            _log(f"↓ {f['name']}（{f['size'] / 2**20:.0f} MB）")
            t0 = time.time()
            last = [t0, 0]

            def on_bytes(_n, done, size, _t0=t0, _last=last, _base=base_have):
                now = time.time()
                if now - _last[0] < 0.4:
                    return
                speed = (done - _last[1]) / max(now - _last[0], 1e-6)
                _last[0], _last[1] = now, done
                with _state_lock:
                    cur = _state.get("current") or {}
                    cur.update({"done": done, "size": size or cur.get("size", 0),
                                "speed": speed,
                                "eta": int((size - done) / speed) if speed > 0 and size else 0})
                    _state["current"] = cur
                    _state["have"] = _base + done

            _download_one(f["url"], f["dest"], f["size"], on_bytes)
            base_have += f["size"]
            with _state_lock:
                _state["have"] = base_have
                _state["done"].append(f["name"])
                _state["queue"] = [q for q in _state["queue"] if q != f["name"]]
            dt = max(time.time() - t0, 1e-6)
            _log(f"✓ {f['name']}（{f['size'] / 2**20 / dt:.1f} MB/s）")

        _log("全部完成")
    except Cancelled:
        _log("已取消（下了一半的文件留着 .part，下次接着下）")
    except Exception as e:
        with _state_lock:
            _state["failed"].append(str(e))
        _log(f"失败：{type(e).__name__}: {e}")
        traceback.print_exc()
    finally:
        with _state_lock:
            _state["running"] = False
            _state["current"] = None
            _state["finished"] = time.time()


def start(ids: list[str]) -> bool:
    """后台开下。已经在下就返回 False。"""
    global _worker
    with _state_lock:
        if _state["running"]:
            return False
        _state.update({"running": True, "cancel": False, "done": [], "failed": [],
                       "current": None, "log": [], "started": time.time(),
                       "finished": 0.0, "total": 0, "have": 0, "queue": []})
    _worker = threading.Thread(target=_run, args=(list(ids),),
                               name="h3-model-download", daemon=True)
    _worker.start()
    return True


def cancel() -> None:
    with _state_lock:
        _state["cancel"] = True


def progress() -> dict:
    with _state_lock:
        return json.loads(json.dumps(_state))


# -------------------------------------------------------------------- 路由

def add_routes(routes) -> None:
    from aiohttp import web

    @routes.get("/minimax_h3_studio/models")
    async def _list(_r):
        return web.json_response(status_all())

    @routes.post("/minimax_h3_studio/models/download")
    async def _start(request):
        body = await request.json()
        ids = [str(i) for i in (body.get("ids") or [])]
        if not ids:
            return web.json_response({"ok": False, "error": "没选要下的模型"}, status=400)
        if not start(ids):
            return web.json_response({"ok": False, "error": "已经在下载了"}, status=409)
        return web.json_response({"ok": True})

    @routes.get("/minimax_h3_studio/models/progress")
    async def _progress(_r):
        return web.json_response(progress())

    @routes.post("/minimax_h3_studio/models/cancel")
    async def _cancel(_r):
        cancel()
        return web.json_response({"ok": True})


def register_routes() -> None:
    try:
        from server import PromptServer
    except Exception:
        return
    # 单独导入（测试台 / 命令行）时 PromptServer 还没实例化，别在这里炸
    inst = getattr(PromptServer, "instance", None)
    r = getattr(inst, "routes", None) if inst is not None else None
    if r is not None:
        add_routes(r)


# -------------------------------------------------------------------- CLI

def _human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} PB"


def main(argv: list[str] | None = None) -> int:
    # Windows 控制台默认 GBK，打个 ✓ 就 UnicodeEncodeError，整个命令直接崩
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

    ap = argparse.ArgumentParser(description="下载 ComfyUI-MiniMaxH3-Studio 需要的模型")
    ap.add_argument("ids", nargs="*", help="要下的模型 id（--list 可以看全部）")
    ap.add_argument("--list", action="store_true", help="列出所有模型和就绪状态")
    ap.add_argument("--all", action="store_true", help="下载全部")
    ap.add_argument("--required", action="store_true", help="只下核心必需的")
    ap.add_argument("--comfy", help="ComfyUI 根目录（不在 custom_nodes 下跑时指定）")
    ap.add_argument("--root", help="强制指定 models 根目录")
    args = ap.parse_args(argv)

    global _FORCED_ROOT, _FORCED_BASE
    if args.comfy:
        _FORCED_BASE = os.path.abspath(args.comfy)
    if args.root:
        _FORCED_ROOT = os.path.abspath(args.root)

    if args.list or not (args.ids or args.all or args.required):
        st = status_all()
        print(f"models 根目录：{st['root']}")
        print(f"下载源：      {st['endpoint']}")
        print(f"剩余空间：    {_human(st['free'])}\n")
        for it in st["items"]:
            mark = "✓" if it["ready"] else ("…" if it["have"] else " ")
            req = "必需" if it["required"] else "可选"
            print(f" [{mark}] {it['id']:<22} {req}  {_human(it['total']):>9}  {it['label']}")
            if it.get("note"):
                print(f"       {it['note']}")
        print("\n用法：python download_models.py --required")
        return 0

    ids = [m["id"] for m in MANIFEST] if args.all else list(args.ids)
    if args.required:
        ids += [m["id"] for m in MANIFEST if m.get("required")]
    ids = list(dict.fromkeys(ids))

    if not start(ids):
        print("已经在下载了")
        return 1
    seen = 0
    while True:
        p = progress()
        for line in p["log"][seen:]:
            print(line, flush=True)
        seen = len(p["log"])
        if not p["running"]:
            return 1 if p["failed"] else 0
        cur = p.get("current")
        if cur and cur.get("size"):
            pct = 100.0 * cur["done"] / cur["size"]
            sys.stdout.write(f"\r    {cur['name'][:48]:<48} {pct:5.1f}%  "
                             f"{cur['speed'] / 2**20:5.1f} MB/s  ETA {cur['eta']}s   ")
            sys.stdout.flush()
        time.sleep(1)


if __name__ == "__main__":
    raise SystemExit(main())
