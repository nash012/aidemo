# 镭射棋模块结构

`games/laser/laser-game.js` 是对外稳定入口。游戏合集和测试只应依赖这个文件，内部文件可以继续重构而不影响调用方。

```text
games/laser/
├── laser-game.js             # 稳定入口，转发 create()
├── game/
│   └── create-game.js        # 生命周期、输入、界面和各模块编排
├── config/
│   ├── constants.js          # 棋盘、棋子、方向、禁区、难度参数
│   └── formations.js         # 五套阵型和初始棋子生成
├── core/
│   ├── rules.js              # 移动、旋转、交换、激光和回合结算
│   └── ai.js                 # 局面评估、主动进攻指标和 Alpha-Beta
├── glb-loader.js              # GLB 解析与模型数据校验
├── webgl-renderer.js          # WebGL 棋盘、棋子、激光和特效渲染
└── models/                    # 红蓝双方 GLB 模型资源
```

## 依赖方向

依赖只能向下流动：

```text
laser-game.js
      ↓
game/create-game.js ─────────→ webgl-renderer.js → glb-loader.js → models/
      ↓
core/ai.js → core/rules.js → config/constants.js
      ↓               ↘
config/formations.js → config/constants.js
```

- `config/` 不读取画布、微信 API、计时器或游戏状态。
- `core/` 只处理传入的数据，不能绘制界面或修改全局状态。
- `game/create-game.js` 负责生命周期、交互状态、计时器以及模块编排。
- `webgl-renderer.js` 只消费场景快照；规则结果由 `core/` 决定。
- 外部代码统一引用 `laser-game.js`，不要直接引用 `game/create-game.js`。

## 修改位置

| 需求 | 首选文件 |
| --- | --- |
| 调整棋盘尺寸、禁区或难度参数 | `config/constants.js` |
| 修正五套初始阵型和棋子朝向 | `config/formations.js` |
| 修改移动、双面镜交换、激光反射或击杀规则 | `core/rules.js` |
| 调整电脑进攻、防守或搜索策略 | `core/ai.js` |
| 修改 WebGL 模型、光束或棋盘表现 | `webgl-renderer.js` |
| 修改页面切换、触摸交互或动画时序 | `game/create-game.js` |

## 后续拆分边界

控制器中的 Canvas 备用渲染、界面绘制和触摸状态仍有较强的共享状态，后续可在功能稳定后依次抽成：

```text
render/canvas-scene.js
ui/setup-screen.js
ui/battle-hud.js
ui/result-modal.js
input/touch-controller.js
```

这些是建议的下一阶段边界，目前没有建立空文件，避免出现只有目录没有职责的“假模块化”。

## 验证

```sh
node tests/laser-ai.test.js
node tests/laser-webgl.test.js
node --check games/laser/game/create-game.js
```
