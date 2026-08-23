# dsh-voice-local（改装增强版）

DeepSeek Harness（dsh）Web UI 本地语音输入插件——**本包是基于原插件 [`Real-WangLe/dsh-voice-local`](https://github.com/Real-WangLe/dsh-voice-local) 改装而来的增强版本**。

- **全程本地离线**：录音与转写都在本机完成，音频不出本机、不依赖云端 API/API Key。
- **多语音模型**：支持 **SenseVoice / Whisper / Paraformer** 三套本地模型一键切换（新增）。
- **智能长按空格**：短按打空格、长按开始识别、松开取消识别（新增）。
- **无语音不乱字**：静音检测优化，长时间不说话不回填乱字（新增）。
- **句子级实时**：浏览器端静音检测断句，说一句自动回填一句，可继续说话；识别文本按光标位置插入。
- **安全**：宿主路由只允许 loopback / trustedHosts 访问，非本机请求返回 403。

---

## 与上游的差异（本包新增/修改点）

本包在原插件基础上做了以下**核心改装**：

1. **多模型支持（新增）**：原插件仅支持 SenseVoice，本包新增 **Whisper**（`~/.dsh/voice/whisper`）和 **Paraformer**（`~/.dsh/voice/paraformer`）两套模型，可在麦克风旁的**模型下拉**一键切换，切换后转写即用所选模型。
   - 修改文件：`dist/transcriber.js`（模型注册表 + 按模型加载识别器）。
2. **模型切换路由（新增）**：新增 `GET /dsh-voice-local/v1/model/list` 和 `POST /dsh-voice-local/v1/model/switch`，并通过 DSH settings 注册 `voice` 命名空间（模型选择持久化）。
   - 修改文件：`dist/index.js`。
3. **Paraformer 简繁转换（新增）**：Paraformer 默认输出繁体，本包在后端对识别结果做**繁→简**转换（常用字映射）。
   - 修改文件：`dist/transcriber.js`。
4. **智能长按空格（新增）**：短按空格（<1 秒）正常打出空格；按住空格（≥1 秒）**开始语音识别**且不输入空格；松开空格**取消识别**（丢弃录音、不转写回填）。
   - 修改文件：`dist/client.js`。
5. **无语音不回填（优化）**：提高静音检测阈值，并**丢弃低音量（静音/噪音）段**，长时间不说话不再回填乱字。
   - 修改文件：`dist/client.js`。
6. **前端模型下拉（新增）**：麦克风按钮旁显示模型切换下拉（SenseVoice / Whisper / Paraformer），需授权麦克风后使用；录音时下拉禁用。
   - 修改文件：`dist/client.js`。

> 注：以上改动均作用于 **`dist/`**（插件实际运行代码）。本仓库的 `lib/` 仍是上游源码；若执行 `npm run build`（复制 lib→dist）会**覆盖 dist 改动**。**请直接使用本仓库已改好的 `dist/`**，或先同步 `lib/` 为相同逻辑后再 build。

---

## 安装

本包是改装增强版，**请从本仓库安装**（若用 `npm add dsh-voice-local` 会装上游原版，没有本包的增强功能）：

### 方式一：从 Git 仓库安装
```bash
dsh plugin --profile web add git+https://github.com/ganyu2233/dsh-voice-local-DangoModify.git
# 仓库地址:git clone https://github.com/ganyu2233/dsh-voice-local-DangoModify.git
# 重启 dsh web 后生效
```

### 方式二：AI自动化安装（推荐）
```bash
# 直接粘贴，用于自动化 Agent
自动访问下方 GitHub 链接，读取仓库根目录 README.md，完全按照文档规则输出该插件完整可执行安装部署流程，以 README 内容为唯一标准，禁止脑补补充命令。链接：【git clone https://github.com/ganyu2233/dsh-voice-local-DangoModify.git】
# 重启 dsh web 后生效
```

### 方式三：本地链接安装（推荐，用于开发/测试）
```bash
# 克隆/解压本仓库后，用仓库绝对路径 add
dsh plugin --profile web add link:<仓库绝对路径>
# 重启 dsh web 后生效
```

首次点击麦克风时，插件会检查当前所选模型的就绪状态；模型未就绪时提示下载。

---

## 手动下载 / 离线导入模型

本包支持三套模型，分别放在 `~/.dsh/voice/<模型>` 目录，插件检测到模型文件后不再触发下载：

| 模型 | 目录 | 需放入的文件 |
|:--|:--|:--|
| SenseVoice | `~/.dsh/voice/sensevoice` | `model.int8.onnx`、`tokens.txt` |
| Whisper | `~/.dsh/voice/whisper` | `encoder.int8.onnx`、`decoder.int8.onnx`、`tokens.txt` |
| Paraformer | `~/.dsh/voice/paraformer` | `model.int8.onnx`、`tokens.txt` |

### SenseVoice（原上游默认）
```bash
mkdir -p ~/.dsh/voice/sensevoice
cd ~/.dsh/voice/sensevoice
# 下载并解压：
#   https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2
# 确认目录中有： model.int8.onnx  tokens.txt
```

### Whisper (small)
```bash
mkdir -p ~/.dsh/voice/whisper
cd ~/.dsh/voice/whisper
# 下载并解压：
#   https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-small.tar.bz2
# 解压后把 encoder/decoder/tokens 重命名/复制为：
#   encoder.int8.onnx  decoder.int8.onnx  tokens.txt
```

### Paraformer
```bash
mkdir -p ~/.dsh/voice/paraformer
cd ~/.dsh/voice/paraformer
# 下载并解压：
#   https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-paraformer-zh-2023-09-14.tar.bz2
# 确认目录中有： model.int8.onnx  tokens.txt
```

也可以使用 `DSH_VOICE_MIRROR_URL` 或 `DSH_VOICE_MIRRORS` 指定更快镜像后运行：

```bash
DSH_VOICE_MIRROR_URL="https://your-mirror/...tar.bz2" node tools/download-model.mjs
```

---

## 使用

1. 打开任意会话，点击输入框工具行麦克风按钮开始录音。
2. **说话**；检测到停顿时自动转写并插入输入框光标位置（光标在末尾时等价追加）。
3. **再次点击麦克风按钮**停止录音，未定稿的剩余语音完成最后一次转写。
4. 识别文本不会自动发送，发送前可编辑。

### 智能长按空格（本包新增）

- **短按空格**（< 1 秒）：正常打出空格。
- **按住空格**（≥ 1 秒）：开始语音识别，且**不输入空格字符**。
- **松开空格**（长按后）：**取消识别**（丢弃录音，不转写回填）。

### 模型切换（本包新增）

- 麦克风按钮旁显示**模型下拉**（SenseVoice / Whisper / Paraformer）。
- 切换模型后，语音转写即使用所选模型（选择持久化，下次打开仍沿用）。
- 录音 / 转写 / 下载中下拉暂时禁用，避免切换冲突。

> 说明：模型识别语言——SenseVoice、Whisper 输出简体；Paraformer 本包已做繁→简转换。

---

## 配置

可选环境变量（同上游）：

| 变量 | 说明 | 默认 |
|:--|:--|:--|
| `DSH_HOME` | dsh 数据目录，模型存到 `$DSH_HOME/voice/<模型>` | `~/.dsh` |
| `DSH_VOICE_MODEL_DIR` | 模型目录覆盖 | 默认目录 |
| `DSH_VOICE_MODEL_URL` | 模型下载主 URL | 官方 GitHub release |
| `DSH_VOICE_MIRROR_URL` | 单个镜像 URL（最先尝试） | 无 |
| `DSH_VOICE_MIRRORS` | 逗号分隔的镜像 URL 列表（按顺序尝试） | 内置 ghfast.top/gh-proxy.com + hf-mirror 直连文件 |
| `DSH_VOICE_MODEL_SHA256` | 模型归档 SHA256（可选强校验） | 内置值（若已发布） |
| `DSH_VOICE_MODEL_FILE_SHA256` | 直连文件模式下 model.int8.onnx 的 SHA256（可选） | 无 |
| `DSH_VOICE_TOKENS_SHA256` | 直连文件模式下 tokens.txt 的 SHA256（可选） | 无 |

也可以在 profile 的 `cordis.patch.yml` 中覆盖：

```yaml
- insert:
    - id: dsh-voice-local
      name: dsh-voice-local
      config:
        modelUrl: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/...'
        mirrorUrl: 'https://your-mirror/...'          # 单个首选镜像
        mirrors: ['https://mirror-a/...', 'https://mirror-b/...']  # 按顺序尝试
        modelDir: '/absolute/path/to/model'
        sha256: '<sha256>'
```

---

## 宿主路由

| 方法 | 路径 | 说明 |
|:--|:--|:--|
| GET | `/dsh-voice-local/v1/health` | 插件/原生模块/模型状态 |
| GET | `/dsh-voice-local/v1/model/status` | 模型文件与下载进度 |
| POST | `/dsh-voice-local/v1/model/download` | 启动后台模型下载 |
| **GET** | **`/dsh-voice-local/v1/model/list`** | **列出可用模型与当前模型（本包新增）** |
| **POST** | **`/dsh-voice-local/v1/model/switch`** | **切换语音识别模型（本包新增）** |
| POST | `/dsh-voice-local/v1/transcribe` | 上传 WAV，返回识别文本 |
| GET | `/dsh-voice-local/v1/diagnose` | 原生模块/重采样器诊断 |

所有路由仅允许本机回环或 DSH `trustedHosts` 来源访问。

---

## 诊断

```bash
node scripts/doctor.mjs            # 完整诊断
node scripts/doctor.mjs --json     # 机器可读
node tools/download-model.mjs      # 手动下载模型
```

---

## 开发

```bash
npm install
npm run build        # 复制 lib/ -> dist/
npm test             # 单元 + 路由集成测试
node scripts/smoke.mjs <wav> [expected.txt]   # 真实模型慢速冒烟
```

---

## License

本项目采用 MIT License。

### 致谢

本包基于 [`Real-WangLe/dsh-voice-local`](https://github.com/Real-WangLe/dsh-voice-local) 改装而来，保留了其原始 MIT 许可声明。原实现参考了社区插件 `dsh-voice-input`（来源标注 `fuzhailv`）。本包在原 SenseVoice 转写封装、原生模块诊断、模型管理、宿主路由以及浏览器端录音与断句逻辑基础上，**新增了多模型支持、模型切换、Paraformer 简繁转换、智能长按空格与无语音防乱字回填**等功能。
