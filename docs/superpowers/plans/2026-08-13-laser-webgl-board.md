# 镭射棋盘 WebGL 3D 升级实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有原生微信小游戏内，以离屏 WebGL 加载 10 个 GLB 棋子并渲染真实 3D 棋盘，同时保留全部 2D UI、游戏规则和伪 3D 回退。

**Architecture:** `game.js` 继续持有主 2D Canvas，只向镭射模块注入离屏 Canvas 创建器；`laser-game.js` 仍是唯一状态源，并在 WebGL 渲染/拾取与旧伪 3D 之间分流。新增 `glb-loader.js` 只解析本批模型实际使用的 glTF 子集，`webgl-renderer.js` 只负责棋盘、模型实例、相机、拾取、激光与 GPU 生命周期。

**Tech Stack:** 微信小游戏 JavaScript、Canvas 2D、WebGL 1.0、glTF 2.0 Binary、Node.js `assert` 回归测试。

## Global Constraints

- 保留当前微信小游戏工程，不新建 Cocos Creator 工程。
- 保留现有主界面、规则、AI、触摸流程和游戏状态；3D 只替换棋盘区域。
- 使用方案 A：离屏 WebGL + 现有 2D UI。
- 不引入 Cocos Runtime、Three.js、npm 包或其他完整 3D 引擎。
- `G.pieces` 和现有激光路径继续是唯一事实来源，不复制规则逻辑。
- 单面镜仅浅蓝色 `Mirror_Face` 是反射面；双面镜前后两块镜面都可反射。
- WebGL、着色器、模型或合成失败时，整套回退当前伪 3D 棋盘。
- 正式游戏只携带 10 个独立 GLB，不携带 `all_pieces_overview.glb`。
- 不覆盖工作区已有的 `game.js`、`games/laser/laser-game.js`、`tests/laser-ai.test.js` 未提交改动；只在当前内容上追加。
- 不触碰 `.trae-html-share-packages/`、`laser-game-filing/`、`docs/superpowers/specs/2026-08-13-laser-webgl-glb-migration-design.md` 等非本计划文件。

## File Structure

- Create `games/laser/glb-loader.js`: 解析 GLB 容器、accessor、节点、网格和内嵌 PBR 材质。
- Create `games/laser/webgl-renderer.js`: 管理 WebGL 上下文、资源、棋盘、模型实例、拾取、激光和回退状态。
- Create `games/laser/models/*.glb`: 10 个独立红蓝模型资源。
- Modify `game.js`: 提供离屏 Canvas 创建器，不改变现有 2D 主循环和其他游戏入口。
- Modify `games/laser/laser-game.js`: 初始化/更新/绘制/退出 WebGL 渲染器，并保留伪 3D 路径。
- Modify `tests/laser-ai.test.js`: 确认现有 UI、规则和回退行为不回归。
- Create `tests/laser-webgl.test.js`: GLB、镜面方向、坐标、拾取、状态同步和失败回退测试。

---

### Task 1: 导入并验证 10 个正式 GLB

**Files:**
- Create: `games/laser/models/laser_cannon_red.glb`
- Create: `games/laser/models/laser_cannon_blue.glb`
- Create: `games/laser/models/king_red.glb`
- Create: `games/laser/models/king_blue.glb`
- Create: `games/laser/models/shield_red.glb`
- Create: `games/laser/models/shield_blue.glb`
- Create: `games/laser/models/single_mirror_red.glb`
- Create: `games/laser/models/single_mirror_blue.glb`
- Create: `games/laser/models/double_mirror_red.glb`
- Create: `games/laser/models/double_mirror_blue.glb`
- Create: `tests/laser-webgl.test.js`

**Interfaces:**
- Consumes: 用户提供的 `cocos_chess_glb_models.zip`。
- Produces: `MODEL_FILES` 测试清单，后续加载器和渲染器使用完全相同的 10 个相对路径。

- [ ] **Step 1: 写失败的资源完整性测试**

