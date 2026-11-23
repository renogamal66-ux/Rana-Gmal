import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

// Body parser with 25MB limit to allow high-res patient physiotherapy photos
app.use(express.json({ limit: '25mb' }));

// Initialize GoogleGenAI SDK on server-side with required User-Agent header
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

// Helper to convert any image source (base64, disk path, or URL) into clean base64 & mimeType
async function resolveImageSource(rawInput: string, fallbackMime: string = 'image/jpeg'): Promise<{ base64Data: string; mimeType: string }> {
  // Case 1: Data URL
  if (rawInput.startsWith('data:image/')) {
    const mimeMatch = rawInput.match(/^data:(image\/[a-zA-Z0-9.-]+);base64,/);
    const mime = mimeMatch ? mimeMatch[1] : fallbackMime;
    const base64Data = rawInput.replace(/^data:image\/[a-zA-Z0-9.-]+;base64,/, '');
    return { base64Data, mimeType: mime };
  }

  // Case 2: Remote URL
  if (rawInput.startsWith('http://') || rawInput.startsWith('https://')) {
    const res = await fetch(rawInput);
    const buffer = await res.arrayBuffer();
    const contentType = res.headers.get('content-type') || fallbackMime;
    return {
      base64Data: Buffer.from(buffer).toString('base64'),
      mimeType: contentType,
    };
  }

  // Case 3: Local file path on disk (e.g. /src/assets/images/... or /assets/images/...)
  let targetPath = rawInput;
  if (targetPath.startsWith('/@fs/')) {
    targetPath = targetPath.replace('/@fs', '');
  } else if (targetPath.startsWith('/src/')) {
    targetPath = path.resolve(__dirname, targetPath.slice(1));
  } else if (targetPath.startsWith('/assets/')) {
    // Check in src/assets or dist/assets
    const inSrc = path.resolve(__dirname, 'src', targetPath.slice(1));
    const inDist = path.resolve(__dirname, 'dist', targetPath.slice(1));
    targetPath = fs.existsSync(inSrc) ? inSrc : inDist;
  } else if (!path.isAbsolute(targetPath)) {
    targetPath = path.resolve(__dirname, targetPath);
  }

  if (fs.existsSync(targetPath)) {
    const fileBuf = await fs.promises.readFile(targetPath);
    const ext = path.extname(targetPath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    return {
      base64Data: fileBuf.toString('base64'),
      mimeType: mime,
    };
  }

  // Case 4: Raw base64 string without data prefix
  return {
    base64Data: rawInput.replace(/\s/g, ''),
    mimeType: fallbackMime,
  };
}

// API Route: AI Physiotherapy & Musculoskeletal Biomechanics Image Analysis
app.post('/api/analyze-physio', async (req, res) => {
  try {
    const { imageBase64, mimeType = 'image/jpeg', patientNote, focusArea = 'general', lang = 'ar' } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: 'No image provided for physiotherapy analysis.' });
    }

    const { base64Data: cleanBase64, mimeType: resolvedMime } = await resolveImageSource(imageBase64, mimeType);

    const prompt = `You are a world-class Clinical Physiotherapy Specialist, Musculoskeletal Biomechanics Researcher, and Sports Kinesiologist collaborating with Rana Gamal (National Boxing Champion and Medical AI researcher).
Analyze the provided patient or clinical physiotherapy photo in detail.

Patient Context / Focus Area: ${focusArea || 'General Posture & Joint Biomechanics'}
Patient Notes: ${patientNote || 'Standard clinical screening for range of motion, symmetry, and rehabilitation.'}
Language Target: Both Arabic and English for bilingual display.

Perform a thorough kinesiological and anatomical assessment:
1. Identify the anatomical joint/posture shown (e.g. Knee flexion/extension, Lumbar/Cervical spine alignment, Shoulder abduction/impingement, Pelvic tilt, Kinetic chain posture).
2. Measure or estimate key joint angles, comparing to optimal anatomical normative baselines.
3. Assess kinetic symmetry and risk level (low, moderate, high).
4. Provide structured clinical observations detailing muscle tightness, compensatory postures, or load imbalances.
5. Provide 3-4 actionable, evidence-based physical therapy corrective exercises with sets, reps, and precise cues.
6. Provide an athletic/biomechanical performance correlation (how this affects kinetic power transfer, athletic resilience, or injury prevention).

Return STRICT JSON matching this exact structure:
{
  "assessmentTitle": {
    "ar": "عنوان التشخيص السريري باللغة العربية",
    "en": "Clinical Diagnosis Title in English"
  },
  "primaryCondition": {
    "ar": "الحالة الأساسية الملاحظة بالعربية",
    "en": "Primary observed condition in English"
  },
  "riskLevel": "low" | "moderate" | "high",
  "symmetryScore": 85,
  "biomechanicalAngles": [
    {
      "joint": "Knee Flexion (ثني الركبة)",
      "measuredAngle": "115°",
      "targetAngle": "135°",
      "status": "warning",
      "clinicalNote": "Mild deficit in terminal flexion due to hamstring and patellar tension."
    },
    {
      "joint": "Pelvic Alignment (محاذاة الحوض)",
      "measuredAngle": "8° anterior",
      "targetAngle": "5° - 10°",
      "status": "optimal",
      "clinicalNote": "Well balanced pelvic tilt maintaining neutral lumbar lordosis."
    }
  ],
  "clinicalObservations": [
    {
      "ar": "الملاحظة السريرية الأولى بالعربية",
      "en": "First clinical observation in English"
    },
    {
      "ar": "الملاحظة السريرية الثانية بالعربية",
      "en": "Second clinical observation in English"
    }
  ],
  "correctiveDrills": [
    {
      "name": {
        "ar": "اسم التمرين الأول بالعربية",
        "en": "First Exercise Name in English"
      },
      "setsReps": "3 مجموعات × 12 تكرار (أو 30 ثانية)",
      "description": {
        "ar": "طريقة الأداء بالتفصيل بالعربية",
        "en": "Step-by-step cue in English"
      },
      "cautionNote": {
        "ar": "تنبيه سريري هام",
        "en": "Clinical caution note"
      }
    }
  ],
  "athleticImpact": {
    "ar": "الأثر الحركي على الأداء الرياضي والملاكمة وثبات الجذع",
    "en": "Kinetic chain implication for combat sports and athletic performance"
  }
}`;

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: {
        parts: [
          {
            inlineData: {
              data: cleanBase64,
              mimeType: resolvedMime || mimeType,
            },
          },
          {
            text: prompt,
          },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    const responseText = response.text || '{}';
    let parsedResult;
    try {
      parsedResult = JSON.parse(responseText);
    } catch (parseError) {
      // Clean up backticks if any
      const cleaned = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
      parsedResult = JSON.parse(cleaned);
    }

    return res.json({
      success: true,
      analysis: parsedResult,
    });
  } catch (error: any) {
    console.error('Error analyzing physiotherapy image:', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to complete AI physiotherapy analysis.',
    });
  }
});

