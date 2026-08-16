# 激光棋项目交接文档

> 本文档供后续接手的 AI Agent 或开发者使用，涵盖项目架构、已解决问题、当前状态和待改进方向。

## 一、项目概述

这是一个微信小游戏项目（`d:\aidemo`），包含多个子游戏。核心项目是 **激光棋（Laser Chess）**——一款基于 WebGL 3D 渲染的策略棋类游戏，具备：

- 单人 vs AI（传统启发式 AI + 神经网络 AI，各三个难度）
- 在线双人对战（微信 GameServerManager 帧同步）
- 3D 棋盘渲染（GLB 模型 + WebGL）
- 阵型选择系统

## 二、项目结构

### 游戏主目录 (`d:\aidemo`)

```
d:\aidemo/
├── game.js                          # 微信小游戏入口（171KB，核心逻辑）
├── game.json                        # 游戏配置
├── project.config.json              # 项目配置（含包大小排除规则）
├── project.private.config.json
├── games/
│   ├── menu.js                      # 游戏菜单
│   ├── jump/                        # 跳跃游戏（独立子游戏）
│   ├── pig-merge/                   # 合成大西瓜（独立子游戏）
│   └── laser/                       # 激光棋（主项目）
│       ├── laser-game.js            # 模块入口
│       ├── config/
│       │   ├── constants.js         # 游戏常量、AI难度参数、难度选项
│       │   └── formations.js        # 阵型布局定义
│       ├── core/
│       │   ├── rules.js             # 游戏规则（棋子移动、激光模拟、消除判定）
│       │   ├── ai.js                # 传统启发式 AI（easy/normal/hard）
│       │   └── ai_neural.js         # 神经网络 AI（neural_easy/normal/hard）
│       ├── game/
│       │   └── create-game.js       # 游戏主逻辑（171KB，渲染+交互+AI调度+在线对战）
│       ├── online.js                # 在线对战网络模块
│       ├── glb-loader.js            # GLB 3D 模型加载器
│       ├── webgl-renderer.js        # WebGL 渲染引擎
│       ├── images/                  # UI 图片
│       └── models/                  # 3D 模型 + AI 模型权重
│           ├── laser_ai_easy.bin    # 神经网络权重（float16, 1.3MB）
│           ├── laser_ai_normal.bin  # 神经网络权重（float16, 1.3MB）
│           ├── laser_ai_hard.bin    # 神经网络权重（float16, 1.3MB）
│           └── *.glb                # 棋子 3D 模型
```

### 训练目录 (`D:\aidemo-extra\ai_training`)

非游戏文件已从主项目中分离，放在 `D:\aidemo-extra`：

```
D:\aidemo-extra\ai_training/
├── model.py              # PyTorch 模型定义（SimplePolicyNet）
├── train.py              # 训练脚本
├── generate_data.js      # 自我对弈数据生成（Node.js）
├── export_weights.py     # 权重导出（支持 float16 量化）
├── export_onnx.py        # ONNX 导出（已弃用，改用纯 JS 前向传播）
├── board_codec.py        # 棋盘编码/动作编解码（Python 端，需与 JS 端一致）
├── data/                 # easy 难度训练数据
├── data_normal/          # normal 难度训练数据
├── data_hard/            # hard 难度训练数据
├── checkpoints/          # easy 模型检查点
├── checkpoints_normal/   # normal 模型检查点
└── checkpoints_hard/     # hard 模型检查点
```

## 三、游戏规则简述

- **棋盘**：10列×8行，红蓝双方各 13 个棋子
- **棋子类型**：激光炮(laser)、国王(king)、护盾(shield)、单面镜(mirror)、分光镜(switch)
- **每回合操作**：移动1步 / 旋转90° / 激光炮旋转 / 与相邻棋子交换位置 / 跳过
- **激光机制**：每回合结束发射激光，遇国王则消灭，遇护盾正面则阻挡，遇镜子则反射/分光
- **胜负**：消灭对方国王获胜
- **阵型**：5种预设阵型，对战开始前选择
- **区域限制**：红蓝双方有各自的禁区，对方不可进入

## 四、AI 系统设计

### 4.1 传统启发式 AI (`ai.js`)

基于手写评估函数的 AI，三个难度通过参数差异化：

| 参数 | easy | normal | hard |
|------|------|--------|------|
| attack | 2.5 | 3.5 | 4.5 |
| defense | 0.7 | 1.3 | 1.6 |
| initiative | 1.2 | 1.8 | 2.5 |
| foresight | 0.4 | 0.65 | 0.9 |
| candidates | 12 | 40 | 50 |
| depth | 1 | 2 | 3 |
| blunder | 0.15 | 0 | 0 |