在 `tests/laser-webgl.test.js` 中用 Node 标准库定义 10 个文件清单，逐个断言存在、前四字节为 `glTF`、版本为 `2`、头部声明长度等于文件长度；同时断言正式目录不存在 `all_pieces_overview.glb`。

- [ ] **Step 2: 运行测试确认 RED**

Run: `node tests/laser-webgl.test.js`

Expected: FAIL，首个正式 GLB 不存在。

- [ ] **Step 3: 从用户 ZIP 解压且只复制 10 个独立模型**

从压缩包的 `cocos_chess_glb/models/` 复制清单中的文件到 `games/laser/models/`。不复制总览模型、预览 PNG、README 或 manifest。

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `node tests/laser-webgl.test.js`

Expected: PASS，10 个 GLB 头部和长度均有效，总览文件不存在。

- [ ] **Step 5: 提交本任务**

只暂存 `games/laser/models/*.glb` 与 `tests/laser-webgl.test.js`，提交信息：`feat: add laser chess GLB assets`。

---

### Task 2: 实现最小 GLB 加载器与镜面元数据

**Files:**
- Create: `games/laser/glb-loader.js`
- Modify: `tests/laser-webgl.test.js`

**Interfaces:**
- Consumes: `ArrayBuffer` 格式的本地 GLB。
- Produces: `parseGlb(arrayBuffer)`，返回 `{nodes, meshes, materials, sceneNodes}`；每个 primitive 返回展开后的 `positions`、`normals`、`indices` 和 `material`，节点保留 `name`、`mesh`、`children`、`matrix`。
- Produces: `mirrorSurfaces(model)`，按节点名返回单面镜一个 `Mirror_Face`、双面镜 `Mirror_Front` 与 `Mirror_Back`。

- [ ] **Step 1: 写失败的解析测试**

扩展 `tests/laser-webgl.test.js`：读取 `single_mirror_red.glb`，断言 `parseGlb` 存在；解析后包含 10 个 mesh、材质名 `red`/`red_dark`/`mirror`，每个 primitive 的 positions/normals/indices 数量有效；`mirrorSurfaces` 只返回 `single_mirror_red_Mirror_Face`。再读取双面镜，断言只返回 Front/Back 两个镜面。

- [ ] **Step 2: 运行测试确认 RED**

Run: `node tests/laser-webgl.test.js`

Expected: FAIL，`../games/laser/glb-loader.js` 不存在。

- [ ] **Step 3: 实现 GLB 容器和 accessor 解析**

实现并校验：magic/version/length、JSON/BIN chunk、bufferView 边界、FLOAT VEC3、UNSIGNED_SHORT/UNSIGNED_INT SCALAR 索引、节点层级和 PBR factor。未知的必要 component/type、越界或缺失 NORMAL 必须抛出带模型上下文的错误。

- [ ] **Step 4: 实现镜面节点识别**

按节点名后缀严格匹配 `_Mirror_Face`、`_Mirror_Front`、`_Mirror_Back`；单面镜只允许一个 Face，双面镜只允许 Front/Back，重复或缺失时抛错。

- [ ] **Step 5: 运行测试确认 GREEN 与边界失败**

Run: `node tests/laser-webgl.test.js`

Expected: PASS；测试还应对损坏 magic、截断 chunk、越界 accessor 和缺失镜面节点断言抛错。

- [ ] **Step 6: 语法和差异检查**

Run: `node --check games/laser/glb-loader.js && git diff --check`

Expected: exit 0。

- [ ] **Step 7: 提交本任务**

只暂存 `games/laser/glb-loader.js` 与 `tests/laser-webgl.test.js`，提交信息：`feat: parse laser chess GLB models`。

---

### Task 3: 建立 WebGL 棋盘、模型资源和实例渲染

**Files:**
- Create: `games/laser/webgl-renderer.js`
- Modify: `tests/laser-webgl.test.js`

**Interfaces:**
- Consumes: `create(options)`，其中 options 包含 `canvas`、`width`、`height`、`dpr`、`readAsset(path, callback)`。
- Produces: renderer 方法 `load(done)`、`render(scene)`、`pick(x,y,camera)`、`resize(width,height,dpr)`、`dispose()`、`status()`。
- `scene` 结构固定为 `{pieces, selected, targets, path, aiPose, camera, setup, zoneCells}`；不得持有或修改 `G`。

