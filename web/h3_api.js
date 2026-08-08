/** 几个弹窗共用的 HTTP 小工具。放这里是为了避免弹窗之间互相 import。 */

/**
 * 把 HTTP 状态码翻译成人能看懂的话。
 *
 * 404/405 基本只有一个含义：这个端点是新加的，而 Python 那边还是旧的。
 * ComfyUI 给前端挂了兜底路由，没注册过的路径用 POST 打过去会撞上它，
 * 返回 405 而不是 404 —— 光甩一句「HTTP 405」没人猜得到要重启。
 */
export function httpHint(status, path = "") {
    if (status === 404 || status === 405) {
        return `接口 ${path} 不存在（HTTP ${status}）。多半是节点包刚更新过、`
             + `ComfyUI 还没重启——Python 代码不会热加载，重启一次就好。`;
    }
    if (status === 0) return "连不上 ComfyUI 服务";
    return `HTTP ${status}`;
}

/** POST JSON，按约定的 {ok, error} 形状抛错。 */
export async function postJSON(url, body) {
    const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
    });
    const d = await r.json().catch(() => ({ ok: false, error: httpHint(r.status, url) }));
    if (!r.ok || !d.ok) throw new Error(d.error || httpHint(r.status, url));
    return d;
}
