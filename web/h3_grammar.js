/**
 * H3 语法 schema —— UI 与生成时拼装的唯一事实来源。
 *
 * 词表依据 MiniMaxAI/MiniMax-H3 官方文档：
 *   docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md
 *   docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md
 * 标 official:true 的是官方受控词表，不要随意增删；
 * 标 official:false 的是本插件的辅助项（官方没有对应受控词表，只作为自然语言写进描述）。
 *
 * 扩展语法只改这个文件，编辑器面板与提示词拼装都会跟随。
 */

/* ------------------------------------------------------------------ 运镜 */
/** 官方运镜词表（base guide「Camera Motion Types」全集） */
export const CAMERA_MOTIONS = [
    { id: "", label: "（不指定）", en: "", official: true },
    { id: "zoom_in", label: "变焦推近 Zoom In", en: "zooms in", official: true },
    { id: "zoom_out", label: "变焦拉远 Zoom Out", en: "zooms out", official: true, widens: true },
    { id: "push_in", label: "推进 Push In", en: "pushes in", official: true },
    { id: "pull_out", label: "后拉 Pull Out", en: "pulls out", official: true, widens: true },
    { id: "pan_left", label: "左摇 Pan Left", en: "pans to the left", official: true },
    { id: "pan_right", label: "右摇 Pan Right", en: "pans to the right", official: true },
    { id: "truck_left", label: "左横移 Truck Left", en: "trucks to the left", official: true },
    { id: "truck_right", label: "右横移 Truck Right", en: "trucks to the right", official: true },
    { id: "tilt_up", label: "上摇 Tilt Up", en: "tilts up", official: true },
    { id: "tilt_down", label: "下摇 Tilt Down", en: "tilts down", official: true },
    { id: "pedestal_up", label: "升镜 Pedestal Up", en: "pedestals up", official: true },
    { id: "pedestal_down", label: "降镜 Pedestal Down", en: "pedestals down", official: true },
    { id: "arc", label: "弧形环绕 Arc Shot", en: "moves in an arc around the subject", official: true },
    { id: "tracking", label: "跟拍 Tracking Shot", en: "tracks with the subject", official: true },
    { id: "static", label: "固定机位 Static Shot", en: "holds a static shot", official: true },
    { id: "shake_slight", label: "轻微晃动 Shake Slightly", en: "shakes slightly", official: true },
    { id: "shake_strong", label: "强烈晃动 Shake Strongly", en: "shakes strongly", official: true },
    { id: "pov", label: "主观视角 POV", en: "takes the subject's POV", official: true },
    { id: "roll_cw", label: "顺时针滚转 Roll CW", en: "rolls clockwise", official: true },
    { id: "roll_ccw", label: "逆时针滚转 Roll CCW", en: "rolls counterclockwise", official: true },
];

/** 官方只给了 small / large 两档，不要自造 medium */
export const CAMERA_AMPLITUDE = [
    { id: "", label: "（不指定）", en: "", official: true },
    { id: "small", label: "小幅", en: "with small amplitude", official: true },
    { id: "large", label: "大幅", en: "with large amplitude", official: true },
];

/** 官方只给了 slow / fast 两档 */
export const CAMERA_SPEED = [
    { id: "", label: "（不指定）", en: "", official: true },
    { id: "slow", label: "慢速", en: "at slow speed", official: true },
    { id: "fast", label: "快速", en: "at fast speed", official: true },
];

/**
 * 景别：官方【没有】受控词表，这里是本插件的辅助项，会作为自然语言写进描述。
 * mouthPixels 用于判断该景别下台词能否看见口型。
 */
