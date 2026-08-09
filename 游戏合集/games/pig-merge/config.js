/**
 * 游戏配置常量
 * 所有尺寸基于 375px 宽度的设计稿，运行时按屏幕宽度等比缩放
 */

// 设计稿基准宽度（iPhone 逻辑像素）
var BASE_WIDTH = 375;

// 角色级别配置（1~10级）西游记主题
// 小妖 → 白骨精 → 蜘蛛精 → 沙悟净 → 猪八戒 → 孙悟空 → 观音菩萨 → 如来佛祖 → 玉皇大帝 → 盘古
var PIG_LEVELS = [
  { level: 1,  radius: 22,  color: '#9966CC', dark: '#7B4FB0', score: 0,   name: '小妖'     },
  { level: 2,  radius: 28,  color: '#D0D0E0', dark: '#A0A0B0', score: 12,  name: '白骨精'   },
  { level: 3,  radius: 35,  color: '#C04060', dark: '#8B2D4A', score: 27,  name: '蜘蛛精'   },
  { level: 4,  radius: 43,  color: '#4A90A4', dark: '#2A7084', score: 48,  name: '沙悟净'   },
  { level: 5,  radius: 52,  color: '#FFB6C1', dark: '#E09AA5', score: 75,  name: '猪八戒'   },
  { level: 6,  radius: 62,  color: '#FFD700', dark: '#DAA520', score: 108, name: '孙悟空'   },
  { level: 7,  radius: 73,  color: '#FFF5E6', dark: '#E8D8C8', score: 147, name: '观音菩萨' },
  { level: 8,  radius: 85,  color: '#FFC125', dark: '#D4A020', score: 192, name: '如来佛祖' },
  { level: 9,  radius: 95,  color: '#FFD700', dark: '#B8860B', score: 243, name: '玉皇大帝' },
  { level: 10, radius: 105, color: '#9370DB', dark: '#6A5ACD', score: 300, name: '盘古'     }
];

var MAX_LEVEL = 10;

// 随机生成的级别范围
var MIN_SPAWN_LEVEL = 1;
var MAX_SPAWN_LEVEL = 3;

// 物理参数（用户调试调优值）
var PHYSICS = {
  // 下落物理
  GRAVITY:              3000,   // 重力加速度
  DROP_VELOCITY:        200,    // 初始下落速度
  AIR_DAMPING:          1.000,  // 空气阻尼
  HIGH_SPEED_THRESHOLD: 2000,   // 高速阈值
  HIGH_SPEED_DAMPING:   1.000,  // 高速阻尼

  // 碰撞参数
  POSITION_ITERATIONS:  8,      // 碰撞迭代次数
  TANGENTIAL_FRICTION:  0.300,  // 切向摩擦
  POSITION_CORRECTION:  1.00,   // 位置修正系数
  COLLISION_SLOP:       1.5,    // 碰撞容差

  // 地面墙壁
  WALL_RESTITUTION:     0.80,   // 墙壁反弹系数
  FLOOR_FRICTION:       0.30,   // 地面摩擦
  GROUND_DAMPING:       0.800,  // 地面阻尼
  GROUND_VEL_CUTOFF:    5,      // 地面速度截止
  VEL_SLEEP_THRESHOLD:  1,      // 速度休眠阈值

  // 弹性系数
  RESTITUTION:          0.50,   // 基础弹性
  RESTITUTION_DECAY:    0.050,  // 每级递减

  // 子步进
  SUBSTEPS:             1
};

// 动画参数（用户调试调优值）
var ANIM = {
  SQUISH_MAX:        0.50,   // 挤压最大值
  SPRING_BACK_MULT:  0.5,    // 回弹速度倍率
  TILT_FACTOR:       1500,   // 倾斜因子
  SETTLED_THRESHOLD: 500,    // 稳定阈值（速度平方）
  SCARED_THRESHOLD:  500     // 害怕表情触发阈值
};

// 游戏布局参数
var LAYOUT = {
  FENCE_RATIO:     0.16,
  SPAWN_OFFSET:    0.04,
  DANGER_TIME:     0.5,     // 超线危险持续时间
  SPAWN_DELAY:     0.00     // 最短等待时间（实际需等猪猪稳定）
};

// 颜色主题
var COLORS = {
  BG_TOP:      '#1a1a2e',
  BG_BOTTOM:   '#16213e',
  FENCE:       '#4a4a6a',
  FENCE_DANGER:'#FF4444',
  FENCE_WARN:  '#FFAA00',
  TEXT:        '#FFFFFF',
  TEXT_DIM:    '#8888aa',
  SCORE_BG:    'rgba(255,255,255,0.1)',
  PARTICLE:    ['#FFD700', '#FFA500', '#FF6347', '#FF69B4']
};

module.exports = {
  BASE_WIDTH: BASE_WIDTH,
  PIG_LEVELS: PIG_LEVELS,
  MAX_LEVEL: MAX_LEVEL,
  MIN_SPAWN_LEVEL: MIN_SPAWN_LEVEL,
  MAX_SPAWN_LEVEL: MAX_SPAWN_LEVEL,
  PHYSICS: PHYSICS,
  ANIM: ANIM,
  LAYOUT: LAYOUT,
  COLORS: COLORS
};
