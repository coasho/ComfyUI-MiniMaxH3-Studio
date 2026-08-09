"""让本包自己持有的模型跟着 ComfyUI 的显存调度一起释放。

反推的 VLM 8.4GB、音色模型 4GB 都是我们自己 from_pretrained 出来的，
ComfyUI 的 model_management 完全不认识它们：它的 free_memory() 只会去卸
current_loaded_models 里那些它自己托管的。于是 H3 加载时我们还占着，直接 OOM。

原来只在 MiniMaxH3Easy.generate() 开头卸一次 —— 太晚了：
MiniMaxH3EasyLoader 跑在它前面，加载 H3 大模型那一刻我们还没让出来。

正确的挂点是 free_memory()：ComfyUI 任何时候要显存都会经过它
（unload_all_models 也是转调它），在它真正开始腾之前先把我们的放掉。
"""

from __future__ import annotations

import os
import threading
import time
import traceback

_patched = False
_providers = []          # [(名字, 卸载函数)]

# 队列空闲这么久就把 ComfyUI 托管的模型也放掉。0 = 关闭。
# 默认开着是因为 H3 本体 19.5GB：16GB 卡上跑完不放，显存只剩 1.8GB，
# 桌面合成和视频硬解都抢不到，播个视频都卡（实测就是这么发生的）。
# 代价是下次生成要重新读一遍权重，所以窗口给得比较宽，连着跑不会触发。
IDLE_UNLOAD_SECONDS = float(os.environ.get("MINIMAX_H3_IDLE_UNLOAD", "180"))
_reaper = None


def register(name: str, unload_fn) -> None:
    """登记一个「要显存时先卸我」的回调。"""
    _providers.append((name, unload_fn))


def _hard_collect() -> None:
    """
    把内存真正还回去。

    只做 torch.cuda.empty_cache() 是不够的：from_pretrained 出来的权重在 CPU
    侧还有副本，Python 的分配器也未必把页还给系统。实测 ComfyUI 因此被撑死过
    ——显存看着放了，31GB 物理内存只剩 2.8GB，H3 那步 20GB Staged 一上来
    进程就没了（HTTP 全超时、只剩 1 个线程、输出为空、日志无 Traceback）。
    """
    import ctypes
    import gc

    for _ in range(3):          # 跨代循环引用要多跑几轮才断干净
        gc.collect()
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.ipc_collect()
    except Exception:
        pass
    # Windows 上把工作集交还系统，否则 RSS 一直挂在那里
    try:
        h = ctypes.windll.kernel32.GetCurrentProcess()
        ctypes.windll.psapi.EmptyWorkingSet(h)
    except Exception:
        pass


def release_all(reason: str = "") -> int:
    freed = 0
    for name, fn in _providers:
        try:
            if fn():
                freed += 1
                print(f"[MiniMaxH3-Studio] 让出内存：已卸载{name}"
                      + (f"（{reason}）" if reason else ""))
        except Exception:
            traceback.print_exc()
    if freed:
        _hard_collect()
        try:
            import torch
            if torch.cuda.is_available():
                print(f"[MiniMaxH3-Studio] 释放后显存占用 "
                      f"{torch.cuda.memory_reserved() / 2**30:.2f} GB")
        except Exception:
            pass
    return freed


def _queue_busy() -> bool:
    """队列里还有没有在跑或排队的活。取不到状态时一律当忙，宁可不放。"""
    try:
        from server import PromptServer
        queue = getattr(PromptServer.instance, "prompt_queue", None)
        if queue is None:
            return True
        running, pending = queue.get_current_queue()
        return bool(running or pending)
    except Exception:
        return True


def _comfy_models_loaded() -> bool:
    try:
        import comfy.model_management as mm
        return bool(getattr(mm, "current_loaded_models", None))
    except Exception:
        return False