export const SHOT_SIZES = [
    { id: "", label: "（不指定）", en: "", mouthPixels: "unknown", official: false },
    { id: "ecu", label: "大特写", en: "an extreme close-up", mouthPixels: "big", official: false },
    { id: "cu", label: "特写 close-up", en: "a close-up", mouthPixels: "big", official: false },
    { id: "mcu", label: "中近景（腰上）", en: "a medium close-up framed from the waist up", mouthPixels: "ok", official: false },
    { id: "ms", label: "中景", en: "a medium shot", mouthPixels: "ok", official: false },
    { id: "mws", label: "中远景 medium-wide", en: "a medium-wide shot", mouthPixels: "tiny", official: false },
    { id: "full", label: "全身", en: "a full-body shot", mouthPixels: "tiny", official: false },
    { id: "wide", label: "远景", en: "a wide shot", mouthPixels: "tiny", official: false },
];

/** 机位角度：官方无受控词表，作为自然语言 */
export const CAMERA_ANGLES = [
    { id: "", label: "（不指定）", en: "", official: false },
    { id: "eye", label: "平视", en: "at eye level", official: false },
    { id: "low", label: "低角度仰拍", en: "from a low angle", official: false },
    { id: "high", label: "高角度俯拍", en: "from a high angle", official: false },
    { id: "bird", label: "顶视/鸟瞰", en: "from a bird's-eye view", official: false },
    { id: "dutch", label: "荷兰角（倾斜）", en: "with a dutch tilt", official: false },
    { id: "ots", label: "过肩", en: "over the shoulder", official: false },
];

/** 官方提到可由用户指定：cross-dissolve / fade / wipe，外加默认硬切 */
export const TRANSITIONS = [
    { id: "cut", label: "硬切", en: "the camera cuts to", official: true },
    { id: "dissolve", label: "叠化 cross-dissolve", en: "the shot cross-dissolves to", official: true },
    { id: "fade", label: "淡入淡出 fade", en: "the shot fades to", official: true },
    { id: "wipe", label: "划像 wipe", en: "the shot wipes to", official: true },
];

/* -------------------------------------------------------------- 保留等级 */
/** 官方视觉内容保留等级（ref guide 全集） */
export const VISUAL_RETENTION = [
    { id: "fully_preserved", label: "完全保留 fully_preserved", official: true },
    { id: "partially_preserved", label: "部分保留 partially_preserved", official: true },
    { id: "attribute_transfer", label: "属性迁移 attribute_transfer", official: true },
    { id: "weak_reference", label: "弱参考 weak_reference", official: true },
];

/** 官方音频保留等级，与视觉是【两套独立】词表 */
export const AUDIO_RETENTION = [
    { id: "fully_copy", label: "完整复制 fully_copy", official: true },
    { id: "partially_copy", label: "部分复制 partially_copy", official: true },
    { id: "reference", label: "仅参考 reference", official: true },
    { id: "weak_reference", label: "弱参考 weak_reference", official: true },
];

/**
 * 官方任务类型，可用 + 组合，作为 summary 段的方括号前缀发送：
 *   summary: [reference generation + audio reference] …
 */
export const TASK_TYPES = [
    { id: "keyframe_completion", label: "关键帧补全", en: "keyframe completion", official: true,
      hint: "给了首帧/尾帧，让模型补中间。" },
    { id: "reference_generation", label: "参考生成", en: "reference generation", official: true,
      hint: "最常用。按参考图的角色/画风/道具生成新内容。" },
    { id: "video_editing", label: "视频编辑", en: "video editing", official: true,
      hint: "在已有视频上改。需要接视频素材。" },
    { id: "video_continuation", label: "视频续写", en: "video continuation", official: true,
      hint: "从已有视频的结尾接着往下拍。" },
    { id: "audio_reuse", label: "音频复用", en: "audio reuse", official: true,
      hint: "整轨或部分照搬参考音频，不另生成语音。" },
    { id: "audio_reference", label: "音频参考", en: "audio reference", official: true,
      hint: "只借音色/风格，语音仍由模型新生成。指定音色时选这个。" },
];

