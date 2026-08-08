/**
 * 剧本数据模型 + 提示词拼装 + 校验。
 *
 * 设计目标：使用者只填内容，不碰 H3 的分段语法、时间码、<d> 标签、<Picture N> 编号。
 * 这些在生成时由 assemble() 自动拼出来。面板的字段全部由 h3_grammar.js 驱动，
 * 想加新语法元素只改 schema。
 */

import {
    CAMERA_MOTIONS, CAMERA_AMPLITUDE, CAMERA_SPEED, SHOT_SIZES, CAMERA_ANGLES,
    TRANSITIONS, MEDIA_ROLES, VOICE_MODES, CONTINUITY, DELIVERY_PRESETS,
    VISUAL_RETENTION, AUDIO_RETENTION, TASK_TYPES,
    SECTIONS_REF, SECTIONS_BASE, STYLE_FIELD, LANGUAGES,
    SPEECH, spokenChars, speechSeconds, cameraSentence, framingWarning,
    GRAMMAR_VERSION,
} from "./h3_grammar.js";

export const SCRIPT_PROP = "minimax_h3_script_v1";

const $ = (tag, cls, txt) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (txt != null) el.textContent = txt;
    return el;
};

let idSeq = 0;
const newId = () => `c${Date.now().toString(36)}${(idSeq++).toString(36)}`;

/**
 * 一个角色。<Subject N> 与 (SN) 都不存在这里——它们是生成时算出来的，
 * 因为官方规定这两套编号各按各的顺序走（见 castPlan）。
 */
export function blankCharacter(name = "") {
    return {
        id: newId(),
        name,
        desc: "",            // 外观描述
        onScreen: true,      // false = 只有声音的旁白，不占 <Subject N>
        language: "",        // 空 = 跟随全局
        identityKey: "",     // 形象参考图的 mediaKey
        voiceKey: "",        // 音色参考音频的 mediaKey
    };
}

export function blankScript() {
    return {
        version: GRAMMAR_VERSION,
        duration: 15,
        language: "Chinese",
        taskTypes: [],
        characters: [blankCharacter("少女")],
        sections: {
            art_style: "", summary: "",
            overall_soundscape: "", non_diegetic_music: "",
        },
        notRetained: [],
        media: {},        // { [mediaKey]: { kind, role, retention, note } }
        shots: [],
    };
}

function blankShot(cutAt) {
    return {
        cutAt, size: "", angle: "", motion: "", amplitude: "", speed: "",
        transition: "cut", description: "", refs: [], lines: [],
    };
}

function blankLine(charId = "") {
    return {
        text: "", charId, delivery: DELIVERY_PRESETS[0], mode: "onscreen",
        continuity: "complete",
    };
}

/**
 * 算出每个角色在提示词里的两个身份：
 *   subject —— <Subject N>，按角色表顺序，只有出镜角色占号
 *   speaker —— (SN)，按「首次开口顺序」，从不开口的角色不给编号
 * 官方明确这两套编号互不相干，可能出现 <Subject 2> (S1)。
 */
export function castPlan(script) {
    const plan = {};
    let subjectN = 0;
    for (const c of script.characters || []) {
        const onScreen = c.onScreen !== false;
        if (onScreen) subjectN++;
        plan[c.id] = {
            char: c,
            subject: onScreen ? subjectN : null,
            label: onScreen ? `<Subject ${subjectN}>` : (c.name.trim() || "an off-screen voice"),
            speaker: null,
        };
    }
    let sN = 0;
    for (const sh of script.shots || []) {
        for (const ln of sh.lines || []) {
            if (!ln.text?.trim()) continue;
            const p = plan[ln.charId];
            if (p && !p.speaker) p.speaker = `S${++sN}`;
        }
    }
    return plan;
}

/** 角色在面板上的显示名，带上它会拿到的编号 */
export function castBadge(p) {
    const bits = [];
    if (p.subject) bits.push(`<Subject ${p.subject}>`);
    if (p.speaker) bits.push(`(${p.speaker})`);
    return bits.join(" ") || "不出镜且无台词";
}

