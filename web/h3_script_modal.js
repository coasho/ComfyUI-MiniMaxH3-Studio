/**
 * 剧本编辑弹窗：分镜卡 + 台词子卡 + 卡上媒体选择 + 实时校验。
 * 使用者只填内容；H3 语法在生成时由 assemble() 补全。
 */

import {
    assemble, validate, blankScript, blankShot, blankLine, SCRIPT_PROP,
    SECTIONS, MEDIA_ROLES, CAMERA_MOTIONS, CAMERA_AMPLITUDE, CAMERA_SPEED,
    SHOT_SIZES, TRANSITIONS, VOICE_MODES, DELIVERY_PRESETS, LANGUAGES, ts,
} from "./h3_script_editor.js";
import { spokenChars, speechSeconds, SPEECH } from "./h3_grammar.js";

const CSS = `
.h3sm-mask{position:fixed;inset:0;background:rgba(0,0,0,.62);z-index:10000;display:flex;
  align-items:center;justify-content:center;backdrop-filter:blur(2px)}
.h3sm{background:#23252b;color:#e6e6e6;width:min(1180px,94vw);height:min(860px,92vh);
  border-radius:12px;display:flex;flex-direction:column;box-shadow:0 18px 60px rgba(0,0,0,.55);
  font:13px/1.55 system-ui,"Segoe UI","Microsoft YaHei",sans-serif;overflow:hidden}
.h3sm-hd{display:flex;align-items:center;gap:14px;padding:12px 16px;background:#1b1d22;
  border-bottom:1px solid #34373f;flex:0 0 auto}
.h3sm-hd h2{margin:0;font-size:15px;font-weight:600}
.h3sm-hd .sp{flex:1}
.h3sm-body{flex:1;overflow:auto;padding:14px 16px 20px}
.h3sm-ft{flex:0 0 auto;border-top:1px solid #34373f;background:#1b1d22;padding:10px 16px;
  display:flex;gap:10px;align-items:center}
.h3sm-btn{background:#3a3f4b;border:1px solid #4a5060;color:#e6e6e6;border-radius:6px;
  padding:6px 13px;cursor:pointer;font-size:13px}
.h3sm-btn:hover{background:#464d5c}
.h3sm-btn.pri{background:#2f6feb;border-color:#3b7ff5}
.h3sm-btn.pri:hover{background:#3b7ff5}
.h3sm-btn.dim{background:transparent;border-color:#4a5060;color:#9aa0ab}
.h3sm-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
.h3sm-lab{color:#9aa0ab;font-size:12px;min-width:56px}
.h3sm input,.h3sm select,.h3sm textarea{background:#2c2f37;border:1px solid #414652;
  color:#e6e6e6;border-radius:5px;padding:5px 8px;font:inherit;outline:none}
.h3sm input:focus,.h3sm select:focus,.h3sm textarea:focus{border-color:#3b7ff5}
.h3sm textarea{width:100%;resize:vertical;min-height:52px;line-height:1.6}
.h3sm-sec{border:1px solid #34373f;border-radius:9px;padding:11px 13px;margin-bottom:12px;background:#26282f}
.h3sm-sec>h3{margin:0 0 4px;font-size:13px;font-weight:600;color:#cfd3da}
.h3sm-hint{color:#7f8794;font-size:11.5px;margin-bottom:7px;line-height:1.5}
.h3sm-shot{border:1px solid #3a3f4b;border-left:3px solid #3b7ff5;border-radius:9px;
  padding:11px 13px;margin-bottom:11px;background:#282b33}
.h3sm-shot.bad{border-left-color:#e05a5a}
.h3sm-shot-hd{display:flex;align-items:center;gap:9px;margin-bottom:9px;flex-wrap:wrap}
.h3sm-no{background:#3b7ff5;color:#fff;border-radius:5px;padding:1px 8px;font-weight:600;font-size:12px}
.h3sm-line{border:1px solid #414652;border-radius:7px;padding:9px 10px;margin:7px 0 0;background:#2e313a}
.h3sm-line-hd{display:flex;gap:8px;align-items:center;margin-bottom:6px;flex-wrap:wrap}
.h3sm-chip{display:inline-flex;align-items:center;gap:5px;background:#333845;border:1px solid #454b5a;
  border-radius:20px;padding:2px 9px 2px 3px;font-size:11.5px;cursor:pointer;user-select:none}
.h3sm-chip.on{background:#26406e;border-color:#3b7ff5}
.h3sm-chip img{width:22px;height:22px;border-radius:50%;object-fit:cover}
.h3sm-chip .ic{width:22px;height:22px;border-radius:50%;background:#454b5a;display:grid;
  place-items:center;font-size:11px}
.h3sm-warn{background:#3a2626;border:1px solid #6b3636;color:#ffb4b4;border-radius:7px;
  padding:8px 11px;margin:9px 0;font-size:12px;line-height:1.6}
.h3sm-ok{background:#22321f;border:1px solid #3d5c35;color:#a9d69a}
.h3sm-tl{display:flex;height:26px;border-radius:5px;overflow:hidden;margin:6px 0 12px;border:1px solid #414652}
.h3sm-tl div{display:grid;place-items:center;font-size:11px;color:#dfe3ea;border-right:1px solid #23252b;
  overflow:hidden;white-space:nowrap}
.h3sm-mini{color:#7f8794;font-size:11px}
`;