/* -------------------------------------------------------------- 媒体用途 */
export const MEDIA_ROLES = {
    image: [
        { id: "identity", label: "角色外观", retention: "fully_preserved",
          en: (t) => `${t} defines <Subject 1>'s appearance` },
        { id: "style", label: "画风参考", retention: "weak_reference",
          en: (t) => `${t} defines the rendering style: line weight, shading, palette and saturation` },
        { id: "prop", label: "道具/服装/物件", retention: "partially_preserved",
          en: (t) => `${t} defines a prop or garment that must appear as shown` },
        { id: "scene", label: "场景/环境", retention: "partially_preserved",
          en: (t) => `${t} defines the environment` },
        { id: "transfer", label: "属性迁移到别的主体", retention: "attribute_transfer",
          en: (t) => `${t}'s characteristics are transferred to a different subject` },
        { id: "first_frame", label: "首帧", retention: "fully_preserved",
          en: (t) => `${t} is fully referenced at the 0.00-second mark` },
        { id: "last_frame", label: "尾帧", retention: "fully_preserved",
          en: (t) => `${t} is fully referenced at the final frame` },
    ],
    audio: [
        { id: "timbre", label: "音色（说话人）", retention: "reference",
          en: (t) => `${t} is the voice-timbre reference for <Subject 1> (S1); ` +
                     `she speaks with its exact timbre, pitch and vocal age throughout` },
        { id: "bgm", label: "配乐风格", retention: "reference",
          en: (t) => `${t} defines the style of the non-diegetic music` },
        { id: "ambience", label: "环境音风格", retention: "weak_reference",
          en: (t) => `${t} defines the character of the ambient soundscape` },
        { id: "copy_full", label: "整轨复用", retention: "fully_copy",
          en: (t) => `${t} is used as the complete final audio track` },
        { id: "copy_part", label: "部分复用", retention: "partially_copy",
          en: (t) => `${t} is partially copied into the final audio track` },
    ],
    video: [
        { id: "motion", label: "动作/运动参考", retention: "reference",
          en: (t) => `${t} defines the motion and timing to imitate` },
        { id: "style_v", label: "画风参考", retention: "weak_reference",
          en: (t) => `${t} defines the rendering style` },
        { id: "edit_src", label: "编辑源素材", retention: "partially_preserved",
          en: (t) => `${t} is the editing source` },
        { id: "continue", label: "续写起点", retention: "fully_preserved",
          en: (t) => `${t} is the clip to continue from` },
    ],
};

/* -------------------------------------------------------------- 台词相关 */
export const VOICE_MODES = [
    { id: "onscreen", label: "画内说话（露脸）",
      en: "on-screen, lips moving clearly and visibly on every syllable", official: true },
    { id: "offscreen", label: "画外音（嘴不动）",
      en: "in an off-screen voiceover while the lips remain completely closed", official: true },
    { id: "narration", label: "旁白", en: "as narration over the scene", official: false },
];

/** 官方支持的 11 种台词语言 */
export const LANGUAGES = [
    "Chinese", "English", "Japanese", "Korean", "German",
    "French", "Russian", "Portuguese", "Spanish", "Italian", "Arabic",
];

/** 官方台词连续性标记 */
export const CONTINUITY = [
    { id: "complete", label: "本镜内说完", tag: "", official: true },
    { id: "into_next", label: "延续到下一镜", tag: "<scenetrans>", official: true },
    { id: "from_prev", label: "承接上一镜", tag: "<scenetrans>", official: true },
    { id: "cutoff", label: "被打断（半句）", tag: "<cutoff>", official: true },
];

export const DELIVERY_PRESETS = [
    "压低的气声耳语，克制鬼祟",
    "很轻的自言自语，节奏平稳",
    "明显比之前更小声的含糊单调",
    "情绪激动地喊出来",
    "带笑意的轻快语气",
    "颤抖迟疑，几乎说不下去",
    "面无表情的平铺直叙",
];