评估函数包括：激光压力(laserPressure)、进攻存在感(attackingPresence)、潜在激光威胁(potentialLaserThreat)、材料计算等。

### 4.2 神经网络 AI (`ai_neural.js`)

纯 JavaScript 实现的前向传播，不依赖 onnxruntime-web。

**模型架构** (SimplePolicyNet):
```
Conv2d(16,32,3,pad=1) + BN + ReLU
Conv2d(32,32,3,pad=1) + BN + ReLU
Conv2d(32,16,3,pad=1) + BN + ReLU
FC(1280,495) → policy logits
FC(1280,32) + ReLU + FC(32,1) + Tanh → value
```

**输入编码**：16通道×8行×10列的棋盘张量
- 通道 0-4：己方棋子类型（laser/king/shield/mirror/switch）
- 通道 5-9：对方棋子类型
- 通道 10-13：棋子朝向（4个方向）
- 通道 14：当前玩家标识
- 通道 15：棋子存在标识

**动作编码**：26棋子 × 19动作 + 1跳过 = 495个动作
- 0-7：移动到8个相邻格
- 8-9：左旋/右旋
- 10：激光炮旋转
- 11-18：与8个相邻棋子交换

**推理配置** (NEURAL_CONFIG):

| 参数 | easy | normal | hard |
|------|-------|--------|------|
| policyWeight | 0.40 | 0.70 | 1.00 |
| initScale | 1.5 | 2.0 | 2.5 |
| blunder | 0.15 | 0.00 | 0.00 |
| candidates | 10 | 15 | 20 |

**AI 调度逻辑**：玩家选择简单/普通/困难难度后，游戏优先使用对应难度的神经网络模型（如已加载），若模型不可用则回退到传统启发式 AI。三个难度的模型文件分别为 `laser_ai_easy.bin`、`laser_ai_normal.bin`、`laser_ai_hard.bin`。

**决策流程**：
1. 前向传播得到 policy logits + value
2. 对每个合法动作计算综合分数：`policyLogit × policyWeight + 战术评估分数`
3. 战术评估包括：材料损益、激光威胁变化、对手反击威胁、重复走法惩罚
4. 取分数最高的 K 个候选，对每个候选做二阶段评估（潜在威胁 + 对手 value 预测）
5. 如配置了 blunder，有概率随机选择候选动作

### 4.3 AI 训练流程

```bash
# 1. 生成训练数据（自我对弈1000局）
cd D:\aidemo-extra\ai_training
node generate_data.js 1000 data easy       # easy 数据
node generate_data.js 1000 data_normal normal  # normal 数据
node generate_data.js 1000 data_hard hard   # hard 数据

# 2. 训练模型（50个epoch）
python train.py --data data --epochs 50 --batch_size 256 --model simple
python train.py --data data_normal --epochs 50 --batch_size 256 --model simple --save_dir checkpoints_normal
python train.py --data data_hard --epochs 50 --batch_size 256 --model simple --save_dir checkpoints_hard

# 3. 导出 float16 权重
python export_weights.py --checkpoint checkpoints\best_simple.pt --output d:\aidemo\games\laser\models\laser_ai_easy.bin --float16
python export_weights.py --checkpoint checkpoints_normal\best_simple.pt --output d:\aidemo\games\laser\models\laser_ai_normal.bin --float16
python export_weights.py --checkpoint checkpoints_hard\best_simple.pt --output d:\aidemo\games\laser\models\laser_ai_hard.bin --float16
```

## 五、在线对战系统

基于微信小游戏 `GameServerManager` 的帧同步方案：

- **触发方式**：长按首页"规则"按钮3秒（无视觉提示）
- **邀请流程**：房主创建房间 → 分享邀请链接 → 被邀请人点击链接加入
- **猜拳选边**：石头剪刀布，胜者执红（先手），败者执蓝
- **阵型选择**：双方同时选择阵型，确认后开始
- **帧同步**：使用 `uploadFrame` / `onSyncFrame` 同步走子、旋转、激光旋转、交换操作
- **棋盘视角**：红方默认视角，蓝方 180° 旋转视角

### 在线状态机

```
online_wait → online_join → rps → formation_select → formation_wait → 游戏中
```

## 六、已解决的问题与经验教训

### 6.1 AI 进攻能力不足

