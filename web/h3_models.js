/**
 * 模型下载面板。
 *
 * 装一个视频模型要凑齐 6 个文件、80GB，分散在三个 HuggingFace 仓库里，
 * 名字还长得几乎一样——照着 README 手动抄链接是这个包最劝退的一步。
 * 这里勾几个框就行，断了会自己从断点接着下。
 *
 * 后端是 download_models.py，前端只负责显示和轮询。
 */

const API = "/minimax_h3_studio/models";

export async function modelStatus() {
    const r = await fetch(API);
    if (!r.ok) throw new Error(`状态接口返回 ${r.status}`);
    return r.json();
}

async function post(path, body) {
    const r = await fetch(API + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
    });
    const d = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
    if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);
    return d;
}

const CSS = `
.h3d-mask{position:fixed;inset:0;background:rgba(8,9,12,.6);z-index:10012;display:flex;
  align-items:center;justify-content:center}
.h3d{--bg:#1e2027;--bg2:#252831;--bg3:#2d313c;--line:#363b47;--txt:#e8eaee;--dim:#8b93a1;
  --accent:#4d8dff;--warn:#ff7a7a;--ok:#67c98a;
  background:var(--bg);color:var(--txt);width:min(880px,95vw);max-height:92vh;border-radius:13px;
  border:1px solid var(--line);box-shadow:0 20px 60px rgba(0,0,0,.6);display:flex;flex-direction:column;
  font:13.5px/1.6 system-ui,"Segoe UI","Microsoft YaHei",sans-serif;overflow:hidden}
.h3d *{box-sizing:border-box}
.h3d-hd{display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--bg2);
  border-bottom:1px solid var(--line)}
.h3d-hd h3{margin:0;font-size:14.5px;font-weight:600}
.h3d-bd{padding:12px 16px;overflow:auto;display:flex;flex-direction:column;gap:12px;min-height:0}
.h3d-btn{background:var(--bg3);border:1px solid var(--line);color:var(--txt);border-radius:7px;
  padding:6px 14px;cursor:pointer;font:inherit}
.h3d-btn:hover{background:#39404e}
.h3d-btn:disabled{opacity:.45;cursor:default}
.h3d-btn.pri{background:var(--accent);border-color:#5c99ff}
.h3d-btn.gh{background:transparent;color:var(--dim)}
.h3d-btn.sm{padding:3px 9px;font-size:12px}
.h3d-ft{padding:11px 16px;border-top:1px solid var(--line);background:var(--bg2);
  display:flex;gap:10px;align-items:center}
.h3d-msg{font-size:11.5px;color:var(--dim);flex:1;min-width:0;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis}
.h3d-msg.bad{color:var(--warn)}
.h3d-msg.ok{color:var(--ok)}
.h3d-grp{font-size:11.5px;color:var(--dim);margin:2px 0 -4px;letter-spacing:.04em}
.h3d-it{display:flex;gap:10px;align-items:flex-start;border:1px solid var(--line);
  border-radius:9px;padding:8px 11px;background:var(--bg2)}
.h3d-it.on{border-color:#4a5a78;background:#232a38}
.h3d-it.ready{opacity:.62}
.h3d-it input[type=checkbox]{margin-top:4px;accent-color:var(--accent);width:15px;height:15px}
.h3d-it .m{flex:1;min-width:0}
.h3d-it .t{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.h3d-it .t b{font-weight:600;font-size:13px}
.h3d-it .n{font-size:11.5px;color:var(--dim);margin-top:1px}
.h3d-it .p{font-size:11px;color:#6c7482;font-family:ui-monospace,Consolas,monospace;
  margin-top:2px;word-break:break-all}
.h3d-sz{font-size:11.5px;color:var(--dim);font-variant-numeric:tabular-nums}
.h3d-tag{font-size:10.5px;padding:1px 7px;border-radius:20px;border:1px solid var(--line)}
.h3d-tag.req{background:#3a2b1c;border-color:#6b4f2c;color:#e5bb84}
.h3d-tag.ok{background:#1e3a2a;border-color:#2f6448;color:var(--ok)}
.h3d-tag.part{background:#33301c;border-color:#645d2c;color:#dcd08a}
.h3d-bar{height:5px;border-radius:3px;background:var(--bg3);overflow:hidden;margin-top:5px}
.h3d-bar i{display:block;height:100%;background:var(--accent);transition:width .3s}
.h3d-prog{border:1px solid var(--line);border-radius:9px;background:var(--bg2);padding:10px 12px;
  display:flex;flex-direction:column;gap:6px}
.h3d-prog .r{display:flex;gap:10px;align-items:baseline;font-size:12px}
.h3d-prog .r .f{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.h3d-prog .r .s{color:var(--dim);font-variant-numeric:tabular-nums;white-space:nowrap}
.h3d-log{max-height:150px;overflow:auto;background:#16181d;border:1px solid var(--line);
  border-radius:8px;padding:7px 9px;font:11.5px/1.55 ui-monospace,Consolas,monospace;
  color:#9aa3b2;white-space:pre-wrap;word-break:break-all}
.h3d-note{border-radius:8px;padding:8px 11px;font-size:12px;line-height:1.6;
  background:#2b2416;border:1px solid #5e4d24;color:#e8cf94}
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

function human(n) {
    if (!n) return "—";
    const u = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(n < 10 && i > 1 ? 1 : 0)} ${u[i]}`;
}

