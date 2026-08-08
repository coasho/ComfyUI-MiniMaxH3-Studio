"""图生文反推节点：一张图进去，中英文两份提示词出来。

就是普通的反推提示词，不带任何 H3 语法加工——不套 <Subject N> 的实体框架、
不补「NOT 邻近色」的颜色围栏、不剥离设定稿版式。那些是剧本编辑器保存时干的事，
反推出来的东西应该是原样的描述，怎么用是使用者的事。

中文由英文译出而不是让模型写两遍：两份得说同一件事，否则核对了中文、
用出去的英文却是别的意思。分开写还要多跑一趟 VLM。
"""

from __future__ import annotations

import base64
import io
import re
import time
import traceback

try:
    from . import caption
except ImportError:                       # 独立加载（测试台）时没有包上下文
    import caption                        # type: ignore


# 三种常见的反推口味。都是「描述这张图」，区别只在写成什么形状。
STYLES = {
    "natural": (
        "Describe this image as a prompt for an image generation model. "
        "One flowing paragraph of plain English, present tense, no preamble. "
        "Cover the subject, what they look like, what they are wearing or made of, "
        "the pose or action, the setting, the lighting, the composition and the art style. "
        "Be concrete and specific. State only what is actually visible — "
        "never guess at names, stories, brands or anything off-frame."
    ),
    "tags": (
        "Describe this image as a comma-separated prompt for an image generation model, "
        "in the usual keyword style: subject first, then appearance, clothing, pose, "
        "setting, lighting, composition, art style. Lower case, no sentences, "
        "no numbering, no preamble. State only what is actually visible. "
        # 不这么写它就把下面喂的标签表原样抄一遍，白跑一趟
        "Write your own list — do not simply repeat the tagger's list back. "
        "A tagger only names discrete objects and attributes; also cover "
        "framing, lighting, colour palette, mood and rendering style, which it misses. "
        # 不封顶它会一路写 no shadows, no watermark, no motion blur…把 token 耗光
        "Stop at about 40 items. Never write a negation — no 'no ...', no 'without ...', "
        "no 'lack of ...'. A prompt lists what IS in the picture, nothing else."
    ),
    "detailed": (
        "Describe this image in detail as a prompt for an image generation model. "
        "Plain English prose, no preamble, no headings. Work through it in this order: "
        "the subject and their appearance (build, face, hair, eyes, skin), "
        "clothing and accessories piece by piece, pose and expression, "
        "the environment and background, lighting and colour palette, "
        "camera framing, and the rendering style. "
        "Be concrete and specific about colours, materials and shapes. "
        "State only what is actually visible — never guess at names, stories, "
        "brands or anything off-frame."
    ),
}

STYLE_IDS = ["natural", "tags", "detailed"]

TRANSLATE_ZH = (
    "Translate this image prompt into Chinese for a human to read. "
    "Keep the same structure and the same level of detail. "
    "Do not add, drop, summarise or explain anything. "
    "Output only the translation."
)

# 标签是逗号分隔的短词，整段当散文翻会被改写成句子，逐项翻才对得上
TRANSLATE_ZH_TAGS = (
    "Translate this comma-separated image prompt into Chinese. "
    "Keep it comma-separated and keep the same number of items in the same order. "
    "Translate each item as a short phrase, not a sentence. "
    "Leave established danbooru terms that have no Chinese equivalent as they are "
    "(for example 1girl, serafuku, zettai ryouiki). "
    "Output only the translated list."
)


def _to_pil(image):
    """ComfyUI 的 IMAGE（B,H,W,C float 0-1）-> PIL，顺带缩到反推用的尺寸。"""
    import numpy as np
    from PIL import Image

    arr = image[0].detach().cpu().numpy() if hasattr(image, "detach") else image[0]
    arr = (np.clip(arr, 0.0, 1.0) * 255.0).round().astype("uint8")
    img = Image.fromarray(arr, "RGB")
    if max(img.size) > caption.MAX_SIDE:
        r = caption.MAX_SIDE / max(img.size)
        img = img.resize((max(1, int(img.width * r)), max(1, int(img.height * r))),
                         Image.LANCZOS)
    return img


def _data_url(img) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


_NEGATION = re.compile(r"^(no|not|non|without|lacks?|lacking|free of|absent|devoid)\b", re.I)


def _clean_tags(text: str, limit: int = 45) -> str:
    """
    标签列表收尾。

    写满 40 项之后 4B 模型会拐进「no shadows, no watermark, no motion blur…」
    一路否定词，直到把 token 耗光、最后一项还是半截的。指令里写死「不许写否定」
    压不住（和颜色排除项那次一模一样），所以在代码里删——这不是加工语义，
    是把模型自己的垃圾扫掉。
    """
    out, seen = [], set()
    items = [x.strip() for x in str(text or "").split(",")]
    for i, it in enumerate(items):
        if not it or _NEGATION.match(it):
            continue
        # 最后一项没跟逗号 = 生成被 max_tokens 截断，半截词不要
        if i == len(items) - 1 and not str(text).rstrip().endswith((",", ".")) and len(it) < 3:
            continue
        k = it.lower()
        if k in seen:
            continue
        seen.add(k)
        out.append(it)
        if len(out) >= limit:
            break
    return ", ".join(out)


