"""图生文反推节点：一张图进去，中英文两份描述出来。

和剧本编辑器里那个反推弹窗是同一套后端（caption.run_caption），区别只是
这里做成节点，能单独连成工作流批量跑、能接进别的图流程。

为什么中文是从英文译出来、而不是让模型分别写两遍：
两份必须说的是同一件事。英文那份要进提示词，中文那份是给人核对的——
如果各写各的，人核对中文没问题就发货，实际发出去的英文可能说了别的。
分开写还要多跑一趟 VLM，慢一倍。
"""

from __future__ import annotations

import base64
import io
import traceback

try:
    from . import caption
except ImportError:                       # 独立加载（测试台）时没有包上下文
    import caption                        # type: ignore


KINDS = ["identity", "object", "scene", "action", "style"]
KIND_LABELS = {
    "identity": "人物：长相、发型、瞳色、服装",
    "object": "物件/服装/道具：外观",
    "scene": "场景/环境",
    "action": "动作/姿态",
    "style": "画风/渲染风格",
}


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


class MiniMaxH3Caption:
    """从参考图反推特征描述，同时给出英文（进提示词）和中文（给人核对）。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "kind": (KINDS, {"default": "identity",
                                 "tooltip": "问什么。人物问长相服装，场景问环境，画风问渲染风格。"}),
                "backend": (["auto", "qwen3vl", "wd14", "openai"], {"default": "auto"}),
                "use_wd14_tags": ("BOOLEAN", {"default": True,
                    "tooltip": "二次元图先用 WD14 抽标签当事实依据喂给 VLM。"
                               "发色瞳色服饰这类离散属性标签比 VLM 准得多。写实照片建议关。"}),
                "translate_to_chinese": ("BOOLEAN", {"default": True,
                    "tooltip": "关掉就不跑第二趟，中文输出为空，快几秒。"}),
                "add_colour_exclusions": ("BOOLEAN", {"default": True,
                    "tooltip": "给每个颜色补上「NOT 邻近色」。H3 不写这个，深色头发会飘成橙色。"}),
            },
            "optional": {
                "hint": ("STRING", {"multiline": True, "default": "",
                                    "tooltip": "补充说明，例如「只描述上半身」「忽略背景」。"}),
                "unload_after": ("BOOLEAN", {"default": True,
                    "tooltip": "跑完就把 8.3GB 的 VLM 放掉。和视频模型串在一条工作流里时必须开。"}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("english", "chinese", "tags", "not_retained")
    OUTPUT_TOOLTIPS = (
        "英文描述，可直接进提示词",
        "中文描述，由英文译出，供人核对",
        "WD14 标签（逗号分隔），没跑 WD14 就是空的",
        "设定稿版式特征（三视图/白底/T-pose 之类），建议写进「不保留」",
    )
    FUNCTION = "run"
    CATEGORY = "MiniMax H3"
    DESCRIPTION = "从参考图反推特征描述，同时输出英文与中文。"

    def run(self, image, kind, backend, use_wd14_tags, translate_to_chinese,
            add_colour_exclusions, hint="", unload_after=True):
        img = _to_pil(image)
        payload = {
            "image": _data_url(img),
            "kind": kind,
            "backend": backend,
            "language": "en",          # 先出英文，中文由它译；两份才对得上
            "hint": hint or "",
            "use_tags": bool(use_wd14_tags),
        }
        try:
            res = caption.run_caption(payload)
            english = str(res.get("text") or "").strip()

            if add_colour_exclusions and backend != "wd14" and english:
                english, _ = caption.add_colour_exclusions(english)

            chinese = ""
            if translate_to_chinese and english:
                try:
                    chinese = caption.translate_to_chinese([english], backend)[0]
                except Exception:
                    # 翻译失败不该让整个节点失败——英文才是主产物
                    traceback.print_exc()
                    chinese = ""

            tags = res.get("tags") or {}
            tag_text = ", ".join(list(tags.get("character") or [])
                                 + list(tags.get("general") or []))
            not_retained = "; ".join(res.get("suggest_not_retained") or [])
            print(f"[MiniMaxH3-Studio] 反推完成：{res.get('backend')} "
                  f"{res.get('seconds')}s，用了 {'+'.join(res.get('used') or [])}")
            return (english, chinese, tag_text, not_retained)
        finally:
            if unload_after:
                try:
                    caption.unload_caption_models()
                except Exception:
                    traceback.print_exc()


# 显示文本用核心的 PreviewAny（显示名「Preview as Text」），不自己造一个：
# 它同样把 STRING 透传出来，还省掉一个前端 widget。

NODE_CLASS_MAPPINGS = {
    "MiniMaxH3Caption": MiniMaxH3Caption,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "MiniMaxH3Caption": "MiniMax H3 图生文反推",
}
