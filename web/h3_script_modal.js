/**
 * 剧本编辑弹窗（v3：实体模型）。
 *
 * 左栏 = 可拖时间轴 + 导航（实体 / 全局 / 各分镜）
 * 右栏 = 当前选中项的编辑区
 *
 * 使用者只填内容；Subject/Speaker 编号、时间码、<d> 标签、官方绑定句
 * 在生成时由 assemble() 补全。自由文本里用 @名字 引用实体，下方实时显示解析结果。
 */

import {
    assemble, validate, entityProblems, beatSentence, resolveRefs, danglingRefs,
    blankScript, blankShot, blankLine, blankEntity, blankBinding, blankBeat,
    migrateScript, castPlan, castBadge, bindingRetention, mediaRetention,
    retentionSet, entityBoundMedia, SCRIPT_PROP,
    SECTIONS, MEDIA_ROLES, ENTITY_KINDS, BEAT_KINDS,
    CAMERA_MOTIONS, CAMERA_AMPLITUDE, CAMERA_SPEED,
    SHOT_SIZES, CAMERA_ANGLES, TRANSITIONS, VOICE_MODES, CONTINUITY,
    DELIVERY_PRESETS, LANGUAGES, TASK_TYPES, taskTypes, lineRefName, lineRefs,
    SPEECH, spokenChars, speechSeconds,
} from "./h3_script_editor.js";
import { framingWarning } from "./h3_grammar.js";
import { openCaptionDialog } from "./h3_caption.js";
import { openVoiceStudio } from "./h3_voice.js";
import { releaseAuxModels } from "./h3_caption.js";

/** 「不保留」常用项。与 caption.py 的 SHEET_TAGS 中文值保持一致，
 *  这样反推自动勾选加进来的和手动点的会去重，不会出现两条一样的。 */
const NOT_RETAINED_PRESETS = [
    "参考图的白色背景", "参考图的纯色背景", "三视图/多视角排版", "转身图排版",
    "设定稿版式", "参考图的张臂姿势", "参考图的 T-pose 站姿", "参考图的全身站位",
    "直视镜头的姿态", "参考图的侧面视角", "参考图的背面视角", "画师签名", "水印",
    "图上的角色名文字",
];

