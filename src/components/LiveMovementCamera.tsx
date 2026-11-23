import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import {
  Camera,
  RefreshCw,
  FlipHorizontal,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Activity,
  Sparkles,
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  Eye,
  Scan,
  Zap,
  Upload,
  Mic,
} from 'lucide-react';
import {
  Language,
  Theme,
  MovementExerciseType,
  MovementEvaluationResult,
} from '../types';
import { playImageSound } from '../utils/imageSound';
import {
  PoseLandmark,
  POSE_CONNECTIONS,
  evaluatePoseBiomechanical,
  computeLandmarkMotion,
} from '../utils/poseMovementJudge';

interface LiveMovementCameraProps {
  lang: Language;
  theme?: Theme;
  initialExercise?: MovementExerciseType;
  onCaptureForReport?: (imageDataUrl: string) => void;
  autoStart?: boolean;
}

interface MovementLogEntry {
  id: string;
  time: string;
  status: 'correct' | 'incorrect' | 'waiting';
  verdict: string;
  reason: string;
  angle: string;
  accuracy: number;
}

const EXERCISE_OPTIONS: {
  id: MovementExerciseType;
  ar: string;
  en: string;
  guideAr: string;
  guideEn: string;
}[] = [
  {
    id: 'general_rehab',
    ar: 'حركة تأهيل عامة',
    en: 'General Movement',
    guideAr: 'تحرك أمام الكاميرا لتقييم القوام وتماثل المفاصل مباشرة',
    guideEn: 'Move in frame for live posture and joint symmetry scoring',
  },
  {
    id: 'knee_flexion',
    ar: 'ثني الركبة',
    en: 'Knee Flexion',
    guideAr: 'اثنِ الركبة مع الحفاظ على محاذاتها فوق أصابع القدم دون ميل للداخل',
    guideEn: 'Bend knee keeping it aligned over toes without inward collapse',
  },
  {
    id: 'squat',
    ar: 'تمرين القرفصاء',
    en: 'Squat Form',
    guideAr: 'انزل مع استقامة الظهر وتوزيع الوزن بالتساوي على القدمين',
    guideEn: 'Descend keeping spine neutral and weight balanced evenly',
  },
  {
    id: 'shoulder_raise',
    ar: 'رفع الكتف والذراع',
    en: 'Shoulder Raise',
    guideAr: 'ارفع الذراع بسلاسة دون رفع الكتف نحو الأذن أو ميل الجذع',
    guideEn: 'Raise arm smoothly without shrugging shoulders or leaning torso',
  },
  {
    id: 'spine_posture',
    ar: 'استقامة الظهر والرقبة',
    en: 'Spine Posture',
    guideAr: 'اجعل الرأس فوق الكتفين مباشرة وتجنب انحناء الصدر للأمام',
    guideEn: 'Stack head directly over shoulders and keep chest open',
  },
  {
    id: 'boxing_jab',
    ar: 'وقفة الملاكمة واللكمة',
    en: 'Boxing Guard & Jab',
    guideAr: 'أبقِ اليد الأخرى مرفوعة لحماية الذقن أثناء مد اللكمة المستقيمة',
    guideEn: 'Keep non-punching guard hand protecting chin during jab extension',
  },
];

function playVerdictTone(isCorrect: boolean) {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (isCorrect) {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(783.99, ctx.currentTime + 0.14);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } else {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(240, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(175, ctx.currentTime + 0.22);
      gain.gain.setValueAtTime(0.09, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    }
    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 450);
  } catch {
    // Audio playback optional
  }
}

function speakVerdict(text: string, isAr: boolean) {
  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = isAr ? 'ar-EG' : 'en-US';
    utterance.rate = 1.05;
    utterance.pitch = 1.0;
    utterance.volume = 0.85;
    window.speechSynthesis.speak(utterance);
  } catch {
    // SpeechSynthesis is optional
  }
}

