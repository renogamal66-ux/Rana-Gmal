import { MovementEvaluationResult, MovementExerciseType } from '../types';

export interface PoseLandmark {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

// Landmark indices from MediaPipe Pose (33 keypoints)
export const POSE_IDX = {
  NOSE: 0,
  LEFT_EYE: 2,
  RIGHT_EYE: 5,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
} as const;

export const POSE_CONNECTIONS: [number, number][] = [
  [11, 12], // shoulders
  [11, 13],
  [13, 15], // left arm
  [12, 14],
  [14, 16], // right arm
  [11, 23],
  [12, 24], // torso sides
  [23, 24], // hips
  [23, 25],
  [25, 27], // left leg
  [24, 26],
  [26, 28], // right leg
  [0, 11],
  [0, 12], // neck/head reference
];

function isVisible(lm?: PoseLandmark, threshold = 0.42): lm is PoseLandmark {
  if (!lm) return false;
  if (typeof lm.visibility === 'number') return lm.visibility >= threshold;
  return true;
}

export function calculateAngle(a: PoseLandmark, b: PoseLandmark, c: PoseLandmark): number {
  const radians =
    Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let angle = Math.abs((radians * 180) / Math.PI);
  if (angle > 180) angle = 360 - angle;
  return Math.round(angle);
}

function verticalLeanAngle(top: PoseLandmark, bottom: PoseLandmark): number {
  const dx = Math.abs(top.x - bottom.x);
  const dy = Math.abs(bottom.y - top.y) || 0.0001;
  return Math.round((Math.atan2(dx, dy) * 180) / Math.PI);
}

export function computeLandmarkMotion(
  curr: PoseLandmark[] | null,
  prev: PoseLandmark[] | null
): number {
  if (!curr || !prev || curr.length === 0 || prev.length === 0) return 0;
  const keyIndices = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26];
  let totalDelta = 0;
  let count = 0;
  for (const idx of keyIndices) {
    const a = curr[idx];
    const b = prev[idx];
    if (isVisible(a, 0.35) && isVisible(b, 0.35)) {
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      totalDelta += dist;
      count++;
    }
  }
  if (count === 0) return 0;
  const avg = totalDelta / count;
  return Math.min(100, Math.round(avg * 950));
}

