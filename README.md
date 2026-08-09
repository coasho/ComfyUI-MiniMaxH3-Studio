# ComfyUI-MiniMaxH3-Studio

[中文说明](README_CN.md)

A ComfyUI node pack for MiniMax H3. Images, video and audio share one sortable `Media`
input and the prompt box references them inline as `@name`; the prompt itself you write
yourself, in the official grammar.

It also ships the things that otherwise stall a first install: a **one-click model
downloader**, **example workflows that use nothing but core ComfyUI nodes**, and two
companion nodes — **image captioning** and **voice generation**.

<p align="center">
  <img src="images/reference-editor-en.png" alt="The node with images, video and audio on one Media input" width="720">
</p>

<sup>One `Media` input takes every asset; drag to reorder and that decides the
`<Picture N>` / `<Audio N>` numbering.</sup>

---

## Install

```bash
git clone https://github.com/coasho/ComfyUI-MiniMaxH3-Studio.git
```

Clone it into `ComfyUI/custom_nodes/`, then install the optional extras and restart:

```bash
pip install -r ComfyUI-MiniMaxH3-Studio/requirements.txt
```

The three main nodes need nothing beyond what ComfyUI already has. `requirements.txt`
only covers the captioning node; without it that node simply does not register and
everything else keeps working.

**ComfyUI ≥ `bdcb886` (2026-08-06 nightly) is strongly recommended.** That commit adds
native MiniMax-H3 AV flow sampling (`ModelSamplingAV`); before it, the 4-step Turbo LoRA
produced badly clipped audio. The example workflows are built around the Turbo LoRA.

The shipped LoRA is **`minimax_h3_turbo_v4_step600_ema`**, which its author calls the
strongest checkpoint of the line — better static and small-motion shots, better faces,
fingers and fine texture, and none of the over-sharpening of the v1 checkpoints. Useful
range is **4–8 steps; 6–8 look noticeably better than 4**, and past 8 it stops helping and
starts over-sharpening. The examples ship at 6 steps, scheduler `simple`, strength `1.0`.
The one case where the older `ckpt850` still wins is 4 steps *and* heavy motion, where v4
can smear; going to 6–8 steps fixes that instead.