class ImageToPromptBilingual:
    """图生文反推：一张图 -> 英文提示词 + 中文提示词 + 标签。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                # 四个开关各对应一路输出。每开一路多跑一趟模型，全开约四趟，
                # 所以默认不全开——只出英文那两路，中文按需再打开。
                "natural_en": ("BOOLEAN", {"default": True,
                    "tooltip": "自然语言 · 英文。一段成句的描述。"}),
                "natural_zh": ("BOOLEAN", {"default": True,
                    "tooltip": "自然语言 · 中文。由英文那份译出，两边说的是同一件事。"}),
                "tags_en": ("BOOLEAN", {"default": True,
                    "tooltip": "标签 · 英文。逗号分隔的关键词。"}),
                "tags_zh": ("BOOLEAN", {"default": False,
                    "tooltip": "标签 · 中文。逐项翻译，保持逗号分隔和顺序。"}),
                "backend": (["auto", "qwen3vl", "wd14", "openai"], {"default": "auto",
                    "tooltip": "wd14 只有 danbooru 标签、不成句，选它自然语言那两路会空。"
                               "openai 走反推弹窗里填的兼容接口。"}),
                "use_wd14_tags": ("BOOLEAN", {"default": True,
                    "tooltip": "先用 WD14 抽标签喂给 VLM 当依据。发色瞳色服饰这类"
                               "离散属性标签比 VLM 准。写实照片建议关。"}),
            },
            "optional": {
                "hint": ("STRING", {"multiline": True, "default": "",
                    "tooltip": "补充要求，例如「只描述人物，忽略背景」「用于 SDXL」。"}),
                "unload_after": ("BOOLEAN", {"default": True,
                    "tooltip": "跑完把 8.3GB 的 VLM 放掉。和视频模型串在一条工作流里时必须开。"}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("natural_en", "natural_zh", "tags_en", "tags_zh", "wd14_tags")
    OUTPUT_TOOLTIPS = (
        "自然语言 · 英文",
        "自然语言 · 中文",
        "标签 · 英文",
        "标签 · 中文",
        "WD14 原始 danbooru 标签，没跑 WD14 就是空的",
    )
    FUNCTION = "run"
    CATEGORY = "图生文反推"
    DESCRIPTION = "图生文反推提示词：自然语言 / 标签 × 中文 / 英文，四路各自可开关。"

    def run(self, image, natural_en, natural_zh, tags_en, tags_zh,
            backend, use_wd14_tags, hint="", unload_after=True):
        img = _to_pil(image)
        t0 = time.time()
        s = caption.load_settings()
        backend = caption.pick_backend(backend or "auto")
        # 中文那路要先有英文才能译，所以英文关着、中文开着时照样得跑一趟英文，
        # 只是不往外输出
        need_natural = natural_en or natural_zh
        need_tags = tags_en or tags_zh
        did = []

        try:
            wd14 = ""
            if use_wd14_tags and caption.wd14_paths():
                try:
                    # split_sheet=False：要标注器原样的英文标签。默认那套会把
                    # 「三视图/白底/T-pose」挑出来换成中文，那是剧本编辑器的
                    # 「不保留」候选，普通反推里不该出现，更不该混进英文输出。
                    t = caption.wd14_tags(img, split_sheet=False)
                    wd14 = ", ".join(list(t.get("character") or [])
                                     + list(t.get("general") or []))
                    did.append("wd14")
                except Exception:
                    traceback.print_exc()

            nat_en = tag_en = ""
            if backend == "wd14":
                # 这个后端只有标签，没有成句能力
                tag_en = wd14
            else:
                if need_natural:
                    nat_en = self._describe(img, "natural", wd14, hint, backend, s)
                    did.append("natural")
                if need_tags:
                    tag_en = _clean_tags(
                        self._describe(img, "tags", wd14, hint, backend, s))
                    did.append("tags")

            nat_zh = tag_zh = ""
            if natural_zh and nat_en:
                nat_zh = self._translate(nat_en, TRANSLATE_ZH, backend, s)
                did.append("natural_zh")
            if tags_zh and tag_en:
                tag_zh = self._translate(tag_en, TRANSLATE_ZH_TAGS, backend, s)
                did.append("tags_zh")

            print(f"[图生文反推] {backend} {time.time() - t0:.1f}s，跑了 "
                  + "+".join(did or ["无"]))
            return (nat_en if natural_en else "", nat_zh,
                    tag_en if tags_en else "", tag_zh, wd14)
        finally:
            if unload_after:
                try:
                    caption.unload_caption_models()
                except Exception:
                    traceback.print_exc()

    @staticmethod
    def _describe(img, style, wd14, hint, backend, s) -> str:
        parts = [STYLES.get(style) or STYLES["natural"]]
        if wd14:
            parts.append(
                "A danbooru tagger read this image as: " + wd14 + ". "
                "Those tags are more reliable than your own reading for discrete "
                "attributes such as hair colour, eye colour and garment names. "
                "Follow them where they conflict with what you think you see.")
        if hint and hint.strip():
            parts.append("Additional instruction from the user: " + hint.strip())
        instruction = "\n\n".join(parts)
        if backend == "openai":
            return (caption.openai_describe(_data_url(img), instruction, s) or "").strip()
        if not caption.qwen_ready():
            raise RuntimeError(f"Qwen3-VL 还没下载到 {caption.QWEN_DIR}")
        return (caption.qwen_describe(img, instruction) or "").strip()

    @staticmethod
    def _translate(text: str, system: str, backend: str, s: dict) -> str:
        try:
            prompt = system + "\n\n" + text
            raw = (caption.openai_describe_text(prompt, s) if backend == "openai"
                   else caption.qwen_text(prompt))
        except Exception:
            traceback.print_exc()      # 翻译失败不该让整个节点失败
            return ""
        out = (raw or "").strip()
        # 一个中文字都没有 = 压根没翻，宁可空着也别把英文当中文交出去
        return out if re.search(r"[一-鿿]", out) else ""


NODE_CLASS_MAPPINGS = {
    "ImageToPromptBilingual": ImageToPromptBilingual,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ImageToPromptBilingual": "图生文反推 · 中英双语",
}
