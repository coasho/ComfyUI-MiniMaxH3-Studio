#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""H3 提示词结构校验 —— 命令行 / 生成时控制台用。

界面上的实时校验走的是 web/h3_lint.js（纯前端，改判据只要 Ctrl+R）。
这一份保留是为了批量跑金标准自检（22 条已出片提示词必须 0 ERROR）
和生成时在控制台查解析后的提示词。两边判据要同步改。

规则来自 docs/H3提示词写法完全指南.txt，阈值全部是从 22 条**实际出片**的提示词上量出来的。

重要：这 22 条分属 4 个流派，规则**必须按流派分档**。
把某一派的惯例当成通用 ERROR，就会把另外三派全判成不合格——
第一版就犯了这个错，在 4 条已出片的提示词上误报了 7 个 ERROR。

自检：
    python h3_prompt_lint.py --selftest <金标准目录>
必须 0 ERROR 才算规则正确。
"""
from __future__ import annotations

import re

# ---------------------------------------------------------------- 常量

ANCHOR_I2VA = ("For the target video, at 0.00 seconds into the target video, "
               "<Picture 1> (from [Shot 1]) is fully referenced.")

SCHOOLS = {
    # 流派 -> (必需字段, 说明)
    "base3": (["integrated_multimodal_description", "overall_soundscape", "non_diegetic_music"],
              "基础三段式（Pixaroma 19 条同款）"),
    "ref6": (["subject_definitions", "summary", "retention_analysis",
              "detailed_description", "overall_soundscape", "non_diegetic_music"],
             "官方 Ref2VA 六段式"),
    "ref4": (["summary", "detailed_description", "overall_soundscape", "non_diegetic_music"],
             "官方模板精简版（Subject 内联定义）"),
    "longform": ([], "工程化长文（自定义段名 + [SHOT N]）"),
}
ALL_FIELDS = ["subject_definitions", "summary", "retention_analysis", "detailed_description",
              "integrated_multimodal_description", "overall_soundscape", "non_diegetic_music"]

# 「说完之后镜头还活着」的收尾装置。19/19 Pixaroma 有 through the <末尾>
# （end 18 次 / final seconds 1 次）；六段式用显式定格；长文派用技术条款收尾。
# 中文提示词用「最后一帧定格」「余摆…后停住」表达同一件事 —— 判据必须双语，
# 否则中文提示词会被整片误报（实测一条正常的中文提示词误报了 3 条）。
# ⚠️ 只认「片尾」专用的说法。中文的「定格一拍」「画面定格两帧」「余摆…后停住」
# 是**镜头内**的定格，是作画技法，不是收尾装置 —— 早先把它们也算进来，
# 一条正常的提示词被报成「收尾装置出现 3 次」。
TAIL_DEVICES = [
    r"through the end", r"through the final \w+", r"through the last \w+",
    r"freezes on", r"holds on (?:this|the)", r"final frame",
    r"最后一帧", r"末帧", r"最后(?:一格|一格画面)",
    r"(?:结尾|片尾|最后)[^。；\n]{0,10}定格", r"定格(?:收束|收尾|结束)",
]

CUT_WORDS = ("hard cut", "cuts to", "cut to", "cuts into", "smash-zoom", "whip-zoom",
             "crash-zoom", "spiral whoosh", "camera cuts", "flash-cut", "whoosh-cut",
             "硬切", "切至", "切到", "镜头切", "跳切", "闪切", "直切")
CONTINUITY = ("keeps ", "still ", "back to", "without stopping", "again on",
              "continues", "only progress", "never reset", "persists", "accumulate",
              "仍", "依旧", "依然", "保持", "继续", "不变", "回到", "沿用", "未停")

FANCY_COLOURS = {"crimson", "azure", "emerald", "scarlet", "vermilion", "cerulean",
                 "magenta", "turquoise", "ochre", "indigo", "burgundy", "maroon",
                 "chartreuse", "mauve", "sapphire", "aquamarine", "fuchsia"}

LANGS = ("English|Chinese|Japanese|Korean|Spanish|French|German|Italian|"
         "Portuguese|Russian|Arabic|Thai|Vietnamese|Indonesian")

FRAME_STEP, FRAME_PLUS = 17, 5

# 中文单字承载的信息量约为英文的两倍，字符预算不能直接套。
# 22 条金标准全是英文：Shot 1 中位 786、其余 379。中文按 0.55 折算。
CN_SCALE = 0.55


def legal_length(seconds: float, fps: int = 24) -> int:
    """H3 的 length 必须 ≡ 5 (mod 17)。官方模板用的就是这个式子。"""
    n = max(5, round(seconds * fps))
    return n + (FRAME_PLUS - (n % FRAME_STEP)) % FRAME_STEP


def is_chinese(text: str) -> bool:
    """正文是不是中文为主。决定用哪套判据和字符预算。"""
    han = len(re.findall(r"[一-鿿]", text))
    latin = len(re.findall(r"[A-Za-z]", text))
    return han > latin * 0.35


# ---------------------------------------------------------------- 报告

class Report:
    def __init__(self, name):
        self.name, self.items = name, []

    def err(self, rule, msg):
        self.items.append(("ERROR", rule, msg))

    def warn(self, rule, msg):
        self.items.append(("WARN", rule, msg))

    def info(self, rule, msg):
        self.items.append(("INFO", rule, msg))

    @property
    def n_err(self):
        return sum(1 for lv, _, _ in self.items if lv == "ERROR")

    @property
    def n_warn(self):
        return sum(1 for lv, _, _ in self.items if lv == "WARN")

    def render(self, show_info=True):
        rank = {"ERROR": 0, "WARN": 1, "INFO": 2}
        mark = {"ERROR": "x", "WARN": "!", "INFO": "."}
        rows = sorted((i for i in self.items if show_info or i[0] != "INFO"),
                      key=lambda i: rank[i[0]])
        out = [f"-- {self.name}"]
        out += [f"   {mark[lv]} [{rule}] {msg}" for lv, rule, msg in rows] or ["   全部通过"]
        out.append(f"   => {self.n_err} 错误 / {self.n_warn} 警告")
        return "\n".join(out)


# ---------------------------------------------------------------- 切分

def split_sections(text):
    """按已知字段名切段。只认行首（或全文开头）的字段名，避免正文里的顺带提及。"""
    pat = "|".join(re.escape(n) for n in ALL_FIELDS)
    marks = [(m.start(), m.end(), m.group(1))
             for m in re.finditer(rf"({pat})\s*:?", text)
             if m.start() == 0 or text[max(0, m.start() - 2):m.start()].endswith("\n")]
    found = {}
    for i, (s, e, nm) in enumerate(marks):
        end = marks[i + 1][0] if i + 1 < len(marks) else len(text)
        found[nm] = text[e:end].strip()
    return found, [m[2] for m in marks]


def detect_school(fields):
    if "subject_definitions" in fields and "retention_analysis" in fields:
        return "ref6"
    if "integrated_multimodal_description" in fields:
        return "base3"
    if "detailed_description" in fields:
        return "ref4"
    return "longform"


# 时间戳可以写在 [镜头N] 前面（`在 00:02.500，[镜头2] …`，这是实测验证过、
# 误差不到一帧的形式），也可以写在后面（`[Shot 2] At 00:02.200, …`）。
# 切分时必须把**前置**的那个时间戳算进这一镜，否则它会落到上一镜的末尾，
# 导致「Shot 1 带了时间戳」「只有 2 个带时间戳」这类完全错误的判断，
# 连带把台词静默占比也算错。
SHOT_START_RE = re.compile(
    r"(?:(?:在|At)\s*\d{1,2}[:：]\d{2}(?:\.\d{1,3})?\s*[，,]?\s*)?"
    r"\[(?:Shot|SHOT|镜头)\s*(\d+)\]"
)


def split_shots(body):
    marks = [(m.start(), int(m.group(1))) for m in SHOT_START_RE.finditer(body)]
    out = []
    for i, (start, num) in enumerate(marks):
        end = marks[i + 1][0] if i + 1 < len(marks) else len(body)
        out.append((num, body[start:end].strip()))
    return out


# ---------------------------------------------------------------- 检查

def lint(text, name, seconds=None):
    r = Report(name)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    n_chars = len(text)
    cn = is_chinese(text)
    scale = CN_SCALE if cn else 1.0

    # ===== 通用：不分流派，违反就是坏 =====================================
    if "__MINIMAX_H3_REF_" in text:
        r.err("占位符", "含 __MINIMAX_H3_REF_N__ —— 只有参考模式后端解析它，"
                        "图生模式原样送进模型，首帧引用直接失效")
    for bad in ("〈Picture", "＜Picture", "<图片", "〈Audio", "＜Audio", "<视频"):
        if bad in text:
            r.err("标签", f"出现 {bad!r} —— <Picture N>/<Audio N>/<Video N> 由 tokenizer 硬编码拼接，必须半角英文")

    if n_chars > 7000:
        r.err("长度", f"{n_chars} 字符 —— H3 提示词硬上限 7000")

    d_open, d_close = text.count("<d>"), text.count("</d>")
    if d_open != d_close:
        r.err("台词", f"<d> {d_open} 个 / </d> {d_close} 个，不配对")
    for m in re.finditer(r"<d>\s*([^<]*)", text):
        if not re.match(rf"\[({LANGS})\]", m.group(1).strip()):
            r.err("台词", f"<d> 后缺语言标签：{m.group(1)[:40]!r}")

    # ===== 流派判定 =======================================================
    sections, order = split_sections(text)
    school = detect_school(sections)
    need, label = SCHOOLS[school]
    r.info("流派", f"{school} —— {label}" + ("  |  中文判据" if cn else ""))

    missing = [s for s in need if s not in sections]
    if missing:
        r.err("分段", f"缺字段：{', '.join(missing)}")
    if order:
        expect = [s for s in need if s in order]
        if expect and order != expect:
            r.err("分段", f"字段顺序不对：实际 {order}，应为 {need}")

    # 段内换行：Pixaroma 那派一个都没有；官方模板和六段式会在镜头之间空行，那是正常的。
    for sec in ("integrated_multimodal_description", "overall_soundscape", "non_diegetic_music"):
        if sec in sections and "\n" in sections[sec].strip():
            r.warn("换行", f"{sec} 段内有换行 —— 出片样本这一段从不换行")

    # ===== 锚点 ===========================================================
    head = text.strip().split("\n")[0].strip()
    if head.startswith("For the target video"):
        if head != ANCHOR_I2VA:
            r.err("锚点", f"I2VA 锚点不是一字不差那句。\n       实际：{head}\n       应为：{ANCHOR_I2VA}")
        else:
            r.info("锚点", "I2VA 锚点逐字匹配")
    elif head.startswith("How the reference"):
        if "0.00-second mark" not in head:
            r.warn("锚点", "Ref2VA 对齐句里没有 0.00-second mark")
        r.info("锚点", "Ref2VA 对齐句")
    elif school != "longform":
        r.warn("锚点", "没有首行对齐句。I2VA / FL2VA / L2VA 必须有，纯 T2VA 可以没有")

    # ===== 镜头 ===========================================================
    desc = (sections.get("integrated_multimodal_description")
            or sections.get("detailed_description") or text)
    shots = split_shots(desc)
    if not shots:
        r.err("镜头", "找不到 [Shot N] / [SHOT N] 标记")
        return r

    nums = [n for n, _ in shots]
    if nums != list(range(1, len(nums) + 1)):
        r.err("镜头", f"镜头编号不连续：{nums}")
    r.info("镜头", f"{len(shots)} 个镜头")

    # 时间戳：英文 `At 00:02.200`；中文实测有效的是 `在 00:02.900，`（切镜落在
    # 2.875s，误差不到一帧）。`2.5秒硬切` 这种口语写法算次一等，单独提醒。
    def shot_time(body):
        m = re.search(r"(?:At|在)\s*(\d{1,2}):(\d{2}(?:\.\d{1,3})?)", body)
        if m:
            return int(m.group(1)) * 60 + float(m.group(2)), True
        m = re.search(r"(?:第\s*)?(\d+(?:\.\d+)?)\s*秒", body)
        if m:
            return float(m.group(1)), False
        return None, False

    ts, loose = [], []
    for i, (num, body) in enumerate(shots):
        t, exact = shot_time(body)
        if i == 0:
            if t is not None:
                r.warn("时间戳", "Shot 1 带了时间戳 —— 出片样本 Shot 1 一律不带")
            continue
        if t is None:
            continue
        ts.append((num, t))
        if not exact:
            loose.append(num)
    for i in range(1, len(ts)):
        if ts[i][1] <= ts[i - 1][1]:
            r.err("时间戳", f"Shot {ts[i][0]} 的 {ts[i][1]}s 不晚于 Shot {ts[i-1][0]} 的 {ts[i-1][1]}s")
    if school in ("base3", "ref6", "ref4") and len(shots) > 1 and len(ts) < len(shots) - 1:
        r.warn("时间戳", f"{len(shots)-1} 个非首镜头里只有 {len(ts)} 个带时间戳"
                         f"（`At 00:SS.mmm` 或 `在 00:SS.mmm`）")
    if loose:
        r.warn("时间戳", f"镜头 {loose} 用的是「X秒」口语写法。"
                         f"实测验证过的形式是 `在 00:02.900，镜头切至…`（误差不到一帧），换成这个")
    # 两套时间机制混用
    if re.search(r"\[\s*\d+(?:\.\d+)?\s*s\s*[-–]\s*\d+(?:\.\d+)?\s*s\s*\]", text) and shots:
        r.warn("时间标记", "同时用了 [镜头N] 和 [0s-2.5s] 时间窗口。"
                           "两者混用没有先例（时间窗口来自 IT2V 系统提示词，官方 GUIDE 里没有）。"
                           "多镜头就只用 [镜头N] + 时间戳；一镜到底才用时间窗口")

    # 硬切 / 连续性：整篇聚合，不逐镜头刷屏
    low_desc = desc.lower()
    n_cut = sum(low_desc.count(w) for w in CUT_WORDS)
    n_cont = sum(low_desc.count(w) for w in CONTINUITY)
    # 只有基础三段式那派把 hard cut 当必需（70 次）。六段式/四段式用
    # `At 00:01.000, …` / `在 00:02.500，[镜头2]` 声明切点就够了，官方样本
    # 就是这么写的 —— 对它们要求 cut 词是误报。
    if school == "base3" and len(shots) > 1 and n_cut == 0:
        r.warn("硬切", "多镜头但全篇没写切换方式（hard cut / 硬切 / smash-zoom）")
    elif len(shots) > 1 and n_cut == 0 and len(ts) < len(shots) - 1:
        r.warn("切点", "多镜头，但既没写切换方式也没给每个镜头时间戳，切点无从确定")
    if len(shots) > 2 and n_cont == 0:
        r.warn("连续性", f"{len(shots)} 个镜头，全篇没有 keeps / still / back to —— "
                         f"硬切后不声明什么没变，就会出现画面断层")
    else:
        r.info("连续性", f"切换 {n_cut} 处，连续性声明 {n_cont} 处")

    # 收尾装置
    # 19/19 的基础三段式都有；官方模板（ref4）那条就没有，所以只在 base3 判 ERROR。
    # 多个模式会命中同一段文字（中文尤其：「最后一帧」「画面定格」「余摆」常常挨着），
    # 按位置去重再计数，否则一句话会被数成五次。
    spans = sorted((m.start(), m.end(), m.group(0))
                   for p in TAIL_DEVICES for m in re.finditer(p, text, re.I))
    tail_hits, last_end = [], -1
    for s, e, g in spans:
        if s >= last_end + 40:        # 40 字符内算同一处收尾
            tail_hits.append(g)
            last_end = e
    if not tail_hits:
        msg = ("没有收尾装置（through the end / through the final seconds / freezes on …）"
               " —— 治片尾冻结。基础三段式 19/19 都有；官方模板那条没有，所以其它流派只是提醒")
        (r.err if school == "base3" else r.warn)("片尾", msg)
    else:
        in_last = any(re.search(p, shots[-1][1], re.I) for p in TAIL_DEVICES)
        if not in_last:
            r.warn("片尾", f"收尾装置 {tail_hits} 不在最后一个镜头里")
        if len(tail_hits) > 2:
            r.warn("片尾", f"收尾装置出现 {len(tail_hits)} 次 —— 样本通常只有 1 次")

    # 预算。Shot 1 要写成两倍长是**基础三段式**的规矩 —— 那一派没有
    # subject_definitions，身份只能压在 Shot 1。六段式/四段式有专门的段放身份，
    # Shot 1 不用扛，套这条就是误报。
    lens = [len(b) for _, b in shots]
    mid = sorted(lens[1:])[len(lens[1:]) // 2] if len(lens) > 1 else 0
    r.info("预算", f"Shot 1 {lens[0]} 字符 / 其余中位 {mid} / 全文 {n_chars}"
                   + (f"（中文，阈值按 {CN_SCALE} 折算）" if cn else ""))
    if school == "base3" and mid and lens[0] < mid * 1.25:
        r.warn("预算", f"Shot 1 只有 {lens[0]} 字符、后续中位 {mid} —— "
                       f"基础三段式的身份锚点全压在 Shot 1，出片样本约为后续的 2 倍")
    cap = int(1200 * scale)
    for (num, _), L in zip(shots, lens):
        if L > cap:
            r.warn("预算", f"Shot {num} 有 {L} 字符（上限约 {cap}），偏长，容易稀释身份锚点")

    # ===== 只对「场景描写」生效的规则 =====================================
    # retention_analysis / summary 是写给模型看的元描述，用 but 是正常的。
    scene = desc
    for word, lv in (("but", "warn"), ("before", "warn"), ("however", "warn")):
        n = len(re.findall(rf"\b{word}\b", scene, re.I))
        if n:
            (r.err if lv == "err" else r.warn)(
                "连接词",
                f"场景描写里 {word} 出现 {n} 次 —— Pixaroma 19 条里 but/before 都是 0。"
                f"转折应写成 A→B 的表情转换（expression flips from X into Y）")

    if school == "base3":   # Pixaroma 那一派的专属纪律
        only_re = r"\bonly\b|只有|仅有|唯一|不要出现|画面里只" if cn else r"\bonly\b"
        if not re.search(only_re, scene, re.I):
            r.warn("构图", "一个 only / 只有 都没有 —— 样本 61 次，"
                           "放在被摄对象后面 = 这个框里别出别的")
        cnt_re = (r"\b(one|single|two|three|both|each|every)\b|[一两二三四]([只个根条对枚])|单[根只条]|每"
                  if cn else r"\b(one|single|two|three|both|each|every)\b")
        n_count = len(re.findall(cnt_re, scene, re.I))
        if n_count < len(shots):
            r.warn("数量词", f"数量词 {n_count} 个 / {len(shots)} 个镜头 —— "
                             f"数量词加 only 是压多手多物的主要手段")

    fancy = sorted({w.lower() for w in re.findall(r"\b[A-Za-z]+\b", scene)} & FANCY_COLOURS)
    if fancy:
        r.warn("颜色", f"文学化色彩词 {fancy} —— 出片样本只用 9 个基础色词，且永远贴着名词写")

    if not cn:   # 中文没有 -ly 这种形态，这条只对英文有意义
        n_ly = len(re.findall(r"\b[a-z]{4,}ly\b", scene))
        if n_ly > len(shots) * 4:
            r.warn("副词", f"{n_ly} 个 -ly 副词 —— 强度靠动词本身（slams / whips），不靠副词")

    # 声音否定句才是招来片头人声的那一类，别把所有否定都算上。
    snd_cn = r"声|音|响|呼吸|喘|说话|人声|混响"
    neg_all = re.findall(r"\bNo [A-Za-z]", scene)
    neg_snd = re.findall(rf"(?:无|没有|不[要出发]?|绝不|全程无)[^，。；\n]{{0,8}}(?:{snd_cn})", scene) if cn else []
    n_neg = len(neg_all) + len(neg_snd)
    if n_neg > 6:
        r.warn("否定句", f"{n_neg} 处否定 —— 19 条里 16 条是 0 次")
    if len(neg_snd) >= 3:
        r.warn("声音否定", f"{len(neg_snd)} 处「无/没有…声」类否定：{neg_snd[:4]} —— "
                           f"实测同一份提示词从 1 处加到 4 处，片头怪叫就回来了。"
                           f"静默只写嘴唇形状，一个字都别提声音")

    snd_words = (r"\b(sound|audio|noise|crackle|rustle|creak|gasp|moan|scream|"
                 r"whisper|echo|thud|bang|squelch)\b")
    if cn:
        snd_words += r"|[“\"「][^”\"」]{1,6}[”\"」]\s*(?:声|响)|的(?:声音|响声|轻响|微响)"
    n_snd = len(re.findall(snd_words, scene, re.I))
    if n_snd > len(shots) * 2:
        r.warn("分工", f"画面段里有 {n_snd} 个听觉词 —— 画面段只写看得见的，"
                       f"呼吸写成胸口起伏和嘴唇形状，听觉全放 overall_soundscape")

    # ===== 音景 / 音乐 ====================================================
    snd = sections.get("overall_soundscape", "")
    if snd:
        if not re.search(r"room tone|ambien|background hum|底噪|环境音|空间音|氛围声", snd, re.I):
            r.warn("音景", "第一句不是持续底噪（room tone / 底噪 / 环境音）—— 19/19 样本都是")
        if not re.search(r"under the whole scene|throughout|全程|贯穿|整段|自始至终", snd, re.I):
            r.warn("音景", "底噪没写「贯穿全程」（under the whole scene / throughout）")
        lo, hi = int(250 * scale), int(900 * scale)
        if not lo <= len(snd) <= hi:
            r.warn("音景", f"{len(snd)} 字符 —— 建议 {lo}~{hi}"
                           + ("（中文按 0.55 折算，英文样本 358~662）" if cn else "（样本 358~662）"))
    if school != "longform" and not sections.get("non_diegetic_music"):
        r.err("音乐", "缺 non_diegetic_music —— 不配乐就写 N/A")

    # ===== 时长与帧数 =====================================================
    if seconds is None:
        m = re.search(r"(\d+(?:\.\d+)?)\s*(?:seconds?|秒)\b", text)
        if m:
            seconds = float(m.group(1))
    # 台词前的静默占比。实测：4.5 秒片子留 2.6 秒静默（58%）时好时坏，
    # 同样 2.6 秒放进 10 秒片子（26%）就稳了。超过 40% 模型会把台词往前拽。
    if seconds and ("<d>" in text or "says:" in text or "说：" in text):
        first_line = min((m.start() for m in re.finditer(r"<d>|says:|说：", text)), default=None)
        if first_line is not None:
            # 台词落在哪个镜头里，取那个镜头的起始时间当静默长度
            t_silence = None
            for i, (num, body) in enumerate(shots):
                if re.search(r"<d>|says:|说：", body):
                    t_silence = dict(ts).get(num) if num in dict(ts) else None
                    break
            if t_silence is None:
                w = re.search(r"\[\s*(\d+(?:\.\d+)?)\s*s\s*[-–]", text[max(0, first_line - 400):first_line])
                t_silence = float(w.group(1)) if w else None
            if t_silence is not None and seconds:
                ratio = t_silence / seconds
                if ratio > 0.40:
                    r.warn("台词时机", f"台词前有 {t_silence:.1f}s 静默 / 总长 {seconds:.0f}s = "
                                       f"{ratio*100:.0f}%。实测超过 40% 模型会把台词往前拽"
                                       f"（4.5s 片留 2.6s 静默 = 58% 时好时坏；"
                                       f"同样 2.6s 放进 10s 片 = 26% 就稳了）")

    if seconds:
        if not 4 <= seconds <= 15:
            r.err("时长", f"{seconds}s 超出 H3 的 4~15 秒硬限制")
        r.info("帧数", f"{seconds}s → length 填 {legal_length(seconds)}"
                       f"（≡5 mod 17），不是 {round(seconds * 24)}")
        if ts:
            last = max(t for _, t in ts)
            if last >= seconds:
                r.err("时间戳", f"最后一个切点 {last}s 不早于总时长 {seconds}s")
            elif seconds - last < 0.8:
                r.warn("时间戳", f"末镜头只有 {seconds-last:.2f}s —— 样本末镜头 3~4s")

    return r


# ---------------------------------------------------------------- 对外接口

def check(prompt: str, seconds=None, name: str = "prompt") -> dict:
    """给 HTTP 路由和节点用。返回 {items, n_err, n_warn}。"""
    rep = lint(str(prompt or ""), name, seconds)
    return {
        "items": [{"level": lv, "rule": rule, "message": msg} for lv, rule, msg in rep.items],
        "n_err": rep.n_err,
        "n_warn": rep.n_warn,
    }


def render(prompt: str, seconds=None, name: str = "prompt", show_info: bool = True) -> str:
    return lint(str(prompt or ""), name, seconds).render(show_info=show_info)


# ---------------------------------------------------------------- ComfyUI 接入

def log_check(prompt: str, length: int | None = None, fps: int = 24, where: str = "") -> None:
    """在真正送进 tokenizer 之前，把校验结果打到 ComfyUI 控制台。

    查的是**解析之后**的提示词——@引用已经变成 <Picture N>、台词已经包好 <d>。
    这是模型真正看到的那份，前端看不到。
    """
    try:
        seconds = round(length / fps, 3) if length and fps else None
        rep = lint(str(prompt or ""), where or "prompt", seconds)
        rows = [i for i in rep.items if i[0] != "INFO"]
        if not rows:
            print(f"[MiniMaxH3-Studio] 提示词校验通过{('（' + where + '）') if where else ''}")
            return
        mark = {"ERROR": "✗", "WARN": "!"}
        print(f"[MiniMaxH3-Studio] 提示词校验：{rep.n_err} 错误 / {rep.n_warn} 警告"
              f"{('（' + where + '）') if where else ''}")
        for lv, rule, msg in sorted(rows, key=lambda i: 0 if i[0] == "ERROR" else 1):
            first = str(msg).splitlines()[0]
            print(f"    {mark[lv]} [{rule}] {first}")
    except Exception:          # 校验永远不该拖垮生成
        pass
