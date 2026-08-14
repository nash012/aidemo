# 来桌游 / 镭射棋项目交接说明

更新时间：2026-08-14（Asia/Shanghai）

## 1. 当前任务

当前目标是完成微信小游戏《来桌游》中的镭射棋对战，并准备真机验收和提审。

最新一项需求已经实现：

- 电脑移动或旋转完成后，先计算当前激光路径。
- 只有能够击杀对方棋子时，电脑才发射激光。
- 没有击杀目标，或者只会击中电脑自己的棋子时，不发射，直接结束电脑回合并交还玩家。
- 电脑选择 `skip` 时显示“电脑结束回合”。
- 玩家一方的“发射激光 / 回合结束”操作保持不变。

主要实现位于：

```text
games/laser/game/create-game.js
  aiCanEliminateOpponent()
  finishAiActionTurn()
  finishAiAnimation()
  applyAiAction()
```

## 2. Git 和工作区状态

```text
branch: main
HEAD: c64cd67 1.0 上传
```

当前工作区有未提交内容，禁止直接 `git reset --hard`、`git checkout -- .` 或覆盖整个目录。

当前修改包括：

```text
M  games/laser/game/create-game.js
M  games/laser/glb-loader.js
M  games/laser/webgl-renderer.js
M  tests/laser-ai.test.js
M  tests/laser-webgl.test.js
M  games/laser/models/*.glb（红蓝双方共 10 个模型）
?? scripts/generate-laser-models.js
```

这些改动属于同一阶段的视觉、模型、相机和电脑回合优化，不能只保留 JS 而丢弃 GLB，也不能只提交 GLB 而漏掉生成脚本和加载器。

## 3. 已完成内容

### 3.1 项目和界面

- 游戏名称已改为“来桌游”。
- 首界面已包含阵型选择、难度选择、规则入口和开始游戏。
- 五套阵型均使用真实 3D 棋盘预览。
- 开始对战后阵型和难度被锁定，游戏中不能修改难度。
- 对局返回会弹出二次确认，并提示进度丢失。
- 对战底部 UI 已调整，“跳过”改为“回合结束”。
- 重开和返回设置按钮已按需求移除；系统返回仍通过二次确认处理。
- 对战界面具有旋转控制舵盘、较大的棋子点击范围、双指缩放和视角归位。
- 胜负和平局具备结算动画；棋子被击杀具备缩小、抬升、闪光和粒子动画。

### 3.2 规则

- 棋盘为 10×8。
- 红方棋子不能进入蓝/白色保留区；蓝方棋子不能进入红色保留区。
- 双面镜可以与相邻的盾牌或单面镜互换，包括对方棋子。
- 互换时会同时检查双方交换后的禁区合法性。
- 单面镜只有镜面一侧反射，背面会被激光击杀。
- 双面镜两面均可反射。
- 单面镜反射映射集中在 `games/laser/config/constants.js` 的 `MIRROR_MAP`。
- 规则计算集中在 `games/laser/core/rules.js`，不要在渲染器中再实现一套规则。

### 3.3 AI

- 难度分为简单、普通、困难。
- 简单和普通已增强主动进攻；困难使用更深搜索。
- AI 会检测玩家连续消极走棋并提高主动进攻权重。
- AI 采用局面评估、激光压力、进攻棋子位置和 Alpha-Beta 搜索。
- AI 动作具有移动、旋转、互换的可视化动画。
- 最新行为：没有对方击杀目标时，AI 不再播放无意义激光，直接结束回合。

相关文件：

```text
games/laser/config/constants.js   难度参数
games/laser/core/ai.js            AI 评估和搜索
games/laser/core/rules.js         动作和激光结算
games/laser/game/create-game.js   AI 动画与真实回合流程
```

### 3.4 WebGL、模型和激光

- 棋盘和棋子已经升级为 WebGL/GLB 渲染，失败时保留 Canvas 备用渲染。
- 红蓝双方五类棋子共十个 GLB 模型。
- 单面镜使用直角三棱柱，并通过名为 `Mirror_Face` 的独立几何面标识反射面。
- 加载时会验证单面镜/双面镜的镜面数量、薄面几何、法线和方向映射。
- WebGL 材质现支持 `metallicFactor`、`roughnessFactor` 和 `emissiveFactor`。
- 棋子尺寸、金属高光、边缘光和镜面表现已优化。
- 激光改为面向摄像机的带状几何，具有蓝色外晕、红橙能量层、黄色亮芯和白色核心。
- 激光外层绘制时关闭深度写入，避免光晕挡住亮芯。
- 激光头的圆点与光线路径使用同一个世界坐标投影。
- `scripts/generate-laser-models.js` 可以确定性重新生成全部十个 GLB；运行它会覆盖现有模型。