- [ ] **Step 1: 写失败的纯函数测试**

在 `tests/laser-webgl.test.js` 断言模块导出：

- `pieceModelKey({type,owner})` 生成五类红蓝文件键；
- `cellToWorld(row,col)` 与 `worldToCell(x,z)` 对 80 格互为逆变换；
- `zoneCells()` 输出与现有棋盘红白禁区完全相同的格子；
- `orientationAngle(type, orientation)` 对炮、盾、单双镜返回四个相差 90° 的角度；
- `validateMirrorDirections()` 验证单面镜四方向法线与 `MIRROR_MAP`、双面镜与 slash/back 表一致。

- [ ] **Step 2: 运行测试确认 RED**

Run: `node tests/laser-webgl.test.js`

Expected: FAIL，`webgl-renderer.js` 不存在。

- [ ] **Step 3: 实现坐标、模型映射和方向校准**

实现 `pieceModelKey`、`cellToWorld`、`worldToCell`、`zoneCells`、`orientationAngle` 和 `validateMirrorDirections`。校准角以模型 `+Z` 正面和现有棋盘方向定义推导；测试枚举所有来光方向，不能只比较角度常量。

- [ ] **Step 4: 实现 WebGL 初始化和失败状态**

创建透明、抗锯齿 WebGL 上下文；编译一套顶点/片元着色器；启用深度测试和 alpha 混合。任何上下文、shader、program、buffer 或资源错误将 `status()` 置为 `{mode:"fallback", reason}`，之后 `render` 安全返回 false。

- [ ] **Step 5: 实现资源读取和 GPU 缓存**

加载 10 个 GLB，调用 `parseGlb`，每个 primitive 只创建一次 position/normal/index Buffer；缓存按模型文件键保存。只有全部模型成功后状态才变为 `ready`，否则释放已创建资源并进入 fallback。

- [ ] **Step 6: 实现棋盘和棋子实例绘制**

生成一个共享棋盘网格：10×8 格、薄板、格线、红白禁区；使用透视矩阵和固定方向光/环境光。按 `scene.pieces` 遍历 alive 棋子，应用格子位置、统一模型缩放、方向与 `aiPose`，复用模型 Buffer 绘制。

- [ ] **Step 7: 写并通过观察型 WebGL 测试**

使用最小 fake WebGL 上下文记录 program/buffer/draw 调用；断言 10 个模型只上传一次、重复 render 不重建 Buffer、alive 棋子生成 drawElements、dispose 删除已创建 Buffer/Program。强制 shader 编译失败和某一 GLB 读取失败，断言完整 fallback 且无 drawElements。

- [ ] **Step 8: 运行验证**

Run: `node tests/laser-webgl.test.js && node --check games/laser/webgl-renderer.js && git diff --check`

Expected: 全部 exit 0。

- [ ] **Step 9: 提交本任务**

只暂存 `games/laser/webgl-renderer.js` 与 `tests/laser-webgl.test.js`，提交信息：`feat: render laser chess board with WebGL`。

---

### Task 4: 接入微信小游戏资源读取与双画布合成

**Files:**
- Modify: `game.js`
- Modify: `games/laser/laser-game.js`
- Modify: `tests/laser-ai.test.js`
- Modify: `tests/laser-webgl.test.js`

**Interfaces:**
- `game.js` 调用 `LaserGame.create(ctx, W, H, returnToMenu, platform)`。
- `platform` 固定为 `{createCanvas, readAsset, dpr}`；缺失时镭射模块直接使用旧伪 3D，保证 Node 测试和旧调用方兼容。
- `laser-game.js` 构造 `sceneSnapshot()` 给 renderer，不能把可变 `G.pieces` 暴露给渲染器。

- [ ] **Step 1: 写失败的集成测试**

扩展 `tests/laser-ai.test.js`，注入 fake platform 与 fake renderer：

