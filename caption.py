"""图生文反推：从参考图直接得到 H3 要的实体描述。

准备好参考图之后还要把特征再手写一遍，是这个编辑器里最耗人的一步。
这里提供一个 HTTP 端点，前端把实体绑定的那张图发过来，拿回一段可以直接
粘进「描述」框的文字，再手动改。

后端可插拔，按可用性自动挑：
  wd14    —— SmilingWolf/wd-eva02-large-tagger-v3（ONNX）。二次元属性抽取，
             v3 系列 F1 最高。输出 danbooru 标签，精确但不成句。
  qwen3vl —— Qwen/Qwen3-VL-4B-Instruct。写实与二次元都能写成句，
             能按结构化指令输出，bf16 约 8.3GB，16G 卡放得下。
  openai  —— 任何 OpenAI 兼容的多模态端点（Ollama / LM Studio / 云 API），
             零下载。用户自己填 base_url 和模型名。

二次元图默认两者协作：WD14 先抽标签，作为事实依据喂给 Qwen3-VL 写成句子。
标签比 VLM 在发色瞳色服饰这类离散属性上准得多，VLM 则负责组织语言。
"""

from __future__ import annotations

import base64
import binascii
import gc
import io
import json
import os
import re
import threading
import time
import traceback

import folder_paths

_HERE = os.path.dirname(os.path.abspath(__file__))
_CUSTOM_NODES = os.path.dirname(_HERE)


def model_roots() -> list[str]:
    """
    所有可能放模型的根目录，按优先级。

    不能只信 `folder_paths.models_dir`：这台机器上它被解析到了
    C:\\Users\\...\\ComfyUI-Shared\\models（一个 1MB 的空骨架），而模型实际在
    --base-directory 指的 D:\\APP\\EDITOR\\ComfyUI\\models 下。
    """
    roots = []
    for p in (getattr(folder_paths, "base_path", None) and
              os.path.join(folder_paths.base_path, "models"),
              getattr(folder_paths, "models_dir", None)):
        if p and p not in roots:
            roots.append(p)
    return roots


def find_model_dir(*parts: str) -> str:
    for root in model_roots():
        p = os.path.join(root, *parts)
        if os.path.isdir(p):
            return p
    return os.path.join(model_roots()[0], *parts)


# 别只用「本文件上一级」推 custom_nodes —— 开发目录里跑就推错了。
# 把 base_path 下的 custom_nodes 也算上。
WD14_DIRS = [
    os.path.join(d, "comfyui-wd14-tagger", "models")
    for d in dict.fromkeys(filter(None, [
        _CUSTOM_NODES,
        getattr(folder_paths, "base_path", None) and
        os.path.join(folder_paths.base_path, "custom_nodes"),
    ]))
] + [os.path.join(r, "wd14_tagger") for r in model_roots()]
WD14_NAME = "wd-eva02-large-tagger-v3"
QWEN_DIR = find_model_dir("LLM", "Qwen3-VL-4B-Instruct")

SETTINGS_PATH = os.path.join(folder_paths.get_user_directory(), "minimax_h3_caption.json")

# 反推出来的东西不该无限长——描述框里塞 300 字没人看得下去
MAX_NEW_TOKENS = 320
MAX_SIDE = 1024

_lock = threading.Lock()
_wd14 = None          # (session, tags)
_qwen = None          # (model, processor)
_qwen_touched = 0.0


# --------------------------------------------------------------------- 设置

DEFAULT_SETTINGS = {
    "backend": "auto",
    "language": "en",          # en = 直接可用于提示词；zh = 中文，便于人读改
    "use_tags_for_anime": True,
    "openai_base_url": "http://127.0.0.1:11434/v1",
    "openai_model": "qwen2.5vl:7b",
    "openai_api_key": "",
    "keep_loaded_seconds": 600,
}


def load_settings() -> dict:
    s = dict(DEFAULT_SETTINGS)
    try:
        with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
            s.update(json.load(f))
    except Exception:
        pass
    return s


def save_settings(patch: dict) -> dict:
    s = load_settings()
    for k, v in (patch or {}).items():
        if k in DEFAULT_SETTINGS:
            s[k] = v
    os.makedirs(os.path.dirname(SETTINGS_PATH), exist_ok=True)
    with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
        json.dump(s, f, ensure_ascii=False, indent=2)
    return s


# ----------------------------------------------------------------- 后端探测

