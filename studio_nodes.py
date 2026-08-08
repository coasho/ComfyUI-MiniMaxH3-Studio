# -*- coding: utf-8 -*-
"""Studio nodes: structured script -> H3 prompt, with a validation report.

MiniMaxH3StudioScript takes the compact script DSL (see script_builder), emits the
official six-section prompt, and reports timing problems. Feed `prompt` into
MiniMaxH3Easy's prompt input (right-click the widget -> convert to input).

The report is what makes this worth using: it catches the failures that are invisible
until you have burned ten minutes on a generation — dialogue that cannot fit its shot,
and a pull-back happening while someone is talking (mouth ends up a few pixels wide).
"""

from __future__ import annotations

from . import script_builder as sb

EXAMPLE = """@meta duration=15 fps=24 speaker=少女 lang=Chinese
@style 干净细线动画，平涂哑光赛璐璐上色，每面只有基色加一层柔和阴影，低对比低饱和、略褪色的配色。无高光泽、无边缘光、无泛光、无星芒特效、无渐变喷绘。柔和轻小说插画质感，不是高对比现代电视动画。
@subject 少女 | 长发浅亚麻金低双马尾（冷调奶金，非橙非姜非焦糖非金黄），齐刘海，中等大小的柔和蓝眼、平实虹膜仅一点小高光；白色短袖水手服配灰粉领与灰粉白条纹袖口，中等暗哑红蝴蝶结，灰粉裙，纯白过膝袜，棕色乐福鞋。正常青少年比例，非Q版。
@keep 少女 | fully_preserved | 发色色相、眼睛大小与画法、饱和度、平涂上色、线条粗细
@drop 参考图的纯白背景
@drop 参考图的 T-pose 姿势

@shot 0.0 | pushes in with small amplitude at slow speed, from a medium shot to a chest-up framing, low heroic angle
天台，晴朗蓝天，背后铁丝网围栏，左侧灰色楼梯间门关着。少女蹑手蹑脚走到中央，左右张望，贴门倾听。确认无人后猛地立正、双臂张开摆出闪耀偶像造型。
@say 1.2 | in a hushed breathy stage-whisper, quiet and conspiratorial, not shouted
接下来……C位出道曲。

@shot 3.5 | arcs to the left with medium amplitude at medium speed, circling her
全身广角。少女全情投入跳偶像舞：头顶双击掌、扭胯、快速侧步、单脚原地旋转。双马尾大幅甩动，粉裙张开，白过膝袜随步伐闪现。表情纯粹快乐专注。
@say 1.0 | counting under her breath, soft and steady, not hyped
一、二、三、四……

@shot 7.0 | holds almost still, drifting forward with very small amplitude at very slow speed
过肩中景。她举起手臂猛地转向楼梯间——僵住。灰色门大开，全班同学挤在门口静静盯着她，一个男生还抱着排球。死寂。她举起的手臂僵在半空，双马尾软塌落回背上。
@say 1.4 | one small strangled cracked syllable, isolated in total silence, no music under it
……啊。

@shot 9.5 | stays locked, holding on the frozen face for an uncomfortably long beat
面部大特写。血色褪去，眼睛睁到极大发直，笑容凝固开裂，一滴汗滑下太阳穴。缓慢眨眼。脸颊从下颌开始爆红。这一镜完全不说话。

@shot 11.0 | holds a waist-up framing and does NOT widen while she speaks, drifting only very slightly at very slow speed
腰部以上中近景，她的脸占画面很大一部分，嘴部清晰可辨。双臂啪地放下、挺直背，开始做僵硬机械的广播体操摆臂，完全面无表情。三七侧身，敞开的门留在肩后画面内，同学们仍一动不动。
@say 0.4 | in a very quiet small mumbled monotone, noticeably softer than anything she said earlier
那个、这是广播体操。
@say 2.2 | even quieter than the previous line, trailing off into a mumble
……第八套。

@sound 开阔天台微风、远处操场噪音与哨声、跳舞时皮鞋在水泥地的踩踏摩擦、衣料与头发摆动；看见门口时骤然跌入近乎全静音，只剩风声和一次排球落地。全部环境音干净、留足余量、明显低于人声。
@music 轻快明亮的日系偶像伴奏，合成器、拍手与简单节拍，音量适中偏低、混在人声之下、不失真；看见同学的瞬间完全切断留白；广播体操时飘进一句怯生生的木管。"""


class MiniMaxH3StudioScript:
    CATEGORY = "MiniMax H3 Studio"
    FUNCTION = "build"
    RETURN_TYPES = ("STRING", "STRING", "INT", "BOOLEAN")
    RETURN_NAMES = ("prompt", "report", "seconds", "ok")
    DESCRIPTION = (
        "Write shots and dialogue in a compact script; get the official six-section "
        "H3 prompt plus a timing/consistency report."
    )
    OUTPUT_NODE = True

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "script": ("STRING", {"multiline": True, "default": EXAMPLE}),
            },
            "optional": {
                "image_ref_token": ("STRING", {"default": "", "tooltip":
                    "参考图的 @ 标记，例如 @anima女孩三视图.png；留空则不写图像参考句"}),
                "audio_ref_token": ("STRING", {"default": "", "tooltip":
                    "音色参考的 @ 标记；留空则不写音色绑定句"}),
                "strict": ("BOOLEAN", {"default": False, "tooltip":
                    "开启后，发现问题就报错中断，而不是仅在 report 里提示"}),
            },
        }

    def build(self, script, image_ref_token="", audio_ref_token="", strict=False):
        sc = sb.parse(script)
        problems = sb.check(sc)
        rep = sb.report(sc)
        if strict and problems:
            raise ValueError("脚本存在问题：\n" + "\n".join(f"- {p}" for p in problems))
        prompt = sb.build(sc, image_ref_token.strip(), audio_ref_token.strip())
        return {
            "ui": {"text": [rep]},
            "result": (prompt, rep, int(round(sc.duration)), not problems),
        }


class MiniMaxH3StudioCheck:
    """Validate an already-written prompt/script without rebuilding it."""

    CATEGORY = "MiniMax H3 Studio"
    FUNCTION = "run"
    RETURN_TYPES = ("STRING", "BOOLEAN")
    RETURN_NAMES = ("report", "ok")
    OUTPUT_NODE = True

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"script": ("STRING", {"multiline": True, "default": ""})}}

    def run(self, script):
        sc = sb.parse(script)
        rep = sb.report(sc)
        return {"ui": {"text": [rep]}, "result": (rep, not sb.check(sc))}


NODE_CLASS_MAPPINGS = {
    "MiniMaxH3StudioScript": MiniMaxH3StudioScript,
    "MiniMaxH3StudioCheck": MiniMaxH3StudioCheck,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "MiniMaxH3StudioScript": "MiniMax H3 剧本 → 提示词",
    "MiniMaxH3StudioCheck": "MiniMax H3 剧本检查",
}
