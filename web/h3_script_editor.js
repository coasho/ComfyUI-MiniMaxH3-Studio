/**
 * 剧本数据模型 + 提示词拼装 + 校验。（v3：实体模型）
 *
 * 设计原则：
 *   结构只用在 H3 语法要求机器精确的地方 —— Subject/Speaker 编号、时间码、
 *   <d> 标签、保留声明、官方绑定句。其余一律是散文 + @实体引用。
 *
 * v2 把「角色」写死成一等公民，于是衣服、道具、场景、纯景色片都表达不了。
 * v3 只有「实体」：人物、物件/服装、场景、动作、画风、画外音，全部共用
 * <Subject N> 编号体系；谁说话谁才拿 (SN)；镜头里的变化用「变更」表达，
 * 预设覆盖常见动作，custom 自由句兜底。
 */

import {
    CAMERA_MOTIONS, CAMERA_AMPLITUDE, CAMERA_SPEED, SHOT_SIZES, CAMERA_ANGLES,
    TRANSITIONS, MEDIA_ROLES, VOICE_MODES, CONTINUITY, DELIVERY_PRESETS,
    VISUAL_RETENTION, AUDIO_RETENTION, TASK_TYPES, ENTITY_KINDS, BEAT_KINDS,
    VOICE_ROLE, bindingSentence,
    SECTIONS_REF, SECTIONS_BASE, STYLE_FIELD, LANGUAGES,
    SPEECH, spokenChars, speechSeconds, cameraSentence, framingWarning,
    GRAMMAR_VERSION,
} from "./h3_grammar.js";

export const SCRIPT_PROP = "minimax_h3_script_v1";

let idSeq = 0;
const newId = (p) => `${p}${Date.now().toString(36)}${(idSeq++).toString(36)}`;

/* ------------------------------------------------------------ 数据构造 */

export function blankEntity(kind = "identity", name = "") {
    const k = ENTITY_KINDS.find((x) => x.id === kind) || ENTITY_KINDS[0];
    return {
        id: newId("e"),
        kind,
        name,
        desc: "",
        visible: k.visible,      // false = 不占 <Subject N>
        bindings: [],            // [{ mediaKey, kind, retention, transferTo }]
        voiceKey: "",            // 音色素材
        language: "",            // 空 = 跟随全局
    };
}

export function blankBinding(mediaKey = "", kind = "identity") {
    return { mediaKey, kind, retention: "", transferTo: "" };
}

export function blankBeat(actor = "") {
    return { kind: "wear", actor, target: "", recipient: "", at: "", text: "" };
}

export function blankShot(cutAt = 0) {
    return {
        cutAt, size: "", angle: "", motion: "", amplitude: "", speed: "",
        transition: "cut", description: "", beats: [], lines: [],
    };
}

export function blankLine(entityId = "") {
    // delivery 默认留空：预填一个「气声耳语」这种强指令，会在用户没察觉时
    // 把每一句台词都改成那个语气。
    return { text: "", entityId, delivery: "", mode: "onscreen", continuity: "complete" };
}

export function blankScript() {
    return {
        version: GRAMMAR_VERSION,
        duration: 15,
        language: "Chinese",
        taskTypes: [],
        entities: [],
        sections: { summary: "", overall_soundscape: "", non_diegetic_music: "" },
        notRetained: [],
        media: {},        // { [mediaKey]: { kind, role, retention, note } } —— 不绑实体的用途
        shots: [],
    };
}

/* -------------------------------------------------------------- 编号 */

/**
 * 算出每个实体在提示词里的身份：
 *   subject —— <Subject N>，按实体表顺序，只有 visible 的占号
 *   speaker —— (SN)，按「首次开口顺序」，从不开口的不给编号
 * 官方明确这两套编号互不相干，可能出现 <Subject 2> (S1)。
 */
export function castPlan(script) {
    const plan = {};
    let n = 0;
    for (const e of script.entities || []) {
        const vis = e.visible !== false;
        if (vis) n++;
        plan[e.id] = {
            ent: e,
            subject: vis ? n : null,
            label: vis ? `<Subject ${n}>` : (e.name?.trim() || "an unnamed voice"),
            speaker: null,
        };
    }
    let s = 0;
    for (const sh of script.shots || []) {
        for (const ln of sh.lines || []) {
            if (!ln.text?.trim()) continue;
            const p = plan[ln.entityId];
            if (p && !p.speaker) p.speaker = `S${++s}`;
        }
    }
    return plan;
}

