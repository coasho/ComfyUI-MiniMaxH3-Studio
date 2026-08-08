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

export function blankScript() {
    return {
        version: GRAMMAR_VERSION,
        duration: 15,
        language: "Chinese",
        speaker: "少女",
        taskTypes: [],
        sections: {
            subject_definitions: "", art_style: "", summary: "",
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

function blankLine() {
    return {
        text: "", delivery: DELIVERY_PRESETS[0], mode: "onscreen",
        continuity: "complete", voiceRef: "",
    };
}

/** 迁移旧剧本：补上后加的字段，避免老工作流打开就报错 */
export function migrateScript(raw) {
    const s = Object.assign(blankScript(), raw || {});
    s.sections = Object.assign(blankScript().sections, s.sections || {});
    s.taskTypes = Array.isArray(s.taskTypes) ? s.taskTypes : [];
    s.notRetained = Array.isArray(s.notRetained) ? s.notRetained : [];
    s.media = s.media || {};
    s.shots = (s.shots || []).map((sh) => Object.assign(blankShot(sh.cutAt || 0), sh, {
        lines: (sh.lines || []).map((ln) => Object.assign(blankLine(), ln)),
        refs: Array.isArray(sh.refs) ? sh.refs : [],
    }));
    return s;
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

    /* --- subject_definitions：角色外观 + 画风 + 各素材用途 --- */
    const subj = [];
    if (script.sections.subject_definitions?.trim()) {
        subj.push(`<Subject 1> is ${period(script.sections.subject_definitions.trim())}`);
    }
    // 官方没有 art_style 段落，画风并入 subject_definitions 一起发送
    if (script.sections.art_style?.trim()) {
        subj.push(`Rendering style: ${period(script.sections.art_style.trim())}`);
    }
    for (const [key, cfg] of media) {
        const token = mediaTokens[key];
        if (!token || !cfg?.role) continue;
        const role = (MEDIA_ROLES[cfg.kind || "image"] || []).find((r) => r.id === cfg.role);
        if (role) subj.push(period(role.en(token) + (cfg.note ? ` (${cfg.note})` : "")));
    }
    if (subj.length) S.push("subject_definitions: " + subj.join(" "));

    /* --- summary：任务类型前缀 + 概述 --- */
    const types = (script.taskTypes || []).filter((t) => TASK_TYPES.some((x) => x.id === t));
    const typeText = types.map((t) => TASK_TYPES.find((x) => x.id === t).en).join(" + ");
    const sum = script.sections.summary?.trim();
    if (typeText || sum) {
        S.push("summary: " + [typeText ? `[${typeText}]` : "", sum].filter(Boolean).join(" "));
    }

    /* --- retention_analysis --- */
    const keeps = [];
    for (const [key, cfg] of media) {
        const token = mediaTokens[key];
        if (!token || !cfg?.role) continue;
        const level = mediaRetention(cfg);
        if (level) keeps.push(`${token}: ${level}`);
    }
    let ret = "retention_analysis: " + (keeps.length ? keeps.join("; ") : "<Subject 1> fully_preserved");
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
            const who = script.speaker || "the character";
            bits.push(`${who} (S1) speaks ${mode.en}` +
                      (ln.delivery ? `, ${ln.delivery}` : "") +
                      `: <d>[${script.language}] ${dialogueBody(ln.text, ln.continuity)}</d>`);
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
        // 主体定义可以完全交给素材（参考图定角色外观），此时不算缺
        if (s.key === "subject_definitions" &&
            Object.values(script.media || {}).some((m) => m?.role)) continue;
        out.push(`「${s.label}」还没填。${s.hint}`);
    }
    return out;
}

export { SECTIONS_REF as SECTIONS, SECTIONS_BASE, STYLE_FIELD, CAMERA_ANGLES,
         CONTINUITY, VISUAL_RETENTION, AUDIO_RETENTION, TASK_TYPES,
         MEDIA_ROLES, CAMERA_MOTIONS, CAMERA_AMPLITUDE, CAMERA_SPEED,
         SHOT_SIZES, TRANSITIONS, VOICE_MODES, DELIVERY_PRESETS, LANGUAGES,
         blankShot, blankLine, $, ts };
