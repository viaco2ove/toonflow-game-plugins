/**
 * AI 模型厂商目录 —— 移植自 Toonflow-game-web/src/utils/modelConfigCatalog.ts
 *
 * 之所以从 web 仓库移植而不是 app：app 的 Electron 包里只有已构建产物
 * （scripts/web/assets/index-*.js），源码在 Toonflow-game-web，本文件即 app 打包的数据源。
 *
 * 与原 TS 的差异（均为 map-editor 特有增量，不改动 app 既有条目）：
 *   1. 新增 `local_u2net`（U²-Net 非生物通用抠图，map-editor 本轮新增）
 *   2. 去掉 map-editor 用不到的语音厂商（voice/voice_design/voice_clone 相关）
 *      —— 保留字段结构以便日后需要时对齐，只是不出现在下拉里
 */

export const MODEL_MANUFACTURERS = [
  {
    value: 'volcengine',
    label: '火山引擎',
    website: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
    kinds: ['text', 'image'],
    defaults: {
      text: 'https://ark.cn-beijing.volces.com/api/v3',
      image: 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
    },
  },
  {
    value: 'openai',
    label: 'OpenAI',
    kinds: ['text', 'image'],
    defaults: {
      text: 'https://api.openai.com/v1',
      image: 'https://api.openai.com/v1/images/generations',
    },
  },
  {
    value: 'gemini',
    label: 'Gemini',
    website: 'https://ai.google.dev/gemini-api/docs/api-key?hl=zh-cn',
    kinds: ['text', 'image'],
    defaults: {
      text: 'https://generativelanguage.googleapis.com/v1beta',
      image: 'https://generativelanguage.googleapis.com/v1beta',
    },
  },
  {
    value: 'deepseek',
    label: 'DeepSeek',
    website: 'https://platform.deepseek.com',
    kinds: ['text'],
    defaults: { text: 'https://api.deepseek.com/v1' },
  },
  {
    value: 'zhipu',
    label: '智谱',
    website: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
    kinds: ['text'],
    defaults: { text: 'https://open.bigmodel.cn/api/paas/v4' },
  },
  {
    value: 't8star',
    label: 't8star',
    kinds: ['text', 'image'],
    defaults: {
      text: 'https://ai.t8star.cn/v1',
      image: 'https://ai.t8star.cn/v1/images/generations',
    },
  },
  {
    value: 'siliconflow',
    label: '硅基流动 SiliconFlow',
    website: 'https://api-docs.siliconflow.cn',
    kinds: ['image'],
    defaults: {},
  },
  {
    value: 'lmstudio',
    label: 'LM Studio',
    website: 'https://lmstudio.ai',
    kinds: ['text'],
    defaults: { text: 'http://127.0.0.1:1234/v1' },
  },
  {
    value: 'autodl_chat',
    label: 'AutoDL',
    website: 'https://www.autodl.art/docs/DeepSeek-V3.2/',
    kinds: ['text'],
    defaults: { text: 'https://www.autodl.art/api/v1' },
  },
  {
    value: 'qwen060',
    label: 'local文本模型',
    website: 'https://www.modelscope.cn/models/Qwen/Qwen3-0.6B',
    kinds: ['text'],
    defaults: { text: 'http://127.0.0.1:11434/v1' },
  },

  // ── 背景分离 / 抠图专用（app 的 DEDICATED_AVATAR_MATTING_MANUFACTURERS）──
  {
    value: 'bria',
    label: 'Bria',
    website: 'https://platform.bria.ai',
    kinds: ['image'],
    matting: true,
    defaults: { image: 'https://engine.prod.bria-api.com/v2/image/edit' },
  },
  {
    value: 'aliyun_imageseg',
    label: '阿里云视觉',
    website: 'https://ram.console.aliyun.com/manage/ak',
    kinds: ['image'],
    matting: true,
    defaults: { image: 'https://imageseg.cn-shanghai.aliyuncs.com' },
  },
  {
    value: 'tencent_ci',
    label: '腾讯云数据万象',
    website: 'https://console.cloud.tencent.com/cam/capi',
    kinds: ['image'],
    matting: true,
    defaults: {}, // baseUrl 必须手填 COS 桶域名，无默认值
  },
  {
    value: 'local_birefnet',
    label: 'BiRefNet 本地',
    website: 'https://github.com/ZhengPeng7/BiRefNet',
    kinds: ['image'],
    matting: true,
    defaults: {},
  },
  {
    value: 'local_modnet',
    label: 'MODNet 本地',
    website: 'https://github.com/ZhengPeng7/BiRefNet',
    kinds: ['image'],
    matting: true,
    defaults: {},
  },
  {
    // map-editor 新增：U²-Net 通用显著对象分割，偏非生物（道具/建筑/纹理/布料）
    value: 'local_u2net',
    label: 'U2Net 本地（非生物）',
    website: 'https://github.com/danielgatis/rembg',
    kinds: ['image'],
    matting: true,
    defaults: {},
  },

  {
    value: 'other',
    label: '其他',
    kinds: ['text', 'image'],
    defaults: {},
  },
]

