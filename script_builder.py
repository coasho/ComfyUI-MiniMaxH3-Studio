# -*- coding: utf-8 -*-
"""Structured script -> MiniMax H3 six-section prompt, with a speech-budget check.

Why this exists
---------------
Writing H3 prompts by hand means retyping the same six-section scaffold every time
(subject_definitions / art_style / retention_analysis / detailed_description /
overall_soundscape / non_diegetic_music), remembering `[Shot N] At MM:SS.mmm`,
`<d>[Lang]...</d>`, stable `(S1)` ids, and "camera = motion + amplitude + speed".
Easy to get subtly wrong; the model fails quietly when you do.

ComfyUI-MiniMax-H3-Guide solves the structure part, but its dialogue validation only
checks that a line's *start offset* lands inside its shot — it has no speech-rate model
at all. So it cannot catch the failure that actually bites: too many characters crammed
into too few seconds, which makes H3 rush the delivery, drop words, or skip lip-sync
entirely. This module adds that missing budget check.

Script DSL
----------
    @meta duration=15 fps=24 speaker=少女 lang=Chinese
    @style 干净细线动画，平涂哑光赛璐璐上色…
    @subject 少女 | 浅亚麻金低双马尾，中等大小蓝眼…
    @keep 少女 | fully_preserved | 发色/眼睛大小/饱和度/平涂上色/线条粗细
    @drop 白色背景与 T-pose 姿势

    @shot 0.0 | 小幅度慢速推进，从中景推到胸部以上，低角度
    天台，晴朗蓝天…（镜头内容，可多行）
    @say 0.8 | 压低的气声耳语，克制鬼祟
    接下来……C位出道曲。

    @sound 开阔天台的微风、远处哨声…
    @music 轻快明亮的日系偶像伴奏…
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# Mandarin lands around 4.5 characters/second in relaxed delivery. Deliberately
# conservative: under-filling a shot is harmless, over-filling is what breaks lip-sync.
CHARS_PER_SECOND = 4.5
# Silence H3 needs on either side of a line so it does not run lines together.
PAD_BEFORE = 0.35
PAD_AFTER = 0.35
# Punctuation is rendered as pause, not as spoken syllables.
_PUNCT = "，。！？…—、；：,.!?;:\"'（）()《》 \t　"


def spoken_chars(text: str) -> int:
    """Characters that actually consume speaking time."""
    body = re.sub(r"^\[[^\]]*\]", "", text)          # strip a leading [Chinese] tag
    return sum(1 for ch in body if ch not in _PUNCT)


def speech_seconds(text: str) -> float:
    return spoken_chars(text) / CHARS_PER_SECOND


@dataclass
class Line:
    offset: float
    delivery: str
    text: str
    speaker: str = ""


@dataclass
class Shot:
    cut_at: float
    camera: str
    description: str = ""
    lines: list[Line] = field(default_factory=list)


@dataclass
class Script:
    duration: float = 15.0
    fps: int = 24
    speaker: str = ""
    lang: str = "Chinese"
    style: str = ""
    sound: str = ""
    music: str = ""
    subjects: list[tuple[str, str]] = field(default_factory=list)
    keeps: list[tuple[str, str, str]] = field(default_factory=list)
    drops: list[str] = field(default_factory=list)
    shots: list[Shot] = field(default_factory=list)


def parse(text: str) -> Script:
    sc = Script()
    cur_shot: Shot | None = None
    cur_line: Line | None = None
    buf: list[str] = []

    def flush():
        nonlocal buf, cur_line
        blob = "\n".join(buf).strip()
        buf = []
        if cur_line is not None:
            cur_line.text = blob
            cur_line = None
        elif cur_shot is not None and blob:
            cur_shot.description = (cur_shot.description + "\n" + blob).strip()

    for raw in text.splitlines():
        line = raw.rstrip()
        m = re.match(r"^\s*@(\w+)\s*(.*)$", line)
        if not m:
            buf.append(line)
            continue
        flush()
        tag, rest = m.group(1).lower(), m.group(2).strip()

        if tag == "meta":
            for k, v in re.findall(r"(\w+)\s*=\s*([^\s]+)", rest):
                if k == "duration":
                    sc.duration = float(v)
                elif k == "fps":
                    sc.fps = int(v)
                elif k == "speaker":
                    sc.speaker = v
                elif k == "lang":
                    sc.lang = v
        elif tag == "style":
            sc.style = rest
        elif tag == "sound":
            sc.sound = rest
        elif tag == "music":
            sc.music = rest
        elif tag == "subject":
            name, _, desc = rest.partition("|")
            sc.subjects.append((name.strip(), desc.strip()))
        elif tag == "keep":
            parts = [p.strip() for p in rest.split("|")]
            sc.keeps.append((parts[0] if parts else "",
                             parts[1] if len(parts) > 1 else "fully_preserved",
                             parts[2] if len(parts) > 2 else ""))
        elif tag == "drop":
            sc.drops.append(rest)
        elif tag == "shot":
            head, _, cam = rest.partition("|")
            cur_shot = Shot(cut_at=float(head.strip() or 0), camera=cam.strip())
            sc.shots.append(cur_shot)
        elif tag == "say":
            parts = [p.strip() for p in rest.split("|")]
            off = float(parts[0]) if parts and parts[0] else 0.0
            cur_line = Line(offset=off,
                            delivery=parts[1] if len(parts) > 1 else "",
                            text="",
                            speaker=parts[2] if len(parts) > 2 else sc.speaker)
            if cur_shot is None:
                cur_shot = Shot(cut_at=0.0, camera="")
                sc.shots.append(cur_shot)
            cur_shot.lines.append(cur_line)
    flush()
    return sc


def _strip_negated(text: str) -> str:
    """Drop negated clauses so "does NOT widen" / "不拉远" stop tripping the detector."""
    text = re.sub(
        r"(?:does\s+not|do\s+not|doesn't|don't|never|without|no)\s+"
        r"(?:\w+\s+){0,2}?(pull\w*\s+(?:back|out)|zoom\w*\s+out|widen|wide[ns]?)",
        " ", text, flags=re.I)
    text = re.sub(r"(?:不|别|禁止|勿)\s*(?:要\s*)?(拉远|后拉|拉开|缩放|扩大取景|变宽)", " ", text)
    return text


def shot_span(sc: Script, idx: int) -> tuple[float, float]:
    start = sc.shots[idx].cut_at
    end = sc.shots[idx + 1].cut_at if idx + 1 < len(sc.shots) else sc.duration
    return start, end


def check(sc: Script) -> list[str]:
    """Return human-readable problems. Empty list means the script is sane."""
    out: list[str] = []
    if not sc.shots:
        out.append("没有任何 @shot，提示词只会是静态描述。")
        return out

    if abs(sc.shots[0].cut_at) > 1e-6:
        out.append(f"第 1 镜的 cut_at 应为 0.0，当前是 {sc.shots[0].cut_at}。")
    for i in range(1, len(sc.shots)):
        if sc.shots[i].cut_at <= sc.shots[i - 1].cut_at:
            out.append(f"第 {i+1} 镜的 cut_at ({sc.shots[i].cut_at}) 未晚于第 {i} 镜。")
    if sc.shots[-1].cut_at >= sc.duration:
        out.append(f"最后一镜起点 {sc.shots[-1].cut_at}s 不早于总时长 {sc.duration}s。")

    total_speech = 0.0
    for i, sh in enumerate(sc.shots):
        start, end = shot_span(sc, i)
        span = end - start
        need = 0.0
        for ln in sh.lines:
            need += PAD_BEFORE + speech_seconds(ln.text) + PAD_AFTER
        total_speech += sum(speech_seconds(l.text) for l in sh.lines)

        if sh.lines and need > span:
            names = " / ".join(f"“{l.text[:12]}”({spoken_chars(l.text)}字)" for l in sh.lines)
            out.append(
                f"镜头 {i+1} ({start:.1f}-{end:.1f}s, 共 {span:.1f}s) 装不下 "
                f"{len(sh.lines)} 句台词：{names}，含前后留白约需 {need:.1f}s。"
                f" → 把该镜起点提前、或缩短台词、或把一句挪到别的镜头。"
            )
        for ln in sh.lines:
            if ln.offset >= span:
                out.append(f"镜头 {i+1} 的台词 offset {ln.offset}s 超出该镜时长 {span:.1f}s。")
            if not ln.text.strip():
                out.append(f"镜头 {i+1} 有一条 @say 没有正文。")
        if not sh.description.strip():
            out.append(f"镜头 {i+1} 没有画面描述。")
        if sh.lines and not sh.camera:
            out.append(f"镜头 {i+1} 有台词但没写运镜；H3 需要「运动+幅度+速度」。")
        if sh.lines:
            blob = _strip_negated(sh.camera + " " + sh.description)
            if re.search(r"拉远|后拉|拉开|pull\w*\s+(?:back|out)|zoom\w*\s+out"
                         r"|widen|pulls?\s+away|dolly\w*\s+out", blob, re.I):
                out.append(
                    f"镜头 {i+1} 在有台词的同时做拉远运镜——画面拉开后嘴部只剩几个像素，"
                    f"口型必然看不见。 → 台词期间锁定景别，拉远放到最后一句说完之后。"
                )
            elif re.search(r"远景|全景|广角|wide\s+(?:shot|angle)|full[- ]body", blob, re.I):
                out.append(
                    f"镜头 {i+1} 用远景/全身景别却有台词——嘴部占不到几个像素，口型会看不清。"
                    f" → 若这句台词需要看见口型，改成中近景；纯背景音或画外音则可忽略。"
                )

    if total_speech > sc.duration * 0.62:
        out.append(
            f"台词总时长约 {total_speech:.1f}s，占全片 {total_speech/sc.duration*100:.0f}%，"
            f"留给动作和留白的时间过少（建议不超过 60%）。"
        )
    if not sc.style:
        out.append("缺 @style：不写画风约束，模型会套用它默认的高饱和电视动画风。")
    if not sc.drops:
        out.append("缺 @drop：用三视图当参考时，不显式排除白底和 T-pose 容易被一起搬进画面。")
    if not sc.sound:
        out.append("缺 @sound（overall_soundscape）。")
    if not sc.music:
        out.append("缺 @music（non_diegetic_music）；确实要无配乐请写 N/A。")
    return out


def _ts(t: float) -> str:
    return f"{int(t // 60):02d}:{t - 60 * int(t // 60):06.3f}"


def build(sc: Script, ref_token: str = "", audio_token: str = "") -> str:
    """Assemble the official six-section H3 prompt."""
    S: list[str] = []

    subj = []
    for name, desc in sc.subjects:
        subj.append(f"<Subject {len(subj)+1}> is {name}: {desc}")
    if ref_token:
        subj.append(f"{ref_token} is the character reference sheet that defines "
                    f"<Subject 1>'s appearance.")
    if audio_token:
        subj.append(f"{audio_token} is the voice-timbre reference for <Subject 1> (S1). "
                    f"<Subject 1> (S1) speaks with the exact vocal timbre, pitch and vocal "
                    f"age of that reference for the whole video; do not use any other voice.")
    S.append("subject_definitions: " + " ".join(subj))

    if sc.style:
        S.append("art_style: " + sc.style)

    keep_bits = [f"<Subject {i+1}> {mode}" + (f" — {detail}" if detail else "")
                 for i, (_, mode, detail) in enumerate(sc.keeps)]
    ret = "retention_analysis: " + ("; ".join(keep_bits) if keep_bits else
                                    "<Subject 1> fully_preserved")
    if sc.drops:
        ret += ". NOT retained: " + "; ".join(sc.drops) + "."
    S.append(ret)

    body: list[str] = []
    for i, sh in enumerate(sc.shots):
        head = "" if i == 0 else f"[Shot {i+1}] At {_ts(sh.cut_at)}, "
        seg = head + sh.description.strip()
        if sh.camera:
            seg += f" The camera {sh.camera.strip()}"
            if not seg.rstrip().endswith((".", "。")):
                seg += "."
        for ln in sh.lines:
            who = ln.speaker or sc.speaker or "the character"
            seg += (f" {who} (S1) says, {ln.delivery}, with lips moving clearly and "
                    f"visibly on every syllable: <d>[{sc.lang}]{ln.text.strip()}</d>")
        body.append(seg)
    S.append("detailed_description: " + "\n\n".join(body))

    S.append("overall_soundscape: " + (sc.sound or "N/A"))
    S.append("non_diegetic_music: " + (sc.music or "N/A"))
    return "\n\n".join(S)


def report(sc: Script) -> str:
    """Timing table plus problems, for the node's report output."""
    rows = ["镜头  区间            时长    台词  说话时长  占比"]
    for i, sh in enumerate(sc.shots):
        a, b = shot_span(sc, i)
        span = b - a
        spk = sum(speech_seconds(l.text) for l in sh.lines)
        rows.append(f"{i+1:^4d}  {a:5.1f}-{b:5.1f}s  {span:5.1f}s  {len(sh.lines):^4d}"
                    f"  {spk:6.1f}s  {(spk/span*100 if span else 0):5.0f}%")
    probs = check(sc)
    rows.append("")
    rows.append(f"语速基准 {CHARS_PER_SECOND} 字/秒，每句前后各留 {PAD_BEFORE}s")
    rows.append("")
    rows.append("✅ 未发现问题" if not probs else f"⚠ {len(probs)} 个问题：")
    rows += [f"  {i+1}. {p}" for i, p in enumerate(probs)]
    return "\n".join(rows)
