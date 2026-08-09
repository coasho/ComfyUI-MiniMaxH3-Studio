# ComfyUI-MiniMaxH3-Studio

[English README](README.md)

给 MiniMax H3 用的 ComfyUI 节点包。图片、视频、音频共用一个可排序的 `Media` 输入，
提示词里用 `@名字` 直接引用；提示词本身按官方语法自己写。

另外带上了新装一次最容易卡住的几样东西：**一键下载全部模型**、**只用 ComfyUI 核心
节点的示例工作流**，以及两个附属节点 —— **图生文反推**和**音色生成**。

<p align="center">
  <img src="images/reference-editor-zh.png" alt="图片、视频、音频共用一个 Media 输入" width="720">
</p>

<sup>一个 `Media` 口接所有素材，拖动排序决定 `<Picture N>` / `<Audio N>` 的编号。</sup>

---

## 安装

```bash
git clone https://github.com/coasho/ComfyUI-MiniMaxH3-Studio.git
```

克隆到 `ComfyUI/custom_nodes/` 下，装一下可选依赖，然后重启：

```bash
pip install -r ComfyUI-MiniMaxH3-Studio/requirements.txt
```

三个主节点本身不需要 ComfyUI 自带之外的任何东西。`requirements.txt` 只服务于
反推节点；缺了它反推节点不注册，主节点照常工作。

**强烈建议 ComfyUI ≥ `bdcb886`（2026-08-06 nightly）。** 那个提交加入了原生的
MiniMax-H3 音画流采样（`ModelSamplingAV`）；在此之前用 4 步 Turbo LoRA，声音会严重破音。
示例工作流是按 Turbo LoRA 配的。

随包用的是 **`minimax_h3_turbo_v4_step600_ema`**——作者称它是这条线上最强的一版：
静态与小幅运动的镜头明显更好，脸、手指、细纹理这些微观细节也更好，而且没有 v1 那种
过锐的塑料感。可用区间 **4–8 步，6–8 步明显好于 4 步**，超过 8 步不再变好还会过锐。
示例按 6 步、调度器 `simple`、强度 `1.0` 配。
旧版 `ckpt850` 唯一还占优的场景是「只跑 4 步且画面大幅运动」——v4 那时会拖影，
但把步数提到 6–8 才是正解。