def wd14_paths() -> tuple[str, str] | None:
    for d in WD14_DIRS:
        onnx = os.path.join(d, WD14_NAME + ".onnx")
        csv = os.path.join(d, WD14_NAME + ".csv")
        if os.path.exists(onnx) and os.path.exists(csv):
            return onnx, csv
    return None


def qwen_ready() -> bool:
    return os.path.isdir(QWEN_DIR) and any(
        f.endswith(".safetensors") for f in os.listdir(QWEN_DIR)
    ) and os.path.exists(os.path.join(QWEN_DIR, "config.json"))


def backend_status() -> dict:
    s = load_settings()
    wd = wd14_paths()
    return {
        "settings": s,
        "backends": [
            {"id": "qwen3vl", "label": "Qwen3-VL-4B（写实 + 二次元，成句）",
             "ready": qwen_ready(), "path": QWEN_DIR,
             "note": "本地 bf16 约 8.3GB，首次调用要装载十几秒"},
            {"id": "wd14", "label": "WD14 EVA02-Large v3（二次元属性标签）",
             "ready": bool(wd), "path": wd[0] if wd else WD14_DIRS[0],
             "note": "ONNX，CPU 即可，输出 danbooru 标签"},
            {"id": "openai", "label": "OpenAI 兼容接口（Ollama / LM Studio / 云）",
             "ready": bool(s.get("openai_base_url") and s.get("openai_model")),
             "path": s.get("openai_base_url", ""),
             "note": "零下载，质量取决于你接的模型"},
        ],
    }


def pick_backend(requested: str) -> str:
    if requested and requested != "auto":
        return requested
    if qwen_ready():
        return "qwen3vl"
    if wd14_paths():
        return "wd14"
    return "openai"


# ------------------------------------------------------------------- 图像

def decode_image(data_url: str):
    from PIL import Image
    if not isinstance(data_url, str) or "," not in data_url:
        raise ValueError("需要 data: URI 形式的图片")
    head, b64 = data_url.split(",", 1)
    if "base64" not in head:
        raise ValueError("图片必须是 base64 编码的 data: URI")
    try:
        raw = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError(f"图片 base64 解不开：{exc}") from exc
    img = Image.open(io.BytesIO(raw))
    img.load()
    img = img.convert("RGB")
    if max(img.size) > MAX_SIDE:
        r = MAX_SIDE / max(img.size)
        img = img.resize((max(1, int(img.width * r)), max(1, int(img.height * r))),
                         Image.LANCZOS)
    return img


# ------------------------------------------------------------ WD14 标签抽取

# 设定稿本身的排版特征。它们描述的是「这是一张设定稿」而不是角色长什么样，
# 混进描述里会被模型当成画面内容照搬——三视图的白底和张臂站姿被搬进成片，
# 是这个项目里真实踩过的坑。这里把它们挑出来，转成「不保留」的候选。
SHEET_TAGS = {
    "multiple views": "三视图/多视角排版",
    "turnaround": "转身图排版",
    "reference sheet": "设定稿版式",
    "character sheet": "设定稿版式",
    "expression chart": "表情差分排版",
    "variations": "差分排版",
    "white background": "参考图的白色背景",
    "grey background": "参考图的灰色背景",
    "gray background": "参考图的灰色背景",
    "simple background": "参考图的纯色背景",
    "transparent background": "参考图的透明背景",
    "artist name": "画师签名",
    "signature": "画师签名",
    "watermark": "水印",
    "character name": "图上的角色名文字",
    "english text": "图上的英文标注",
    "border": "参考图的边框",
    "outstretched arms": "参考图的张臂姿势",
    "spread arms": "参考图的张臂姿势",
    "t-pose": "参考图的 T-pose 站姿",
    "arms at sides": "参考图的立正站姿",
    "looking at viewer": "直视镜头的姿态",
}


# 视角标签只在确认是设定稿时才算排版特征。单张侧脸特写里的 profile
# 是真实构图，不该建议丢掉。
SHEET_MARKERS = {"multiple views", "turnaround", "reference sheet",
                 "character sheet", "expression chart", "variations"}
VIEW_TAGS = {
    "profile": "参考图的侧面视角",
    "from side": "参考图的侧面视角",
    "from behind": "参考图的背面视角",
    "from above": "参考图的俯视视角",
    "from below": "参考图的仰视视角",
    "full body": "参考图的全身站位",
}