- WebGL ready 时 `render` 收到当前阵型、选择、目标、相机、AI pose 和激光路径；
- 主 2D context 在棋盘层调用一次 `drawImage(offscreenCanvas, ...)`；
- setup 和 playing 共用 renderer；
- 缺少 platform、创建 canvas 抛错、加载失败或 drawImage 抛错时调用旧 `drawBoard3D`/`drawPiece3D` 路径；
- `exit()` 只 dispose 一次，异步完成回调不能复活 renderer。

- [ ] **Step 2: 运行测试确认 RED**

Run: `node tests/laser-ai.test.js`

Expected: FAIL，当前 create 不接收 platform，也不会合成 WebGL 画布。

- [ ] **Step 3: 在主入口注入最小平台适配**

在 `game.js` 保留主 2D canvas；`createLaserGame()` 传入：

- `createCanvas: wx.createCanvas.bind(wx)`；
- `readAsset` 使用 `wx.getFileSystemManager().readFile` 读取代码包内相对路径并返回 ArrayBuffer；
- `dpr: DPR`。

不修改其他两个小游戏的创建方式。

- [ ] **Step 4: 在镭射模块初始化渲染器**

创建离屏 Canvas，将尺寸限制为棋盘区域和 DPR≤2；异步加载期间保留当前背景并显示“正在加载 3D 棋盘…”。成功后切换 ready，失败后固定为 fallback 并记录一次原因。

- [ ] **Step 5: 分流绘制并合成**

从现有 `render()` 中抽出最小 `renderBoardLayer()`：ready 时组装只读 scene、调用 WebGL renderer、再 `ctx.drawImage` 合成；否则调用当前 `drawBoard3D`、`drawPiece3D`、旧选中和激光绘制。UI 绘制顺序保持不变。

- [ ] **Step 6: 生命周期与上下文恢复**

`exit()` 标记模块失效、dispose renderer、清空引用并继续调用现有视觉状态清理；异步读取回调先检查 token。若运行时 renderer.render 或 drawImage 抛错，dispose 并永久切换本次模块实例到 fallback。

- [ ] **Step 7: 运行完整回归**

Run: `node tests/laser-webgl.test.js && node tests/laser-ai.test.js && node --check game.js && node --check games/laser/laser-game.js && git diff --check`

Expected: 全部 exit 0，现有 AI/UI/规则测试继续输出 `laser AI regression tests passed`。

- [ ] **Step 8: 提交本任务**

只暂存本任务实际修改的四个 JS/测试文件，先核对 cached name-only，提交信息：`feat: integrate WebGL laser board`。

---

### Task 5: WebGL 拾取、动作提示和 3D 激光

**Files:**
- Modify: `games/laser/webgl-renderer.js`
- Modify: `games/laser/laser-game.js`
- Modify: `tests/laser-webgl.test.js`
- Modify: `tests/laser-ai.test.js`

**Interfaces:**
- `renderer.pick(localX, localY, camera)` 返回 `{r,c}` 或 `null`。
- `renderer.render(scene)` 的 `scene.path` 直接使用现有激光格点；`scene.aiPose` 直接使用现有动画采样结果。

- [ ] **Step 1: 写失败的拾取测试**

对 setup 固定相机和 playing 的边界 yaw/pitch，投影每个格子中心后再 pick，断言返回原行列；棋盘外点返回 null。测试画布局部坐标与主屏坐标的偏移换算。

- [ ] **Step 2: 运行测试确认 RED**

Run: `node tests/laser-webgl.test.js`

Expected: FAIL，pick 尚未实现或返回不正确。

- [ ] **Step 3: 实现射线和平面求交拾取**

逆变换裁剪空间近远点，形成世界射线，与棋盘 y=0 平面求交，再用 `worldToCell` 转换；平行、背向、越界和非有限值返回 null。

- [ ] **Step 4: 把点击分流到 WebGL pick**

`screenToCell` 在 renderer ready 时先换算棋盘局部坐标并调用 pick；fallback 时原封不动执行现有最近投影点算法。UI、按钮和棋盘内操作顺序保持不变。