// API Route: Real-time Camera Movement Evaluation (Correct vs Incorrect Form)
app.post('/api/evaluate-movement', async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        success: false,
        error: 'GEMINI_API_KEY is not configured on the server.',
      });
    }

    const {
      currentFrameBase64,
      previousFrameBase64,
      exerciseType = 'general_rehab',
      motionIntensity = 0,
    } = req.body;

    if (!currentFrameBase64) {
      return res.status(400).json({
        success: false,
        error: 'No camera frame provided for movement evaluation.',
      });
    }

    const currentFrame = await resolveImageSource(currentFrameBase64, 'image/jpeg');
    const parts: any[] = [];

    if (previousFrameBase64) {
      const prevFrame = await resolveImageSource(previousFrameBase64, 'image/jpeg');
      parts.push({
        inlineData: {
          data: prevFrame.base64Data,
          mimeType: prevFrame.mimeType || 'image/jpeg',
        },
      });
    }

    parts.push({
      inlineData: {
        data: currentFrame.base64Data,
        mimeType: currentFrame.mimeType || 'image/jpeg',
      },
    });

    const exerciseGuidelines: Record<string, string> = {
      knee_flexion:
        'Knee Flexion / Squat Rehab: Evaluate knee tracking over toes (no inward knee valgus collapse), controlled flexion angle, and stable upright torso.',
      squat:
        'Squat Form: Spine must stay neutral (not rounded forward), knees aligned with toes (no inward cave), weight balanced.',
      shoulder_raise:
        'Shoulder Abduction / Arm Raise: Shoulders should stay down and away from ears (no shrugging), torso upright without side-leaning, symmetrical elevation.',
      spine_posture:
        'Spine & Neck Posture: Head stacked neutrally over shoulders (no forward head jutting), shoulders level, thoracic spine upright without hunching.',
      boxing_jab:
        'Boxing Guard & Punch: Non-punching guard hand must stay high protecting the chin/jaw, shoulder rotates into the punch, chin tucked, balanced posture.',
      general_rehab:
        'General Physiotherapy & Athletic Movement: Evaluate body alignment, joint stability, symmetry, and whether the posture/movement is safe and biomechanically sound.',
    };

    const selectedGuide = exerciseGuidelines[exerciseType] || exerciseGuidelines.general_rehab;

    const promptText = `You are a real-time Clinical Physiotherapy & Sports Biomechanics Movement Judge.
${previousFrameBase64 ? 'You are given TWO consecutive live camera frames: Frame 1 (earlier) and Frame 2 (current) showing the user in motion.' : 'You are given a live camera frame of the user.'}
On-device motion sensor intensity between frames: ${Math.round(motionIntensity)}%.
Target exercise / posture standard: ${selectedGuide}

Your job is to immediately judge whether the user's movement/posture is CORRECT ("صح") or INCORRECT ("غلط"):
1. First check if a person or body part (face/torso/arms/legs) is clearly visible in the current frame. If NO person is visible or the camera is blocked/blank, set personDetected=false and status="waiting".
2. If a person is visible:
   - Compare Frame 1 and Frame 2 (if both provided) and inspect the posture/joint alignment in Frame 2.
   - Set status="correct" if the form/movement follows safe biomechanical alignment for the selected exercise.
   - Set status="incorrect" if there is a clear form flaw (e.g., hunched back, forward head tilt, shoulder shrugging, dropped boxing guard, knee valgus, asymmetrical lean, unsafe joint angle).
   - Provide concise, direct, natural Egyptian/Modern Standard Arabic and English feedback explaining WHY it is right or wrong and what to adjust immediately.
   - Estimate the key visible joint angle (e.g., "95°" or "172°" or "N/A" if not measurable) and an accuracyScore from 0 to 100.
   - Set repCompleted=true only if a clear motion/repetition occurred (motionIntensity >= 12) with status="correct".`;

    parts.push({ text: promptText });

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents: { parts },
      config: {
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            personDetected: { type: Type.BOOLEAN },
            movementDetected: { type: Type.BOOLEAN },
            status: {
              type: Type.STRING,
              description: 'Must be one of: correct, incorrect, waiting',
            },
            verdictTitle: {
              type: Type.OBJECT,
              properties: {
                ar: { type: Type.STRING },
                en: { type: Type.STRING },
              },
              required: ['ar', 'en'],
            },
            reason: {
              type: Type.OBJECT,
              properties: {
                ar: { type: Type.STRING },
                en: { type: Type.STRING },
              },
              required: ['ar', 'en'],
            },
            correctionTip: {
              type: Type.OBJECT,
              properties: {
                ar: { type: Type.STRING },
                en: { type: Type.STRING },
              },
              required: ['ar', 'en'],
            },
            detectedExercise: {
              type: Type.OBJECT,
              properties: {
                ar: { type: Type.STRING },
                en: { type: Type.STRING },
              },
              required: ['ar', 'en'],
            },
            jointAngle: { type: Type.STRING },
            accuracyScore: { type: Type.INTEGER },
            repCompleted: { type: Type.BOOLEAN },
          },
          required: [
            'personDetected',
            'movementDetected',
            'status',
            'verdictTitle',
            'reason',
            'correctionTip',
            'detectedExercise',
            'jointAngle',
            'accuracyScore',
            'repCompleted',
          ],
        },
      },
    });

    const responseText = response.text || '{}';
    const parsed = JSON.parse(responseText);

    // Normalize status strictly to 'correct' | 'incorrect' | 'waiting'
    const normalizedStatus =
      parsed.status === 'correct' || parsed.status === 'incorrect' || parsed.status === 'waiting'
        ? parsed.status
        : parsed.personDetected
        ? 'correct'
        : 'waiting';

    return res.json({
      success: true,
      evaluation: {
        ...parsed,
        status: normalizedStatus,
      },
    });
  } catch (error: any) {
    console.error('Error evaluating live movement:', error);
    const rawMsg = String(error?.message || '');
    const isQuota = error?.status === 429 || rawMsg.includes('429') || rawMsg.includes('RESOURCE_EXHAUSTED');
    if (isQuota) {
      return res.status(429).json({
        success: false,
        error: 'تم استهلاك الحصة المجانية اليومية لطلب Gemini الإضافي. يستمر التحليل الفوري عبر الكاميرا محلياً بدون توقف.',
      });
    }
    return res.status(error?.status || 500).json({
      success: false,
      error: 'تعذر إتمام التحليل الإضافي عبر Gemini AI حالياً.',
    });
  }
});

// Vite Middleware integration for development vs static hosting in production
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, port: PORT, host: '0.0.0.0' },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Rana Gamal Portfolio server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});
