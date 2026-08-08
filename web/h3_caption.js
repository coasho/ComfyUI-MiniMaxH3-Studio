/**
 * 图生文反推（前端）。
 *
 * 实体绑定了参考图之后，点一下就把外观特征反推出来填进描述框，再手改。
 * 图片在浏览器里先缩到 1024 长边再发，省得把几 MB 的原图丢给后端。
 */

const API = "/minimax_h3_studio/caption";
const MAX_SIDE = 1024;

export async function captionStatus() {
    const r = await fetch(`${API}/status`);
    if (!r.ok) throw new Error(`状态接口返回 ${r.status}`);
    return r.json();
}

export async function saveCaptionSettings(patch) {
    const r = await fetch(`${API}/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
    });
    return r.json();
}

/** 把 ComfyUI 的 /view 链接读成缩小后的 data URI */
export async function imageToDataUrl(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`取图失败（${resp.status}）：${url}`);
    const blob = await resp.blob();
    const bmp = await createImageBitmap(blob);
    const r = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(bmp.width * r));
    cv.height = Math.max(1, Math.round(bmp.height * r));
    cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
    bmp.close?.();
    return cv.toDataURL("image/jpeg", 0.9);
}

async function runCaption(body) {
    const r = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
    if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
}

const CSS = `
.h3c-mask{position:fixed;inset:0;background:rgba(8,9,12,.6);z-index:10010;display:flex;
  align-items:center;justify-content:center}
.h3c{--bg:#1e2027;--bg2:#252831;--bg3:#2d313c;--line:#363b47;--txt:#e8eaee;--dim:#8b93a1;
  --accent:#4d8dff;--warn:#ff7a7a;--ok:#67c98a;
  background:var(--bg);color:var(--txt);width:min(880px,94vw);max-height:92vh;border-radius:13px;
  border:1px solid var(--line);box-shadow:0 20px 60px rgba(0,0,0,.6);display:flex;flex-direction:column;
  font:13.5px/1.6 system-ui,"Segoe UI","Microsoft YaHei",sans-serif;overflow:hidden}
.h3c *{box-sizing:border-box}
.h3c-hd{display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--bg2);
  border-bottom:1px solid var(--line)}
.h3c-hd h3{margin:0;font-size:14.5px;font-weight:600}
.h3c-bd{padding:14px 16px;overflow:auto;display:flex;gap:14px;min-height:0}
.h3c-pic{width:190px;flex:0 0 auto}
.h3c-pic img{width:100%;border-radius:9px;border:1px solid var(--line);display:block}
.h3c-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:9px}
.h3c-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.h3c-lab{color:var(--dim);font-size:11.5px}
.h3c input,.h3c select,.h3c textarea{background:var(--bg3);border:1px solid var(--line);color:var(--txt);
  border-radius:6px;padding:6px 9px;font:inherit;outline:none;max-width:100%}
.h3c textarea{width:100%;resize:vertical;min-height:150px;line-height:1.65}
.h3c input:focus,.h3c select:focus,.h3c textarea:focus{border-color:var(--accent)}
.h3c-btn{background:var(--bg3);border:1px solid var(--line);color:var(--txt);border-radius:7px;
  padding:6px 14px;cursor:pointer;font:inherit}