**问题**：神经网络 AI 只防守不进攻，面对对手重复无意义回合时不会主动攻击国王。

**根因**：训练数据来自 `attack=0.7` 的低进攻参数 easy AI，生成的自我对弈数据缺乏进攻走法。

**解决方案**：
- 将 easy AI 的 `attack` 从 0.7 提升到 2.5，`initiative` 从 0.4 提升到 1.2，`foresight` 从 0.15 提升到 0.4
- 重新生成训练数据（1000局，20120条记录）
- 在 SimplePolicyNet 中添加 Dropout(0.3) 防止过拟合
- 重新训练50个epoch，准确率76%

### 6.2 神经网络策略权重过低

**问题**：神经网络 AI 的 `policyWeight` 过低（easy:0.05, normal:0.15, hard:0.30），网络学到的策略完全被手写战术启发式淹没。

**根因**：policy logits 通常在 ±2-3 范围，乘以 0.30 后仅贡献 ±0.9 分，而战术评估（材料损益 ×10、威胁评估等）贡献 ±10-100 分。

**解决方案**：将权重提升为 easy:0.40, normal:0.70, hard:1.00，确保网络策略有意义地参与决策，同时保留战术启发式作为安全网。

### 6.3 包大小超限

**问题**：添加神经网络难度后小程序无法运行，`ai_training` 目录（106MB）被包含在包中，超过 8MB 限制。

**解决方案**：
- 在 `project.config.json` 中添加排除规则：`ai_training/`、`docs/`、`tests/`、`scripts/`、`laser-game-filing/`、`.idea/`、`.trae-html-share-packages/`、根目录 `.html`/`.md`/`.gitignore` 文件
- 非游戏文件统一移至 `D:\aidemo-extra`
- 模型权重使用 float16 量化（2.7MB → 1.3MB/个）
- 删除旧的 float32 模型 `laser_ai.bin`
- 最终包大小：6.57MB（含3个1.3MB模型）

### 6.4 在线对战指令发送失败

**问题**：双人对战中出现指令发送失败和双方同时等待对手行动的问题。

**根因**：`onSyncFrame` 中的守卫条件使用了 `!==` 而非 `===`，导致接收方永远不处理对方的出招帧。

**解决方案**：
- 修正守卫条件为 `===` 比较
- 实现重试看门狗（Watchdog）机制：发送关键帧后启动5秒定时器，未收到对方帧则自动重发，最多重试3次
- 覆盖场景：出招/旋转/激光同步、猜拳选择、阵型选择、再来一局
- 针对不同操作添加防重复处理逻辑

### 6.5 在线对战加入失败

**问题**：点击邀请链接经常无法加入游戏。

**根因**：`createRoom` 设置 `startPercent: 100`，服务器在两人加入后立即自动开始游戏并触发 `onGameStart`，但事件监听器注册太晚导致错过事件。

**解决方案**：
- 新增 `prepareGameStart` 方法，提前注册 `onGameStart` 监听器（房主在 createRoom 后、分享邀请前；被邀请人在 login 后、joinRoom 前）
- `startGame()` 检查 `_connected` 标志，已连接则直接返回成功
- `startGame()` 失败后等待5秒看 `onGameStart` 是否触发（服务器可能已自动开始）
- 使用 flag 防止 `startRps()` 被多次调用

### 6.6 安全区域适配

**问题**：顶部按钮和 UI 元素被微信胶囊按钮遮挡。

**根因**：`game.js` 的返回按钮固定在 `y:10`，`create-game.js` 使用已废弃的 `wx.getSystemInfoSync()` 且回退值不合理。

**解决方案**：
- SAFE_TOP 计算优先级：`wx.getMenuButtonBoundingClientRect().bottom + 4px` > `safeArea.top` > `statusBarHeight`，最小 20px
- SAFE_BOTTOM：`screenHeight - safeArea.bottom`，最小 12px
- 所有顶部 UI 元素使用 SAFE_TOP 定位

### 6.7 数据生成效率

**问题**：困难难度 AI 搜索深度（depth=3）导致生成1000局数据需要数小时。

**解决方案**：生成困难数据时将搜索深度临时降为1（`C.AI_LEVELS[difficulty].depth = 1`），评估参数不变，大幅加速生成。深度降低主要影响搜索广度而非评估质量，对训练数据影响有限。

### 6.8 微信分享 API 限制

**问题**：`wx.shareAppMessage` 在异步回调中调用失败。

**解决方案**：必须在用户点击事件中直接调用 `wx.shareAppMessage`，不能在异步回调中使用。