def split_sheet_tags(general: list[str]) -> tuple[list[str], list[str]]:
    """返回 (外观标签, 不该保留的排版特征中文描述)。"""
    is_sheet = any(t in SHEET_MARKERS for t in general)
    table = dict(SHEET_TAGS)
    if is_sheet:
        table.update(VIEW_TAGS)
    keep, drop, seen = [], [], set()
    for t in general:
        zh = table.get(t)
        if zh:
            if zh not in seen:
                seen.add(zh)
                drop.append(zh)
        else:
            keep.append(t)
    return keep, drop


def wd14_tags(img, threshold: float = 0.35, char_threshold: float = 0.75) -> dict:
    """返回 {'general': [...], 'character': [...], 'rating': str}。"""
    global _wd14
    paths = wd14_paths()
    if not paths:
        raise RuntimeError("WD14 模型还没下载")
    onnx_path, csv_path = paths

    with _lock:
        if _wd14 is None:
            import csv as _csv
            import onnxruntime as ort
            providers = [p for p in ("CUDAExecutionProvider", "CPUExecutionProvider")
                         if p in ort.get_available_providers()]
            sess = ort.InferenceSession(onnx_path, providers=providers)
            rows = []
            with open(csv_path, "r", encoding="utf-8") as f:
                for row in _csv.DictReader(f):
                    rows.append((row["name"], int(row["category"])))
            _wd14 = (sess, rows)
    sess, rows = _wd14

    import numpy as np
    from PIL import Image
    _, h, w, _ = sess.get_inputs()[0].shape
    size = int(h) if isinstance(h, int) else 448
    # WD14 期望方图、白底填充、BGR
    side = max(img.size)
    canvas = Image.new("RGB", (side, side), (255, 255, 255))
    canvas.paste(img, ((side - img.width) // 2, (side - img.height) // 2))
    canvas = canvas.resize((size, size), Image.BICUBIC)
    arr = np.asarray(canvas, dtype=np.float32)[:, :, ::-1]
    arr = np.expand_dims(arr, 0)

    probs = sess.run([sess.get_outputs()[0].name], {sess.get_inputs()[0].name: arr})[0][0]

    general, character, rating = [], [], ""
    best_rating = -1.0
    for (name, cat), p in zip(rows, probs):
        p = float(p)
        if cat == 9:                       # rating
            if p > best_rating:
                best_rating, rating = p, name
        elif cat == 0 and p >= threshold:  # general
            general.append((name.replace("_", " "), p))
        elif cat == 4 and p >= char_threshold:
            character.append((name.replace("_", " "), p))
    general.sort(key=lambda x: -x[1])
    character.sort(key=lambda x: -x[1])
    keep, drop = split_sheet_tags([n for n, _ in general])
    return {
        "general": keep,
        "sheet": drop,
        "character": [n for n, _ in character],
        "rating": rating,
    }


# ------------------------------------------------------------- Qwen3-VL 成句

def _unload_qwen_locked():
    global _qwen
    if _qwen is None:
        return
    _qwen = None
    gc.collect()
    try:
        import torch
        torch.cuda.empty_cache()
    except Exception:
        pass


def unload_caption_models():
    """H3 采样前把反推模型让出显存。"""
    with _lock:
        had = _qwen is not None
        _unload_qwen_locked()
    return had


_reaper_started = False


def _start_reaper():
    """空闲久了自动卸载。8GB 常驻显存会直接把 H3 挤爆。"""
    global _reaper_started
    if _reaper_started:
        return
    _reaper_started = True

    def loop():
        while True:
            time.sleep(30)
            keep = load_settings().get("keep_loaded_seconds", 600)
            if not keep or keep <= 0:
                continue
            with _lock:
                if _qwen is not None and time.time() - _qwen_touched > keep:
                    print(f"[MiniMaxH3-Studio] 反推模型空闲超过 {keep}s，卸载让出显存")
                    _unload_qwen_locked()

    threading.Thread(target=loop, name="h3-caption-reaper", daemon=True).start()


def _load_qwen():
    global _qwen, _qwen_touched
    _start_reaper()
    with _lock:
        if _qwen is None:
            import torch
            from transformers import AutoProcessor, Qwen3VLForConditionalGeneration
            model = Qwen3VLForConditionalGeneration.from_pretrained(
                QWEN_DIR, dtype=torch.bfloat16, device_map="cuda:0",
            )
            model.eval()
            proc = AutoProcessor.from_pretrained(QWEN_DIR)
            _qwen = (model, proc)
        _qwen_touched = time.time()
        return _qwen


def qwen_describe(img, instruction: str) -> str:
    import torch
    model, proc = _load_qwen()
    msgs = [{"role": "user", "content": [
        {"type": "image"},
        {"type": "text", "text": instruction},
    ]}]
    text = proc.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)
    inputs = proc(text=[text], images=[img], return_tensors="pt").to(model.device)
    with torch.inference_mode():
        out = model.generate(**inputs, max_new_tokens=MAX_NEW_TOKENS, do_sample=False)
    trimmed = out[0][inputs.input_ids.shape[1]:]
    return proc.decode(trimmed, skip_special_tokens=True).strip()


# ------------------------------------------------------- OpenAI 兼容接口后端

def openai_describe(data_url: str, instruction: str, s: dict) -> str:
    import urllib.request
    base = (s.get("openai_base_url") or "").rstrip("/")
    if not base:
        raise RuntimeError("还没配置 OpenAI 兼容接口的 base_url")
    body = json.dumps({
        "model": s.get("openai_model") or "",
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": instruction},
            {"type": "image_url", "image_url": {"url": data_url}},
        ]}],
        "max_tokens": MAX_NEW_TOKENS,
        "temperature": 0.2,
    }).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if s.get("openai_api_key"):
        headers["Authorization"] = "Bearer " + s["openai_api_key"]
    req = urllib.request.Request(base + "/chat/completions", data=body, headers=headers)
    with urllib.request.urlopen(req, timeout=180) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return (data["choices"][0]["message"]["content"] or "").strip()


