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

# 图生文反推的 HTTP 端点。装不上也不该拖垮整个节点包，所以单独兜住。
try:
    from . import caption
    caption.register_routes()
except Exception:  # pragma: no cover
    import traceback
    print("[MiniMaxH3-Studio] 图生文反推路由注册失败，节点本身不受影响：")
    traceback.print_exc()

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
