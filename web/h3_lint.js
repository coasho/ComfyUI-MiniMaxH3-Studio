/**
 * H3 提示词结构校验 —— 纯前端实现，不走后端。
 *
 * 为什么不放 Python：这就是对字符串跑正则，没有任何需要服务端的东西。
 * 放后端的唯一好处是跟命令行共用一份规则，代价是每改一条判据都要重启
 * ComfyUI（Python 不热加载）。改在这里，Ctrl+R 就生效。
 *
 * 规则和阈值来自 docs/H3提示词写法完全指南.txt，全部是从 22 条**实际出片**
 * 的提示词上量出来的。这 22 条分属 4 个流派，判据必须按流派分档——
 * 把某一派的惯例当通用 ERROR，就会把另外三派全判成不合格。
 *
 * 批量跑金标准自检用 tools/h3_prompt_lint.py（同一套规则的 Python 版）。
 */

const ANCHOR_I2VA = "For the target video, at 0.00 seconds into the target video, "
    + "<Picture 1> (from [Shot 1]) is fully referenced.";

const SCHOOLS = {
    base3: { need: ["integrated_multimodal_description", "overall_soundscape", "non_diegetic_music"],
             label: "基础三段式（Pixaroma 19 条同款）" },
    ref6: { need: ["subject_definitions", "summary", "retention_analysis",
                   "detailed_description", "overall_soundscape", "non_diegetic_music"],
            label: "官方 Ref2VA 六段式" },
    ref4: { need: ["summary", "detailed_description", "overall_soundscape", "non_diegetic_music"],
            label: "官方模板精简版（Subject 内联定义）" },
    longform: { need: [], label: "工程化长文（自定义段名 + [SHOT N]）" },
};
const ALL_FIELDS = ["subject_definitions", "summary", "retention_analysis", "detailed_description",
                    "integrated_multimodal_description", "overall_soundscape", "non_diegetic_music"];

// 只认「片尾」专用说法。中文的「定格一拍」「画面定格两帧」「余摆…后停住」
// 是镜头内的定格，是作画技法，不是收尾装置。
const TAIL_DEVICES = [
    /through the end/gi, /through the final \w+/gi, /through the last \w+/gi,
    /freezes on/gi, /holds on (?:this|the)/gi, /final frame/gi,
    /最后一帧/g, /末帧/g, /最后一格/g,
    /(?:结尾|片尾|最后)[^。；\n]{0,10}定格/g, /定格(?:收束|收尾|结束)/g,
];

const CUT_WORDS = ["hard cut", "cuts to", "cut to", "cuts into", "smash-zoom", "whip-zoom",
                   "crash-zoom", "spiral whoosh", "camera cuts", "flash-cut", "whoosh-cut",
                   "硬切", "切至", "切到", "镜头切", "跳切", "闪切", "直切"];
const CONTINUITY = ["keeps ", "still ", "back to", "without stopping", "again on",
                    "continues", "only progress", "never reset", "persists", "accumulate",
                    "仍", "依旧", "依然", "保持", "继续", "不变", "回到", "沿用", "未停"];

const FANCY_COLOURS = ["crimson", "azure", "emerald", "scarlet", "vermilion", "cerulean",
                       "magenta", "turquoise", "ochre", "indigo", "burgundy", "maroon",
                       "chartreuse", "mauve", "sapphire", "aquamarine", "fuchsia"];

const LANGS = "English|Chinese|Japanese|Korean|Spanish|French|German|Italian|"
    + "Portuguese|Russian|Arabic|Thai|Vietnamese|Indonesian";

// 时间戳可以写在 [镜头N] 前面（`在 00:02.500，[镜头2] …`，实测误差不到一帧），
// 也可以写在后面（`[Shot 2] At 00:02.200, …`）。切分时必须把前置的那个算进
// 这一镜，否则它落到上一镜末尾，会连带把台词静默占比也算错。
const SHOT_START_RE = /(?:(?:在|At)\s*\d{1,2}[:：]\d{2}(?:\.\d{1,3})?\s*[，,]?\s*)?\[(?:Shot|SHOT|镜头)\s*(\d+)\]/g;

