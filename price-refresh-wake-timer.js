"use strict";
// Only timer coordination; the caller retains lifecycle.runJob, actual due
// checks, the batch-running guard and all existing lease/source operations.
const Schedule = require("./price-refresh-wake-plan");
function create(options) {
  let timer = null, stopped = false;
  const cancel = () => { if (timer !== null) options.clearTimer(timer); timer = null; };
  const snapshot = () => Schedule.decision(options.getStates(), options.getHandlers(), options.getContext());
  function arm() {
    cancel();
    if (stopped || options.isStopping() || options.isRunning()) return null;
    const plan = snapshot();
    if (!plan.shouldArm) return plan;
    timer = options.setTimer(() => {
      timer = null;
      if (stopped || options.isStopping() || options.isRunning()) return;
      // A cooldown, foreign lease or source change after arming invalidates
      // the old timer; no captured due time can authorize a later source run.
      const context = options.getContext(), current = Schedule.candidateFor(options.getStates(), options.getHandlers(), context, plan.candidate.name);
      if (!current || current.eligibleAt > context.now) { arm(); return; }
      options.onWake();
    }, plan.delayMs);
    timer?.unref?.();
    return plan;
  }
  return Object.freeze({ arm, beforeFallback: cancel, stop: () => { stopped = true; cancel(); }, hasTimer: () => timer !== null });
}
module.exports = Object.freeze({ create });
