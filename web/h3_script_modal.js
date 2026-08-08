/**
 * 剧本编辑弹窗（左右分栏）。
 *
 * 左栏 = 导航：全局设置入口、时间轴、分镜列表（带问题角标）
 * 右栏 = 当前选中项的编辑区
 *
 * 使用者只填内容；六段式、时间码、<d> 标签、<Picture N> 编号在生成时由 assemble() 补全。
 */

import {
    assemble, validate, blankScript, blankShot, blankLine, SCRIPT_PROP,
    SECTIONS, MEDIA_ROLES, CAMERA_MOTIONS, CAMERA_AMPLITUDE, CAMERA_SPEED,
    SHOT_SIZES, TRANSITIONS, VOICE_MODES, DELIVERY_PRESETS, LANGUAGES,
} from "./h3_script_editor.js";
import { spokenChars, speechSeconds, SPEECH, framingWarning } from "./h3_grammar.js";

const CSS = `
.h3m-mask{position:fixed;inset:0;background:rgba(8,9,12,.72);z-index:10000;display:flex;
  align-items:center;justify-content:center;backdrop-filter:blur(3px)}
.h3m{--bg:#1e2027;--bg2:#252831;--bg3:#2d313c;--line:#363b47;--txt:#e8eaee;--dim:#8b93a1;
  --accent:#4d8dff;--warn:#ff7a7a;--ok:#67c98a;
  background:var(--bg);color:var(--txt);width:min(1240px,95vw);height:min(880px,93vh);
  border-radius:14px;display:flex;flex-direction:column;overflow:hidden;
  box-shadow:0 24px 70px rgba(0,0,0,.6);border:1px solid var(--line);
  font:13.5px/1.6 system-ui,"Segoe UI","Microsoft YaHei",sans-serif}
.h3m *{box-sizing:border-box}
.h3m-hd{display:flex;align-items:center;gap:16px;padding:13px 18px;background:var(--bg2);
  border-bottom:1px solid var(--line);flex:0 0 auto}
.h3m-hd h2{margin:0;font-size:15px;font-weight:600;letter-spacing:.3px}
.h3m-main{flex:1;display:flex;min-height:0}
.h3m-rail{width:246px;flex:0 0 auto;border-right:1px solid var(--line);background:var(--bg2);
  display:flex;flex-direction:column;min-height:0}
.h3m-rail-top{padding:12px 12px 8px;flex:0 0 auto}
.h3m-rail-list{flex:1;overflow:auto;padding:0 10px 12px}
.h3m-rail-ft{flex:0 0 auto;padding:10px 12px;border-top:1px solid var(--line)}
.h3m-pane{flex:1;overflow:auto;padding:18px 22px 28px;min-width:0}
.h3m-ft{flex:0 0 auto;border-top:1px solid var(--line);background:var(--bg2);
  padding:11px 18px;display:flex;gap:12px;align-items:center}
.h3m-nav{display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:8px;
  cursor:pointer;margin-bottom:4px;border:1px solid transparent;user-select:none}
.h3m-nav:hover{background:var(--bg3)}
.h3m-nav.on{background:#25406e;border-color:var(--accent)}
.h3m-nav .n{background:var(--bg3);border-radius:5px;min-width:22px;text-align:center;
  font-size:11.5px;padding:1px 5px;color:var(--dim)}
.h3m-nav.on .n{background:var(--accent);color:#fff}
.h3m-nav .t{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px}
.h3m-nav .b{color:var(--warn);font-size:12px}
.h3m-tl{display:flex;height:30px;border-radius:6px;overflow:hidden;border:1px solid var(--line);margin-bottom:10px}
.h3m-tl>div{display:grid;place-items:center;font-size:10.5px;color:#cfd5e0;cursor:pointer;
  border-right:1px solid var(--bg);overflow:hidden;white-space:nowrap;transition:filter .12s}
.h3m-tl>div:hover{filter:brightness(1.35)}
.h3m-tl>div.on{outline:2px solid var(--accent);outline-offset:-2px}
.h3m h3{margin:0 0 5px;font-size:13.5px;font-weight:600}
.h3m-hint{color:var(--dim);font-size:11.5px;line-height:1.55;margin-bottom:9px}
.h3m-fld{margin-bottom:16px}
.h3m-row{display:flex;gap:9px;align-items:center;flex-wrap:wrap}
.h3m-lab{color:var(--dim);font-size:11.5px}
.h3m input,.h3m select,.h3m textarea{background:var(--bg3);border:1px solid var(--line);
  color:var(--txt);border-radius:6px;padding:6px 9px;font:inherit;outline:none;max-width:100%}
.h3m input:focus,.h3m select:focus,.h3m textarea:focus{border-color:var(--accent)}
.h3m textarea{width:100%;resize:vertical;min-height:76px}
.h3m-btn{background:var(--bg3);border:1px solid var(--line);color:var(--txt);border-radius:7px;
  padding:6px 14px;cursor:pointer;font:inherit}
.h3m-btn:hover{background:#39404e}
.h3m-btn.pri{background:var(--accent);border-color:#5c99ff}
.h3m-btn.pri:hover{filter:brightness(1.1)}
.h3m-btn.gh{background:transparent;color:var(--dim)}
.h3m-btn.full{width:100%}
.h3m-line{border:1px solid var(--line);border-radius:9px;padding:11px 12px;margin-bottom:9px;background:var(--bg2)}
.h3m-line-hd{display:flex;gap:9px;align-items:center;margin-bottom:8px;flex-wrap:wrap}
.h3m-chip{display:inline-flex;align-items:center;gap:6px;background:var(--bg3);border:1px solid var(--line);
  border-radius:22px;padding:3px 11px 3px 3px;font-size:12px;cursor:pointer;user-select:none}
.h3m-chip:hover{border-color:#4a5262}
.h3m-chip.on{background:#25406e;border-color:var(--accent)}
.h3m-chip img{width:24px;height:24px;border-radius:50%;object-fit:cover}
.h3m-chip .ic{width:24px;height:24px;border-radius:50%;background:#454b5a;display:grid;place-items:center;font-size:12px}
.h3m-note{border-radius:8px;padding:9px 12px;font-size:12px;line-height:1.65;margin-bottom:12px}
.h3m-note.warn{background:#3a2424;border:1px solid #6e3636;color:#ffb8b8}
.h3m-note.ok{background:#1f3226;border:1px solid #35603f;color:#a5dcb6}
.h3m-mini{color:var(--dim);font-size:11.5px}
.h3m-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:9px}
.h3m-grid label{display:flex;flex-direction:column;gap:4px}
.h3m-grid label>span{color:var(--dim);font-size:11.5px}
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

function dd(opts, value, onChange) {
    const s = E("select");
    for (const o of opts) {
        const op = E("option");
        op.value = typeof o === "string" ? o : o.id;
        op.textContent = typeof o === "string" ? o : o.label;
        s.append(op);
    }
    s.value = value ?? "";
    s.addEventListener("change", () => onChange(s.value));
    return s;
}

function labeled(text, el) {
    const l = E("label");
    l.append(E("span", null, text), el);
    return l;
}

/** 可编辑下拉：选预设或自己写 */
function combo(presets, value, onChange) {
    const wrap = E("span");
    wrap.style.cssText = "display:inline-flex;flex:1;min-width:200px";
    const inp = E("input");
    inp.value = value || "";
    inp.style.cssText = "flex:1;border-top-right-radius:0;border-bottom-right-radius:0";
    inp.addEventListener("input", () => onChange(inp.value));
    const sel = E("select");
    sel.style.cssText = "width:30px;border-top-left-radius:0;border-bottom-left-radius:0;border-left:none";
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

export function openScriptModal(node, mediaList, onSave) {
    ensureStyle();
    const S = structuredClone(node.properties?.[SCRIPT_PROP] || blankScript());
    S.shots ||= []; S.media ||= {}; S.sections ||= {}; S.notRetained ||= [];
    let sel = S.shots.length ? 0 : "global";     // 当前选中：'global' 或分镜下标

    const mask = E("div", "h3m-mask");
    const box = E("div", "h3m");

    /* -------------------------------------------------------------- 顶栏 */
    const hd = E("div", "h3m-hd");
    hd.append(E("h2", null, "剧本编辑器"));
    const dur = E("input");
    dur.type = "number"; dur.step = "0.5"; dur.min = "4"; dur.max = "20";
    dur.value = S.duration; dur.style.width = "74px";
    dur.addEventListener("input", () => { S.duration = parseFloat(dur.value) || 15; draw(); });
    hd.append(E("span", "h3m-lab", "总时长"), dur, E("span", "h3m-mini", "秒"));
    const spk = E("input");
    spk.value = S.speaker || ""; spk.style.width = "96px"; spk.placeholder = "少女";
    spk.addEventListener("input", () => { S.speaker = spk.value; });
    hd.append(E("span", "h3m-lab", "说话人"), spk);
    hd.append(E("span", "h3m-lab", "语言"), dd(LANGUAGES, S.language || "Chinese", (v) => { S.language = v; }));
    const sp0 = E("div"); sp0.style.flex = "1"; hd.append(sp0);
    const x = E("button", "h3m-btn gh", "✕");
    x.onclick = () => mask.remove();
    hd.append(x);

    /* ------------------------------------------------------------ 主体 */
    const main = E("div", "h3m-main");
    const rail = E("div", "h3m-rail");
    const railTop = E("div", "h3m-rail-top");
    const railList = E("div", "h3m-rail-list");
    const railFt = E("div", "h3m-rail-ft");
    const addBtn = E("button", "h3m-btn full", "+ 新增分镜");
    addBtn.onclick = () => {
        const last = S.shots.at(-1);
        const t = last ? Math.min(S.duration - 0.5, last.cutAt + 3) : 0;
        S.shots.push(blankShot(S.shots.length ? +t.toFixed(2) : 0));
        sel = S.shots.length - 1;
        draw();
    };
    railFt.append(addBtn);
    rail.append(railTop, railList, railFt);
    const pane = E("div", "h3m-pane");
    main.append(rail, pane);

    /* ------------------------------------------------------------ 底栏 */
    const ft = E("div", "h3m-ft");
    const stat = E("div", "h3m-mini");
    const sp1 = E("div"); sp1.style.flex = "1";
    const cancel = E("button", "h3m-btn gh", "取消");
    cancel.onclick = () => mask.remove();
    const ok = E("button", "h3m-btn pri", "保存并应用");
    ok.onclick = () => { onSave(structuredClone(S)); mask.remove(); };
    ft.append(stat, sp1, cancel, ok);

    box.append(hd, main, ft);
    mask.append(box);
    mask.addEventListener("mousedown", (e) => { if (e.target === mask) mask.remove(); });
    document.body.append(mask);

    /* ------------------------------------------------------- 素材选择器 */
    function picker(selected, toggle, kinds) {
        const w = E("div", "h3m-row");
        const list = mediaList.filter((m) => kinds.includes(m.kind));
        if (!list.length) {
            w.append(E("span", "h3m-mini", "还没有素材连到节点的 media 口"));
            return w;
        }
        for (const m of list) {
            const c = E("span", "h3m-chip" + (selected.includes(m.key) ? " on" : ""));
            if (m.previewUrl && m.kind === "image") {
                const i = E("img"); i.src = m.previewUrl; c.append(i);
            } else c.append(E("span", "ic", m.kind === "audio" ? "♪" : m.kind === "video" ? "▶" : "🖼"));
            c.append(E("span", null, m.label));
            c.onclick = () => { toggle(m.key); draw(); };
            w.append(c);
        }
        return w;
    }

    const shotEnd = (i) => (i + 1 < S.shots.length ? S.shots[i + 1].cutAt : S.duration);

    function shotProblems(i) {
        const sh = S.shots[i];
        const out = [];
        const span = shotEnd(i) - sh.cutAt;
        let need = 0;
        for (const l of sh.lines) if (l.text?.trim()) need += SPEECH.padBefore + speechSeconds(l.text) + SPEECH.padAfter;
        if (need > span) out.push(`台词需 ${need.toFixed(1)}s，本镜只有 ${span.toFixed(1)}s`);
        const fw = framingWarning(sh);
        if (fw) out.push(fw);
        if (!sh.description?.trim()) out.push("还没有画面描述");
        return out;
    }

    /* ----------------------------------------------------------- 绘制 */
    function draw() {
        // 左栏：时间轴
        railTop.innerHTML = "";
        railTop.append(E("div", "h3m-lab", "时间轴"));
        if (S.shots.length) {
            const tl = E("div", "h3m-tl");
            S.shots.forEach((sh, i) => {
                const span = Math.max(0.01, shotEnd(i) - sh.cutAt);
                const d = E("div", sel === i ? "on" : null, `${i + 1}`);
                d.style.flex = String(span);
                d.style.background = shotProblems(i).length ? "#5c3030" : (i % 2 ? "#333b4a" : "#3c4557");
                d.title = `镜头 ${i + 1}：${sh.cutAt.toFixed(1)}–${shotEnd(i).toFixed(1)}s`;
                d.onclick = () => { sel = i; draw(); };
                tl.append(d);
            });
            railTop.append(tl);
        } else railTop.append(E("div", "h3m-mini", "尚无分镜"));

        // 左栏：导航
        railList.innerHTML = "";
        const g = E("div", "h3m-nav" + (sel === "global" ? " on" : ""));
        g.append(E("span", "n", "◈"), E("span", "t", "全局设置"));
        const gp = globalProblems();
        if (gp.length) g.append(E("span", "b", "●"));
        g.onclick = () => { sel = "global"; draw(); };
        railList.append(g);
        S.shots.forEach((sh, i) => {
            const n = E("div", "h3m-nav" + (sel === i ? " on" : ""));
            n.append(E("span", "n", String(i + 1)));
            const title = (sh.description || "").trim().slice(0, 14) || "（未填描述）";
            n.append(E("span", "t", `${sh.cutAt.toFixed(1)}s  ${title}`));
            if (shotProblems(i).length) n.append(E("span", "b", "●"));
            n.onclick = () => { sel = i; draw(); };
            railList.append(n);
        });

        // 右栏
        pane.innerHTML = "";
        if (sel === "global") drawGlobal(); else drawShot(S.shots[sel], sel);

        const all = validate(S);
        stat.textContent = all.length ? `⚠ ${all.length} 个问题` : "✅ 校验通过";
        stat.style.color = all.length ? "var(--warn)" : "var(--ok)";
    }

    function globalProblems() {
        return SECTIONS.filter((s) => s.required && !s.auto && !S.sections[s.key]?.trim());
    }

    function drawGlobal() {
        // 素材用途
        const f0 = E("div", "h3m-fld");
        f0.append(E("h3", null, "素材用途"));
        f0.append(E("div", "h3m-hint",
            "指定每个素材做什么用。生成时自动编号成 <Picture 1>/<Audio 1> 并写进保留声明，编号不用你管。"));
        if (!mediaList.length) f0.append(E("div", "h3m-mini", "把 LoadImage / TTS 之类接到节点的 media 口即可。"));
        for (const m of mediaList) {
            const r = E("div", "h3m-row");
            r.style.marginBottom = "7px";
            const c = E("span", "h3m-chip on");
            if (m.previewUrl && m.kind === "image") { const i = E("img"); i.src = m.previewUrl; c.append(i); }
            else c.append(E("span", "ic", m.kind === "audio" ? "♪" : m.kind === "video" ? "▶" : "🖼"));
            c.append(E("span", null, m.label));
            r.append(c);
            const cfg = (S.media[m.key] ||= { kind: m.kind, role: "" });
            cfg.kind = m.kind;
            r.append(dd([{ id: "", label: "（不使用）" }, ...(MEDIA_ROLES[m.kind] || [])], cfg.role,
                (v) => { cfg.role = v; draw(); }));
            const note = E("input");
            note.placeholder = "补充说明（可留空）"; note.style.flex = "1"; note.style.minWidth = "160px";
            note.value = cfg.note || "";
            note.addEventListener("input", () => { cfg.note = note.value; });
            r.append(note);
            f0.append(r);
        }
        pane.append(f0);

        // 文字段落
        for (const s of SECTIONS) {
            if (s.auto) continue;
            const f = E("div", "h3m-fld");
            f.append(E("h3", null, s.label + (s.required ? "" : "（可选）")));
            f.append(E("div", "h3m-hint", s.hint));
            const ta = E("textarea");
            ta.value = S.sections[s.key] || "";
            ta.addEventListener("input", () => { S.sections[s.key] = ta.value; });
            ta.addEventListener("change", draw);
            f.append(ta);
            pane.append(f);
        }

        // 不保留
        const f2 = E("div", "h3m-fld");
        f2.append(E("h3", null, "不保留的内容"));
        f2.append(E("div", "h3m-hint",
            "用三视图/设定稿当参考时务必写上白底和 T-pose，否则会被一起搬进画面。"));
        const row = E("div", "h3m-row");
        const inp = E("input");
        inp.placeholder = "例如：参考图的白色背景"; inp.style.flex = "1";
        const add = E("button", "h3m-btn", "+ 添加");
        const doAdd = () => { if (inp.value.trim()) { S.notRetained.push(inp.value.trim()); draw(); } };
        add.onclick = doAdd;
        inp.addEventListener("keydown", (e) => { if (e.key === "Enter") doAdd(); });
        row.append(inp, add);
        f2.append(row);
        const chips = E("div", "h3m-row");
        chips.style.marginTop = "8px";
        S.notRetained.forEach((t, i) => {
            const c = E("span", "h3m-chip on");
            c.append(E("span", null, t + "　✕"));
            c.onclick = () => { S.notRetained.splice(i, 1); draw(); };
            chips.append(c);
        });
        f2.append(chips);
        pane.append(f2);
    }

    function drawShot(sh, i) {
        const probs = shotProblems(i);
        if (probs.length) {
            const n = E("div", "h3m-note warn");
            probs.forEach((p) => n.append(E("div", null, "• " + p)));
            pane.append(n);
        }

        const hdr = E("div", "h3m-row");
        hdr.style.marginBottom = "14px";
        hdr.append(E("h3", null, `镜头 ${i + 1}`));
        const sp = E("div"); sp.style.flex = "1"; hdr.append(sp);
        const span = shotEnd(i) - sh.cutAt;
        hdr.append(E("span", "h3m-mini", `${sh.cutAt.toFixed(1)} – ${shotEnd(i).toFixed(1)}s，共 ${span.toFixed(1)}s`));
        const up = E("button", "h3m-btn gh", "↑");
        up.onclick = () => {
            if (i === 0) return;
            const a = S.shots[i - 1];
            [a.cutAt, sh.cutAt] = [sh.cutAt, a.cutAt];
            S.shots[i - 1] = sh; S.shots[i] = a;
            sel = i - 1; draw();
        };
        const del = E("button", "h3m-btn gh", "删除本镜");
        del.onclick = () => { S.shots.splice(i, 1); sel = Math.max(0, i - 1); if (!S.shots.length) sel = "global"; draw(); };
        hdr.append(up, del);
        pane.append(hdr);

        const grid = E("div", "h3m-grid");
        grid.style.marginBottom = "14px";
        const t = E("input");
        t.type = "number"; t.step = "0.1"; t.min = "0"; t.value = sh.cutAt; t.disabled = i === 0;
        t.addEventListener("input", () => { sh.cutAt = parseFloat(t.value) || 0; draw(); });
        grid.append(labeled("起点（秒）", t));
        if (i > 0) grid.append(labeled("转场", dd(TRANSITIONS, sh.transition, (v) => { sh.transition = v; })));
        grid.append(labeled("景别", dd(SHOT_SIZES, sh.size, (v) => { sh.size = v; draw(); })));
        grid.append(labeled("运镜", dd(CAMERA_MOTIONS, sh.motion, (v) => { sh.motion = v; draw(); })));
        grid.append(labeled("幅度", dd(CAMERA_AMPLITUDE, sh.amplitude, (v) => { sh.amplitude = v; })));
        grid.append(labeled("速度", dd(CAMERA_SPEED, sh.speed, (v) => { sh.speed = v; })));
        pane.append(grid);

        const f = E("div", "h3m-fld");
        f.append(E("h3", null, "画面描述"));
        f.append(E("div", "h3m-hint", "直接写这一镜发生什么，不用管语法。"));
        const ta = E("textarea");
        ta.style.minHeight = "110px";
        ta.value = sh.description || "";
        ta.addEventListener("input", () => { sh.description = ta.value; });
        ta.addEventListener("change", draw);
        f.append(ta);
        pane.append(f);

        const f1 = E("div", "h3m-fld");
        f1.append(E("h3", null, "本镜引用素材"));
        f1.append(picker(sh.refs, (k) => {
            const p = sh.refs.indexOf(k);
            if (p >= 0) sh.refs.splice(p, 1); else sh.refs.push(k);
        }, ["image", "video"]));
        pane.append(f1);

        const f3 = E("div", "h3m-fld");
        const h = E("div", "h3m-row");
        h.append(E("h3", null, "台词"));
        const sp2 = E("div"); sp2.style.flex = "1"; h.append(sp2);
        let need = 0;
        for (const l of sh.lines) if (l.text?.trim()) need += SPEECH.padBefore + speechSeconds(l.text) + SPEECH.padAfter;
        if (sh.lines.length) {
            const m = E("span", "h3m-mini", `含留白约需 ${need.toFixed(1)}s / 本镜 ${span.toFixed(1)}s`);
            if (need > span) m.style.color = "var(--warn)";
            h.append(m);
        }
        f3.append(h);
        sh.lines.forEach((ln, j) => f3.append(lineCard(sh, ln, j)));
        const addL = E("button", "h3m-btn", "+ 添加台词");
        addL.onclick = () => { sh.lines.push(blankLine()); draw(); };
        f3.append(addL);
        pane.append(f3);
    }

    function lineCard(sh, ln, j) {
        const c = E("div", "h3m-line");
        const h = E("div", "h3m-line-hd");
        h.append(E("span", "h3m-lab", `第 ${j + 1} 句`));
        h.append(dd(VOICE_MODES, ln.mode, (v) => { ln.mode = v; }));
        const cnt = E("span", "h3m-mini", `${spokenChars(ln.text)} 字 · ${speechSeconds(ln.text).toFixed(1)}s`);
        const sp = E("div"); sp.style.flex = "1";
        h.append(sp, cnt);
        const d = E("button", "h3m-btn gh", "✕");
        d.onclick = () => { sh.lines.splice(j, 1); draw(); };
        h.append(d);
        c.append(h);

        const ta = E("textarea");
        ta.style.minHeight = "50px";
        ta.placeholder = "说什么？只写内容，语种标签和 <d> 会自动加。";
        ta.value = ln.text || "";
        ta.addEventListener("input", () => {
            ln.text = ta.value;
            cnt.textContent = `${spokenChars(ln.text)} 字 · ${speechSeconds(ln.text).toFixed(1)}s`;
        });
        ta.addEventListener("change", draw);
        c.append(ta);

        const r = E("div", "h3m-row");
        r.style.marginTop = "8px";
        r.append(E("span", "h3m-lab", "语气"), combo(DELIVERY_PRESETS, ln.delivery, (v) => { ln.delivery = v; }));
        const audio = mediaList.filter((m) => m.kind === "audio");
        if (audio.length) {
            r.append(E("span", "h3m-lab", "音色"),
                dd([{ id: "", label: "（跟随全局）" }, ...audio.map((m) => ({ id: m.key, label: m.label }))],
                    ln.voiceRef, (v) => { ln.voiceRef = v; }));
        }
        c.append(r);
        return c;
    }

    draw();
    return mask;
}

export { assemble, blankScript, SCRIPT_PROP };
