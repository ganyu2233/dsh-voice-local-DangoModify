/**
 * dsh-voice-local 语音转写核心（sherpa-onnx-node 封装），支持多模型切换。
 *
 * 设计要点：
 * - 支持多个语音识别模型（sensevoice / whisper / paraformer），各有独立目录与识别器配置。
 * - recognizer 按模型单例复用；所有 decode 调用通过 promise 队列串行化。
 * - 输入统一转成 16kHz 单声道 float32 后送入识别器。
 */
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { access, stat } from 'node:fs/promises';
import { asNativeModuleError, isNativeModuleError, nativeModuleStatus, probeResampler } from './arch.js';

const require = createRequire(import.meta.url);

export const TARGET_SAMPLE_RATE = 16000;

/** 常用繁→简映射（paraformer 输出繁体时转简体）。 */
const TRAD_TO_SIMP = {
  '們': '们', '來': '来', '試': '试', '識': '识', '別': '别', '沒': '没', '議': '议', '異': '异',
  '說': '说', '話': '话', '聽': '听', '覺': '觉', '見': '见', '買': '买', '賣': '卖', '開': '开',
  '關': '关', '問': '问', '點': '点', '鐘': '钟', '錢': '钱', '長': '长', '現': '现', '為': '为',
  '無': '无', '這': '这', '麼': '么', '個': '个', '樣': '样', '後': '后', '時': '时', '裏': '里',
  '裡': '里', '邊': '边', '過': '过', '還': '还', '會': '会', '對': '对', '從': '从', '當': '当',
  '發': '发', '應': '应', '與': '与', '師': '师', '國': '国', '頭': '头', '體': '体', '講': '讲',
  '誰': '谁', '並': '并', '尋': '寻', '優': '优', '總': '总', '動': '动', '將': '将', '僅': '仅',
  '幾': '几', '處': '处', '記': '记', '讓': '让', '爾': '尔', '豐': '丰', '閃': '闪', '東': '东',
  '樂': '乐', '樓': '楼', '檔': '档', '橋': '桥', '廳': '厅', '籤': '签', '綠': '绿', '續': '续',
  '網': '网', '圖': '图', '變': '变', '線': '线', '團': '团', '訂': '订', '務': '务', '單': '单',
};

function toSimplified(text) {
  if (typeof text !== 'string' || text === '') return text;
  let out = '';
  for (const ch of text) {
    out += TRAD_TO_SIMP[ch] ?? ch;
  }
  return out;
}

/** 支持的全部模型 id。 */
export const MODELS = ['sensevoice', 'whisper', 'paraformer'];

/**
 * 语音模型注册表：每个模型定义目录子名、所需文件与 sherpa-onnx 识别器配置。
 * 模型目录 = <voiceRoot>/<dir>。
 */
export const MODEL_REGISTRY = {
  sensevoice: {
    dir: 'sensevoice',
    files(dir) {
      return { model: join(dir, 'model.int8.onnx'), tokens: join(dir, 'tokens.txt') };
    },
    config(files) {
      return {
        senseVoice: { model: files.model, language: 'zh', useInverseTextNormalization: 1 },
        tokens: files.tokens,
      };
    },
  },
  whisper: {
    dir: 'whisper',
    files(dir) {
      return {
        encoder: join(dir, 'encoder.int8.onnx'),
        decoder: join(dir, 'decoder.int8.onnx'),
        tokens: join(dir, 'tokens.txt'),
      };
    },
    config(files) {
      return {
        whisper: { encoder: files.encoder, decoder: files.decoder, language: 'zh', task: 'transcribe' },
        tokens: files.tokens,
      };
    },
  },
  paraformer: {
    dir: 'paraformer',
    files(dir) {
      return { model: join(dir, 'model.int8.onnx'), tokens: join(dir, 'tokens.txt') };
    },
    config(files) {
      return {
        paraformer: { model: files.model },
        tokens: files.tokens,
      };
    },
  },
};

/** 语音根目录：$DSH_HOME/voice 或 ~/.dsh/voice。 */
export function voiceRoot() {
  const home = process.env.DSH_HOME;
  if (typeof home === 'string' && home.trim() !== '') return join(home, 'voice');
  return join(homedir(), '.dsh', 'voice');
}

/** 某一模型的目录（voiceRoot/<dir>）。 */
export function modelDirFor(model) {
  return join(voiceRoot(), MODEL_REGISTRY[model].dir);
}

/** 默认模型目录（兼容：sensevoice）。 */
export function defaultModelDir() {
  return modelDirFor('sensevoice');
}

/** 解析模型目录（兼容旧调用：sensevoice 默认）。优先级：显式 dir / config.modelDir > env > 默认。 */
export function modelDir(dir, configModelDir) {
  if (typeof dir === 'string' && dir !== '') return dir;
  if (typeof configModelDir === 'string' && configModelDir.trim() !== '') {
    return isAbsolute(configModelDir) ? configModelDir : join(process.cwd(), configModelDir);
  }
  if (typeof process.env.DSH_VOICE_MODEL_DIR === 'string' && process.env.DSH_VOICE_MODEL_DIR.trim() !== '') {
    return process.env.DSH_VOICE_MODEL_DIR.trim();
  }
  return defaultModelDir();
}

/** 模型所需文件清单。 */
export function modelFilesFor(model, dir = modelDirFor(model)) {
  return MODEL_REGISTRY[model].files(dir);
}

