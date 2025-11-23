// optimizedOCR.js - 10초 내 완료를 위한 최적화된 OCR
import { createWorker } from 'tesseract.js';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import simpleRotationCheck, { autoRotateImage } from './checkImgRotated.js';

// 단일 Worker 인스턴스를 재사용 (초기화 시간 단축)
let globalWorker = null;

async function getOCRWorker() {
  if (!globalWorker) {
    try {
      globalWorker = await createWorker('kor+eng', 1, {
        logger: () => {}, // 로그 비활성화로 성능 향상
      });

      // 최적 파라미터 미리 설정
      await globalWorker.setParameters({
        tessedit_pageseg_mode: '11', // 테스트에서 최적으로 확인된 PSM
        preserve_interword_spaces: '1',
        user_defined_dpi: '300',
        tessedit_enable_dict_correction: '1',
      });
    } catch (error) {
      console.warn('한국어+영어 초기화 실패, 영어만 사용:', error.message);
      globalWorker = await createWorker('eng');
    }
  }
  return globalWorker;
}

// 빠른 이미지 전처리 (단일 최적화 방식)
async function fastPreprocess(inputPath) {
  try {
    const tempPath = inputPath.replace(path.extname(inputPath), '_fast.png');

    // 이미지 분석을 통한 동적 처리
    const metadata = await sharp(inputPath).metadata();
    const stats = await sharp(inputPath).stats();

    const brightness = stats.channels[0]?.mean || 128;
    const isLowContrast = stats.channels[0]?.stdev < 50;

    let pipeline = sharp(inputPath)
      .resize(2000, null, {
        fit: 'inside',
        kernel: sharp.kernel.lanczos3,
        withoutEnlargement: false,
      })
      .grayscale();

    // 조건부 최적화 적용
    if (brightness < 140 || isLowContrast) {
      pipeline = pipeline
        .normalize()
        .linear(2.0, -80) // 대비 강화
        .threshold(110); // 이진화
    } else {
      pipeline = pipeline.normalize().sharpen();
    }

    await pipeline.png({ quality: 100, compressionLevel: 1 }).toFile(tempPath);

    return tempPath;
  } catch (error) {
    console.warn('전처리 실패, 원본 사용:', error.message);
    return inputPath;
  }
}

// 메인 OCR 함수 (최적화)
export async function extractTextFromImageFast(imagePath, options = {}) {
  const startTime = Date.now();
  let preprocessedPath = null;
  let rotatedImagePath = null;

  try {
    console.log('빠른 OCR 시작...');

    // 1. 회전 감지 및 자동 회전
    let isRotated = false;
    try {
      isRotated = await simpleRotationCheck(imagePath);
      console.log(`회전 감지 결과: ${isRotated ? '회전 필요' : '정상'}`);
    } catch (rotationError) {
      console.warn('회전 체크 실패, 계속 진행:', rotationError.message);
      isRotated = false;
    }

    // 회전이 필요한 경우 자동 회전 시도
    if (isRotated) {
      try {
        const rotatedPath = imagePath.replace(
          path.extname(imagePath),
          '_rotated.png'
        );
        const rotationSuccess = await autoRotateImage(imagePath, rotatedPath);

        if (rotationSuccess && fs.existsSync(rotatedPath)) {
          console.log('이미지 자동 회전 완료, 회전된 이미지로 OCR 진행');
          rotatedImagePath = rotatedPath;
          // 회전된 이미지로 계속 진행
        } else {
          console.warn('자동 회전 실패, 원본 이미지로 진행');
          return {
            success: false,
            error:
              '이미지가 회전되어있습니다. 올바른 방향(예: 세로)으로 촬영해주세요',
            processingTime: Date.now() - startTime,
          };
        }
      } catch (rotationError) {
        console.error('자동 회전 중 오류:', rotationError.message);
        return {
          success: false,
          error: '이미지 회전 처리 중 오류가 발생했습니다.',
          processingTime: Date.now() - startTime,
        };
      }
    }

    // 2. 빠른 전처리 (회전된 이미지가 있으면 그것을 사용)
    const imageToProcess = rotatedImagePath || imagePath;
    preprocessedPath = await fastPreprocess(imageToProcess);

    // 3. OCR 실행
    const worker = await getOCRWorker();
    const result = await worker.recognize(preprocessedPath);

    const text = result.data?.text || '';
    const confidence = result.data?.confidence || 0;

    console.log(
      `OCR 완료 - 신뢰도: ${confidence.toFixed(1)}%, 처리시간: ${
        Date.now() - startTime
      }ms`
    );

    // 4. 임시 파일 정리
    if (preprocessedPath !== imagePath && fs.existsSync(preprocessedPath)) {
      fs.unlinkSync(preprocessedPath);
    }

    // 회전된 이미지 파일 정리
    if (rotatedImagePath && fs.existsSync(rotatedImagePath)) {
      fs.unlinkSync(rotatedImagePath);
    }

    return {
      success: true,
      text,
      confidence,
      processingTime: Date.now() - startTime,
      wasRotated: !!rotatedImagePath,
    };
  } catch (error) {
    console.error('빠른 OCR 실패:', error);

    // 정리
    if (
      preprocessedPath &&
      preprocessedPath !== imagePath &&
      fs.existsSync(preprocessedPath)
    ) {
      fs.unlinkSync(preprocessedPath);
    }

    if (rotatedImagePath && fs.existsSync(rotatedImagePath)) {
      fs.unlinkSync(rotatedImagePath);
    }

    return {
      success: false,
      text: '',
      confidence: 0,
      error: error.message,
      processingTime: Date.now() - startTime,
    };
  }
}

// TUID 추출 및 검증 (최적화)
export function extractTUID(text) {
  if (!text) return null;

  // 1단계: 빠른 필터링
  const cleanText = text.replace(/[^A-Za-z0-9\n]/g, '');
  const lines = cleanText.split('\n');

  // 2단계: 길이 기반 후보 추출
  const candidates = [];

  // 18~31자리수의 문자열이면 추출
  for (const line of lines) {
    if (line.length >= 18 && line.length <= 31) {
      candidates.push(line);
    }
  }

  // 3단계: TUID 패턴 매칭
  for (const candidate of candidates) {
    // A,B,4,8,5,6으로 시작하고 15~30자리 수의 숫자가 반복되는 문자열 검출
    const matches = candidate.match(/[AB4856][0-9]{15,30}/);

    console.log('matches: ');
    console.log(matches);

    if (matches) {
      let tuid = matches[0];

      // 4단계: OCR 오류 보정
      const firstChar = tuid[0];
      if (firstChar === '4') tuid = 'A' + tuid.slice(1);
      if (['8', '5', '6'].includes(firstChar)) tuid = 'B' + tuid.slice(1);

      return tuid;
    }
  }

  return null;
}

// Worker 정리 함수 (앱 종료 시 호출)
export async function cleanupOCRWorker() {
  if (globalWorker) {
    try {
      await globalWorker.terminate();
      globalWorker = null;
    } catch (error) {
      console.warn('Worker 정리 실패:', error.message);
    }
  }
}

export default extractTextFromImageFast;