### 3.5 真机棋盘视角

- 棋盘相机距离会根据屏幕纵横比动态调整，避免窄长手机切掉边缘。
- 双指捏合直接修改 `cam.zoom`。
- 缩小棋盘时会提高最小俯仰角，避免棋盘压成一条横线。
- yaw、pitch、zoom 统一通过 `constrainMatchCamera()` 限制。
- 当前范围：zoom `0.72–1.48`，pitch `0.50–1.50`；缩小时实际最小 pitch 会动态增加。

## 4. 已完成的目录重构

旧的 `games/laser/laser-game.js` 已改为稳定兼容入口，内部代码拆分如下：

```text
games/laser/
├── laser-game.js             稳定公开入口，只转发 create()
├── game/create-game.js       生命周期、UI、输入、动画、模块编排
├── config/constants.js       棋盘、棋子、方向、禁区、难度参数
├── config/formations.js      五套阵型和初始朝向
├── core/rules.js             移动、交换、反射、击杀、回合结算
├── core/ai.js                AI 评估和 Alpha-Beta
├── glb-loader.js             GLB 解析和镜面数据验证
├── webgl-renderer.js         WebGL 棋盘、模型、激光和特效
├── models/                   十个 GLB 模型
└── README.md                 模块职责与依赖说明
```

依赖原则：

- 外部统一引用 `games/laser/laser-game.js`。
- `core/` 不得依赖 Canvas、微信 API、计时器或渲染器。
- `config/` 不得依赖游戏状态。
- 渲染器消费状态快照，不修改规则状态。
- `game/create-game.js` 负责生命周期与模块编排。

详细说明见 `games/laser/README.md`。

## 5. 当前卡住或尚未确认的问题

目前没有自动化测试阻塞，代码测试全部通过。仍需人工确认的项目如下：

1. **微信真机视觉验收尚未最终完成**
   - 重点检查不同屏幕比例下棋盘四角是否完整。
   - 连续缩小、降低视角后，棋盘是否仍保持可见面积。
   - 棋子点击、旋转舵盘和移动格是否容易操作且不重叠。

2. **单面镜需要真机再次肉眼确认**
   - 自动测试已经验证规则方向和 GLB `Mirror_Face` 法线。
   - 仍需确认模型中“看起来像镜子的一面”与实际反射方向完全一致。
   - 测试五套阵型的不同朝向，不要只检查一个默认棋子。

3. **当前工作区尚未提交**
   - 十个二进制 GLB、加载器、渲染器、测试和生成脚本必须作为一个完整变更审查。
   - `scripts/generate-laser-models.js` 目前是未跟踪文件，提交前不要漏掉。

4. **本地调试服务不是永久服务**
   - 当前测试地址通常为 `http://localhost:57581/laser-3d-debug.html`。
   - 如果访问失败，在项目根目录重新启动：

```sh
python3 -m http.server 57581 --bind 127.0.0.1
```

## 6. 下一步计划

建议按以下顺序继续：

1. 在浏览器打开 `http://localhost:57581/laser-3d-debug.html`，检查模型、镜面、激光、相机和电脑不发空激光。
2. 在微信开发者工具和至少一台窄长屏真机完成验收清单。
3. 如果单面镜视觉方向仍错，先检查 GLB 的 `Mirror_Face` 几何和 `validateMirrorDirections()`，不要直接改 `MIRROR_MAP` 猜方向。
4. 审查当前 dirty diff，显式暂存五个 JS/测试文件、十个 GLB 和 `scripts/generate-laser-models.js`。
5. 再跑完整回归，通过后提交。
6. 提审前检查小游戏名称、头像、包体积、项目配置和截图。
7. 后续维护性优化可继续拆分 `game/create-game.js`：

```text
render/canvas-scene.js
ui/setup-screen.js
ui/battle-hud.js
ui/result-modal.js
input/touch-controller.js
```

