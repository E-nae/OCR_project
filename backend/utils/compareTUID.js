import dotenv from 'dotenv';
dotenv.config();
import axios from 'axios';
import generateTUID from '../util/generateTUID.js';
import header from '../controller/header.js';

const compareTUID = async (payload) => {
  try {
    const tuid = generateTUID();
    const headers = header('application/json', 1, 'POST', tuid);
    const API_PATH = process.env.CHECK_TUID_PATH;

    const data = {
      DEBUG: 'Y',
      PAYLOAD: {
        TUID: payload,
      },
    };

    const response = await axios.post(`${API_PATH}`, data, { headers });
    console.log('TUID 확인 결과: ');
    console.log(response?.data);

    if (response.data?.validity !== 'true') {
      console.log('TUID 확인 실패: ');
      return {
        ok: false,
        message: 'TUID 확인 실패: ',
      };
    }

    if (!response.data?.data) {
      console.log('일치하는 TUID 확인 실패: ');
      return {
        ok: false,
        message: '일치하는 TUID 확인 실패: ',
      };
    }

    return { ok: true, message: 'TUID 확인 완료' };
  } catch (error) {
    return error;
  }
};

export default compareTUID;