/* ---------------------------------------------------------------- 分段 */
/** 参考模式六段，顺序为官方规定，不可调换 */
export const SECTIONS_REF = [
    // auto 只标「整段由别处拼出来、面板不给输入框」的段落。本段要人写角色外观，
    // 素材用途只是自动追加在后面，所以不能标 auto——标了输入框就没了。
    { key: "subject_definitions", label: "主体定义", required: true,
      hint: "角色外观：发型发色、五官、服装、体型。颜色务必写排除项（NOT orange…），" +
            "否则模型会往它熟悉的方向飘。上面配好的素材用途会自动追加到本段末尾。" },
    { key: "summary", label: "整体概述", required: true,
      hint: "一段话讲清整体内容、镜头数、风格基调。官方必需段落。" },
    { key: "retention_analysis", label: "保留声明", required: true, auto: true,
      hint: "由素材用途自动生成；另可手写「不保留」项（如三视图的白底与 T-pose）。" },
    { key: "detailed_description", label: "分镜", required: true, auto: true,
      hint: "由分镜卡自动拼装，含时间码、运镜、台词标签。" },
    { key: "overall_soundscape", label: "环境音", required: true,
      hint: "环境音与动作音，1-4 句。确实静音写 N/A。不含台词与配乐。" },
    { key: "non_diegetic_music", label: "配乐", required: true,
      hint: "只有观众听得到的音乐，1-3 句。没有写 N/A。" },
];

/** 基础模式（t2v/i2v/fl2v）只有三段，结构与参考模式不同 */
export const SECTIONS_BASE = [
    { key: "integrated_multimodal_description", label: "整体描述", required: true, auto: true,
      hint: "镜头、主体、运镜、画面内文字，由分镜卡拼装。" },
    { key: "overall_soundscape", label: "环境音", required: true, hint: "环境音与动作音，1-4 句。" },
    { key: "non_diegetic_music", label: "配乐", required: true, hint: "只有观众听得到的音乐。" },
];

/** 画风：官方没有独立段落，写进 subject_definitions 或 summary */
export const STYLE_FIELD = {
    key: "art_style", label: "画风（并入主体定义）", required: false, official: false,
    hint: "官方没有 art_style 段落，这里填的内容会并入 subject_definitions 一起发送。",
};

/* ------------------------------------------------------------ 语速预算 */
/** 官方无此约束，是本插件补的——最常踩的坑 */
export const SPEECH = { charsPerSecond: 4.5, padBefore: 0.35, padAfter: 0.35 };

export function spokenChars(text) {
    const body = String(text || "").replace(/^\[[^\]]*\]/, "");
    return [...body].filter((c) => !"，。！？…—、；：,.!?;:\"'（）()《》 \t　".includes(c)).length;
}

export function speechSeconds(text) {
    return spokenChars(text) / SPEECH.charsPerSecond;
}

export function cameraSentence(shot) {
    const m = CAMERA_MOTIONS.find((x) => x.id === shot.motion);
    if (!m || !m.en) return "";
    const a = CAMERA_AMPLITUDE.find((x) => x.id === shot.amplitude);
    const s = CAMERA_SPEED.find((x) => x.id === shot.speed);
    return ["The camera", m.en, a?.en, s?.en].filter(Boolean).join(" ") + ".";
}

export function framingWarning(shot) {
    if (!shot.lines?.length) return null;
    const size = SHOT_SIZES.find((x) => x.id === shot.size);
    const motion = CAMERA_MOTIONS.find((x) => x.id === shot.motion);
    if (size?.mouthPixels === "tiny") {
        return `景别「${size.label}」下嘴部只有几个像素，本镜的台词看不出口型。改用中近景或更近。`;
    }
    if (motion?.widens) {
        return `本镜在说话时做「${motion.label}」，画面拉开后嘴部会缩到几个像素。把拉远放到台词结束之后。`;
    }
    return null;
}

export const GRAMMAR_VERSION = 2;