/** 图像槽位的 modelType 选项（对齐 app 的 MODEL_TYPE_OPTIONS.image） */
export const MODEL_TYPE_OPTIONS = {
  text: [
    { value: 'text', label: '通用文本' },
    { value: 'deepThinkingText', label: '深度思考' },
  ],
  image: [
    { value: 't2i', label: '文生图' },
    { value: 'i2i', label: '图生图' },
  ],
  voice: [
    { value: 'tts', label: '语音合成' },
    { value: 'asr', label: '语音识别' },
  ],
}

/** 背景分离（抠图）专用厂商 key 集合 —— 对齐 app 的 DEDICATED_AVATAR_MATTING_MANUFACTURERS */
export const DEDICATED_MATTING_MANUFACTURERS = new Set([
  'bria',
  'aliyun_imageseg',
  'tencent_ci',
  'local_birefnet',
  'local_modnet',
  'local_u2net',
])

export function modelKindLabel(type) {
  if (type === 'text') return '文本模型'
  if (type === 'image') return '图像模型'
  if (type === 'voice') return '语音模型'
  return '未知模型'
}

export function defaultModelTypeFor(type) {
  return MODEL_TYPE_OPTIONS[type]?.[0]?.value || ''
}

/** 对齐 app 的 defaultManufacturerFor */
export function defaultManufacturerFor(type) {
  return type === 'voice' ? 'lmstudio' : 'volcengine'
}

/**
 * 对齐 app 的 defaultBaseUrlFor。
 * 注意 app 里有几处「defaults 表之外」的硬编码分支（voice_design/voice_clone 的
 * aliyun_direct & minimax、voice 的 asr 变体），map-editor 不做语音，保留其中
 * 唯一与文本/图像相关的一条：aliyun_direct + voice + asr。
 */
export function defaultBaseUrlFor(manufacturer, type, modelType = defaultModelTypeFor(type)) {
  if (type === 'voice' && manufacturer === 'aliyun_direct') {
    return modelType === 'asr'
      ? 'https://dashscope.aliyuncs.com/compatible-mode'
      : 'https://dashscope.aliyuncs.com'
  }
  return MODEL_MANUFACTURERS.find((item) => item.value === manufacturer)?.defaults?.[type] || ''
}

/**
 * 对齐 app 的 defaultModelNameFor（只保留 text / image 两类，语音部分 map-editor 未实现）。
 * 注意原 TS 里 `manufacturer === "aliyun"` 是死分支（注册表里只有 aliyun_direct），此处不复制。
 */
export function defaultModelNameFor(manufacturer, type, modelType = defaultModelTypeFor(type)) {
  if (type === 'text') {
    if (manufacturer === 'volcengine') return 'doubao-seed-2-0-lite-260215'
    if (manufacturer === 'autodl_chat') return 'DeepSeek-R1-0528'
    if (manufacturer === 'deepseek') return 'deepseek-v4-flash'
    if (manufacturer === 'lmstudio') return 'qwen3.5-9b'
    return ''
  }

  if (type === 'image') {
    if (manufacturer === 'bria') return 'RMBG-2.0'
    if (manufacturer === 'aliyun_imageseg') return 'SegmentCommonImage'
    if (manufacturer === 'tencent_ci') return 'AIPortraitMatting'
    if (manufacturer === 'local_birefnet') return 'birefnet-portrait'
    if (manufacturer === 'local_modnet') return 'modnet-photographic-portrait'
    if (manufacturer === 'local_u2net') return 'u2net'
    return ''
  }

  return ''
}

/**
 * 按类型过滤出可用厂商。
 * 抠图专用厂商只在 image 槽位出现（对齐 app 的槽位 × 厂商互斥矩阵）。
 */
export function manufacturersFor(type) {
  return MODEL_MANUFACTURERS.filter((m) => (m.kinds || []).includes(type))
}

/**
 * 凭据填写提示 —— 对齐 app 的 SettingsModelManagerDialog（凭据提示文案）。
 * 云端抠图三家的 apiKey 不是单个 token，格式特殊，必须提示清楚。
 */
export function apiKeyHintFor(manufacturer) {
  switch (manufacturer) {
    case 'aliyun_imageseg':
      return '阿里云视觉这里不是单个 token。请填写 AccessKeyId|AccessKeySecret，或填写 {"accessKeyId":"...","accessKeySecret":"..."}。'
    case 'tencent_ci':
      return '腾讯云请填写 SecretId|SecretKey；Base URL 请填标准 COS 桶域名，例如 https://bucket-appid.cos.ap-shanghai.myqcloud.com'
    case 'bria':
      return 'Bria 这里填写平台生成的 API token。'
    case 'local_birefnet':
    case 'local_modnet':
    case 'local_u2net':
      return '本地模型无需填写 API Key。'
    default:
      return ''
  }
}

/** baseUrl 填写提示 */
export function baseUrlHintFor(manufacturer) {
  switch (manufacturer) {
    case 'tencent_ci':
      return '必须填 COS 桶域名，例如 https://bucket-appid.cos.ap-shanghai.myqcloud.com（不支持填接口路径）'
    case 'aliyun_imageseg':
      return '只需填服务地址 host，region 会从域名自动提取（如 cn-shanghai）'
    case 'bria':
      return '默认已填到 /v2/image/edit，可填到这一层；系统会自动拼接 remove_background'
    case 'local_birefnet':
    case 'local_modnet':
    case 'local_u2net':
      return '本地模型无需填写 Base URL。'
    default:
      return ''
  }
}