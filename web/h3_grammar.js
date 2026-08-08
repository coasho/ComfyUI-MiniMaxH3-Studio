/**
 * H3 语法 schema —— UI 与生成时拼装的唯一事实来源。
 *
 * 想扩展语法（新字段、新用途、新运镜、新分段）只改这个文件，
 * 编辑器面板和提示词拼装都会自动跟着变，不用碰 UI 代码。
 */

export const CAMERA_MOTIONS = [
    { id: "", label: "（不指定）", en: "" },
    { id: "push_in", label: "推进", en: "pushes in" },
    { id: "pull_back", label: "拉远", en: "pulls back", widens: true },
    { id: "pan_left", label: "左摇", en: "pans to the left" },
    { id: "pan_right", label: "右摇", en: "pans to the right" },
    { id: "tilt_up", label: "上摇", en: "tilts up" },
    { id: "tilt_down", label: "下摇", en: "tilts down" },
    { id: "arc_left", label: "左弧绕", en: "arcs to the left" },
    { id: "arc_right", label: "右弧绕", en: "arcs to the right" },
    { id: "track_follow", label: "跟拍", en: "tracks with the subject" },
    { id: "track_back", label: "后退跟拍", en: "tracks backward", widens: true },
    { id: "whip_pan", label: "甩镜", en: "whip-pans" },
    { id: "handheld", label: "手持晃动", en: "shakes slightly, handheld" },
    { id: "static", label: "固定机位", en: "holds still" },
];

export const CAMERA_AMPLITUDE = [
    { id: "", label: "（不指定）", en: "" },
    { id: "small", label: "小幅", en: "with small amplitude" },
    { id: "medium", label: "中幅", en: "with medium amplitude" },
    { id: "large", label: "大幅", en: "with large amplitude" },
];

export const CAMERA_SPEED = [
    { id: "", label: "（不指定）", en: "" },
    { id: "slow", label: "慢速", en: "at slow speed" },
    { id: "medium", label: "中速", en: "at medium speed" },
    { id: "fast", label: "快速", en: "at fast speed" },
];

/** 景别：决定嘴部有多少像素，直接关系口型能否被看见 */
export const SHOT_SIZES = [
    { id: "", label: "（不指定）", en: "", mouthPixels: "unknown" },
    { id: "ecu", label: "大特写", en: "an extreme close-up", mouthPixels: "big" },
    { id: "cu", label: "特写", en: "a close-up", mouthPixels: "big" },
    { id: "mcu", label: "中近景（腰部以上）", en: "a medium close-up framed from the waist up", mouthPixels: "ok" },
    { id: "ms", label: "中景", en: "a medium shot", mouthPixels: "ok" },
    { id: "full", label: "全身", en: "a full-body shot", mouthPixels: "tiny" },
    { id: "wide", label: "远景", en: "a wide shot", mouthPixels: "tiny" },
];

export const TRANSITIONS = [
    { id: "cut", label: "硬切", en: "the camera cuts to" },
    { id: "dissolve", label: "叠化", en: "the shot cross-dissolves to" },
    { id: "fade", label: "淡入淡出", en: "the shot fades to" },
    { id: "wipe", label: "划像", en: "the shot wipes to" },
];

