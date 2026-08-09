"""音色生成节点：文字描述或参考音频进去，AUDIO 出来，直接接 H3 的 media 口。

两条路，对应 Qwen3-TTS 的两种能力：
  设计 —— Qwen3TTSVoiceDesign，用一段文字描述嗓音。随机采样，换个 seed 音色差很远。
  克隆 —— Qwen3TTSVoiceClonePrompt + VoiceClone，从参考音频提音色向量复刻。
           这才是「指定音色」，不靠抽卡。

设计模式的挑选问题用 count 解决：一次出 n 条候选拼进同一段 AUDIO，接 PreviewAudio
连着听，听中第几条就把 seed 设成输出里报的那个值、count 调回 1 定下来。
一次只出一条、听到什么算什么，就是「什么大妈声音」的来源。

不碰 CustomVoice：那是固定预设，实测就是大妈声。
"""

from __future__ import annotations

import time
import traceback

try:
    from . import voice
except ImportError:                       # 独立加载（测试台）时没有包上下文
    import voice                          # type: ignore


# Qwen3-TTS 支持的语种。写死一份是为了做成下拉框，免得拼错了跑到一半才报错。
LANGUAGES = [
    "Chinese", "English", "Japanese", "Korean", "Spanish", "French",
    "German", "Italian", "Portuguese", "Russian", "Arabic",
]

MAX_COUNT = 8


def _concat(clips: list[dict]) -> dict:
    """多条候选拼成一段，中间垫 0.6 秒静音好分辨。"""
    import torch
    if not clips:
        raise RuntimeError("一条都没生成出来")
    if len(clips) == 1:
        return clips[0]
    sr = int(clips[0]["sample_rate"])
    gap = torch.zeros(1, 1, int(sr * 0.6))
    parts = []
    for i, c in enumerate(clips):
        wav = c["waveform"]
        if int(c["sample_rate"]) != sr:
            # 同一个模型同一次调用，采样率理应一致；真不一致就直说，
            # 别硬拼出一段忽快忽慢的音频让人以为是模型的锅
            raise RuntimeError(
                f"第 {i + 1} 条候选采样率是 {c['sample_rate']}，和第一条的 {sr} 不一致")
        if i:
            parts.append(gap)
        parts.append(wav)
    return {"waveform": torch.cat(parts, dim=-1), "sample_rate": sr}


def _seeds(base_seed: int, n: int) -> list[int]:
    if base_seed:
        return [base_seed + i * 7919 for i in range(n)]
    import random
    return [random.randrange(1, 2**31) for _ in range(n)]


def _finish(clips: list[dict], seeds: list[int], t0: float, unload: bool) -> tuple:
    audio = _concat(clips)
    if unload:
        try:
            voice.unload_voice_models()
        except Exception:                 # 卸载失败不该让已经生成好的音频作废
            traceback.print_exc()
    report = " / ".join(str(s) for s in seeds)
    took = round(time.time() - t0, 1)
    print(f"[MiniMaxH3-Studio] 音色生成完成，{len(clips)} 条，seed {report}，{took}s")
    return (audio, report)