export function castBadge(p) {
    const bits = [];
    if (p.subject) bits.push(`<Subject ${p.subject}>`);
    if (p.speaker) bits.push(`(${p.speaker})`);
    return bits.join(" ") || "无编号";
}

/* ---------------------------------------------------------- @实体引用 */

const ESC = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 名字 -> 实体，长名优先，避免「少女」把「少女的外套」截断 */
function refRegex(script) {
    const names = (script.entities || [])
        .map((e) => e.name?.trim()).filter(Boolean)
        .sort((a, b) => b.length - a.length);
    if (!names.length) return null;
    return new RegExp("@(" + names.map(ESC).join("|") + ")", "g");
}

/** 把自由文本里的 @名字 换成 <Subject N> / 名字。找不到的原样留下，由校验报出来 */
export function resolveRefs(text, script, plan) {
    const t = String(text || "");
    const re = refRegex(script);
    if (!re) return t;
    const byName = {};
    for (const e of script.entities || []) if (e.name?.trim()) byName[e.name.trim()] = e.id;
    return t.replace(re, (m, name) => plan[byName[name]]?.label ?? m);
}

/** 文本里所有 @xxx 里、对不上实体的那些 */
export function danglingRefs(text, script) {
    const known = new Set((script.entities || []).map((e) => e.name?.trim()).filter(Boolean));
    const out = [];
    // 中英文名都可能，取到下一个空白/标点为止
    for (const m of String(text || "").matchAll(/@([^\s，。！？、；："'（）()<>@]+)/g)) {
        if (!known.has(m[1])) out.push(m[1]);
    }
    return out;
}

/* ------------------------------------------------------------ 保留等级 */

/** 一条实体绑定的实际保留等级：用户覆盖优先，否则取该内容类型的官方默认 */
export function bindingRetention(b) {
    if (b?.retention) return b.retention;
    return ENTITY_KINDS.find((x) => x.id === b?.kind)?.retention || "";
}

export function mediaRetention(cfg) {
    if (!cfg) return "";
    if (cfg.retention) return cfg.retention;
    const role = (MEDIA_ROLES[cfg.kind || "image"] || []).find((r) => r.id === cfg.role);
    return role?.retention || "";
}

export function retentionSet(kind) {
    return kind === "audio" ? AUDIO_RETENTION : VISUAL_RETENTION;
}

/** 已被实体占用的素材 -> 占用它的实体与用途，供素材面板显示成只读 */
export function entityBoundMedia(script) {
    const out = {};
    for (const e of script.entities || []) {
        for (const b of e.bindings || []) {
            if (b.mediaKey) (out[b.mediaKey] ||= []).push({ ent: e, binding: b });
        }
        if (e.voiceKey) (out[e.voiceKey] ||= []).push({ ent: e, voice: true });
    }
    return out;
}

/* ---------------------------------------------------------------- 迁移 */

/** v2（角色模型）以及更早的单角色剧本 -> v3 实体模型 */
export function migrateScript(raw) {
    // 必须深拷贝：Object.assign 是浅拷贝，notRetained 数组与 media 对象会和
    // 调用方共享引用，于是弹窗里的改动即使点「取消」也已经写回节点了。
    try { raw = raw ? structuredClone(raw) : raw; } catch { raw = JSON.parse(JSON.stringify(raw || null)); }
    const s = Object.assign(blankScript(), raw || {});
    s.sections = Object.assign(blankScript().sections, s.sections || {});
    s.taskTypes = Array.isArray(s.taskTypes) ? s.taskTypes : [];
    s.notRetained = Array.isArray(s.notRetained) ? s.notRetained : [];
    s.media = s.media || {};

    if (!Array.isArray(raw?.entities)) {
        const ents = [];
        // v2：characters[] -> 人物实体
        const chars = Array.isArray(raw?.characters) ? raw.characters : null;
        if (chars) {
            for (const c of chars) {
                const e = blankEntity(c.onScreen === false ? "voice" : "identity", c.name || "");
                e.desc = c.desc || "";
                e.visible = c.onScreen !== false;
                e.language = c.language || "";
                e.voiceKey = c.voiceKey || "";
                if (c.identityKey) e.bindings.push(blankBinding(c.identityKey, "identity"));
                e.id = c.id || e.id;      // 保住 id，台词才不会失联
                ents.push(e);
            }
        } else {
            // v1：单角色 speaker + subject_definitions
            const e = blankEntity("identity", String(raw?.speaker || "").trim() || "少女");
            e.desc = String(raw?.sections?.subject_definitions || "").trim();
            for (const [key, cfg] of Object.entries(s.media)) {
                if (cfg?.role === "identity") { e.bindings.push(blankBinding(key, "identity")); cfg.role = ""; }
                if (cfg?.role === "timbre") { e.voiceKey = key; cfg.role = ""; }
            }
            ents.push(e);
        }
        // 旧的 art_style 段 / style 用途 -> 画风实体
        const styleKeys = Object.entries(s.media)
            .filter(([, c]) => c?.role === "style" || c?.role === "style_v").map(([k]) => k);
        const styleText = String(raw?.sections?.art_style || "").trim();
        if (styleText || styleKeys.length) {
            const st = blankEntity("style", "画风");
            st.desc = styleText;
            for (const k of styleKeys) { st.bindings.push(blankBinding(k, "style")); s.media[k].role = ""; }
            ents.push(st);
        }
        // 旧的 prop / scene / motion 用途 -> 各自实体
        const carry = { prop: ["object", "道具"], scene: ["scene", "场景"], motion: ["action", "动作"] };
        for (const [role, [kind, nm]] of Object.entries(carry)) {
            for (const [k, cfg] of Object.entries(s.media)) {
                if (cfg?.role !== role) continue;
                const e = blankEntity(kind, nm);
                e.desc = cfg.note || "";
                e.bindings.push(blankBinding(k, kind));
                cfg.role = "";
                ents.push(e);
            }
        }
        s.entities = ents;
    }
    s.entities = (s.entities || []).map((e) => {
        const m = Object.assign(blankEntity(e.kind || "identity"), e);
        m.bindings = (m.bindings || []).map((b) => Object.assign(blankBinding(), b));
        return m;
    });
    delete s.characters;
    delete s.speaker;
    delete s.sections.subject_definitions;
    delete s.sections.art_style;

    const ids = new Set(s.entities.map((e) => e.id));
    const firstSpeaker = s.entities.find((e) => ENTITY_KINDS.find((k) => k.id === e.kind)?.canSpeak)?.id || "";
    s.shots = (s.shots || []).map((sh) => {
        const m = Object.assign(blankShot(sh.cutAt || 0), sh);
        m.beats = (m.beats || []).map((b) => Object.assign(blankBeat(), b));
        m.lines = (m.lines || []).map((ln) => {
            const l = Object.assign(blankLine(), ln);
            // v2 用 charId；已删实体的台词回落到第一个能说话的实体，别让台词凭空消失
            l.entityId = l.entityId || ln.charId || "";
            if (!ids.has(l.entityId)) l.entityId = firstSpeaker;
            delete l.charId; delete l.voiceRef;
            return l;
        });
        delete m.refs;
        return m;
    });
    s.version = GRAMMAR_VERSION;
    return s;
}

/* ---------------------------------------------------------------- 拼装 */

function ts(t) {
    const m = Math.floor(t / 60);
    return `${String(m).padStart(2, "0")}:${(t - m * 60).toFixed(3).padStart(6, "0")}`;
}

const period = (t) => (/[.。!！?？]$/.test(t) ? t : t + ".");

function dialogueBody(text, continuity) {
    const t = text.trim();
    if (continuity === "into_next") return `${t} <scenetrans>`;
    if (continuity === "from_prev") return `<scenetrans> ${t}`;
    if (continuity === "cutoff") return `${t} <cutoff>`;
    return t;
}

/** 一条变更 -> 一句英文。custom 走自由文本，其余走预设模板 */
export function beatSentence(beat, script, plan) {
    const k = BEAT_KINDS.find((x) => x.id === beat.kind);
    const lab = (id) => plan[id]?.label || "";
    const extra = beat.text?.trim() ? " " + period(resolveRefs(beat.text, script, plan)) : "";
    const when = beat.at !== "" && beat.at != null && !Number.isNaN(+beat.at)
        ? `At +${(+beat.at).toFixed(1)}s, ` : "";
    if (!k || k.id === "custom" || !k.en) {
        const t = resolveRefs(beat.text, script, plan).trim();
        return t ? when + period(t) : "";
    }
    const a = lab(beat.actor), t = lab(beat.target), r = lab(beat.recipient);
    if (k.needs.includes("actor") && !a) return "";
    if (k.needs.includes("target") && !t) return "";
    if (k.needs.includes("recipient") && !r) return "";
    return when + period(k.en(a, t, r)) + extra;
}

/**
 * 把结构化剧本拼成官方参考模式六段式提示词。
 * mediaTokens: { [mediaKey]: "<Picture 1>" | "<Audio 1>" | ... }
 */
export function assemble(script, mediaTokens = {}) {
    // 存在工作流里的可能还是 v1/v2 的形状（没打开过编辑器就直接生成）。
    // 在这里兜底迁移，免得每个调用点都要记得先迁一次。
    if (!Array.isArray(script?.entities)) script = migrateScript(script);
    const S = [];
    const plan = castPlan(script);
    const R = (t) => resolveRefs(t, script, plan);

    /* --- subject_definitions --- */
    const subj = [];
    for (const e of script.entities || []) {
        const p = plan[e.id];
        const desc = e.desc?.trim();
        const binds = (e.bindings || []).filter((b) => mediaTokens[b.mediaKey]);
        if (!desc && !binds.length && !p.speaker) continue;   // 空壳实体不写进提示词
        if (p.subject == null) {
            // 不出镜：不能写成有长相的主体，否则模型会把它画出来
            if (e.kind === "style") {
                if (desc) subj.push(period(`The visual style of the video is ${R(desc)}`));
            } else if (desc) {
                subj.push(period(`${p.label} is an off-screen voice: ${R(desc)}`));
            } else if (p.speaker) {
                subj.push(`${p.label} is an off-screen voice with no visible presence.`);
            }
        } else if (desc) {
            subj.push(period(`${p.label} is ${R(desc)}`));
        }
        // 官方绑定句：一个实体可以被多张图/多段视频分别定义
        for (const b of binds) {
            const label = p.subject == null && e.kind === "style" ? "the video" : p.label;
            const sent = bindingSentence(b.kind, label, mediaTokens[b.mediaKey]);
            if (sent) subj.push(sent);
            if (bindingRetention(b) === "attribute_transfer" && b.transferTo && plan[b.transferTo]) {
                const kk = ENTITY_KINDS.find((x) => x.id === b.kind);
                subj.push(`Transfer the ${kk.phrase} defined by ${mediaTokens[b.mediaKey]} ` +
                          `to ${plan[b.transferTo].label}.`);
            }
        }
    }
    // 音色绑定（只给真开口的实体写，否则是条模型用不上的悬空引用）
    for (const e of script.entities || []) {
        const p = plan[e.id];
        const token = mediaTokens[e.voiceKey];
        if (token && p.speaker) subj.push(VOICE_ROLE.en(token, p.label, p.speaker));
    }
    // 不绑实体的素材用途（首尾帧、配乐、整轨复用……）
    const bound = entityBoundMedia(script);
    for (const [key, cfg] of Object.entries(script.media || {})) {
        const token = mediaTokens[key];
        if (!token || !cfg?.role || bound[key]) continue;
        const role = (MEDIA_ROLES[cfg.kind || "image"] || []).find((r) => r.id === cfg.role);
        if (role) subj.push(period(role.en(token) + (cfg.note ? ` (${cfg.note})` : "")));
    }
    if (subj.length) S.push("subject_definitions: " + subj.join(" "));

    /* --- summary --- */
    const types = (script.taskTypes || []).filter((t) => TASK_TYPES.some((x) => x.id === t));
    const typeText = types.map((t) => TASK_TYPES.find((x) => x.id === t).en).join(" + ");
    const sum = script.sections.summary?.trim();
    if (typeText || sum) {
        S.push("summary: " + [typeText ? `[${typeText}]` : "", sum ? R(sum) : ""].filter(Boolean).join(" "));
    }

    /* --- retention_analysis --- */
    const keeps = [];
    for (const e of script.entities || []) {
        for (const b of e.bindings || []) {
            const token = mediaTokens[b.mediaKey];
            const lvl = bindingRetention(b);
            if (token && lvl) keeps.push(`${token}: ${lvl}`);
        }
        const vt = mediaTokens[e.voiceKey];
        if (vt) keeps.push(`${vt}: ${script.media?.[e.voiceKey]?.retention || VOICE_ROLE.retention}`);
    }
    for (const [key, cfg] of Object.entries(script.media || {})) {
        const token = mediaTokens[key];
        if (!token || !cfg?.role || bound[key]) continue;
        const lvl = mediaRetention(cfg);
        if (lvl) keeps.push(`${token}: ${lvl}`);
    }
    const first = Object.values(plan).find((p) => p.subject === 1);
    let ret = "retention_analysis: " + (keeps.length ? keeps.join("; ")
        : `${first?.label || "<Subject 1>"} fully_preserved`);
    if (script.notRetained?.length) ret += ". NOT retained: " + script.notRetained.join("; ") + ".";
    S.push(ret);

    /* --- detailed_description --- */
    const body = [];
    (script.shots || []).forEach((sh, i) => {
        const bits = [];
        const size = SHOT_SIZES.find((x) => x.id === sh.size);
        const angle = CAMERA_ANGLES.find((x) => x.id === sh.angle);
        const framing = [size?.en, angle?.en].filter(Boolean).join(" ");
        if (i > 0) {
            const tr = TRANSITIONS.find((x) => x.id === sh.transition) || TRANSITIONS[0];
            bits.push(period(`[Shot ${i + 1}] At ${ts(sh.cutAt)}, ${tr.en}` + (framing ? ` ${framing}` : "")));
        } else if (framing) {
            bits.push(`The opening shot is ${framing}.`);
        }
        if (sh.description?.trim()) bits.push(period(R(sh.description.trim())));
        const cam = cameraSentence(sh);
        if (cam) bits.push(cam);
        for (const b of sh.beats || []) {
            const s2 = beatSentence(b, script, plan);
            if (s2) bits.push(s2);
        }
        for (const ln of sh.lines || []) {
            if (!ln.text?.trim()) continue;
            const mode = VOICE_MODES.find((x) => x.id === ln.mode) || VOICE_MODES[0];
            const p = plan[ln.entityId];
            const who = p ? p.label : "the character";
            const sid = p?.speaker ? ` (${p.speaker})` : "";
            const vToken = p && mediaTokens[p.ent.voiceKey];
            const lang = p?.ent.language?.trim() || script.language;
            bits.push(`${who}${sid} speaks` +
                      (vToken ? ` using the voice timbre and delivery referenced from ${vToken},` : "") +
                      ` ${mode.en}` + (ln.delivery ? `, ${ln.delivery}` : "") +
                      `: <d>[${lang}] ${dialogueBody(ln.text, ln.continuity)}</d>`);
        }
        body.push(bits.join(" "));
    });
    if (body.length) S.push("detailed_description: " + body.join("\n\n"));

    S.push("overall_soundscape: " + (script.sections.overall_soundscape?.trim()
        ? R(script.sections.overall_soundscape.trim()) : "N/A"));
    S.push("non_diegetic_music: " + (script.sections.non_diegetic_music?.trim() || "N/A"));
    return S.join("\n\n");
}

/* ---------------------------------------------------------------- 校验 */

/** 实体层面的问题。没有实体不算错——纯景色片可以只写镜头描述 */
export function entityProblems(script) {
    const out = [];
    const ents = script.entities || [];
    const plan = castPlan(script);
    const seen = new Map();

    ents.forEach((e, i) => {
        const k = ENTITY_KINDS.find((x) => x.id === e.kind) || ENTITY_KINDS[0];
        const who = e.name?.trim() || `第 ${i + 1} 个实体`;
        if (!e.name?.trim()) out.push(`第 ${i + 1} 个实体还没起名字，镜头里就没法 @ 引用它。`);
        else if (seen.has(e.name.trim())) out.push(`实体名「${e.name.trim()}」重复了，@ 引用会指错人。`);
        else seen.set(e.name.trim(), e.id);

        if (!e.desc?.trim() && !(e.bindings || []).some((b) => b.mediaKey) && k.id !== "voice") {
            out.push(`实体「${who}」既没有描述也没绑素材，模型只能瞎编。`);
        }
        for (const b of e.bindings || []) {
            if (!b.mediaKey) continue;
            if (bindingRetention(b) === "attribute_transfer" && !b.transferTo) {
                out.push(`实体「${who}」的绑定是 attribute_transfer，官方要求指定迁移到哪个实体上。`);
            }
        }
        if (e.voiceKey) {
            if (!plan[e.id].speaker) out.push(`实体「${who}」指定了音色但一句台词都没有，这条音色不会生效。`);
            if (!k.canSpeak) out.push(`实体「${who}」是「${k.label}」，绑音色通常没意义。`);
        }
    });

    const byVoice = {};
    for (const e of ents) if (e.voiceKey) (byVoice[e.voiceKey] ||= []).push(e.name?.trim() || "未命名");
    for (const names of Object.values(byVoice)) {
        if (names.length > 1) out.push(`同一条音色素材同时绑给了 ${names.join("、")}，会是同一把嗓子。`);
    }

    const speaking = Object.values(plan).filter((p) => p.speaker).length;
    if (speaking > 4) out.push(`共 ${speaking} 个实体有台词，(S1)…(S${speaking}) 越多越容易串音，建议压到 4 个以内。`);
    return out;
}

export function validate(script) {
    const out = [];
    const shots = script.shots || [];
    const ids = new Set((script.entities || []).map((e) => e.id));
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
            if (!ln.entityId || !ids.has(ln.entityId)) out.push(`镜头 ${i + 1} 有台词没指定说话人。`);
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
        if (!sh.description?.trim() && !(sh.beats || []).length) {
            out.push(`镜头 ${i + 1} 既没有画面描述也没有变更。`);
        }
        // @ 引用对不上
        const texts = [sh.description, ...(sh.beats || []).map((b) => b.text)];
        for (const t of texts) {
            for (const bad of danglingRefs(t, script)) {
                out.push(`镜头 ${i + 1} 引用了不存在的实体「@${bad}」。`);
            }
        }
        // 变更缺角色
        (sh.beats || []).forEach((b, j) => {
            const k = BEAT_KINDS.find((x) => x.id === b.kind);
            if (!k) return;
            if (k.id === "custom") {
                if (!b.text?.trim()) out.push(`镜头 ${i + 1} 的第 ${j + 1} 条变更是自定义但内容为空。`);
                return;
            }
            const miss = k.needs.filter((f) => !b[f] || !ids.has(b[f]));
            if (miss.length) {
                const zh = { actor: "发起者", target: "对象", recipient: "接受者" };
                out.push(`镜头 ${i + 1} 的第 ${j + 1} 条变更「${k.label}」还缺 ${miss.map((f) => zh[f]).join("、")}。`);
            }
        });
    });
    if (totalSpeech > script.duration * 0.62) {
        out.push(`台词共约 ${totalSpeech.toFixed(1)}s，占全片 ${Math.round(totalSpeech / script.duration * 100)}%，` +
                 `留给动作和留白的时间过少（建议不超过 60%）。`);
    }

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
    out.push(...entityProblems(script));
    return out;
}

export { SECTIONS_REF as SECTIONS, SECTIONS_BASE, STYLE_FIELD, CAMERA_ANGLES,
         CONTINUITY, VISUAL_RETENTION, AUDIO_RETENTION, TASK_TYPES,
         ENTITY_KINDS, BEAT_KINDS, MEDIA_ROLES,
         CAMERA_MOTIONS, CAMERA_AMPLITUDE, CAMERA_SPEED,
         SHOT_SIZES, TRANSITIONS, VOICE_MODES, DELIVERY_PRESETS, LANGUAGES,
         SPEECH, spokenChars, speechSeconds, ts };