The voice nodes additionally need [ComfyUI-Qwen3-TTS](https://github.com/lrzjason/ComfyUI-Qwen3-TTS)
installed — this pack drives its TTS node classes. Without it the voice nodes do not
register and nothing else is affected.

---

## One-click model download

H3's weights live in three HuggingFace repos under near-identical names, and you need
six files before anything runs. Don't copy links by hand.

Open the **MiniMax H3 Loader** node and hit **⬇ Download models**: what you have, what is
missing and how many bytes are left, all in one panel.

You can also run it without ComfyUI:

```bash
python ComfyUI/custom_nodes/ComfyUI-MiniMaxH3-Studio/download_models.py --list
```

```bash
python ComfyUI/custom_nodes/ComfyUI-MiniMaxH3-Studio/download_models.py --required
```

| id | required | size | destination |
|---|---|---|---|
| `h3_ref2va` | ✔ | 19.5 GB | `models/diffusion_models/` |
| `h3_fl2va` | ✔ | 19.5 GB | `models/diffusion_models/` |
| `h3_text_encoder` | ✔ | 14.6 GB | `models/text_encoders/` |
| `h3_text_encoder_int8` | — | 25.3 GB | alternative for non-50-series GPUs |
| `h3_vae` | ✔ | 5.4 GB | `models/vae/` (video + audio) |
| `h3_turbo_lora` | ✔ | 592 MB | `models/loras/` — v4-600 EMA, author's pick |
| `h3_turbo_lora_ckpt850` | — | 592 MB | older, only wins at 4 steps + heavy motion |
| `qwen3vl_caption` | — | 8.3 GB | `models/LLM/Qwen3-VL-4B-Instruct/` |
| `wd14_tagger` | — | 1.2 GB | reuses `comfyui-wd14-tagger`'s models dir if present |
| `tts_voicedesign` | — | 4.2 GB | `models/TTS/Qwen/…-VoiceDesign/` |
| `tts_base` | — | 4.2 GB | `models/TTS/Qwen/…-Base/` |

Details that actually save you:

- **Resumable.** Downloads go to a `.part` beside the target and continue from where they
  stopped — cancel, close ComfyUI, lose the network, it does not matter.
  `huggingface_hub`'s `snapshot_download(local_dir=…)` has no resume on Xet storage, so
  killing the process loses gigabytes; this uses raw `Range` requests with its own read
  timeout instead.
- **No second copy.** Files land straight in ComfyUI's models directory, never through
  `~/.cache/huggingface`.
- **Mirrors.** Set `HF_ENDPOINT=https://hf-mirror.com`.
- **Verification.** A `.safetensors` must pass its own header check before it is renamed
  into place, so a half file is never mistaken for a complete one. Files already on disk
  are accepted on that self-check alone rather than a byte-for-byte match against the
  manifest — different repacks of the same weights differ by a few dozen bytes, and
  judging by size would make you re-download 19.5 GB for nothing.

---

## Example workflows

Four graphs in `example_workflows/`, using **only core ComfyUI nodes plus this pack's
own** — no KJNodes, no wavespeed, no patched samplers.

| file | purpose | needs |
|---|---|---|
| `MiniMax_H3_Studio_Reference.json` | reference-to-video | `h3_ref2va` + text encoder + VAE + Turbo LoRA |
| `MiniMax_H3_Studio_TextToVideo.json` | text- / image-to-video | `h3_fl2va` + text encoder + VAE + Turbo LoRA |
| `Image_to_Prompt_Bilingual.json` | captioning, no video | `qwen3vl_caption` (+ `wd14_tagger` for anime) |
| `MiniMax_H3_Voice.json` | voice generation, no video | `tts_voicedesign` or `tts_base` |

Both video graphs point their reference image at ComfyUI's bundled `input/example.png` —
swap in your own reference sheet.

---

## 1. Aspect ratio: don't let the first frame stretch

- **`aspect_ratio = Auto (follow image)`** picks the closest official ratio from the first
  frame / first reference image.
- **`first_frame_fit = crop`** scales proportionally and centre-crops. This is the default.
  The other setting, `stretch`, is core ComfyUI's original behaviour — it stretches the
  image onto the canvas and distorts it.

Together these two defaults give zero distortion for an image of any ratio. Locking the
aspect ratio to something the source does not match still trims the edges — that is
expected — but nothing is ever distorted.

> With `resolution = Custom` the aspect ratio is ignored entirely: explicit width/height
> wins, so `auto` has nothing to do. Pick a preset if you want the canvas to follow the image.

---

## 2. Writing the prompt

Write the prompt yourself in the official grammar. The base modes (T2VA / I2VA / FL2VA /
L2VA) use three sections — `integrated_multimodal_description`, `overall_soundscape`,
`non_diegetic_music`. Reference-to-video (Ref2VA) uses six, adding `subject_definitions`,
`summary` and `retention_analysis`.

**I2VA must open with this exact line**, followed by a blank line:

```
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.
```

### `<Subject N>` is not only "a character"

It is any reusable declared entity. The official set of visible content types:

| type | official phrase | default retention |
|---|---|---|
| person | `identity and appearance` | fully_preserved |
| object / clothing / prop | `visible object appearance` | fully_preserved |
| scene / environment | `scene and environment` | fully_preserved |
| action / pose | `pose and movement` | **attribute_transfer** (must name a target) |
| art style | `visual style` | weak_reference |
| off-screen voice | none (takes no Subject number) | — |

Binding sentence: `The {phrase} of <Subject 1> {is|are} defined by <Picture 1>.`
One entity may bind several assets (front view + side view + costume detail).

### The two numbering schemes are unrelated

- `<Subject N>` follows **declaration order**, and only entities that appear on screen take a number
- `(S1)(S2)` follows **first-speaking order**, and an entity that never speaks gets none

So `<Subject 2> (S1)` is perfectly normal.

### `@` references

Write `@filename` in the prompt box to reference an asset on the `Media` input; at queue
time it becomes `<Picture N>` / `<Audio N>` / `<Video N>`. Press `@` for a completion list,
↑ ↓ to pick, Enter to insert. Switching `@ reference mode` to "by index" uses the asset's
position on `Media` instead.

<p align="center">
  <img src="images/mention-popup-en.png" alt="Press @ for the asset list" width="330">
</p>

### Official limits

4–15 s, 24 fps, ≤9 images / ≤3 videos / ≤3 audio (≤12 mixed), prompt ≤7000 characters.
Camera motion / amplitude / speed are controlled vocabularies, and **amplitude and speed
have exactly two values each** (small/large, slow/fast). There is **no** official
vocabulary for focal-length words like "wide-angle" or "macro", nor for shot size and
camera angle — write those as ordinary English.

---

## 3. Captioning node

`Image to Prompt · Bilingual` takes one image and returns five texts: prose and
comma-tags, each in English and Chinese, plus the raw WD14 tags. Each of the four has its
own switch, because every one you enable costs another model pass.

The Chinese is **translated from the English** rather than written separately: the two must
say the same thing, otherwise you proof-read the Chinese, ship it, and the English you
actually sent said something else. The 8.3 GB VLM is released when the run finishes; turn
`unload_after` off if you are batching.

Two models cooperate — this is **not** either/or:

| model | size | job |
|---|---|---|
| `SmilingWolf/wd-eva02-large-tagger-v3` | 1.2 GB ONNX | discrete anime attributes (best F1 of the v3 line, 0.4772) |
| `Qwen/Qwen3-VL-4B-Instruct` | 8.3 GB bf16 | prose description, works for both photo and anime |

For anime, WD14 tags are extracted first and fed to the VLM as **ground truth**, with an
explicit note that the tags beat its own reading on hair colour, eye colour and clothing.
For photographs, turn `use_wd14_tags` off and go straight to the VLM.

> What comes out is a **plain description** with no H3-specific processing — no
> `<Subject N>` scaffolding, no "NOT adjacent colour" fences, no reference-sheet layout
> stripping. What you do with it is your business.

---

## 4. Voice nodes

**The "middle-aged lady voice" problem is a lack of choice, not a bad model.** VoiceDesign
samples randomly, and the same description with a different seed lands somewhere quite
different (measured within-group similarity 0.989 — it really does drift). So the
`Voice Design` node generates 4 candidates by default, concatenated into one clip: hook up
`PreviewAudio`, listen through, then put the seed reported on the `seeds` output into
`seed` and set `count` back to 1 to lock it in.

| node | model | notes |
|---|---|---|
| `Voice Design · from text` | `Qwen3-TTS-12Hz-1.7B-VoiceDesign` 4.2 GB | free-form description of the voice; random sampling, hence the candidates |
| `Voice Clone · from audio` | `Qwen3-TTS-12Hz-1.7B-Base` 4.2 GB | extracts a timbre vector from reference audio; no dice-rolling |

**CustomVoice is deliberately unused** (the fixed Vivian presets) — measurably the source
of the "middle-aged lady" complaint.

Measured timbre consistency (MFCC cosine): design within-group 0.989, clone within-group
0.997, clone across references 0.980 — cloning is steadier, and the reference really does
determine the timbre. (The metric saturates toward 1.0 on short clips, so trust your ears.)

Both nodes output a standard `AUDIO`, which **connects straight to the `Media` input of
`MiniMax H3 Easy`** — no need to save a file and load it back. Add `SaveAudio` if you want
to reuse the voice across sessions.

> To feed a saved voice back through `LoadAudio`, the file must sit in the **root** of
> `input/`: `LoadAudio` lists files with `os.listdir(input_dir)` and does not recurse, so
> anything in a subdirectory never appears in the dropdown.

Make the audition text the line the character actually says in the shot — otherwise what
you heard is not what you get.

---

## 5. VRAM and RAM

The captioning VLM is 8 GB and the voice models 4 GB; both will blow up alongside H3. So:

- `MiniMaxH3Easy.generate()` unloads both before it starts
- each has a watchdog that unloads after 10 idle minutes
- both companion nodes default to `unload_after = True` and release immediately: ComfyUI's
  `free_memory`, `gc` ×3, `empty_cache`, `ipc_collect`, plus `EmptyWorkingSet` on Windows
  to hand pages back to the OS

Measured peaks on a 16 GB card: captioning 8.78 GB, voice 4.09 GB.

> Unloading **never** does `.to("cpu")`. That moves 8 GB of weights from VRAM into RAM and
> leaves them there (measured RSS 0.83 → 7.63 GB), starving ComfyUI itself instead.

---

## 6. Files

| file | role |
|---|---|
| `nodes.py` | the three main nodes: Loader / Easy / Output |
| `download_models.py` | manifest, resumable downloader, HTTP routes, CLI |
| `caption.py` | captioning and translation backend |
| `caption_node.py` | the `Image to Prompt · Bilingual` node |
| `voice.py` | TTS model loading and unloading |
| `voice_node.py` | the `Voice Design` / `Voice Clone` nodes |
| `vram.py` | VRAM/RAM release, wired into ComfyUI's `free_memory` |
| `web/minimax_h3_easy_ui.js` | node UI: Media input, `@` mention editor, drag-to-create |
| `web/h3_models.js` | model download panel |
| `web/h3_api.js` | HTTP helpers |

### The widgets_values contract

The 13 entries in `WIDGET_DEFAULTS` are the whole of it, and both reading and writing go
**by name** rather than trusting litegraph's widget order. The in-node prompt editor is a
DOM widget that gets spliced in after `prompt` and takes a slot during serialization; on
load it is not installed yet, so you save 14 and read 13, and everything after
`resolution` shifts by one. Rebuilding the array by name in `onSerialize` removes the
whole class of problem.

---

## Credits

The node layer — the single sortable `Media` input, the `@`-mention prompt editor and
drag-to-create — comes from
[nkxx188/ComfyUI-MiniMaxH3-Easy](https://github.com/nkxx188/ComfyUI-MiniMaxH3-Easy) (MIT).
This pack adds the model downloader, the captioning node and the voice nodes.

## License

MIT, see [LICENSE](LICENSE).
