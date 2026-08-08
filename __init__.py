from .nodes import MiniMaxH3Easy, MiniMaxH3EasyLoader, MiniMaxH3EasyOutput

NODE_CLASS_MAPPINGS = {
    "MiniMaxH3EasyLoader": MiniMaxH3EasyLoader,
    "MiniMaxH3Easy": MiniMaxH3Easy,
    "MiniMaxH3EasyOutput": MiniMaxH3EasyOutput,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "MiniMaxH3EasyLoader": "MiniMax H3 Easy Loader",
    "MiniMaxH3Easy": "MiniMax H3 Easy",
    "MiniMaxH3EasyOutput": "MiniMax H3 Easy Output",
}

WEB_DIRECTORY = "./web"

# 图生文反推 / 音色生成的 HTTP 端点。装不上也不该拖垮整个节点包，各自兜住。
# 同时把它们的卸载函数登记进显存调度：这两个模型是我们自己加载的，
# ComfyUI 的 model_management 不认识，不登记就会在 H3 加载时把显存挤爆。
try:
    from . import vram
    vram.install()
    vram.register_routes()
except Exception:  # pragma: no cover
    import traceback
    print("[MiniMaxH3-Studio] 显存调度接入失败：")
    traceback.print_exc()

for _name, _label, _fn in (("caption", "图生文反推模型", "unload_caption_models"),
                           ("voice", "音色模型", "unload_voice_models")):
    try:
        _mod = __import__(f"{__name__}.{_name}", fromlist=[_name])
        _mod.register_routes()
        vram.register(_label, getattr(_mod, _fn))
    except Exception:  # pragma: no cover
        import traceback
        print(f"[MiniMaxH3-Studio] {_name} 初始化失败，节点本身不受影响：")
        traceback.print_exc()

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