# ------------------------------------------------------------------ 指令

# 按实体类型给不同指令。H3 的关键在于「颜色要写排除项」——不写的话模型会往
# 它熟悉的方向漂（黑发飘成橙发是实际踩过的坑）。
KIND_RULES = {
    "identity": (
        "the character's appearance only",
        "hair colour and hairstyle, eye colour, facial features, age impression, "
        "body build, and every garment and accessory actually visible",
    ),
    "object": (
        "the object itself only",
        "its shape, material, colour, surface finish, wear, and any markings or text on it",
    ),
    "scene": (
        "the place only",
        "architecture, furniture and props, time of day, light direction and quality, weather, and mood",
    ),
    "action": (
        "the pose and movement only",
        "body posture, limb positions, weight distribution, direction and speed of motion",
    ),
    "style": (
        "the rendering style only, not the content",
        "line weight and cleanliness, shading method, colour palette, saturation, "
        "contrast, texture and which medium it imitates",
    ),
    "voice": (
        "the appearance only",
        "anything visible about the speaker",
    ),
}

# 指令写成散文一大段时，模型只挑着执行（实测：点了 8 个颜色只给 1 个排除项）。
# 编号硬规则 + 可数的要求，照做率高得多。
BASE_EN = (
    "You are writing a reference description for a video generation model.\n"
    "Subject: describe {scope}. Cover {aspects}.\n"
    "Rules:\n"
    "1. Output exactly one dense paragraph of plain declarative English. "
    "No preamble, no markdown, no bullet lists, no closing remark.\n"
    # 颜色排除项一律由 enforce_colour_exclusions() 在本地补，不让模型碰。
    # 让模型写的两次尝试都失败了：给字母占位符它抄 "X, NOT Y"，给成品例句
    # 它抄「湖蓝，不是青绿」，而且覆盖率在 0%~62% 之间乱跳。
    "2. Name colours plainly and precisely (e.g. 'jet black hair', 'pale pink trim'). "
    "Do NOT write any exclusion, contrast or 'not ...' clause after a colour — "
    "that is added later by a separate step. Never copy wording from these rules.\n"
    # 「无裸露肌肤」「no other accessories」这类断言：模型看一张缩图判断不了
    # 「没有什么」，写错了 H3 会照做——参考图明明是短袖，却被加上袖子。
    "3b. Describe only what is actually present. NEVER state that something is "
    "absent, missing, not visible, unadorned, or that there are 'no' items of some "
    "kind. Do not summarise with phrases like 'no other accessories are visible' or "
    "'no exposed skin'. The colour exclusion in rule 2 is the only negative form allowed.\n"
    "4. Do not mention the background, the white canvas, the camera, the composition, "
    "or that this is a reference sheet. Do not speculate about story, mood or emotion.\n"
)