/**
 * 迁移旧剧本：补上后加的字段，避免老工作流打开就报错。
 * 单角色时代的 speaker / subject_definitions / media 的 identity+timbre 用途
 * 会折叠成一个角色，台词全部挂到它身上。
 */
export function migrateScript(raw) {
    const s = Object.assign(blankScript(), raw || {});
    s.sections = Object.assign(blankScript().sections, s.sections || {});
    s.taskTypes = Array.isArray(s.taskTypes) ? s.taskTypes : [];
    s.notRetained = Array.isArray(s.notRetained) ? s.notRetained : [];
    s.media = s.media || {};

    // 判据必须看 raw：blankScript() 自带一个空角色，看 s 会以为老剧本已经有角色表，
    // 于是折叠分支永不执行，外观描述和参考图绑定全部无声丢失。
    if (!Array.isArray(raw?.characters) || !raw.characters.length) {
        const c = blankCharacter(String(raw?.speaker || "").trim() || "少女");
        c.desc = String(raw?.sections?.subject_definitions || "").trim();
        for (const [key, cfg] of Object.entries(s.media)) {
            if (cfg?.role === "identity" && !c.identityKey) { c.identityKey = key; cfg.role = ""; }
            if (cfg?.role === "timbre" && !c.voiceKey) { c.voiceKey = key; cfg.role = ""; }
        }
        s.characters = [c];
    }
    s.characters = s.characters.map((c) => Object.assign(blankCharacter(), c));
    delete s.speaker;
    delete s.sections.subject_definitions;

    const first = s.characters[0]?.id || "";
    s.shots = (s.shots || []).map((sh) => Object.assign(blankShot(sh.cutAt || 0), sh, {
        lines: (sh.lines || []).map((ln) => {
            const l = Object.assign(blankLine(), ln);
            // 老剧本没有 charId；已删角色的台词也回落到第一个角色，别让台词凭空消失
            if (!l.charId || !s.characters.some((c) => c.id === l.charId)) l.charId = first;
            delete l.voiceRef;
            return l;
        }),
        refs: Array.isArray(sh.refs) ? sh.refs : [],
    }));
    return s;
}

/** 被角色占用的素材：这些不在「素材用途」里选用途，但保留等级仍可覆盖 */
export function characterBoundMedia(script) {
    const out = {};
    for (const c of script.characters || []) {
        if (c.identityKey) out[c.identityKey] = { char: c, kind: "image", role: "identity" };
        if (c.voiceKey) out[c.voiceKey] = { char: c, kind: "audio", role: "timbre" };
    }
    return out;
}

/** 某素材的实际保留等级：用户覆盖优先，否则取用途预设 */
export function mediaRetention(cfg) {
    if (!cfg) return "";
    if (cfg.retention) return cfg.retention;
    const role = (MEDIA_ROLES[cfg.kind || "image"] || []).find((r) => r.id === cfg.role);
    return role?.retention || "";
}

/** 该素材类型对应的保留等级词表（音频与视觉是两套独立词表） */
export function retentionSet(kind) {
    return kind === "audio" ? AUDIO_RETENTION : VISUAL_RETENTION;
}

/* ---------------------------------------------------------------- 生成时拼装 */

function ts(t) {
    const m = Math.floor(t / 60);
    return `${String(m).padStart(2, "0")}:${(t - m * 60).toFixed(3).padStart(6, "0")}`;
}

const period = (t) => (/[.。!！?？]$/.test(t) ? t : t + ".");

/** 台词按连续性包上官方标记，标记写在 <d> 内部 */
function dialogueBody(text, continuity) {
    const t = text.trim();
    if (continuity === "into_next") return `${t} <scenetrans>`;
    if (continuity === "from_prev") return `<scenetrans> ${t}`;
    if (continuity === "cutoff") return `${t} <cutoff>`;
    return t;
}

/**
 * 把结构化剧本拼成官方参考模式六段式提示词。
 * mediaTokens: { [mediaKey]: "<Picture 1>" | "<Audio 1>" | ... }
 */
