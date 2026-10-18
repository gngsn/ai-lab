/** World units are roughly "game meters"; the runner is ~1.8 units tall. */
export const ROAD_HALF = 4.5;
/** Lateral limit — a bit of grass on each side before the invisible wall. */
export const LATERAL_LIMIT = ROAD_HALF + 2.5;
/** Runner half-width — touching grass with a foot counts as off road. */
export const RUNNER_HALF = 0.35;

export const MAX_V = 32;
/** Speed cap per pace bucket: green, yellow, orange, red. */
export const SPEED_CAP = [1.0, 0.85, 0.7, 0.55] as const;
export const TURBO_V = MAX_V * 1.45;
export const TURBO_TIME = 2.0;
export const TURBO_PAD_HALF_WIDTH = 1.6;
export const ACCEL = 14;
export const OFFROAD_FACTOR = 0.45;

export const STEER_SPEED = 9;
/** Lateral drift (units/s) per unit of curvature × v² — pushes the runner wide in turns. */
export const DRIFT_K = 0.2;
export const DRIFT_MAX = 8;

/** Ghost ("past me") pacing: a perfect turbo-less run beats it by this margin. */
export const GHOST_SLACK = 1.03;
/** Fall this far behind the ghost and it's game over. */
export const GAP_LIMIT = 70;

export const COUNTDOWN = 3;

export const COIN_SPACING = 5;

/** Energy gel every N real metres of the run. */
export const GEL_EVERY_M = 5000;
/** No gel this close (real metres) to the finish. */
export const GEL_FINISH_MARGIN_M = 300;
export const GEL_RADIUS = 1.3;
/** Energy boost: pace caps are ignored and grass hurts less. */
export const ENERGY_TIME = 6;
export const ENERGY_V = MAX_V * 1.15;
export const ENERGY_OFFROAD_FACTOR = 0.75;
/** Items you carry and use when you like. */
export const ITEM_SLOTS = 3;
export const ITEM_RADIUS = 1.2;
/** Banana: steady footing — no grass slowdown and much less drift in curves. */
export const BANANA_TIME = 4;
export const GRIP_DRIFT = 0.35;
/** Shine muscat (one grape): a short, strong sprint. */
export const MUSCAT_TIME = 1.5;
export const SPRINT_V = MAX_V * 1.6;
/** pickup radius around a coin's lateral position */
export const COIN_RADIUS = 0.8;

export const PACE_COLORS = ['#3fc39a', '#f5d04f', '#f5a04f', '#ee6767'] as const;
export const PACE_LABELS = ['Fast', 'Steady', 'Slow', 'Very slow'] as const;