BASE_ZH = (
    "你在为一个视频生成模型写参考描述。\n"
    "对象：只描述{scope_zh}，覆盖：{aspects_zh}。\n"
    "规则：\n"
    "1. 只输出一段密实的陈述性中文。不要开场白、不要 markdown、不要分点、不要结尾语。\n"
    # 颜色排除项一律本地补。让模型写试过两次都失败：给占位字母它抄 X，
    # 给成品例句它把「不是青绿」原样抄进输出，覆盖率还在 0%~62% 之间乱跳。
    "2. 颜色要写得具体准确（例如「纯黑的头发」「淡粉色滚边」）。"
    "颜色后面不要写任何排除项、对比或「不是……」的从句——那由后续步骤统一补。"
    "也不要把本规则里的任何措辞抄进正文。\n"
    # 「无裸露肌肤」写错了 H3 会照做——参考图明明是短袖，成片却被加上袖子
    "3b. 只描述画面上真实存在的东西。绝对不要断言什么「没有」「无」「不存在」"
    "「未见」「不露」「素净无装饰」，也不要用「没有其他配饰」「无裸露肌肤」这类收尾。"
    "规则 2 的颜色排除项是唯一允许的否定形式。\n"
    "4. 不要提背景、白底、镜头、构图，也不要说这是一张设定稿。不要推测剧情或情绪。\n"
)

SCOPE_ZH = {
    "identity": ("角色的外观", "发色发型、瞳色、五官、年龄感、体型，以及画面上真实可见的每一件衣物和配饰"),
    "object": ("这个物件本身", "形状、材质、颜色、表面处理、磨损，以及上面的标记或文字"),
    "scene": ("这个地点", "建筑、家具道具、时段、光线方向与质感、天气、气氛"),
    "action": ("姿态与动作", "身体姿势、四肢位置、重心、运动方向与速度"),
    "style": ("画风本身而不是画的内容", "线条粗细与干净程度、上色方式、色板、饱和度、对比度、质感，以及它在模仿哪种媒介"),
    "voice": ("外观", "关于说话者可见的一切"),
}


def build_instruction(kind: str, lang: str, hint: str, tags: dict | None) -> str:
    kind = kind if kind in KIND_RULES else "identity"
    if lang == "zh":
        scope, aspects = SCOPE_ZH[kind]
        base = BASE_ZH.format(scope_zh=scope, aspects_zh=aspects)
    else:
        scope, aspects = KIND_RULES[kind]
        base = BASE_EN.format(scope=scope, aspects=aspects)
    parts = [base]
    if tags and (tags.get("general") or tags.get("character")):
        joined = ", ".join((tags.get("character") or []) + (tags.get("general") or [])[:40])
        parts.append(
            "A danbooru tagger read this image as: " + joined + ". "
            "Those tags are more reliable than your own reading for discrete attributes "
            "(hair colour, eye colour, garment names). Follow them where they conflict with "
            "what you think you see, but ignore any tag that is clearly not about "
            + ("the character" if kind == "identity" else "the subject") + "."
        )
    # 光靠「不要提这是设定稿」压不住——实测仍然写出了
    # "standing with arms outstretched in three different poses"。
    # 标签已经确认了它是设定稿，就把这件事明说，并逐项点名要禁掉什么。
    if tags and tags.get("sheet"):
        parts.append(
            "This image is a character reference sheet: it shows one single character drawn "
            "several times from different angles, on a blank backdrop, often in a neutral "
            "arms-out pose. Describe that one character as if you were looking at them once. "
            "Never mention the multiple views, the number of poses, the turnaround, the "
            "arm position, the backdrop, or any text and signature on the sheet."
        )
    if hint and hint.strip():
        parts.append("Additional instruction from the user: " + hint.strip())
    return "\n\n".join(parts)


# --------------------------------------------------------- 颜色排除项补全

# 4B 模型做不到「每个颜色都带排除项」——实测同一版指令下覆盖率在 0%/25%/62%
# 之间乱跳，编号硬规则也救不回来。所以让 VLM 只负责看，排除项交给确定性补全。
# 值都是该颜色最容易被扩散模型漂过去的邻近色。
EN_CONFUSABLE = {
    "black": "dark brown", "white": "cream", "cream": "pale yellow",
    "red": "orange-red", "crimson": "rust", "scarlet": "orange",
    "pink": "salmon", "rose": "coral", "magenta": "hot pink",
    "orange": "amber", "amber": "orange", "yellow": "mustard",
    "gold": "brass", "golden": "brass",
    "green": "teal", "emerald": "jade", "teal": "sea green",
    "cyan": "sky blue", "blue": "teal", "cerulean": "teal",
    "azure": "cyan", "navy": "black", "indigo": "violet",
    "purple": "magenta", "violet": "periwinkle", "lavender": "lilac",
    "brown": "auburn", "auburn": "copper", "tan": "beige", "beige": "tan",
    "grey": "silver", "gray": "silver", "silver": "pale grey",
    "blonde": "light brown", "blond": "light brown", "ginger": "copper",
}