def release_everything(reason: str = "") -> dict:
    """本包的辅助模型 + ComfyUI 托管的模型，一起放掉。"""
    before = snapshot()
    for name, fn in _providers:
        try:
            fn()
        except Exception:
            traceback.print_exc()
    try:
        import comfy.model_management as mm
        # unload_all_models 会转调被我们包过的 free_memory，那层只管辅助模型，
        # 不会递归回到这里
        mm.unload_all_models()
    except Exception:
        traceback.print_exc()
    _hard_collect()
    after = snapshot()
    print(f"[MiniMaxH3-Studio] 已释放全部模型"
          + (f"（{reason}）" if reason else "")
          + f"：显存 {before.get('vram_gb', '?')} -> {after.get('vram_gb', '?')} GB，"
            f"进程内存 {before.get('rss_gb', '?')} -> {after.get('rss_gb', '?')} GB")
    return {"before": before, "after": after}


def _idle_loop() -> None:
    idle_since = None
    while True:
        time.sleep(5)
        try:
            if _queue_busy():
                idle_since = None
                continue
            if not _comfy_models_loaded():
                idle_since = None
                continue
            now = time.time()
            if idle_since is None:
                idle_since = now
                continue
            if now - idle_since < IDLE_UNLOAD_SECONDS:
                continue
            release_everything(f"空闲 {int(IDLE_UNLOAD_SECONDS)} 秒")
            idle_since = None
        except Exception:
            traceback.print_exc()
            idle_since = None


def start_idle_reaper() -> None:
    global _reaper
    if _reaper is not None or IDLE_UNLOAD_SECONDS <= 0:
        return
    _reaper = threading.Thread(target=_idle_loop, name="h3-idle-unload", daemon=True)
    _reaper.start()
    print(f"[MiniMaxH3-Studio] 空闲 {int(IDLE_UNLOAD_SECONDS)} 秒自动释放模型"
          f"（改 MINIMAX_H3_IDLE_UNLOAD 环境变量，0 关闭）")


def snapshot() -> dict:
    """当前显存/内存占用，用来给前端显示释放了多少。"""
    out = {}
    try:
        import torch
        if torch.cuda.is_available():
            out["vram_gb"] = round(torch.cuda.memory_reserved() / 2**30, 2)
    except Exception:
        pass
    try:
        import psutil
        out["rss_gb"] = round(psutil.Process().memory_info().rss / 2**30, 2)
    except Exception:
        pass
    return out


def add_routes(routes) -> None:
    """给前端一个主动释放的入口。"""
    from aiohttp import web

    @routes.post("/minimax_h3_studio/release")
    async def _release(_r):
        before = snapshot()
        n = release_all("界面请求释放")
        after = snapshot()
        return web.json_response({"ok": True, "released": n,
                                  "before": before, "after": after})

    @routes.post("/minimax_h3_studio/release_all")
    async def _release_all(_r):
        """连 ComfyUI 托管的模型一起放。跑完想立刻用电脑就打这个。"""
        if _queue_busy():
            return web.json_response({"ok": False, "error": "队列还在跑，没有释放"},
                                     status=409)
        return web.json_response({"ok": True, **release_everything("手动请求")})


def register_routes() -> None:
    try:
        from server import PromptServer
    except Exception:
        return
    r = getattr(PromptServer.instance, "routes", None)
    if r is not None:
        add_routes(r)


def install() -> None:
    """把 free_memory 包一层。重复调用安全。"""
    global _patched
    if _patched:
        return
    try:
        import comfy.model_management as mm
    except Exception:
        return

    original = mm.free_memory

    def free_memory(memory_required, device, *a, **kw):
        # 只在真的要腾出量的时候让路。ComfyUI 有些调用是 0 或极小值，
        # 那种没必要把我们几 GB 的模型也扔掉。
        try:
            if memory_required and memory_required > 64 * 1024 * 1024:
                release_all("ComfyUI 需要显存")
        except Exception:
            traceback.print_exc()
        return original(memory_required, device, *a, **kw)

    free_memory.__wrapped__ = original
    mm.free_memory = free_memory
    _patched = True
    print("[MiniMaxH3-Studio] 已接入 ComfyUI 显存调度")