.h3c-btn:hover{background:#39404e}
.h3c-btn:disabled{opacity:.45;cursor:default}
.h3c-btn.pri{background:var(--accent);border-color:#5c99ff}
.h3c-btn.gh{background:transparent;color:var(--dim)}
.h3c-ft{padding:11px 16px;border-top:1px solid var(--line);background:var(--bg2);
  display:flex;gap:10px;align-items:center}
.h3c-msg{font-size:11.5px;color:var(--dim);flex:1;min-width:0}
.h3c-msg.bad{color:var(--warn)}
.h3c-msg.ok{color:var(--ok)}
.h3c-tags{font-size:11px;color:var(--dim);background:#22252d;border:1px solid var(--line);
  border-radius:7px;padding:7px 9px;max-height:78px;overflow:auto;line-height:1.55}
.h3c-cfg{border-top:1px dashed var(--line);padding-top:9px;margin-top:2px}
.h3c-dot{width:7px;height:7px;border-radius:50%;display:inline-block;flex:0 0 auto}
`;

let styled = false;
function ensureStyle() {
    if (styled) return;
    const s = document.createElement("style");
    s.textContent = CSS;
    document.head.append(s);
    styled = true;
}

const E = (t, c, x) => {
    const el = document.createElement(t);
    if (c) el.className = c;
    if (x != null) el.textContent = x;
    return el;
};

function dd(opts, value, onChange) {
    const s = E("select");
    for (const o of opts) {
        const op = E("option");
        op.value = o.id; op.textContent = o.label;
        if (o.disabled) op.disabled = true;
        s.append(op);
    }
    s.value = value ?? "";
    s.addEventListener("change", () => onChange(s.value));
    return s;
}

/**
 * 打开反推弹窗。
 * @param {object} opt
 *   opt.previewUrl  参考图地址（ComfyUI 的 /view 链接）
 *   opt.label       素材名，仅用于显示
 *   opt.kind        实体类型，决定问什么（identity/object/scene/action/style）
 *   opt.current     实体现有描述，用于「追加」
 *   opt.onApply(text, mode)  mode = 'replace' | 'append'
 */
export function openCaptionDialog(opt) {
    ensureStyle();
    const mask = E("div", "h3c-mask");
    const box = E("div", "h3c");

    const hd = E("div", "h3c-hd");
    hd.append(E("h3", null, "从参考图反推特征"));
    hd.append(E("span", "h3c-lab", opt.label || ""));
    const sp = E("div"); sp.style.flex = "1"; hd.append(sp);
    const closeX = E("button", "h3c-btn gh", "✕");
    closeX.onclick = () => close();
    hd.append(closeX);

    const bd = E("div", "h3c-bd");
    const picWrap = E("div", "h3c-pic");
    if (opt.previewUrl) {
        const im = E("img"); im.src = opt.previewUrl; picWrap.append(im);
    } else picWrap.append(E("div", "h3c-lab", "没有可预览的图"));
    const mainCol = E("div", "h3c-main");
    bd.append(picWrap, mainCol);

    // --- 控制条 ---
    const ctrl = E("div", "h3c-row");
    const dot = E("span", "h3c-dot");
    const backendSel = dd([{ id: "auto", label: "后端：自动" }], "auto", (v) => { state.backend = v; });
    const langSel = dd([{ id: "en", label: "输出英文（可直接进提示词）" },
                        { id: "zh", label: "输出中文（好读好改）" }], "en", (v) => { state.language = v; });
    const tagCk = E("label");
    tagCk.style.cssText = "display:inline-flex;gap:6px;align-items:center;font-size:12px;color:var(--dim)";
    const tagBox = E("input"); tagBox.type = "checkbox"; tagBox.checked = true;
    tagCk.append(tagBox, E("span", null, "二次元：先用 WD14 抽标签做依据"));
    tagCk.title = "WD14 在发色瞳色服饰这类离散属性上比 VLM 准，抽到的标签会作为事实依据喂给 VLM。写实照片请关掉。";
    ctrl.append(dot, backendSel, langSel, tagCk);
    mainCol.append(ctrl);

    const hint = E("input");
    hint.placeholder = "补充要求（可留空），例如：忽略背景的白底；只写上半身；用简短一句";
    hint.style.width = "100%";
    mainCol.append(hint);

    const ta = E("textarea");
    ta.placeholder = "反推结果会出现在这里，可以直接改。";
    mainCol.append(ta);

    const tagsBox = E("div", "h3c-tags");
    tagsBox.style.display = "none";
    mainCol.append(tagsBox);

    // 设定稿的排版特征（白底、三视图、张臂站姿…）——这些必须写进「不保留」，
    // 否则会被模型当画面内容一起搬进成片。
    const nrWrap = E("div");
    nrWrap.style.display = "none";
    const nrHead = E("div", "h3c-lab", "顺便加进「不保留的内容」（这张是设定稿，下面这些是版式不是角色）：");
    const nrList = E("div", "h3c-row");
    nrWrap.append(nrHead, nrList);
    mainCol.append(nrWrap);
    let nrBoxes = [];

    // --- 后端设置（OpenAI 兼容接口）---
    const cfg = E("div", "h3c-cfg");
    cfg.style.display = "none";
    const cfgRow = E("div", "h3c-row");
    const urlIn = E("input"); urlIn.style.flex = "1"; urlIn.style.minWidth = "220px";
    urlIn.placeholder = "http://127.0.0.1:11434/v1";
    const modelIn = E("input"); modelIn.style.width = "180px"; modelIn.placeholder = "qwen2.5vl:7b";
    const keyIn = E("input"); keyIn.style.width = "150px"; keyIn.placeholder = "API Key（本地留空）";
    keyIn.type = "password";
    const saveCfg = E("button", "h3c-btn", "保存接口设置");
    saveCfg.onclick = async () => {
        await saveCaptionSettings({
            openai_base_url: urlIn.value.trim(),
            openai_model: modelIn.value.trim(),
            openai_api_key: keyIn.value,
        });
        msg("接口设置已保存", "ok");
    };
    cfgRow.append(E("span", "h3c-lab", "接口"), urlIn,
                  E("span", "h3c-lab", "模型"), modelIn, keyIn, saveCfg);
    cfg.append(cfgRow);
    mainCol.append(cfg);

    const ft = E("div", "h3c-ft");
    const status = E("div", "h3c-msg");
    const run = E("button", "h3c-btn pri", "开始反推");
    const applyR = E("button", "h3c-btn", "替换描述");
    const applyA = E("button", "h3c-btn", "追加到描述");
    applyR.disabled = applyA.disabled = true;
    const cancel = E("button", "h3c-btn gh", "关闭");
    cancel.onclick = () => close();
    ft.append(status, run, applyR, applyA, cancel);

    box.append(hd, bd, ft);
    mask.append(box);
    mask.addEventListener("mousedown", (e) => { if (e.target === mask) close(); });
    document.body.append(mask);

    const onKey = (e) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    function close() {
        window.removeEventListener("keydown", onKey);
        mask.remove();
    }

    const state = { backend: "auto", language: "en", busy: false };
    const msg = (t, cls) => { status.textContent = t; status.className = "h3c-msg" + (cls ? " " + cls : ""); };

    /* --- 探测后端可用性 --- */
    (async () => {
        msg("正在检查可用后端…");
        try {
            const st = await captionStatus();
            const ready = st.backends.filter((b) => b.ready);
            backendSel.innerHTML = "";
            const opts = [{ id: "auto", label: ready.length ? "后端：自动" : "后端：无可用" }];
            for (const b of st.backends) {
                opts.push({ id: b.id, label: (b.ready ? "✓ " : "✕ ") + b.label, disabled: !b.ready });
            }
            for (const o of opts) {
                const op = E("option");
                op.value = o.id; op.textContent = o.label;
                if (o.disabled) op.disabled = true;
                backendSel.append(op);
            }
            backendSel.value = st.settings?.backend || "auto";
            state.backend = backendSel.value;
            state.language = st.settings?.language || "en";
            langSel.value = state.language;
            tagBox.checked = st.settings?.use_tags_for_anime !== false;
            urlIn.value = st.settings?.openai_base_url || "";
            modelIn.value = st.settings?.openai_model || "";
            cfg.style.display = "";

            dot.style.background = ready.length ? "var(--ok)" : "var(--warn)";
            if (!ready.length) {
                msg("还没有可用后端。要么等本地模型下载完，要么在下面填一个 OpenAI 兼容接口。", "bad");
                run.disabled = true;
            } else {
                const notReady = st.backends.filter((b) => !b.ready).map((b) => b.label.split("（")[0]);
                msg(`可用：${ready.map((b) => b.label.split("（")[0]).join("、")}` +
                    (notReady.length ? `　未就绪：${notReady.join("、")}` : ""));
            }
        } catch (e) {
            dot.style.background = "var(--warn)";
            msg(`反推服务没起来：${e.message}。重启一次 ComfyUI 再试。`, "bad");
            run.disabled = true;
        }
    })();

    run.onclick = async () => {
        if (state.busy) return;
        if (!opt.previewUrl) { msg("这个素材没有可读取的图片。先把图片节点跑一次生成预览。", "bad"); return; }
        state.busy = true;
        run.disabled = true;
        const t0 = performance.now();
        const tick = setInterval(() => {
            msg(`反推中… ${((performance.now() - t0) / 1000).toFixed(0)}s（首次调用要装载模型，会久一点）`);
        }, 500);
        try {
            const image = await imageToDataUrl(opt.previewUrl);
            const data = await runCaption({
                image, kind: opt.kind || "identity", hint: hint.value,
                language: state.language, backend: state.backend,
                use_tags: tagBox.checked,
            });
            clearInterval(tick);
            ta.value = data.text || "";
            applyR.disabled = applyA.disabled = !ta.value.trim();
            if (data.tags?.general?.length) {
                tagsBox.style.display = "";
                tagsBox.textContent = "WD14 标签：" +
                    [...(data.tags.character || []), ...(data.tags.general || [])].join("、");
            } else tagsBox.style.display = "none";

            const nr = data.suggest_not_retained || [];
            nrList.innerHTML = "";
            nrBoxes = [];
            if (nr.length) {
                nrWrap.style.display = "";
                for (const item of nr) {
                    const l = E("label");
                    l.style.cssText = "display:inline-flex;gap:5px;align-items:center;font-size:12px";
                    const cb = E("input"); cb.type = "checkbox"; cb.checked = true;
                    l.append(cb, E("span", null, item));
                    nrList.append(l);
                    nrBoxes.push([cb, item]);
                }
            } else nrWrap.style.display = "none";
            msg(`完成，用了 ${data.seconds}s（${data.used.join(" + ")}）。检查一遍再填进去。`, "ok");
        } catch (e) {
            clearInterval(tick);
            msg(`反推失败：${e.message}`, "bad");
        } finally {
            state.busy = false;
            run.disabled = false;
        }
    };

    const picked = () => nrBoxes.filter(([cb]) => cb.checked).map(([, t]) => t);
    applyR.onclick = () => { opt.onApply(ta.value.trim(), "replace", picked()); close(); };
    applyA.onclick = () => { opt.onApply(ta.value.trim(), "append", picked()); close(); };
    return mask;
}