ZH_CONFUSABLE = {
    "黑": "深棕", "白": "米白", "红": "砖红", "粉": "藕荷", "橙": "土黄",
    "黄": "土黄", "金": "铜", "绿": "青", "青": "蓝绿", "蓝": "青",
    "紫": "品红", "棕": "红棕", "褐": "棕", "灰": "银", "银": "浅灰",
}

_EN_COLOUR_RE = re.compile(
    r"\b(" + "|".join(sorted(EN_CONFUSABLE, key=len, reverse=True)) + r")\b", re.I)
_ZH_COLOUR_RE = re.compile("(" + "|".join(ZH_CONFUSABLE) + ")色")


# 排除项到哪结束。中文用全角标点，拿 ASCII "," 去找会一路找不到、
# 退化成固定窗口把后半句整个吞掉（实测漏补了后三处）。
_STOPPERS = ",，;；。.)）\n"


def _excluded_spans(text: str, marker: str) -> list[tuple[int, int]]:
    """已经写在排除项里的区间，别在里面再套一层排除项。"""
    spans = []
    for m in re.finditer(marker, text, re.I):
        end = len(text)
        for i in range(m.end(), len(text)):
            if text[i] in _STOPPERS:
                end = i
                break
        spans.append((m.start(), end))
    return spans


def strip_orphan_exclusions(text: str, lang: str) -> tuple[str, list[str]]:
    """
    删掉没挂在颜色词后面的孤立排除项。

    模型会把规则里的例句原样抄进输出（实测出现过孤零零的「不是青绿」）。
    判据很简单：排除项前面必须紧跟一个已知颜色词，否则它就是抄来的垃圾。
    """
    if not text.strip():
        return text, []
    # 分隔符要连分号和句首一起认：抄来的例句常常自成一个从句
    #（实测漏过「；不是青绿」——原来只匹配逗号前缀）
    if lang == "zh":
        rx = re.compile(r"[（(]\s*不是[^）)]{1,12}[）)]"
                        r"|(?:^|[，,；;])\s*不是[^，,。；;]{1,12}")
        table = ZH_CONFUSABLE
        colour_at_end = lambda s: bool(re.search(
            "(" + "|".join(table) + r")[色]?\s*$", s))
    else:
        rx = re.compile(r"\(\s*NOT\b[^)]{1,28}\)"
                        r"|(?:^|[,，;；])\s*NOT\b[\w\s-]{1,28}", re.I)
        table = EN_CONFUSABLE
        colour_at_end = lambda s: bool(re.search(
            r"\b(" + "|".join(table) + r")\b[\w\s-]{0,12}$", s, re.I))

    out, last, dropped = [], 0, []
    for m in rx.finditer(text):
        if colour_at_end(text[max(0, m.start() - 40):m.start()]):
            continue                      # 正常挂在颜色后面，留着
        dropped.append(m.group(0).strip())
        out.append(text[last:m.start()])
        last = m.end()
    if not dropped:
        return text, []
    out.append(text[last:])
    s = re.sub(r"\s{2,}", " ", "".join(out))
    s = re.sub(r"\s+([,，。;；])", r"\1", s)
    s = re.sub(r"([,，;；])\s*\1+", r"\1", s).strip()
    return s, dropped


def enforce_colour_exclusions(text: str, lang: str) -> tuple[str, int]:
    """
    给每个裸颜色补上排除项。返回 (新文本, 补了几个)。

    用括号而不是逗号：中文里「浅棕色，不是红棕长发」会被读成
    「不是红棕长发」，意思正好反了。括号形式没有这个歧义。
    """
    if not text.strip():
        return text, 0
    if lang == "zh":
        rx, table, marker = _ZH_COLOUR_RE, ZH_CONFUSABLE, r"不是"
        def already(tail):
            t = tail.lstrip()
            return t.startswith("（不是") or t.startswith("(不是") or t.startswith("，不是")
        def clause(word): return f"（不是{table[word]}）"
        def key(m): return m.group(1)
    else:
        rx, table, marker = _EN_COLOUR_RE, EN_CONFUSABLE, r"\bNOT\b"
        def already(tail):
            return (re.match(r"[\w\s-]{0,24},\s*NOT\b", tail, re.I) is not None
                    or re.match(r"\s*\(\s*NOT\b", tail, re.I) is not None)
        def clause(word): return f" (NOT {table[word.lower()]})"
        def key(m): return m.group(1).lower()

    skip = _excluded_spans(text, marker)
    out, last, added = [], 0, 0
    for m in rx.finditer(text):
        if any(a <= m.start() < b for a, b in skip):
            continue
        if already(text[m.end():m.end() + 40]):
            continue
        word = key(m)
        if word not in table:
            continue
        out.append(text[last:m.end()])
        out.append(clause(word))
        last = m.end()
        added += 1
    out.append(text[last:])
    return "".join(out), added