/** 媒体用途：与官方 r2v 语义对应 */
export const MEDIA_ROLES = {
    image: [
        { id: "identity", label: "角色外观（完全保留）", retention: "fully_preserved",
          en: (t) => `${t} defines <Subject 1>'s appearance and is fully retained` },
        { id: "style", label: "画风参考", retention: "attribute_transfer",
          en: (t) => `${t} defines the rendering style: line weight, shading, palette and saturation` },
        { id: "prop", label: "道具/服装/物件", retention: "partially_preserved",
          en: (t) => `${t} defines a prop or garment that must appear as shown` },
        { id: "scene", label: "场景/环境", retention: "partially_preserved",
          en: (t) => `${t} defines the environment` },
        { id: "first_frame", label: "首帧", retention: "fully_preserved",
          en: (t) => `${t} is fully referenced at the 0.00-second mark` },
        { id: "last_frame", label: "尾帧", retention: "fully_preserved",
          en: (t) => `${t} is fully referenced at the final frame` },
    ],
    audio: [
        { id: "timbre", label: "音色（说话人）",
          en: (t) => `${t} is the voice-timbre reference for <Subject 1> (S1); ` +
                     `she speaks with its exact timbre, pitch and vocal age throughout` },
        { id: "bgm", label: "配乐风格",
          en: (t) => `${t} defines the style of the non-diegetic music` },
        { id: "ambience", label: "环境音风格",
          en: (t) => `${t} defines the character of the ambient soundscape` },
    ],
    video: [
        { id: "motion", label: "动作/运动参考",
          en: (t) => `${t} defines the motion and timing to imitate` },
        { id: "style_v", label: "画风参考",
          en: (t) => `${t} defines the rendering style` },
    ],
};

/** 台词投送方式 */
export const VOICE_MODES = [
    { id: "onscreen", label: "画内说话（露脸）", en: "on-screen, lips moving clearly and visibly on every syllable" },
    { id: "offscreen", label: "画外音（不露嘴）", en: "in an off-screen voiceover while the lips remain completely closed" },
    { id: "narration", label: "旁白", en: "as narration over the scene" },
];

/** 常用语气，可自由追加；UI 里是可编辑下拉 */
export const DELIVERY_PRESETS = [
    "压低的气声耳语，克制鬼祟",
    "很轻的自言自语，节奏平稳",
    "明显比之前更小声的含糊单调",
    "情绪激动地喊出来",
    "带笑意的轻快语气",
    "颤抖迟疑，几乎说不下去",
    "面无表情的平铺直叙",
];

/** 六段式分段定义：生成时按此顺序拼装 */
export const SECTIONS = [
    { key: "subject_definitions", label: "主体定义", required: true,
      hint: "角色外观逐项描述。颜色务必写排除项（NOT orange…），否则模型会往它熟悉的方向飘。" },
    { key: "art_style", label: "画风", required: false,
      hint: "线条、上色方式、对比度、饱和度。不写会套用默认的高饱和电视动画风。" },
    { key: "retention_analysis", label: "保留声明", required: true, auto: true,
      hint: "由媒体用途自动生成；另可手写「不保留」项（如三视图的白底与 T-pose）。" },
    { key: "detailed_description", label: "分镜", required: true, auto: true,
      hint: "由分镜卡自动拼装，含时间码、运镜、台词标签。" },
    { key: "overall_soundscape", label: "环境音", required: true,
      hint: "环境音与动作音，1-4 句。确实静音写 N/A。不含台词与配乐。" },
    { key: "non_diegetic_music", label: "配乐", required: true,
      hint: "只有观众听得到的音乐，1-3 句。没有写 N/A。" },
];

export const LANGUAGES = [
    "Chinese", "English", "Japanese", "Korean", "German",
    "French", "Russian", "Portuguese", "Spanish", "Italian", "Arabic",
];

/** 语速预算——Guide 完全没有这个，却是最常踩的坑 */
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

/** 景别与台词的冲突检查（口型看不看得见） */
export function framingWarning(shot) {
    if (!shot.lines?.length) return null;
    const size = SHOT_SIZES.find((x) => x.id === shot.size);
    const motion = CAMERA_MOTIONS.find((x) => x.id === shot.motion);
    if (size?.mouthPixels === "tiny") {
        return `景别「${size.label}」下嘴部只有几个像素，本镜的台词看不出口型。改用中近景或更近。`;
    }
    if (motion?.widens || motion?.wideens) {
        return `本镜在说话时做「${motion.label}」，画面拉开后嘴部会缩到几个像素。把拉远放到台词结束之后。`;
    }
    return null;
}

export const GRAMMAR_VERSION = 1;
