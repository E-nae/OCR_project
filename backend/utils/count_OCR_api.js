import dotenv from 'dotenv';
dotenv.config();
import header from '../controller/header.js';
import generateTUID from './generateTUID.js';
import axios from 'axios';

const getDate = () => {
  let now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const nextMonth = String(now.getMonth() + 2).padStart(2, '0');

  return {
    startOfMonth: `${year}-${month}-01`,
    nextMonth: `${year}-${nextMonth}-01`,
  };
};

// 카운트 초기화 여부 확인 및 처리
const count_OCR_api = async () => {
  try {
    const { startOfMonth, nextMonth } = getDate();

    console.log(`조회 기간: ${startOfMonth} ~ ${nextMonth}`);

    // SQL 쿼리 실행 (created_at 컬럼을 기준으로 함)
    const table = process.env.GOOGLE_VISION_LOG_TABLE;
    const query = `SELECT COUNT(*) as TUID FROM ${table} WHERE DT_IN >= '${startOfMonth}' AND DT_IN < '${nextMonth}'`;
    const tuid = generateTUID();
    const headers = header('application/json', 1, 'POST', tuid);
    const API_PATH = process.env.COMMON_API;

    const data = {
      METHOD: 'POST',
      RUN: 'Y',
      DIRECT: 'Y',
      VIEW: 'N',
      LANG: 'KR',
      DB: process.env.GOOGLE_VISION_LOG_DB_KEY,
      QRY: query,
      TUID: tuid,
    };

    const response = await axios.post(API_PATH, data, { headers });
    console.log(`이번 달 데이터 개수: `);
    console.log(response.data);

    if (response.data?.validity !== 'true') {
      return { ok: false, count: null, message: 'OCR 요청 회수 조회 실패' };
    }

    const result = response.data?.data?.DATA[0]?.TUID;
    const count = Number(result);

    return {
      ok: true,
      count,
    };
  } catch (error) {
    console.error('Error in initialize_OCR_Count:', error);
    throw error;
  }
};

export default count_OCR_api;