/** 兼容：sensevoice 文件清单。 */
export function modelFiles(dir = modelDir()) {
  return modelFilesFor('sensevoice', dir);
}

/** 检查某模型文件是否就绪。 */
export async function modelReadyFor(model, dir = modelDirFor(model)) {
  const files = modelFilesFor(model, dir);
  try {
    const stats = await Promise.all(Object.values(files).map((p) => stat(p)));
    return stats.every((s) => s.size > 0);
  } catch {
    return false;
  }
}

/** 兼容：sensevoice 就绪检查。 */
export async function modelReady(dir = modelDir()) {
  return modelReadyFor('sensevoice', dir);
}

let recognizers = new Map();
let queue = Promise.resolve();
let currentModel = 'sensevoice';

/** 当前使用的模型 id。 */
export function getCurrentModel() {
  return currentModel;
}

/**
 * 切换当前模型。校验模型合法；切换后重置对应识别器缓存（下次转写重新加载）。
 * @param {string} model - sensevoice | whisper | paraformer
 * @returns {boolean} 是否切换成功。
 */
export function setCurrentModel(model) {
  if (!Object.prototype.hasOwnProperty.call(MODEL_REGISTRY, model)) return false;
  if (model !== currentModel) {
    currentModel = model;
    recognizers.delete(model);
  }
  return true;
}

function loadRecognizerFor(model, dir) {
  let sherpa;
  try {
    sherpa = require('sherpa-onnx-node/non-streaming-asr.js');
  } catch (cause) {
    if (isNativeModuleError(cause)) throw asNativeModuleError(cause);
    throw cause;
  }
  const { OfflineRecognizer } = sherpa;
  const files = modelFilesFor(model, dir);
  const modelConfig = MODEL_REGISTRY[model].config(files);
  return new OfflineRecognizer({
    modelConfig: {
      ...modelConfig,
      provider: 'cpu',
      numThreads: 4,
    },
    featConfig: { sampleRate: TARGET_SAMPLE_RATE, featureDim: 80 },
  });
}

export async function ensureRecognizerFor(model, dir = modelDirFor(model)) {
  if (recognizers.has(model) && recognizers.get(model).dir === dir) {
    return recognizers.get(model).rec;
  }
  if (!(await modelReadyFor(model, dir))) {
    throw new Error(`模型 "${model}" 未就绪：请先下载/放置模型文件到 ${dir}`);
  }
  const rec = loadRecognizerFor(model, dir);
  recognizers.set(model, { rec, dir });
  return rec;
}

/** 释放单例（测试/热重载用）。 */
export function disposeRecognizer() {
  recognizers.clear();
}

/**
 * 对已归一化的 float32 音频做转写。
 * @param {Float32Array} samples
 * @param {number} sampleRate
 * @param {string} [model] 可选，默认当前模型。
 * @param {string} [dir] 可选，模型目录。
 */
export async function transcribeWave(samples, sampleRate, model = currentModel, dir = modelDirFor(model)) {
  if (!(samples instanceof Float32Array)) {
    throw new TypeError('samples must be a Float32Array');
  }
  const rec = await ensureRecognizerFor(model, dir);
  const run = () => {
    const stream = rec.createStream();
    stream.acceptWaveform({ samples, sampleRate });
    return rec.decodeAsync(stream);
  };
  const result = await (queue = queue.then(run, run));
  const text = typeof result?.text === 'string' ? result.text : '';
  return model === 'paraformer' ? toSimplified(text) : text;
}

/** 读取 WAV（含任意 chunk 布局），必要时重采样到 16kHz，再转写（用当前模型）。 */
export async function transcribeWaveFile(filePath, model = currentModel) {
  const { readFile } = await import('node:fs/promises');
  return transcribeWavBuffer(await readFile(filePath), model);
}

/** 读取 WAV 二进制（Uint8Array/Buffer），必要时重采样到 16kHz，再转写（用当前模型）。 */
export async function transcribeWavBuffer(wavBuffer, model = currentModel) {
  let addon;
  try {
    addon = require('sherpa-onnx-node/addon.js');
  } catch (cause) {
    if (isNativeModuleError(cause)) throw asNativeModuleError(cause);
    throw cause;
  }
  if (typeof addon.readWaveFromBinary !== 'function') {
    throw new Error('sherpa-onnx native addon does not expose readWaveFromBinary');
  }
  const wave = addon.readWaveFromBinary(wavBuffer);
  if (wave.samples.length === 0) {
    return '';
  }
  let { samples, sampleRate } = wave;
  if (sampleRate !== TARGET_SAMPLE_RATE) {
    let resampler;
    try {
      const { LinearResampler } = require('sherpa-onnx-node/resampler.js');
      resampler = new LinearResampler(sampleRate, TARGET_SAMPLE_RATE);
    } catch (cause) {
      if (isNativeModuleError(cause)) throw asNativeModuleError(cause);
      cause.debug = probeResampler();
      throw cause;
    }
    samples = resampler.flush(samples);
    sampleRate = TARGET_SAMPLE_RATE;
  }
  return transcribeWave(samples, sampleRate, model);
}

/** 汇总诊断信息（/health 用）：原生模块状态 + 当前模型状态。 */
export async function diagnose() {
  const model = currentModel;
  return {
    native: nativeModuleStatus(),
    model: { ready: await modelReadyFor(model), dir: modelDirFor(model) },
    currentModel: model,
  };
}