不要先创建无内容空模块；每次只拆一个职责，并保持 `laser-game.js` 入口不变。

## 7. 验证命令

当前最新验证结果：全部通过。

```sh
node tests/laser-webgl.test.js
node tests/laser-ai.test.js
node --check game.js
node --check games/laser/laser-game.js
node --check games/laser/game/create-game.js
node --check games/laser/config/constants.js
node --check games/laser/config/formations.js
node --check games/laser/core/rules.js
node --check games/laser/core/ai.js
node --check games/laser/glb-loader.js
node --check games/laser/webgl-renderer.js
git diff --check
```

成功输出应包含：

```text
laser WebGL regression tests passed
laser AI regression tests passed
```

## 8. 真机验收清单

- [ ] 首界面五套阵型预览清楚，棋盘和棋子没有裁切。
- [ ] 开始游戏后无法修改阵型和难度。
- [ ] 红蓝保留区规则正确。
- [ ] 双面镜能够与双方盾牌/单面镜合法互换。
- [ ] 单面镜只有可见镜面反射，背面被击杀。
- [ ] 激光线、转折光点、炮口和终点圆光头位置一致。
- [ ] 电脑有敌方击杀目标时发射激光。
- [ ] 电脑无击杀目标或只会击中己方时不发射，直接结束回合。
- [ ] AI 移动期间玩家不能操作；电脑回合结束后输入立即恢复。
- [ ] 棋子点击容易，旋转舵盘不遮挡移动目标。
- [ ] 双指缩放、旋转和俯仰后棋盘不会变成一条横线。
- [ ] 棋盘四角和边缘棋子在真机上完整可见。
- [ ] 击杀动画、胜利/失败结算动画完整播放。
- [ ] 返回操作出现进度丢失二次确认。

## 9. 已踩过的坑

1. **GitHub 不支持账户密码推送**
   - HTTPS 必须使用 Personal Access Token，或者改用 SSH key。

2. **不要使用 `file://` 判断完整 WebGL 行为**
   - 浏览器安全策略可能阻止资源加载。使用本地 HTTP 服务。

3. **单面镜的视觉面和规则方向必须同时校准**
   - 只改规则映射会让模型看起来反着反射。
   - 只旋转模型会让五套阵型已有 orientation 全部偏移。
   - 应从 GLB 的唯一 `Mirror_Face` 实际几何法线推导并验证方向。

4. **GLB 节点变换会破坏镜面校验**
   - 镜面节点不应额外带 rotation/scale/matrix；否则局部法线与世界方向不一致。

5. **WebGL 光晕会遮住亮芯**
   - 同深度先画半透明光晕时必须关闭 depth write，再恢复后画亮芯。

6. **固定屏幕尺寸或固定相机距离会在真机裁棋盘**
   - 必须按真实纵横比适配；缩小时也要限制最小 pitch。

7. **AI 动画结束和规则提交必须分开**
   - 动画播放期间不能提前修改棋盘状态。
   - 动画结束后只提交一次，再判断是否需要发射。

8. **“不发空激光”不能只隐藏动画**
   - 必须在动作提交后模拟 AI 激光。
   - 仅当 `eliminated.owner !== G.aiPlayer` 时才发射，否则真正调用 `endTurn()`。

9. **WebGL 测试桩需要同步新增 uniform 和 GL 常量**
   - 修改 shader、材质或混合模式时，需要同步更新 `tests/laser-webgl.test.js` 的 fake GL。

10. **模型生成脚本会覆盖全部模型**
    - 运行 `node scripts/generate-laser-models.js` 前先检查工作区；运行后必须重新执行 WebGL 和镜面测试。

11. **不要破坏公开入口**
    - `game.js` 和测试依赖 `games/laser/laser-game.js`；内部重构后仍应保留这个薄包装入口。

## 10. 给下一位 Agent 的快速开始

```sh
cd /Users/nash/Documents/zzr_project
git status --short
node tests/laser-webgl.test.js
node tests/laser-ai.test.js
python3 -m http.server 57581 --bind 127.0.0.1
```

然后打开：

```text
http://localhost:57581/laser-3d-debug.html
```

开始修改前先阅读：

```text
HANDOFF.md
games/laser/README.md
games/laser/config/constants.js
games/laser/core/rules.js
games/laser/core/ai.js
```