let styled = false;
function ensureStyle() {
    if (styled) return;
    const s = document.createElement("style");
    s.textContent = CSS;
    document.head.append(s);
    styled = true;
}

const E = (tag, cls, txt) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (txt != null) el.textContent = txt;
    return el;
};

function dropdown(opts, value, onChange, width) {
    const s = E("select");
    for (const o of opts) {
        const op = E("option");
        op.value = typeof o === "string" ? o : o.id;
        op.textContent = typeof o === "string" ? o : o.label;
        s.append(op);
    }
    s.value = value ?? "";
    if (width) s.style.width = width;
    s.addEventListener("change", () => onChange(s.value));
    return s;
}

/** 可编辑下拉：能选预设也能自己写 */
function comboBox(presets, value, onChange, width = "230px") {
    const wrap = E("span");
    wrap.style.display = "inline-flex";
    const inp = E("input");
    inp.value = value || "";
    inp.style.width = width;
    inp.style.borderTopRightRadius = inp.style.borderBottomRightRadius = "0";
    inp.addEventListener("input", () => onChange(inp.value));
    const sel = E("select");
    sel.style.width = "26px";
    sel.style.borderTopLeftRadius = sel.style.borderBottomLeftRadius = "0";
    sel.style.borderLeft = "none";
    sel.append(E("option"));
    for (const p of presets) {
        const o = E("option");
        o.value = p; o.textContent = p;
        sel.append(o);
    }
    sel.addEventListener("change", () => {
        if (!sel.value) return;
        inp.value = sel.value; onChange(sel.value); sel.value = "";
    });
    wrap.append(inp, sel);
    return wrap;
}

/**
 * @param {object} node       MiniMaxH3Easy 节点
 * @param {Array}  mediaList  [{key,label,kind,previewUrl}]  已连接的素材
 */
