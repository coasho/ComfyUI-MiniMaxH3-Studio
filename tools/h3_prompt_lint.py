#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""H3 提示词结构校验 —— 命令行入口。

规则本体在包内的 prompt_lint.py（ComfyUI 里的节点和 HTTP 路由用的是同一份），
这里只负责读文件和打印，保证两边永远同一套判据。

用法：
    python h3_prompt_lint.py 提示词.txt
    python h3_prompt_lint.py 提示词.txt --seconds 15
    cat 提示词.txt | python h3_prompt_lint.py -
    python h3_prompt_lint.py 目录/ --quiet
    python h3_prompt_lint.py 金标准目录/ --selftest
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from prompt_lint import lint  # noqa: E402


# ---------------------------------------------------------------- 入口

def collect(path):
    if path == "-":
        return [("<stdin>", sys.stdin.read())]
    if os.path.isdir(path):
        return [(fn, open(os.path.join(path, fn), encoding="utf-8").read())
                for fn in sorted(os.listdir(path)) if fn.lower().endswith((".txt", ".md"))]
    return [(os.path.basename(path), open(path, encoding="utf-8").read())]


def main():
    ap = argparse.ArgumentParser(description="H3 提示词结构校验（只查结构，不看题材）")
    ap.add_argument("path", help="提示词文件、目录，或 - 从 stdin 读")
    ap.add_argument("--seconds", type=float, default=None, help="目标时长，用于帧数与末镜头检查")
    ap.add_argument("--quiet", action="store_true", help="只输出有问题的")
    ap.add_argument("--no-info", action="store_true", help="不显示 INFO")
    ap.add_argument("--selftest", action="store_true",
                    help="金标准自检：目录里全是已出片的提示词，出现任何 ERROR 即判定规则写错")
    a = ap.parse_args()

    jobs = collect(a.path)
    worst, n_err_files = 0, []
    for name, text in jobs:
        rep = lint(text, name, a.seconds)
        if rep.n_err:
            n_err_files.append(name)
        if not (a.quiet and rep.n_err == 0 and rep.n_warn == 0):
            print(rep.render(show_info=not a.no_info))
            print()
        worst = max(worst, 1 if rep.n_err else 0)

    if a.selftest:
        print("=" * 60)
        if n_err_files:
            print(f"自检未通过：{len(n_err_files)}/{len(jobs)} 条已出片的提示词被判 ERROR")
            print("  " + ", ".join(n_err_files))
            print("  这些是规则写错了，不是提示词写错了。")
            sys.exit(1)
        print(f"自检通过：{len(jobs)} 条已出片的提示词全部 0 ERROR")
        sys.exit(0)
    sys.exit(worst)


if __name__ == "__main__":
    main()