# --------------------------------------------------------- 剥离「没有什么」

# 模型总爱用「无裸露肌肤」「no other accessories are visible」这类断言收尾。
# 它看一张缩到 1024 的设定稿判断不了「没有什么」，写错了 H3 会照做：
# 参考图明明是短袖，成片却给加上袖子。描述存在的东西可以验证，断言不存在
# 的东西无法验证，所以一律删掉。
_ABSENCE_EN = re.compile(
    r"\b("
    r"no\s+(?:other|further|additional|visible|exposed|discernible|apparent)\b"
    r"|no\s+\w+\s+(?:are|is)\s+visible"
    r"|(?:are|is)\s+not\s+visible"
    r"|(?:with|and)\s+no\b"
    r"|without\s+(?:any|visible)\b"
    r"|there\s+(?:are|is)\s+no\b"
    r"|nothing\s+(?:else|other)\b"
    r"|lacks?\s+(?:any|visible)\b"
    r"|devoid\s+of\b"
    r"|free\s+of\b"
    r"|unadorned\b"
    r"|absent\b"
    r")", re.I)

_ABSENCE_ZH = re.compile(
    r"(无[裸其他任别]|无任何|无其[他余]|没有[其别任]|未见|不存在|看不[到见]"
    r"|无装饰|素净|无多余|无额外|无露出|不露)")

# 颜色排除项的确定形状，只有它才受保护
_EXCLUSION_SHAPE = re.compile(r"[,，]\s*NOT\b|\(\s*NOT\b|（\s*不是|[,，]\s*不是", re.I)


def strip_absence_claims(text: str, lang: str) -> tuple[str, list[str]]:
    """删掉断言「没有什么」的从句。返回 (新文本, 被删掉的原文列表)。"""
    if not text.strip():
        return text, []
    rx = _ABSENCE_ZH if lang == "zh" else _ABSENCE_EN
    seps = "，；;," if lang == "zh" else ",;"
    # 按从句切，保留分隔符以便还原
    parts, buf = [], ""
    for ch in text:
        buf += ch
        if ch in seps:
            parts.append(buf)
            buf = ""
    if buf:
        parts.append(buf)

    kept, dropped = [], []
    for p in parts:
        body = p.strip().rstrip(seps + " ")
        # 颜色排除项本身带否定词，绝不能误删。但只能按它的确定形状匹配
        # （", NOT x" / "(NOT x)" / "（不是x）"）——单看有没有 "not" 会把
        # "the arms are not visible" 也保护起来，那正是要删的东西。
        has_exclusion = bool(_EXCLUSION_SHAPE.search(p))
        if body and not has_exclusion and rx.search(body):
            dropped.append(body)
            continue
        kept.append(p)

    out = "".join(kept).strip()
    # 收尾标点整理
    out = re.sub(r"[，,;；]\s*$", "", out).strip()
    if out and not re.search(r"[.。!！?？]$", out):
        out += "。" if lang == "zh" else "."
    return out, dropped


# ------------------------------------------------------------- 标签转句子

def tags_to_text(tags: dict, kind: str, lang: str) -> str:
    """没有 VLM 时的退路：把标签排成一句，人工再改。"""
    g = tags.get("general") or []
    c = tags.get("character") or []
    if not g and not c:
        return ""
    who = "、".join(c) if c else ""
    body = ", ".join(g)
    if lang == "zh":
        head = f"（标签来自 WD14，未成句，请自行整理）{who + '；' if who else ''}"
        return head + body
    head = f"(raw WD14 tags, not prose — clean these up) {who + '; ' if who else ''}"
    return head + body


# ------------------------------------------------------------------- 主入口