export function assemble(script, mediaTokens = {}) {
    const S = [];
    const media = Object.entries(script.media || {});
    const plan = castPlan(script);
    const bound = characterBoundMedia(script);

    /* --- subject_definitions：逐角色定义 + 音色绑定 + 画风 + 其余素材用途 --- */
    const subj = [];
    for (const c of script.characters || []) {
        const p = plan[c.id];
        const desc = c.desc?.trim();
        const idToken = mediaTokens[c.identityKey];
        if (!desc && !idToken && !p.speaker) continue;      // 空壳角色不写进提示词
        if (p.subject == null) {
            // 不出镜的声音：别写成有长相的主体，否则模型会把它画出来
            if (desc) subj.push(period(`${p.label} is an off-screen voice: ${desc}`));
            else if (p.speaker) subj.push(`${p.label} is an off-screen voice with no visible presence.`);
            continue;
        }
        let line = `${p.label} is ${desc || "the character"}`;
        if (idToken) line += `${desc ? "," : ""} whose identity and appearance come from ${idToken}`;
        subj.push(period(line));
    }
    // 音色绑定：官方写法把 (SN) 一起带上，模型才知道这条嗓子归谁
    for (const c of script.characters || []) {
        const p = plan[c.id];
        const vToken = mediaTokens[c.voiceKey];
        // 没台词的角色不写音色绑定：那是条模型用不上的悬空引用，反而可能诱导它开口
        if (!vToken || !p.speaker) continue;
        subj.push(`${vToken} is the voice-timbre and delivery reference for ` +
                  `${p.label} (${p.speaker}); do not reuse its source words.`);
    }
    // 官方没有 art_style 段落，画风并入 subject_definitions 一起发送
    if (script.sections.art_style?.trim()) {
        subj.push(`Rendering style: ${period(script.sections.art_style.trim())}`);
    }
    for (const [key, cfg] of media) {
        const token = mediaTokens[key];
        if (!token || !cfg?.role || bound[key]) continue;   // 角色占用的素材已在上面写过
        const role = (MEDIA_ROLES[cfg.kind || "image"] || []).find((r) => r.id === cfg.role);
        if (role && !role.viaCharacter) subj.push(period(role.en(token) + (cfg.note ? ` (${cfg.note})` : "")));
    }
    if (subj.length) S.push("subject_definitions: " + subj.join(" "));

    /* --- summary：任务类型前缀 + 概述 --- */
    const types = (script.taskTypes || []).filter((t) => TASK_TYPES.some((x) => x.id === t));
    const typeText = types.map((t) => TASK_TYPES.find((x) => x.id === t).en).join(" + ");
    const sum = script.sections.summary?.trim();
    if (typeText || sum) {
        S.push("summary: " + [typeText ? `[${typeText}]` : "", sum].filter(Boolean).join(" "));
    }

    /* --- retention_analysis：角色占用的素材也要报，否则参考图等于白接 --- */
    const keeps = [];
    for (const [key, b] of Object.entries(bound)) {
        const token = mediaTokens[key];
        if (!token) continue;
        const level = mediaRetention({ ...b, ...(script.media?.[key] || {}), kind: b.kind, role: b.role });
        if (level) keeps.push(`${token}: ${level}`);
    }
    for (const [key, cfg] of media) {
        const token = mediaTokens[key];
        if (!token || !cfg?.role || bound[key]) continue;
        const level = mediaRetention(cfg);
        if (level) keeps.push(`${token}: ${level}`);
    }
    const firstSubject = Object.values(plan).find((p) => p.subject === 1);
    let ret = "retention_analysis: " + (keeps.length ? keeps.join("; ")
        : `${firstSubject?.label || "<Subject 1>"} fully_preserved`);
    if (script.notRetained?.length) ret += ". NOT retained: " + script.notRetained.join("; ") + ".";
    S.push(ret);

    /* --- detailed_description：分镜 --- */
    const body = [];
    script.shots.forEach((sh, i) => {
        const bits = [];
        const size = SHOT_SIZES.find((x) => x.id === sh.size);
        const angle = CAMERA_ANGLES.find((x) => x.id === sh.angle);
        const framing = [size?.en, angle?.en].filter(Boolean).join(" ");
        if (i > 0) {
            const tr = TRANSITIONS.find((x) => x.id === sh.transition) || TRANSITIONS[0];
            bits.push(period(`[Shot ${i + 1}] At ${ts(sh.cutAt)}, ${tr.en}` +
                             (framing ? ` ${framing}` : "")));
        } else if (framing) {
            bits.push(`The opening shot is ${framing}.`);
        }
        if (sh.description?.trim()) bits.push(period(sh.description.trim()));
        const cam = cameraSentence(sh);
        if (cam) bits.push(cam);
        for (const ln of sh.lines) {
            if (!ln.text?.trim()) continue;
            const mode = VOICE_MODES.find((x) => x.id === ln.mode) || VOICE_MODES[0];
            const p = plan[ln.charId];
            const who = p ? p.label : "the character";
            const sid = p?.speaker ? ` (${p.speaker})` : "";
            const vToken = p && mediaTokens[p.char.voiceKey];
            const lang = p?.char.language?.trim() || script.language;
            bits.push(`${who}${sid} speaks` +
                      (vToken ? ` using the voice timbre and delivery referenced from ${vToken},` : "") +
                      ` ${mode.en}` + (ln.delivery ? `, ${ln.delivery}` : "") +
                      `: <d>[${lang}] ${dialogueBody(ln.text, ln.continuity)}</d>`);
        }
        body.push(bits.join(" "));
    });
    if (body.length) S.push("detailed_description: " + body.join("\n\n"));

    S.push("overall_soundscape: " + (script.sections.overall_soundscape?.trim() || "N/A"));
    S.push("non_diegetic_music: " + (script.sections.non_diegetic_music?.trim() || "N/A"));
    return S.join("\n\n");
}