### 6.9 长按触发后按钮失效

**问题**：长按规则按钮触发在线对战后，后续按钮点击失效。

**解决方案**：长按触发后立即将 `triggered` 状态重置为 `false`。

## 七、关键技术决策

1. **纯 JS 前向传播 vs ONNX Runtime**：选择纯 JS 实现，避免 onnxruntime-web 在微信小游戏中兼容性问题，模型文件更小
2. **float16 量化**：将权重从 float32 转为 float16，文件体积减半（2.7MB → 1.3MB），推理精度损失可忽略
3. **分享邀请 vs 官方好友邀请**：选择分享链接方式，开发复杂度更低
4. **多模型加载**：同时加载三个难度的模型到内存，通过 `setDifficulty` 动态切换，无需重新加载
5. **战术评估融合**：神经网络策略分数 + 手写战术评估分数的组合方式，网络提供战略方向，战术评估提供安全网

## 八、当前状态

### 已完成
- [x] 传统 AI 三个难度（easy/normal/hard）
- [x] 神经网络 AI 三个难度（neural_easy/normal/hard），各训练50个epoch
- [x] float16 量化模型导出（各1.3MB）
- [x] 多模型加载和动态难度切换
- [x] 在线对战全流程（创建/加入/猜拳/阵型/对战/再来一局）
- [x] 帧同步重试机制
- [x] 安全区域适配
- [x] 包大小控制（6.57MB < 8MB）

### 已知限制
- 神经网络模型基于 easy/normal/hard AI 自我博弈数据训练，强度上限受限于训练数据质量
- 神经网络模型未经过强化学习（RL）训练，仅监督学习
- 在线对战仅支持 1v1

## 九、待改进方向

### 9.1 AI 强度提升
- **强化学习训练**：当前仅监督学习（模仿传统AI），可通过自我对弈 RL（如 AlphaZero 方法）突破传统AI强度上限
- **更大数据集**：增加训练局数（5000-10000局），丰富开局和中局策略多样性
- **模型架构升级**：增加残差连接（ResNet）、注意力机制，提升模型容量
- **MCTS 结合**：将神经网络 policy/value 与蒙特卡洛树搜索结合，提升搜索深度
- **开局库**：预设常见开局走法，避免开局重复

### 9.2 在线对战优化
- **断线重连**：当前断线后无法恢复，需要实现重连机制
- **匹配系统**：支持随机匹配而非仅好友邀请
- **观战模式**：允许第三方观战
- **回放系统**：保存对战记录支持回放

### 9.3 游戏体验
- **棋盘视角**：当前蓝方为180°旋转视角，可考虑更平滑的视角过渡动画
- **教程系统**：新手引导教程
- **音效系统**：落子、激光发射、消除等音效
- **排行榜**：在线对战积分排行

### 9.4 工程优化
- **create-game.js 拆分**：该文件已达171KB，应按功能模块拆分（渲染、交互、AI调度、在线对战等）
- **模型懒加载**：当前启动时同时加载三个模型，可改为按需加载
- **棋盘编码一致性验证**：JS 端（`ai_neural.js` 的 `encodeBoard`）和 Python 端（`board_codec.py`）的编码逻辑必须完全一致，修改任一端时需同步

## 十、开发环境

- **运行环境**：微信开发者工具
- **Node.js**：用于训练数据生成（`generate_data.js`）
- **Python 3.12**：`C:\Program Files\Python312\python.exe`，用于模型训练和权重导出
- **PyTorch**：模型训练框架
- **包大小限制**：8MB（微信小游戏主包限制）
- **项目配置**：`project.config.json` 中的 `packOptions.ignore` 字段控制打包排除规则

## 十一、注意事项

1. **修改 AI 参数后需重新训练**：修改 `constants.js` 中的 `AI_LEVELS` 参数后，需重新生成训练数据并训练神经网络模型
2. **编码一致性**：JS 端和 Python 端的棋盘编码、动作编码必须完全一致
3. **微信 API 限制**：`wx.shareAppMessage` 必须在用户点击事件中直接调用
4. **包大小监控**：新增文件时注意检查包大小是否超限
5. **模型文件路径**：游戏代码中引用 `games/laser/models/laser_ai_{easy,normal,hard}.bin`，训练脚本中引用 `../../aidemo/games/laser/`（相对 `D:\aidemo-extra\ai_training`）
6. **Python 路径**：当前环境 Python 不在 PATH 中，需使用完整路径 `C:\Program Files\Python312\python.exe`
