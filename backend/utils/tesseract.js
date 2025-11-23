import dotenv from 'dotenv';
dotenv.config();
import { createWorker } from 'tesseract.js';
import fs from 'fs';
import path from 'path';
import createMultiplePreprocessed from './preprocessImg.js';

// 범용 OCR Worker 생성 함수
export async function createOCRWorker(language = 'kor+eng') {
  let worker;

  try {
    // 최신 버전 방식 시도
    worker = await createWorker(language);
    return worker;
  } catch (error) {
    console.log('최신 방식 실패, 호환 방식 시도...');

    try {
      // 호환성을 위한 단계별 초기화
      worker = await createWorker();
      await worker.loadLanguage(language);
      await worker.initialize(language);
      return worker;
    } catch (error2) {
      console.log('언어팩 로딩 실패, 기본 영어로 초기화...');

      try {
        worker = await createWorker('eng');
        return worker;
      } catch (error3) {
        console.error('모든 Worker 생성 방식 실패');
        throw error3;
      }
    }
  }
}

// 강화된 OCR 함수
export async function performOCR(imagePath, options = {}) {
  let worker = null;

  try {
    console.log(`OCR 시작: ${path.basename(imagePath)}`);

    const config = {
      lang: 'kor+eng',
      ...options,
    };

    // Worker 생성
    worker = await createOCRWorker(config.lang);

    // PSM 11 모드 설정 (테스트에서 최적으로 확인)
    const psmModes = [11, 6, 7]; // 11을 우선으로
    let bestResult = { text: '', confidence: 0 };

    for (const psm of psmModes) {
      try {
        // Tesseract 파라미터 설정
        await worker.setParameters({
          tessedit_pageseg_mode: psm.toString(),
          preserve_interword_spaces: '1',
          user_defined_dpi: '300',
          tessedit_enable_doc_dict: '0',
          tessedit_enable_dict_correction: '1',
        });

        const result = await worker.recognize(imagePath);

        // 버전 호환성을 위한 텍스트/신뢰도 추출
        let text = '';
        let confidence = 0;

        if (result && result.data) {
          text = result.data.text || '';
          confidence = result.data.confidence || 0;
        } else if (result) {
          text = result.text || '';
          confidence = result.confidence || 0;
        }

        text = text.trim();

        console.log(
          `PSM ${psm}: 텍스트 길이 ${text.length}, 신뢰도: ${confidence.toFixed(
            1
          )}%`
        );

        if (
          confidence > bestResult.confidence ||
          (confidence > 30 && text.length > bestResult.text.length)
        ) {
          bestResult = { text, confidence, psm };
        }

        // PSM 11에서 좋은 결과가 나오면 우선 채택
        if (psm === 11 && confidence > 76) {
          break;
        }
      } catch (psmError) {
        console.warn(`PSM ${psm} 실패:`, psmError.message);
      }
    }

    return bestResult;
  } catch (error) {
    console.error('OCR 오류:', error);
    return { text: '', confidence: 0, error: error.message };
  } finally {
    if (worker) {
      try {
        await worker.terminate();
      } catch (e) {
        console.warn('Worker 종료 실패:', e.message);
      }
    }
  }
}

// 메인 OCR 함수
export async function extractTextFromImage(inputImagePath, options = {}) {
  const { keepDebugFiles = false, verbose = true } = options;
  let preprocessedImages = [];

  try {
    console.log('=== 이미지에서 텍스트 추출 시작 ===');

    // 1. 이미지 분석
    if (verbose) await analyzeImage(inputImagePath);

    // 2. 다중 전처리 실행
    preprocessedImages = await createMultiplePreprocessed(inputImagePath);

    // 3. 각 전처리 결과에 대해 OCR 실행
    const allResults = [];

    // 언어 설정들 (테스트 결과 기반으로 우선순위 조정)
    const langConfigs = [
      { lang: 'kor+eng' }, // 최적으로 확인된 설정
      // { lang: 'kor' },
      // { lang: 'eng' },
    ];

    for (const processed of preprocessedImages) {
      console.log(`\n--- ${processed.type.toUpperCase()} 방식 OCR ---`);

      for (const langConfig of langConfigs) {
        try {
          const result = await performOCR(processed.path, langConfig);

          if (result.text && result.text.length > 0) {
            allResults.push({
              ...result,
              preprocessType: processed.type,
              langConfig: langConfig.lang,
              imagePath: processed.path,
            });
          }
        } catch (error) {
          console.warn(
            `${processed.type} + ${langConfig.lang} 실패:`,
            error.message
          );
        }
      }
    }

    // 4. 결과 없음 처리
    if (allResults.length === 0) {
      console.log('❌ 모든 OCR 시도가 실패했습니다.');
      return {
        success: false,
        text: '',
        confidence: 0,
        error: 'No text extracted from any method',
      };
    }

    // 5. 최적 결과 선택 (신뢰도와 텍스트 길이 종합 고려)
    allResults.sort((a, b) => {
      const scoreA = a.confidence * 0.7 + Math.min(a.text.length, 100) * 0.3;
      const scoreB = b.confidence * 0.7 + Math.min(b.text.length, 100) * 0.3;
      return scoreB - scoreA;
    });

    const bestResult = allResults[0];

    // 6. 결과 출력
    console.log(
      '\n========================= 최종 결과 ==========================='
    );
    console.log(`✅ 성공!`);
    console.log(`전처리: ${bestResult.preprocessType}`);
    console.log(`언어: ${bestResult.langConfig}`);
    console.log(`PSM: ${bestResult.psm}`);
    console.log(`신뢰도: ${bestResult.confidence.toFixed(1)}%`);
    console.log(`텍스트 길이: ${bestResult.text.length}자`);
    console.log(`추출된 텍스트:`);
    console.log(`"${bestResult.text}"`);

    // 7. 정리
    if (!keepDebugFiles) {
      for (const img of preprocessedImages) {
        if (img.path !== inputImagePath && fs.existsSync(img.path)) {
          try {
            fs.unlinkSync(img.path);
          } catch (e) {
            console.warn('임시 파일 삭제 실패:', e.message);
          }
        }
      }
    }

    return {
      success: true,
      text: bestResult.text,
      confidence: bestResult.confidence,
      preprocessType: bestResult.preprocessType,
      langConfig: bestResult.langConfig,
      psmMode: bestResult.psm,
      debugImagePath: keepDebugFiles ? bestResult.imagePath : null,
    };
  } catch (error) {
    console.error('텍스트 추출 오류:', error);

    // 정리
    for (const img of preprocessedImages) {
      if (img.path !== inputImagePath && fs.existsSync(img.path)) {
        try {
          fs.unlinkSync(img.path);
        } catch (e) {
          console.warn('정리 중 파일 삭제 실패:', e.message);
        }
      }
    }

    return {
      success: false,
      text: '',
      confidence: 0,
      error: error.message,
    };
  }
}

export default extractTextFromImage;
