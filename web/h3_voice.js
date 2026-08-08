/**
 * 音色工作台（前端）。
 *
 * 一次出多条候选并排试听，挑中意的那条 —— 这是这个面板存在的理由。
 * VoiceDesign 是随机采样，同一段描述换个 seed 音色差很远；一次只生成一条
 * 就是碰运气，「大妈声」就是这么来的。
 *
 * 试听文本默认取该实体在剧本里的第一句真实台词，听到的就是成片里会说的那句。
 */

const API = "/minimax_h3_studio/voice";

/** 音色模型 4GB，关掉工作台就还回去，别等空闲计时器 */
async function releaseAuxModels() {
    try { await fetch("/minimax_h3_studio/release", { method: "POST" }); } catch { /* 忽略 */ }
}

export async function voiceStatus() {
    const r = await fetch(`${API}/status`);
    if (!r.ok) throw new Error(`状态接口返回 ${r.status}`);
    return r.json();
}

async function post(path, body) {
    const r = await fetch(API + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
    if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);
    return d;
}

const CSS = `
.h3v-mask{position:fixed;inset:0;background:rgba(8,9,12,.6);z-index:10010;display:flex;
  align-items:center;justify-content:center}
.h3v{--bg:#1e2027;--bg2:#252831;--bg3:#2d313c;--line:#363b47;--txt:#e8eaee;--dim:#8b93a1;
  --accent:#4d8dff;--warn:#ff7a7a;--ok:#67c98a;
  background:var(--bg);color:var(--txt);width:min(940px,95vw);max-height:93vh;border-radius:13px;
  border:1px solid var(--line);box-shadow:0 20px 60px rgba(0,0,0,.6);display:flex;flex-direction:column;
  font:13.5px/1.6 system-ui,"Segoe UI","Microsoft YaHei",sans-serif;overflow:hidden}
.h3v *{box-sizing:border-box}
.h3v-hd{display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--bg2);
  border-bottom:1px solid var(--line)}
.h3v-hd h3{margin:0;font-size:14.5px;font-weight:600}
.h3v-bd{padding:14px 16px;overflow:auto;display:flex;flex-direction:column;gap:10px;min-height:0}
.h3v-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.h3v-lab{color:var(--dim);font-size:11.5px}
.h3v input,.h3v select,.h3v textarea{background:var(--bg3);border:1px solid var(--line);color:var(--txt);
  border-radius:6px;padding:6px 9px;font:inherit;outline:none;max-width:100%}
.h3v textarea{width:100%;resize:vertical;min-height:60px}
.h3v input:focus,.h3v select:focus,.h3v textarea:focus{border-color:var(--accent)}
.h3v-btn{background:var(--bg3);border:1px solid var(--line);color:var(--txt);border-radius:7px;
  padding:6px 14px;cursor:pointer;font:inherit}
.h3v-btn:hover{background:#39404e}
.h3v-btn:disabled{opacity:.45;cursor:default}
.h3v-btn.pri{background:var(--accent);border-color:#5c99ff}
.h3v-btn.gh{background:transparent;color:var(--dim)}
.h3v-btn.sm{padding:3px 9px;font-size:12px}
.h3v-ft{padding:11px 16px;border-top:1px solid var(--line);background:var(--bg2);
  display:flex;gap:10px;align-items:center}
.h3v-msg{font-size:11.5px;color:var(--dim);flex:1;min-width:0}
.h3v-msg.bad{color:var(--warn)}
.h3v-msg.ok{color:var(--ok)}
.h3v-tabs{display:flex;gap:6px}
.h3v-tab{padding:5px 13px;border-radius:8px;border:1px solid var(--line);background:var(--bg2);
  cursor:pointer;font-size:12.5px;user-select:none}
.h3v-tab.on{background:#25406e;border-color:var(--accent)}
.h3v-tab.off{opacity:.45;cursor:default}
.h3v-cands{display:grid;grid-template-columns:repeat(auto-fit,minmax(268px,1fr));gap:9px}
.h3v-cand{border:1px solid var(--line);border-radius:9px;padding:9px 10px;background:var(--bg2);
  display:flex;flex-direction:column;gap:6px;cursor:pointer}
.h3v-cand:hover{border-color:#4a5262}
.h3v-cand.on{background:#25406e;border-color:var(--accent)}
.h3v-cand audio{width:100%;height:32px}
.h3v-cand .t{display:flex;gap:8px;align-items:center;font-size:12px}
.h3v-cand .s{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--dim)}
.h3v-bank{display:flex;flex-direction:column;gap:6px;max-height:230px;overflow:auto}
.h3v-bankrow{display:flex;gap:9px;align-items:center;border:1px solid var(--line);
  border-radius:8px;padding:6px 9px;background:var(--bg2)}
.h3v-bankrow audio{height:30px;flex:1;min-width:150px}
.h3v-note{border-radius:8px;padding:8px 11px;font-size:12px;line-height:1.6;
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

/** 描述预设。写得越具体越稳，尤其要点明音量与语速——「太亢奋」多半是没写。 */
const INSTRUCTION_PRESETS = [
    "十二岁少女的清亮嗓音，气声偏多，音量压得很低，像在偷偷说话，语速平稳不亢奋",
    "初中女生的自然说话声，音色干净不做作，情绪平稳，语速中等偏慢",
    "成年女性的温柔低音，气息稳，尾音轻，不夸张",
    "少年清亮嗓音，略带沙哑，语速偏快，有精神但不喊",
    "成熟男性的低沉嗓音，胸腔共鸣明显，语速慢，字字沉稳",
    "老年人的沙哑嗓音，气息不足，语速缓慢，带轻微颤抖",
];

const LANGS = ["Chinese", "English", "Japanese", "Korean", "German",
               "French", "Russian", "Portuguese", "Spanish", "Italian"];

/**
 * 打开音色工作台。
 * @param {object} opt
 *   opt.entityName   实体名，用于命名落盘文件
 *   opt.auditionText 试听文本（默认取剧本里该实体的第一句台词）
 *   opt.language     默认语种
 *   opt.onPick(entry)  entry = { file, name, mode, ... }，file 是 input/ 下的相对路径
 */
export function openVoiceStudio(opt) {
    ensureStyle();
    const mask = E("div", "h3v-mask");
    const box = E("div", "h3v");

    const hd = E("div", "h3v-hd");
    hd.append(E("h3", null, "音色工作台"));
    hd.append(E("span", "h3v-lab", opt.entityName ? `为「${opt.entityName}」` : ""));
    const sp0 = E("div"); sp0.style.flex = "1"; hd.append(sp0);
    const xb = E("button", "h3v-btn gh", "✕");
    xb.onclick = () => close();
    hd.append(xb);

    const bd = E("div", "h3v-bd");

    const st = { mode: "design", language: opt.language || "Chinese",
                 count: 4, picked: null, refAudio: null, busy: false };

    /* --- 来源切换 --- */
    const tabs = E("div", "h3v-tabs");
    const tabDesign = E("div", "h3v-tab on", "描述生成");
    const tabClone = E("div", "h3v-tab", "克隆参考音频");
    const tabBank = E("div", "h3v-tab", "音色库");
    tabs.append(tabDesign, tabClone, tabBank);
    bd.append(tabs);

    const noteBox = E("div", "h3v-note");
    noteBox.style.display = "none";
    bd.append(noteBox);

    /* --- 试听文本 --- */
    const textWrap = E("div");
    textWrap.append(E("div", "h3v-lab", "试听文本（默认取剧本里这个角色的第一句台词）"));
    const textTa = E("textarea");
    textTa.value = opt.auditionText || "那个、这是广播体操……第八套。";
    textWrap.append(textTa);
    bd.append(textWrap);

    /* --- design 面板 --- */
    const designPane = E("div");
    designPane.append(E("div", "h3v-lab", "音色描述（越具体越稳，务必写明音量与语速）"));
    const instrTa = E("textarea");
    instrTa.value = INSTRUCTION_PRESETS[0];
    designPane.append(instrTa);
    const presetRow = E("div", "h3v-row");
    presetRow.append(E("span", "h3v-lab", "预设"));
    presetRow.append(dd([{ id: "", label: "（选一个填进去）" },
        ...INSTRUCTION_PRESETS.map((p, i) => ({ id: String(i), label: p.slice(0, 22) + "…" }))],
        "", (v) => { if (v !== "") instrTa.value = INSTRUCTION_PRESETS[+v]; }));
    designPane.append(presetRow);
    bd.append(designPane);

    /* --- clone 面板 --- */
    const clonePane = E("div");
    clonePane.style.display = "none";
    clonePane.append(E("div", "h3v-lab",
        "选一段你想要的嗓子（wav / flac / ogg，3–15 秒最好，尽量干净无背景音）"));
    const fileRow = E("div", "h3v-row");
    const fileIn = E("input"); fileIn.type = "file"; fileIn.accept = "audio/*";
    const refPlayer = E("audio"); refPlayer.controls = true; refPlayer.style.height = "32px";
    refPlayer.style.display = "none";
    fileIn.addEventListener("change", async () => {
        const f = fileIn.files?.[0];
        if (!f) return;
        st.refAudio = await new Promise((res, rej) => {
            const fr = new FileReader();
            fr.onload = () => res(fr.result);
            fr.onerror = rej;
            fr.readAsDataURL(f);
        });
        refPlayer.src = st.refAudio;
        refPlayer.style.display = "";
        msg(`已载入参考音频 ${(f.size / 1024).toFixed(0)} KB`, "ok");
    });
    fileRow.append(fileIn, refPlayer);
    clonePane.append(fileRow);
    clonePane.append(E("div", "h3v-lab",
        "参考音频里说的原话（可留空，留空则只提取音色向量，不参考内容）"));
    const refTextIn = E("input");
    refTextIn.style.width = "100%";
    refTextIn.placeholder = "留空 = x-vector 模式，只复刻嗓音";
    clonePane.append(refTextIn);
    bd.append(clonePane);

    /* --- 参数 --- */
    const cfgRow = E("div", "h3v-row");
    cfgRow.append(E("span", "h3v-lab", "语种"), dd(LANGS, st.language, (v) => { st.language = v; }));
    cfgRow.append(E("span", "h3v-lab", "候选条数"),
        dd([2, 4, 6, 8].map((n) => ({ id: String(n), label: String(n) })), "4",
           (v) => { st.count = +v; }));
    const seedIn = E("input");
    seedIn.type = "number"; seedIn.min = "0"; seedIn.style.width = "128px"; seedIn.value = "0";
    seedIn.title = "0 = 每次随机。填了固定值则候选可复现";
    cfgRow.append(E("span", "h3v-lab", "起始 seed"), seedIn);
    bd.append(cfgRow);

    /* --- 候选区 --- */
    const candsWrap = E("div");
    candsWrap.append(E("div", "h3v-lab", "候选（点卡片选中，可反复重生成）"));
    const cands = E("div", "h3v-cands");
    candsWrap.append(cands);
    bd.append(candsWrap);

    /* --- 音色库 --- */
    const bankPane = E("div");
    bankPane.style.display = "none";
    bankPane.append(E("div", "h3v-lab", "已保存的音色，可直接绑给这个角色"));
    const bankList = E("div", "h3v-bank");
    bankPane.append(bankList);
    bd.append(bankPane);

    /* --- 底栏 --- */
    const ft = E("div", "h3v-ft");
    const status = E("div", "h3v-msg");
    const gen = E("button", "h3v-btn pri", "生成候选");
    const use = E("button", "h3v-btn", "用作该角色音色");
    use.disabled = true;
    const cancel = E("button", "h3v-btn gh", "关闭");
    cancel.onclick = () => close();
    ft.append(status, gen, use, cancel);

    box.append(hd, bd, ft);
    mask.append(box);
    mask.addEventListener("mousedown", (e) => { if (e.target === mask) close(); });
    document.body.append(mask);

    const onKey = (e) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    function close() {
        window.removeEventListener("keydown", onKey);
        bd.querySelectorAll("audio").forEach((a) => { try { a.pause(); } catch { /* 忽略 */ } });
        mask.remove();
        releaseAuxModels();
    }

    const msg = (t, cls) => { status.textContent = t; status.className = "h3v-msg" + (cls ? " " + cls : ""); };

    function setMode(m) {
        st.mode = m;
        for (const [t, id] of [[tabDesign, "design"], [tabClone, "clone"], [tabBank, "bank"]]) {
            t.classList.toggle("on", id === m);
        }
        designPane.style.display = m === "design" ? "" : "none";
        clonePane.style.display = m === "clone" ? "" : "none";
        bankPane.style.display = m === "bank" ? "" : "none";
        textWrap.style.display = m === "bank" ? "none" : "";
        cfgRow.style.display = m === "bank" ? "none" : "";
        candsWrap.style.display = m === "bank" ? "none" : "";
        gen.style.display = m === "bank" ? "none" : "";
        use.disabled = m === "bank" ? !st.picked : !st.picked;
    }
    tabDesign.onclick = () => setMode("design");
    tabClone.onclick = () => { if (!tabClone.classList.contains("off")) setMode("clone"); };
    tabBank.onclick = () => setMode("bank");

    /* --- 探测后端 + 载入音色库 --- */
    (async () => {
        msg("正在检查音色后端…");
        try {
            const s = await voiceStatus();
            const design = s.backends.find((b) => b.id === "design");
            const clone = s.backends.find((b) => b.id === "clone");
            if (!clone?.ready) {
                tabClone.classList.add("off");
                tabClone.title = "Base 模型还没下载完，暂不能克隆";
                tabClone.textContent = "克隆参考音频（模型未就绪）";
            }
            if (!design?.ready) {
                tabDesign.classList.add("off");
                gen.disabled = true;
                noteBox.style.display = "";
                noteBox.textContent = "VoiceDesign 模型没找到，描述生成不可用。";
            }
            renderBank(s.bank || []);
            const ready = s.backends.filter((b) => b.ready).map((b) => b.label.split("（")[0]);
            msg(ready.length ? `可用：${ready.join("、")}　音色库 ${s.bank?.length || 0} 条`
                             : "没有可用的音色后端", ready.length ? "" : "bad");
        } catch (e) {
            msg(`音色服务没起来：${e.message}。重启一次 ComfyUI 再试。`, "bad");
            gen.disabled = true;
        }
    })();

    function renderBank(bank) {
        bankList.innerHTML = "";
        if (!bank.length) {
            bankList.append(E("div", "h3v-lab", "音色库还是空的。生成一条并保存后会出现在这里。"));
            return;
        }
        for (const b of bank) {
            const row = E("div", "h3v-bankrow");
            const pick = E("input"); pick.type = "radio"; pick.name = "h3vbank";
            pick.onchange = () => {
                st.picked = { fromBank: true, entry: b };
                use.disabled = false;
            };
            row.append(pick, E("span", null, b.name || b.file));
            const au = E("audio");
            au.controls = true;
            au.src = `/view?filename=${encodeURIComponent(b.file)}&type=input`;
            row.append(au);
            row.append(E("span", "h3v-lab", b.mode === "clone" ? "克隆" : "描述"));
            bankList.append(row);
        }
    }

    function renderCandidates(list) {
        cands.innerHTML = "";
        st.picked = null;
        use.disabled = true;
        list.forEach((c, i) => {
            const card = E("div", "h3v-cand");
            const t = E("div", "t");
            const rb = E("input"); rb.type = "radio"; rb.name = "h3vcand";
            t.append(rb, E("span", null, `#${i + 1}`), E("span", "s", `seed ${c.seed}`));
            const au = E("audio");
            au.controls = true;
            au.src = c.audio;
            card.append(t, au);
            const choose = () => {
                rb.checked = true;
                cands.querySelectorAll(".h3v-cand").forEach((n) => n.classList.remove("on"));
                card.classList.add("on");
                st.picked = { fromBank: false, cand: c };
                use.disabled = false;
            };
            card.onclick = (e) => { if (e.target !== au) choose(); };
            rb.onchange = choose;
            cands.append(card);
        });
    }

    gen.onclick = async () => {
        if (st.busy) return;
        if (st.mode === "clone" && !st.refAudio) { msg("先选一段参考音频", "bad"); return; }
        st.busy = true; gen.disabled = true;
        const t0 = performance.now();
        const tick = setInterval(() => {
            msg(`生成中… ${((performance.now() - t0) / 1000).toFixed(0)}s`
                + `（${st.count} 条，首次调用要装载模型）`);
        }, 500);
        try {
            const d = await post("/generate", {
                mode: st.mode,
                text: textTa.value,
                instruction: instrTa.value,
                language: st.language,
                count: st.count,
                seed: parseInt(seedIn.value, 10) || 0,
                ref_audio: st.mode === "clone" ? st.refAudio : undefined,
                ref_text: refTextIn.value,
            });
            clearInterval(tick);
            renderCandidates(d.candidates || []);
            msg(`出了 ${d.candidates.length} 条，用了 ${d.seconds}s。逐条听，挑一条。`, "ok");
        } catch (e) {
            clearInterval(tick);
            msg(`生成失败：${e.message}`, "bad");
        } finally {
            st.busy = false; gen.disabled = false;
        }
    };

    use.onclick = async () => {
        if (!st.picked) return;
        if (st.picked.fromBank) { opt.onPick(st.picked.entry); close(); return; }
        use.disabled = true;
        try {
            const d = await post("/save", {
                audio: st.picked.cand.audio,
                name: opt.entityName || "voice",
                mode: st.mode,
                instruction: instrTa.value,
                language: st.language,
                seed: st.picked.cand.seed,
            });
            opt.onPick(d.entry);
            close();
        } catch (e) {
            msg(`保存失败：${e.message}`, "bad");
            use.disabled = false;
        }
    };

    setMode("design");
    return mask;
}