- [ ] **Step 5: 写失败的动画与激光绘制测试**

fake WebGL 记录实例矩阵和 draw 调用：移动/旋转/互换时使用 `aiPose` 且不提前改变规则棋子；激光每一段生成核心与辉光两次绘制，转折点使用相邻格中心；空/短/非法 path 不绘制。

- [ ] **Step 6: 实现选择、落点、电脑动作和 3D 激光**

用共享的平面/线带网格绘制选中环、合法落点环和电脑动作脉冲；激光位于棋盘表面上方，核心不透明、外层 alpha 混合。只消费现有 pose/path，不新增动画计时器。

- [ ] **Step 7: 运行完整验证**

Run: `node tests/laser-webgl.test.js && node tests/laser-ai.test.js && node --check games/laser/webgl-renderer.js && node --check games/laser/laser-game.js && git diff --check`

Expected: 全部 exit 0。

- [ ] **Step 8: 提交本任务**

只暂存本任务四个文件，提交信息：`feat: add WebGL picking and laser effects`。

---

### Task 6: 兼容性、真实加载和最终验收

**Files:**
- Modify: `tests/laser-webgl.test.js`
- Modify: `tests/laser-ai.test.js`
- Modify: `laser-3d-debug.html`（仅当现有调试页能以小改动注入浏览器 Canvas；若微信专属读取阻止复用，则不修改，并在报告记录真机门槛）

**Interfaces:**
- Consumes: 完整模块公共接口与真实 10 个 GLB。
- Produces: 可重复的自动验证命令和明确的人工验收记录。

- [ ] **Step 1: 补足真实路径失败测试**

覆盖：无 WebGL、context lost、shader compile/link 失败、任一 GLB 缺失/损坏、合成失败、退出时仍在加载、再次进入重新初始化。每个场景断言 UI 仍可开始游戏、点击棋子、返回确认和 exit 清理。

- [ ] **Step 2: 运行自动测试并修复根因**

Run: `node tests/laser-webgl.test.js && node tests/laser-ai.test.js`

Expected: 两套回归均 PASS，无未处理异常或计时器残留。

- [ ] **Step 3: 运行静态检查**

Run: `node --check game.js && node --check games/laser/laser-game.js && node --check games/laser/glb-loader.js && node --check games/laser/webgl-renderer.js && git diff --check`

Expected: 全部 exit 0。

- [ ] **Step 4: 微信开发者工具人工验收**

验证五种阵型预览、红蓝模型、禁区、炮/盾/镜面方向、移动/旋转/交换、电脑动作、激光、视角、规则弹窗、返回和重开；控制台无每帧错误。记录基础库版本与结果。

- [ ] **Step 5: 至少一台真机人工验收**

同样覆盖核心流程，并观察帧率、加载时间、内存和触摸拾取。人工验收如果无法在当前环境执行，必须明确标记为未通过门槛，不能以桌面 Node 测试替代。

- [ ] **Step 6: 强制回退验收**

通过测试开关或注入失败强制禁用 WebGL，完成从阵型选择到一回合走棋/发射/返回，确认旧伪 3D 完整可玩。

- [ ] **Step 7: 最终提交**

只提交本任务测试和必要调试页改动，提交信息：`test: verify laser WebGL fallback and lifecycle`。

- [ ] **Step 8: 请求代码审查并处理发现**

使用 `superpowers:requesting-code-review` 审查规格覆盖、GLB 安全边界、GPU 生命周期、规则一致性与工作区范围；重要问题修复后重跑 Step 2–3。

---

## Plan Self-Review

- 规格中的双画布、单一状态源、轻量 GLB 子集、10 个模型、单/双镜面语义、棋盘禁区、相机、拾取、激光、回退、性能和生命周期均有对应任务。
- 所有新增模块的调用签名在首次出现处固定，后续任务保持一致。
- 无新增依赖、通用引擎、实时阴影或实时镜面反射。
- 工作区现有未提交改动被列为全局约束，每个提交都要求显式暂存与 cached 文件核对。
- 真机验收保留为不可伪造的完成门槛。