音色节点还需要另外装 [ComfyUI-Qwen3-TTS](https://github.com/lrzjason/ComfyUI-Qwen3-TTS)，
本包驱动的是它的 TTS 节点类。没装就是音色节点不注册，其余不受影响。

---

## 一键下载模型

H3 的权重分散在三个 HuggingFace 仓库里，名字几乎一模一样，跑起来前要凑齐六个文件。
别手抄链接。

打开 **MiniMax H3 加载器** 节点，点 **⬇ 下载模型**：有什么、缺什么、还差多少字节，
一目了然。

也可以不开 ComfyUI，直接在终端跑：

```bash
python ComfyUI/custom_nodes/ComfyUI-MiniMaxH3-Studio/download_models.py --list
```

```bash
python ComfyUI/custom_nodes/ComfyUI-MiniMaxH3-Studio/download_models.py --required
```

| id | 必需 | 体积 | 落到哪 |
|---|---|---|---|
| `h3_ref2va` | ✔ | 19.5 GB | `models/diffusion_models/` |
| `h3_fl2va` | ✔ | 19.5 GB | `models/diffusion_models/` |
| `h3_text_encoder` | ✔ | 14.6 GB | `models/text_encoders/` |
| `h3_text_encoder_int8` | — | 25.3 GB | 非 50 系显卡的备选 |
| `h3_vae` | ✔ | 5.4 GB | `models/vae/`（视频 + 音频两个）|
| `h3_turbo_lora` | ✔ | 592 MB | `models/loras/` —— v4-600 EMA，作者推荐 |
| `h3_turbo_lora_ckpt850` | — | 592 MB | 旧版，只在「4 步 + 大幅运动」时占优 |
| `qwen3vl_caption` | — | 8.3 GB | `models/LLM/Qwen3-VL-4B-Instruct/` |
| `wd14_tagger` | — | 1.2 GB | 装了 `comfyui-wd14-tagger` 就复用它的 models 目录 |
| `tts_voicedesign` | — | 4.2 GB | `models/TTS/Qwen/…-VoiceDesign/` |
| `tts_base` | — | 4.2 GB | `models/TTS/Qwen/…-Base/` |

几个实际会救命的细节：

- **断点续传。** 下载写在目标旁边的 `.part` 上，从上次断的位置接着下——取消、关
  ComfyUI、断网都行。`huggingface_hub` 的 `snapshot_download(local_dir=…)` 在 Xet
  存储上没有断点，杀掉进程几个 GB 全丢，所以这里用裸 `Range` 请求配自己的读超时。
- **不存第二份。** 直接落到 ComfyUI 的 models 目录，不经过 `~/.cache/huggingface`。
- **镜像。** 设 `HF_ENDPOINT=https://hf-mirror.com` 就走镜像。
- **校验。** `.safetensors` 要先过自己的头部校验才改名到位，半个文件不会被当成就绪。
  已经在本地的文件只要能自校验就认，不比对清单里的字节数（同一权重的不同 repack
  会差几十字节，按大小判会让人白下 19.5GB）。

---

## 示例工作流

`example_workflows/` 里四张图，**只用 ComfyUI 核心节点 + 本包自己的节点**——
不需要 KJNodes、不需要 wavespeed、不需要任何改过的采样器。

| 文件 | 用途 | 需要 |
|---|---|---|
| `MiniMax_H3_Studio_Reference.json` | 参考生视频 | `h3_ref2va` + 文本编码器 + VAE + Turbo LoRA |
| `MiniMax_H3_Studio_TextToVideo.json` | 文生视频 / 图生视频 | `h3_fl2va` + 文本编码器 + VAE + Turbo LoRA |
| `Image_to_Prompt_Bilingual.json` | 图生文反推，不出视频 | `qwen3vl_caption`（二次元再加 `wd14_tagger`）|
| `MiniMax_H3_Voice.json` | 音色生成，不出视频 | `tts_voicedesign` 或 `tts_base` |

两张视频图的参考图指向 ComfyUI 自带的 `input/example.png`，换成你自己的设定稿即可。

---

## 一、画面比例：别让首帧被拉伸

- **`宽高比 = 自动（跟随图片）`** —— 按首帧 / 第一张参考图挑最接近的官方比例。
- **`首帧适配 = 裁切（不变形）`** —— 等比缩放后居中裁切，默认值。
  另一档 `拉伸（会变形）` 是官方核心的原始行为，它会直接把图拉到画布上。

两个默认值一起，任何比例的图都是 0 形变。手动把宽高比锁成和原图不符的值仍然会
裁掉边缘（那是预期行为），但不会再变形。

> `分辨率 = Custom` 时宽高比整个失效——自定义宽高是直接生效的，`自动` 无从谈起。
> 想让画布跟着图走，就得选一个预设档位。

---

## 二、提示词怎么写

提示词按官方语法自己写。基础模式（T2VA / I2VA / FL2VA / L2VA）三段：
`integrated_multimodal_description` / `overall_soundscape` / `non_diegetic_music`；
参考生视频（Ref2VA）六段，多出 `subject_definitions` / `summary` / `retention_analysis`。

**I2VA 必须以这一行开头**，后面空一行：

```
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.
```

### `<Subject N>` 不只是「角色」

它是任意可复用的声明实体，官方 visible content type 全集：

| 类型 | 官方短语 | 默认保留等级 |
|---|---|---|
| 人物 | `identity and appearance` | fully_preserved |
| 物件 / 服装 / 道具 | `visible object appearance` | fully_preserved |
| 场景 / 环境 | `scene and environment` | fully_preserved |
| 动作 / 姿态 | `pose and movement` | **attribute_transfer**（必须指定迁移目标）|
| 画风 | `visual style` | weak_reference |
| 画外音 | 无（不占 Subject 编号）| — |

绑定句模板：`The {短语} of <Subject 1> {is|are} defined by <Picture 1>.`
一个实体可以绑多个素材（正面图 + 侧面图 + 服装细节各一张）。

### 两套编号互不相干

- `<Subject N>` 按**声明顺序**编号，只有「出现在画面里」的占号
- `(S1)(S2)` 按**首次开口顺序**编号，**从不开口的实体不给编号**

所以完全可能出现 `<Subject 2> (S1)`。

### `@` 引用

提示词框里写 `@文件名` 引用接在 `Media` 口上的素材，排队时替换成
`<Picture N>` / `<Audio N>` / `<Video N>`。按 `@` 直接弹出补全列表，↑ ↓ 选、回车插入。
`@引用方式` 切换成「按序号」时改用素材在 `Media` 上的顺序号。

<p align="center">
  <img src="images/mention-popup-zh.png" alt="按 @ 弹出素材列表" width="330">
</p>

### 官方限制

4–15 秒，24fps，≤9 张图 / ≤3 段视频 / ≤3 段音频（混合 ≤12），提示词 ≤7000 字符。
运镜 / 幅度 / 速度是官方词表，且**幅度与速度官方只有两档**（small/large、slow/fast）。
官方**没有**「广角」「微距」这类焦段词，也没有景别和机位角度的受控词表——
那些照常写成普通英文即可。

---

## 三、图生文反推节点

`图生文反推 · 中英双语`：一张图进去，五份文本出来——自然语言和逗号标签各出中英两份，
外加 WD14 原始标签。四路各有开关，因为每开一路就多跑一趟模型。

中文是**从英文译出来的**、不是分别写两遍：两份必须说的是同一件事，否则你核对中文
没问题就发货，实际发出去的英文可能说了别的。跑完自动把 8.3GB 的 VLM 放掉，
要连着批量跑就把 `unload_after` 关掉。

两个模型协作，**不是二选一**：

| 模型 | 体积 | 职责 |
|---|---|---|
| `SmilingWolf/wd-eva02-large-tagger-v3` | 1.2 GB ONNX | 二次元离散属性抽取（v3 系列 F1 最高 0.4772）|
| `Qwen/Qwen3-VL-4B-Instruct` | 8.3 GB bf16 | 成句描述，写实与二次元通用 |

二次元图先用 WD14 抽标签当**事实依据**喂给 VLM，并明确告诉它标签在发色瞳色
服饰上比自己看的准。写实照片把 `use_wd14_tags` 关掉直接走 VLM。

> 反推出来的是**原样的描述**，不带任何 H3 语法加工——不套 `<Subject N>`、
> 不补「NOT 邻近色」的颜色围栏、不剥离设定稿版式。怎么用是使用者的事。

---

## 四、音色节点

**「大妈声」的根因是没得挑，不是模型烂。** VoiceDesign 是随机采样，
同一段描述换个 seed 音色差很远（实测组内相似度 0.989，确实在飘）。
所以 `音色设计` 节点默认一次出 4 条候选拼成一段音频，接 `PreviewAudio` 连着听，
听中第几条就把 `seed` 填成 `seeds` 输出里报的那个数、`count` 调回 1 定下来。

| 节点 | 需要模型 | 说明 |
|---|---|---|
| `音色设计 · 文字描述` | `Qwen3-TTS-12Hz-1.7B-VoiceDesign` 4.2 GB | 自由描述嗓音，随机采样，所以要多出几条挑 |
| `音色克隆 · 参考音频` | `Qwen3-TTS-12Hz-1.7B-Base` 4.2 GB | 从参考音频提音色向量复刻，不靠抽卡 |

**不用 CustomVoice**（Vivian 那套固定预设），实测就是「大妈声」的来源。

实测音色一致性（MFCC 余弦）：描述生成组内 0.989，克隆组内 0.997，
克隆跨参考 0.980 —— 克隆更稳，且参考确实决定音色。
（该指标在短片段上往 1.0 饱和，动态范围窄，以听感为准。）

两个节点都输出标准 `AUDIO`，**可以直接接到 `MiniMax H3 Easy` 的 `Media` 口上**，
不用先存成文件再 `LoadAudio`。想跨会话复用就接 `SaveAudio` 存下来。

> 存下来的音色要拿回 `LoadAudio` 用的话，文件必须放 `input/` **根目录**：
> `LoadAudio` 用 `os.listdir(input_dir)` 列文件，不递归，放子目录下拉框根本选不到。

试听文本填成片里真要说的那句，听到的才作数。

---

## 五、显存与内存

反推的 VLM 8 GB、音色模型 4 GB，跟 H3 抢显存必爆。所以：

- `MiniMaxH3Easy.generate()` 开头先把两个都卸掉
- 各有一个空闲 10 分钟自动卸载的守护线程
- 两个附属节点默认 `unload_after = True`，跑完立刻释放：接进 ComfyUI 的
  `free_memory`、`gc` ×3、`empty_cache`、`ipc_collect`，Windows 上还调
  `EmptyWorkingSet` 把内存页还给系统

16 GB 卡实测峰值：反推 8.78 GB，音色 4.09 GB。

> 卸载时**绝不** `.to("cpu")`。那会把 8GB 权重从显存搬进内存然后留在那里
> （实测 RSS 0.83 → 7.63 GB），反过来把 ComfyUI 自己饿死。

---

## 六、文件

| 文件 | 作用 |
|---|---|
| `nodes.py` | 三个主节点：Loader / Easy / Output |
| `download_models.py` | 模型清单、断点续传下载器、HTTP 路由、命令行 |
| `caption.py` | 反推与翻译的后端 |
| `caption_node.py` | `图生文反推 · 中英双语` 节点 |
| `voice.py` | TTS 模型加载与卸载 |
| `voice_node.py` | `音色设计` / `音色克隆` 两个节点 |
| `vram.py` | 显存/内存释放，接进 ComfyUI 的 `free_memory` |
| `web/minimax_h3_easy_ui.js` | 节点界面：Media 输入、`@` 提及编辑器、拖线快速建节点 |
| `web/h3_models.js` | 模型下载面板 |
| `web/h3_api.js` | HTTP 小工具 |

### widgets_values 的契约

`WIDGET_DEFAULTS` 里那 13 格就是全部，读写都按**名字**来，不依赖 litegraph 排的
widget 顺序。节点内的提示词编辑器是个 DOM widget，会被插到 `prompt` 后面并在序列化时
占掉一格；载入时它还没挂上，于是存 14 读 13，`resolution` 之后整体串位。
`onSerialize` 按名字重拼整个数组就没这个问题。

---

## 致谢

节点层——单一可排序的 `Media` 输入、`@` 提及式提示词编辑器、拖线快速建节点——
来自 [nkxx188/ComfyUI-MiniMaxH3-Easy](https://github.com/nkxx188/ComfyUI-MiniMaxH3-Easy)（MIT）。
本包在它之上做了模型下载器、图生文反推节点和音色节点。

## 许可证

MIT，见 [LICENSE](LICENSE)。