function eta(sec) {
    if (!sec || sec <= 0) return "—";
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.floor(sec / 60)}分${sec % 60}秒`;
    return `${Math.floor(sec / 3600)}小时${Math.floor((sec % 3600) / 60)}分`;
}

/**
 * 打开模型下载面板。
 * @param {object} opt
 *   opt.preselect  额外默认勾上的 id 列表（比如从反推面板点进来时勾上 qwen3vl_caption）
 *   opt.onClose()  关闭回调，用来刷新调用方的就绪状态
 */
export function openModelManager(opt = {}) {
    ensureStyle();
    const mask = E("div", "h3d-mask");
    const box = E("div", "h3d");

    const hd = E("div", "h3d-hd");
    hd.append(E("h3", null, "模型下载"));
    const hdInfo = E("span", "h3d-msg");
    hd.append(hdInfo);
    const xb = E("button", "h3d-btn gh", "✕");
    xb.onclick = () => close();
    hd.append(xb);

    const bd = E("div", "h3d-bd");
    const ft = E("div", "h3d-ft");
    const msg = E("div", "h3d-msg");
    const selBtn = E("button", "h3d-btn sm", "选缺的");
    const goBtn = E("button", "h3d-btn pri", "开始下载");
    const stopBtn = E("button", "h3d-btn", "取消");
    stopBtn.style.display = "none";
    ft.append(msg, selBtn, stopBtn, goBtn);

    box.append(hd, bd, ft);
    mask.append(box);
    document.body.append(mask);

    let poll = 0;
    let closed = false;
    const picked = new Set();
    let items = [];
    let lastStatus = { items: [] };

    function close() {
        if (closed) return;
        closed = true;
        clearInterval(poll);
        mask.remove();
        document.removeEventListener("keydown", onKey);
        opt.onClose?.();
    }
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    mask.addEventListener("mousedown", (e) => { if (e.target === mask) close(); });

    function say(text, cls) {
        msg.textContent = text || "";
        msg.className = "h3d-msg" + (cls ? " " + cls : "");
    }

    // ---------------------------------------------------------------- 列表

    const listWrap = E("div");
    listWrap.style.cssText = "display:flex;flex-direction:column;gap:7px";
    const progWrap = E("div");
    progWrap.style.display = "none";
    bd.append(listWrap, progWrap);

    function renderList(st) {
        items = st.items;
        listWrap.replaceChildren();
        hdInfo.textContent = `${st.root}　·　剩余 ${human(st.free)}　·　源 ${
            st.endpoint.replace(/^https?:\/\//, "")}`;

        let lastGroup = null;
        for (const it of items) {
            if (it.group !== lastGroup) {
                lastGroup = it.group;
                listWrap.append(E("div", "h3d-grp", it.group));
            }
            const row = E("div", "h3d-it" + (it.ready ? " ready" : ""));
            const cb = E("input");
            cb.type = "checkbox";
            cb.checked = picked.has(it.id);
            cb.disabled = it.ready;
            cb.addEventListener("change", () => {
                cb.checked ? picked.add(it.id) : picked.delete(it.id);
                row.classList.toggle("on", cb.checked);
                updateFooter();
            });
            row.classList.toggle("on", cb.checked);

            const m = E("div", "m");
            const t = E("div", "t");
            t.append(E("b", null, it.label));
            if (it.required) t.append(E("span", "h3d-tag req", "必需"));
            if (it.ready) t.append(E("span", "h3d-tag ok", "已就绪"));
            else if (it.have > 0) {
                t.append(E("span", "h3d-tag part",
                           `下了 ${Math.floor(100 * it.have / (it.total || 1))}%`));
            }
            t.append(E("span", "h3d-sz", human(it.total)));
            m.append(t);
            if (it.note) m.append(E("div", "n", it.note));
            m.append(E("div", "p", it.path));
            if (!it.ready && it.have > 0) {
                const bar = E("div", "h3d-bar");
                const i = E("i");
                i.style.width = `${Math.min(100, 100 * it.have / (it.total || 1))}%`;
                bar.append(i);
                m.append(bar);
            }

            // 整行都能点，别逼用户瞄准那个 15px 的方框
            row.addEventListener("click", (e) => {
                if (e.target === cb || cb.disabled) return;
                cb.checked = !cb.checked;
                cb.dispatchEvent(new Event("change"));
            });
            row.append(cb, m);
            listWrap.append(row);
        }
        updateFooter();
    }

    function updateFooter() {
        const sel = items.filter((i) => picked.has(i.id));
        const bytes = sel.reduce((a, i) => a + Math.max(0, i.total - i.have), 0);
        goBtn.disabled = !sel.length;
        if (!sel.length) {
            const missing = items.filter((i) => !i.ready && i.required);
            say(missing.length
                ? `还缺 ${missing.length} 个必需模型，点「选缺的」一次性勾上`
                : "必需的模型都齐了");
        } else {
            say(`已选 ${sel.length} 项，还要下载约 ${human(bytes)}`);
        }
    }

    selBtn.onclick = () => {
        const missing = items.filter((i) => !i.ready);
        // 必需的全勾；一个都不缺时才把可选的也勾上，免得手一抖下 80GB
        const want = missing.some((i) => i.required)
            ? missing.filter((i) => i.required)
            : missing;
        // int8 文本编码器和 nvfp4 是二选一，别两个都下
        const skip = want.some((i) => i.id === "h3_text_encoder")
            ? new Set(["h3_text_encoder_int8"]) : new Set();
        picked.clear();
        for (const i of want) if (!skip.has(i.id)) picked.add(i.id);
        renderList(lastStatus);
    };

    // -------------------------------------------------------------- 进度

    const progRow = E("div", "h3d-prog");
    const pTitle = E("div", "r");
    const pFile = E("div", "f");
    const pSpeed = E("div", "s");
    pTitle.append(pFile, pSpeed);
    const pBar = E("div", "h3d-bar");
    const pBarI = E("i");
    pBar.append(pBarI);
    const pTotal = E("div", "r");
    const pTotalT = E("div", "f");
    pTotal.append(pTotalT);
    const pLog = E("div", "h3d-log");
    progRow.append(pTitle, pBar, pTotal, pLog);
    progWrap.append(progRow);

    function renderProgress(p) {
        const cur = p.current;
        if (cur) {
            pFile.textContent = cur.name;
            pSpeed.textContent = `${human(cur.done)} / ${human(cur.size)}　`
                + `${(cur.speed / 1048576).toFixed(1)} MB/s　剩 ${eta(cur.eta)}`;
            pBarI.style.width = `${Math.min(100, 100 * cur.done / (cur.size || 1))}%`;
        } else if (p.running) {
            pFile.textContent = "准备中…";
            pSpeed.textContent = "";
        }
        const doneN = p.done.length;
        const totalN = doneN + p.queue.length;
        pTotalT.textContent = p.total
            ? `总进度 ${human(p.have)} / ${human(p.total)}　（${doneN}/${totalN} 个文件）`
            : "";
        const atBottom = pLog.scrollHeight - pLog.scrollTop - pLog.clientHeight < 24;
        pLog.textContent = p.log.slice(-120).join("\n");
        if (atBottom) pLog.scrollTop = pLog.scrollHeight;
    }

    async function tick() {
        let p;
        try { p = await fetch(`${API}/progress`).then((r) => r.json()); }
        catch { return; }
        renderProgress(p);
        if (!p.running) {
            clearInterval(poll);
            poll = 0;
            stopBtn.style.display = "none";
            goBtn.disabled = false;
            goBtn.textContent = "开始下载";
            listWrap.style.display = "";
            if (p.failed?.length) say(`失败：${p.failed[p.failed.length - 1]}`, "bad");
            else say("下载完成", "ok");
            picked.clear();
            refresh();
        }
    }

    goBtn.onclick = async () => {
        const ids = [...picked];
        if (!ids.length) return;
        goBtn.disabled = true;
        try { await post("/download", { ids }); }
        catch (e) { goBtn.disabled = false; return say(e.message, "bad"); }
        progWrap.style.display = "";
        listWrap.style.display = "none";
        stopBtn.style.display = "";
        goBtn.textContent = "下载中…";
        say("下载中，可以关掉这个窗口，后台继续");
        pLog.textContent = "";
        clearInterval(poll);
        poll = setInterval(tick, 700);
        tick();
    };

    stopBtn.onclick = async () => {
        stopBtn.disabled = true;
        try { await post("/cancel"); } catch { /* 忽略 */ }
        setTimeout(() => { stopBtn.disabled = false; }, 1500);
        say("正在停…已下的部分留着，下次接着下");
    };

    // -------------------------------------------------------------- 启动

    async function refresh() {
        try {
            const st = await modelStatus();
            lastStatus = st;
            renderList(st);
        } catch (e) {
            say(`读取状态失败：${e.message}`, "bad");
        }
    }

    (async () => {
        await refresh();
        for (const id of opt.preselect || []) {
            if (items.some((i) => i.id === id && !i.ready)) picked.add(id);
        }
        if (picked.size) renderList(lastStatus);

        // 打开时后台已经在下（比如上次关窗口没停），直接进进度视图
        try {
            const p = await fetch(`${API}/progress`).then((r) => r.json());
            if (p.running) {
                progWrap.style.display = "";
                listWrap.style.display = "none";
                stopBtn.style.display = "";
                goBtn.disabled = true;
                goBtn.textContent = "下载中…";
                renderProgress(p);
                poll = setInterval(tick, 700);
            }
        } catch { /* 忽略 */ }
    })();

    return { close };
}