/* ------------------------------------------------------------------- 校验 */

export function validate(script) {
    const out = [];
    const shots = script.shots || [];
    if (!shots.length) return ["还没有分镜。"];
    if (Math.abs(shots[0].cutAt) > 1e-6) out.push("第 1 镜必须从 0 秒开始。");
    for (let i = 1; i < shots.length; i++) {
        if (shots[i].cutAt <= shots[i - 1].cutAt) out.push(`第 ${i + 1} 镜的起点不晚于第 ${i} 镜。`);
    }
    if (shots.at(-1).cutAt >= script.duration) out.push("最后一镜起点不早于总时长。");

    let totalSpeech = 0;
    shots.forEach((sh, i) => {
        const start = sh.cutAt;
        const end = i + 1 < shots.length ? shots[i + 1].cutAt : script.duration;
        const span = end - start;
        let need = 0;
        for (const ln of sh.lines) {
            if (!ln.text?.trim()) continue;
            need += SPEECH.padBefore + speechSeconds(ln.text) + SPEECH.padAfter;
            totalSpeech += speechSeconds(ln.text);
        }
        if (need > span) {
            const names = sh.lines.filter((l) => l.text?.trim())
                .map((l) => `「${l.text.slice(0, 10)}」${spokenChars(l.text)}字`).join(" / ");
            out.push(`镜头 ${i + 1}（${start.toFixed(1)}–${end.toFixed(1)}s，共 ${span.toFixed(1)}s）` +
                     `装不下 ${sh.lines.filter((l) => l.text?.trim()).length} 句台词：${names}，` +
                     `含前后留白约需 ${need.toFixed(1)}s。`);
        }
        const fw = framingWarning(sh);
        if (fw) out.push(`镜头 ${i + 1}：${fw}`);
        if (!sh.description?.trim()) out.push(`镜头 ${i + 1} 还没有画面描述。`);
    });
    if (totalSpeech > script.duration * 0.62) {
        out.push(`台词共约 ${totalSpeech.toFixed(1)}s，占全片 ${Math.round(totalSpeech / script.duration * 100)}%，` +
                 `留给动作和留白的时间过少（建议不超过 60%）。`);
    }

    // 连续性成对检查：延续到下一镜，必须有人承接
    const flat = [];
    shots.forEach((sh, i) => sh.lines.forEach((ln) => { if (ln.text?.trim()) flat.push({ ln, i }); }));
    flat.forEach((cur, k) => {
        const next = flat[k + 1];
        if (cur.ln.continuity === "into_next" && next?.ln.continuity !== "from_prev") {
            out.push(`镜头 ${cur.i + 1} 有台词标了「延续到下一镜」，但下一句没标「承接上一镜」，` +
                     `<scenetrans> 必须成对出现。`);
        }
        if (cur.ln.continuity === "cutoff" && k !== flat.length - 1) {
            out.push(`镜头 ${cur.i + 1} 的「被打断」只应用在全片最后一句。`);
        }
    });

    for (const s of SECTIONS_REF) {
        if (!s.required || s.auto || script.sections[s.key]?.trim()) continue;
        out.push(`「${s.label}」还没填。${s.hint}`);
    }
    out.push(...castProblems(script));
    return out;
}