class MiniMaxH3VoiceDesign:
    """文字描述 -> 音色。一次可出多条候选拼在一起并排试听。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "instruction": ("STRING", {"multiline": True, "default": "",
                    "tooltip": "描述嗓音本身，不是描述内容。例如「年轻女性，"
                               "音色清亮偏薄，语速偏快，尾音上扬，带一点气声」。"}),
                "text": ("STRING", {"multiline": True, "default": "",
                    "tooltip": "试听用的台词。填成片里真要说的那句，听到的才作数。"}),
                "language": (LANGUAGES, {"default": "Chinese"}),
                "count": ("INT", {"default": 4, "min": 1, "max": MAX_COUNT,
                    "tooltip": "一次出几条候选，拼成一段音频依次播放。"
                               "挑中第几条就把 seed 填成输出里报的那个数、count 调回 1。"}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 2**31 - 1,
                    "tooltip": "0 = 每次随机。定下音色后填回输出报的 seed 就能复现。"}),
            },
            "optional": {
                "unload_after": ("BOOLEAN", {"default": True,
                    "tooltip": "跑完把 TTS 模型放掉。和 H3 串在一条工作流里时必须开，"
                               "否则 H3 加载时显存不够。"}),
            },
        }

    RETURN_TYPES = ("AUDIO", "STRING")
    RETURN_NAMES = ("audio", "seeds")
    OUTPUT_TOOLTIPS = (
        "候选依次拼接，每条之间 0.6 秒静音",
        "各条候选的 seed，顺序和音频里一致",
    )
    FUNCTION = "run"
    CATEGORY = "MiniMax H3 Easy"
    DESCRIPTION = "音色设计：用文字描述嗓音，一次生成多条候选挑选。"

    def run(self, instruction, text, language, count, seed, unload_after=True):
        instruction = (instruction or "").strip()
        text = (text or "").strip()
        if not instruction:
            raise ValueError("音色描述不能为空")
        if not text:
            raise ValueError("试听文本不能为空")

        t0 = time.time()
        n = max(1, min(MAX_COUNT, int(count)))
        seeds = _seeds(int(seed), n)
        model, nodes = voice._load(voice.REPO_DESIGN)
        node = nodes.Qwen3TTSVoiceDesign()
        clips = []
        for s in seeds:
            (audio,) = node.generate(
                model_obj=model, text=text, voice_instruction=instruction,
                language=language, output_mode="Concatenate (Merge)", seed=s,
            )
            clips.append(audio)
        return _finish(clips, seeds, t0, unload_after)


class MiniMaxH3VoiceClone:
    """参考音频 -> 复刻音色说新台词。不抽卡，要哪个音色给哪段参考。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "ref_audio": ("AUDIO", {
                    "tooltip": "参考音色。5~15 秒干净人声最好，别带背景音乐。"}),
                "text": ("STRING", {"multiline": True, "default": "",
                    "tooltip": "要让这个音色说的话。"}),
                "language": (LANGUAGES, {"default": "Chinese"}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 2**31 - 1,
                    "tooltip": "0 = 每次随机。克隆的音色由参考音频决定，"
                               "seed 只影响语气和节奏的细微差别。"}),
            },
            "optional": {
                "ref_text": ("STRING", {"multiline": True, "default": "",
                    "tooltip": "参考音频里说的是什么。填了会更像；留空则只提音色向量。"}),
                "instruction": ("STRING", {"multiline": True, "default": "",
                    "tooltip": "额外的表演要求，例如「压低声音，语速放慢」。"}),
                "count": ("INT", {"default": 1, "min": 1, "max": MAX_COUNT,
                    "tooltip": "一次出几条候选拼在一起。克隆一般 1 条就够。"}),
                "unload_after": ("BOOLEAN", {"default": True,
                    "tooltip": "跑完把 TTS 模型放掉。和 H3 串在一条工作流里时必须开。"}),
            },
        }

    RETURN_TYPES = ("AUDIO", "STRING")
    RETURN_NAMES = ("audio", "seeds")
    FUNCTION = "run"
    CATEGORY = "MiniMax H3 Easy"
    DESCRIPTION = "音色克隆：给一段参考音频，用同一个音色说新台词。"

    def run(self, ref_audio, text, language, seed,
            ref_text="", instruction="", count=1, unload_after=True):
        text = (text or "").strip()
        if not text:
            raise ValueError("台词不能为空")

        t0 = time.time()
        n = max(1, min(MAX_COUNT, int(count)))
        seeds = _seeds(int(seed), n)
        model, nodes = voice._load(voice.REPO_BASE)
        ref_text = (ref_text or "").strip()
        (prompt,) = nodes.Qwen3TTSVoiceClonePrompt().create_prompt(
            model_obj=model, ref_audio=ref_audio,
            x_vector_only=not ref_text, ref_text=ref_text,
        )
        node = nodes.Qwen3TTSVoiceClone()
        clips = []
        for s in seeds:
            (audio,) = node.generate(
                model_obj=model, target_text=text, target_language=language,
                output_mode="Concatenate (Merge)", seed=s,
                voice_clone_prompt=prompt,
                instruct=(instruction or "").strip(),
            )
            clips.append(audio)
        return _finish(clips, seeds, t0, unload_after)


NODE_CLASS_MAPPINGS = {
    "MiniMaxH3VoiceDesign": MiniMaxH3VoiceDesign,
    "MiniMaxH3VoiceClone": MiniMaxH3VoiceClone,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "MiniMaxH3VoiceDesign": "音色设计 · 文字描述",
    "MiniMaxH3VoiceClone": "音色克隆 · 参考音频",
}