const FRAME_STEP = 17, FRAME_PLUS = 5;
const CN_SCALE = 0.55;   // 中文单字信息量约为英文两倍，字符阈值折算

export function legalLength(seconds, fps = 24) {
    const n = Math.max(5, Math.round(seconds * fps));
    return n + ((FRAME_PLUS - (n % FRAME_STEP)) % FRAME_STEP + FRAME_STEP) % FRAME_STEP;
}

function isChinese(text) {
    const han = (text.match(/[一-鿿]/g) || []).length;
    const latin = (text.match(/[A-Za-z]/g) || []).length;
    return han > latin * 0.35;
}

function count(text, re) { return (text.match(re) || []).length; }

function splitSections(text) {
    const pat = new RegExp(`(${ALL_FIELDS.join("|")})\\s*:?`, "g");
    const marks = [];
    let m;
    while ((m = pat.exec(text)) !== null) {
        if (m.index === 0 || text.slice(Math.max(0, m.index - 2), m.index).endsWith("\n")) {
            marks.push({ start: m.index, end: m.index + m[0].length, name: m[1] });
        }
    }
    const found = {};
    marks.forEach((mk, i) => {
        const end = i + 1 < marks.length ? marks[i + 1].start : text.length;
        found[mk.name] = text.slice(mk.end, end).trim();
    });
    return { found, order: marks.map((x) => x.name) };
}

function detectSchool(fields) {
    if (fields.subject_definitions !== undefined && fields.retention_analysis !== undefined) return "ref6";
    if (fields.integrated_multimodal_description !== undefined) return "base3";
    if (fields.detailed_description !== undefined) return "ref4";
    return "longform";
}

function splitShots(body) {
    SHOT_START_RE.lastIndex = 0;
    const marks = [];
    let m;
    while ((m = SHOT_START_RE.exec(body)) !== null) marks.push({ start: m.index, num: Number(m[1]) });
    return marks.map((mk, i) => ({
        num: mk.num,
        body: body.slice(mk.start, i + 1 < marks.length ? marks[i + 1].start : body.length).trim(),
    }));
}

function shotTime(body) {
    let m = body.match(/(?:At|在)\s*(\d{1,2})[:：](\d{2}(?:\.\d{1,3})?)/);
    if (m) return { t: Number(m[1]) * 60 + Number(m[2]), exact: true };
    m = body.match(/(?:第\s*)?(\d+(?:\.\d+)?)\s*秒/);
    if (m) return { t: Number(m[1]), exact: false };
    return { t: null, exact: false };
}

/**
 * @returns {{items: {level: string, rule: string, message: string}[], n_err: number, n_warn: number}}
 */
