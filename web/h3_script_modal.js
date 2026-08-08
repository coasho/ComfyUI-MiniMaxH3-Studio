/**
 * 剧本编辑弹窗（左右分栏）。
 *
 * 左栏 = 导航：可拖拽时间轴、全局设置入口、分镜列表（带问题角标）
 * 右栏 = 当前选中项的编辑区
 *
 * 使用者只填内容；分段、时间码、<d> 标签、<Picture N> 编号在生成时由 assemble() 补全。
 * 标「非官方」的字段是本插件的辅助项，官方无对应受控词表，只作为自然语言写进描述。
 */

import {
    assemble, validate, blankScript, blankShot, blankLine, blankCharacter, migrateScript,
    mediaRetention, retentionSet, castPlan, castBadge, castProblems, characterBoundMedia,
    SCRIPT_PROP,
    SECTIONS, STYLE_FIELD, MEDIA_ROLES, CAMERA_MOTIONS, CAMERA_AMPLITUDE, CAMERA_SPEED,
    SHOT_SIZES, CAMERA_ANGLES, TRANSITIONS, VOICE_MODES, CONTINUITY,
    DELIVERY_PRESETS, LANGUAGES, TASK_TYPES,
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
.h3m-rail{width:252px;flex:0 0 auto;border-right:1px solid var(--line);background:var(--bg2);
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

/* 时间轴：绝对定位，分界线可拖 */
.h3m-tl{position:relative;height:34px;border-radius:6px;border:1px solid var(--line);
  overflow:hidden;margin:5px 0 4px;user-select:none;background:#191b21}
.h3m-seg{position:absolute;top:0;bottom:0;display:grid;place-items:center;font-size:10.5px;
  color:#cfd5e0;cursor:pointer;overflow:hidden;white-space:nowrap;transition:filter .12s}
.h3m-seg:hover{filter:brightness(1.3)}
.h3m-seg.on{outline:2px solid var(--accent);outline-offset:-2px;z-index:1}
.h3m-grip{position:absolute;top:0;bottom:0;width:11px;margin-left:-5px;cursor:col-resize;z-index:3}
.h3m-grip::after{content:"";position:absolute;left:4px;top:3px;bottom:3px;width:3px;
  border-radius:2px;background:#7d879a}
.h3m-grip:hover::after,.h3m-grip.drag::after{background:var(--accent);top:0;bottom:0}
.h3m-bub{position:absolute;top:-24px;transform:translateX(-50%);background:var(--accent);
  color:#fff;font-size:11px;padding:1px 7px;border-radius:5px;white-space:nowrap;
  pointer-events:none;z-index:4}
.h3m-ruler{position:relative;height:13px;color:var(--dim);font-size:10px}
.h3m-ruler span{position:absolute;transform:translateX(-50%)}

.h3m h3{margin:0 0 5px;font-size:13.5px;font-weight:600;display:flex;align-items:center;gap:7px}
.h3m-tag{font-size:10px;font-weight:400;padding:0 6px;border-radius:9px;line-height:16px}
.h3m-tag.un{background:#3a3320;border:1px solid #6b5a2a;color:#e0c476}
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
.h3m-step{display:inline-flex;align-items:center;gap:0}
.h3m-step button{width:26px;padding:6px 0;background:var(--bg3);border:1px solid var(--line);
  color:var(--txt);cursor:pointer;font:inherit}
.h3m-step button:first-child{border-radius:6px 0 0 6px}
.h3m-step button:last-child{border-radius:0 6px 6px 0}
.h3m-step button:hover{background:#39404e}
.h3m-step input{width:62px;border-radius:0;border-left:none;border-right:none;text-align:center}
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
.h3m-banner{display:flex;gap:10px;align-items:flex-start;background:#3a2f1e;border:1px solid #6e5a2f;
  color:#f0d9a6;padding:9px 14px;font-size:12px;line-height:1.6;flex:0 0 auto}
.h3m-banner button{margin-left:auto;background:transparent;border:none;color:inherit;cursor:pointer;font:inherit}
.h3m-mini{color:var(--dim);font-size:11.5px}
.h3m-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:9px}
.h3m-grid label{display:flex;flex-direction:column;gap:4px}
.h3m-grid label>span{color:var(--dim);font-size:11.5px}
.h3m-cks{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:6px}
.h3m-ck{display:flex;gap:7px;align-items:flex-start;padding:6px 9px;border-radius:7px;
  border:1px solid var(--line);background:var(--bg2);cursor:pointer}
.h3m-ck.on{background:#25406e;border-color:var(--accent)}
.h3m-ck input{margin-top:3px}
.h3m-ck em{font-style:normal;color:var(--dim);font-size:11px;display:block}
.h3m-cast{border:1px solid var(--line);border-radius:10px;padding:12px 13px;margin-bottom:11px;background:var(--bg2)}
.h3m-cast-hd{display:flex;gap:9px;align-items:center;margin-bottom:9px;flex-wrap:wrap}
.h3m-cast-hd input.nm{width:130px;font-weight:600}
.h3m-id{font-family:ui-monospace,Consolas,monospace;font-size:11px;background:#233a63;
  border:1px solid #35558f;color:#a8c6ff;border-radius:5px;padding:1px 7px;white-space:nowrap}
.h3m-id.none{background:#33363f;border-color:#454b5a;color:var(--dim)}
.h3m-slot{display:flex;flex-direction:column;gap:4px;margin-top:9px}
.h3m-slot>span{color:var(--dim);font-size:11.5px}
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

/** 标题右侧的「非官方」角标 */
function unofficial(title) {
    const t = E("span", "h3m-tag un", "非官方");
    t.title = title || "官方没有对应受控词表，这里填的内容会作为普通英文写进描述。";
    return t;
}

/** 加减步进数字框，比裸 number input 好点 */
function stepper(value, step, min, max, onChange) {
    const w = E("span", "h3m-step");
    const inp = E("input");
    inp.type = "number"; inp.step = String(step); inp.value = value.toFixed(1);
    const clamp = (v) => Math.min(max, Math.max(min, Math.round(v * 10) / 10));
    const set = (v) => { const c = clamp(v); inp.value = c.toFixed(1); onChange(c); };
    const minus = E("button", null, "−");
    const plus = E("button", null, "+");
    minus.onclick = () => set(parseFloat(inp.value) - step);
    plus.onclick = () => set(parseFloat(inp.value) + step);
    inp.addEventListener("change", () => set(parseFloat(inp.value) || min));
    w.append(minus, inp, plus);
    return w;
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

/**
 * onSave(script) 的返回值决定弹窗去留：
 *   true      —— 保存成功，关闭
 *   string    —— 保存没生效，弹窗留着并在顶部显示这句话
 */
export function openScriptModal(node, mediaList, onSave) {
    ensureStyle();
    const S = migrateScript(node.properties?.[SCRIPT_PROP]);
    let sel = S.shots.length ? 0 : "global";     // 当前选中：'global' 或分镜下标

    const mask = E("div", "h3m-mask");
    const box = E("div", "h3m");

    /* -------------------------------------------------------------- 顶栏 */
    const hd = E("div", "h3m-hd");
    hd.append(E("h2", null, "剧本编辑器"));
    const dur = E("input");
    dur.type = "number"; dur.step = "0.5"; dur.min = "4"; dur.max = "20";
    dur.value = S.duration; dur.style.width = "74px";
    dur.addEventListener("change", () => {
        S.duration = Math.min(20, Math.max(4, parseFloat(dur.value) || 15));
        dur.value = S.duration;
        // 总时长缩短后把越界的分镜起点收回来
        let limit = S.duration - 0.3;
        for (let i = S.shots.length - 1; i > 0; i--) {
            if (S.shots[i].cutAt > limit) S.shots[i].cutAt = +limit.toFixed(1);
            limit = S.shots[i].cutAt - 0.3;
        }
        draw();
    });
    hd.append(E("span", "h3m-lab", "总时长"), dur, E("span", "h3m-mini", "秒"));
    hd.append(E("span", "h3m-lab", "默认语言"),
              dd(LANGUAGES, S.language || "Chinese", (v) => { S.language = v; draw(); }));
    const sp0 = E("div"); sp0.style.flex = "1"; hd.append(sp0);
    const x = E("button", "h3m-btn gh", "✕");
    x.onclick = () => close();
    hd.append(x);

    /* ------------------------------------------------------- 提示条（内嵌） */
    const banner = E("div", "h3m-banner");
    banner.style.display = "none";
    const bannerTxt = E("div");
    const bannerX = E("button", null, "✕");
    bannerX.onclick = () => { banner.style.display = "none"; };
    banner.append(bannerTxt, bannerX);
    const notify = (msg) => {
        bannerTxt.textContent = msg;
        banner.style.display = "flex";
    };

    /* ------------------------------------------------------------ 主体 */
    const main = E("div", "h3m-main");
    const rail = E("div", "h3m-rail");
    const railTop = E("div", "h3m-rail-top");
    const railList = E("div", "h3m-rail-list");
    const railFt = E("div", "h3m-rail-ft");
    const addBtn = E("button", "h3m-btn full", "+ 新增分镜");
    addBtn.onclick = () => {
        const last = S.shots.at(-1);
        if (!S.shots.length) {
            S.shots.push(blankShot(0));
        } else {
            const room = S.duration - last.cutAt;
            if (room < 0.8) { notify("最后一镜到片尾不足 0.8 秒，先拖长总时长或把分界线往左拖。"); return; }
            S.shots.push(blankShot(+(last.cutAt + room / 2).toFixed(1)));
        }
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
    cancel.onclick = () => close();
    const ok = E("button", "h3m-btn pri", "保存并应用");
    ok.onclick = () => {
        const r = onSave(structuredClone(S));
        // 保存没生效时留在弹窗里，别让人重填一遍
        if (r === true || r == null) close(true); else notify(String(r));
    };
    ft.append(stat, sp1, cancel, ok);

    box.append(hd, banner, main, ft);
    mask.append(box);
    document.body.append(mask);

    const teardown = [];
    const pristine = JSON.stringify(S);
    /** 关窗。有未保存改动时先问一句——手滑点到背景就丢一晚上的稿子太亏 */
    function close(force) {
        if (!force && JSON.stringify(S) !== pristine &&
            !confirm("有未保存的改动，确定关闭并丢弃吗？")) return;
        teardown.forEach((f) => f());
        mask.remove();
    }
    const onKey = (e) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    teardown.push(() => window.removeEventListener("keydown", onKey));
    mask.addEventListener("mousedown", (e) => { if (e.target === mask) close(); });

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

    const MIN_SHOT = 0.3;

    /**
     * 改某镜时长：后面所有镜整体平移（涟漪）。总时长不够就顶到片尾。
     */
    function setShotLength(i, len) {
        const cur = shotEnd(i) - S.shots[i].cutAt;
        let delta = len - cur;
        if (i + 1 >= S.shots.length) {              // 最后一镜：改的是总时长
            S.duration = Math.min(20, Math.max(S.shots[i].cutAt + MIN_SHOT, S.shots[i].cutAt + len));
            dur.value = S.duration;
            return;
        }
        const tailLen = S.duration - S.shots.at(-1).cutAt;
        const maxDelta = tailLen - MIN_SHOT;        // 别把最后一镜挤没
        delta = Math.min(delta, maxDelta);
        delta = Math.max(delta, MIN_SHOT - cur);
        for (let k = i + 1; k < S.shots.length; k++) {
            S.shots[k].cutAt = +(S.shots[k].cutAt + delta).toFixed(1);
        }
    }

    /* ------------------------------------------------------ 可拖拽时间轴 */
    // draw() 每次重建时间轴。旧的 window 监听必须先摘掉，否则重绘几十次就挂几十个。
    let dropTimelineHooks = null;
    teardown.push(() => dropTimelineHooks?.());

    function buildTimeline() {
        dropTimelineHooks?.();
        const tl = E("div", "h3m-tl");
        const pct = (t) => (t / S.duration) * 100;
        const segs = [], grips = [];

        S.shots.forEach((sh, i) => {
            const d = E("div", "h3m-seg" + (sel === i ? " on" : ""), String(i + 1));
            d.style.background = shotProblems(i).length ? "#5c3030" : (i % 2 ? "#333b4a" : "#3c4557");
            d.onclick = () => { sel = i; draw(); };
            segs.push(d);
            tl.append(d);
        });
        for (let k = 1; k < S.shots.length; k++) {
            const g = E("div", "h3m-grip");
            g.dataset.idx = String(k);
            g.title = "拖动改变前后两镜的分界点";
            grips.push(g);
            tl.append(g);
        }
        const bub = E("div", "h3m-bub");
        bub.style.display = "none";
        tl.append(bub);

        /** 把当前 cutAt 刷到 DOM 上，不重建元素——拖动时每帧都要跑 */
        const layout = () => {
            segs.forEach((d, i) => {
                d.style.left = pct(S.shots[i].cutAt) + "%";
                d.style.width = pct(shotEnd(i) - S.shots[i].cutAt) + "%";
                d.title = `镜头 ${i + 1}：${S.shots[i].cutAt.toFixed(1)} – ${shotEnd(i).toFixed(1)}s`;
            });
            grips.forEach((g, k) => { g.style.left = pct(S.shots[k + 1].cutAt) + "%"; });
        };
        layout();

        let drag = null;
        tl.addEventListener("mousedown", (e) => {
            const g = e.target.closest?.(".h3m-grip");
            if (!g) return;
            e.preventDefault();
            const idx = +g.dataset.idx;
            drag = { idx, g, rect: tl.getBoundingClientRect() };
            g.classList.add("drag");
            document.body.style.cursor = "col-resize";
            bub.style.display = "";
            move(e);
        });
        const move = (e) => {
            if (!drag) return;
            const { idx, rect } = drag;
            const lo = S.shots[idx - 1].cutAt + MIN_SHOT;
            const hi = (idx + 1 < S.shots.length ? S.shots[idx + 1].cutAt : S.duration) - MIN_SHOT;
            let t = ((e.clientX - rect.left) / rect.width) * S.duration;
            t = Math.min(hi, Math.max(lo, Math.round(t * 10) / 10));
            S.shots[idx].cutAt = t;
            layout();
            bub.style.left = pct(t) + "%";
            bub.textContent = `${t.toFixed(1)}s`;
            stat.textContent = `镜头 ${idx} → ${idx + 1} 分界 ${t.toFixed(1)}s　` +
                `（${(t - S.shots[idx - 1].cutAt).toFixed(1)}s / ${(shotEnd(idx) - t).toFixed(1)}s）`;
            stat.style.color = "var(--accent)";
        };
        const up = () => {
            if (!drag) return;
            drag.g.classList.remove("drag");
            drag = null;
            document.body.style.cursor = "";
            bub.style.display = "none";
            draw();
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
        dropTimelineHooks = () => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
            dropTimelineHooks = null;
        };
        return tl;
    }

    function buildRuler() {
        const r = E("div", "h3m-ruler");
        const step = S.duration <= 8 ? 1 : S.duration <= 16 ? 2 : 5;
        for (let t = 0; t <= S.duration + 1e-6; t += step) {
            const s = E("span", null, `${t}s`);
            s.style.left = (t / S.duration) * 100 + "%";
            if (t === 0) s.style.transform = "none";
            r.append(s);
        }
        return r;
    }

    /* ----------------------------------------------------------- 绘制 */
    function draw() {
        // 左栏：时间轴
        railTop.innerHTML = "";
        railTop.append(E("div", "h3m-lab", "时间轴"));
        if (S.shots.length) {
            railTop.append(buildTimeline(), buildRuler());
            railTop.append(E("div", "h3m-mini", "拖分界线改分镜长度，点色块切到那一镜"));
        } else railTop.append(E("div", "h3m-mini", "尚无分镜"));

        // 左栏：导航
        railList.innerHTML = "";
        const plan = castPlan(S);
        const cast = E("div", "h3m-nav" + (sel === "cast" ? " on" : ""));
        const speaking = Object.values(plan).filter((p) => p.speaker).length;
        cast.append(E("span", "n", "👤"),
                    E("span", "t", `角色（${S.characters.length} 个 · ${speaking} 个有台词）`));
        if (castProblems(S).length) cast.append(E("span", "b", "●"));
        cast.onclick = () => { sel = "cast"; draw(); };
        railList.append(cast);
        const g = E("div", "h3m-nav" + (sel === "global" ? " on" : ""));
        g.append(E("span", "n", "◈"), E("span", "t", "全局设置"));
        if (globalProblems().length) g.append(E("span", "b", "●"));
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
        if (sel === "cast") drawCast();
        else if (sel === "global") drawGlobal();
        else drawShot(S.shots[sel], sel);

        const all = validate(S);
        stat.textContent = all.length ? `⚠ ${all.length} 个问题` : "✅ 校验通过";
        stat.style.color = all.length ? "var(--warn)" : "var(--ok)";
        stat.title = all.join("\n");
    }

    function globalProblems() {
        const byMedia = Object.values(S.media || {}).some((m) => m?.role);
        return SECTIONS.filter((s) => {
            if (!s.required || s.auto || S.sections[s.key]?.trim()) return false;
            // 主体定义可以完全交给参考图，此时不算缺（与 validate() 同一条规则）
            return !(s.key === "subject_definitions" && byMedia);
        });
    }

    /** 角色面板：一个角色一张卡，形象图与音色在卡上直接选 */
    function drawCast() {
        const plan = castPlan(S);
        const probs = castProblems(S);
        if (probs.length) {
            const n = E("div", "h3m-note warn");
            probs.forEach((p) => n.append(E("div", null, "• " + p)));
            pane.append(n);
        }
        pane.append(E("h3", null, "角色"));
        pane.append(E("div", "h3m-hint",
            "一个角色一张卡，形象图和音色直接在卡上挑。<Subject N> 按角色顺序编号，" +
            "(S1)(S2) 按谁先开口编号 —— 官方规定这两套号互不相干，卡右上角显示的就是实际会发出去的编号。"));

        const imgs = mediaList.filter((m) => m.kind === "image");
        const auds = mediaList.filter((m) => m.kind === "audio");
        const taken = (key, self) => S.characters.some((c) => c !== self && (c.identityKey === key || c.voiceKey === key));

        S.characters.forEach((c, i) => {
            const p = plan[c.id];
            const card = E("div", "h3m-cast");
            const hd2 = E("div", "h3m-cast-hd");
            const nm = E("input", "nm");
            nm.placeholder = `角色 ${i + 1}`; nm.value = c.name || "";
            nm.addEventListener("input", () => { c.name = nm.value; });
            nm.addEventListener("change", draw);
            hd2.append(nm);
            const badge = E("span", "h3m-id" + (p.subject || p.speaker ? "" : " none"), castBadge(p));
            badge.title = "生成时实际使用的编号";
            hd2.append(badge);

            const onS = E("label");
            onS.style.cssText = "display:inline-flex;gap:6px;align-items:center;font-size:12px;color:var(--dim)";
            const cb = E("input"); cb.type = "checkbox"; cb.checked = c.onScreen !== false;
            cb.addEventListener("change", () => { c.onScreen = cb.checked; draw(); });
            onS.append(cb, E("span", null, "出镜"));
            onS.title = "取消勾选 = 只有声音的旁白，不占 <Subject N> 编号";
            hd2.append(onS);

            const lang = dd([{ id: "", label: `语言：跟随全局（${S.language}）` },
                             ...LANGUAGES.map((l) => ({ id: l, label: `语言：${l}` }))],
                            c.language || "", (v) => { c.language = v; });
            lang.title = "这个角色的台词用什么语种发送 <d>[Lang]…</d>";
            hd2.append(lang);

            const sp = E("div"); sp.style.flex = "1"; hd2.append(sp);
            const up = E("button", "h3m-btn gh", "↑");
            up.disabled = i === 0;
            up.title = "上移会改变 <Subject N> 的编号";
            up.onclick = () => { S.characters.splice(i - 1, 0, S.characters.splice(i, 1)[0]); draw(); };
            const del = E("button", "h3m-btn gh", "删除");
            del.onclick = () => {
                const lines = S.shots.reduce((n2, sh) =>
                    n2 + sh.lines.filter((l) => l.charId === c.id && l.text?.trim()).length, 0);
                if (lines && !confirm(`「${c.name || "该角色"}」名下还有 ${lines} 句台词，删除后这些台词会没有说话人。继续？`)) return;
                S.characters.splice(i, 1);
                draw();
            };
            hd2.append(up, del);
            card.append(hd2);

            const ta = E("textarea");
            ta.style.minHeight = "58px";
            ta.placeholder = "外观：发型发色、五官、服装、体型。颜色务必写排除项，例如 hair is jet black, NOT orange";
            ta.value = c.desc || "";
            ta.addEventListener("input", () => { c.desc = ta.value; });
            ta.addEventListener("change", draw);
            card.append(ta);

            const slots = E("div", "h3m-grid");
            slots.style.marginTop = "10px";
            const mkSlot = (label, list, cur, onPick, emptyHint) => {
                const s = E("label");
                s.append(E("span", null, label));
                if (!list.length) { s.append(E("span", "h3m-mini", emptyHint)); return s; }
                const opts = [{ id: "", label: "（不指定）" },
                    ...list.map((m) => ({ id: m.key, label: taken(m.key, c) ? `${m.label}（已被其他角色占用）` : m.label }))];
                s.append(dd(opts, cur || "", (v) => { onPick(v); draw(); }));
                return s;
            };
            slots.append(mkSlot("形象参考图", imgs, c.identityKey,
                (v) => { c.identityKey = v; }, "没有图片接到 media 口"));
            slots.append(mkSlot("音色参考音频", auds, c.voiceKey,
                (v) => { c.voiceKey = v; }, "没有音频接到 media 口"));
            card.append(slots);

            const said = S.shots.reduce((n2, sh) => n2 + sh.lines.filter((l) => l.charId === c.id && l.text?.trim()).length, 0);
            card.append(E("div", "h3m-mini", said
                ? `名下 ${said} 句台词` + (p.speaker ? `，说话人编号 (${p.speaker})` : "")
                : "名下暂无台词，不会分配说话人编号"));
            pane.append(card);
        });

        const add = E("button", "h3m-btn", "+ 新增角色");
        add.onclick = () => { S.characters.push(blankCharacter("")); draw(); };
        pane.append(add);
    }

    function drawGlobal() {
        /* --- 任务类型 --- */
        const f00 = E("div", "h3m-fld");
        f00.append(E("h3", null, "任务类型"));
        f00.append(E("div", "h3m-hint",
            "官方词表，可多选组合。生成时作为 summary 的方括号前缀发送，例如 [reference generation + audio reference]。"));
        const cks = E("div", "h3m-cks");
        for (const t of TASK_TYPES) {
            const on = S.taskTypes.includes(t.id);
            const l = E("label", "h3m-ck" + (on ? " on" : ""));
            const cb = E("input"); cb.type = "checkbox"; cb.checked = on;
            cb.addEventListener("change", () => {
                if (cb.checked) S.taskTypes.push(t.id);
                else S.taskTypes = S.taskTypes.filter((x) => x !== t.id);
                draw();
            });
            const body = E("div");
            body.append(E("div", null, `${t.label}　${t.en}`), E("em", null, t.hint));
            l.append(cb, body);
            cks.append(l);
        }
        f00.append(cks);
        pane.append(f00);

        /* --- 素材用途 --- */
        const f0 = E("div", "h3m-fld");
        f0.append(E("h3", null, "素材用途"));
        f0.append(E("div", "h3m-hint",
            "指定每个素材做什么用。生成时自动编号成 <Picture 1>/<Audio 1> 并写进保留声明，编号不用你管。" +
            "保留等级默认跟随用途，需要时可以覆盖——视觉与音频是两套官方词表。" +
            "角色形象和音色不在这里选，去「角色」面板绑到具体角色上。"));
        if (!mediaList.length) f0.append(E("div", "h3m-mini", "把 LoadImage / TTS 之类接到节点的 media 口即可。"));
        const bound = characterBoundMedia(S);
        for (const m of mediaList) {
            const cfg = (S.media[m.key] ||= { kind: m.kind, role: "", retention: "", note: "" });
            cfg.kind = m.kind;
            const b = bound[m.key];
            const r = E("div", "h3m-row");
            r.style.marginBottom = "7px";
            const c = E("span", "h3m-chip on");
            if (m.previewUrl && m.kind === "image") { const i = E("img"); i.src = m.previewUrl; c.append(i); }
            else c.append(E("span", "ic", m.kind === "audio" ? "♪" : m.kind === "video" ? "▶" : "🖼"));
            c.append(E("span", null, m.label));
            r.append(c);
            if (b) {
                // 已被角色占用：用途只读，避免同一件事有两个地方能改
                const who = b.char.name?.trim() || "未命名角色";
                const lk = E("span", "h3m-mini",
                    `${b.role === "identity" ? "角色形象" : "音色"} → ${who}`);
                lk.style.cssText = "padding:6px 9px;border:1px dashed var(--line);border-radius:6px";
                const jump = E("button", "h3m-btn gh", "去角色面板改");
                jump.onclick = () => { sel = "cast"; draw(); };
                r.append(lk, jump);
            } else {
                const roles = (MEDIA_ROLES[m.kind] || []).filter((x) => !x.viaCharacter);
                r.append(dd([{ id: "", label: "（不使用）" }, ...roles], cfg.role,
                    (v) => { cfg.role = v; cfg.retention = ""; draw(); }));
            }
            const effRole = b ? b.role : cfg.role;
            if (effRole) {
                const auto = mediaRetention({ kind: m.kind, role: effRole });
                const set = retentionSet(m.kind);
                const opts = [{ id: "", label: `保留：${auto}（默认）` },
                              ...set.map((x) => ({ id: x.id, label: `保留：${x.label}` }))];
                const s = dd(opts, cfg.retention, (v) => { cfg.retention = v; });
                s.title = m.kind === "audio" ? "官方音频保留等级词表" : "官方视觉保留等级词表";
                r.append(s);
            }
            const note = E("input");
            note.placeholder = "补充说明（可留空）"; note.style.flex = "1"; note.style.minWidth = "140px";
            note.value = cfg.note || "";
            note.addEventListener("input", () => { cfg.note = note.value; });
            if (!b) r.append(note);
            f0.append(r);
        }
        pane.append(f0);

        /* --- 文字段落（官方分段） + 画风（非官方） --- */
        const fields = [...SECTIONS.filter((s) => !s.auto), STYLE_FIELD];
        for (const s of fields) {
            const f = E("div", "h3m-fld");
            const h = E("h3", null, s.label + (s.required ? "" : "（可选）"));
            if (s.official === false) h.append(unofficial(s.hint));
            f.append(h);
            f.append(E("div", "h3m-hint", s.hint));
            const ta = E("textarea");
            ta.value = S.sections[s.key] || "";
            ta.addEventListener("input", () => { S.sections[s.key] = ta.value; });
            ta.addEventListener("change", draw);
            f.append(ta);
            pane.append(f);
        }

        /* --- 不保留 --- */
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

        const span = shotEnd(i) - sh.cutAt;
        const hdr = E("div", "h3m-row");
        hdr.style.marginBottom = "14px";
        hdr.append(E("h3", null, `镜头 ${i + 1}`));
        hdr.append(E("span", "h3m-mini", `${sh.cutAt.toFixed(1)} – ${shotEnd(i).toFixed(1)}s`));
        const sp = E("div"); sp.style.flex = "1"; hdr.append(sp);
        const up = E("button", "h3m-btn gh", "↑ 上移");
        up.disabled = i === 0;
        up.onclick = () => {
            if (i === 0) return;
            const a = S.shots[i - 1];
            [a.cutAt, sh.cutAt] = [sh.cutAt, a.cutAt];   // 起点留在原处，只换内容
            S.shots[i - 1] = sh; S.shots[i] = a;
            sel = i - 1; draw();
        };
        const down = E("button", "h3m-btn gh", "↓ 下移");
        down.disabled = i === S.shots.length - 1;
        down.onclick = () => {
            const b = S.shots[i + 1];
            if (!b) return;
            [b.cutAt, sh.cutAt] = [sh.cutAt, b.cutAt];
            S.shots[i + 1] = sh; S.shots[i] = b;
            sel = i + 1; draw();
        };
        const del = E("button", "h3m-btn gh", "删除本镜");
        del.onclick = () => {
            S.shots.splice(i, 1);
            if (S.shots.length) S.shots[0].cutAt = 0;    // 第 1 镜恒定从 0 开始
            sel = S.shots.length ? Math.max(0, i - 1) : "global";
            draw();
        };
        hdr.append(up, down, del);
        pane.append(hdr);

        // 时长用步进器（涟漪），起点由时间轴拖，不再让人算绝对时间码
        const lenRow = E("div", "h3m-row");
        lenRow.style.marginBottom = "12px";
        lenRow.append(E("span", "h3m-lab", "本镜时长"));
        lenRow.append(stepper(span, 0.5, MIN_SHOT, S.duration, (v) => { setShotLength(i, v); draw(); }));
        lenRow.append(E("span", "h3m-mini",
            i + 1 < S.shots.length ? "秒　后面的镜头会跟着平移" : "秒　最后一镜，改它等于改总时长"));
        pane.append(lenRow);

        const grid = E("div", "h3m-grid");
        grid.style.marginBottom = "14px";
        if (i > 0) grid.append(labeled("转场（官方）", dd(TRANSITIONS, sh.transition, (v) => { sh.transition = v; })));
        grid.append(labeled("景别（非官方）", dd(SHOT_SIZES, sh.size, (v) => { sh.size = v; draw(); })));
        grid.append(labeled("机位角度（非官方）", dd(CAMERA_ANGLES, sh.angle, (v) => { sh.angle = v; })));
        grid.append(labeled("运镜（官方）", dd(CAMERA_MOTIONS, sh.motion, (v) => { sh.motion = v; draw(); })));
        grid.append(labeled("幅度（官方）", dd(CAMERA_AMPLITUDE, sh.amplitude, (v) => { sh.amplitude = v; })));
        grid.append(labeled("速度（官方）", dd(CAMERA_SPEED, sh.speed, (v) => { sh.speed = v; })));
        pane.append(grid);
        pane.append(E("div", "h3m-hint",
            "标「非官方」的两项官方无受控词表（也没有「广角」「微距」这类镜头词），" +
            "会作为普通英文写进画面描述；运镜/幅度/速度是官方词表，幅度与速度官方只有两档。"));

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
        // 默认说话人：接着本镜上一句的人说；没有就用第一个角色。对话戏里再手动切
        addL.onclick = () => {
            const prev = sh.lines.at(-1)?.charId;
            sh.lines.push(blankLine(prev || S.characters[0]?.id || ""));
            draw();
        };
        f3.append(addL);
        if (S.characters.length > 1) {
            const addO = E("button", "h3m-btn", "+ 对方接话");
            addO.style.marginLeft = "8px";
            addO.title = "新增一句，说话人自动换成上一句以外的角色";
            addO.onclick = () => {
                const prev = sh.lines.at(-1)?.charId;
                const other = S.characters.find((ch) => ch.id !== prev) || S.characters[0];
                sh.lines.push(blankLine(other.id));
                draw();
            };
            f3.append(addO);
        }
        pane.append(f3);
    }

    function lineCard(sh, ln, j) {
        const plan = castPlan(S);
        const c = E("div", "h3m-line");
        const h = E("div", "h3m-line-hd");
        h.append(E("span", "h3m-lab", `第 ${j + 1} 句`));

        // 说话人：多角色时这是最关键的一格，放在最前面
        const who = dd([{ id: "", label: "（未指定说话人）" },
            ...S.characters.map((ch, k) => ({ id: ch.id, label: ch.name?.trim() || `角色 ${k + 1}` }))],
            ln.charId || "", (v) => { ln.charId = v; draw(); });
        who.title = "这句是谁说的";
        h.append(who);
        const p = plan[ln.charId];
        if (p) {
            const badge = E("span", "h3m-id" + (p.speaker ? "" : " none"),
                p.speaker ? `${p.label} (${p.speaker})` : p.label);
            badge.title = p.char.voiceKey
                ? "该角色已绑定音色，本句会带上音色引用"
                : "该角色未绑定音色，音色由模型自由发挥";
            h.append(badge);
        }
        h.append(dd(VOICE_MODES, ln.mode, (v) => { ln.mode = v; draw(); }));
        const cont = dd(CONTINUITY, ln.continuity || "complete", (v) => { ln.continuity = v; draw(); });
        cont.title = "官方标记：延续/承接会在 <d> 内加 <scenetrans>，被打断加 <cutoff>";
        h.append(cont);
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
        c.append(r);
        return c;
    }

    draw();
    return mask;
}

export { assemble, blankScript, SCRIPT_PROP };
