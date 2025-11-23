import vision from '@google-cloud/vision';
import fs from 'fs';
import DBSave from '../controller/saveRefund.js';
import path from 'path';
import { fileURLToPath } from 'url';

// ES module에서 __dirname 대신 사용
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 임시 디렉토리 및 최종 업로드 디렉토리 설정
const keyFilePath = path.join(
  __dirname,
  '..',
  'config',
  'svcm-8d53e-71393b1afec6.json'
);

/**
 * Google Cloud Vision API를 사용하여 이미지에서 텍스트를 추출하는 함수
 * @param {string} imagePath - 텍스트를 추출할 이미지 파일의 경로
 * @param {string} keyFilePath - Google Cloud에서 다운로드한 JSON 인증 키 파일의 경로
 */
async function detectTextWithGoogleVision(req, imagePath, SID) {
  // 이미지 파일이 존재하는지 확인합니다.
  if (!fs.existsSync(imagePath)) {
    console.error('오류: 이미지 파일을 찾을 수 없습니다.', imagePath);
    return { ok: false, payload: '이미지 파일을 찾을 수 없습니다.' };
  }
  // 인증 키 파일이 존재하는지 확인합니다.
  if (!fs.existsSync(keyFilePath)) {
    console.error(
      '오류: Google Cloud 인증 키 파일을 찾을 수 없습니다.',
      keyFilePath
    );
    console.error(
      '사전 준비 단계를 확인하여 JSON 키 파일을 다운로드하고 경로를 올바르게 지정했는지 확인하세요.'
    );
    return {
      ok: false,
      payload: 'Google Cloud 인증 키 파일을 찾을 수 없습니다.',
    };
  }

  try {
    const rootPath = process.cwd();
    const KEY_FILE_PATH = path.join(
      rootPath,
      'config',
      ''
    );

    // 인증 정보를 사용하여 Vision API 클라이언트를 생성합니다.
    const client = new vision.ImageAnnotatorClient({
      keyFilename: KEY_FILE_PATH,
    });

    console.log('Google Cloud Vision API로 텍스트 인식을 요청합니다...');

    // API에 텍스트 인식을 요청합니다.
    const [result] = await client.textDetection(imagePath);

    const detections = result.textAnnotations;

    // API 응답을 확인합니다.
    if (detections && detections.length > 0) {
      // 첫 번째 결과(detections[0])는 이미지에서 인식된 전체 텍스트를 포함합니다.
      const fullText = detections[0].description;
      console.log('--- Google Vision OCR 인식 결과 ---');
      console.log(fullText); // 앞뒤 공백 제거
      console.log(fullText?.trim()); // 앞뒤 공백 제거
      console.log('-----------------------------------');

      /** 거래번호(TUID) 추출 */
      // const match = fullText?.trim()?.match(/거래번호\s*(\d{30})/);
      const match = fullText?.match(/[A-Za-z]\d{29}|\d{30}/g)?.[0];

      console.log('matched: '); // 30자리 문자열 출력
      console.log(match); // 30자리 문자열 출력

      if (!match) {
        console.log('이미지에서 텍스트를 찾지 못했습니다.');
        return {
          ok: false,
          payload: '이미지의 상태가 좋지 않습니다. 다시 촬영해주세요',
        };
      }
      const fstStr = match?.slice(0, 1);
      console.log(fstStr);

      let finalTuid = match;

      if (fstStr === 4 || fstStr === '4') {
        finalTuid = finalTuid?.replace(fstStr, 'A');
      }
      if (fstStr === 8 || fstStr === '8') {
        finalTuid = finalTuid?.replace(fstStr, 'B');
      }

      console.log('finalTuid: ');
      console.log(finalTuid);

      /*** API 사용 횟수 DB에 로그 저장 */
      const TABLE = process.env.GOOGLE_VISION_LOG_TABLE;
      const DBNAME = process.env.GOOGLE_VISION_LOG_DB_KEY;
      const DATA = {
        TUID: finalTuid,
      };

      console.log('finalTuid: ');
      console.log(finalTuid);
      const logInsert = new DBSave(req, DATA, SID, TABLE, DBNAME);
      const result = await logInsert.save();

      /** 로그 저장 실패 */
      if (!result.ok) {
        console.log('구글 비전 에러: 구글 api 사용 로그 저장 실패');
        return {
          ok: false,
          payload: '구글 비전 에러: 구글 api 사용 로그 저장 실패',
        };
      }
      /** 로그 저장 후 */
      if (finalTuid) {
        // 추출 결과 전송
        console.log('구글 비전 추출 완료: ');
        return { ok: true, payload: finalTuid };
      }
    } else {
      console.log('이미지에서 텍스트를 찾지 못했습니다.');
      return { ok: false, payload: '이미지에서 텍스트를 찾지 못했습니다.' };
    }
  } catch (error) {
    // API 오류 또는 기타 예외 처리
    console.error('API 요청 중 오류가 발생했습니다:', error.message);
    return { ok: false, payload: 'API 요청 중 오류가 발생했습니다.' };
  }
}

export default detectTextWithGoogleVision;