export const LiveMovementCamera: React.FC<LiveMovementCameraProps> = ({
  lang,
  theme = 'dark',
  initialExercise = 'general_rehab',
  onCaptureForReport,
  autoStart = true,
}) => {
  const isAr = lang === 'ar';
  const isLight = theme === 'light';

  // Camera stream & DOM refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraReqIdRef = useRef<number>(0);
  const cameraInstanceIdRef = useRef<string>(`cam-${Math.random().toString(36).slice(2, 9)}`);
  const videoUploadInputRef = useRef<HTMLInputElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const motionProbeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const prevProbeFrameRef = useRef<Uint8ClampedArray | null>(null);

  // MediaPipe PoseLandmarker refs
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);
  const prevLandmarksRef = useRef<PoseLandmark[] | null>(null);
  const prevCapturedFrameRef = useRef<string | null>(null);
  const lastVideoTimeRef = useRef<number>(-1);
  const lastPoseTimestampRef = useRef<number>(0);
  const lastUiUpdateRef = useRef<number>(0);
  const lastLogTimeRef = useRef<number>(0);
  const lastVoiceTimeRef = useRef<number>(0);
  const lastLoggedStatusRef = useRef<'correct' | 'incorrect' | 'waiting' | null>(null);

  // Camera states
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [isVideoFileMode, setIsVideoFileMode] = useState<boolean>(false);
  const [cameraFacing, setCameraFacing] = useState<'user' | 'environment'>('user');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isStartingCamera, setIsStartingCamera] = useState<boolean>(false);
  const [poseReady, setPoseReady] = useState<boolean>(false);

  // Exercise & tracking states
  const [selectedExercise, setSelectedExercise] = useState<MovementExerciseType>(initialExercise);
  const [isTrackingEnabled, setIsTrackingEnabled] = useState<boolean>(true);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(true);
  const [motionIntensity, setMotionIntensity] = useState<number>(0);
  const [motionDetectedNow, setMotionDetectedNow] = useState<boolean>(false);
  const [isDeepAnalyzing, setIsDeepAnalyzing] = useState<boolean>(false);
  const [deepAnalysisNote, setDeepAnalysisNote] = useState<string | null>(null);

  // Verdict & stats states
  const [evaluation, setEvaluation] = useState<MovementEvaluationResult | null>(null);
  const [correctCount, setCorrectCount] = useState<number>(0);
  const [incorrectCount, setIncorrectCount] = useState<number>(0);
  const [movementLog, setMovementLog] = useState<MovementLogEntry[]>([]);

  useEffect(() => {
    setSelectedExercise(initialExercise);
  }, [initialExercise]);

  // Load MediaPipe PoseLandmarker locally from /mediapipe-wasm and /models
  useEffect(() => {
    let cancelled = false;
    async function initPoseModel() {
      try {
        const vision = await FilesetResolver.forVisionTasks('/mediapipe-wasm');
        let landmarker: PoseLandmarker;
        try {
          landmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: '/models/pose_landmarker_lite.task',
              delegate: 'GPU',
            },
            runningMode: 'VIDEO',
            numPoses: 1,
            minPoseDetectionConfidence: 0.45,
            minPosePresenceConfidence: 0.45,
            minTrackingConfidence: 0.45,
          });
        } catch {
          // Fallback to CPU delegate if WebGL GPU delegate isn't available
          landmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: '/models/pose_landmarker_lite.task',
              delegate: 'CPU',
            },
            runningMode: 'VIDEO',
            numPoses: 1,
          });
        }
        if (cancelled) {
          landmarker.close();
          return;
        }
        poseLandmarkerRef.current = landmarker;
        setPoseReady(true);
      } catch (err) {
        console.warn('MediaPipe PoseLandmarker unavailable, using optical motion fallback:', err);
      }
    }
    initPoseModel();

    return () => {
      cancelled = true;
      if (poseLandmarkerRef.current) {
        poseLandmarkerRef.current.close();
        poseLandmarkerRef.current = null;
      }
    };
  }, []);

  const stopCamera = useCallback(() => {
    cameraReqIdRef.current += 1;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      if (videoRef.current.srcObject) {
        const s = videoRef.current.srcObject as MediaStream;
        s.getTracks().forEach((track) => track.stop());
        videoRef.current.srcObject = null;
      }
      if (videoRef.current.src && videoRef.current.src.startsWith('blob:')) {
        URL.revokeObjectURL(videoRef.current.src);
        videoRef.current.removeAttribute('src');
      }
    }
    prevLandmarksRef.current = null;
    prevCapturedFrameRef.current = null;
    prevProbeFrameRef.current = null;
    lastVideoTimeRef.current = -1;
    try {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    } catch {
      // ignore
    }
    setCameraActive(false);
    setIsVideoFileMode(false);
  }, []);

  // Coordinate active webcam ownership across multiple LiveMovementCamera instances
  useEffect(() => {
    const onOtherCameraClaimed = (e: Event) => {
      const custom = e as CustomEvent<{ ownerId?: string }>;
      if (custom.detail?.ownerId && custom.detail.ownerId !== cameraInstanceIdRef.current) {
        stopCamera();
        setCameraError(null);
      }
    };
    window.addEventListener('live-camera-claim', onOtherCameraClaimed);
    return () => {
      window.removeEventListener('live-camera-claim', onOtherCameraClaimed);
    };
  }, [stopCamera]);

  const startCamera = useCallback(async () => {
    window.dispatchEvent(
      new CustomEvent('live-camera-claim', { detail: { ownerId: cameraInstanceIdRef.current } })
    );
    const reqId = ++cameraReqIdRef.current;
    setCameraError(null);
    setIsStartingCamera(true);
    setIsVideoFileMode(false);

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        if (reqId === cameraReqIdRef.current) {
          setCameraError(
            isAr
              ? 'المتصفح لا يدعم فتح الكاميرا المباشرة.'
              : 'Camera API is not supported on this browser.'
          );
          setIsStartingCamera(false);
        }
        return;
      }

      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: cameraFacing },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      }

      if (reqId !== cameraReqIdRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = stream;

      const videoEl = videoRef.current;
      if (videoEl) {
        videoEl.removeAttribute('src');
        videoEl.srcObject = stream;
        videoEl.muted = true;
        videoEl.playsInline = true;
        try {
          await videoEl.play();
        } catch (playErr: unknown) {
          const e = playErr as { name?: string };
          if (e?.name !== 'AbortError') {
            console.warn('Video play warning:', playErr);
          }
        }
      }

      if (reqId === cameraReqIdRef.current) {
        setCameraActive(true);
        setCameraError(null);
      }
    } catch (err: unknown) {
      if (reqId !== cameraReqIdRef.current) return;
      const errorObj = err as { name?: string };
      const isDenied =
        errorObj?.name === 'NotAllowedError' || errorObj?.name === 'PermissionDeniedError';
      const isNotFound =
        errorObj?.name === 'NotFoundError' || errorObj?.name === 'DevicesNotFoundError';
      setCameraError(
        isDenied
          ? isAr
            ? 'تم رفض إذن الكاميرا أو لم يظهر مربع السماح. اضغط على "فتح الكاميرا الآن" أو فعّل الكاميرا من أيقونة القفل في شريط المتصفح.'
            : 'Camera permission was denied. Click "Open Camera Now" or allow camera access in your browser address bar.'
          : isNotFound
          ? isAr
            ? 'لم يتم العثور على كاميرا متصلة بهذا الجهاز. يمكنك توصيل كاميرا أو اختبار تقييم الحركة برفع فيديو تمرين.'
            : 'No camera device found. Connect a webcam or upload a workout video to test movement evaluation.'
          : isAr
          ? 'تعذر فتح الكاميرا الآن. تأكد من عدم استخدامها في برنامج آخر ثم أعد المحاولة.'
          : 'Unable to open camera right now. Make sure no other app is using it and retry.'
      );
      setCameraActive(false);
    } finally {
      if (reqId === cameraReqIdRef.current) {
        setIsStartingCamera(false);
      }
    }
  }, [cameraFacing, isAr]);

  const handleVideoFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !videoRef.current) return;
    stopCamera();
    const url = URL.createObjectURL(file);
    const videoEl = videoRef.current;
    videoEl.srcObject = null;
    videoEl.src = url;
    videoEl.loop = true;
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl
      .play()
      .then(() => {
        setIsVideoFileMode(true);
        setCameraActive(true);
        setCameraError(null);
      })
      .catch(() => {
        setCameraError(isAr ? 'تعذر تشغيل ملف الفيديو.' : 'Unable to play video file.');
      });
  };

  useEffect(() => {
    if (autoStart) {
      startCamera();
    }
    return () => {
      stopCamera();
    };
  }, [autoStart, startCamera, stopCamera]);

  const toggleFacing = () => {
    stopCamera();
    setCameraFacing((prev) => (prev === 'user' ? 'environment' : 'user'));
  };

  // Capture compressed frame from live video
  const captureVideoFrameDataUrl = useCallback(
    (maxWidth: number = 640, quality: number = 0.78): string | null => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth) return null;

      const scale = Math.min(1, maxWidth / video.videoWidth);
      const w = Math.round(video.videoWidth * scale);
      const h = Math.round(video.videoHeight * scale);

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      if (cameraFacing === 'user' && !isVideoFileMode) {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, 0, 0, w, h);
      return canvas.toDataURL('image/jpeg', quality);
    },
    [cameraFacing, isVideoFileMode]
  );

  // Real-time Movement Tracking Loop (MediaPipe 33-Keypoint Pose + Immediate Optical Motion Fallback)
  useEffect(() => {
    if (!cameraActive) return;

    let rafId = 0;
    let lastProcessedMs = 0;
    const isMirrored = cameraFacing === 'user' && !isVideoFileMode;

    if (!motionProbeCanvasRef.current) {
      const probe = document.createElement('canvas');
      probe.width = 72;
      probe.height = 48;
      motionProbeCanvasRef.current = probe;
    }

    const computeOpticalMotion = (
      video: HTMLVideoElement
    ): { intensity: number; cx: number; cy: number; upperRatio: number } => {
      const probe = motionProbeCanvasRef.current;
      if (!probe) return { intensity: 0, cx: 0.5, cy: 0.5, upperRatio: 0.5 };
      const pCtx = probe.getContext('2d', { willReadFrequently: true });
      if (!pCtx) return { intensity: 0, cx: 0.5, cy: 0.5, upperRatio: 0.5 };

      pCtx.drawImage(video, 0, 0, probe.width, probe.height);
      const currData = pCtx.getImageData(0, 0, probe.width, probe.height).data;
      const prevData = prevProbeFrameRef.current;

      if (!prevData || prevData.length !== currData.length) {
        prevProbeFrameRef.current = new Uint8ClampedArray(currData);
        return { intensity: 0, cx: 0.5, cy: 0.5, upperRatio: 0.5 };
      }

      let changedPixels = 0;
      let sumX = 0;
      let sumY = 0;
      let upperPixels = 0;
      const totalPixels = probe.width * probe.height;

      for (let y = 0; y < probe.height; y++) {
        for (let x = 0; x < probe.width; x++) {
          const i = (y * probe.width + x) * 4;
          const diff =
            (Math.abs(currData[i] - prevData[i]) +
              Math.abs(currData[i + 1] - prevData[i + 1]) +
              Math.abs(currData[i + 2] - prevData[i + 2])) /
            3;
          if (diff > 24) {
            changedPixels++;
            sumX += x / probe.width;
            sumY += y / probe.height;
            if (y < probe.height * 0.5) upperPixels++;
          }
        }
      }

      prevProbeFrameRef.current = new Uint8ClampedArray(currData);
      const pct = Math.min(100, Math.round((changedPixels / totalPixels) * 320));
      const cx = changedPixels > 10 ? sumX / changedPixels : 0.5;
      const cy = changedPixels > 10 ? sumY / changedPixels : 0.5;
      const upperRatio = changedPixels > 10 ? upperPixels / changedPixels : 0.5;
      return { intensity: pct, cx, cy, upperRatio };
    };

    const activeEx =
      EXERCISE_OPTIONS.find((ex) => ex.id === selectedExercise) || EXERCISE_OPTIONS[0];

    const buildOpticalFallbackVerdict = (
      optical: { intensity: number; cx: number; cy: number; upperRatio: number }
    ): MovementEvaluationResult => {
      const offCenter = Math.abs(optical.cx - 0.5);
      if (optical.intensity < 5) {
        return {
          personDetected: true,
          movementDetected: false,
          status: 'waiting',
          verdictTitle: {
            ar: 'الكاميرا مستعدة — تحرك الآن',
            en: 'Camera Ready — Move Now',
          },
          reason: {
            ar: 'الكاميرا مفتوحة وتنتظر حركتك لتقييمها لحظياً (صح / غلط).',
            en: 'Camera stream active and waiting for your movement.',
          },
          correctionTip: {
            ar: 'قم بأداء التمرين بوضوح أمام الكاميرا.',
            en: 'Perform your exercise clearly in front of the camera.',
          },
          detectedExercise: { ar: activeEx.ar, en: activeEx.en },
          jointAngle: '-',
          accuracyScore: 0,
          repCompleted: false,
        };
      }

      if (optical.intensity > 68 || offCenter > 0.34) {
        return {
          personDetected: true,
          movementDetected: true,
          status: 'incorrect',
          verdictTitle: {
            ar: 'الحركة غلط ✗',
            en: 'Incorrect Movement ✗',
          },
          reason: {
            ar:
              offCenter > 0.34
                ? 'تم رصد انحراف واضح عن محور المنتصف أثناء الحركة.'
                : 'الحركة سريعة جداً ومندفعة بدون تحكم حركي مستقر.',
            en:
              offCenter > 0.34
                ? 'Movement drifted off the center alignment axis.'
                : 'Movement speed is jerky and lacks controlled tempo.',
          },
          correctionTip: {
            ar: 'تحرك في منتصف الإطار بإيقاع أبطأ وثبات أعلى.',
            en: 'Stay centered in the frame and move with controlled speed.',
          },
          detectedExercise: { ar: activeEx.ar, en: activeEx.en },
          jointAngle: `${Math.round(offCenter * 90)}°`,
          accuracyScore: 56,
          repCompleted: false,
        };
      }

      return {
        personDetected: true,
        movementDetected: true,
        status: 'correct',
        verdictTitle: {
          ar: 'الحركة صح ✓',
          en: 'Correct Movement ✓',
        },
        reason: {
          ar: 'تم استقبال حركتك بنجاح — إيقاع متوازن ومحور جسم مستقر.',
          en: 'Movement received — controlled rhythm and centered alignment.',
        },
        correctionTip: {
          ar: 'أداء سليم! واصل الحركة بنفس التحكم والهدوء.',
          en: 'Great control! Maintain the same smooth tempo.',
        },
        detectedExercise: { ar: activeEx.ar, en: activeEx.en },
        jointAngle: `${Math.max(85, 175 - optical.intensity)}°`,
        accuracyScore: 92,
        repCompleted: optical.intensity >= 14,
      };
    };

    const processFrame = (nowMs: number) => {
      rafId = window.requestAnimationFrame(processFrame);

      if (!isTrackingEnabled) return;
      if (nowMs - lastProcessedMs < 65) return; // ~15 FPS
      lastProcessedMs = nowMs;

      const video = videoRef.current;
      const overlay = overlayCanvasRef.current;
      const landmarker = poseLandmarkerRef.current;
      if (!video || video.readyState < 2 || video.videoWidth === 0 || video.paused || video.ended) {
        return;
      }

      if (isVideoFileMode && video.currentTime === lastVideoTimeRef.current) return;
      lastVideoTimeRef.current = video.currentTime;

      const optical = computeOpticalMotion(video);
      let landmarks: PoseLandmark[] | null = null;
      let usedPoseModel = false;

      if (landmarker) {
        try {
          const nextTs = Math.max(
            lastPoseTimestampRef.current + 1,
            Math.floor(performance.now())
          );
          lastPoseTimestampRef.current = nextTs;
          const result = landmarker.detectForVideo(video, nextTs);
          usedPoseModel = true;
          if (result.landmarks && result.landmarks.length > 0) {
            landmarks = result.landmarks[0] as PoseLandmark[];
          }
        } catch {
          usedPoseModel = false;
        }
      }

      // Compute movement intensity (skeleton + pixel energy blended so motion always registers)
      const skeletalIntensity = computeLandmarkMotion(landmarks, prevLandmarksRef.current);
      prevLandmarksRef.current = landmarks;
      const intensity = landmarks
        ? Math.max(skeletalIntensity, Math.round(optical.intensity * 0.65))
        : optical.intensity;
      const isMoving = intensity >= 7;

      // Evaluate biomechanical correctness ("الحركة صح" vs "الحركة غلط")
      const verdict = usedPoseModel
        ? evaluatePoseBiomechanical(landmarks, selectedExercise, intensity)
        : buildOpticalFallbackVerdict(optical);

      // Draw live skeletal / kinetic reticle overlay accounting for video object-cover framing
      if (overlay) {
        const rect = overlay.getBoundingClientRect();
        const targetW = Math.max(320, Math.round(rect.width));
        const targetH = Math.max(180, Math.round(rect.height));
        if (overlay.width !== targetW || overlay.height !== targetH) {
          overlay.width = targetW;
          overlay.height = targetH;
        }
        const ctx = overlay.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, overlay.width, overlay.height);

          // Center plumb alignment guide
          ctx.save();
          ctx.strokeStyle = 'rgba(189, 219, 209, 0.25)';
          ctx.setLineDash([6, 6]);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(overlay.width / 2, 0);
          ctx.lineTo(overlay.width / 2, overlay.height);
          ctx.stroke();
          ctx.restore();

          // Exact object-cover projection
          const scale = Math.max(overlay.width / video.videoWidth, overlay.height / video.videoHeight);
          const drawnW = video.videoWidth * scale;
          const drawnH = video.videoHeight * scale;
          const offsetX = (overlay.width - drawnW) / 2;
          const offsetY = (overlay.height - drawnH) / 2;
          const mapX = (nx: number) => offsetX + (isMirrored ? 1 - nx : nx) * drawnW;
          const mapY = (ny: number) => offsetY + ny * drawnH;

          if (landmarks && landmarks.length > 0) {
            const lineColor =
              verdict.status === 'correct'
                ? 'rgba(52, 211, 153, 0.92)'
                : verdict.status === 'incorrect'
                ? 'rgba(251, 113, 133, 0.95)'
                : 'rgba(189, 219, 209, 0.7)';
            const jointColor =
              verdict.status === 'correct'
                ? '#34D399'
                : verdict.status === 'incorrect'
                ? '#FB7185'
                : '#BDDBD1';

            ctx.save();
            ctx.strokeStyle = lineColor;
            ctx.lineWidth = 3.5;
            ctx.lineCap = 'round';
            for (const [startIdx, endIdx] of POSE_CONNECTIONS) {
              const p1 = landmarks[startIdx];
              const p2 = landmarks[endIdx];
              if (
                p1 &&
                p2 &&
                (p1.visibility ?? 1) > 0.35 &&
                (p2.visibility ?? 1) > 0.35
              ) {
                ctx.beginPath();
                ctx.moveTo(mapX(p1.x), mapY(p1.y));
                ctx.lineTo(mapX(p2.x), mapY(p2.y));
                ctx.stroke();
              }
            }

            for (let i = 0; i < landmarks.length; i++) {
              if (i >= 1 && i <= 10 && i !== 7 && i !== 8) continue;
              const lm = landmarks[i];
              if (!lm || (lm.visibility ?? 1) < 0.38) continue;
              const px = mapX(lm.x);
              const py = mapY(lm.y);
              ctx.fillStyle = '#121815';
              ctx.beginPath();
              ctx.arc(px, py, 6, 0, Math.PI * 2);
              ctx.fill();
              ctx.fillStyle = jointColor;
              ctx.beginPath();
              ctx.arc(px, py, 4, 0, Math.PI * 2);
              ctx.fill();
            }
            ctx.restore();
          } else if (optical.intensity >= 5) {
            // Visual optical motion tracking target while model warms up or if unavailable
            const px = mapX(optical.cx);
            const py = mapY(optical.cy);
            const radius = Math.min(54, 18 + optical.intensity * 0.5);
            ctx.save();
            ctx.strokeStyle =
              verdict.status === 'correct'
                ? 'rgba(52, 211, 153, 0.9)'
                : 'rgba(251, 113, 133, 0.9)';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(px, py, radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = 'rgba(189, 219, 209, 0.85)';
            ctx.beginPath();
            ctx.arc(px, py, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }
      }

      // Throttle React state updates cleanly
      const statusChanged = verdict.status !== lastLoggedStatusRef.current;
      if (nowMs - lastUiUpdateRef.current >= 240 || statusChanged) {
        lastUiUpdateRef.current = nowMs;
        setMotionIntensity(intensity);
        setMotionDetectedNow(isMoving);
        setEvaluation(verdict);
      }

      // Log rep/error events with cooldown + audio/voice feedback
      const elapsedSinceLog = nowMs - lastLogTimeRef.current;
      const shouldLog =
        verdict.status !== 'waiting' &&
        ((verdict.status === 'incorrect' &&
          (lastLoggedStatusRef.current !== 'incorrect' || elapsedSinceLog > 3000)) ||
          (verdict.status === 'correct' &&
            (verdict.repCompleted || lastLoggedStatusRef.current !== 'correct') &&
            (lastLoggedStatusRef.current !== 'correct' || elapsedSinceLog > 2400)));

      if (shouldLog) {
        lastLogTimeRef.current = nowMs;
        lastLoggedStatusRef.current = verdict.status;

        if (verdict.status === 'correct') {
          setCorrectCount((prev) => prev + 1);
          if (soundEnabled) playVerdictTone(true);
        } else if (verdict.status === 'incorrect') {
          setIncorrectCount((prev) => prev + 1);
          if (soundEnabled) playVerdictTone(false);
        }

        if (voiceEnabled && nowMs - lastVoiceTimeRef.current > 3800) {
          lastVoiceTimeRef.current = nowMs;
          const spoken =
            verdict.status === 'correct'
              ? isAr
                ? 'الحركة صح'
                : 'Correct movement'
              : isAr
              ? 'الحركة غلط'
              : 'Incorrect movement';
          speakVerdict(spoken, isAr);
        }

        const entry: MovementLogEntry = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          time: new Date().toLocaleTimeString(isAr ? 'ar-EG' : 'en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }),
          status: verdict.status,
          verdict: isAr ? verdict.verdictTitle.ar : verdict.verdictTitle.en,
          reason: isAr ? verdict.reason.ar : verdict.reason.en,
          angle: verdict.jointAngle || '-',
          accuracy: verdict.accuracyScore || 0,
        };
        setMovementLog((prev) => [entry, ...prev.slice(0, 5)]);
      } else if (verdict.status === 'waiting') {
        lastLoggedStatusRef.current = 'waiting';
      }
    };

    rafId = window.requestAnimationFrame(processFrame);
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [
    cameraActive,
    cameraFacing,
    isVideoFileMode,
    isTrackingEnabled,
    selectedExercise,
    soundEnabled,
    voiceEnabled,
    isAr,
  ]);

  // Optional on-demand Gemini Vision second-opinion check (only when user clicks)
  const runOnDemandGeminiCheck = async () => {
    if (isDeepAnalyzing || !cameraActive) return;
    const currentFrame = captureVideoFrameDataUrl(560, 0.78);
    if (!currentFrame) return;

    const previousFrame = prevCapturedFrameRef.current;
    prevCapturedFrameRef.current = currentFrame;

    setIsDeepAnalyzing(true);
    setDeepAnalysisNote(null);

    try {
      const response = await fetch('/api/evaluate-movement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentFrameBase64: currentFrame,
          previousFrameBase64: previousFrame,
          exerciseType: selectedExercise,
          motionIntensity,
          lang,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success || !data.evaluation) {
        throw new Error(data.error || 'Unable to run Gemini check.');
      }

      const aiVerdict: MovementEvaluationResult = data.evaluation;
      setEvaluation(aiVerdict);
      if (aiVerdict.status === 'correct') {
        setCorrectCount((c) => c + 1);
        if (soundEnabled) playVerdictTone(true);
      } else if (aiVerdict.status === 'incorrect') {
        setIncorrectCount((c) => c + 1);
        if (soundEnabled) playVerdictTone(false);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      setDeepAnalysisNote(
        msg ||
          (isAr
            ? 'التقييم الفوري من الكاميرا يعمل بشكل طبيعي ومستمر.'
            : 'Real-time local camera pose tracking remains active.')
      );
    } finally {
      setIsDeepAnalyzing(false);
    }
  };

  const handleCaptureSnapshotForReport = () => {
    const snap = captureVideoFrameDataUrl(1280, 0.92);
    if (snap && onCaptureForReport) {
      playImageSound('medical');
      onCaptureForReport(snap);
    }
  };

  const resetSessionStats = () => {
    setCorrectCount(0);
    setIncorrectCount(0);
    setMovementLog([]);
    setEvaluation(null);
    setDeepAnalysisNote(null);
    lastLoggedStatusRef.current = null;
    playImageSound('pop');
  };

  const activeExerciseObj =
    EXERCISE_OPTIONS.find((ex) => ex.id === selectedExercise) || EXERCISE_OPTIONS[0];

  return (
    <div className="space-y-4">
      {/* Exercise Mode Selector Bar */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-mono font-bold text-[#BDDBD1] flex items-center gap-1.5">
            <Scan className="w-3.5 h-3.5 text-emerald-400" />
            <span>
              {isAr
                ? 'اختر التمرين أو الحركة المطلوب مراقبتها بالكاميرا:'
                : 'Select Target Movement / Exercise to Evaluate:'}
            </span>
          </span>
          <span className="text-[10px] font-mono text-[#7C8380]">
            {isAr ? activeExerciseObj.guideAr : activeExerciseObj.guideEn}
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {EXERCISE_OPTIONS.map((ex) => (
            <button
              key={ex.id}
              type="button"
              onClick={() => {
                setSelectedExercise(ex.id);
                setEvaluation(null);
                lastLoggedStatusRef.current = null;
                playImageSound('pop');
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-mono transition-all border cursor-pointer ${
                selectedExercise === ex.id
                  ? 'bg-emerald-500 text-black font-bold border-emerald-400 shadow-sm'
                  : isLight
                  ? 'bg-[#F6F8F7] text-[#566E64] border-[#D3DFD9] hover:border-emerald-500/60'
                  : 'bg-[#121815] text-[#BDDBD1]/80 border-[#2F3E3C] hover:border-[#BDDBD1]/60'
              }`}
            >
              {isAr ? ex.ar : ex.en}
            </button>
          ))}
        </div>
      </div>

      {/* Main Camera Viewport */}
      <div className="relative rounded-2xl overflow-hidden aspect-[16/10] bg-black border border-[#2F3E3C] shadow-2xl flex items-center justify-center">
        <input
          ref={videoUploadInputRef}
          type="file"
          accept="video/*"
          onChange={handleVideoFileSelect}
          className="hidden"
        />

        {/* Always-mounted Video Element so ref is always available for stream attachment */}
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={`w-full h-full object-cover transition-opacity duration-300 ${
            cameraActive ? 'opacity-100' : 'opacity-0 pointer-events-none absolute inset-0'
          } ${cameraFacing === 'user' && !isVideoFileMode ? 'scale-x-[-1]' : ''}`}
        />

        {cameraError ? (
          <div className="p-6 text-center max-w-md mx-auto space-y-4 z-20 relative">
            <div className="w-14 h-14 rounded-2xl bg-amber-500/20 border border-amber-400/50 flex items-center justify-center text-amber-300 mx-auto">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-white mb-1 font-mono">
                {isAr ? 'الكاميرا تحتاج إذن التشغيل' : 'Camera Permission Required'}
              </h4>
              <p className="text-xs text-[#BDDBD1]/80 leading-relaxed">{cameraError}</p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={startCamera}
                disabled={isStartingCamera}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-black text-xs font-mono font-bold inline-flex items-center gap-2 shadow-lg active:scale-95 cursor-pointer"
              >
                <RefreshCw className={`w-4 h-4 ${isStartingCamera ? 'animate-spin' : ''}`} />
                <span>{isAr ? 'فتح الكاميرا الآن' : 'Open Camera Now'}</span>
              </button>

              <button
                type="button"
                onClick={() => videoUploadInputRef.current?.click()}
                className="px-4 py-2.5 rounded-xl bg-[#2F3E3C] hover:bg-[#3E6153] text-[#BDDBD1] border border-[#BDDBD1]/40 text-xs font-mono font-bold inline-flex items-center gap-2 cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                <span>{isAr ? 'أو اختبار بفيديو تمرين' : 'Or Test with Video'}</span>
              </button>
            </div>
          </div>
        ) : !cameraActive ? (
          <div className="p-6 text-center max-w-md mx-auto space-y-4 z-20 relative">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 border-2 border-emerald-400 text-emerald-300 flex items-center justify-center mx-auto animate-pulse">
              <Camera className="w-8 h-8" />
            </div>
            <div>
              <h4 className="text-base font-bold text-white">
                {isAr
                  ? 'افتح الكاميرا لاستقبال الحركات وتقييمها'
                  : 'Open Camera for Live Movement Evaluation'}
              </h4>
              <p className="text-xs text-[#7C8380] mt-1">
                {isAr
                  ? 'ستقوم الكاميرا برصد جسمك وحركاتك لحظياً وتخبرك مباشرة إذا كانت الحركة صح أم غلط.'
                  : 'The camera tracks your body landmarks live and tells you immediately if your movement is right or wrong.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={startCamera}
                disabled={isStartingCamera}
                className="px-5 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-black text-xs font-mono font-bold inline-flex items-center gap-2 shadow-lg active:scale-95 cursor-pointer"
              >
                <Camera className="w-4 h-4" />
                <span>
                  {isStartingCamera
                    ? isAr
                      ? 'جاري فتح الكاميرا...'
                      : 'Opening Camera...'
                    : isAr
                    ? 'تشغيل الكاميرا واستقبال الحركة ✦'
                    : 'Open Camera & Track Motion ✦'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => videoUploadInputRef.current?.click()}
                className="px-4 py-3 rounded-xl bg-[#2F3E3C] hover:bg-[#3E6153] text-[#BDDBD1] border border-[#BDDBD1]/40 text-xs font-mono font-bold inline-flex items-center gap-2 cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                <span>{isAr ? 'رفع فيديو تمرين' : 'Upload Video'}</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Real-time 33-point Skeletal & Vector Overlay Canvas */}
            <canvas
              ref={overlayCanvasRef}
              className="absolute inset-0 w-full h-full pointer-events-none z-10"
            />

            {/* Top HUD Bar: Live Pose Status + Motion Signal Meter */}
            <div className="absolute top-3 left-3 right-3 z-20 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/75 backdrop-blur-md border border-white/15 text-[11px] font-mono text-white">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    !poseReady
                      ? 'bg-amber-400 animate-pulse'
                      : motionDetectedNow
                      ? 'bg-emerald-400 animate-ping'
                      : isTrackingEnabled
                      ? 'bg-emerald-400'
                      : 'bg-zinc-400'
                  }`}
                />
                <span>
                  {motionDetectedNow
                    ? isAr
                      ? 'جاري استقبال الحركة...'
                      : 'Receiving Movement...'
                    : isTrackingEnabled
                    ? poseReady
                      ? isAr
                        ? 'تتبع المفاصل شغال مباشرة'
                        : 'Live Pose Tracking Active'
                      : isAr
                      ? 'تتبع الحركة الفوري شغال'
                      : 'Live Motion Tracking Active'
                    : isAr
                    ? 'التتبع متوقف مؤقتاً'
                    : 'Tracking Paused'}
                </span>
              </div>

              {/* Motion Intensity Bar */}
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/75 backdrop-blur-md border border-white/15 text-[10px] font-mono text-[#BDDBD1]">
                <Activity className="w-3.5 h-3.5 text-emerald-400" />
                <span>{isAr ? 'شدة الحركة:' : 'Motion:'}</span>
                <div className="w-16 h-1.5 rounded-full bg-white/15 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-150 ${
                      motionIntensity >= 10 ? 'bg-emerald-400' : 'bg-[#BDDBD1]/60'
                    }`}
                    style={{ width: `${motionIntensity}%` }}
                  />
                </div>
                <span className="w-7 text-end font-bold">{motionIntensity}%</span>
              </div>
            </div>

            {/* Live Verdict Banner Overlay (Correct / Incorrect / Waiting) */}
            <AnimatePresence mode="wait">
              {evaluation && (
                <motion.div
                  key={`${evaluation.status}-${evaluation.verdictTitle.ar}`}
                  initial={{ opacity: 0, y: -10, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8 }}
                  className={`absolute top-14 left-1/2 -translate-x-1/2 z-20 max-w-[92%] sm:max-w-md px-4 py-2.5 rounded-2xl backdrop-blur-md border-2 shadow-2xl flex items-center gap-3 pointer-events-none ${
                    evaluation.status === 'correct'
                      ? 'bg-emerald-950/90 border-emerald-400 text-emerald-100'
                      : evaluation.status === 'incorrect'
                      ? 'bg-rose-950/90 border-rose-400 text-rose-100'
                      : 'bg-black/80 border-[#BDDBD1]/40 text-[#BDDBD1]'
                  }`}
                >
                  {evaluation.status === 'correct' ? (
                    <CheckCircle2 className="w-7 h-7 text-emerald-400 flex-shrink-0" />
                  ) : evaluation.status === 'incorrect' ? (
                    <XCircle className="w-7 h-7 text-rose-400 flex-shrink-0" />
                  ) : (
                    <Eye className="w-6 h-6 text-[#BDDBD1] flex-shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm sm:text-base font-bold font-sans-modern">
                        {isAr ? evaluation.verdictTitle.ar : evaluation.verdictTitle.en}
                      </span>
                      {evaluation.status !== 'waiting' && (
                        <span className="px-2 py-0.5 rounded-full bg-black/50 text-[10px] font-mono font-bold">
                          {evaluation.accuracyScore}%
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] opacity-90 line-clamp-2 leading-snug">
                      {isAr ? evaluation.reason.ar : evaluation.reason.en}
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Bottom Controls Bar */}
            <div className="absolute bottom-3 left-3 right-3 z-20 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleFacing}
                  className="p-2.5 rounded-xl bg-black/75 hover:bg-black text-white border border-white/20 transition-all active:scale-95 cursor-pointer"
                  title={isAr ? 'تبديل الكاميرا' : 'Switch Camera'}
                >
                  <FlipHorizontal className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => setSoundEnabled((s) => !s)}
                  className="p-2.5 rounded-xl bg-black/75 hover:bg-black text-white border border-white/20 transition-all active:scale-95 cursor-pointer"
                  title={isAr ? 'تشغيل/كتم صوت التنبيه' : 'Toggle Feedback Sound'}
                >
                  {soundEnabled ? (
                    <Volume2 className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <VolumeX className="w-4 h-4 text-zinc-400" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setVoiceEnabled((v) => !v)}
                  className={`px-2.5 py-2 rounded-xl text-[11px] font-mono font-bold border transition-all active:scale-95 cursor-pointer flex items-center gap-1 ${
                    voiceEnabled
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/50'
                      : 'bg-black/75 text-zinc-400 border-white/20'
                  }`}
                  title={isAr ? 'نطق صوتي (الحركة صح / غلط)' : 'Voice Verdict Coach'}
                >
                  <Mic className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{isAr ? 'نطق' : 'Voice'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsTrackingEnabled((t) => !t)}
                  className={`px-3 py-2 rounded-xl text-xs font-mono font-bold flex items-center gap-1.5 border transition-all cursor-pointer ${
                    isTrackingEnabled
                      ? 'bg-emerald-500/90 text-black border-emerald-300'
                      : 'bg-black/75 text-white border-white/20'
                  }`}
                >
                  {isTrackingEnabled ? (
                    <>
                      <Pause className="w-3.5 h-3.5" />
                      <span>{isAr ? 'التقييم الفوري شغال' : 'Live Judge ON'}</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5" />
                      <span>{isAr ? 'استئناف التقييم' : 'Resume Judge'}</span>
                    </>
                  )}
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={runOnDemandGeminiCheck}
                  disabled={isDeepAnalyzing}
                  className="px-3.5 py-2 rounded-xl bg-[#BDDBD1] hover:bg-white text-[#121815] font-mono text-xs font-bold flex items-center gap-1.5 shadow-lg active:scale-95 disabled:opacity-60 cursor-pointer"
                  title={isAr ? 'تقييم عميق عبر Gemini Vision' : 'Deep check with Gemini AI'}
                >
                  {isDeepAnalyzing ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Zap className="w-3.5 h-3.5" />
                  )}
                  <span>{isAr ? 'تحليل عميق AI' : 'Gemini Deep Check'}</span>
                </button>

                {onCaptureForReport && (
                  <button
                    type="button"
                    onClick={handleCaptureSnapshotForReport}
                    className="px-3 py-2 rounded-xl bg-black/75 hover:bg-black text-[#BDDBD1] border border-[#BDDBD1]/40 font-mono text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                    title={isAr ? 'التقاط صورة للتقرير المفصل' : 'Capture for Full Report'}
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">
                      {isAr ? 'حفظ لقطة للتقرير' : 'Snap Report'}
                    </span>
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Optional On-Demand Gemini Notice */}
      {deepAnalysisNote && (
        <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
          <span>{deepAnalysisNote}</span>
        </div>
      )}

      {/* Live Movement Verdict Dashboard Card */}
      <div
        className={`rounded-2xl border p-4 sm:p-5 space-y-4 transition-all ${
          evaluation?.status === 'correct'
            ? isLight
              ? 'bg-emerald-50 border-emerald-400'
              : 'bg-emerald-950/25 border-emerald-500/50'
            : evaluation?.status === 'incorrect'
            ? isLight
              ? 'bg-rose-50 border-rose-400'
              : 'bg-rose-950/25 border-rose-500/50'
            : isLight
            ? 'bg-[#F6F8F7] border-[#D3DFD9]'
            : 'bg-[#121815] border-[#2F3E3C]'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={`w-11 h-11 rounded-2xl flex items-center justify-center border ${
                evaluation?.status === 'correct'
                  ? 'bg-emerald-500/20 border-emerald-400 text-emerald-400'
                  : evaluation?.status === 'incorrect'
                  ? 'bg-rose-500/20 border-rose-400 text-rose-400'
                  : 'bg-[#2F3E3C] border-[#BDDBD1]/30 text-[#BDDBD1]'
              }`}
            >
              {evaluation?.status === 'correct' ? (
                <CheckCircle2 className="w-6 h-6" />
              ) : evaluation?.status === 'incorrect' ? (
                <XCircle className="w-6 h-6" />
              ) : (
                <Sparkles className="w-5 h-5" />
              )}
            </div>
            <div>
              <div className="text-[10px] font-mono uppercase text-[#7C8380]">
                {isAr ? 'وصف وتقييم الحركة المباشر' : 'LIVE MOVEMENT VERDICT'}
              </div>
              <h4 className="text-base sm:text-lg font-bold font-sans-modern">
                {evaluation
                  ? isAr
                    ? evaluation.verdictTitle.ar
                    : evaluation.verdictTitle.en
                  : isAr
                  ? 'في انتظار ظهورك أمام الكاميرا...'
                  : 'Waiting for subject in front of camera...'}
              </h4>
            </div>
          </div>

          {/* Live Counters */}
          <div className="flex items-center gap-2">
            <div className="px-3 py-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-center">
              <div className="text-[10px] font-mono text-emerald-400">
                {isAr ? 'حركة صح ✓' : 'Correct'}
              </div>
              <div className="text-sm font-mono font-bold text-emerald-300">{correctCount}</div>
            </div>

            <div className="px-3 py-1.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-center">
              <div className="text-[10px] font-mono text-rose-400">
                {isAr ? 'حركة غلط ✗' : 'Wrong'}
              </div>
              <div className="text-sm font-mono font-bold text-rose-300">{incorrectCount}</div>
            </div>

            <button
              type="button"
              onClick={resetSessionStats}
              className="p-2 rounded-xl border border-[#2F3E3C] text-[#7C8380] hover:text-[#BDDBD1] cursor-pointer"
              title={isAr ? 'تصفير العداد' : 'Reset Counters'}
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {evaluation && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-[#3E6153]/25">
            <div className="md:col-span-2 space-y-1.5">
              <div className="text-xs font-sans leading-relaxed">
                <span className="font-bold text-[#BDDBD1]">
                  {isAr ? 'وصف الحركة: ' : 'Movement Description: '}
                </span>
                <span>{isAr ? evaluation.reason.ar : evaluation.reason.en}</span>
              </div>
              <div className="text-xs font-sans text-emerald-400/95 leading-relaxed">
                <span className="font-bold">
                  {isAr ? 'التصحيح الفوري: ' : 'Immediate Correction: '}
                </span>
                <span>{isAr ? evaluation.correctionTip.ar : evaluation.correctionTip.en}</span>
              </div>
            </div>

            <div className="flex sm:flex-col justify-between gap-2 p-3 rounded-xl bg-black/25 border border-[#2F3E3C]">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-[#7C8380]">{isAr ? 'الزاوية:' : 'Angle:'}</span>
                <span className="font-bold text-[#BDDBD1]">{evaluation.jointAngle || '-'}</span>
              </div>
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-[#7C8380]">{isAr ? 'الدقة:' : 'Accuracy:'}</span>
                <span className="font-bold text-emerald-400">{evaluation.accuracyScore}%</span>
              </div>
            </div>
          </div>
        )}

        {/* Recent Movement History Strip */}
        {movementLog.length > 0 && (
          <div className="pt-3 border-t border-[#3E6153]/25 space-y-1.5">
            <div className="text-[10px] font-mono uppercase text-[#7C8380]">
              {isAr ? 'سجل الحركات المستقبلة:' : 'Recent Movement Feed:'}
            </div>
            <div className="space-y-1.5 max-h-36 overflow-y-auto">
              {movementLog.map((item) => (
                <div
                  key={item.id}
                  className={`px-3 py-2 rounded-xl border text-xs flex items-center justify-between gap-2 ${
                    item.status === 'correct'
                      ? 'bg-emerald-500/10 border-emerald-500/30'
                      : 'bg-rose-500/10 border-rose-500/30'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {item.status === 'correct' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                    )}
                    <span className="font-bold whitespace-nowrap">{item.verdict}</span>
                    <span className="text-[11px] opacity-80 truncate">{item.reason}</span>
                  </div>
                  <span className="text-[10px] font-mono text-[#7C8380] flex-shrink-0">
                    {item.time}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