/** 多角色专属的坑：说话人没指，音色撞车，角色是空壳 */
export function castProblems(script) {
    const out = [];
    const chars = script.characters || [];
    const plan = castPlan(script);
    if (!chars.length) return ["还没有角色。至少建一个角色，台词才知道是谁说的。"];

    const byVoice = {};
    chars.forEach((c, i) => {
        const who = c.name?.trim() || `第 ${i + 1} 个角色`;
        if (!c.name?.trim()) out.push(`第 ${i + 1} 个角色还没起名字，台词下拉框里会分不清。`);
        // 不出镜的旁白本来就没有长相，别拿出镜角色的标准去要求它
        if (c.onScreen !== false && !c.desc?.trim() && !c.identityKey) {
            out.push(`角色「${who}」既没有外观描述也没有形象参考图，模型只能瞎编长相。`);
        }
        if (c.voiceKey) {
            (byVoice[c.voiceKey] ||= []).push(who);
            if (!plan[c.id].speaker) {
                out.push(`角色「${who}」指定了音色但一句台词都没有，这条音色不会生效。`);
            }
        }
        if (c.onScreen === false && plan[c.id].speaker) {
            const bad = (script.shots || []).some((sh) =>
                sh.lines.some((l) => l.charId === c.id && l.text?.trim() && l.mode === "onscreen"));
            if (bad) out.push(`角色「${who}」标了不出镜，却有台词按「画内说话（露脸）」写，改成画外音或旁白。`);
        }
    });
    for (const [key, names] of Object.entries(byVoice)) {
        if (names.length > 1) out.push(`同一条音色素材同时绑给了 ${names.join("、")}，两人会是同一把嗓子。`);
    }

    const ids = new Set(chars.map((c) => c.id));
    (script.shots || []).forEach((sh, i) => {
        for (const l of sh.lines) {
            if (!l.text?.trim()) continue;
            if (!l.charId || !ids.has(l.charId)) out.push(`镜头 ${i + 1} 有台词没指定说话人。`);
        }
    });
    const speaking = Object.values(plan).filter((p) => p.speaker).length;
    if (speaking > 4) out.push(`共 ${speaking} 个角色有台词，(S1)…(S${speaking}) 越多越容易串音，建议压到 4 个以内。`);
    return out;
}

export { SECTIONS_REF as SECTIONS, SECTIONS_BASE, STYLE_FIELD, CAMERA_ANGLES,
         CONTINUITY, VISUAL_RETENTION, AUDIO_RETENTION, TASK_TYPES,
         MEDIA_ROLES, CAMERA_MOTIONS, CAMERA_AMPLITUDE, CAMERA_SPEED,
         SHOT_SIZES, TRANSITIONS, VOICE_MODES, DELIVERY_PRESETS, LANGUAGES,
         blankShot, blankLine, $, ts };