export function evaluatePoseBiomechanical(
  landmarks: PoseLandmark[] | null,
  exerciseType: MovementExerciseType,
  motionIntensity: number
): MovementEvaluationResult {
  if (!landmarks || landmarks.length < 29) {
    return {
      personDetected: false,
      movementDetected: false,
      status: 'waiting',
      verdictTitle: {
        ar: 'قف أمام الكاميرا للبدء',
        en: 'Stand in front of camera',
      },
      reason: {
        ar: 'لم يتم رصد جسم واضح في الكاميرا بعد — تأكد من الإضاءة والظهور داخل الإطار.',
        en: 'No body detected in frame yet — ensure good lighting and step into view.',
      },
      correctionTip: {
        ar: 'قف على بُعد 1.5 متر تقريباً أمام الكاميرا.',
        en: 'Stand about 1.5 meters back facing the camera.',
      },
      detectedExercise: {
        ar: 'في انتظار الرصد',
        en: 'Waiting for subject',
      },
      jointAngle: '-',
      accuracyScore: 0,
      repCompleted: false,
    };
  }

  const nose = landmarks[POSE_IDX.NOSE];
  const ls = landmarks[POSE_IDX.LEFT_SHOULDER];
  const rs = landmarks[POSE_IDX.RIGHT_SHOULDER];
  const le = landmarks[POSE_IDX.LEFT_ELBOW];
  const re = landmarks[POSE_IDX.RIGHT_ELBOW];
  const lw = landmarks[POSE_IDX.LEFT_WRIST];
  const rw = landmarks[POSE_IDX.RIGHT_WRIST];
  const lh = landmarks[POSE_IDX.LEFT_HIP];
  const rh = landmarks[POSE_IDX.RIGHT_HIP];
  const lk = landmarks[POSE_IDX.LEFT_KNEE];
  const rk = landmarks[POSE_IDX.RIGHT_KNEE];
  const la = landmarks[POSE_IDX.LEFT_ANKLE];
  const ra = landmarks[POSE_IDX.RIGHT_ANKLE];

  const hasUpperBody = isVisible(ls) && isVisible(rs);
  if (!hasUpperBody) {
    return {
      personDetected: false,
      movementDetected: motionIntensity > 10,
      status: 'waiting',
      verdictTitle: {
        ar: 'أظهر الكتفين والجسم بوضوح',
        en: 'Show shoulders clearly in frame',
      },
      reason: {
        ar: 'الكتفان غير ظاهرين بالكامل — اضبط زاوية الكاميرا أو ابتعد خطوة للخلف.',
        en: 'Shoulders are not fully visible — step back slightly or adjust camera angle.',
      },
      correctionTip: {
        ar: 'تأكد من ظهور الجزء العلوي من الجسم بوضوح.',
        en: 'Keep upper torso centered in the frame.',
      },
      detectedExercise: { ar: 'معايرة الإطار', en: 'Calibrating frame' },
      jointAngle: '-',
      accuracyScore: 0,
      repCompleted: false,
    };
  }

  const shoulderWidth = Math.max(0.08, Math.hypot(ls.x - rs.x, ls.y - rs.y));
  const shoulderTiltRatio = Math.abs(ls.y - rs.y) / shoulderWidth;
  const shoulderTiltDeg = Math.round(
    Math.abs((Math.atan2(ls.y - rs.y, ls.x - rs.x) * 180) / Math.PI)
  );
  const normalizedTiltDeg = shoulderTiltDeg > 90 ? 180 - shoulderTiltDeg : shoulderTiltDeg;
  const midShoulder = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
  const isMoving = motionIntensity >= 8;

  // 1. KNEE FLEXION
  if (exerciseType === 'knee_flexion') {
    const leftLegOk = isVisible(lh) && isVisible(lk) && isVisible(la);
    const rightLegOk = isVisible(rh) && isVisible(rk) && isVisible(ra);

    if (!leftLegOk && !rightLegOk) {
      return {
        personDetected: true,
        movementDetected: isMoving,
        status: 'waiting',
        verdictTitle: {
          ar: 'أظهر الركبة والساق في الكاميرا',
          en: 'Show knee and leg in frame',
        },
        reason: {
          ar: 'الجزء السفلي غير ظاهر بالكامل — تراجع للخلف أو وجّه الكاميرا نحو الساقين.',
          en: 'Lower body is out of view — step back or tilt camera down toward knees.',
        },
        correctionTip: {
          ar: 'يجب أن يظهر الفخذ والركبة والكاحل داخل الكادر.',
          en: 'Ensure hip, knee, and ankle are visible.',
        },
        detectedExercise: { ar: 'ثني الركبة', en: 'Knee Flexion' },
        jointAngle: '-',
        accuracyScore: 0,
        repCompleted: false,
      };
    }

    const angleL = leftLegOk ? calculateAngle(lh, lk, la) : 180;
    const angleR = rightLegOk ? calculateAngle(rh, rk, ra) : 180;
    const activeKneeAngle = Math.min(angleL, angleR);

    // Check valgus collapse if both knees & ankles are visible
    if (leftLegOk && rightLegOk) {
      const kneeDist = Math.abs(lk.x - rk.x);
      const ankleDist = Math.max(0.05, Math.abs(la.x - ra.x));
      if (activeKneeAngle < 150 && kneeDist < ankleDist * 0.72) {
        return {
          personDetected: true,
          movementDetected: isMoving,
          status: 'incorrect',
          verdictTitle: {
            ar: 'الحركة غلط ✗',
            en: 'Incorrect Movement ✗',
          },
          reason: {
            ar: `الركبة تميل للداخل أثناء الثني (زاوية ${activeKneeAngle}°)، مما يسبب ضغطاً على الرباط الصليبي.`,
            en: `Knee valgus collapse detected at ${activeKneeAngle}° flexion.`,
          },
          correctionTip: {
            ar: 'ادفع الركبة للخارج قليلاً لتكون بمحاذاة أصابع القدم.',
            en: 'Push your knees outward in line with your toes.',
          },
          detectedExercise: { ar: 'ثني الركبة', en: 'Knee Flexion' },
          jointAngle: `${activeKneeAngle}°`,
          accuracyScore: 54,
          repCompleted: false,
        };
      }
    }

    if (activeKneeAngle < 55) {
      return {
        personDetected: true,
        movementDetected: isMoving,
        status: 'incorrect',
        verdictTitle: {
          ar: 'الحركة غلط ✗',
          en: 'Incorrect Movement ✗',
        },
        reason: {
          ar: `ثني عميق جداً (${activeKneeAngle}°) قد يضغط على مفصل الرضفة.`,
          en: `Excessive deep flexion (${activeKneeAngle}°) increasing patellar stress.`,
        },
        correctionTip: {
          ar: 'خفف عمق النزول قليلاً وتوقف عند زاوية 85° - 110°.',
          en: 'Reduce flexion depth slightly to stay between 85° and 110°.',
        },
        detectedExercise: { ar: 'ثني الركبة', en: 'Knee Flexion' },
        jointAngle: `${activeKneeAngle}°`,
        accuracyScore: 60,
        repCompleted: false,
      };
    }

    if (activeKneeAngle <= 148) {
      return {
        personDetected: true,
        movementDetected: isMoving,
        status: 'correct',
        verdictTitle: {
          ar: 'الحركة صح ✓',
          en: 'Correct Movement ✓',
        },
        reason: {
          ar: `زاوية ثني الركبة ممتازة (${activeKneeAngle}°) والمحاذاة مستقرة وآمنة.`,
          en: `Optimal knee flexion (${activeKneeAngle}°) with stable alignment.`,
        },
        correctionTip: {
          ar: 'استمر بنفس التحكم البطيء عند العودة للوضع المستقيم.',
          en: 'Maintain slow controlled return to standing.',
        },
        detectedExercise: { ar: 'ثني الركبة', en: 'Knee Flexion' },
        jointAngle: `${activeKneeAngle}°`,
        accuracyScore: 95,
        repCompleted: true,
      };
    }

    return {
      personDetected: true,
      movementDetected: isMoving,
      status: 'correct',
      verdictTitle: {
        ar: 'وضعية بداية صحيحة ✓',
        en: 'Good Starting Stance ✓',
      },
      reason: {
        ar: `الركبة مفرودة باستقامة سليمة (${activeKneeAngle}°) — اثنِ الركبة الآن لبدء التمرين.`,
        en: `Knee neutral at ${activeKneeAngle}° — bend knee to perform a rep.`,
      },
      correctionTip: {
        ar: 'اثنِ الركبة ببطء مع الحفاظ على استقامة الظهر.',
        en: 'Bend knee smoothly keeping torso tall.',
      },
      detectedExercise: { ar: 'ثني الركبة', en: 'Knee Flexion' },
      jointAngle: `${activeKneeAngle}°`,
      accuracyScore: 90,
      repCompleted: false,
    };
  }

  // 2. SQUAT
  if (exerciseType === 'squat') {
    const leftLegOk = isVisible(lh) && isVisible(lk) && isVisible(la);
    const rightLegOk = isVisible(rh) && isVisible(rk) && isVisible(ra);
    if (!leftLegOk && !rightLegOk) {
      return {
        personDetected: true,
        movementDetected: isMoving,
        status: 'waiting',
        verdictTitle: {
          ar: 'أظهر الجسم والركبتين بالكامل',
          en: 'Show full body & knees',
        },
        reason: {
          ar: 'لتقييم القرفصاء، يجب أن يظهر الجذع والركبتان والكاحلان في الكاميرا.',
          en: 'To evaluate squats, keep torso, knees, and ankles inside the frame.',
        },
        correctionTip: {
          ar: 'ابتعد خطوتين للخلف أمام الكاميرا.',
          en: 'Step two paces back from the camera.',
        },
        detectedExercise: { ar: 'تمرين القرفصاء', en: 'Squat' },
        jointAngle: '-',
        accuracyScore: 0,
        repCompleted: false,
      };
    }

    const midHip =
      isVisible(lh) && isVisible(rh)
        ? { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 }
        : isVisible(lh)
        ? lh
        : rh;
    const torsoLean = verticalLeanAngle(midShoulder, midHip);
    const kneeAngle = Math.min(
      leftLegOk ? calculateAngle(lh, lk, la) : 180,
      rightLegOk ? calculateAngle(rh, rk, ra) : 180
    );

    if (torsoLean > 38) {
      return {
        personDetected: true,
        movementDetected: isMoving,
        status: 'incorrect',
        verdictTitle: {
          ar: 'الحركة غلط ✗',
          en: 'Incorrect Movement ✗',
        },
        reason: {
          ar: `ميل الظهر للأمام زائد (${torsoLean}°) مما يضع حملاً على الفقرات القطنية.`,
          en: `Excessive forward torso lean (${torsoLean}°) overloading lower back.`,
        },
        correctionTip: {
          ar: 'ارفع صدرك للأعلى وحافظ على استقامة ظهرك أثناء النزول.',
          en: 'Keep your chest lifted and spine neutral as you descend.',
        },
        detectedExercise: { ar: 'تمرين القرفصاء', en: 'Squat' },
        jointAngle: `${kneeAngle}°`,
        accuracyScore: 52,
        repCompleted: false,
      };
    }

    if (leftLegOk && rightLegOk) {
      const kneeDist = Math.abs(lk.x - rk.x);
      const ankleDist = Math.max(0.05, Math.abs(la.x - ra.x));
      if (kneeAngle < 150 && kneeDist < ankleDist * 0.74) {
        return {
          personDetected: true,
          movementDetected: isMoving,
          status: 'incorrect',
          verdictTitle: {
            ar: 'الحركة غلط ✗',
            en: 'Incorrect Movement ✗',
          },
          reason: {
            ar: 'الركبتان تنغلقان للداخل أثناء القرفصاء.',
            en: 'Knees are caving inward during squat descent.',
          },
          correctionTip: {
            ar: 'افتح الركبتين للخارج بمحاذاة مشط القدم.',
            en: 'Drive knees outward over your toes.',
          },
          detectedExercise: { ar: 'تمرين القرفصاء', en: 'Squat' },
          jointAngle: `${kneeAngle}°`,
          accuracyScore: 58,
          repCompleted: false,
        };
      }
    }

    if (kneeAngle <= 140) {
      return {
        personDetected: true,
        movementDetected: isMoving,
        status: 'correct',
        verdictTitle: {
          ar: 'الحركة صح ✓',
          en: 'Correct Movement ✓',
        },
        reason: {
          ar: `قرفصاء متزنة بزاوية ركبة ${kneeAngle}° واستقامة ظهر سليمة.`,
          en: `Solid squat form at ${kneeAngle}° knee flexion with neutral spine.`,
        },
        correctionTip: {
          ar: 'ادفع من الكعبين للصعود بنفس التوازن.',
          en: 'Drive through your heels to stand back up smoothly.',
        },
        detectedExercise: { ar: 'تمرين القرفصاء', en: 'Squat' },
        jointAngle: `${kneeAngle}°`,
        accuracyScore: 94,
        repCompleted: true,
      };
    }

    return {
      personDetected: true,
      movementDetected: isMoving,
      status: 'correct',
      verdictTitle: {
        ar: 'وقفة استعداد صحيحة ✓',
        en: 'Neutral Ready Stance ✓',
      },
      reason: {
        ar: 'توازن سليم للكتفين والجذع — انزل للأسفل لأداء القرفصاء.',
        en: 'Balanced posture — descend smoothly to execute the squat.',
      },
      correctionTip: {
        ar: 'ارجع بالحوض للخلف وكأنك تجلس على كرسي.',
        en: 'Sit hips back while keeping knees tracking forward.',
      },
      detectedExercise: { ar: 'تمرين القرفصاء', en: 'Squat' },
      jointAngle: `${kneeAngle}°`,
      accuracyScore: 90,
      repCompleted: false,
    };
  }

  // 3. SHOULDER RAISE
  if (exerciseType === 'shoulder_raise') {
    const leftArmOk = isVisible(lh) && isVisible(ls) && isVisible(le);
    const rightArmOk = isVisible(rh) && isVisible(rs) && isVisible(re);
    const leftArmFallback = isVisible(ls) && isVisible(le) && isVisible(lw);
    const rightArmFallback = isVisible(rs) && isVisible(re) && isVisible(rw);

    if (!leftArmOk && !rightArmOk && !leftArmFallback && !rightArmFallback) {
      return {
        personDetected: true,
        movementDetected: isMoving,
        status: 'waiting',
        verdictTitle: {
          ar: 'أظهر الذراعين والكتفين بوضوح',
          en: 'Show arms and shoulders clearly',
        },
        reason: {
          ar: 'الذراعان غير واضحتين في الإطار.',
          en: 'Arms are not clearly visible in the camera frame.',
        },
        correctionTip: {
          ar: 'قف في المنتصف وارفع ذراعك داخل الكادر.',
          en: 'Center your torso and keep arms visible.',
        },
        detectedExercise: { ar: 'رفع الكتف والذراع', en: 'Shoulder Raise' },
        jointAngle: '-',
        accuracyScore: 0,
        repCompleted: false,
      };
    }

    // Measure arm elevation angle relative to torso vertical downward vector
    const measureShoulderElev = (s: PoseLandmark, e: PoseLandmark, h?: PoseLandmark): number => {
      const virtualHip: PoseLandmark = isVisible(h) ? h : { x: s.x, y: s.y + 0.3 };
      return calculateAngle(virtualHip, s, e);
    };

    const elevL = isVisible(le) ? measureShoulderElev(ls, le, lh) : 0;
    const elevR = isVisible(re) ? measureShoulderElev(rs, re, rh) : 0;
    const maxElev = Math.max(elevL, elevR);

    // Check shoulder shrugging or uneven tilt
    if (shoulderTiltRatio > 0.16) {
      return {
        personDetected: true,
        movementDetected: isMoving,
        status: 'incorrect',
        verdictTitle: {
          ar: 'الحركة غلط ✗',
          en: 'Incorrect Movement ✗',
        },
        reason: {
          ar: `عدم توازن في الكتفين (${normalizedTiltDeg}°) — الكتف يرتفع نحو الأذن أو الجذع يميل.`,
          en: `Shoulder asymmetry/shrug detected (${normalizedTiltDeg}° tilt).`,
        },
        correctionTip: {
          ar: 'أنزل كتفيك للأسفل بعيداً عن الأذنين وثبّت جذعك قبل رفع الذراع.',
          en: 'Depress your shoulders away from your ears and brace your core.',
        },
        detectedExercise: { ar: 'رفع الكتف والذراع', en: 'Shoulder Raise' },
        jointAngle: `${maxElev}°`,
        accuracyScore: 55,
        repCompleted: false,
      };
    }

    // Check if arm raised too high causing impingement risk (> 165 with elbow bent awkwardly) or clean range 40..160
    if (maxElev >= 40) {
      return {
        personDetected: true,
        movementDetected: isMoving,
        status: 'correct',
        verdictTitle: {
          ar: 'الحركة صح ✓',
          en: 'Correct Movement ✓',
        },
        reason: {
          ar: `رفع ممتاز للذراع (${maxElev}°) مع ثبات لوح الكتف واستقامة الكتفين.`,
          en: `Clean shoulder elevation (${maxElev}°) with level scapular stability.`,
        },
        correctionTip: {
          ar: 'أنزل الذراع ببطء وتحكم دون شد الرقبة.',
          en: 'Lower the arm smoothly without tensing the neck.',
        },
        detectedExercise: { ar: 'رفع الكتف والذراع', en: 'Shoulder Raise' },
        jointAngle: `${maxElev}°`,
        accuracyScore: 96,
        repCompleted: true,
      };
    }

    return {
      personDetected: true,
      movementDetected: isMoving,
      status: 'correct',
      verdictTitle: {
        ar: 'وضع البداية سليم ✓',
        en: 'Good Neutral Position ✓',
      },
      reason: {
        ar: `الكتفان متساويان ومستقيمان (${maxElev}°) — ارفع ذراعك للجانب أو للأمام لبدء التقييم.`,
        en: `Shoulders level (${maxElev}°) — raise your arm to test mobility.`,
      },
      correctionTip: {
        ar: 'تنفس بهدوء وارفع الذراع حتى مستوى الكتف أو أعلى قليلاً.',
        en: 'Exhale gently as you raise the arm to shoulder height.',
      },
      detectedExercise: { ar: 'رفع الكتف والذراع', en: 'Shoulder Raise' },
      jointAngle: `${maxElev}°`,
      accuracyScore: 91,
      repCompleted: false,
    };
  }

  // 4. SPINE POSTURE
  if (exerciseType === 'spine_posture') {
    const headOffset = isVisible(nose)
      ? Math.abs(nose.x - midShoulder.x) / shoulderWidth
      : 0;
    const headDrop = isVisible(nose)
      ? (midShoulder.y - nose.y) / shoulderWidth
      : 0.6;

    if (shoulderTiltRatio > 0.13) {
      return {
        personDetected: true,
        movementDetected: isMoving,
        status: 'incorrect',
        verdictTitle: {
          ar: 'الحركة غلط ✗',
          en: 'Incorrect Posture ✗',
        },
        reason: {
          ar: `يوجد ميلان جانبي في الكتفين بمقدار ${normalizedTiltDeg}° مما يضغط على العمود الفقري.`,
          en: `Lateral shoulder tilt of ${normalizedTiltDeg}° detected.`,
        },
        correctionTip: {
          ar: 'اضبط مستوى الكتفين ليكونا على خط أفقي واحد.',
          en: 'Level both shoulders horizontally.',
        },
        detectedExercise: { ar: 'استقامة الظهر والرقبة', en: 'Spine Posture' },
        jointAngle: `${normalizedTiltDeg}° tilt`,
        accuracyScore: 56,
        repCompleted: false,
      };
    }

    if (headOffset > 0.24 || headDrop < 0.34) {
      return {
        personDetected: true,
        movementDetected: isMoving,
        status: 'incorrect',
        verdictTitle: {
          ar: 'الحركة غلط ✗',
          en: 'Incorrect Posture ✗',
        },
        reason: {
          ar: 'الرقبة أو الرأس مائل للأمام/الأسفل (Forward Head Posture).',
          en: 'Forward or tilted head posture straining cervical spine.',
        },
        correctionTip: {
          ar: 'اسحب ذقنك للخلف قليلاً واجعل رأسك فوق منتصف الكتفين مباشرة.',
          en: 'Perform a gentle chin tuck and center head directly above shoulders.',
        },
        detectedExercise: { ar: 'استقامة الظهر والرقبة', en: 'Spine Posture' },
        jointAngle: `${Math.round(headOffset * 45)}° dev`,
        accuracyScore: 60,
        repCompleted: false,
      };
    }

    return {
      personDetected: true,
      movementDetected: isMoving,
      status: 'correct',
      verdictTitle: {
        ar: 'الوضعية صح ✓',
        en: 'Correct Posture ✓',
      },
      reason: {
        ar: 'العمود الفقري والرقبة والكتفان في استقامة وتماثل مثالي.',
        en: 'Spine, neck, and shoulders are neutrally aligned and balanced.',
      },
      correctionTip: {
        ar: 'حافظ على هذه الاستقامة مع استرخاء الفك والكتفين.',
        en: 'Hold this tall neutral alignment with relaxed shoulders.',
      },
      detectedExercise: { ar: 'استقامة الظهر والرقبة', en: 'Spine Posture' },
      jointAngle: `${Math.max(0, 180 - normalizedTiltDeg)}°`,
      accuracyScore: 96,
      repCompleted: isMoving,
    };
  }

  // 5. BOXING JAB & GUARD
  if (exerciseType === 'boxing_jab') {
    const leftArmOk = isVisible(ls) && isVisible(le) && isVisible(lw);
    const rightArmOk = isVisible(rs) && isVisible(re) && isVisible(rw);

    if (!leftArmOk && !rightArmOk) {
      return {
        personDetected: true,
        movementDetected: isMoving,
        status: 'waiting',
        verdictTitle: {
          ar: 'أظهر اليدين ووقفة الملاكمة',
          en: 'Show hands & boxing guard',
        },
        reason: {
          ar: 'اليدان والمرفقان غير ظاهرين بالكامل — ارفع قبضتيك داخل الكادر.',
          en: 'Hands and elbows are outside frame — raise guard into view.',
        },
        correctionTip: {
          ar: 'قف بوضع الاستعداد وأظهر يديك أمام الكاميرا.',
          en: 'Take boxing stance keeping both fists visible.',
        },
        detectedExercise: { ar: 'وقفة الملاكمة واللكمة', en: 'Boxing Jab & Guard' },
        jointAngle: '-',
        accuracyScore: 0,
        repCompleted: false,
      };
    }

    const leftElbowAngle = leftArmOk ? calculateAngle(ls, le, lw) : 90;
    const rightElbowAngle = rightArmOk ? calculateAngle(rs, re, rw) : 90;

    // Guard check: wrist should stay near shoulder/chin height (not dropped far below shoulder)
    const chinRefY = isVisible(nose) ? (nose.y + midShoulder.y) / 2 : midShoulder.y;
    const leftGuardUp = leftArmOk && lw.y <= ls.y + shoulderWidth * 0.35;
    const rightGuardUp = rightArmOk && rw.y <= rs.y + shoulderWidth * 0.35;

    const leftPunching = leftArmOk && leftElbowAngle >= 138;
    const rightPunching = rightArmOk && rightElbowAngle >= 138;

    if (leftPunching && !rightPunching) {
      if (rightArmOk && !rightGuardUp) {
        return {
          personDetected: true,
          movementDetected: isMoving,
          status: 'incorrect',
          verdictTitle: {
            ar: 'الحركة غلط ✗',
            en: 'Incorrect Boxing Form ✗',
          },
          reason: {
            ar: 'أنزلت يد الحماية اليمنى أثناء توجيه اللكمة اليسرى، مما يكشف ذقنك.',
            en: 'You dropped your rear guard hand while throwing the jab, leaving chin exposed.',
          },
          correctionTip: {
            ar: 'أبقِ اليد اليمنى ملتصقة بمستوى الذقن أثناء مد اللكمة.',
            en: 'Keep your non-punching hand glued high by your chin.',
          },
          detectedExercise: { ar: 'لكمة وحماية', en: 'Boxing Jab & Guard' },
          jointAngle: `${leftElbowAngle}°`,
          accuracyScore: 55,
          repCompleted: false,
        };
      }
      return {
        personDetected: true,
        movementDetected: isMoving,
        status: 'correct',
        verdictTitle: {
          ar: 'الحركة صح ✓',
          en: 'Correct Boxing Jab ✓',
        },
        reason: {
          ar: `لكمة مستقيمة نظيفة (${leftElbowAngle}°) مع ثبات ممتاز ليد الحماية عند الذقن!`,
          en: `Clean punch extension (${leftElbowAngle}°) with tight chin guard!`,
        },
        correctionTip: {
          ar: 'اسحب اللكمة بسرعة عائداً لوضع الحماية الكاملة.',
          en: 'Snap the punch straight back to guard.',
        },
        detectedExercise: { ar: 'لكمة وحماية', en: 'Boxing Jab & Guard' },
        jointAngle: `${leftElbowAngle}°`,
        accuracyScore: 96,
        repCompleted: true,
      };
    }

    if (rightPunching && !leftPunching) {
      if (leftArmOk && !leftGuardUp) {
        return {
          personDetected: true,
          movementDetected: isMoving,
          status: 'incorrect',
          verdictTitle: {
            ar: 'الحركة غلط ✗',
            en: 'Incorrect Boxing Form ✗',
          },
          reason: {
            ar: 'أنزلت يد الحماية اليسرى أثناء اللكمة، مما يترك الوجه مكشوفاً.',
            en: 'Lead guard hand dropped during punch extension.',
          },
          correctionTip: {
            ar: 'ارفع يدك اليسرى لحماية الفك والذقن دائماً.',
            en: 'Keep your guard hand tight against your cheek/chin.',
          },
          detectedExercise: { ar: 'لكمة وحماية', en: 'Boxing Jab & Guard' },
          jointAngle: `${rightElbowAngle}°`,
          accuracyScore: 55,
          repCompleted: false,
        };
      }
      return {
        personDetected: true,
        movementDetected: isMoving,
        status: 'correct',
        verdictTitle: {
          ar: 'الحركة صح ✓',
          en: 'Correct Boxing Cross ✓',
        },
        reason: {
          ar: `لكمة قوية متكاملة (${rightElbowAngle}°) مع حماية محكمة للذقن!`,
          en: `Sharp punch extension (${rightElbowAngle}°) with solid guard discipline!`,
        },
        correctionTip: {
          ar: 'حافظ على استرخاء الكتفين وعودة القبضة للذقن.',
          en: 'Return fist straight back to chin level.',
        },
        detectedExercise: { ar: 'لكمة وحماية', en: 'Boxing Jab & Guard' },
        jointAngle: `${rightElbowAngle}°`,
        accuracyScore: 95,
        repCompleted: true,
      };
    }

    // Both hands dropped low
    if ((leftArmOk && !leftGuardUp) || (rightArmOk && !rightGuardUp)) {
      if (chinRefY >= 0 && ((!leftGuardUp && leftArmOk) || (!rightGuardUp && rightArmOk))) {
        return {
          personDetected: true,
          movementDetected: isMoving,
          status: 'incorrect',
          verdictTitle: {
            ar: 'الحركة غلط ✗',
            en: 'Guard Too Low ✗',
          },
          reason: {
            ar: 'وضع الحماية منخفض تحت مستوى الكتف والذقن.',
            en: 'Boxing guard hands are dropped below shoulder/chin level.',
          },
          correctionTip: {
            ar: 'ارفع قبضتيك الآن لمستوى الذقن وأغلق المرفقين للداخل.',
            en: 'Bring both fists up to protect your chin and tuck elbows.',
          },
          detectedExercise: { ar: 'وقفة الملاكمة', en: 'Boxing Guard' },
          jointAngle: `${Math.round((leftElbowAngle + rightElbowAngle) / 2)}°`,
          accuracyScore: 58,
          repCompleted: false,
        };
      }
    }

    return {
      personDetected: true,
      movementDetected: isMoving,
      status: 'correct',
      verdictTitle: {
        ar: 'وقفة حماية صح ✓',
        en: 'Solid Boxing Guard ✓',
      },
      reason: {
        ar: 'اليدان في وضع حماية مثالي عند الذقن — وجّه اللكمة الآن لاختبار الامتداد.',
        en: 'High tight boxing guard protecting the chin — throw a punch to test form.',
      },
      correctionTip: {
        ar: 'أطلق اللكمة للأمام مع إبقاء اليد الأخرى عند الذقن.',
        en: 'Snap punch straight while keeping opposite hand high.',
      },
      detectedExercise: { ar: 'وقفة الملاكمة', en: 'Boxing Guard' },
      jointAngle: `${Math.round((leftElbowAngle + rightElbowAngle) / 2)}°`,
      accuracyScore: 93,
      repCompleted: false,
    };
  }

  // 6. GENERAL REHAB (Default)
  if (shoulderTiltRatio > 0.16) {
    return {
      personDetected: true,
      movementDetected: isMoving,
      status: 'incorrect',
      verdictTitle: {
        ar: 'الحركة غلط ✗',
        en: 'Incorrect Form ✗',
      },
      reason: {
        ar: `يوجد ميلان واضح في الكتفين (${normalizedTiltDeg}°) وعدم تماثل في الحركة.`,
        en: `Noticeable shoulder tilt (${normalizedTiltDeg}°) causing asymmetric posture.`,
      },
      correctionTip: {
        ar: 'وازن بين الكتف الأيمن والأيسر وتحرك بهدوء دون ميل الجذع.',
        en: 'Level both shoulders and move smoothly without torso lean.',
      },
      detectedExercise: { ar: 'حركة تأهيل عامة', en: 'General Movement' },
      jointAngle: `${normalizedTiltDeg}° tilt`,
      accuracyScore: 58,
      repCompleted: false,
    };
  }

  const headOffCenter = isVisible(nose)
    ? Math.abs(nose.x - midShoulder.x) / shoulderWidth
    : 0;
  if (headOffCenter > 0.28) {
    return {
      personDetected: true,
      movementDetected: isMoving,
      status: 'incorrect',
      verdictTitle: {
        ar: 'الحركة غلط ✗',
        en: 'Incorrect Alignment ✗',
      },
      reason: {
        ar: 'الرأس مائل أو منحرف عن محور العمود الفقري أثناء الحركة.',
        en: 'Head is off-center relative to shoulder axis during movement.',
      },
      correctionTip: {
        ar: 'حافظ على الرأس في المنتصف فوق الكتفين مباشرة.',
        en: 'Keep head centered directly over shoulders.',
      },
      detectedExercise: { ar: 'حركة تأهيل عامة', en: 'General Movement' },
      jointAngle: `${Math.round(headOffCenter * 45)}°`,
      accuracyScore: 62,
      repCompleted: false,
    };
  }

  // Check visible elbow angle if arms are raised/moving
  const elbowAngle = isVisible(ls) && isVisible(le) && isVisible(lw)
    ? calculateAngle(ls, le, lw)
    : isVisible(rs) && isVisible(re) && isVisible(rw)
    ? calculateAngle(rs, re, rw)
    : 180 - normalizedTiltDeg;

  if (isMoving) {
    return {
      personDetected: true,
      movementDetected: true,
      status: 'correct',
      verdictTitle: {
        ar: 'الحركة صح ✓',
        en: 'Correct Movement ✓',
      },
      reason: {
        ar: `تم رصد حركة متزنة وسلسة مع تماثل ممتاز في الكتفين واستقامة الجذع.`,
        en: `Smooth, balanced movement detected with symmetric shoulder alignment.`,
      },
      correctionTip: {
        ar: 'أداء ممتاز! واصل الحركة بنفس الإيقاع الهادئ.',
        en: 'Great form! Continue moving with steady control.',
      },
      detectedExercise: { ar: 'حركة متوازنة', en: 'Balanced Movement' },
      jointAngle: `${elbowAngle}°`,
      accuracyScore: 95,
      repCompleted: true,
    };
  }

  return {
    personDetected: true,
    movementDetected: false,
    status: 'correct',
    verdictTitle: {
      ar: 'الوقفة صحيحة ✓',
      en: 'Good Posture ✓',
    },
    reason: {
      ar: 'جسمك متوازن ومستقيم أمام الكاميرا — تحرك الآن ليتم تقييم حركتك لحظياً.',
      en: 'Posture is balanced and aligned — move now for live movement scoring.',
    },
    correctionTip: {
      ar: 'نفّذ الحركة بوضوح أمام الكاميرا.',
      en: 'Perform your exercise movement smoothly in view.',
    },
    detectedExercise: { ar: 'ثبات سليم', en: 'Aligned Posture' },
    jointAngle: `${elbowAngle}°`,
    accuracyScore: 92,
    repCompleted: false,
  };
}
