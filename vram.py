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

import traceback

_patched = False
_providers = []          # [(名字, 卸载函数)]


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
