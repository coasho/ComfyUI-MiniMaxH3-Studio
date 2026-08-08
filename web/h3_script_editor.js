/**
 * 弹窗式剧本编辑器。
 *
 * 设计目标：使用者只填内容，不碰 H3 的六段式语法、时间码、<d> 标签、<Picture N> 编号。
 * 这些在生成时由 assemble() 自动拼出来。面板的字段全部由 h3_grammar.js 驱动，
 * 想加新语法元素只改 schema。
 */

import {
    CAMERA_MOTIONS, CAMERA_AMPLITUDE, CAMERA_SPEED, SHOT_SIZES, TRANSITIONS,
    MEDIA_ROLES, VOICE_MODES, DELIVERY_PRESETS, SECTIONS, LANGUAGES,
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

function select(options, value, onChange, { editable = false } = {}) {
    const sel = $("select", "h3se-select");
    for (const o of options) {
        const opt = $("option");
        opt.value = typeof o === "string" ? o : o.id;
        opt.textContent = typeof o === "string" ? o : o.label;
        sel.append(opt);
    }
    sel.value = value ?? (typeof options[0] === "string" ? options[0] : options[0]?.id) ?? "";
    sel.addEventListener("change", () => onChange(sel.value));
    if (!editable) return sel;
    const wrap = $("span", "h3se-editable");
    const input = $("input", "h3se-input");
    input.value = value || "";
    input.addEventListener("input", () => onChange(input.value));
    sel.value = "";
    sel.addEventListener("change", () => { if (sel.value) { input.value = sel.value; onChange(sel.value); } });
    wrap.append(input, sel);
    return wrap;
}

export function blankScript() {
    return {
        version: GRAMMAR_VERSION,
        duration: 15,
        language: "Chinese",
        speaker: "少女",
        sections: { subject_definitions: "", art_style: "", overall_soundscape: "", non_diegetic_music: "" },
        notRetained: [],
        media: {},        // { [mediaKey]: { role, note, scope } }
        shots: [],
    };
}

function blankShot(cutAt) {
    return {
        cutAt, size: "", motion: "", amplitude: "", speed: "",
        transition: "cut", description: "", refs: [], lines: [],
    };
}

function blankLine() {
    return { text: "", delivery: DELIVERY_PRESETS[0], mode: "onscreen", voiceRef: "", offset: 0.5 };
}

/* ---------------------------------------------------------------- 生成时拼装 */

function ts(t) {
    const m = Math.floor(t / 60);
    return `${String(m).padStart(2, "0")}:${(t - m * 60).toFixed(3).padStart(6, "0")}`;
}

/**
 * 把结构化剧本拼成官方六段式提示词。
 * mediaTokens: { [mediaKey]: "<Picture 1>" | "<Audio 1>" | ... }
 */
export function assemble(script, mediaTokens = {}) {
    const S = [];
    const subj = [];
    if (script.sections.subject_definitions?.trim()) {
        const t = script.sections.subject_definitions.trim();
        subj.push(`<Subject 1> is ${t}${/[.。!！?？]$/.test(t) ? "" : "."}`);
    }
    for (const [key, cfg] of Object.entries(script.media || {})) {
        const token = mediaTokens[key];
        if (!token || !cfg?.role) continue;
        const kind = cfg.kind || "image";
        const role = (MEDIA_ROLES[kind] || []).find((r) => r.id === cfg.role);
        if (role) subj.push(role.en(token) + (cfg.note ? ` (${cfg.note})` : "") + ".");
    }
    if (subj.length) S.push("subject_definitions: " + subj.join(" "));

    if (script.sections.art_style?.trim()) S.push("art_style: " + script.sections.art_style.trim());

    const keeps = [];
    for (const [key, cfg] of Object.entries(script.media || {})) {
        const token = mediaTokens[key];
        const kind = cfg.kind || "image";
        const role = (MEDIA_ROLES[kind] || []).find((r) => r.id === cfg.role);
        if (!token || !role) continue;
        // 音频/视频没有 retention 概念，用其用途说明代替，避免整条从保留声明里消失
        keeps.push(role.retention ? `${token}: ${role.retention}`
                                  : `${token}: ${role.label} 按其用途保留`);
    }
    let ret = "retention_analysis: " + (keeps.length ? keeps.join("; ") : "<Subject 1> fully_preserved");
    if (script.notRetained?.length) ret += ". NOT retained: " + script.notRetained.join("; ") + ".";
    S.push(ret);

    const body = [];
    script.shots.forEach((sh, i) => {
        const bits = [];
        if (i > 0) {
            const tr = TRANSITIONS.find((x) => x.id === sh.transition) || TRANSITIONS[0];
            const size = SHOT_SIZES.find((x) => x.id === sh.size);
            bits.push(`[Shot ${i + 1}] At ${ts(sh.cutAt)}, ${tr.en}` +
                      (size?.en ? ` ${size.en}.` : "."));
        } else {
            const size = SHOT_SIZES.find((x) => x.id === sh.size);
            if (size?.en) bits.push(`The opening shot is ${size.en}.`);
        }
        if (sh.description?.trim()) bits.push(sh.description.trim());
        const cam = cameraSentence(sh);
        if (cam) bits.push(cam);
        for (const ln of sh.lines) {
            if (!ln.text?.trim()) continue;
            const mode = VOICE_MODES.find((x) => x.id === ln.mode) || VOICE_MODES[0];
            const who = script.speaker || "the character";
            bits.push(`${who} (S1) speaks ${mode.en}` +
                      (ln.delivery ? `, ${ln.delivery}` : "") +
                      `: <d>[${script.language}]${ln.text.trim()}</d>`);
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
    for (const s of SECTIONS) {
        if (s.required && !s.auto && !script.sections[s.key]?.trim()) {
            out.push(`「${s.label}」还没填。${s.hint}`);
        }
    }
    return out;
}

export { SECTIONS, MEDIA_ROLES, CAMERA_MOTIONS, CAMERA_AMPLITUDE, CAMERA_SPEED,
         SHOT_SIZES, TRANSITIONS, VOICE_MODES, DELIVERY_PRESETS, LANGUAGES,
         blankShot, blankLine, $, select, ts };
