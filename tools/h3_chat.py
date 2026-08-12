#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""H3 提示词工作台 —— 本地网页，强制关思考，写完自动机检。

为什么要它：Ollama 桌面版没有关思考的开关（ollama/ollama#15962、#16016 至今未实现），
而只有 API 的 think:false 真的有效（/no_think 和模板预填都实测无效）。
这个脚本自己发请求，永远带 think:false。

用法：
    python tools/h3_chat.py
    浏览器开 http://127.0.0.1:8765

自带同源代理，所以没有跨域问题。system 提示词默认用 docs/ 下那两份。
"""
from __future__ import annotations

import http.server
import json
import os
import socketserver
import subprocess
import sys
import urllib.request

PORT = 8765
OLLAMA = "http://127.0.0.1:11434"
MODEL = os.environ.get("H3_MODEL", "h3writer:latest")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "docs")
LINT = os.path.join(ROOT, "tools", "h3_prompt_lint.py")


def read(*parts):
    p = os.path.join(*parts)
    return open(p, encoding="utf-8").read() if os.path.exists(p) else ""


def build_system():
    grammar = read(DOCS, "H3提示词语法速查.txt")
    rules = read(DOCS, "本地模型系统提示词.txt")
    return (grammar + "\n\n" + rules).strip()


PAGE = """<!doctype html><html lang="zh"><meta charset="utf-8">
<title>H3 提示词工作台</title>
<style>
:root{--bg:#14161a;--fg:#e6e6e6;--dim:#8b93a0;--line:#2a2f37;--ok:#4ec9a0;--warn:#e0b341;--err:#e06c75}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.6 system-ui,"Microsoft YaHei",sans-serif;height:100vh;display:flex;flex-direction:column}
header{padding:8px 14px;border-bottom:1px solid var(--line);display:flex;gap:14px;align-items:center;flex-wrap:wrap}
header b{color:var(--ok)}
header span{color:var(--dim);font-size:12px}
main{flex:1;display:flex;min-height:0}
#left{flex:1;display:flex;flex-direction:column;border-right:1px solid var(--line);min-width:0}
#out{flex:1;overflow:auto;padding:14px;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,Consolas,monospace;font-size:13px}
#lint{width:400px;overflow:auto;padding:14px;white-space:pre-wrap;font-family:ui-monospace,Consolas,monospace;font-size:12px;background:#101216}
footer{border-top:1px solid var(--line);padding:10px;display:flex;gap:8px}
textarea{flex:1;background:#0e1013;color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:9px;font:inherit;resize:vertical;min-height:76px}
button{background:#2b6cb0;color:#fff;border:0;border-radius:6px;padding:0 18px;font:inherit;cursor:pointer}
button:disabled{background:#3a4048;cursor:default}
button.ghost{background:#22262d}
input[type=number]{width:64px;background:#0e1013;color:var(--fg);border:1px solid var(--line);border-radius:4px;padding:3px 6px}
.e{color:var(--err)} .w{color:var(--warn)} .i{color:var(--dim)} .g{color:var(--ok)}
</style>
<header>
  <b>H3 提示词工作台</b>
  <span>模型 <code id="model"></code></span>
  <span>思考 <b style="color:var(--ok)">已关闭</b>（think:false）</span>
  <span>时长 <input type="number" id="secs" value="15" min="4" max="15" step="1"> 秒</span>
  <span id="stat"></span>
  <button class="ghost" id="clear" style="margin-left:auto;padding:4px 12px">清空对话</button>
</header>
<main>
  <div id="left"><div id="out"></div></div>
  <div id="lint"><span class="i">写完会自动跑 h3_prompt_lint.py，结果显示在这里。</span></div>
</main>
<footer>
  <textarea id="q" placeholder="描述你要的片子。Ctrl+Enter 发送。"></textarea>
  <button id="go">生成</button>
</footer>
<script>
const $=s=>document.querySelector(s);
let history=[];
fetch('/model').then(r=>r.text()).then(t=>$('#model').textContent=t);

function render(){
  $('#out').innerHTML = history.map(m=>
    (m.role==='user'?'<span class="g">▸ 你</span>\\n':'<span class="i">▸ 模型</span>\\n')
    + m.content.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])) + '\\n\\n'
  ).join('');
  $('#out').scrollTop=1e9;
}

async function send(){
  const q=$('#q').value.trim(); if(!q) return;
  $('#go').disabled=true; $('#stat').textContent='生成中…';
  history.push({role:'user',content:q}); $('#q').value=''; render();
  const t0=Date.now();
  try{
    const r=await fetch('/chat',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({messages:history, seconds:+$('#secs').value})});
    const d=await r.json();
    if(d.error){ $('#stat').textContent='错误：'+d.error; $('#go').disabled=false; return; }
    history.push({role:'assistant',content:d.content}); render();
    $('#stat').textContent=`${((Date.now()-t0)/1000).toFixed(0)}s · ${d.eval_count} token · ${d.done_reason}`
      + (d.thinking_len? ` · ⚠ 思考仍有 ${d.thinking_len} 字符`:'');
    $('#lint').innerHTML = (d.lint||'(无输出)').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))
      .replace(/^(\\s*x .*)$/gm,'<span class="e">$1</span>')
      .replace(/^(\\s*! .*)$/gm,'<span class="w">$1</span>')
      .replace(/^(\\s*\\. .*)$/gm,'<span class="i">$1</span>');
  }catch(e){ $('#stat').textContent='请求失败：'+e; }
  $('#go').disabled=false;
}
$('#go').onclick=send;
$('#clear').onclick=()=>{history=[];render();$('#lint').textContent='';$('#stat').textContent='';};
$('#q').addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey))send();});
</script>
</html>"""


def run_lint(text, seconds):
    """把模型输出丢给校验脚本。去掉代码围栏和前后说明。"""
    body = text
    if "```" in body:
        parts = body.split("```")
        if len(parts) >= 3:
            body = parts[1]
            if body[:12].strip().split("\n")[0].strip() in ("text", "txt", "plaintext", ""):
                body = body.split("\n", 1)[1] if "\n" in body else body
    try:
        p = subprocess.run([sys.executable, "-X", "utf8", LINT, "-", "--seconds", str(seconds)],
                           input=body, capture_output=True, text=True,
                           encoding="utf-8", timeout=60)
        return (p.stdout or "") + (p.stderr or "")
    except Exception as e:
        return f"校验脚本没跑起来：{type(e).__name__}: {e}"


class H(http.server.BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="text/html; charset=utf-8"):
        b = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path == "/model":
            return self._send(200, MODEL, "text/plain; charset=utf-8")
        self._send(200, PAGE)

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        req = json.loads(self.rfile.read(n) or b"{}")
        msgs = [{"role": "system", "content": build_system()}] + req.get("messages", [])
        body = {"model": MODEL, "messages": msgs, "stream": False,
                "think": False}                      # <<< 这一行是全部的意义
        try:
            r = urllib.request.Request(f"{OLLAMA}/api/chat", data=json.dumps(body).encode(),
                                       headers={"Content-Type": "application/json"})
            d = json.load(urllib.request.urlopen(r, timeout=1800))
        except Exception as e:
            return self._send(200, json.dumps({"error": f"{type(e).__name__}: {e}"}),
                              "application/json; charset=utf-8")
        m = d.get("message", {})
        content = m.get("content", "")
        out = {"content": content,
               "thinking_len": len(m.get("thinking") or ""),
               "eval_count": d.get("eval_count"),
               "done_reason": d.get("done_reason"),
               "lint": run_lint(content, req.get("seconds", 15))}
        self._send(200, json.dumps(out, ensure_ascii=False), "application/json; charset=utf-8")

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    sysmsg = build_system()
    print(f"模型      {MODEL}")
    print(f"system    {len(sysmsg)} 字符（语法速查 + 系统提示词）")
    print(f"思考      强制关闭（think:false）")
    print(f"校验      {'有' if os.path.exists(LINT) else '找不到 h3_prompt_lint.py'}")
    print(f"\n打开 http://127.0.0.1:{PORT}\n")
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), H) as s:
        try:
            s.serve_forever()
        except KeyboardInterrupt:
            print("停止")