def run_caption(payload: dict) -> dict:
    s = load_settings()
    lang = payload.get("language") or s.get("language") or "en"
    kind = payload.get("kind") or "identity"
    hint = payload.get("hint") or ""
    backend = pick_backend(payload.get("backend") or s.get("backend") or "auto")
    data_url = payload.get("image") or ""
    img = decode_image(data_url)

    t0 = time.time()
    tags = None
    used = []

    # 二次元图先抽标签当事实依据。WD14 只认二次元，写实照片上它会输出一堆
    # 无意义的标签，所以只在前端判定为二次元、或用户显式要求时才跑。
    want_tags = bool(payload.get("use_tags", s.get("use_tags_for_anime", True)))
    if want_tags and kind in ("identity", "object", "action") and wd14_paths():
        try:
            tags = wd14_tags(img)
            used.append("wd14")
        except Exception:
            traceback.print_exc()
            tags = None

    if backend == "wd14":
        if tags is None:
            tags = wd14_tags(img)
            used.append("wd14")
        text = tags_to_text(tags, kind, lang)
    elif backend == "openai":
        text = openai_describe(data_url, build_instruction(kind, lang, hint, tags), s)
        used.append("openai")
    else:
        if not qwen_ready():
            raise RuntimeError(f"Qwen3-VL 还没下载到 {QWEN_DIR}")
        text = qwen_describe(img, build_instruction(kind, lang, hint, tags))
        used.append("qwen3vl")

    # 先剥离「没有什么」的断言，再补颜色排除项 —— 顺序不能反，
    # 否则剥离时会碰到刚插进去的 NOT 从句。
    dropped = []
    if backend != "wd14":
        # 先清掉模型从规则里抄来的孤立排除项（出现过孤零零的「不是青绿」）
        text, orphans = strip_orphan_exclusions(text, lang)
        if orphans:
            dropped.extend(orphans)
            used.append(f"删抄来的排除项×{len(orphans)}")
        if payload.get("strip_absence", True):
            text, absent = strip_absence_claims(text, lang)
            if absent:
                dropped.extend(absent)
                used.append(f"删无据否定×{len(absent)}")

    # 模型漏掉的颜色排除项在这里确定性补齐（可关）
    added = 0
    if backend != "wd14" and payload.get("enforce_colours", True):
        text, added = enforce_colour_exclusions(text, lang)
        if added:
            used.append(f"补排除项×{added}")

    return {
        "ok": True,
        "text": text,
        "colours_added": added,
        "tags": tags,
        # 设定稿排版特征 -> 「不保留」候选。不主动写进剧本，由用户勾选。
        "suggest_not_retained": (tags or {}).get("sheet") or [],
        "dropped_absence": dropped,
        "backend": backend,
        "used": used,
        "seconds": round(time.time() - t0, 1),
    }


# ----------------------------------------------------------------- HTTP 路由

def register_routes():
    try:
        from server import PromptServer
    except Exception:
        return
    routes = getattr(PromptServer.instance, "routes", None)
    if routes is None:
        return
    add_routes(routes)


def add_routes(routes):
    """把路由挂到一张 aiohttp RouteTableDef 上。

    抽出来是为了能在独立进程里挂同一份代码做端到端测试，
    不必为了验证而重启用户正在用的 ComfyUI。
    """
    from aiohttp import web

    @routes.get("/minimax_h3_studio/caption/status")
    async def _status(_request):
        return web.json_response(backend_status())

    @routes.post("/minimax_h3_studio/caption/settings")
    async def _settings(request):
        try:
            patch = await request.json()
        except Exception:
            patch = {}
        return web.json_response({"ok": True, "settings": save_settings(patch)})

    @routes.post("/minimax_h3_studio/caption")
    async def _caption(request):
        try:
            payload = await request.json()
        except Exception:
            return web.json_response({"ok": False, "error": "请求体不是 JSON"}, status=400)
        import asyncio
        loop = asyncio.get_running_loop()
        try:
            # 反推是同步重活，丢到线程池，别把 ComfyUI 的事件循环卡住
            result = await loop.run_in_executor(None, run_caption, payload)
            return web.json_response(result)
        except Exception as exc:
            traceback.print_exc()
            return web.json_response({"ok": False, "error": f"{type(exc).__name__}: {exc}"},
                                     status=500)

    @routes.post("/minimax_h3_studio/caption/unload")
    async def _unload(_request):
        unload_caption_models()
        return web.json_response({"ok": True})
