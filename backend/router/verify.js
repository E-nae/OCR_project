// optimized_verify.js - 최적화된 검증 라우터
import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import fs from 'fs';
import multer from 'multer';
import cors from 'cors';
import {
  extractTextFromImageFast,
  extractTUID,
} from '../../util/optimizedOCR.js';
import compareTUID from '../../util/compareTUID.js';
import count_OCR_api from '../../util/count_OCR_api.js';
import detectTextWithGoogleVision from '../../util/google_vision.js';
import { OCR } from '../../config/OCR.js';

const whitelist = [
  'http://localhost:3000',
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || whitelist.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'X-Access-Token',
    'Authorization',
  ],
};

const storage = multer.memoryStorage();
const upload = multer({ storage });
const uploadTracker = {};
const router = express.Router();

// 응답 헬퍼 함수
const sendResponse = (res, validity, data = null, message = '') => {
  const response = {
    validity,
    data: {
      DATA: data,
      FNM: '',
      message,
    },
  };
  console.log(
    `응답 전송: validity=${validity}, message=${message} data=${data}`
  );
  return res.send(response);
};

// 파일 정리 헬퍼
const cleanupFile = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.warn('파일 삭제 실패:', error.message);
  }
};

router.options('/img', cors(corsOptions));

router.post(
  '/img',
  cors(corsOptions),
  upload.single('CHUNK'),
  async (req, res) => {
    let sent = false;
    const send = (success, data, msg) => {
      if (!sent && !res.headersSent) {
        sent = true;
        console.log(`=== 응답 전송 시도: ${success} ===`);

        // 응답 전송 전 약간의 지연
        setTimeout(() => {
          try {
            const result = sendResponse(res, success, data, msg);
            console.log(`응답 전송 완료: ${success}`);
            return result;
          } catch (e) {
            console.error(`응답 전송 실패:`, e);
          }
        }, 10); // 10ms 지연
      } else {
        console.warn(
          `응답 전송 실패 - 이미 전송됨: sent=${sent}, headersSent=${res.headersSent}`
        );
      }
    };

    try {
      const { CHUNK_IDX, CHUNK_TOTAL, FILENAME, PAYLOAD } = req.body;

      // 빠른 검증
      if (
        !CHUNK_IDX ||
        !CHUNK_TOTAL ||
        !FILENAME ||
        !PAYLOAD ||
        !req.file?.buffer
      ) {
        return send('false', null, '필수 파라미터 누락');
      }

      const payload = JSON.parse(PAYLOAD);
      const SID = payload.TUID;

      if (!SID) return send('false', null, 'SID 누락');

      const chunkIndex = parseInt(CHUNK_IDX);
      const totalChunks = parseInt(CHUNK_TOTAL);
      const chunkData = req.file.buffer;

      console.log(`=== 청크 요청: ${SID} - ${chunkIndex}/${totalChunks} ===`);

      // 이미지 병합
      const imagePath = await imageMerge(
        FILENAME,
        SID,
        chunkData,
        chunkIndex,
        totalChunks,
        uploadTracker
      );

      console.log(`imageMerge 응답:`, imagePath || 'undefined');

      // 중간 청크면 진행 상황 응답
      if (!imagePath) {
        console.log(`진행 응답 전송: ${chunkIndex + 1}/${totalChunks}`);
        return send(
          'progress',
          {
            chunk: chunkIndex + 1,
            total: totalChunks,
            sid: SID,
          },
          '청크 처리됨'
        );
      }

      // 완료 - 파일 존재 재확인
      if (!fs.existsSync(imagePath)) {
        console.error('최종 파일이 존재하지 않음:', imagePath);
        return send('false', null, '파일 생성 실패');
      }

      console.log(`=== 최종 완료 응답 전송: ${imagePath} ===`);
      return send('true', imagePath, '업로드 완료'); 
    } catch (error) {
      console.error('업로드 에러:', error.message);
      return send('false', null, error.message);
    }
  }
);