const CSS = `
.h3m-mask{position:fixed;inset:0;background:rgba(8,9,12,.72);z-index:10000;display:flex;
  align-items:center;justify-content:center;backdrop-filter:blur(3px)}
.h3m{--bg:#1e2027;--bg2:#252831;--bg3:#2d313c;--line:#363b47;--txt:#e8eaee;--dim:#8b93a1;
  --accent:#4d8dff;--warn:#ff7a7a;--ok:#67c98a;
  background:var(--bg);color:var(--txt);width:min(1560px,97vw);height:min(1040px,95vh);
  border-radius:14px;display:flex;flex-direction:column;overflow:hidden;
  box-shadow:0 24px 70px rgba(0,0,0,.6);border:1px solid var(--line);
  font:var(--h3m-fs,15px)/1.6 system-ui,"Segoe UI","Microsoft YaHei",sans-serif}
.h3m *{box-sizing:border-box}
.h3m-zoom{display:flex;align-items:center;gap:4px;flex:0 0 auto}
.h3m-zoom .h3m-mini{min-width:34px;text-align:center;font-variant-numeric:tabular-nums}
.h3m-hd{display:flex;align-items:center;gap:16px;padding:13px 18px;background:var(--bg2);
  border-bottom:1px solid var(--line);flex:0 0 auto}
.h3m-hd h2{margin:0;font-size:calc(var(--h3m-fs,15px)*1.111);font-weight:600;letter-spacing:.3px}
.h3m-main{flex:1;display:flex;min-height:0}
/* 时间轴是横向的东西，塞进 258px 窄栏根本看不清刻度。提到顶上占满宽度。 */
.h3m-tlbar{flex:0 0 auto;padding:10px 18px 6px;background:var(--bg2);
  border-bottom:1px solid var(--line)}
.h3m-tlbar .h3m-tl{height:40px}
/* 导航分组：设定（整片）与分镜（时间线）不是同一层东西 */
.h3m-grp{font-size:calc(var(--h3m-fs,15px)*0.778);color:var(--dim);letter-spacing:.6px;padding:10px 10px 4px;
  text-transform:uppercase}
.h3m-grp:first-child{padding-top:2px}
.h3m-rail{width:calc(var(--h3m-fs,15px)*18.7);flex:0 0 auto;border-right:1px solid var(--line);background:var(--bg2);
  display:flex;flex-direction:column;min-height:0}
.h3m-rail-top{padding:12px 12px 8px;flex:0 0 auto}
.h3m-rail-list{flex:1;overflow:auto;padding:0 10px 12px}
.h3m-rail-ft{flex:0 0 auto;padding:10px 12px;border-top:1px solid var(--line)}
/* 内容列限宽：右栏可以有 970px，但一行塞 110 个汉字没法扫读。
   限到 62em 左右，剩下的留白比硬撑满一行更好读。 */
.h3m-pane{flex:1;overflow:auto;padding:18px 22px 28px;min-width:0}
.h3m-pane>*{max-width:64em}
.h3m-ft{flex:0 0 auto;border-top:1px solid var(--line);background:var(--bg2);
  padding:11px 18px;display:flex;gap:12px;align-items:center}
.h3m-nav{display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:8px;
  cursor:pointer;margin-bottom:4px;border:1px solid transparent;user-select:none}
.h3m-nav:hover{background:var(--bg3)}
.h3m-nav.on{background:#25406e;border-color:var(--accent)}
.h3m-nav .n{background:var(--bg3);border-radius:5px;min-width:22px;text-align:center;
  font-size:calc(var(--h3m-fs,15px)*0.852);padding:1px 5px;color:var(--dim)}
.h3m-nav.on .n{background:var(--accent);color:#fff}
.h3m-nav .t{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:calc(var(--h3m-fs,15px)*0.926)}
.h3m-nav .b{color:var(--warn);font-size:calc(var(--h3m-fs,15px)*0.889)}
.h3m-nav .gr{cursor:grab;color:#5d6675;font-size:calc(var(--h3m-fs,15px)*0.963);line-height:1;letter-spacing:-1px}
.h3m-nav.drag{opacity:.4}
.h3m-nav.over{box-shadow:inset 0 2px 0 var(--accent)}
.h3m-nav.over-end{box-shadow:inset 0 -2px 0 var(--accent)}
/* 分镜之间的插入槽：平时只留一条细缝，悬停才展开 */
.h3m-ins{height:6px;margin:-2px 0;display:flex;align-items:center;justify-content:center;
  cursor:pointer;border-radius:4px;transition:height .1s,background .1s}
.h3m-ins:hover{height:20px;background:#25406e}
.h3m-ins i{display:block;width:100%;height:2px;border-radius:2px;background:transparent;
  transition:background .1s}
.h3m-ins:hover i{display:none}
.h3m-ins span{display:none;font-size:calc(var(--h3m-fs,15px)*0.815);color:#a8c6ff;white-space:nowrap}
.h3m-ins:hover span{display:block}

/* 可折叠区块：一次性配置默认收起，标题行给出摘要，不用展开也知道设了什么 */
.h3m-sec{border:1px solid var(--line);border-radius:9px;margin-bottom:12px;background:var(--bg2)}
.h3m-sec>summary{list-style:none;cursor:pointer;padding:9px 12px;display:flex;
  align-items:center;gap:9px;font-size:calc(var(--h3m-fs,15px)*0.963);font-weight:600;user-select:none}
.h3m-sec>summary::-webkit-details-marker{display:none}
.h3m-sec>summary::before{content:"▸";color:var(--dim);font-size:calc(var(--h3m-fs,15px)*0.815);transition:transform .12s}
.h3m-sec[open]>summary::before{transform:rotate(90deg)}
.h3m-sec>summary:hover{background:var(--bg3);border-radius:8px}
.h3m-sec>summary .sum{margin-left:auto;font-weight:400;font-size:calc(var(--h3m-fs,15px)*0.852);color:var(--dim);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:56%}
/* details 折叠时必须显式藏掉内容：给 .bd 设了 display 之后，
   浏览器默认的「非 summary 子元素隐藏」规则就失效了，内容会溢出在外面。 */
.h3m-sec>.bd{display:none;padding:2px 12px 12px}
.h3m-sec[open]>.bd{display:block}
.h3m-cnt{font-weight:400;font-size:calc(var(--h3m-fs,15px)*0.852);color:var(--dim);margin-left:6px}

/* 校验问题清单：可点，点了跳到出问题的地方 */
.h3m-issues{position:absolute;left:14px;right:14px;bottom:52px;max-height:46%;overflow:auto;
  background:var(--bg2);border:1px solid var(--line);border-radius:10px;z-index:15;
  box-shadow:0 -8px 26px rgba(0,0,0,.45);padding:6px}
.h3m-issue{display:flex;gap:9px;align-items:flex-start;padding:7px 10px;border-radius:7px;
  font-size:calc(var(--h3m-fs,15px)*0.889);line-height:1.6;cursor:pointer}
.h3m-issue:hover{background:var(--bg3)}
.h3m-issue .w{color:var(--warn);flex:0 0 auto}
.h3m-issue .go{margin-left:auto;color:var(--accent);font-size:calc(var(--h3m-fs,15px)*0.815);white-space:nowrap;flex:0 0 auto}
.h3m-stat{cursor:pointer;user-select:none;border-radius:6px;padding:2px 8px}
.h3m-stat:hover{background:var(--bg3)}

/* @ 自动补全：打 @ 直接出候选，上下键选、回车/Tab 确认 */
.h3m-ac{position:fixed;z-index:10050;background:var(--bg2);border:1px solid var(--accent);
  border-radius:9px;box-shadow:0 10px 30px rgba(0,0,0,.55);padding:4px;min-width:210px;
  max-height:240px;overflow:auto}
.h3m-ac-item{display:flex;gap:8px;align-items:center;padding:6px 9px;border-radius:6px;
  font-size:calc(var(--h3m-fs,15px)*0.926);cursor:pointer;white-space:nowrap}
.h3m-ac-item.on{background:#25406e}
.h3m-ac-item .k{flex:0 0 auto}
.h3m-ac-item .nm{flex:1;overflow:hidden;text-overflow:ellipsis}
.h3m-ac-item .id{font-family:ui-monospace,Consolas,monospace;font-size:calc(var(--h3m-fs,15px)*0.778);color:var(--dim)}
.h3m-lineref{font-family:ui-monospace,Consolas,monospace;
  font-size:calc(var(--h3m-fs,15px)*0.815);background:#233a63;border:1px solid #35538c;
  color:#a8c6ff;border-radius:5px;padding:0 7px;cursor:pointer;user-select:none}
.h3m-lineref:hover{background:#2b4778}
.h3m-lineref.copied{background:#1e3a2a;border-color:#2f6448;color:#67c98a}
.h3m-ac-empty{padding:7px 10px;font-size:calc(var(--h3m-fs,15px)*0.889);color:var(--dim)}

.h3m-tl{position:relative;height:34px;border-radius:6px;border:1px solid var(--line);
  overflow:hidden;margin:5px 0 4px;user-select:none;background:#191b21}
.h3m-seg{position:absolute;top:0;bottom:0;display:grid;place-items:center;font-size:calc(var(--h3m-fs,15px)*0.778);
  color:#cfd5e0;cursor:pointer;overflow:hidden;white-space:nowrap;transition:filter .12s}
.h3m-seg:hover{filter:brightness(1.3)}
.h3m-seg.on{outline:2px solid var(--accent);outline-offset:-2px;z-index:1}
.h3m-grip{position:absolute;top:0;bottom:0;width:11px;margin-left:-5px;cursor:col-resize;z-index:3}
.h3m-grip::after{content:"";position:absolute;left:4px;top:3px;bottom:3px;width:3px;
  border-radius:2px;background:#7d879a}
.h3m-grip:hover::after,.h3m-grip.drag::after{background:var(--accent);top:0;bottom:0}
.h3m-bub{position:absolute;top:-24px;transform:translateX(-50%);background:var(--accent);
  color:#fff;font-size:calc(var(--h3m-fs,15px)*0.815);padding:1px 7px;border-radius:5px;white-space:nowrap;
  pointer-events:none;z-index:4}
.h3m-ruler{position:relative;height:13px;color:var(--dim);font-size:calc(var(--h3m-fs,15px)*0.741)}
.h3m-ruler span{position:absolute;transform:translateX(-50%)}

.h3m h3{margin:0 0 5px;font-size:calc(var(--h3m-fs,15px)*1.0);font-weight:600;display:flex;align-items:center;gap:7px}
.h3m-tag{font-size:calc(var(--h3m-fs,15px)*0.741);font-weight:400;padding:0 6px;border-radius:9px;line-height:16px}
.h3m-tag.un{background:#3a3320;border:1px solid #6b5a2a;color:#e0c476}
.h3m-hint{color:var(--dim);font-size:calc(var(--h3m-fs,15px)*0.852);line-height:1.55;margin-bottom:9px}
.h3m-fld{margin-bottom:16px}
.h3m-row{display:flex;gap:9px;align-items:center;flex-wrap:wrap}
.h3m-lab{color:var(--dim);font-size:calc(var(--h3m-fs,15px)*0.852)}
.h3m input,.h3m select,.h3m textarea{background:var(--bg3);border:1px solid var(--line);
  color:var(--txt);border-radius:6px;padding:6px 9px;font:inherit;outline:none;max-width:100%}
.h3m input:focus,.h3m select:focus,.h3m textarea:focus{border-color:var(--accent)}
.h3m textarea{width:100%;resize:vertical;min-height:76px}
.h3m-btn{background:var(--bg3);border:1px solid var(--line);color:var(--txt);border-radius:7px;
  padding:6px 14px;cursor:pointer;font:inherit}
.h3m-btn:hover{background:#39404e}
.h3m-btn:disabled{opacity:.4;cursor:default}
.h3m-btn.pri{background:var(--accent);border-color:#5c99ff}
.h3m-btn.pri:hover{filter:brightness(1.1)}
.h3m-btn.gh{background:transparent;color:var(--dim)}
.h3m-btn.sm{padding:3px 9px;font-size:calc(var(--h3m-fs,15px)*0.889)}
.h3m-btn.full{width:100%}
.h3m-step{display:inline-flex;align-items:center}
.h3m-step button{width:26px;padding:6px 0;background:var(--bg3);border:1px solid var(--line);
  color:var(--txt);cursor:pointer;font:inherit}
.h3m-step button:first-child{border-radius:6px 0 0 6px}
.h3m-step button:last-child{border-radius:0 6px 6px 0}
.h3m-step button:hover{background:#39404e}
.h3m-step input{width:62px;border-radius:0;border-left:none;border-right:none;text-align:center}
.h3m-line{border:1px solid var(--line);border-radius:9px;padding:11px 12px;margin-bottom:9px;background:var(--bg2)}
.h3m-line-hd{display:flex;gap:9px;align-items:center;margin-bottom:8px;flex-wrap:wrap}
.h3m-chip{display:inline-flex;align-items:center;gap:6px;background:var(--bg3);border:1px solid var(--line);
  border-radius:22px;padding:3px 11px 3px 3px;font-size:calc(var(--h3m-fs,15px)*0.889);cursor:pointer;user-select:none}
.h3m-chip:hover{border-color:#4a5262}
.h3m-chip.on{background:#25406e;border-color:var(--accent)}
.h3m-chip img{width:24px;height:24px;border-radius:50%;object-fit:cover}
.h3m-chip .ic{width:24px;height:24px;border-radius:50%;background:#454b5a;display:grid;place-items:center;font-size:calc(var(--h3m-fs,15px)*0.889)}
.h3m-note{border-radius:8px;padding:9px 12px;font-size:calc(var(--h3m-fs,15px)*0.889);line-height:1.65;margin-bottom:12px}
.h3m-note.warn{background:#3a2424;border:1px solid #6e3636;color:#ffb8b8}
.h3m-banner{display:flex;gap:10px;align-items:flex-start;background:#3a2f1e;border:1px solid #6e5a2f;
  color:#f0d9a6;padding:9px 14px;font-size:calc(var(--h3m-fs,15px)*0.889);line-height:1.6;flex:0 0 auto}
.h3m-banner div{white-space:pre-wrap;flex:1;min-width:0}
.h3m-banner button{margin-left:auto;background:transparent;border:none;color:inherit;cursor:pointer;font:inherit}
.h3m-mini{color:var(--dim);font-size:calc(var(--h3m-fs,15px)*0.852)}
.h3m-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:9px}
.h3m-grid label{display:flex;flex-direction:column;gap:4px}
.h3m-grid label>span{color:var(--dim);font-size:calc(var(--h3m-fs,15px)*0.852)}
.h3m-cks{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:6px}
.h3m-ck{display:flex;gap:7px;align-items:flex-start;padding:6px 9px;border-radius:7px;
  border:1px solid var(--line);background:var(--bg2);cursor:pointer}
.h3m-ck.on{background:#25406e;border-color:var(--accent)}
.h3m-ck input{margin-top:3px}
.h3m-ck input:disabled{opacity:.7}
.h3m-ck em{font-style:normal;color:var(--dim);font-size:calc(var(--h3m-fs,15px)*0.815);display:block}
.h3m-auto{margin-left:7px;font-size:calc(var(--h3m-fs,15px)*0.741);padding:0 6px;border-radius:9px;line-height:16px;
  background:#1e3a2a;border:1px solid #2f6448;color:#67c98a;white-space:nowrap}
/* 保存遮罩：翻译要十几秒，底栏小字看不见，得盖住整个弹窗 */
.h3m-busy{position:absolute;inset:0;background:rgba(20,22,27,.86);z-index:20;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;
  backdrop-filter:blur(2px)}
.h3m-busy .ttl{font-size:calc(var(--h3m-fs,15px)*1.111);font-weight:600}
.h3m-busy .sub{font-size:calc(var(--h3m-fs,15px)*0.926);color:var(--dim);max-width:70%;text-align:center;line-height:1.7}
.h3m-busy .bar{width:min(420px,62%);height:5px;border-radius:3px;background:var(--bg3);overflow:hidden}
.h3m-busy .bar i{display:block;height:100%;width:36%;border-radius:3px;background:var(--accent);
  animation:h3mslide 1.1s ease-in-out infinite}
@keyframes h3mslide{0%{margin-left:-36%}100%{margin-left:100%}}
.h3m-busy .el{font-family:ui-monospace,Consolas,monospace;font-size:calc(var(--h3m-fs,15px)*0.889);color:var(--dim)}
.h3m-pick{display:inline-flex;align-items:center;background:transparent;color:var(--dim);
  border:1px dashed var(--line);border-radius:22px;padding:3px 11px;font-size:calc(var(--h3m-fs,15px)*0.889);
  cursor:pointer;user-select:none}
.h3m-pick:hover{border-color:var(--accent);border-style:solid;color:var(--txt)}

/* 实体卡 */
.h3m-ent{border:1px solid var(--line);border-radius:10px;padding:12px 13px;margin-bottom:11px;background:var(--bg2)}
.h3m-ent.dim{opacity:.72}
.h3m-ent-hd{display:flex;gap:9px;align-items:center;margin-bottom:9px;flex-wrap:wrap}
.h3m-ent-hd input.nm{width:132px;font-weight:600}
.h3m-id{font-family:ui-monospace,Consolas,monospace;font-size:calc(var(--h3m-fs,15px)*0.815);background:#233a63;
  border:1px solid #35558f;color:#a8c6ff;border-radius:5px;padding:1px 7px;white-space:nowrap}
.h3m-id.none{background:#33363f;border-color:#454b5a;color:var(--dim)}
.h3m-bind{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:7px 9px;margin-top:7px;
  border:1px dashed var(--line);border-radius:8px}
.h3m-beat{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 10px;margin-bottom:7px;
  border:1px solid var(--line);border-radius:8px;background:var(--bg2)}
.h3m-prev{font-family:ui-monospace,Consolas,monospace;font-size:calc(var(--h3m-fs,15px)*0.852);color:#9fd2b0;
  background:#1b2620;border:1px solid #2f4a39;border-radius:7px;padding:7px 10px;margin-top:7px;
  white-space:pre-wrap;word-break:break-word}
.h3m-prev.bad{color:#ffb8b8;background:#2b1e1e;border-color:#5d3434}
.h3m-refs{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px;align-items:center}
.h3m-ref{background:#233a63;border:1px solid #35558f;color:#a8c6ff;border-radius:14px;
  padding:1px 10px;font-size:calc(var(--h3m-fs,15px)*0.852);cursor:pointer;user-select:none}
.h3m-ref:hover{filter:brightness(1.25)}
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

function dd(opts, value, onChange, title) {
    const s = E("select");
    for (const o of opts) {
        const op = E("option");
        op.value = typeof o === "string" ? o : o.id;
        op.textContent = typeof o === "string" ? o : o.label;
        s.append(op);
    }
    s.value = value ?? "";
    if (title) s.title = title;
    s.addEventListener("change", () => onChange(s.value));
    return s;
}

function labeled(text, el) {
    const l = E("label");
    l.append(E("span", null, text), el);
    return l;
}

/**
 * 可折叠区块。一次性配置默认收起，标题行给出摘要——
 * 不展开也知道设了什么，改文案时不用滚过一堆配置。
 */
function section(title, { open = true, summary = "", count = null } = {}) {
    const d = E("details", "h3m-sec");
    d.open = open;
    const s = E("summary");
    s.append(E("span", null, title));
    if (count != null) s.append(E("span", "h3m-cnt", count));
    const sum = E("span", "sum", summary);
    s.append(sum);
    const bd = E("div", "bd");
    d.append(s, bd);
    d.body = bd;
    d.setSummary = (t) => { sum.textContent = t; };
    return d;
}

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
 *   true   —— 保存成功，关闭
 *   string —— 保存没生效，弹窗留着并在顶部显示这句话
 */
/**
 * @param onVoicePicked(entry) 可选。生成好的音色落盘后调它，由调用方在图里建
 *   LoadAudio 节点并接进 media 口，返回新的 mediaKey；返回空则只落盘不绑定。
 */
/** 字号偏好跨会话记住——每次打开都要重调一遍是没人受得了的 */
const FS_KEY = "minimax_h3_script_fs";
const FS_MIN = 12;
const FS_MAX = 22;
const FS_DEFAULT = 15;

function savedFontPx() {
    try {
        const v = parseFloat(localStorage.getItem(FS_KEY));
        if (Number.isFinite(v)) return Math.min(FS_MAX, Math.max(FS_MIN, v));
    } catch { /* 隐私模式下 localStorage 会抛 */ }
    return FS_DEFAULT;
}

export function openScriptModal(node, mediaList, onSave, onVoicePicked) {
    ensureStyle();
    let fontPx = savedFontPx();
    const S = migrateScript(node.properties?.[SCRIPT_PROP]);
    let sel = S.shots.length ? 0 : "cast";
    let lastRemoved = null;          // 「不保留」最近移除的一条，供撤销
    let issuePanel = null;           // 校验问题清单（Esc 先关它）          // 「不保留」最近移除的一条，供撤销

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

    // 字号档位。整个弹窗的字号都是 calc(var(--h3m-fs) * k)，改这一个变量就整体缩放。
    const zoomWrap = E("div", "h3m-zoom");
    const zoomLab = E("span", "h3m-mini");
    const applyFs = (px) => {
        fontPx = Math.min(FS_MAX, Math.max(FS_MIN, px));
        box.style.setProperty("--h3m-fs", fontPx + "px");
        zoomLab.textContent = fontPx + "px";
        try { localStorage.setItem(FS_KEY, String(fontPx)); } catch { /* 隐私模式 */ }
    };
    const smaller = E("button", "h3m-btn sm gh", "A−");
    smaller.title = "缩小字号";
    smaller.onclick = () => applyFs(fontPx - 1);
    const bigger = E("button", "h3m-btn sm gh", "A+");
    bigger.title = "放大字号";
    bigger.onclick = () => applyFs(fontPx + 1);
    zoomWrap.append(smaller, zoomLab, bigger);
    hd.append(zoomWrap);

    const x = E("button", "h3m-btn gh", "✕");
    x.onclick = () => close();
    hd.append(x);
    applyFs(fontPx);

    /* --------------------------------------------------------- 内嵌提示条 */
    const banner = E("div", "h3m-banner");
    banner.style.display = "none";
    const bannerTxt = E("div");
    const bannerX = E("button", null, "✕");
    bannerX.onclick = () => { banner.style.display = "none"; };
    banner.append(bannerTxt, bannerX);
    const notify = (msg) => { bannerTxt.textContent = msg; banner.style.display = "flex"; };

    /* ------------------------------------------------------------ 主体 */
    const tlBar = E("div", "h3m-tlbar");
    const main = E("div", "h3m-main");
    const rail = E("div", "h3m-rail");
    const railTop = tlBar;
    const railList = E("div", "h3m-rail-list");
    const railFt = E("div", "h3m-rail-ft");
    const addBtn = E("button", "h3m-btn full", "+ 在末尾新增分镜");
    addBtn.onclick = () => {
        const last = S.shots.at(-1);
        if (!S.shots.length) S.shots.push(blankShot(0));
        else {
            const room = S.duration - last.cutAt;
            if (room < 0.8) { notify("最后一镜到片尾不足 0.8 秒，先拖长总时长或把分界线往左拖。"); return; }
            S.shots.push(blankShot(+(last.cutAt + room / 2).toFixed(1)));
        }
        sel = S.shots.length - 1;
        draw();
    };
    railFt.append(addBtn);
    rail.append(railList, railFt);
    const pane = E("div", "h3m-pane");
    main.append(rail, pane);

    /* ------------------------------------------------------------ 底栏 */
    const ft = E("div", "h3m-ft");
    const stat = E("div", "h3m-mini");
    const sp1 = E("div"); sp1.style.flex = "1";
    const cancel = E("button", "h3m-btn gh", "取消");
    cancel.onclick = () => close();
    /** 保存遮罩。翻译要十几秒，底栏那行小字根本看不见 */
    function busyOverlay() {
        const el = E("div", "h3m-busy");
        const ttl = E("div", "ttl", "正在保存…");
        const sub = E("div", "sub", "把剧本拼成提示词");
        const bar = E("div", "bar"); bar.append(E("i"));
        const el2 = E("div", "el", "0.0s");
        el.append(ttl, sub, bar, el2);
        box.style.position = "relative";
        box.append(el);
        const t0 = performance.now();
        const tick = setInterval(() => {
            el2.textContent = ((performance.now() - t0) / 1000).toFixed(1) + "s";
        }, 100);
        return {
            say(title, detail) { ttl.textContent = title; if (detail) sub.textContent = detail; },
            done() { clearInterval(tick); el.remove(); },
        };
    }

    const ok = E("button", "h3m-btn pri", "保存并应用");
    ok.onclick = async () => {
        if (ok.disabled) return;
        ok.disabled = true;
        cancel.disabled = true;
        const busy = busyOverlay();
        try {
            const r = await onSave(structuredClone(S), (msg) => busy.say("正在保存…", msg));
            busy.done();
            if (r === true || r == null) { close(true); return; }
            notify(String(r));
        } catch (err) {
            busy.done();
            notify(`保存失败：${err.message}`);
        } finally {
            busy.done();
            ok.disabled = false;
            cancel.disabled = false;
            drawStatus();
        }
    };
    ft.append(stat, sp1, cancel, ok);

    box.append(hd, banner, tlBar, main, ft);
    mask.append(box);
    document.body.append(mask);

    const teardown = [];
    const pristine = JSON.stringify(S);
    function close(force) {
        if (!force && JSON.stringify(S) !== pristine &&
            !confirm("有未保存的改动，确定关闭并丢弃吗？")) return;
        teardown.forEach((f) => f());
        mask.remove();
        // 关掉编辑器 = 反推和音色都用完了，12GB 该还回去
        releaseAuxModels();
    }
    const onKey = (e) => {
        if (e.key === "Escape") {
            // 问题清单开着时，Esc 先关它，不要直接把编辑器也关了
            if (issuePanel) { issuePanel.remove(); issuePanel = null; return; }
            close();
            return;
        }
        // 在文本框里写完直接 Ctrl+Enter 保存，不用摸鼠标去点右下角
        if ((e.ctrlKey || e.metaKey) && (e.key === "Enter" || e.key === "s")) {
            e.preventDefault();
            ok.click();
        }
    };
    window.addEventListener("keydown", onKey);
    teardown.push(() => window.removeEventListener("keydown", onKey));
    mask.addEventListener("mousedown", (e) => { if (e.target === mask) close(); });

    /* ------------------------------------------------------------ 工具 */
    const shotEnd = (i) => (i + 1 < S.shots.length ? S.shots[i + 1].cutAt : S.duration);
    const MIN_SHOT = 0.3;
    const entName = (e, i) => e.name?.trim() || `实体 ${i + 1}`;
    const entOptions = (extra) => [
        ...(extra ? [{ id: "", label: extra }] : []),
        ...S.entities.map((e, i) => ({ id: e.id, label: `${kindOf(e).icon} ${entName(e, i)}` })),
    ];
    const kindOf = (e) => ENTITY_KINDS.find((k) => k.id === e.kind) || ENTITY_KINDS[0];

    /** 某实体在剧本里的第一句台词，用作音色试听文本 */
    function firstLineOf(entityId) {
        for (const sh of S.shots) {
            for (const ln of sh.lines) {
                if (ln.entityId === entityId && ln.text?.trim()) return ln.text.trim();
            }
        }
        return "";
    }

    function shotProblems(i) {
        const sh = S.shots[i];
        const out = [];
        const span = shotEnd(i) - sh.cutAt;
        let need = 0;
        for (const l of sh.lines) if (l.text?.trim()) need += SPEECH.padBefore + speechSeconds(l.text) + SPEECH.padAfter;
        if (need > span) out.push(`台词需 ${need.toFixed(1)}s，本镜只有 ${span.toFixed(1)}s`);
        const fw = framingWarning(sh);
        if (fw) out.push(fw);
        if (!sh.description?.trim() && !sh.beats.length) out.push("既没有画面描述也没有变更");
        for (const t of [sh.description, ...sh.beats.map((b) => b.text)]) {
            for (const bad of danglingRefs(t, S, sh)) out.push(`引用了不存在的实体「@${bad}」`);
        }
        return out;
    }

    function setShotLength(i, len) {
        const cur = shotEnd(i) - S.shots[i].cutAt;
        let delta = len - cur;
        if (i + 1 >= S.shots.length) {
            S.duration = Math.min(20, Math.max(S.shots[i].cutAt + MIN_SHOT, S.shots[i].cutAt + len));
            dur.value = S.duration;
            return;
        }
        const tailLen = S.duration - S.shots.at(-1).cutAt;
        delta = Math.min(delta, tailLen - MIN_SHOT);
        delta = Math.max(delta, MIN_SHOT - cur);
        for (let k = i + 1; k < S.shots.length; k++) {
            S.shots[k].cutAt = +(S.shots[k].cutAt + delta).toFixed(1);
        }
    }

    /* ------------------------------------------------------ 可拖拽时间轴 */
    let dropTimelineHooks = null;
    teardown.push(() => dropTimelineHooks?.());

    function buildTimeline() {
        dropTimelineHooks?.();
        const tl = E("div", "h3m-tl");
        const pct = (t) => (t / S.duration) * 100;
        const segs = [], grips = [];
        S.shots.forEach((sh, i) => {
            const dur = shotEnd(i) - sh.cutAt;
            const label = `${i + 1}　${(sh.description || "").trim().slice(0, 10) || "未填描述"}　${dur.toFixed(1)}s`;
            const d = E("div", "h3m-seg" + (sel === i ? " on" : ""), label);
            d.style.background = shotProblems(i).length ? "#5c3030" : (i % 2 ? "#333b4a" : "#3c4557");
            d.onclick = () => { sel = i; draw(); };
            segs.push(d); tl.append(d);
        });
        for (let k = 1; k < S.shots.length; k++) {
            const g = E("div", "h3m-grip");
            g.dataset.idx = String(k);
            g.title = "拖动改变前后两镜的分界点";
            grips.push(g); tl.append(g);
        }
        const bub = E("div", "h3m-bub");
        bub.style.display = "none";
        tl.append(bub);

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
            drag = { idx: +g.dataset.idx, g, rect: tl.getBoundingClientRect() };
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
        // 宽度够就每秒一格，不够再放稀。原来按时长硬编码，窄栏里挤成一团
        const w = railTop.clientWidth || 900;
        const step = w / S.duration >= 46 ? 1 : w / S.duration >= 24 ? 2 : 5;
        for (let t = 0; t <= S.duration + 1e-6; t += step) {
            const s = E("span", null, `${t}s`);
            s.style.left = (t / S.duration) * 100 + "%";
            if (t === 0) s.style.transform = "none";
            r.append(s);
        }
        return r;
    }

    /* ----------------------------------------------------------- 绘制 */
    /**
     * 校验结果要能点开、能跳过去。
     * 原来只把详情塞在 title 里：悬停才看得见，看见了也不知道在哪一镜。
     */
    function toggleIssues(all) {
        if (issuePanel) { issuePanel.remove(); issuePanel = null; return; }
        if (!all.length) return;
        const p = E("div", "h3m-issues");
        for (const msg of all) {
            const row = E("div", "h3m-issue");
            row.append(E("span", "w", "⚠"), E("span", null, msg));
            // 从文案里认出该跳到哪儿：「镜头 N」跳分镜，「实体/角色」跳实体表
            const m = /镜头\s*(\d+)/.exec(msg);
            const target = m ? { kind: "shot", i: +m[1] - 1 }
                : /实体|角色|音色|参考图/.test(msg) ? { kind: "cast" }
                : /「[^」]+」还没填|概述|环境音|配乐|不保留/.test(msg) ? { kind: "global" }
                : null;
            if (target) {
                row.append(E("span", "go", target.kind === "shot" ? `→ 镜头 ${m[1]}`
                                          : target.kind === "cast" ? "→ 实体" : "→ 全局"));
                row.onclick = () => {
                    sel = target.kind === "shot" ? Math.min(target.i, S.shots.length - 1)
                        : target.kind === "cast" ? "cast" : "global";
                    p.remove(); issuePanel = null;
                    draw();
                };
            } else {
                row.style.cursor = "default";
            }
            p.append(row);
        }
        box.style.position = "relative";
        box.append(p);
        issuePanel = p;
    }

    function drawStatus() {
        const all = validate(S, fakeTokens());
        stat.textContent = all.length ? `⚠ ${all.length} 个问题　点击查看` : "✅ 校验通过";
        stat.className = "h3m-mini" + (all.length ? " h3m-stat" : "");
        stat.style.color = all.length ? "var(--warn)" : "var(--ok)";
        stat.title = all.length ? "点击展开问题清单，可跳转到出问题的地方" : "";
        stat.onclick = all.length ? () => toggleIssues(all) : null;
        if (issuePanel) { issuePanel.remove(); issuePanel = null; }
    }

    /** 左栏（时间轴 + 导航）。全是不可聚焦的元素，重建不会抢焦点 */
    function drawRail() {
        railTop.innerHTML = "";
        const tlHd = E("div", "h3m-row");
        tlHd.append(E("span", "h3m-lab", "时间轴"));
        tlHd.append(E("span", "h3m-mini", `全片 ${S.duration}s ／ ${S.shots.length} 镜`));
        railTop.append(tlHd);
        if (S.shots.length) {
            railTop.append(buildTimeline(), buildRuler());
            railTop.append(E("div", "h3m-mini",
                "拖分界线改长度　·　点色块切到那一镜　·　插入与排序在左侧列表"));
        } else railTop.append(E("div", "h3m-mini", "尚无分镜"));

        railList.innerHTML = "";
        railList.append(E("div", "h3m-grp", "整片设定"));
        const plan = castPlan(S);
        const speaking = Object.values(plan).filter((p) => p.speaker).length;
        const cast = E("div", "h3m-nav" + (sel === "cast" ? " on" : ""));
        cast.append(E("span", "n", "◍"),
                    E("span", "t", `实体（${S.entities.length} 个 · ${speaking} 个有台词）`));
        if (entityProblems(S).length) cast.append(E("span", "b", "●"));
        cast.onclick = () => { sel = "cast"; draw(); };
        railList.append(cast);

        const g = E("div", "h3m-nav" + (sel === "global" ? " on" : ""));
        g.append(E("span", "n", "◈"), E("span", "t", "全局设置"));
        if (globalProblems().length) g.append(E("span", "b", "●"));
        g.onclick = () => { sel = "global"; draw(); };
        railList.append(g);

        // 分镜列表：结构操作（插入、排序）都在这里 —— 它们属于列表，
        // 不属于内容编辑区。插入槽平时是条细缝，悬停才展开成按钮。
        const insertAt = (idx) => {
            // idx = 插在第 idx 个位置。从相邻分镜里劈一半出来，其他时间点不动
            const prev = S.shots[idx - 1];
            const start = prev ? prev.cutAt : 0;
            const end = idx < S.shots.length ? S.shots[idx].cutAt : S.duration;
            const span = end - start;
            if (span < MIN_SHOT * 2) {
                notify(`这里只有 ${span.toFixed(1)}s，劈不出两段。先把相邻分镜拖长些。`);
                return;
            }
            S.shots.splice(idx, 0, blankShot(+(start + span / 2).toFixed(1)));
            if (idx === 0) { S.shots[0].cutAt = 0; S.shots[1].cutAt = +(span / 2).toFixed(1); }
            sel = idx;
            draw();
        };
        const slot = (idx) => {
            const s = E("div", "h3m-ins");
            s.append(E("i"), E("span", null, "＋ 在此插入分镜"));
            s.title = "在这个位置插入一个新分镜";
            s.onclick = () => insertAt(idx);
            return s;
        };

        let dragFrom = null;
        railList.append(E("div", "h3m-grp", `分镜　${S.shots.length} 个`));
        S.shots.forEach((sh, i) => {
            railList.append(slot(i));
            const n = E("div", "h3m-nav" + (sel === i ? " on" : ""));
            n.draggable = true;
            n.append(E("span", "gr", "⠿"));
            n.append(E("span", "n", String(i + 1)));
            const title = (sh.description || "").trim().slice(0, 12) || "（未填描述）";
            n.append(E("span", "t", `${sh.cutAt.toFixed(1)}s  ${title}`));
            if (shotProblems(i).length) n.append(E("span", "b", "●"));
            n.onclick = () => { sel = i; draw(); };

            n.addEventListener("dragstart", (ev) => {
                dragFrom = i;
                n.classList.add("drag");
                ev.dataTransfer.effectAllowed = "move";
                ev.dataTransfer.setData("text/plain", String(i));
            });
            n.addEventListener("dragend", () => {
                dragFrom = null;
                railList.querySelectorAll(".h3m-nav").forEach(
                    (x) => x.classList.remove("drag", "over", "over-end"));
            });
            n.addEventListener("dragover", (ev) => {
                if (dragFrom === null || dragFrom === i) return;
                ev.preventDefault();
                const after = ev.offsetY > n.offsetHeight / 2;
                n.classList.toggle("over", !after);
                n.classList.toggle("over-end", after);
            });
            n.addEventListener("dragleave", () => n.classList.remove("over", "over-end"));
            n.addEventListener("drop", (ev) => {
                ev.preventDefault();
                const from = dragFrom;
                if (from === null || from === i) return;
                let to = i + (ev.offsetY > n.offsetHeight / 2 ? 1 : 0);
                if (from < to) to -= 1;
                if (from === to) return;
                // 时长跟着分镜走。一个分镜就是「内容 + 时长」的整体，
                // 若只换内容，被移动的那镜会捡到目标位置原本的时长——
                // 那是个跟它无关的数字。
                const durs = S.shots.map((x, k) => shotEnd(k) - x.cutAt);
                const [movedDur] = durs.splice(from, 1);
                durs.splice(to, 0, movedDur);
                const [moved] = S.shots.splice(from, 1);
                S.shots.splice(to, 0, moved);
                // 起点按新顺序累加重算。各段时长之和恒等于总时长，所以总长不变
                let t = 0;
                S.shots.forEach((x, k) => { x.cutAt = +t.toFixed(2); t += durs[k]; });
                S.shots[0].cutAt = 0;
                sel = to;
                draw();
            });
            railList.append(n);
        });
        railList.append(slot(S.shots.length));
    }

    /** 结构变化时才用它：会重建右栏，输入焦点会丢 */
    function draw() {
        softHooks.length = 0;
        drawRail();
        pane.innerHTML = "";
        if (sel === "cast") drawCast();
        else if (sel === "global") drawGlobal();
        else if (S.shots[sel]) drawShot(S.shots[sel], sel);
        else { sel = "cast"; drawCast(); }
        drawStatus();
    }

    /**
     * 输入框失焦后只刷新派生显示，绝不重建右栏。
     *
     * 原来所有文本控件都挂 change -> draw()。change 在失焦时触发，draw() 把整个
     * 面板拆了重建，于是「打完字去点别的东西」那一下点击落在已被销毁的元素上
     * ——用户看到的就是「点了没反应，很卡顿」，实体改名也因此难用。
     * 派生显示（导航标题、角标、校验计数）由这里就地更新，输入框不动。
     */
    const softHooks = [];

    function softRefresh() {
        for (const fn of softHooks) {
            try { fn(); } catch { /* 单个角标坏了不该拖垮整次刷新 */ }
        }
        drawRail();
        drawStatus();
    }

    /** 输入时更新数据 + 轻量刷新；失焦不做任何重建 */
    function bindText(el, setter) {
        el.addEventListener("input", () => { setter(el.value); softRefresh(); });
    }

    function globalProblems() {
        return SECTIONS.filter((s) => s.required && !s.auto && !S.sections[s.key]?.trim());
    }

    /* ------------------------------------------------------- 实体面板 */
    function drawCast() {
        const plan = castPlan(S);
        const probs = entityProblems(S);
        if (probs.length) {
            const n = E("div", "h3m-note warn");
            probs.forEach((p) => n.append(E("div", null, "• " + p)));
            pane.append(n);
        }
        pane.append(E("h3", null, "实体"));
        pane.append(E("div", "h3m-hint",
            "官方的 <Subject N> 不只是「角色」——人物、衣服、道具、场景、动作都各占一个编号，" +
            "镜头里再用 @名字 引用它们。要中途换的两件衣服就建成两个物件实体，" +
            "在分镜的「变更」里写谁在什么时候换成哪件。" +
            "编号全自动：Subject 按实体顺序，(S1)(S2) 按谁先开口，两套互不相干。"));

        S.entities.forEach((e, i) => {
            const p = plan[e.id];
            const k = kindOf(e);
            const card = E("div", "h3m-ent" + (e.visible === false ? " dim" : ""));

            const hd2 = E("div", "h3m-ent-hd");
            const nm = E("input", "nm");
            nm.placeholder = `实体 ${i + 1}`; nm.value = e.name || "";
            nm.title = "镜头描述里用 @这个名字 引用它";
            bindText(nm, (v) => { e.name = v; });
            hd2.append(nm);

            hd2.append(dd(ENTITY_KINDS.map((x) => ({ id: x.id, label: `${x.icon} ${x.label}` })), e.kind,
                (v) => {
                    e.kind = v;
                    const nk = ENTITY_KINDS.find((x) => x.id === v);
                    e.visible = nk.visible;
                    for (const b of e.bindings) if (!b.kind || b.kind === k.id) b.kind = v;
                    if (!nk.canSpeak) e.voiceKey = "";
                    draw();
                }, k.hint));

            const badge = E("span", "h3m-id" + (p.subject || p.speaker ? "" : " none"), castBadge(p));
            badge.title = "生成时实际使用的编号";
            hd2.append(badge);
            // 编号依赖名字与台词，改名后就地更新角标，不重建卡片（否则输入焦点会丢）
            softHooks.push(() => {
                const np = castPlan(S)[e.id];
                if (!np) return;
                badge.textContent = castBadge(np);
                badge.className = "h3m-id" + (np.subject || np.speaker ? "" : " none");
            });

            const vis = E("label");
            vis.style.cssText = "display:inline-flex;gap:6px;align-items:center;font-size:12px;color:var(--dim)";
            const cb = E("input"); cb.type = "checkbox"; cb.checked = e.visible !== false;
            cb.addEventListener("change", () => { e.visible = cb.checked; draw(); });
            vis.append(cb, E("span", null, "出现在画面里"));
            vis.title = "取消勾选 = 不占 <Subject N>（画外音、整片画风）";
            hd2.append(vis);

            if (k.canSpeak) {
                hd2.append(dd([{ id: "", label: `语言：跟随全局（${S.language}）` },
                               ...LANGUAGES.map((l) => ({ id: l, label: `语言：${l}` }))],
                              e.language || "", (v) => { e.language = v; },
                              "这个实体的台词用什么语种发送 <d>[Lang]…</d>"));
            }

            const sp = E("div"); sp.style.flex = "1"; hd2.append(sp);
            const up = E("button", "h3m-btn gh sm", "↑");
            up.disabled = i === 0;
            up.title = "上移会改变 <Subject N> 的编号";
            up.onclick = () => { S.entities.splice(i - 1, 0, S.entities.splice(i, 1)[0]); draw(); };
            const del = E("button", "h3m-btn gh sm", "删除");
            del.onclick = () => {
                const lines = S.shots.reduce((n2, sh) =>
                    n2 + sh.lines.filter((l) => l.entityId === e.id && l.text?.trim()).length, 0);
                const beats = S.shots.reduce((n2, sh) =>
                    n2 + sh.beats.filter((b) => [b.actor, b.target, b.recipient].includes(e.id)).length, 0);
                if ((lines || beats) && !confirm(
                    `「${e.name || "该实体"}」还被 ${lines} 句台词、${beats} 条变更引用，删除后这些引用会失效。继续？`)) return;
                S.entities.splice(i, 1);
                draw();
            };
            hd2.append(up, del);
            card.append(hd2);

            const ta = E("textarea");
            ta.style.minHeight = "54px";
            ta.placeholder = k.id === "identity"
                ? "外观：发型发色、五官、服装、体型。颜色务必写排除项，例如 hair is jet black, NOT orange"
                : k.id === "style" ? "画风：线条粗细、上色方式、色板、饱和度"
                : "这是什么、长什么样。也可以在这里 @ 引用其他实体";
            ta.value = e.desc || "";
            bindText(ta, (v) => { e.desc = v; });
            // 实体描述里的 @ 在 assemble 里是会解析的，补全也得挂上
            attachRefAutocomplete(ta, (v) => { e.desc = v; softRefresh(); });
            card.append(ta);

            // 素材绑定：一个实体可以被多张图/多段视频分别定义
            const imgsVids = mediaList.filter((m) => m.kind === "image" || m.kind === "video");
            (e.bindings || []).forEach((b, j) => {
                const row = E("div", "h3m-bind");
                row.append(E("span", "h3m-lab", "由素材定义"));
                // 绑的素材已经不在 media 口上了：下拉框会静默回落成空，
                // 界面看着像「没绑」，保存时才发现提示词里缺参考图。
                const lost = b.mediaKey && !imgsVids.some((m) => m.key === b.mediaKey);
                row.append(dd([{ id: "", label: lost ? `⚠ 素材已断开（${b.mediaKey}）` : "（选素材）" },
                               ...imgsVids.map((m) => ({ id: m.key, label: m.label }))],
                              lost ? "" : b.mediaKey, (v) => { b.mediaKey = v; draw(); }));
                if (lost) {
                    const w = E("span", "h3m-mini", "这条绑定失效了，重选一个");
                    w.style.color = "var(--warn)";
                    row.append(w);
                }
                row.append(dd(ENTITY_KINDS.filter((x) => x.phrase).map((x) => ({ id: x.id, label: x.label })),
                              b.kind, (v) => { b.kind = v; b.retention = ""; draw(); },
                              "官方绑定句：The {内容类型} of <Subject N> is defined by <Picture M>."));
                const auto = bindingRetention({ ...b, retention: "" });
                row.append(dd([{ id: "", label: `保留：${auto}（默认）` },
                               ...retentionSet("image").map((x) => ({ id: x.id, label: `保留：${x.label}` }))],
                              b.retention, (v) => { b.retention = v; draw(); }));
                if (bindingRetention(b) === "attribute_transfer") {
                    row.append(dd(entOptions("迁移到？（必填）"), b.transferTo,
                        (v) => { b.transferTo = v; draw(); },
                        "官方要求 attribute_transfer 必须指定接收方"));
                }
                // 从这张参考图反推特征，省得辛辛苦苦配好图还要把外观再手写一遍
                const media = mediaList.find((m) => m.key === b.mediaKey);
                const cap = E("button", "h3m-btn sm", "🔍 反推描述");
                cap.disabled = !media || media.kind !== "image";
                cap.title = !media ? "先选一个素材"
                    : media.kind !== "image" ? "目前只支持从图片反推，视频请先抽一帧"
                    : "读这张图，反推出外观特征填进上面的描述框";
                cap.onclick = () => openCaptionDialog({
                    previewUrl: media.previewUrl,
                    label: media.label,
                    kind: b.kind || e.kind,
                    current: e.desc || "",
                    onApply: (text, mode, notRetained) => {
                        if (text) {
                            e.desc = mode === "append" && e.desc?.trim()
                                ? e.desc.trim() + "\n" + text : text;
                        }
                        // 设定稿的白底/三视图排版直接进「不保留」，去重
                        for (const t of notRetained || []) {
                            if (!S.notRetained.includes(t)) S.notRetained.push(t);
                        }
                        draw();
                    },
                });
                row.append(cap);
                const rm = E("button", "h3m-btn gh sm", "✕");
                rm.onclick = () => { e.bindings.splice(j, 1); draw(); };
                row.append(rm);
                card.append(row);
            });

            const foot = E("div", "h3m-row");
            foot.style.marginTop = "8px";
            const addB = E("button", "h3m-btn sm", "+ 绑定素材");
            addB.disabled = !imgsVids.length;
            addB.title = imgsVids.length ? "同一实体可以绑多张图（正面 + 侧面 + 服装细节）" : "还没有图片/视频接到 media 口";
            addB.onclick = () => { e.bindings.push(blankBinding("", e.kind)); draw(); };
            foot.append(addB);

            if (k.canSpeak) {
                const auds = mediaList.filter((m) => m.kind === "audio");
                foot.append(E("span", "h3m-lab", "音色"));
                foot.append(dd([{ id: "", label: auds.length ? "（不指定）" : "没有音频接到 media 口" },
                                ...auds.map((m) => ({ id: m.key, label: m.label }))],
                               e.voiceKey || "", (v) => { e.voiceKey = v; draw(); }));
                const mk = E("button", "h3m-btn sm", "🎙 做音色");
                mk.title = "一次生成多条候选并排试听，挑中的自动接进 media 口";
                mk.onclick = () => openVoiceStudio({
                    entityName: e.name?.trim() || `实体 ${i + 1}`,
                    // 试听文本用这个实体的第一句真实台词，听到的就是成片里会说的那句
                    auditionText: firstLineOf(e.id),
                    language: e.language?.trim() || S.language,
                    onPick: (entry) => {
                        // 回调在图里新建 LoadAudio 并返回它的 mediaKey。mediaList 是
                        // 开窗时的快照，不把新素材补进去，下拉框就找不到这个 key，
                        // voiceKey 写进了数据但界面显示为空。
                        const added = onVoicePicked?.(entry);
                        const key = typeof added === "string" ? added : added?.key;
                        if (!key) return;
                        if (!mediaList.some((m) => m.key === key)) {
                            mediaList.push({
                                key, kind: "audio", previewUrl: "",
                                label: added?.label || entry.name || entry.file,
                            });
                        }
                        e.voiceKey = key;
                        draw();
                    },
                });
                foot.append(mk);
            }
            const said = S.shots.reduce((n2, sh) => n2 + sh.lines.filter((l) => l.entityId === e.id && l.text?.trim()).length, 0);
            const spx = E("div"); spx.style.flex = "1"; foot.append(spx);
            foot.append(E("span", "h3m-mini", said ? `名下 ${said} 句台词` : "名下暂无台词"));
            card.append(foot);
            pane.append(card);
        });

        // 六个「+ 某某」平铺是选择过载，而且它们是同一件事的变体。
        // 收成一个按钮 + 类型选择，默认人物（最常加的那种）。
        const bar = E("div", "h3m-row");
        let newKind = "identity";
        const kindSel = dd(ENTITY_KINDS.map((k) => ({ id: k.id, label: `${k.icon} ${k.label}` })),
                           newKind, (v) => {
                               newKind = v;
                               kindSel.title = ENTITY_KINDS.find((k) => k.id === v)?.hint || "";
                           });
        kindSel.title = ENTITY_KINDS[0].hint;
        const addB = E("button", "h3m-btn pri", "＋ 新增实体");
        addB.onclick = () => { S.entities.push(blankEntity(newKind, "")); draw(); };
        bar.append(addB, kindSel);
        pane.append(bar);
    }

    /**
     * 编辑器里拿不到真正的 <Picture N>/<Audio N>（那要等节点的运行时连线），
     * 但 taskTypes() 只看某个 mediaKey 有没有 token。给每件素材一个占位就够了。
     */
    function fakeTokens() {
        const m = {};
        for (const it of mediaList) m[it.key] = "<ref>";
        return m;
    }

    /* ------------------------------------------------------- 全局面板 */
    function drawGlobal() {
        // 实际会发出去的是「勾选 ∪ 推导」。只显示勾选项会骗人：绑了音色但没勾
        // audio reference，模型就不把音频当音色参考用，两个角色会是同一把嗓子。
        const effective = taskTypes(S, fakeTokens());
        const picked = TASK_TYPES.filter((t) => effective.includes(t.id)).map((t) => t.label);
        const f00 = section("任务类型", { open: false, summary: picked.join(" + ") || "未选" });
        f00.body.append(E("div", "h3m-hint",
            "官方词表。生成时作为 summary 的方括号前缀发送，例如 [reference generation + audio reference]。" +
            "绑了参考图/音色/首尾帧会自动带上对应项，不用手勾。"));
        const cks = E("div", "h3m-cks");
        for (const t of TASK_TYPES) {
            const manual = S.taskTypes.includes(t.id);
            const auto = effective.includes(t.id) && !manual;
            const l = E("label", "h3m-ck" + (manual || auto ? " on" : ""));
            const cb = E("input"); cb.type = "checkbox"; cb.checked = manual || auto;
            cb.disabled = auto;                    // 推导出来的取消不掉，取消了也会被加回去
            cb.addEventListener("change", () => {
                if (cb.checked) S.taskTypes.push(t.id);
                else S.taskTypes = S.taskTypes.filter((y) => y !== t.id);
                draw();
            });
            const body = E("div");
            const head = E("div", null, `${t.label}　${t.en}`);
            if (auto) head.append(E("span", "h3m-auto", "已按绑定自动带上"));
            body.append(head, E("em", null, t.hint));
            l.append(cb, body);
            cks.append(l);
        }
        f00.body.append(cks);
        pane.append(f00);

        const bound0 = entityBoundMedia(S);
        const usedN = mediaList.filter((m) => bound0[m.key] || S.media?.[m.key]?.role).length;
        const f0 = section("素材用途", { open: false,
            summary: `${mediaList.length} 件素材，已配 ${usedN} 件` });
        f0.body.append(E("div", "h3m-hint",
            "这里只放不绑实体的用途：首尾帧、配乐、环境音、整轨复用。" +
            "「这张图定义谁长什么样」去实体面板绑。生成时自动编号成 <Picture 1>/<Audio 1>。"));
        if (!mediaList.length) f0.body.append(E("div", "h3m-mini", "把 LoadImage / TTS 之类接到节点的 media 口即可。"));
        const bound = entityBoundMedia(S);
        for (const m of mediaList) {
            const cfg = (S.media[m.key] ||= { kind: m.kind, role: "", retention: "", note: "" });
            cfg.kind = m.kind;
            const uses = bound[m.key];
            const r = E("div", "h3m-row");
            r.style.marginBottom = "7px";
            const c = E("span", "h3m-chip on");
            if (m.previewUrl && m.kind === "image") { const i = E("img"); i.src = m.previewUrl; c.append(i); }
            else c.append(E("span", "ic", m.kind === "audio" ? "♪" : m.kind === "video" ? "▶" : "🖼"));
            c.append(E("span", null, m.label));
            r.append(c);
            if (uses) {
                const txt = uses.map((u) => `${u.voice ? "音色" : "定义"} → ${u.ent.name?.trim() || "未命名实体"}`).join("，");
                const lk = E("span", "h3m-mini", txt);
                lk.style.cssText = "padding:6px 9px;border:1px dashed var(--line);border-radius:6px";
                const jump = E("button", "h3m-btn gh sm", "去实体面板改");
                jump.onclick = () => { sel = "cast"; draw(); };
                r.append(lk, jump);
            } else {
                r.append(dd([{ id: "", label: "（不使用）" }, ...(MEDIA_ROLES[m.kind] || [])], cfg.role,
                    (v) => { cfg.role = v; cfg.retention = ""; draw(); }));
                if (cfg.role) {
                    const auto = mediaRetention({ kind: m.kind, role: cfg.role });
                    r.append(dd([{ id: "", label: `保留：${auto}（默认）` },
                                 ...retentionSet(m.kind).map((y) => ({ id: y.id, label: `保留：${y.label}` }))],
                                cfg.retention, (v) => { cfg.retention = v; }));
                }
                const note = E("input");
                note.placeholder = "补充说明（可留空）"; note.style.flex = "1"; note.style.minWidth = "140px";
                note.value = cfg.note || "";
                note.addEventListener("input", () => { cfg.note = note.value; });
                r.append(note);
            }
            f0.body.append(r);
        }
        pane.append(f0);

        for (const s of SECTIONS.filter((y) => !y.auto)) {
            const f = E("div", "h3m-fld");
            f.append(E("h3", null, s.label + (s.required ? "" : "（可选）")));
            f.append(E("div", "h3m-hint", s.hint + "　可以用 @名字 引用实体。"));
            const ta = E("textarea");
            ta.value = S.sections[s.key] || "";
            bindText(ta, (v) => { S.sections[s.key] = v; });
            attachRefAutocomplete(ta, (v) => { S.sections[s.key] = v; softRefresh(); });
            f.append(ta);
            pane.append(f);
        }

        const f2 = section("不保留的内容", { open: S.notRetained.length === 0,
            count: `${S.notRetained.length} 条`,
            summary: S.notRetained.slice(0, 3).join("、")
                     + (S.notRetained.length > 3 ? ` 等 ${S.notRetained.length} 条` : "") });
        f2.body.append(E("div", "h3m-hint",
            "写在这里的东西会告诉模型「参考图上有它，但别搬进成片」。" +
            "用三视图/设定稿当参考时务必写上白底和张臂站姿，否则会被一起画出来。"));

        // 常用项直接点着加。原来这里只有一排「点一下就没」的芯片，
        // 分不清是待添加还是已添加，误删了还找不回来。
        const pool = E("div", "h3m-row");
        pool.style.marginBottom = "9px";
        const remain = NOT_RETAINED_PRESETS.filter((t) => !S.notRetained.includes(t));
        pool.append(E("span", "h3m-lab", remain.length ? "常用（点击添加）" : "常用项都加过了"));
        for (const t of remain) {
            const c = E("span", "h3m-pick", "＋ " + t);
            c.onclick = () => { S.notRetained.push(t); draw(); };
            pool.append(c);
        }
        f2.body.append(pool);

        const row = E("div", "h3m-row");
        const inp = E("input");
        inp.placeholder = "自己写一条，回车添加"; inp.style.flex = "1"; inp.style.minWidth = "220px";
        const add = E("button", "h3m-btn", "+ 添加");
        const doAdd = () => {
            const v = inp.value.trim();
            if (!v) return;
            if (!S.notRetained.includes(v)) S.notRetained.push(v);
            inp.value = "";
            draw();
        };
        add.onclick = doAdd;
        inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doAdd(); } });
        row.append(inp, add);
        f2.body.append(row);

        const chips = E("div", "h3m-row");
        chips.style.marginTop = "9px";
        if (!S.notRetained.length) {
            chips.append(E("span", "h3m-mini", "还没添加任何项。参考图是设定稿的话，上面的常用项至少加白底那条。"));
        }
        S.notRetained.forEach((t, i) => {
            // 整块可点会误删，删除只认那个 ✕
            const c = E("span", "h3m-chip on");
            c.style.cursor = "default";
            c.append(E("span", null, t));
            const x2 = E("span", null, "✕");
            x2.style.cssText = "cursor:pointer;padding:0 2px;opacity:.7";
            x2.title = "移除这条";
            x2.onclick = (ev) => {
                ev.stopPropagation();
                lastRemoved = { text: t, index: i };
                S.notRetained.splice(i, 1);
                draw();
            };
            c.append(x2);
            chips.append(c);
        });
        if (lastRemoved) {
            const undo = E("button", "h3m-btn gh sm", `↩ 撤销移除「${lastRemoved.text}」`);
            undo.onclick = () => {
                S.notRetained.splice(lastRemoved.index, 0, lastRemoved.text);
                lastRemoved = null;
                draw();
            };
            chips.append(undo);
        }
        f2.body.append(chips);
        pane.append(f2);
    }

    /**
     * 给文本框装上 @ 自动补全。
     *
     * 原来打了 @ 之后要么把实体名一个字一个字敲全，要么把手从键盘挪到鼠标
     * 去点下面那排芯片——写作流被打断两次。现在打 @ 直接出候选，
     * 上下键选、回车/Tab 确认、Esc 关掉，手不离键盘。
     */
    function attachRefAutocomplete(ta, onChange) {
        let pop = null, items = [], idx = 0, tokenStart = -1;

        const closePop = () => { pop?.remove(); pop = null; items = []; tokenStart = -1; };
        teardown.push(closePop);

        /** 光标前最近的 @ 及其后已输入的片段；不在 @ 上下文里返回 null */
        const context = () => {
            const pos = ta.selectionStart ?? 0;
            const left = ta.value.slice(0, pos);
            const at = left.lastIndexOf("@");
            if (at < 0) return null;
            const frag = left.slice(at + 1);
            // @ 后出现空白或标点就不再算同一个引用
            if (/[\s，。！？、；：""'（）()<>@]/.test(frag)) return null;
            return { at, frag };
        };

        const place = () => {
            if (!pop) return;
            const r = ta.getBoundingClientRect();
            pop.style.left = `${Math.min(r.left + 10, window.innerWidth - 240)}px`;
            const below = r.bottom + 4;
            pop.style.top = below + 240 > window.innerHeight
                ? `${Math.max(8, r.top - 244)}px` : `${below}px`;
        };

        const render = () => {
            if (!pop) return;
            pop.innerHTML = "";
            if (!items.length) {
                pop.append(E("div", "h3m-ac-empty", "没有匹配的实体"));
                return;
            }
            const plan = castPlan(S);
            items.forEach((it, k) => {
                const row = E("div", "h3m-ac-item" + (k === idx ? " on" : ""));
                if (it.kind === "line") {
                    row.append(E("span", "k", "💬"));
                    row.append(E("span", "nm", it.name));
                    row.append(E("span", "id", (it.line.text || "").trim().slice(0, 16) || "（空）"));
                } else {
                    row.append(E("span", "k", kindOf(it.ent).icon));
                    row.append(E("span", "nm", it.name));
                    row.append(E("span", "id", castBadge(plan[it.ent.id])));
                }
                row.onmousedown = (ev) => { ev.preventDefault(); accept(k); };
                pop.append(row);
            });
            pop.querySelector(".on")?.scrollIntoView({ block: "nearest" });
        };

        const refresh = () => {
            const ctx = context();
            if (!ctx) { closePop(); return; }
            const q = ctx.frag.toLowerCase();
            const ents = S.entities.filter((e) => e.name?.trim())
                .filter((e) => !q || e.name.trim().toLowerCase().includes(q))
                .map((e) => ({ kind: "entity", ent: e, name: e.name.trim() }));
            // 在分镜面板里编辑时，本分镜的台词也能被 @ 引用
            const sh = typeof sel === "number" ? S.shots[sel] : null;
            const lns = (sh ? lineRefs(sh) : [])
                .filter((r) => !q || r.name.toLowerCase().includes(q))
                .map((r) => ({ kind: "line", line: r.line, name: r.name }));
            items = [...ents, ...lns];
            tokenStart = ctx.at;
            idx = 0;
            if (!pop) { pop = E("div", "h3m-ac"); document.body.append(pop); }
            render();
            place();
        };

        const accept = (k) => {
            const it = items[k];
            if (!it || tokenStart < 0) { closePop(); return; }
            const pos = ta.selectionStart ?? 0;
            const name = it.name;
            ta.value = ta.value.slice(0, tokenStart) + "@" + name + ta.value.slice(pos);
            const caret = tokenStart + 1 + name.length;
            ta.setSelectionRange(caret, caret);
            onChange(ta.value);
            closePop();
            ta.focus();
        };

        ta.addEventListener("keydown", (ev) => {
            if (!pop || !items.length) return;
            if (ev.key === "ArrowDown") { ev.preventDefault(); idx = (idx + 1) % items.length; render(); }
            else if (ev.key === "ArrowUp") { ev.preventDefault(); idx = (idx - 1 + items.length) % items.length; render(); }
            else if (ev.key === "Enter" || ev.key === "Tab") { ev.preventDefault(); accept(idx); }
            else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); closePop(); }
        });
        ta.addEventListener("input", refresh);
        ta.addEventListener("click", refresh);
        ta.addEventListener("blur", () => setTimeout(closePop, 120));
        ta.addEventListener("scroll", place);
    }

    /** 预览用：实体换 <Subject N>，台词换一个短占位（整句英文塞进来没法读） */
    function previewRefs(text, shot, plan) {
        let out = resolveRefs(text, S, plan);
        for (const r of lineRefs(shot)) {
            const body = (r.line.text || "").trim();
            out = out.split("@" + r.name).join(`〔${r.name}：${body.slice(0, 12)}〕`);
        }
        return out;
    }

    /* ------------------------------------------- @ 引用输入框 + 实时解析 */
    function refField(getText, setText, placeholder, minHeight, shot = null) {
        const wrap = E("div");
        const ta = E("textarea");
        ta.style.minHeight = minHeight || "104px";
        ta.placeholder = placeholder;
        ta.value = getText() || "";
        const prev = E("div", "h3m-prev");
        const sync = () => {
            const plan = castPlan(S);
            const bad = danglingRefs(ta.value, S, shot);
            prev.className = "h3m-prev" + (bad.length ? " bad" : "");
            prev.textContent = ta.value.trim()
                ? (bad.length ? `找不到实体：${bad.map((b) => "@" + b).join("、")}`
                              : previewRefs(ta.value, shot, plan))
                : "（这里会实时显示 @ 引用解析之后的样子）";
        };
        ta.addEventListener("input", () => { setText(ta.value); sync(); softRefresh(); });
        attachRefAutocomplete(ta, (v) => { setText(v); sync(); softRefresh(); });
        wrap.append(ta);

        // 主入口是打 @ 弹候选（手不离键盘）。芯片降级成备用，
        // 免得看起来像「必须用鼠标点」。
        if (S.entities.length) {
            const refs = E("div", "h3m-refs");
            refs.append(E("span", "h3m-mini", "打 @ 出候选，↑↓ 选，回车确认　｜　也可点这里插入："));
            S.entities.forEach((e, i) => {
                const chip = E("span", "h3m-ref", `@${entName(e, i)}`);
                chip.title = `${kindOf(e).label} · ${castBadge(castPlan(S)[e.id])}`;
                chip.onclick = () => {
                    const at = ta.selectionStart ?? ta.value.length;
                    const tok = `@${entName(e, i)}`;
                    ta.value = ta.value.slice(0, at) + tok + ta.value.slice(ta.selectionEnd ?? at);
                    setText(ta.value);
                    ta.focus();
                    ta.selectionStart = ta.selectionEnd = at + tok.length;
                    sync();
                };
                refs.append(chip);
            });
            wrap.append(refs);
        }
        wrap.append(prev);
        sync();
        return wrap;
    }

    /* ------------------------------------------------------- 分镜面板 */
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
        // 插入与排序都归左栏列表：那是结构操作，不是内容编辑。
        // 这里只留跟「当前这一镜」有关的动作。
        const del = E("button", "h3m-btn gh", "删除本镜");
        del.onclick = () => {
            S.shots.splice(i, 1);
            if (S.shots.length) S.shots[0].cutAt = 0;
            sel = S.shots.length ? Math.max(0, i - 1) : "cast";
            draw();
        };
        hdr.append(del);
        pane.append(hdr);

        const lenRow = E("div", "h3m-row");
        lenRow.style.marginBottom = "12px";
        lenRow.append(E("span", "h3m-lab", "本镜时长"));
        lenRow.append(stepper(span, 0.5, MIN_SHOT, S.duration, (v) => { setShotLength(i, v); draw(); }));
        lenRow.append(E("span", "h3m-mini",
            i + 1 < S.shots.length ? "秒　后面的镜头会跟着平移" : "秒　最后一镜，改它等于改总时长"));
        pane.append(lenRow);

        // 六个镜头参数平铺占掉半屏，而它们是「设一次就不太动」的东西。
        // 收进折叠区，标题行给出当前摘要，不展开也知道设了什么。
        const camSum = () => [
            i > 0 && TRANSITIONS.find((x) => x.id === sh.transition)?.label,
            SHOT_SIZES.find((x) => x.id === sh.size)?.label,
            CAMERA_ANGLES.find((x) => x.id === sh.angle)?.label,
            CAMERA_MOTIONS.find((x) => x.id === sh.motion)?.label,
            CAMERA_AMPLITUDE.find((x) => x.id === sh.amplitude)?.label,
            CAMERA_SPEED.find((x) => x.id === sh.speed)?.label,
        ].filter((x) => x && !x.startsWith("（")).join(" · ") || "未设置";

        const cam = section("镜头", { open: false, summary: camSum() });
        const grid = E("div", "h3m-grid");
        const bump = (fn) => (v) => { fn(v); cam.setSummary(camSum()); softRefresh(); };
        if (i > 0) grid.append(labeled("转场", dd(TRANSITIONS, sh.transition, bump((v) => { sh.transition = v; }))));
        grid.append(labeled("景别 ·非官方", dd(SHOT_SIZES, sh.size, bump((v) => { sh.size = v; }))));
        grid.append(labeled("机位角度 ·非官方", dd(CAMERA_ANGLES, sh.angle, bump((v) => { sh.angle = v; }))));
        grid.append(labeled("运镜", dd(CAMERA_MOTIONS, sh.motion, bump((v) => { sh.motion = v; }))));
        grid.append(labeled("幅度", dd(CAMERA_AMPLITUDE, sh.amplitude, bump((v) => { sh.amplitude = v; }))));
        grid.append(labeled("速度", dd(CAMERA_SPEED, sh.speed, bump((v) => { sh.speed = v; }))));
        cam.body.append(grid);
        cam.body.append(E("div", "h3m-hint",
            "标「非官方」的两项官方无受控词表（也没有「广角」「微距」这类镜头词），会作为普通英文写进描述。"));
        pane.append(cam);

        const f = E("div", "h3m-fld");
        f.append(E("h3", null, "画面描述"));
        f.append(E("div", "h3m-hint",
            "直接写这一镜发生什么。要提到某个实体就打 @ 或点下面的芯片，生成时自动换成 <Subject N>。"));
        f.append(refField(() => sh.description, (v) => { sh.description = v; },
            "例如：@少女 站在 @教室 门口说 @台词1，转身后再说 @台词2",
            null, sh));
        pane.append(f);

        /* --- 变更：本镜内的状态变化 --- */
        const fb = E("div", "h3m-fld");
        fb.append(E("h3", null, "变更"));
        fb.append(E("div", "h3m-hint",
            "这一镜里谁换了衣服、谁把东西给了谁、什么东西出现或消失。" +
            "预设不够用就选「自定义」，自己写一句，里面照样能 @ 引用实体。"));
        sh.beats.forEach((b, j) => fb.append(beatCard(sh, b, j)));
        const addBeat = E("button", "h3m-btn", "+ 添加变更");
        addBeat.onclick = () => { sh.beats.push(blankBeat(S.entities[0]?.id || "")); draw(); };
        fb.append(addBeat);
        pane.append(fb);

        /* --- 台词 --- */
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
        const speakers = S.entities.filter((e) => kindOf(e).canSpeak);
        if (!speakers.length) {
            f3.append(E("div", "h3m-mini", "还没有能说话的实体。到实体面板加一个「人物」或「画外音」。"));
        }
        sh.lines.forEach((ln, j) => f3.append(lineCard(sh, ln, j, speakers)));
        const addL = E("button", "h3m-btn", "+ 添加台词");
        addL.disabled = !speakers.length;
        addL.onclick = () => {
            const prev = sh.lines.at(-1)?.entityId;
            sh.lines.push(blankLine(prev || speakers[0]?.id || ""));
            draw();
        };
        f3.append(addL);
        if (speakers.length > 1) {
            const addO = E("button", "h3m-btn", "+ 对方接话");
            addO.style.marginLeft = "8px";
            addO.title = "新增一句，说话人自动换成上一句以外的实体";
            addO.onclick = () => {
                const prev = sh.lines.at(-1)?.entityId;
                const other = speakers.find((e) => e.id !== prev) || speakers[0];
                sh.lines.push(blankLine(other.id));
                draw();
            };
            f3.append(addO);
        }
        pane.append(f3);
    }

    function beatCard(sh, b, j) {
        const k = BEAT_KINDS.find((x) => x.id === b.kind) || BEAT_KINDS[0];
        const wrap = E("div");
        const row = E("div", "h3m-beat");
        row.append(dd(BEAT_KINDS, b.kind, (v) => { b.kind = v; draw(); }));
        if (k.needs.includes("actor")) {
            row.append(E("span", "h3m-lab", "谁"), dd(entOptions("（选实体）"), b.actor, (v) => { b.actor = v; draw(); }));
        }
        if (k.needs.includes("target")) {
            row.append(E("span", "h3m-lab", k.id === "swap" ? "从" : "对象"),
                       dd(entOptions("（选实体）"), b.target, (v) => { b.target = v; draw(); }));
        }
        if (k.needs.includes("recipient")) {
            row.append(E("span", "h3m-lab", k.id === "give" ? "给" : "换成"),
                       dd(entOptions("（选实体）"), b.recipient, (v) => { b.recipient = v; draw(); }));
        }
        const at = E("input");
        at.type = "number"; at.step = "0.1"; at.min = "0"; at.style.width = "72px";
        at.placeholder = "秒"; at.value = b.at ?? "";
        at.title = "本镜开始后第几秒发生。留空 = 不指定";
        at.addEventListener("input", () => { b.at = at.value; softRefresh(); });
        row.append(E("span", "h3m-lab", "+"), at, E("span", "h3m-mini", "s"));
        const sp = E("div"); sp.style.flex = "1"; row.append(sp);
        const rm = E("button", "h3m-btn gh sm", "✕");
        rm.onclick = () => { sh.beats.splice(j, 1); draw(); };
        row.append(rm);
        wrap.append(row);

        if (k.id === "custom") {
            wrap.append(refField(() => b.text, (v) => { b.text = v; },
                "自己写这一刻发生了什么，例如：@旧信封 在 @少女 手里被风吹散，纸片飘过 @教室 的窗",
                "62px", sh));
        } else {
            const extra = E("input");
            extra.placeholder = "补充一句（可留空），也能 @ 引用实体";
            extra.style.width = "100%";
            extra.value = b.text || "";
            wrap.append(extra);
            const s2 = beatSentence(b, S, castPlan(S));
            const prev = E("div", "h3m-prev" + (s2 ? "" : " bad"), s2 || "还缺实体，这条变更不会发送");
            wrap.append(prev);
            const syncPrev = () => {
                const t2 = beatSentence(b, S, castPlan(S));
                prev.className = "h3m-prev" + (t2 ? "" : " bad");
                prev.textContent = t2 || "还缺实体，这条变更不会发送";
            };
            extra.addEventListener("input", () => { b.text = extra.value; syncPrev(); softRefresh(); });
            softHooks.push(syncPrev);
        }
        wrap.style.marginBottom = "9px";
        return wrap;
    }

    function lineCard(sh, ln, j, speakers) {
        const plan = castPlan(S);
        const c = E("div", "h3m-line");
        const h = E("div", "h3m-line-hd");
        h.append(E("span", "h3m-lab", `第 ${j + 1} 句`));
        // 这条台词的引用名。写进画面描述里，成片中这句就落在那个位置，
        // 而不是被堆到整段末尾。
        const ref = E("span", "h3m-lineref", "@" + lineRefName(j));
        ref.title = "点一下复制。把它写进「画面描述」里，这句台词就落在那个位置。";
        ref.onclick = () => {
            navigator.clipboard?.writeText("@" + lineRefName(j)).catch(() => {});
            ref.classList.add("copied");
            setTimeout(() => ref.classList.remove("copied"), 900);
        };
        h.append(ref);
        h.append(dd([{ id: "", label: "（未指定说话人）" },
            ...speakers.map((e) => ({ id: e.id, label: `${kindOf(e).icon} ${e.name?.trim() || "未命名"}` }))],
            ln.entityId || "", (v) => { ln.entityId = v; draw(); }, "这句是谁说的"));
        const p = plan[ln.entityId];
        if (p) {
            const badge = E("span", "h3m-id" + (p.speaker ? "" : " none"),
                p.speaker ? `${p.label} (${p.speaker})` : p.label);
            badge.title = p.ent.voiceKey ? "该实体已绑定音色，本句会带上音色引用"
                                         : "该实体未绑定音色，音色由模型自由发挥";
            h.append(badge);
        }
        h.append(dd(VOICE_MODES, ln.mode, (v) => { ln.mode = v; draw(); }));
        const cont = dd(CONTINUITY, ln.continuity || "complete", (v) => { ln.continuity = v; draw(); },
            "官方标记：延续/承接会在 <d> 内加 <scenetrans>，被打断加 <cutoff>");
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
            softRefresh();
        });
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