export function openScriptModal(node, mediaList, onSave) {
    ensureStyle();
    const script = structuredClone(node.properties?.[SCRIPT_PROP] || blankScript());
    script.shots ||= [];
    script.media ||= {};
    script.sections ||= {};
    script.notRetained ||= [];

    const mask = E("div", "h3sm-mask");
    const box = E("div", "h3sm");
    const hd = E("div", "h3sm-hd");
    hd.append(E("h2", null, "剧本编辑器"));

    const dur = E("input"); dur.type = "number"; dur.step = "0.5"; dur.min = "4"; dur.max = "20";
    dur.value = script.duration; dur.style.width = "68px";
    dur.addEventListener("input", () => { script.duration = parseFloat(dur.value) || 15; refresh(); });
    hd.append(E("span", "h3sm-lab", "总时长"), dur, E("span", "h3sm-mini", "秒"));

    const spk = E("input"); spk.value = script.speaker || ""; spk.style.width = "90px";
    spk.placeholder = "说话人";
    spk.addEventListener("input", () => { script.speaker = spk.value; });
    hd.append(E("span", "h3sm-lab", "说话人"), spk);
    hd.append(E("span", "h3sm-lab", "语言"),
        dropdown(LANGUAGES, script.language || "Chinese", (v) => { script.language = v; }, "110px"));
    hd.append(E("div", "sp"));
    const close = E("button", "h3sm-btn dim", "✕");
    close.onclick = () => mask.remove();
    hd.append(close);

    const body = E("div", "h3sm-body");
    const ft = E("div", "h3sm-ft");
    const status = E("div", "h3sm-mini");
    const addShot = E("button", "h3sm-btn", "+ 新增分镜");
    addShot.onclick = () => {
        const last = script.shots.at(-1);
        const t = last ? Math.min(script.duration - 0.5, last.cutAt + 3) : 0;
        script.shots.push(blankShot(script.shots.length ? +t.toFixed(2) : 0));
        refresh();
    };
    const save = E("button", "h3sm-btn pri", "保存并应用");
    save.onclick = () => { onSave(structuredClone(script)); mask.remove(); };
    ft.append(addShot, E("div", "sp"), status, save);
    ft.querySelector(".sp").style.flex = "1";

    box.append(hd, body, ft);
    mask.append(box);
    mask.addEventListener("mousedown", (e) => { if (e.target === mask) mask.remove(); });
    document.body.append(mask);

    /* ---------------------------------------------------------- 媒体选择器 */
    function mediaPicker(selected, onToggle, kinds = ["image", "video"]) {
        const wrap = E("div");
        wrap.style.display = "flex";
        wrap.style.flexWrap = "wrap";
        wrap.style.gap = "6px";
        const usable = mediaList.filter((m) => kinds.includes(m.kind));
        if (!usable.length) {
            wrap.append(E("span", "h3sm-mini", "（还没有连接素材到节点的 media 口）"));
            return wrap;
        }
        for (const m of usable) {
            const chip = E("span", "h3sm-chip" + (selected.includes(m.key) ? " on" : ""));
            if (m.previewUrl && m.kind === "image") {
                const img = E("img"); img.src = m.previewUrl; chip.append(img);
            } else {
                chip.append(E("span", "ic", m.kind === "audio" ? "♪" : m.kind === "video" ? "▶" : "🖼"));
            }
            chip.append(E("span", null, m.label));
            chip.onclick = () => { onToggle(m.key); refresh(); };
            wrap.append(chip);
        }
        return wrap;
    }

    /* --------------------------------------------------------------- 渲染 */
    function refresh() {
        body.innerHTML = "";

        // 素材用途
        const msec = E("div", "h3sm-sec");
        msec.append(E("h3", null, "素材用途"));
        msec.append(E("div", "h3sm-hint",
            "指定每个素材做什么用。生成时会自动编号成 <Picture 1>/<Audio 1>… 并写进保留声明，你不用管编号。"));
        if (!mediaList.length) {
            msec.append(E("div", "h3sm-mini", "还没有素材。把 LoadImage / TTS 之类接到节点的 media 口即可。"));
        }
        for (const m of mediaList) {
            const r = E("div", "h3sm-row");
            const chip = E("span", "h3sm-chip on");
            if (m.previewUrl && m.kind === "image") {
                const img = E("img"); img.src = m.previewUrl; chip.append(img);
            } else chip.append(E("span", "ic", m.kind === "audio" ? "♪" : m.kind === "video" ? "▶" : "🖼"));
            chip.append(E("span", null, m.label));
            r.append(chip);
            const cfg = (script.media[m.key] ||= { kind: m.kind, role: "" });
            cfg.kind = m.kind;
            const roles = MEDIA_ROLES[m.kind] || [];
            r.append(dropdown([{ id: "", label: "（不使用）" }, ...roles], cfg.role,
                (v) => { cfg.role = v; refresh(); }, "230px"));
            const note = E("input");
            note.placeholder = "补充说明（可留空）";
            note.style.flex = "1"; note.style.minWidth = "180px";
            note.value = cfg.note || "";
            note.addEventListener("input", () => { cfg.note = note.value; });
            r.append(note);
            msec.append(r);
        }
        body.append(msec);

        // 文字段落
        for (const s of SECTIONS) {
            if (s.auto) continue;
            const sec = E("div", "h3sm-sec");
            sec.append(E("h3", null, s.label + (s.required ? "" : "（可选）")));
            sec.append(E("div", "h3sm-hint", s.hint));
            const ta = E("textarea");
            ta.value = script.sections[s.key] || "";
            ta.addEventListener("input", () => { script.sections[s.key] = ta.value; runCheck(); });
            sec.append(ta);
            body.append(sec);
        }

        // 不保留项
        const nr = E("div", "h3sm-sec");
        nr.append(E("h3", null, "不保留的内容"));
        nr.append(E("div", "h3sm-hint",
            "用三视图/设定稿当参考时，务必写上白底和 T-pose，否则会被一起搬进画面。"));
        const nrRow = E("div", "h3sm-row");
        const nrIn = E("input");
        nrIn.placeholder = "例如：参考图的白色背景";
        nrIn.style.flex = "1";
        const nrAdd = E("button", "h3sm-btn", "+ 添加");
        nrAdd.onclick = () => { if (nrIn.value.trim()) { script.notRetained.push(nrIn.value.trim()); refresh(); } };
        nrRow.append(nrIn, nrAdd);
        nr.append(nrRow);
        const nrList = E("div", "h3sm-row");
        script.notRetained.forEach((t, i) => {
            const c = E("span", "h3sm-chip on");
            c.append(E("span", null, t + "  ✕"));
            c.onclick = () => { script.notRetained.splice(i, 1); refresh(); };
            nrList.append(c);
        });
        nr.append(nrList);
        body.append(nr);

        // 时间轴
        if (script.shots.length) {
            const tl = E("div", "h3sm-tl");
            script.shots.forEach((sh, i) => {
                const end = i + 1 < script.shots.length ? script.shots[i + 1].cutAt : script.duration;
                const span = Math.max(0.01, end - sh.cutAt);
                const d = E("div", null, `${i + 1} · ${span.toFixed(1)}s`);
                d.style.flex = String(span);
                d.style.background = i % 2 ? "#333947" : "#3b4252";
                tl.append(d);
            });
            body.append(E("div", "h3sm-lab", "时间轴"), tl);
        }

        // 分镜卡
        script.shots.forEach((sh, i) => body.append(shotCard(sh, i)));
        if (!script.shots.length) {
            body.append(E("div", "h3sm-mini", "还没有分镜。点左下「+ 新增分镜」开始。"));
        }
        runCheck();
    }

    function shotCard(sh, i) {
        const card = E("div", "h3sm-shot");
        const hdr = E("div", "h3sm-shot-hd");
        hdr.append(E("span", "h3sm-no", "镜头 " + (i + 1)));

        const t = E("input"); t.type = "number"; t.step = "0.1"; t.min = "0";
        t.value = sh.cutAt; t.style.width = "72px";
        t.disabled = i === 0;
        t.addEventListener("input", () => { sh.cutAt = parseFloat(t.value) || 0; refresh(); });
        hdr.append(E("span", "h3sm-lab", "起点"), t, E("span", "h3sm-mini", "秒"));

        if (i > 0) hdr.append(dropdown(TRANSITIONS, sh.transition, (v) => { sh.transition = v; }, "96px"));
        hdr.append(E("span", "h3sm-lab", "景别"),
            dropdown(SHOT_SIZES, sh.size, (v) => { sh.size = v; refresh(); }, "170px"));
        hdr.append(E("span", "h3sm-lab", "运镜"),
            dropdown(CAMERA_MOTIONS, sh.motion, (v) => { sh.motion = v; refresh(); }, "120px"),
            dropdown(CAMERA_AMPLITUDE, sh.amplitude, (v) => { sh.amplitude = v; }, "96px"),
            dropdown(CAMERA_SPEED, sh.speed, (v) => { sh.speed = v; }, "96px"));

        const sp = E("div"); sp.style.flex = "1"; hdr.append(sp);
        const up = E("button", "h3sm-btn dim", "↑");
        up.onclick = () => { if (i > 0) { const c = script.shots[i - 1].cutAt; script.shots[i - 1].cutAt = sh.cutAt; sh.cutAt = c; [script.shots[i - 1], script.shots[i]] = [script.shots[i], script.shots[i - 1]]; refresh(); } };
        const del = E("button", "h3sm-btn dim", "删除");
        del.onclick = () => { script.shots.splice(i, 1); refresh(); };
        hdr.append(up, del);
        card.append(hdr);

        const ta = E("textarea");
        ta.placeholder = "这一镜画面里发生什么？直接写，不用管语法。";
        ta.value = sh.description || "";
        ta.addEventListener("input", () => { sh.description = ta.value; runCheck(); });
        card.append(ta);

        card.append(E("div", "h3sm-lab", "本镜引用"));
        card.append(mediaPicker(sh.refs, (k) => {
            const p = sh.refs.indexOf(k);
            if (p >= 0) sh.refs.splice(p, 1); else sh.refs.push(k);
        }));

        sh.lines.forEach((ln, j) => card.append(lineCard(sh, ln, j)));
        const addLine = E("button", "h3sm-btn", "+ 台词");
        addLine.style.marginTop = "8px";
        addLine.onclick = () => { sh.lines.push(blankLine()); refresh(); };
        card.append(addLine);

        const end = i + 1 < script.shots.length ? script.shots[i + 1].cutAt : script.duration;
        const span = end - sh.cutAt;
        let need = 0;
        for (const ln of sh.lines) if (ln.text?.trim()) need += SPEECH.padBefore + speechSeconds(ln.text) + SPEECH.padAfter;
        if (sh.lines.length) {
            const bar = E("div", "h3sm-mini");
            bar.textContent = `本镜 ${span.toFixed(1)}s，台词含留白约需 ${need.toFixed(1)}s` +
                (need > span ? "  ← 放不下" : "");
            bar.style.marginTop = "6px";
            if (need > span) { bar.style.color = "#ff9a9a"; card.classList.add("bad"); }
            card.append(bar);
        }
        return card;
    }

    function lineCard(sh, ln, j) {
        const c = E("div", "h3sm-line");
        const h = E("div", "h3sm-line-hd");
        h.append(E("span", "h3sm-lab", "台词 " + (j + 1)));
        h.append(dropdown(VOICE_MODES, ln.mode, (v) => { ln.mode = v; }, "170px"));
        h.append(E("span", "h3sm-lab", "语气"), comboBox(DELIVERY_PRESETS, ln.delivery, (v) => { ln.delivery = v; }));
        const sp = E("div"); sp.style.flex = "1"; h.append(sp);
        const n = E("span", "h3sm-mini", `${spokenChars(ln.text)} 字 · ${speechSeconds(ln.text).toFixed(1)}s`);
        h.append(n);
        const d = E("button", "h3sm-btn dim", "删");
        d.onclick = () => { sh.lines.splice(j, 1); refresh(); };
        h.append(d);
        c.append(h);

        const inp = E("textarea");
        inp.style.minHeight = "38px";
        inp.placeholder = "说什么？只写内容，语种标签和 <d> 会自动加。";
        inp.value = ln.text || "";
        inp.addEventListener("input", () => {
            ln.text = inp.value;
            n.textContent = `${spokenChars(ln.text)} 字 · ${speechSeconds(ln.text).toFixed(1)}s`;
            runCheck();
        });
        c.append(inp);

        const audio = mediaList.filter((m) => m.kind === "audio");
        if (audio.length) {
            const r = E("div", "h3sm-row");
            r.style.marginTop = "6px";
            r.append(E("span", "h3sm-lab", "音色"));
            r.append(dropdown([{ id: "", label: "（跟随全局）" },
                ...audio.map((m) => ({ id: m.key, label: m.label }))],
                ln.voiceRef, (v) => { ln.voiceRef = v; }, "200px"));
            c.append(r);
        }
        return c;
    }

    function runCheck() {
        const probs = validate(script);
        let bar = body.querySelector(".h3sm-checkbar");
        if (bar) bar.remove();
        bar = E("div", "h3sm-warn h3sm-checkbar" + (probs.length ? "" : " h3sm-ok"));
        bar.textContent = probs.length ? "" : "✅ 没有发现问题";
        if (probs.length) {
            bar.append(E("div", null, `⚠ ${probs.length} 个问题：`));
            probs.forEach((p, i) => bar.append(E("div", null, `${i + 1}. ${p}`)));
        }
        body.prepend(bar);
        status.textContent = probs.length ? `${probs.length} 个问题待处理` : "校验通过";
        status.style.color = probs.length ? "#ff9a9a" : "#a9d69a";
    }

    refresh();
    return mask;
}

export { assemble, blankScript, SCRIPT_PROP };