router.options(
  '/ocr',
  cors({
    origin: '*',
    credentials: false,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    preflightContinue: false, 
    optionsSuccessStatus: 204, 
  }),
  (req, res) => {
    res.sendStatus(200);
  }
);
router.post(
  '/ocr',
  cors({
    origin: '*',
    credentials: false,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    preflightContinue: false, // 추가
    optionsSuccessStatus: 204, // 추가
  }),
  async (req, res) => {
    const requestStart = Date.now();
    try {
      const imagePath = req.body.IMG_PATH;
      console.log('도착한 imagePath: ');
      console.log(imagePath);

      if (!imagePath) {
        console.log('이미지 경로 누락');

        return sendResponse(res, 'false', null, '이미지 경로 누락, OCR 실패');
      }
      // OCR 실행 (최적화된 버전)
      const ocrResult = await extractTextFromImageFast(imagePath);

      if (!ocrResult.success) {
        cleanupFile(imagePath);
        return sendResponse(
          res,
          'false',
          null,
          ocrResult.error || 'OCR 실행 실패'
        );
      }

      console.log(
        `OCR 완료 - 신뢰도: ${ocrResult.confidence}%, 시간: ${ocrResult.processingTime}ms`
      );

      console.log('tesseract result: ');
      console.log(ocrResult.text);

      // TUID 추출
      const extractedTUID = extractTUID(ocrResult.text);
      console.log('추출된 TUID:', extractedTUID);

      // TUID를 일부라도 추출하지 못할 경우
      if (!extractedTUID) {
        cleanupFile(imagePath);
        return sendResponse(
          res,
          'false',
          null,
          '이미지의 상태가 좋지 않습니다. 재촬영해주세요'
        );
      }

      // TUID 검증
      const apiResponse = await compareTUID(extractedTUID);

      if (apiResponse.ok) {
        console.log(
          `Tesseract TUID 검증 성공 - 총 소요시간: ${
            Date.now() - requestStart
          }ms`
        );
        cleanupFile(imagePath);
        return sendResponse(res, 'true', extractedTUID, 'TUID 추출 완료');
      }

      // Tesseract로 일부만 추출(온전한 TUID 추출 실패 시) Google Vision API 시도
      console.log('Tesseract TUID 검증 실패, Google Vision API 시도');

      // 사용량 체크
      const countResult = await count_OCR_api();

      if (!countResult.ok || countResult.count === undefined) {
        cleanupFile(imagePath);
        return sendResponse(
          res,
          'false',
          null,
          '구글 클라우드 비전 사용 횟수 조회 실패'
        );
      }

      if (countResult.count > OCR.maxCount) {
        cleanupFile(imagePath);
        return sendResponse(
          res,
          'false',
          null,
          '구글 클라우드 비전 사용 횟수 초과'
        );
      }

      // Google Vision API 실행
      const googleVisionResult = await detectTextWithGoogleVision(
        req,
        imagePath,
        SID
      );

      if (!googleVisionResult.ok) {
        cleanupFile(imagePath);
        return sendResponse(
          res,
          'false',
          null,
          googleVisionResult.payload || 'Google Vision 실행 실패'
        );
      }

      // Google Vision 결과 검증
      const googleApiResponse = await compareTUID(googleVisionResult.payload);

      if (!googleApiResponse.ok) {
        cleanupFile(imagePath);
        return sendResponse(
          res,
          'false',
          null,
          `이미지 상태가 좋지 않습니다. ${googleApiResponse.message}`
        );
      }

      // 성공
      console.log(
        `Google Vision TUID 검증 성공 - 총 소요시간: ${
          Date.now() - requestStart
        }ms`
      );
      cleanupFile(imagePath);
      return sendResponse(
        res,
        'true',
        googleVisionResult.payload,
        'TUID 추출 완료'
      );
    } catch (error) {
      console.log(error);
      return sendResponse(res, 'false', null, 'OCR 실패');
    }
  }
);

export default router;