export function lintPrompt(rawText, seconds = null) {
    const items = [];
    const err = (rule, message) => items.push({ level: "ERROR", rule, message });
    const warn = (rule, message) => items.push({ level: "WARN", rule, message });
    const info = (rule, message) => items.push({ level: "INFO", rule, message });

    const text = String(rawText || "").replace(/\r\n?/g, "\n");
    const nChars = text.length;
    const cn = isChinese(text);
    const scale = cn ? CN_SCALE : 1;

    // ===== 通用：不分流派 =====
    // 调用方应当先把占位符解析成真标签（参考模式下写占位符是正确流程，
    // 由后端 _resolve_reference_prompt 负责替换）。走到这里还剩占位符，
    // 说明那条引用对不上任何一个已连接的媒体。
    if (text.includes("__MINIMAX_H3_REF_")) {
        err("占位符", "有引用占位符没解析出来 —— 对应的媒体多半已经断开连接。"
                     + "重新连上，或把提示词里那个 @ 引用删掉");
    }
    if (text.includes("__MINIMAX_H3_UNRESOLVED_REF_")) {
        err("引用", "提示词里有指向已断开媒体的 @ 引用 —— 后端会直接报错拒绝生成");
    }
    for (const bad of ["〈Picture", "＜Picture", "<图片", "〈Audio", "＜Audio", "<视频"]) {
        if (text.includes(bad)) {
            err("标签", `出现 ${bad} —— <Picture N>/<Audio N>/<Video N> 由 tokenizer 硬编码拼接，必须半角英文`);
        }
    }
    if (nChars > 7000) err("长度", `${nChars} 字符 —— H3 提示词硬上限 7000`);

    const dOpen = count(text, /<d>/g), dClose = count(text, /<\/d>/g);
    if (dOpen !== dClose) err("台词", `<d> ${dOpen} 个 / </d> ${dClose} 个，不配对`);
    for (const m of text.matchAll(/<d>\s*([^<]*)/g)) {
        if (!new RegExp(`^\\[(${LANGS})\\]`).test(m[1].trim())) {
            err("台词", `<d> 后缺语言标签：${JSON.stringify(m[1].slice(0, 40))}`);
        }
    }

    // ===== 流派 =====
    const { found: sections, order } = splitSections(text);
    const school = detectSchool(sections);
    const { need, label } = SCHOOLS[school];
    info("流派", `${school} —— ${label}${cn ? "  |  中文判据" : ""}`);

    const missing = need.filter((s) => sections[s] === undefined);
    if (missing.length) err("分段", `缺字段：${missing.join(", ")}`);
    if (order.length) {
        const expect = need.filter((s) => order.includes(s));
        if (expect.length && JSON.stringify(order) !== JSON.stringify(expect)) {
            err("分段", `字段顺序不对：实际 ${order.join(" → ")}，应为 ${need.join(" → ")}`);
        }
    }
    for (const sec of ["integrated_multimodal_description", "overall_soundscape", "non_diegetic_music"]) {
        if (sections[sec] && sections[sec].trim().includes("\n")) {
            warn("换行", `${sec} 段内有换行 —— 出片样本这一段从不换行`);
        }
    }

    // 每个 <Subject N> 的定义里必须出现至少一个 <Picture N>。有多张参考图时
    // 写「图中的少女」模型不知道指哪一张，只能猜。官方六段式的写法是
    // `<Subject 1> is …, derived from <Picture 1>`，retention 里也给 <Picture N>
    // 单独列行说明它驱动了哪几项。
    const defs = sections.subject_definitions;
    if (defs) {
        const nPic = new Set([...defs.matchAll(/<Picture\s+(\d+)>/g)].map((m) => m[1])).size;
        if (nPic > 1) {
            const unbound = [];
            for (const m of defs.matchAll(/<Subject\s+(\d+)>[^<]*(?:<(?!Subject)[^>]*>[^<]*)*/g)) {
                if (!/<Picture\s+\d+>/.test(m[0])) unbound.push(m[1]);
            }
            if (unbound.length) {
                warn("参考绑定", `<Subject ${unbound.join(", ")}> 没写明取自哪张参考图。`
                                + `有 ${nPic} 张图时「图中的…」指哪张模型只能猜 —— `
                                + "每个 Subject 都要写「取自 <Picture N>」");
            }
        }
    }

    // ===== 锚点 =====
    const head = text.trim().split("\n")[0].trim();
    if (head.startsWith("For the target video")) {
        if (head !== ANCHOR_I2VA) err("锚点", `I2VA 锚点不是一字不差那句。\n实际：${head}\n应为：${ANCHOR_I2VA}`);
        else info("锚点", "I2VA 锚点逐字匹配");
    } else if (head.startsWith("How the reference")) {
        // 两种写法都对，取决于要不要把参考钉成第 0 帧：
        //   钉    …aligns with the 0.00-second mark…   开场构图 = 那张图
        //   不钉  …均不对齐到任何时间点，不作为任何一帧的画面内容…（只取特征和画风）
        // 只有两者都没写才是问题 —— 那样模型不知道参考该不该进画面。
        const pinned = /0\.00-second mark|对齐到目标视频的 ?0/.test(head);
        const unpinned = /不对齐到|不作为任何一帧|does not align|no time alignment/.test(head);
        if (!pinned && !unpinned) {
            warn("锚点", "Ref2VA 对齐句既没写对齐到 0.00-second mark，也没写「不对齐到任何时间点」——"
                        + "要不要把参考当第 0 帧，得明说一个");
        }
        info("锚点", `Ref2VA 对齐句（${pinned ? "钉到 0 秒，开场构图 = 参考图" : "不钉时间点，只取特征与画风"}）`);
    } else if (school !== "longform") {
        warn("锚点", "没有首行对齐句。I2VA / FL2VA / L2VA 必须有，纯 T2VA 可以没有");
    }

    // ===== 镜头 =====
    const desc = sections.integrated_multimodal_description ?? sections.detailed_description ?? text;
    const shots = splitShots(desc);
    if (!shots.length) {
        err("镜头", "找不到 [Shot N] / [SHOT N] / [镜头N] 标记");
        return finish(items);
    }
    const nums = shots.map((s) => s.num);
    if (JSON.stringify(nums) !== JSON.stringify(nums.map((_, i) => i + 1))) {
        err("镜头", `镜头编号不连续：${nums.join(", ")}`);
    }
    info("镜头", `${shots.length} 个镜头`);

    const ts = [], loose = [];
    shots.forEach((s, i) => {
        const { t, exact } = shotTime(s.body.slice(0, 60));
        if (i === 0) { if (t !== null) warn("时间戳", "Shot 1 带了时间戳 —— 出片样本 Shot 1 一律不带"); return; }
        if (t === null) return;
        ts.push({ num: s.num, t });
        if (!exact) loose.push(s.num);
    });
    for (let i = 1; i < ts.length; i++) {
        if (ts[i].t <= ts[i - 1].t) {
            err("时间戳", `Shot ${ts[i].num} 的 ${ts[i].t}s 不晚于 Shot ${ts[i - 1].num} 的 ${ts[i - 1].t}s`);
        }
    }
    if (["base3", "ref6", "ref4"].includes(school) && shots.length > 1 && ts.length < shots.length - 1) {
        warn("时间戳", `${shots.length - 1} 个非首镜头里只有 ${ts.length} 个带时间戳（\`At 00:SS.mmm\` 或 \`在 00:SS.mmm\`）`);
    }
    if (loose.length) {
        warn("时间戳", `镜头 ${loose.join(", ")} 用的是「X秒」口语写法。`
                       + "实测验证过的形式是 `在 00:02.900，镜头切至…`（误差不到一帧），换成这个");
    }
    if (/\[\s*\d+(?:\.\d+)?\s*s\s*[-–]\s*\d+(?:\.\d+)?\s*s\s*\]/.test(text)) {
        warn("时间标记", "同时用了 [镜头N] 和 [0s-2.5s] 时间窗口。两者混用没有先例"
                       + "（时间窗口来自 IT2V 系统提示词，官方 GUIDE 里没有）。"
                       + "多镜头就只用 [镜头N] + 时间戳；一镜到底才用时间窗口");
    }

    const lowDesc = desc.toLowerCase();
    const nCut = CUT_WORDS.reduce((a, w) => a + lowDesc.split(w).length - 1, 0);
    const nCont = CONTINUITY.reduce((a, w) => a + lowDesc.split(w).length - 1, 0);
    // hard cut 是基础三段式的惯例（70 次）。六段式/四段式用时间戳声明切点就够了。
    if (school === "base3" && shots.length > 1 && nCut === 0) {
        warn("硬切", "多镜头但全篇没写切换方式（hard cut / 硬切 / smash-zoom）");
    } else if (shots.length > 1 && nCut === 0 && ts.length < shots.length - 1) {
        warn("切点", "多镜头，但既没写切换方式也没给每个镜头时间戳，切点无从确定");
    }
    if (shots.length > 2 && nCont === 0) {
        warn("连续性", `${shots.length} 个镜头，全篇没有 keeps / still / 仍 / 保持 / 回到 —— `
                       + "硬切后不声明什么没变，就会出现画面断层");
    } else {
        info("连续性", `切换 ${nCut} 处，连续性声明 ${nCont} 处`);
    }

    // 收尾装置：按位置去重，40 字符内算同一处
    const spans = [];
    for (const re of TAIL_DEVICES) {
        re.lastIndex = 0;
        for (const m of text.matchAll(re)) spans.push({ s: m.index, e: m.index + m[0].length, g: m[0] });
    }
    spans.sort((a, b) => a.s - b.s);
    const tailHits = [];
    let lastEnd = -1;
    for (const sp of spans) if (sp.s >= lastEnd + 40) { tailHits.push(sp.g); lastEnd = sp.e; }
    if (!tailHits.length) {
        const msg = "没有收尾装置（through the end / 最后一帧画面定格 / freezes on …）—— 治片尾冻结。"
            + "基础三段式 19/19 都有；官方模板那条没有，所以其它流派只是提醒";
        if (school === "base3") err("片尾", msg); else warn("片尾", msg);
    } else {
        const inLast = TAIL_DEVICES.some((re) => { re.lastIndex = 0; return re.test(shots[shots.length - 1].body); });
        if (!inLast) warn("片尾", `收尾装置 ${tailHits.join(" / ")} 不在最后一个镜头里`);
        if (tailHits.length > 2) warn("片尾", `收尾装置出现 ${tailHits.length} 次 —— 样本通常只有 1 次`);
    }

    // 预算
    const lens = shots.map((s) => s.body.length);
    const rest = lens.slice(1).sort((a, b) => a - b);
    const mid = rest.length ? rest[Math.floor(rest.length / 2)] : 0;
    info("预算", `Shot 1 ${lens[0]} 字符 / 其余中位 ${mid} / 全文 ${nChars}`
                 + (cn ? `（中文，阈值按 ${CN_SCALE} 折算）` : ""));
    if (school === "base3" && mid && lens[0] < mid * 1.25) {
        warn("预算", `Shot 1 只有 ${lens[0]} 字符、后续中位 ${mid} —— `
                     + "基础三段式的身份锚点全压在 Shot 1，出片样本约为后续的 2 倍");
    }
    const cap = Math.round(1200 * scale);
    shots.forEach((s, i) => {
        if (lens[i] > cap) warn("预算", `Shot ${s.num} 有 ${lens[i]} 字符（上限约 ${cap}），偏长，容易稀释身份锚点`);
    });

    // ===== 只对场景描写生效 =====
    const scene = desc;
    for (const w of ["but", "before", "however"]) {
        const n = count(scene, new RegExp(`\\b${w}\\b`, "gi"));
        if (n) {
            warn("连接词", `场景描写里 ${w} 出现 ${n} 次 —— Pixaroma 19 条里 but/before 都是 0。`
                          + "转折应写成 A→B 的表情转换（expression flips from X into Y）");
        }
    }
    if (school === "base3") {
        const onlyRe = cn ? /\bonly\b|只有|仅有|唯一|不要出现|画面里只/i : /\bonly\b/i;
        if (!onlyRe.test(scene)) {
            warn("构图", "一个 only / 只有 都没有 —— 样本 61 次，放在被摄对象后面 = 这个框里别出别的");
        }
        const cntRe = cn
            ? /\b(one|single|two|three|both|each|every)\b|[一两二三四][只个根条对枚]|单[根只条]|每/gi
            : /\b(one|single|two|three|both|each|every)\b/gi;
        const nCount = count(scene, cntRe);
        if (nCount < shots.length) {
            warn("数量词", `数量词 ${nCount} 个 / ${shots.length} 个镜头 —— 数量词加 only 是压多手多物的主要手段`);
        }
    }
    const fancy = FANCY_COLOURS.filter((c) => new RegExp(`\\b${c}\\b`, "i").test(scene));
    if (fancy.length) {
        warn("颜色", `文学化色彩词 ${fancy.join(", ")} —— 出片样本只用 9 个基础色词，且永远贴着名词写`);
    }
    if (!cn) {
        const nLy = count(scene, /\b[a-z]{4,}ly\b/g);
        if (nLy > shots.length * 4) warn("副词", `${nLy} 个 -ly 副词 —— 强度靠动词本身（slams / whips），不靠副词`);
    }
    const negSnd = cn ? (scene.match(/(?:无|没有|不[要出发]?|绝不|全程无)[^，。；\n]{0,8}(?:声|音|响|呼吸|喘|说话|人声|混响)/g) || []) : [];
    const nNeg = count(scene, /\bNo [A-Za-z]/g) + negSnd.length;
    if (nNeg > 6) warn("否定句", `${nNeg} 处否定 —— 19 条里 16 条是 0 次`);
    if (negSnd.length >= 3) {
        warn("声音否定", `${negSnd.length} 处「无/没有…声」类否定：${negSnd.slice(0, 4).join("、")} —— `
                        + "实测同一份提示词从 1 处加到 4 处，片头怪叫就回来了。静默只写嘴唇形状，一个字都别提声音");
    }
    let sndRe = /\b(sound|audio|noise|crackle|rustle|creak|gasp|moan|scream|whisper|echo|thud|bang|squelch)\b/gi;
    if (cn) sndRe = /\b(sound|audio|noise|crackle|rustle|creak|gasp|moan|scream|whisper|echo|thud|bang|squelch)\b|[“"「][^”"」]{1,6}[”"」]\s*(?:声|响)|的(?:声音|响声|轻响|微响)/gi;
    const nSnd = count(scene, sndRe);
    if (nSnd > shots.length * 2) {
        warn("分工", `画面段里有 ${nSnd} 个听觉词 —— 画面段只写看得见的，`
                     + "呼吸写成胸口起伏和嘴唇形状，听觉全放 overall_soundscape");
    }

    // ===== 音景 / 音乐 =====
    const snd = sections.overall_soundscape || "";
    if (snd) {
        if (!/room tone|ambien|background hum|底噪|环境音|空间音|氛围声/i.test(snd)) {
            warn("音景", "第一句不是持续底噪（room tone / 底噪 / 环境音）—— 19/19 样本都是");
        }
        if (!/under the whole scene|throughout|全程|贯穿|整段|自始至终/i.test(snd)) {
            warn("音景", "底噪没写「贯穿全程」（under the whole scene / throughout）");
        }
        const lo = Math.round(250 * scale), hi = Math.round(900 * scale);
        if (snd.length < lo || snd.length > hi) {
            warn("音景", `${snd.length} 字符 —— 建议 ${lo}~${hi}`
                         + (cn ? "（中文按 0.55 折算，英文样本 358~662）" : "（样本 358~662）"));
        }
    }
    if (school !== "longform" && !sections.non_diegetic_music) {
        err("音乐", "缺 non_diegetic_music —— 不配乐就写 N/A");
    }

    // ===== 时长与帧数 =====
    let secs = seconds;
    if (secs == null) {
        const m = text.match(/(\d+(?:\.\d+)?)\s*(?:seconds?|秒)\b/);
        if (m) secs = Number(m[1]);
    }
    if (secs) {
        if (secs < 4 || secs > 15) err("时长", `${secs}s 超出 H3 的 4~15 秒硬限制`);
        info("帧数", `${secs}s → length 填 ${legalLength(secs)}（≡5 mod 17），不是 ${Math.round(secs * 24)}`);
        if (ts.length) {
            const last = Math.max(...ts.map((x) => x.t));
            if (last >= secs) err("时间戳", `最后一个切点 ${last}s 不早于总时长 ${secs}s`);
            else if (secs - last < 0.8) warn("时间戳", `末镜头只有 ${(secs - last).toFixed(2)}s —— 样本末镜头 3~4s`);
        }
        // 台词前静默占比。实测 4.5s 片留 2.6s（58%）时好时坏，
        // 同样 2.6s 放进 10s 片（26%）就稳了。
        if (/<d>|says:|说：/.test(text)) {
            const withLine = shots.find((s) => /<d>|says:|说：/.test(s.body));
            const hit = withLine && ts.find((x) => x.num === withLine.num);
            const tSil = hit ? hit.t : null;
            if (tSil != null && tSil / secs > 0.40) {
                warn("台词时机", `台词前有 ${tSil.toFixed(1)}s 静默 / 总长 ${secs}s = ${Math.round(tSil / secs * 100)}%。`
                                + "实测超过 40% 模型会把台词往前拽（4.5s 片留 2.6s 静默 = 58% 时好时坏；"
                                + "同样 2.6s 放进 10s 片 = 26% 就稳了）");
            }
        }
    }
    return finish(items);
}

function finish(items) {
    return {
        items,
        n_err: items.filter((i) => i.level === "ERROR").length,
        n_warn: items.filter((i) => i.level === "WARN").length,
    };
}
